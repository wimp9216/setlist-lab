/* =========================================================
   Setlist Lab — localStorage 層
   ---------------------------------------------------------
   保存はすべてこのモジュール経由。キーは setlistLab.<name>.v1。
   セトリは件数が多いので、保存時に不要フィールドを落とす。
   ========================================================= */

const K = (name) => `setlistLab.${name}.v1`;

export const LS_ARTISTS  = K('artists');   // お気に入りアーティスト
export const LS_SETLISTS = K('setlists');  // API取得セトリ（mbid 単位）
export const LS_MANUAL   = K('manual');    // 手動入力セトリ
export const LS_FEATURES = K('features');  // 楽曲特徴量キャッシュ
export const LS_SONGMAP  = K('songmap');   // 曲名 → iTunes トラック の手動リンク
export const LS_TITLES   = K('titles');    // setlist.fm の原名 → 正式名称
export const LS_ATTEND   = K('attend');    // 参加記録
export const LS_MYSETS   = K('mysets');    // マイセトリ
export const LS_PROXY    = K('proxy');     // Cloudflare Worker の URL
export const LS_SETTINGS = K('settings');  // 各種設定

export function load(key, def) {
  try {
    const raw = localStorage.getItem(key);
    if (raw === null) return def;
    const v = JSON.parse(raw);
    return v === null ? def : v;
  } catch {
    return def;
  }
}

export function save(key, value) {
  try {
    localStorage.setItem(key, JSON.stringify(value));
    return true;
  } catch (e) {
    // 容量超過（QuotaExceededError）のときだけ呼び出し元に知らせる
    console.warn('[store] 保存に失敗:', key, e);
    return false;
  }
}

export function remove(key) {
  localStorage.removeItem(key);
}

/* ---------------- 既定値 ---------------- */

export const DEFAULT_SETTINGS = {
  excludeTape: true,        // SE/BGM(tape) を分析から除外
  crossSetTransitions: false, // set をまたぐ遷移を「つながり」に含める
  minTransitionCount: 2,    // 定番ブロック検出の最小出現回数
  blockThreshold: 0.6,      // 定番ブロック検出の確率しきい値
  weights: { energy: 0.45, tempo: 0.30, brightness: 0.25 },
  // setlist.fm の利用規約は、取得したデータの保持を
  // 「短期間のキャッシュ」に限っている。この日数を過ぎた取得分は起動時に破棄する。
  cacheMaxDays: 14,
};

export function getSettings() {
  return { ...DEFAULT_SETTINGS, ...load(LS_SETTINGS, {}) };
}

export function setSettings(patch) {
  const next = { ...getSettings(), ...patch };
  save(LS_SETTINGS, next);
  return next;
}

/* ---------------- アーティスト ---------------- */
// { mbid, name, sortName, itunesArtistId }

export function getArtists() {
  return load(LS_ARTISTS, []);
}

export function addArtist(artist) {
  const list = getArtists();
  if (list.some((a) => a.mbid === artist.mbid)) return list;
  list.push(artist);
  save(LS_ARTISTS, list);
  return list;
}

export function removeArtist(mbid) {
  const list = getArtists().filter((a) => a.mbid !== mbid);
  save(LS_ARTISTS, list);
  // 紐づくセトリも消す（容量を無駄に食わないように）
  const all = load(LS_SETLISTS, {});
  delete all[mbid];
  save(LS_SETLISTS, all);
  return list;
}

export function updateArtist(mbid, patch) {
  const list = getArtists();
  const i = list.findIndex((a) => a.mbid === mbid);
  if (i < 0) return list;
  list[i] = { ...list[i], ...patch };
  save(LS_ARTISTS, list);
  return list;
}

/* ---------------- セトリ ---------------- */
// LS_SETLISTS の形: { [mbid]: { fetchedAt, total, items: [Setlist] } }

export function getSetlistCache(mbid) {
  return load(LS_SETLISTS, {})[mbid] || null;
}

/** 取得からの経過日数（未取得なら null） */
export function cacheAgeDays(mbid) {
  const c = getSetlistCache(mbid);
  if (!c?.fetchedAt) return null;
  return (Date.now() - c.fetchedAt) / 86400000;
}

