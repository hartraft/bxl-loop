import * as THREE from 'three/webgpu';
import {
  Fn,
  uniform,
  float,
  vec2,
  vec3,
  vec4,
  dot,
  mix,
  min,
  max,
  pow,
  smoothstep,
  length,
  screenUV,
  screenSize
} from 'three/tsl';
import { bloom } from 'three/addons/tsl/display/BloomNode.js';

// js/post-processing.js — Workstream E
// Scene-linear colour grade and lens bloom, composed in the final render pass. Brussels look: by day a touch cooler
// and less saturated than the NY grade (soft northern light, Portland stone & grey brick); at night a split tone of
// warm sodium / amber highlights over cool LED-blue shadows. Weather eases contrast & saturation (overcast, drizzle)
// and lets bloom bleed in fog.
//
//   const grade = createPostProcessing(renderer, sceneColor, reflections);
//   grade.outputNode                    // for new THREE.RenderPipeline(renderer, grade.outputNode)
//   grade.applyPreset('golden' | 'midday' | 'twilight' | 'midnight')
//   grade.applyWeather('clear' | 'overcast' | 'drizzle' | 'fog')

// exposure, contrast, saturation, white balance, split-tone (shadow tint, highlight tint), bloom strength, threshold
const LOOKS = {
  // golden: bloom only on what is really bright (a low sun in frame used to wash the whole view out)
  golden:   { exposure: 0.98, contrast: 1.08, saturation: 1.0, balance: [1.03, 1.0, 0.97], shadow: [0.97, 1.0, 1.04], high: [1.03, 1.005, 0.97], bloom: 0.16, threshold: 1.6 },
  midday:   { exposure: 1.0, contrast: 1.07, saturation: 0.95, balance: [0.99, 1.0, 1.02], shadow: [0.975, 1.0, 1.035], high: [1.01, 1.0, 0.99], bloom: 0.16, threshold: 1.35 },
  twilight: { exposure: 1.06, contrast: 1.09, saturation: 1.02, balance: [1.0, 0.995, 1.03], shadow: [0.95, 0.995, 1.07], high: [1.05, 1.0, 0.94], bloom: 0.28, threshold: 1.05 },
  midnight: { exposure: 1.05, contrast: 1.08, saturation: 1.04, balance: [1.0, 0.99, 1.0], shadow: [0.93, 0.99, 1.09], high: [1.09, 0.995, 0.87], bloom: 0.32, threshold: 0.98 }
};

// weather modifiers: multiply exposure / saturation, add to contrast / bloom / threshold, multiply balance
const WEATHER_LOOKS = {
  clear: { exposure: 1, contrast: 0, saturation: 1, bloom: 0, threshold: 0, balance: [1, 1, 1] },
  overcast: { exposure: 1.05, contrast: -0.04, saturation: 0.88, bloom: 0.02, threshold: 0, balance: [0.99, 1.0, 1.015] },
  drizzle: { exposure: 1.06, contrast: -0.03, saturation: 0.82, bloom: 0.06, threshold: -0.1, balance: [0.98, 1.0, 1.03] },
  fog: { exposure: 1.03, contrast: -0.08, saturation: 0.78, bloom: 0.14, threshold: -0.25, balance: [1.01, 1.0, 0.985] }
};

function createPostProcessing(renderer, sceneColor, reflections) {
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  // Exposure is applied before bloom so its threshold follows the exposed image; RenderPipeline tone-maps once after.
  renderer.toneMappingExposure = 1.0;

  const exposure = uniform(1.0);
  const contrast = uniform(1.0);
  const saturation = uniform(1.0);
  const balance = uniform(new THREE.Vector3(1, 1, 1));
  const shadowTint = uniform(new THREE.Vector3(0.97, 1.0, 1.04));
  const highTint = uniform(new THREE.Vector3(1.03, 1.0, 0.97));
  const reflected = reflections ? sceneColor.rgb.add(reflections.rgb) : sceneColor.rgb;
  const exposed = max(reflected, vec3(0)).mul(exposure).mul(balance);

  // Limit only bloom's peak radiance (RGB together, keeps neon & lamp colours); the HDR image keeps its full range
  const peak = max(max(exposed.r, exposed.g), exposed.b);
  // (5: the sun disc / glare stays a tight glow instead of flooding the frame; lamps and neon are far below it)
  const bloomInput = vec4(exposed.mul(float(5.0).div(max(peak, 5.0))), 1.0);
  const bloomPass = bloom(bloomInput, 0.24, 0.4, 1.2);
  bloomPass.smoothWidth.value = 0.3;
  bloomPass.setResolutionScale(0.5);

  const outputNode = Fn(() => {
    const color = exposed.add(bloomPass.rgb).toVar();
    const luma = dot(color, vec3(0.2126, 0.7152, 0.0722)).toVar();

    // split tone: cool shadows / warm highlights, multiplicative (black level untouched)
    const shadows = mix(shadowTint, vec3(1), smoothstep(0.02, 0.6, luma));
    const highlights = mix(vec3(1), highTint, smoothstep(0.6, 3.0, luma));
    color.mulAssign(shadows.mul(highlights));

    // contrast around middle grey, RGB together
    color.mulAssign(pow(max(luma, 0.0001).div(0.18), contrast.sub(1.0)));
    const gray = dot(color, vec3(0.2126, 0.7152, 0.0722));
    const chroma = max(max(color.r, color.g), color.b).sub(min(min(color.r, color.g), color.b));
    const vibrance = float(0.08).mul(float(1).sub(chroma.div(max(max(max(color.r, color.g), color.b), 0.0001))));
    color.assign(max(mix(vec3(gray), color, saturation.add(vibrance)), vec3(0)));

    const aspect = screenSize.x.div(screenSize.y);
    const radius = length(screenUV.sub(0.5).mul(vec2(aspect, 1))).div(length(vec2(aspect, 1).mul(0.5)));
    const vignette = float(1).sub(smoothstep(0.35, 1.0, radius).mul(0.13));
    return vec4(color.mul(vignette), 1.0);
  })();

  let presetId = 'golden';
  let weatherId = 'clear';
  function apply() {
    const look = LOOKS[presetId] || LOOKS.golden;
    const w = WEATHER_LOOKS[weatherId] || WEATHER_LOOKS.clear;
    exposure.value = look.exposure * w.exposure;
    contrast.value = look.contrast + w.contrast;
    saturation.value = look.saturation * w.saturation;
    balance.value.set(look.balance[0] * w.balance[0], look.balance[1] * w.balance[1], look.balance[2] * w.balance[2]);
    shadowTint.value.set(...look.shadow);
    highTint.value.set(...look.high);
    bloomPass.strength.value = look.bloom + w.bloom;
    bloomPass.threshold.value = Math.max(0.6, look.threshold + w.threshold);
  }
  function applyPreset(id) {
    presetId = LOOKS[id] ? id : 'golden';
    apply();
  }
  function applyWeather(id) {
    weatherId = WEATHER_LOOKS[id] ? id : 'clear';
    apply();
  }

  apply();
  return { outputNode, applyPreset, applyWeather, bloomPass, uniforms: { exposure, contrast, saturation, balance, shadowTint, highTint } };
}

export { createPostProcessing, LOOKS, WEATHER_LOOKS };
