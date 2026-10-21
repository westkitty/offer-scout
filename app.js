import { scoreOffer, rankOffers, DEFAULTS } from './score.js';

/* ---------- tiny helpers ---------- */
const $ = (s, el = document) => el.querySelector(s);
const $$ = (s, el = document) => [...el.querySelectorAll(s)];
const money = (n) => (n < 0 ? '−$' : '$') + Math.abs(n).toFixed(2);
const fmt1 = (n) => (Number.isFinite(n) ? n.toFixed(1) : '∞');
const uid = () => Math.random().toString(36).slice(2, 9);
const store = {
  get(k, d) { try { const v = localStorage.getItem('os.' + k); return v ? JSON.parse(v) : d; } catch { return d; } },
  set(k, v) { try { localStorage.setItem('os.' + k, JSON.stringify(v)); } catch {} },
};
let saveT; const saveSoon = () => { clearTimeout(saveT); saveT = setTimeout(() => store.set('offers', offers), 250); };

const hapticLabel = $('#hapticLabel');
function haptic(ms = 8) {
  if (navigator.vibrate) { navigator.vibrate(ms); return; }
  try { hapticLabel.click(); } catch {} // iOS 18+: toggling a <input switch> yields a system haptic tick
}
hapticLabel.addEventListener('click', (e) => e.stopPropagation());

let toastT;
function toast(msg, action) {
  const t = $('#toast'); t.textContent = msg;
  if (action) { const b = document.createElement('button'); b.textContent = action.label; b.onclick = () => { action.fn(); t.classList.remove('show'); }; t.append(b); }
  t.classList.add('show'); clearTimeout(toastT); toastT = setTimeout(() => t.classList.remove('show'), action ? 4500 : 2200);
}

/* ---------- state ---------- */
let settings = { ...DEFAULTS, ...store.get('settings', {}) };
let offers = store.get('offers', null);
let history = store.get('history', []);
let lastLoc = store.get('loc', null);
const blankRoute = () => ({ me: null, stores: [], stops: [] });
function newOffer(p = {}) {
  const used = new Set(offers.map((o) => o.name));
  let i = 0, name; do { name = 'Offer ' + (i < 26 ? String.fromCharCode(65 + i) : i + 1); i++; } while (used.has(name));
  return { id: uid(), name, pay: '', tip: '', miles: '', stores: 1, stops: 1, items: '', minutes: '', heavy: false, driveMin: 0, route: blankRoute(), ...p };
}
if (!Array.isArray(offers)) { offers = []; offers.push(newOffer()); }

/* ---------- offers view ---------- */
const listEl = $('#offers'), tpl = $('#tplOffer');
const CIRC = 2 * Math.PI * 19;

function cardFor(o) {
  const el = tpl.content.firstElementChild.cloneNode(true);
  el.dataset.id = o.id;
  $('.o-name', el).value = o.name;
  $$('[data-k]', el).forEach((inp) => { const k = inp.dataset.k; if (inp.type === 'checkbox') inp.checked = !!o[k]; else inp.value = o[k] ?? ''; });
  $('[data-o=stores]', el).textContent = o.stores;
  $('[data-o=stops]', el).textContent = o.stops;
  return el;
}

function renderOffers() {
  listEl.replaceChildren(...offers.map(cardFor));
  $('#empty').hidden = offers.length > 0;
  updateScores();
}

