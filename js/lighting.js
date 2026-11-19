import * as THREE from 'three/webgpu';
import {
  Fn,
  float,
  vec3,
  vec4,
  uniform,
  mix,
  fog,
  pmremTexture,
  positionWorld,
  cameraPosition,
  length,
  normalize,
  max,
  exp,
  abs,
  select,
  attribute,
  floor,
  cross,
  smoothstep,
  time,
  varying
} from 'three/tsl';
import { SkyMesh } from 'three/addons/objects/SkyMesh.js';
import { SunLight } from 'three/addons/lights/SunLight.js';
import { SunLightNode } from 'three/addons/lights/SunLightNode.js';
import * as TSLM from './tsl-materials.js';

// js/lighting.js — Workstream E
// Physically-based sky (Preetham SkyMesh + clouds), live PMREM IBL, r186 SunLight (2-cascade CSM) and sky-matched
// aerial fog, with the sun where it really is over London (51.5° N), plus WEATHER:
//
//   const lighting = new LightingSystem(scene, renderer);
//   lighting.applyPreset('golden' | 'midday' | 'twilight' | 'midnight');
//   lighting.setWeather('clear' | 'overcast' | 'drizzle' | 'fog');   // lighting.weather -> current id
//   lighting.onWeatherChange((id, params) => …);                     // params.ssrIntensity: suggested SSR strength
//   lighting.update(focusPos, camera?)                                // every frame (shadow far plane, rain follows camera)
//   import { weatherUniforms } from './lighting.js'                   // TSL uniforms for materials (see below)
//
// weatherUniforms (all TSL uniform floats, 0..1, updated by setWeather / applyPreset):
//   wetness  — how wet the ground is (also written to cityUniforms.uRoadWetness, which tsl-materials' roads read)
//   rain     — rain intensity (streaks drawn here; materials may add ripples / drips)
//   overcast — cloud cover (flat light)
//   fog      — fog thickness

const RAD = Math.PI / 180;
/** world direction toward the sun from its azimuth (deg, clockwise from north) & elevation (deg): x east, y up, z south */
function sunDirection(azimuthDeg, elevationDeg) {
  const a = azimuthDeg * RAD, e = elevationDeg * RAD;
  return new THREE.Vector3(Math.sin(a) * Math.cos(e), Math.sin(e), -Math.cos(a) * Math.cos(e)).normalize();
}

