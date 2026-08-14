/* =========================================================
   Setlist Lab — 比較画面
   複数公演のセトリを横並びにして、共通曲とその日だけの曲を見る
   ========================================================= */

import { el, empty, toast, countRate } from '../ui.js';
import { formatDate } from '../normalize.js';
import { compareSetlists, songStats, arcOf, classifyArc } from '../analyze.js';
import { makeIntensityResolver } from '../features.js';
import { arcChart, positionStrip, intensityBar } from '../charts.js';
import * as store from '../store.js';
import { state, render, currentArtist, currentSetlists, scopedSetlists, scopeLabel, analysisOpts } from '../main.js';
import { scopeBar } from './scope-bar.js';
import { openSetlistModal } from './setlist-view.js';

const SERIES_COLORS = ['#ffb020', '#4cc9f0', '#7c6cff', '#3ddc97', '#ff5470', '#ff9f45'];

export function renderCompare() {
  const view = el('div.view');
  const artist = currentArtist();

  view.appendChild(el('div.view-head', [
    el('h1', '比較'),
    el('p', '公演を選ぶとセットリストを横に並べます。全公演で披露された曲と、その日だけの曲が色で分かれます。'),
  ]));

  if (!artist) {
    view.appendChild(empty('🎤', 'アーティストが登録されていません。'));
    return view;
  }

  const all = currentSetlists();
  if (!all.length) {
    view.appendChild(empty('🎫', '公演がありません。', '「公演」画面から取り込んでください。'));
    return view;
  }

  view.appendChild(scopeBar());

  const scoped = scopedSetlists();
  const selected = scoped.filter((s) => state.compareIds.includes(s.id));

  /* --- 公演の選択 --- */
  view.appendChild(el('div.section', [
    el('h2', [
      '比較する公演を選ぶ',
      el('span.count', `${selected.length}件選択中`),
      selected.length ? el('button.btn.sm.ghost', {
        style: { marginLeft: 'auto' },
        onclick: () => { state.compareIds = []; render(); },
      }, '選択を解除') : null,
    ]),
    el('div.row.tight', scoped.slice(0, 40).map((s) => {
      const on = state.compareIds.includes(s.id);
      return el(`button.chip${on ? '.on' : ''}`, {
        onclick: () => {
          if (on) state.compareIds = state.compareIds.filter((id) => id !== s.id);
          else if (state.compareIds.length >= 6) { toast('比較は6公演までです'); return; }
          else state.compareIds = [...state.compareIds, s.id];
          render();
        },
      }, [
        formatDate(s.date).slice(5),
        el('span', { style: { opacity: .7, fontWeight: 400 } }, s.venue || ''),
      ]);
    })),
    scoped.length > 40 ? el('div.tiny.dim', { style: { marginTop: '7px' } },
      `※ 直近40公演を表示しています（該当${scoped.length}公演）。ツアーで絞り込むと選びやすくなります。`) : null,
  ]));

  if (!selected.length) {
    view.appendChild(el('div.section', [tourSummary(scoped)]));
    return view;
  }

  /* --- 横並び比較 --- */
  const { columns } = compareSetlists(selected, analysisOpts());
  const commonCount = columns[0]
    ? columns[0].songs.filter((s) => s.isCommon).length
    : 0;

  view.appendChild(el('div.section', [
    el('h2', [
      'セットリスト比較',
      el('span.count', selected.length > 1 ? `共通 ${commonCount}曲` : ''),
    ]),
    el('div.compare-scroll', [
      el('div.compare-grid', columns.map((col, ci) => compareColumn(col, ci, selected.length))),
    ]),
    selected.length > 1 ? el('div.legend', [
      el('span', [el('i', { style: { background: 'var(--accent)' } }), 'その日だけの曲']),
      el('span', [el('i', { style: { background: 'var(--card-hi)' } }), '複数公演で披露']),
    ]) : null,
  ]));

  /* --- 起伏の重ね合わせ --- */
  view.appendChild(arcOverlay(selected));

  /* --- 選択公演の披露曲サマリ --- */
  view.appendChild(el('div.section', [tourSummary(selected, '選択した公演の披露曲')]));

  return view;
}

/* ---------------------------------------------------------
   1公演分の列
   --------------------------------------------------------- */

