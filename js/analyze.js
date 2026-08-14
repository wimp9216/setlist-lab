/* =========================================================
   Setlist Lab — 分析エンジン
   ---------------------------------------------------------
   ここは純関数だけで構成する（DOM も localStorage も触らない）。
   入力は正規化済みセトリの配列、出力は集計結果のプレーンオブジェクト。
   ========================================================= */

import { flattenSongs, extractPositions, songKey } from './normalize.js';

export const POSITIONS = [
  { id: 'opener',       label: '1曲目' },
  { id: 'mainCloser',   label: '本編ラスト' },
  { id: 'encoreOpener', label: 'アンコール1曲目' },
  { id: 'encoreCloser', label: 'アンコールラスト' },
];

/**
 * Wilson score の下側信頼限界（95%）。
 * 「1公演中1回だから100%」のような、n が小さいだけの数字が
 * ランキング上位に居座らないようにするために使う。
 */
export function wilsonLower(count, total) {
  if (!total) return 0;
  const z = 1.96;
  const p = count / total;
  const d = 1 + (z * z) / total;
  const centre = p + (z * z) / (2 * total);
  const margin = z * Math.sqrt((p * (1 - p) + (z * z) / (4 * total)) / total);
  return Math.max(0, (centre - margin) / d);
}

/* =========================================================
   1. 位置別の確率
   ========================================================= */

/**
 * 「1曲目 / 本編ラスト / アンコール1曲目 / アンコールラスト」に
 * 各曲が来た回数を集計する。
 *
 * @returns {{ total:number, positions: { [id]: { total:number, ranking: Array } } }}
 *   ranking の各要素: { key, name, count, total, rate, wilson }
 *   total は「その位置が存在した公演数」。アンコール無しの公演は
 *   アンコール系の分母から外れる（ここを全公演数にすると確率が不当に下がる）。
 */
export function positionStats(setlists, opts = {}) {
  const acc = {};
  for (const p of POSITIONS) acc[p.id] = { total: 0, counts: new Map() };

  for (const sl of setlists) {
    const pos = extractPositions(sl, opts);
    for (const p of POSITIONS) {
      const song = pos[p.id];
      if (!song) continue;
      const bucket = acc[p.id];
      bucket.total += 1;
      const cur = bucket.counts.get(song.key);
      if (cur) cur.count += 1;
      else bucket.counts.set(song.key, { key: song.key, name: song.name, count: 1 });
    }
  }

  const positions = {};
  for (const p of POSITIONS) {
    const { total, counts } = acc[p.id];
    const ranking = [...counts.values()]
      .map((e) => ({ ...e, total, rate: total ? e.count / total : 0, wilson: wilsonLower(e.count, total) }))
      .sort((a, b) => b.count - a.count || a.name.localeCompare(b.name, 'ja'));
    positions[p.id] = { total, ranking };
  }

  return { total: setlists.length, positions };
}

/* =========================================================
   2. 曲ごとの出現率と登場位置の分布
   ========================================================= */

/**
 * 各曲の出現公演数と、セトリ内での相対位置（0=開演, 1=終演）の分布を出す。
 * @returns Array<{ key, name, count, total, rate, avgPosition, positions:number[], encoreCount }>
 */
export function songStats(setlists, opts = {}) {
  const map = new Map();

  for (const sl of setlists) {
    const songs = flattenSongs(sl, opts);
    const n = songs.length;
    if (!n) continue;
    // 同一公演で同じ曲が2回出ても1公演としてカウントする
    const seen = new Set();
    for (const s of songs) {
      let e = map.get(s.key);
      if (!e) {
        e = { key: s.key, name: s.name, count: 0, positions: [], encoreCount: 0 };
        map.set(s.key, e);
      }
      if (!seen.has(s.key)) {
        e.count += 1;
        seen.add(s.key);
      }
      e.positions.push(n > 1 ? s.position / (n - 1) : 0);
      if (s.encore > 0) e.encoreCount += 1;
    }
  }

  const total = setlists.length;
  return [...map.values()]
    .map((e) => ({
      ...e,
      total,
      rate: total ? e.count / total : 0,
      avgPosition: e.positions.reduce((a, b) => a + b, 0) / e.positions.length,
    }))
    .sort((a, b) => b.count - a.count || a.avgPosition - b.avgPosition);
}

