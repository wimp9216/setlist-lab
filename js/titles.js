/* =========================================================
   Setlist Lab — 曲名の正式名称化
   ---------------------------------------------------------
   setlist.fm はラテン文字しか扱えないため、日本語タイトルの曲は
   ローマ字表記で登録されている（「宿命」→「Shukumei」）。
   そのままだと画面がローマ字だらけになって読みにくい。

   ここでは setlist.fm の原名 → 正式名称の対応表を持ち、
   表示のときだけ差し替える。

   ＊集計キーは原名から作ったものを使い続ける。
     正式名称をキーにすると、曲名を直すたびにキーが変わり、
     解析済みの特徴量や参加記録との対応が切れてしまう。
   ========================================================= */

import { songKey, matchTrack, cleanTitle } from './normalize.js';
import * as store from './store.js';
import * as api from './api.js';

/**
 * 保存形式: { [rawKey]: { official, source, itunesId?, confidence?, savedAt } }
 *   rawKey     setlist.fm の原名から作ったキー
 *   official   表示に使う正式名称
 *   source     'itunes'（自動）| 'manual'（手動修正）
 *   confidence 'exact' | 'artist' | 'weak'
 */

export function getTitles() {
  return store.getTitles();
}

/** 原名 → 正式名称（未登録なら原名をそのまま返す） */
export function officialOf(rawName) {
  const t = store.getTitles()[songKey(rawName)];
  return t?.official || rawName;
}

/**
 * 表示名を引く関数を作る。
 * 毎回 localStorage を読むと重いので、1回読んでクロージャに閉じ込める。
 * @returns {(rawName:string) => string}
 */
export function makeTitleResolver() {
  const all = store.getTitles();
  return (rawName) => all[songKey(rawName)]?.official || rawName;
}

/** 手動で正式名称を設定する（空文字を渡すと解除＝原名に戻す） */
export function setTitle(rawName, official) {
  const key = songKey(rawName);
  const v = (official || '').trim();
  if (!v || v === rawName) {
    store.removeTitle(key);
    return null;
  }
  return store.saveTitle(key, { official: v, rawName, source: 'manual', confidence: 'manual' });
}

/** 自動解決の結果を保存する。手動で直したものは上書きしない。 */
export function setTitleAuto(rawName, official, { itunesId, confidence } = {}) {
  const key = songKey(rawName);
  const existing = store.getTitles()[key];
  if (existing?.source === 'manual') return existing;
  return store.saveTitle(key, {
    official: (official || '').trim(),
    rawName,
    source: 'itunes',
    itunesId: itunesId || null,
    confidence: confidence || null,
  });
}

export function clearTitle(rawName) {
  store.removeTitle(songKey(rawName));
}

/* ---------------------------------------------------------
   一括解決
   --------------------------------------------------------- */

/**
 * 曲名がローマ字表記のままかを判定する。
 *
 * 日本語（かな・漢字）が1文字でも入っていれば、すでに正式名称と見なす。
 * setlist.fm 由来の曲名にはそもそも日本語が入らないので、
 * 日本語が入っているものは手動入力か解決済みのどちらか。
 */
export function looksRomaji(name) {
  return !/[ぁ-んァ-ヶ一-龯々〆ヵヶ]/.test(name || '');
}

/**
 * アーティストの曲名をまとめて正式名称に直す。
 *
 * 手順:
 *   1. iTunes のアーティストIDを解決（1リクエスト）
 *   2. 楽曲カタログを一括取得（1リクエスト・200曲まで）
 *   3. 曲名が一致したものはカタログから決定（英語タイトル曲はここで済む）
 *   4. 残りだけ個別検索（iTunes は約20回/分なので、ここが時間のかかる部分）
 *
 * @param {object} artist { mbid, name, itunesArtistId }
 * @param {Array} songs [{ key, name, count }]
 * @param {object} opts { onProgress, signal, deep }
 *   deep=false なら 3 までで止める（速いが英語タイトル曲しか直らない）
 * @returns {{ resolved, unresolved, catalogSize, requests }}
 */
