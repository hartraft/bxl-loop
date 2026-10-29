# Brussels Loop — build spec (shared by everyone working on the code)

This is a fork of mrdoob's Slop New York (MIT, `reference-tools/` and the NY modules in `js/` are the starting point).
The goal is a full playable Zone-1 Brussels at true 1:1 scale, built from OpenStreetMap, running in the browser on
three.js WebGPURenderer + TSL (r186, vendored in `vendor/three/`, no CDN).

## Golden rules
- **Own your files.** Each workstream below owns specific files. Don't edit files you don't own. If you need something
  from another workstream, code against the contract in this spec. `js/main.js`, `index.html` and `css/style.css`
  belong to the integrator (lead): **don't edit them** — instead put UI markup/CSS your module needs into your own
  module (create DOM in JS, inject a `<style>` block) and document what main.js must call in your section of
  `INTEGRATION.md` (append-only, one section per workstream).
- **1 unit = 1 m. Frame = `js/geo-frame.js`** (origin Nelson's Column, +x east, +z south, +y up). Use `toWorld(lat, lon)`.
- **Drive on the LEFT.** UK cars are right-hand drive. Roundabouts go clockwise.
- **No real brand marks.** No TfL roundel, no Uber/Santander/National Express logos, no Johnston font. Generic but
  unmistakably Brussels (red buses, black cabs, red phone boxes, pillar boxes, zebra crossings with Belisha beacons).
  The ride-hail mode is our own fictional app **"RideBXL"** (the user asked for "Uber" — ours is an Uber-style app, not branded Uber).
- **Performance:** target 60 fps on an M-series Mac in Chrome. Merge static geometry (`mergeGeometries`), use
  InstancedMesh for repeated props, keep draw calls low, tile big layers (~500 m tiles) so `scene-culling.js` works.
- **Testing in the container:** there's no GPU. Chromium runs WebGPU via SwiftShader and is slow; the full city will
  not render at speed. Build a small sandbox page for your module under `tests/sandbox-<name>.html` (importmap like
  `index.html`), serve the repo root (`python3 -m http.server` — a server is already running at
  http://localhost:8811/brussels-loop/), and screenshot with
  `python3 tools/shot.py "<url>?webgl" out.png <seconds>` (`?webgl` → WebGL2 backend, more reliable headless).
  Keep sandboxes small (one district / one model) so they render. `node --check` doesn't catch ESM errors; copy to
  `.mjs` and run `node --check`, or load the module in the sandbox and read console errors (shot.py prints them).
- No network from the container except GitHub. No npm. Write dependency-free code.

## Data: `tools/data/osm_central.json`
Overpass-like JSON extracted from the Geofabrik Greater Brussels PBF (2026-10-20) by `tools/osm-pbf-extract.mjs`:
`{ bbox, elements: [ {type:'node',id,lat,lon,tags}, {type:'way',id,tags,geometry:[{lat,lon}|null]}, {type:'relation',id,tags,members:[{type,ref,role}]} ] }`.
Every way touching the bbox is kept with full tags (null geometry entries = nodes outside the margin). 117k buildings
(55k with `building:levels`, 553 with `height`, 13k `building:part`), 104k highway ways, Thames as `natural=water` multipolygons.
It is 180 MB — only the geodata build reads it. The game reads the baked files below.

## Contract: the baked geodata (owner: Workstream A)
`js/bxl-geodata.js` — `export const GEO = await loadGeo();` (top-level await; fetches `data/*`). Shape:
```
GEO = {
  frame: FRAME, bounds: WORLD_BOUNDS,
  roads: [ { id, name, ref, kind, w, lanes, oneway, maxspeed, bridge, tunnel, layer, junction, pts } ],
     // kind: motorway|trunk|primary|secondary|tertiary|unclassified|residential|living_street|service|pedestrian|footway|cycleway|steps
     // w = carriageway width (m, estimated from lanes/kind when untagged), oneway: 1 forward, -1 reverse, 0 two-way
     // junction: 'roundabout' | '' ; pts: Float32Array [x0,z0,x1,z1,...] in world metres (clipped to bounds)
  buildings: { count, // struct-of-arrays, decoded from data/bxl-buildings.bin
     ringStart: Uint32Array(count+1), // index into xz/2 — building i's outer ring is points ringStart[i]..ringStart[i+1]-1
     xz: Float32Array,                // all ring points, CCW when seen from above (+y), not closed (first != last)
     height: Float32Array, minHeight: Float32Array, // metres; height from tags or levels*3.2+roof, else district default
     kind: Uint8Array,   // BUILDING_KINDS index (house, terrace, flats, office, retail, civic, church, station, industrial, glass_tower, other)
     material: Uint8Array, // MATERIALS index (brussels_stock_brick, red_brick, portland_stone, stucco_white, glass, concrete, sandstone)
     roof: Uint8Array,     // ROOFS index (flat, gabled, hipped, mansard, dome, spire)
     colour: Uint32Array,  // 0xRRGGBB from building:colour if tagged, else 0
     nameIdx: Int32Array,  // index into GEO.names or -1
     landmark: Uint8Array  // 1 if inside a landmark exclusion zone (city renderer must skip; landmark modules draw these)
  },
  water: [ { pts: Float32Array, holes: [Float32Array] , kind:'river'|'lake'|'dock'|'canal'|'fountain' } ], // Thames etc.
  parks: [ { kind:'park'|'garden'|'grass'|'pitch'|'wood'|'cemetery'|'square'|'playground', name, pts, holes } ],
  plazas: [ { name, pts } ],        // pedestrian areas / squares (Trafalgar Sq etc.)
  rail: [ { kind:'rail'|'light_rail'|'subway', bridge, tunnel, pts } ], // only surface + bridge track is drawn
  bridges: [ { name, pts, deckY } ],  // man_made=bridge outlines (Westminster, Waterloo, Tower Bridge…) with deck height
  stations: [ { name, x, z, kind:'tube'|'rail'|'dlr' } ],
  pois: [ { kind, name, x, z } ],    // pub, cafe, restaurant, theatre, museum, attraction, … (for labels, ride-hail stops)
  signals: Float32Array [x,z,...], busStops: Float32Array, crossings: [{x,z,kind:'zebra'|'signals'}], trees: Float32Array,
  districts: [ { name, x, z } ],     // Soho, Mayfair, Westminster, The City, Southwark, Covent Garden, … (place=* nodes)
  names: [ string ],
  landmarkZones: [ { id, pts } ]     // footprint polygons the landmark modules replace (see Workstream B)
}
```
Also `js/brussels-world.js` (owner A) — `createWorldQueries(GEO)` → `{ groundHeight(x,z,mode), isWater(x,z),
nearestRoad(x,z,{kinds}) -> {road, x, z, dist, heading}, streetName(x,z), districtAt(x,z), randomRoadPoint(rng,{kinds}) }`.
`groundHeight` returns bridge deck height on bridges (mode 'boat' returns water level -1.2 on water), 0 elsewhere.
`js/brussels-config.js` (owner A) replaces NY `city-config.js` for the game shell: `TELEPORT_LOCATIONS`, `BRUSSELS_LANDMARKS`,
`getLocationLabel(x,z)` (→ `{primary: street, secondary: district}`), `isTypingInField`, `WORLD_BOUNDS`.

## Workstreams and file ownership
| WS | Owner of | Summary |
|----|----------|---------|
| A Geodata | `tools/build-brussels-geodata.mjs`, `tools/geo-brussels-*.mjs`, `data/*`, `js/bxl-geodata.js`, `js/brussels-world.js`, `js/brussels-config.js` | OSM → baked compact data + world queries |
| B Landmarks | `js/brussels-landmarks.js`, `js/landmarks/*.js`, `tests/sandbox-landmarks.html` | Big Ben & Parliament, Brussels Eye (rotating), Tower Bridge (bascules), the Shard, St Paul's, the Gherkin, Buckingham Palace (+Victoria Memorial), Trafalgar Square (Nelson's Column, lions, fountains), Piccadilly Circus (curved LED screens, Eros), Battersea Power Station (4 chimneys) |
| C Vehicles & play | `js/brussels-vehicles.js` (models), `js/controllers.js`, `js/vehicle-lights.js`, `tests/sandbox-vehicles.html` | black cab (drive), RideBXL car (ride-hail), red double-decker bus, hire bike (cycle), police helicopter (fly), Thames river boat (new mode 5) — models also exported for traffic |
| D Ride-hail + Supabase | `js/ridebxl.js`, `js/backend.js`, `tests/sandbox-ridebxl.html` | RideBXL ride-hail game: phone app UI, job offers, pick-up/drop-off with GPS route, fare/rating, Supabase save/leaderboard |
| E Map, HUD look & weather | `js/brussels-map.js`, `js/lighting.js`, `js/post-processing.js`, `js/brussels-ui.js`, `tests/sandbox-map.html` | minimap + full "Brussels A–Z" map + teleport + GPS route drawing; Brussels street-name plates; weather (overcast, drizzle with rain, fog) |
| F City | `js/brussels-city.js`, `js/city/*.js`, `js/street-details.js`, `js/trees.js`, `js/tsl-materials.js`, `tests/sandbox-city.html` | buildings, roads/pavements/kerbs/markings, Thames + embankments, bridges, parks, rail, street furniture, colliders |
| G Traffic & people | `js/road-network.js`, `js/traffic.js`, `js/road-paint.js`, `js/pedestrians.js`, `tests/sandbox-traffic.html` | left-hand road graph, traffic incl. buses & cabs, signals, roundabouts, pedestrians |
| Lead | `js/main.js`, `index.html`, `css/style.css`, `js/scene-culling.js`, `js/cameras.js` | integration, cameras, final QA |

## Colliders (shared format, unchanged from NY)
`{ minX, maxX, minZ, maxZ, maxY, obb?: { cx, cz, hx, hz, cs, sn } }` — AABB, optionally with an oriented box
(cs/sn = cos/sin of its rotation). Brussels buildings: one OBB per building (min-area rectangle of the footprint);
split big concave footprints into a few OBBs. `controllers.js` consumes these.

## Supabase (already provisioned — owner D uses it)
Project `huorgiwdzlqpnyzmfmoi` (shared with another game; our tables are `slop_*`). URL
`https://huorgiwdzlqpnyzmfmoi.supabase.co`, publishable key `sb_publishable_02C3aAYazBjZDsZxRgcPAQ_tjZjNOSx`.
Call RPCs with plain `fetch` (POST `/rest/v1/rpc/<fn>`, headers `apikey` + `Content-Type: application/json`).
No supabase-js. RPCs (all args named `p_*`):
- `slop_join(p_name)` → `{id, token, name}` (store in localStorage `brusselsloop_player`)
- `slop_load(p_id, p_token)` → `{id, name, state, ride_count, ride_earnings, distance_m, rating}`
- `slop_save(p_id, p_token, p_state jsonb ≤4 KB, p_distance_m)` → void
- `slop_rename(p_id, p_token, p_name)` → name
- `slop_finish_ride(p_id, p_token, p_pickup, p_dropoff, p_distance_m, p_duration_s, p_rating 1-5)` → `{fare, ride_count, ride_earnings, rating}`
  (server computes the fare: £3 + £1.60/km + £0.25/min, × rating factor; rejects < 15 s apart, < 100 m, faster than 45 m/s)
- `slop_leaderboard(p_limit)` → `[{name, rides, earnings, rating}]`
- `slop_recent_rides(p_id, p_token)` → last 20 rides
The container can't reach supabase.co: build a mock backend (`?offline` or when fetch fails) and keep the game fully
playable offline.
