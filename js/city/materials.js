// js/city/materials.js — TSL materials of the London city (buildings, glass towers, roads, pavements, markings,
// ground, parks, water, stonework). All shading is procedural, in world space or in per-vertex wall coordinates, and
// reads the shared time-of-day uniforms (cityUniforms from js/tsl-materials.js: uInteriorGlow lights windows & lamps at
// night, uSky* colours feed the fake reflections, uRoadWetness darkens the tarmac).
//
// Vertex attribute contracts (written by js/city/buildings.js, roads.js, ground.js):
//  buildings  bfu   vec2 f32  x = wall coordinate in window bays (0 at the wall's start, whole bays per wall) — for
//                             roofs: metres along the ridge; y = eave height (no windows above it)
//             binfo vec4 u8n  x = building seed, y = SURF (surface type), z = MATERIALS index, w = style flags
//                             (STYLE + 8·shop + 16·street-front + 32·mansard storey)
//             bcol  vec4 u8n  rgb = base colour (facade / roof), a = roof variant (slate / clay / felt / gravel …)
//  surfaces   scol  vec4 u8n  rgb = albedo tint, a = wear / pattern selector (see each material)
//             uv    vec2      pavements: x = metres along the kerb, y = metres from the kerb edge
import * as THREE from 'three/webgpu';
import {
  Fn, float, vec2, vec3, vec4, color, uniform, attribute, texture, positionWorld, normalWorld, normalWorldGeometry,
  cameraPosition, uv, time, sin, cos, abs, floor, fract, mod, min, max, clamp, mix, step, smoothstep, dot, length,
  normalize, reflect, pow, fwidth, exp, transformNormalToView
} from 'three/tsl';
import { cityUniforms, hash2D, noise2D, filteredPulse, bumpNormal, evaluateApartmentInterior } from '../tsl-materials.js';

export { SURF, STYLE } from './materials-shared.js';

const night = () => smoothstep(0.3, 1.25, cityUniforms.uInteriorGlow);
const dec255 = (v) => floor(v.mul(255.0).add(0.5));
// vertex colours are stored as sRGB bytes: linearize for lighting
const lin = (c) => pow(c, vec3(2.2));
const bit = (v, k) => mod(floor(v.div(k)), 2.0);

// Fake sky reflection colour for a reflected direction (no environment lookup: cheap and time-of-day aware)
const skyReflect = (R) => mix(cityUniforms.uSkyHorizonColor, cityUniforms.uSkyTopColor, clamp(R.y.mul(1.6).add(0.1), 0.0, 1.0));
// what a window low in a street sees reflected: the buildings across the road below a jagged roofline, sky above
const streetReflect = (R, P, seed) => {
  const az = dot(R.xz, vec2(0.71, 0.71)).mul(6.0).add(dot(P.xz, vec2(0.013, 0.017))).add(seed.mul(7.0));
  const roofline = hash2D(vec2(floor(az), seed.mul(3.0).add(1.7))).mul(0.32).add(0.08).sub(P.y.mul(0.006)).max(-0.2);
  const inBld = smoothstep(roofline.add(0.03), roofline.sub(0.03), R.y);
  const bld = mix(color(0x2b2824), color(0x5a5248), hash2D(vec2(floor(az), 4.1))).mul(mix(float(0.6), float(1.0), cityUniforms.uSkyHorizonColor.g));
  return mix(skyReflect(R), bld, inBld.mul(0.85));
};
// sky light reaching a London street canyon (aoNode: indirect light only): darker near the pavement, open at roof level
const londonCanyonAO = () => mix(float(0.58), float(1.0), smoothstep(0.0, 26.0, positionWorld.y)).mul(smoothstep(0.0, 4.0, positionWorld.y).mul(0.18).add(0.82));

