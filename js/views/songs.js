/* =========================================================
   Setlist Lab — 楽曲画面
   iTunes の30秒試聴を解析して特徴量を作り、必要なら手動で補正する。
   ここで作った「激しさ」が起伏分析の入力になる。
   ========================================================= */

import { el, clear, modal, toast, empty, field, debounce, intensityColor } from '../ui.js';
import { songKey, matchTrack } from '../normalize.js';
import * as store from '../store.js';
import * as api from '../api.js';
import { analyzePreview, audioSupported } from '../audio.js';
import { collectSongs, recomputeIntensities, effectiveIntensity, setManualIntensity } from '../features.js';
import { currentArtist, currentSetlists, render } from '../main.js';

export function renderSongs() {
  const view = el('div.view');
  const artist = currentArtist();

  view.appendChild(el('div.view-head', [
    el('h1', '楽曲'),
    el('p', 'iTunes の30秒試聴をブラウザ内で解析して、曲ごとの「激しさ」を割り出します。この値が起伏分析の土台になります。'),
  ]));

  if (!artist) {
    view.appendChild(empty('🎤', 'アーティストが登録されていません。'));
    return view;
  }

  const songs = collectSongs(currentSetlists());
  if (!songs.length) {
    view.appendChild(empty('🎵', '曲がありません。', '「公演」画面からセットリストを取り込んでください。'));
    return view;
  }

  const features = store.getFeatures();
  const analyzed = songs.filter((s) => Number.isFinite(effectiveIntensity(features[s.key])));

  /* --- 解析パネル --- */
  view.appendChild(analyzePanel(artist, songs, analyzed));

  /* --- 曲一覧 --- */
  view.appendChild(el('div.section', [
    el('h2', ['曲一覧', el('span.count', `${songs.length}曲`)]),
    el('div.stack', { style: { gap: '5px' } }, songs.map((s) => songRow(s, artist))),
  ]));

  return view;
}

/* ---------------------------------------------------------
   解析パネル
   --------------------------------------------------------- */

function analyzePanel(artist, songs, analyzed) {
  const box = el('div.card', { style: { marginBottom: '18px' } });
  const remaining = songs.length - analyzed.length;

  box.appendChild(el('div.spread', [
    el('div.grow', [
      el('b', `解析済み ${analyzed.length} / ${songs.length} 曲`),
      el('div.tiny.dim', { style: { marginTop: '3px' } },
        remaining ? `未解析が ${remaining} 曲あります` : 'すべての曲に特徴量があります'),
    ]),
    el('button.btn.sm.primary', {
      disabled: !remaining || !audioSupported(),
      onclick: () => runBatch(artist, songs.filter((s) => !Number.isFinite(effectiveIntensity(store.getFeatures()[s.key])))),
    }, '未解析の曲を解析'),
  ]));

  if (analyzed.length) {
    box.appendChild(el('div.row.tight', { style: { marginTop: '10px' } }, [
      el('button.btn.sm.ghost', {
        onclick: () => runBatch(artist, songs),
      }, 'すべて解析し直す'),
      el('button.btn.sm.ghost', {
        onclick: () => {
          const n = recomputeIntensities(songs.map((s) => s.key));
          render();
          toast(`${n}曲の激しさを付け直しました`);
        },
      }, '激しさを再計算'),
    ]));
  }

  if (!audioSupported()) {
    box.appendChild(el('div.notice.danger', { style: { marginTop: '10px' } },
      'このブラウザは Web Audio に対応していないため、自動解析が使えません。各曲の「手動で設定」から入力してください。'));
  }

  // iPhone / iPad は Apple 側の転送で iTunes 検索を直接呼べない
  if (api.itunesNeedsProxy()) {
    box.appendChild(el('div.notice.warn', { style: { marginTop: '10px' } }, [
      el('b', 'この端末では取得サーバーの設定が必要です。'),
      ' iPhone・iPad からは Apple が iTunes の検索を Music アプリへ転送するため、'
      + 'ブラウザから直接呼べません。設定画面で Worker のURLを登録してください。',
    ]));
  }

  box.appendChild(el('div.tiny.dim', { style: { marginTop: '10px', lineHeight: '1.75' } }, [
    '30秒の試聴はサビ付近が切り出されることが多いため、静かな導入を持つバラードが高めに出ることがあります。',
    'ずれている曲は各行の「調整」から直してください。手動で設定した値は再解析しても上書きされません。',
  ]));

  return box;
}

