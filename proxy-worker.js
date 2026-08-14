/* =========================================================
   Setlist Lab — setlist.fm 中継（Cloudflare Worker）
   ---------------------------------------------------------
   setlist.fm の API は CORS ヘッダーを一切返さない（プリフライトも403）ため、
   GitHub Pages 上のブラウザからは直接呼べない。この Worker が代理でアクセスし、
   CORS を付けて返す。APIキーはここに秘匿し、ブラウザには出さない。

   使い方（Cloudflare ダッシュボード）:
     1. setlist.fm に無料登録 → https://www.setlist.fm/settings/api でAPIキーを申請
        （非商用は無料。標準キーは 2req/秒・1440req/日）
     2. https://dash.cloudflare.com → Workers & Pages → Create → Worker
        「Hello World」テンプレートで適当な名前を付けて Deploy
     3. 「Edit code」→ このファイルの中身を全部貼り付け → Deploy
     4. Worker の Settings → Variables and Secrets に
          名前: SETLIST_KEY   値: 取得したAPIキー
        を追加して Encrypt（暗号化）を選択 → Deploy
     5. 発行された URL（https://<name>.<sub>.workers.dev）を
        Setlist Lab の「設定 → setlist.fm の取得サーバー」に貼る

   ※ Git連携は不要（リポジトリ権限を渡さずに済む）
   ========================================================= */

const API = 'https://api.setlist.fm/rest/1.0';

// このオリジンからのみ受け付ける。第三者に踏み台として使われるのを防ぐ。
// 自分の Pages の URL に書き換えて使う。
const ALLOWED_ORIGINS = [
  'https://wimp9216.github.io',
];

// 1日1440リクエストの上限があるため、同じ問い合わせはキャッシュから返す
const CACHE_SECONDS = 6 * 60 * 60;

export default {
  async fetch(request, env, ctx) {
    const origin = request.headers.get('Origin') || '';
    const cors = corsHeaders(origin);

    if (request.method === 'OPTIONS') {
      return new Response(null, {
        headers: {
          ...cors,
          'Access-Control-Allow-Methods': 'GET, OPTIONS',
          'Access-Control-Allow-Headers': 'Content-Type',
          'Access-Control-Max-Age': '86400',
        },
      });
    }
    if (request.method !== 'GET') {
      return json({ error: 'GET のみ受け付けます。' }, 405, cors);
    }
    if (!isAllowed(origin)) {
      return json({ error: 'このオリジンからの利用は許可されていません。' }, 403, cors);
    }

    const url = new URL(request.url);
    const path = url.pathname.replace(/\/+$/, '') || '/';

    /* --- 疎通確認 --- */
    if (path === '/health' || path === '/') {
      return json({
        ok: true,
        service: 'setlist-lab-proxy',
        hasKey: !!env.SETLIST_KEY,
        allowedOrigins: ALLOWED_ORIGINS,
      }, 200, cors);
    }

    if (!env.SETLIST_KEY) {
      return json({
        error: 'Worker に setlist.fm のAPIキーが設定されていません。'
             + 'Cloudflare の Settings → Variables で SETLIST_KEY を追加してください。',
      }, 500, cors);
    }

    /* --- ルーティング --- */
    let upstream;
    if (path === '/artists') {
      const name = (url.searchParams.get('name') || '').trim();
      if (!name) return json({ error: 'name は必須です。' }, 400, cors);
      upstream = `${API}/search/artists?artistName=${encodeURIComponent(name)}&p=1&sort=relevance`;

    } else if (path === '/setlists') {
      const mbid = (url.searchParams.get('artistMbid') || '').trim();
      const page = clampInt(url.searchParams.get('p'), 1, 1, 500);
      if (!isMbid(mbid)) return json({ error: 'artistMbid の形式が不正です。' }, 400, cors);
      upstream = `${API}/artist/${mbid}/setlists?p=${page}`;

    } else if (path === '/setlist') {
      const id = (url.searchParams.get('id') || '').trim();
      if (!/^[A-Za-z0-9]{4,20}$/.test(id)) return json({ error: 'id の形式が不正です。' }, 400, cors);
      upstream = `${API}/setlist/${id}`;

    } else {
      return json({ error: `不明なパスです: ${path}` }, 404, cors);
    }

    /* --- キャッシュ --- */
    const cacheKey = new Request(upstream, { method: 'GET' });
    const cache = caches.default;
    const cached = await cache.match(cacheKey);
    if (cached) {
      const body = await cached.text();
      return new Response(body, { status: 200, headers: { ...cors, 'X-Cache': 'HIT' } });
    }

    /* --- setlist.fm へ --- */
    let res;
    try {
      res = await fetch(upstream, {
        headers: {
          'x-api-key': env.SETLIST_KEY,
          Accept: 'application/json',
          'User-Agent': 'SetlistLab/1.0',
        },
      });
    } catch (e) {
      return json({ error: `setlist.fm に接続できませんでした: ${e.message}` }, 502, cors);
    }

    if (res.status === 404) {
      // setlist.fm は「該当なし」も404で返す。空の結果として扱うほうが呼び出し側が楽。
      return json({ setlist: [], artist: [], total: 0, page: 1, itemsPerPage: 20 }, 200, cors);
    }
    if (res.status === 429) {
      return json({ error: 'setlist.fm のレート制限に達しました。少し待ってからお試しください。' }, 429, cors);
    }
    if (!res.ok) {
      return json({ error: `setlist.fm が ${res.status} を返しました。` }, res.status, cors);
    }

    const body = await res.text();

    ctx.waitUntil(cache.put(cacheKey, new Response(body, {
      headers: { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': `max-age=${CACHE_SECONDS}` },
    })));

    return new Response(body, { status: 200, headers: { ...cors, 'X-Cache': 'MISS' } });
  },
};

/* --------------------------------------------------------- */

function isAllowed(origin) {
  if (!origin) return true; // curl 等の Origin なしアクセスは通す（ブラウザ以外の確認用）
  if (ALLOWED_ORIGINS.includes(origin)) return true;
  // ローカル開発（http://localhost:8000 など）
  return /^https?:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/.test(origin);
}

function corsHeaders(origin) {
  return {
    'Access-Control-Allow-Origin': isAllowed(origin) && origin ? origin : '*',
    'Vary': 'Origin',
    'Content-Type': 'application/json; charset=utf-8',
  };
}

function json(body, status, cors) {
  return new Response(JSON.stringify(body), { status, headers: cors });
}

function isMbid(s) {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(s);
}

function clampInt(raw, def, min, max) {
  const n = parseInt(raw, 10);
  if (!Number.isFinite(n)) return def;
  return Math.min(max, Math.max(min, n));
}
