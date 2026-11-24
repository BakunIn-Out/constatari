'use strict';
/* Constatări – v0.2
   Poză / video (GIF) + dictare pe teren -> asistentul AI (DeepSeek) scrie rândul și alege câmpurile.
   Clădirile / etajele / apartamentele / încăperile / firmele + cheia AI vin în date.bin.json, CRIPTAT cu codul echipei (linkul ?k=…)
   -> fișier compatibil cu „Combina backup-uri” din aplicația de verificări.
   Datele stau pe telefon (IndexedDB). Spre AI (doar când completează) pleacă textul + imaginile constatării
   și câteva rânduri-exemplu din backup-ul importat (ca să scrie în același stil). */

const APP_VER = '0.5.2';
// pagină veche (din cache) + cod nou -> nu pornesc pe jumătate: șterg memoria veche și redeschid curat
if (document.documentElement.getAttribute('data-ver') !== APP_VER) {
  (window.reparaAplicatia || function () {
    if (navigator.onLine === false) return;
    try { if (Date.now() - Number(sessionStorage.getItem('constatari_repar') || 0) < 60000) return; sessionStorage.setItem('constatari_repar', String(Date.now())); } catch (e) { }
    const gata = () => { const u = new URL(location.href); u.searchParams.set('r', Date.now()); u.hash = ''; location.replace(u.toString()); };
    Promise.all([
      window.caches ? caches.keys().then(k => Promise.all(k.map(x => caches.delete(x)))) : 0,
      navigator.serviceWorker ? navigator.serviceWorker.getRegistrations().then(r => Promise.all(r.map(x => x.unregister()))) : 0
    ]).then(gata, gata); setTimeout(gata, 3000);
  })(false);
  throw new Error('versiune veche în memoria browserului - repar');
}
window.addEventListener('unhandledrejection', e => {
  if (window.__aplicatiaPornita) return;            // după pornire, erorile mărunte nu blochează ecranul
  const b = document.getElementById('eroare'); if (!b) return;
  b.querySelector('.msg').textContent = (e.reason && e.reason.message) || String(e.reason);
  b.hidden = false; const l = document.getElementById('incarc'); if (l) l.hidden = true;
});
const LS = { user: 'constatari_user', ses: 'constatari_sesiune', cod: 'constatari_cod', pachet: 'constatari_pachet', pachetCt: 'constatari_pachet_ct' };
const DEF = {
  locatii: [], etaje: {}, apartamente: {},
  camere: ['Baie', 'Bucatarie', 'Living', 'Dormitor', 'Hol intrare', 'Hol interior', 'Balcon'],
  camere_apt: {}, specialitati: [], specialitatiZone: {},
  tipuri: ['Neconformitate', 'Lipsa', 'Neterminat', 'Deteriorare', 'Altele', 'In lucru', 'Curatenie'],
  responsabili: [], prioritati: ['Urgent', 'Normal', 'Minor']
};
const CFG_KEYS = Object.keys(DEF);
const CAMERE_COMUNE = /^(baie|bucatarie|living|dormitor|hol|balcon|terasa|logie|debara|dressing)/i;

