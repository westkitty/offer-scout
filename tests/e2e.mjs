// Headless iPhone e2e: node tests/e2e.mjs [baseURL]. Needs `playwright` (set PW_MODULE to its path if not local).
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const { chromium, devices } = require(process.env.PW_MODULE || 'playwright');
const BASE = process.argv[2] || 'http://localhost:8765/offer-scout/';
const SHOTS = new URL('../shots/', import.meta.url).pathname;
const results = []; const ok = (name, cond, info = '') => { results.push([cond ? 'PASS' : 'FAIL', name, info]); if (!cond) process.exitCode = 1; };

const browser = await chromium.launch();
const ctx = await browser.newContext({ ...devices['iPhone 14 Pro'], colorScheme: 'dark', geolocation: { latitude: 42.3314, longitude: -83.0458 }, permissions: ['geolocation'], serviceWorkers: 'allow' });
const page = await ctx.newPage();
const errors = []; page.on('pageerror', (e) => errors.push(e.message)); page.on('console', (m) => m.type() === 'error' && errors.push(m.text()));

// Deterministic fakes for the public routing / geocoding APIs (tiles still load live when reachable).
await ctx.route('**/router.project-osrm.org/**', (r) => r.fulfill({ contentType: 'application/json', body: JSON.stringify({ code: 'Ok', routes: [{ distance: 14967, duration: 1260, geometry: { type: 'LineString', coordinates: [[-83.0458, 42.3314], [-83.03, 42.34], [-83.01, 42.35]] } }] }) }));
await ctx.route('**/nominatim.openstreetmap.org/**', (r) => r.fulfill({ contentType: 'application/json', body: JSON.stringify([{ lat: '42.3401', lon: '-83.0301', display_name: 'Kroger, Gratiot Avenue, Detroit, Michigan, USA' }]) }));

const t0 = Date.now();
await page.goto(BASE, { waitUntil: 'load' });
ok('first load < 2s (local)', Date.now() - t0 < 2000, `${Date.now() - t0} ms`);
const swScope = await page.evaluate(async () => (await navigator.serviceWorker.ready).scope);
ok('service worker registered', !!swScope, swScope);

// Offer A (default card): MAYBE-ish
const A = page.locator('.offer').first();
await A.locator('[data-k=pay]').fill('18');
await A.locator('[data-k=miles]').fill('11');
await A.locator('[data-step="stops:1"]').tap();
// Offer B, C via quick add
for (const q of ['45 8 1 1', '7 18 2 3']) { await page.fill('#quickInput', q); await page.press('#quickInput', 'Enter'); }
await page.waitForTimeout(700);
const cards = await page.$$eval('.offer', (els) => els.map((e) => ({ name: e.querySelector('.o-name').value, verdict: e.querySelector('.chip').textContent, rank: e.querySelector('.rank').textContent, best: e.classList.contains('best-offer'), reason: e.querySelector('.reason').textContent })));
console.log(cards);
const inputs = await page.$$eval('.offer', (els) => els.map((e) => [...e.querySelectorAll('.fields .f > span')].map((s) => s.textContent).join('|')));
ok('each card has exactly Total pay | Stores | Stops | Miles', inputs.every((x) => x === 'Total pay $|Stores|Stops|Miles'), inputs[0]);
ok('no tip/items/minutes/heavy inputs anywhere', (await page.$$('[data-k=tip],[data-k=items],[data-k=minutes],[data-k=heavy]')).length === 0);
ok('quick-add explains order (total miles stores stops)', /total\s+miles\s+stores\s+stops/.test(await page.getAttribute('#quickInput', 'placeholder')) && /38 12 1 2.*total.*miles.*store.*stops/.test(await page.textContent('.quick-hint')));
ok('3 offers on screen', cards.length === 3);
ok('Offer A = MAYBE', cards[0].verdict === 'MAYBE', cards[0].reason);
ok('Offer B = ACCEPT and ranked #1 + highlighted', cards[1].verdict === 'ACCEPT' && cards[1].rank === '#1' && cards[1].best, cards[1].reason);
ok('Offer C = DECLINE and ranked #3', cards[2].verdict === 'DECLINE' && cards[2].rank === '#3', cards[2].reason);
const strip = await page.$$eval('.rk', (els) => els.map((e) => e.textContent.replace(/\s+/g, ' ').trim()));
ok('ranking strip order B, A, C', /Offer B/.test(strip[0]) && /Offer A/.test(strip[1]) && /Offer C/.test(strip[2]), strip.join(' | '));
ok('banner recommends Offer B', /I recommend Offer B/.test(await page.textContent('#best')));
await page.evaluate(() => { document.activeElement?.blur(); scrollTo(0, 0); }); await page.mouse.wheel(0, -3000); await page.waitForTimeout(300);
await page.screenshot({ path: SHOTS + '01-offers-ranked.png' });