export async function resolveTitles(artist, songs, { onProgress, signal, deep = true } = {}) {
  let requests = 0;
  const resolved = [];
  const unresolved = [];

  /* --- アーティストID --- */
  let itunesArtistId = artist.itunesArtistId || null;
  onProgress?.({ phase: 'artist', done: 0, total: songs.length });
  if (!itunesArtistId) {
    try {
      requests++;
      const hit = await api.findItunesArtist(artist.name, { signal });
      if (hit) {
        itunesArtistId = hit.id;
        store.updateArtist(artist.mbid, { itunesArtistId });
      }
    } catch (e) {
      if (e.name === 'AbortError') throw e;
      // アーティストIDが取れなくても、曲名検索だけで進められる
    }
  }

  /* --- カタログ --- */
  let catalog = [];
  if (itunesArtistId) {
    try {
      onProgress?.({ phase: 'catalog', done: 0, total: songs.length });
      requests++;
      catalog = await api.fetchArtistCatalog(itunesArtistId, { limit: 200, signal });
    } catch (e) {
      if (e.name === 'AbortError') throw e;
    }
  }

  /* --- カタログで照合 --- */
  const remaining = [];
  for (const song of songs) {
    if (signal?.aborted) throw new DOMException('中止しました', 'AbortError');

    const m = catalog.length ? matchTrack(song.name, artist.name, catalog, itunesArtistId) : null;
    if (m && m.confidence === 'exact') {
      setTitleAuto(song.name, cleanTitle(m.track.title), { itunesId: m.track.itunesId, confidence: 'exact' });
      resolved.push({ ...song, official: cleanTitle(m.track.title), confidence: 'exact' });
    } else {
      remaining.push(song);
    }
  }
  onProgress?.({ phase: 'catalog-done', done: resolved.length, total: songs.length, catalogSize: catalog.length });

  if (!deep) {
    return { resolved, unresolved: remaining, catalogSize: catalog.length, requests };
  }

  /* --- 残りを個別検索 --- */
  let done = resolved.length;
  // 残り時間の見積もりには「実際に検索した数」を使う。
  // done にはカタログで即決まった曲が含まれており、
  // それで割ると1曲あたりの所要時間が実態より短く出てしまう。
  let searched = 0;
  for (const song of remaining) {
    if (signal?.aborted) throw new DOMException('中止しました', 'AbortError');
    onProgress?.({
      phase: 'search',
      done, total: songs.length, current: song.name,
      searched, searchTotal: remaining.length,
    });

    try {
      requests++;
      const hits = await api.searchTracks(`${artist.name} ${song.name}`, { limit: 8, signal });
      const m = matchTrack(song.name, artist.name, hits, itunesArtistId);

      // アーティストが確定できた結果だけ採用する。
      // weak（別アーティストかもしれない先頭）を信じると、
      // 無関係な曲名に書き換えてしまう。
      if (m && (m.confidence === 'exact' || m.confidence === 'artist')) {
        setTitleAuto(song.name, cleanTitle(m.track.title), { itunesId: m.track.itunesId, confidence: m.confidence });
        resolved.push({ ...song, official: cleanTitle(m.track.title), confidence: m.confidence });
      } else {
        markNotFound(song.name);
        unresolved.push({ ...song, reason: m ? '同じアーティストの曲が見つかりません' : '検索結果が空でした' });
      }
    } catch (e) {
      if (e.name === 'AbortError') throw e;
      // 通信エラーは「見つからなかった」とは別。再試行できるよう記録しない。
      unresolved.push({ ...song, reason: e.message });
    }
    done++;
    searched++;
  }

  onProgress?.({ phase: 'done', done, total: songs.length });
  return { resolved, unresolved, catalogSize: catalog.length, requests };
}

/**
 * まだ iTunes と照合していない曲を返す（＝自動解決の対象）。
 *
 * 照合済みなら、結果が英語のまま（「Pretender」など元から英語タイトルの曲）でも
 * 未照合とは扱わない。ここを「ローマ字かどうか」だけで見ると、
 * 正しい英語タイトルの曲を毎回検索し直してしまう。
 */
export function pendingSongs(songs) {
  const titles = store.getTitles();
  return songs.filter((s) => {
    const t = titles[songKey(s.name)];
    if (t) return false;              // 一度照合済み（見つからなかった場合も含む）
    return looksRomaji(s.name);       // 未照合かつローマ字なら対象
  });
}

/**
 * 照合したものの正式名称に直せなかった曲（手入力が必要なもの）。
 * 照合して英語タイトルのままだったものは正常なので含めない。
 */
export function needsManualSongs(songs) {
  const titles = store.getTitles();
  return songs.filter((s) => titles[songKey(s.name)]?.confidence === 'notfound');
}

/** 照合したが該当が見つからなかったことを記録する（毎回検索し直さないため） */
export function markNotFound(rawName) {
  const key = songKey(rawName);
  if (store.getTitles()[key]?.source === 'manual') return;
  store.saveTitle(key, { official: rawName, rawName, source: 'itunes', confidence: 'notfound' });
}
