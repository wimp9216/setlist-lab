/* =========================================================
   Setlist Lab — 設定
   取得サーバー(Worker) / 分析パラメータ / バックアップ / 自己検証
   ========================================================= */

import { el, clear, toast, field, bytes, modal, confirmDialog, pct } from '../ui.js';
import { songKey } from '../normalize.js';
import { positionStats, transitionStats, successorsOf, arcOf, classifyArc } from '../analyze.js';
import * as store from '../store.js';
import * as api from '../api.js';
import { audioSupported } from '../audio.js';
import {
  SAMPLE_MBID, SAMPLE_ARTIST, SAMPLE_FACTS,
  buildSampleSetlists, buildSampleFeatures,
} from '../sample-data.js';
import { render } from '../main.js';

export function renderSettings() {
  const view = el('div.view');

  view.appendChild(el('div.view-head', [
    el('h1', '設定'),
    el('p', 'データの取得元、分析の条件、バックアップを設定します。'),
  ]));

  view.appendChild(proxySection());
  view.appendChild(analysisSection());
  view.appendChild(dataSection());
  view.appendChild(verifySection());
  view.appendChild(aboutSection());

  return view;
}

/* ---------------------------------------------------------
   取得サーバー
   --------------------------------------------------------- */

function proxySection() {
  const input = el('input', {
    type: 'text',
    value: store.getProxyUrl(),
    placeholder: 'https://setlist-proxy.xxxx.workers.dev',
  });
  const status = el('div.small', { style: { marginTop: '9px' } });

  const check = async () => {
    const url = input.value.trim();
    if (!url) { status.textContent = ''; return; }
    status.replaceChildren(el('span.spinner'), ' 確認中…');
    try {
      const res = await api.checkProxy(url);
      status.replaceChildren(el('div.notice.ok', [
        el('b', '接続できました。'),
        res.hasKey === false
          ? ' ただし Worker 側に setlist.fm の APIキーが設定されていません（環境変数 SETLIST_KEY）。'
          : ' APIキーも設定済みです。',
      ]));
    } catch (e) {
      status.replaceChildren(el('div.notice.danger', [el('b', '接続できません。'), ` ${e.message}`]));
    }
  };

  return el('div.section', [
    el('h2', 'setlist.fm の取得サーバー'),
    el('div.card', [
      el('div.small.muted', { style: { marginBottom: '11px', lineHeight: '1.8' } }, [
        'setlist.fm の API は CORS ヘッダーを一切返さないため、ブラウザから直接呼べません。',
        el('br'),
        '同梱の ',
        el('code', { style: { color: 'var(--accent)' } }, 'proxy-worker.js'),
        ' を Cloudflare Worker に貼り付けて、その URL をここに登録してください。',
      ]),
      field('Worker の URL', input),
      el('div.row', { style: { marginTop: '10px' } }, [
        el('button.btn.sm.primary', {
          onclick: () => {
            store.setProxyUrl(input.value);
            toast('保存しました');
            check();
          },
        }, '保存'),
        el('button.btn.sm.ghost', { onclick: check }, '接続を確認'),
        store.getProxyUrl() ? el('button.btn.sm.ghost.danger', {
          style: { marginLeft: 'auto' },
          onclick: () => { store.setProxyUrl(''); input.value = ''; clear(status); toast('解除しました'); },
        }, '解除') : null,
      ]),
      status,
      el('details.fold', { style: { marginTop: '11px' } }, [
        el('summary', '設定手順を見る'),
        el('ol', { style: { fontSize: '12.5px', lineHeight: '2', color: 'var(--muted)', paddingLeft: '20px', margin: 0 } }, [
          el('li', [
            'setlist.fm に無料登録し、',
            el('a', { href: 'https://www.setlist.fm/settings/apps', target: '_blank', rel: 'noopener noreferrer', style: { color: 'var(--accent)' } }, 'APIキー申請ページ'),
            ' からキーを取得（非商用は無料）',
          ]),
          el('li', 'Cloudflare ダッシュボード → Workers & Pages → Create → Worker を「Hello World」から作成'),
          el('li', '「Edit code」で proxy-worker.js の中身を全部貼り付けて Deploy'),
          el('li', [
            'Worker の Settings → Variables and Secrets → Add で ',
            el('b', 'Type: Secret'),
            ' を選び、名前 ',
            el('b', 'SETLIST_KEY'),
            ' ／ 値にAPIキーを入れて Deploy',
          ]),
          el('li', '発行された URL をこの欄に貼って保存'),
        ]),
      ]),
    ]),
  ]);
}

