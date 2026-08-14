/* =========================================================
   Setlist Lab — セトリの手動入力
   ---------------------------------------------------------
   setlist.fm に登録が無い公演（小規模ライブ、登録が追いついていない
   直近公演など）を自分で登録する。保存後は API 取得分と同じ扱いで
   分析・比較・参加記録の対象になる。
   ========================================================= */

import { el, clear, modal, toast, field } from '../ui.js';
import { makeManualSetlist, parseSetlistText, songKey } from '../normalize.js';
import * as store from '../store.js';
import { collectSongs } from '../features.js';

/**
 * @param {object|null} existing 編集する既存セトリ（新規なら null）
 * @param {object} opts { artist, onSaved }
 */
export function openManualEditor(existing, { artist, onSaved } = {}) {
  modal(existing ? 'セットリストを編集' : 'セットリストを手動で追加', (body, close) => {
    const date = el('input', { type: 'date', value: existing?.date || new Date().toISOString().slice(0, 10) });
    const venue = el('input', { type: 'text', value: existing?.venue || '', placeholder: '例: Zepp Tokyo' });
    const city = el('input', { type: 'text', value: existing?.city || '', placeholder: '例: 東京' });
    const tour = el('input', { type: 'text', value: existing?.tour || '', placeholder: '例: LIVE TOUR 2026', list: 'tour-suggest' });

    // 既存のツアー名を候補に出す（表記ゆれでツアーが分かれるのを防ぐ）
    const tours = [...new Set(store.getAllSetlists(artist?.mbid).map((s) => s.tour).filter(Boolean))];
    const datalist = el('datalist', { id: 'tour-suggest' }, tours.map((t) => el('option', { value: t })));

    /* --- 曲の入力欄 --- */
    // 既存アーティストの曲を補完候補に出す
    const known = collectSongs(store.getAllSetlists(artist?.mbid));
    const songList = el('datalist', { id: 'song-suggest' }, known.map((s) => el('option', { value: s.name })));

    const sections = []; // { encore:number, wrap, list }

    const makeSongInput = (value = '') => {
      const input = el('input', { type: 'text', value, placeholder: '曲名', list: 'song-suggest' });
      const row = el('div.row.tight', { style: { marginBottom: '5px' } }, [
        el('span.dim.tiny', { class: 'idx', style: { width: '20px', textAlign: 'right', flex: 'none' } }, ''),
        el('div.grow', input),
        el('button.btn.sm.ghost', {
          title: '削除',
          onclick: () => { row.remove(); renumber(); },
        }, '✕'),
      ]);
      row._input = input;

      // 最終行で Enter を押したら次の行を足す（連続入力しやすく）
      input.addEventListener('keydown', (e) => {
        if (e.key !== 'Enter') return;
        e.preventDefault();
        const list = row.parentElement;
        const rows = [...list.children];
        if (rows[rows.length - 1] === row) {
          const next = makeSongInput();
          list.appendChild(next);
          renumber();
          next._input.focus();
        } else {
          rows[rows.indexOf(row) + 1]._input.focus();
        }
      });
      return row;
    };

    const renumber = () => {
      for (const sec of sections) {
        [...sec.list.children].forEach((row, i) => {
          const idx = row.querySelector('.idx');
          if (idx) idx.textContent = String(i + 1);
        });
      }
    };

    const addSection = (encore, songs = []) => {
      const list = el('div');
      for (const s of songs.length ? songs : ['']) list.appendChild(makeSongInput(s));

      const wrap = el('div.section', [
        el('h2', [
          encore === 0 ? '本編' : `アンコール${encore > 1 ? encore : ''}`,
          encore > 0 ? el('button.btn.sm.ghost', {
            style: { marginLeft: 'auto' },
            onclick: () => {
              wrap.remove();
              sections.splice(sections.findIndex((s) => s.wrap === wrap), 1);
              renumber();
            },
          }, 'このアンコールを削除') : null,
        ]),
        list,
        el('button.btn.sm.ghost', {
          onclick: () => { list.appendChild(makeSongInput()); renumber(); },
        }, '＋ 曲を追加'),
      ]);

      sections.push({ encore, wrap, list });
      return wrap;
    };

    const setsBox = el('div');
    const rebuildSections = (main, encores) => {
      sections.length = 0;
      clear(setsBox);
      setsBox.appendChild(addSection(0, main));
      encores.forEach((songs, i) => setsBox.appendChild(addSection(i + 1, songs)));
      renumber();
    };

    // 既存データ or 空の状態で初期化
    if (existing) {
      const main = existing.sets.find((s) => s.encore === 0)?.songs.map((s) => s.name) || [];
      const encores = existing.sets.filter((s) => s.encore > 0).map((s) => s.songs.map((x) => x.name));
      rebuildSections(main, encores);
    } else {
      rebuildSections([''], []);
    }

    /* --- テキストから取り込み --- */
    const importBox = el('details.fold', [
      el('summary', 'テキストから取り込む'),
      el('div.stack', [
        el('div.tiny.dim', { style: { lineHeight: '1.75' } },
          '箇条書きを貼り付けると自動で分解します。「EN」「アンコール」「en.」などの行はアンコールの区切りとして認識します。行頭の番号（1. や 01) など）は自動で外れます。'),
        (() => {
          const ta = el('textarea', { placeholder: '1. ミックスナッツ\n2. Subtitle\n…\nアンコール\n1. Pretender' });
          const btn = el('button.btn.sm.primary', {
            onclick: () => {
              const { main, encores } = parseSetlistText(ta.value);
              if (!main.length && !encores.length) { toast('曲を読み取れませんでした', { error: true }); return; }
              rebuildSections(main.length ? main : [''], encores);
              toast(`本編${main.length}曲・アンコール${encores.reduce((a, e) => a + e.length, 0)}曲を読み取りました`);
            },
          }, '取り込む');
          return el('div.stack', [ta, el('div.row', { style: { justifyContent: 'flex-end' } }, btn)]);
        })(),
      ]),
    ]);

    /* --- 保存 --- */
    const save = () => {
      if (!date.value) { toast('日付を入力してください', { error: true }); return; }

      const main = [...sections.find((s) => s.encore === 0).list.children].map((r) => r._input.value.trim()).filter(Boolean);
      const encores = sections.filter((s) => s.encore > 0)
        .map((s) => [...s.list.children].map((r) => r._input.value.trim()).filter(Boolean));

      if (!main.length && !encores.some((e) => e.length)) {
        toast('曲を1曲以上入力してください', { error: true });
        return;
      }

      // 同一公演内の曲重複は入力ミスの可能性が高いので知らせる（保存は止めない）
      const allNames = [...main, ...encores.flat()];
      const keys = allNames.map(songKey);
      const dup = keys.find((k, i) => keys.indexOf(k) !== i);
      if (dup) {
        const name = allNames[keys.indexOf(dup)];
        toast(`「${name}」が重複しています（そのまま保存しました）`);
      }

      const setlist = makeManualSetlist({
        id: existing?.id,
        date: date.value,
        venue: venue.value,
        city: city.value,
        tour: tour.value,
        artistMbid: artist?.mbid || '',
        artistName: artist?.name || '',
        main,
        encores,
      });

      store.saveManualSetlist(setlist);
      close();
      onSaved?.();
      toast(existing ? '更新しました' : '追加しました');
    };

    body.appendChild(el('div.stack', [
      datalist,
      songList,
      el('div.row', [
        el('div.grow', field('日付', date)),
        el('div.grow', field('会場', venue)),
      ]),
      el('div.row', [
        el('div.grow', field('都市', city)),
        el('div.grow', field('ツアー名', tour)),
      ]),
      importBox,
      setsBox,
      el('button.btn.sm.ghost.block', {
        onclick: () => {
          const next = sections.filter((s) => s.encore > 0).length + 1;
          setsBox.appendChild(addSection(next, ['']));
          renumber();
        },
      }, '＋ アンコールを追加'),
      el('div.row', { style: { justifyContent: 'flex-end', marginTop: '6px' } }, [
        el('button.btn.ghost', { onclick: close }, 'キャンセル'),
        el('button.btn.primary', { onclick: save }, '保存'),
      ]),
    ]));
  });
}
