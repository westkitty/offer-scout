import test from 'node:test';
import assert from 'node:assert/strict';
import { scoreOffer, rankOffers, DEFAULTS, ratioPoints } from '../score.js';

const near = (a, b, eps = 0.01) => assert.ok(Math.abs(a - b) < eps, `${a} vs ${b}`);

test('ratioPoints: on-target = 80, 125%+ capped at 100, negative floored at 0', () => {
  assert.equal(ratioPoints(1), 80);
  assert.equal(ratioPoints(2), 100);
  assert.equal(ratioPoints(-1), 0);
});

test('basic math: net, minutes, $/hr, $/mi', () => {
  const r = scoreOffer({ pay: 30, tip: 10, miles: 10, stores: 1, stops: 1, items: 0 });
  near(r.pay, 40); near(r.cost, 3); near(r.net, 37);
  near(r.driveMin, 24); near(r.shopMin, 20); near(r.stopMin, 5); near(r.minutes, 49);
  near(r.hourly, 37 / (49 / 60)); near(r.perMile, 4);
});

test('user-entered minutes override the estimate', () => {
  const r = scoreOffer({ pay: 25, miles: 5, stores: 1, stops: 1, minutes: 60 });
  assert.equal(r.usedUserMinutes, true); near(r.minutes, 60); near(r.hourly, 23.5);
});

test('routed drive minutes replace the mph estimate', () => {
  const r = scoreOffer({ pay: 25, miles: 10, stores: 1, stops: 1, driveMin: 12 });
  near(r.driveMin, 12);
});

test('exactly on both targets scores 80 and is ACCEPT', () => {
  const r = scoreOffer({ pay: 20, miles: 10, stores: 1, stops: 1 }, { costPerMile: 0, avgMph: 60, shopMinPerStore: 38, minPerStop: 0 });
  near(r.hourly, 25); near(r.perMile, 2); assert.equal(r.score, 80); assert.equal(r.verdict, 'ACCEPT');
});

test('penalties for extra stores, stops, heavy', () => {
  const r = scoreOffer({ pay: 80, miles: 10, stores: 3, stops: 4, heavy: true });
  assert.equal(r.penStores, 8); assert.equal(r.penStops, 6); assert.equal(r.penHeavy, 3); assert.equal(r.penalty, 17);
});

test('bad offer declines, zero payout scores 0', () => {
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
  const r = scoreOffer({ pay: '22.50', tip: '8', miles: '6.2', stores: '1', stops: '2' });
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

test('defaults are frozen and sane', () => {
  assert.ok(Object.isFrozen(DEFAULTS)); assert.equal(DEFAULTS.costPerMile, 0.30); assert.equal(DEFAULTS.targetHourly, 25);
});
