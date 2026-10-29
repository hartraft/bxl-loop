// tools/osm-pbf-extract.mjs — minimal dependency-free OSM PBF reader.
// usage: node tools/osm-pbf-extract.mjs <in.osm.pbf> <out.json> [south,west,north,east]
// Writes an Overpass-like JSON: { bbox, elements: [ {type:'node',id,lat,lon,tags}, {type:'way',id,tags,geometry:[{lat,lon}]}, {type:'relation',id,tags,members:[{type,ref,role}]} ] }
// Keeps tagged nodes in the requested bbox and a 1 km geometry margin so ways crossing the edge remain complete.
import fs from 'node:fs';
import zlib from 'node:zlib';

const [IN, OUT, BB] = process.argv.slice(2);
const [S, W, N, E] = (BB || '51.470,-0.215,51.545,-0.055').split(',').map(Number);
const buf = fs.readFileSync(IN);

// --- protobuf helpers ---------------------------------------------------------------------------------------------
function* fields(b, start = 0, end = b.length) {
  let p = start;
  while (p < end) {
    let key = 0, shift = 0, c;
    do { c = b[p++]; key += (c & 0x7f) * 2 ** shift; shift += 7; } while (c & 0x80);
    const f = Math.floor(key / 8), wt = key & 7;
    if (wt === 0) {
      let v = 0n, s = 0n;
      do { c = b[p++]; v |= BigInt(c & 0x7f) << s; s += 7n; } while (c & 0x80);
      yield [f, wt, v];
    } else if (wt === 2) {
      let len = 0; shift = 0;
      do { c = b[p++]; len += (c & 0x7f) * 2 ** shift; shift += 7; } while (c & 0x80);
      yield [f, wt, p, p + len]; p += len;
    } else if (wt === 1) { yield [f, wt, b.readBigUInt64LE(p)]; p += 8; }
    else if (wt === 5) { yield [f, wt, b.readUInt32LE(p)]; p += 4; }
    else throw new Error('wire type ' + wt);
  }
}
// packed varints → Number array (zigzag optional). Fast path with Numbers (values fit in 2^53 for OSM deltas).
function packed(b, s, e, zz) {
  const out = [];
  let p = s;
  while (p < e) {
    let v = 0, mul = 1, c;
    do { c = b[p++]; v += (c & 0x7f) * mul; mul *= 128; } while (c & 0x80);
    if (zz) v = (v % 2 === 0) ? v / 2 : -(v + 1) / 2;
    out.push(v);
  }
  return out;
}
const zz64 = (v) => Number((v >> 1n) ^ -(v & 1n));

// --- pass over blobs ----------------------------------------------------------------------------------------------
const nodeLat = new Map(); // id -> [lat, lon]
const elements = [];
const ways = [];
const relations = [];
let pos = 0, blocks = 0;
const inBox = (lat, lon) => lat >= S && lat <= N && lon >= W && lon <= E;
// Keep a ~1 km margin of untagged geometry around the requested bbox. The bake stage clips to the exact play area.
const inMargin = (lat, lon) => lat >= S - 0.009 && lat <= N + 0.009 && lon >= W - 0.015 && lon <= E + 0.015;

