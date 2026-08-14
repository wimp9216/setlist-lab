/* =========================================================
   Setlist Lab — 内蔵サンプルデータ
   ---------------------------------------------------------
   setlist.fm の APIキーが届く前でも全機能を動かせるようにするための、
   実データと同じ形式のダミー。アーティスト・楽曲はすべて架空。

   分析ロジックの検証を兼ねているため、「正解」を意図的に仕込んである。
   期待値は下部の SAMPLE_FACTS に明記してあり、設定画面の
   「サンプルデータで自己検証」から実際の集計結果と突き合わせられる。
   ========================================================= */

import { songKey } from './normalize.js';

export const SAMPLE_MBID = 'sample-0000-0000-0000-000000000001';

export const SAMPLE_ARTIST = {
  mbid: SAMPLE_MBID,
  name: 'ペーパーランタンズ（サンプル）',
  sortName: 'Paper Lanterns',
  itunesArtistId: null,
  isSample: true,
};

/**
 * 楽曲マスタ。intensity は「激しさ 0-100」の正解値。
 * 架空の曲なので iTunes には存在せず自動解析できないため、
 * 起伏分析をそのまま試せるよう特徴量を焼き込んである。
 */
export const SAMPLE_SONGS = [
  { name: 'ハローの合図',     intensity: 82, bpm: 168, energy: 80, brightness: 74 },
  { name: 'サイレン',         intensity: 88, bpm: 176, energy: 87, brightness: 82 },
  { name: 'ネオンの雨',       intensity: 76, bpm: 152, energy: 74, brightness: 70 },
  { name: 'カメレオン',       intensity: 85, bpm: 172, energy: 84, brightness: 79 },
  { name: 'ワンダーラスト',   intensity: 79, bpm: 160, energy: 77, brightness: 76 },
  { name: 'アルバトロス',     intensity: 91, bpm: 184, energy: 90, brightness: 85 },
  { name: 'ダンスフロア',     intensity: 96, bpm: 192, energy: 95, brightness: 90 },
  { name: '花火のあと',       intensity: 94, bpm: 180, energy: 93, brightness: 88 },
  { name: 'リフレイン',       intensity: 70, bpm: 144, energy: 68, brightness: 66 },
  { name: '群青ブルー',       intensity: 66, bpm: 138, energy: 64, brightness: 62 },
  { name: 'トワイライト',     intensity: 58, bpm: 126, energy: 56, brightness: 55 },
  { name: '深呼吸',           intensity: 52, bpm: 118, energy: 50, brightness: 52 },
  { name: '灯台',             intensity: 45, bpm: 108, energy: 44, brightness: 47 },
  { name: 'スロウダウン',     intensity: 40, bpm: 100, energy: 38, brightness: 42 },
  { name: 'またこの街で',     intensity: 38, bpm: 96,  energy: 36, brightness: 40 },
  { name: '雪解けのテンポ',   intensity: 34, bpm: 88,  energy: 32, brightness: 36 },
  { name: '帰り道',           intensity: 30, bpm: 80,  energy: 28, brightness: 33 },
  { name: '春の残像',         intensity: 28, bpm: 76,  energy: 26, brightness: 30 },
  { name: 'ノクターン',       intensity: 25, bpm: 72,  energy: 23, brightness: 27 },
  { name: '手紙',             intensity: 22, bpm: 68,  energy: 20, brightness: 24 },
];

const VENUES_A = [
  ['Zepp Sapporo', '札幌'], ['Zepp Sendai', '仙台'], ['Zepp Tokyo', '東京'],
  ['Zepp Tokyo', '東京'], ['Zepp Nagoya', '名古屋'], ['Zepp Namba', '大阪'],
  ['Zepp Namba', '大阪'], ['Zepp Fukuoka', '福岡'], ['Zepp Hiroshima', '広島'],
  ['Zepp Yokohama', '横浜'], ['Zepp Yokohama', '横浜'], ['日本武道館', '東京'],
];