await page.locator('.offer').nth(1).locator('.o-score').tap();
await page.waitForTimeout(300);
ok('math breakdown opens', await page.locator('.offer').nth(1).locator('.math').isVisible());
const mathTxt = await page.locator('.offer').nth(1).locator('.math').textContent();
ok('math shows Total pay, no tip/items/heavy', /Total pay/.test(mathTxt) && !/tip|item|Heavy/i.test(mathTxt));
await page.locator('.offer').nth(1).scrollIntoViewIfNeeded();
await page.screenshot({ path: SHOTS + '02-math-breakdown.png' });

// Map: route Offer A from my location -> searched store -> tapped drop-off
await page.locator('.offer').first().locator('[data-act=route]').tap();
await page.waitForSelector('.leaflet-container', { timeout: 8000 });
await page.tap('#locBtn'); await page.waitForSelector('.pt-me');
await page.fill('#geoQ', 'Kroger Gratiot'); await page.press('#geoQ', 'Enter');
await page.locator('.geo-item button', { hasText: 'Store' }).tap();
await page.tap('[data-mode=stop]');
const box = await page.locator('#map').boundingBox();
await page.mouse.click(box.x + box.width * 0.8, box.y + box.height * 0.3);
await page.tap('#routeBtn'); await page.waitForSelector('#routeOut:not([hidden])');
const miles = await page.evaluate(() => window.__offerScout.offers[0].miles);
ok('OSRM route auto-fills miles (9.3 mi from 14,967 m)', miles === '9.3', miles);
ok('route sets stores/stops from pins', await page.evaluate(() => { const o = window.__offerScout.offers[0]; return o.stores === 1 && o.stops === 1 && o.driveMin === 21; }));
await page.waitForTimeout(1500);
await page.evaluate(() => scrollTo(0, 0)); await page.waitForTimeout(300);
await page.screenshot({ path: SHOTS + '03-map-route.png' });

// Accept best, view history
await page.tap('.tab[data-view=offers]');
// Chromium's iPhone emulation leaves the visual viewport panned ~22px after the map view, which breaks hit-testing for page.tap; click the element directly instead.
const tapC = async (sel) => { await page.$eval(sel, (b) => { b.scrollIntoView({ block: 'center' }); b.click(); }); };
await page.waitForTimeout(400);
await tapC('.offer.best-offer [data-act=accept]');
await page.waitForTimeout(400);
await page.waitForTimeout(400);
await tapC('.offer:last-child [data-act=decline]');
await page.waitForTimeout(400);
await page.tap('.tab[data-view=history]');
const hist = await page.$$eval('.history li', (l) => l.length);
ok('history logs accept + decline', hist === 2, String(hist));
await page.waitForTimeout(500); await page.screenshot({ path: SHOTS + '04-history.png' });
await page.tap('.tab[data-view=settings]');
await page.fill('#s-targetHourly', '30');
ok('settings have no per-item or heavy rows', (await page.$$('#s-shopMinPerItem,#s-heavyMinutes,#s-heavyPenalty')).length === 0 && (await page.$$('#s-shopMinPerStore,#s-minPerStop')).length === 2);
ok('settings persist to localStorage', (await page.evaluate(() => JSON.parse(localStorage.getItem('os.settings')).targetHourly)) === 30);
await page.waitForTimeout(500); await page.screenshot({ path: SHOTS + '05-settings.png' });

