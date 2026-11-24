'use strict';
/* Constatări – v0.2
   Poză / video (GIF) + dictare pe teren -> asistentul AI (DeepSeek, opțional) scrie rândul și alege câmpurile
   -> fișier compatibil cu „Combina backup-uri” din aplicația de verificări.
   Datele stau pe telefon (IndexedDB). Spre AI (doar când completează) pleacă textul + imaginile constatării
   și câteva rânduri-exemplu din backup-ul importat (ca să scrie în același stil). */

const APP_VER = '0.2.1';
const LS = { cfg: 'constatari_cfg', user: 'constatari_user', ses: 'constatari_sesiune', ai: 'constatari_ai_cheie', stil: 'constatari_stil' };
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
function loadCfg() {
  try { const c = JSON.parse(localStorage.getItem(LS.cfg) || 'null'); if (c && Array.isArray(c.locatii)) return { ...DEF, ...c, _importat: true }; } catch (e) { }
  return { ...DEF, _importat: false };
}
let cfg = loadCfg();
let ses = { locatie: '', etaj: '', apt: '', spec: '', tip: 'Neconformitate', prioritate: 'Normal', resp: [], termenZile: 3 };
try { Object.assign(ses, JSON.parse(localStorage.getItem(LS.ses) || '{}')); } catch (e) { }
const saveSes = () => localStorage.setItem(LS.ses, JSON.stringify(ses));
const getUser = () => (localStorage.getItem(LS.user) || '').trim();
function stil() {
  try { const s = JSON.parse(localStorage.getItem(LS.stil) || 'null'); if (s && Array.isArray(s.exemple)) return s; } catch (e) { }
  return { exemple: [], respPeSpec: {} };
}

