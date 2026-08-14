/* =========================================================
   Setlist Lab — 公演画面
   アーティストの登録 / セトリ取得 / ツアー別の公演一覧
   ========================================================= */

import { el, clear, toast, modal, field, empty, debounce, confirmDialog } from '../ui.js';
import { formatDate, flattenSongs } from '../normalize.js';
import * as store from '../store.js';
import * as api from '../api.js';
import { state, render, go, currentArtist, currentSetlists, tourList } from '../main.js';
import { showRow, openSetlistModal } from './setlist-view.js';
import { openManualEditor } from './manual-editor.js';
import { resolveTitles, pendingSongs } from '../titles.js';
import { collectSongs } from '../features.js';

export function renderShows() {
  const view = el('div.view');
  const artist = currentArtist();

  view.appendChild(el('div.view-head', [
    el('h1', '公演'),
    el('p', 'アーティストを登録してセットリストを取り込み、ツアーごとに公演を一覧します。'),
  ]));

  /* --- アーティスト --- */
  view.appendChild(artistBar(artist));

  if (!artist) {
    view.appendChild(empty('🎤', 'アーティストが登録されていません。', '上の「アーティストを追加」から始めてください。'));
    return view;
  }

  const all = currentSetlists();
  if (!all.length) {
    view.appendChild(el('div.section', [
      empty('🎫', 'このアーティストの公演がまだありません。',
        'setlist.fm から取り込むか、手動で追加してください。'),
    ]));
    return view;
  }

  /* --- 公演一覧（ツアー別） --- */
  const tours = tourList();
  const attendedCount = all.filter((s) => store.isAttended(s.id)).length;

  view.appendChild(el('div.section', [
    el('h2', [
      '公演一覧',
      el('span.count', `${all.length}公演 / ${tours.length}ツアー`),
      attendedCount ? el('span.pill.attended', `参加 ${attendedCount}`) : null,
    ]),
    el('div', tours.map((t) => {
      const shows = all.filter((s) => (s.tour || '') === t.tour);
      return el('div.tourgroup', [
        el('h3', [
          t.tour || el('span.muted', 'ツアー名なし（単発・フェス等）'),
          el('span.n', `${t.count}公演`),
          el('button.btn.sm.ghost', {
            style: { marginLeft: 'auto' },
            onclick: () => go('analyze', { tour: t.tour }),
          }, 'このツアーを分析'),
        ]),
        el('div.stack', shows.map((s) =>
          showRow(s, { onclick: () => openSetlistModal(s, { onChange: render }) })
        )),
      ]);
    })),
  ]));

  return view;
}

/* ---------------------------------------------------------
   アーティスト操作バー
   --------------------------------------------------------- */

function artistBar(artist) {
  const cache = artist ? store.getSetlistCache(artist.mbid) : null;
  const box = el('div.card', { style: { marginBottom: '18px' } });

  box.appendChild(el('div.spread', [
    el('div.grow', [
      el('div.row.tight', [
        el('b', { style: { fontSize: '15px' } }, artist ? artist.name : 'アーティスト未選択'),
        artist?.isSample ? el('span.pill.sample', 'サンプル') : null,
      ]),
      el('div.tiny.dim', { style: { marginTop: '3px' } }, (() => {
        if (!artist) return '';
        if (!cache) return 'setlist.fm から未取得';
        const days = Math.floor(store.cacheAgeDays(artist.mbid) ?? 0);
        const max = store.getSettings().cacheMaxDays;
        const left = max - days;
        return `最終取得: ${new Date(cache.fetchedAt).toLocaleDateString('ja-JP')}`
          + (artist.isSample || !max ? '' : `（あと${Math.max(0, left)}日で破棄）`);
      })()),
    ]),
    el('button.btn.sm.primary', { onclick: openArtistSearch }, '＋ アーティスト'),
  ]));

  if (artist) {
    box.appendChild(el('div.row', { style: { marginTop: '11px' } }, [
      el('button.btn.sm', {
        onclick: () => fetchSetlists(artist),
        disabled: !!artist.isSample,
        title: artist.isSample ? 'サンプルアーティストは取得対象外です' : '',
      }, cache ? 'セトリを再取得' : 'setlist.fm から取得'),
      el('button.btn.sm.ghost', {
        onclick: () => openManualEditor(null, { artist, onSaved: render }),
      }, '＋ 手動でセトリ追加'),
      el('button.btn.sm.ghost.danger', {
        style: { marginLeft: 'auto' },
        onclick: async () => {
          const ok = await confirmDialog('アーティストを削除',
            `${artist.name} と、取り込んだセットリストを削除します。手動入力・参加記録は残ります。`,
            { okLabel: '削除する', danger: true });
          if (!ok) return;
          store.removeArtist(artist.mbid);
          const rest = store.getArtists();
          state.artistMbid = rest.length ? rest[0].mbid : null;
          state.tour = '__all__';
          render();
          toast('削除しました');
        },
      }, '削除'),
    ]));

    if (!api.hasProxy() && !artist.isSample) {
      box.appendChild(el('div.notice.warn', { style: { marginTop: '11px' } }, [
        el('b', '取得サーバーが未設定です。'),
        ' setlist.fm はブラウザから直接呼べないため、Cloudflare Worker の中継が必要です。',
        el('button.btn.sm', { style: { marginTop: '8px' }, onclick: () => go('settings') }, '設定を開く'),
      ]));
    }
  }

  return box;
}