// Sun positions for London in late summer (≈ 25 August, BST). Golden hour sits a little higher than the true
// 19:30 sun so the streets aren't all in shadow; blue hour keeps a low warm key light for readability.
const TIME_PRESETS = {
  golden: {
    id: 'golden',
    name: 'Golden Hour · 18:50',
    // az 264° (not the true ~275°): the Westminster scenic camera looks due west (az 272°) at Elizabeth Tower, and a sun
    // straight behind the tower blew the frame out; 8° south of it the low sun still rakes along the river
    sunDir: sunDirection(264, 13),
    sunColor: 0xffc489,
    sunIntensity: 5.6,
    hemiSky: 0x9fbde3,
    hemiGround: 0xb08a6a, // warm London stock brick & Portland stone bounce
    hemiIntensity: 1.5,
    skyTop: 0x2f5a8e,
    skyHorizon: 0xead0b2,
    fogColor: 0xd8c6b0,
    fogDensity: 0.00026,
    interiorGlow: 0.5,
    roadWetness: 0.12,
    envIntensity: 0.54,
    canyonBounce: 0.5,
    turbidity: 8.5,
    rayleigh: 2.6,
    mieCoefficient: 0.0065,
    mieDirectionalG: 0.82,
    cloudCoverage: 0.42,
    cloudDensity: 0.42,
    skyExposure: 0.148,
    nightFactor: 0.0,
    // weather looks for this time of day: overcast sky grey (linear, × lum), fog tint, rain streak colour
    cloud: { horizon: 0xc9c0b4, zenith: 0xaeb0b4, lum: 0.62, fogTint: 0xc7bba2, rain: 0xd8d4cc }
  },
  midday: {
    id: 'midday',
    name: 'Midday · 13:00',
    sunDir: sunDirection(185, 50),
    sunColor: 0xfff4e6,
    sunIntensity: 5.3, // (6.4 burnt sunlit roofs & pavements to white; London's midday sun is a hazy one)
    hemiSky: 0xa9cdf6,
    hemiGround: 0xa89580,
    hemiIntensity: 1.55,
    skyTop: 0x2a62a6,
    skyHorizon: 0xcfe0f0,
    fogColor: 0xc8d8e8,
    fogDensity: 0.0002,
    interiorGlow: 0.22,
    roadWetness: 0.05,
    envIntensity: 0.58,
    canyonBounce: 0.56,
    turbidity: 6.8,
    rayleigh: 2.2,
    mieCoefficient: 0.006,
    mieDirectionalG: 0.86,
    cloudCoverage: 0.4,
    cloudDensity: 0.38,
    skyExposure: 0.142,
    nightFactor: 0.0,
    cloud: { horizon: 0xd6d8da, zenith: 0xc2c6cb, lum: 0.95, fogTint: 0xc9c8bf, rain: 0xe2e6ea }
  },
  twilight: {
    id: 'twilight',
    name: 'Blue Hour · 20:25',
    sunDir: sunDirection(296, 7),
    sunColor: 0xff9466,
    sunIntensity: 2.9,
    hemiSky: 0x4c6ca8,
    hemiGround: 0x6a5048,
    hemiIntensity: 0.85,
    skyTop: 0x102248,
    skyHorizon: 0xb86b6c,
    fogColor: 0x353c58,
    fogDensity: 0.00032,
    interiorGlow: 1.25,
    roadWetness: 0.25,
    envIntensity: 0.36,
    canyonBounce: 0.32,
    turbidity: 9.5,
    rayleigh: 3.4,
    mieCoefficient: 0.01,
    mieDirectionalG: 0.9,
    cloudCoverage: 0.4,
    cloudDensity: 0.42,
    skyExposure: 0.115,
    nightFactor: 0.28,
    cloud: { horizon: 0x6a6470, zenith: 0x3f4658, lum: 0.2, fogTint: 0x6b6066, rain: 0x9aa0b0 }
  },
  midnight: {
    id: 'midnight',
    name: 'London Night · 23:30',
    sunDir: sunDirection(160, 38), // moonlight
    sunColor: 0x8cb0e8,
    sunIntensity: 1.4,
    hemiSky: 0x263a62,
    hemiGround: 0x3e3230, // sodium-lit pavements
    hemiIntensity: 0.72,
    skyTop: 0x060c1a,
    skyHorizon: 0x1c2436,
    fogColor: 0x0c1424,
    fogDensity: 0.00036,
    interiorGlow: 1.55,
    roadWetness: 0.3,
    envIntensity: 0.3,
    canyonBounce: 0.18,
    turbidity: 4.0,
    rayleigh: 1.5,
    mieCoefficient: 0.004,
    mieDirectionalG: 0.8,
    cloudCoverage: 0.26,
    cloudDensity: 0.28,
    skyExposure: 0.022,
    nightFactor: 0.86,
    // London's cloud base glows orange-brown over the city at night
    cloud: { horizon: 0x9a6640, zenith: 0x4a3830, lum: 0.11, fogTint: 0xa07850, rain: 0xb09070 }
  }
};

// Weather on top of the time of day. overcast: cloud cover (flat light); rain: streak intensity; fog: fog thickness;
// wet: ground wetness; ssr: suggested SSR intensity (puddles reflect more when wet)
const WEATHER = {
  clear: { id: 'clear', name: 'Clear', overcast: 0, rain: 0, fog: 0, wet: 0, ssr: 0.5 },
  overcast: { id: 'overcast', name: 'Overcast', overcast: 1, rain: 0, fog: 0.12, wet: 0.18, ssr: 0.45 },
  drizzle: { id: 'drizzle', name: 'Drizzle', overcast: 1, rain: 1, fog: 0.28, wet: 0.92, ssr: 0.85 },
  fog: { id: 'fog', name: 'Fog', overcast: 0.9, rain: 0, fog: 1, wet: 0.4, ssr: 0.3 }
};

/** shared TSL uniforms for materials (Workstream F reads wetness for the wet road sheen / puddles) */
const weatherUniforms = {
  wetness: uniform(0.12),
  rain: uniform(0),
  overcast: uniform(0),
  fog: uniform(0)
};

const cityUniforms = TSLM.cityUniforms || {};
const setCity = (name, fn) => { const u = cityUniforms[name]; if (u) fn(u); };
const lerp = (a, b, t) => a + (b - a) * t;
const colorLerp = (out, a, b, t) => out.setHex(a).lerp(new THREE.Color(b), t);

