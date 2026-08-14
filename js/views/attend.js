/* =========================================================
   Setlist Lab — 参加記録
   参加した公演の一覧・記録の編集・「自分が見た曲」の集計
   ========================================================= */

import { el, empty, countRate } from '../ui.js';
import { formatDate, flattenSongs } from '../normalize.js';
import { songStats } from '../analyze.js';
import { positionStrip } from '../charts.js';
import * as store from '../store.js';
import { state, render, go, currentArtist, currentSetlists, analysisOpts } from '../main.js';
import { showRow, openSetlistModal, openAttendEditor } from './setlist-view.js';
import { openManualEditor } from './manual-editor.js';

export function renderAttend() {
  const view = el('div.view');
  const artist = currentArtist();

  view.appendChild(el('div.view-head', [
    el('h1', '参加記録'),
    el('p', '参加した公演に印を付けて、座席やメモを残せます。「自分が生で見た曲」も集計します。'),
  ]));

  if (!artist) {
    view.appendChild(empty('🎤', 'アーティストが登録されていません。'));
    return view;
  }

  const all = currentSetlists();
  const attended = all.filter((s) => store.isAttended(s.id));

  // 取得データが期限切れで消えても記録が宙に浮かないよう、控えから復元して並べる
  const orphans = orphanRecords(all);

  /* --- サマリ --- */
  view.appendChild(summary(all, attended));

  if (orphans.length) {
    view.appendChild(el('div.section', [
      el('h2', ['セットリストが手元に無い記録', el('span.count', `${orphans.length}件`)]),
      el('div.notice', { style: { marginBottom: '9px' } },
        '取得したセットリストは一定期間で破棄されるため、この公演のセトリは手元にありません。記録自体は残っています。「公演」画面から再取得すると内容も戻ります。'),
      el('div.stack', orphans.map((o) => el('div.card', [
        el('div.small.muted', formatDate(o.snapshot.date)),
        el('b', { style: { fontSize: '14px' } }, o.snapshot.venue || '会場不明'),
        o.snapshot.tour ? el('div.tiny', { style: { color: 'var(--accent)', marginTop: '2px' } }, o.snapshot.tour) : null,
        (o.seat || o.companions) ? el('div.tiny.muted', { style: { marginTop: '6px' } },
          [o.seat ? `座席: ${o.seat}` : null, o.companions ? `同行: ${o.companions}` : null].filter(Boolean).join(' ・ ')) : null,
        o.memo ? el('div.small', { style: { marginTop: '6px', lineHeight: '1.75', whiteSpace: 'pre-wrap', color: 'var(--muted)' } }, o.memo) : null,
      ]))),
    ]));
  }

  if (!attended.length && !orphans.length) {
    view.appendChild(el('div.section', [
      empty('📝', 'まだ参加記録がありません。',
        '下の一覧から参加した公演を選んで印を付けてください。'),
    ]));
  } else if (attended.length) {
    /* --- 参加した公演 --- */
    view.appendChild(el('div.section', [
      el('h2', ['参加した公演', el('span.count', `${attended.length}公演`)]),
      el('div.stack', attended.map((s) => {
        const rec = store.getAttendanceFor(s.id) || {};
        return el('div.card', [
          el('div.spread', [
            el('div.grow', [
              el('div.small.muted', formatDate(s.date)),
              el('b', { style: { fontSize: '14px' } }, s.venue || '会場不明'),
              s.tour ? el('div.tiny', { style: { color: 'var(--accent)', marginTop: '2px' } }, s.tour) : null,
            ]),
            el('div', { style: { textAlign: 'right', flex: 'none' } }, [
              rec.rating ? el('div', { style: { color: 'var(--accent)', fontSize: '13px' } }, '★'.repeat(rec.rating)) : null,
              el('div.tiny.dim', `${flattenSongs(s, { excludeTape: true }).length}曲`),
            ]),
          ]),
          (rec.seat || rec.companions) ? el('div.tiny.muted', { style: { marginTop: '7px' } }, [
            rec.seat ? `座席: ${rec.seat}` : null,
            rec.seat && rec.companions ? ' ・ ' : null,
            rec.companions ? `同行: ${rec.companions}` : null,
          ]) : null,
          rec.memo ? el('div.small', {
            style: { marginTop: '7px', lineHeight: '1.75', whiteSpace: 'pre-wrap', color: 'var(--muted)' },
          }, rec.memo) : null,
          el('div.row.tight', { style: { marginTop: '9px' } }, [
            el('button.btn.sm.ghost', { onclick: () => openSetlistModal(s, { onChange: render }) }, 'セトリを見る'),
            el('button.btn.sm.ghost', { onclick: () => openAttendEditor(s, render) }, '記録を編集'),
            el('button.btn.sm.ghost', {
              style: { marginLeft: 'auto' },
              onclick: () => { store.setAttendance(s.id, { attended: false }); render(); },
            }, '参加を取り消す'),
          ]),
        ]);
      })),
    ]));

    /* --- 生で見た曲 --- */
    view.appendChild(seenSongs(all, attended));
  }

  /* --- 公演を選んで記録する --- */
  view.appendChild(el('div.section', [
    el('h2', ['公演に参加記録を付ける', el('span.count', `${all.length}公演`)]),
    el('div.row', { style: { marginBottom: '9px' } }, [
      el('button.btn.sm.ghost', {
        onclick: () => openManualEditor(null, { artist, onSaved: render }),
      }, '＋ 一覧に無い公演を手動で追加'),
    ]),
    el('div.stack', all.slice(0, 60).map((s) =>
      showRow(s, {
        selected: store.isAttended(s.id),
        onclick: () => openSetlistModal(s, { onChange: render }),
        trailing: el('span.n', store.isAttended(s.id) ? '参加済' : ''),
      })
    )),
    all.length > 60 ? el('div.tiny.dim', { style: { marginTop: '8px' } },
      `※ 直近60公演を表示しています（全${all.length}公演）。`) : null,
  ]));

  return view;
}