/* =========================================================
   3. 曲のつながり（遷移）
   ========================================================= */

/**
 * 隣接する曲のペア A→B を数える。
 * 既定では同一set内のみ（本編ラスト→アンコール1曲目は「つながり」ではなく
 * 別物として扱うほうが実感に合う）。crossSetTransitions で切り替え。
 *
 * @returns {{ pairs:Map<string,Map<string,object>>, outTotal:Map<string,number>, names:Map<string,string> }}
 */
export function transitionStats(setlists, opts = {}) {
  const { crossSetTransitions = false } = opts;
  const pairs = new Map();     // fromKey -> Map<toKey, {key,name,count}>
  const outTotal = new Map();  // fromKey -> 「後続が存在した回数」
  const names = new Map();     // key -> 表示名

  for (const sl of setlists) {
    const songs = flattenSongs(sl, opts);
    for (let i = 0; i < songs.length; i++) names.set(songs[i].key, songs[i].name);

    for (let i = 0; i < songs.length - 1; i++) {
      const a = songs[i];
      const b = songs[i + 1];
      if (!crossSetTransitions && a.setIndex !== b.setIndex) continue;

      outTotal.set(a.key, (outTotal.get(a.key) || 0) + 1);
      let to = pairs.get(a.key);
      if (!to) { to = new Map(); pairs.set(a.key, to); }
      const cur = to.get(b.key);
      if (cur) cur.count += 1;
      else to.set(b.key, { key: b.key, name: b.name, count: 1 });
    }
  }

  return { pairs, outTotal, names };
}

/**
 * ある曲の「次に来やすい曲」ランキング。
 * @returns Array<{ key, name, count, total, rate, wilson }>
 */
export function successorsOf(stats, fromKey) {
  const to = stats.pairs.get(fromKey);
  if (!to) return [];
  const total = stats.outTotal.get(fromKey) || 0;
  return [...to.values()]
    .map((e) => ({ ...e, total, rate: total ? e.count / total : 0, wilson: wilsonLower(e.count, total) }))
    .sort((a, b) => b.count - a.count || b.rate - a.rate);
}

/**
 * 「ほぼ固定の流れ」を検出する。
 * P(next|cur) がしきい値以上かつ最低回数を満たす間だけ鎖を伸ばし、
 * 長さ3曲以上のものを返す。
 *
 * 起点は「ブロックの入口」に限る。入口とは、その曲へ強く流れ込んでくる
 * 曲が無い曲のこと。これをやらないと長い鎖の途中から始まる部分列が
 * 大量に出るうえ、結果が Map の反復順に左右されてしまう。
 *
 * @returns Array<{ songs:[{key,name}], links:[{count,total,rate}], minRate, length }>
 */
export function findFixedBlocks(stats, opts = {}) {
  const { blockThreshold = 0.6, minTransitionCount = 2, maxBlockLength = 6 } = opts;

  const strongNext = (key) => {
    const list = successorsOf(stats, key);
    if (!list.length) return null;
    const best = list[0];
    if (best.count < minTransitionCount || best.rate < blockThreshold) return null;
    // 割合だけで判断すると「2回中2回だから100%」のような、
    // 根拠の薄い並びが固定の流れとして紛れ込む。
    // 信頼区間の下限が5割を超えるもの（=偶然とは考えにくいもの）だけ通す。
    if (best.wilson < 0.5) return null;
    if (best.key === key) return null; // 自己ループは無視
    return best;
  };

  // 強い流れの流入先を集める。ここに入っている曲は入口ではない。
  const hasStrongInflow = new Set();
  for (const key of stats.pairs.keys()) {
    const nxt = strongNext(key);
    if (nxt) hasStrongInflow.add(nxt.key);
  }

  const blocks = [];
  const coveredEdges = new Set(); // 既出の鎖に含まれる辺

  const buildFrom = (startKey) => {
    const chain = [{ key: startKey, name: stats.names.get(startKey) || startKey }];
    const links = [];
    const edges = [];
    const visited = new Set([startKey]);

    let cur = startKey;
    while (chain.length < maxBlockLength) {
      const nxt = strongNext(cur);
      if (!nxt || visited.has(nxt.key)) break;
      chain.push({ key: nxt.key, name: nxt.name });
      links.push({ count: nxt.count, total: nxt.total, rate: nxt.rate });
      edges.push(`${cur} ${nxt.key}`);
      visited.add(nxt.key);
      cur = nxt.key;
    }
    return { chain, links, edges };
  };

  for (const startKey of stats.pairs.keys()) {
    if (hasStrongInflow.has(startKey)) continue;

    const { chain, links, edges } = buildFrom(startKey);
    if (chain.length < 3) continue;

    // 既出の鎖の辺しか含まない鎖は、実質同じ情報なので出さない
    if (edges.every((e) => coveredEdges.has(e))) continue;
    edges.forEach((e) => coveredEdges.add(e));

    blocks.push({
      songs: chain,
      links,
      length: chain.length,
      minRate: Math.min(...links.map((l) => l.rate)),
    });
  }

  return blocks.sort((a, b) => b.length - a.length || b.minRate - a.minRate);
}

