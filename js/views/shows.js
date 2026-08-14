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
import { resolveTitles } from '../titles.js';
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

function fetchSetlists(artist) {
  modal('セットリストを取得', (body, close) => {
    const bar = el('i', { style: { width: '0%' } });
    const status = el('div.small.muted');
    const controller = new AbortController();
    let done = false;

    body.appendChild(el('div.stack', [
      el('div.small', `${artist.name} の公演を setlist.fm から取り込みます。`),
      el('div.progress', [bar]),
      status,
      el('div.row', { style: { justifyContent: 'flex-end' } }, [
        el('button.btn.sm.ghost', {
          onclick: () => { if (!done) controller.abort(); close(); },
        }, '中止'),
      ]),
    ]));

    api.fetchAllSetlists(artist.mbid, {
      signal: controller.signal,
      onProgress: ({ page, pages, fetched, total }) => {
        bar.style.width = `${Math.round((page / pages) * 100)}%`;
        status.textContent = `${page} / ${pages} ページ — ${fetched}件取得（全${total}件）`;
      },
    }).then(async ({ items, total, truncated }) => {
      done = true;
      store.saveSetlistCache(artist.mbid, items, total);

      /* --- 曲名を正式名称に直す（カタログ照合まで） ---
         setlist.fm の曲名はローマ字表記なので、取り込み直後に
         iTunes のカタログと突き合わせて読める名前にしておく。
         カタログ取得はリクエスト2回で済むのでここで自動実行する。
         残り（個別検索が要る曲）は楽曲画面から明示的に実行してもらう。 */
      let renamed = 0;
      try {
        status.replaceChildren(el('span.spinner'), ' 曲名を照合中…');
        const songs = collectSongs(items);
        const res = await resolveTitles(artist, songs, { signal: controller.signal, deep: false });
        renamed = res.resolved.length;
      } catch (e) {
        if (e.name !== 'AbortError') console.warn('[titles]', e);
      }

      close();
      render();
      toast(truncated
        ? `${items.length}件を取得しました（全${total}件のうち上限まで）`
        : `${items.length}件を取得・${renamed}曲の曲名を照合しました`);
    }).catch((e) => {
      done = true;
      if (e.name === 'AbortError') return;
      status.replaceChildren(el('span', { style: { color: 'var(--danger)' } }, e.message));
      bar.style.background = 'var(--danger)';
    });
  });
}

export { formatDate, flattenSongs };