/* ---------------------------------------------------------
   アーティスト検索
   --------------------------------------------------------- */

function openArtistSearch() {
  modal('アーティストを追加', (body, close) => {
    const input = el('input', { type: 'search', placeholder: 'アーティスト名（例: Official HIGE DANdism）', autofocus: true });
    const results = el('div.stack', { style: { marginTop: '12px' } });
    const status = el('div.small.muted', { style: { marginTop: '10px' } });

    let seq = 0;
    const search = async () => {
      const q = input.value.trim();
      clear(results);
      if (q.length < 2) { status.textContent = ''; return; }

      const mine = ++seq;
      status.replaceChildren(el('span.spinner'), ' 検索中…');

      try {
        // setlist.fm 側の検索が使えるならそちらを優先（セトリの有無と直結するため）。
        // 未設定なら MusicBrainz で MBID だけ解決しておく。
        const hits = api.hasProxy()
          ? await api.searchArtistsSetlistFm(q)
          : await api.searchArtistsMusicBrainz(q);
        if (mine !== seq) return;

        clear(status);
        if (!hits.length) {
          status.textContent = '該当するアーティストが見つかりませんでした。';
          return;
        }
        if (!api.hasProxy()) {
          status.replaceChildren(el('span.dim',
            '※ 取得サーバー未設定のため MusicBrainz で検索しています。セトリの取得には設定が必要です。'));
        }

        for (const a of hits) {
          results.appendChild(el('button.show', {
            onclick: () => {
              store.addArtist({ mbid: a.mbid, name: a.name, sortName: a.sortName || '', itunesArtistId: null });
              state.artistMbid = a.mbid;
              state.tour = '__all__';
              state.compareIds = [];
              close();
              render();
              toast(`${a.name} を追加しました`);
            },
          }, [
            el('span.meta', [
              el('b', a.name),
              el('span', [a.disambiguation || a.sortName || '', a.country ? ` ・${a.country}` : ''].join('')),
            ]),
            el('span.n', '追加'),
          ]));
        }
      } catch (e) {
        if (mine !== seq) return;
        status.replaceChildren(el('span', { style: { color: 'var(--danger)' } }, e.message));
      }
    };

    input.addEventListener('input', debounce(search, 450));
    input.addEventListener('keydown', (e) => { if (e.key === 'Enter') search(); });

    body.appendChild(el('div.stack', [
      field('アーティスト名', input),
      status,
      results,
    ]));
    setTimeout(() => input.focus(), 50);
  });
}

/* ---------------------------------------------------------
   セトリ取得
   --------------------------------------------------------- */

/**
 * セトリの取得と、曲名の正式名称化を続けて行う。
 *
 * setlist.fm の曲名はローマ字表記なので、取り込んだだけでは読めない。
 * 別操作にせず、取得の流れの中で最後まで直しきる。
 *
 * 曲名の照合には iTunes を使うが、1IPあたり約20回/分の制限があるため
 * カタログに無い曲は1曲3秒ほどかかる。そのぶん時間がかかるので、
 * 残り時間を出して、途中で止めても続きからやり直せるようにしている。
 */
