# Integration notes

Each workstream appends a section: what main.js / index.html must import, call each frame, and any DOM/CSS it expects.

## Workstream A — Geodata (`js/bxl-geodata.js`, `js/brussels-world.js`, `js/brussels-config.js`, `data/*`)

**Build / check** (only when the OSM extract or the builder changes; the baked files are committed):
`node --max-old-space-size=12000 tools/build-brussels-geodata.mjs` (~20–40 s) → `data/bxl-geo.json` (5.6 MB) +
`data/bxl-buildings.bin` (4.4 MB). Tests: `node --test tests/geodata-brussels.test.mjs`. Top-down PNG:
`node tools/geo-brussels-topdown.mjs [out.png] [m/px] [cx cz w h]` (default `tools/out/bxl-topdown.png`, 4 m/px).

**Imports**
- `import { GEO } from './bxl-geodata.js'` — top-level await; fetches `../data/bxl-geo.json` + `../data/bxl-buildings.bin`
  relative to the module (serve `data/` next to `js/`). Also exports `BUILDING_KINDS, MATERIALS, ROOFS, decodeGeo, loadGeo`.
  Works in Node too (reads with fs), so tests can import it. Decode ≈ 0.6 s.
- `import { WORLD, TELEPORT_LOCATIONS, BRUSSELS_LANDMARKS, getLocationLabel, getLocationText, isTypingInField, ROADS, WORLD_BOUNDS } from './brussels-config.js'`.
  `WORLD` is the shared `createWorldQueries(GEO)` instance — use it instead of making another (≈150 ms + a 5 MB water raster).
- `js/brussels-world.js` also exports `createWorldQueries, bridgeDeckAt, WATER_LEVEL (-1.2), VEHICLE_KINDS, MAJOR_KINDS, WALK_KINDS`.

**NY `city-config.js` → Brussels**
| NY (main.js / controllers / gamepad) | Brussels |
|---|---|
| `getLocationLabel(x,z)` → string `"Place · A & B"` | `getLocationLabel(x,z)` → `{primary, secondary, text}`; `getLocationText(x,z)` returns the `"primary · secondary"` string |
| `ROADS` (name set) | `ROADS` = `GEO.roads` (all kinds; filter `r.name`) |
| `NYC_LANDMARKS` | `BRUSSELS_LANDMARKS` `[{id,name,short,x,z,district,r}]` (21 places; `r` = "you're at it" radius) |
| `TELEPORT_LOCATIONS[key]` `{x,z,heading}` | same shape, keyed by id, plus `{id,name,sub}`: bigBen, brusselsEye, towerBridge, shard, stPauls, gherkin, buckinghamPalace, trafalgarSquare, piccadillyCircus, battersea, kingsCross, paddington, oxfordCircus, coventGarden, camden, boroughMarket, soho |
| `isTypingInField` | same (+ TEXTAREA / contentEditable) |
| `ISLAND_BOUNDS`, `getIslandBoundsAtZ` (shore clamp) | `WORLD_BOUNDS` + `WORLD.isWater(x,z)` |
| `blockAt`, `streetZ`, `CENTRAL_PARK_BOUNDS`, `SIGNAL_TIMING`, … | no equivalent (no grid); use `WORLD.nearestRoad`, `GEO.parks`, own timing |

**World queries** (`WORLD.*`): `groundHeight(x,z,mode)` (bridge deck or 0; `'boat'` → −1.2 on water, boats pass under
bridges; ~60 ns/call, safe per vehicle per frame), `deckHeight(x,z)`, `isWater(x,z)` (4 m raster, fountains excluded),
`nearestRoad(x,z,{kinds:[..]|'drive'|'major'|'walk', maxDist=250, named, tunnels, filter})` → `{road,x,z,dist,heading,t,seg}`,
`streetName(x,z)`, `districtAt(x,z)`, `randomRoadPoint(rng,{kinds, tunnels, bridges})` → `{road,x,z,heading,t,seg}`.

**Conventions & quirks other workstreams must know**
- **Heading** (teleports, nearestRoad, randomRoadPoint): NY convention, 0 faces +z (south), direction = `(sin h, cos h)`.
  Teleports stand in the LEFT lane of a real drive road facing the landmark.
- **Winding**: building rings, water/park/plaza outers and zones are CCW seen from above = *negative* shoelace sum over
  (x, z); holes are CW. For three.js: build a `Shape` from `(x, -z)` (CCW) → `ShapeGeometry` → `rotateX(-Math.PI/2)` gives +y normals.
- **Roads are whole OSM ways, not split at junctions.** Shared OSM nodes survive simplification bit-exactly, so build the
  graph by hashing vertex coords (0.1 m) — including interior vertices (>90 % of road ends join another road; the rest
  are dead ends). Dual carriageways are separate `oneway` ways; roundabouts are `junction:'roundabout'`, oneway 1 (OSM
  order is clockwise for UK roundabouts). Roads are clipped at bounds + 30 m; service roads < 25 m dropped. Extra fields:
  `sub` ('' | 'sidewalk' | 'crossing' | 'link' | service type e.g. 'driveway', 'parking_aisle'), `deck` (see bridges).
  `maxspeed` is **mph** (untagged: 20, trunk 30, service 10; footways 0). `lanes` is 0 for non-vehicle kinds. Tunnels
  (`tunnel:1`, e.g. Strand/Hyde Park Corner underpasses) are kept — don't draw them. ~42k footways incl. 13.7k
  separately-mapped sidewalks (`sub:'sidewalk'`) — the city renderer probably wants to skip those.
- **Bridges**: only crossings of water are raised. Their roads/rail carry `deck: Float32Array` (one height per vertex;
  points densified to ≤ 8 m). `GEO.bridges[]` = man_made=bridge outlines with `deckY` (mid-span height) and `axis`
  `[x0,z0,x1,z1]`; height anywhere = `bridgeDeckAt(bridge,x,z)` (raised cosine along the axis, 0 at both ends). Thames
  bridges 7–8 m (≈9 m above the −1.2 water), canal/lake bridges ≤ 2.5 m humps. `synthetic:true` outlines are hulls for
  crossings without an OSM outline — for drawing only. Other bridges/flyovers (`bridge:1`, no `deck`) are at grade.
- **Water**: the Thames is 3–4 `kind:'river'` polygons (main multipolygon up to Brussels Bridge, the Pool of Brussels,
  a SW sliver) that share/overlap edges — draw them all at the same level. Bridge piers are holes. It enters the play
  area through the **south** edge in the SW (Chelsea Reach), not the west edge. Trafalgar Square fountains are not in
  `GEO.water` (Landmarks draws them); other fountains are `kind:'fountain'`.
- **Landmark zones** (`GEO.landmarkZones`, ids = `LANDMARK_ANCHORS` keys): bigBen, parliament (3 polys), brusselsEye,
  towerBridge (hull of both towers + the high walkway; the road deck is still in `GEO.roads`), shard, stPauls, gherkin,
  buckinghamPalace, nelsonsColumn, trafalgarSquare (column + fountains only), batterseaPowerStation. Buildings whose
  centroid is inside have `landmark=1` (524 incl. many building:parts) — skip them. No zone for Piccadilly Circus.
- **Buildings**: building:parts replace the outline when they cover ≥ 50 % of it, so expect `minHeight > 0` (extrude from
  minHeight to height). `building=roof` canopies have minHeight = height − 1.2. `colour` is 0 unless OSM tags it.
  `kind 'glass_tower'` = ≥ 60 m or ≥ 40 m & large in the City / South Bank / Nine Elms / King's Cross.
- `GEO.parks` is sorted largest first (draw in order). `GEO.districts[].rank`: 3 suburb, 2 quarter, 1 neighbourhood,
  0 locality (park gates etc., labels only — `districtAt` ignores them).

## Workstream F — City renderer (`js/brussels-city.js`, `js/city/*.js`, `js/street-details.js`, `js/trees.js`, `js/tsl-materials.js`)

Sandbox: `tests/sandbox-city.html?webgl&cx=&cz=&r=[&time=golden|midday|twilight|night][&cam=aerial|street|heli]`
`[&az=&el=&d=&at=x,z&hd=deg][&shadows][&nodetails][&notrees][&nohud]` (r ≥ 6000 = whole city; keep r ≤ 250 under
SwiftShader). Node full-build check: `node --max-old-space-size=8000 tests/city-build-check.mjs [cx cz r]`.

**Import & call (main.js)**
```js
import { buildBrusselsCity } from './brussels-city.js';
const city = buildBrusselsCity(scene, { geo: GEO, world: WORLD, landmarkZones: landmarks.zones /* optional */ });
allColliders.push(...city.colliders);
setupSceneCulling(scene, [...Object.values(city.groups), ...landmarkRoots], lightingSystem.sunLight.shadow);
// every frame:
city.update(dt, camera);   // signal-lens state when traffic drives them; trees hook scene.onBeforeRender themselves
```
Options: `region: {cx, cz, r}` (square, sandbox), `details` / `trees` (default true), `landmarkZones` (B's zones: buildings
whose centroid is inside are skipped, on top of `GEO.buildings.landmark`), `onProgress(label)`.
`city.groups` = `{ tiles: 'BrusselsCityTiles', ground: 'BrusselsGround', water: 'BrusselsWater', roads: 'BrusselsRoads',
bridges: 'BrusselsBridges', details: 'BrusselsStreetDetails', trees: 'BrusselsTrees' }` (all under root `BrusselsCity`).
Tsl-materials.js no longer imports the NY `city-config.js` (stand-ins), so it doesn't pull 1.1 MB of NYC data; every
existing export still works, plus `hash2D, noise2D, bumpNormal, lineAA, gridLine, filteredPulse`.
Time of day: everything reads `cityUniforms` (`uInteriorGlow` → lit windows/shops/lamps/lens glow; `uSky*`,
`uSunColor`, `uSkySunDir` → reflections; `uRoadWetness` → tarmac/paving wetness). LightingSystem presets drive them.

**Return value**
- `colliders` — SPEC format. One OBB per building (min-area rectangle; footprints filling < 68 % of a > 300 m² box are
  split into 2–3 OBBs), `minY` = minHeight when > 2.5 m (canopies, bridges between blocks: walk/drive under).
  Plus bus shelters (OBB), K6 phone boxes and pillar boxes (AABB). ~86 k colliders for the whole city.
- `sidewalks` = `{ kerbHeight: 0.12, strips, pavementAt(x, z) }`
  - `strips[]`: `{ road, side, pts, y, offset, w, kind }` — one per continuous pavement run. `road` = GEO.roads index,
    `side` +1 = left of the road's point order / −1 right, `pts` Float32Array [x,z,…] of the pavement's *centreline*,
    `y` Float32Array per point (pavement top = deck height + 0.12), `offset` = road.w/2 + w/2 from the road centreline,
    `w` pavement width (trunk/primary 3.2, secondary 3.0, tertiary 2.8, unclassified 2.4, residential 2.3; 2.5 on
    bridges), `kind` = road kind. Runs stop where they'd cross another carriageway (junction mouths, the other half
    of a dual carriageway) or the river. No pavements on service roads, living streets, roundabouts, `link` roads.
    45 k strips / ~2 000 km for the whole city. OSM `sub:'sidewalk'` footways are not drawn (these replace them).
  - `pavementAt(x, z)` → pavement top y or `null` (16 m hash; ~0.2 µs).
- `surfaceHeight(x, z)` → drawn surface: max(world.groundHeight, pavementAt) — use it to stand people on pavements.
- `footprints[]` — `{minX,maxX,minZ,maxZ,kind}` for 'lamp' (0.25 m), 'signal', 'beacon', 'shelter' (4.4 m), 'phonebox',
  'pillarbox', 'bollard', 'bench' (58 k). Buildings are in `colliders` only.