const VENUES_B = [
  ['LIQUIDROOM', '東京'], ['UMEDA CLUB QUATTRO', '大阪'], ['NAGOYA CLUB QUATTRO', '名古屋'],
  ['仙台 darwin', '仙台'], ['広島 CLUB QUATTRO', '広島'], ['福岡 DRUM LOGOS', '福岡'],
  ['札幌 PENNY LANE24', '札幌'], ['新木場STUDIO COAST', '東京'],
];

const TOUR_A = 'PAPER LANTERNS TOUR 2026 “HALO”';
const TOUR_B = 'ペーパーランタンズ 対バンツアー 2025';

/* ---------------------------------------------------------
   ツアーA（12公演）— ゾーン分離型のセトリ
   前半に激しい曲、中盤にバラードゾーン、終盤で再び上げる構成。
   --------------------------------------------------------- */

// 基本形。公演ごとの差分は VARIATIONS_A で上書きする。
const BASE_A_MAIN = [
  'ハローの合図', 'サイレン', 'ネオンの雨', 'カメレオン', 'ワンダーラスト', 'アルバトロス',
  '春の残像', '手紙', 'ノクターン', '雪解けのテンポ', '帰り道',
  'リフレイン', '花火のあと',
];
const BASE_A_ENCORE = ['ダンスフロア', '深呼吸', 'またこの街で'];

/**
 * 公演ごとの差分。
 *  opener      : 1曲目を差し替える（未指定なら BASE のまま = ハローの合図）
 *  mainCloser  : 本編ラストを差し替える
 *  encoreOpener: アンコール1曲目を差し替える
 *  swap        : [対象曲, 差し替え曲] で中盤の曲を入れ替える
 */
const VARIATIONS_A = [
  {},                                                          // 0
  { encoreOpener: 'トワイライト', swap: ['帰り道', 'スロウダウン'] }, // 1
  { mainCloser: 'アルバトロス' },                                // 2
  { opener: '灯台' },                                           // 3
  { swap: ['ノクターン', 'トワイライト'] },                       // 4
  { mainCloser: 'アルバトロス' },                                // 5
  { encoreOpener: 'トワイライト', swap: ['春の残像', '群青ブルー'] }, // 6
  { opener: '灯台' },                                           // 7
  { encoreOpener: 'トワイライト' },                              // 8
  { swap: ['リフレイン', '群青ブルー'] },                         // 9
  { encoreOpener: 'トワイライト' },                              // 10
  { opener: '灯台', encoreOpener: 'トワイライト' },               // 11
];

/* ---------------------------------------------------------
   ツアーB（8公演）— 交互型のセトリ
   激しい曲と静かな曲を1曲ずつ交互に並べる構成。
   --------------------------------------------------------- */

const BASE_B_MAIN = [
  'ダンスフロア', '手紙', 'カメレオン', 'ノクターン', 'アルバトロス', '春の残像',
  'サイレン', '帰り道', 'ハローの合図', '雪解けのテンポ', '花火のあと',
];
const BASE_B_ENCORE = ['またこの街で'];

const VARIATIONS_B = [
  {},
  { swap: ['帰り道', 'スロウダウン'] },
  { opener: 'サイレン' },
  { swap: ['ノクターン', 'トワイライト'] },
  {},
  { swap: ['春の残像', '灯台'] },
  { opener: 'サイレン' },
  { swap: ['手紙', '深呼吸'] },
];

/* --------------------------------------------------------- */

function applyVariation(main, encore, v) {
  let m = [...main];
  let e = [...encore];

  if (v.swap) {
    const [from, to] = v.swap;
    const i = m.indexOf(from);
    if (i >= 0) m[i] = to;
  }
  if (v.opener) {
    // 差し替える1曲目が本編の他の位置にいたら、そこは元の1曲目で埋める
    const dup = m.indexOf(v.opener);
    if (dup > 0) m[dup] = m[0];
    m[0] = v.opener;
  }
  if (v.mainCloser) {
    const last = m.length - 1;
    const dup = m.indexOf(v.mainCloser);
    if (dup >= 0 && dup !== last) m[dup] = m[last];
    m[last] = v.mainCloser;
  }
  if (v.encoreOpener) {
    const dup = e.indexOf(v.encoreOpener);
    if (dup > 0) e[dup] = e[0];
    e[0] = v.encoreOpener;
  }
  return { main: m, encore: e };
}

