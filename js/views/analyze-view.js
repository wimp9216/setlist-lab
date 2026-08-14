/* =========================================================
   Setlist Lab — 分析画面
   1. 位置別の確率（1曲目・本編ラスト・アンコール・アンコールラスト）
   2. 曲のつながり（次に来やすい曲・定番ブロック）
   3. セトリの感情の起伏（パターン分類）
   ========================================================= */

import { el, empty, countRate, pct } from '../ui.js';
import { formatDate } from '../normalize.js';
import {
  POSITIONS, positionStats, songStats, transitionStats,
  successorsOf, findFixedBlocks, arcOf, classifyArc,
} from '../analyze.js';
import { makeIntensityResolver } from '../features.js';
import { arcChart, rankList, positionStrip } from '../charts.js';
import * as store from '../store.js';
import { state, render, go, currentArtist, scopedSetlists, scopeLabel } from '../main.js';
import { scopeBar } from './scope-bar.js';

// つながり分析で選択中の曲（画面をまたいでは保持しない）
let selectedSongKey = null;

export function renderAnalyze() {
  const view = el('div.view');
  const artist = currentArtist();

  view.appendChild(el('div.view-head', [
    el('h1', '分析'),
    el('p', '公演をまたいでセットリストの傾向を集計します。確率は必ず「何公演中の何回か」とセットで表示します。'),
  ]));

  if (!artist) {
    view.appendChild(empty('🎤', 'アーティストが登録されていません。'));
    return view;
  }

  view.appendChild(scopeBar());

  const setlists = scopedSetlists();
  if (!setlists.length) {
    view.appendChild(empty('📊', 'この条件に当てはまる公演がありません。'));
    return view;
  }

  const opts = { excludeTape: store.getSettings().excludeTape, ...store.getSettings() };

  view.appendChild(positionSection(setlists, opts));
  view.appendChild(transitionSection(setlists, opts));
  view.appendChild(arcSection(setlists, opts));
  view.appendChild(songTable(setlists, opts));

  return view;
}

/* =========================================================
   1. 位置別の確率
   ========================================================= */

function positionSection(setlists, opts) {
  const stats = positionStats(setlists, opts);

  return el('div.section', [
    el('h2', [
      'この位置に来やすい曲',
      el('span.count', `${scopeLabel()} ${setlists.length}公演`),
    ]),
    el('div.stack', POSITIONS.map((p) => {
      const bucket = stats.positions[p.id];
      if (!bucket.total) {
        return el('div.card', [
          el('div.spread', [el('b', p.label), el('span.tiny.dim', '該当なし')]),
        ]);
      }

      const top = bucket.ranking[0];
      return el('div.card', [
        el('div.spread', { style: { marginBottom: '10px' } }, [
          el('div', [
            el('b', p.label),
            el('div.tiny.dim', { style: { marginTop: '2px' } }, `${bucket.total}公演が対象`),
          ]),
          el('div', { style: { textAlign: 'right' } }, [
            el('div', { style: { fontSize: '13px', fontWeight: 700, color: 'var(--accent)' } }, top.name),
            el('div.tiny.dim', countRate(top.count, top.total)),
          ]),
        ]),
        rankList(bucket.ranking, { max: 6 }),
        bucket.ranking.length > 6
          ? el('div.tiny.dim', { style: { marginTop: '6px' } }, `ほか ${bucket.ranking.length - 6}曲`)
          : null,
      ]);
    })),
    el('div.tiny.dim', { style: { marginTop: '8px', lineHeight: '1.7' } },
      'アンコールが無い公演は、アンコール系の分母から除いています（全公演を分母にすると確率が実態より低く出るため）。'),
  ]);
}

/* =========================================================
   2. 曲のつながり
   ========================================================= */