/* ---------------------------------------------------------
   分析の条件
   --------------------------------------------------------- */

function analysisSection() {
  const s = store.getSettings();

  const toggle = (key, label, desc) => {
    const input = el('input', { type: 'checkbox', checked: s[key] });
    input.addEventListener('change', () => { store.setSettings({ [key]: input.checked }); toast('保存しました'); });
    return el('label.spread', { style: { cursor: 'pointer', padding: '7px 0' } }, [
      el('div.grow', [
        el('div.small', label),
        el('div.tiny.dim', { style: { marginTop: '2px', lineHeight: '1.6' } }, desc),
      ]),
      input,
    ]);
  };

  const num = (key, label, desc, { min, max, step }) => {
    const input = el('input', { type: 'number', value: s[key], min, max, step, style: { width: '92px' } });
    input.addEventListener('change', () => {
      const v = Number(input.value);
      if (!Number.isFinite(v)) return;
      store.setSettings({ [key]: Math.min(max, Math.max(min, v)) });
      toast('保存しました');
      render();
    });
    return el('div.spread', { style: { padding: '7px 0' } }, [
      el('div.grow', [
        el('div.small', label),
        el('div.tiny.dim', { style: { marginTop: '2px', lineHeight: '1.6' } }, desc),
      ]),
      input,
    ]);
  };

  return el('div.section', [
    el('h2', '分析の条件'),
    el('div.card', [
      toggle('excludeTape', 'SE・BGM を分析から除外',
        'setlist.fm で「テープ再生」と記録された曲を、1曲目などの集計から外します。'),
      toggle('crossSetTransitions', 'セットをまたぐ流れも「つながり」に含める',
        '本編ラスト → アンコール1曲目 を曲の繋がりとして数えます。'),
      num('blockThreshold', '定番ブロックのしきい値',
        'この確率以上で次の曲に進む場合だけ「固定の流れ」とみなします。', { min: 0.3, max: 1, step: 0.05 }),
      num('minTransitionCount', '定番ブロックの最低回数',
        '同じ流れが最低何回あれば固定とみなすか。', { min: 1, max: 20, step: 1 }),
    ]),

    el('div.card', { style: { marginTop: '9px' } }, [
      num('cacheMaxDays', '取得データを保持する日数',
        'setlist.fm の利用規約は取得データの保持を短期間のキャッシュに限っています。'
        + 'この日数を過ぎた取り込み分は起動時に破棄され、再取得が必要になります。'
        + '手動入力のセトリ・参加記録・マイセトリは自分のデータなので破棄されません。',
        { min: 1, max: 30, step: 1 }),
    ]),
  ]);
}

/* ---------------------------------------------------------
   データ
   --------------------------------------------------------- */