let _db;
function db() {
  if (_db) return Promise.resolve(_db);
  return new Promise((res, rej) => {
    const r = indexedDB.open('constatari', 2);
    r.onupgradeneeded = () => {
      const d = r.result;
      if (!d.objectStoreNames.contains('obs')) d.createObjectStore('obs', { keyPath: 'id' });
      if (!d.objectStoreNames.contains('draft')) d.createObjectStore('draft', { keyPath: 'k' });
    };
    r.onsuccess = () => {
      const d = r.result; _db = d;
      d.onversionchange = () => { try { d.close(); } catch (e) { } if (_db === d) _db = null; };
      d.onclose = () => { if (_db === d) _db = null; };
      res(d);
    };
    r.onerror = () => rej(r.error);
    r.onblocked = () => toast('Închide celelalte ferestre ale aplicației, apoi reîncarcă.', 6000);
  });
}
async function tx(store, mode, fn, retry = true) {
  let d;
  try {
    d = await db();
    return await new Promise((res, rej) => {
      const t = d.transaction(store, mode); const out = fn(t.objectStore(store));
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
const dbAll = () => tx('obs', 'readonly', st => st.getAll());
const dbPut = rec => tx('obs', 'readwrite', st => st.put(rec));
const dbDel = id => tx('obs', 'readwrite', st => st.delete(id));

let all = [];
async function reload() { all = (await dbAll()).sort((a, b) => (a._ts || 0) - (b._ts || 0)); }
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
  saveDraftNow();
});

/* ---------------- UI mărunt ---------------- */
let toastT;
function toast(msg, ms = 2600) {
  const t = $('toast'); t.textContent = msg; t.hidden = false;
  clearTimeout(toastT); toastT = setTimeout(() => { t.hidden = true; }, ms);
}

// câmp = <select> dacă avem listă, altfel <input> liber
function field(id, list, value, ph, onchange) {
  const box = $(id); box.innerHTML = '';
  let el;
  if (list && list.length) {
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
    if (!st.items.length) box.innerHTML = '<span class="muted small">Lista vine din backup (Setări)</span>';
  }
  draw();
  return {
    get: () => st.items.filter(v => st.sel.has(v)),
    add: v => { if (!v) return; if (!st.items.includes(v)) st.items.push(v); if (!multi) st.sel.clear(); st.sel.add(v); draw(); },
    set: list => { st.sel = new Set(); (list || []).forEach(v => { if (!st.items.includes(v)) st.items.push(v); st.sel.add(v); }); draw(); }
  };
}

/* ---------------- liste din config ---------------- */
const etajePt = loc => (cfg.etaje && cfg.etaje[loc]) || [];
const aptPt = (loc, etaj) => (cfg.apartamente && cfg.apartamente[`${loc}|${etaj}`]) || [];
const specPt = (loc, etaj) => (cfg.specialitatiZone && cfg.specialitatiZone[`${loc}|${etaj}`]) || cfg.specialitati || [];
function camerePt(loc, etaj, apt) {
  const ca = cfg.camere_apt || {}; const pref = `${loc}|${etaj}|`;
  const m = String(apt).match(/^([A-Za-z]+)\d+\.(\d+)$/);           // A1.04 -> A_04
  if (m) {
    const tip = `${m[1].toUpperCase()}_${m[2]}`;
    const k = Object.keys(ca).find(k => k.startsWith(pref) && (k.slice(pref.length) === tip || k.slice(pref.length).startsWith(tip + ' ')));
    if (k && ca[k].length) return ca[k];
  }
  if (ca[pref + apt] && ca[pref + apt].length) return ca[pref + apt];
  const comune = (cfg.camere || []).filter(c => CAMERE_COMUNE.test(c)).slice(0, 14);
  return comune.length ? comune : DEF.camere;
}
const toateCamerele = ed => [...new Set([...camerePt(ed.locatie, ed.etaj, ed.apt), ...(cfg.camere || [])])];
function urmApt() { const l = aptPt(ses.locatie, ses.etaj); const i = l.indexOf(ses.apt); return i >= 0 && i < l.length - 1 ? l[i + 1] : ''; }

/* ---------------- navigare (butonul Înapoi al telefonului merge ca în aplicație) ---------------- */
const VIEWS = { start: 'vStart', apt: 'vApt', obs: 'vObs', gata: 'vGata', setari: 'vSetari' };
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
  if (curView === 'obs' && v !== 'obs') { if (obsNesalvata()) { intreabaIesire(() => go(v, replace)); return; } aruncObs(); }
  if (replace || nav.pos < 0) navReplace(v); else navPush(v);
  show(v);
}
window.addEventListener('popstate', e => {
  const v = hashView();
  const d = e.state && Number.isInteger(e.state.d) ? e.state.d : null;
  if (d !== null) { nav.pos = d; nav.stack[d] = v; }
  else { nav.pos++; nav.stack.length = nav.pos; nav.stack.push(v); history.replaceState({ v, d: nav.pos }, '', '#' + v); }
  if (curView === 'obs' && v !== 'obs') {
    if (obsNesalvata()) { navPush('obs'); intreabaIesire(() => history.back()); return; }
    aruncObs();
  }
  navSave();
  show(v);
});
const obsNesalvata = () => !!edit && formDirty && !saving;
function aruncObs() { if (!edit) return; formDirty = false; stopMic(true); ai.seq++; dropDraft(); edit = null; }
// în loc de confirm() (unde „OK” = aruncă, apăsat din reflex): trei butoane clare
function intreabaIesire(dupaAruncare) {
  const sh = $('sheet'); sh.hidden = false;
  const inchide = () => { sh.hidden = true; };
  $('shSalv').onclick = () => { inchide(); saveForm(); };
  $('shArunc').onclick = () => { inchide(); aruncObs(); dupaAruncare(); };
  $('shRamai').onclick = inchide;
  sh.onclick = e => { if (e.target === sh) inchide(); };
}
function show(v) {
  if (!VIEWS[v]) v = 'start';
  if (v === 'obs' && !edit) v = ses.apt ? 'apt' : 'start';
  if (v === 'apt' && !ses.apt) v = 'start';
  if (location.hash !== '#' + v || !history.state || history.state.d !== nav.pos) navReplace(v);
  curView = v;
  Object.entries(VIEWS).forEach(([k, id]) => { $(id).hidden = k !== v; });
  $('btnBack').hidden = v === 'start';
  $('btnSetari').hidden = v === 'setari' || v === 'obs';
  if (v !== 'obs') stopMic(true);
  ({ start: renderStart, apt: renderApt, obs: renderObs, gata: renderGata, setari: renderSetari })[v]();
  window.scrollTo(0, 0);
}
$('btnBack').onclick = () => nav.pos > 0 ? history.back() : go(parinte(curView), true);
$('btnSetari').onclick = () => go('setari');

/* ---------------- START ---------------- */
const IOS = /iPhone|iPad|iPod/i.test(navigator.userAgent) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
const standalone = () => navigator.standalone === true || (window.matchMedia && matchMedia('(display-mode: standalone)').matches);
let respStart;
function renderStart() {
  head('Constatări', 'Inspecții pe teren');
  $('cfgWarn').hidden = cfg._importat;
  const loc = field('fLocatie', cfg.locatii, ses.locatie, 'alege');
  const drawEtaj = () => {
    const et = field('fEtaj', etajePt(val('fLocatie')), ses.etaj, 'alege');
    const drawApt = () => {
      const ap = field('fApt', aptPt(val('fLocatie'), val('fEtaj')), ses.apt, 'alege');
      ap.addEventListener('change', updIncepe); ap.addEventListener('input', updIncepe);
      field('fSpec', specPt(val('fLocatie'), val('fEtaj')), ses.spec, 'oricare', () => { ses.specAles = true; updDefSum(); });
      updIncepe();
    };
    et.addEventListener('change', () => {          // fără liste (câmpuri scrise de mână) nu refac câmpul următor: s-ar închide tastatura
      ses.etaj = val('fEtaj');
      if (aptPt(val('fLocatie'), ses.etaj).length || eSelect('fApt')) { ses.apt = ''; drawApt(); } else updIncepe();
    });
    drawApt();
  };
  loc.addEventListener('change', () => {
    ses.locatie = val('fLocatie');
    if (etajePt(ses.locatie).length || eSelect('fEtaj')) { ses.etaj = ''; ses.apt = ''; drawEtaj(); }
  });
  drawEtaj();
  field('fTip', cfg.tipuri, ses.tip, 'alege', () => { ses.tipAles = true; updDefSum(); });
  field('fPrio', cfg.prioritati, ses.prioritate, 'alege', updDefSum);
  respStart = makeChips('fResp', cfg.responsabili || [], ses.resp, true, updDefSum);
  $('fTermenZile').value = ses.termenZile ?? 3;
  const neexp = all.filter(r => !r._meta?.exportat).length;
  $('stTotal').textContent = all.length; $('stNoi').textContent = neexp;
  $('aiStart').hidden = aiOn();
  $('iosWarn').hidden = !(IOS && !standalone());
  updDefSum();
}
const eSelect = id => !!$(id).firstElementChild && $(id).firstElementChild.tagName === 'SELECT';
function updIncepe() { const a = val('fApt'); $('btnIncepe').textContent = a ? `Începe la ${a}` : 'Începe verificarea'; }
function updDefSum() {
  const r = respStart ? respStart.get() : ses.resp;
  const z = $('fTermenZile').value;
  $('defSum').textContent = [(r || []).join(' / '), val('fTip'), val('fSpec'), z !== '' ? `termen ${z} zile` : ''].filter(Boolean).join(' · ');
}
$('fTermenZile').addEventListener('input', updDefSum);
function readStart() {
  ses.locatie = val('fLocatie'); ses.etaj = val('fEtaj'); ses.apt = val('fApt');
  ses.spec = val('fSpec'); ses.tip = val('fTip'); ses.prioritate = val('fPrio');
  ses.resp = respStart ? respStart.get() : ses.resp;
  const zv = $('fTermenZile').value.trim(), z = Number(zv);
  ses.termenZile = zv !== '' && Number.isFinite(z) && z >= 0 ? Math.min(Math.round(z), 365) : 3;   // gol = 3 zile, nu „azi”
  $('fTermenZile').value = ses.termenZile;
  saveSes();
}
$('btnIncepe').onclick = () => {
  readStart();
  if (!ses.locatie || !ses.etaj || !ses.apt) { toast('Alege locația, etajul și apartamentul.'); return; }
  go('apt');
};
$('btnLaGata').onclick = () => { readStart(); go('gata'); };
$('lnkSetari').onclick = e => { e.preventDefault(); go('setari'); };
$('lnkSetariAi').onclick = e => { e.preventDefault(); go('setari'); };

/* ---------------- APARTAMENT ---------------- */
function recsApt() { return all.filter(r => r.locatie === ses.locatie && r.etaj === ses.etaj && r.apt === ses.apt); }
function itemHtml(r) {
  const p = r.poze || []; const n = p.length;
  const src = (r._meta && r._meta.thumb) || p[0];
  const img = n ? `<span class="phw"><img class="ph" src="${src}" alt="" loading="lazy">${isGif(p[0]) ? '<span class="badge">GIF</span>' : ''}</span>` : `<div class="ph">${icon('note')}</div>`;
  const meta = [r.tip, r.spec, (r.resp || []).join(' / '), n ? `${n} ${n === 1 ? 'imagine' : 'imagini'}` : ''].filter(Boolean).map(esc).join('<span>·</span>');
  const exp = r._meta?.exportat ? ' <span class="pill ok">exportat</span>' : '';
  return `${img}<div class="body"><div class="room">${esc(r.inc || 'Fără încăpere')}</div>
    <div class="d">${esc(r.obs || '(fără descriere)')}</div><div class="m">${meta}${exp}</div></div>`;
}
function renderApt() {
  head(ses.apt, `${ses.locatie} › ${ses.etaj}`);
  const list = recsApt();
  $('aptCount').textContent = `${list.length} ${list.length === 1 ? 'constatare' : 'constatări'}`;
  $('aptCount').hidden = !list.length;
  $('aptEmpty').hidden = !!list.length;
  const box = $('aptList'); box.innerHTML = '';
  list.slice().reverse().forEach(r => {
    const d = document.createElement('button'); d.type = 'button'; d.className = 'item'; d.innerHTML = itemHtml(r);
    d.onclick = () => openObs(r); box.appendChild(d);
  });
  const u = urmApt();
  $('btnAptUrm').hidden = !u;
  $('btnAptUrm').innerHTML = `${esc(u)}${icon('next')}`;
  $('btnAptUrm').setAttribute('aria-label', 'Apartamentul următor: ' + u);
}
$('btnNou').onclick = () => openObs(null);
$('btnGata').onclick = () => go('gata');
$('btnAptUrm').onclick = () => {
  const u = urmApt(); if (!u) return;
  ses.apt = u; saveSes(); renderApt(); window.scrollTo(0, 0); toast('Acum: ' + u);
};

/* ---------------- FORMULAR ---------------- */
let edit = null, incChips, respObs;
let atins = { inc: false, spec: false, tip: false };       // ce a ales omul de mână (AI-ul nu le mai schimbă)
const cadreGif = new Map();                                  // GIF -> 3 cadre JPEG pentru AI
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
function openObs(rec) {
  edit = rec ? JSON.parse(JSON.stringify(rec)) : newRec();
  edit.poze = edit.poze || []; edit.resp = edit.resp || [];
  // ce s-a ales la Start pentru toată verificarea contează ca ales de om: AI-ul nu-l schimbă
  atins = rec ? { inc: !!rec.inc, spec: true, tip: true } : { inc: false, spec: !!(ses.specAles && ses.spec), tip: !!(ses.tipAles && ses.tip) };
  editOrig = rec ? amprenta(edit) : null;
  formDirty = false; pozeVer++; aiReset();
  go('obs');
}
function renderObs() {
  head(edit.id ? 'Editare constatare' : 'Constatare nouă', `${edit.locatie} › ${edit.etaj} › ${edit.apt}`);
  drawThumbs();
  const cam = camerePt(edit.locatie, edit.etaj, edit.apt);
  const sel = edit.inc ? edit.inc.split(',').map(s => s.trim()).filter(Boolean) : [];
  incChips = makeChips('incChips', cam, sel, false, () => { atins.inc = true; onFormChange(); });   // o singură încăpere, ca în aplicația de verificări
  const alte = (cfg.camere || []).filter(c => !cam.includes(c));
  $('incAlta').innerHTML = '<option value="">Altă încăpere…</option>' + alte.map(c => `<option>${esc(c)}</option>`).join('');
  $('incAlta').hidden = !alte.length;
  $('txtObs').value = edit.obs || ''; creste();
  drawDetalii();
  $('btnSterge').hidden = !edit.id;
  $('obsExportat').hidden = !(edit._meta && edit._meta.exportat);
  updFotoBusy();
  renderMicInfo();
  micUi(); aiUi();
}
function drawDetalii() {
  field('oSpec', specPt(edit.locatie, edit.etaj), edit.spec, 'specialitate', () => { atins.spec = true; onFormChange(); });
  field('oTip', cfg.tipuri, edit.tip, 'tip', () => { atins.tip = true; onFormChange(); });
  field('oPrio', cfg.prioritati, edit.prioritate, 'prioritate', onFormChange);
  respObs = makeChips('oResp', cfg.responsabili || [], edit.resp || [], true, onFormChange);
  $('oTermen').value = edit.termen || '';
  updSumObs();
}
function updSumObs() {
  $('sumObs').textContent = [val('oSpec'), val('oTip'), respObs ? respObs.get().join(' / ') : ''].filter(Boolean).join(' · ') || 'specialitate, tip, firmă';
}
function onFormChange() { formDirty = true; updSumObs(); saveDraftSoon(); aiUi(); }
$('incAlta').onchange = e => { if (e.target.value) { incChips.add(e.target.value); e.target.value = ''; atins.inc = true; onFormChange(); } };
$('txtObs').addEventListener('input', () => { creste(); onFormChange(); });
function creste() { const t = $('txtObs'); t.style.height = 'auto'; t.style.height = Math.min(t.scrollHeight + 2, 280) + 'px'; }
$('oTermen').addEventListener('change', onFormChange);

function drawThumbs() {
  const box = $('thumbs'); box.innerHTML = '';
  edit.poze.forEach((p, i) => {
    const d = document.createElement('div'); d.className = 'thumb';
    d.innerHTML = `<img src="${p}" alt="">${isGif(p) ? '<span class="badge">GIF</span>' : ''}<button type="button" aria-label="Scoate imaginea">${icon('x')}</button>`;
    d.querySelector('button').onclick = () => { edit.poze.splice(i, 1); pozeVer++; drawThumbs(); onFormChange(); };
    box.appendChild(d);
  });
  inLucru.filter(j => j.ed === edit).forEach(j => {
    const d = document.createElement('div'); d.className = 'thumb busy';
    d.innerHTML = j.tip === 'video' ? `<div class="prog"><span class="spin"></span><b>${j.pct}%</b><small>fac GIF</small></div>` : `<div class="prog"><span class="spin"></span><small>poză</small></div>`;
    j.el = d; box.appendChild(d);
  });
}
async function compress(file, MAX = 1600, q = 0.72) {
  const url = URL.createObjectURL(file);
  try { return await imgToJpeg(url, MAX, q); } finally { URL.revokeObjectURL(url); }
}
async function imgToJpeg(src, MAX, q) {
  const img = await new Promise((res, rej) => { const i = new Image(); i.onload = () => res(i); i.onerror = () => rej(new Error('imagine')); i.src = src; });
  const s = Math.min(1, MAX / Math.max(img.naturalWidth, img.naturalHeight));
  const w = Math.max(1, Math.round(img.naturalWidth * s)), h = Math.max(1, Math.round(img.naturalHeight * s));
  const c = document.createElement('canvas'); c.width = w; c.height = h;
  const g = c.getContext('2d'); g.fillStyle = '#fff'; g.fillRect(0, 0, w, h); g.drawImage(img, 0, 0, w, h);
  const out = c.toDataURL('image/jpeg', q);
  c.width = c.height = 0;                          // iPhone are o limită totală de memorie pentru canvas
  return out;
}
const eVideo = f => /^video\//.test(f.type) || /\.(mp4|mov|m4v|webm|3gp|mkv)$/i.test(f.name || '');
function jobNou(ed, tip) {
  let gata; const job = { ed, tip, pct: 0, el: null, gata: new Promise(r => { gata = r; }) };
  job.termina = () => { const i = inLucru.indexOf(job); if (i >= 0) inLucru.splice(i, 1); gata(); if (edit === ed) { drawThumbs(); updFotoBusy(); } };
  inLucru.push(job); return job;
}
function updFotoBusy() {
  const v = !!edit && inLucru.some(j => j.ed === edit && j.tip === 'video');
  $('photos').classList.toggle('busy', v);
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
    try { const p = await compress(poze[i]); ed.poze.push(p); adaugate++; } catch (err) { toast('Nu am putut citi o poză.'); }
    joburi[i].termina();
  }
  if (adaugate) { pozeVer++; if (edit === ed) { onFormChange(); aiDinImagine(); } }
}
function addVideo(f, ed) {
  const job = jobNou(ed, 'video');
  if (edit === ed) { drawThumbs(); updFotoBusy(); toast('Fac GIF-ul din video. Între timp poți dicta.', 3500); }
  coadaVideo = coadaVideo.then(async () => {      // unul câte unul: telefonul nu decodează bine mai multe video deodată
    try {
      const r = await videoToGif(f, p => { job.pct = p; const b = job.el && job.el.querySelector('b'); if (b) b.textContent = p + '%'; });
      if (r.taiat) toast(`Video lung: am păstrat primele ${r.sec} secunde.`, 4500);
      ed.poze.push(r.url); cadreGif.set(r.url, r.cadre); pozeVer++;
      if (edit === ed) { onFormChange(); aiDinImagine(); }
    } catch (err) { toast('Nu am putut face GIF din video: ' + err.message, 5000); }
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
  edit.spec = val('oSpec'); edit.tip = val('oTip'); edit.prioritate = val('oPrio');
  if (respObs) edit.resp = respObs.get();
  edit.termen = $('oTermen').value || '';
}
async function saveForm() {
  if (!edit || saving) return;
  const ed = edit;
  saving = true; $('btnSalv').disabled = true;
  try {
    const pend = inLucru.filter(j => j.ed === ed);
    if (pend.length) {
      toast(pend.some(j => j.tip === 'video') ? 'Termin GIF-ul, apoi salvez…' : 'Termin poza, apoi salvez…', 4000);
      await Promise.all(pend.map(j => j.gata));
    }
    if (micOn || rec) { stopMic(true); await asteptMic(); }
    if (edit !== ed) return;
    readForm();
    if (!ed.obs && !ed.poze.length) { toast('Pune măcar o poză sau o descriere.'); return; }
    if (!ed.inc) { toast('Alege încăperea.'); $('incChips').scrollIntoView({ block: 'center', behavior: 'smooth' }); return; }
    ai.seq++;                                          // un răspuns AI întârziat nu mai schimbă nimic
    if (ed.id && editOrig && editOrig === amprenta(ed)) {   // n-ai schimbat nimic: nu o marchez ca nouă (nu se reexportă)
      edit = null; formDirty = false; await dropDraft(); inapoiLaApt(); return;
    }
    if (!ed.id) ed.id = genId();
    ed._ts = Date.now();
    ed.poza = ed.poze[0] || '';
    ed._meta = { ...(ed._meta || {}), exportat: null };   // modificată după export -> se exportă din nou
    try { ed._meta.thumb = ed.poze[0] ? await imgToJpeg(ed.poze[0], 200, 0.7) : ''; } catch (e) { ed._meta.thumb = ''; }
    try { await dbPut(ed); } catch (err) { toast('Nu am putut salva: ' + err.message, 7000); return; }
    edit = null; formDirty = false;
    inLista(ed);
    await dropDraft();
    toast('Salvat');
    inapoiLaApt();
  } finally { saving = false; $('btnSalv').disabled = false; }
}
function inapoiLaApt() { if (prevView() === 'apt') history.back(); else go('apt', true); }
$('btnSalv').onclick = saveForm;
$('btnSterge').onclick = async () => {
  if (!edit || !edit.id || !confirm('Ștergi constatarea asta de pe telefon?')) return;
  const id = edit.id; await dbDel(id); dinLista(id); formDirty = false; edit = null; await dropDraft(); toast('Șters'); inapoiLaApt();
};

/* ---------------- DICTARE ---------------- */
const SR = window.SpeechRecognition || window.webkitSpeechRecognition;
const ANDROID = /Android/i.test(navigator.userAgent);
let rec = null, micOn = false, micBase = '', aiDupaMic = false, micIdleT = null, srOprit = false;
function micActiv() { clearTimeout(micIdleT); if (micOn) micIdleT = setTimeout(() => { if (micOn) { stopMic(false); toast('Am oprit microfonul (nu am mai auzit nimic).', 3500); } }, 25000); }
function micUi() {
  const b = $('btnMic'); b.classList.toggle('on', micOn);
  b.innerHTML = micOn ? `${icon('stop')}<span>Gata, am terminat</span>` : `${icon('mic')}<span>Dictează</span>`;
}
function renderMicInfo() {
  $('micInfo').textContent = (!SR || srOprit) ? 'Pe acest telefon: apasă microfonul de pe tastatură și vorbește.'
    : aiOn() ? 'Ex.: „ușa de la baie, tocul zgâriat sus”. Aplicația scrie rândul și alege încăperea.'
      : 'Ex.: „ușa de la baie, tocul zgâriat sus”.';
}
const asteptMic = () => rec ? Promise.race([rec.sfarsit, pauza(1500)]) : Promise.resolve();
async function startMic() {
  if (!SR || srOprit) { toast('Apasă microfonul de pe tastatura telefonului și vorbește.', 4000); $('txtObs').focus(); return; }
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
  r.lang = 'ro-RO'; r.interimResults = true;
  r.continuous = !ANDROID;                           // pe Android „continuous” dublează cuvintele -> repornesc eu
  let gata; r.sfarsit = new Promise(res => { gata = res; });
  micBase = ta.value.trim() ? ta.value.trim() + ' ' : '';
  r.onresult = e => {
    if (rec !== r) return;
    let fin = '', interim = '';
    for (let i = 0; i < e.results.length; i++) {
      const x = e.results[i];
      if (x.isFinal) fin += x[0].transcript.trim() + ' '; else interim += x[0].transcript;
    }
    ta.value = (micBase + fin + interim).replace(/\s+/g, ' ').trimStart(); creste(); micActiv();
    formDirty = true;
  };
  r.onerror = e => {
    if (rec !== r || document.hidden) return;
    const opreste = msg => { micOn = false; aiDupaMic = false; toast(msg, 5000); };
    if (e.error === 'service-not-allowed') {
      srOprit = true; opreste('Dictarea din aplicație nu merge pe acest telefon. Apasă microfonul de pe tastatură.'); renderMicInfo(); ta.focus();
    } else if (e.error === 'not-allowed') opreste('Microfonul e blocat pentru aplicație. Permite-l din setările telefonului sau folosește microfonul de pe tastatură.');
    else if (e.error === 'network') opreste('Dictarea are nevoie de internet. Scrie sau folosește tastatura.');
    else if (e.error === 'audio-capture') opreste('Nu găsesc microfonul.');
  };
  r.onend = () => {
    if (rec !== r) { gata(); return; }
    if (micOn && !document.hidden) { micBase = ta.value.trim() ? ta.value.trim() + ' ' : ''; try { r.start(); return; } catch (err) { } }
    micOn = false; rec = null; micUi(); gata();
    if (!edit) return;
    onFormChange();
    if (aiDupaMic) { aiDupaMic = false; if (ta.value.trim()) aiRun('dictare'); }
  };
  try { r.start(); micOn = true; aiDupaMic = false; micUi(); aiUi(); micActiv(); }
  catch (err) { rec = null; gata(); toast('Nu am putut porni dictarea.'); }
}
function stopMic(faraAi) {
  clearTimeout(micIdleT);
  if (rec && micOn) { micOn = false; aiDupaMic = !faraAi; try { rec.stop(); } catch (e) { } }
  else if (faraAi) aiDupaMic = false;
  if ($('btnMic')) micUi();
}
$('btnMic').onclick = () => micOn ? stopMic(false) : startMic();

/* ---------------- ASISTENT AI (DeepSeek) ---------------- */
const AI = { url: 'https://api.deepseek.com', model: 'deepseek-flash', timeout: 35000 };
const aiKey = () => (localStorage.getItem(LS.ai) || '').trim();
const aiOn = () => !!aiKey();
const PROMPT = `Esti asistentul unui inginer care verifica apartamente noi inainte de predare, pe un santier de blocuri de locuinte.
Primesti: textul dictat de inginer (recunoastere vocala automata, poate avea cuvinte gresite), 0-4 imagini (poze sau cadre dintr-un video) si listele aplicatiei.
Scrii constatarea pentru aplicatia de verificari.

"obs" = UN rand scurt (de regula sub 80 de caractere), FARA diacritice, fara punct la final, in stilul exemplelor: elementul + unde + problema.
- Pastrezi exact sensul inginerului. NU adaugi probleme pe care nu le-a spus.
- Imaginile le folosesti doar ca sa precizezi ce a spus (ce element, ce parte, sus/jos, interior/exterior) si DOAR cu ce se vede sigur; daca nu esti sigur, nu adaugi nimic din imagine. Daca NU exista text dictat, descrii problema clar vizibila in imagini si pui "din_imagine": true; daca nu se vede nicio problema clara, "obs" = "".
- Mai multe probleme la acelasi element: in acelasi rand, separate prin "; ".
- Corectezi cuvintele recunoscute gresit dupa glosar (ex. "spalier" -> "spalet").
Exemple de stil: "Toc usa baie zgariat (partea superioara)" · "Usa dormitor nu se inchide" · "Usa acces zgariata" · "Usa baie cu dus atinge tocul la inchidere" · "Usa baie dus nu este in boloboc" · "Coltar grinda living nu este drept" · "Urme de slefuit pe intrados" · "Spalet fereastra nefinisat in partea de jos" · "Lavabil scurs sub priza" · "Masca cada nu este in linie cu cada" · "Rampa CT murdara de vopsea" · "Folie lichida neindepartata de pe tamplarie".
Glosar: spalet = latura golului de usa/fereastra · intrados = fata de dedesubt a grinzii · coltar = profilul de pe muchie · olnita = racordul/muchia dintre doua suprafete · aparataj = prize, intrerupatoare · CT = centrala termica · rampa CT = tevile de sub centrala · masca cada = panoul care inchide cada · distantiere = crucitele dintre placi · defoliat = scoasa folia de protectie · folie lichida · beton contact · reparatii perimetrale = retusurile din jurul ramei/tocului · toc · foaie usa · pervaz · glaf · plinta · balamale · broasca · yala · maner · garnitura · prag · glet · lavabil · chit · boloboc (nu e in boloboc = nu e drept/la nivel) · are joc = se misca, nu sta fix.

Campuri:
- "inc": incaperea, scrisa EXACT ca in lista "incaperi"; "" daca nu reiese. Daca ce spune omul se potriveste cu mai multe din lista (ex. "baie", iar lista are "Baie cu cada" si "Baie cu rigola"), alegi doar daca reiese clar (cada / dus / rigola); altfel "" si in "nesigur" scrii "care baie?".
- "spec": specialitatea, EXACT din lista "specialitati"; "" daca nu reiese.
- "tip": EXACT din lista "tipuri" (Deteriorare = stricat, zgariat, ciupit, rupt; Neconformitate = executat gresit sau nu functioneaza; Lipsa = lipseste; Neterminat = nefinalizat; Curatenie = murdarie de indepartat).
- "nesigur": foarte scurt, doar daca ceva important nu e clar (ex. "nu reiese care usa"); altfel "".
Raspunzi DOAR cu JSON: {"obs":"","inc":"","spec":"","tip":"","din_imagine":false,"nesigur":""}`;

let ai = { seq: 0, busy: false, undo: null, sig: '', stare: null, info: null, descriere: '' };
function aiReset() { ai = { seq: ai.seq + 1, busy: false, undo: null, sig: '', stare: null, info: null, descriere: '' }; }
const semnatura = () => edit ? `${$('txtObs').value.trim()}|${edit.poze.length}` : '';
function aiUi() {
  const areInput = !!edit && (!!$('txtObs').value.trim() || edit.poze.length > 0);
  $('btnAi').hidden = !aiOn() || ai.busy || micOn || !areInput || semnatura() === ai.sig;
  const bar = $('aiBar');
  if (!ai.stare || micOn) { bar.hidden = true; return; }
  bar.hidden = false; bar.className = 'aibar ' + ai.stare;
  if (ai.stare === 'lucru') bar.innerHTML = `<span class="spin"></span><span>Completez automat…</span>`;
  else if (ai.stare === 'gata') {
    const i = ai.info || {};
    bar.innerHTML = `${icon('spark')}<span>${i.dinImagine ? 'Descris din imagine. Verifică textul.' : 'Completat automat din ce ai spus.'}${i.nesigur ? `<small>Neclar: ${esc(i.nesigur)}</small>` : ''}</span><button type="button" id="aiUndo" class="linkbtn">Anulează</button>`;
    $('aiUndo').onclick = aiAnuleaza;
  } else if (ai.stare === 'eroare') {
    bar.innerHTML = `${icon('alert')}<span>Nu am putut completa automat: ${esc(ai.info)}</span><button type="button" id="aiRetry" class="linkbtn">Reîncearcă</button>`;
    $('aiRetry').onclick = () => aiRun('buton');
  } else if (ai.stare === 'nimic') {
    bar.innerHTML = `${icon('alert')}<span>Nu văd o problemă clară în imagine. Spune ce e.</span>`;
  }
}
function aiStare(s, info) { ai.stare = s; ai.info = info ?? null; aiUi(); }
$('btnAi').onclick = () => aiRun('buton');

function aiDinImagine() {           // după o poză / un GIF nou: dacă nu e text, propune o descriere din imagine
  if (!aiOn() || !edit || micOn || ai.busy || $('txtObs').value.trim()) return;
  aiRun('imagine');
}
async function aiRun(motiv) {
  if (!aiOn() || !edit) return;
  readForm();
  const text = $('txtObs').value.trim();
  if (!text && !edit.poze.length) return;
  const vorbit = ai.descriere && text === ai.descriere ? '' : text;   // descrierea propusă din imagine nu e „ce a spus omul”
  const ed = edit, seq = ++ai.seq;
  ai.busy = true; ai.running = seq; aiStare('lucru');
  try {
    const imgs = await imaginiPentruAi(ed);
    const o = await aiCall(vorbit, imgs, ed);
    if (seq !== ai.seq || edit !== ed) return;
    if (motiv === 'imagine' && ($('txtObs').value.trim() || micOn)) { aiStare(null); return; }   // între timp omul a scris / vorbește
    if ($('txtObs').value.trim() !== text) { aiStare(null); return; }                                // textul s-a schimbat între timp
    aplicaAi(o, vorbit);
  } catch (e) {
    if (seq === ai.seq && edit === ed) aiStare('eroare', e.message);
  } finally {
    if (ai.running === seq) { ai.busy = false; ai.running = 0; aiUi(); }
  }
}
async function imaginiPentruAi(ed) {
  const out = [];
  for (const p of ed.poze.slice(0, 4)) {
    if (isGif(p) && cadreGif.has(p)) out.push(...cadreGif.get(p));
    else { try { out.push(await imgToJpeg(p, 1024, 0.7)); } catch (e) { } }
    if (out.length >= 4) break;
  }
  return out.slice(0, 4);
}
async function aiFetch(path, opt) {
  const ctrl = new AbortController(); const to = setTimeout(() => ctrl.abort(), AI.timeout);
  try {                                              // limita de timp ține și pentru citirea răspunsului (semnal slab)
    let res;
    try { res = await fetch(AI.url + path, { ...opt, signal: ctrl.signal, headers: { ...(opt.headers || {}), Authorization: 'Bearer ' + aiKey() } }); }
    catch (e) { throw new Error(e.name === 'AbortError' ? 'răspunsul a durat prea mult' : 'nu am internet acum'); }
    if (res.status === 401) throw new Error('cheia nu e bună (vezi Setări)');
    if (res.status === 402) throw new Error('s-a terminat creditul DeepSeek');
    if (res.status === 429) throw new Error('prea multe cereri, mai încearcă');
    if (!res.ok) throw new Error('eroare ' + res.status);
    try { return await res.json(); } catch (e) { throw new Error(e.name === 'AbortError' ? 'răspunsul a durat prea mult' : 'răspuns incomplet, mai încearcă'); }
  } finally { clearTimeout(to); }
}
async function aiCall(text, imgs, ed) {
  const st = stil();
  const ctx = {
    text_dictat: text || '(nimic dictat - descrie din imagini)',
    incaperi: toateCamerele(ed), specialitati: specPt(ed.locatie, ed.etaj), tipuri: cfg.tipuri,
    specialitate_aleasa_inainte: ed.spec || '',
    exemple_din_aplicatia_de_verificari: st.exemple.slice(0, 40)
  };
  const content = [{ type: 'text', text: JSON.stringify(ctx) }, ...imgs.map(u => ({ type: 'image_url', image_url: { url: u } }))];
  const d = await aiFetch('/chat/completions', {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      model: AI.model, temperature: 0.2, response_format: { type: 'json_object' },
      // cu text: fără „gândire” (~1-2 s). Doar imagine: gândire scurtă (~5 s), altfel e prea prudent; omul oricum abia începe să vorbească
      ...(text ? { thinking: { type: 'disabled' }, max_tokens: 1500 } : { reasoning_effort: 'low', max_tokens: 4000 }),
      messages: [{ role: 'system', content: PROMPT }, { role: 'user', content }]
    })
  });
  const o = jsonLax(d.choices && d.choices[0] && d.choices[0].message && d.choices[0].message.content);
  if (o) return o;
  throw new Error('răspuns neclar, mai încearcă');
}
function jsonLax(s) {               // JSON-ul poate veni tăiat sau cu text în jur
  if (typeof s !== 'string' || !s.trim()) return null;
  try { const o = JSON.parse(s); return o && typeof o === 'object' ? o : null; } catch (e) { }
  const m = s.match(/\{[\s\S]*\}/); if (m) { try { return JSON.parse(m[0]); } catch (e) { } }
  const o = {};
  ['obs', 'inc', 'spec', 'tip', 'nesigur'].forEach(k => { const r = new RegExp('"' + k + '"\\s*:\\s*"((?:[^"\\\\]|\\\\.)*)"').exec(s); if (r) { try { o[k] = JSON.parse('"' + r[1] + '"'); } catch (e) { o[k] = r[1]; } } });
  return o.obs !== undefined ? o : null;
}
function potrivire(v, list) {
  if (!v || !list || !list.length) return '';
  if (list.includes(v)) return v;
  const k = cheie(v); return list.find(x => cheie(x) === k) || '';
}
function curat(s) {
  let t = fara(s).replace(/\s+/g, ' ').trim().replace(/[.\s]+$/, '');
  if (t.length > 220) t = t.slice(0, 220);
  return t ? t[0].toUpperCase() + t.slice(1) : '';
}
function aplicaAi(o, textInitial) {
  readForm();
  const inainte = { txt: $('txtObs').value, inc: incChips.get(), spec: edit.spec, tip: edit.tip, resp: edit.resp.slice() };
  const sch = [];
  const obs = curat(o.obs);
  if (!obs && !textInitial) { aiStare('nimic'); ai.sig = semnatura(); return; }
  if (obs && obs !== $('txtObs').value.trim()) { $('txtObs').value = obs; creste(); sch.push('txtObs'); }
  const cam = textInitial ? potrivire(o.inc, toateCamerele(edit)) : '';     // din imagine singură nu ghicesc încăperea
  if (cam && !atins.inc) { const c = incChips.get(); if (c.length !== 1 || c[0] !== cam) { incChips.set([cam]); sch.push('incChips'); } }
  const sp = potrivire(o.spec, specPt(edit.locatie, edit.etaj));
  if (sp && !atins.spec && sp !== edit.spec) { edit.spec = sp; sch.push('oSpec'); }
  const tp = potrivire(o.tip, cfg.tipuri);
  if (tp && !atins.tip && tp !== edit.tip) { edit.tip = tp; sch.push('oTip'); }
  if (!edit.resp.length) {
    const m = stil().respPeSpec || {}; const r = m[`${edit.locatie}|${edit.spec}`] || m[edit.spec];
    if (r && r.length) { edit.resp = r.slice(); sch.push('oResp'); }
  }
  edit._meta = { ...(edit._meta || {}) };
  if (textInitial) edit._meta.dictat = textInitial;
  ai.undo = inainte;
  ai.descriere = !textInitial && obs ? obs : '';
  drawDetalii(); formDirty = true; readForm(); saveDraftSoon();
  ai.sig = semnatura();
  aiStare('gata', { dinImagine: !textInitial, nesigur: String(o.nesigur || '').slice(0, 120) });
  if (sch.some(x => x === 'oSpec' || x === 'oTip' || x === 'oResp')) sch.push('sumObs');   // Detalii e de obicei închis: arăt schimbarea pe rândul rezumat
  sch.forEach(id => { const el = $(id) && ($(id).closest('.frow, .fblock, .group') || $(id)); if (el) { el.classList.remove('flash'); void el.offsetWidth; el.classList.add('flash'); } });
}
function aiAnuleaza() {
  const u = ai.undo; if (!u || !edit) return;
  $('txtObs').value = u.txt; creste(); incChips.set(u.inc); edit.spec = u.spec; edit.tip = u.tip; edit.resp = u.resp;
  drawDetalii(); ai.undo = null; ai.sig = ''; aiStare(null); onFormChange();
}

