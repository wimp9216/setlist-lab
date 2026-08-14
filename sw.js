/* =========================================================
   Setlist Lab — Service Worker
   ---------------------------------------------------------
   アプリ本体（HTML/CSS/JS）だけをキャッシュして、
   オフラインでも保存済みデータを見られるようにする。

   API 応答はキャッシュしない。セトリは localStorage 側に
   保存済みで、古い応答を挟むと取得状況が分かりにくくなるため。
   ========================================================= */

const VERSION = 'setlist-lab-v1';

const SHELL = [
  './',
  './index.html',
  './css/style.css',
  './manifest.webmanifest',
  './icon.svg',
  './js/main.js',
  './js/store.js',
  './js/api.js',
  './js/ui.js',
  './js/normalize.js',
  './js/analyze.js',
  './js/audio.js',
  './js/charts.js',
  './js/features.js',
  './js/sample-data.js',
  './js/views/shows.js',
  './js/views/compare.js',
  './js/views/analyze-view.js',
  './js/views/myset.js',
  './js/views/attend.js',
  './js/views/songs.js',
  './js/views/settings.js',
  './js/views/setlist-view.js',
  './js/views/manual-editor.js',
  './js/views/scope-bar.js',
];

self.addEventListener('install', (e) => {
  e.waitUntil(
    caches.open(VERSION)
      // 1つでも欠けると全部失敗する addAll は使わず、取れたものだけ入れる
      .then((cache) => Promise.all(SHELL.map((url) => cache.add(url).catch(() => {}))))
      .then(() => self.skipWaiting())
  );
});

self.addEventListener('activate', (e) => {
  e.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== VERSION).map((k) => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', (e) => {
  const url = new URL(e.request.url);

  // 自分のオリジンの GET だけ扱う。API（setlist.fm / iTunes / MusicBrainz）は素通し。
  if (e.request.method !== 'GET' || url.origin !== self.location.origin) return;

  // アプリ本体は「ネットワーク優先・失敗したらキャッシュ」。
  // 更新したファイルが古いまま出続けるのを防ぐ。
  e.respondWith(
    fetch(e.request)
      .then((res) => {
        if (res && res.ok) {
          const copy = res.clone();
          caches.open(VERSION).then((c) => c.put(e.request, copy)).catch(() => {});
        }
        return res;
      })
      .catch(() => caches.match(e.request).then((hit) => hit || caches.match('./index.html')))
  );
});