// ---------------------------------------------------------------------------------------------------------------------
// Masonry buildings + every roof
// ---------------------------------------------------------------------------------------------------------------------
let _buildingMat = null;
export function createLondonBuildingMaterial() {
  if (_buildingMat) return _buildingMat;
  const mat = new THREE.MeshStandardNodeMaterial({ roughness: 0.85, metalness: 0.0 });
  mat.name = 'LondonBuilding';

  const fu = attribute('bfu', 'vec2');
  const info = attribute('binfo', 'vec4');
  const bcol = attribute('bcol', 'vec4');
  // quantized: an interpolated u8 drifts in its last bits, which the sin-hashes below would turn into speckle
  const seed = dec255(info.x).div(255.0);
  const surf = dec255(info.y);
  const matId = dec255(info.z);
  const flags = dec255(info.w);
  const style = mod(flags, 8.0);
  const shop = bit(flags, 8.0);
  const front = bit(flags, 16.0);
  const mansard = bit(flags, 32.0);
  const isWall = step(surf, 1.5); // wall or blank wall
  const isBlank = step(0.5, surf).mul(isWall).max(step(4.5, style).mul(step(style, 5.5)));
  const isFlat = step(1.5, surf).mul(step(surf, 2.5));
  const isPitched = step(2.5, surf).mul(step(surf, 3.5));
  const isPlant = step(3.5, surf).mul(step(surf, 4.5));
  const isChimney = step(4.5, surf).mul(step(surf, 5.5));
  const isParapet = step(5.5, surf).mul(step(surf, 6.5));

  const mBrickStock = step(matId, 0.5);
  const mBrickRed = step(0.5, matId).mul(step(matId, 1.5));
  const mStone = step(1.5, matId).mul(step(matId, 2.5)).add(step(5.5, matId)); // portland + sandstone
  const mStucco = step(2.5, matId).mul(step(matId, 3.5));
  const mConcrete = step(3.5, matId).mul(step(matId, 5.5)); // glass (small buildings) + concrete
  const brick = mBrickStock.add(mBrickRed);

  const P = positionWorld;
  const nW = normalWorldGeometry;
  const y = P.y;
  // metres along the wall from its face normal (flat per face): bricks / ashlar joints
  const tang = normalize(vec2(nW.z.negate(), nW.x).add(vec2(0.0001, 0.0)));
  const along = dot(P.xz, tang);

  // storey height by style (sash residential 3.1, georgian 3.4, office 3.6, ribbon 3.5, industrial 5, church 7)
  const fh = mix(mix(mix(mix(mix(float(3.1), float(3.6), step(0.5, style)), float(3.5), step(1.5, style)), float(5.0), step(2.5, style)),
    float(7.0), step(3.5, style)), float(3.45), step(5.5, style));
  const gv = y.div(fh);
  const floorIdx = floor(gv);
  const cv = fract(gv);
  const u = fu.x;
  const bayIdx = floor(u);
  const cu = fract(u);
  const eave = fu.y;
  const fwu = fwidth(u).max(0.0005);
  const fwv = fwidth(gv).max(0.0005);
  // bay width in metres: u (bays) and `along` (m) both run linearly along the wall, so their derivatives' ratio is it
  const bayW = clamp(fwidth(along).div(fwu), 1.6, 5.5);
  const camDist = length(cameraPosition.sub(P));
  // windows only in storeys that end below the eave, and not in the ground floor of shop fronts (handled apart)
  const storeyFits = step(floorIdx.add(1.0).mul(fh), eave.add(0.25));
  const inMansard = mansard.mul(step(eave.sub(2.9), y));

  // window rectangle in the bay cell by style: [x half-width, y0, y1]
  const wHalf = mix(mix(mix(mix(mix(float(0.21), float(0.3), step(0.5, style)), float(0.47), step(1.5, style)), float(0.36), step(2.5, style)),
    float(0.14), step(3.5, style)), float(0.2), step(5.5, style));
  const wY0 = mix(mix(float(0.2), float(0.28), step(0.5, style)), float(0.16), step(2.5, style));
  const wY1 = mix(mix(float(0.84), float(0.86), step(0.5, style)), float(0.9), step(2.5, style));
  // georgian: shorter top-floor windows (attic storey); taller piano-nobile windows on the first floor
  const attic = step(5.5, style).mul(step(eave.sub(fh.mul(1.2)), y));
  const nobile = step(5.5, style).max(step(style, 0.5).mul(mStucco)).mul(step(0.5, floorIdx)).mul(step(floorIdx, 1.5));
  const wY0b = mix(mix(wY0, float(0.08), nobile), float(0.35), attic);
  const winHalf = mix(wHalf, float(0.17), inMansard);
  const winMask = filteredPulse(cu, float(0.5).sub(winHalf), float(0.5).add(winHalf), fwu)
    .mul(filteredPulse(cv, wY0b, wY1, fwv))
    .mul(storeyFits.max(inMansard.mul(step(y, eave.sub(0.6))))).mul(isWall).mul(float(1.0).sub(isBlank));

  // ---- ground-floor shop fronts ---------------------------------------------------------------------------------------
  // A shop spans 1-3 bays (per building); each has a painted fascia with a sign, pilasters at its ends, a stall riser,
  // a transom light over the door and glazing bars, and a lit interior with shelves seen in parallax behind the glass.
  const g0 = step(y, 4.2).mul(step(0.0, y));
  const shopZone = shop.mul(front).mul(g0).mul(isWall).mul(float(1.0).sub(isBlank));
  const shopBays = floor(hash2D(vec2(seed.mul(41.0), 2.3)).mul(2.6)).add(1.0);
  const shU = u.div(shopBays);
  const shopId = floor(shU);
  const su = fract(shU);
  const fws = fwu.div(shopBays);
  const shopHash = hash2D(vec2(shopId.mul(0.37).add(seed.mul(911.0)), 7.7));
  const shopHash2 = hash2D(vec2(shopId.add(seed.mul(57.0)), 2.9));
  const pil = float(0.16).div(shopBays.mul(bayW)).max(0.02); // 0.16 m pilasters
  const inOpening = filteredPulse(su, pil, float(1.0).sub(pil), fws);
  const doorC = mix(mix(pil.add(0.1), float(0.5), step(0.4, shopHash2)), float(1.0).sub(pil).sub(0.1), step(0.75, shopHash2));
  const doorHalf = float(0.5).div(shopBays.mul(bayW)).min(0.2);
  const inShopDoor = filteredPulse(su, doorC.sub(doorHalf), doorC.add(doorHalf), fws).mul(step(y, 2.5));
  const riser = step(y, 0.6).mul(float(1.0).sub(inShopDoor));
  const transomBar = step(2.42, y).mul(step(y, 2.52));
  const panes = shopBays.mul(2.0);
  const glazingBar = filteredPulse(fract(su.mul(panes)), 0.0, 0.025, fws.mul(panes)).mul(step(0.6, y)).mul(float(1.0).sub(inShopDoor));
  const shopGlass = inOpening.mul(step(0.6, y).max(inShopDoor)).mul(step(y, 3.0)).mul(float(1.0).sub(transomBar)).mul(float(1.0).sub(glazingBar));
  const fascia = step(3.1, y).mul(step(y, 3.9)).mul(filteredPulse(su, 0.005, 0.995, fws));
  // fascia paint: London greens, navy, black, burgundy, cream, slate, and a few brighter chains
  const fpick = shopHash.mul(8.0);
  const signCol = mix(mix(mix(mix(mix(mix(mix(color(0x1f3b2c), color(0x1a2540), step(1.0, fpick)), color(0x141414), step(2.0, fpick)),
    color(0x5a1620), step(3.0, fpick)), color(0xd9cfb4), step(4.0, fpick)), color(0x3d444a), step(5.0, fpick)),
    color(0xa3281e), step(6.0, fpick)), color(0x1f5c5a), step(7.0, fpick));
  const lightSign = step(4.0, fpick).mul(step(fpick, 5.0));
  // sign lettering: a row of block letters in the middle of the fascia
  const nLet = floor(shopBays.mul(bayW).mul(2.4)).max(5.0);
  const lu = su.sub(0.18).div(0.64);
  const letterCell = fract(lu.mul(nLet));
  const letterOn = step(0.22, hash2D(vec2(floor(lu.mul(nLet)), shopHash.mul(77.0))));
  const letters = filteredPulse(letterCell, 0.2, 0.72, fws.div(0.64).mul(nLet)).mul(step(3.38, y)).mul(step(y, 3.64))
    .mul(float(1.0).sub(filteredPulse(letterCell, 0.36, 0.56, fws.div(0.64).mul(nLet)).mul(step(3.45, y)).mul(step(y, 3.57)).mul(step(0.5, hash2D(vec2(floor(lu.mul(nLet)), 3.3))))))
    .mul(step(0.0, lu)).mul(step(lu, 1.0)).mul(letterOn);
  const letterCol = mix(mix(color(0xe8dcb8), color(0xc9a24a), step(0.5, shopHash2)), color(0x1a1a1a), lightSign);
  const winMaskUp = winMask.mul(float(1.0).sub(shopZone));

  // street door on residential fronts: one bay in ~4, panelled, under a fanlight, a step up from the pavement
  const doorHash = hash2D(vec2(bayIdx.add(seed.mul(531.0)), 3.1));
  const doorZone = front.mul(float(1.0).sub(shop)).mul(isWall).mul(float(1.0).sub(isBlank)).mul(step(doorHash, 0.28))
    .mul(filteredPulse(cu, 0.3, 0.7, fwu)).mul(step(y, 2.9)).mul(step(0.15, y)).mul(step(style, 0.5).max(step(5.5, style)));
  const doorV = y.sub(0.15).div(2.75);
  const doorU = cu.sub(0.3).div(0.4);
  const fanlight = step(0.8, doorV);
  const doorPanel = float(1.0).sub(filteredPulse(fract(doorU.mul(2.0)), 0.16, 0.84, fwu.mul(5.0)).mul(filteredPulse(fract(doorV.mul(2.6)), 0.15, 0.85, fwv.mul(3.0))));
  const dpick = fract(doorHash.mul(3.5));
  const doorPaint = mix(mix(mix(color(0x0e0e10), color(0x1d3b2a), step(0.3, dpick)), color(0x6b1418), step(0.62, dpick)), color(0x1c2e4a), step(0.85, dpick));
  const doorCol = mix(doorPaint.mul(float(1.0).sub(doorPanel.mul(0.35))), color(0x1a1c1e), fanlight);

  // ---- masonry patterns -------------------------------------------------------------------------------------------
  const course = y.div(0.075);
  const row = floor(course);
  const brickU = along.div(0.225).add(mod(row, 2.0).mul(0.5));
  const brickId = vec2(floor(brickU), row);
  const fwc = fwidth(course).max(0.0005);
  const fwb = fwidth(brickU).max(0.0005);
  const mortar = float(1.0).sub(filteredPulse(fract(course), 0.0, 0.86, fwc).mul(filteredPulse(fract(brickU), 0.0, 0.94, fwb))).mul(mix(float(1.0), float(0.6), smoothstep(0.2, 0.6, fwc)));
  // per-brick tint, faded out once bricks shrink to a couple of pixels (it would only alias into speckle)
  const brickFade = float(1.0).sub(smoothstep(0.12, 0.45, max(fwc, fwb)));
  const brickJit = hash2D(brickId.add(seed.mul(17.0))).sub(0.5).mul(brickFade);
  const grime = noise2D(vec2(along.mul(0.25), y.mul(0.05)).add(seed.mul(31.0)));
  const streak = noise2D(vec2(along.mul(1.7), y.mul(0.04)));
  // rain streaks washing down from sills & copings, soot darker low down near the traffic
  const rainStreak = smoothstep(0.45, 0.85, noise2D(vec2(along.mul(2.3).add(seed.mul(9.0)), y.mul(0.12)))).mul(float(1.0).sub(smoothstep(0.2, 1.2, fwidth(along.mul(2.3)))));
  const base = lin(bcol.rgb);
  const brickCol = base.mul(float(1.0).add(brickJit.mul(0.22))).mul(mix(float(1.0), float(0.82), mortar.mul(0.6)))
    .mul(mix(float(0.78), float(1.05), grime));
  // Portland / sandstone ashlar, rusticated (deep horizontal joints) in the ground floor of office / civic buildings
  const ashV = y.div(0.6);
  const ashU = along.div(1.2).add(mod(floor(ashV), 2.0).mul(0.5));
  const ashJoint = float(1.0).sub(filteredPulse(fract(ashV), 0.0, 0.97, fwidth(ashV).max(0.0005)).mul(filteredPulse(fract(ashU), 0.0, 0.985, fwidth(ashU).max(0.0005))));
  const rustStone = step(y, fh.mul(1.02)).mul(step(0.5, style)).mul(step(style, 1.5)).mul(gridLineSoft(y, 0.6, 0.05));
  // Portland stone weathers white where the rain washes it and black where it doesn't (under cornices, sills)
  const stoneCol = base.mul(float(1.0).sub(ashJoint.mul(0.12)).sub(rustStone.mul(0.35))).mul(mix(float(0.7), float(1.04), smoothstep(0.15, 0.7, streak.mul(0.6).add(grime.mul(0.4)))));
  // stucco: smooth painted render, rusticated ground floor (horizontal grooves), faint string courses
  const rust = step(y, fh).mul(gridLineSoft(y, 0.42, 0.025));
  const stuccoCol = base.mul(float(1.0).sub(rust.mul(0.25))).mul(mix(float(0.9), float(1.02), grime));
  // concrete panels: a joint per bay and per storey
  const panelJ = max(filteredPulse(cu, 0.0, 0.02, fwu), filteredPulse(cv, 0.0, 0.025, fwv));
  const concCol = base.mul(float(1.0).sub(panelJ.mul(0.25))).mul(mix(float(0.75), float(1.03), grime));

  const wallCol = brickCol.mul(brick).add(stoneCol.mul(mStone)).add(stuccoCol.mul(mStucco)).add(concCol.mul(mConcrete));
  // string course at each floor line & cornice under the eave (stone / stucco / brick dressings), coping at the top
  const string = filteredPulse(cv, 0.0, 0.045, fwv).mul(step(0.5, floorIdx)).mul(mStone.add(mStucco).add(brick.mul(0.5)));
  const cornice = step(eave.sub(0.55), y).mul(step(y, eave.sub(0.1)));
  const underCornice = step(eave.sub(0.85), y).mul(step(y, eave.sub(0.55)));
  const dressing = mix(color(0xe6e0d2), base.mul(1.12), mStone.add(mStucco).min(1.0));
  let wall = mix(wallCol, dressing, max(string.mul(0.7), cornice.mul(0.85)).mul(float(1.0).sub(isParapet)));
  wall = wall.mul(float(1.0).sub(underCornice.mul(0.35).mul(float(1.0).sub(isParapet))));
  // window dressings: stone / painted sills under every window, gauged red-brick arches over them on stock brick,
  // stone lintels on red brick, moulded architraves on stone & stucco
  const winSpan = filteredPulse(cu, float(0.5).sub(winHalf).sub(0.045), float(0.5).add(winHalf).add(0.045), fwu);
  const winRows = storeyFits.mul(isWall).mul(float(1.0).sub(isBlank)).mul(float(1.0).sub(shopZone)).mul(float(1.0).sub(inMansard));
  const sill = filteredPulse(cv, wY0b.sub(0.04), wY0b, fwv).mul(winSpan).mul(winRows);
  const sillShade = filteredPulse(cv, wY0b.sub(0.075), wY0b.sub(0.04), fwv).mul(winSpan).mul(winRows);
  const head = filteredPulse(cv, wY1, wY1.add(0.07), fwv).mul(filteredPulse(cu, float(0.5).sub(winHalf).sub(0.03), float(0.5).add(winHalf).add(0.03), fwu)).mul(winRows);
  const archCol = mix(mix(color(0x8a4632), color(0xd8d0bc), mBrickRed), base.mul(1.15), mStone.add(mStucco).add(mConcrete).min(1.0));
  const architrave = filteredPulse(cu, float(0.5).sub(winHalf).sub(0.035), float(0.5).sub(winHalf), fwu)
    .add(filteredPulse(cu, float(0.5).add(winHalf), float(0.5).add(winHalf).add(0.035), fwu))
    .mul(filteredPulse(cv, wY0b, wY1, fwv)).mul(winRows).mul(mStone.add(mStucco).min(1.0));
  wall = mix(wall, dressing, sill.mul(0.9));
  wall = mix(wall, archCol, head.mul(0.85).mul(float(1.0).sub(mConcrete)));
  wall = mix(wall, base.mul(1.12), architrave.mul(0.6));
  wall = wall.mul(float(1.0).sub(sillShade.mul(0.35)));
  // rain streaks under the sills on stone & brick
  wall = wall.mul(float(1.0).sub(rainStreak.mul(0.12).mul(mStone.add(brick).min(1.0))));
  // mansard storey: slate between the dormers
  const slateCol = mix(color(0x2c3036), color(0x3a3f47), noise2D(P.xz.mul(0.5).add(y)));
  wall = mix(wall, slateCol, inMansard.mul(float(1.0).sub(winMask)));
  // stucco railings feel: black area railings in front of the basement (front walls, below 1.05 m)
  const rail = front.mul(mStucco).mul(float(1.0).sub(shop)).mul(step(y, 1.05)).mul(isWall)
    .mul(max(filteredPulse(fract(along.div(0.13)), 0.0, 0.22, fwidth(along.div(0.13)).max(0.0005)), step(0.95, y)));
  // plinth: a darker base course (engineering brick / granite / painted render) and splash grime off the pavement
  const plinth = step(y, 0.55).mul(isWall).mul(float(1.0).sub(shopZone));
  wall = mix(wall, wall.mul(0.55).add(color(0x101010).mul(0.2)), plinth.mul(0.7));
  wall = wall.mul(mix(float(0.66), float(1.0), smoothstep(0.0, 2.4, y)));

  // ---- windows ------------------------------------------------------------------------------------------------------
  const winU = clamp(cu.sub(float(0.5).sub(winHalf)).div(winHalf.mul(2.0)), 0.0, 1.0);
  const winV = clamp(cv.sub(wY0b).div(wY1.sub(wY0b)), 0.0, 1.0);
  // painted white sash frames with glazing bars (6 over 6 / 2 over 2), dark metal frames on offices & flats
  const fwwu = fwidth(winU).max(0.001);
  const fwwv = fwidth(winV).max(0.001);
  const sashy = step(style, 0.5).max(step(5.5, style)).max(inMansard);
  const bars = mix(float(3.0), float(2.0), step(0.6, seed));
  const frame = max(
    float(1.0).sub(filteredPulse(winU, 0.06, 0.94, fwwu).mul(filteredPulse(winV, 0.05, 0.95, fwwv))),
    max(filteredPulse(winV, 0.49, 0.53, fwwv), sashy.mul(max(filteredPulse(fract(winU.mul(bars)), 0.0, 0.05, fwwu.mul(bars)), filteredPulse(fract(winV.mul(bars)), 0.0, 0.06, fwwv.mul(bars)))))
  );
  const frameCol = mix(mix(color(0x2a2d31), color(0x47423a), step(0.5, seed)), color(0xe8e6df), sashy.max(mStucco).max(mStone.mul(step(0.4, seed))));
  const viewDir = normalize(cameraPosition.sub(P));
  const R = reflect(viewDir.negate(), nW);
  const fres = pow(clamp(float(1.0).sub(abs(dot(viewDir, nW))), 0.0, 1.0), 3.0);
  const winId = vec2(bayIdx.add(seed.mul(1371.0)), floorIdx.add(seed.mul(97.0)));
  const nf = night();
  const litProb = mix(float(0.1), float(0.46), nf).mul(mix(float(1.0), float(1.25), step(0.5, style).mul(step(style, 2.5))));
  const warmth = mix(float(0.85), float(0.35), step(0.5, style).mul(step(style, 2.5)));
  // the room behind each pane (3D interior mapping, shared with NY's facades): walls, floor, lamp, curtains
  const aptRoom = evaluateApartmentInterior(u.mul(bayW), y, vec2(winU, winV), winId, bayW, fh, seed.mul(97.0), warmth, litProb, vec2(fwu, fwv));
  // net curtains / blinds on a share of the windows (London!), the panes' grime pooled low
  const net = step(0.62, hash2D(winId.add(vec2(2.1, 9.4)))).mul(smoothstep(0.35, 0.75, winV).mul(0.5).add(0.35));
  const glassTint = mix(color(0x12161a), color(0x1d2329), hash2D(winId.add(vec2(5.3, 1.7))));
  const roomSeen = mix(aptRoom.xyz.mul(0.75), color(0xb8b4aa).mul(0.55), net);
  const glassDay = mix(roomSeen, glassTint, float(0.38).add(float(1.0).sub(smoothstep(0.0, 0.3, winV)).mul(0.2)));
  // the reveal: the frame sits ~15 cm back in the wall, so the head and one jamb shade the glass
  const reveal = max(smoothstep(0.8, 1.0, winV).mul(0.5), float(1.0).sub(smoothstep(0.0, 0.12, winU)).mul(0.35));
  const winFinal = mix(glassDay, frameCol, frame).mul(float(1.0).sub(reveal));

  // shop interiors: back wall with shelves of goods, seen through the glass with parallax (1.8 m deep)
  const rayW = viewDir.negate();
  const dz = max(abs(dot(rayW, nW)), 0.08);
  const dxs = dot(rayW, vec3(tang.x, 0.0, tang.y));
  const sx = along.add(dxs.div(dz).mul(1.8));
  const sy = y.add(rayW.y.div(dz).mul(1.8));
  const shelfRow = fract(sy.div(0.55));
  const shelf = step(shelfRow, 0.08);
  const goods = hash2D(vec2(floor(sx.div(0.13)), floor(sy.div(0.55)).add(shopHash.mul(13.0))));
  const goodsFar = smoothstep(0.04, 0.2, fwidth(sx.div(0.13)));
  const goodsCol = mix(mix(mix(color(0x6a4a3e), color(0x485a66), step(0.33, goods)), mix(color(0xa8987a), color(0x5e6a4e), step(0.8, goods)), step(0.6, goods)), color(0x6e6458), goodsFar);
  const backWall = mix(color(0xcfc7b6), color(0x6b5038), step(0.6, shopHash2));
  const shopLit = step(hash2D(vec2(shopId.add(seed.mul(77.0)), 1.3)), mix(float(0.75), float(0.9), nf));
  const display = mix(backWall, goodsCol, step(0.1, shelfRow).mul(step(sy, 2.3)).mul(step(0.25, goods)).mul(0.6)).mul(float(1.0).sub(shelf.mul(0.45)))
    .mul(mix(float(0.18), float(0.62), shopLit)).mul(mix(float(0.6), float(1.0), smoothstep(0.0, 2.6, sy)));
  const shopGl = mix(display, color(0x0e1012), float(1.0).sub(smoothstep(0.0, 0.5, dz)).mul(0.6));
  const frameShop = mix(signCol.mul(0.9), color(0x1a1b1c), step(0.5, shopHash2).mul(0.6));
  let shopFront = mix(frameShop, shopGl, shopGlass);
  shopFront = mix(shopFront, mix(signCol.mul(0.5), color(0x1c1c1c), 0.4), riser.mul(inOpening));
  shopFront = mix(shopFront, mix(signCol, letterCol, letters), fascia);
  shopFront = mix(shopFront, frameShop.mul(0.7), float(1.0).sub(inOpening).mul(step(y, 3.1)));
  // a cornice shadow line over the fascia and a step at the foot
  shopFront = shopFront.mul(float(1.0).sub(step(3.9, y).mul(step(y, 4.05)).mul(0.5)));

  // ---- roofs --------------------------------------------------------------------------------------------------------
  const rv = bcol.a;
  const roofN = noise2D(P.xz.mul(0.6));
  const roofN2 = noise2D(P.xz.mul(0.09).add(seed.mul(40.0)));
  // (kept a good deal darker than the facades: from the air light roofs read as snow)
  const felt = mix(mix(color(0x3c3e42), color(0x55555a), roofN2), color(0x5c4a3e), step(0.3, rv).mul(0.5)).mul(mix(float(0.85), float(1.08), roofN));
  const gravel = mix(color(0x4e4c47), color(0x625f58), roofN).mul(mix(float(0.8), float(1.05), roofN2)).mul(mix(float(0.85), float(1.1), seed));
  const greenRoof = mix(color(0x3f5a2c), color(0x5d6f3b), roofN);
  // flat roofs: membrane sheets laid in strips, lead-capped edges, puddle stains & skylights on big roofs
  const sheet = filteredPulse(fract(dot(P.xz, tang.mul(1.0)).div(1.0)), 0.0, 0.04, fwidth(dot(P.xz, tang)).max(0.001));
  const stain = smoothstep(0.55, 0.8, noise2D(P.xz.mul(0.15).add(seed.mul(13.0))));
  const skyl = step(0.9, hash2D(floor(P.xz.div(3.5)).add(seed.mul(5.0)))).mul(filteredPulse(fract(P.x.div(3.5)), 0.2, 0.8, fwidth(P.x.div(3.5)).max(0.001)))
    .mul(filteredPulse(fract(P.z.div(3.5)), 0.25, 0.75, fwidth(P.z.div(3.5)).max(0.001))).mul(step(0.45, rv));
  const flatBase = mix(mix(felt.mul(float(1.0).sub(sheet.mul(0.18))), gravel, step(0.45, rv)), greenRoof, step(0.975, rv).mul(mConcrete.add(mStone).min(1.0)));
  const flatCol = mix(flatBase.mul(float(1.0).sub(stain.mul(0.22))), color(0x2a3036), skyl.mul(0.8));
  // pitched: slate courses (rows of constant height) with staggered joints along the ridge, or clay tiles
  const sRow = y.div(0.11);
  const sRowId = floor(sRow);
  const sU = fu.x.div(mix(float(0.3), float(0.27), step(0.72, rv))).add(mod(sRowId, 2.0).mul(0.5));
  const slateId = vec2(floor(sU), sRowId);
  const sJ = float(1.0).sub(filteredPulse(fract(sRow), 0.0, 0.85, fwidth(sRow).max(0.0005)).mul(filteredPulse(fract(sU), 0.0, 0.93, fwidth(sU).max(0.0005))));
  const sJit = hash2D(slateId.add(seed.mul(13.0))).sub(0.5).mul(float(1.0).sub(smoothstep(0.15, 0.5, max(fwidth(sRow), fwidth(sU)))));
  // weathering: lichen / moss patches and the colour drifting per building, so a terrace isn't one flat grey sheet
  const moss = smoothstep(0.6, 0.85, noise2D(P.xz.mul(0.35).add(seed.mul(21.0))));
  const slate = mix(color(0x30343b), color(0x4a4e56), roofN2).mul(mix(float(0.85), float(1.12), seed)).mul(float(1.0).add(sJit.mul(0.25)));
  const clay = mix(color(0x7a3c2a), color(0x9a5236), roofN2).mul(float(1.0).add(sJit.mul(0.3)));
  const pitchedCol = mix(mix(slate, clay, step(0.72, rv)), color(0x4f5236), moss.mul(0.35)).mul(float(1.0).sub(sJ.mul(0.35))).mul(mix(float(0.8), float(1.0), roofN));
  const plantCol = mix(color(0x6e7073), color(0x8b8d8f), roofN).mul(float(1.0).sub(filteredPulse(fract(y.mul(6.0)), 0.0, 0.25, fwidth(y.mul(6.0)).max(0.001)).mul(0.25)));
  const chimTop = step(eave.sub(0.25), y);
  const chimCol = mix(brickColFor(base, mortar, brickJit), color(0x8a4a36), chimTop);
  const parapetCol = wall.mul(0.8);

  const roofCol = flatCol.mul(isFlat).add(pitchedCol.mul(isPitched)).add(plantCol.mul(isPlant)).add(chimCol.mul(isChimney)).add(parapetCol.mul(isParapet));
  const isRoofish = isFlat.add(isPitched).add(isPlant).add(isChimney).add(isParapet).min(1.0);

  const wallLook = mix(mix(mix(wall, winFinal, winMaskUp), shopFront, shopZone), doorCol, doorZone);
  // Belgravia / Pimlico stucco: a columned porch round each front door, its entablature carrying a first-floor balcony
  const doorBay = front.mul(float(1.0).sub(shop)).mul(isWall).mul(float(1.0).sub(isBlank)).mul(step(doorHash, 0.28)).mul(mStucco)
    .mul(step(style, 0.5).max(step(5.5, style)));
  const colC = mix(float(0.24), float(0.76), step(0.5, cu));
  const colD = abs(cu.sub(colC)).div(0.045);
  const column = filteredPulse(cu, 0.195, 0.285, fwu).add(filteredPulse(cu, 0.715, 0.805, fwu)).mul(step(y, 3.05)).mul(step(0.15, y));
  const entab = filteredPulse(cu, 0.16, 0.84, fwu).mul(step(3.05, y)).mul(step(y, 3.5));
  const balus = filteredPulse(cu, 0.16, 0.84, fwu).mul(step(3.5, y)).mul(step(y, 4.25))
    .mul(max(filteredPulse(fract(cu.mul(18.0)), 0.0, 0.45, fwu.mul(18.0)), step(4.1, y)));
  const porch = doorBay.mul(max(max(column, entab), balus));
  const porchCol = dressing.mul(mix(float(1.0), mix(float(1.0), float(0.68), colD.mul(colD).min(1.0)), column))
    .mul(float(1.0).sub(step(3.05, y).mul(step(y, 3.14)).mul(0.3)));
  const finalWall = mix(mix(wallLook, porchCol, porch), color(0x121314), rail.mul(0.92));
  mat.colorNode = mix(finalWall, roofCol, isRoofish);
  mat.aoNode = mix(londonCanyonAO(), float(1.0), isRoofish.mul(0.7));

  const glassy = winMaskUp.mul(float(1.0).sub(frame)).add(shopZone.mul(shopGlass));
  mat.roughnessNode = mix(mix(mix(float(0.88), float(0.62), mStucco.add(isPitched.mul(0.6))), float(0.5), isFlat.mul(stain)), float(0.12), glassy);
  mat.metalnessNode = float(0.0);

  // relief: window reveals, projecting sills, string courses, shop pilasters — derivative bump, faded with distance
  mat.normalNode = Fn(() => {
    // heights from masks filtered over >= 3 px: sharper steps turn into derivative sparkles along every edge
    const fade = float(1.0).sub(smoothstep(20.0, 110.0, camDist)).mul(isWall).mul(float(1.0).sub(shopZone));
    const wu = fwu.mul(3.0), wv = fwv.mul(3.0);
    const rec = filteredPulse(cu, float(0.5).sub(winHalf), float(0.5).add(winHalf), wu).mul(filteredPulse(cv, wY0b, wY1, wv)).mul(winRows);
    const sl = filteredPulse(cv, wY0b.sub(0.04), wY0b, wv).mul(filteredPulse(cu, float(0.5).sub(winHalf).sub(0.045), float(0.5).add(winHalf).add(0.045), wu)).mul(winRows);
    const recess = rec.mul(-0.035).add(sl.mul(0.02));
    return bumpNormal(recess.mul(fade));
  })();

  mat.emissiveNode = Fn(() => {
    const roomGlow = aptRoom.xyz.mul(aptRoom.w).mul(float(1.0).sub(net.mul(0.45))).mul(winMaskUp).mul(float(1.0).sub(frame)).mul(mix(float(0.12), float(1.0), nf));
    const shopGlow = mix(color(0xffd7a0), color(0xfff1dc), shopHash).mul(shopLit).mul(shopGlass).mul(shopZone).mul(mix(float(0.06), float(1.0), nf))
      .mul(display.mul(1.4).add(0.08));
    const signGlow = mix(signCol.mul(0.6), letterCol.mul(2.0), letters).add(0.04).mul(fascia).mul(shopZone).mul(nf).mul(0.5);
    const fanGlow = doorZone.mul(fanlight).mul(color(0xffc77a)).mul(nf).mul(0.6);
    // the street / sky reflected in the panes (emissive: reflections don't depend on how the wall is lit)
    const refl = streetReflect(R, P, seed).mul(fres.mul(0.5).add(0.05)).mul(glassy).mul(float(1.0).sub(nf.mul(0.6))).mul(float(1.0).sub(net.mul(0.3)));
    // at night the street lamps and shop windows wash the lower storeys in warm light (else facades go flat black)
    const wash = wall.mul(color(0xffb978)).mul(nf).mul(float(1.0).sub(smoothstep(1.0, 13.0, y))).mul(float(0.09).add(shop.mul(front).mul(0.06)))
      .mul(float(1.0).sub(winMaskUp));
    return roomGlow.mul(1.5).add(shopGlow).add(signGlow).add(fanGlow).mul(cityUniforms.uInteriorGlow.max(0.2)).add(refl).add(wash).mul(float(1.0).sub(isRoofish));
  })();

  _buildingMat = mat;
  return mat;
}