/**
 * Rain: N camera-centred streak quads in one draw. Each drop is placed by TSL from its seed in a 48 × 28 × 48 m box
 * that wraps around the camera (drops stay fixed in the world, so they don't swim when the camera turns), falling at
 * ~7 m/s with a little wind; width grows with distance so streaks stay ~1–2 px wide.
 */
function createRain(count = 7000) {
  const geo = new THREE.BufferGeometry();
  const pos = new Float32Array(count * 4 * 3);
  const seed = new Float32Array(count * 4 * 3);
  const corner = new Float32Array(count * 4 * 2);
  const index = new Uint32Array(count * 6);
  let r = 0x9e3779b9;
  const rnd = () => { r ^= r << 13; r ^= r >>> 17; r ^= r << 5; return ((r >>> 0) % 100000) / 100000; };
  for (let i = 0; i < count; i++) {
    const s = [rnd(), rnd(), rnd()];
    for (let c = 0; c < 4; c++) {
      const v = i * 4 + c;
      seed.set(s, v * 3);
      corner[v * 2] = c & 1 ? 1 : -1;
      corner[v * 2 + 1] = c >> 1 ? 1 : 0;
    }
    index.set([i * 4, i * 4 + 1, i * 4 + 2, i * 4 + 2, i * 4 + 1, i * 4 + 3], i * 6);
  }
  geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  geo.setAttribute('aSeed', new THREE.BufferAttribute(seed, 3));
  geo.setAttribute('aCorner', new THREE.BufferAttribute(corner, 2));
  geo.setIndex(new THREE.BufferAttribute(index, 1));

  const uColor = uniform(new THREE.Color(0xd8d4cc));
  const uSpeed = uniform(7.0);
  const uWind = uniform(new THREE.Vector2(1.1, 0.5));
  const B = float(48), H = float(28);
  const aSeed = attribute('aSeed', 'vec3');
  const aCorner = attribute('aCorner', 'vec2');
  const cam = cameraPosition;
  const base = aSeed.mul(vec3(B, H, B));
  const t = time.add(aSeed.x.mul(40.0));
  const wrap = (v, size) => v.sub(size.mul(floor(v.div(size)))); // floored modulo (WGSL % truncates)
  const px = wrap(base.x.add(t.mul(uWind.x)).sub(cam.x.sub(B.mul(0.5))), B).add(cam.x.sub(B.mul(0.5)));
  const py = wrap(base.y.sub(t.mul(uSpeed)).sub(cam.y.sub(H.mul(0.35))), H).add(cam.y.sub(H.mul(0.35)));
  const pz = wrap(base.z.add(t.mul(uWind.y)).sub(cam.z.sub(B.mul(0.5))), B).add(cam.z.sub(B.mul(0.5)));
  const drop = vec3(px, py, pz);
  const dir = normalize(vec3(uWind.x, uSpeed.negate(), uWind.y));
  const toCam = cam.sub(drop);
  const dist = length(toCam);
  const side = normalize(cross(dir, toCam.div(max(dist, 0.001))));
  const len = float(0.3).add(aSeed.z.mul(0.25));
  const width = max(dist.mul(0.0022), 0.004);
  const p = drop.sub(dir.mul(aCorner.y.mul(len))).add(side.mul(aCorner.x.mul(width)));
  const vDist = varying(dist);

  const mat = new THREE.MeshBasicNodeMaterial({ transparent: true, depthWrite: false, fog: false, side: THREE.DoubleSide });
  mat.positionNode = p;
  mat.colorNode = uColor;
  const along = aCorner.y; // interpolated: 0 at the drop's head, 1 at its tail
  const edge = float(1).sub(abs(aCorner.x));
  mat.opacityNode = weatherUniforms.rain.mul(0.32)
    .mul(smoothstep(0.0, 0.6, along).mul(float(1.15).sub(along)))
    .mul(edge.mul(0.6).add(0.4))
    .mul(float(1).sub(smoothstep(14.0, 24.0, vDist))).mul(smoothstep(0.6, 2.2, vDist));
  const mesh = new THREE.Mesh(geo, mat);
  mesh.name = 'WeatherRain';
  mesh.frustumCulled = false;
  mesh.castShadow = false;
  mesh.receiveShadow = false;
  mesh.renderOrder = 10;
  mesh.visible = false;
  mesh.userData.noCulling = true;
  return { mesh, uColor, uSpeed, uWind };
}