function dataSection() {
  const artists = store.getArtists();
  const setlistCount = artists.reduce((a, x) => a + (store.getSetlistCache(x.mbid)?.items.length || 0), 0);
  const manual = store.getManualSetlists().length;
  const features = Object.keys(store.getFeatures()).length;
  const attended = Object.values(store.getAttendance()).filter((r) => r.attended).length;

  const stat = (k, v) => el('tr', [el('td', el('span.dim', k)), el('td.num', v)]);

  return el('div.section', [
    el('h2', 'データ'),
    el('div.card', [
      el('table.tbl', [
        el('tbody', [
          stat('アーティスト', `${artists.length}`),
          stat('取り込んだ公演', `${setlistCount}`),
          stat('手動入力の公演', `${manual}`),
          stat('特徴量を持つ曲', `${features}`),
          stat('参加記録', `${attended}`),
          stat('マイセトリ', `${store.getMySets().length}`),
          stat('使用容量', bytes(store.usageBytes())),
        ]),
      ]),
      el('div.row.tight', { style: { marginTop: '12px' } }, [
        el('button.btn.sm', { onclick: exportBackup }, 'バックアップを書き出す'),
        el('button.btn.sm.ghost', { onclick: importBackup }, '読み込む'),
      ]),
      el('div.tiny.dim', { style: { marginTop: '9px', lineHeight: '1.7' } },
        'データはこの端末のブラウザ内（localStorage）にのみ保存されます。機種変更やブラウザのデータ削除の前にバックアップを書き出してください。'),
      el('div.row', { style: { marginTop: '12px' } }, [
        el('button.btn.sm.ghost.danger', {
          onclick: async () => {
            const ok = await confirmDialog('すべてのデータを削除',
              'アーティスト・公演・参加記録・マイセトリをすべて消します。元に戻せません。',
              { okLabel: 'すべて削除する', danger: true });
            if (!ok) return;
            for (const k of Object.keys(localStorage).filter((x) => x.startsWith('setlistLab.'))) {
              localStorage.removeItem(k);
            }
            location.reload();
          },
        }, 'すべてのデータを削除'),
      ]),
    ]),
  ]);
}

