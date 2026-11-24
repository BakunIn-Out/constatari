'use strict';
/* Constatări – v0.1
   Poze + dictare pe teren -> fișier compatibil cu „Combina backup-uri” din aplicația de verificări.
   Nicio dată nu pleacă de pe telefon: totul stă în IndexedDB până la export. */

const APP_VER = '0.1.1';
const LS = { cfg: 'constatari_cfg', user: 'constatari_user', ses: 'constatari_sesiune' };
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
const addDays = (n) => { const d = new Date(); d.setDate(d.getDate() + (Number(n) || 0)); return isoDate(d); };

/* ---------------- stocare ---------------- */
function loadCfg() {
  try { const c = JSON.parse(localStorage.getItem(LS.cfg) || 'null'); if (c && Array.isArray(c.locatii)) return { ...DEF, ...c, _importat: true }; } catch (e) { }
  return { ...DEF, _importat: false };
}
let cfg = loadCfg();
let ses = Object.assign({ locatie: '', etaj: '', apt: '', spec: '', tip: 'Neconformitate', prioritate: 'Normal', resp: [], termenZile: 3 },
  JSON.parse(localStorage.getItem(LS.ses) || '{}'));
const saveSes = () => localStorage.setItem(LS.ses, JSON.stringify(ses));
const getUser = () => (localStorage.getItem(LS.user) || '').trim();

let _db;
function db() {
  if (_db) return Promise.resolve(_db);
  return new Promise((res, rej) => {
    const r = indexedDB.open('constatari', 1);
    r.onupgradeneeded = () => { if (!r.result.objectStoreNames.contains('obs')) r.result.createObjectStore('obs', { keyPath: 'id' }); };
    r.onsuccess = () => { _db = r.result; res(_db); };
    r.onerror = () => rej(r.error);
  });
}
async function tx(mode, fn) {
  const d = await db();
  return new Promise((res, rej) => {
    const t = d.transaction('obs', mode); const st = t.objectStore('obs');
    const out = fn(st);
    t.oncomplete = () => res(out && 'result' in out ? out.result : undefined);
    t.onerror = () => rej(t.error); t.onabort = () => rej(t.error);
  });
}
const dbAll = () => tx('readonly', st => st.getAll());
const dbPut = rec => tx('readwrite', st => st.put(rec));
const dbDel = id => tx('readwrite', st => st.delete(id));

let all = [];
async function reload() { all = (await dbAll()).sort((a, b) => (a._ts || 0) - (b._ts || 0)); }

/* ---------------- UI mărunt ---------------- */
let toastT;
function toast(msg, ms = 2600) {
  const t = $('toast'); t.textContent = msg; t.hidden = false;
  clearTimeout(toastT); toastT = setTimeout(() => { t.hidden = true; }, ms);
}

// câmp = <select> dacă avem listă, altfel <input> liber
function field(id, list, value, ph) {
  const box = $(id); box.innerHTML = '';
  let el;
  if (list && list.length) {
    el = document.createElement('select');
    const opts = list.slice();
    if (value && !opts.includes(value)) opts.push(value);
    el.innerHTML = `<option value="">— ${esc(ph || 'alege')} —</option>` + opts.map(v => `<option>${esc(v)}</option>`).join('');
  } else {
    el = document.createElement('input'); el.type = 'text'; el.placeholder = ph || '';
  }
  el.value = value || '';
  if (el.tagName === 'SELECT') { const upd = () => el.classList.toggle('empty', !el.value); upd(); el.addEventListener('change', upd); }
  box.appendChild(el);
  return el;
}
const val = id => { const e = $(id).firstElementChild; return e ? e.value.trim() : ''; };