- `signalHeads[]` — `{x, z, heading, road}` one per traffic-light pole (5.2 k): on the LEFT kerb (road.w/2 + 0.7 m) of
  each approach at every `GEO.signals` node, head facing the oncoming traffic; `heading` = travel direction of the
  traffic it controls (NY convention, (sin h, cos h)). Lenses cycle by themselves in the shader (60 s: green 0–24,
  amber 24–27, red 27–57, red+amber 57–60; offsets per 40 m cluster, crossing axes half a cycle apart).
  **G**: `city.setSignalPhase((i, t) => 0 red | 1 amber | 2 green | 3 red+amber)` switches them to your states
  (called from `city.update` every frame for all heads; `setSignalPhase(null)` returns to the built-in cycle).
- `stats` — `{ buildings, tiles, triangles, drawCalls, buildMs, timings, buildingStats, roadStats, detailStats, … }`.

**What F draws** — buildings (not `landmark=1`, nor inside `landmarkZones`; Piccadilly's corner building way 153661809
is kept), carriageways of every non-tunnel vehicle road at y = 0 / road.deck (identical world-space asphalt where
ribbons overlap, junction discs at shared nodes), raised pavements + granite kerbs (0.12 m), footways / cycleways /
steps (gravel inside parks) at y ≈ −0.01, pedestrian streets & GEO.plazas in light stone, parks / gardens / pitches,
the base ground (to 3 km beyond the bounds) cut away over water by a 4 m signed-distance mask, the Thames / lakes /
canals / docks at y = −1.2 with stone embankment walls and a granite parapet (0.9 m) on the Thames, bridges (deck
slab, fascias, parapets, river piers) under every road / footway / rail with `deck`, rail (ballast + sleepers +
rails) incl. **brick arched viaducts at 7.2 m for OSM `bridge` rail without a deck** (ramping 1:35 into at-grade track;
cosmetic — no collider, `groundHeight` is not raised there), street furniture, trees.
**Static UK markings (F)**: white dashed centre lines (4 m / 5 m) on two-way roads ≥ 5.5 m wide, double yellow lines
along both kerbs on ~70 % of streets (single yellow on the rest of non-residential), red double lines on trunk roads,
give-way double dashes where a minor road ends on a bigger one, zebra crossings (stripes + kerb/centre zig-zags) with
Belisha beacons, signal crossings (studs + stop lines on the left-hand approach). All cut wherever they'd enter
another carriageway. **Left to G (road-paint.js)**: lane dividers on multi-lane roads, lane arrows, box junctions,
bus lanes. Markings sit 0.012 m above the carriageway with polygonOffset — G's paint should use ≥ 0.015 m.
**Not drawn by F**: tunnels; GEO.roads named 'Tower Bridge' (deck, footways, parapets, piers — Workstream B draws
them); GEO.bridges outlines; Trafalgar fountains (B).

**Cost** (whole city, `tests/city-build-check.mjs`): ~4.8 M triangles of static merged geometry (buildings 2.37 M in
299 + 118 tiles of 500 m, + 17 k low "rest of Brussels" filler blocks in a 1.5 km ring beyond the bounds in 2 km chunks;
roads / pavements / markings ~2.1 M and ground / water ~0.1 M in 2 km chunks) + ~5.3 M in instanced props (lamps
41 k + night light pools, signals 5.2 k, beacons 2.5 k, shelters 1.5 k, phone boxes 361, pillar boxes 306, bollards
3.7 k, benches 3 k) which `setupSceneCulling` chunks and distance-culls (300 m–2 km), + ~70 k trees (js/trees.js
LODs). 696 meshes before culling; frustum culling leaves a few hundred. Build ≈ 15 s CPU in the (slow, shared)
container — expect ~5–7 s on an M-series Mac (buildings ~50 %, roads ~40 %). `filler: false` skips the outer ring;
beyond the bounds the Thames keeps flowing out (the water mask clamps at the edge + an outer water plane).

## Workstream D — RideBXL ride-hail + Supabase (`js/ridebxl.js`, `js/backend.js`)

Sandbox + test: `tests/sandbox-ridebxl.html` (synthetic 9×9 grid, stand-in car, `?offline`, `?autoname`, `?webgl`;
WASD drive, P autopilot along the GPS route) and `python3 tests/sandbox-ridebxl.py [base_url] [out_dir]` (offline full
ride flow + online path against a stubbed Supabase via `page.route`).

**Imports & boot (main.js)**
```js
import { createBackend } from './backend.js';
import { RideBXL } from './ridebxl.js';

const backend = createBackend();            // ?offline forces the localStorage mock; network failures fall back to it automatically
const ridebxl = new RideBXL({
  scene, camera: cameraSystem.camera,       // camera may also be a function () => camera
  controllers: controllerManager,           // needs .activeMode and .getActiveEntity() -> { position (Vector3), heading, speed (m/s) }
  world: WORLD, geo: GEO, backend,
  ui: {
    setMode: (m) => selectMode(m),           // REQUIRED for the "Switch to RideBXL car" button (calls setMode('ride'))
    onRouteChange: (route, target) => mapSystem.setRoute?.(route, target),   // optional push (≈1 Hz + on every reroute)
    onRideFinished: (result) => {}           // optional
  }
});
// after the loading overlay hides (it may show the first-play driver-name modal):
backend.init({
  onRestore: (state) => {                    // state = what getState below returned last time (or null)
    if (state.mode) selectMode(state.mode);
    if (state.pos) teleportTo(state.pos.x, state.pos.z, state.pos.h);
    if (state.time) selectTime(state.time);
    if (state.weather) /* WS E */ setWeather?.(state.weather);
  }
}).then(() => backend.startAutosave(() => {  // every 30 s + on visibilitychange/pagehide; must stay ≤ 4 KB as JSON
  const e = controllerManager.getActiveEntity();
  return { v: 1, pos: { x: e.position.x, z: e.position.z, h: e.heading }, mode: controllerManager.activeMode,
           time: lightingSystem.activePresetId, weather: currentWeather };
}));
// every frame, after controllerManager.update():
ridebxl.update(dt);
```
RideBXL also calls `backend.addDistance(m)` itself for all player movement (teleports excluded), which autosave sends as `p_distance_m`.

**Hooks expected from other workstreams**
- **C (controllers)**: a mode id **`'ride'`** for the RideBXL car (`controllers.activeMode === 'ride'`). Collisions:
  implement either `controllers.addCollisionListener(fn) -> unsubscribe` or EventDispatcher `addEventListener('collision', fn)`,
  calling `fn({ impulse /* m/s of speed lost */, mode, x, z })`. Without it RideBXL detects hits from sudden speed drops
  (> 3.5 m/s in one frame at > 40 m/s²); `ridebxl.reportCollision(impulse)` can be called manually too.
- **E (map)**: pull `ridebxl.getRoute()` → `[{x, z}, …]` (car → current pin along the road graph, [] when none) and
  `ridebxl.getTarget()` → `{ x, z, kind: 'pickup'|'dropoff', name } | null` each frame/redraw, or use `ui.onRouteChange`.
  Colours: pickup `#3ee6b4` (RideBXL mint), drop-off `#ff5fa2`.
- **Lead**: mode switcher button / hotkey for `'ride'` (RideBXL car), keyboard: RideBXL binds **R** (toggle app),
  **Enter** (accept offer / close result), **X** (decline offer) on `window` — ignored while typing in inputs. Don't
  bind those elsewhere. Add `ride: [[['R'], 'RideBXL app'], [['Enter'], 'Accept job']]` style hints if wanted.

**DOM / CSS**: everything is created from JS with an injected `<style id="rl-style">` (`.rl-` classes, uses the
`--font-sans` / `--grain` tokens from style.css when present). Fixed elements: phone panel right side (top 86 px,
284 px wide, max-height `100vh − 262px`, collapses to a small handle; state remembered in localStorage), HUD chip top
centre, toasts below it, pin label / edge arrow overlay (z-index 9–14), result card centre, "Offline" pill top centre
(`.rl-offline-pill`, from backend.js; the chip moves below it). All hide with `body.hud-minimized`.
If main's top-right toolbar grows taller than ~66 px, override `.rl-phone, .rl-handle { top: … }`.

**3D**: adds `RideBXLPin` (beam + hovering pin + kerb rings, additive, `toneMapped:false`, scales with camera distance),
`RideBXLRoute` (chevron ribbon at groundHeight + 0.15 m, next 600 m, `frustumCulled=false`), `RideBXLPassenger`
(simple capsule figure, waves, casts shadow). Few draw calls; nothing static — keep them out of scene-culling roots.

**Backend API** (`js/backend.js`): `createBackend({offline?, fetchImpl?, timeoutMs=8000})` →
`init({onRestore, askName=true})`, `rpc(name, args)`, `join(name)`, `load()`, `save(state)`, `rename(name)`,
`finishRide({pickup, dropoff, distance_m, duration_s, rating})` → `{fare, ride_count, ride_earnings, rating}` (throws
`RpcError` with the server's message on rejection), `leaderboard(limit)`, `recentRides()`, `addDistance(m)`,
`startAutosave(getState, ms)`, `saveNow()`, `onChange(cb)`, `.offline`, `.player {id, token, name}` (localStorage
`brusselsloop_player`), `.profile`. Also exports `computeFare` (same formula as `slop_finish_ride`), `randomDriverName`,
`askDriverName`. The mock (`brusselsloop_mock_db`) mirrors the SQL validation (15 s between rides, 100 m–25 km,
≥ distance/45 s, ≤ 3600 s, name regex) and seeds a few rival drivers for the offline leaderboard.

**Road graph**: built lazily the first time the player goes online (`RoadGraph` over drivable `GEO.roads`: vertices
hashed at 0.5 m, oneway respected with a 6× wrong-way fallback, driveways/parking aisles/sidewalks excluded). It's
logged as `[ridebxl] road graph: N nodes … ms`; expect a few hundred ms on the full city (one-off).

## Workstream B — Landmarks (`js/brussels-landmarks.js`, `js/landmarks/*.js`, `tests/sandbox-landmarks.html`)

Sandbox: `tests/sandbox-landmarks.html?webgl&lm=<id>[&night][&raise][&az=&el=&d=&tx=&ty=&tz=]` — ids `bigBen`
(= westminster), `brusselsEye`, `towerBridge`, `shard`, `stPauls`, `gherkin`, `buckinghamPalace`, `trafalgarSquare`,
`piccadillyCircus`, `battersea`, `all`. The HUD prints meshes / triangles / draw calls / colliders / zones.

**Import & call (main.js)**
```js
import { buildBrusselsLandmarks } from './brussels-landmarks.js';
import { cityUniforms } from './tsl-materials.js';
const landmarks = buildBrusselsLandmarks(scene, { world: WORLD, uniforms: cityUniforms });
allColliders.push(...landmarks.colliders);
// culling: landmarks.group ('BrusselsLandmarks') has one child group per landmark ('Landmark_<id>') → use them as roots
const landmarkRoots = landmarks.group.children;
// every frame:
landmarks.update(dt, lightingHours);   // hours optional; ignored when `uniforms` is passed (night follows uInteriorGlow)
```
- `uniforms`: pass the city's shared `cityUniforms` (needs `uInteriorGlow`; also uses `uSkyTopColor`,
  `uSkyHorizonColor`, `uSkySunDir`, `uSunColor` if present). Night factor = smoothstep(0.35, 1.3, uInteriorGlow) drives
  lit windows, floodlighting, the Eye's blue LEDs, clock dials, Shard crown, LED screens. Without it call
  `landmarks.setNight(0…1)` or pass `timeOfDay` hours to `update`.
