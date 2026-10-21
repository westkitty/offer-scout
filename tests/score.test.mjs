import test from 'node:test';
import assert from 'node:assert/strict';
import { scoreOffer, rankOffers, DEFAULTS, ratioPoints, migrateOffer, migrateSettings } from '../score.js';

const near = (a, b, eps = 0.01) => assert.ok(Math.abs(a - b) < eps, `${a} vs ${b}`);

test('ratioPoints: on-target = 80, 125%+ capped at 100, negative floored at 0', () => {
  assert.equal(ratioPoints(1), 80);
  assert.equal(ratioPoints(2), 100);
  assert.equal(ratioPoints(-1), 0);
});

test('basic math: total, net, minutes, $/hr, $/mi', () => {
  const r = scoreOffer({ pay: 40, miles: 10, stores: 1, stops: 1 });
  near(r.pay, 40); near(r.cost, 3); near(r.net, 37);
  near(r.driveMin, 24); near(r.shopMin, 20); near(r.stopMin, 5); near(r.minutes, 49);
  near(r.hourly, 37 / (49 / 60)); near(r.perMile, 4);
});

test('time = drive + 20/store + 5/stop', () => {
  const r = scoreOffer({ pay: 50, miles: 25, stores: 2, stops: 3 });
  near(r.minutes, 60 + 40 + 15);
});

test('removed fields (tip, items, minutes, heavy) are ignored by the model', () => {
  const a = scoreOffer({ pay: 30, miles: 8, stores: 1, stops: 2 });
  const b = scoreOffer({ pay: 30, miles: 8, stores: 1, stops: 2, tip: 10, items: 80, minutes: 300, heavy: true });
  assert.deepEqual(a, b);
});

test('routed drive minutes replace the mph estimate', () => {
  const r = scoreOffer({ pay: 25, miles: 10, stores: 1, stops: 1, driveMin: 12 });
  near(r.driveMin, 12); assert.equal(r.routedDrive, true);
});

test('exactly on both targets scores 80 and is ACCEPT', () => {
  const r = scoreOffer({ pay: 20, miles: 10, stores: 1, stops: 1 }, { costPerMile: 0, avgMph: 60, shopMinPerStore: 38, minPerStop: 0 });
  near(r.hourly, 25); near(r.perMile, 2); assert.equal(r.score, 80); assert.equal(r.verdict, 'ACCEPT');
});

test('penalties for extra stores and stops past 2', () => {
  const r = scoreOffer({ pay: 80, miles: 10, stores: 3, stops: 4 });
  assert.equal(r.penStores, 8); assert.equal(r.penStops, 6); assert.equal(r.penalty, 14);
  assert.equal('penHeavy' in r, false);
});

test('bad offer declines, zero pay scores 0', () => {
  assert.equal(scoreOffer({ pay: 7, miles: 18, stores: 2, stops: 3 }).verdict, 'DECLINE');
  const z = scoreOffer({ pay: 0, miles: 5 }); assert.equal(z.score, 0); assert.equal(z.verdict, 'DECLINE');
});

test('net loss is always 0 / DECLINE', () => {
  const r = scoreOffer({ pay: 5, miles: 30 }, { costPerMile: 0.70 });
  assert.ok(r.net < 0); assert.equal(r.score, 0);
});

test('middle offer is MAYBE', () => {
  const r = scoreOffer({ pay: 18, miles: 11, stores: 1, stops: 2 });
  assert.equal(r.verdict, 'MAYBE', JSON.stringify({ s: r.score, h: r.hourly, m: r.perMile }));
});

test('string inputs from form fields parse', () => {
  const r = scoreOffer({ pay: '30.50', miles: '6.2', stores: '1', stops: '2' });
  near(r.pay, 30.5); near(r.miles, 6.2);
});

test('zero miles does not divide by zero', () => {
  const r = scoreOffer({ pay: 15, miles: 0, stores: 1, stops: 1 });
  assert.equal(r.perMile, Infinity); assert.ok(r.score > 0);
});

test('settings thresholds are respected', () => {
  const o = { pay: 18, miles: 11, stores: 1, stops: 2 };
  assert.equal(scoreOffer(o, { acceptAt: 40 }).verdict, 'ACCEPT');
  assert.equal(scoreOffer(o, { maybeAt: 99, acceptAt: 100 }).verdict, 'DECLINE');
});

test('rankOffers sorts best first', () => {
  const ranked = rankOffers([
    { id: 'bad', pay: 7, miles: 18, stores: 2, stops: 3 },
    { id: 'great', pay: 45, miles: 8, stores: 1, stops: 1 },
    { id: 'ok', pay: 18, miles: 11, stores: 1, stops: 2 },
  ]);
  assert.deepEqual(ranked.map((x) => x.offer.id), ['great', 'ok', 'bad']);
});

test('migrateOffer folds old tip into total and drops removed fields', () => {
  const m = migrateOffer({ id: 'x', name: 'Offer A', pay: '22.50', tip: '8', miles: '6', stores: 1, stops: 2, items: '40', minutes: '55', heavy: true, driveMin: 0 });
  assert.equal(m.pay, '30.5'); assert.equal(m.miles, '6');
  for (const k of ['tip', 'items', 'minutes', 'heavy']) assert.equal(k in m, false, k);
  assert.equal(migrateOffer({ pay: '20', tip: '' }).pay, '20');
  assert.equal(migrateOffer({ pay: '', tip: '5' }).pay, '5');
  assert.deepEqual(migrateOffer({ pay: '12', miles: '3' }), { pay: '12', miles: '3' });
});

test('migrateSettings keeps known keys, drops removed ones', () => {
  const s = migrateSettings({ targetHourly: 30, shopMinPerItem: 0.6, heavyMinutes: 5, heavyPenalty: 3, junk: 1 });
  assert.deepEqual(s, { targetHourly: 30 });
});

test('defaults are frozen and only the four-input model settings remain', () => {
  assert.ok(Object.isFrozen(DEFAULTS)); assert.equal(DEFAULTS.costPerMile, 0.30); assert.equal(DEFAULTS.targetHourly, 25);
  assert.equal(DEFAULTS.shopMinPerStore, 20); assert.equal(DEFAULTS.minPerStop, 5); assert.equal(DEFAULTS.avgMph, 25);
  for (const k of ['shopMinPerItem', 'heavyMinutes', 'heavyPenalty']) assert.equal(k in DEFAULTS, false, k);
});