// soft horizontal groove every `period` m (rustication)
function gridLineSoft(y, period, hw) {
  const g = y.div(period);
  return filteredPulse(fract(g), 0.0, float(hw).div(period), fwidth(g).max(0.0005));
}
function brickColFor(base, mortar, jit) {
  return mix(color(0x6a4a36), base, 0.5).mul(float(1.0).add(jit.mul(0.2))).mul(float(1.0).sub(mortar.mul(0.2)));
}

// ---------------------------------------------------------------------------------------------------------------------
// Glass curtain walls (towers of the City, South Bank, King's Cross, Nine Elms)
// ---------------------------------------------------------------------------------------------------------------------
let _glassMat = null;
export function createLondonGlassMaterial() {
  if (_glassMat) return _glassMat;
  const mat = new THREE.MeshStandardNodeMaterial({ roughness: 0.08, metalness: 0.7 });
  mat.name = 'LondonGlass';
  const fu = attribute('bfu', 'vec2');
  const info = attribute('binfo', 'vec4');
  const bcol = attribute('bcol', 'vec4');
  // quantized: an interpolated u8 drifts in its last bits, which the sin-hashes below would turn into speckle
  const seed = dec255(info.x).div(255.0);
  const v4 = bcol.a; // per-building variant: storey height, spandrel share, fins
  const P = positionWorld;
  const nW = normalWorldGeometry;
  const fh = mix(float(3.8), float(4.2), step(0.5, v4));
  const spandrel = mix(mix(float(0.06), float(0.3), step(0.35, v4)), float(0.16), step(0.8, v4)); // full-height glazing vs. banded
  const gv = P.y.div(fh);
  const cv = fract(gv);
  const floorIdx = floor(gv);
  const u = fu.x;
  const cu = fract(u);
  const bay = floor(u);
  const fwu = fwidth(u).max(0.0005);
  const fwv = fwidth(gv).max(0.0005);
  const eave = fu.y;
  const crown = step(eave.sub(3.0), P.y);
  // plant floor every ~12 storeys on the banded towers (louvres)
  const plantFloor = step(mod(floorIdx.add(floor(seed.mul(7.0))), 12.0), 0.5).mul(step(3.0, floorIdx)).mul(step(0.35, v4));
  // mullions; vertical fins on every other bay of some towers
  const finTower = step(0.62, v4).mul(step(v4, 0.8));
  const mull = float(1.0).sub(filteredPulse(cu, mix(float(0.035), float(0.08), finTower), mix(float(0.965), float(0.92), finTower), fwu));
  const span = filteredPulse(cv, 0.0, spandrel, fwv);
  const pane = float(1.0).sub(max(mull, span)).mul(float(1.0).sub(crown)).mul(float(1.0).sub(plantFloor));
  const viewDir = normalize(cameraPosition.sub(P));
  // per-pane tilt warble (pillowed panes break up the reflection)
  const pr = vec2(hash2D(vec2(bay, floorIdx).add(seed)), hash2D(vec2(floorIdx, bay).add(3.3))).sub(0.5).mul(0.06);
  const pillow = vec2(cu.sub(0.5), cv.sub(0.55)).mul(0.08);
  const nP = normalize(nW.add(vec3(pr.x.add(pillow.x), pr.y.add(pillow.y), pr.x.negate())));
  const R = reflect(viewDir.negate(), nP);
  const fres = pow(clamp(float(1.0).sub(abs(dot(viewDir, nP))), 0.0, 1.0), 2.2);
  const sky = skyReflect(R);
  // reflected neighbour towers: silhouettes low in the reflected sky, with their own window grid
  const az = dot(R.xz, vec2(0.7, 0.7)).mul(7.0).add(u.mul(0.03)).add(seed.mul(5.0));
  const tH = hash2D(vec2(floor(az), seed.mul(9.0))).mul(0.4).add(0.02).sub(P.y.mul(0.0015)).max(-0.1);
  const elevAA = fwidth(R.y).add(0.01);
  const inTower = smoothstep(tH.add(elevAA), tH.sub(elevAA), R.y);
  const rg = filteredPulse(fract(az.mul(14.0)), 0.3, 1.0, fwidth(az.mul(14.0))).mul(filteredPulse(fract(R.y.mul(40.0)), 0.35, 1.0, fwidth(R.y.mul(40.0))));
  const towerCol = mix(mix(color(0x1a2026), color(0x3e474f), hash2D(vec2(floor(az), 2.0))), color(0x0c1014), rg.mul(0.5))
    .add(color(0xffd494).mul(rg).mul(night()).mul(0.5));
  const env = mix(sky, towerCol, inTower.mul(0.75));
  const tint = lin(bcol.rgb).mul(mix(float(0.88), float(1.12), hash2D(vec2(floor(bay.mul(0.13)), floorIdx.add(seed.mul(31.0))))));
  // the offices behind the glass (3D interior mapping), seen when looking into the panes
  const winUV = clamp(vec2(cu.sub(0.035).div(0.93), cv.sub(spandrel).div(float(1.0).sub(spandrel).max(0.05))), vec2(0.0), vec2(1.0));
  const office = evaluateApartmentInterior(u.mul(1.5), P.y, winUV, vec2(bay, floorIdx), float(1.5), fh, seed.mul(61.0), float(0.2),
    mix(float(0.12), float(0.38), night()), vec2(fwu, fwv));
  const inside = mix(office.xyz.mul(color(0xa8b8c0)).mul(0.6), tint.mul(0.3), float(0.55));
  const glass = mix(inside, env, fres.mul(0.75).add(0.22));
  const sunSpec = pow(max(dot(R, normalize(cityUniforms.uSkySunDir)), 0.0), 60.0).mul(2.0);
  const frameCol = mix(tint.mul(0.6), mix(color(0x8c9196), color(0x3a3d40), step(0.5, seed)), 0.5);
  const spandrelCol = mix(frameCol.mul(0.7), tint.mul(0.45), 0.5);
  const louvre = frameCol.mul(mix(float(0.55), float(0.9), filteredPulse(fract(P.y.mul(5.0)), 0.0, 0.5, fwidth(P.y.mul(5.0)).max(0.001))));
  const wallCol = mix(mix(frameCol, spandrelCol, span.mul(float(1.0).sub(mull))), louvre, plantFloor);
  mat.colorNode = mix(mix(wallCol, glass.add(cityUniforms.uSunColor.mul(sunSpec)), pane), frameCol.mul(0.8), crown);
  mat.roughnessNode = mix(float(0.45), float(0.06), pane);
  mat.metalnessNode = mix(float(0.3), float(0.75), pane);
  mat.aoNode = londonCanyonAO();
  mat.normalNode = Fn(() => {
    const fade = float(1.0).sub(smoothstep(30.0, 160.0, length(cameraPosition.sub(P))));
    const relief = float(1.0).sub(filteredPulse(cu, mix(float(0.035), float(0.08), finTower), mix(float(0.965), float(0.92), finTower), fwu.mul(3.0)))
      .mul(mix(float(0.03), float(0.12), finTower));
    return bumpNormal(relief.mul(fade));
  })();
  mat.emissiveNode = Fn(() => {
    const nf = night();
    // offices light runs of panes (2-7 bays) per floor, a few whole floors; cleaners' floors cooler
    const runW = floor(hash2D(vec2(floorIdx, seed.mul(37.0))).mul(6.0)).add(2.0);
    const g = hash2D(vec2(floor(bay.div(runW)).add(seed.mul(371.0)), floorIdx.add(seed.mul(53.0))));
    const fl = hash2D(vec2(floorIdx, seed.mul(91.0)));
    const lit = step(g, mix(float(0.08), float(0.32), nf)).max(step(fl, nf.mul(0.07)));
    const col = mix(color(0xd8e6ff), color(0xffefd0), step(0.55, fl));
    const dim = mix(float(0.35), float(0.85), hash2D(vec2(bay, floorIdx).add(seed.mul(7.0))));
    const ceil = mix(float(0.55), float(1.0), smoothstep(0.55, 0.95, cv)); // ceiling panels glow brighter
    // the lit runs tint the interior-mapped office behind (floor, desks' lamp pool, back wall) instead of flat panels
    const room = office.xyz.mul(office.w).mul(0.9);
    return col.mul(lit).mul(dim).mul(ceil).mul(mix(float(0.12), float(0.42), smoothstep(0.0, 0.6, length(office.xyz)))).add(room).mul(pane).mul(float(1.0).sub(fres.mul(0.6))).mul(mix(float(0.03), float(0.9), nf)).mul(cityUniforms.uInteriorGlow.max(0.2));
  })();
  _glassMat = mat;
  return mat;
}