- Big Ben's hands show real Brussels time (Intl, Europe/Brussels), updated once a second inside `update`.
- The Eye turns at the real speed (one revolution / 30 min); `opts.eyeSpeed` multiplies it. Capsules are an
  InstancedMesh with `frustumCulled = false`.
- Returned: `{ group, colliders, zones, update, landmarks, towerBridge, setNight }`. Colliders are SPEC format
  (AABB + `obb`, no `minY`): buildings, towers, piers, chimneys, plinths, fountains, gate railings.
- `zones`: `[{ id, pts: Float32Array [x,z,…] }]`, CCW (GEO convention), ids = `LANDMARK_ANCHORS` keys: `bigBen`,
  `parliament`, `brusselsEye`, `towerBridge`, `shard`, `stPauls`, `gherkin`, `buckinghamPalace` (palace + forecourt, and the
  Victoria Memorial circle), `nelsonsColumn`, `trafalgarSquare` (the two fountain basins), `piccadillyCircus` (Eros
  island only), `batterseaPowerStation`. **F**: skip buildings inside `GEO.landmarkZones` *or* these.

**Tower Bridge deck contract (A / F / G / C)**
- Local frame: centre (3656.5, 246.3), axis (−0.391, 0.920) north→south; local s = (p − centre)·axis.
- **Deck height = A's profile.** The road surface follows `world.groundHeight(x, z, 'drive')` sampled every 2 m along the
  centreline (A's raised cosine over the GEO.bridges 'Tower Bridge' axis, `deckY` = **8.0 m** mid-span, ≈ 6.9 m at the
  bascule hinges (the leaves keep that camber), ≈ 6.9 m at the towers, 0 at both ends). Without `world` the same formula is used. So physics/traffic
  keep using `WORLD.groundHeight` and land exactly on our deck. `landmarks.towerBridge.deckY` = 7.99 (mid-span),
  `deckAtWorld(x, z)` / `deckProfile(s)` give the drawn surface.
- **B draws the whole deck** (asphalt 12.4 m + 2 × 2.2 m footways, parapets, lamps) over the full OSM 'Tower Bridge'
  road, s = −163.3 … +157.4, plus piers, towers, walkways, chains and the two bascule leaves. **F: please do not draw
  the deck/parapets/piers for GEO.roads named 'Tower Bridge' (incl. its footways) or the GEO.bridges 'Tower Bridge'
  outline** — otherwise a static deck stays across the river when the bascules open.
- Bascules (s = −35.2 … +35.2) are **down by default**. `landmarks.towerBridge.raise()`, `.lower()`, `.toggle()`,
  `.setOpen(0…1)`, `.open` (0…1), `.moving`, `.isPassable()`; 22 s to open to 86°. **G/C**: when `!isPassable()`,
  stop traffic at `stopLines` (s = ±49.4) — colliders do not block the gap.

**Piccadilly Circus**: the curved LED screen (invented brands only, incl. a RideBXL ad) hangs 0.7 m proud of the facade
of OSM way 153661809 (the corner building on the north side) from y = 6.2 to 19.5 m — **F keeps drawing that
building**. B draws only the screen + its dark cabinet and the Shaftesbury Memorial Fountain (Eros).
**Trafalgar Square**: B draws Nelson's Column + lions, the two fountains (animated, not in GEO.water), the 4 plinths and
4 lamp standards; paving, the north terrace and the National Gallery are F's.

**Cost** (meshes = draw calls per pass; static parts merged per material inside each landmark; measured in the sandbox):
| landmark | draw calls | triangles |
|---|---|---|
| Westminster (Elizabeth Tower + Palace) | 13 | ~7 k |
| Brussels Eye | 12 | ~46 k |
| Tower Bridge | 28 | ~13 k |
| The Shard | 6 | ~1 k |
| St Paul's | 8 | ~8 k |
| The Gherkin | 3 | ~9 k |
| Buckingham Palace + Victoria Memorial | 24 | ~7 k |
| Trafalgar Square | 20 | ~11 k |
| **all ten** | **132** | **~109 k** (73 colliders, 14 zones) |
| Piccadilly Circus | 6 | ~2 k |
| Battersea Power Station | 12 | ~4.5 k |
All materials are TSL node materials built in `js/landmarks/common.js` (world-space patterns, so no UVs needed);
the only textures are two Union Flag canvases and the LED ad atlas (8 × 256 × 352 canvas).

## Workstream C — Vehicles & player controllers (`js/brussels-vehicles.js`, `js/controllers.js`, `js/vehicle-lights.js`)

Sandbox: `tests/sandbox-vehicles.html?show=all` (lineup of the road vehicles; `&view=front|rear|top`; one model: `?show=<factory>&yaw=deg&dist=m`),
`?mode=car|ride|cyclist|helicopter|boat|person` (drive with the real `cameras.js`; `&cam=pov|action`, `&alt=m` heli start
altitude, `&tp=x,z,heading`, `&keys=forward,left`), `?night`, `?webgl`, `?noshadow`, `?autotest`. Under `?webgl` the
sandbox hides pedestrians.js people (their storage-buffer skinning renders as noise on the headless WebGL2 fallback; `&people` shows them).

### main.js changes (small)
```js
import { ThirdPersonControllerManager, PLAYER_MODES, MODE_INFO } from './controllers.js';
import { WORLD } from './brussels-config.js';
const controllerManager = new ThirdPersonControllerManager(scene, allColliders, {
  world: WORLD,                                   // groundHeight(x,z,mode,y?) + isWater(x,z) (+ nearestRoad for spawn snapping)
  spawn: { x, z, heading },                       // optional ground spawn (cab; ride/bike/person placed beside it).
                                                  // Default: nearestRoad(0, 40) (Trafalgar Sq → Whitehall). Boat: Westminster Pier.
  spawns: { boat: {x,z,heading}, helicopter: {x,z,heading,y} },  // optional per-mode overrides
  mode: 'car'
});
```
- Mode list (gamepad cycle, buttons, number keys): `PLAYER_MODES = ['person','car','ride','cyclist','helicopter','boat']`.
  index.html needs buttons for `ride` (RideBXL) and `boat` (River bus); rename car → "Black cab", heli → "Police helicopter".
- Replace main's `controlHints` / `topSpeedMph` tables with `MODE_INFO[mode].hints` / `.topSpeedMph` / `.label`
  (entity `.label` is the same string).
- Every frame unchanged: `controllerManager.update(dt, elapsed)` (it also drives `VEHICLE_UNIFORMS.night` from
  `cityUniforms.uInteriorGlow`, so traffic lamps follow day/night without extra calls).
- When colliders/world arrive later: `controllerManager.setColliders(list)`, `controllerManager.setWorld(WORLD)`.

### Controller API (NY shape kept)
Unchanged: `activeMode`, `keys`, `entities[mode]`, `getActiveEntity()`, `setMode(mode)`, `teleportActiveTo(x,z,heading)`
→ `{x,z}`, `getGroundHeight(x,z,mode)`, `update(dt,elapsed)`, `resetInput()`, `setTouchInput/setGamepadInput/
clear*Input`, `nearColliders`, `resolveHorizontalCollision`, entity `{type, label, mesh, position, heading, speed, vx, vz,
cameraTargetOffset, chaseDistance, chaseHeight, lastCollisionSpark}`.
Changed / new:
- **constructor** `(scene, colliders, { world, spawn, spawns, mode, bounds })` — no `city-config.js` / `landmarks.js` imports
  any more (NY `ISLAND_BOUNDS`, Central Park, Bryant Park lawn, `isPointOnSidewalk`, `blockAt`, `streetZ` are gone).
  Bounds = `WORLD_BOUNDS` (helicopter may leave by 2 km).
- **modes** `'ride'` (RideBXL car, `type: 'car'` so cameras treat it as a car) and `'boat'` (`type: 'boat'`).
  Entities carry `mode`, `halfExtents {hx,hz}` (collision box), `bodyHeight`, `povOffset` (local eye position; cars: driver
  on the RIGHT, x < 0).
- Removed from entities: NY `carState` (brake lamps are now `entity.uniforms.brake`), `wheels[].steerPivot/tire/isFront`
  (now `{group, spin, front}`), cyclist `pedals`/`helmet`. `entity.model` is the brussels-vehicles.js Group.
- `getGroundHeight(x, z, mode, y?)` — `y` is passed through to `world.groundHeight` (lets a world tell "under the deck" apart).
- `setMode(mode, { placeNear: true })` — optional: move the new mode's entity beside the current one ("get in the cab").
- `getPovPosition(target)` → world-space cockpit eye of the active entity. **cameras.js (lead)**: in the `pov` case use
  `controllerManager.getPovPosition(desiredPos)` instead of the centred `fwdOffset/eyeY` table so the cab/RideBXL POV sits in
  the right-hand driver's seat (the body is backface-culled from inside; dash + steering wheel are modelled). Optional:
  `entity.type === 'boat'` → look-up bias like the heli (0.2) in `chase`, `sideOffset ≈ 6, backDist ≈ 16` in `action`.
- `isWater(x,z)`, `findClearPosition(mode,x,z,heading,alt)` (`findTeleportPosition` kept as an alias), `findWaterNear`.
- `setTaxiForHire(bool)` (key **H** in cab mode) — the cab's amber TAXI sign; `toggleSearchlight()` (key **L** in heli,
  default automatic: on at night). `setColliders(list)`, `setWorld(world)`.
- `addCollisionListener(fn)` → unsubscribe, and `addEventListener('collision', fn)` (EventDispatcher) for RideBXL:
  `fn({ type:'collision', impulse /* m/s lost */, mode, x, z, kind: 'collider'|'embankment'|'bank' })`, fired for the
  cab/ride/bike/boat on hits > 1 m/s.
- Colliders: `minY` honoured (a collider whose `minY` is above the body top is passed under — canopies, bridge decks).
- Speeds (m/s): cab 19 (boost 28 ≈ 63 mph), ride 20 (31 ≈ 70 mph), bike 7.2 (10.5), person 4.2 (7.4), heli 40 (65),
  boat 12.5 (15.5). HUD reads `entity.speed` as before.
- Car physics: engine with a soft top end, brakes/reverse, speed-sensitive steering with grip-limited yaw, tyre slip
  (vx/vz), **Space = handbrake** slide, sprung chassis pitch/roll/heave, slope pitch on bridge ramps, falls off ledges.
  Cars/bike/person can't enter water unless `groundHeight > max(0.3, waterLevel + 1)` there (bridge decks); they slide
  along the embankment. The boat only moves where *all* its hull sample points are `isWater`; it bobs, trims bow-up and
  sprays a wake (one InstancedMesh). The heli lands on the ground or on any collider roof (`maxY`).
- **traffic.js (G)**: it sized the player from `activeMode` (`'cyclist'|'person'|else car`). Use
  `entity.halfExtents.hx/hz` instead (boat 3.95×13.5, heli is airborne). Skip player-vs-traffic for `'boat'`/`'helicopter'`.
- **tests/controllers.test.cjs** (not owned by C): add stubs `'./geo-frame.js': { WORLD_BOUNDS: {}, toWorld: () => ({x:0,z:0}) }`
  and `'./brussels-vehicles.js': {}` (the `city-config.js` / `landmarks.js` stubs become unused; `isTypingInField` is internal
  now) → the 9 keyboard/touch tests pass unchanged. The other 15 exercise NY physics fixtures (`ISLAND_BOUNDS`, shoreline
  clamps, hand-built entities without `halfExtents`/`mode`, `wheels[].steerPivot`) and need rewriting against the Brussels
  entities — `tests/sandbox-vehicles.html?webgl&noshadow&autotest` covers the same ground in the browser.