function updateScores() {
  const ranked = rankOffers(offers, settings);
  const pos = new Map(ranked.map((x, i) => [x.offer.id, i]));
  const scored = ranked.filter((x) => x.r.pay > 0);
  const bestId = scored.length ? scored[0].offer.id : null;
  for (const el of listEl.children) {
    const o = offers.find((x) => x.id === el.dataset.id); if (!o) continue;
    const r = scoreOffer(o, settings);
    const sc = $('.o-score', el);
    sc.className = 'o-score v-' + (r.pay > 0 ? r.verdict : 'none');
    $('.ring-fg', el).style.strokeDashoffset = String(CIRC * (1 - r.score / 100));
    animateNum($('.score-num', el), r.score);
    $('.chip', el).textContent = r.pay > 0 ? r.verdict : '—';
    $('.reason', el).textContent = r.reason;
    $('.rank', el).textContent = '#' + (pos.get(o.id) + 1);
    el.classList.toggle('best-offer', o.id === bestId && scored.length > 1);
    const rt = $('.routed', el); rt.hidden = !o.driveMin; if (o.driveMin) rt.textContent = '✓ routed';
    const m = $('.math', el); if (!m.hidden) m.innerHTML = mathHTML(r);
    $('[data-o=stores]', el).textContent = o.stores; $('[data-o=stops]', el).textContent = o.stops;
  }
  // ranking strip
  const rk = $('#ranking');
  rk.replaceChildren(...(scored.length > 1 ? scored.map((x, i) => {
    const b = document.createElement('button'); b.className = 'rk ' + x.r.verdict + (i === 0 ? ' top' : '');
    b.dataset.jump = x.offer.id; b.innerHTML = `<span>#${i + 1}</span> <span></span> <i>${x.r.score}</i>`;
    b.children[1].textContent = x.offer.name; return b;
  }) : []));
  // header banner
  const best = $('#best');
  if (scored.length) {
    const top = scored[0]; best.hidden = false;
    best.className = 'best ' + (top.r.verdict === 'ACCEPT' ? '' : top.r.verdict === 'MAYBE' ? 'warn' : 'bad');
    const label = top.r.verdict === 'ACCEPT' ? 'I recommend' : top.r.verdict === 'MAYBE' ? 'Borderline:' : 'Skip all —';
    best.innerHTML = `<span>${scored.length > 1 ? '🏆' : '🎯'}</span><span>${label} <b></b> · ${top.r.score}/100 · ${top.r.reason.split(' · ').slice(0, 2).join(' · ')}</span>`;
    $('b', best).textContent = top.offer.name;
  } else best.hidden = true;
}

const numAnim = new WeakMap();
function animateNum(el, to) {
  const from = numAnim.get(el) ?? 0; numAnim.set(el, to);
  if (from === to) { el.textContent = to; return; }
  const t0 = performance.now(), d = 380;
  const step = (t) => { const k = Math.min(1, (t - t0) / d), e = 1 - Math.pow(1 - k, 3); el.textContent = Math.round(from + (to - from) * e); if (k < 1 && numAnim.get(el) === to) requestAnimationFrame(step); };
  requestAnimationFrame(step);
}