class LightingSystem {
  constructor(scene, renderer = null, { captureMode = false } = {}) {
    this.scene = scene;
    this.renderer = renderer;
    this.captureMode = captureMode;
    this.activePresetId = 'golden';
    this.weather = 'clear';
    this.weatherListeners = [];

    if (SunLight.registerNode) {
      SunLight.registerNode(SunLightNode);
    } else if (renderer && renderer.library) {
      renderer.library.addLight(SunLightNode, SunLight);
    }

    this.scene.fog = new THREE.FogExp2(0xdcc5ae, 0.00026);
    // scene.background stays null: SkyMesh draws the dome (a Color background would force-clear the 2nd shadow cascade)
    this.scene.background = null;

    this.sky = new SkyMesh();
    this.sky.scale.setScalar(200000);
    this.sky.cloudScale.value = 0.00018;
    this.sky.cloudSpeed.value = 0.000015;
    this.sky.cloudElevation.value = 0.52;

    // Calibrated sky radiance, the night sky and the overcast cloud deck (a flat CIE-overcast-like grey gradient)
    this.uSkyExposure = uniform(0.148);
    this.uNightFactor = uniform(0.0);
    this.uNightSkyColor = uniform(new THREE.Color(0x0b1528));
    this.uCloudHorizon = uniform(new THREE.Color(0xc9c0b4));
    this.uCloudZenith = uniform(new THREE.Color(0xaeb0b4));
    this.uCloudLum = uniform(0.62);
    const rawSkyNode = this.sky.material.colorNode;
    this.sky.material.colorNode = Fn(() => {
      const dayCol = rawSkyNode.rgb.mul(this.uSkyExposure);
      const clearSky = mix(dayCol, this.uNightSkyColor, this.uNightFactor);
      const dirY = normalize(positionWorld.sub(cameraPosition)).y;
      const deck = mix(this.uCloudHorizon, this.uCloudZenith, smoothstep(0.0, 0.7, max(dirY, 0.0))).mul(this.uCloudLum);
      // below the horizon the deck darkens a little (ground haze)
      const deck2 = deck.mul(mix(float(0.82), float(1.0), smoothstep(-0.2, 0.02, dirY)));
      return vec4(mix(clearSky, deck2, weatherUniforms.overcast.mul(0.94)), float(1.0));
    })();

    if (renderer && renderer.reversedDepthBuffer) {
      const rawSkyVertexNode = this.sky.material.vertexNode;
      this.sky.material.vertexNode = Fn(() => {
        const pos = rawSkyVertexNode.toVar();
        pos.z.assign(0.0);
        return pos;
      })();
    }
    this.scene.add(this.sky);

    // A still capture does not need the expensive PMREM environment bake; the sky dome and direct lights remain.
    this.pmremGenerator = renderer && !this.captureMode ? new THREE.PMREMGenerator(renderer) : null;
    this.envScene = new THREE.Scene();
    this.envRenderTarget = null;

    this.sunLight = new SunLight(0xffc489, 5.6);
    this.sunLight.position.copy(TIME_PRESETS.golden.sunDir);
    this.sunLight.castShadow = true;
    const maxTex = (renderer && renderer.backend && renderer.backend.device && renderer.backend.device.limits.maxTextureDimension2D) || 4096;
    const tile = maxTex >= 6144 ? 3072 : 2048;
    this.sunLight.shadow.mapSize.set(tile, tile);
    this.sunLight.shadow.camera.near = 0.5;
    this.sunLight.shadow.camera.far = 300;
    this.sunLight.shadow.normalBias = 0.05;
    this.scene.add(this.sunLight);

    this.hemiLight = new THREE.HemisphereLight(0x9fbde3, 0xb08a6a, 1.05);
    this.hemiLight.position.set(0, 300, 0);
    this.scene.add(this.hemiLight);

    // aerial fog parameters (uniforms exist before the first preset so it can set them)
    this.uFogDensity = uniform(TIME_PRESETS.golden.fogDensity);
    this.uFogHeight = uniform(900.0);
    this.uFogTint = uniform(new THREE.Color(0xc7bba2));
    this.uFogTintAmount = uniform(0.0);
    this.uFogLinear = uniform(0.0); // adds an exponential (not only Gaussian) term: thick fog shows near the camera too

    this.rain = createRain();
    this.scene.add(this.rain.mesh);

    this.applyPreset('golden', true);

    // Sky-matched aerial perspective: distant surfaces fade into the baked sky radiance just above the horizon in their
    // view direction, through an exponential haze layer (helicopter views stay clearer than the street)
    if (this.envRenderTarget) this.scene.fogNode = this.createAerialFogNode();
  }

