/* =========================================================
   Setlist Lab — セトリ表示の共通部品
   公演カード / セトリ本体 / 詳細モーダル
   ========================================================= */

import { el, modal, toast, empty, field, confirmDialog } from '../ui.js';
import { intensityBar, arcChart } from '../charts.js';
import { formatDate, flattenSongs, songKey } from '../normalize.js';
import { makeIntensityResolver } from '../features.js';
import { arcOf, classifyArc } from '../analyze.js';
import * as store from '../store.js';

/** 公演1件のボタン行 */
export function showRow(setlist, { selected = false, onclick, trailing } = {}) {
  const n = flattenSongs(setlist, { excludeTape: true }).length;
  const attended = store.isAttended(setlist.id);

  return el(`button.show${selected ? '.sel' : ''}`, { onclick }, [
    el('span.date', formatDate(setlist.date).replace(/^\d{4}\//, '')),
    el('span.meta', [
      el('b', setlist.venue || '会場不明'),
      el('span', [
        setlist.city || '',
        setlist.source === 'manual' ? el('span.pill.manual', { style: { marginLeft: '6px' } }, '手動') : null,
        attended ? el('span.pill.attended', { style: { marginLeft: '6px' } }, '参加') : null,
      ]),
    ]),
    trailing || el('span.n', `${n}曲`),
  ]);
}

/**
 * セトリ本体（本編／アンコールに分けた曲リスト）。
 * @param {object} setlist
 * @param {object} opts { showIntensity, intensityOf, compact }
 */
export function setlistBody(setlist, opts = {}) {
  const { showIntensity = true, intensityOf = null, compact = false } = opts;
  const resolve = intensityOf || makeIntensityResolver();
  const kids = [];
  let n = 0;

  for (const set of setlist.sets) {
    kids.push(el('div.set-label', set.encore > 0
      ? `アンコール${set.encore > 1 ? set.encore : ''}${set.name ? ` — ${set.name}` : ''}`
      : (set.name || '本編')));

    for (const song of set.songs) {
      if (!song.tape) n += 1;
      const v = song.tape ? null : resolve(song.name, songKey(song.name));
      kids.push(el('div.song', [
        el('span.num', song.tape ? '—' : String(n)),
        el('span.title', { title: song.name }, [
          song.name,
          song.cover ? el('span.tiny.dim', ` (${song.cover} のカバー)`) : null,
          song.tape ? el('span.pill.tape', { style: { marginLeft: '6px' } }, 'SE') : null,
        ]),
        showIntensity && !compact ? intensityBar(v) : null,
      ]));
    }
  }

  return el('div.setlist', kids);
}

/** 公演の見出し（日付・会場・ツアー） */
export function setlistHeader(setlist) {
  return el('div', [
    el('div.small.muted', formatDate(setlist.date)),
    el('h3', { style: { fontSize: '16px', margin: '3px 0 4px' } }, setlist.venue || '会場不明'),
    el('div.small.muted', [
      [setlist.city, setlist.country].filter(Boolean).join('・'),
      setlist.tour ? el('div', { style: { marginTop: '3px', color: 'var(--accent)' } }, setlist.tour) : null,
    ]),
  ]);
}

/**
 * 公演の詳細モーダル。セトリ・起伏グラフ・参加記録をまとめて出す。
 * @param {Function} onChange 参加記録などを変更したときに呼ぶ（再描画用）
 */
export function openSetlistModal(setlist, { onChange } = {}) {
  modal(setlist.venue || '公演', (body, close) => {
    const resolve = makeIntensityResolver();
    const arc = arcOf(setlist, resolve, { excludeTape: true });
    const cls = classifyArc(arc.points, arc.coverage);

    body.appendChild(setlistHeader(setlist));

    /* --- 参加記録 --- */
    const attendBox = el('div', { style: { marginTop: '14px' } });
    const renderAttend = () => {
      const rec = store.getAttendanceFor(setlist.id) || {};
      attendBox.replaceChildren(
        el('div.row', [
          el(`button.btn.sm${rec.attended ? '.primary' : ''}`, {
            onclick: () => {
              store.setAttendance(setlist.id, { attended: !rec.attended });
              renderAttend();
              onChange?.();
            },
          }, rec.attended ? '✓ 参加した' : 'この公演に参加した'),
          rec.attended ? el('button.btn.sm.ghost', {
            onclick: () => openAttendEditor(setlist, () => { renderAttend(); onChange?.(); }),
          }, '詳細を記録') : null,
        ]),
        rec.attended && (rec.seat || rec.companions || rec.memo)
          ? el('div.card', { style: { marginTop: '8px' } }, [
              rec.seat ? el('div.small', [el('span.dim', '座席: '), rec.seat]) : null,
              rec.companions ? el('div.small', [el('span.dim', '同行: '), rec.companions]) : null,
              rec.memo ? el('div.small', { style: { marginTop: '5px', lineHeight: '1.7', whiteSpace: 'pre-wrap' } }, rec.memo) : null,
            ])
          : null
      );
    };
    renderAttend();
    body.appendChild(attendBox);

    /* --- 起伏 --- */
    if (arc.points.length >= 6) {
      body.appendChild(el('div.section', { style: { marginTop: '18px' } }, [
        el('h2', '感情の起伏'),
        el('div.chart-wrap', [
          arcChart(arc.points, { zones: cls.zones, height: 190 }),
        ]),
        el('div.small.muted', { style: { marginTop: '8px', lineHeight: '1.75' } }, [
          el('b', { style: { color: 'var(--accent)' } }, cls.label),
          ' — ',
          cls.description,
        ]),
      ]));
    }

    /* --- セトリ --- */
    body.appendChild(el('div.section', { style: { marginTop: '18px' } }, [
      el('h2', 'セットリスト'),
      setlistBody(setlist),
    ]));

    /* --- 操作 --- */
    body.appendChild(el('div.row', { style: { marginTop: '16px', justifyContent: 'flex-end' } }, [
      setlist.url
        ? el('a.btn.sm.ghost', { href: setlist.url, target: '_blank', rel: 'noopener noreferrer' }, 'setlist.fm で見る')
        : null,
      el('button.btn.sm.ghost', {
        onclick: () => { copySetlistText(setlist); },
      }, 'テキストをコピー'),
      setlist.source === 'manual'
        ? el('button.btn.sm.danger', {
            onclick: async () => {
              const ok = await confirmDialog('手動入力の公演を削除',
                `${formatDate(setlist.date)} ${setlist.venue} を削除します。元に戻せません。`,
                { okLabel: '削除する', danger: true });
              if (!ok) return;
              store.deleteManualSetlist(setlist.id);
              close();
              onChange?.();
              toast('削除しました');
            },
          }, '削除')
        : null,
    ]));
  });
}

/** 参加記録の詳細フォーム */
export function openAttendEditor(setlist, onSaved) {
  modal('参加記録', (body, close) => {
    const rec = store.getAttendanceFor(setlist.id) || {};
    const seat = el('input', { type: 'text', value: rec.seat || '', placeholder: '例: 2階 C列 12番 / スタンディング B-450' });
    const companions = el('input', { type: 'text', value: rec.companions || '', placeholder: '例: ひとり / 友人2人' });
    const memo = el('textarea', { placeholder: 'その日の感想、印象に残った演出、MCの内容など' }, rec.memo || '');
    const rating = el('select', [5, 4, 3, 2, 1, 0].map((n) =>
      el('option', { value: n, selected: (rec.rating ?? 0) === n }, n === 0 ? '未評価' : '★'.repeat(n))));

    body.appendChild(el('div.stack', [
      el('div.small.muted', `${formatDate(setlist.date)} ${setlist.venue || ''}`),
      field('座席', seat),
      field('同行者', companions),
      field('評価', rating),
      field('メモ', memo),
      el('div.row', { style: { justifyContent: 'flex-end', marginTop: '4px' } }, [
        el('button.btn.ghost', { onclick: close }, 'キャンセル'),
        el('button.btn.primary', {
          onclick: () => {
            store.setAttendance(setlist.id, {
              attended: true,
              seat: seat.value.trim(),
              companions: companions.value.trim(),
              memo: memo.value.trim(),
              rating: Number(rating.value) || 0,
            });
            close();
            onSaved?.();
            toast('記録しました');
          },
        }, '保存'),
      ]),
    ]));
  });
}

/** セトリをテキスト化してクリップボードへ */
export function setlistToText(setlist) {
  const lines = [];
  lines.push(`${formatDate(setlist.date)} ${setlist.venue || ''}${setlist.city ? `（${setlist.city}）` : ''}`);
  if (setlist.tour) lines.push(setlist.tour);
  lines.push('');

  for (const set of setlist.sets) {
    if (set.encore > 0) lines.push(`【アンコール${set.encore > 1 ? set.encore : ''}】`);
    else if (setlist.sets.length > 1) lines.push('【本編】');
    set.songs.forEach((song, i) => {
      lines.push(`${i + 1}. ${song.name}${song.tape ? '（SE）' : ''}`);
    });
    lines.push('');
  }
  return lines.join('\n').trim();
}

export async function copySetlistText(setlist) {
  const text = setlistToText(setlist);
  try {
    await navigator.clipboard.writeText(text);
    toast('セットリストをコピーしました');
  } catch {
    // クリップボードAPIが使えない環境（http や古いブラウザ）向けの逃げ道
    modal('セットリスト', (body) => {
      const ta = el('textarea', { style: { minHeight: '260px' }, readonly: true }, text);
      body.appendChild(el('div.stack', [
        el('div.small.muted', '長押しまたは Ctrl+A → Ctrl+C でコピーしてください。'),
        ta,
      ]));
      ta.select();
    });
  }
}

export { empty };