function mathHTML(r) {
  const s = settings, row = (a, b, cls = '') => `<tr class="${cls}"><td>${a}</td><td>${b}</td></tr>`;
  return `<table>
  ${row('Payout + tip', money(r.pay))}
  ${row(`Mileage cost (${fmt1(r.miles)} mi × ${money(s.costPerMile)})`, `<span class="neg">−${money(r.cost)}</span>`)}
  ${row('<b>Net earnings</b>', `<b>${money(r.net)}</b>`, 'sep')}
  ${r.usedUserMinutes ? row('Time (your estimate)', r.minutes.toFixed(0) + ' min', 'sep') : row(r.routedDrive ? 'Drive (routed)' : `Drive (${fmt1(r.miles)} mi ÷ ${s.avgMph} mph)`, r.driveMin.toFixed(0) + ' min', 'sep')}
  ${r.usedUserMinutes ? '' : row(`Shopping (${r.stores}×${s.shopMinPerStore}${r.items ? ` + ${r.items}×${s.shopMinPerItem}` : ''})`, r.shopMin.toFixed(0) + ' min')}
  ${r.usedUserMinutes ? '' : row(`Drop-offs (${r.stops}×${s.minPerStop})`, r.stopMin.toFixed(0) + ' min')}
  ${r.extraMin && !r.usedUserMinutes ? row('Heavy items', r.extraMin + ' min') : ''}
  ${row('<b>Total time</b>', `<b>${r.minutes.toFixed(0)} min</b>`)}
  ${row(`Net $/hr vs $${s.targetHourly} target`, `$${r.hourly.toFixed(2)} → ${r.hrPts.toFixed(0)} pts`, 'sep')}
  ${row(`Gross $/mi vs $${s.targetPerMile} target`, `${Number.isFinite(r.perMile) ? '$' + r.perMile.toFixed(2) : '∞'} → ${r.miPts.toFixed(0)} pts`)}
  ${row(`Blend ${Math.round(s.weightHourly * 100)}% / ${Math.round((1 - s.weightHourly) * 100)}%`, r.base.toFixed(1))}
  ${r.penStores ? row(`Extra stores (${r.stores - 1}×${s.storePenalty})`, `<span class="neg">−${r.penStores}</span>`) : ''}
  ${r.penStops ? row(`Drop-offs past 2 (${r.stops - 2}×${s.stopPenalty})`, `<span class="neg">−${r.penStops}</span>`) : ''}
  ${r.penHeavy ? row('Heavy items', `<span class="neg">−${r.penHeavy}</span>`) : ''}
  ${row('<b>Score</b>', `<b>${r.score}/100 · ${r.verdict}</b>`, 'sep')}
  </table><p class="fine">Accept ≥ ${s.acceptAt}, Maybe ≥ ${s.maybeAt}. Edit any of this in Settings.</p>`;
}

function addOffer(p, focus = true) {
  const o = newOffer(p); offers.push(o); saveSoon();
  const el = cardFor(o); listEl.append(el); $('#empty').hidden = true; updateScores(); haptic();
  if (focus) { el.scrollIntoView({ behavior: 'smooth', block: 'center' }); if (!p) setTimeout(() => $('[data-k=pay]', el).focus({ preventScroll: true }), 300); }
  return o;
}

function removeCard(id, cb) {
  const el = listEl.querySelector(`[data-id="${id}"]`); if (!el) return cb?.();
  el.classList.add('leaving'); setTimeout(() => { el.remove(); cb?.(); $('#empty').hidden = offers.length > 0; updateScores(); }, 230);
}

listEl.addEventListener('input', (e) => {
  const card = e.target.closest('.offer'); if (!card) return;
  const o = offers.find((x) => x.id === card.dataset.id); if (!o) return;
  if (e.target.classList.contains('o-name')) { o.name = e.target.value || 'Offer'; saveSoon(); updateScores(); return; }
  const k = e.target.dataset.k; if (!k) return;
  if (e.target.type === 'checkbox') { o[k] = e.target.checked; haptic(); }
  else { o[k] = e.target.value.replace(',', '.'); if (k === 'miles') o.driveMin = 0; }
  saveSoon(); updateScores();
});

listEl.addEventListener('click', (e) => {
  const card = e.target.closest('.offer'); if (!card) return;
  const idx = offers.findIndex((x) => x.id === card.dataset.id); const o = offers[idx]; if (!o) return;
  const step = e.target.closest('[data-step]');
  if (step) { const [k, d] = step.dataset.step.split(':'); o[k] = Math.max(1, Math.min(20, (+o[k] || 1) + +d)); haptic(); saveSoon(); updateScores(); return; }
  const act = e.target.closest('[data-act]')?.dataset.act; if (!act) return;
  if (act === 'math') { const m = $('.math', card); m.hidden = !m.hidden; $('.o-score', card).setAttribute('aria-expanded', String(!m.hidden)); haptic(); updateScores(); }
  if (act === 'dup') { const c = structuredClone(o); delete c.id; delete c.name; addOffer(c); toast('Duplicated'); }
  if (act === 'del') { offers.splice(idx, 1); saveSoon(); haptic(14); removeCard(o.id); toast('Offer removed', { label: 'Undo', fn: () => { offers.splice(idx, 0, o); saveSoon(); renderOffers(); } }); }
  if (act === 'accept' || act === 'decline') decide(o, idx, act);
  if (act === 'route') { mapOfferId = o.id; showView('map'); }
});

