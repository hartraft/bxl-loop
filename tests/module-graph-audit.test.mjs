// Static audit of the browser entry point's relative module graph and named imports.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('../', import.meta.url));
const entry = path.join(root, 'js/main.js');
const read = (file) => fs.readFileSync(file, 'utf8');
const relativeTarget = (from, specifier) => path.resolve(path.dirname(from), specifier);
const sourceFiles = new Set();

function relativeImports(source) {
  const found = [];
  const staticImport = /^[ \t]*import[ \t]+([\s\S]*?)\s+from\s*['"]([^'"]+)['"]\s*;?/gm;
  for (const match of source.matchAll(staticImport)) {
    if (match[2].startsWith('.')) found.push({ specifier: match[2], clause: match[1] || '' });
  }
  const dynamicImport = /\bimport\s*\(\s*['"]([^'"]+)['"]\s*\)/g;
  for (const match of source.matchAll(dynamicImport)) {
    if (match[1].startsWith('.')) found.push({ specifier: match[1], clause: '' });
  }
  return found;
}

function parseNames(clause) {
  const open = clause.indexOf('{'), close = clause.indexOf('}');
  if (open < 0 || close < open) return [];
  return clause.slice(open + 1, close).split(',').map((part) => part.trim().replace(/^type\s+/, ''))
    .filter(Boolean).map((part) => part.split(/\s+as\s+/)[0].trim()).filter((name) => name !== 'type');
}

const exportCache = new Map();
function exportedNames(file, stack = new Set()) {
  if (exportCache.has(file)) return exportCache.get(file);
  if (stack.has(file)) return new Set();
  stack.add(file);
  const source = read(file);
  const names = new Set();
  for (const m of source.matchAll(/^[ \t]*export\s+(?:async\s+)?(?:function|class|const|let|var)\s+([A-Za-z_$][\w$]*)/gm)) names.add(m[1]);
  for (const m of source.matchAll(/^[ \t]*export\s*\{([^}]+)\}(?:\s*from\s*['"]([^'"]+)['"])?/gm)) {
    const target = m[2] && m[2].startsWith('.') ? relativeTarget(file, m[2]) : null;
    for (const item of m[1].split(',')) {
      const bits = item.trim().split(/\s+as\s+/);
      if (!bits[0]) continue;
      if (target) {
        const sourceName = bits[0].replace(/^type\s+/, '');
        assert.ok(exportedNames(target, new Set(stack)).has(sourceName), path.relative(root, file) + ' re-exports missing ' + sourceName + ' from ' + m[2]);
      }
      names.add((bits[1] || bits[0]).trim());
    }
  }
  for (const m of source.matchAll(/^[ \t]*export\s+\*\s+from\s*['"]([^'"]+)['"]/gm)) {
    if (m[1].startsWith('.')) for (const name of exportedNames(relativeTarget(file, m[1]), new Set(stack))) names.add(name);
  }
  stack.delete(file);
  exportCache.set(file, names);
  return names;
}

function visit(file) {
  if (sourceFiles.has(file)) return;
  assert.ok(fs.existsSync(file), 'missing module: ' + path.relative(root, file));
  sourceFiles.add(file);
  const source = read(file);
  for (const { specifier, clause } of relativeImports(source)) {
    const target = relativeTarget(file, specifier);
    assert.ok(fs.existsSync(target), path.relative(root, file) + ' imports missing file ' + specifier);
    if (clause.includes('{')) {
      const targetExports = exportedNames(target);
      for (const name of parseNames(clause)) {
        assert.ok(targetExports.has(name), path.relative(root, file) + ' imports missing named export ' + name + ' from ' + specifier);
      }
    }
    visit(target);
  }
}

function collectJavaScriptFiles(directory) {
  const files = [];
  for (const item of fs.readdirSync(directory, { withFileTypes: true })) {
    const full = path.join(directory, item.name);
    if (item.isDirectory()) files.push(...collectJavaScriptFiles(full));
    else if (item.isFile() && /\.m?js$/.test(item.name)) files.push(full);
  }
  return files;
}

test('JavaScript module graph has no missing relative files or named exports', () => {
  for (const file of collectJavaScriptFiles(path.join(root, 'js'))) visit(file);
  assert.ok(sourceFiles.size > 40, 'audit scanned the source tree (visited ' + sourceFiles.size + ' files)');
  console.log('Audited ' + sourceFiles.size + ' JavaScript modules');
});
