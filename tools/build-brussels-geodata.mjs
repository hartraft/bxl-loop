// Build Brussels OSM geometry from a local .osm.pbf extract.
// Usage: node --max-old-space-size=12000 tools/build-brussels-geodata.mjs [input.osm.pbf] [output-dir]
// The extractor is dependency-free. Keep generated files out of git until the dataset is reviewed.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { execFileSync } from 'node:child_process';

const ROOT = fileURLToPath(new URL('../', import.meta.url));
const inputPbf = path.resolve(process.argv[2] || path.join(ROOT, 'tools/data/belgium-latest.osm.pbf'));
const outDir = path.resolve(process.argv[3] || path.join(ROOT, 'data/brussels-build'));
const osmJson = path.join(ROOT, 'tools/data/brussels-central.osm.json');
const bbox = '50.815,4.305,50.875,4.405';

if (!fs.existsSync(inputPbf)) {
  throw new Error(`Missing OSM PBF: ${inputPbf}\nDownload the Belgium extract from https://download.geofabrik.de/europe/belgium-latest.osm.pbf or pass a local PBF path.`);
}
fs.mkdirSync(path.dirname(osmJson), { recursive: true });
fs.mkdirSync(outDir, { recursive: true });

console.log(`[brx-build] extracting bbox ${bbox} from ${path.basename(inputPbf)}`);
execFileSync(process.execPath, [
  path.join(ROOT, 'tools/osm-pbf-extract.mjs'), inputPbf, osmJson, bbox
], { stdio: 'inherit', cwd: ROOT });

process.env.CITY = 'brussels';
process.argv = [process.argv[0], path.join(ROOT, 'tools/build-london-geodata.mjs'), osmJson, outDir];
console.log('[brx-build] baking Brussels geodata');
await import('./build-london-geodata.mjs?city=brussels');
console.log(`[brx-build] complete: ${path.join(outDir, 'brx-geo.json')} and ${path.join(outDir, 'brx-buildings.bin')}`);