// ---------------------------------------------------------------------------------------------------------------------
// Ground-level surfaces
// ---------------------------------------------------------------------------------------------------------------------
/** water mask: a signed-distance texture (metres, >0 on land) over the world bounds — see js/city/water.js */
export const waterSDF = { tex: null, minX: 0, minZ: 0, sizeX: 1, sizeZ: 1, range: 16 };
function landMaskNode() {
  if (!waterSDF.tex) return null;
  const S = waterSDF;
  const tuv = vec2(positionWorld.x.sub(S.minX).div(S.sizeX), positionWorld.z.sub(S.minZ).div(S.sizeZ));
  const d = texture(S.tex, tuv).r.sub(0.5).mul(S.range * 2);
  return d.greaterThan(0.0);
}

let _asphalt = null;
/** carriageways & junctions (scol.rgb tint: tarmac grey / red bus lane / cycle lane; scol.a: wear) */
export function createAsphaltMaterial() {
  if (_asphalt) return _asphalt;
  const mat = new THREE.MeshStandardNodeMaterial({ roughness: 0.9, metalness: 0.0 });
  mat.name = 'LondonAsphalt';
  const sc = attribute('scol', 'vec4');
  const P = positionWorld.xz;
  const n1 = noise2D(P.mul(0.08));
  const n2 = noise2D(P.mul(0.9));
  const n3 = noise2D(P.mul(7.0));
  const patch = smoothstep(0.62, 0.66, noise2D(P.mul(0.045).add(17.0)));
  const wet = cityUniforms.uRoadWetness;
  const puddle = smoothstep(0.58, 0.72, noise2D(P.mul(0.11).add(5.0))).mul(wet);
  // worn London tarmac is a mid grey (the baked tint is fresh-laid black), darker where it was resurfaced
  const base = lin(sc.rgb).mul(1.55).mul(mix(float(0.82), float(1.12), n1)).mul(mix(float(0.9), float(1.08), n3));
  // sealed cracks: thin dark tar lines along noise contours, filtered so they fade before they alias
  const cn = noise2D(P.mul(0.6).add(31.0));
  const crackW = fwidth(cn).max(0.0005);
  const crack = float(1.0).sub(smoothstep(0.0, crackW.mul(1.5).add(0.004), abs(cn.sub(0.5)))).mul(float(1.0).sub(smoothstep(0.01, 0.05, crackW)))
    .mul(smoothstep(0.55, 0.7, noise2D(P.mul(0.05).add(3.0))));
  // utility covers: a cast-iron square every so often
  const cell = floor(P.div(7.0));
  const ch = hash2D(cell.add(4.2));
  const cp = fract(P.div(7.0)).sub(0.5).mul(7.0);
  const fwc = fwidth(P.x).max(0.001);
  const cover = step(0.93, ch).mul(filteredPulse(cp.x.div(1.4).add(0.5), 0.25, 0.75, fwc.div(1.4))).mul(filteredPulse(cp.y.div(1.4).add(0.5), 0.25, 0.75, fwc.div(1.4)));
  const coverCol = mix(color(0x2a2a2a), color(0x46443f), filteredPulse(fract(cp.x.mul(6.0)), 0.0, 0.5, fwc.mul(6.0)));
  let col = mix(base, base.mul(0.72), patch);
  col = mix(col, col.mul(0.6), crack.mul(0.5));
  col = mix(col, coverCol, cover).mul(mix(float(1.0), float(0.62), wet.mul(0.6).add(puddle.mul(0.4))));
  mat.colorNode = col.mul(mix(float(1.0), float(0.93), n2));
  mat.roughnessNode = mix(mix(float(0.92), float(0.55), wet), float(0.08), puddle);
  _asphalt = mat;
  return mat;
}