const $ = id => document.getElementById(id);
const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const head = (t, sub = '') => { $('title').textContent = t; $('subtitle').textContent = sub; };
const icon = n => `<svg><use href="#i-${n}"/></svg>`;
const pad = n => String(n).padStart(2, '0');
const isoDate = d => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
const roDateTime = d => `${pad(d.getDate())}/${pad(d.getMonth() + 1)}/${d.getFullYear()} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
const addDays = n => { const d = new Date(); d.setDate(d.getDate() + (Number(n) || 0)); return isoDate(d); };
const fara = s => String(s ?? '').normalize('NFD').replace(/[\u0300-\u036f]/g, '');   // fără diacritice
const cheie = s => fara(s).toLowerCase().replace(/\s+/g, ' ').trim();
const isGif = p => String(p).startsWith('data:image/gif');
const pauza = ms => new Promise(r => setTimeout(r, ms));

/* ---------------- stocare ---------------- */
let PACHET = null, cfg = { ...DEF };
function aplicaPachet(pk) { PACHET = pk; cfg = { ...DEF, ...(pk.cfg || {}) }; }
const normCod = x => String(x || '').toUpperCase().replace(/[^A-Z0-9]/g, '');
const b64 = x => Uint8Array.from(atob(x), c => c.charCodeAt(0));
async function decripteaza(cod, bin) {
  const baza = await crypto.subtle.importKey('raw', new TextEncoder().encode(cod), 'PBKDF2', false, ['deriveKey']);
  const k = await crypto.subtle.deriveKey({ name: 'PBKDF2', salt: b64(bin.salt), iterations: bin.it, hash: 'SHA-256' }, baza, { name: 'AES-GCM', length: 256 }, false, ['decrypt']);
  const pt = await crypto.subtle.decrypt({ name: 'AES-GCM', iv: b64(bin.iv) }, k, b64(bin.ct));
  return JSON.parse(new TextDecoder().decode(pt));
}
// aduce date.bin.json; dacă s-a schimbat (sau nu am nimic), îl decriptează cu codul echipei. Codul greșit -> eroare.
async function incarcaDate(cod, fortat) {
  const r = await fetch('date.bin.json', { cache: 'no-cache' });
  if (!r.ok) throw new Error('nu găsesc datele');
  const bin = await r.json();
  const sem = bin.ct.slice(0, 64);
  if (!fortat && PACHET && localStorage.getItem(LS.pachetCt) === sem) return false;
  const pk = await decripteaza(cod, bin);
  aplicaPachet(pk);
  try { localStorage.setItem(LS.cod, cod); localStorage.setItem(LS.pachet, JSON.stringify(pk)); localStorage.setItem(LS.pachetCt, sem); }
  catch (e) { toast('Memorie plină', 6000); }
  return true;
}
let ses = { locatie: '', etaj: '', apt: '', spec: '', tip: 'Neconformitate', prioritate: 'Normal', resp: [], termenZile: 3 };
try { Object.assign(ses, JSON.parse(localStorage.getItem(LS.ses) || '{}')); } catch (e) { }
Object.assign(ses, { spec: '', tip: 'Neconformitate', prioritate: 'Normal', resp: [], termenZile: 3 }); delete ses.specAles; delete ses.tipAles;
const saveSes = () => localStorage.setItem(LS.ses, JSON.stringify(ses));
const getUser = () => (localStorage.getItem(LS.user) || '').trim();
function stil() { return (PACHET && PACHET.stil) || { exemple: [], respPeSpec: {} }; }

let _db;
function db() {
  if (_db) return Promise.resolve(_db);
  return new Promise((res, rej) => {
    const r = indexedDB.open('constatari', 3);
    r.onupgradeneeded = e => {
      const d = r.result, t = r.transaction;
      if (!d.objectStoreNames.contains('obs')) d.createObjectStore('obs', { keyPath: 'id' });
      if (!d.objectStoreNames.contains('draft')) d.createObjectStore('draft', { keyPath: 'k' });
      if (!d.objectStoreNames.contains('poze')) d.createObjectStore('poze', { keyPath: 'id' });
      // constatările vechi (pozele în aceeași înregistrare) se mută la pornire, câte una: vezi reload()
    };
    r.onsuccess = () => {
      const d = r.result; _db = d;
      d.onversionchange = () => { try { d.close(); } catch (e) { } if (_db === d) _db = null; };
      d.onclose = () => { if (_db === d) _db = null; };
      res(d);
    };
    r.onerror = () => rej(r.error);
    r.onblocked = () => toast('Închide celelalte ferestre și reîncarcă', 6000);
  });
}
async function tx(store, mode, fn, retry = true) {
  let d;
  try {
    d = await db();
    return await new Promise((res, rej) => {
      const t = d.transaction(store, mode); const out = fn(Array.isArray(store) ? t : t.objectStore(store));
      t.oncomplete = () => res(out && 'result' in out ? out.result : undefined);
      t.onerror = () => rej(t.error); t.onabort = () => rej(t.error || new Error('memorie plină?'));
    });
  } catch (e) {
    const pierdut = e && (e.name === 'InvalidStateError' || e.name === 'UnknownError' || /connection|closing|closed/i.test(e.message || ''));
    if (retry && pierdut) { try { d && d.close(); } catch (x) { } _db = null; return tx(store, mode, fn, false); }
    if (e && e.name === 'QuotaExceededError') throw new Error('memoria telefonului e plină: exportă și șterge ce ai exportat');
    throw e;
  }
}
// constatarea „ușoară” (fără pozele mari): asta stă în listă și în memorie; pozele se citesc doar la deschidere / trimitere
function usoara(r) {
  const { poze, poza, ...o } = r;
  if (Array.isArray(poze)) { o.nPoze = poze.length; o._meta = { ...(o._meta || {}), gif: isGif(poze[0] || '') }; }
  else o.nPoze = o.nPoze || 0;
  return o;
}
const dbAll = () => tx('obs', 'readonly', st => st.getAll());
const dbPut = rec => tx('obs', 'readwrite', st => st.put(usoara(rec)));               // doar datele, pozele rămân neatinse
const dbSalveaza = (rec, poze) => tx(['obs', 'poze'], 'readwrite', t => { t.objectStore('obs').put(usoara({ ...rec, poze })); t.objectStore('poze').put({ id: rec.id, poze }); });
const dbPoze = id => tx('poze', 'readonly', st => st.get(id)).then(x => (x && x.poze) || []);
const dbPatch = (id, fn) => tx('obs', 'readwrite', st => { const g = st.get(id); g.onsuccess = () => { if (g.result) st.put(fn(g.result)); }; });
const patchMeta = async (id, m) => { await dbPatch(id, x => ({ ...x, _meta: { ...(x._meta || {}), ...m } })); const c = all.find(x => x.id === id); if (c) c._meta = { ...(c._meta || {}), ...m }; };
const dbDel = id => tx(['obs', 'poze'], 'readwrite', t => { t.objectStore('obs').delete(id); t.objectStore('poze').delete(id); });

let all = [];
async function reload() {
  const l = await dbAll();
  for (const r of l.filter(x => Array.isArray(x.poze))) { try { await dbSalveaza(r, r.poze); } catch (e) { } }   // rămășițe în formatul vechi
  all = l.map(usoara).sort((a, b) => (a._ts || 0) - (b._ts || 0));
}
// miniaturi pentru constatările vechi care nu au (una câte una, în fundal)
async function completeazaMiniaturi() {
  for (const r of all.filter(x => x.nPoze && !(x._meta && x._meta.thumb))) {
    try { const pz = await dbPoze(r.id); if (!pz[0]) continue; await patchMeta(r.id, { thumb: await imgToJpeg(pz[0], 200, 0.7) }); } catch (e) { }
  }
}
function inLista(rec) { all = all.filter(r => r.id !== rec.id); all.push(rec); }
function dinLista(id) { all = all.filter(r => r.id !== id); }

/* ciorna constatării în lucru: dacă telefonul închide pagina (camera, apel, baterie), o recuperăm */
let draftT, pozeVer = 0, pozeVerSalvat = -1;
function saveDraftSoon() { clearTimeout(draftT); draftT = setTimeout(saveDraftNow, 400); }
async function saveDraftNow() {
  clearTimeout(draftT);
  if (curView !== 'obs' || !edit || saving) return;
  try {
    readForm();
    const { poze, ...rest } = edit; rest.poza = '';
    const ver = pozeVer, cuPoze = ver !== pozeVerSalvat;
    await tx('draft', 'readwrite', st => { st.put({ k: 'cur', edit: rest, atins, orig: editOrig, ts: Date.now() }); if (cuPoze) st.put({ k: 'poze', poze: poze.slice() }); });
    if (cuPoze) pozeVerSalvat = ver;
  } catch (e) { }
}
const dropDraft = () => { clearTimeout(draftT); pozeVerSalvat = -1; return tx('draft', 'readwrite', st => { st.delete('cur'); st.delete('poze'); }).catch(() => { }); };
async function getDraft() {
  try {
    const [c, z] = await Promise.all([tx('draft', 'readonly', st => st.get('cur')), tx('draft', 'readonly', st => st.get('poze'))]);
    if (c && c.edit) c.edit.poze = (z && z.poze) || [];
    return c;
  } catch (e) { return null; }
}
document.addEventListener('visibilitychange', () => {
  if (!document.hidden) return;
  if (micOn) stopMic(false);                       // camera / apel: nu las microfonul pornit în fundal
  if (camStream) { inchideCamera(); if (edit) onFormChange(); }
  saveDraftNow();
});

/* ---------------- UI mărunt ---------------- */
let toastT, toastAt = 0;
function toast(msg, ms = 2200) {
  toastAt = Date.now();
  if (!$('sheet').hidden) return;                   // nu acopăr butoanele ferestrei Salvează / Nu salva
  const t = $('toast'); t.textContent = msg; t.hidden = false;
  clearTimeout(toastT); toastT = setTimeout(() => { t.hidden = true; }, ms);
}

// câmp = <select> dacă avem listă, altfel <input> liber
function field(id, list, value, ph, onchange) {
  const box = $(id); box.innerHTML = '';
  let el;
  if (list && list.length > 8) {
    el = document.createElement('button'); el.type = 'button'; el.className = 'pick';
    const pune = v => { el.value = v || ''; el.textContent = v || `— ${ph || 'alege'} —`; el.classList.toggle('empty', !v); };
    pune(value);
    el.onclick = e => {
      e.preventDefault();
      alegeDinLista((ph || 'alege').replace(/^./, c => c.toUpperCase()), list, el.value, v => { pune(v); el.dispatchEvent(new Event('change')); });
    };
  } else if (list && list.length) {
    el = document.createElement('select');
    const opts = list.slice();
    if (value && !opts.includes(value)) opts.push(value);
    el.innerHTML = `<option value="">— ${esc(ph || 'alege')} —</option>` + opts.map(v => `<option>${esc(v)}</option>`).join('');
    el.value = value || '';
    const upd = () => el.classList.toggle('empty', !el.value); upd(); el.addEventListener('change', upd);
  } else {
    el = document.createElement('input'); el.type = 'text'; el.placeholder = ph || ''; el.value = value || '';
    if (onchange) el.addEventListener('input', onchange);
  }
  if (onchange) el.addEventListener('change', onchange);
  box.appendChild(el);
  return el;
}
const val = id => { const e = $(id) && $(id).firstElementChild; return e ? e.value.trim() : ''; };

// chips cu selecție
function makeChips(id, items, selected, multi = true, onchange) {
  const box = $(id);
  const st = { items: items.slice(), sel: new Set(selected || []) };
  (selected || []).forEach(s => { if (s && !st.items.includes(s)) st.items.push(s); });
  function draw() {
    box.innerHTML = '';
    st.items.forEach(v => {
      const b = document.createElement('button'); b.type = 'button';
      b.className = 'chip' + (st.sel.has(v) ? ' on' : ''); b.textContent = v;
      b.onclick = () => {
        if (st.sel.has(v)) st.sel.delete(v); else { if (!multi) st.sel.clear(); st.sel.add(v); }
        draw(); if (onchange) onchange();
      };
      box.appendChild(b);
    });
    if (!st.items.length) box.innerHTML = '';
  }
  draw();
  return {
    get: () => st.items.filter(v => st.sel.has(v)),
    add: v => { if (!v) return; if (!st.items.includes(v)) st.items.push(v); if (!multi) st.sel.clear(); st.sel.add(v); draw(); },
    set: list => { st.sel = new Set(); (list || []).forEach(v => { if (!st.items.includes(v)) st.items.push(v); st.sel.add(v); }); draw(); }
  };
}

function alegeDinLista(titlu, lista, curent, cb) {
  const sh = $('picker'), q = $('pkCauta'), box = $('pkLista');
  $('pkTitlu').textContent = titlu; q.value = ''; sh.hidden = false;
  const inchide = () => { sh.hidden = true; q.oninput = null; };
  const deseneaza = () => {
    const k = cheie(q.value);
    const vis = lista.filter(v => !k || cheie(v).includes(k));
    box.innerHTML = '';
    vis.forEach(v => {
      const b = document.createElement('button'); b.type = 'button'; b.className = 'pkrow' + (v === curent ? ' on' : ''); b.textContent = v;
      b.onclick = () => { inchide(); cb(v); };
      box.appendChild(b);
    });
    if (!vis.length) box.innerHTML = '<div class="info">Nimic</div>';
    box.scrollTop = 0;
  };
  q.oninput = deseneaza; deseneaza();
  $('pkInchide').onclick = inchide;
  sh.onclick = e => { if (e.target === sh) inchide(); };
}

/* ---------------- liste din config ---------------- */
const etajePt = loc => (cfg.etaje && cfg.etaje[loc]) || [];
const aptPt = (loc, etaj) => (cfg.apartamente && cfg.apartamente[`${loc}|${etaj}`]) || [];
const specPt = (loc, etaj) => (cfg.specialitatiZone && cfg.specialitatiZone[`${loc}|${etaj}`]) || cfg.specialitati || [];
// „Living / Bucatarie” = open space: apare DOAR la apartamentele care îl au în lista lor (ex. garsoniera A_12), nu și la „Altă încăpere”
const combinata = c => / \/ /.test(c);
function camerePt(loc, etaj, apt) {
  const ca = cfg.camere_apt || {}; const pref = `${loc}|${etaj}|`;
  const m = String(apt).match(/^([A-Za-z]+)\d+\.(\d+)$/);           // A1.04 -> A_04
  if (m) {
    const tip = `${m[1].toUpperCase()}_${m[2]}`;
    const k = Object.keys(ca).find(k => k.startsWith(pref) && (k.slice(pref.length) === tip || k.slice(pref.length).startsWith(tip + ' ')));
    if (k && ca[k].length) return ca[k];
  }
  if (ca[pref + apt] && ca[pref + apt].length) return ca[pref + apt];
  const kz = Object.keys(ca).find(k => k.startsWith(pref + apt));   // ex. „Casa de scara” -> „Casa de scara A”
  if (kz && ca[kz].length) return ca[kz];
  const comune = (cfg.camere || []).filter(c => CAMERE_COMUNE.test(c)).slice(0, 14);
  return comune.length ? comune : DEF.camere;
}
const toateCamerele = ed => [...new Set([...camerePt(ed.locatie, ed.etaj, ed.apt), ...(cfg.camere || [])])];
function urmApt() { const l = aptPt(ses.locatie, ses.etaj); const i = l.indexOf(ses.apt); return i >= 0 && i < l.length - 1 ? l[i + 1] : ''; }

/* ---------------- navigare (butonul Înapoi al telefonului merge ca în aplicație) ---------------- */
const VIEWS = { start: 'vStart', apt: 'vApt', obs: 'vObs', gata: 'vGata', setari: 'vSetari', lock: 'vLock', mele: 'vMele' };
let curView = null;
let formDirty = false;
// istoricul nostru: fiecare intrare știe la ce adâncime e (d), așa că Înapoi / Înainte / reîncărcarea rămân corecte
let nav = { stack: [], pos: -1 };
const navSave = () => { try { sessionStorage.setItem('constatari_nav', JSON.stringify(nav)); } catch (e) { } };
function navPush(v) { if (nav.pos >= 0 && nav.stack[nav.pos] === v) { navReplace(v); return; }   // dublu-tap: nu dublez intrarea
  nav.pos++; nav.stack.length = nav.pos; nav.stack.push(v); history.pushState({ v, d: nav.pos }, '', '#' + v); navSave(); }
function navReplace(v) { if (nav.pos < 0) nav.pos = 0; nav.stack[nav.pos] = v; history.replaceState({ v, d: nav.pos }, '', '#' + v); navSave(); }
const prevView = () => nav.pos > 0 ? nav.stack[nav.pos - 1] : null;
const hashView = () => { const v = (location.hash || '').slice(1); return VIEWS[v] ? v : 'start'; };
const parinte = v => ({ obs: 'apt', apt: 'start', gata: ses.apt ? 'apt' : 'start' }[v] || 'start');
function go(v, replace) {
  if (saving && curView === 'obs' && v !== 'obs') return;
  if (curView === 'obs' && v !== 'obs') { if (obsNesalvata()) { intreabaIesire(() => go(v, replace)); return; } aruncObs(); }
  if (replace || nav.pos < 0) navReplace(v); else navPush(v);
  show(v);
}
window.addEventListener('popstate', e => {
  const v = hashView();
  const d = e.state && Number.isInteger(e.state.d) ? e.state.d : null;
  if (d !== null) { nav.pos = d; nav.stack[d] = v; }
  else { nav.pos++; nav.stack.length = nav.pos; nav.stack.push(v); history.replaceState({ v, d: nav.pos }, '', '#' + v); }
  const deschisa = ['cam', 'picker', 'sheet', 'shFisier'].find(id => !$(id).hidden);
  if (deschisa && curView && v !== curView) {
    if (deschisa === 'shFisier') $('sfRenunta').click(); else if (deschisa === 'cam') $('camGata').click(); else $(deschisa).hidden = true;
    navPush(curView); return;
  }
  if (saving && curView === 'obs' && v !== 'obs') { navPush('obs'); toast('Salvez…'); return; }
  if (curView === 'obs' && v !== 'obs') {
    if (obsNesalvata()) { navPush('obs'); intreabaIesire(() => history.back()); return; }
    aruncObs();
  }
  navSave();
  show(v);
});
const obsNesalvata = () => !!edit && formDirty && !saving;
function aruncObs() {
  if (!edit || saving) return;
  formDirty = false; opresteMic(); ai.seq++; dropDraft(); uitaCadre(edit); edit = null;
}
// în loc de confirm() (unde „OK” = aruncă, apăsat din reflex): trei butoane clare
function intreabaIesire(dupaAruncare) {
  const sh = $('sheet'); sh.hidden = false; clearTimeout(toastT); $('toast').hidden = true;
  const inchide = () => { sh.hidden = true; };
  $('shSalv').onclick = () => { inchide(); saveForm(); };
  $('shArunc').onclick = () => { inchide(); aruncObs(); dupaAruncare(); };
  $('shRamai').onclick = inchide;
  sh.onclick = e => { if (e.target === sh) inchide(); };
}
function show(v) {
  if (!PACHET) v = 'lock'; else if (!VIEWS[v] || v === 'lock') v = 'start';
  if (v === 'obs' && !edit) v = ses.apt ? 'apt' : 'start';
  if (v === 'apt' && !ses.apt) v = 'start';
  if (location.hash !== '#' + v || !history.state || history.state.d !== nav.pos) navReplace(v);
  const vechi = curView; curView = v;
  window.__aplicatiaPornita = true; $('incarc').hidden = true;
  if (vechi !== v && Date.now() - toastAt > 700) { clearTimeout(toastT); $('toast').hidden = true; }
  Object.entries(VIEWS).forEach(([k, id]) => { $(id).hidden = k !== v; });
  $('btnBack').hidden = v === 'start' || v === 'lock';
  $('btnSetari').hidden = v !== 'start';
  if (v !== 'obs') stopMic(true);
  ({ start: renderStart, apt: renderApt, obs: renderObs, gata: renderGata, setari: renderSetari, lock: renderLock, mele: renderMele })[v]();
  window.scrollTo(0, 0);
}
$('btnBack').onclick = () => nav.pos > 0 ? history.back() : go(parinte(curView), true);
$('btnSetari').onclick = () => go('setari');

/* ---------------- BLOCAT (fără codul echipei) ---------------- */
function renderLock() { head('Constatări', ''); }
$('btnCod').onclick = async () => {
  const cod = normCod($('inCod').value);
  $('lockErr').hidden = true;
  if (!cod) { $('inCod').focus(); return; }
  $('btnCod').disabled = true;
  try { await incarcaDate(cod, true); go('start', true); }
  catch (e) { $('lockErr').textContent = e.name === 'OperationError' ? 'Cod greșit' : 'Fără internet'; $('lockErr').hidden = false; }
  finally { $('btnCod').disabled = false; }
};

/* ---------------- START: unde ești (corp -> etaj -> apartament, din butoane mari) ---------------- */
const IOS = /iPhone|iPad|iPod/i.test(navigator.userAgent) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
const standalone = () => navigator.standalone === true || (window.matchMedia && matchMedia('(display-mode: standalone)').matches);
let alegere = { loc: '', etaj: '' };
const eLocuinte = loc => /^L\d/i.test(loc);
const scurtEtaj = e => e === 'Parter' ? 'P' : String(e).replace(/^Etaj\s+/i, '');
function placa(text, on, onclick, sub) {
  const b = document.createElement('button'); b.type = 'button'; b.className = 'tile-b' + (on ? ' on' : '');
  b.innerHTML = esc(text) + (sub ? `<span class="n">${esc(sub)}</span>` : ''); b.onclick = onclick; return b;
}
const laVedere = id => setTimeout(() => { const e = $(id); if (e && !e.hidden) e.scrollIntoView({ behavior: 'smooth', block: 'start' }); }, 60);
function nrPe(loc, etaj, apt) {
  const n = all.filter(r => r.locatie === loc && (etaj == null || r.etaj === etaj) && (apt == null || r.apt === apt)).length;
  return n ? String(n) : '';
}
function renderStart() {
  head('Constatări', '');
  $('verApp').textContent = 'v ' + APP_VER.split('.').slice(0, 2).join('.');
  $('iosWarn').hidden = !(IOS && !standalone());
  const cont = !!ses.apt && aptPt(ses.locatie, ses.etaj).includes(ses.apt);
  $('btnContinua').hidden = !cont;
  if (cont) { $('contApt').textContent = ses.apt; $('contLoc').textContent = `${ses.locatie} · ${ses.etaj}`; }
  if (!alegere.loc && ses.locatie) alegere = { loc: ses.locatie, etaj: ses.etaj };
  drawLoc();
  const neexp = all.filter(r => !r._meta?.exportat).length;
  $('stNoi').textContent = neexp ? String(neexp) : '';
  $('stTot').textContent = all.length ? String(all.length) : '';
}
function drawLoc() {
  const g = $('gLoc'); g.innerHTML = '';
  (cfg.locatii || []).forEach(l => g.appendChild(placa(l, l === alegere.loc, () => {
    alegere = { loc: l, etaj: '' }; drawLoc(); laVedere(etajePt(l).length > 1 ? 'blocEtaj' : 'blocApt');
  })));
  const et = alegere.loc ? etajePt(alegere.loc) : [];
  if (et.length === 1) alegere.etaj = et[0];                 // Exterior / Învelitoare: un singur „etaj” -> nu mai întreb
  $('blocEtaj').hidden = et.length <= 1;
  const ge = $('gEtaj'); ge.innerHTML = '';
  et.forEach(e => ge.appendChild(placa(scurtEtaj(e), e === alegere.etaj, () => { alegere.etaj = e; drawLoc(); laVedere('blocApt'); })));
  const ap = alegere.loc && alegere.etaj ? aptPt(alegere.loc, alegere.etaj) : [];
  $('blocApt').hidden = !ap.length;
  $('lblApt').innerHTML = `<span class="nr">${et.length > 1 ? 3 : 2}</span>${eLocuinte(alegere.loc) ? 'Apartamentul' : 'Zona'}`;
  const ga = $('gApt'); ga.innerHTML = '';
  ga.className = ap.every(a => String(a).length <= 7) ? 'tiles small' : 'tiles';
  ap.forEach(a => ga.appendChild(placa(a, false, () => {
    ses.locatie = alegere.loc; ses.etaj = alegere.etaj; ses.apt = a; saveSes(); go('apt');
  }, nrPe(alegere.loc, alegere.etaj, a))));
}
$('btnContinua').onclick = () => go('apt');
$('btnLaGata').onclick = () => go('gata');
$('btnMele').onclick = () => { $('meleCauta').value = ''; go('mele'); };
$('meleCauta').addEventListener('input', () => renderMele());

/* ---------------- CONSTATĂRILE MELE: tot ce e pe telefon, grupat pe apartamente ---------------- */
let filtruMele = 'toate';
function renderMele() {
  head('Constatările mele', `${all.length} pe acest telefon`);
  const k = cheie($('meleCauta').value);
  const potriveste = r => !k || cheie([r.apt, r.locatie, r.etaj, r.inc, r.obs, r.spec, r.tip, (r.resp || []).join(' ')].join(' ')).includes(k);
  const recs = (filtruMele === 'netrimise' ? all.filter(r => !r._meta?.exportat) : all).filter(potriveste).slice().sort((a, b) => (b._ts || 0) - (a._ts || 0));
  $('meleEmpty').hidden = !!recs.length;
  const grupe = new Map();
  recs.forEach(r => { const k = `${r.locatie}|${r.etaj}|${r.apt}`; if (!grupe.has(k)) grupe.set(k, []); grupe.get(k).push(r); });
  const box = $('meleList'); box.innerHTML = '';
  grupe.forEach(l => {
    const r0 = l[0];
    const h = document.createElement('button'); h.type = 'button'; h.className = 'grup';
    h.innerHTML = `<b>${esc(r0.apt)}</b><span class="gl">${esc(r0.locatie)} · ${esc(r0.etaj)}</span><span class="pill">${l.length}</span>${icon('next')}`;
    h.setAttribute('aria-label', `Deschide ${r0.apt}`);
    h.onclick = () => { ses.locatie = r0.locatie; ses.etaj = r0.etaj; ses.apt = r0.apt; saveSes(); go('apt'); };
    const lst = document.createElement('div'); lst.className = 'list';
    l.forEach(r => { const d = document.createElement('button'); d.type = 'button'; d.className = 'item'; d.innerHTML = itemHtml(r); d.onclick = () => openObs(r); lst.appendChild(d); });
    box.appendChild(h); box.appendChild(lst);
  });
  document.querySelectorAll('#vMele .filtre .chip').forEach(b => {
    b.classList.toggle('on', b.dataset.f === filtruMele);
    b.onclick = () => { filtruMele = b.dataset.f; renderMele(); };
  });
}

/* ---------------- APARTAMENT ---------------- */
function recsApt() { return all.filter(r => r.locatie === ses.locatie && r.etaj === ses.etaj && r.apt === ses.apt); }
function itemHtml(r) {
  const n = r.nPoze || 0, gif = !!(r._meta && r._meta.gif);
  const src = r._meta && r._meta.thumb;
  const img = n && src ? `<span class="phw"><img class="ph" src="${src}" alt="" loading="lazy">${gif ? '<span class="badge">VIDEO</span>' : ''}</span>` : `<div class="ph">${icon(n ? 'image' : 'note')}</div>`;
  const media = !n ? '' : gif ? (n > 1 ? `video + ${n - 1} ${n - 1 === 1 ? 'poză' : 'poze'}` : 'video') : `${n} ${n === 1 ? 'poză' : 'poze'}`;
  const meta = [r.tip, r.spec, (r.resp || []).join(' / '), media].filter(Boolean).map(esc).join(' · ');
  const exp = r._meta?.exportat ? ` <span class="pill ok">${icon('check')}trimisă</span>` : '';
  return `${img}<div class="body"><div class="room">${esc(r.inc || 'Fără încăpere')}</div>
    <div class="d">${esc(r.obs || '(fără descriere)')}</div><div class="m">${meta}${exp}</div></div>`;
}
function renderApt() {
  head(ses.apt, `${ses.locatie} · ${ses.etaj}`);
  const list = recsApt();
  $('aptEmpty').hidden = !!list.length;
  const box = $('aptList'); box.innerHTML = '';
  list.slice().reverse().forEach(r => {
    const d = document.createElement('button'); d.type = 'button'; d.className = 'item'; d.innerHTML = itemHtml(r);
    d.onclick = () => openObs(r); box.appendChild(d);
  });
  $('btnCopiazaTot').hidden = !list.length;
  const u = urmApt();
  $('btnAptUrm').hidden = !u;
  $('btnAptUrm').innerHTML = `<small>Următorul</small><b>${esc(u)} ›</b>`;
  $('btnAptUrm').setAttribute('aria-label', 'Apartamentul următor: ' + u);
}
$('btnNou').onclick = () => openObs(null);
$('btnCopiazaTot').onclick = () => alegeApt({ locatie: ses.locatie, etaj: ses.etaj, apt: ses.apt }, async dest => {
  const n = await copiazaIn(recsApt(), dest); toast(`Copiate ${n} în ${dest.apt}`);
});

/* ---------------- COPIERE în alt apartament (aceleași probleme; fără poze: pozele sunt din apartamentul vechi) ---------------- */
function toateApt() {
  const out = [];
  Object.entries(cfg.apartamente || {}).forEach(([k, l]) => { const [loc, et] = k.split('|'); (l || []).forEach(a => out.push({ loc, et, apt: a, lbl: `${a} · ${loc} · ${et}` })); });
  return out;
}
function alegeApt(din, cb) {
  const l = toateApt().filter(x => !(x.loc === din.locatie && x.et === din.etaj && x.apt === din.apt));
  const scor = x => (x.loc === din.locatie ? 2 : 0) + (x.et === din.etaj ? 1 : 0);
  const ord = l.map((x, i) => [x, i]).sort((a, b) => scor(b[0]) - scor(a[0]) || a[1] - b[1]).map(([x]) => x);
  alegeDinLista('Copiază în', ord.map(x => x.lbl), '', lbl => { const d = ord.find(x => x.lbl === lbl); if (d) cb(d); });
}
async function copiazaIn(recs, dest) {
  let n = 0;
  for (const r of recs) {
    const now = new Date();
    const c = JSON.parse(JSON.stringify(r)); delete c.poze; delete c.poza; delete c._farePoze;
    Object.assign(c, { id: genId(), _ts: Date.now() + n, dataOra: roDateTime(now), dataObs: isoDate(now), locatie: dest.loc, etaj: dest.et, apt: dest.apt, nPoze: 0,
      _meta: { ...(r._meta || {}), exportat: null, thumb: '', gif: false, copiatDin: r.id } });
    try { await dbSalveaza(c, []); inLista(usoara({ ...c, poze: [] })); n++; } catch (e) { toast('Nu am putut copia: ' + e.message, 5000); break; }
  }
  return n;
}
$('btnAptUrm').onclick = () => {
  const u = urmApt(); if (!u) return;
  ses.apt = u; saveSes(); renderApt(); window.scrollTo(0, 0); toast('Acum: ' + u);
};

/* ---------------- FORMULAR ---------------- */
let edit = null, incChips, respObs;
let atins = { inc: false, spec: false, tip: false };       // ce a ales omul de mână (AI-ul nu le mai schimbă)
const cadreGif = new Map();                                  // GIF (după amprentă scurtă) -> 3 cadre JPEG pentru AI
const fp = u => String(u).length + ':' + String(u).slice(-64);
const uitaCadre = e => (e && e.poze || []).forEach(x => cadreGif.delete(fp(x)));
const inLucru = [];                                          // poze care se micșorează / video-uri care devin GIF, acum
let saving = false, editOrig = null, coadaVideo = Promise.resolve();
const amprenta = r => JSON.stringify([r.inc, r.obs, r.spec, r.tip, r.prioritate, r.termen, r.resp, (r.poze || []).map(p => p.length + p.slice(-48))]);
function genId() {
  const pre = getUser() || 'teren';
  for (;;) {
    const id = `${pre}-${Date.now()}${String(Math.floor(Math.random() * 1000)).padStart(3, '0')}`;
    if (!all.some(r => r.id === id)) return id;
  }
}
function newRec() {
  const now = new Date();
  return {
    id: null, dataOra: roDateTime(now), _ts: 0,
    locatie: ses.locatie, etaj: ses.etaj, apt: ses.apt, inc: '', obs: '',
    spec: ses.spec || '', tip: ses.tip || '', prioritate: ses.prioritate || 'Normal',
    dataObs: isoDate(now), termen: addDays(ses.termenZile ?? 3),
    resp: (ses.resp || []).slice(), status: 'Nesolutionat', poze: [], poza: '',
    _meta: { creat: now.toISOString(), exportat: null }
  };
}
let openSeq = 0;
async function openObs(rec) {
  const tok = ++openSeq;
  let poze = [], farePoze = false;
  if (rec) {
    try { poze = await dbPoze(rec.id); } catch (e) { toast('Nu pot citi pozele', 5000); return; }
    if (rec.nPoze && !poze.length) { farePoze = true; toast('Pozele nu se găsesc', 5000); }
  }
  if (tok !== openSeq) return;
  edit = rec ? { ...JSON.parse(JSON.stringify(rec)), poze } : newRec();
  if (farePoze) edit._farePoze = true;
  edit.poze = edit.poze || []; edit.resp = edit.resp || [];
  // ce s-a ales la Start pentru toată verificarea contează ca ales de om: AI-ul nu-l schimbă
  atins = rec ? { inc: !!rec.inc, spec: true, tip: true } : { inc: false, spec: !!(ses.specAles && ses.spec), tip: !!(ses.tipAles && ses.tip) };
  editOrig = rec ? amprenta(edit) : null;
  formDirty = false; pozeVer++; aiReset();
  go('obs');
}
function renderObs() {
  head(edit.id ? 'Editare constatare' : 'Constatare nouă', `${edit.apt} · ${edit.locatie} · ${edit.etaj}`);
  drawThumbs();
  let cam = camerePt(edit.locatie, edit.etaj, edit.apt);
  if (eLocuinte(edit.locatie) && !cam.includes('Tot apartamentul')) cam = ['Tot apartamentul', ...cam];
  const sel = edit.inc ? edit.inc.split(',').map(s => s.trim()).filter(Boolean) : [];
  incChips = makeChips('incChips', cam, sel, false, () => { atins.inc = true; onFormChange(); });   // o singură încăpere, ca în aplicația de verificări
  const alte = (cfg.camere || []).filter(c => !cam.includes(c) && !combinata(c));
  incAlte = alte;
  $('incAlta').hidden = !alte.length;
  $('txtObs').value = edit.obs || ''; creste();
  drawDetalii();
  $('btnSterge').hidden = !edit.id;
  $('btnCopiaza').hidden = !edit.id;
  $('obsExportat').hidden = !(edit._meta && edit._meta.exportat);
  updFotoBusy();
  renderMicInfo();
  $('txtObs').classList.remove('flash');
  micUi(); aiUi(); updSalv();
}
let tipChips = null, prioChips = null;
function drawDetalii() {
  field('oSpec', specPt(edit.locatie, edit.etaj), edit.spec, 'alege', () => { atins.spec = true; firmeToate = false; deseneazaFirme(); onFormChange(); });
  tipChips = makeChips('oTip', cfg.tipuri || [], edit.tip ? [edit.tip] : [], false, () => { atins.tip = true; onFormChange(); });
  prioChips = makeChips('oPrio', cfg.prioritati || [], edit.prioritate ? [edit.prioritate] : [], false, onFormChange);
  firmeToate = false;
  deseneazaFirme(edit.resp || []);
  $('oTermen').value = edit.termen || '';
  deseneazaTermen();
  updSumObs();
}
function deseneazaTermen() {
  const box = $('oTermenC'); box.innerHTML = '';
  [3, 7, 14].forEach(n => {
    const d = addDays(n), b = document.createElement('button'); b.type = 'button';
    b.className = 'chip' + ($('oTermen').value === d ? ' on' : ''); b.textContent = `${n} zile`;
    b.onclick = () => { $('oTermen').value = d; deseneazaTermen(); onFormChange(); };
    box.appendChild(b);
  });
}
// Firma: după specialitate, întâi firmele care o fac (din constatările de până acum); restul sub „Alte firme”
let firmeToate = false;
function firmeSugerate(spec) {
  const m = stil().firmePeSpec || {};
  return spec ? (m[`${edit.locatie}|${spec}`] || m[spec] || []).filter(f => (cfg.responsabili || []).includes(f)) : [];
}
function deseneazaFirme(alese) {
  const sel = alese || (respObs ? respObs.get() : edit.resp || []);
  const spec = val('oSpec') || edit.spec;
  const sug = firmeSugerate(spec);
  const toate = cfg.responsabili || [];
  const rest = toate.filter(f => !sug.includes(f));
  const cuSug = sug.length > 0 && rest.length > 0;
  const vizibile = !cuSug || firmeToate ? [...sug, ...rest] : [...sug, ...sel.filter(f => !sug.includes(f))];
  respObs = makeChips('oResp', vizibile, sel, true, onFormChange);
  $('firmeSug').hidden = true;
  const b = $('firmeAlte');
  b.hidden = !cuSug || firmeToate;
  b.innerHTML = `${icon('next')}Alte firme (${rest.filter(f => !sel.includes(f)).length})`;
  b.onclick = () => { firmeToate = true; deseneazaFirme(); };
}
function updSumObs() {
  $('sumObs').textContent = [val('oSpec'), tipChips ? tipChips.get()[0] : '', respObs ? respObs.get().join(' / ') : ''].filter(Boolean).join(' · ') || 'specialitate, firmă';
}
function onFormChange() { formDirty = true; updSumObs(); saveDraftSoon(); aiUi(); updSalv(); updSugestie(); }
// întâi elementul (ușă, geam, priză, gresie…), apoi suprafețele, la final curățenia
const REGULI_SPEC = [
  ['Usa de acces', /\busa (de |de la )?(acces|intrare|apartament)|\bvizor|\bcaptuseal|\busa metalic/],
  ['Tamplarie PVC', /tamplari|\bgeam|fereastr|\bglaf|\bpvc\b|plasa (de )?tantar|usa (de )?balcon|\bgarnitur/],
  ['Placari ceramice', /gresi|faiant|ceramic|\bplac(a|i|ile|ilor)\b|\bchit|\brost|distantier/],
  ['Obiecte sanitare', /\bcad(a|ei)\b|lavoar|\bwc\b|vas (de )?toaleta|\bbaterie|\bsifon|cabina (de )?dus|panou (de )?dus/],
  ['Parchet', /parchet|\bplint|\blaminat/],
  ['Aparataj electrice', /\bpriz|intrerupat|ornament|\bdoz(a|e)\b/],
  ['Instalatii electrice', /\btablou|\bcablu|corp (de )?iluminat|\bspot|\bsonerie|\bbec\b/],
  ['Interfonie', /interfon/],
  ['Instalatii gaz', /\bgaz|regulator/],
  ['Instalatii HVAC', /calorifer|radiator|\bcentral(a|ei)\b|\bct\b|ventila|\bclima/],
  ['Instalatii sanitare', /\bteav|scurger|pierdere (de )?apa|infiltra|\bcoloan|apometru|robinet/],
  ['Confectii metalice', /balustrad|\bparapet|\bmetalic/],
  ['Usi de interior', /\busa\b|\busi(le)?\b|\busii\b|\btoc(ul|uri)?\b|\bbalama|\bclant|\bmaner|\bcant(ul)?\b|\bopritor|\bchei/],
  ['Glet', /\bglet|slefui|\bfisur|\bcoltar|\bintrados|\bolnit|\bperete|\bpereti|\btavan|\bspalet/],
  ['Tencuiala', /tencuial/],
  ['Zugraveli lavabile', /zugrav|lavabil|\bvopse|\bretus|\bamors/],
  ['Curatenie', /curat|murdar|\bpraf|mizerie|\bfoli|infoliat|\bbanda/],
];
function sugestieSpec(text, inc) {
  const t = cheie(text); if (t.length < 4 || !edit) return '';
  const lista = specPt(edit.locatie, edit.etaj);
  const gaseste = s => lista.find(x => cheie(x) === cheie(s)) || '';
  for (const [sp, rx] of REGULI_SPEC) {
    if (!rx.test(t)) continue;
    if (sp === 'Usi de interior' && /acces|intrare/.test(cheie(inc || '')) && gaseste('Usa de acces')) return gaseste('Usa de acces');
    const g = gaseste(sp); if (g) return g;
  }
  return '';
}
let sugT;
function updSugestie() {
  clearTimeout(sugT);
  sugT = setTimeout(() => {
    const bar = $('sugBar'); if (!edit || curView !== 'obs') { bar.hidden = true; return; }
    const sp = sugestieSpec($('txtObs').value, incChips ? incChips.get()[0] : '');
    const firma = sp ? (firmeSugerate(sp)[0] || '') : '';
    const alese = respObs ? respObs.get() : [];
    if (!sp || (sp === val('oSpec') && (!firma || alese.length))) { bar.hidden = true; return; }
    bar.hidden = false;
    bar.innerHTML = `${icon('spark')}<span>${esc([sp, firma].filter(Boolean).join(' · '))}</span><button type="button" id="sugPune" class="linkbtn">Pune</button>`;
    $('sugPune').onclick = () => {
      readForm(); edit.spec = sp; atins.spec = true;
      if (firma && !edit.resp.length) edit.resp = [firma];
      drawDetalii(); bar.hidden = true; onFormChange();
      const el = $('detObs').querySelector('summary'); el.classList.remove('flash'); void el.offsetWidth; el.classList.add('flash');
    };
  }, 350);
}
// cât nu e aleasă încăperea, butonul de jos spune asta (altfel omul apasă Salvează și nu înțelege de ce nu merge)
function updSalv() {
  const faraInc = !!incChips && !incChips.get().length;
  $('btnSalv').innerHTML = faraInc ? `Alege încăperea ↓` : `${icon('check')}Salvează`;
}
let incAlte = [];
$('incAlta').onclick = () => alegeDinLista('Altă încăpere', incAlte, '', v => { incChips.add(v); atins.inc = true; onFormChange(); });
$('txtObs').addEventListener('input', () => {
  if (micOn) stopMic(true);                          // scrii de mână -> dictarea nu-ți mai suprascrie textul
  if (ai.undo) { ai.undo = null; aiStare(null); }    // după ce schimbi textul, „Anulează” AI nu mai are sens
  creste(); onFormChange();
});
function creste() { const t = $('txtObs'); t.style.height = 'auto'; t.style.height = Math.min(t.scrollHeight + 2, 280) + 'px'; }
$('oTermen').addEventListener('change', () => { deseneazaTermen(); onFormChange(); });

function drawThumbs() {
  const box = $('thumbs'); box.innerHTML = '';
  edit.poze.forEach((p, i) => {
    const d = document.createElement('div'); d.className = 'thumb';
    d.innerHTML = `<img src="${p}" alt="">${isGif(p) ? '<span class="badge">VIDEO</span>' : ''}<button type="button" aria-label="Scoate imaginea">${icon('x')}</button>`;
    d.querySelector('button').onclick = () => { edit.poze.splice(i, 1); pozeVer++; drawThumbs(); onFormChange(); };
    box.appendChild(d);
  });
  inLucru.filter(j => j.ed === edit).forEach(j => {
    const d = document.createElement('div'); d.className = 'thumb busy';
    d.innerHTML = j.tip === 'video' ? `<div class="prog"><span class="spin"></span><b>${j.pct}%</b><small>video</small></div>` : `<div class="prog"><span class="spin"></span><small>poză</small></div>`;
    j.el = d; box.appendChild(d);
  });
}
async function compress(file, MAX = 1600, q = 0.72) {
  const url = URL.createObjectURL(file);
  try { return await imgToJpeg(url, MAX, q); } finally { URL.revokeObjectURL(url); }
}
async function imgToJpeg(src, MAX, q, lumina) {
  const img = await new Promise((res, rej) => { const i = new Image(); i.onload = () => res(i); i.onerror = () => rej(new Error('imagine')); i.src = src; });
  const s = Math.min(1, MAX / Math.max(img.naturalWidth, img.naturalHeight));
  const w = Math.max(1, Math.round(img.naturalWidth * s)), h = Math.max(1, Math.round(img.naturalHeight * s));
  const c = document.createElement('canvas'); c.width = w; c.height = h;
  const g = c.getContext('2d'); g.fillStyle = '#fff'; g.fillRect(0, 0, w, h); g.drawImage(img, 0, 0, w, h);
  if (lumina) lumineaza(g, w, h);
  const out = c.toDataURL('image/jpeg', q);
  c.width = c.height = 0;                          // iPhone are o limită totală de memorie pentru canvas
  return out;
}
// raport: pozele clar întunecate se luminează ușor (gamma), fără să schimbi altceva
function lumineaza(g, w, h) {
  let d; try { d = g.getImageData(0, 0, w, h); } catch (e) { return; }
  const a = d.data; let sum = 0, n = 0;
  for (let i = 0; i < a.length; i += 64) { sum += 0.299 * a[i] + 0.587 * a[i + 1] + 0.114 * a[i + 2]; n++; }
  const m = sum / n / 255; if (!(m > 0.02 && m < 0.38)) return;
  const gm = Math.max(0.6, Math.log(0.46) / Math.log(m)), lut = new Uint8ClampedArray(256);
  for (let v = 0; v < 256; v++) lut[v] = Math.round(255 * Math.pow(v / 255, gm));
  for (let i = 0; i < a.length; i += 4) { a[i] = lut[a[i]]; a[i + 1] = lut[a[i + 1]]; a[i + 2] = lut[a[i + 2]]; }
  g.putImageData(d, 0, 0);
}
const eVideo = f => /^video\//.test(f.type) || /\.(mp4|mov|m4v|webm|3gp|mkv)$/i.test(f.name || '');
function jobNou(ed, tip) {
  let gata; const job = { ed, tip, pct: 0, el: null, gata: new Promise(r => { gata = r; }) };
  job.termina = () => { const i = inLucru.indexOf(job); if (i >= 0) inLucru.splice(i, 1); gata(); if (edit === ed) { drawThumbs(); updFotoBusy(); } };
  inLucru.push(job); return job;
}
function updFotoBusy() {
  const v = !!edit && inLucru.some(j => j.ed === edit && j.tip === 'video');
  $('photos').classList.toggle('busy', v); $('vObs').classList.toggle('mediabusy', v);
}
async function onFiles(e) {
  const files = [...(e.target.files || [])]; e.target.value = '';
  if (!files.length || !edit) return;
  const ed = edit;
  formDirty = true;
  const poze = files.filter(f => !eVideo(f)), video = files.filter(eVideo);
  video.forEach(f => addVideo(f, ed));
  const joburi = poze.map(() => jobNou(ed, 'poza'));
  if (edit === ed) drawThumbs();
  let adaugate = 0;
  for (let i = 0; i < poze.length; i++) {
    try { const p = await compress(poze[i]); ed.poze.push(p); adaugate++; } catch (err) { toast('Poza nu se poate citi'); }
    joburi[i].termina();
  }
  if (adaugate) { pozeVer++; if (edit === ed) onFormChange(); }
}
function addVideo(f, ed) {
  const job = jobNou(ed, 'video');
  if (edit === ed) { drawThumbs(); updFotoBusy(); }
  coadaVideo = coadaVideo.then(async () => {      // unul câte unul: telefonul nu decodează bine mai multe video deodată
    if (edit !== ed) { job.termina(); return; }     // constatarea a fost aruncată între timp
    try {
      const r = await videoToGif(f, p => { job.pct = p; const b = job.el && job.el.querySelector('b'); if (b) b.textContent = p + '%'; });
      if (r.taiat) toast(`Video tăiat la ${r.sec} s`, 3000);
      ed.poze.push(r.url); cadreGif.set(fp(r.url), r.cadre); pozeVer++;
      if (edit === ed) onFormChange();
    } catch (err) { toast('Video-ul nu merge: ' + err.message, 5000); }
    finally { job.termina(); }
  });
}
$('inCam').onchange = onFiles;
$('inVid').onchange = onFiles;
$('inGal').onchange = onFiles;

/* ---- video -> GIF (mic, se vede animat oriunde se vede o poză) ---- */
const GIF = { maxSec: 15, fps: 5, latura: 400 };
function evOnce(el, ev, ms) {
  return new Promise((res, rej) => {
    const t = setTimeout(() => { el.removeEventListener(ev, f); rej(new Error('timp depășit')); }, ms);
    const f = () => { clearTimeout(t); el.removeEventListener(ev, f); res(); };
    el.addEventListener(ev, f);
  });
}
function negru(px) { let s = 0, n = 0; for (let i = 0; i < px.length; i += 4 * 97) { s += px[i] + px[i + 1] + px[i + 2]; n++; } return n > 0 && s / n < 12; }
async function videoToGif(file, onProg) {
  if (!window.gifenc) throw new Error('lipsește encoderul GIF');
  const url = URL.createObjectURL(file);
  const v = document.createElement('video');
  v.muted = true; v.defaultMuted = true; v.playsInline = true; v.preload = 'auto';
  v.setAttribute('muted', ''); v.setAttribute('playsinline', '');
  v.style.cssText = 'position:fixed;left:0;top:0;width:2px;height:2px;opacity:0;pointer-events:none';
  document.body.appendChild(v);
  try {
    await new Promise((res, rej) => {
      const t = setTimeout(() => rej(new Error('video-ul nu se încarcă')), 20000);
      v.onloadedmetadata = () => { clearTimeout(t); res(); };
      v.onerror = () => { clearTimeout(t); rej(new Error('format video necunoscut')); };
      v.src = url; v.load();
    });
    try { await Promise.race([v.play(), pauza(1500)]); } catch (e) { }      // iPhone: fără play() cadrele pot ieși negre
    try { v.pause(); } catch (e) { }
    if (v.readyState < 2) await evOnce(v, 'loadeddata', 8000).catch(() => { });
    let dur = v.duration;
    if (!isFinite(dur) || !dur) { v.currentTime = 1e7; await evOnce(v, 'seeked', 5000).catch(() => { }); dur = v.duration; }
    if (!isFinite(dur) || !dur) throw new Error('nu aflu durata');
    if (!v.videoWidth || !v.videoHeight) throw new Error('video fără imagine');
    const sec = Math.min(dur, GIF.maxSec);
    const n = Math.max(2, Math.round(sec * GIF.fps));
    const s = Math.min(1, GIF.latura / Math.max(v.videoWidth, v.videoHeight));
    const w = Math.max(2, Math.round(v.videoWidth * s)), h = Math.max(2, Math.round(v.videoHeight * s));
    const c = document.createElement('canvas'); c.width = w; c.height = h;
    const g = c.getContext('2d', { willReadFrequently: true });
    const frames = [], cadre = [];
    const chei = [Math.floor(n * 0.15), Math.floor(n * 0.5), Math.min(n - 1, Math.floor(n * 0.9))];
    for (let i = 0; i < n; i++) {
      const t = Math.min(dur - 0.04, (i + 0.5) * sec / n);
      if (Math.abs(v.currentTime - t) > 0.01) { v.currentTime = t; await evOnce(v, 'seeked', 4000).catch(() => { }); }
      g.drawImage(v, 0, 0, w, h);
      let px = g.getImageData(0, 0, w, h).data;
      if (i === 0 && negru(px)) {                  // primul cadru negru (iPhone, mod economisire baterie): mai încerc după play()
        try { await Promise.race([v.play(), pauza(1200)]); await pauza(250); v.pause(); } catch (e) { }
        v.currentTime = t; await evOnce(v, 'seeked', 4000).catch(() => { });
        g.drawImage(v, 0, 0, w, h); px = g.getImageData(0, 0, w, h).data;
        if (negru(px)) throw new Error('telefonul nu dă cadrele (mod economisire baterie?)');
      }
      frames.push(px);
      if (chei.includes(i) && cadre.length < 3) cadre.push(c.toDataURL('image/jpeg', 0.7));
      onProg(Math.round((i + 1) / n * 70));
    }
    const { GIFEncoder, quantize, applyPalette } = window.gifenc;
    const pas = Math.max(1, Math.floor(frames.length / 6));
    const mostre = frames.filter((_, i) => i % pas === 0).slice(0, 6);
    const tot = new Uint8ClampedArray(mostre.reduce((a, f) => a + f.length, 0));
    let o = 0; mostre.forEach(f => { tot.set(f, o); o += f.length; });
    const pal = quantize(tot, 256);
    const enc = GIFEncoder();
    const delay = Math.round(sec * 1000 / n);
    for (let i = 0; i < frames.length; i++) {
      enc.writeFrame(applyPalette(frames[i], pal), w, h, i === 0 ? { palette: pal, delay } : { delay });
      frames[i] = null;
      if (i % 5 === 4) { onProg(70 + Math.round((i + 1) / n * 30)); await pauza(0); }
    }
    enc.finish();
    c.width = c.height = 0;
    const blob = new Blob([enc.bytes()], { type: 'image/gif' });
    const dataUrl = await new Promise((res, rej) => { const fr = new FileReader(); fr.onload = () => res(fr.result); fr.onerror = () => rej(fr.error); fr.readAsDataURL(blob); });
    onProg(100);
    return { url: dataUrl, cadre, sec: Math.round(sec), taiat: dur > GIF.maxSec + 0.5, kb: Math.round(blob.size / 1024) };
  } finally { URL.revokeObjectURL(url); v.removeAttribute('src'); try { v.load(); } catch (e) { } v.remove(); }
}

function readForm() {
  if (!edit) return;
  if (incChips) edit.inc = incChips.get().join(', ');
  edit.obs = $('txtObs').value.trim().replace(/\s+/g, ' ');
  if (edit.obs) edit.obs = edit.obs[0].toUpperCase() + edit.obs.slice(1);
  edit.spec = val('oSpec');
  if (tipChips) edit.tip = tipChips.get()[0] || '';
  if (prioChips) edit.prioritate = prioChips.get()[0] || '';
  if (respObs) edit.resp = respObs.get();
  edit.termen = $('oTermen').value || '';
}
async function saveForm() {
  if (!edit || saving) return;
  const ed = edit;
  saving = true; $('btnSalv').disabled = true;
  try {
    $('vObs').classList.add('salvez');
    while (inLucru.some(j => j.ed === ed)) {
      const pend = inLucru.filter(j => j.ed === ed);
      toast('Salvez…', 4000);
      await Promise.all(pend.map(j => j.gata));
    }
    if (micOn || rec) { stopMic(true); await asteptMic(); opresteMic(); }
    readForm();
    if (!ed.obs && !ed.poze.length) { toast('Lipsește poza sau textul'); return; }
    if (!ed.inc) { toast('Alege încăperea'); $('incChips').scrollIntoView({ block: 'center', behavior: 'smooth' }); return; }
    ai.seq++;                                          // un răspuns AI întârziat nu mai schimbă nimic
    if (ed.id && editOrig && editOrig === amprenta(ed)) {   // n-ai schimbat nimic: nu o marchez ca nouă (nu se reexportă)
      uitaCadre(ed); edit = null; formDirty = false; await dropDraft(); saving = false; inapoiLaApt(); return;
    }
    if (!ed.id) ed.id = genId();
    ed._ts = Date.now();
    ed._meta = { ...(ed._meta || {}), exportat: null };   // modificată după export -> se exportă din nou
    const doarText = ed._farePoze && !ed.poze.length;           // pozele nu s-au putut citi: NU le suprascriu cu „nimic”
    delete ed._farePoze;
    if (!doarText) { try { ed._meta.thumb = ed.poze[0] ? await imgToJpeg(ed.poze[0], 200, 0.7) : ''; } catch (e) { ed._meta.thumb = ''; } }
    try {
      if (doarText) { const { poze, ...fara } = ed; await dbPut(fara); } else await dbSalveaza(ed, ed.poze);
    } catch (err) { toast('Nu am putut salva: ' + err.message, 7000); return; }
    if (edit === ed) edit = null;
    formDirty = false; uitaCadre(ed);
    inLista(usoara(doarText ? (({ poze, ...x }) => x)(ed) : ed));
    await dropDraft();
    saving = false; $('btnSalv').disabled = false; $('vObs').classList.remove('salvez');
    toast('Salvat');
    inapoiLaApt();
  } finally { saving = false; $('btnSalv').disabled = false; $('vObs').classList.remove('salvez'); }
}
const vineDinLista = () => prevView() === 'apt' || prevView() === 'mele';
function inapoiLaApt() { if (vineDinLista()) history.back(); else go('apt', true); }
$('btnSalv').onclick = saveForm;
$('btnCopiaza').onclick = () => {
  if (!edit) return;
  readForm();
  const src = { ...edit };
  alegeApt(src, async dest => { const n = await copiazaIn([src], dest); if (n) toast(`Copiată în ${dest.apt}`); });
};

/* ---------------- CAMERA din aplicație: poze una după alta, fără să ieși; fiecare intră imediat în constatare ---------------- */
let camStream = null, camNr = 0;
$('btnCam').onclick = () => {
  if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) { $('inCam').click(); return; }   // telefon vechi: camera telefonului
  deschideCamera();
};
async function deschideCamera() {
  try {
    camStream = await navigator.mediaDevices.getUserMedia({ audio: false, video: { facingMode: { ideal: 'environment' }, width: { ideal: 1920 }, height: { ideal: 1440 } } });
  } catch (e) { toast(e.name === 'NotAllowedError' ? 'Camera e blocată (setările telefonului)' : 'Camera nu pornește', 4000); return; }
  if (!edit) { inchideCamera(); return; }
  const v = $('camVideo'); v.srcObject = camStream; camNr = 0; updCam(); $('camUlt').style.backgroundImage = '';
  $('cam').hidden = false;
  try { await v.play(); } catch (e) { }
}
function inchideCamera() {
  if (camStream) camStream.getTracks().forEach(t => { try { t.stop(); } catch (e) { } });
  camStream = null; $('camVideo').srcObject = null; $('cam').hidden = true;
}
function updCam() { $('camGata').textContent = camNr ? `Gata (${camNr})` : 'Închide'; }
$('camShot').onclick = () => {
  const v = $('camVideo'); if (!edit) return;
  if (v.videoWidth < 200 || v.readyState < 2) { toast('Camera pornește…', 1200); return; }   // fără poze goale cât nu e gata imaginea
  const s = Math.min(1, 1600 / Math.max(v.videoWidth, v.videoHeight));
  const c = document.createElement('canvas'); c.width = Math.round(v.videoWidth * s); c.height = Math.round(v.videoHeight * s);
  c.getContext('2d').drawImage(v, 0, 0, c.width, c.height);
  const url = c.toDataURL('image/jpeg', 0.8); c.width = c.height = 0;
  edit.poze.push(url); pozeVer++; formDirty = true; camNr++;
  $('camUlt').style.backgroundImage = `url("${url}")`;
  const f = $('camFlash'); f.classList.remove('on'); void f.offsetWidth; f.classList.add('on');
  updCam(); drawThumbs(); saveDraftSoon();
};
$('camGata').onclick = () => { inchideCamera(); if (edit) onFormChange(); };
$('btnSterge').onclick = async () => {
  if (!edit || !edit.id || !confirm('Ștergi constatarea?')) return;
  const id = edit.id; await dbDel(id); dinLista(id); formDirty = false; edit = null; await dropDraft(); toast('Șters'); inapoiLaApt();
};

/* ---------------- DICTARE ---------------- */
const SR = window.SpeechRecognition || window.webkitSpeechRecognition;
const ANDROID = /Android/i.test(navigator.userAgent);
let rec = null, micOn = false, micBase = '', aiDupaMic = false, micIdleT = null, srOprit = false;
function micActiv() { clearTimeout(micIdleT); if (micOn) micIdleT = setTimeout(() => { if (micOn) { stopMic(false); toast('Microfon oprit', 2500); } }, 25000); }
function micUi() {
  const b = $('btnMic'); b.classList.toggle('on', micOn);
  b.innerHTML = micOn ? `${icon('stop')}<span>Oprește</span>` : `${icon('mic')}<span>Dictează</span>`;
}
function renderMicInfo() {
  $('micInfo').textContent = (!SR || srOprit) ? ''
    : '';
}
// recunoașterea vocală aude greșit câțiva termeni de șantier (utilizatorul, 24.11): „înfoliat” -> „înfuriat”, „de reglat” -> „dereglat”
const CORECTURI_DICTARE = [
  [/(^|[^\p{L}])([îÎiI])nfuria(t|tă|ta|te|ți|ti)(?![\p{L}])/gu, (m, p, a, t) => p + (a === 'Î' || a === 'I' ? 'Î' : 'î') + 'nfolia' + t],
  [/(^|[^\p{L}])([dD])eregla(t|tă|ta|te|ți|ti)(?![\p{L}])/gu, (m, p, d) => p + d + 'e reglat'],
];
const corecteazaDictare = x => CORECTURI_DICTARE.reduce((s, [rx, fn]) => s.replace(rx, fn), x);
const asteptMic = () => rec ? Promise.race([rec.sfarsit, pauza(1500)]) : Promise.resolve();
async function startMic() {
  if (!SR || srOprit) { toast('Folosește microfonul tastaturii', 3000); $('txtObs').focus(); return; }
  if (rec) {                                         // sesiunea veche încă se închide (pe iPhone ~1 s): îi aștept ultimele cuvinte
    await asteptMic();
    if (rec) { const v = rec; rec = null; try { v.abort(); } catch (e) { } }
  }
  if (!edit || micOn) return;
  ai.seq++;                                          // nu mai aștept o completare veche
  const ta = $('txtObs');
  if (ai.descriere && ta.value.trim() === ai.descriere) { ta.value = ''; creste(); }   // descrierea propusă din imagine o înlocuiește ce spui
  aiStare(null);
  const r = new SR(); rec = r;
  const ed0 = edit, textStart = ta.value;
  r.lang = 'ro-RO'; r.interimResults = true;
  r.continuous = !ANDROID;                           // pe Android „continuous” dublează cuvintele -> repornesc eu
  let gata; r.sfarsit = new Promise(res => { gata = res; });
  micBase = ta.value.trim() ? ta.value.trim() + ' ' : '';
  r.onresult = e => {
    if (rec !== r || edit !== ed0) return;
    let fin = '', interim = '';
    for (let i = 0; i < e.results.length; i++) {
      const x = e.results[i];
      if (x.isFinal) fin += x[0].transcript.trim() + ' '; else interim += x[0].transcript;
    }
    ta.value = corecteazaDictare((micBase + fin + interim).replace(/\s+/g, ' ').trimStart()); creste(); micActiv();
    formDirty = true;
  };
  r.onerror = e => {
    if (rec !== r || document.hidden) return;
    const opreste = msg => { micOn = false; aiDupaMic = false; toast(msg, 5000); };
    if (e.error === 'service-not-allowed') {
      srOprit = true; opreste('Folosește microfonul tastaturii'); renderMicInfo(); ta.focus();
    } else if (e.error === 'not-allowed') opreste('Microfon blocat (setările telefonului)');
    else if (e.error === 'network') opreste('Dictarea cere internet');
    else if (e.error === 'audio-capture') opreste('Nu găsesc microfonul.');
  };
  r.onend = () => {
    if (rec !== r) { gata(); return; }
    if (micOn && !document.hidden) { micBase = ta.value.trim() ? ta.value.trim() + ' ' : ''; try { r.start(); return; } catch (err) { } }
    micOn = false; rec = null; micUi(); gata();
    if (!edit || edit !== ed0) return;
    if (ta.value !== textStart) onFormChange(); else aiUi();
  };
  try { r.start(); micOn = true; aiDupaMic = false; micUi(); aiUi(); micActiv(); }
  catch (err) { rec = null; gata(); toast('Dictarea nu pornește'); }
}
function stopMic(faraAi) {
  clearTimeout(micIdleT);
  if (rec && micOn) { micOn = false; aiDupaMic = !faraAi; try { rec.stop(); } catch (e) { } }
  else if (faraAi) aiDupaMic = false;
  if ($('btnMic')) micUi();
}
function opresteMic() {                             // oprire definitivă: fără rezultate întârziate
  stopMic(true);
  if (rec) { const v = rec; rec = null; try { v.abort(); } catch (e) { } }
  micOn = false; if ($('btnMic')) micUi();
}
$('btnMic').onclick = () => micOn ? stopMic(false) : startMic();

/* ---------------- ASISTENT AI (DeepSeek) ---------------- */
const AI = { url: 'https://api.deepseek.com', model: 'deepseek-flash', timeout: 35000 };
const aiKey = () => (PACHET && PACHET.ai && PACHET.ai.key) || '';
const aiOn = () => !!aiKey();
// AI-ul face UN singur lucru și DOAR când omul apasă „Completează automat”: rescrie textul spus într-un rând curat.
// Încăperea, specialitatea, tipul, firma le alege omul (AI-ul nu are de unde să le știe).
const PROMPT = `Esti asistentul unui inginer care verifica apartamente noi inainte de predare, pe un santier de blocuri de locuinte.
Primesti textul dictat de inginer (recunoastere vocala automata, poate avea cuvinte gresite) si 0-4 imagini ale problemei.
Il rescrii ca UN rand scurt pentru aplicatia de verificari ("obs"): de regula sub 80 de caractere, FARA diacritice, fara punct la final, in stilul exemplelor: elementul + unde + problema.
- Pastrezi exact sensul inginerului. NU adaugi probleme pe care nu le-a spus.
- Imaginile le folosesti doar ca sa precizezi ce a spus (ce element, ce parte, sus/jos, interior/exterior) si DOAR cu ce se vede sigur; daca nu esti sigur, nu adaugi nimic din imagine.
- Mai multe probleme la acelasi element: in acelasi rand, separate prin "; ".
- Corectezi cuvintele recunoscute gresit dupa glosar (ex. "spalier" -> "spalet", "ce te" -> "CT").
Exemple de stil: "Toc usa baie zgariat (partea superioara)" · "Usa dormitor nu se inchide" · "Usa acces zgariata" · "Usa baie cu dus atinge tocul la inchidere" · "Usa baie dus nu este in boloboc" · "Coltar grinda living nu este drept" · "Urme de slefuit pe intrados" · "Spalet fereastra nefinisat in partea de jos" · "Lavabil scurs sub priza" · "Masca cada nu este in linie cu cada" · "Rampa CT murdara de vopsea" · "Folie lichida neindepartata de pe tamplarie".
Glosar: infoliat = acoperit cu folie de protectie · de reglat = trebuie reglat (ex. tamplarie de reglat) · spalet = latura golului de usa/fereastra · intrados = fata de dedesubt a grinzii · coltar = profilul de pe muchie · olnita = racordul/muchia dintre doua suprafete · aparataj = prize, intrerupatoare · CT = centrala termica · rampa CT = tevile de sub centrala · masca cada = panoul care inchide cada · distantiere = crucitele dintre placi · defoliat = scoasa folia de protectie · folie lichida · beton contact · reparatii perimetrale = retusurile din jurul ramei/tocului · toc · foaie usa · pervaz · glaf · plinta · balamale · broasca · yala · maner · garnitura · prag · glet · lavabil · chit · boloboc (nu e in boloboc = nu e drept/la nivel) · are joc = se misca, nu sta fix.
Raspunzi DOAR cu JSON: {"obs":""}`;

let ai = { seq: 0, busy: false, undo: null, sig: '', stare: null, info: null, descriere: '' };
function aiReset() { ai = { seq: ai.seq + 1, busy: false, undo: null, sig: '', stare: null, info: null, descriere: '' }; }
const semnatura = () => edit ? `${$('txtObs').value.trim()}|${edit.poze.length}` : '';
function aiUi() {
  const areText = !!edit && !!$('txtObs').value.trim();
  $('btnAi').hidden = !aiOn() || ai.busy || micOn || !areText || semnatura() === ai.sig;
  const bar = $('aiBar');
  if (!ai.stare || micOn) { bar.hidden = true; return; }
  bar.hidden = false; bar.className = 'aibar ' + ai.stare;
  if (ai.stare === 'lucru') bar.innerHTML = `<span class="spin"></span><span>Completez…</span>`;
  else if (ai.stare === 'gata') {
    bar.innerHTML = `${icon('spark')}<span>Completat</span><button type="button" id="aiUndo" class="linkbtn">Anulează</button>`;
    $('aiUndo').onclick = aiAnuleaza;
  } else if (ai.stare === 'eroare') {
    bar.innerHTML = `${icon('alert')}<span>${esc(ai.info)}</span><button type="button" id="aiRetry" class="linkbtn">Reîncearcă</button>`;
    $('aiRetry').onclick = aiRun;
  }
}
function aiStare(st, info) { ai.stare = st; ai.info = info ?? null; aiUi(); }
$('btnAi').onclick = () => aiRun();

async function aiRun() {
  if (!aiOn() || !edit) return;
  readForm();
  const text = $('txtObs').value.trim();
  if (!text) return;
  const ed = edit, seq = ++ai.seq;
  ai.busy = true; ai.running = seq; aiStare('lucru');
  try {
    const imgs = await imaginiPentruAi(ed);
    const o = await aiCall(text, imgs);
    if (seq !== ai.seq || edit !== ed) return;
    if ($('txtObs').value.trim() !== text) { aiStare(null); return; }      // textul s-a schimbat între timp
    aplicaAi(o, text);
  } catch (e) {
    if (seq === ai.seq && edit === ed) aiStare('eroare', e.message);
  } finally {
    if (ai.running === seq) { ai.busy = false; ai.running = 0; aiUi(); }
  }
}
async function imaginiPentruAi(ed) {
  const out = [];
  for (const p of ed.poze.slice(0, 4)) {
    if (isGif(p) && cadreGif.has(fp(p))) out.push(...cadreGif.get(fp(p)));
    else { try { out.push(await imgToJpeg(p, 1024, 0.7)); } catch (e) { } }
    if (out.length >= 4) break;
  }
  return out.slice(0, 4);
}
async function aiFetch(path, opt, ms) {
  const ctrl = new AbortController(); const to = setTimeout(() => ctrl.abort(), ms || AI.timeout);
  try {                                              // limita de timp ține și pentru citirea răspunsului (semnal slab)
    let res;
    try { res = await fetch(AI.url + path, { ...opt, signal: ctrl.signal, headers: { ...(opt.headers || {}), Authorization: 'Bearer ' + aiKey() } }); }
    catch (e) { throw new Error(e.name === 'AbortError' ? 'răspunsul a durat prea mult' : 'nu am internet acum'); }
    if (res.status === 401) throw new Error('cheia nu mai e bună');
    if (res.status === 402) throw new Error('s-a terminat creditul DeepSeek');
    if (res.status === 429) throw new Error('prea multe cereri, mai încearcă');
    if (!res.ok) throw new Error('eroare ' + res.status);
    try { return await res.json(); } catch (e) { throw new Error(e.name === 'AbortError' ? 'răspunsul a durat prea mult' : 'răspuns incomplet, mai încearcă'); }
  } finally { clearTimeout(to); }
}
async function aiCall(text, imgs) {
  const ctx = { text_dictat: text, exemple_din_aplicatia_de_verificari: stil().exemple.slice(0, 40) };
  const content = [{ type: 'text', text: JSON.stringify(ctx) }, ...imgs.map(u => ({ type: 'image_url', image_url: { url: u } }))];
  const d = await aiFetch('/chat/completions', {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      model: AI.model, temperature: 0.2, response_format: { type: 'json_object' },
      thinking: { type: 'disabled' }, max_tokens: 600,             // fără „gândire”: ~1-2 s
      messages: [{ role: 'system', content: PROMPT }, { role: 'user', content }]
    })
  });
  const o = jsonLax(d.choices && d.choices[0] && d.choices[0].message && d.choices[0].message.content);
  if (o && typeof o.obs === 'string') return o;
  throw new Error('răspuns neclar, mai încearcă');
}
function jsonLax(x) {               // JSON-ul poate veni tăiat sau cu text în jur
  if (typeof x !== 'string' || !x.trim()) return null;
  try { const o = JSON.parse(x); return o && typeof o === 'object' ? o : null; } catch (e) { }
  const m = x.match(/\{[\s\S]*\}/); if (m) { try { return JSON.parse(m[0]); } catch (e) { } }
  const r = /"obs"\s*:\s*"((?:[^"\\]|\\.)*)"/.exec(x);
  if (!r) return null;
  try { return { obs: JSON.parse('"' + r[1] + '"') }; } catch (e) { return { obs: r[1] }; }
}
function curat(x) {
  let t = fara(x).replace(/\s+/g, ' ').trim().replace(/[.\s]+$/, '');
  if (t.length > 220) t = t.slice(0, 220);
  return t ? t[0].toUpperCase() + t.slice(1) : '';
}
function aplicaAi(o, text) {
  const obs = curat(o.obs);
  if (!obs) { aiStare('eroare', 'Nu am înțeles textul'); return; }
  ai.undo = { txt: $('txtObs').value };
  $('txtObs').value = obs; creste();
  edit._meta = { ...(edit._meta || {}), dictat: text };
  formDirty = true; readForm(); saveDraftSoon();
  ai.sig = semnatura();
  aiStare('gata');
  const el = $('txtObs'); el.classList.remove('flash'); void el.offsetWidth; el.classList.add('flash');
}
function aiAnuleaza() {
  const u = ai.undo; if (!u || !edit) return;
  $('txtObs').value = u.txt; creste();
  ai.undo = null; ai.sig = ''; aiStare(null); onFormChange();
}

/* ---------------- GATA / EXPORT ---------------- */
function recsExport() { return $('doarNoi').checked ? all.filter(r => !r._meta?.exportat) : all.slice(); }
function grupat(recs) {
  const g = new Map();
  recs.forEach(r => { const k = `${r.locatie} · ${r.etaj} · ${r.apt}`; if (!g.has(k)) g.set(k, []); g.get(k).push(r); });
  return g;
}
function renderGata() {
  head('Trimite constatările', '');
  $('lblExpApp').textContent = 'Fișier pentru aplicația de verificări';
  const recs = recsExport();
  const g = grupat(recs);
  const np = recs.reduce((x, r) => x + (r.nPoze || 0), 0);
  const pl = (n, a, b) => `${n} ${n === 1 ? a : b}`;
  $('gxRez').textContent = recs.length ? [pl(recs.length, 'constatare', 'constatări'), pl(g.size, 'loc', 'locuri'), pl(np, 'poză / video', 'poze / video')].join(' · ') : 'Nimic de trimis';
  let h = '';
  g.forEach((l, k) => { const [lo, et, ap] = k.split(' · '); h += `<div class="grow-row"><span><b>${esc(ap)}</b> · ${esc(lo)} · ${esc(et)}</span><span class="pill">${l.length}</span></div>`; });
  $('gataSum').innerHTML = h || '';
}
$('doarNoi').onchange = renderGata;
const stamp = () => { const d = new Date(); return `${isoDate(d)}_${pad(d.getHours())}${pad(d.getMinutes())}`; };
const pentruApp = r => { const o = { ...r }; delete o._meta; delete o.nPoze; return o; };

// iPhone: meniul de partajare („Salvează în Fișiere”, WhatsApp, mail). Android / laptop: descărcare directă în Downloads
// (meniul de partajare de pe Android de obicei nu are „salvează pe telefon”).
function cereTrimitere(file) {
  return new Promise(res => {
    const sh = $('shFisier'); sh.hidden = false; clearTimeout(toastT); $('toast').hidden = true;
    $('sfTrimite').onclick = async () => {
      sh.hidden = true;
      try { await navigator.share({ files: [file], title: file.name }); res(true); }
      catch (e) { if (e.name !== 'AbortError') toast('Nu s-a trimis: ' + e.message, 5000); res(false); }
    };
    $('sfRenunta').onclick = () => { sh.hidden = true; res(false); };
  });
}
async function shareOrDownload(blob, name) {
  const file = new File([blob], name, { type: blob.type });
  if (IOS && navigator.canShare && navigator.canShare({ files: [file] })) return cereTrimitere(file);
  const a = document.createElement('a'); a.href = URL.createObjectURL(blob); a.download = name;
  document.body.appendChild(a); a.click();
  setTimeout(() => { URL.revokeObjectURL(a.href); a.remove(); }, 30000);
  return true;
}
let exportInLucru = false;
const unaCateUna = fn => async () => {               // (18) dublu-tap pe export = un singur fișier
  if (exportInLucru) return; exportInLucru = true;
  ['btnExpApp', 'btnExpCsv', 'btnExpPdf'].forEach(id => { $(id).disabled = true; });
  try { await fn(); } finally { exportInLucru = false; ['btnExpApp', 'btnExpCsv', 'btnExpPdf'].forEach(id => { $(id).disabled = false; }); }
};
$('btnExpApp').onclick = unaCateUna(async () => {
  const recs = recsExport();
  if (!recs.length) { toast('Nimic de trimis'); return; }
  toast('Pregătesc…', 2000);
  const parti = ['{"observatii":['];
  for (let i = 0; i < recs.length; i++) {
    const pz = await dbPoze(recs[i].id).catch(() => []);
    parti.push(new Blob([(i ? ',' : '') + JSON.stringify(pentruApp({ ...recs[i], poze: pz, poza: pz[0] || '' }))]));
  }
  parti.push(']}');
  const blob = new Blob(parti, { type: 'application/json' });
  const ok = await shareOrDownload(blob, `constatari_${stamp()}_${recs.length}obs.json`);
  if (!ok) return;
  const t = new Date().toISOString();
  for (const r of recs) await patchMeta(r.id, { exportat: t });
  renderGata();
  toast(`Trimise: ${recs.length}`, 2500);
});
$('btnExpCsv').onclick = unaCateUna(async () => {
  const recs = recsExport();
  if (!recs.length) { toast('Nimic de trimis'); return; }
  const cols = ['Locatie', 'Etaj', 'Apartament', 'Incapere', 'Observatie', 'Specialitate', 'Tip', 'Prioritate', 'Responsabil', 'Data', 'Termen', 'Nr imagini', 'Text dictat', 'Id'];
  const q = v => { const s = String(v ?? ''); return /[;"\r\n]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s; };
  const rows = recs.map(r => [r.locatie, r.etaj, r.apt, r.inc, r.obs, r.spec, r.tip, r.prioritate, (r.resp || []).join(' / '), r.dataObs, r.termen, r.nPoze || 0, r._meta?.dictat || '', r.id].map(q).join(';'));
  const blob = new Blob(['\ufeff' + [cols.join(';')].concat(rows).join('\r\n')], { type: 'text/csv' });
  await shareOrDownload(blob, `constatari_${stamp()}.csv`);
});
const PROMPT_TEXTE = `Primesti constatari de pe un santier (verificarea apartamentelor noi inainte de predare). Pentru fiecare, rescrii "text" ca o propozitie scurta, clara, profesionala, in limba romana CU diacritice, prima litera mare, fara punct la final.
OBLIGATORIU cu diacritice (ă, â, î, ș, ț), chiar daca textul primit nu le are. Exemplu: "Usa dormitor nu se inchide" -> "Ușa dormitorului nu se închide".
Pastrezi exact sensul. NU adaugi si NU scoti probleme, NU inventezi detalii. "de reglat" ramane "de reglat" (= trebuie reglat), NU "dereglat".
Termeni de santier: spalet, intrados, coltar, olnita, aparataj, CT, glet, lavabil, chit, plinta, toc, glaf, înfoliat (cu î), de reglat, tamplarie.
Raspunzi DOAR cu JSON: {"texte":[{"n":1,"text":"..."}]}`;
const PROMPT_REZUMAT = `Primesti lista constatarilor dintr-o verificare de apartamente (santier). Scrii in limba romana CU diacritice, sobru, doar ce reiese din lista:
- "pe_scurt": 3-6 puncte scurte: problemele principale si cele care se repeta (cate apartamente / constatari), pe firme daca reiese;
- "apartamente": pentru fiecare apartament ("ap" exact ca in lista), un rand de rezumat de maximum 18 cuvinte.
Raspunzi DOAR cu JSON: {"pe_scurt":["..."],"apartamente":[{"ap":"...","rezumat":"..."}]}`;
function jsonObj(x) {
  if (typeof x !== 'string') return null;
  try { return JSON.parse(x); } catch (e) { }
  const m = x.match(/\{[\s\S]*\}/); if (m) { try { return JSON.parse(m[0]); } catch (e) { } }
  return null;
}
async function cerereAi(prompt, date, ms) {
  const d = await aiFetch('/chat/completions', {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ model: AI.model, temperature: 0.2, response_format: { type: 'json_object' }, thinking: { type: 'disabled' }, max_tokens: 6000,
      messages: [{ role: 'system', content: prompt }, { role: 'user', content: JSON.stringify(date) }] })
  }, ms);
  const o = jsonObj(d.choices && d.choices[0] && d.choices[0].message && d.choices[0].message.content);
  if (!o) throw new Error('răspuns neclar');
  return o;
}
const cheieAp = r => `${r.apt} · ${r.locatie} · ${r.etaj}`;
async function aiRaport(recs, prog) {
  const items = recs.map((r, i) => ({ n: i + 1, ap: cheieAp(r), inc: r.inc, text: r.obs || '', spec: r.spec, firma: (r.resp || []).join(', ') }));
  const loturi = []; for (let i = 0; i < items.length; i += 40) loturi.push(items.slice(i, i + 40));
  const texte = {}; let gata = 0;
  prog('Formulez textele…');
  await Promise.all(loturi.map(async lot => {
    const o = await cerereAi(PROMPT_TEXTE, lot.map(x => ({ n: x.n, text: x.text })), 90000);
    (o.texte || []).forEach(x => { if (x && x.n && typeof x.text === 'string' && x.text.trim()) texte[x.n] = x.text.trim(); });
    gata += lot.length; prog(`Formulez textele… ${gata}/${items.length}`);
  }));
  prog('Scriu rezumatul…');
  const o2 = await cerereAi(PROMPT_REZUMAT, items.map(x => ({ ap: x.ap, incapere: x.inc, text: texte[x.n] || x.text, specialitate: x.spec, firma: x.firma })), 90000);
  return { texte, peScurt: Array.isArray(o2.pe_scurt) ? o2.pe_scurt.filter(x => typeof x === 'string') : [],
    peAp: Object.fromEntries((o2.apartamente || []).filter(a => a && a.ap).map(a => [a.ap, String(a.rezumat || '')])) };
}
$('btnExpPdf').onclick = unaCateUna(async () => {
  const recs = recsExport();
  if (!recs.length) { toast('Nimic de trimis'); return; }
  const prog = m => toast(m, 120000);
  let ai = null;
  if (aiOn()) { try { ai = await aiRaport(recs, prog); } catch (e) { toast('Fără AI: ' + e.message, 2500); await pauza(800); } }
  prog('Pun pozele…');
  const g = grupat(recs);
  const nPoze = recs.reduce((x, r) => x + (r.nPoze || 0), 0);
  const pl = (n, a, b) => `${n} ${n === 1 ? a : b}`;
  let h = `<div class="rh"><div class="rt">Raport constatări</div><div class="rs">${esc(roDateTime(new Date()))}${getUser() ? ' · ' + esc(getUser()) : ''} · ${pl(recs.length, 'constatare', 'constatări')} · ${pl(g.size, 'loc', 'locuri')} · ${pl(nPoze, 'poză', 'poze')}</div></div>`;
  if (ai && ai.peScurt.length) h += `<section class="pescurt"><h2>Pe scurt</h2><ul>${ai.peScurt.map(x => `<li>${esc(x)}</li>`).join('')}</ul></section>`;
  h += `<table class="rtab"><thead><tr><th>Loc</th><th>Constatări</th><th>Firme</th></tr></thead><tbody>`;
  for (const [, l] of g) {
    const firme = [...new Set(l.flatMap(r => r.resp || []))];
    h += `<tr><td><b>${esc(l[0].apt)}</b> · ${esc(l[0].locatie)} · ${esc(l[0].etaj)}</td><td class="n">${l.length}</td><td>${esc(firme.join(', ') || '-')}</td></tr>`;
  }
  h += `</tbody></table>`;
  let nr = 0;
  for (const [, l] of g) {
    const r0 = l[0];
    // antetul apartamentului rămâne pe aceeași pagină cu prima constatare; titlul încăperii, cu prima ei constatare
    const rez = ai && ai.peAp[cheieAp(r0)];
    let antet = `<h2>${esc(r0.apt)}<span>${esc(r0.locatie)} · ${esc(r0.etaj)}</span></h2>${rez ? `<p class="rez">${esc(rez)}</p>` : ''}`;
    h += `<section class="rap-ap">`;
    const pe = new Map(); l.forEach(r => { const i = r.inc || 'Fără încăpere'; if (!pe.has(i)) pe.set(i, []); pe.get(i).push(r); });
    for (const [inc, rs] of pe) {
      for (const [ri, r] of rs.entries()) {
        nr++;
        const idx = recs.indexOf(r) + 1;
        const text = (ai && ai.texte[idx]) || r.obs || '';
        const pz = r.nPoze ? await dbPoze(r.id).catch(() => []) : [];
        let fig = '';
        for (const x of pz) { let m = ''; try { m = await imgToJpeg(x, 720, 0.72, !isGif(x)); } catch (e) { continue; } fig += `<figure><img src="${m}" alt="">${isGif(x) ? '<figcaption>cadru din video</figcaption>' : ''}</figure>`; }
        const meta = [r.tip, r.spec, (r.resp || []).join(', '), r.termen ? 'termen ' + r.termen.split('-').reverse().join('.') : ''].filter(Boolean).join(' · ');
        const fh = `<div class="o${fig ? ' cu' : ''}"><div class="oc"><div class="ot"><span class="nr">${nr}.</span>${esc(text)}</div>${meta ? `<div class="m">${esc(meta)}</div>` : ''}</div>${fig ? `<div class="ph">${fig}</div>` : ''}</div>`;
        const titlu = ri === 0 ? `<h3>${esc(inc)}</h3>` : '';
        if (antet || titlu) { h += `<div class="cap">${antet}${titlu}${fh}</div>`; antet = ''; } else h += fh;
      }
    }
    h += `</section>`;
  }
  h += `<div class="rfoot">Constatări v${esc(APP_VER)}${ai ? ' · texte formulate cu AI' : ''}</div>`;
  $('print').innerHTML = h;
  clearTimeout(toastT); $('toast').hidden = true;
  for (const i of $('print').querySelectorAll('img')) { try { if (i.decode) await i.decode(); } catch (e) { } }
  window.print();
});
window.addEventListener('afterprint', () => { $('print').innerHTML = ''; });
$('btnStergeExp').onclick = async () => {
  const exp = all.filter(r => r._meta?.exportat);
  if (!exp.length) { toast('Nimic de șters'); return; }
  if (!confirm(`Ștergi ${exp.length} constatări trimise?`)) return;
  for (const r of exp) { await dbDel(r.id); dinLista(r.id); }
  renderGata(); toast('Șters');
};

/* ---------------- SETĂRI ---------------- */
async function renderSetari() {
  head('Setări');
  $('inUser').value = getUser();
  const nApt = Object.entries(cfg.apartamente || {}).filter(([k]) => eLocuinte(k)).reduce((a, [, v]) => a + v.length, 0);
  $('cfgInfo').textContent = `${(cfg.locatii || []).length} clădiri și zone, ${nApt} apartamente, ${(cfg.responsabili || []).length} firme`;
  verificaAi();
  let spatiu = '';
  try { const e = await navigator.storage.estimate(); spatiu = ` · ~${Math.round(e.usage / 1048576)} MB folosiți`; } catch (e) { }
  $('infoApp').textContent = `${all.length} constatări · v${APP_VER}`;
}
$('inUser').addEventListener('input', () => { localStorage.setItem(LS.user, $('inUser').value.trim().toUpperCase().replace(/[^A-Z0-9_]/g, '').slice(0, 20)); });
$('inUser').onchange = () => {
  const u = $('inUser').value.trim().toUpperCase().replace(/[^A-Z0-9_]/g, '').slice(0, 20);
  localStorage.setItem(LS.user, u); $('inUser').value = u; toast(u ? 'Nume salvat: ' + u : 'Nume șters');
};
let verifSeq = 0;
async function verificaAi() {
  const st = $('aiStare'), seq = ++verifSeq;
  if (!aiOn()) { st.textContent = 'oprit'; return; }
  st.textContent = 'verific…';
  try {
    const d = await aiFetch('/user/balance', { method: 'GET' });
    if (seq !== verifSeq) return;
    const b = (d.balance_infos || [])[0];
    st.textContent = 'pornit' + (b && Number(b.total_balance) < 1 ? ' (credit aproape gata)' : '');
  } catch (e) { if (seq === verifSeq) st.textContent = e.message; }
}

/* ---------------- pornire ---------------- */
(async function init() {
  try { if (navigator.storage && navigator.storage.persist) navigator.storage.persist(); } catch (e) { }
  if ('serviceWorker' in navigator) navigator.serviceWorker.register('sw.js').catch(() => { });
  try { await reload(); } catch (e) { toast('Memoria telefonului nu se poate citi', 6000); }
  // codul echipei: din link (?k=…) sau de pe telefon. Datele decriptate se țin pe telefon; se reîmprospătează când se schimbă.
  const codUrl = normCod(new URLSearchParams(location.search).get('k'));
  const codSalvat = localStorage.getItem(LS.cod) || '';
  try { const pk = JSON.parse(localStorage.getItem(LS.pachet) || 'null'); if (pk && pk.cfg) aplicaPachet(pk); } catch (e) { }
  const arataEroareCod = e => { $('lockErr').textContent = e.name === 'OperationError' ? 'Cod greșit' : 'Fără internet'; $('lockErr').hidden = false; };
  const inFundal = c => incarcaDate(c).then(nou => { if (nou && curView === 'start') renderStart(); })
    .catch(e => { if (e.name === 'OperationError') toast('Deschide linkul nou al echipei', 6000); });
  if (codUrl && codUrl !== codSalvat) {              // link nou sau alt cod
    try { await incarcaDate(codUrl, true); }
    catch (e) { if (!PACHET) arataEroareCod(e); else if (codSalvat) inFundal(codSalvat); }
  } else if (codUrl || codSalvat) {
    if (PACHET) inFundal(codUrl || codSalvat);
    else { try { await incarcaDate(codUrl || codSalvat, true); } catch (e) { arataEroareCod(e); } }
  }
  if (!PACHET) { nav = { stack: [], pos: -1 }; navReplace('lock'); show('lock'); return; }
  // după reîncărcare (ex. telefonul a închis pagina cât era deschisă camera) refac istoricul de unde era
  try {
    const s = JSON.parse(sessionStorage.getItem('constatari_nav') || 'null'), st = history.state;
    if (s && Array.isArray(s.stack) && st && Number.isInteger(st.d) && s.stack[st.d] === hashView()) { nav = s; nav.pos = st.d; }
  } catch (e) { }
  const d = await getDraft();
  if (d && d.edit) {
    edit = d.edit; edit.poze = edit.poze || []; edit.resp = edit.resp || [];
    atins = d.atins || { inc: true, spec: true, tip: true };
    editOrig = d.orig || null; pozeVerSalvat = pozeVer;
    ses.locatie = edit.locatie; ses.etaj = edit.etaj; ses.apt = edit.apt; saveSes();
    aiReset(); formDirty = true;
    if (!(nav.pos > 0 && nav.stack[nav.pos] === 'obs' && vineDinLista())) {
      nav = { stack: [], pos: -1 }; navReplace('start'); navPush('apt'); navPush('obs');
    }
    show('obs');
    toast('Constatare recuperată', 2500);
  } else {
    if (d) dropDraft();
    if (nav.pos < 0) navReplace('start');            // pornire nouă (de pe ecranul telefonului) = mereu „Unde ești?”
    if (nav.stack[nav.pos] === 'obs' && vineDinLista()) { history.back(); return; }   // formular fără ciornă -> înapoi la apartament
    show(nav.stack[nav.pos]);
    setTimeout(completeazaMiniaturi, 1500);
  }
})();