/* ---------------------------------------------------------
   一括解析
   --------------------------------------------------------- */

function runBatch(artist, targets) {
  if (!targets.length) { toast('解析対象がありません'); return; }

  modal('楽曲を解析', (body, close) => {
    const bar = el('i', { style: { width: '0%' } });
    const status = el('div.small.muted');
    const log = el('div.stack', { style: { gap: '3px', maxHeight: '220px', overflow: 'auto', marginTop: '4px' } });
    const controller = new AbortController();
    let stopped = false;

    body.appendChild(el('div.stack', [
      el('div.small', `${targets.length}曲を順番に解析します。1曲あたり数秒かかります。`),
      el('div.progress', [bar]),
      status,
      log,
      el('div.row', { style: { justifyContent: 'flex-end' } }, [
        el('button.btn.sm.ghost', { onclick: () => { stopped = true; controller.abort(); close(); render(); } }, '中止'),
      ]),
    ]));

    (async () => {
      const songMap = store.getSongMap();
      let done = 0, okCount = 0, ngCount = 0;

      for (const song of targets) {
        if (stopped) break;
        status.textContent = `${done + 1} / ${targets.length} — ${song.name}`;

        try {
          // 手動リンク済みならそれを使う。無ければ iTunes で探す。
          let track = songMap[song.key] || null;
          let confidence = track ? 'manual' : null;

          if (!track) {
            const hits = await api.searchTracks(`${artist.name} ${song.name}`, { limit: 8, signal: controller.signal });
            const m = matchTrack(song.name, artist.name, hits);
            if (m) { track = m.track; confidence = m.confidence; }
          }

          if (!track || !track.previewUrl) {
            throw new Error('試聴音源が見つかりません');
          }

          const raw = await analyzePreview(track.previewUrl, { signal: controller.signal });

          store.saveFeature(song.key, {
            displayName: song.name,
            bpm: raw.bpm,
            energy: raw.energy,
            brightness: raw.brightness,
            dynamics: raw.dynamics,
            itunesId: track.itunesId,
            jaTitle: track.title,
            artwork: track.artwork,
            previewUrl: track.previewUrl,
            confidence,
            analyzedAt: Date.now(),
          });

          okCount += 1;
          log.appendChild(el('div.tiny', [
            el('span', { style: { color: 'var(--ok)' } }, '✓ '),
            el('span', song.name),
            el('span.dim', ` → ${track.title}`),
            confidence === 'artist' ? el('span', { style: { color: 'var(--warn)' } }, '（要確認）') : null,
          ]));
        } catch (e) {
          if (e.name === 'AbortError') break;
          ngCount += 1;
          log.appendChild(el('div.tiny', [
            el('span', { style: { color: 'var(--danger)' } }, '✕ '),
            el('span', song.name),
            el('span.dim', ` — ${e.message}`),
          ]));
        }

        done += 1;
        bar.style.width = `${Math.round((done / targets.length) * 100)}%`;
        log.scrollTop = log.scrollHeight;
      }

      if (stopped) return;

      // 激しさはアーティスト全体の相対値なので、まとめて計算し直す
      const allKeys = collectSongs(currentSetlists()).map((s) => s.key);
      recomputeIntensities(allKeys);

      status.replaceChildren(el('b', `完了: 成功 ${okCount}曲 / 失敗 ${ngCount}曲`));
      bar.style.background = ngCount && !okCount ? 'var(--danger)' : 'var(--ok)';
      setTimeout(() => { close(); render(); }, 900);
    })();
  });
}

/* ---------------------------------------------------------
   1曲分の行
   --------------------------------------------------------- */