  createAerialFogNode() {
    const toFrag = positionWorld.sub(cameraPosition);
    const dist = length(toFrag);
    const dir = toFrag.div(max(dist, 0.001));
    const horizonDir = normalize(vec3(dir.x, max(dir.y, 0.015), dir.z));
    const skyColor = pmremTexture(this.envRenderTarget.texture, horizonDir, float(0.3)).rgb;
    // pea-souper: the fog takes a murky tint of its own (same brightness as the sky it replaces)
    const fogColor = mix(skyColor, this.uFogTint.mul(this.uCloudLum), this.uFogTintAmount);
    const H = this.uFogHeight;
    const ya = max(positionWorld.y, 0.0);
    const yb = max(cameraPosition.y, 0.0);
    const dy = yb.sub(ya);
    const ea = exp(ya.div(H).negate());
    const eb = exp(yb.div(H).negate());
    const meanDensity = select(abs(dy).greaterThan(1.0), ea.sub(eb).mul(H).div(dy), ea);
    const tau = this.uFogDensity.mul(dist).mul(meanDensity);
    return fog(fogColor, float(1.0).sub(exp(tau.mul(tau).add(tau.mul(this.uFogLinear)).negate())));
  }

  bakeEnvironmentMap() {
    if (!this.pmremGenerator) return;
    this.sky.showSunDisc.value = 0;
    const rainVisible = this.rain.mesh.visible;
    this.envScene.add(this.sky);
    this.envRenderTarget = this.pmremGenerator.fromScene(this.envScene, 0, 0.1, 100, { renderTarget: this.envRenderTarget });
    this.scene.environment = this.envRenderTarget.texture;
    this.sky.showSunDisc.value = 1;
    this.scene.add(this.sky);
    this.rain.mesh.visible = rainVisible;
  }

  /** applies time of day × weather */
  applyPreset(presetId, force = false) {
    const p = TIME_PRESETS[presetId] || TIME_PRESETS.golden;
    if (!force && this.activePresetId === p.id && this.envRenderTarget !== null) return;
    this.activePresetId = p.id;
    this.refresh();
  }

  /** 'clear' | 'overcast' | 'drizzle' | 'fog' */
  setWeather(id, force = false) {
    const w = WEATHER[id] || WEATHER.clear;
    if (!force && w.id === this.weather && this.envRenderTarget !== null) return;
    this.weather = w.id;
    this.refresh();
    const params = this.getWeatherParams();
    for (const fn of this.weatherListeners) {
      try { fn(w.id, params); } catch (e) { console.warn('[lighting] onWeatherChange', e); }
    }
  }

  /** subscribe to weather changes: fn(id, params); returns an unsubscribe function */
  onWeatherChange(fn) {
    this.weatherListeners.push(fn);
    return () => { this.weatherListeners = this.weatherListeners.filter((f) => f !== fn); };
  }

  getWeatherParams() {
    const w = WEATHER[this.weather] || WEATHER.clear;
    return { ...w, wetness: weatherUniforms.wetness.value };
  }

