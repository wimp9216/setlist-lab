/* =========================================================
   Setlist Lab — 外部API クライアント
   ---------------------------------------------------------
   ・setlist.fm … CORSヘッダーを一切返さないためブラウザから直接叩けない。
                  Cloudflare Worker(proxy-worker.js)を必ず経由する。
                  無料キーは 2req/秒・1440req/日。
   ・MusicBrainz … CORS可。1req/秒を厳守（規約）。
   ・iTunes Search … CORS可・認証不要。日本語曲名と30秒試聴URLの供給源。
   ========================================================= */

import { getProxyUrl } from './store.js';
import { fromSetlistFmPage } from './normalize.js';

/* ---------------------------------------------------------
   共通: 1系統ずつ間隔を空けて流すキュー
   --------------------------------------------------------- */

class Throttle {
  constructor(minIntervalMs) {
    this.minInterval = minIntervalMs;
    this.last = 0;
    this.chain = Promise.resolve();
  }
  run(fn) {
    const task = this.chain.then(async () => {
      const wait = this.minInterval - (Date.now() - this.last);
      if (wait > 0) await new Promise((r) => setTimeout(r, wait));
      this.last = Date.now();
      return fn();
    });
    // 1件失敗しても後続を止めない
    this.chain = task.catch(() => {});
    return task;
  }
}

const throttles = {
  setlistfm: new Throttle(550),   // 2req/秒の制限に対し余裕を持たせる
  musicbrainz: new Throttle(1100), // 規約上 1req/秒
  itunes: new Throttle(350),
};

export class ApiError extends Error {
  constructor(message, { status = 0, kind = 'error' } = {}) {
    super(message);
    this.name = 'ApiError';
    this.status = status;
    this.kind = kind;
  }
}

async function fetchJson(url, { signal, headers } = {}) {
  let res;
  try {
    res = await fetch(url, { signal, headers });
  } catch (e) {
    if (e.name === 'AbortError') throw e;
    throw new ApiError('ネットワークに接続できませんでした。通信環境を確認してください。', { kind: 'network' });
  }

  if (res.status === 429) {
    throw new ApiError('リクエストが多すぎます。少し待ってからもう一度お試しください。', { status: 429, kind: 'ratelimit' });
  }
  if (res.status === 404) {
    throw new ApiError('該当するデータが見つかりませんでした。', { status: 404, kind: 'notfound' });
  }
  if (!res.ok) {
    let detail = '';
    try {
      const body = await res.json();
      detail = body?.error || body?.message || '';
    } catch { /* JSONでない応答は本文を諦める */ }
    throw new ApiError(detail || `サーバーが ${res.status} を返しました。`, { status: res.status });
  }

  return res.json();
}

/* =========================================================
   setlist.fm（Worker 経由）
   ========================================================= */

function proxyBase() {
  const url = getProxyUrl();
  if (!url) {
    throw new ApiError(
      'setlist.fm の取得サーバー(Cloudflare Worker)が未設定です。設定画面でURLを登録してください。',
      { kind: 'noproxy' }
    );
  }
  return url;
}

export function hasProxy() {
  return !!getProxyUrl();
}

/** Worker の疎通確認。APIキーが設定済みかも返す。 */
export async function checkProxy(url) {
  const base = (url || getProxyUrl()).replace(/\/+$/, '');
  if (!base) throw new ApiError('URLが空です。', { kind: 'noproxy' });
  return throttles.setlistfm.run(() => fetchJson(`${base}/health`));
}

/**
 * アーティスト名で setlist.fm を検索する。
 * @returns Array<{ mbid, name, sortName, disambiguation }>
 */
export async function searchArtistsSetlistFm(name, { signal } = {}) {
  const base = proxyBase();
  const url = `${base}/artists?name=${encodeURIComponent(name)}`;
  const data = await throttles.setlistfm.run(() => fetchJson(url, { signal }));
  return (data.artist || []).map((a) => ({
    mbid: a.mbid,
    name: a.name,
    sortName: a.sortName || '',
    disambiguation: a.disambiguation || '',
  }));
}

/**
 * アーティストのセトリを1ページ取得する（20件/ページ）。
 * @returns {{ items, total, page, itemsPerPage }}
 */
export async function fetchSetlistPage(mbid, page = 1, { signal } = {}) {
  const base = proxyBase();
  const url = `${base}/setlists?artistMbid=${encodeURIComponent(mbid)}&p=${page}`;
  const data = await throttles.setlistfm.run(() => fetchJson(url, { signal }));
  return {
    items: fromSetlistFmPage(data),
    total: Number(data.total) || 0,
    page: Number(data.page) || page,
    itemsPerPage: Number(data.itemsPerPage) || 20,
  };
}

