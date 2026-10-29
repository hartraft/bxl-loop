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
const start = city.TELEPORT_LOCATIONS.grandPlace, finish = city.TELEPORT_LOCATIONS.cinquantenaire;
const startLane = network.nearestLane(start.x, start.z, { maxDist: 150 });
const finishLane = network.nearestLane(finish.x, finish.z, { maxDist: 150 });
const route = network.route(start, finish, { heading: start.heading });
let reachableLinks = 0, goalReachable = false, reverseGoalReachable = false;
if (startLane) {
  const seen = new Set([startLane.lane.link]), stack = [startLane.lane.link];
  while (stack.length) {
    const link = stack.pop();
    reachableLinks++;
    if (link === finishLane?.lane.link) goalReachable = true;
    if (link === finishLane?.lane.link?.reverse) reverseGoalReachable = true;
    for (const next of link.succ || []) if (!seen.has(next)) { seen.add(next); stack.push(next); }
  }
}
if (!route) console.error(JSON.stringify({
  stats: network.stats, start, finish,
  startLane: startLane && { x: startLane.x, z: startLane.z, road: startLane.lane.link.name, succ: startLane.lane.link.succ.length },
  finishLane: finishLane && { x: finishLane.x, z: finishLane.z, road: finishLane.lane.link.name, reverse: !!finishLane.lane.link.reverse },
  reachableLinks, goalReachable, reverseGoalReachable
}, null, 2));
assert.ok(startLane && finishLane, 'GPS should find drivable lanes near Grand-Place and Cinquantenaire');
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