function decide(o, idx, act) {
  const r = scoreOffer(o, settings);
  if (!(r.pay > 0)) { toast('Enter a payout first'); return; }
  const h = { id: uid(), ts: Date.now(), name: o.name, decision: act, pay: r.pay, net: r.net, miles: r.miles, minutes: r.minutes, stores: r.stores, stops: r.stops, hourly: r.hourly, perMile: Number.isFinite(r.perMile) ? r.perMile : null, score: r.score, verdict: r.verdict };
  history.unshift(h); history = history.slice(0, 500); store.set('history', history);
  offers.splice(idx, 1); saveSoon(); haptic(act === 'accept' ? 20 : 10);
  removeCard(o.id);
  toast(act === 'accept' ? `Accepted ${o.name} · ${money(r.net)} net` : `Declined ${o.name}`, { label: 'Undo', fn: () => { history = history.filter((x) => x.id !== h.id); store.set('history', history); offers.splice(idx, 0, o); saveSoon(); renderOffers(); renderHistory(); } });
  renderHistory();
}

$('#ranking').addEventListener('click', (e) => {
  const b = e.target.closest('[data-jump]'); if (!b) return;
  const el = listEl.querySelector(`[data-id="${b.dataset.jump}"]`); if (!el) return;
  haptic(); el.scrollIntoView({ behavior: 'smooth', block: 'center' }); el.classList.remove('flash'); void el.offsetWidth; el.classList.add('flash');
});

$('#fab').addEventListener('click', () => { if (currentView !== 'offers') showView('offers'); addOffer(); });
$('#quick').addEventListener('submit', (e) => {
  e.preventDefault(); const inp = $('#quickInput');
  const n = inp.value.replace(/[$,]/g, ' ').trim().split(/[\s/]+/).map(parseFloat).filter(Number.isFinite);
  if (!n.length) { toast('Type: pay miles stores stops'); return; }
  const [pay, miles = '', stores = 1, stops = 1] = n;
  addOffer({ pay: String(pay), miles: miles === '' ? '' : String(miles), stores: Math.max(1, Math.round(stores)), stops: Math.max(1, Math.round(stops)) }, true);
  inp.value = ''; inp.blur();
});

/* ---------- views ---------- */
let currentView = 'offers';
function showView(v) {
  currentView = v; document.body.dataset.view = v; document.activeElement?.blur?.(); // dismiss the keyboard so iOS resets its visual viewport
  $$('.view').forEach((s) => s.classList.toggle('active', s.id === 'view-' + v));
  $$('.tab').forEach((t) => { const on = t.dataset.view === v; t.classList.toggle('active', on); t.setAttribute('aria-selected', String(on)); });
  $('#fab').hidden = v !== 'offers';
  if (v === 'map') openMap();
  if (v === 'history') renderHistory();
  window.scrollTo({ top: 0 });
}
$('.tabbar').addEventListener('click', (e) => { const t = e.target.closest('.tab'); if (t) { haptic(); showView(t.dataset.view); } });

