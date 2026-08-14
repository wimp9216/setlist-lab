/* =========================================================
   Setlist Lab — マイセトリ作成
   分析結果を見ながら自分のセトリを組む。
   1曲目の実績・曲のつながり・起伏がその場で出る。
   ========================================================= */

import { el, clear, empty, toast, modal, field, pct, confirmDialog, intensityColor } from '../ui.js';
import { songKey } from '../normalize.js';
import {
  positionStats, songStats, transitionStats, successorsOf,
  predictSetlist, classifyArc, POSITIONS,
} from '../analyze.js';
import { makeIntensityResolver, collectSongs } from '../features.js';
import { arcChart } from '../charts.js';
import * as store from '../store.js';
import { state, render, go, currentArtist, scopedSetlists, scopeLabel, analysisOpts } from '../main.js';
import { scopeBar } from './scope-bar.js';

/* 編集中のセトリ（保存するまでは localStorage に書かない） */
let draft = null;

export function renderMySet() {
  const view = el('div.view');
  const artist = currentArtist();

  view.appendChild(el('div.view-head', [
    el('h1', 'マイセトリ'),
    el('p', '分析結果をもとに自分のセットリストを組みます。組みながら「1曲目の実績」「この繋がりの実績」「起伏」が右に出ます。'),
  ]));

  if (!artist) {
    view.appendChild(empty('🎤', 'アーティストが登録されていません。'));
    return view;
  }

  const setlists = scopedSetlists();
  if (!setlists.length) {
    view.appendChild(empty('✍️', '分析できる公演がありません。', '「公演」画面からセットリストを取り込んでください。'));
    return view;
  }

  // 別アーティストに切り替わったら下書きを捨てる
  if (draft && draft.artistMbid !== artist.mbid) draft = null;

  view.appendChild(scopeBar({ compact: true }));

  if (!draft) {
    view.appendChild(savedList(artist));
    return view;
  }

  view.appendChild(builder(artist, setlists));
  return view;
}

/* ---------------------------------------------------------
   保存済み一覧
   --------------------------------------------------------- */

function savedList(artist) {
  const mine = store.getMySets().filter((s) => s.artistMbid === artist.mbid);

  const newDraft = (sets, name) => {
    draft = {
      id: `myset-${Date.now().toString(36)}`,
      name: name || `${artist.name} 予想セトリ`,
      artistMbid: artist.mbid,
      artistName: artist.name,
      sets: sets || [{ encore: 0, songs: [] }, { encore: 1, songs: [] }],
    };
    render();
  };

  return el('div', [
    el('div.section', [
      el('div.row', [
        el('button.btn.primary', { onclick: () => newDraft() }, '＋ 新しく作る'),
        el('button.btn', {
          onclick: () => {
            const setlists = scopedSetlists();
            const pred = predictSetlist(setlists, analysisOpts({ mainLength: 13, encoreLength: 3 }));
            newDraft(
              pred.sets.map((s) => ({ encore: s.encore, songs: s.songs.map((x) => ({ name: x.name, reason: x.reason })) })),
              `${artist.name} 予想セトリ（自動生成）`
            );
            toast('分析結果から自動生成しました');
          },
        }, '⚡ 分析から自動生成'),
      ]),
      el('div.tiny.dim', { style: { marginTop: '8px', lineHeight: '1.7' } },
        `自動生成は「${scopeLabel()}」の傾向を使います。1曲目は実績最上位、以降は「次に来やすい曲」を既出を避けながら辿ります。`),
    ]),

    el('div.section', [
      el('h2', ['保存したマイセトリ', el('span.count', `${mine.length}件`)]),
      mine.length
        ? el('div.stack', mine.map((s) => {
            const n = s.sets.reduce((a, x) => a + x.songs.length, 0);
            return el('div.card', [
              el('div.spread', [
                el('div.grow', [
                  el('b', s.name),
                  el('div.tiny.dim', { style: { marginTop: '3px' } },
                    `${n}曲 ・ 更新 ${new Date(s.updatedAt).toLocaleDateString('ja-JP')}`),
                ]),
              ]),
              el('div.row.tight', { style: { marginTop: '9px' } }, [
                el('button.btn.sm.ghost', {
                  onclick: () => { draft = JSON.parse(JSON.stringify(s)); render(); },
                }, '編集'),
                el('button.btn.sm.ghost', { onclick: () => exportText(s) }, 'テキスト'),
                el('button.btn.sm.ghost.danger', {
                  style: { marginLeft: 'auto' },
                  onclick: async () => {
                    const ok = await confirmDialog('マイセトリを削除', `「${s.name}」を削除します。`, { okLabel: '削除する', danger: true });
                    if (!ok) return;
                    store.deleteMySet(s.id);
                    render();
                    toast('削除しました');
                  },
                }, '削除'),
              ]),
            ]);
          }))
        : empty('✍️', 'まだマイセトリがありません。', '「新しく作る」か「分析から自動生成」で始めてください。'),
    ]),
  ]);
}