let _paving = null;
/** pavements (York-stone flags along the kerb + granite kerb), plazas & pedestrian streets (scol.a > 0.4: big
 * world-aligned slabs), park paths (scol.a > 0.8: gravel) */
export function createPavingMaterial() {
  if (_paving) return _paving;
  const mat = new THREE.MeshStandardNodeMaterial({ roughness: 0.85, metalness: 0.0 });
  mat.name = 'LondonPaving';
  const sc = attribute('scol', 'vec4');
  const st = uv();
  const P = positionWorld.xz;
  const isPlaza = step(0.4, sc.a).mul(step(sc.a, 0.8));
  const isGravel = step(0.8, sc.a);
  // flags along the kerb: 0.9 x 0.6 m, staggered rows
  const fv = st.y.div(0.6);
  const fuu = st.x.div(0.9).add(mod(floor(fv), 2.0).mul(0.5));
  const pu = mix(fuu, P.x.div(1.2), isPlaza);
  const pv = mix(fv, P.y.div(0.8).add(mod(floor(P.x.div(1.2)), 2.0).mul(0.5)), isPlaza);
  const jnt = float(1.0).sub(filteredPulse(fract(pu), 0.0, 0.97, fwidth(pu).max(0.0005)).mul(filteredPulse(fract(pv), 0.0, 0.96, fwidth(pv).max(0.0005))));
  const fid = vec2(floor(pu), floor(pv));
  const fj = hash2D(fid).sub(0.5);
  const n1 = noise2D(P.mul(0.3));
  const n3 = noise2D(P.mul(6.0));
  const wet = cityUniforms.uRoadWetness;
  const kerb = step(st.y, 0.3).mul(float(1.0).sub(isPlaza)).mul(float(1.0).sub(isGravel));
  // the baked tints read too bright under a clear sun: London flags are a weathered mid grey
  const scl = lin(sc.rgb).mul(0.72);
  // stains, chewing-gum spots and a darker band of grime along the building line / kerb
  const stain = smoothstep(0.58, 0.85, noise2D(P.mul(0.7).add(3.0))).mul(0.16);
  const gum = step(0.985, hash2D(floor(P.mul(4.0)))).mul(float(1.0).sub(smoothstep(0.05, 0.2, fwidth(P.x.mul(4.0))))).mul(0.35);
  const edgeGrime = smoothstep(0.6, 0.3, st.y).mul(0.08).mul(float(1.0).sub(isPlaza)).mul(float(1.0).sub(isGravel));
  const flag = scl.mul(float(1.0).add(fj.mul(0.2))).mul(float(1.0).sub(jnt.mul(0.35))).mul(mix(float(0.86), float(1.05), n1))
    .mul(float(1.0).sub(stain).sub(gum).sub(edgeGrime));
  const kerbCol = mix(color(0x6e6e6c), color(0x8a8986), n3).mul(float(1.0).sub(filteredPulse(fract(st.x.div(0.9)), 0.0, 0.02, fwidth(st.x.div(0.9)).max(0.0005)).mul(0.4)));
  const gravel = mix(scl.mul(0.85), scl.mul(1.08), n3).mul(mix(float(0.9), float(1.05), n1));
  const col = mix(mix(flag, kerbCol, kerb), gravel, isGravel);
  mat.colorNode = col.mul(mix(float(1.0), float(0.7), wet.mul(0.5)));
  mat.roughnessNode = mix(float(0.88), float(0.45), wet.mul(0.6));
  _paving = mat;
  return mat;
}

