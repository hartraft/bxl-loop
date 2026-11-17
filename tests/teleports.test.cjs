const assert = require('node:assert/strict');
const { readFileSync } = require('node:fs');
const { join } = require('node:path');
const test = require('node:test');

const read = (path) => readFileSync(join(__dirname, '..', path), 'utf8');
let TELEPORT_LOCATIONS;

test.before(async () => {
  ({ TELEPORT_LOCATIONS } = await import('../js/city-config.js'));
});

test('every Brussels travel destination has a matching UI entry', () => {
  const html = read('index.html');
  const buttons = [...html.matchAll(/data-teleport="([^"]+)"/g)].map((match) => match[1]);
  assert.deepEqual([...Object.keys(TELEPORT_LOCATIONS)].sort(), buttons.sort());
  assert.equal(new Set(buttons).size, buttons.length, 'travel destination IDs are unique');

  for (const [id, destination] of Object.entries(TELEPORT_LOCATIONS)) {
    assert.equal(destination.id, id);
    assert.ok(destination.name && destination.sub, id + ' has a useful name and street/subtitle');
    assert.ok(Number.isFinite(destination.x) && Number.isFinite(destination.z), id + ' has a resolved world position');
    assert.ok(Number.isFinite(destination.heading), id + ' has an arrival heading');
  }
});

test('travel menu contains Brussels destinations, not inherited London entries', () => {
  const html = read('index.html');
  for (const londonName of [
    'Big Ben', 'Tower Bridge', 'Buckingham Palace', 'Trafalgar Square',
    'Piccadilly Circus', 'Battersea', 'King&#x27;s Cross', 'Paddington',
    'Oxford Circus', 'Covent Garden', 'Camden', 'Borough Market', 'Soho',
    'Westminster', 'South Bank', 'Ludgate Hill', 'The Mall'
  ]) {
    assert.equal(html.includes(londonName), false, 'stale destination text: ' + londonName);
  }
  for (const brusselsName of ['Grand-Place', 'Manneken Pis', 'Mont des Arts', 'Palace of Justice', 'Cinquantenaire Park', 'Koekelberg Basilica']) {
    assert.ok(html.includes(brusselsName), 'missing Brussels destination: ' + brusselsName);
  }
});

test('the transport UI routes selected destinations through the shared teleport function', () => {
  const main = read('js/main.js');
  assert.match(main, /teleportButtons\.forEach/);
  assert.match(main, /const loc = TELEPORT_LOCATIONS\[key\]/);
  assert.match(main, /teleportTo\(loc\.x, loc\.z, loc\.heading\)/);
});