/* =========================================================
   4. セトリの感情の起伏
   ========================================================= */

/**
 * セトリを激しさの系列に変換する。
 * @param {object} setlist 内部モデル
 * @param {Function} intensityOf (songName) => number|null  特徴量の解決関数
 * @returns {{ points: Array<{name,key,intensity,encore,position}>, coverage:number }}
 *   coverage は特徴量が判明している曲の割合。低いと判定が当てにならない。
 */
export function arcOf(setlist, intensityOf, opts = {}) {
  const songs = flattenSongs(setlist, opts);
  const points = [];
  let known = 0;

  for (const s of songs) {
    const v = intensityOf(s.name, s.key);
    if (v !== null && v !== undefined && Number.isFinite(v)) known += 1;
    points.push({
      name: s.name,
      key: s.key,
      intensity: Number.isFinite(v) ? v : null,
      encore: s.encore,
      position: s.position,
    });
  }

  return { points, coverage: songs.length ? known / songs.length : 0 };
}

/**
 * Wald–Wolfowitz の連（ラン）検定。
 * 中央値の上/下を並びとして見たとき、
 *   ラン数が期待より少ない → 同種が固まっている（ゾーン分離型）
 *   ラン数が期待より多い   → 交互に来ている（交互型）
 * 「なんとなくの閾値」ではなく、偶然の並びと比べて偏っているかで判定する。
 */
export function runsTest(values) {
  const vals = values.filter((v) => Number.isFinite(v));
  const n = vals.length;
  if (n < 6) return null;

  const sorted = [...vals].sort((a, b) => a - b);
  const median = n % 2 ? sorted[(n - 1) / 2] : (sorted[n / 2 - 1] + sorted[n / 2]) / 2;

  const signs = vals.map((v) => v > median);
  const nT = signs.filter(Boolean).length;
  const nF = n - nT;
  if (nT === 0 || nF === 0) return null;

  let runs = 1;
  for (let i = 1; i < signs.length; i++) if (signs[i] !== signs[i - 1]) runs += 1;

  const mu = 1 + (2 * nT * nF) / n;
  const variance = (2 * nT * nF * (2 * nT * nF - n)) / (n * n * (n - 1));
  const sigma = Math.sqrt(Math.max(variance, 1e-9));
  const z = (runs - mu) / sigma;

  return { runs, expected: mu, z, median, nT, nF, n };
}

/** 最長の連続ラン（同種が何曲続いたか） */
function longestRun(values, median) {
  let best = 0, cur = 0, prev = null;
  for (const v of values) {
    if (!Number.isFinite(v)) { prev = null; cur = 0; continue; }
    const s = v > median;
    if (s === prev) cur += 1;
    else { cur = 1; prev = s; }
    if (cur > best) best = cur;
  }
  return best;
}