- **Autotest**: `sandbox-vehicles.html?webgl&noshadow&autotest` runs 16 scripted drives (all six modes: bridge deck,
  embankment stop, building stop, steering, handbrake, river bank, bridge pier, heli climb) as a pure fixed-step
  simulation, logs `PASS/FAIL …` lines + `AUTOTEST PASS|FAIL` to the console and sets `document.title` /
  `window.__sb.autotest`. The sandbox exposes `window.__sb.{controllers, cams, colliders, world, simTime}` and runs the
  controller at a fixed 60 Hz step so slow headless frames don't change the physics.

### Vehicle models for traffic (G) — `js/brussels-vehicles.js`
```js
import { VEHICLE_FACTORIES, getInstanceParts, VEHICLE_UNIFORMS, createVehicleMaterial, CAR_COLOURS } from './brussels-vehicles.js';
const bus = VEHICLE_FACTORIES.doubleDecker({ route: '24', destination: 'Pimlico' });   // THREE.Group
const { parts, wheels, spec } = getInstanceParts(bus, { instancePaint: true });
// parts: [{name:'body'|'decals'|'blinds', geometry, material}] → one InstancedMesh each (model-local, merged)
// wheels: {left, right, material, placements:[{x,y,z,side,front,radius}]} → one InstancedMesh per side, or skip far away
```
- Factories (real metres, front +z, ground y=0, origin between the axles; all accept `{ uniforms }`):
  `blackCab({colour, plateIndex})` 4.86 m (amber TAXI sign lit by `uniforms.sign`), `rideCar({colour})` 4.54 m
  (RideBXL stickers), `genericCar({type:'hatch'|'saloon'|'suv'|'van', colour, seed})` (+ `hatch/saloon/suv/van` shortcuts;
  van = white Transit-style), `doubleDecker({route, destination, colour})` 11.2 × 2.52 × 4.4 m, doors on the nearside
  (+x): `spec.doors.front/middle {z0,z1}`, `hireBike()` (`userData.cranks`), `policeHeli()` (`userData.mainRotor`
  spin .y, `tailRotor` spin .x, `searchlight` gimbal), `riverBoat()` 27 × 7.9 m (origin at the waterline).
- `model.userData.spec` = `{ kind, length, width, height, wheelbase, wheelRadius, halfExtents, headlight:[x,y], zFront,
  tail:[x,y], zRear, povOffset, ... }` — pass it straight to `placeVehicleHeadlight(spot, spec, side, matrix)`.
- `model.userData.wheels[] = { group (steer pivot), spin (mesh, rotate .x), front, side, x, y, z, radius }`;
  `spinWheels(model, metres, steer)` helper.
- Materials: one vertex-coloured `MeshStandardNodeMaterial` per uniform set; surface per vertex in `aSurf` (rough, metal,
  emissive class, paint mask). Lamps follow `VEHICLE_UNIFORMS.night` (set by the controller each frame, or call
  `setVehicleNightFromGlow(glow)`); `.brake` (tail lamps), `.sign` (taxi signs, default 1), `.beacon` are shared across
  all traffic — use `createVehicleUniforms()` for a private set. With `instancePaint: true`, paint vertices read a
  per-instance `aPaint` vec3 (`geometry.setAttribute('aPaint', new THREE.InstancedBufferAttribute(rgbLinear, 3))`).
- Draw calls per model: body 1 + decals 1 (shared atlas: plates, TAXI, RideBXL, POLICE, Battenburg, RIVER BUS) + bus
  blind 1 + wheels (one mesh each; as instanced parts: 2). Triangles incl. wheels: cars 6.4–7.8k, bus 7.0k, bike 4.3k,
  heli 6.0k, boat 4.4k — use a cheaper LOD (e.g. body only, no wheels/decals/interior) beyond ~120 m.
- `vehicle-lights.js` adds `SEARCHLIGHT`, `createSearchlight()`, `beamScaleForGlow(glow)`; existing exports unchanged.

## Workstream E — Map, HUD look & weather (`js/brussels-map.js`, `js/lighting.js`, `js/post-processing.js`, `js/brussels-ui.js`, `tests/sandbox-map.html`)

**Sandbox**: `tests/sandbox-map.html` — radar + plates with a fake player driving the Strand and a GPS route;
`?view=full[&fit=1|&zoom=<px/m>&cx=&cz=][&search=Baker%20Street]` full atlas; `?route=ext` RideBXL-style route + pins;
`?weather=clear|overcast|drizzle|fog[&time=golden|midday|twilight|midnight][&still&frames=3&lowshadow]` 3D weather street.

### Map — `BrusselsMapSystem` (drop-in for `NYCMapSystem`)
```js
import { BrusselsMapSystem } from './brussels-map.js';
const mapSystem = new BrusselsMapSystem({ controllerManager, cameraSystem, trafficSystem, onToggle, onTeleport: teleportTo
  /* optional: rotateMinimap = true, onWaypointChange(wp), roadGraph (a js/ridebxl.js RoadGraph to share) */ });
mapSystem.prewarm();          // optional, behind the loading screen: builds vector layers + city overview (~0.3–1 s)
mapSystem.update();           // every frame (unchanged)
```
- Same surface as NY: `toggleFullMap(open)`, `isFullMapOpen`, `resizeFullCanvas()`, `renderFullMap()`, `search(text)`,
  `waypoint` (assignable `{x, z, name}` — **name must be a string**: use `getLocationLabel(x, z).text` in teleportTo),
  plus `setWaypoint(x, z, name?)`, `clearWaypoint()`, `getGpsRoute()`.
