/* =========================================================
   Setlist Lab — 分析スコープの切り替えバー
   ツアー単位 / 全期間 / 参加した公演のみ を1箇所で切り替える。
   比較・分析・マイセトリで共通して使う。
   ========================================================= */

import { el } from '../ui.js';
import * as store from '../store.js';
import { state, render, currentSetlists, tourList, scopedSetlists } from '../main.js';

export function scopeBar({ compact = false } = {}) {
  const all = currentSetlists();
  const attended = all.filter((s) => store.isAttended(s.id)).length;
  const tours = tourList();
  const scoped = scopedSetlists();

  const chip = (value, label, count) => el(`button.chip${state.tour === value ? '.on' : ''}`, {
    onclick: () => { state.tour = value; render(); },
  }, [label, count !== undefined ? el('span', { style: { opacity: .7 } }, ` ${count}`) : null]);

  return el('div.section', [
    !compact ? el('h2', [
      '分析対象',
      el('span.count', `${scoped.length}公演`),
    ]) : null,
    el('div.row.tight', [
      chip('__all__', '全期間', all.length),
      attended ? chip('__attended__', '参加した公演のみ', attended) : null,
      ...tours.map((t) => chip(t.tour, t.tour || 'ツアー名なし', t.count)),
    ]),
    scoped.length < 3 ? el('div.notice.warn', { style: { marginTop: '10px' } }, [
      el('b', `対象が${scoped.length}公演しかありません。`),
      ' 傾向としては読み取れないため、確率は参考程度に見てください。',
    ]) : null,
  ]);
}
