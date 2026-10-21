# Offer Scout

A fast, installable iPhone web app (PWA) that scores Instacart shopper batch offers so you can decide in seconds. Compare several offers at once, see a ranked list, and get a plain **ACCEPT / MAYBE / DECLINE** with the math behind it.

**Install on iPhone:** open the site in Safari, tap Share, then **Add to Home Screen**. It runs full screen and works offline. Routing and address search need a connection.

## Features
- Several offers side by side: add, duplicate, delete, quick add (`38 12 1 2` = pay, miles, stores, drop-offs)
- Live score ring, verdict, one-line reason, live ranking with the best offer highlighted, and the full math on tap
- Map (Leaflet + OpenStreetMap): use my location, search addresses (Nominatim), tap to drop store and drop-off pins, drag pins, and get driving miles and minutes from the public OSRM router, filled into the offer automatically
- History of accepted and declined offers with stats (avg net $/hr, net earned, $/mile)
- Every threshold is editable in Settings. Everything is stored on the phone in localStorage. No accounts, no backend.

## Scoring model (`score.js`)
| Step | Formula (defaults) |
|---|---|
| Payout | offer + tip |
| Net | payout − miles × **$0.30**/mi (IRS preset $0.70) |
| Time | drive (route minutes, or miles ÷ **25 mph**) + stores × **20 min** + items × **0.6 min** + drop-offs × **5 min** (+ **5 min** heavy). Minutes you type override all of this. |
| Net $/hr | net ÷ hours |
| $/mile | payout ÷ miles (gross, the classic "$2/mile" rule) |
| Points | each ratio vs target (**$25/hr**, **$2/mi**) → 0–100: on target = 80, ≥125% = 100 |
| Score | 60% × $/hr points + 40% × $/mi points − 4 per extra store − 3 per drop-off past 2 − 3 heavy, clamped 0–100. Net ≤ 0 scores 0. |
| Verdict | ≥ 70 ACCEPT · 50–69 MAYBE · < 50 DECLINE |

## Dev
```
python3 -m http.server   # serve the folder
npm test                 # scoring unit tests (node:test)
node tests/e2e.mjs http://localhost:8000/   # headless iPhone e2e (needs playwright)
python3 scripts/make_icons.py               # regenerate icons
```
No build step: plain ES modules, about 20 KB of app code, and Leaflet loaded only when you open the Map tab.

## Limits
- OSRM (`router.project-osrm.org`) and Nominatim are free public demo services with no uptime guarantee and fair-use limits (Nominatim: at most 1 request per second, search on submit only). If either is down, type miles by hand. Everything else still works.
- The route order is You → stores (in order) → drop-offs (in order). It is not optimized.
- Not affiliated with Instacart. The app does not read the Instacart app; you type the offer numbers in.