let _marking = null;
/** road markings: scol.rgb = paint colour (white / yellow / red), scol.a = emissive retro-reflection share */
export function createMarkingMaterial() {
  if (_marking) return _marking;
  const mat = new THREE.MeshStandardNodeMaterial({ roughness: 0.6, metalness: 0.0 });
  mat.name = 'LondonMarkings';
  const sc = attribute('scol', 'vec4');
  const P = positionWorld.xz;
  const wear = smoothstep(0.35, 0.75, noise2D(P.mul(1.3))).mul(0.45).add(noise2D(P.mul(9.0)).mul(0.15));
  mat.colorNode = mix(lin(sc.rgb), color(0x202022), wear).mul(mix(float(1.0), float(0.75), cityUniforms.uRoadWetness.mul(0.5)));
  mat.emissiveNode = lin(sc.rgb).mul(sc.a).mul(night()).mul(0.04);
  mat.polygonOffset = true;
  mat.polygonOffsetFactor = -1;
  mat.polygonOffsetUnits = -2;
  _marking = mat;
  return mat;
}

let _ground = null;
/** street-frontage mask (js/city/ground.js buildStreetMask): 1 along the streets, 0 deep inside the blocks */
export const streetMask = { tex: null, minX: 0, minZ: 0, sizeX: 1, sizeZ: 1 };
/** the base ground under everything, cut away over water: paved forecourts / areas along the streets (York-stone
 * flags & concrete, grimy, matching the pavements), yards & back gardens (hardstanding, worn grass) inside the blocks */
