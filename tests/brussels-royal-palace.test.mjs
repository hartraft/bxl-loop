import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import testCase from 'node:test';

const source = readFileSync(new URL('../js/brussels-landmarks.js', import.meta.url), 'utf8');
const start = source.indexOf("addLandmark('royalPalace'");
const end = source.indexOf("addLandmark('cathedral'", start);
assert.ok(start >= 0 && end > start, 'Royal Palace landmark builder must exist');
const palace = source.slice(start, end);

testCase('Royal Palace central façade details sit in front of its masonry wall', () => {
  const face = palace.match(/const centralFace = ([0-9.]+);/);
  assert.ok(face, 'central façade plane is explicitly defined');
  const centralWallFront = -1 + 22 / 2;
  assert.ok(Number(face[1]) > centralWallFront + 0.2,
    'central windows, arcade and columns must project beyond the central corps de logis wall');
  assert.match(palace, /Central ceremonial arcade recess/);
  assert.match(palace, /Palace central piano nobile window/);
  assert.match(palace, /Central avant-corps pilaster/);
});

testCase('Royal Palace central pavilion has a classical pediment and restrained roofline', () => {
  assert.match(palace, /Palace central triangular pediment/);
  assert.match(palace, /Palace shallow dome/);
  assert.match(palace, /Palace central roof pavilion/);
});