/** 単回帰の傾き（0..n-1 に対する）。系列を [0,1] 幅に正規化した傾きを返す。 */
function slopeOf(values) {
  const pts = values.map((v, i) => [i, v]).filter(([, v]) => Number.isFinite(v));
  const n = pts.length;
  if (n < 3) return 0;
  const mx = pts.reduce((a, [x]) => a + x, 0) / n;
  const my = pts.reduce((a, [, y]) => a + y, 0) / n;
  let num = 0, den = 0;
  for (const [x, y] of pts) { num += (x - mx) * (y - my); den += (x - mx) ** 2; }
  if (!den) return 0;
  return (num / den) * (n - 1); // 全長にわたる変化量に換算
}

/**
 * バラードゾーン / 激しい曲ゾーンの連続区間を拾う。
 * @returns Array<{ type:'ballad'|'intense', from:number, to:number, songs:string[] }>
 */
export function findZones(points, opts = {}) {
  const { balladMax = 35, intenseMin = 75, minLength = 3 } = opts;
  const zones = [];
  let cur = null;

  points.forEach((p, i) => {
    const type = !Number.isFinite(p.intensity) ? null
      : p.intensity <= balladMax ? 'ballad'
      : p.intensity >= intenseMin ? 'intense'
      : null;

    if (type && cur && cur.type === type) {
      cur.to = i;
      cur.songs.push(p.name);
    } else {
      if (cur && cur.songs.length >= minLength) zones.push(cur);
      cur = type ? { type, from: i, to: i, songs: [p.name] } : null;
    }
  });
  if (cur && cur.songs.length >= minLength) zones.push(cur);

  return zones;
}

/**
 * 起伏のパターンを判定し、日本語の説明文を組み立てる。
 * @param {Array} points arcOf() の points
 * @returns {{ pattern, label, description, z, zones, slope, coverage } | null}
 */
export function classifyArc(points, coverage = 1) {
  const values = points.map((p) => p.intensity);
  const known = values.filter(Number.isFinite);
  if (known.length < 6) {
    return {
      pattern: 'unknown',
      label: '判定不能',
      description: `特徴量が分かっている曲が ${known.length} 曲しかないため、起伏を判定できません。楽曲マスタから解析してください。`,
      z: null, zones: [], slope: 0, coverage,
    };
  }

  const rt = runsTest(values);
  const zones = findZones(points);
  const slope = slopeOf(values);
  const median = rt ? rt.median : 0;
  const maxRun = longestRun(values, median);

  const parts = [];
  let pattern = 'mixed';
  let label = '緩急ミックス型';

  if (rt && rt.z <= -1.64) {
    pattern = 'zoned';
    label = 'ゾーン分離型';
    parts.push(`盛り上がる曲と落ち着く曲がまとまって配置されています（最長で${maxRun}曲連続）。`);
  } else if (rt && rt.z >= 1.64) {
    pattern = 'alternating';
    label = '交互型';
    parts.push('激しい曲と静かな曲がほぼ1曲ずつ交互に並んでいます。');
  } else {
    parts.push('特定の型に強く寄ってはおらず、緩急がほどよく混ざった並びです。');
  }

  // 全体の傾き（激しさ100点満点に対する変化量で判断）
  if (slope >= 20) parts.push('全体としては後半に向かって上がっていく右肩上がりの構成です。');
  else if (slope <= -20) parts.push('全体としては終盤に向けて落ち着いていく構成です。');

  const ballad = zones.filter((z) => z.type === 'ballad');
  const intense = zones.filter((z) => z.type === 'intense');
  if (ballad.length) {
    parts.push(`バラードゾーンが${ballad.length}箇所（${ballad.map((z) => `${z.from + 1}〜${z.to + 1}曲目`).join('・')}）あります。`);
  }
  if (intense.length) {
    parts.push(`激しい曲が続くゾーンが${intense.length}箇所（${intense.map((z) => `${z.from + 1}〜${z.to + 1}曲目`).join('・')}）あります。`);
  }
  if (coverage < 0.8) {
    parts.push(`※ 特徴量が判明しているのは${Math.round(coverage * 100)}%の曲のみのため、参考値です。`);
  }

  return { pattern, label, description: parts.join(''), z: rt ? rt.z : null, zones, slope, coverage };
}

/* =========================================================
   5. 予想セトリの自動生成
   ========================================================= */