- Full-map click → `onTeleport(x, z, heading?)` (heading of the road there, or undefined → main's default) and the spot
  becomes the waypoint; **right-click / Shift+click / long-press** only sets the GPS waypoint (road-following route via
  RideBXL's `RoadGraph`, rerouted when you stray > 40 m, cleared on arrival). Clicks on water snap to the nearest road.
  Drag pans, wheel / pinch zooms, M / Esc toggle (unchanged).
- **RideBXL**: `ui.onRouteChange: (route, target) => mapSystem.setRoute(route, target)` — accepts `[{x,z}]` (or flat) and
  either `{ color }` or RideBXL's target `{x, z, kind:'pickup'|'dropoff', name}` (route coloured by kind + a pin);
  `setRoute(null)` / `[]` clears and the GPS waypoint route shows again. Extra pins: `setPins([{x, z, kind, label}])`.
- Radar rotates with the camera (`rotateMinimap:false` for north-up); it moves the `.radar-north` badge round the rim
  itself (inline left/top/transform). It reads `cameraSystem.currentPos/currentLookAt` (`.x/.z` only).
- It fills `#fullmap-counts`, the search placeholder, the compass (north up), `#map-view-all` title and **replaces the
  children of `.fullmap-legend`** with a Brussels legend; injects `<style id="bxl-map-style">` (paper backgrounds).
- Uses the same DOM ids as NY (`minimap-card`, `minimap-canvas`, `fullmap-modal`, `fullmap-canvas(-wrap)`,
  `fullmap-hover-info`, `fullmap-player-info`, `fullmap-search`, `close-fullmap-btn`, `map-zoom-in/out`,
  `map-center-player`, `map-view-all`, `map-compass-needle`) — keep them.

### Lighting & weather — `js/lighting.js`
```js
const lightingSystem = new LightingSystem(scene, renderer);   // unchanged; time presets keep their ids
lightingSystem.applyPreset('golden' | 'midday' | 'twilight' | 'midnight');
lightingSystem.setWeather('clear' | 'overcast' | 'drizzle' | 'fog');  // .weather = current id (default 'clear')
lightingSystem.onWeatherChange((id, params) => { ssrPass.intensity.value = params.ssr; colorGrade.applyWeather(id); });
lightingSystem.getWeatherParams();   // { id, overcast, rain, fog, wet, ssr, wetness }
lightingSystem.update(cameraSystem.currentPos);   // unchanged (also thins rain above 150 m)
```
- Sun positions are Brussels (51.5° N, late August, BST): golden 19:10 (az 272°, el 14°), midday 13:00 (185°, 50°),
  blue hour 20:25 (296°, 7°), night = moonlight. Default on load: **golden hour, clear** (looks best; overcast is one click).
- Weather: overcast = flat grey cloud deck in the sky dome & IBL, sun ×0.16 with `shadow.intensity` 0.28, stronger sky
  light, more haze; drizzle = overcast + rain streaks + wet ground; fog = thick tinted aerial fog (≈250 m visibility at
  street level, thins above ~150 m; brown-orange at night). Every change re-bakes the PMREM env (one-off ~ms).
- Rain = one mesh `WeatherRain` (7000 TSL streak quads around the camera, transparent, `frustumCulled=false`), added to
  the scene and only visible while raining → its pipeline compiles the first time it rains (small hitch), unless main
  sets `lightingSystem.rain.mesh.visible = true` during `precompileShaders()`.
- **Uniform names for F (materials):** `import { weatherUniforms } from './lighting.js'` →
  `weatherUniforms.wetness` (0..1 ground wetness: drizzle 0.92, fog 0.4, overcast 0.18, clear = preset's 0.05–0.3),
  `weatherUniforms.rain` (0..1, use for ripples / drips), `weatherUniforms.overcast`, `weatherUniforms.fog`.
  The same wetness is also written to `cityUniforms.uRoadWetness` (tsl-materials.js) so the existing road/pavement
  puddle code keeps working. For SSR puddles: lower roughness (≈0.9 → 0.25) with wetness on roads/pavements; main can
  raise `ssrPass.intensity` to `params.ssr` (drizzle 0.85) via `onWeatherChange`.
- It still writes `cityUniforms.uSunColor/uSkyTopColor/uSkyHorizonColor/uSkySunDir/uInteriorGlow/uCanyonBounce`
  (guarded: missing ones are skipped).

### Colour grade — `js/post-processing.js`
`createPostProcessing(renderer, sceneColor, reflections)` → `{ outputNode, applyPreset(id), applyWeather(id), bloomPass,
uniforms }` (API kept; `reflections` may be null). Brussels grade: cooler / less saturated by day, sodium-amber highlights
over cool LED shadows at night; weather lowers contrast & saturation, fog adds bloom bleed. main: call
`colorGrade.applyWeather(id)` whenever the weather changes (applyBrusselsHud does it for you).

### HUD — `js/brussels-ui.js`
```js
import { applyBrusselsHud } from './brussels-ui.js';
const hud = applyBrusselsHud({ mainHooks: { lighting: lightingSystem, colorGrade,
  onWeather: (id) => { ssrPass.intensity.value = lightingSystem.getWeatherParams().ssr; } } });
// in the telemetry tick, instead of renderLocation(getLocationLabel(...)) (Brussels's label is an object, not a string):
hud.renderLocation(getLocationLabel(where.x, where.z), where);
```
- Injects `<style id="bxl-ui-style">` (no CSS file to link): Brussels street plates (white enamel, black caps, thin black
  inset border, red postcode district e.g. `STRAND WC2`, borough under a rule `CITY OF WESTMINSTER`; postcode/borough
  from a district lookup, position fallback — `postcodeFor(district, x, z)` exported), the red **BXL** brand badge,
  weather buttons (same `.time-btn` look, `data-weather`, inserted after `.time-switch` with a divider), paper radar.
  It sets `--taxi: #e3283e; --taxi-ink: #fff` so every "active" accent (mode pill etc.) turns Brussels red.
- Weather buttons call `mainHooks.setWeather(id)` if given, else `lighting.setWeather(id)` + `colorGrade.applyWeather(id)`;
  the last pick is restored from localStorage `brusselsloop_weather` (pass `initialWeather` to force one,
  `restoreWeather:false` to skip). `hud.setActiveWeather(id)` syncs the buttons (e.g. after RideBXL restores
  `state.weather`; lighting.onWeatherChange already does it when `lighting` is passed).
- At runtime it also rewrites the NY strings below — but the lead should make these **index.html edits** directly:
  1. `<title>` → `Brussels Loop`; `meta description` → Brussels text.
  2. modulepreload list: drop `nyc-geodata.js`, `city-config.js`, `city-grid.js`, `boroughs.js`, `buildings.js`,
     `landmarks.js`, `nyc-map.js`; add `bxl-geodata.js`, `brussels-world.js`, `brussels-config.js`, `brussels-map.js`,
     `brussels-ui.js` (+ other workstreams' modules).
  3. Loader: `<span class="mta-bullet loader-bullet">NY</span>` → `<span class="bxl-badge loader-bullet">BXL</span>`;
     `.loader-title` → `Brussels Loop`.
  4. `#canvas-container` aria-label → `3D Brussels Loop viewport`.
  5. Brand: `.brand .mta-bullet` text `NY` → `BXL` (class `bxl-badge`); `<h1>` → `Brussels Loop`; repo link label/URL as
     you see fit.
  6. `#btn-open-map` title → `Brussels Street Atlas [M]`.
  7. Teleport popover: replace the 8 NY `data-teleport` buttons with Brussels ids from `TELEPORT_LOCATIONS` (bigBen,
     brusselsEye, towerBridge, shard, stPauls, gherkin, buckinghamPalace, trafalgarSquare, piccadillyCircus, battersea,
     kingsCross, paddington, oxfordCircus, coventGarden, camden, boroughMarket, soho), `pop-name` = `.name`, `pop-sub` = `.sub`.
  8. Minimap `<aside id="minimap-card">` aria-label `Live Brussels street radar`, title `Open the Brussels Street Atlas [M]`.
  9. `#hud-active-mode` default text `NYC Yellow Taxi` → `Black cab` (controllers set it anyway).
  10. Camera popover: NY scenic cameras (Central Park, 5th Ave, Times Square, Chrysler, Empire State deck, Bryant Park,
      East River) → Brussels ones once `cameras.js` has them.
  11. Full map: `aria-label` → `Brussels Street Atlas`; title bullet `NY` → `<span class="bxl-badge">BXL</span>`;
      `<h2>Manhattan Street Atlas</h2>` → `<h2>Brussels Street Atlas</h2>`; search placeholder → `Search streets, stations &
      landmarks — Strand, Baker St, Big Ben…`; compass title → `North is up`; `#map-view-all` title → `All of Zone 1`;
      legend items can be left empty (the map fills `.fullmap-legend`).
  12. Time buttons: optional titles `Golden Hour 19:10`, `Midday 13:00`, `Blue Hour 20:25`, `Night 23:30`.
  13. Fonts: `Overpass` (NY sign font) is no longer needed.

## Workstream G — Road network, traffic & pedestrians (`js/road-network.js`, `js/traffic-sim.js`, `js/traffic.js`, `js/road-paint.js`, `js/pedestrians.js`)

Sandbox: `tests/sandbox-traffic.html?webgl&cx=&cz=&r=` (default Trafalgar Sq 0,0 r=500; Hyde Park Corner `cx=-1580&cz=430`;
`&warm=s &night &rain &signals` (debug lamps on every signal head) `&bridge=up &h= &tilt= &yaw=`). Flat road ribbons from
GEO.roads, aerial camera. Headless: `node --test tests/traffic-sim.test.mjs` (≈1 min; `SIM_SECONDS`, `SIM_VEHICLES`).
New file `js/traffic-sim.js` = the simulation without rendering (so Node can test it); traffic.js draws it.
The NY `tests/traffic.test.cjs` / `tests/traffic-performance.test.cjs` exercise the deleted NY traffic code — retire them.

**main.js** (NY call sites keep working):
```js
import { createTrafficSystem, createHighwayTraffic } from './traffic.js';
import { buildRoadPaint } from './road-paint.js';
import { buildBrusselsRoadNetwork } from './road-network.js';
const network = buildBrusselsRoadNetwork(GEO, WORLD);          // ~0.5–1 s, ~100 MB JS heap (lanes/junctions built lazily)
const trafficSystem = createTrafficSystem(scene, { network, geo: GEO, world: WORLD,
  sidewalks: city.sidewalks,               // optional: people walk F's pavement strips (else derived w/2+1.6 m lines)
  towerBridge: landmarks.towerBridge });   // optional: B's bascules; traffic holds at stopLines while !isPassable()
const highwayTraffic = createHighwayTraffic();               // no-op in Brussels (keep or drop the call)
buildRoadPaint(scene, trafficSystem.network);                 // tiles near the camera, updated by trafficSystem.update
city.setSignalPhase(trafficSystem.cityPhaseFn(city.signalHeads)); // F's lenses show the simulated lights
// every frame (unchanged NY signature; or update(dt, camera, playerEntity, activeMode)):
trafficSystem.update(dt, elapsed, cameraSystem.currentPos, controllerManager.getActiveEntity(), controllerManager.activeMode, cameraSystem.camera);
trafficSystem.setRain(weatherIsRaining);  // umbrellas (≈60 % of people), brisker walking
```
`createTrafficSystem(scene, sidewalks, footprints)` (NY arity) also works — Brussels ignores those arrays.

**trafficSystem API**: `update`, `network`, `sim`, `group`, `vehicles` (alive count), `cars` (alive vehicles
`{x, y, z, yaw, speed, type:'cab'|'hatch'|'saloon'|'suv'|'van'|'bus', route, braking, indicator}` — E's radar reads
`.cars`), `peds`, `signalHeads` (network heads `{id, x, z, y, heading (faces drivers), controller, phase, stopX, stopZ,
lineX0/Z0/X1/Z1}`), `signalAspects` (Uint8Array per head, 0 red · 1 red+amber · 2 green · 3 amber, 5×/s),
`signalState(id)` → `'red'|'redamber'|'green'|'amber'`, `signalStateAt(x, z)` → `{head, aspect}` (nearest within 30 m),
`cityPhaseFn(cityHeads)` (F's encoding), `setRain(bool)`, `setTowerBridge(tb)`, `setPlayerPush(bool)`,
`route(from, to)`, `getDynamicColliders(x, z, r = 60)` → SPEC colliders of nearby traffic (`obb {cx,cz,hx,hz,cs:cos yaw,
sn:sin yaw}`, `minY/maxY`, `vehicle`), `stats()`.
**Player**: vehicles brake behind the player in their lane, and traffic.js pushes the player's entity out of any car/bus
it overlaps (SAT, cars give a little, buses none; uses `entity.halfExtents`; skipped for boat/helicopter or > 2.6 m up).
If the lead wires `getDynamicColliders()` into controllers.js instead, call `setPlayerPush(false)`.

**Network API** (`buildBrusselsRoadNetwork(geo, world)`, no three.js — RideBXL/E may use it directly):
- `route(fromXZ, toXZ, {heading})` → `{ points: Float32Array [x,z,…] along the kerb lanes, length (m), duration (s at the
  limits), links, steps: [{name, turn: 'start'|'S'|'L'|'R'|'U'|'arrive', x, z, dist}] }` or null. A* over directed links,
  oneway + turn-legal (no U-turns except dead ends), ~20–200 ms across Zone 1.
- `nearestLane(x, z, {heading, maxDist})` → `{lane, s, x, z, dist}`; `lanesNear / linksNear / pavementsNear(x, z, r)`;
  `ensureNode(node)` (builds a junction's lanes + connectors + conflicts on demand), `aspect(ctl, phase, t)`, `pedWalk(ctl, t)`.
- Data: `nodes`, `links` (directed; `{from, to, pts, len, nLanes, laneW, oneway, speed (m/s from maxspeed mph), rank,
  roundabout, control: {controller, phase}, zebra, busStops, succ}`), `lanes` (lane 0 = kerb lane, LEFT of travel),
  `connectors` (cubic curves through junction boxes, `turn`, `priority`, `conflicts`), `controllers` (UK cycle:
  red → red+amber 2 s → green 17–26 s → amber 3 s → red; one phase per approach axis, + 7 s pedestrian stage where there
  are signal crossings; stop lines a short hop apart share a controller), `crossings` (zebra / signal crossings on drive
  roads), `signalHeads`, `stats`.

**Behaviour**: ~200 vehicles within 420 m of the camera (recycled out of view, spawned ahead of the camera; cabs ≈22 %
in the West End/City, 8 % elsewhere; buses ≈8–10 % on bus-route roads, 4 route variants 24/9/38/15, dwell 7–14 s at
GEO.busStops), IDM car following, commitment to a junction only with a green (or amber it can't stop for), nobody on
the zebra, no conflicting traffic in the box, room on the far side; give way to roundabout traffic, the major road and
(turning right) oncoming traffic. Gridlocked vehicles (> 40 s, not at a red) more than 45 m from the camera are
recycled even in view. ~260 people (denser in the West End/City/South Bank, tourists in bright jackets near landmarks)
walk the pavements and cross at zebras (when no car is too close) and signal crossings (green man).

**Rendering**: one InstancedMesh per model part (body with per-instance paint, decals, bus blinds) for 9 model
variants, instanced wheels within 90 m, contact shadows, one instanced lamp mesh (brake lights, blinking indicators),
10 headlight spots at night (from `VEHICLE_UNIFORMS.night`, which C's controller sets). ≈ 40 draw calls for traffic + 3
for people. Road paint (G): stop lines at signalled junctions, give-way lines at roundabout entries, dashed lane dividers
on multi-lane roads, lane arrows on multi-lane approaches; 0.025 m above the asphalt, 250 m tiles within 420 m.

**Numbers** (container, loaded 2-core box, headless test 5 sim-min at Trafalgar Sq, 200 vehicles + 180 people):
sim step ≈ 1.5–3 ms avg (p95 5–10 ms); mean speed ≈ 3.0–3.1 m/s (central Brussels is ~3 m/s in reality); 0 overlaps,
0 keep-left violations, 0 red-light runs, roundabouts 100 % clockwise (Hyde Park Corner), stuck > 60 s ≈ 2–3 % of
vehicle lives (excluding queues at red lights).

## Round 2 — B — Bus driver (`js/bus-driver.js`, `tools/build-bus-routes.mjs`, `data/bxl-bus-routes.json`, bus RPCs in `js/backend.js`, `tests/sandbox-bus.html`)

### Data: `data/bxl-bus-routes.json` (≈270 KB, real OSM `route=bus` relations, night routes skipped)
Rebuild: `node --max-old-space-size=12000 tools/build-bus-routes.mjs` (first run reads osm_central.json ≈30 s and caches
`tools/out/bus-relations.json`; then ≈5 s; `FRESH=1` re-reads OSM, `ALL=1` lists every candidate). Re-run it after a
geodata rebake or a road-network change (paths are routed on `buildBrusselsRoadNetwork(GEO, WORLD).route()` kerb lanes).
```
{ v: 1, generated, source, note,
  routes: [ {                               // 16 curated routes, picker order: 9 11 12 15 24 38 73 88 139 159 453 23 25 390 14 19
    ref: '9',
    variants: [ {                           // always 2: dir 0 and dir 1 (opposite directions)
      id: '9-<osmRelId>', osm, dir: 0|1,
      from, to, via,                        // OSM relation tags (full journey, may lie outside the play area)
      destination: 'Hammersmith',           // short destination-blind text (≤ 20 chars)
      firstStop, lastStop,                  // names of the first / last stop inside the play area
      length,                               // m of `path`
      path: [x0, z0, x1, z1, …],            // world metres, drivable polyline along the LEFT kerb lane, start = first stop's bay
      stops: [ { name, code /* stop letter e.g. 'H' */,
                 x, z,                      // pavement point (= the GEO.busStops node where one is within 12 m → city shelter/flag)
                 bx, bz,                    // bay point on the kerb lane (on `path`) where the bus stops
                 h,                         // heading of travel at the bay (rad, NY convention: dir = (sin h, cos h))
                 side: 'L'|'R',             // which side of the bus the pavement is ('R' = one-way street / contraflow, rare)
                 s } ]                      // metres along `path` (monotone)
    } ] } ] }
```
Traffic (L): a bus can follow `path` and dwell ~8–14 s at each `stop.s`; blind = `ref` + `destination`.


## Round 2 — R — Roads & topology (`tools/build-brussels-geodata.mjs`, `tools/geo-brussels-*.mjs`, `data/*`, `js/bxl-geodata.js`, `js/city/roads.js`)

"Roads leading nowhere" fix. Check: `node tools/geo-brussels-roadcheck.mjs [--crops 3 --tag after]` (counts per category,
zoomed top-down crops to `tools/out/roadcheck/`). The bake (`tools/geo-brussels-roadfix.mjs`, ~25 s total) now:
- draws short tunnels at grade (`tunnel` 1 → 0) when they only duck under a building (≥ 70 % inside), a railway
  (≤ 120 m) or a road junction (≤ 60 m): the approach no longer stops at both portals; brick viaducts open over them.
- **drops** ~1.4 k roads: dead-end service stubs (< 80 m) into / against buildings, at dropped tunnels or in water;
  isolated fragments; underpass approach ramps that run beside the surface road (Piccadilly / Hyde Park Corner, …).
- extends dead ends that stop 0.3–4 m short of another carriageway onto it (modal filters) and dead ends facing a wall
  within 4 m up to the wall. Vertex hashing is unchanged (extensions add a non-shared tip point).
**GEO additions (backward compatible — nothing renamed):**
- `road.capA` / `road.capB` (first / last point): `''` (junction / edge) | `'kerb'` (kerbed end) | `'bollards'`
  (modal filter or continues as a path) | `'portal'` (tunnel mouth) | `'gate'` (ends at a building wall).
- `GEO.gates[{road, end, x, z, nx, nz, w, h}]` — where a `'gate'` end meets a wall: wall point, outward wall normal,
  road width, opening height (≤ building height − 1.2).
- `GEO.passages[{road, pts, w, minY, portals:[{x, z, nx, nz}], tag}]` — ~380 runs of drawn carriageways / pedestrian
  streets through ground-level building footprints (OSM `tunnel=building_passage`, `covered=yes`, roads under
  stations, mews arches…). `pts` = centreline (Float32Array, 0.5 m beyond the walls), `w` = road width, `minY` =
  clearance (maxheight + 0.3, else 4.8 m / 4.0 service / 3.6 pedestrian, ≤ building height − 1.5), `portals` = wall
  crossings with outward normals, `tag` = `'passage' | 'covered' | ''`.
**What roads.js draws** (`buildRoadEnds`): kerb slabs across kerbed ends (joining the pavements), black bollards with a
band, tunnel portals (retaining walls, dark mouth, headwall), roller shutters in a stone frame at gates, and a dark
segmental arch + stone surround on the facade at every passage portal. `rd.sites.deadEnds[{x, z, kind, road}]`.
**P (buildings):** to cut real arches through passage buildings use `GEO.passages` (carve `pts` ± `w/2 + 0.3` below
`minY` out of the footprint walls, or add an opening at each portal); then set `ctx.passageArches = true` before
`buildRoadGeometry` so roads.js stops drawing its dark arch decals. **P (brussels-city.js):** please add `rd.colliders`
(bollards + portal walls, SPEC format) to `city.colliders`: `const colliders = [...bld.colliders, ...(det.colliders || []), ...(rd.colliders || [])];`.
**L / lead:** dropped roads are simply absent from `GEO.roads` (indices shift — never cache road ids across rebakes).
Un-tunnelled roads now join the drive graph at grade. Teleports unchanged and still on roads (test 10).

## Round 2 — C — Car feel + drivable bus (`js/controllers.js`, `js/cameras.js`, `js/touch-controls.js`, `js/gamepad-controls.js`, `tests/sandbox-vehicles.html`, `tools/diag/drive-harness.mjs`)

### Drivable bus (contract for B)
- New player mode **`'bus'`** (appended: `PLAYER_MODES = ['person','car','ride','cyclist','helicopter','boat','bus']`,
  `MODE_INFO.bus = { label: 'Brussels Bus', topSpeedMph: 34, hints }`). Entity = `controllerManager.entities.bus`:
  `type: 'car'` (cameras/traffic treat it like a car), `mode: 'bus'`, `isBus: true`, same `{position, heading, speed, vx, vz,
  halfExtents {hx: 1.26, hz: 5.6}, bodyHeight: 4.4, mass: 12500}`; model = `VEHICLE_FACTORIES.doubleDecker` (11.2 m,
  wheelbase 5.9 m). Handling (`HANDLING.bus`): top 12.5 m/s (28 mph), Shift 14.5 m/s (32 mph), 0–20 mph ≈ 5.5 s, slow
  turn-in, ~10 m turning radius, Space = parking brake (no slides). Chase camera 14.5 m back / 5.2 m up; POV sits in
  the right-hand cab (shell hidden, a simple cab interior with a turning steering wheel shown instead).
- `controllerManager.setBusLivery({ route, destination })` — swaps the destination blind (front/side/rear) of the
  drivable bus; `entities.bus.route` / `.destination` reflect it.
- `controllerManager.setBusDoors(open)` — opens/closes both nearside doors (0.9 s animation, `entities.bus.doorOpen`
  0..1); `entities.bus.doorsOpen` is the flag. While the doors are open the bus **won't drive off** (throttle ignored,
  brake held; set `entities.bus.doorInterlock = false` to disable) and, once stopped, it **kneels** towards the kerb
  (`entities.bus.kneel` 0..1). Door positions for boarding logic: `entities.bus.spec.doors.front/middle {z0, z1, side: +1}`
  (model-local metres, +x = nearside, +z = forward).
- Spawn: placed 24 m behind the cab spawn; `spawns: { bus: {x, z, heading} }` overrides; `setMode('bus', {placeNear:true})`.

### Car feel (what changed)
- **Fixed-step physics**: `update(dt)` runs `ceil(dt / PHYS_STEP)` equal substeps (`PHYS_STEP = 1/120`) for the driven
  mode, so handling/collisions are identical at 30/60/120 fps (path deviation vs 120 fps: 0.000 m at 30 & 60 fps,
  0.04 m at 144 fps; was 0.79 / 0.32 / 0.02 m). Collision events are reported once per frame (hardest hit per kind).
- **Driver inputs eased** (keys are binary): throttle/brake pedals travel in ~0.2 s; the wheel slews to lock (5.5 lock/s
  parked → 3.2 at 25 m/s) and self-centres (6 + 0.12·v lock/s); lock is speed-limited so full steer corners at about
  `aLat` (0.9 g car, 0.39 g bus); the body takes up the bicycle-model yaw rate with a lag (`yawTau` 0.11 s car, 0.26 s
  bus) and a soft grip limit (no hard yaw clamp). Handbrake grip comes back over ~0.4 s (no snap out of a slide).
  Tunables: `HANDLING.{car,ride,bus}` (exported), copied onto each entity.
- **Walls**: the into-wall velocity is removed (hard hits keep < 1.2 m/s of rebound), the along-wall part scrapes with
  friction, glancing hits turn the car to run along the wall; < 1.5 m/s knocks don't spin it. Embankments use the same
  response (no more `-0.2 × speed` bounce). Fixed: after stopping at an embankment a turn could swing a corner over
  the water and the "already stuck" escape let the car drive across the river (now it may never go further in).
- **Body**: pitch/roll springs now have the right signs (nose up under power, dips under braking, rolls to the
  *outside* of a turn — it used to lean into turns and squat on braking), driven by drive force and v·yawRate instead of
  a per-frame finite difference (that was noisy). Peak roll ≈ 2.2° car / 1.8° bus, pitch ≈ 2.4°.
- **Kerbs**: optional `controllerManager.setSurfaceHeight(city.surfaceHeight)`: car wheels ride up the 12 cm
  pavement individually (eased 35 ms, the body follows on its springs — no jolt); pedestrian and bike step up onto it.
- **Chase camera** (`cameras.js`): yaw follows on a critically damped spring (lag 0.2 s car, 0.4 s bus/boat), leaning a
  little towards the direction of travel when sliding; position stays locked to the vehicle (no surging); FOV widens
  56° → 65° with speed; the boom **pulls in in front of colliders** (instantly, eases back out, rises over the roof when
  tight) — `cameraSystem` uses `controllerManager.nearColliders`. POV glances slightly into turns.
  `cameras.js` calls `controllerManager.setPovView(bool)` each frame (the bus swaps its shell for a cab interior).

### Measured (tools/diag/drive-harness.mjs feel car — before → after)
| metric | before | after |
|---|---|---|
| heading change per 0.1 s tap of A at 38 mph | 6.9° | 0.7° |
| yaw rise time 10→90 % (step steer) | 0.07 s | 0.33 s |
| peak yaw acceleration, slalom | 10.3 rad/s² | 2.2 rad/s² |
| chase view yaw accel (rms) / peak view yaw rate | 2.04 rad/s² / 1.69 rad/s | 0.69 / 0.65 |
| 90° wall hit at 15 m/s: rebound speed / bounce distance | −10.5 m/s / 4.4 m | −1.2 m/s / 0.07 m |
| 30° wall hit: speed kept along the wall after 0.5 s | 50 % | 72 % |
| 3 m/s nudge at 45°: heading change | 13° | 4.9° (only while W held into the wall) |
| camera inside the wall while reversing against it | 126/126 frames | 0 |
| braking from 30 mph | 1.08 s, 6.9 m (1.3 g) | 1.38 s, 9.5 m |
| 0–30 mph / top / boost 0–60 mph | 2.6 s / 17.6 m/s / never (56 mph max) | 2.4 s / 20 m/s / 4.5 s (65 mph) |
| path deviation vs 120 fps: 30 / 60 / 144 fps | 0.79 / 0.32 / 0.02 m | 0 / 0 / 0.04 m |
Bus: 0–20 mph 5.5 s, top 28 mph (32 boost), 30→0 mph 2.5 s / 16.6 m, radius 11.7 m at walking pace, peak yaw accel 0.36 rad/s².

### main.js changes for the lead (Round 2 — C)
1. After the city is built: `controllerManager.setSurfaceHeight(city.surfaceHeight);` (kerbs; optional but nicer).
2. Bus mode: add a mode button `data-mode="bus"` ("Bus", in index.html) — `PLAYER_MODES`/`MODE_INFO` already include it, so
   hints, top speed, the gamepad mode cycle and `selectMode('bus')` work unchanged. Suggested key: **7** is a camera, so
   use the button + gamepad cycle, or a free key such as **N**. Bus doors (B's job will drive them): suggested key **O**
   → `controllerManager.setBusDoors(!controllerManager.entities.bus.doorsOpen)` (only in bus mode).
3. Nothing else: `controllerManager.update(dt, elapsed)` / `cameraSystem.update(dt, elapsed)` unchanged (the 0.05 s dt clamp
   is fine: that's 6 substeps).
- For L (traffic.js `collidePlayer`): entities now carry `mass` (cab 1900, ride 1600, bus 12500 kg); a car hitting the
  player bus should barely move it (e.g. `share = v.bus ? 1 : entity.mass > 5000 ? 0.15 : 0.85`).
- Sandbox: `tests/sandbox-vehicles.html?mode=bus`, `?drive=slalom|wall|reverse` (scripted inputs, `__sb.trace`),
  `?webgl&noshadow&autotest` now runs 21 drives (5 bus: forward, building stop, turn, doors-open interlock + livery,
  pull away). Harness: `node tools/diag/drive-harness.mjs feel [car|ride|bus] [--json]`, `CTRL=<old controllers.js>
  CAM=<old cameras.js>` to compare (also `CTRL=` for the city modes).

## Round 2 — P — Visual polish (`js/city/buildings.js`, `js/city/materials*.js`, `js/city/ground.js`, `js/brussels-city.js`, `js/street-details.js`, `js/tsl-materials.js`, `js/landmarks/common.js`, `js/lighting.js`, `js/post-processing.js`, `tests/sandbox-city.html`)

No API changes for main.js — everything is inside the existing materials / builders. What changed:
- **Facades** (`createBrusselsBuildingMaterial`): 3D interior-mapped rooms behind every upper window (NY's
  `evaluateApartmentInterior`, now exported from tsl-materials.js), net curtains, window reveals (head / jamb shade +
  derivative bump), stone sills, gauged red-brick arches on stock brick / lintels on red brick / architraves on stone &
  stucco, plinth course, rusticated Portland ground floors, rain streaks, street reflection (buildings across the road)
  in low panes. **Shop fronts** span 1–3 bays with pilasters, stall riser, transom, glazing bars, a door, a painted
  fascia with lettering and a lit interior with shelves of goods in parallax. Residential doors are panelled under a
  fanlight; **stucco** (Belgravia / Pimlico) gets columned porches with a balcony and a whiter, repainted palette.
  Night: warm street-light wash on the lower storeys. `aoNode` = street-canyon sky occlusion.
- **Glass towers**: interior-mapped offices, pillowed panes, reflected neighbour towers with window grids, louvred
  plant floors, vertical fins on some towers, per-building spandrel / storey variants.
- **Roofs**: darker felt / gravel (they read as snow from the air), membrane strips, stains, skylights; mossy / per
  building slate; more rooftop clutter (stair housings, tanks, AC units on roofs > 90 m²).
- **Ground**: new street-frontage mask texture (`buildStreetMask` in ground.js, 4 m grid): the base ground along streets
  is paved (flags / tarmac patches) instead of the olive yard mix that showed between pavements and facades.
  Pavements toned down (×0.72) with stains, gum spots, edge grime. **Asphalt** lifted to worn mid-grey with sealed
  cracks and utility covers. **Thames**: ripple normal now lights the water (sun glints / sky sheen), current streaks.
- **Passages** (R's `GEO.passages`): buildings cut real openings (walls crossing a passage box start at `minY`) and
  line the passage (side walls + soffit); `ctx.passageArches = true` is set so roads.js skips its decals.
  Building colliders are unchanged (`pushBuildingColliders` already drops cells over carriageways; pedestrian
  passages stay blocked for walkers). `city.colliders` now also includes `rd.colliders` (R's bollards / portals).
- **Street furniture**: bus shelter panes are a separate see-through instanced mesh (`BusShelterGlass`, +1 draw).
- **Landmarks** (`common.js`): stone gets soiling patches, soot / rain streaks and shade under string courses;
  slate / lead / stone `plainMaterial`s weather in patches (gilt / metal untouched).
- **Lighting / grade**: golden-hour sun moved to az 264° el 13° (was 272°/14°, straight behind Elizabeth Tower in the
  Westminster scenic cam) with a tighter Mie glare; golden bloom 0.16 / threshold 1.6, exposure 0.98; bloom input peak
  clamp 8 → 5 (the sun disc no longer floods the frame).
- **Stucco quarters**: untagged stock-brick / concrete houses, terraces, flats, offices & `other` under 30 m inside
  rough ellipses round Belgravia, Pimlico, Hans Town and South Kensington become `stucco_white` (85 %), with sash /
  georgian windows (buildings.js `STUCCO_AREAS`); clay roofs only on buildings < 400 m².
- Midday sun 6.4 → 5.3 (sunlit roofs & pavements burnt to white).
- **Cost** (whole city, `tests/city-build-check.mjs`): buildings 2.52 M → 2.73 M triangles (+8 %, rooftop clutter +
  passage linings), +1 instanced draw (BusShelterGlass, 1.5 k instances), 696 → 701 meshes (the rest is R's roads),
  +5 k colliders from `rd.colliders`. Street mask bake ≈ 0.4–1 s CPU (inside the `waterSDF` timing). Shader cost per
  facade pixel goes up (interior mapping, as NY does on every facade).
- Sandbox: `tests/sandbox-city.html` gains `&post` (game colour grade + bloom), `&landmarks`, `&weather=`,
  `&pos=x,y,z&look=x,y,z` (exact camera, e.g. Westminster scenic `pos=505,11,800&look=236,55,790`).

## Round 2 — L — Life & audio (`js/life/*.js`, `js/audio/*.js`, `js/traffic.js`, `js/traffic-sim.js`, `js/pedestrians.js`, `js/road-network.js`, `tests/sandbox-life.html`)

Sandbox: `tests/sandbox-life.html?webgl&scene=river|pigeons|sky|street` (`&gather` all boats in view, `&focus=clipper|
tourist|barge|rib|bus|cab` chase one, `&scatter=s` walk into the Trafalgar pigeons, `&traffic` road traffic, `&night`,
`&cam=x,y,z&at=x,y,z`, `&audiotest` runs the real WebAudio graph and logs RMS/levels — headless needs
`--autoplay-policy=no-user-gesture-required`). Tests: `node --test tests/audio.test.mjs` (fake AudioContext, <1 s),
`node --test tests/life.test.mjs` (river / boats / pigeons / aircraft / real bus routes / pedestrian life / gestures,
≈20 s), plus the existing `tests/traffic-sim.test.mjs tests/traffic-player.test.mjs` (still green).

### main.js (lead) — exact steps
```js
import { createBrusselsLife } from './life/brussels-life.js';
import { createBrusselsAudio } from './audio/brussels-audio.js';
import { VEHICLE_UNIFORMS } from './brussels-vehicles.js';
import { BRUSSELS_LANDMARKS } from './brussels-config.js';   // (already imports WORLD etc. from there)

// 1. right after `const cameraSystem = new CameraSystem(...)` — i.e. BEFORE the scene.traverse() that swaps instanced
//    matrices to storage attributes and before precompileShaders(), so the boats / pigeons / planes compile up front:
const life = createBrusselsLife(scene, { world: WORLD, surfaceHeight: city.surfaceHeight });
life.onBoatHit = (e) => controllerManager._emitCollision && controllerManager._emitCollision(controllerManager.getActiveEntity(), e.impulse, 'boat');
const audio = createBrusselsAudio({
  controllers: controllerManager, traffic: trafficSystem, life, lighting: lightingSystem, world: WORLD, geo: GEO,
  landmarks: BRUSSELS_LANDMARKS, cameraSystem, night: () => VEHICLE_UNIFORMS.night.value
  // optional: keys: { horn: 'KeyG', mute: 'KeyK' } (or keys: false), button: false, buttonParent: el, ctxFactory
});
// 2. in the animation loop, after trafficSystem.update(...):
life.update(dt, { camera: cameraSystem.camera, entity: controllerManager.getActiveEntity(), mode: controllerManager.activeMode,
                  peds: trafficSystem.peds, night: VEHICLE_UNIFORMS.night.value });
audio.update(dt, cameraSystem.camera);
// 3. (optional) window.__bxl.life = life; window.__bxl.audio = audio;  hint rows: [['G'], 'Horn'], [['K'], 'Sound on/off']
```
Nothing else is needed: audio starts on the first pointer/key/touch (browser rule), suspends while the tab is hidden
or muted, remembers mute/volume in localStorage (`brusselsloop_audio_*`), and injects a speaker button (`#btn-sound`,
`.tool-btn icon-only`) into `#hud-toolbar` before the hide-HUD button (`button: false` to skip, `buttonParent` to place
it). Weather comes from `lighting.onWeatherChange`/`.weather`; collisions from `controllers.addCollisionListener`;
the bus doors / kneel of C's drivable bus are heard by watching `entities.bus.doorsOpen` / `.kneel` (no hook needed).
Tested in a copy of main.js with exactly these lines (`?webgl&lite&offline` boot).

**Keys proposed** (lead decides): **G** horn (hold; bike bell / ship's horn / taxi whistle on foot), **K** sound on/off.
(C suggested N for bus mode and O for bus doors, so I avoided those.)

### Audio API (`js/audio/brussels-audio.js`) — for B (bus driver), D (RideBXL) and anyone
`audio.play(name, { x, z, gain })` → one-shot cue, placed in the world when x/z are given: `busBell` (stop requested
ding), `busDoorsOpen`, `busDoorsClose` (pneumatic + thunk + two beeps), `kneel`, `airBrake`, `notify` (phone: job
offer), `coin` (fare paid), `cancel`, `bikeBell`, `whistle`, `click`, `horn` (`{duration}`), `shipHorn`.
`audio.horn(bool)`, `audio.setMuted(bool)`, `audio.toggleMute()`, `audio.setVolume(0..1)`, `audio.chime(quarter 1–4,
hour)` (ring Big Ben now), `audio.unlock()`, `audio.ready`, `audio.levels` (last mix levels, debug), `audio.stats`.
What plays: per-mode engines from speed/throttle (black cab: 4-cyl diesel with clatter + 5-speed autobox; RideBXL:
hybrid whine, petrol fades in above ~20 mph; bus: 6-cyl diesel, turbo whistle, air-brake hiss on stopping; bike: tyre
hum, wind, freewheel ticks when coasting; helicopter: rotor thump at the blade rate with a Doppler-ish pitch / slap
from speed & climb + turbine; boat: diesel + wash + hull slaps; on foot: footsteps, splashy in the rain), tyre squeal
from the cab's sideways slip / handbrake / lock-ups, collision thuds (+ crunch above 4.5 m/s), city hum (from nearby
traffic), pass-bys of the 4 nearest traffic vehicles (panned, Doppler, gear-saw pitch), crowd babble (pavement crowd
+ landmarks), birds in parks by day (robins at night), gulls + lapping near the Thames, rain + drips in drizzle, wind
aloft, distant UK sirens every 1–3 min (two-tone / wail / yelp, sometimes one passes close), river boats (nearest one)
and their horns leaving piers, airliners overhead, the odd helicopter, pigeons cooing / taking off, and **Big Ben**:
the Westminster Quarters at :15 :30 :45 and the hour strikes on the hour in real Brussels time (Intl, Europe/Brussels —
BST/GMT right), delayed by distance / 343 m/s and low-passed with distance, audible across Zone 1. The cab POV muffles
the city (cabin low-pass). Synthesised only: oscillators + ~9 s of generated noise; no files.

### Life (`js/life/brussels-life.js`)
`createBrusselsLife(scene, { world, surfaceHeight, river, sky, pigeons, planeInterval })` → `{ group 'BrusselsLife', update,
boats, aircraft, helicopters, events, nearestFlock(x, z), getDynamicColliders(x, z, r), onBoatHit, stats, river, sky, pigeons }`.
- **Thames** (`river-traffic.js`, `river-path.js`): 15 boats — 5 catamaran river buses (~10 m/s), 5 sightseeing boats
  (C's `riverBoat`, per-instance hull colours), 2 tugs pushing lighter barges, 3 RIBs (bouncing) — both ways on a
  fairway extracted from the water raster (10.4 km, Chelsea → the Pool), keeping to starboard and relaxed into the
  navigation arch of every bridge (never through a pier), calling at 11 real piers (dwell 25–80 s, horn on leaving),
  following each other, foamy wakes (one additive instanced mesh, 520 puffs). They slow, stop and swerve for the
  player's boat and push it out (SAT) if it rams them (`onBoatHit` → a collision for RideBXL/audio).
  `life.getDynamicColliders()` gives them as SPEC colliders if the lead prefers that.
- **Sky** (`sky.js`): airliners on the Heathrow approach (westerly ops, 3° glide path ~1 km up over Westminster, one
  every ~90 s, rarer at night) with nav lights, strobes, beacon, landing lights; a helicopter crosses every 2.5–5 min.
- **Pigeons** (`pigeons.js`): flocks on Trafalgar Sq (46), Leicester Sq, Covent Garden piazza, St Paul's, Parliament
  Sq, Piccadilly Circus, Leadenhall — peck about, hop out of pedestrians' way, burst up when the player comes close
  (walking, cycling or driving/flying at them), wheel round and land again. 2 instanced draws for all of them.

### Traffic & people (G files, now L)
- **Real bus routes** (B's `data/bxl-bus-routes.json`, loaded async; the 4 old variants until it arrives): a bus
  spawned on a lane a route runs along takes its number + destination and **follows the route** (links planned with
  `network.route()` ~900 m at a time, ~3 ms each, re-planned as it goes); elsewhere it shows a route passing nearby.
  All buses are **one** model now: the blinds come from a 40-slot atlas with a per-instance `aBlind` attribute (was 4
  variants × 5 draws). `trafficSystem.cars[i].route` / `.destination` / `.linkPlan`; `trafficSystem.busPlanner.stats`.
- **Black cabs**: ~45 % show the amber TAXI sign lit (for hire), the rest are dark (carrying a fare) — two variants.
- **Fewer long holds at big junctions**: shorter signal cycles (`road-network.js`: green 17–21 s on 2-axis junctions,
  12–15 s on 3-axis gyratories, ped stage 6.5 s: ~50–60 s cycles instead of 70–90), zebra courtesy (people let a car
  through once it has waited 7 s), and when the player has been held ≥ 35 s, whatever is gridlocked (not queued at a
  red) in the 40 m ahead of the player clears off. Drive harness through Trafalgar / Parliament Sq / The Mall (8 routes,
  `PAIRS=…` in `tools/diag/drive-harness.mjs route`): longest wait behind traffic 19–90 s (avg 59) → 25–63 s (avg 44).
  Sim test: stuck > 60 s 3.3 % → 0.7 % of vehicle lives, mean speed 3.0 m/s (Trafalgar) / 3.5 (Hyde Park Corner).
- **Smoother acceleration**: throttle builds at a limited jerk (3.5 m/s³; pulling away from rest starts at ~0), braking
  unchanged. Indicators were already there (35 m before a turn). Contact fixes from the last round kept
  (`collidePlayer` only scrubs speed on > 1 m/s knocks; sim yields to the player's projected box; gridlock recycling);
  the player's 12.5 t bus is only pushed 15 % by a car (C's `mass`).
- **Pedestrians**: people queue at bus stops (facing the road, some on the phone) and board buses that dwell there;
  walk in twos and threes; tourists stop to photograph the landmark they're at (both hands up holding a phone, a
  friend pointing); ~8 % of walkers are on a call; street performers at Covent Garden piazza, the South Bank and
  Leicester Square draw a ring of onlookers who clap and cheer when the acrobat lands a jump. `PersonRig.gesture`
  ('photo' | 'phone' | 'clap' | 'wave' | 'cheer' | 'point') + `gestureW` (0..1) are new (pedestrians.js), and the crowd
  passes `p.air` (jump height).

### Cost
Draw calls (only what's in view; empty instanced meshes are hidden): Thames ≤ 6 (+3 shadow-casting) near the river,
pigeons 2, airliners 2, helicopter ~5 while one is up; traffic buses 5 instead of up to 20, cabs +4. CPU per frame:
life ≈ 0.1–0.4 ms (SwiftShader box, under load), audio ≈ 0.2 ms at its 30 Hz tick (real Chromium; <0.3 ms with a
fake context), pedestrian behaviours ≈ 0 (sim step 0.25 ms with 260 people in Node). Audio graph: ~190 live nodes.
### Game: `js/bus-driver.js`
```js
import { BusDriver } from './bus-driver.js';
const busDriver = new BusDriver({
  scene, camera: () => cameraSystem.camera, controllers: controllerManager, world: WORLD, geo: GEO, backend,
  ui: {
    setMode: (m) => selectMode(m),                         // REQUIRED: switches to 'bus' (or 'car' until C's bus lands)
    teleport: (x, z, h) => teleportTo(x, z, h),            // optional; else controllers.teleportActiveTo
    onRouteChange: (route, target) => mapSystem.setRoute(route, target), // [{x,z}] remaining route + {x,z,kind:'busstop',name,color:'#e3283e'}; ([], null) clears
    onPinsChange: (pins) => mapSystem.setPins(pins),       // optional: remaining stops [{x,z,kind:'busstop',label}]
    traffic: trafficSystem,                                // optional: red-light detection via signalStateAt(x,z)
    renderer,                                              // optional: on WebGPU passengers use pedestrians.js PersonRig/PersonCrowd; WebGL → simple instanced figures
    // people: 'simple' forces the simple figures (the PersonRig path could not be screenshot headless — WebGPU/SwiftShader crashes here)
    onShiftEnd: (result) => {}                             // optional
  }
});
// every frame, after controllerManager.update() (and after ridebxl.update):
busDriver.update(dt);
// a "Bus driver" button (e.g. next to the mode switcher / in the 'bus' mode hints) → busDriver.openPicker()
```
- Loads `data/bxl-bus-routes.json` itself (fetch relative to the module; ~270 KB, lazily at construction) — or pass `ui.routes`.
- **Keys (proposal):** **J** = route picker (open/close), **F** = bus doors open/close (only on shift, in the bus). While
  the picker is open it captures ↑/↓ (route), ←/→/Tab (direction), Enter (start), Esc/J (close) in the capture phase so the
  bus doesn't drive; the summary captures Enter/Esc. Mode hints for `'bus'`: `[['J'], 'Bus routes'], [['F'], 'Doors']`.
- **API:** `openPicker() / closePicker() / togglePicker()`, `startShift(ref, dir, {maxStops})`, `endShift()`, `toggleDoors()`,
  `getRoute()` → `[{x,z}]`, `getTarget()`, `getPins()`, `getState()`, `reportCollision(impulse)`, `ready()` (routes loaded),
  `phase` ('idle'|'driving'|'dwell'|'finishing'|'done'), `lastResult`, `dispose()`. `loadBusRoutes()`, `PathTrack` exported.
- **Hooks used on controllers (C):** `activeMode`, `getActiveEntity()` → `{position, heading, speed, model.userData.spec.doors}`,
  `entities.bus` (presence → mode `'bus'`; otherwise falls back to `'car'` — TODO remove once C lands the bus),
  `setBusLivery({route, destination})` on shift start, `setBusDoors(open)`, `addCollisionListener` (or `addEventListener('collision')`).
- **Gameplay:** start at the first stop inside the area; red chevron GPS ribbon on the kerb lane (next 520 m) + map route;
  yellow "BUS STOP" bay marking with a glow (red → amber in the bay → green when stopped < 2 mph) and a beam from afar;
  a generic stop flag (red BUS STOP header, stop letter, route-number tiles of every baked route serving that stop, name).
  Doors in the bay → people get off by the middle door and walk away, waiting people walk to the front door and board;
  close the doors and pull away. Timetable: 5.2 m/s + 18 s per stop (departing > 1 min early or > 3 min late = not on
  time; the prompt tells you to hold when early). Bell + "Stop requested" when someone aboard wants the next stop.
  Penalties (comfort points): harsh braking with passengers (> 5.2 m/s² for 0.3 s) 4, collision 6–15, speeding > 30 mph
  for 3 s 3, doors opened away from a stop 5, drove off with doors open 6, skipped stop with people waiting/requested
  6–12, closed doors on boarders 3 each, red light 8 (needs `ui.traffic`). Shift summary → `backend.finishBusShift()`.
- **DOM/CSS:** injected `<style id="bd-style">`, `.bd-` classes. Fixed: shift panel LEFT (`top:112px`, 272 px wide,
  `max-height: 100vh − 412px`; override `.bd-panel{top:…}` if the brand header is taller), idle launcher card at the same
  spot (only in the bus without a shift), chip top-centre, prompt bottom-centre (`bottom:150px`, above the mode switcher),
  toasts under the chip, picker and summary centred modals. Adds `body.bd-on-shift` while driving, which hides RideBXL's
  phone/handle. All hide with `body.hud-minimized`.
- **3D:** `BusRouteRibbon`, `BusStopBay` (mark + glow + beam), `BusStopFlag`, passengers (`BusPax_*` 8 InstancedMeshes, or
  2 PersonCrowd meshes). ≈ 12 draw calls, all `frustumCulled=false`; keep them out of scene-culling roots.

### Backend (`js/backend.js`, RideBXL API unchanged)
`backend.finishBusShift({ route, variant, from, to, stops_total, stops_served, passengers, distance_m, duration_s,
on_time_pct, comfort, penalties })` → `{ pay, shifts, passengers, earnings, on_time, rank }` (throws RpcError),
`backend.busLeaderboard(limit)` → `[{name, shifts, passengers, earnings, on_time}]`, `backend.recentBusShifts()`,
`computeBusPay(…)` (same formula as SQL). The offline mock (`brusselsloop_mock_db.busShifts/busStats`, seeded with 4 rival
bus drivers) applies the same validation.

### Supabase (migration `slop_brussels_002_buses`)
Tables `slop_bus_shifts` (one row per shift) and `slop_bus_stats` (per player totals), RLS on, no policies.
SECURITY DEFINER RPCs with `search_path = ''`, auth via `private.slop_auth`:
- `slop_bus_finish_shift(p_id, p_token, p_route, p_variant, p_from, p_to, p_stops_total, p_stops_served, p_passengers,
  p_distance_m, p_duration_s, p_on_time_pct, p_comfort, p_penalties)` → json `{pay, shifts, passengers, earnings, on_time, rank}`.
  Pay = max(0, min(150, £2.50 + £1.10/km + £0.35/passenger + £0.15/stop) × (0.6 + 0.25·on-time + 0.15·comfort) − £0.25 × min(penalties, 40)).
  Rejects: route not `^[A-Za-z0-9]{1,5}$`; stops_total ∉ 2–80; served ∉ 1–total; passengers > 15/stop or > 600;
  distance ∉ 300–30000 m; duration < distance/18 or < 5 s/stop or > 3 h; < 30 s since the last shift.
- `slop_bus_leaderboard(p_limit)` → `(name, shifts, passengers, earnings, on_time)` by earnings.
- `slop_bus_recent_shifts(p_id, p_token)` → last 20 shifts.

### Sandbox
`tests/sandbox-bus.html?webgl` (real map slice around route `?route=25&dir=0`, roads/pavements/extruded buildings, the
real double-decker model, WASD or P autopilot) · `?webgl&autotest` runs a 5-stop shift end-to-end (autopilot drives
between stops, doors, boarding/alighting, timetable hold, summary saved in the mock) and sets `document.title` to
`AUTOTEST PASS|FAIL`.