/**
 * 参加記録はあるが、対応するセトリが手元に無いもの。
 * 取得データは期限で破棄されるため、記録の控え（snapshot）から復元する。
 */
function orphanRecords(available) {
  const have = new Set(available.map((s) => s.id));
  return Object.entries(store.getAttendance())
    .filter(([id, rec]) => rec.attended && rec.snapshot && !have.has(id))
    .map(([id, rec]) => ({ id, ...rec }))
    .sort((a, b) => (a.snapshot.date < b.snapshot.date ? 1 : -1));
}

/* ---------------------------------------------------------
   サマリ
   --------------------------------------------------------- */

function summary(all, attended) {
  if (!attended.length) {
    return el('div.card', { style: { marginBottom: '18px' } }, [
      el('div.small.muted', `記録できる公演が ${all.length} 件あります。`),
    ]);
  }

  const years = new Map();
  const venues = new Map();
  for (const s of attended) {
    const y = (s.date || '').slice(0, 4) || '不明';
    years.set(y, (years.get(y) || 0) + 1);
    const v = s.venue || '不明';
    venues.set(v, (venues.get(v) || 0) + 1);
  }
  const topVenue = [...venues.entries()].sort((a, b) => b[1] - a[1])[0];
  const totalSongs = attended.reduce((a, s) => a + flattenSongs(s, { excludeTape: true }).length, 0);

  const stat = (label, value, sub) => el('div', { style: { flex: '1', minWidth: '96px' } }, [
    el('div.tiny.dim', label),
    el('div', { style: { fontSize: '20px', fontWeight: 800, lineHeight: '1.3' } }, value),
    sub ? el('div.tiny.dim', sub) : null,
  ]);

  return el('div.card', { style: { marginBottom: '18px' } }, [
    el('div.row', { style: { gap: '14px' } }, [
      stat('参加公演', `${attended.length}`, `全${all.length}公演中`),
      stat('聴いた曲数', `${totalSongs}`, '延べ'),
      stat('参加年', `${years.size}`, [...years.keys()].sort().join('・')),
      topVenue ? stat('最多の会場', topVenue[0], `${topVenue[1]}回`) : null,
    ]),
  ]);
}

/* ---------------------------------------------------------
   生で見た曲 / まだ見ていない曲
   --------------------------------------------------------- */

function seenSongs(all, attended) {
  const seen = songStats(attended, analysisOpts());
  const seenKeys = new Set(seen.map((s) => s.key));
  const everything = songStats(all, analysisOpts());
  const unseen = everything.filter((s) => !seenKeys.has(s.key));

  return el('div.section', [
    el('h2', [
      '自分が生で見た曲',
      el('span.count', `${seen.length}曲 / このアーティストの${everything.length}曲`),
    ]),
    el('div.card', [
      el('table.tbl', [
        el('thead', el('tr', [
          el('th', '曲名'),
          el('th', { style: { width: '78px' } }, '見た回数'),
          el('th', { style: { width: '124px' } }, '登場位置'),
        ])),
        el('tbody', seen.map((s) => el('tr', [
          el('td', el('span.ellipsis', { style: { display: 'block' }, title: s.name }, s.name)),
          el('td.num', { title: countRate(s.count, s.total) }, `${s.count}/${s.total}`),
          el('td', positionStrip(s.positions, { width: 116, height: 9 })),
        ]))),
      ]),
    ]),

    unseen.length ? el('details.fold', { style: { marginTop: '9px' } }, [
      el('summary', `まだ生で見ていない曲（${unseen.length}曲）`),
      el('div.stack', { style: { gap: '4px' } }, unseen.map((s) =>
        el('div.row', { style: { fontSize: '13px' } }, [
          el('span.grow.ellipsis', { title: s.name }, s.name),
          el('span.tiny.dim.nowrap', `他公演で${s.count}回`),
        ])
      )),
    ]) : null,
  ]);
}
