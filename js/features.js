/* =========================================================
   Setlist Lab — 楽曲特徴量の解決層
   ---------------------------------------------------------
   特徴量は songKey（表記ゆれを吸収した正規化キー）で保存する。
   手動で上書きした値があれば、そちらを常に優先する。
   ========================================================= */

import { songKey } from './normalize.js';
import { getFeatures, saveFeature, getSettings } from './store.js';

/**
 * 保存済みの特徴量から「激しさ」を引く関数を作る。
 * 毎回 localStorage を読むと重いので、1回読んでクロージャに閉じ込める。
 *
 * @returns {(name:string, key?:string) => number|null}
 */
export function makeIntensityResolver() {
  const all = getFeatures();
  return (name, key) => {
    const f = all[key || songKey(name)];
    if (!f) return null;
    const v = Number.isFinite(f.manualIntensity) ? f.manualIntensity : f.intensity;
    return Number.isFinite(v) ? v : null;
  };
}

/** 1曲分の特徴量レコードを引く */
export function featureOf(name) {
  return getFeatures()[songKey(name)] || null;
}

/** 実効の激しさ（手動上書きがあればそれ） */
export function effectiveIntensity(feature) {
  if (!feature) return null;
  const v = Number.isFinite(feature.manualIntensity) ? feature.manualIntensity : feature.intensity;
  return Number.isFinite(v) ? v : null;
}

/**
 * 生の測定値（energy / tempo / brightness）から激しさ 0-100 を合成する。
 * 各成分はアーティスト内でのパーセンタイルに直してから重み付けする。
 * 絶対値で正規化すると、静かな曲ばかりのアーティストが
 * 全曲「静か」に潰れて曲間の差が見えなくなるため。
 */
export function composeIntensity(raw, percentiles, weights = getSettings().weights) {
  const e = percentiles.energy(raw.energy);
  const t = percentiles.tempo(raw.bpm);
  const b = percentiles.brightness(raw.brightness);
  const w = weights;
  const sum = w.energy + w.tempo + w.brightness || 1;
  return Math.round(((e * w.energy + t * w.tempo + b * w.brightness) / sum) * 100);
}

/**
 * 値の配列から「その値が何パーセンタイルか」を返す関数を作る。
 * 同点は中間順位として扱う。
 */
export function percentileFn(values) {
  const sorted = values.filter(Number.isFinite).sort((a, b) => a - b);
  const n = sorted.length;
  if (!n) return () => 0.5;
  return (v) => {
    if (!Number.isFinite(v)) return 0.5;
    let lo = 0, hi = 0;
    for (const s of sorted) {
      if (s < v) lo += 1;
      if (s <= v) hi += 1;
    }
    return ((lo + hi) / 2) / n;
  };
}

/**
 * 解析済みの生値をもとに、アーティスト全体で激しさを付け直す。
 * 曲を1曲追加するたびに全体の基準がずれるため、まとめて計算し直す。
 *
 * @param {string[]} keys 対象の songKey
 */
export function recomputeIntensities(keys) {
  const all = getFeatures();
  const targets = keys.filter((k) => all[k] && Number.isFinite(all[k].energy));
  if (!targets.length) return 0;

  const percentiles = {
    energy: percentileFn(targets.map((k) => all[k].energy)),
    tempo: percentileFn(targets.map((k) => all[k].bpm)),
    brightness: percentileFn(targets.map((k) => all[k].brightness)),
  };

  const weights = getSettings().weights;
  for (const k of targets) {
    const f = all[k];
    saveFeature(k, { intensity: composeIntensity(f, percentiles, weights) });
  }
  return targets.length;
}

/** 手動で激しさを上書きする（null を渡すと解除） */
export function setManualIntensity(name, value) {
  const k = songKey(name);
  return saveFeature(k, {
    manualIntensity: value === null || value === undefined ? undefined : Math.max(0, Math.min(100, Math.round(value))),
    displayName: name,
  });
}

/** セトリ群に出てくる曲を、出現回数つきで一覧にする */
export function collectSongs(setlists, { excludeTape = true } = {}) {
  const map = new Map();
  for (const sl of setlists) {
    for (const set of sl.sets) {
      for (const song of set.songs) {
        if (excludeTape && song.tape) continue;
        const k = songKey(song.name);
        if (!k) continue;
        const e = map.get(k);
        if (e) e.count += 1;
        else map.set(k, { key: k, name: song.name, count: 1 });
      }
    }
  }
  return [...map.values()].sort((a, b) => b.count - a.count || a.name.localeCompare(b.name, 'ja'));
}
