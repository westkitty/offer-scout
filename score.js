// Offer Scout scoring model. Pure functions, no DOM. Shared by the app and node tests.
export const DEFAULTS = Object.freeze({
  costPerMile: 0.30,     // your real out-of-pocket per mile (gas + wear). IRS 2025 rate is 0.70.
  avgMph: 25,            // average driving speed when no route is computed
  shopMinPerStore: 20,   // base shopping/checkout minutes per store
  shopMinPerItem: 0.6,   // extra minutes per item/unit
  minPerStop: 5,         // park, hand off, photo, per drop-off
  heavyMinutes: 5,       // extra minutes for heavy items (cases of water, etc.)
  targetHourly: 25,      // your net $/hr goal
  targetPerMile: 2,      // your gross $/mi goal (the classic "$2 a mile" rule)
  weightHourly: 0.6,     // share of the score from $/hr
  storePenalty: 4,       // points off per store beyond the first
  stopPenalty: 3,        // points off per drop-off beyond the second
  heavyPenalty: 3,       // points off for heavy items
  acceptAt: 70,          // score >= this → ACCEPT
  maybeAt: 50,           // score >= this → MAYBE, else DECLINE
});

const num = (v, d = 0) => { const n = typeof v === 'string' ? parseFloat(v) : v; return Number.isFinite(n) ? n : d; };
const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v));
// A ratio vs target maps to 0..100, with exactly-on-target = 80 and 125%+ of target = 100.
export const ratioPoints = (r) => 100 * clamp(r, 0, 1.25) / 1.25;

export function scoreOffer(offer, settings = {}) {
  const s = { ...DEFAULTS, ...settings };
  const pay = num(offer.pay) + num(offer.tip);
  const miles = Math.max(0, num(offer.miles));
  const stores = Math.max(1, Math.round(num(offer.stores, 1)));
  const stops = Math.max(1, Math.round(num(offer.stops, 1)));
  const items = Math.max(0, num(offer.items));
  const heavy = !!offer.heavy;

  const driveMin = num(offer.driveMin) > 0 ? num(offer.driveMin) : (miles / Math.max(1, s.avgMph)) * 60;
  const shopMin = stores * s.shopMinPerStore + items * s.shopMinPerItem;
  const stopMin = stops * s.minPerStop;
  const extraMin = heavy ? s.heavyMinutes : 0;
  const estMin = driveMin + shopMin + stopMin + extraMin;
  const userMin = num(offer.minutes) > 0 ? num(offer.minutes) : 0;
  const minutes = Math.max(1, userMin || estMin);

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
  const penHeavy = heavy ? s.heavyPenalty : 0;
  const penalty = penStores + penStops + penHeavy;
  let score = Math.round(clamp(base - penalty, 0, 100));
  if (pay <= 0 || net <= 0) score = 0;

  const verdict = score >= s.acceptAt ? 'ACCEPT' : score >= s.maybeAt ? 'MAYBE' : 'DECLINE';
  const reason = pay <= 0 ? 'Enter a payout to score this offer'
    : `$${Math.round(hourly)}/hr net · ${Number.isFinite(perMile) ? '$' + perMile.toFixed(2) : '∞'}/mi · ${stores} store${stores > 1 ? 's' : ''} · ${stops} stop${stops > 1 ? 's' : ''}`;

  return {
    pay, miles, stores, stops, items, heavy, cost, net, minutes,
    usedUserMinutes: !!userMin, routedDrive: num(offer.driveMin) > 0, driveMin, shopMin, stopMin, extraMin, estMin,
    hourly, perMile, hrRatio, miRatio, hrPts, miPts, base,
    penStores, penStops, penHeavy, penalty, score, verdict, reason,
  };
}

// Rank offers best-first. Ties broken by net $/hr, then net $.
export function rankOffers(offers, settings) {
  return offers
    .map((o) => ({ offer: o, r: scoreOffer(o, settings) }))
    .sort((a, b) => b.r.score - a.r.score || b.r.hourly - a.r.hourly || b.r.net - a.r.net);
}
