/* 水蓮社區巴士 PWA — Service Worker v37 (greenline, GitHub Pages 根目錄版)
 * --------------------------------------------------------------------------
 * 這個檔案假設自己被放在 repo 根目錄，也就是 https://sc0720mr.github.io/lhbs_pwa/
 * 因此所有路徑都以「相對本站根目錄」撰寫，不使用開頭的 '/'，
 * 否則在 GitHub Pages 的子路徑（/lhbs_pwa/）下會全部 404。
 *
 * 快取策略沿用原站契約：
 *   1) index.html / data/tdx_snapshot.json / service-worker.js → 網路優先，離線回退快取
 *   2) 其餘靜態資源（css / js / icon / 安裝步驟圖）→ 快取優先，未命中再抓並寫入
 *   3) activate 清掉非當前版本的快取
 *   4) 支援 SKIP_WAITING，讓頁面要求新版立即接手
 *
 * 換版時只要把 CACHE_VERSION 加一，使用者就不會卡在舊快取。
 *
 * ⚠️ 常見陷阱（v35 起特別標記）：
 *    index.html 的 ?v= 與這裡的 CACHE_VERSION 必須「一起」加一。
 *     只改其中一個，瀏覽器會因爲網址相同而命中舊快取，
 *     就會出現「檔案已經改了、畫面卻還是舊的」。
 * ------------------------------------------------------------------------ */

const CACHE_VERSION = 'v41';
const CACHE_NAME = 'lhbs-greenline-' + CACHE_VERSION;

/* 用相對路徑結尾比對，避免 absolute path 在子目錄下失效 */
const NETWORK_FIRST = [
  'index.html',
  'data/tdx_snapshot.json',
  'data/schedule-config.json',
  'service-worker.js'
];

/* 必須與磁碟上的實際檔案一一對應（見教學：APP_ASSETS 一致性檢查） */
const APP_ASSETS = [
  './',
  './index.html',
  './style.css',
  './manifest.json',
  './js/data.js',
  './js/holidays.js',
  './js/core.js',
  './data/tdx_snapshot.json',
  './data/schedule-config.json',
  './icon/favicon-32x32.png',
  './icon/favicon-128.png',
  './icon/icon-192.png',
  './icon/icon-512.png',
  './icon/icon-maskable-512.png',
  './icon/apple-touch-icon-180x180.png',
  /* 贊助 QR Code：離線也要看得到，所以加入預快取。
     換成自己的 QR 圖時，只要檔名路徑不變，这里就不用動。
  './images/linepay_qr.webp' */
];

self.addEventListener('install', event => {
  event.waitUntil(
    caches.open(CACHE_NAME).then(cache =>
      Promise.all(APP_ASSETS.map(url =>
        cache.add(url).catch(err => console.warn('[SW] 略過預快取：', url, err && err.message))
      ))
    )
  );
  self.skipWaiting();
});

self.addEventListener('activate', event => {
  event.waitUntil(
    caches.keys()
      .then(keys => Promise.all(
        /* 這個 origin 只有本 PWA 在用快取，所以「非當前版本一律刪」。
           從 v35 起不再只挑 'lhbs' 開頭的名字 —— 舊站曾用
           lhbs-pwa-v9 / lhbs-greenline-v34 等不同命名，
           限定前綴會漏掉它們，導致新舊快取並存。 */
        keys.filter(k => k !== CACHE_NAME).map(k => caches.delete(k))
      ))
      .then(() => self.clients.claim())
  );
});

self.addEventListener('message', event => {
  if (event.data && event.data.type === 'SKIP_WAITING') self.skipWaiting();
});

function isNetworkFirst(pathname) {
  return NETWORK_FIRST.some(p => pathname.endsWith(p));
}

self.addEventListener('fetch', event => {
  const req = event.request;
  if (req.method !== 'GET') return;

  const url = new URL(req.url);

  /* 跨網域（TDX 代理、Google Maps）一律放行，不快取，確保即時資料新鮮 */
  if (url.origin !== self.location.origin) {
    event.respondWith(fetch(req).catch(() => caches.match(req)));
    return;
  }

  if (isNetworkFirst(url.pathname) || url.pathname.endsWith('/')) {
    event.respondWith(
      fetch(req, { cache: 'no-store' })
        .then(response => {
          if (response && response.status === 200) {
            const cloned = response.clone();
            caches.open(CACHE_NAME).then(cache => cache.put(req, cloned));
          }
          return response;
        })
        .catch(() => caches.match(req).then(cached => cached || caches.match('./index.html')))
    );
    return;
  }

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
