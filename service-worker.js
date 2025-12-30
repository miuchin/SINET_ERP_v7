const CACHE_NAME = 'sinet-erp-v18-final';
const ASSETS = [
  '/',
  'index.html',
  'sinet_core_v7.js',
  '01_settings_v7.html',
  '04_invoice_v7.html',
  '12_tasks_v16.html',
  'https://cdn.tailwindcss.com',
  'https://cdnjs.cloudflare.com/ajax/libs/qrcodejs/1.0.0/qrcode.min.js',
  'https://fonts.googleapis.com/icon?family=Material+Icons+Round'
];

self.addEventListener('install', (e) => {
  e.waitUntil(caches.open(CACHE_NAME).then((cache) => cache.addAll(ASSETS)));
});

self.addEventListener('fetch', (e) => {
  e.respondWith(
    caches.match(e.request).then((response) => response || fetch(e.request))
  );
});