/* ---------- history ---------- */
function renderHistory() {
  const acc = history.filter((h) => h.decision === 'accept');
  const sum = (a, k) => a.reduce((s, x) => s + (x[k] || 0), 0);
  const mins = sum(acc, 'minutes');
  const avgHr = mins ? sum(acc, 'net') / (mins / 60) : 0;
  const miles = sum(acc, 'miles');
  const stats = [
    ['Accepted', `${acc.length}<small style="display:inline;font-size:13px"> / ${history.length}</small>`],
    ['Avg net $/hr', acc.length ? '$' + avgHr.toFixed(2) : '—'],
    ['Net earned', acc.length ? money(sum(acc, 'net')) : '—'],
    ['Avg $/mile', miles ? '$' + (sum(acc, 'pay') / miles).toFixed(2) : '—'],
  ];
  $('#stats').innerHTML = stats.map(([a, b]) => `<div class="stat"><small>${a}</small><strong>${b}</strong></div>`).join('');
  const ul = $('#history'); ul.replaceChildren();
  if (!history.length) { ul.innerHTML = '<li><div><small>Accept or decline offers and they show up here with your running stats.</small></div></li>'; return; }
  for (const h of history.slice(0, 60)) {
    const li = document.createElement('li'); li.className = h.decision === 'accept' ? 'acc' : 'dec';
    const d = new Date(h.ts);
    li.innerHTML = `<span class="d"></span><div><b></b><small>${d.toLocaleDateString(undefined, { month: 'short', day: 'numeric' })} ${d.toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' })} · ${h.decision === 'accept' ? 'Accepted' : 'Declined'} · ${h.verdict} ${h.score}</small></div><em>$${Math.round(h.hourly)}/hr</em>`;
    $('b', li).textContent = `${h.name} · ${money(h.pay)} · ${fmt1(h.miles)} mi`;
    ul.append(li);
  }
}
$('#clearHist').addEventListener('click', () => { if (history.length && confirm('Clear all history on this phone?')) { history = []; store.set('history', history); renderHistory(); } });

/* ---------- settings ---------- */
const SCHEMA = [
  ['Costs', [['costPerMile', 'Cost per mile $', 'Gas + wear. Real cost ≈ $0.20–0.35; IRS rate $0.70', 0.01, [['Real $0.30', 0.30], ['IRS $0.70', 0.70]]], ['avgMph', 'Average speed (mph)', 'Used when no route is calculated', 1]]],
  ['Time', [['shopMinPerStore', 'Minutes per store', 'Walk, shop, checkout', 1], ['shopMinPerItem', 'Minutes per item', 'Added per item/unit', 0.1], ['minPerStop', 'Minutes per drop-off', 'Park, hand off, photo', 1], ['heavyMinutes', 'Heavy items extra (min)', '', 1]]],
  ['Targets', [['targetHourly', 'Target net $/hr', '', 1], ['targetPerMile', 'Target gross $/mile', 'Classic rule: $2/mi', 0.1], ['weightHourly', '$/hr weight (0–1)', 'Rest goes to $/mile', 0.05]]],
  ['Penalties (points)', [['storePenalty', 'Per extra store', '', 1], ['stopPenalty', 'Per drop-off past 2', '', 1], ['heavyPenalty', 'Heavy items', '', 1]]],
  ['Verdict', [['acceptAt', 'Accept at score ≥', '', 1], ['maybeAt', 'Maybe at score ≥', 'Below this: decline', 1]]],
];
function renderSettings() {
  const f = $('#settings'); f.replaceChildren();
  for (const [title, rows] of SCHEMA) {
    const g = document.createElement('div'); g.className = 'set-group'; g.innerHTML = `<h3>${title}</h3>`;
    for (const [k, label, hint, step, presets] of rows) {
      const r = document.createElement('div'); r.className = 'set-row';
      r.innerHTML = `<label for="s-${k}">${label}${hint ? `<small>${hint}</small>` : ''}</label><input id="s-${k}" data-s="${k}" inputmode="decimal" step="${step}" value="${settings[k]}">`;
      g.append(r);
      if (presets) { const p = document.createElement('div'); p.className = 'presets'; p.innerHTML = presets.map(([l, v]) => `<button type="button" class="btn small" data-preset="${k}:${v}">${l}</button>`).join(''); g.append(p); }
    }
    f.append(g);
  }
}
$('#settings').addEventListener('input', (e) => {
  const k = e.target.dataset.s; if (!k) return; const v = parseFloat(e.target.value.replace(',', '.'));
  if (Number.isFinite(v)) { settings[k] = v; store.set('settings', settings); updateScores(); }
});
$('#settings').addEventListener('click', (e) => {
  const p = e.target.closest('[data-preset]'); if (!p) return; const [k, v] = p.dataset.preset.split(':');
  settings[k] = +v; store.set('settings', settings); $(`#s-${k}`).value = v; haptic(); updateScores(); toast(`Cost per mile set to $${(+v).toFixed(2)}`);
});
$('#resetSettings').addEventListener('click', () => { settings = { ...DEFAULTS }; store.set('settings', settings); renderSettings(); updateScores(); haptic(); toast('Defaults restored'); });

