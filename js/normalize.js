/* =========================================================
   Setlist Lab — 正規化層
   ---------------------------------------------------------
   setlist.fm の生JSON → アプリ内部モデルへの変換と、
   曲名の突合に使う正規化キーの生成をここに集約する。
   ========================================================= */

/**
 * 内部モデル（このアプリで扱うセトリの唯一の形）
 * {
 *   id, source: 'setlistfm' | 'manual',
 *   date: 'YYYY-MM-DD',
 *   artistMbid, artistName,
 *   tour, venue, city, country,
 *   url, info,
 *   sets: [ { encore: 0, name: '', songs: [ { name, tape, cover, info } ] } ]
 * }
 */

/** setlist.fm の 'dd-MM-yyyy' → 'YYYY-MM-DD' */
export function parseEventDate(s) {
  if (!s) return '';
  const m = String(s).match(/^(\d{2})-(\d{2})-(\d{4})$/);
  if (!m) return String(s);
  return `${m[3]}-${m[2]}-${m[1]}`;
}

/** 'YYYY-MM-DD' → '2026/08/14(金)' */
const WD = ['日', '月', '火', '水', '木', '金', '土'];
export function formatDate(iso) {
  if (!iso) return '日付不明';
  const d = new Date(`${iso}T00:00:00`);
  if (Number.isNaN(d.getTime())) return iso;
  return `${d.getFullYear()}/${String(d.getMonth() + 1).padStart(2, '0')}/${String(d.getDate()).padStart(2, '0')}(${WD[d.getDay()]})`;
}

/**
 * setlist.fm の setlist オブジェクト1件を内部モデルに変換する。
 * JSON では sets.set[] だが、環境によって set[] で来ることもあるため両方受ける。
 */
export function fromSetlistFm(raw) {
  const rawSets = raw?.sets?.set ?? raw?.set ?? [];
  const sets = rawSets.map((s) => ({
    encore: Number(s.encore) || 0,
    name: s.name || '',
    songs: (s.song || []).map((song) => ({
      name: (song.name || '').trim(),
      tape: !!song.tape,
      cover: song.cover?.name || null,
      info: song.info || '',
    })).filter((song) => song.name),
  })).filter((s) => s.songs.length);

  return {
    id: raw.id,
    source: 'setlistfm',
    date: parseEventDate(raw.eventDate),
    artistMbid: raw.artist?.mbid || '',
    artistName: raw.artist?.name || '',
    tour: raw.tour?.name || '',
    venue: raw.venue?.name || '',
    city: raw.venue?.city?.name || '',
    country: raw.venue?.city?.country?.name || '',
    url: raw.url || '',
    info: raw.info || '',
    sets,
  };
}

/** 検索結果ページ（{setlist:[...]}）をまとめて変換。曲が1つも無い公演は落とす。 */
export function fromSetlistFmPage(page) {
  const arr = page?.setlist ?? [];
  return arr.map(fromSetlistFm).filter((s) => s.sets.length > 0);
}

/* ---------------- 曲名の正規化 ---------------- */

/**
 * 曲名の表記ゆれを吸収した突合キーを作る。
 *  - 全角英数→半角、大文字→小文字
 *  - 括弧書き（"(Live Version)" 等）を落とす
 *  - 記号・空白・長音符を除去
 * 「Pretender」「pretender」「Pretender (Live)」を同一視するのが目的。
 */
