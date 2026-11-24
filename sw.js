// Online-first: ia mereu versiunea nouă de pe net (verificată de fiecare dată, fără cache-ul vechi al browserului);
// din cache doar dacă netul pică sau e foarte lent. Fișierele au versiunea în adresă (?v=), deci nu se amestecă versiuni.
const V = '0.3.1';
const CACHE = 'constatari-v' + V;
const FILES = ['./', './index.html', `./style.css?v=${V}`, `./app.js?v=${V}`, `./lib/gifenc.js?v=${V}`, './date.bin.json', './manifest.webmanifest', './icons/icon-192.png', './icons/icon-512.png'];
self.addEventListener('install', e => {
  e.waitUntil(caches.open(CACHE).then(c => Promise.all(FILES.map(f => fetch(new Request(f, { cache: 'no-cache' })).then(r => r.ok && c.put(f, r)).catch(() => { })))));
  self.skipWaiting();
});
self.addEventListener('activate', e => {
  e.waitUntil(caches.keys().then(ks => Promise.all(ks.filter(k => k !== CACHE).map(k => caches.delete(k)))).then(() => self.clients.claim()));
});
// Semnal slab (casa scării, subsol): dacă rețeaua nu răspunde în 3,5 s, deschid din cache; rețeaua actualizează cache-ul în fundal.
self.addEventListener('fetch', e => {
  const req = e.request;
  if (req.method !== 'GET' || new URL(req.url).origin !== location.origin) return;
  const nav = req.mode === 'navigate';
  const proaspat = nav ? new Request(req.url, { cache: 'no-cache', credentials: 'same-origin' }) : new Request(req, { cache: 'no-cache' });
  const net = fetch(proaspat).then(res => {
    if (res.ok) { const copy = res.clone(); caches.open(CACHE).then(c => c.put(nav ? './index.html' : req, copy)); }
    return res;
  });
  e.waitUntil(net.then(() => { }, () => { }));
  e.respondWith((async () => {
    try { return await Promise.race([net, new Promise((_, rej) => setTimeout(() => rej(new Error('lent')), 3500))]); }
    catch (err) {
      const c = nav ? ((await caches.match('./index.html')) || (await caches.match('./'))) : await caches.match(req);   // exact, cu versiunea
      return c || net;
    }
  })());
});