function songRow(song, artist) {
  const f = store.getFeatures()[song.key];
  const v = effectiveIntensity(f);
  const manual = Number.isFinite(f?.manualIntensity);

  return el('div.card', { style: { padding: '10px 12px' } }, [
    el('div.spread', [
      el('div.grow', { style: { minWidth: 0 } }, [
        el('div.row.tight', [
          el('span.ellipsis', { style: { fontWeight: 700, fontSize: '13.5px' }, title: song.name }, song.name),
          manual ? el('span.pill.manual', '手動') : null,
          f?.confidence === 'artist' ? el('span.pill.tape', '要確認') : null,
        ]),
        el('div.tiny.dim', { style: { marginTop: '2px' } }, [
          `${song.count}公演で披露`,
          f?.jaTitle && songKey(f.jaTitle) !== song.key ? ` ・ 照合: ${f.jaTitle}` : '',
          Number.isFinite(f?.bpm) && f.bpm ? ` ・ ${f.bpm} BPM` : '',
        ]),
      ]),
      el('div', { style: { flex: 'none', textAlign: 'right', minWidth: '52px' } }, [
        el('div', {
          style: { fontSize: '17px', fontWeight: 800, color: Number.isFinite(v) ? intensityColor(v) : 'var(--dim)' },
        }, Number.isFinite(v) ? String(Math.round(v)) : '—'),
        el('div.tiny.dim', '激しさ'),
      ]),
    ]),
    el('div.row.tight', { style: { marginTop: '8px' } }, [
      el('button.btn.sm.ghost', { onclick: () => openTuner(song, artist) }, '調整'),
      f?.previewUrl ? el('button.btn.sm.ghost', {
        onclick: (e) => playPreview(f.previewUrl, e.currentTarget),
      }, '▶ 試聴') : null,
    ]),
  ]);
}

/* ---------------------------------------------------------
   1曲の調整（手動補正 / 手動リンク）
   --------------------------------------------------------- */

function openTuner(song, artist) {
  modal(song.name, (body, close) => {
    const f = store.getFeatures()[song.key] || {};
    const current = effectiveIntensity(f);

    /* --- 激しさスライダー --- */
    const slider = el('input', {
      type: 'range', min: 0, max: 100, step: 1,
      value: Number.isFinite(current) ? Math.round(current) : 50,
      style: { width: '100%' },
    });
    const valLabel = el('b', { style: { fontSize: '22px' } }, String(slider.value));
    const updateLabel = () => {
      valLabel.textContent = slider.value;
      valLabel.style.color = intensityColor(Number(slider.value));
    };
    updateLabel();
    slider.addEventListener('input', updateLabel);

    /* --- 測定値 --- */
    const measured = Number.isFinite(f.energy) ? el('table.tbl', [
      el('tbody', [
        row('自動解析の激しさ', Number.isFinite(f.intensity) ? String(Math.round(f.intensity)) : '—'),
        row('テンポ', f.bpm ? `${f.bpm} BPM` : '—'),
        row('明るさ（スペクトル重心）', f.brightness ? `${Math.round(f.brightness)} Hz` : '—'),
        row('強弱の起伏', Number.isFinite(f.dynamics) ? f.dynamics.toFixed(2) : '—'),
        row('照合したトラック', f.jaTitle || '—'),
      ]),
    ]) : el('div.notice.warn', 'まだ自動解析されていません。下の「iTunes の曲を手動で指定」から音源を選ぶか、上のスライダーで直接設定してください。');

    function row(k, v) {
      return el('tr', [el('td', el('span.dim', k)), el('td.num', v)]);
    }

    /* --- 手動リンク --- */
    const linkBox = el('div');
    const buildLink = () => {
      const mapped = store.getSongMap()[song.key];
      clear(linkBox);
      linkBox.appendChild(el('details.fold', [
        el('summary', mapped ? `iTunes の曲: ${mapped.title}（変更する）` : 'iTunes の曲を手動で指定'),
        el('div.stack', [
          el('div.tiny.dim', { style: { lineHeight: '1.75' } },
            'setlist.fm の曲名はローマ字表記のため、日本語タイトルの曲は自動で見つからないことがあります。ここで一度対応づければ次回以降も使われます。'),
          searchUI(song, artist, () => { buildLink(); }),
          mapped ? el('button.btn.sm.ghost.danger', {
            onclick: () => { store.unlinkSong(song.key); buildLink(); toast('対応づけを解除しました'); },
          }, '対応づけを解除') : null,
        ]),
      ]));
    };
    buildLink();

    body.appendChild(el('div.stack', [
      el('div.card', [
        el('div.spread', { style: { marginBottom: '8px' } }, [
          el('span.small.muted', '激しさ（0=静か / 100=激しい）'),
          valLabel,
        ]),
        slider,
        el('div.row', { style: { marginTop: '10px', justifyContent: 'flex-end' } }, [
          Number.isFinite(f.manualIntensity) ? el('button.btn.sm.ghost', {
            onclick: () => {
              setManualIntensity(song.name, null);
              close(); render();
              toast('自動解析の値に戻しました');
            },
          }, '自動の値に戻す') : null,
          el('button.btn.sm.primary', {
            onclick: () => {
              setManualIntensity(song.name, Number(slider.value));
              close(); render();
              toast(`「${song.name}」の激しさを ${slider.value} に設定しました`);
            },
          }, 'この値で固定'),
        ]),
      ]),
      measured,
      linkBox,
      Number.isFinite(f.energy) ? el('button.btn.sm.ghost.block', {
        onclick: async () => {
          try {
            toast('解析中…');
            const mapped = store.getSongMap()[song.key];
            const url = mapped?.previewUrl || f.previewUrl;
            if (!url) throw new Error('試聴音源がありません');
            const raw = await analyzePreview(url);
            store.saveFeature(song.key, { ...raw, analyzedAt: Date.now() });
            recomputeIntensities(collectSongs(currentSetlists()).map((s) => s.key));
            close(); render();
            toast('解析し直しました');
          } catch (e) {
            toast(e.message, { error: true });
          }
        },
      }, 'この曲だけ解析し直す') : null,
    ]));
  });
}

