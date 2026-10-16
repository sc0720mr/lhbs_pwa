/* 水蓮社區巴士 PWA — Service Worker
 *  v9 修正重點：解決「已更新 repo 但瀏覽器一直看到舊版」的問題。
 *
 *  1) index.html 與 data/tdx_snapshot.json 改為「網路優先」（network-first）：
 *     每次上線都先向伺服器要最新版，只有在離線時才回退到快取。
 *     舊版用 cache-first，會讓使用者永遠卡在第一次載入的舊 HTML。
 *  2) 其他靜態資源（圖示、圖片）維持「快取優先」以求速度，
 *     但帶有 ?v= 版號的 css/js 會因網址不同而自動取得新版。
 *  3) CACHE_NAME 升版，install 時清掉所有舊快取。
 *  4) 提供 SKIP_WAITING 訊息，讓頁面可主動要求新 SW 立即接手。
 */
const CACHE_NAME = 'lhbs-pwa-v9';

/* 需要「網路優先」的檔案：這兩個一旦被舊快取卡住，使用者就看不到更新 */
const NETWORK_FIRST = [
  './',
  './index.html',
  './data/tdx_snapshot.json',
  './service-worker.js'
];

const APP_ASSETS = [
  './',
  './index.html',
  './manifest.json',
  './css/lhbs.css?v=1.0.22',
  './js/ad.js?v=1.0.6',
  './js/lhbs_114.js?v=1.0.49',
  './js/tdx_eta_v2.js?v=3',
  './data/tdx_snapshot.json',
  './icon/favicon-196x196.png',
  './icon/favicon-128.png',
  './icon/apple-touch-icon-152x152.png',
  './images/ios_step1.png',
  './images/ios_step2.png',
  './images/ios_step3.png',
  './images/ios_step4.png',
  './images/android_step1.png',
  './images/android_step2.png',
  './images/android_step3.png',
  './images/android_step4.png',
  './images/android_step5.png',
  './images/android_step6.png'
];

self.addEventListener('install', event => {
  event.waitUntil(
    caches.open(CACHE_NAME)
      .then(cache => cache.addAll(APP_ASSETS))
      .catch(err => console.warn('[SW] 預快取部分失敗（略過）:', err && err.message))
  );
  self.skipWaiting();
});

self.addEventListener('activate', event => {
  event.waitUntil(
    caches.keys()
      .then(keys => Promise.all(keys.filter(k => k !== CACHE_NAME).map(k => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

/* 讓頁面可以主動要求新版 SW 立即接手 */
self.addEventListener('message', event => {
  if (event.data && event.data.type === 'SKIP_WAITING') self.skipWaiting();
});

function isNetworkFirst(pathname) {
  return NETWORK_FIRST.some(p => {
    const clean = p.replace(/^\.\//, '/');
    return pathname === clean || pathname.endsWith(clean) ||
           (clean === '/' && (pathname.endsWith('/') || pathname.endsWith('/index.html')));
  });
}

self.addEventListener('fetch', event => {
  const req = event.request;
  if (req.method !== 'GET') return;

  const url = new URL(req.url);

  /* TDX 官方 API：直接放行，不做快取（避免與代理端點混淆） */
  if (url.hostname.includes('transportdata.tw')) {
    event.respondWith(
      fetch(req).catch(() => caches.match(req))
    );
    return;
  }

  /* 跨網域（例如 Cloudflare Worker 代理）：直接放行，不快取，確保即時資料新鮮 */
  if (url.origin !== self.location.origin) {
    event.respondWith(fetch(req));
    return;
  }

  /* 網路優先：index.html、快照、SW 自身 —— 每次上線先要最新版，離線才回退快取 */
  if (isNetworkFirst(url.pathname)) {
    event.respondWith(
      fetch(req, { cache: 'no-store' })
        .then(response => {
          if (response && response.status === 200) {
            const cloned = response.clone();
            caches.open(CACHE_NAME).then(cache => cache.put(req, cloned));
          }
          return response;
        })
        .catch(() =>
          caches.match(req).then(cached => cached || caches.match('./index.html'))
        )
    );
    return;
  }

  /* 其餘靜態資源：快取優先（帶 ?v= 版號者，改版後網址不同即自動更新） */
  event.respondWith(
    caches.match(req).then(cached => {
      if (cached) return cached;
      return fetch(req).then(response => {
        if (response && response.status === 200) {
          const cloned = response.clone();
          caches.open(CACHE_NAME).then(cache => cache.put(req, cloned));
        }
        return response;
      }).catch(() => caches.match('./index.html'));
    })
  );
});