export function createGroundMaterial() {
  if (_ground) return _ground;
  const mat = new THREE.MeshStandardNodeMaterial({ roughness: 0.95, metalness: 0.0 });
  mat.name = 'LondonGround';
  const P = positionWorld.xz;
  const n1 = noise2D(P.mul(0.035));
  const n2 = noise2D(P.mul(0.4));
  const n3 = noise2D(P.mul(3.0));
  const green = smoothstep(0.55, 0.7, n1);
  const hard = mix(color(0x6a6966), color(0x7d7b76), n2);
  const yard = mix(color(0x55603f), color(0x66704a), n2);
  const inner = mix(hard, yard, green.mul(0.65));
  // world-aligned flags 0.9 x 0.6 m, a patch of concrete or tarmac here and there
  const fv = P.y.div(0.6);
  const fu = P.x.div(0.9).add(mod(floor(fv), 2.0).mul(0.5));
  const jnt = float(1.0).sub(filteredPulse(fract(fu), 0.0, 0.965, fwidth(fu).max(0.0005)).mul(filteredPulse(fract(fv), 0.0, 0.955, fwidth(fv).max(0.0005))));
  const fj = hash2D(vec2(floor(fu), floor(fv))).sub(0.5).mul(float(1.0).sub(smoothstep(0.1, 0.4, fwidth(fu))));
  const flagCol = mix(color(0x8c8880), color(0x9a958b), n2).mul(float(1.0).add(fj.mul(0.14))).mul(float(1.0).sub(jnt.mul(0.3)));
  const tarmac = mix(color(0x45464a), color(0x55565a), n3);
  const paved = mix(flagCol, tarmac, smoothstep(0.68, 0.72, noise2D(P.mul(0.05).add(7.0))).mul(0.85)).mul(mix(float(0.82), float(1.03), n1));
  let street = float(0.0);
  if (streetMask.tex) {
    const S = streetMask;
    street = texture(S.tex, vec2(positionWorld.x.sub(S.minX).div(S.sizeX), positionWorld.z.sub(S.minZ).div(S.sizeZ))).r;
  }
  mat.colorNode = mix(inner, paved, smoothstep(0.25, 0.75, street));
  const wet = cityUniforms.uRoadWetness;
  mat.roughnessNode = mix(float(0.95), float(0.6), wet.mul(street));
  const m = landMaskNode();
  if (m) mat.maskNode = m;
  _ground = mat;
  return mat;
}

let _grass = null;
/** parks, gardens, pitches, woods (scol.rgb = grass tint, scol.a: 0 lawn · 0.3 pitch (stripes) · 0.6 wood floor · 0.9 rubber) */
export function createGrassMaterial() {
  if (_grass) return _grass;
  const mat = new THREE.MeshStandardNodeMaterial({ roughness: 0.95, metalness: 0.0 });
  mat.name = 'LondonGrass';
  const sc = attribute('scol', 'vec4');
  const P = positionWorld.xz;
  const n1 = noise2D(P.mul(0.05));
  const n2 = noise2D(P.mul(0.5));
  const n3 = noise2D(P.mul(4.0));
  const pitch = step(0.2, sc.a).mul(step(sc.a, 0.45));
  const wood = step(0.45, sc.a).mul(step(sc.a, 0.75));
  const rubber = step(0.75, sc.a);
  const stripes = filteredPulse(fract(P.x.add(P.y.mul(0.3)).div(9.0)), 0.0, 0.5, fwidth(P.x.div(9.0)).max(0.001));
  const lawn = lin(sc.rgb).mul(mix(float(0.82), float(1.1), n1)).mul(mix(float(0.9), float(1.06), n2)).mul(mix(float(0.92), float(1.04), n3));
  const pitchCol = lawn.mul(mix(float(0.9), float(1.08), stripes));
  const woodCol = mix(color(0x3b3a24), color(0x4d4a2a), n2).mul(mix(float(0.8), float(1.1), n3));
  const rubberCol = mix(color(0x7a3a30), color(0x2f5d47), step(0.5, n1));
  mat.colorNode = mix(mix(mix(lawn, pitchCol, pitch), woodCol, wood), rubberCol, rubber);
  const m = landMaskNode();
  if (m) mat.maskNode = m;
  _grass = mat;
  return mat;
}