/* ---------------- GATA / EXPORT ---------------- */
function recsExport() { return $('doarNoi').checked ? all.filter(r => !r._meta?.exportat) : all.slice(); }
function grupat(recs) {
  const g = new Map();
  recs.forEach(r => { const k = `${r.locatie} · ${r.etaj} · ${r.apt}`; if (!g.has(k)) g.set(k, []); g.get(k).push(r); });
  return g;
}
function renderGata() {
  head('Export', 'Constatări de pe acest telefon');
  const recs = recsExport();
  const g = grupat(recs);
  $('gxObs').textContent = recs.length;
  $('gxPoze').textContent = recs.reduce((s, r) => s + (r.poze || []).length, 0);
  $('gxApt').textContent = g.size;
  let h = '';
  g.forEach((l, k) => { h += `<div class="grow-row"><span>${esc(k.replace(/ · /g, ' › '))}</span><span class="pill">${l.length}</span></div>`; });
  $('gataSum').innerHTML = h || '<div class="grow-row muted">Nimic de exportat.</div>';
}
$('doarNoi').onchange = renderGata;
const stamp = () => { const d = new Date(); return `${isoDate(d)}_${pad(d.getHours())}${pad(d.getMinutes())}`; };
const pentruApp = r => { const o = { ...r }; delete o._meta; return o; };

