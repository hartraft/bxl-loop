# Brussels Loop

A GTA-style playable Brussels in the browser. The central Pentagon and surroundings are at true 1:1 scale, built from OpenStreetMap: the Grand-Place, the canal, the European Quarter, Koekelberg. It's a fork of mrdoob's [Slop New York](https://github.com/mrdoob/slop-newyork) (MIT), rebuilt for Brussels on three.js r186 (WebGPURenderer + TSL, vendored in `vendor/three/`).

## Play
**Online:** https://nelsonchris1.github.io/brussels-loop/ (Chrome, Edge or Safari 26+; the first load takes about 40 s).

**Locally:**
```bash
git clone https://github.com/Nelsonchris1/brussels-loop.git && cd brussels-loop
python3 -m http.server 8000
```
Then open http://localhost:8000 in Chrome, Edge or Safari 26+ (WebGPU).

URL flags:
- `?lite`: no screen-space reflections, for slower machines.
- `?webgl`: WebGL2 fallback.
- `?offline`: skip Supabase.
- `?tp=grandPlace`: start at a teleport spot (see the teleport menu).
- `?time=midnight`: time of day (golden / midday / twilight / midnight).
- `?weather=drizzle`: clear / overcast / drizzle / fog.

| Key | |
|---|---|
| 1–6 | Walk · Taxi · RideBXL car · Hire bike · Police helicopter · Canal boat |
| W A S D | move / steer · Shift boost · Space handbrake (cars) / jump / climb (heli) · Q/C descend |
| 7 8 9 / 0 / V | chase, action, cockpit (right-hand drive) / Grand-Place scenic cam / cycle cameras |
| M | Brussels Street Atlas: click to teleport, right-click to set a GPS route |
| R · Enter · X | RideBXL app · accept job · decline |
| N | drive a Brussels bus |
| F · O | Bus doors · bus route picker |
| G · K | horn · sound on/off |
| H / L | cab's TAXI light / helicopter searchlight |
| U | hide the HUD |

**RideBXL** is the Uber-style ride-hail mode under our own made-up brand:
1. Switch to the RideBXL car (3) and go online in the app.
2. Accept a job and follow the GPS route to the pickup pin.
3. Stop by the pin to pick the passenger up, then drop them off.

The fare and your rating go to the leaderboard.

**Bus driver**: press O (or the Bus driver button) and pick a Brussels route and a direction. Drive the route, pull into each stop's bay under 2 mph, open the doors with F, and close them once everyone's on. The shift is scored on passengers carried, timekeeping and comfort, and saved to Supabase (`slop_bus_shifts`).

## Supabase
Player profiles, saved position/mode/time/weather, finished rides and the leaderboard are stored in the **sim-brussels** Supabase project, in separate `slop_*` tables:
- `slop_players`
- `slop_rides`

Everything goes through RPCs (`slop_join`, `slop_load`, `slop_save`, `slop_finish_ride`, `slop_leaderboard`, …). Fares are computed on the server. The client is `js/backend.js` (plain fetch, publishable key). If Supabase can't be reached, the game falls back to a local offline mock and shows "Offline". A claude.ai artifact preview is always offline, because artifact pages can't call outside servers.

## Layout
- `js/main.js`: game shell (lead).
- `js/geo-frame.js`: world frame (Brussels). Origin is the Grand-Place; +x east, +z south; metres.
- `js/brx-geodata.js`, `js/brussels-world.js`, `js/brussels-config.js`: baked map data + world queries (ground height, bridges, water, nearest road).
- `js/brussels-city.js`, `js/city/*`, `js/street-details.js`, `js/trees.js`, `js/tsl-materials.js`: buildings, roads, the canal, bridges, parks, street furniture.
- `js/brussels-landmarks.js`: the Grand-Place, Manneken Pis, Mont des Arts, Royal Palace, St Michael and St Gudula Cathedral, Palace of Justice, Cinquantenaire, European Parliament, Koekelberg Basilica.
- `js/brussels-vehicles.js`, `js/controllers.js`: vehicles and player physics.
- `js/road-network.js`, `js/traffic-sim.js`, `js/traffic.js`, `js/road-paint.js`, `js/pedestrians.js`: right-hand traffic, signals, roundabouts and pedestrians.
- `js/brussels-map.js`, `js/lighting.js`, `js/post-processing.js`, `js/brussels-ui.js`: map, time/weather and HUD.
- `js/ridebxl.js`, `js/backend.js`: ride-hail game + Supabase.
- `tests/*.test.mjs` / `tests/*.test.cjs`: Node tests; `snapshot-*.html`: render snapshot pages used by CI.
- `SPEC.md` / `INTEGRATION.md`: the contracts each part was built against.
- `reference/`: the original Slop New York modules and tools, for reference.

## Rebuilding the map data
1. Download `greater-brussels-latest.osm.pbf` from Geofabrik.
2. Extract the play area:
   ```bash
   node tools/osm-pbf-extract.mjs <pbf> tools/data/osm_central.json
   ```
3. Bake the game data:
   ```bash
   node --max-old-space-size=12000 tools/build-brussels-geodata.mjs
   ```
   This writes `data/brussels-build/brx-geo.json` and `data/brussels-build/brx-buildings.bin`.

`tools/build-dist.sh` copies a trimmed static build into `dist/` for hosting.

Map data © OpenStreetMap contributors (ODbL).
