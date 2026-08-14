/* =========================================================
   Setlist Lab — SVG グラフ
   ---------------------------------------------------------
   外部ライブラリは使わない。
   コンテナの実寸を測って 1:1 の座標で描くので、スマホの狭い画面でも
   文字が潰れず、点が楕円にならない。
   ========================================================= */

import { svg, el, clear, intensityColor } from './ui.js';

const PAD = { top: 14, right: 12, bottom: 28, left: 28 };

/**
 * 幅をコンテナの実寸に合わせて描き直すラッパー。
 *
 * viewBox を固定して CSS で伸縮させると、スマホの狭い画面では
 * 横だけが圧縮されて文字が潰れ、点が楕円になる。
 * 実寸を測って 1:1 で描けば、どの幅でも文字は文字の大きさのまま出る。
 *
 * @param {(width:number) => SVGElement} build
 */
export function responsive(build, { minWidth = 260 } = {}) {
  const wrap = el('div', { style: { width: '100%' } });
  let lastWidth = 0;

  const draw = () => {
    const w = Math.max(minWidth, Math.round(wrap.clientWidth || 0));
    if (!w || w === lastWidth) return;
    lastWidth = w;
    clear(wrap);
    wrap.appendChild(build(w));
  };

  // 挿入前は clientWidth が 0 なので、次のフレームで測ってから描く
  requestAnimationFrame(() => {
    draw();
    if (typeof ResizeObserver !== 'undefined') {
      new ResizeObserver(() => draw()).observe(wrap);
    }
  });

  return wrap;
}

/**
 * セトリの起伏（激しさの推移）を描く。
 * @param {Array} points arcOf() の points: { name, intensity, encore }
 * @param {object} opts { zones, height, compareSeries }
 */
export function arcChart(points, opts = {}) {
  return responsive((width) => buildArc(points, width, opts));
}

function buildArc(points, W, opts = {}) {
  const { zones = [], compareSeries = [] } = opts;
  const H = opts.height || 220;
  const plotW = W - PAD.left - PAD.right;
  const plotH = H - PAD.top - PAD.bottom;

  const xAt = (i, n) => PAD.left + (n <= 1 ? plotW / 2 : (i / (n - 1)) * plotW);
  const yAt = (v) => PAD.top + plotH - (Math.max(0, Math.min(100, v)) / 100) * plotH;

  const linePath = (pts) => {
    const n = pts.length;
    const coords = pts
      .map((p, i) => (Number.isFinite(p.intensity) ? `${xAt(i, n).toFixed(1)},${yAt(p.intensity).toFixed(1)}` : null))
      .filter(Boolean);
    return coords.length < 2 ? '' : `M${coords.join('L')}`;
  };

  const areaPath = (pts) => {
    const line = linePath(pts);
    if (!line) return '';
    const n = pts.length;
    const known = pts.map((p, i) => [i, p.intensity]).filter(([, v]) => Number.isFinite(v));
    const first = xAt(known[0][0], n);
    const last = xAt(known[known.length - 1][0], n);
    const base = PAD.top + plotH;
    return `${line}L${last.toFixed(1)},${base}L${first.toFixed(1)},${base}Z`;
  };

  const n = points.length;
  const kids = [];
  // 同一ページに複数のグラフが出るので、グラデーションIDは衝突しないよう毎回変える
  const gradId = `arcFill-${Math.random().toString(36).slice(2, 9)}`;

  /* --- 目盛り --- */
  for (const v of [0, 25, 50, 75, 100]) {
    const y = yAt(v);
    kids.push(svg('line', {
      x1: PAD.left, x2: W - PAD.right, y1: y, y2: y,
      stroke: 'rgba(255,255,255,.07)', 'stroke-width': 1,
    }));
    kids.push(svg('text', {
      x: PAD.left - 6, y: y + 3.5, 'text-anchor': 'end',
      fill: '#6c6c84', 'font-size': 10,
    }, String(v)));
  }

  /* --- ゾーンの帯 --- */
  for (const z of zones) {
    const x1 = xAt(z.from, n);
    const x2 = xAt(z.to, n);
    kids.push(svg('rect', {
      x: x1 - 5, y: PAD.top, width: Math.max(10, x2 - x1 + 10), height: plotH,
      fill: z.type === 'ballad' ? 'rgba(76,201,240,.10)' : 'rgba(255,84,112,.10)',
      rx: 5,
    }));
    kids.push(svg('text', {
      x: (x1 + x2) / 2, y: PAD.top + 11, 'text-anchor': 'middle',
      fill: z.type === 'ballad' ? '#4cc9f0' : '#ff5470',
      'font-size': 10, 'font-weight': 700,
    }, z.type === 'ballad' ? 'バラード' : '激しい曲'));
  }

  /* --- アンコール境界 --- */
  for (let i = 1; i < n; i++) {
    if (points[i].encore !== points[i - 1].encore) {
      const x = (xAt(i - 1, n) + xAt(i, n)) / 2;
      kids.push(svg('line', {
        x1: x, x2: x, y1: PAD.top, y2: PAD.top + plotH,
        stroke: '#7c6cff', 'stroke-width': 1.5, 'stroke-dasharray': '4 3', opacity: .75,
      }));
      kids.push(svg('text', {
        x: x + 4, y: PAD.top + plotH - 4, fill: '#7c6cff', 'font-size': 10, 'font-weight': 700,
      }, 'アンコール'));
    }
  }

  /* --- 比較用に重ねる系列（薄く） --- */
  for (const series of compareSeries) {
    const path = linePath(series.points);
    if (path) {
      kids.push(svg('path', {
        d: path, fill: 'none', stroke: series.color || '#6c6c84',
        'stroke-width': 1.5, opacity: .4, 'stroke-linejoin': 'round',
      }));
    }
  }

  /* --- 本体（面＋線） --- */
  const area = areaPath(points);
  if (area) {
    kids.push(svg('defs', {}, [
      svg('linearGradient', { id: gradId, x1: '0', y1: '0', x2: '0', y2: '1' }, [
        svg('stop', { offset: '0%', 'stop-color': '#ffb020', 'stop-opacity': .30 }),
        svg('stop', { offset: '100%', 'stop-color': '#ffb020', 'stop-opacity': .02 }),
      ]),
    ]));
    kids.push(svg('path', { d: area, fill: `url(#${gradId})` }));
  }

  const line = linePath(points);
  if (line) {
    kids.push(svg('path', {
      d: line, fill: 'none', stroke: '#ffb020', 'stroke-width': 2,
      'stroke-linejoin': 'round', 'stroke-linecap': 'round',
    }));
  }

  /* --- 各曲の点 --- */
  points.forEach((p, i) => {
    if (!Number.isFinite(p.intensity)) {
      // 特徴量が未取得の曲は、線を欠かさず「不明」と分かるよう中央に白抜きで置く
      kids.push(svg('circle', {
        cx: xAt(i, n), cy: yAt(50), r: 3,
        fill: '#0a0a12', stroke: '#4a4a60', 'stroke-width': 1.5,
      }, [svg('title', {}, `${p.name}（特徴量なし）`)]));
      return;
    }
    kids.push(svg('circle', {
      cx: xAt(i, n), cy: yAt(p.intensity), r: 3.8,
      fill: intensityColor(p.intensity), stroke: '#0a0a12', 'stroke-width': 1.5,
    }, [svg('title', {}, `${i + 1}. ${p.name} — 激しさ ${Math.round(p.intensity)}`)]));
  });

  /* --- x軸の曲番号（幅に対して混まない範囲で間引く） --- */
  const perLabel = plotW / Math.max(1, n);
  const step = perLabel >= 22 ? 1 : perLabel >= 12 ? 2 : perLabel >= 7 ? 4 : 5;
  points.forEach((p, i) => {
    if (i % step !== 0 && i !== n - 1) return;
    kids.push(svg('text', {
      x: xAt(i, n), y: H - 9, 'text-anchor': 'middle', fill: '#6c6c84', 'font-size': 10,
    }, String(i + 1)));
  });

  return svg('svg.chart', {
    viewBox: `0 0 ${W} ${H}`, width: W, height: H, role: 'img',
    'aria-label': 'セットリストの激しさの推移',
  }, kids);
}