// iPhone: meniul de partajare („Salvează în Fișiere”, WhatsApp, mail). Android / laptop: descărcare directă în Downloads
// (meniul de partajare de pe Android de obicei nu are „salvează pe telefon”).
async function shareOrDownload(blob, name) {
  const ios = /iPhone|iPad|iPod/i.test(navigator.userAgent) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
  const file = new File([blob], name, { type: blob.type });
  if (ios && navigator.canShare && navigator.canShare({ files: [file] })) {
    try { await navigator.share({ files: [file], title: name }); return true; }
    catch (e) { if (e.name === 'AbortError') return false; }
  }
  const a = document.createElement('a'); a.href = URL.createObjectURL(blob); a.download = name;
  document.body.appendChild(a); a.click();
  setTimeout(() => { URL.revokeObjectURL(a.href); a.remove(); }, 30000);
  return true;
}
$('btnExpApp').onclick = async () => {
  const recs = recsExport();
  if (!recs.length) { toast('Nimic de exportat.'); return; }
  const blob = new Blob([JSON.stringify({ observatii: recs.map(pentruApp) })], { type: 'application/json' });
  const ok = await shareOrDownload(blob, `constatari_${stamp()}_${recs.length}obs.json`);
  if (!ok) return;
  const t = new Date().toISOString();
  for (const r of recs) { r._meta = { ...(r._meta || {}), exportat: t }; await dbPut(r); }
  renderGata();
  toast(`Exportat: ${recs.length}. Acum în aplicația de verificări → „Combina backup-uri”.`, 5000);
};
$('btnExpCsv').onclick = async () => {
  const recs = recsExport();
  if (!recs.length) { toast('Nimic de exportat.'); return; }
  const cols = ['Locatie', 'Etaj', 'Apartament', 'Incapere', 'Observatie', 'Specialitate', 'Tip', 'Prioritate', 'Responsabil', 'Data', 'Termen', 'Nr imagini', 'Text dictat', 'Id'];
  const q = v => { const s = String(v ?? ''); return /[;"\r\n]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s; };
  const rows = recs.map(r => [r.locatie, r.etaj, r.apt, r.inc, r.obs, r.spec, r.tip, r.prioritate, (r.resp || []).join(' / '), r.dataObs, r.termen, (r.poze || []).length, r._meta?.dictat || '', r.id].map(q).join(';'));
  const blob = new Blob(['\ufeff' + [cols.join(';')].concat(rows).join('\r\n')], { type: 'text/csv' });
  await shareOrDownload(blob, `constatari_${stamp()}.csv`);
};
$('btnExpPdf').onclick = async () => {
  const recs = recsExport();
  if (!recs.length) { toast('Nimic de exportat.'); return; }
  const g = grupat(recs);
  let h = `<h1>Raport constatări</h1><div class="sub">${esc(roDateTime(new Date()))} · ${recs.length} constatări${getUser() ? ' · ' + esc(getUser()) : ''}</div>`;
  g.forEach((l, k) => {
    h += `<h2>${esc(k)}</h2>`;
    const pe = new Map(); l.forEach(r => { const i = r.inc || '(fără încăpere)'; if (!pe.has(i)) pe.set(i, []); pe.get(i).push(r); });
    pe.forEach((rs, inc) => {
      h += `<h3>${esc(inc)}:</h3>`;
      rs.forEach(r => {
        h += `<div class="o"><div>- ${esc(r.obs || '')}</div><div class="m">${esc([r.tip, r.spec, (r.resp || []).join(' / '), r.termen ? 'termen ' + r.termen : ''].filter(Boolean).join(' · '))}</div>`
          + (r.poze || []).map(p => `<figure><img src="${p}" alt="">${isGif(p) ? '<figcaption>cadru din video (GIF)</figcaption>' : ''}</figure>`).join('') + '</div>';
      });
    });
  });
  $('print').innerHTML = h;
  toast('Pregătesc raportul…', 2000);
  await Promise.all([...$('print').querySelectorAll('img')].map(i => (i.decode ? i.decode() : Promise.resolve()).catch(() => { })));
  window.print();
};
window.addEventListener('afterprint', () => { $('print').innerHTML = ''; });
$('btnStergeExp').onclick = async () => {
  const exp = all.filter(r => r._meta?.exportat);
  if (!exp.length) { toast('Nu ai nimic exportat de șters.'); return; }
  if (!confirm(`Ștergi de pe telefon ${exp.length} constatări deja exportate?\n(Verifică întâi că au intrat în aplicația de verificări.)`)) return;
  for (const r of exp) { await dbDel(r.id); dinLista(r.id); }
  renderGata(); toast('Șters');
};

/* ---------------- SETĂRI ---------------- */
async function renderSetari() {
  head('Setări');
  $('inUser').value = getUser();
  const st = stil();
  $('cfgInfo').textContent = cfg._importat
    ? `${cfg.locatii.length} locații · ${Object.keys(cfg.apartamente || {}).length} etaje · ${(cfg.camere || []).length} încăperi · ${(cfg.responsabili || []).length} firme${st.exemple.length ? ` · ${st.exemple.length} exemple de stil` : ''}`
    : 'Nicio listă importată';
  $('inAiKey').value = aiKey();
  verificaAi();
  let spatiu = '';
  try { const e = await navigator.storage.estimate(); spatiu = ` · spațiu folosit ~${Math.round(e.usage / 1048576)} MB`; } catch (e) { }
  $('infoApp').textContent = `Constatări v${APP_VER} · ${all.length} constatări pe telefon${spatiu}`;
}
$('inUser').onchange = () => {
  const u = $('inUser').value.trim().toUpperCase().replace(/[^A-Z0-9_]/g, '').slice(0, 20);
  localStorage.setItem(LS.user, u); $('inUser').value = u; toast(u ? 'Nume salvat: ' + u : 'Nume șters');
};
let verifSeq = 0;
async function verificaAi() {
  const st = $('aiStare'), seq = ++verifSeq;
  st.className = 'fc muted';
  if (!aiOn()) { st.textContent = 'Oprit (fără cheie)'; return; }
  st.textContent = 'Verific…';
  try {
    const d = await aiFetch('/user/balance', { method: 'GET' });
    if (seq !== verifSeq) return;
    const b = (d.balance_infos || [])[0];
    st.textContent = 'Pornit' + (b ? ` · credit ${b.total_balance} ${b.currency}` : ''); st.className = 'fc ok';
  } catch (e) { if (seq === verifSeq) { st.textContent = e.message; st.className = 'fc err'; } }
}
$('inAiKey').onchange = () => {
  const k = $('inAiKey').value.trim().replace(/\s+/g, '');
  if (k) localStorage.setItem(LS.ai, k); else localStorage.removeItem(LS.ai);
  $('inAiKey').value = k;
  verificaAi();
};
function construiesteStil(obs) {
  const lista = (Array.isArray(obs) ? obs : []).filter(o => o && typeof o.obs === 'string');
  const bune = lista.filter(o => o.obs.trim().length >= 8 && o.obs.trim().length <= 110).sort((a, b) => (b._ts || 0) - (a._ts || 0));
  const vazut = new Set(), peSpec = {}, exemple = [];
  for (const o of bune) {
    const k = cheie(o.obs); if (vazut.has(k)) continue;
    const s = o.spec || '-'; if ((peSpec[s] = (peSpec[s] || 0) + 1) > 6) continue;
    vazut.add(k); exemple.push(`${o.obs.trim()} [${[o.inc, o.spec, o.tip].filter(Boolean).join(' / ')}]`);
    if (exemple.length >= 40) break;
  }
  const num = {};
  lista.forEach(o => {
    if (!o.spec || !Array.isArray(o.resp) || !o.resp.length) return;
    const v = o.resp.join('|');
    [`${o.locatie}|${o.spec}`, o.spec].forEach(k => { num[k] = num[k] || {}; num[k][v] = (num[k][v] || 0) + 1; });
  });
  const respPeSpec = {};
  Object.entries(num).forEach(([k, m]) => { const [v] = Object.entries(m).sort((a, b) => b[1] - a[1])[0]; respPeSpec[k] = v.split('|'); });
  return { exemple, respPeSpec };
}
$('inCfg').onchange = async e => {
  const f = e.target.files && e.target.files[0]; e.target.value = '';
  if (!f) return;
  try {
    const p = JSON.parse(await f.text());
    if (!p || !Array.isArray(p.locatii)) throw new Error('fișierul nu are lista de locații');
    const c = {}; CFG_KEYS.forEach(k => { if (p[k] !== undefined) c[k] = p[k]; });
    localStorage.setItem(LS.cfg, JSON.stringify(c));
    if (Array.isArray(p.observatii) && p.observatii.length) localStorage.setItem(LS.stil, JSON.stringify(construiesteStil(p.observatii)));
    cfg = loadCfg();
    toast('Liste importate', 3000); show(curView);
  } catch (err) { toast('Nu am putut importa: ' + err.message, 5000); }
};

/* ---------------- pornire ---------------- */
(async function init() {
  try { if (navigator.storage && navigator.storage.persist) navigator.storage.persist(); } catch (e) { }
  if ('serviceWorker' in navigator) navigator.serviceWorker.register('sw.js').catch(() => { });
  try { await reload(); } catch (e) { toast('Nu pot citi memoria telefonului: ' + e.message, 6000); }
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
    if (!(nav.pos > 0 && nav.stack[nav.pos] === 'obs' && prevView() === 'apt')) {
      nav = { stack: [], pos: -1 }; navReplace('start'); navPush('apt'); navPush('obs');
    }
    show('obs');
    toast('Am recuperat constatarea începută.', 3500);
  } else {
    if (d) dropDraft();
    if (nav.pos < 0) navReplace(hashView());
    if (nav.stack[nav.pos] === 'obs' && prevView() === 'apt') { history.back(); return; }   // formular fără ciornă -> înapoi la apartament
    show(nav.stack[nav.pos]);
  }
})();