/**
 * 期限切れの取得データを破棄する。
 *
 * setlist.fm の利用規約はデータの保持を「短期間のキャッシュ」に限っているため、
 * 取得分は一定日数で捨てて取り直す。ユーザー自身が作ったもの
 * （手動入力のセトリ・参加記録・マイセトリ）は setlist.fm のデータではないので消さない。
 *
 * @returns {string[]} 破棄したアーティストの mbid
 */
export function purgeExpiredSetlists() {
  const maxDays = getSettings().cacheMaxDays;
  if (!maxDays) return [];

  const all = load(LS_SETLISTS, {});
  const purged = [];
  for (const [mbid, entry] of Object.entries(all)) {
    // サンプルは setlist.fm 由来ではないので対象外
    if (mbid.startsWith('sample-')) continue;
    if (!entry?.fetchedAt) continue;
    if (Date.now() - entry.fetchedAt > maxDays * 86400000) {
      delete all[mbid];
      purged.push(mbid);
    }
  }
  if (purged.length) save(LS_SETLISTS, all);
  return purged;
}

export function saveSetlistCache(mbid, items, total) {
  const all = load(LS_SETLISTS, {});
  all[mbid] = { fetchedAt: Date.now(), total: total ?? items.length, items };
  return save(LS_SETLISTS, all);
}

export function getManualSetlists() {
  return load(LS_MANUAL, []);
}

export function saveManualSetlist(setlist) {
  const list = getManualSetlists();
  const i = list.findIndex((s) => s.id === setlist.id);
  if (i >= 0) list[i] = setlist;
  else list.push(setlist);
  save(LS_MANUAL, list);
  return list;
}

export function deleteManualSetlist(id) {
  const list = getManualSetlists().filter((s) => s.id !== id);
  save(LS_MANUAL, list);
  return list;
}

/**
 * API取得分と手動入力分を統合して返す。分析はすべてこの関数の出力を入口にする。
 */
export function getAllSetlists(mbid) {
  const cached = getSetlistCache(mbid);
  const api = cached ? cached.items : [];
  const manual = getManualSetlists().filter((s) => s.artistMbid === mbid);
  return [...api, ...manual].sort((a, b) => (a.date < b.date ? 1 : -1)); // 新しい順
}

/* ---------------- 楽曲特徴量 ---------------- */
// { [songKey]: { bpm, energy, brightness, dynamics, intensity, manual, itunesId, jaTitle, artwork, previewUrl, analyzedAt } }

export function getFeatures() {
  return load(LS_FEATURES, {});
}

export function getFeature(songKey) {
  return getFeatures()[songKey] || null;
}

export function saveFeature(songKey, feature) {
  const all = getFeatures();
  all[songKey] = { ...all[songKey], ...feature };
  save(LS_FEATURES, all);
  return all[songKey];
}

export function saveFeatures(map) {
  const all = getFeatures();
  for (const [k, v] of Object.entries(map)) all[k] = { ...all[k], ...v };
  save(LS_FEATURES, all);
  return all;
}

/* ---------------- 曲名 → iTunes 手動リンク ---------------- */
// setlist.fm のローマ字表記と日本語タイトルが自動で結びつかない曲を手作業で対応づける

export function getSongMap() {
  return load(LS_SONGMAP, {});
}

export function linkSong(songKey, track) {
  const map = getSongMap();
  map[songKey] = track; // { itunesId, jaTitle, previewUrl, artwork }
  save(LS_SONGMAP, map);
  return map;
}

export function unlinkSong(songKey) {
  const map = getSongMap();
  delete map[songKey];
  save(LS_SONGMAP, map);
  return map;
}

/* ---------------- 曲名の正式名称 ---------------- */
// { [rawKey]: { official, rawName, source:'itunes'|'manual', itunesId, confidence, savedAt } }

export function getTitles() {
  return load(LS_TITLES, {});
}

export function saveTitle(rawKey, entry) {
  const all = getTitles();
  all[rawKey] = { ...all[rawKey], ...entry, savedAt: Date.now() };
  save(LS_TITLES, all);
  return all[rawKey];
}