function buildSetlist({ id, date, tour, venue, city, main, encore }) {
  const sets = [
    { encore: 0, name: '', songs: main.map((name) => ({ name, tape: false, cover: null, info: '' })) },
  ];
  if (encore.length) {
    sets.push({ encore: 1, name: '', songs: encore.map((name) => ({ name, tape: false, cover: null, info: '' })) });
  }
  return {
    id, source: 'setlistfm', date,
    artistMbid: SAMPLE_MBID, artistName: SAMPLE_ARTIST.name,
    tour, venue, city, country: '日本',
    url: '', info: '', sets,
  };
}

function addDays(iso, days) {
  const d = new Date(`${iso}T00:00:00`);
  d.setDate(d.getDate() + days);
  return d.toISOString().slice(0, 10);
}

export function buildSampleSetlists() {
  const out = [];

  VARIATIONS_A.forEach((v, i) => {
    const { main, encore } = applyVariation(BASE_A_MAIN, BASE_A_ENCORE, v);
    const [venue, city] = VENUES_A[i];
    out.push(buildSetlist({
      id: `sample-a-${String(i + 1).padStart(2, '0')}`,
      date: addDays('2026-04-11', i * 7),
      tour: TOUR_A, venue, city, main, encore,
    }));
  });

  VARIATIONS_B.forEach((v, i) => {
    const { main, encore } = applyVariation(BASE_B_MAIN, BASE_B_ENCORE, v);
    const [venue, city] = VENUES_B[i];
    out.push(buildSetlist({
      id: `sample-b-${String(i + 1).padStart(2, '0')}`,
      date: addDays('2025-09-06', i * 6),
      tour: TOUR_B, venue, city, main, encore,
    }));
  });

  return out.sort((a, b) => (a.date < b.date ? 1 : -1));
}

/** 架空の曲は iTunes に無いため、特徴量を最初から入れておく */
export function buildSampleFeatures() {
  const map = {};
  for (const s of SAMPLE_SONGS) {
    // 保存キーは他と揃えて songKey（正規化キー）にする
    map[songKey(s.name)] = {
      displayName: s.name,
      bpm: s.bpm,
      energy: s.energy,
      brightness: s.brightness,
      dynamics: 50,
      intensity: s.intensity,
      isSample: true,
      analyzedAt: Date.now(),
    };
  }
  return map;
}

/* ---------------------------------------------------------
   仕込んだ「正解」。設定画面の自己検証で実際の集計と突き合わせる。
   --------------------------------------------------------- */

export const SAMPLE_FACTS = {
  tour: TOUR_A,
  total: 12,
  checks: [
    { label: '1曲目「ハローの合図」',            position: 'opener',       song: 'ハローの合図',  expected: 9  },
    { label: '1曲目「灯台」',                    position: 'opener',       song: '灯台',          expected: 3  },
    { label: '本編ラスト「花火のあと」',          position: 'mainCloser',   song: '花火のあと',    expected: 10 },
    { label: '本編ラスト「アルバトロス」',        position: 'mainCloser',   song: 'アルバトロス',  expected: 2  },
    { label: 'アンコール1曲目「ダンスフロア」',    position: 'encoreOpener', song: 'ダンスフロア',  expected: 7  },
    { label: 'アンコール1曲目「トワイライト」',    position: 'encoreOpener', song: 'トワイライト',  expected: 5  },
    { label: 'アンコールラスト「またこの街で」',   position: 'encoreCloser', song: 'またこの街で',  expected: 12 },
  ],
  transitions: [
    { from: 'ハローの合図', to: 'サイレン',   expected: 9  },
    { from: 'サイレン',     to: 'ネオンの雨', expected: 12 },
  ],
  arcs: [
    { tour: TOUR_A, expect: 'zoned',      note: '前半に激しい曲、中盤にバラードゾーン' },
    { tour: TOUR_B, expect: 'alternating', note: '激しい曲と静かな曲が交互' },
  ],
};