/* =========================================================
   曲の登場位置の分布（ヒートマップ帯）
   ========================================================= */

/**
 * その曲がセトリのどのあたりで演奏されがちかを1本の帯で示す。
 * @param {number[]} positions 0(開演)〜1(終演) の配列
 */
export function positionStrip(positions, { bins = 12, width = 120, height = 10 } = {}) {
  const hist = new Array(bins).fill(0);
  for (const p of positions) {
    const i = Math.min(bins - 1, Math.max(0, Math.floor(p * bins)));
    hist[i] += 1;
  }
  const max = Math.max(1, ...hist);
  const bw = width / bins;

  const rects = hist.map((c, i) =>
    svg('rect', {
      x: (i * bw).toFixed(2), y: 0, width: (bw - 0.6).toFixed(2), height,
      rx: 1.5, fill: '#ffb020', opacity: (0.12 + 0.88 * (c / max)).toFixed(3),
    }, [svg('title', {}, `${Math.round((i / bins) * 100)}〜${Math.round(((i + 1) / bins) * 100)}% の位置: ${c}回`)])
  );

  return svg('svg', {
    viewBox: `0 0 ${width} ${height}`, width, height,
    style: 'display:block;flex:none', role: 'img', 'aria-label': '登場位置の分布',
  }, rects);
}

/* =========================================================
   ランキングの横棒
   ========================================================= */

/**
 * @param {Array} rows { name, count, total, rate }
 */
export function rankList(rows, { max = 8, showBar = true } = {}) {
  const top = rows.slice(0, max);
  const peak = Math.max(...top.map((r) => r.rate), 0.0001);

  return el('div.rank', top.map((r) =>
    el('div.rank-row', [
      el('span.name', { title: r.name }, r.name),
      showBar ? el('span.track', [
        el('i', { style: { width: `${(r.rate / peak) * 100}%` } }),
      ]) : null,
      el('span.val', [
        el('b', `${r.count}`),
        `/${r.total} `,
        `(${Math.round(r.rate * 100)}%)`,
      ]),
    ])
  ));
}

/* =========================================================
   曲ごとの激しさバー（セトリ表示の行に添える小さいやつ）
   ========================================================= */

export function intensityBar(v) {
  if (!Number.isFinite(v)) {
    return el('span.bar', { title: '特徴量なし' });
  }
  return el('span.bar', { title: `激しさ ${Math.round(v)}` }, [
    el('i', { style: { width: `${Math.max(4, v)}%`, background: intensityColor(v) } }),
  ]);
}
