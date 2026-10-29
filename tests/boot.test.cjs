const assert = require('node:assert/strict');
const { existsSync, readFileSync } = require('node:fs');
const { join, resolve } = require('node:path');
const test = require('node:test');

const root = resolve(__dirname, '..');
const html = readFileSync(join(root, 'index.html'), 'utf8');
const importStart = html.indexOf('<script type="importmap">');
const importOpenEnd = html.indexOf('>', importStart);
const importClose = html.indexOf('</script>', importOpenEnd);
const importMapText = importOpenEnd >= 0 && importClose >= 0 ? html.slice(importOpenEnd + 1, importClose) : '';
const preloads = html.split('\n').filter((line) => line.includes('rel="modulepreload"')).map((line) => line.match(/href="([^"]+)"/)?.[1]).filter(Boolean);
const entries = html.split('\n').filter((line) => line.includes('<script type="module" src=')).map((line) => line.match(/src="([^"]+)"/)?.[1]).filter(Boolean);

test('module preloads point to existing files and the entry follows the import map', () => {
  assert.ok(importStart >= 0, 'import map exists');
  assert.ok(importMapText, 'import map has contents');
  assert.ok(preloads.length > 0, 'runtime modules are preloaded');
  const stylesheetIndex = html.indexOf('rel="stylesheet"');
  for (const preload of preloads) {
    const index = html.indexOf('href="' + preload + '"');
    assert.ok(importStart < index && index < stylesheetIndex);
    assert.ok(existsSync(join(root, preload.replace(/^\.\//, ''))), 'missing preload: ' + preload);
  }
  assert.deepEqual(entries, ['./js/main.js']);
  assert.ok(html.indexOf('<script type="module" src="./js/main.js">') < stylesheetIndex);
  assert.ok(html.indexOf('<script type="module" src="./js/main.js">') > importStart);
  assert.ok(html.includes('https://cdn.jsdelivr.net'));
  const { imports } = JSON.parse(importMapText);
  assert.equal(imports.three, imports['three/webgpu']);
});

test('preloads exclude retired geodata and the broken legacy landmark implementation', () => {
  assert.equal(new Set(preloads).size, preloads.length, 'each module is preloaded once');
  assert.ok(preloads.includes('./js/main.js'));
  assert.ok(!preloads.includes('./js/bxl-geodata.js'));
  assert.ok(!preloads.includes('./js/brussels-base-config.js'));
  assert.ok(!preloads.includes('./js/brussels-base-landmarks.js'));
});