/**
 * セトリを複数ページまとめて取得する。
 * 1日1440リクエストの上限があるので maxPages で必ず頭打ちにする。
 * @param {Function} onProgress ({ page, pages, fetched, total }) => void
 */
export async function fetchAllSetlists(mbid, { maxPages = 15, onProgress, signal } = {}) {
  const first = await fetchSetlistPage(mbid, 1, { signal });
  const pages = Math.min(Math.ceil(first.total / (first.itemsPerPage || 20)) || 1, maxPages);
  const items = [...first.items];
  onProgress?.({ page: 1, pages, fetched: items.length, total: first.total });

  for (let p = 2; p <= pages; p++) {
    if (signal?.aborted) break;
    const res = await fetchSetlistPage(mbid, p, { signal });
    items.push(...res.items);
    onProgress?.({ page: p, pages, fetched: items.length, total: first.total });
  }

  return { items, total: first.total, pagesFetched: pages, truncated: pages * (first.itemsPerPage || 20) < first.total };
}

/* =========================================================
   MusicBrainz（アーティストのMBID解決・CORS可）
   ========================================================= */

const MB_UA = 'SetlistLab/1.0 (https://github.com/wimp9216)';

export async function searchArtistsMusicBrainz(name, { signal } = {}) {
  const url = `https://musicbrainz.org/ws/2/artist?query=${encodeURIComponent(name)}&fmt=json&limit=10`;
  const data = await throttles.musicbrainz.run(() =>
    fetchJson(url, { signal, headers: { 'User-Agent': MB_UA } })
  );
  return (data.artists || []).map((a) => ({
    mbid: a.id,
    name: a.name,
    sortName: a['sort-name'] || '',
    disambiguation: a.disambiguation || '',
    country: a.country || '',
    score: a.score || 0,
  }));
}

/* =========================================================
   iTunes Search（日本語曲名・ジャケット・30秒試聴）
   ========================================================= */

const ITUNES_COUNTRY = 'JP';

/** 検索結果のトラックを共通形に整える */
function toTrack(r) {
  return {
    itunesId: r.trackId,
    title: r.trackName || '',
    artist: r.artistName || '',
    album: r.collectionName || '',
    previewUrl: r.previewUrl || '',
    artwork: (r.artworkUrl100 || '').replace('100x100bb', '300x300bb'),
    genre: r.primaryGenreName || '',
    durationMs: r.trackTimeMillis || 0,
    itunesArtistId: r.artistId,
  };
}

/** 曲名（＋アーティスト名）で検索する */
export async function searchTracks(term, { limit = 10, signal } = {}) {
  const url = `https://itunes.apple.com/search?term=${encodeURIComponent(term)}`
    + `&country=${ITUNES_COUNTRY}&media=music&entity=song&limit=${limit}`;
  const data = await throttles.itunes.run(() => fetchJson(url, { signal }));
  return (data.results || []).map(toTrack);
}

/** アーティスト名から iTunes のアーティストIDを引く */
export async function findItunesArtist(name, { signal } = {}) {
  const url = `https://itunes.apple.com/search?term=${encodeURIComponent(name)}`
    + `&country=${ITUNES_COUNTRY}&media=music&entity=musicArtist&limit=5`;
  const data = await throttles.itunes.run(() => fetchJson(url, { signal }));
  const hit = (data.results || [])[0];
  return hit ? { id: hit.artistId, name: hit.artistName, genre: hit.primaryGenreName } : null;
}

/**
 * アーティストIDから楽曲カタログをまとめて引く。
 * setlist.fm のローマ字表記と突き合わせる「曲名マスタ」を作るのに使う。
 */
export async function fetchArtistCatalog(itunesArtistId, { limit = 200, signal } = {}) {
  const url = `https://itunes.apple.com/lookup?id=${encodeURIComponent(itunesArtistId)}`
    + `&entity=song&limit=${limit}&country=${ITUNES_COUNTRY}`;
  const data = await throttles.itunes.run(() => fetchJson(url, { signal }));
  return (data.results || [])
    .filter((r) => r.wrapperType === 'track' && r.kind === 'song')
    .map(toTrack);
}

/** 試聴音源のバイト列を取る（Web Audio に渡す用） */
export async function fetchPreviewBuffer(previewUrl, { signal } = {}) {
  const res = await fetch(previewUrl, { signal });
  if (!res.ok) throw new ApiError(`試聴音源を取得できませんでした (${res.status})`, { status: res.status });
  return res.arrayBuffer();
}
