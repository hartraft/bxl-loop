// End-to-end Node smoke test for generated Brussels assets and the runtime config/road graph.
import assert from 'node:assert/strict';

process.env.CITY = 'brussels';
globalThis.location = { search: '?city=brussels' };

const [{ GEO }, city, frame, roads] = await Promise.all([
  import('../js/ldn-geodata.js'),
  import('../js/city-config.js'),
  import('../js/geo-frame.js'),
  import('../js/road-network.js')
]);

assert.equal(frame.FRAME.lat0, 50.84673, 'runtime origin must be Grand-Place');
assert.equal(roads.TRAFFIC_SIDE, 'right', 'Brussels must use right-hand traffic');
assert.equal(city.GEO, GEO, 'map, traffic and world config must share one decoded data set');
assert.ok(GEO.roads.length > 40000, `expected central Brussels roads, got ${GEO.roads.length}`);
assert.ok(GEO.buildings.count > 100000, `expected Brussels building footprints, got ${GEO.buildings.count}`);
assert.ok(GEO.water.some((w) => w.kind === 'canal' && /Canal Charleroi|Kanaal Brussel-Charleroi/i.test(w.name)),
  'the Charleroi–Brussels canal must be in the water layer');
assert.ok(city.TELEPORT_LOCATIONS.grandPlace && city.TELEPORT_LOCATIONS.cinquantenaire);

const network = roads.buildRoadNetwork(GEO, city.WORLD);
assert.ok(network.stats.links > 10000, `expected connected road graph, got ${network.stats.links} links`);
const route = network.route(city.TELEPORT_LOCATIONS.grandPlace, city.TELEPORT_LOCATIONS.cinquantenaire);
assert.ok(route && route.length > 100, 'GPS routing should connect Grand-Place to Cinquantenaire');
console.log(JSON.stringify({
  status: 'ok',
  trafficSide: roads.TRAFFIC_SIDE,
  roads: GEO.roads.length,
  buildings: GEO.buildings.count,
  canalFeatures: GEO.water.filter((w) => w.kind === 'canal').length,
  links: network.stats.links,
  routeMetres: Math.round(route.length),
  routeSteps: route.steps.length
}, null, 2));