/* ---------------------------------------------------------
   iTunes 検索（手動リンク用）
   --------------------------------------------------------- */

function searchUI(song, artist, onLinked) {
  const input = el('input', { type: 'search', value: `${artist.name} ${song.name}`, placeholder: '曲名で検索' });
  const results = el('div.stack', { style: { gap: '4px' } });
  const status = el('div.tiny.dim');

  let seq = 0;
  const search = async () => {
    const q = input.value.trim();
    clear(results);
    if (q.length < 2) return;

    const mine = ++seq;
    status.replaceChildren(el('span.spinner'), ' 検索中…');
    try {
      const hits = await api.searchTracks(q, { limit: 10 });
      if (mine !== seq) return;
      clear(status);
      if (!hits.length) { status.textContent = '見つかりませんでした。'; return; }

      for (const t of hits) {
        results.appendChild(el('button.songpick', {
          disabled: !t.previewUrl,
          title: t.previewUrl ? '' : '試聴音源が無いため解析できません',
          onclick: async () => {
            store.linkSong(song.key, t);
            try {
              status.replaceChildren(el('span.spinner'), ' 解析中…');
              const raw = await analyzePreview(t.previewUrl);
              store.saveFeature(song.key, {
                displayName: song.name, ...raw,
                itunesId: t.itunesId, jaTitle: t.title, artwork: t.artwork,
                previewUrl: t.previewUrl, confidence: 'manual', analyzedAt: Date.now(),
              });
              recomputeIntensities(collectSongs(currentSetlists()).map((s) => s.key));
              toast(`「${t.title}」で解析しました`);
            } catch (e) {
              toast(`対応づけは保存しましたが解析に失敗: ${e.message}`, { error: true });
            }
            onLinked?.();
            render();
          },
        }, [
          t.artwork ? el('img', { src: t.artwork, width: 32, height: 32, loading: 'lazy', style: { borderRadius: '4px', flex: 'none' } }) : null,
          el('span.grow', { style: { minWidth: 0 } }, [
            el('div.ellipsis', t.title),
            el('div.tiny.dim.ellipsis', `${t.artist} ・ ${t.album}`),
          ]),
          el('span.rate', t.previewUrl ? '選ぶ' : '試聴なし'),
        ]));
      }
    } catch (e) {
      if (mine !== seq) return;
      status.replaceChildren(el('span', { style: { color: 'var(--danger)' } }, e.message));
    }
  };

  input.addEventListener('input', debounce(search, 450));
  input.addEventListener('keydown', (e) => { if (e.key === 'Enter') { e.preventDefault(); search(); } });

  return el('div.stack', [field('iTunes を検索', input), status, results]);
}

/* ---------------------------------------------------------
   試聴
   --------------------------------------------------------- */

let currentAudio = null;

function playPreview(url, btn) {
  if (currentAudio) {
    currentAudio.pause();
    currentAudio = null;
    if (btn._playing) { btn.textContent = '▶ 試聴'; btn._playing = false; return; }
  }
  const audio = new Audio(url);
  audio.play().then(() => {
    currentAudio = audio;
    btn.textContent = '■ 停止';
    btn._playing = true;
    audio.addEventListener('ended', () => { btn.textContent = '▶ 試聴'; btn._playing = false; currentAudio = null; });
  }).catch(() => toast('再生できませんでした', { error: true }));
}
