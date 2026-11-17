// Brussels travel menu contract tests; deliberately avoid loading generated binary map assets.
const assert = require('node:assert/strict');
const { readFileSync } = require('node:fs');
const { join } = require('node:path');
const test = require('node:test');

const read = (path) => readFileSync(join(__dirname, '..', path), 'utf8');
const configuredIds = () => {
  const config = read('js/brussels-config.js');
  const start = config.indexOf('const teleports = [');
  const end = config.indexOf('\n];', start);
  assert.ok(start >= 0 && end > start, 'Brussels teleport configuration exists');
  return [...config.slice(start, end).matchAll(/^\\s*\\['([^']+)'/gm)].map((match) => match[1]);
};

test('every Brussels travel destination has a matching UI entry', () => {
  const html = read('index.html');
  const buttons = [...html.matchAll(/data-teleport="([^"]+)"/g)].map((match) => match[1]);
  assert.deepEqual(configuredIds().sort(), buttons.sort());
  assert.equal(new Set(buttons).size, buttons.length, 'travel destination IDs are unique');
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
  assert.match(main, /teleportButtons\\.forEach/);
  assert.match(main, /const loc = TELEPORT_LOCATIONS\\[key\\]/);
  assert.match(main, /teleportTo\\(loc\\.x, loc\\.z, loc\\.heading\\)/);
});