/**
 * 分析結果からセトリを1本組み立てる。
 * 1曲目は実績最上位、以降は「次に来やすい曲」を既出を避けながら辿り、
 * 行き止まったら未使用曲の出現率上位で埋める。
 *
 * @returns {{ sets:[{encore, songs:[{name, reason}]}] }}
 */
export function predictSetlist(setlists, opts = {}) {
  const { mainLength = 13, encoreLength = 3 } = opts;

  const pstats = positionStats(setlists, opts);
  const tstats = transitionStats(setlists, opts);
  const sstats = songStats(setlists, opts);
  const byRate = [...sstats].sort((a, b) => b.rate - a.rate);

  const used = new Set();
  const pick = (entry, reason) => {
    used.add(entry.key);
    return { name: entry.name, key: entry.key, reason };
  };

  const topOf = (id) => pstats.positions[id].ranking.find((r) => !used.has(r.key)) || null;

  /* --- 本編 --- */
  const main = [];
  const opener = topOf('opener');
  if (opener) {
    main.push(pick(opener, `1曲目の実績 ${opener.count}/${opener.total}公演`));
  } else if (byRate.length) {
    main.push(pick(byRate[0], '出現率が最も高い曲'));
  }

  // 本編ラストは先に確保しておく（途中で使ってしまわないように）
  const closer = topOf('mainCloser');
  if (closer) used.add(closer.key);

  while (main.length < mainLength - (closer ? 1 : 0)) {
    const prev = main[main.length - 1];
    let next = null;

    if (prev) {
      const succ = successorsOf(tstats, prev.key).filter((s) => !used.has(s.key));
      if (succ.length && succ[0].count >= 2) {
        next = pick(succ[0], `「${prev.name}」の次に来た実績 ${succ[0].count}/${succ[0].total}回`);
      }
    }
    if (!next) {
      const fill = byRate.find((s) => !used.has(s.key));
      if (!fill) break;
      next = pick(fill, `出現率 ${Math.round(fill.rate * 100)}%`);
    }
    main.push(next);
  }

  if (closer) {
    main.push({ name: closer.name, key: closer.key, reason: `本編ラストの実績 ${closer.count}/${closer.total}公演` });
  }

  /* --- アンコール --- */
  const encore = [];
  const encCloser = topOf('encoreCloser');
  if (encCloser) used.add(encCloser.key);

  const encOpener = topOf('encoreOpener');
  if (encOpener) {
    encore.push(pick(encOpener, `アンコール1曲目の実績 ${encOpener.count}/${encOpener.total}公演`));
  }
  while (encore.length < encoreLength - (encCloser ? 1 : 0)) {
    const fill = byRate.find((s) => !used.has(s.key));
    if (!fill) break;
    encore.push(pick(fill, `出現率 ${Math.round(fill.rate * 100)}%`));
  }
  if (encCloser) {
    encore.push({ name: encCloser.name, key: encCloser.key, reason: `アンコールラストの実績 ${encCloser.count}/${encCloser.total}公演` });
  }

  const sets = [{ encore: 0, songs: main }];
  if (encore.length) sets.push({ encore: 1, songs: encore });
  return { sets };
}

/* =========================================================
   6. 比較
   ========================================================= */

/**
 * 複数公演を横並びで比べるための集計。
 * どの曲が共通で、どれがその日だけかを判定する。
 */
export function compareSetlists(setlists, opts = {}) {
  const columns = setlists.map((sl) => ({ setlist: sl, songs: flattenSongs(sl, opts) }));
  const appearIn = new Map(); // key -> Set(列index)

  columns.forEach((col, ci) => {
    for (const s of col.songs) {
      if (!appearIn.has(s.key)) appearIn.set(s.key, new Set());
      appearIn.get(s.key).add(ci);
    }
  });

  const n = columns.length;
  for (const col of columns) {
    for (const s of col.songs) {
      const cnt = appearIn.get(s.key).size;
      s.sharedCount = cnt;
      s.isCommon = cnt === n && n > 1;  // 全公演で披露
      s.isUnique = cnt === 1 && n > 1;  // その日だけ
    }
  }

  return { columns, appearIn };
}

/** 曲名から突合キーを作る（ビュー層から使う用の再エクスポート） */
export { songKey };