let _stone = null;
/** embankment walls, bridge fascias & piers, parapets: ashlar from the face normal (scol.rgb = stone colour) */
export function createStoneMaterial() {
  if (_stone) return _stone;
  const mat = new THREE.MeshStandardNodeMaterial({ roughness: 0.85, metalness: 0.0 });
  mat.name = 'LondonStone';
  const sc = attribute('scol', 'vec4');
  const P = positionWorld;
  const nW = normalWorldGeometry;
  const tang = normalize(vec2(nW.z.negate(), nW.x).add(vec2(0.0001, 0.0)));
  const along = dot(P.xz, tang);
  const up = step(0.7, abs(nW.y));
  const av = P.y.div(0.55);
  const au = mix(along.div(1.1).add(mod(floor(av), 2.0).mul(0.5)), P.x.div(1.1), up);
  const av2 = mix(av, P.z.div(0.55), up);
  const jn = float(1.0).sub(filteredPulse(fract(au), 0.0, 0.97, fwidth(au).max(0.0005)).mul(filteredPulse(fract(av2), 0.0, 0.95, fwidth(av2).max(0.0005))));
  const n1 = noise2D(vec2(along.mul(0.3), P.y.mul(0.2)));
  const tide = smoothstep(-0.6, -1.6, P.y).mul(0.45); // tide-stained base
  const j = hash2D(vec2(floor(au), floor(av2))).sub(0.5);
  const stoneCol = lin(sc.rgb).mul(float(1.0).add(j.mul(0.14))).mul(float(1.0).sub(jn.mul(0.28))).mul(mix(float(0.78), float(1.05), n1)).mul(float(1.0).sub(tide));
  // scol.a > 0.5: railway viaduct brickwork with arches every 7.5 m (openings 5.2 m wide, crown 6.4 m up)
  const arched = step(0.5, sc.a).mul(float(1.0).sub(up));
  const ac = fract(along.div(7.5)).sub(0.5).mul(7.5);
  const rad = float(2.6);
  const inArch = step(abs(ac), rad).mul(max(step(P.y, 3.8), step(ac.mul(ac).add(P.y.sub(3.8).mul(P.y.sub(3.8))), rad.mul(rad))));
  const course = filteredPulse(fract(P.y.div(0.075)), 0.0, 0.85, fwidth(P.y.div(0.075)).max(0.0005));
  const brick = lin(sc.rgb).mul(mix(float(0.8), float(1.0), course)).mul(mix(float(0.75), float(1.05), n1));
  mat.colorNode = mix(stoneCol, mix(brick, color(0x0d0c0b), inArch), arched);
  _stone = mat;
  return mat;
}

let _water = null;
/** Thames / lakes / canals: tidal brown-green-grey with wind ripples, fresnel sky, sun glitter, night light streaks */
export function createLondonWaterMaterial() {
  if (_water) return _water;
  const mat = new THREE.MeshStandardNodeMaterial({ roughness: 0.06, metalness: 0.0 });
  mat.name = 'LondonWater';
  const sc = attribute('scol', 'vec4');
  const P = positionWorld.xz;
  const t = time;
  // two scrolling ripple layers -> normal from finite differences of a height field
  const h = (q) => noise2D(q.mul(0.35).add(vec2(t.mul(0.05), t.mul(0.021)))).mul(0.6)
    .add(noise2D(q.mul(1.3).add(vec2(t.mul(-0.09), t.mul(0.13)))).mul(0.3))
    .add(noise2D(q.mul(4.1).add(vec2(t.mul(0.21), t.mul(-0.17)))).mul(0.1));
  const e = 0.25;
  const h0 = h(P);
  const hx = h(P.add(vec2(e, 0.0)));
  const hz = h(P.add(vec2(0.0, e)));
  const dist = length(cameraPosition.sub(positionWorld));
  const amp = mix(float(0.32), float(0.04), smoothstep(20.0, 600.0, dist));
  const N = normalize(vec3(h0.sub(hx).mul(amp).div(e), float(1.0), h0.sub(hz).mul(amp).div(e)));
  const V = normalize(cameraPosition.sub(positionWorld));
  const R = reflect(V.negate(), N);
  const fres = float(0.02).add(float(0.98).mul(pow(clamp(float(1.0).sub(dot(V, N)), 0.0, 1.0), 5.0)));
  // tidal water: silt-brown in the shallows / by the walls, greener mid-stream, with slow current streaks and the
  // wind-roughened sheen that catches the sky even from above
  const current = noise2D(vec2(P.x.mul(0.004), P.y.mul(0.02)).add(vec2(t.mul(0.003), 0.0)));
  const deep = lin(sc.rgb).mul(mix(float(0.8), float(1.15), current)).mul(mix(float(0.9), float(1.05), noise2D(P.mul(0.05).add(t.mul(0.01)))));
  const sky = skyReflect(R);
  const sun = pow(max(dot(R, normalize(cityUniforms.uSkySunDir)), 0.0), 220.0).mul(6.0).mul(float(1.0).sub(night()));
  const glitter = pow(max(dot(R, normalize(cityUniforms.uSkySunDir)), 0.0), 40.0).mul(smoothstep(0.55, 0.8, h0)).mul(1.5).mul(float(1.0).sub(night()));
  mat.colorNode = mix(deep, sky.mul(0.85), fres.mul(0.65).add(0.12)).add(cityUniforms.uSunColor.mul(sun.add(glitter)));
  mat.roughnessNode = float(0.08);
  // the ripple normal lights the water too (sun glints, sky sheen from the IBL), fading with distance like the ripples
  mat.normalNode = transformNormalToView(N);
  mat.emissiveNode = Fn(() => {
    // night: the city's lights reflect as streaks stretched toward the viewer, broken up by the ripples
    const nf = night();
    const fwd = normalize(positionWorld.xz.sub(cameraPosition.xz).add(vec2(0.001, 0.0)));
    const side = vec2(fwd.y.negate(), fwd.x);
    const q = vec2(dot(P, side).mul(0.09), dot(P, fwd).mul(0.006));
    const streak = smoothstep(0.7, 0.95, noise2D(q.add(vec2(h0.mul(0.4), 0.0))));
    const glint = smoothstep(0.35, 0.85, h0.add(hx.sub(hz).mul(3.0)));
    return color(0xffc27a).mul(streak).mul(glint).mul(nf).mul(0.22).mul(fres.add(0.15));
  })();
  _water = mat;
  return mat;
}

let _ballast = null;
export function createBallastMaterial() {
  if (_ballast) return _ballast;
  const mat = new THREE.MeshStandardNodeMaterial({ roughness: 0.95, metalness: 0.0 });
  mat.name = 'LondonBallast';
  const st = uv();
  const P = positionWorld.xz;
  const n = noise2D(P.mul(8.0));
  // sleepers every 0.65 m across the 2.6 m sleeper band
  const sl = filteredPulse(fract(st.x.div(0.65)), 0.0, 0.38, fwidth(st.x.div(0.65)).max(0.001)).mul(step(abs(st.y), 1.3));
  mat.colorNode = mix(mix(color(0x5a544c), color(0x77706a), n), color(0x3b332c), sl.mul(0.85));
  _ballast = mat;
  return mat;
}

/** plain coloured standard material (props), cached by key */
const _plain = new Map();
export function plainMaterial(hex, roughness = 0.6, metalness = 0.0, opts = {}) {
  const key = `${hex}_${roughness}_${metalness}_${JSON.stringify(opts)}`;
  let m = _plain.get(key);
  if (!m) {
    m = new THREE.MeshStandardNodeMaterial({ color: hex, roughness, metalness, ...opts });
    _plain.set(key, m);
  }
  return m;
}
/** vertex-coloured standard material (props merged with a 'color' attribute) */
let _vcol = null;
export function vertexColorMaterial() {
  if (!_vcol) {
    _vcol = new THREE.MeshStandardNodeMaterial({ vertexColors: true, roughness: 0.55, metalness: 0.1 });
    _vcol.name = 'LondonProps';
  }
  return _vcol;
}
/** glowing lamp glass: dim by day, lit by uInteriorGlow at night; optional blink (Belisha beacons) */
const _glow = new Map();
export function glowMaterial(hex, { blink = 0, day = 0.08 } = {}) {
  const key = hex + '_' + blink + '_' + day;
  let m = _glow.get(key);
  if (!m) {
    m = new THREE.MeshBasicNodeMaterial();
    const c = color(hex);
    const on = blink > 0 ? step(0.5, fract(time.mul(blink))) : float(1.0);
    m.colorNode = c.mul(mix(float(day), float(1.6), night()).mul(on).add(c.mul(0.15)));
    m.name = 'LondonGlow';
    _glow.set(key, m);
  }
  return m;
}

let _pool = null;
/** additive warm pool of lamp light on the ground under each lamp (instanced quads; only shows at night) */
export function lampPoolMaterial() {
  if (_pool) return _pool;
  const m = new THREE.MeshBasicNodeMaterial({ transparent: true, depthWrite: false, blending: THREE.AdditiveBlending });
  const d = length(uv().sub(0.5)).mul(2.0);
  const fall = pow(clamp(float(1.0).sub(d), 0.0, 1.0), 2.2);
  m.colorNode = color(0xffb766).mul(fall).mul(night()).mul(0.32);
  m.opacityNode = float(1.0);
  m.polygonOffset = true; m.polygonOffsetFactor = -2; m.polygonOffsetUnits = -4;
  m.name = 'LampPool';
  _pool = m;
  return m;
}


// Brussels port compatibility names. The procedural implementations are shared
// with the original city renderer; expose the names consumed by brussels-base-city.js.
export {
  createLondonBuildingMaterial as createBrusselsBuildingMaterial,
  createLondonGlassMaterial as createBrusselsGlassMaterial,
  createLondonWaterMaterial as createBrusselsWaterMaterial
};