while (pos < buf.length) {
  const hlen = buf.readUInt32BE(pos); pos += 4;
  let type = '', dsize = 0;
  for (const [f, wt, a, b] of fields(buf, pos, pos + hlen)) {
    if (f === 1) type = buf.toString('utf8', a, b);
    if (f === 3) dsize = Number(a);
  }
  pos += hlen;
  const blobEnd = pos + dsize;
  let data = null;
  for (const [f, wt, a, b] of fields(buf, pos, blobEnd)) {
    if (f === 1) data = buf.subarray(a, b);
    if (f === 3) data = zlib.inflateSync(buf.subarray(a, b));
  }
  pos = blobEnd;
  if (type !== 'OSMData' || !data) continue;
  blocks++;
  // PrimitiveBlock
  let st = [], gran = 100, latOff = 0, lonOff = 0; const groups = [];
  for (const [f, wt, a, b] of fields(data)) {
    if (f === 1) { st = []; for (const [g, w2, x, y] of fields(data, a, b)) if (g === 1) st.push(data.toString('utf8', x, y)); }
    else if (f === 2) groups.push([a, b]);
    else if (f === 17) gran = Number(a);
    else if (f === 19) latOff = Number(a);
    else if (f === 20) lonOff = Number(a);
  }
  const toDeg = (v, off) => 1e-9 * (off + gran * v);
  for (const [ga, gb] of groups) {
    for (const [f, wt, a, b] of fields(data, ga, gb)) {
      if (f === 2) { // DenseNodes
        let ids = [], lats = [], lons = [], kv = [];
        for (const [g, w2, x, y] of fields(data, a, b)) {
          if (g === 1) ids = packed(data, x, y, true);
          else if (g === 8) lats = packed(data, x, y, true);
          else if (g === 9) lons = packed(data, x, y, true);
          else if (g === 10) kv = packed(data, x, y, false);
        }
        let id = 0, la = 0, lo = 0, k = 0;
        for (let i = 0; i < ids.length; i++) {
          id += ids[i]; la += lats[i]; lo += lons[i];
          const lat = toDeg(la, latOff), lon = toDeg(lo, lonOff);
          let tags = null;
          if (kv.length) { while (kv[k] !== 0) { (tags ||= {})[st[kv[k]]] = st[kv[k + 1]]; k += 2; } k++; }
          if (inMargin(lat, lon)) {
            nodeLat.set(id, [lat, lon]);
            if (tags && inBox(lat, lon)) elements.push({ type: 'node', id, lat: +lat.toFixed(7), lon: +lon.toFixed(7), tags });
          }
        }
      } else if (f === 3) { // Way
        let id = 0, keys = [], vals = [], refs = [];
        for (const [g, w2, x, y] of fields(data, a, b)) {
          if (g === 1) id = Number(x);
          else if (g === 2) keys = packed(data, x, y, false);
          else if (g === 3) vals = packed(data, x, y, false);
          else if (g === 8) refs = packed(data, x, y, true);
        }
        let r = 0, hit = false; const nodes = new Array(refs.length);
        for (let i = 0; i < refs.length; i++) { r += refs[i]; nodes[i] = r; if (!hit && nodeLat.has(r)) hit = true; }
        if (!hit) continue;
        const tags = {}; for (let i = 0; i < keys.length; i++) tags[st[keys[i]]] = st[vals[i]];
        ways.push({ id, tags, nodes });
      } else if (f === 4) { // Relation
        let id = 0, keys = [], vals = [], roles = [], mids = [], types = [];
        for (const [g, w2, x, y] of fields(data, a, b)) {
          if (g === 1) id = Number(x);
          else if (g === 2) keys = packed(data, x, y, false);
          else if (g === 3) vals = packed(data, x, y, false);
          else if (g === 8) roles = packed(data, x, y, false);
          else if (g === 9) mids = packed(data, x, y, true);
          else if (g === 10) types = packed(data, x, y, false);
        }
        const tags = {}; for (let i = 0; i < keys.length; i++) tags[st[keys[i]]] = st[vals[i]];
        let m = 0; const members = mids.map((d, i) => { m += d; return { type: ['node', 'way', 'relation'][types[i]], ref: m, role: st[roles[i]] }; });
        relations.push({ id, tags, members });
      }
    }
  }
}
const wayIds = new Set(ways.map((w) => w.id));
for (const w of ways) {
  // Geometry; nodes outside the bbox+margin are left null (geom builders clip).
  w.geometry = w.nodes.map((n) => { const c = nodeLat.get(n); return c ? { lat: +c[0].toFixed(7), lon: +c[1].toFixed(7) } : null; });
  delete w.nodes;
  elements.push({ type: 'way', ...w });
}
let keptRel = 0;
for (const r of relations) {
  if (!r.members.some((m) => m.type === 'way' && wayIds.has(m.ref))) continue;
  keptRel++;
  elements.push({ type: 'relation', ...r });
}
fs.writeFileSync(OUT, JSON.stringify({ bbox: [S, W, N, E], source: IN.split('/').pop(), elements }));
console.log(`blocks ${blocks}, nodes in bbox ${nodeLat.size}, tagged nodes ${elements.filter((e) => e.type === 'node').length}, ways ${ways.length}, relations ${keptRel}`);