  refresh() {
    const p = TIME_PRESETS[this.activePresetId] || TIME_PRESETS.golden;
    const w = WEATHER[this.weather] || WEATHER.clear;
    const oc = w.overcast, fg = w.fog;

    weatherUniforms.overcast.value = oc;
    weatherUniforms.rain.value = w.rain;
    weatherUniforms.fog.value = fg;
    weatherUniforms.wetness.value = Math.max(p.roadWetness, w.wet);

    // sun: dimmed and its shadows softened under cloud (a hint of direction stays)
    this.sunLight.color.setHex(p.sunColor);
    if (oc > 0) this.sunLight.color.lerp(new THREE.Color(p.cloud.horizon), 0.6 * oc);
    this.sunLight.intensity = p.sunIntensity * lerp(1, 0.16, oc);
    this.sunLight.shadow.intensity = lerp(1, 0.28, oc);
    this.sunLight.position.copy(p.sunDir);
    if (oc > 0) this.sunLight.position.lerp(new THREE.Vector3(0, 1, 0), 0.5 * oc).normalize(); // diffuse light reads as top-down
    this.sunLight.updateMatrixWorld();

    // sky light takes over
    const night = p.nightFactor > 0.5;
    colorLerp(this.hemiLight.color, p.hemiSky, night ? p.cloud.horizon : p.cloud.zenith, 0.75 * oc);
    colorLerp(this.hemiLight.groundColor, p.hemiGround, 0x8a8478, 0.45 * oc);
    this.hemiLight.intensity = p.hemiIntensity * lerp(1, night ? 1.9 : 1.45, oc);

    // sky dome
    this.sky.turbidity.value = lerp(p.turbidity, 10, oc);
    this.sky.rayleigh.value = p.rayleigh;
    this.sky.mieCoefficient.value = p.mieCoefficient;
    this.sky.mieDirectionalG.value = p.mieDirectionalG;
    this.sky.cloudCoverage.value = lerp(p.cloudCoverage, 1.0, oc);
    this.sky.cloudDensity.value = lerp(p.cloudDensity, 0.95, oc);
    this.sky.sunPosition.value.copy(p.sunDir);
    this.uSkyExposure.value = p.skyExposure;
    this.uNightFactor.value = p.nightFactor;
    this.uCloudHorizon.value.setHex(p.cloud.horizon);
    this.uCloudZenith.value.setHex(p.cloud.zenith);
    this.uCloudLum.value = p.cloud.lum * (w.rain > 0 ? 0.78 : 1) * (fg > 0.5 ? 1.05 : 1);

    // fog: overcast haze, drizzle murk, or a pea-souper (≈ 250 m visibility at street level, thinning above ~150 m)
    const density = p.fogDensity * lerp(1, 2.4, oc) + fg * (w.id === 'fog' ? 0.0068 : 0.0011);
    this.uFogLinear.value = w.id === 'fog' ? 1.0 : w.rain > 0 ? 0.35 : 0;
    this.uFogDensity.value = density;
    this.uFogHeight.value = w.id === 'fog' ? 150 : lerp(900, 400, oc);
    this.uFogTint.value.setHex(p.cloud.fogTint);
    this.uFogTintAmount.value = w.id === 'fog' ? 0.75 : 0.25 * oc;
    const fogHex = new THREE.Color(p.fogColor).lerp(new THREE.Color(p.cloud.fogTint).multiplyScalar(Math.min(1, p.cloud.lum * 1.4)), Math.max(oc * 0.7, fg));
    this.scene.fog.color.copy(fogHex);
    this.scene.fog.density = density;

    // rain
    this.rain.mesh.visible = w.rain > 0;
    this.rain.uColor.value.setHex(p.cloud.rain);

    setCity('uSunColor', (u) => u.value.copy(this.sunLight.color));
    setCity('uSkyTopColor', (u) => { u.value.setHex(p.skyTop); if (oc) u.value.lerp(new THREE.Color(p.cloud.zenith).multiplyScalar(p.cloud.lum * 1.3), 0.85 * oc); });
    setCity('uSkyHorizonColor', (u) => { u.value.setHex(p.skyHorizon); if (oc) u.value.lerp(new THREE.Color(p.cloud.horizon).multiplyScalar(Math.min(1, p.cloud.lum * 1.3)), 0.85 * oc); });
    setCity('uSkySunDir', (u) => u.value.copy(p.sunDir));
    setCity('uInteriorGlow', (u) => { u.value = p.interiorGlow + (p.nightFactor < 0.5 ? 0.35 * oc : 0); });
    setCity('uRoadWetness', (u) => { u.value = weatherUniforms.wetness.value; });
    setCity('uCanyonBounce', (u) => { u.value = p.canyonBounce * lerp(1, 0.75, oc); });

    this.scene.environmentIntensity = p.envIntensity * lerp(1, 1.15, oc);
    if (!this.captureMode) this.bakeEnvironmentMap();
  }

  update(focusPos) {
    // SunLightShadow fits its 2 cascades to the view each frame; widen the far plane with altitude
    const altitude = focusPos && Number.isFinite(focusPos.y) ? Math.max(0, focusPos.y) : 0;
    this.sunLight.shadow.camera.far = Math.max(300, Math.min(720, 260 + altitude * 1.6));
    // rain thins out above the rooftops (helicopter) — it follows the camera in the shader
    if (this.rain.mesh.visible) {
      const w = WEATHER[this.weather] || WEATHER.clear;
      weatherUniforms.rain.value = w.rain * (altitude > 150 ? Math.max(0.25, 1 - (altitude - 150) / 300) : 1);
    }
  }
}

export { LightingSystem, TIME_PRESETS, WEATHER, weatherUniforms, sunDirection };