function exportBackup() {
  const payload = store.exportAll();
  const blob = new Blob([JSON.stringify(payload, null, 2)], { type: 'application/json' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = `setlist-lab-backup-${new Date().toISOString().slice(0, 10)}.json`;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(a.href), 1000);
  toast('書き出しました');
}

function importBackup() {
  const input = el('input', { type: 'file', accept: 'application/json,.json', style: { display: 'none' } });
  input.addEventListener('change', async () => {
    const file = input.files?.[0];
    if (!file) return;
    try {
      const payload = JSON.parse(await file.text());
      const ok = await confirmDialog('バックアップを読み込む',
        `${payload.exportedAt ? new Date(payload.exportedAt).toLocaleString('ja-JP') : '不明な日時'} のバックアップで、現在のデータを上書きします。`,
        { okLabel: '読み込む', danger: true });
      if (!ok) return;
      store.importAll(payload);
      location.reload();
    } catch (e) {
      toast(e.message || '読み込みに失敗しました', { error: true });
    } finally {
      input.remove();
    }
  });
  document.body.appendChild(input);
  input.click();
}

/* ---------------------------------------------------------
   自己検証
   --------------------------------------------------------- */

/**
 * 内蔵サンプルには「1曲目はこの曲が12公演中9回」といった正解を仕込んである。
 * 集計結果がその正解と一致するかをこの場で確かめられるようにする。
 * 分析の数字が信用できるかを、自分の目で確認できるようにするための機能。
 */
function verifySection() {
  const out = el('div');

  const run = () => {
    clear(out);
    const setlists = buildSampleSetlists();
    const features = buildSampleFeatures();
    const tourA = setlists.filter((s) => s.tour === SAMPLE_FACTS.tour);
    const opts = { excludeTape: true, crossSetTransitions: false };

    const rows = [];
    let pass = 0, fail = 0;

    const check = (label, got, expected) => {
      const okFlag = got === expected;
      okFlag ? pass++ : fail++;
      rows.push(el('tr', [
        el('td', [
          el('span', { style: { color: okFlag ? 'var(--ok)' : 'var(--danger)', marginRight: '6px' } }, okFlag ? '✓' : '✕'),
          el('span.small', label),
        ]),
        el('td.num.small', `${got} / 期待 ${expected}`),
      ]));
    };

    // 公演数
    check(`ツアーAの公演数`, tourA.length, SAMPLE_FACTS.total);

    // 位置別
    const ps = positionStats(tourA, opts);
    for (const c of SAMPLE_FACTS.checks) {
      const hit = ps.positions[c.position].ranking.find((r) => r.key === songKey(c.song));
      check(c.label, hit ? hit.count : 0, c.expected);
    }

    // 遷移
    const ts = transitionStats(tourA, opts);
    for (const t of SAMPLE_FACTS.transitions) {
      const hit = successorsOf(ts, songKey(t.from)).find((s) => s.key === songKey(t.to));
      check(`「${t.from}」→「${t.to}」`, hit ? hit.count : 0, t.expected);
    }

    // 起伏パターン
    const intensityOf = (name) => features[songKey(name)]?.intensity ?? null;
    for (const a of SAMPLE_FACTS.arcs) {
      const sl = setlists.find((s) => s.tour === a.tour);
      const arc = arcOf(sl, intensityOf, opts);
      const cls = classifyArc(arc.points, arc.coverage);
      const okFlag = cls.pattern === a.expect;
      okFlag ? pass++ : fail++;
      rows.push(el('tr', [
        el('td', [
          el('span', { style: { color: okFlag ? 'var(--ok)' : 'var(--danger)', marginRight: '6px' } }, okFlag ? '✓' : '✕'),
          el('span.small', `${a.note} → ${cls.label}`),
        ]),
        el('td.num.small', okFlag ? '一致' : `期待 ${a.expect}`),
      ]));
    }

    out.appendChild(el('div', [
      el(`div.notice${fail ? '.danger' : '.ok'}`, { style: { marginBottom: '10px' } }, [
        el('b', fail ? `${fail}件が期待と一致しませんでした` : `${pass}件すべて期待どおりです`),
        fail ? '' : ' — 集計ロジックは仕込んだ正解を正しく再現しています。',
      ]),
      el('table.tbl', [el('tbody', rows)]),
    ]));
  };

  return el('div.section', [
    el('h2', '分析ロジックの自己検証'),
    el('div.card', [
      el('div.small.muted', { style: { marginBottom: '10px', lineHeight: '1.8' } },
        '内蔵サンプルには「1曲目はこの曲が12公演中9回」といった正解をあらかじめ仕込んであります。集計結果がその正解と一致するかをその場で確かめられます。'),
      el('button.btn.sm', { onclick: run }, '検証を実行'),
      el('div', { style: { marginTop: '12px' } }, out),
    ]),
  ]);
}

/* ---------------------------------------------------------
   このアプリについて
   --------------------------------------------------------- */

function aboutSection() {
  const hasSample = store.getArtists().some((a) => a.mbid === SAMPLE_MBID);

  return el('div.section', [
    el('h2', 'このアプリについて'),
    el('div.card', [
      el('table.tbl', [
        el('tbody', [
          el('tr', [el('td', el('span.dim', 'セトリ・公演情報')), el('td.num.small', 'setlist.fm API')]),
          el('tr', [el('td', el('span.dim', 'アーティスト検索')), el('td.num.small', 'MusicBrainz')]),
          el('tr', [el('td', el('span.dim', '曲名・試聴')), el('td.num.small', 'iTunes Search API')]),
          el('tr', [el('td', el('span.dim', '楽曲の特徴量')), el('td.num.small', audioSupported() ? 'Web Audio（この端末で解析）' : '非対応')]),
        ]),
      ]),
      el('div.tiny.dim', { style: { marginTop: '10px', lineHeight: '1.8' } },
        'Spotify の audio-features は2024年11月に廃止されたため、楽曲の特徴量は iTunes の30秒試聴をこの端末で解析して算出しています。曲の一部だけを見た値なので、実感と合わない曲は「楽曲」画面で手動補正してください。'),

      hasSample ? el('div.row', { style: { marginTop: '12px' } }, [
        el('button.btn.sm.ghost', {
          onclick: async () => {
            const ok = await confirmDialog('サンプルを削除',
              'サンプルアーティスト「ペーパーランタンズ」と、そのセットリストを削除します。', { okLabel: '削除する', danger: true });
            if (!ok) return;
            store.removeArtist(SAMPLE_MBID);
            location.reload();
          },
        }, 'サンプルデータを削除'),
      ]) : el('div.row', { style: { marginTop: '12px' } }, [
        el('button.btn.sm.ghost', {
          onclick: () => {
            store.addArtist(SAMPLE_ARTIST);
            store.saveSetlistCache(SAMPLE_MBID, buildSampleSetlists());
            store.saveFeatures(buildSampleFeatures());
            location.reload();
          },
        }, 'サンプルデータを再追加'),
      ]),
    ]),
  ]);
}

export { pct };
