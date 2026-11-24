// Online-first: ia mereu versiunea nouă de pe net; din cache doar dacă pică netul.
const CACHE = 'constatari-v0.2.1';
const FILES = ['./', './index.html', './style.css', './app.js', './lib/gifenc.js', './manifest.webmanifest', './icons/icon-192.png', './icons/icon-512.png'];
self.addEventListener('install', e => { e.waitUntil(caches.open(CACHE).then(c => c.addAll(FILES))); self.skipWaiting(); });
self.addEventListener('activate', e => {
  e.waitUntil(caches.keys().then(ks => Promise.all(ks.filter(k => k !== CACHE).map(k => caches.delete(k)))).then(() => self.clients.claim()));
});
// Semnal slab (casa scării, subsol): dacă rețeaua nu răspunde în 3,5 s, deschid din cache; rețeaua actualizează cache-ul în fundal.
self.addEventListener('fetch', e => {
  const req = e.request;
  if (req.method !== 'GET' || new URL(req.url).origin !== location.origin) return;
  const net = fetch(req).then(res => {
    if (res.ok) { const copy = res.clone(); caches.open(CACHE).then(c => c.put(req, copy)); }
    return res;
  });
  e.waitUntil(net.then(() => { }, () => { }));
  e.respondWith((async () => {
    try { return await Promise.race([net, new Promise((_, rej) => setTimeout(() => rej(new Error('lent')), 3500))]); }
    catch (err) {
      const c = (await caches.match(req, { ignoreSearch: true })) || (req.mode === 'navigate' ? await caches.match('./index.html') : null);
      return c || net;
    }
  })());
});