export function songKey(name) {
  if (!name) return '';
  let s = String(name);

  // 全角英数記号 → 半角
  s = s.replace(/[Ａ-Ｚａ-ｚ０-９]/g, (c) => String.fromCharCode(c.charCodeAt(0) - 0xfee0));
  s = s.toLowerCase();

  // 末尾の補足括弧を除去（曲名の一部である括弧を消しすぎないよう末尾のみ）
  s = s.replace(/[（(\[【][^）)\]】]*[）)\]】]\s*$/g, '');

  // 記号・空白・長音・中黒を除去
  s = s.replace(/[\s　]/g, '');
  s = s.replace(/[-‐‑‒–—―ー~〜_.,'"“”‘’!！?？&＆/／:：;；*＊+＋#＃@＄$%％]/g, '');

  return s.trim();
}

/** 表示用に曲名を整える（前後の空白のみ） */
export function displayName(name) {
  return (name || '').trim();
}

/**
 * iTunes の検索結果から、目的の曲らしいトラックを選ぶ。
 *
 * setlist.fm はラテン文字しか扱えないため、日本語タイトルの曲は
 * ローマ字表記で入っている（例: 「宿命」→「Shukumei」）。
 * iTunes 側は日本語タイトルで返るので、文字列では一致しない。そこで
 *   1. 曲名キーが完全一致するもの（英語タイトル曲はここで決まる）
 *   2. 同じアーティストの検索結果の最上位（ローマ字で検索しても
 *      Apple の検索インデックスがかなり拾ってくれる）
 * の順で選び、2 で決めたものは confidence を下げて手動確認を促す。
 *
 * アーティストの同定は名前の文字列比較では効かない
 * （setlist.fm「Official HIGE DANdism」/ iTunes「Official髭男dism」）。
 * iTunes のアーティストIDが分かっていればそれで絞る。
 *
 * @param {number} [itunesArtistId] 分かっていれば渡す。誤って別アーティストの
 *   曲を掴むのを防げる。
 * @returns {{ track, confidence:'exact'|'artist'|'weak' } | null}
 */
export function matchTrack(songName, artistName, tracks, itunesArtistId = null) {
  if (!tracks || !tracks.length) return null;

  const target = songKey(songName);
  const artistTarget = songKey(artistName);

  const sameArtist = tracks.filter((t) => (
    itunesArtistId
      ? String(t.itunesArtistId) === String(itunesArtistId)
      : songKey(t.artist) === artistTarget
  ));

  const pool = sameArtist.length ? sameArtist : tracks;
  const exact = pool.find((t) => songKey(t.title) === target);
  if (exact) return { track: exact, confidence: 'exact' };

  // アーティストが確定していれば、曲名が一致しなくても信頼してよい
  if (sameArtist.length) return { track: sameArtist[0], confidence: 'artist' };

  return { track: tracks[0], confidence: 'weak' };
}

/* ---------------- セトリからの抽出 ---------------- */

/**
 * セトリを1本のフラットな曲配列にする。
 * 各要素に、そのセトリ内での位置情報を付ける。
 * @param {object} setlist 内部モデル
 * @param {object} opts { excludeTape }
 */
export function flattenSongs(setlist, opts = {}) {
  const { excludeTape = true } = opts;
  const out = [];
  setlist.sets.forEach((set, setIndex) => {
    set.songs.forEach((song, songIndex) => {
      if (excludeTape && song.tape) return;
      out.push({
        ...song,
        key: songKey(song.name),
        setIndex,
        songIndex,
        encore: set.encore,
      });
    });
  });
  // フラット後の通し番号を振り直す（tape 除外後の並びが本来の「n曲目」）
  out.forEach((s, i) => {
    s.position = i;
    s.total = out.length;
  });
  return out;
}

/**
 * 1公演から「1曲目 / 本編ラスト / アンコール1曲目 / アンコールラスト」を取り出す。
 * 該当が無い位置は null。
 */
export function extractPositions(setlist, opts = {}) {
  const songs = flattenSongs(setlist, opts);
  if (!songs.length) return { opener: null, mainCloser: null, encoreOpener: null, encoreCloser: null };

  const main = songs.filter((s) => s.encore === 0);
  const enc = songs.filter((s) => s.encore > 0);
  const maxEncore = enc.length ? Math.max(...enc.map((s) => s.encore)) : 0;
  const lastEncore = enc.filter((s) => s.encore === maxEncore);

  return {
    opener: songs[0] || null,
    mainCloser: main.length ? main[main.length - 1] : null,
    encoreOpener: enc.length ? enc[0] : null,
    encoreCloser: lastEncore.length ? lastEncore[lastEncore.length - 1] : null,
  };
}

/** 曲数（tape 除外後） */
export function songCount(setlist, opts = {}) {
  return flattenSongs(setlist, opts).length;
}

/* ---------------- 手動入力 ---------------- */

export function makeManualId() {
  return `manual-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 7)}`;
}

/**
 * 手動入力フォームの内容を内部モデルにする。
 * @param {object} input { date, venue, city, tour, artistMbid, artistName, main: string[], encores: string[][] }
 */
export function makeManualSetlist(input) {
  const sets = [];
  const main = (input.main || []).map((n) => n.trim()).filter(Boolean);
  if (main.length) {
    sets.push({ encore: 0, name: '', songs: main.map((name) => ({ name, tape: false, cover: null, info: '' })) });
  }
  (input.encores || []).forEach((list, i) => {
    const songs = (list || []).map((n) => n.trim()).filter(Boolean);
    if (songs.length) {
      sets.push({ encore: i + 1, name: '', songs: songs.map((name) => ({ name, tape: false, cover: null, info: '' })) });
    }
  });

  return {
    id: input.id || makeManualId(),
    source: 'manual',
    date: input.date || '',
    artistMbid: input.artistMbid || '',
    artistName: input.artistName || '',
    tour: (input.tour || '').trim(),
    venue: (input.venue || '').trim(),
    city: (input.city || '').trim(),
    country: '',
    url: '',
    info: (input.info || '').trim(),
    sets,
  };
}

/**
 * 箇条書きテキストからセトリを起こす。
 * 「EN」「アンコール」「encore」等の行をアンコール境界として扱い、
 * 行頭の番号・記号は取り除く。
 */
export function parseSetlistText(text) {
  const lines = String(text || '').split(/\r?\n/);
  const main = [];
  const encores = [];
  let current = main;

  const encoreHeader = /^\s*(?:[-–—•*]\s*)?(?:en(?:core)?\.?|アンコール|ｱﾝｺｰﾙ|w[- ]?en(?:core)?)\s*(\d+)?\s*[:：]?\s*$/i;
  const inlineEncore = /^\s*(?:en|アンコール)\s*(\d*)\s*[-.:：]\s*(.+)$/i;

  for (const rawLine of lines) {
    const line = rawLine.trim();
    if (!line) continue;

    const head = line.match(encoreHeader);
    if (head) {
      const n = head[1] ? parseInt(head[1], 10) : encores.length + 1;
      while (encores.length < n) encores.push([]);
      current = encores[n - 1];
      continue;
    }

    const inline = line.match(inlineEncore);
    if (inline) {
      const n = inline[1] ? parseInt(inline[1], 10) : 1;
      while (encores.length < n) encores.push([]);
      const title = stripBullet(inline[2]);
      if (title) encores[n - 1].push(title);
      current = encores[n - 1];
      continue;
    }

    const title = stripBullet(line);
    if (title) current.push(title);
  }

  return { main, encores };
}

/** 行頭の「1.」「01)」「・」「-」などを落とす */
function stripBullet(line) {
  return String(line)
    .replace(/^\s*(?:\d{1,3}\s*[.)、．:：]|[-–—•*・>＞])\s*/, '')
    .trim();
}