function compareColumn(col, index, total) {
  const sl = col.setlist;
  const resolve = makeIntensityResolver();
  const attended = store.isAttended(sl.id);

  const rows = [];
  let lastEncore = null;
  col.songs.forEach((song, i) => {
    if (song.encore !== lastEncore) {
      rows.push(el('div.set-label', song.encore > 0 ? `アンコール${song.encore > 1 ? song.encore : ''}` : '本編'));
      lastEncore = song.encore;
    }
    const cls = total > 1 ? (song.isUnique ? '.uniq' : song.isCommon ? '.common' : '') : '';
    rows.push(el(`div.song${cls}`, [
      el('span.num', String(i + 1)),
      el('span.title', { title: song.name }, song.name),
      intensityBar(resolve(song.name, song.key)),
    ]));
  });

  return el('div.compare-col', [
    el('header', [
      el('b', formatDate(sl.date).slice(5)),
      el('span', sl.venue || '会場不明'),
      el('div.row.tight', { style: { marginTop: '5px' } }, [
        attended ? el('span.pill.attended', '参加') : null,
        sl.source === 'manual' ? el('span.pill.manual', '手動') : null,
        el('button.btn.sm.ghost', {
          style: { marginLeft: 'auto', padding: '2px 7px', fontSize: '11px' },
          onclick: () => openSetlistModal(sl, { onChange: render }),
        }, '詳細'),
      ]),
    ]),
    el('div.setlist', rows),
  ]);
}

/* ---------------------------------------------------------
   起伏の重ね合わせ
   --------------------------------------------------------- */

function arcOverlay(setlists) {
  const resolve = makeIntensityResolver();
  const arcs = setlists.map((sl) => ({ sl, arc: arcOf(sl, resolve, analysisOpts()) }));
  const usable = arcs.filter((a) => a.arc.points.filter((p) => Number.isFinite(p.intensity)).length >= 6);

  if (!usable.length) {
    return el('div.section', [
      el('h2', '感情の起伏の比較'),
      el('div.notice', [
        '選んだ公演の曲に特徴量がまだありません。',
        el('span.dim', '「楽曲」画面で解析すると、ここに起伏の比較が出ます。'),
      ]),
    ]);
  }

  const base = usable[0];
  const cls = classifyArc(base.arc.points, base.arc.coverage);

  return el('div.section', [
    el('h2', '感情の起伏の比較'),
    el('div.chart-wrap', [
      arcChart(base.arc.points, {
        zones: cls.zones,
        height: 230,
        compareSeries: usable.slice(1).map((u, i) => ({
          points: u.arc.points,
          color: SERIES_COLORS[(i + 1) % SERIES_COLORS.length],
        })),
      }),
      el('div.legend', usable.map((u, i) =>
        el('span', [
          el('i', { style: { background: SERIES_COLORS[i % SERIES_COLORS.length] } }),
          `${formatDate(u.sl.date).slice(5)} ${u.sl.venue || ''}`,
          i === 0 ? el('span.dim', '（実線）') : null,
        ])
      )),
    ]),
    el('div.stack', { style: { marginTop: '10px' } }, usable.map((u) => {
      const c = classifyArc(u.arc.points, u.arc.coverage);
      return el('div.card', [
        el('div.small', [
          el('b', `${formatDate(u.sl.date).slice(5)} ${u.sl.venue || ''}`),
          ' — ',
          el('span', { style: { color: 'var(--accent)' } }, c.label),
        ]),
        el('div.tiny.muted', { style: { marginTop: '5px', lineHeight: '1.75' } }, c.description),
      ]);
    })),
  ]);
}

/* ---------------------------------------------------------
   披露曲サマリ
   --------------------------------------------------------- */

function tourSummary(setlists, title = '披露曲サマリ') {
  if (!setlists.length) return el('div');

  const stats = songStats(setlists, analysisOpts());
  const resolve = makeIntensityResolver();

  return el('div', [
    el('h2', [
      title,
      el('span.count', `${stats.length}曲 / ${setlists.length}公演（${scopeLabel()}）`),
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
          el('td', [
            el('span.ellipsis', { style: { display: 'block', maxWidth: '100%' }, title: s.name }, s.name),
            s.encoreCount ? el('span.tiny.dim', `アンコール ${s.encoreCount}回`) : null,
          ]),
          el('td.num', { title: countRate(s.count, s.total) }, `${s.count}/${s.total}`),
          el('td', positionStrip(s.positions, { width: 120, height: 9 })),
          el('td.num', (() => {
            const v = resolve(s.name, s.key);
            return Number.isFinite(v) ? String(Math.round(v)) : '—';
          })()),
        ]))),
      ]),
    ]),
    el('div.tiny.dim', { style: { marginTop: '7px', lineHeight: '1.7' } },
      '登場位置は「開演直後（左端）〜終演（右端）」のどのあたりで演奏されたかの分布です。色が濃いほどその位置での回数が多いことを示します。'),
  ]);
}
