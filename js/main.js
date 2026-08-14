/* =========================================================
   Setlist Lab — 起動・画面遷移・共有ステート
   ========================================================= */

import { el, clear, toast, setlistFmCredit } from './ui.js';
import * as store from './store.js';
import { SAMPLE_ARTIST, SAMPLE_MBID, buildSampleSetlists, buildSampleFeatures } from './sample-data.js';

import { renderShows }    from './views/shows.js';
import { renderCompare }  from './views/compare.js';
import { renderAnalyze }  from './views/analyze-view.js';
import { renderMySet }    from './views/myset.js';
import { renderAttend }   from './views/attend.js';
import { renderSongs }    from './views/songs.js';
import { renderSettings } from './views/settings.js';

/* ---------------------------------------------------------
   画面
   --------------------------------------------------------- */

const VIEWS = [
  { id: 'shows',    label: '公演',       ico: '🎫', render: renderShows,    tab: true },
  { id: 'compare',  label: '比較',       ico: '🔀', render: renderCompare,  tab: true },
  { id: 'analyze',  label: '分析',       ico: '📊', render: renderAnalyze,  tab: true },
  { id: 'myset',    label: 'マイセトリ', ico: '✍️', render: renderMySet,    tab: true },
  { id: 'attend',   label: '記録',       ico: '📝', render: renderAttend,   tab: true },
  { id: 'songs',    label: '楽曲',       ico: '🎵', render: renderSongs },
  { id: 'settings', label: '設定',       ico: '⚙️', render: renderSettings },
];

/* ---------------------------------------------------------
   共有ステート
   --------------------------------------------------------- */

export const state = {
  view: 'shows',
  artistMbid: null,   // 選択中アーティスト
  tour: '__all__',    // 分析スコープ: ツアー名 / '__all__' / '__attended__'
  compareIds: [],     // 比較に選んだ公演ID
  editingMySetId: null,
};

/** 選択中アーティストのオブジェクト */
export function currentArtist() {
  if (!state.artistMbid) return null;
  return store.getArtists().find((a) => a.mbid === state.artistMbid) || null;
}

/** 選択中アーティストのセトリ全件（API取得＋手動入力） */
export function currentSetlists() {
  if (!state.artistMbid) return [];
  return store.getAllSetlists(state.artistMbid);
}

/**
 * 分析スコープを適用したセトリ。
 * ツアー指定 / 全期間 / 参加した公演のみ、を1箇所で解決する。
 */
export function scopedSetlists() {
  const all = currentSetlists();
  if (state.tour === '__all__') return all;
  if (state.tour === '__attended__') return all.filter((s) => store.isAttended(s.id));
  return all.filter((s) => (s.tour || '') === state.tour);
}

/** スコープの表示名 */
export function scopeLabel() {
  if (state.tour === '__all__') return '全期間';
  if (state.tour === '__attended__') return '参加した公演のみ';
  return state.tour || 'ツアー名なし';
}

/** 選択中アーティストのツアー一覧（新しい順・公演数つき） */
export function tourList() {
  const map = new Map();
  for (const s of currentSetlists()) {
    const key = s.tour || '';
    const e = map.get(key);
    if (e) { e.count += 1; if (s.date > e.latest) e.latest = s.date; }
    else map.set(key, { tour: key, count: 1, latest: s.date });
  }
  return [...map.values()].sort((a, b) => (a.latest < b.latest ? 1 : -1));
}

/* ---------------------------------------------------------
   遷移・描画
   --------------------------------------------------------- */

// setlist.fm から取り込んだデータを表示する画面
const SETLISTFM_VIEWS = new Set(['shows', 'compare', 'analyze', 'myset', 'attend']);

/** 表示中のアーティストに setlist.fm 由来の公演があるか */
function hasSetlistFmData() {
  return currentSetlists().some((s) => s.source === 'setlistfm');
}

let mainEl, navEl, tabbarEl;

export function go(viewId, patch = {}) {
  Object.assign(state, patch);
  state.view = viewId;
  render();
  mainEl.scrollTop = 0;
  try {
    history.replaceState(null, '', `#${viewId}`);
  } catch { /* file:// では失敗しうるが致命ではない */ }
}