/* ---------------------------------------------------------
   ビルダー
   --------------------------------------------------------- */

function builder(artist, setlists) {
  const opts = analysisOpts();
  const pstats = positionStats(setlists, opts);
  const tstats = transitionStats(setlists, opts);
  const sstats = songStats(setlists, opts);
  const resolve = makeIntensityResolver();

  const wrap = el('div');
  const left = el('div');
  const right = el('div');

  const usedKeys = () => new Set(draft.sets.flatMap((s) => s.songs.map((x) => songKey(x.name))));

  const redraw = () => { drawLeft(); drawRight(); };

  /* --- 左: セトリ本体 --- */
  function drawLeft() {
    clear(left);

    const nameInput = el('input', { type: 'text', value: draft.name, placeholder: 'マイセトリ名' });
    nameInput.addEventListener('input', () => { draft.name = nameInput.value; });

    left.appendChild(el('div.section', [
      field('名前', nameInput),
    ]));

    draft.sets.forEach((set, si) => {
      const list = el('div.stack', { style: { gap: '5px' } });

      set.songs.forEach((song, i) => {
        const prev = i > 0 ? set.songs[i - 1] : null;
        const link = prev ? linkInfo(tstats, prev.name, song.name) : null;

        const slot = el('div.slot', { draggable: true }, [
          el('span.grip', { title: 'ドラッグで並べ替え' }, '⠿'),
          el('span.num', String(i + 1)),
          el('span.title', [
            song.name,
            link ? el('span.why', link.count
              ? `直前の「${prev.name}」からの実績 ${link.count}/${link.total}回 (${pct(link.rate)})`
              : `「${prev.name}」→「${song.name}」の実績はありません`) : null,
          ]),
          el('span', { style: { flex: 'none', display: 'flex', gap: '2px' } }, [
            el('button.x', { title: '上へ', onclick: () => { move(si, i, -1); } }, '▲'),
            el('button.x', { title: '下へ', onclick: () => { move(si, i, +1); } }, '▼'),
            el('button.x', { title: '削除', onclick: () => { set.songs.splice(i, 1); redraw(); } }, '✕'),
          ]),
        ]);

        // デスクトップ向けのドラッグ＆ドロップ（スマホは▲▼で操作する）
        slot.addEventListener('dragstart', (e) => {
          e.dataTransfer.setData('text/plain', JSON.stringify({ si, i }));
          e.dataTransfer.effectAllowed = 'move';
          slot.classList.add('drag');
        });
        slot.addEventListener('dragend', () => slot.classList.remove('drag'));
        slot.addEventListener('dragover', (e) => { e.preventDefault(); slot.classList.add('over'); });
        slot.addEventListener('dragleave', () => slot.classList.remove('over'));
        slot.addEventListener('drop', (e) => {
          e.preventDefault();
          slot.classList.remove('over');
          try {
            const from = JSON.parse(e.dataTransfer.getData('text/plain'));
            const [moved] = draft.sets[from.si].songs.splice(from.i, 1);
            if (moved) { draft.sets[si].songs.splice(i, 0, moved); redraw(); }
          } catch { /* 想定外のドロップは無視 */ }
        });

        list.appendChild(slot);
      });

      if (!set.songs.length) {
        list.appendChild(el('div.empty', { style: { padding: '18px' } }, '曲がありません'));
      }

      left.appendChild(el('div.section', [
        el('h2', [
          set.encore > 0 ? `アンコール${set.encore > 1 ? set.encore : ''}` : '本編',
          el('span.count', `${set.songs.length}曲`),
          set.encore > 0 && draft.sets.length > 1 ? el('button.btn.sm.ghost', {
            style: { marginLeft: 'auto' },
            onclick: () => { draft.sets.splice(si, 1); redraw(); },
          }, 'このセクションを削除') : null,
        ]),
        list,
        el('button.btn.sm.ghost.block', {
          style: { marginTop: '6px' },
          onclick: () => openSongPicker(si),
        }, '＋ 曲を追加'),
      ]));
    });

    left.appendChild(el('div.row', [
      el('button.btn.sm.ghost', {
        onclick: () => {
          const next = draft.sets.filter((s) => s.encore > 0).length + 1;
          draft.sets.push({ encore: next, songs: [] });
          redraw();
        },
      }, '＋ アンコールを追加'),
    ]));

    left.appendChild(el('div.row', { style: { marginTop: '16px' } }, [
      el('button.btn.primary', {
        onclick: () => {
          const n = draft.sets.reduce((a, s) => a + s.songs.length, 0);
          if (!n) { toast('曲を1曲以上入れてください', { error: true }); return; }
          store.saveMySet({ ...draft, sets: draft.sets.filter((s) => s.songs.length) });
          draft = null;
          render();
          toast('保存しました');
        },
      }, '保存'),
      el('button.btn.ghost', { onclick: () => exportText(draft) }, 'テキスト'),
      el('button.btn.ghost', {
        style: { marginLeft: 'auto' },
        onclick: async () => {
          const ok = await confirmDialog('編集を終了', '保存していない変更は失われます。', { okLabel: '破棄して戻る', danger: true });
          if (!ok) return;
          draft = null;
          render();
        },
      }, '戻る'),
    ]));
  }

  function move(si, i, dir) {
    const songs = draft.sets[si].songs;
    const j = i + dir;
    if (j < 0 || j >= songs.length) return;
    [songs[i], songs[j]] = [songs[j], songs[i]];
    redraw();
  }

  /* --- 右: 実績と起伏 --- */
  function drawRight() {
    clear(right);

    const flat = draft.sets.flatMap((s) => s.songs.map((x) => ({ ...x, encore: s.encore })));
    const points = flat.map((s, i) => ({
      name: s.name, key: songKey(s.name),
      intensity: resolve(s.name, songKey(s.name)),
      encore: s.encore, position: i,
    }));
    const known = points.filter((p) => Number.isFinite(p.intensity));
    const cls = known.length >= 6 ? classifyArc(points, known.length / points.length) : null;

    /* 起伏 */
    right.appendChild(el('div.section', [
      el('h2', 'このセトリの起伏'),
      cls
        ? el('div.chart-wrap', [
            arcChart(points, { zones: cls.zones, height: 180 }),
            el('div.small', { style: { marginTop: '9px' } }, [
              el('b', { style: { color: 'var(--accent)' } }, cls.label),
            ]),
            el('div.tiny.muted', { style: { marginTop: '4px', lineHeight: '1.75' } }, cls.description),
          ])
        : el('div.notice', points.length < 6
            ? '6曲以上入れると起伏を判定します。'
            : '曲の特徴量が足りません。「楽曲」画面で解析してください。'),
    ]));

    /* 位置の実績 */
    const positionsNow = currentPositions();
    right.appendChild(el('div.section', [
      el('h2', '位置ごとの実績'),
      el('div.card', [
        el('table.tbl', [
          el('tbody', POSITIONS.map((p) => {
            const chosen = positionsNow[p.id];
            const bucket = pstats.positions[p.id];
            if (!chosen) {
              return el('tr', [el('td', el('span.dim', p.label)), el('td.num', el('span.dim', '未設定'))]);
            }
            const hit = bucket.ranking.find((r) => r.key === songKey(chosen));
            const top = bucket.ranking[0];
            return el('tr', [
              el('td', [
                el('div.tiny.dim', p.label),
                el('div.small.ellipsis', { title: chosen }, chosen),
              ]),
              el('td.num', [
                hit
                  ? el('div', { style: { color: hit === top ? 'var(--ok)' : 'var(--text)' } },
                      `${hit.count}/${hit.total}`)
                  : el('div', { style: { color: 'var(--warn)' } }, '実績なし'),
                el('div.tiny.dim', hit ? pct(hit.rate) : `最有力: ${top ? top.name : '—'}`),
              ]),
            ]);
          })),
        ]),
      ]),
    ]));

    /* 次の曲の候補 */
    const lastSet = draft.sets[draft.sets.length - 1];
    const last = lastSet?.songs[lastSet.songs.length - 1];
    if (last) {
      const succ = successorsOf(tstats, songKey(last.name)).filter((s) => !usedKeys().has(s.key));
      right.appendChild(el('div.section', [
        el('h2', `「${last.name}」の次の候補`),
        succ.length
          ? el('div.card', [
              el('div.stack', { style: { gap: '2px' } }, succ.slice(0, 6).map((s) =>
                el('button.songpick', {
                  onclick: () => { lastSet.songs.push({ name: s.name }); redraw(); },
                }, [
                  el('span.grow.ellipsis', s.name),
                  el('span.rate', `${s.count}/${s.total} (${pct(s.rate)})`),
                ])
              )),
            ])
          : el('div.notice', 'この曲の次に来た実績のある曲はありません。'),
      ]));
    }
  }

  function currentPositions() {
    const main = draft.sets.filter((s) => s.encore === 0).flatMap((s) => s.songs);
    const encs = draft.sets.filter((s) => s.encore > 0);
    const firstSet = draft.sets.find((s) => s.songs.length);
    const lastEnc = [...encs].reverse().find((s) => s.songs.length);
    const firstEnc = encs.find((s) => s.songs.length);
    return {
      opener: firstSet?.songs[0]?.name || null,
      mainCloser: main.length ? main[main.length - 1].name : null,
      encoreOpener: firstEnc?.songs[0]?.name || null,
      encoreCloser: lastEnc ? lastEnc.songs[lastEnc.songs.length - 1].name : null,
    };
  }

  /* --- 曲を選ぶ --- */
  function openSongPicker(si) {
    modal('曲を追加', (body, close) => {
      const used = usedKeys();
      const q = el('input', { type: 'search', placeholder: '曲名で絞り込む' });
      const list = el('div.stack', { style: { gap: '2px', maxHeight: '52vh', overflow: 'auto' } });

      const draw = () => {
        clear(list);
        const term = songKey(q.value);
        const rows = sstats.filter((s) => !term || songKey(s.name).includes(term));
        if (!rows.length) { list.appendChild(el('div.empty', '該当する曲がありません')); return; }

        for (const s of rows) {
          const isUsed = used.has(s.key);
          const v = resolve(s.name, s.key);
          list.appendChild(el('button.songpick', {
            disabled: isUsed,
            title: isUsed ? 'すでにこのセトリに入っています' : '',
            onclick: () => {
              draft.sets[si].songs.push({ name: s.name });
              used.add(s.key);
              draw();
              redraw();
            },
          }, [
            el('span', {
              style: {
                flex: 'none', width: '7px', height: '7px', borderRadius: '50%',
                background: Number.isFinite(v) ? intensityColor(v) : 'var(--dim)',
              },
            }),
            el('span.grow.ellipsis', s.name),
            el('span.rate', `${s.count}/${s.total}`),
          ]));
        }
      };

      q.addEventListener('input', draw);
      draw();

      body.appendChild(el('div.stack', [
        field('曲を探す', q),
        el('div.tiny.dim', '右の数字は「対象公演のうち何公演で披露されたか」です。'),
        list,
        el('div.row', { style: { justifyContent: 'flex-end' } }, [
          el('button.btn.sm.primary', { onclick: close }, '閉じる'),
        ]),
      ]));
    });
  }

  redraw();
  wrap.appendChild(el('div.builder', [left, right]));
  return wrap;
}

