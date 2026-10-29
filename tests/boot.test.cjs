const assert = require('node:assert/strict');
const { existsSync, readFileSync } = require('node:fs');
const { join, resolve, dirname } = require('node:path');
const test = require('node:test');

const root = resolve(__dirname, '..');
const html = readFileSync(join(root, 'index.html'), 'utf8');
const importMap = html.match(/<script type="importmap">([^]*?)<\\/script>/);
const preloads = [...html.matchAll(/<link rel="modulepreload" href="([^"]+)"\\s*\\/>/g)];
const entries = [...html.matchAll(/<script type="module" src="([^"]+)"><\\/script>/g)];

test('module preloads point to existing files and the entry is loaded after the import map', () => {
  assert.ok(importMap, 'import map exists');
  assert.ok(preloads.length > 0, 'runtime modules are preloaded');
  const stylesheetIndex = html.indexOf('rel="stylesheet"');
  for (const preload of preloads) {
    assert.ok(importMap.index < preload.index);
    assert.ok(preload.index < stylesheetIndex);
    assert.ok(existsSync(join(root, preload[1].replace(/^\\.\\//, ''))), 'missing preload: ' + preload[1]);
  }
  assert.equal(entries.length, 1);
  assert.equal(entries[0][1], './js/main.js');
  assert.ok(importMap.index < entries[0].index && entries[0].index < stylesheetIndex);
  assert.match(html, /<link rel="preconnect" href="https:\\/\\/cdn\\.jsdelivr\\.net" crossorigin\\s*\\/>/);
  const { imports } = JSON.parse(importMap[1]);
  assert.equal(imports.three, imports['three/webgpu']);
});

test('preloads contain no retired London geodata or broken legacy landmark module', () => {
  const links = preloads.map((match) => match[1]);
  assert.equal(new Set(links).size, links.length, 'each module is preloaded once');
  assert.ok(links.includes('./js/main.js'));
  assert.ok(!links.includes('./js/bxl-geodata.js'));
  assert.ok(!links.includes('./js/brussels-base-config.js'));
  assert.ok(!links.includes('./js/brussels-base-landmarks.js'));
});