// Manifest
const man = await page.evaluate(async () => { const href = document.querySelector('link[rel=manifest]').href; const m = await (await fetch(href)).json();
  const icons = await Promise.all(m.icons.map(async (i) => { const r = await fetch(new URL(i.src, href)); const b = await createImageBitmap(await r.blob()); return `${i.sizes}=${b.width}x${b.height}`; }));
  const ati = document.querySelector('link[rel=apple-touch-icon]').href; const ab = await createImageBitmap(await (await fetch(ati)).blob());
  return { m, icons, ati: `${ab.width}x${ab.height}`, capable: document.querySelector('meta[name=apple-mobile-web-app-capable]')?.content }; });
ok('manifest has name/start_url/scope/display standalone', man.m.name && man.m.start_url && man.m.scope && man.m.display === 'standalone');
ok('manifest icons are real 192/512 PNGs', man.icons.join(',') === '192x192=192x192,512x512=512x512,512x512=512x512', man.icons.join(','));
ok('apple-touch-icon is 180x180 + apple-mobile-web-app-capable', man.ati === '180x180' && man.capable === 'yes');

ok('service worker cache is v1.1.0', (await page.evaluate(() => caches.keys())).includes('shell-v1.1.0'));

// Offline reload from service worker
await ctx.setOffline(true);
await page.reload({ waitUntil: 'load' });
ok('works offline (app shell from SW)', await page.locator('.brand h1').textContent() === 'Offer Scout');
ok('offline state restored offers from localStorage', (await page.$$eval('.offer', (e) => e.length)) === 1);
await ctx.setOffline(false);

// Migration: an old v1 install with separate tip/items/minutes/heavy must load and fold tip into total
const ctxM = await browser.newContext({ ...devices['iPhone 14 Pro'] });
await ctxM.addInitScript(() => { if (!sessionStorage.getItem('seeded')) { sessionStorage.setItem('seeded', '1');
  localStorage.setItem('os.offers', JSON.stringify([{ id: 'old1', name: 'Old offer', pay: '22.50', tip: '8', miles: '6', stores: 1, stops: 2, items: '40', minutes: '55', heavy: true, driveMin: 0, route: { me: null, stores: [], stops: [] } }]));
  localStorage.setItem('os.settings', JSON.stringify({ targetHourly: 28, shopMinPerItem: 0.6, heavyPenalty: 3 })); } });
const pM = await ctxM.newPage(); const errM = []; pM.on('pageerror', (x) => errM.push(x.message));
await pM.goto(BASE); await pM.waitForSelector('.offer');
const mig = await pM.evaluate(() => ({ pay: document.querySelector('[data-k=pay]').value, saved: JSON.parse(localStorage.getItem('os.offers'))[0], set: JSON.parse(localStorage.getItem('os.settings')), reason: document.querySelector('.reason').textContent }));
ok('old saved offer migrates: tip folded into total (22.50 + 8 = 30.5)', mig.pay === '30.5' && !('tip' in mig.saved) && !('heavy' in mig.saved) && !('items' in mig.saved) && !('minutes' in mig.saved), JSON.stringify(mig.saved));
ok('old settings migrate: custom target kept, removed keys dropped', mig.set.targetHourly === 28 && !('shopMinPerItem' in mig.set) && !('heavyPenalty' in mig.set));
ok('migrated install has no JS errors and scores', errM.length === 0 && /\/hr net/.test(mig.reason), mig.reason);
await ctxM.close();

// Light mode shot with fresh demo data
const ctx2 = await browser.newContext({ ...devices['iPhone 14 Pro'], colorScheme: 'light' });
const p2 = await ctx2.newPage(); await p2.goto(BASE);
await p2.locator('[data-k=pay]').first().fill('41'); await p2.locator('[data-k=miles]').first().fill('14');
for (const q of ['22 6 1 2', '15 21 2 4']) { await p2.fill('#quickInput', q); await p2.press('#quickInput', 'Enter'); }
await p2.waitForTimeout(700); await p2.evaluate(() => { document.activeElement?.blur(); scrollTo(0, 0); }); await p2.mouse.wheel(0, -3000); await p2.waitForTimeout(300);
await p2.screenshot({ path: SHOTS + '06-offers-light.png' });

ok('no JS errors', errors.filter((e) => !/tile|Failed to load resource/i.test(e)).length === 0, errors.join(' / '));
await browser.close();
for (const r of results) console.log(r.join('  '));
console.log(`${results.filter((r) => r[0] === 'PASS').length}/${results.length} checks passed`);