/* ---------- map (lazy Leaflet) ---------- */
let L, map, layer, routeLine, mapOfferId = null, tapMode = 'store', leafletP;
const loadLeaflet = () => leafletP ||= new Promise((res, rej) => {
  const css = document.createElement('link'); css.rel = 'stylesheet'; css.href = 'vendor/leaflet.css'; document.head.append(css);
  const s = document.createElement('script'); s.src = 'vendor/leaflet.js'; s.onload = () => res(window.L); s.onerror = rej; document.head.append(s);
});
const curOffer = () => offers.find((o) => o.id === mapOfferId) || offers[0];

async function openMap() {
  if (!offers.length) addOffer(undefined, false);
  if (!offers.some((o) => o.id === mapOfferId)) mapOfferId = offers[0].id;
  const sel = $('#mapOffer'); sel.innerHTML = offers.map((o) => `<option value="${o.id}"></option>`).join('');
  [...sel.options].forEach((op, i) => (op.textContent = offers[i].name)); sel.value = mapOfferId;
  try { L = await loadLeaflet(); } catch { $('#map').innerHTML = '<div class="map-loading">Map unavailable offline. Enter miles by hand.</div>'; return; }
  if (!map) {
    $('#map').replaceChildren();
    map = L.map('map', { zoomControl: false, attributionControl: true }).setView(lastLoc ? [lastLoc.lat, lastLoc.lng] : [39.5, -98.35], lastLoc ? 13 : 4);
    L.tileLayer('https://tile.openstreetmap.org/{z}/{x}/{y}.png', { maxZoom: 19, attribution: '© OpenStreetMap' }).addTo(map);
    L.control.zoom({ position: 'bottomright' }).addTo(map);
    layer = L.layerGroup().addTo(map);
    map.on('click', (e) => addPoint(tapMode, e.latlng.lat, e.latlng.lng));
  }
  setTimeout(() => map.invalidateSize(), 50);
  drawPoints(true);
}
$('#mapOffer').addEventListener('change', (e) => { mapOfferId = e.target.value; $('#routeOut').hidden = true; drawPoints(true); });
$('.seg').addEventListener('click', (e) => { const b = e.target.closest('[data-mode]'); if (!b) return; tapMode = b.dataset.mode; $$('.seg-btn').forEach((x) => x.classList.toggle('active', x === b)); haptic(); });

function addPoint(kind, lat, lng, label) {
  const o = curOffer(); o.route ||= blankRoute();
  const list = kind === 'store' ? o.route.stores : o.route.stops;
  list.push({ lat, lng, label: label || `${kind === 'store' ? 'Store' : 'Drop-off'} ${list.length + 1}` });
  saveSoon(); haptic(); drawPoints();
}