export function render() {
  const view = VIEWS.find((v) => v.id === state.view) || VIEWS[0];

  clear(mainEl);
  try {
    const node = view.render();
    // setlist.fm 由来のデータを出す画面には帰属表示を添える（利用規約で必須）
    if (SETLISTFM_VIEWS.has(view.id) && hasSetlistFmData()) {
      node.appendChild(setlistFmCredit());
    }
    mainEl.appendChild(node);
  } catch (e) {
    console.error('[render]', e);
    mainEl.appendChild(el('div.view', [
      el('div.notice.danger', [
        el('b', '画面の描画に失敗しました。'),
        el('div.small', { style: { marginTop: '6px' } }, String(e && e.message ? e.message : e)),
      ]),
    ]));
  }

  renderNav();
}

function renderNav() {
  clear(navEl);
  for (const v of VIEWS) {
    navEl.appendChild(el(`button${state.view === v.id ? '.on' : ''}`, {
      onclick: () => go(v.id),
    }, [el('span.ico', v.ico), v.label]));
  }

  clear(tabbarEl);
  const tabs = VIEWS.filter((v) => v.tab);
  for (const v of tabs) {
    tabbarEl.appendChild(el(`button${state.view === v.id ? '.on' : ''}`, {
      onclick: () => go(v.id),
    }, [el('span.ico', v.ico), v.label]));
  }
  // 「その他」から楽曲・設定へ
  const isOther = !tabs.some((v) => v.id === state.view);
  tabbarEl.appendChild(el(`button${isOther ? '.on' : ''}`, {
    onclick: () => go(state.view === 'songs' ? 'settings' : 'songs'),
  }, [el('span.ico', '⋯'), 'その他']));

  renderSidebarArtist();
}

function renderSidebarArtist() {
  const box = document.getElementById('sidebar-artist');
  if (!box) return;
  clear(box);

  const artists = store.getArtists();
  if (!artists.length) return;

  box.appendChild(el('div.tiny.dim', { style: { marginBottom: '6px', paddingLeft: '4px' } }, 'アーティスト'));
  const sel = el('select', {
    onchange: (e) => { state.artistMbid = e.target.value; state.tour = '__all__'; state.compareIds = []; render(); },
  }, artists.map((a) => el('option', { value: a.mbid, selected: a.mbid === state.artistMbid }, a.name)));
  box.appendChild(sel);
}

/* ---------------------------------------------------------
   初期化
   --------------------------------------------------------- */

/** 初回起動時だけサンプルデータを入れる（分析画面が空だと何も分からないため） */
function seedSampleIfEmpty() {
  if (store.getArtists().length) return;

  store.addArtist(SAMPLE_ARTIST);
  store.saveSetlistCache(SAMPLE_MBID, buildSampleSetlists());
  store.saveFeatures(buildSampleFeatures());
}

function boot() {
  mainEl = document.getElementById('main');
  navEl = document.getElementById('nav');
  tabbarEl = document.getElementById('tabbar');

  seedSampleIfEmpty();

  // 利用規約上、取得データは短期キャッシュに限られるので期限切れは捨てる。
  // 手動入力・参加記録・マイセトリは自分のデータなので残る。
  const purged = store.purgeExpiredSetlists();

  const artists = store.getArtists();
  state.artistMbid = artists.length ? artists[0].mbid : null;

  const hash = (location.hash || '').replace('#', '');
  if (VIEWS.some((v) => v.id === hash)) state.view = hash;

  render();

  if (purged.length) {
    toast(`取得から${store.getSettings().cacheMaxDays}日を過ぎたセットリストを破棄しました。再取得してください。`, { ms: 5000 });
  }

  // Service Worker はデプロイ後（https）でのみ登録する
  if ('serviceWorker' in navigator && location.protocol === 'https:') {
    navigator.serviceWorker.register('sw.js').catch(() => { /* 未配置なら無視 */ });
  }
}

window.addEventListener('error', (e) => {
  console.error(e.error || e.message);
});
window.addEventListener('unhandledrejection', (e) => {
  console.error('[unhandled]', e.reason);
  const msg = e.reason?.message;
  if (msg) toast(msg, { error: true });
});

boot();
