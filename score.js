// Offer Scout scoring model. Pure functions, no DOM. Shared by the app and node tests.
// Inputs per offer: total pay (offer + tip combined), miles, stores, stops.
export const DEFAULTS = Object.freeze({
  costPerMile: 0.30,     // your real out-of-pocket per mile (gas + wear). IRS 2025 rate is 0.70.
  avgMph: 25,            // average driving speed when no route is calculated
  shopMinPerStore: 20,   // shopping/checkout minutes per store
  minPerStop: 5,         // park, hand off, photo, per stop
  targetHourly: 25,      // your net $/hr goal
  targetPerMile: 2,      // your gross $/mi goal (the classic "$2 a mile" rule)
  weightHourly: 0.6,     // share of the score from $/hr
  storePenalty: 4,       // points off per store beyond the first
  stopPenalty: 3,        // points off per stop beyond the second
  acceptAt: 70,          // score >= this -> ACCEPT
  maybeAt: 50,           // score >= this -> MAYBE, else DECLINE
});

const num = (v, d = 0) => { const n = typeof v === 'string' ? parseFloat(v) : v; return Number.isFinite(n) ? n : d; };
const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v));
// A ratio vs target maps to 0..100, with exactly-on-target = 80 and 125%+ of target = 100.
export const ratioPoints = (r) => 100 * clamp(r, 0, 1.25) / 1.25;

// Saved data from v1 had separate tip, items, minutes and heavy fields. Fold tip into total; drop the rest.
export function migrateOffer(o) {
  if (!o || typeof o !== 'object') return o;
  const out = { ...o };
  if ('tip' in out) {
    const pay = num(out.pay), tip = num(out.tip);
    if (tip) out.pay = String(Math.round((pay + tip) * 100) / 100);
    delete out.tip;
  }
  delete out.items; delete out.minutes; delete out.heavy;
  return out;
}
export function migrateSettings(saved) {
  const out = {};
  for (const k of Object.keys(DEFAULTS)) if (saved && Number.isFinite(saved[k])) out[k] = saved[k];
  return out;
}

export function scoreOffer(offer, settings = {}) {
  const s = { ...DEFAULTS, ...settings };
  const pay = num(offer.pay);
  const miles = Math.max(0, num(offer.miles));
  const stores = Math.max(1, Math.round(num(offer.stores, 1)));
  const stops = Math.max(1, Math.round(num(offer.stops, 1)));

  const routedDrive = num(offer.driveMin) > 0;
  const driveMin = routedDrive ? num(offer.driveMin) : (miles / Math.max(1, s.avgMph)) * 60;
  const shopMin = stores * s.shopMinPerStore;
  const stopMin = stops * s.minPerStop;
  const minutes = Math.max(1, driveMin + shopMin + stopMin);

  const cost = miles * s.costPerMile;
  const net = pay - cost;
  const hourly = net / (minutes / 60);
  const perMile = miles > 0 ? pay / miles : (pay > 0 ? Infinity : 0);

  const hrRatio = s.targetHourly > 0 ? hourly / s.targetHourly : 0;
  const miRatio = s.targetPerMile > 0 ? perMile / s.targetPerMile : 0;
  const hrPts = ratioPoints(hrRatio);
  const miPts = ratioPoints(miRatio);
  const w = clamp(s.weightHourly, 0, 1);
  const base = w * hrPts + (1 - w) * miPts;
  const penStores = Math.max(0, stores - 1) * s.storePenalty;
  const penStops = Math.max(0, stops - 2) * s.stopPenalty;
  const penalty = penStores + penStops;
  let score = Math.round(clamp(base - penalty, 0, 100));
  if (pay <= 0 || net <= 0) score = 0;

  const verdict = score >= s.acceptAt ? 'ACCEPT' : score >= s.maybeAt ? 'MAYBE' : 'DECLINE';
  const reason = pay <= 0 ? 'Enter your total pay to score this offer'
    : `$${Math.round(hourly)}/hr net · ${Number.isFinite(perMile) ? '$' + perMile.toFixed(2) : '∞'}/mi · ${stores} store${stores > 1 ? 's' : ''} · ${stops} stop${stops > 1 ? 's' : ''}`;

  return {
    pay, miles, stores, stops, cost, net, minutes, routedDrive, driveMin, shopMin, stopMin,
    hourly, perMile, hrRatio, miRatio, hrPts, miPts, base,
    penStores, penStops, penalty, score, verdict, reason,
  };
}

// Rank offers best-first. Ties broken by net $/hr, then net $.
export function rankOffers(offers, settings) {
  return offers
    .map((o) => ({ offer: o, r: scoreOffer(o, settings) }))
    .sort((a, b) => b.r.score - a.r.score || b.r.hourly - a.r.hourly || b.r.net - a.r.net);
}