// chips cu selecție (multi)
function makeChips(id, items, selected, multi = true) {
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
        draw();
      };
      box.appendChild(b);
    });
    if (!st.items.length) box.innerHTML = '<span class="muted small">Lista vine din backup (Setări)</span>';
  }
  draw();
  return {
    get: () => st.items.filter(v => st.sel.has(v)),
    add: v => { if (!v) return; if (!st.items.includes(v)) st.items.push(v); if (!multi) st.sel.clear(); st.sel.add(v); draw(); }
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

/* ---------------- navigare ---------------- */
const VIEWS = { start: 'vStart', apt: 'vApt', obs: 'vObs', gata: 'vGata', setari: 'vSetari' };
let curView = 'start';
let formDirty = false;
function go(v) { if (location.hash !== '#' + v) location.hash = v; else show(v); }
window.addEventListener('hashchange', () => {
  const v = (location.hash || '#start').slice(1);
  if (curView === 'obs' && v !== 'obs' && formDirty) {
    readForm();                                   // păstrez textul dacă rămâne pe formular
    if (!confirm('Renunți la constatarea nesalvată?')) { history.forward(); return; }
    formDirty = false; stopMic();
  }
  show(v);
});
function show(v) {
  if (!VIEWS[v]) v = 'start';
  if (v === 'obs' && !edit) v = ses.apt ? 'apt' : 'start';
  if (v === 'apt' && !ses.apt) v = 'start';
  curView = v;
  Object.entries(VIEWS).forEach(([k, id]) => { $(id).hidden = k !== v; });
  $('btnBack').hidden = v === 'start';
  $('btnSetari').hidden = v === 'setari';
  if (v !== 'obs') stopMic();
  ({ start: renderStart, apt: renderApt, obs: renderObs, gata: renderGata, setari: renderSetari })[v]();
  window.scrollTo(0, 0);
}
$('btnBack').onclick = () => history.length > 1 ? history.back() : go('start');
$('btnSetari').onclick = () => go('setari');

/* ---------------- START ---------------- */
let respStart;
function renderStart() {
  head('Constatări', 'Inspecții pe teren');
  $('cfgWarn').hidden = cfg._importat;
  const loc = field('fLocatie', cfg.locatii, ses.locatie, 'locație');
  const drawEtaj = () => {
    const et = field('fEtaj', etajePt(val('fLocatie')), ses.etaj, 'etaj');
    const drawApt = () => {
      field('fApt', aptPt(val('fLocatie'), val('fEtaj')), ses.apt, 'apartament');
      field('fSpec', specPt(val('fLocatie'), val('fEtaj')), ses.spec, 'specialitate');
    };
    et.onchange = () => { ses.etaj = val('fEtaj'); ses.apt = ''; drawApt(); };
    drawApt();
  };
  loc.onchange = () => { ses.locatie = val('fLocatie'); ses.etaj = ''; ses.apt = ''; drawEtaj(); };
  drawEtaj();
  field('fTip', cfg.tipuri, ses.tip, 'tip');
  field('fPrio', cfg.prioritati, ses.prioritate, 'prioritate');
  respStart = makeChips('fResp', cfg.responsabili || [], ses.resp);
  $('fTermenZile').value = ses.termenZile ?? 3;
  const neexp = all.filter(r => !r._meta?.exportat).length;
  $('stTotal').textContent = all.length; $('stNoi').textContent = neexp;
  $('defSum').textContent = [ses.spec, ses.tip, (ses.resp || []).join(' / ')].filter(Boolean).join(' · ') || 'Specialitate, tip, responsabil';
}
function readStart() {
  ses.locatie = val('fLocatie'); ses.etaj = val('fEtaj'); ses.apt = val('fApt');
  ses.spec = val('fSpec'); ses.tip = val('fTip'); ses.prioritate = val('fPrio');
  ses.resp = respStart ? respStart.get() : ses.resp;
  ses.termenZile = Number($('fTermenZile').value) || 0;
  saveSes();
}
$('btnIncepe').onclick = () => {
  readStart();
  if (!ses.locatie || !ses.etaj || !ses.apt) { toast('Alege locația, etajul și apartamentul.'); return; }
  go('apt');
};
$('btnLaGata').onclick = () => { readStart(); go('gata'); };

/* ---------------- APARTAMENT ---------------- */
function recsApt() { return all.filter(r => r.locatie === ses.locatie && r.etaj === ses.etaj && r.apt === ses.apt); }
function itemHtml(r) {
  const n = (r.poze || []).length;
  const img = n ? `<img class="ph" src="${r.poze[0]}" alt="">` : `<div class="ph">${icon('note')}</div>`;
  const meta = [r.tip, r.spec, (r.resp || []).join(' / '), n ? `${n} ${n === 1 ? 'foto' : 'foto'}` : ''].filter(Boolean).map(esc).join('<span>·</span>');
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
}
$('btnNou').onclick = () => openObs(null);
$('btnGata').onclick = () => go('gata');
$('btnAptUrm').onclick = () => {
  const l = aptPt(ses.locatie, ses.etaj); const i = l.indexOf(ses.apt);
  if (i >= 0 && i < l.length - 1) { ses.apt = l[i + 1]; saveSes(); renderApt(); window.scrollTo(0, 0); toast('Acum: ' + ses.apt); }
  else { toast('Ultimul de pe etaj. Alege altul din start.'); go('start'); }
};

/* ---------------- FORMULAR ---------------- */
let edit = null, incChips, respObs;
function genId() {
  const base = Date.now() + Math.floor(Math.random() * 100000);
  const u = getUser();
  return u ? `${u}-${base}` : `teren-${base}`;
}
function newRec(incPrev) {
  const now = new Date();
  return {
    id: null, dataOra: roDateTime(now), _ts: 0,
    locatie: ses.locatie, etaj: ses.etaj, apt: ses.apt, inc: incPrev || '', obs: '',
    spec: ses.spec || '', tip: ses.tip || '', prioritate: ses.prioritate || 'Normal',
    dataObs: isoDate(now), termen: addDays(ses.termenZile ?? 3),
    resp: (ses.resp || []).slice(), status: 'Nesolutionat', poze: [], poza: '',
    _meta: { creat: now.toISOString(), exportat: null }
  };
}
function openObs(rec, incPrev) {
  edit = rec ? JSON.parse(JSON.stringify(rec)) : newRec(incPrev);
  formDirty = false;
  if (curView === 'obs') renderObs(); else go('obs');
}
function renderObs() {
  head(edit.id ? 'Editare constatare' : 'Constatare nouă', `${edit.locatie} › ${edit.etaj} › ${edit.apt}`);
  drawThumbs();
  const cam = camerePt(edit.locatie, edit.etaj, edit.apt);
  const sel = edit.inc ? edit.inc.split(',').map(s => s.trim()).filter(Boolean) : [];
  incChips = makeChips('incChips', cam, sel);
  const alte = (cfg.camere || []).filter(c => !cam.includes(c));
  $('incAlta').innerHTML = '<option value="">Altă încăpere…</option>' + alte.map(c => `<option>${esc(c)}</option>`).join('');
  $('incAlta').hidden = !alte.length;
  $('txtObs').value = edit.obs || '';
  field('oSpec', specPt(edit.locatie, edit.etaj), edit.spec, 'specialitate');
  field('oTip', cfg.tipuri, edit.tip, 'tip');
  field('oPrio', cfg.prioritati, edit.prioritate, 'prioritate');
  respObs = makeChips('oResp', cfg.responsabili || [], edit.resp || []);
  $('oTermen').value = edit.termen || '';
  $('sumObs').textContent = [edit.spec, edit.tip, (edit.resp || []).join(' / ')].filter(Boolean).join(' · ');
  $('btnSterge').hidden = !edit.id;
  $('btnSalvNou').hidden = !!edit.id;
  $('micInfo').textContent = SR ? '' : 'În acest browser folosește microfonul de pe tastatura telefonului.';
}
$('incAlta').onchange = e => { if (e.target.value) { incChips.add(e.target.value); e.target.value = ''; formDirty = true; } };
$('txtObs').addEventListener('input', () => { formDirty = true; });

function drawThumbs() {
  const box = $('thumbs'); box.innerHTML = '';
  edit.poze.forEach((p, i) => {
    const d = document.createElement('div'); d.className = 'thumb';
    d.innerHTML = `<img src="${p}" alt=""><button type="button" aria-label="Scoate fotografia">${icon('x')}</button>`;
    d.querySelector('button').onclick = () => { edit.poze.splice(i, 1); formDirty = true; drawThumbs(); };
    box.appendChild(d);
  });
}
async function compress(file) {
  const url = URL.createObjectURL(file);
  try {
    const img = await new Promise((res, rej) => { const i = new Image(); i.onload = () => res(i); i.onerror = () => rej(new Error('imagine')); i.src = url; });
    const MAX = 1600; const s = Math.min(1, MAX / Math.max(img.naturalWidth, img.naturalHeight));
    const w = Math.round(img.naturalWidth * s), h = Math.round(img.naturalHeight * s);
    const c = document.createElement('canvas'); c.width = w; c.height = h;
    c.getContext('2d').drawImage(img, 0, 0, w, h);
    return c.toDataURL('image/jpeg', 0.72);
  } finally { URL.revokeObjectURL(url); }
}
async function onFiles(e) {
  const files = [...(e.target.files || [])]; e.target.value = '';
  for (const f of files) {
    try { edit.poze.push(await compress(f)); formDirty = true; } catch (err) { toast('Nu am putut citi o poză.'); }
  }
  drawThumbs();
}
$('inCam').onchange = onFiles;
$('inGal').onchange = onFiles;

function readForm() {
  edit.inc = incChips.get().join(', ');
  edit.obs = $('txtObs').value.trim().replace(/\s+/g, ' ');
  if (edit.obs) edit.obs = edit.obs[0].toUpperCase() + edit.obs.slice(1);
  edit.spec = val('oSpec'); edit.tip = val('oTip'); edit.prioritate = val('oPrio');
  edit.resp = respObs.get();
  edit.termen = $('oTermen').value || '';
}
async function saveForm(siUna) {
  stopMic();
  readForm();
  if (!edit.obs && !edit.poze.length) { toast('Pune măcar o poză sau un text.'); return; }
  if (!edit.inc) { toast('Alege încăperea.'); return; }
  if (!edit.id) edit.id = genId();
  edit._ts = Date.now();
  edit.poza = edit.poze[0] || '';
  if (edit._meta) edit._meta.exportat = null;          // modificată după export -> se exportă din nou
  try { await dbPut(edit); } catch (err) { toast('Eroare la salvare: ' + err.message, 5000); return; }
  await reload();
  formDirty = false;
  const inc = edit.inc;
  toast('Constatare salvată');
  if (siUna) openObs(null, inc); else { edit = null; history.back(); }
}
$('btnSalv').onclick = () => saveForm(false);
$('btnSalvNou').onclick = () => saveForm(true);
$('btnSterge').onclick = async () => {
  if (!edit.id || !confirm('Ștergi constatarea asta de pe telefon?')) return;
  await dbDel(edit.id); await reload(); formDirty = false; edit = null; toast('Șters'); history.back();
};

/* ---------------- DICTARE ---------------- */
const SR = window.SpeechRecognition || window.webkitSpeechRecognition;
let rec = null, micOn = false, micBase = '';
function micUi() { const b = $('btnMic'); b.classList.toggle('on', micOn); b.innerHTML = micOn ? `${icon('stop')}<span>Oprește</span>` : `${icon('mic')}<span>Dictează</span>`; }
function startMic() {
  if (!SR) { toast('Folosește microfonul de pe tastatura telefonului.', 4000); $('txtObs').focus(); return; }
  const ta = $('txtObs');
  rec = new SR(); rec.lang = 'ro-RO'; rec.interimResults = true; rec.continuous = true;
  micBase = ta.value.trim() ? ta.value.trim() + ' ' : '';
  rec.onresult = e => {
    let fin = '', interim = '';
    for (let i = 0; i < e.results.length; i++) {
      const r = e.results[i];
      if (r.isFinal) fin += r[0].transcript.trim() + ' '; else interim += r[0].transcript;
    }
    ta.value = (micBase + fin + interim).replace(/\s+/g, ' ').trimStart();
    formDirty = true;
  };
  rec.onerror = e => {
    if (e.error === 'not-allowed' || e.error === 'service-not-allowed') { micOn = false; micUi(); toast('Microfonul e blocat pentru pagina asta. Permite-l din setările browserului.', 5000); }
    else if (e.error === 'network') { micOn = false; micUi(); toast('Dictarea are nevoie de internet. Scrie sau folosește tastatura.', 4000); }
  };
  rec.onend = () => {
    if (micOn) { micBase = ta.value.trim() ? ta.value.trim() + ' ' : ''; try { rec.start(); return; } catch (err) { } }
    micOn = false; micUi();
  };
  try { rec.start(); micOn = true; micUi(); } catch (err) { toast('Nu am putut porni dictarea.'); }
}
function stopMic() { if (rec && micOn) { micOn = false; try { rec.stop(); } catch (e) { } } micUi(); }
$('btnMic').onclick = () => micOn ? stopMic() : startMic();

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

async function shareOrDownload(blob, name) {
  const mobil = /Android|iPhone|iPad|iPod/i.test(navigator.userAgent);
  const file = new File([blob], name, { type: blob.type });
  if (mobil && navigator.canShare && navigator.canShare({ files: [file] })) {
    try { await navigator.share({ files: [file], title: name }); return true; }
    catch (e) { if (e.name === 'AbortError') return false; }
  }
  const a = document.createElement('a'); a.href = URL.createObjectURL(blob); a.download = name;
  document.body.appendChild(a); a.click();
  setTimeout(() => { URL.revokeObjectURL(a.href); a.remove(); }, 5000);
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
  await reload(); renderGata();
  toast(`Exportat: ${recs.length}. Acum în aplicația de verificări → „Combina backup-uri”.`, 5000);
};
$('btnExpCsv').onclick = async () => {
  const recs = recsExport();
  if (!recs.length) { toast('Nimic de exportat.'); return; }
  const cols = ['Locatie', 'Etaj', 'Apartament', 'Incapere', 'Observatie', 'Specialitate', 'Tip', 'Prioritate', 'Responsabil', 'Data', 'Termen', 'Nr poze', 'Id'];
  const q = v => { const s = String(v ?? ''); return /[;"\n]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s; };
  const rows = recs.map(r => [r.locatie, r.etaj, r.apt, r.inc, r.obs, r.spec, r.tip, r.prioritate, (r.resp || []).join(' / '), r.dataObs, r.termen, (r.poze || []).length, r.id].map(q).join(';'));
  const blob = new Blob(['﻿' + [cols.join(';')].concat(rows).join('\r\n')], { type: 'text/csv' });
  await shareOrDownload(blob, `constatari_${stamp()}.csv`);
};
$('btnExpPdf').onclick = () => {
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
          + (r.poze || []).map(p => `<img src="${p}" alt="">`).join('') + '</div>';
      });
    });
  });
  $('print').innerHTML = h;
  setTimeout(() => window.print(), 300);
};
$('btnStergeExp').onclick = async () => {
  const exp = all.filter(r => r._meta?.exportat);
  if (!exp.length) { toast('Nu ai nimic exportat de șters.'); return; }
  if (!confirm(`Ștergi de pe telefon ${exp.length} constatări deja exportate?\n(Verifică întâi că au intrat în aplicația de verificări.)`)) return;
  for (const r of exp) await dbDel(r.id);
  await reload(); renderGata(); toast('Șters');
};