function transitionSection(setlists, opts) {
  const tstats = transitionStats(setlists, opts);
  const songs = songStats(setlists, opts);

  // 初期選択は最も多く演奏された曲
  if (!selectedSongKey || !tstats.pairs.has(selectedSongKey)) {
    selectedSongKey = songs.find((s) => tstats.pairs.has(s.key))?.key || null;
  }

  const blocks = findFixedBlocks(tstats, opts);
  const detail = el('div');

  const chips = new Map(); // songKey -> ボタン要素
  const chipRow = el('div.row.tight', songs.slice(0, 30).map((s) => {
    const btn = el('button.chip', {
      onclick: () => {
        selectedSongKey = s.key;
        for (const [k, b] of chips) b.classList.toggle('on', k === selectedSongKey);
        renderDetail();
      },
    }, s.name);
    chips.set(s.key, btn);
    return btn;
  }));

  const renderDetail = () => {
    const succ = selectedSongKey ? successorsOf(tstats, selectedSongKey) : [];
    const name = tstats.names.get(selectedSongKey) || '';

    detail.replaceChildren(
      succ.length
        ? el('div.card', [
            el('div.small.muted', { style: { marginBottom: '9px' } }, [
              el('b', { style: { color: 'var(--text)' } }, `「${name}」`),
              ' の次に来た曲',
            ]),
            rankList(succ, { max: 8 }),
            el('div.tiny.dim', { style: { marginTop: '8px' } },
              `分母は「${name}」の後ろに別の曲が続いた ${succ[0].total} 回です。`),
          ])
        : el('div.card', [el('div.small.dim', 'この曲の次に演奏された曲のデータがありません（常に最後の曲だった可能性があります）。')])
    );
  };

  chips.get(selectedSongKey)?.classList.add('on');
  renderDetail();

  return el('div.section', [
    el('h2', '曲のつながり'),

    el('div.card', { style: { marginBottom: '9px' } }, [
      el('div.small.muted', { style: { marginBottom: '8px' } }, '曲を選ぶと、その次に来やすい曲が出ます。'),
      chipRow,
    ]),
    detail,

    /* --- 定番ブロック --- */
    el('div', { style: { marginTop: '14px' } }, [
      el('h2', [
        'ほぼ固定の流れ',
        el('span.count', `${blocks.length}件`),
      ]),
      blocks.length
        ? el('div.stack', blocks.map((b) => el('div.card', [
            el('div.block-chain', b.songs.flatMap((s, i) => {
              const out = [];
              if (i > 0) {
                out.push(el('span.arrow', '▶'));
                out.push(el('span.rate', `${b.links[i - 1].count}/${b.links[i - 1].total}`));
              }
              out.push(el('span.s', s.name));
              return out;
            })),
            el('div.tiny.dim', { style: { marginTop: '7px' } },
              `${b.length}曲連続 ・ 最も弱いつながりでも ${pct(b.minRate)}`),
          ])))
        : el('div.card', [
            el('div.small.dim', [
              '固定の流れは見つかりませんでした。',
              el('div', { style: { marginTop: '4px' } },
                `判定条件は「次の曲に進む確率が ${pct(store.getSettings().blockThreshold)} 以上、かつ ${store.getSettings().minTransitionCount} 回以上」です。設定画面で変更できます。`),
            ]),
        ]),
      blocks.length ? el('div.tiny.dim', { style: { marginTop: '8px', lineHeight: '1.7' } },
        '「2回中2回だから100%」のような回数の少ない並びは、偶然と区別がつかないため除いています（信頼区間の下限が5割を超えるものだけを採用）。') : null,
    ]),
  ]);
}

/* =========================================================
   3. 感情の起伏
   ========================================================= */