/* ---------------------------------------------------------
   つながりの実績
   --------------------------------------------------------- */

function linkInfo(tstats, fromName, toName) {
  const fromKey = songKey(fromName);
  const toKey = songKey(toName);
  const list = successorsOf(tstats, fromKey);
  const hit = list.find((s) => s.key === toKey);
  if (hit) return hit;
  return { count: 0, total: list[0]?.total || 0, rate: 0 };
}

/* ---------------------------------------------------------
   テキスト書き出し
   --------------------------------------------------------- */

function exportText(myset) {
  const lines = [myset.name, ''];
  for (const set of myset.sets) {
    if (!set.songs.length) continue;
    lines.push(set.encore > 0 ? `【アンコール${set.encore > 1 ? set.encore : ''}】` : '【本編】');
    set.songs.forEach((s, i) => lines.push(`${i + 1}. ${s.name}`));
    lines.push('');
  }
  const text = lines.join('\n').trim();

  navigator.clipboard?.writeText(text).then(
    () => toast('クリップボードにコピーしました'),
    () => showText(text)
  ) ?? showText(text);

  function showText(t) {
    modal('マイセトリ', (body) => {
      const ta = el('textarea', { style: { minHeight: '280px' }, readonly: true }, t);
      body.appendChild(el('div.stack', [
        el('div.small.muted', '長押しまたは Ctrl+A → Ctrl+C でコピーしてください。'),
        ta,
      ]));
      ta.select();
    });
  }
}
