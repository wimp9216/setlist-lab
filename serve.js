/* =========================================================
   Setlist Lab — ローカル確認用サーバー（依存ゼロ）
   ---------------------------------------------------------
   ES モジュールは file:// では読み込めない（CORS で弾かれる）ため、
   ローカルで開くときは HTTP で配信する必要がある。

     node serve.js          → http://localhost:5175
     node serve.js 8080     → ポート指定

   スマホ実機で試すときは、表示される LAN の URL を開く。
   （PC とスマホが同じ Wi-Fi にいる必要がある）
   ========================================================= */

const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');

const PORT = Number(process.argv[2]) || 5175;
const ROOT = __dirname;

const TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.webmanifest': 'application/manifest+json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.ico': 'image/x-icon',
};

const server = http.createServer((req, res) => {
  let urlPath;
  try {
    urlPath = decodeURIComponent(new URL(req.url, 'http://localhost').pathname);
  } catch {
    res.writeHead(400).end('Bad Request');
    return;
  }
  if (urlPath.endsWith('/')) urlPath += 'index.html';

  // ROOT の外に出る参照は拒否する
  const filePath = path.join(ROOT, urlPath);
  if (!filePath.startsWith(ROOT)) {
    res.writeHead(403).end('Forbidden');
    return;
  }

  fs.readFile(filePath, (err, data) => {
    if (err) {
      res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' });
      res.end(`404 Not Found: ${urlPath}`);
      return;
    }
    res.writeHead(200, {
      'Content-Type': TYPES[path.extname(filePath).toLowerCase()] || 'application/octet-stream',
      'Cache-Control': 'no-store',   // 編集内容がすぐ反映されるように
    });
    res.end(data);
  });
});

server.listen(PORT, () => {
  console.log(`\n  Setlist Lab — ローカルサーバー`);
  console.log(`  ローカル: http://localhost:${PORT}`);
  for (const [name, addrs] of Object.entries(os.networkInterfaces())) {
    for (const a of addrs || []) {
      if (a.family === 'IPv4' && !a.internal) {
        console.log(`  LAN(${name}): http://${a.address}:${PORT}   ← スマホ実機はこちら`);
      }
    }
  }
  console.log(`\n  停止: Ctrl+C\n`);
});