export function removeTitle(rawKey) {
  const all = getTitles();
  delete all[rawKey];
  save(LS_TITLES, all);
  return all;
}

/* ---------------- 参加記録 ---------------- */
// { [setlistId]: { attended, seat, companions, memo, rating, savedAt } }

export function getAttendance() {
  return load(LS_ATTEND, {});
}

export function getAttendanceFor(setlistId) {
  return getAttendance()[setlistId] || null;
}

/**
 * @param {object} record 変更内容。null を渡すと記録ごと削除
 * @param {object} setlist 記録対象の公演。渡すと最小限の情報を控える。
 *   取得データは期限で破棄されるので、控えが無いと後から
 *   「いつ・どこの公演だったか」が分からなくなる。
 */
export function setAttendance(setlistId, record, setlist = null) {
  const all = getAttendance();
  if (record === null) {
    delete all[setlistId];
  } else {
    const snapshot = setlist ? {
      date: setlist.date,
      venue: setlist.venue,
      city: setlist.city,
      tour: setlist.tour,
      artistName: setlist.artistName,
      songCount: setlist.sets.reduce((a, s) => a + s.songs.filter((x) => !x.tape).length, 0),
    } : all[setlistId]?.snapshot;

    all[setlistId] = { ...all[setlistId], ...record, snapshot, savedAt: Date.now() };
  }
  save(LS_ATTEND, all);
  return all;
}

export function isAttended(setlistId) {
  const r = getAttendance()[setlistId];
  return !!(r && r.attended);
}

/* ---------------- マイセトリ ---------------- */
// { id, name, artistMbid, artistName, createdAt, updatedAt, sets: [{ encore, songs: [{name}] }] }

export function getMySets() {
  return load(LS_MYSETS, []);
}

export function saveMySet(set) {
  const list = getMySets();
  const i = list.findIndex((s) => s.id === set.id);
  const now = Date.now();
  if (i >= 0) list[i] = { ...set, updatedAt: now };
  else list.push({ ...set, createdAt: now, updatedAt: now });
  save(LS_MYSETS, list);
  return list;
}

export function deleteMySet(id) {
  const list = getMySets().filter((s) => s.id !== id);
  save(LS_MYSETS, list);
  return list;
}

/* ---------------- proxy ---------------- */

export function getProxyUrl() {
  return load(LS_PROXY, '') || '';
}

export function setProxyUrl(url) {
  const v = (url || '').trim().replace(/\/+$/, '');
  if (v) save(LS_PROXY, v);
  else remove(LS_PROXY);
  return v;
}

/* ---------------- バックアップ ---------------- */

export function exportAll() {
  const keys = [LS_ARTISTS, LS_SETLISTS, LS_MANUAL, LS_FEATURES, LS_SONGMAP, LS_TITLES, LS_ATTEND, LS_MYSETS, LS_PROXY, LS_SETTINGS];
  const dump = {};
  for (const k of keys) {
    const raw = localStorage.getItem(k);
    if (raw !== null) dump[k] = JSON.parse(raw);
  }
  return { app: 'setlist-lab', version: 1, exportedAt: new Date().toISOString(), data: dump };
}

export function importAll(payload) {
  if (!payload || payload.app !== 'setlist-lab' || !payload.data) {
    throw new Error('このファイルは Setlist Lab のバックアップではありません。');
  }
  for (const [k, v] of Object.entries(payload.data)) {
    if (!k.startsWith('setlistLab.')) continue; // 想定外のキーは書き込まない
    localStorage.setItem(k, JSON.stringify(v));
  }
}

/**
 * localStorage の使用量をざっくり返す（設定画面の表示用）。
 */
export function usageBytes() {
  let total = 0;
  for (let i = 0; i < localStorage.length; i++) {
    const k = localStorage.key(i);
    if (!k || !k.startsWith('setlistLab.')) continue;
    total += k.length + (localStorage.getItem(k) || '').length;
  }
  return total * 2; // UTF-16 でおおよそ2バイト/文字
}