/* ---------------- SETĂRI ---------------- */
async function renderSetari() {
  head('Setări');
  $('inUser').value = getUser();
  $('cfgInfo').textContent = cfg._importat
    ? `${cfg.locatii.length} locații · ${Object.keys(cfg.apartamente || {}).length} etaje · ${(cfg.camere || []).length} încăperi · ${(cfg.responsabili || []).length} firme`
    : 'Nicio listă importată';
  let spatiu = '';
  try { const e = await navigator.storage.estimate(); spatiu = ` · spațiu folosit ~${Math.round(e.usage / 1048576)} MB`; } catch (e) { }
  $('infoApp').textContent = `Constatări v${APP_VER} · ${all.length} constatări pe telefon${spatiu}`;
}
$('inUser').onchange = () => {
  const u = $('inUser').value.trim().toUpperCase().replace(/[^A-Z0-9_]/g, '').slice(0, 20);
  localStorage.setItem(LS.user, u); $('inUser').value = u; toast(u ? 'Nume salvat: ' + u : 'Nume șters');
};
$('inCfg').onchange = async e => {
  const f = e.target.files && e.target.files[0]; e.target.value = '';
  if (!f) return;
  try {
    const p = JSON.parse(await f.text());
    if (!p || !Array.isArray(p.locatii)) throw new Error('fișierul nu are lista de locații');
    const c = {}; CFG_KEYS.forEach(k => { if (p[k] !== undefined) c[k] = p[k]; });
    localStorage.setItem(LS.cfg, JSON.stringify(c));
    cfg = loadCfg();
    toast('Liste importate', 3000); show(curView);
  } catch (err) { toast('Nu am putut importa: ' + err.message, 5000); }
};

/* ---------------- pornire ---------------- */
(async function init() {
  try { if (navigator.storage && navigator.storage.persist) navigator.storage.persist(); } catch (e) { }
  if ('serviceWorker' in navigator) navigator.serviceWorker.register('sw.js').catch(() => { });
  await reload();
  show((location.hash || '#start').slice(1));
})();