function fetchSetlists(artist) {
  modal('セットリストを取得', (body, close) => {
    const bar = el('i', { style: { width: '0%' } });
    const stepLabel = el('div.small', { style: { fontWeight: 700 } }, '① セットリストを取得');
    const status = el('div.small.muted');
    const detail = el('div.tiny.dim');
    const controller = new AbortController();
    let finished = false;

    const closeBtn = el('button.btn.sm.ghost', {
      onclick: () => { if (!finished) controller.abort(); close(); render(); },
    }, '中止');

    body.appendChild(el('div.stack', [
      el('div.small', `${artist.name} の公演を setlist.fm から取り込み、曲名を正式名称に直します。`),
      stepLabel,
      el('div.progress', [bar]),
      status,
      detail,
      el('div.row', { style: { justifyContent: 'flex-end' } }, [closeBtn]),
    ]));

    (async () => {
      /* --- ① セトリ取得 --- */
      const { items, total, truncated } = await api.fetchAllSetlists(artist.mbid, {
        signal: controller.signal,
        onProgress: ({ page, pages, fetched, total: t }) => {
          bar.style.width = `${Math.round((page / pages) * 40)}%`;   // 全体の4割を取得に割り当てる
          status.textContent = `${page} / ${pages} ページ — ${fetched}件取得（全${t}件）`;
        },
      });
      store.saveSetlistCache(artist.mbid, items, total);

      /* --- ② 曲名の正式名称化 --- */
      const songs = collectSongs(items);
      const targets = pendingSongs(songs);

      let renamed = 0;
      let leftover = 0;

      if (targets.length) {
        stepLabel.textContent = '② 曲名を正式名称に直す';
        detail.textContent = `${targets.length}曲を iTunes と照合します。`;

        let searchStarted = Date.now();
        try {
          const res = await resolveTitles(artist, targets, {
            signal: controller.signal,
            onProgress: (p) => {
              const { phase, done, total: t, current, catalogSize } = p;
              if (phase === 'artist') {
                status.replaceChildren(el('span.spinner'), ' アーティストを特定中…');
              } else if (phase === 'catalog') {
                status.replaceChildren(el('span.spinner'), ' 楽曲カタログを取得中…');
              } else if (phase === 'catalog-done') {
                searchStarted = Date.now();   // 個別検索はここから始まる
                bar.style.width = `${40 + Math.round((done / t) * 60)}%`;
                status.textContent = `カタログ${catalogSize}曲と照合 — ${done}曲が確定`;
                detail.textContent = t - done > 0
                  ? `残り${t - done}曲は個別に検索します（約${estimate(t - done)}）`
                  : '';
              } else if (phase === 'search') {
                bar.style.width = `${40 + Math.round((done / t) * 60)}%`;
                status.textContent = `${done} / ${t} — ${current}`;
                // 見積もりは実際に検索した数で割る。done にはカタログで
                // 即決まった曲が入っており、それを含めると短く出てしまう。
                const remain = p.searchTotal - p.searched;
                const perSong = p.searched > 0 ? (Date.now() - searchStarted) / p.searched : 3300;
                detail.textContent = remain > 0 ? `残り約${estimate(remain, perSong)}` : '';
              }
            },
          });
          renamed = res.resolved.length;
          leftover = res.unresolved.length;
        } catch (e) {
          if (e.name !== 'AbortError') throw e;
          // 中断でも、そこまでに直した分は保存済みなので破棄しない
          finished = true;
          close();
          render();
          toast(`${items.length}件を取得しました（曲名の照合は中断）`);
          return;
        }
      }

      finished = true;
      bar.style.width = '100%';
      close();
      render();

      const msg = [
        truncated ? `${items.length}件を取得（全${total}件のうち上限まで）` : `${items.length}件を取得`,
        renamed ? `${renamed}曲の曲名を確定` : null,
        leftover ? `${leftover}曲は楽曲画面で手入力してください` : null,
      ].filter(Boolean).join('・');
      toast(msg, { ms: leftover ? 5000 : 3000 });
    })().catch((e) => {
      finished = true;
      if (e.name === 'AbortError') return;
      status.replaceChildren(el('span', { style: { color: 'var(--danger)' } }, e.message));
      bar.style.background = 'var(--danger)';
      closeBtn.textContent = '閉じる';
    });
  });
}

/** 残り曲数から待ち時間の目安を作る */
function estimate(songs, perSongMs = 3300) {
  const sec = Math.round((songs * perSongMs) / 1000);
  if (sec < 60) return `${sec}秒`;
  return `${Math.round(sec / 60)}分`;
}

export { formatDate, flattenSongs };
