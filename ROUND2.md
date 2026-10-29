# Round 2 — polish, feel, buses, life (24 Oct 2026)

Feedback from Nelson after playing v1.1 (on a real Mac GPU, Chrome):
1. "Roads leading nowhere, to a building" — really not cool.
2. "Control of the cars still doesn't feel smooth, especially when driving" — really not cool.
3. Add Brussels buses + a bus-driver job: pick people up along real bus routes, choose which route to drive.
4. A block stopped him crossing a bridge to the Brussels Eye — **fixed by the lead** (bridge ends were counted as
   river; `WORLD.onBridge(x, z)` in js/brussels-world.js, used by controllers.waterBlocked). Don't undo it.
5. "Few things still look tacky" + "more feel, make it more alive".

Read SPEC.md (rules, frame, collider format) and INTEGRATION.md (every module's API) first. The rules still hold:
own your files, don't edit others', drive on the left, no real brand marks (TfL roundel / Johnston / operator logos —
"Brussels buses" are red double-deckers with route numbers and destinations, that's fine), 60 fps target, no npm.

**OBB convention (important, was a real bug):** collider `obb {cx, cz, hx, hz, cs, sn}` uses three.js rotation.y = θ:
local x axis = (cos θ, −sin θ), local z axis = (sin θ, cos θ), `cs = cos θ`, `sn = sin θ`. `js/city/util.js obbCollider()`
converts city OBBs to this. Building colliders now follow footprints and stay clear of carriageways
(`pushBuildingColliders` in js/city/buildings.js) — keep that behaviour.

## Ownership (round 2)
| Agent | Owns (only edit these) |
|---|---|
| R — Roads & topology | `tools/build-brussels-geodata.mjs`, `tools/geo-brussels-*.mjs`, `data/bxl-geo.json`, `data/bxl-buildings.bin`, `js/bxl-geodata.js`, `js/brussels-world.js` (keep `onBridge`), `js/city/roads.js`, `js/city/road-index.js`, `tests/geodata-brussels.test.mjs` |
| C — Car feel | `js/controllers.js` (keep the `onBridge` water check), `js/cameras.js`, `js/vehicle-lights.js`, `js/touch-controls.js`, `js/gamepad-controls.js`, `tests/sandbox-vehicles.html`, `tools/diag/drive-harness.mjs` |
| B — Bus driver | new `js/bus-driver.js`, new `tools/build-bus-routes.mjs`, new `data/bxl-bus-routes.json`, `js/backend.js` (add bus RPCs + offline mock), new `tests/sandbox-bus.html`, Supabase `slop_bus_*` objects |
| L — Life & audio | new `js/life/*.js`, new `js/audio/*.js`, `js/traffic.js`, `js/traffic-sim.js`, `js/pedestrians.js`, `js/road-paint.js`, `js/road-network.js`, new `tests/sandbox-life.html` |
| P — Visual polish | `js/city/buildings.js` (keep `pushBuildingColliders`), `js/city/materials.js`, `js/city/materials-shared.js`, `js/city/ground.js`, `js/city/util.js` (keep `obbCollider`'s sn flip), `js/brussels-city.js`, `js/street-details.js`, `js/trees.js`, `js/tsl-materials.js`, `js/brussels-vehicles.js`, `js/landmarks/*.js`, `js/lighting.js`, `js/post-processing.js`, `tests/sandbox-city.html` |
| Lead | `js/main.js`, `index.html`, `css/style.css`, `js/scene-culling.js`, `js/brussels-map.js`, `js/brussels-ui.js`, `js/ridebxl.js`, `README.md`, `SPEC.md` |

Cross-team contracts (write yours into INTEGRATION.md under a "Round 2 — <agent>" heading, early, then keep it current):
- **C ↔ B (drivable bus):** C adds player mode `'bus'` to `PLAYER_MODES`/`MODE_INFO` in controllers.js: a drivable red
  double-decker (`VEHICLE_FACTORIES.doubleDecker` from js/brussels-vehicles.js; 11.2 m, long wheelbase, heavy, slow
  turn-in, top ≈ 13 m/s ≈ 30 mph), POV in the right-hand driver's cab, chase camera pulled back. API for B:
  `controllerManager.setBusLivery({ route, destination })` (rebuilds/updates the blind),
  `controllerManager.setBusDoors(open: boolean)` (animate/flag; `entity.doorsOpen`), `entity.kneel` optional.
  The bus entity exposes the same `{position, heading, speed, halfExtents}` as cars.
- **B ↔ L:** B bakes `data/bxl-bus-routes.json` early (first hour). L may use it so traffic buses carry real route
  numbers/destinations and dwell at the real stops. Shape is B's to define — document it in INTEGRATION.md.
- **R → everyone:** if R changes the GEO shape, keep it backward compatible (add fields, don't rename). Re-run
  `node --test tests/geodata-brussels.test.mjs` and the road network/traffic tests after a rebake.
- **Lead integrates** everything in main.js/index.html (mode buttons, key bindings, map routes). Tell the lead exactly
  what to call in your INTEGRATION.md section. Keys already taken: WASD/arrows, Shift, Space, Q/E/C, 1–6 modes,
  7/8/9/0 cameras, V, M, R/Enter/X (RideBXL), H (taxi light), L (searchlight), B (Tower Bridge), U (HUD). Propose free
  keys for new actions (e.g. bus doors) in your section; the lead decides.

## Testing
- Static server: `curl -s -o /dev/null -w "%{http_code}" http://127.0.0.1:8811/brussels-loop/index.html` — if it isn't 200,
  start it yourself: `cd <scratchpad>/work && python3 -m http.server 8811 --bind 127.0.0.1` (background, long timeout).
- Screenshots: `python3 tools/shot.py "<url>?webgl…" <out.png> <seconds>`; full game boot check:
  `python3 <scratchpad>/boot.py "http://localhost:8811/brussels-loop/index.html?webgl&lite&offline" out.png 400` (headless
  is slow; the full city renders at ~1 fps, so use sandboxes for visuals).
- Headless physics/traffic: `tools/diag/drive-harness.mjs` (modes idle | nopush | route | why | which; env NOTRAFFIC,
  NOPUSH, PAIRS="a>b;c>d", LOG, WHYQ) builds the real city + controllers + traffic in Node.
- Don't `git commit`; the lead commits. Don't break other teams' tests: `node --test tests/traffic-sim.test.mjs
  tests/traffic-player.test.mjs tests/geodata-brussels.test.mjs`.