function drawPoints(fit) {
  if (!map) return; const o = curOffer(); const rt = o.route ||= blankRoute();
  layer.clearLayers(); routeLine = null;
  const ll = [];
  if (rt.me) { L.marker([rt.me.lat, rt.me.lng], { icon: L.divIcon({ className: '', html: '<div class="me-dot"></div>', iconSize: [18, 18] }) }).addTo(layer); ll.push([rt.me.lat, rt.me.lng]); }
  const pin = (p, kind, i, arr) => {
    const m = L.marker([p.lat, p.lng], { draggable: true, icon: L.divIcon({ className: '', html: `<div class="pin ${kind}"><span>${kind === 'store' ? 'S' : 'D'}${i + 1}</span></div>`, iconSize: [28, 28], iconAnchor: [14, 28] }) }).addTo(layer);
    m.on('dragend', () => { const q = m.getLatLng(); arr[i] = { ...p, lat: q.lat, lng: q.lng }; o.driveMin = 0; saveSoon(); drawPoints(); });
    ll.push([p.lat, p.lng]);
  };
  rt.stores.forEach((p, i) => pin(p, 'store', i, rt.stores));
  rt.stops.forEach((p, i) => pin(p, 'stop', i, rt.stops));
  if (o._geom) routeLine = L.geoJSON(o._geom, { style: { color: '#22e3a1', weight: 5, opacity: .9 } }).addTo(layer);
  if (fit && ll.length > 1) map.fitBounds(ll, { padding: [40, 40], maxZoom: 15 }); else if (fit && ll.length === 1) map.setView(ll[0], 14);
  // list
  const ol = $('#pts'); ol.replaceChildren();
  const item = (cls, badge, text, onDel) => {
    const li = document.createElement('li'); li.className = cls; li.innerHTML = `<b>${badge}</b><span></span>`; li.children[1].textContent = text;
    if (onDel) { const x = document.createElement('button'); x.className = 'icon-btn'; x.textContent = '✕'; x.ariaLabel = 'Remove'; x.onclick = () => { onDel(); o.driveMin = 0; o._geom = null; saveSoon(); haptic(); drawPoints(); updateScores(); }; li.append(x); }
    ol.append(li);
  };
  if (rt.me) item('pt-me', '●', 'Start: my location', () => (rt.me = null));
  rt.stores.forEach((p, i) => item('pt-store', 'S' + (i + 1), p.label, () => rt.stores.splice(i, 1)));
  rt.stops.forEach((p, i) => item('pt-stop', 'D' + (i + 1), p.label, () => rt.stops.splice(i, 1)));
  if (!ol.children.length) ol.innerHTML = '<li><span class="fine">No pins yet. Use your location, search an address, or tap the map.</span></li>';
}

$('#locBtn').addEventListener('click', () => {
  if (!('geolocation' in navigator)) { toast('Location not available on this device'); return; }
  const b = $('#locBtn'); b.disabled = true; b.textContent = 'Locating…';
  navigator.geolocation.getCurrentPosition((pos) => {
    b.disabled = false; b.textContent = '📍 Use my location';
    lastLoc = { lat: pos.coords.latitude, lng: pos.coords.longitude }; store.set('loc', lastLoc);
    const o = curOffer(); (o.route ||= blankRoute()).me = { ...lastLoc }; o.driveMin = 0; saveSoon(); haptic();
    drawPoints(); map?.setView([lastLoc.lat, lastLoc.lng], Math.max(map.getZoom(), 14));
  }, (err) => { b.disabled = false; b.textContent = '📍 Use my location'; toast(err.code === 1 ? 'Location permission denied (Settings → Safari → Location)' : 'Could not get location'); }, { enableHighAccuracy: true, timeout: 12000, maximumAge: 60000 });
});

async function fetchJSON(url, ms = 10000) {
  const c = new AbortController(); const t = setTimeout(() => c.abort(), ms);
  try { const r = await fetch(url, { signal: c.signal, headers: { Accept: 'application/json' } }); if (!r.ok) throw new Error('HTTP ' + r.status); return await r.json(); }
  finally { clearTimeout(t); }
}

