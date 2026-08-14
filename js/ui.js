/* =========================================================
   Setlist Lab — DOM ヘルパー
   ---------------------------------------------------------
   文字列 HTML の組み立ては使わない（曲名や会場名が外部由来のため、
   innerHTML に流し込むとそのまま埋め込み事故になる）。
   要素は必ず el() で組み、テキストは textContent で入れる。
   ========================================================= */

/**
 * 要素を組み立てる。
 *   el('div.card', { onclick }, [ el('b', 'タイトル'), '本文' ])
 * タグ名には .class と #id を書ける。
 */
export function el(spec, props, children) {
  // props を省いて子だけ渡された場合を吸収
  if (props !== undefined && (Array.isArray(props) || typeof props === 'string' || typeof props === 'number' || props instanceof Node)) {
    children = props;
    props = null;
  }

  const m = String(spec).match(/^([a-zA-Z0-9]+)?((?:[.#][\w-]+)*)$/);
  const tag = (m && m[1]) || 'div';
  const node = document.createElement(tag);

  if (m && m[2]) {
    for (const token of m[2].match(/[.#][\w-]+/g) || []) {
      if (token[0] === '.') node.classList.add(token.slice(1));
      else node.id = token.slice(1);
    }
  }

  if (props) {
    for (const [k, v] of Object.entries(props)) {
      if (v === null || v === undefined || v === false) continue;
      if (k === 'class') node.className = node.className ? `${node.className} ${v}` : v;
      else if (k === 'style' && typeof v === 'object') Object.assign(node.style, v);
      else if (k === 'dataset') Object.assign(node.dataset, v);
      else if (k.startsWith('on') && typeof v === 'function') node.addEventListener(k.slice(2), v);
      else if (k === 'html') node.innerHTML = v; // 自前の定数SVGだけに使う
      else if (k in node && k !== 'list') node[k] = v;
      else node.setAttribute(k, v === true ? '' : v);
    }
  }

  append(node, children);
  return node;
}

export function append(node, children) {
  if (children === null || children === undefined || children === false) return node;
  if (Array.isArray(children)) {
    for (const c of children) append(node, c);
    return node;
  }
  node.appendChild(children instanceof Node ? children : document.createTextNode(String(children)));
  return node;
}

export function clear(node) {
  while (node.firstChild) node.removeChild(node.firstChild);
  return node;
}

/**
 * SVG 用（名前空間が必要）。
 * el() と同じく 'svg.chart' のように .class を書ける。
 * SVG 要素は className が読み取り専用なので setAttribute で入れる。
 */
export function svg(spec, props, children) {
  const m = String(spec).match(/^([a-zA-Z][a-zA-Z0-9]*)((?:\.[\w-]+)*)$/);
  const tag = (m && m[1]) || spec;
  const node = document.createElementNS('http://www.w3.org/2000/svg', tag);

  if (m && m[2]) {
    node.setAttribute('class', m[2].split('.').filter(Boolean).join(' '));
  }

  if (props) {
    for (const [k, v] of Object.entries(props)) {
      if (v === null || v === undefined || v === false) continue;
      if (k.startsWith('on') && typeof v === 'function') node.addEventListener(k.slice(2), v);
      else node.setAttribute(k, v);
    }
  }
  if (children !== undefined) {
    for (const c of [].concat(children)) {
      if (c === null || c === undefined || c === false) continue;
      node.appendChild(c instanceof Node ? c : document.createTextNode(String(c)));
    }
  }
  return node;
}

/* ---------------- トースト ---------------- */

let toastNode = null;
let toastTimer = 0;

export function toast(message, { error = false, ms = 2600 } = {}) {
  if (!toastNode) {
    toastNode = el('div.toast');
    document.body.appendChild(toastNode);
  }
  toastNode.textContent = message;
  toastNode.classList.toggle('err', !!error);
  toastNode.classList.add('show');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => toastNode.classList.remove('show'), ms);
}

/* ---------------- モーダル ---------------- */

/**
 * @returns {{ close:Function, body:HTMLElement }}
 */
export function modal(title, buildBody, { onClose } = {}) {
  const body = el('div');
  const bg = el('div.modal-bg');
  const close = () => {
    bg.remove();
    document.removeEventListener('keydown', onKey);
    onClose?.();
  };
  const onKey = (e) => { if (e.key === 'Escape') close(); };

  const box = el('div.modal', [
    el('header', [
      el('h3', title),
      el('button.x', { onclick: close, 'aria-label': '閉じる' }, '✕'),
    ]),
    body,
  ]);

  bg.appendChild(box);
  bg.addEventListener('click', (e) => { if (e.target === bg) close(); });
  document.addEventListener('keydown', onKey);
  document.body.appendChild(bg);

  buildBody?.(body, close);
  return { close, body };
}

/** 確認ダイアログ。Promise<boolean> を返す。 */
export function confirmDialog(title, message, { okLabel = 'OK', danger = false } = {}) {
  return new Promise((resolve) => {
    let settled = false;
    const done = (v) => { if (!settled) { settled = true; resolve(v); } };

    const { close } = modal(title, (body) => {
      append(body, [
        el('p.small.muted', { style: { margin: '0 0 16px', lineHeight: '1.8' } }, message),
        el('div.row', { style: { justifyContent: 'flex-end' } }, [
          el('button.btn.ghost', { onclick: () => { done(false); close(); } }, 'キャンセル'),
          el(`button.btn${danger ? '.danger' : '.primary'}`, { onclick: () => { done(true); close(); } }, okLabel),
        ]),
      ]);
    }, { onClose: () => done(false) });
  });
}

/* ---------------- 表示フォーマット ---------------- */

/** 0.75 → "75%" */
export function pct(rate, digits = 0) {
  return `${(rate * 100).toFixed(digits)}%`;
}

/**
 * 確率は必ず分母とセットで出す。
 * n が小さいときに割合だけ見せると「1公演中1回=100%」を強い傾向と
 * 読み違えてしまうため、この形を全画面で共通にする。
 */
export function countRate(count, total) {
  if (!total) return '—';
  return `${count}/${total}公演 (${pct(count / total)})`;
}

export function bytes(n) {
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
  return `${(n / 1024 / 1024).toFixed(2)} MB`;
}

/** 激しさスコア(0-100) に応じた色。青(静か) → 赤(激しい)。 */
export function intensityColor(v) {
  if (!Number.isFinite(v)) return '#3a3a4e';
  const t = Math.max(0, Math.min(100, v)) / 100;
  // 200°(青) → 0°(赤) へ、彩度・明度はほぼ一定にして高さの比較を邪魔しない
  const hue = 205 - 205 * t;
  return `hsl(${hue.toFixed(0)} 72% 58%)`;
}

/** 空状態の共通表示 */
export function empty(icon, ...lines) {
  return el('div.empty', [
    el('span.big', icon),
    ...lines.map((l) => el('div', l)),
  ]);
}

/** ラベル付きの入力欄 */
export function field(label, input) {
  return el('div.field', [el('label', label), input]);
}

/** debounce */
export function debounce(fn, ms = 300) {
  let t = 0;
  return (...args) => {
    clearTimeout(t);
    t = setTimeout(() => fn(...args), ms);
  };
}