function arcSection(setlists, opts) {
  const resolve = makeIntensityResolver();
  const arcs = setlists.map((sl) => {
    const arc = arcOf(sl, resolve, opts);
    return { sl, arc, cls: classifyArc(arc.points, arc.coverage) };
  });

  const usable = arcs.filter((a) => a.cls.pattern !== 'unknown');
  if (!usable.length) {
    return el('div.section', [
      el('h2', 'セットリストの感情の起伏'),
      el('div.notice.warn', [
        el('b', '楽曲の特徴量がまだありません。'),
        ' 起伏を出すには、曲ごとの「激しさ」が必要です。',
        el('div', { style: { marginTop: '9px' } }, [
          el('button.btn.sm.primary', { onclick: () => go('songs') }, '楽曲画面で解析する'),
        ]),
      ]),
    ]);
  }

  // パターンの内訳
  const tally = new Map();
  for (const a of usable) {
    const e = tally.get(a.cls.pattern);
    if (e) e.count += 1;
    else tally.set(a.cls.pattern, { pattern: a.cls.pattern, label: a.cls.label, count: 1 });
  }
  const patterns = [...tally.values()].sort((a, b) => b.count - a.count);

  // 代表として最も新しい公演を大きく描く
  const rep = usable[0];

  return el('div.section', [
    el('h2', [
      'セットリストの感情の起伏',
      el('span.count', `${usable.length}公演を判定`),
    ]),

    el('div.card', { style: { marginBottom: '9px' } }, [
      el('div.small.muted', { style: { marginBottom: '9px' } }, 'このスコープでの構成タイプの内訳'),
      rankList(patterns.map((p) => ({
        name: p.label, count: p.count, total: usable.length, rate: p.count / usable.length,
      })), { max: 6 }),
    ]),

    el('div.chart-wrap', [
      el('div.small.muted', { style: { marginBottom: '8px' } }, [
        el('b', { style: { color: 'var(--text)' } }, `${formatDate(rep.sl.date)} ${rep.sl.venue || ''}`),
        el('span', { style: { color: 'var(--accent)', marginLeft: '8px' } }, rep.cls.label),
      ]),
      arcChart(rep.arc.points, { zones: rep.cls.zones, height: 230 }),
      el('div.small.muted', { style: { marginTop: '10px', lineHeight: '1.75' } }, rep.cls.description),
    ]),

    el('details.fold', { style: { marginTop: '9px' } }, [
      el('summary', `公演ごとの判定を見る（${usable.length}件）`),
      el('table.tbl', [
        el('thead', el('tr', [
          el('th', '公演'),
          el('th', { style: { width: '108px' } }, 'タイプ'),
          el('th', { style: { width: '58px' } }, '曲数'),
        ])),
        el('tbody', usable.map((a) => el('tr', [
          el('td', [
            el('div.small', formatDate(a.sl.date).slice(5)),
            el('div.tiny.dim', a.sl.venue || ''),
          ]),
          el('td', el('span', { style: { color: 'var(--accent)', fontSize: '12px', fontWeight: 700 } }, a.cls.label)),
          el('td.num', String(a.arc.points.length)),
        ]))),
      ]),
    ]),

    el('div.tiny.dim', { style: { marginTop: '8px', lineHeight: '1.75' } },
      'タイプ判定は「連（ラン）検定」によるものです。曲の激しさを中央値で上下に分け、同じ側が続く回数が偶然の並びより少なければゾーン分離型、多ければ交互型と判定します。'),
  ]);
}

/* =========================================================
   曲ごとの一覧
   ========================================================= */

function songTable(setlists, opts) {
  const stats = songStats(setlists, opts);
  const resolve = makeIntensityResolver();

  return el('div.section', [
    el('h2', [
      '曲ごとの披露率',
      el('span.count', `${stats.length}曲`),
    ]),
    el('div.card', [
      el('table.tbl', [
        el('thead', el('tr', [
          el('th', '曲名'),
          el('th', { style: { width: '78px' } }, '披露'),
          el('th', { style: { width: '116px' } }, '登場位置'),
          el('th.nowrap', { style: { width: '56px' } }, '激しさ'),
        ])),
        el('tbody', stats.map((s) => el('tr', [
          el('td', el('span.ellipsis', { style: { display: 'block' }, title: s.name }, s.name)),
          el('td.num', { title: countRate(s.count, s.total) }, `${s.count}/${s.total}`),
          el('td', positionStrip(s.positions, { width: 116, height: 9 })),
          el('td.num', (() => {
            const v = resolve(s.name, s.key);
            return Number.isFinite(v) ? String(Math.round(v)) : '—';
          })()),
        ]))),
      ]),
    ]),
  ]);
}