// Nominatim: max 1 request/second, search on submit only (no autocomplete), results cached in-session.
let lastGeo = 0; const geoCache = new Map();
$('#geoForm').addEventListener('submit', async (e) => {
  e.preventDefault(); const q = $('#geoQ').value.trim(); if (q.length < 3) return; $('#geoQ').blur();
  const out = $('#geoResults'); out.innerHTML = '<div class="fine">Searching…</div>';
  try {
    let res = geoCache.get(q);
    if (!res) {
      const wait = 1100 - (Date.now() - lastGeo); if (wait > 0) await new Promise((r) => setTimeout(r, wait)); lastGeo = Date.now();
      const near = (curOffer().route?.me || lastLoc);
      const vb = near ? `&viewbox=${near.lng - 0.4},${near.lat + 0.3},${near.lng + 0.4},${near.lat - 0.3}` : '';
      res = await fetchJSON(`https://nominatim.openstreetmap.org/search?format=jsonv2&limit=5&addressdetails=0&q=${encodeURIComponent(q)}${vb}`);
      geoCache.set(q, res);
    }
    out.replaceChildren();
    if (!res.length) { out.innerHTML = '<div class="fine">No matches. Try adding the city.</div>'; return; }
    for (const r of res) {
      const d = document.createElement('div'); d.className = 'geo-item'; d.innerHTML = '<span></span><button class="btn small">Store</button><button class="btn small">Drop-off</button>';
      d.firstChild.textContent = r.display_name;
      const short = r.display_name.split(',').slice(0, 2).join(',');
      d.children[1].onclick = () => { addPoint('store', +r.lat, +r.lon, short); out.replaceChildren(); drawPoints(true); };
      d.children[2].onclick = () => { addPoint('stop', +r.lat, +r.lon, short); out.replaceChildren(); drawPoints(true); };
      out.append(d);
    }
  } catch { out.innerHTML = '<div class="fine">Search is unavailable right now. Drop pins by tapping the map, or type miles by hand.</div>'; }
});

$('#routeBtn').addEventListener('click', async () => {
  const o = curOffer(); const rt = o.route ||= blankRoute();
  const pts = [rt.me, ...rt.stores, ...rt.stops].filter(Boolean);
  if (pts.length < 2) { toast('Add at least 2 points (you, a store, a drop-off)'); return; }
  const b = $('#routeBtn'); b.disabled = true; b.textContent = 'Routing…';
  try {
    const coords = pts.map((p) => `${p.lng.toFixed(6)},${p.lat.toFixed(6)}`).join(';');
    const j = await fetchJSON(`https://router.project-osrm.org/route/v1/driving/${coords}?overview=full&geometries=geojson`, 12000);
    if (j.code !== 'Ok' || !j.routes?.length) throw new Error(j.code);
    const route = j.routes[0]; const miles = route.distance / 1609.344; const mins = route.duration / 60;
    o.miles = miles.toFixed(1); o.driveMin = Math.round(mins);
    if (rt.stores.length) o.stores = rt.stores.length;
    if (rt.stops.length) o.stops = rt.stops.length;
    o._geom = route.geometry; saveSoon(); drawPoints(true); haptic(20);
    const card = listEl.querySelector(`[data-id="${o.id}"]`); if (card) $('[data-k=miles]', card).value = o.miles;
    updateScores();
    const r = scoreOffer(o, settings);
    const out = $('#routeOut'); out.hidden = false;
    out.innerHTML = `<div><strong>${o.miles} mi</strong> · ${o.driveMin} min drive</div><div class="grow"></div><div><b class="chip" style="background:var(--card)"></b></div><div style="width:100%" class="fine">Filled into ${''}<b></b>: ${r.reason} → score ${r.score}</div>`;
    out.querySelector('.chip').textContent = r.verdict; out.querySelectorAll('b')[1].textContent = o.name;
  } catch {
    toast('Routing service unavailable. Type miles by hand.');
  } finally { b.disabled = false; b.textContent = 'Calculate route'; }
});

/* ---------- boot ---------- */
document.body.dataset.view = 'offers';
renderOffers(); renderSettings(); renderHistory();
if ('serviceWorker' in navigator) addEventListener('load', () => navigator.serviceWorker.register('sw.js').catch(() => {}));
window.__offerScout = { get offers() { return offers; }, scoreOffer, settings: () => settings };
