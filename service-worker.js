const CACHE_NAME = 'lhbs-pwa-v7';
const APP_ASSETS = ['./','./index.html','./manifest.json','./css/lhbs.css','./js/ad.js','./js/lhbs_114.js','./js/tdx_eta_v2.js?v=1','./data/tdx_snapshot.json','./icon/favicon-196x196.png','./icon/favicon-128.png','./icon/apple-touch-icon-152x152.png','./images/ios_step1.png','./images/ios_step2.png','./images/ios_step3.png','./images/ios_step4.png','./images/android_step1.png','./images/android_step2.png','./images/android_step3.png','./images/android_step4.png','./images/android_step5.png','./images/android_step6.png'];
self.addEventListener('install', event => { event.waitUntil(caches.open(CACHE_NAME).then(cache => cache.addAll(APP_ASSETS))); self.skipWaiting(); });
self.addEventListener('activate', event => { event.waitUntil(caches.keys().then(keys => Promise.all(keys.filter(k => k !== CACHE_NAME).map(k => caches.delete(k))))); self.clients.claim(); });
self.addEventListener('fetch', event => {
  const url = new URL(event.request.url);
  if (url.hostname.includes('transportdata.tw')) {
    event.respondWith(fetch(event.request).then(response => { const cloned = response.clone(); caches.open(CACHE_NAME).then(cache => cache.put(event.request, cloned)); return response; }).catch(() => caches.match(event.request)));
    return;
  }
  event.respondWith(caches.match(event.request).then(cached => cached || fetch(event.request).then(response => { const cloned = response.clone(); if (event.request.method === 'GET' && url.origin === self.location.origin) { caches.open(CACHE_NAME).then(cache => cache.put(event.request, cloned)); } return response; }).catch(() => caches.match('./index.html'))));
});
