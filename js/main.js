import * as THREE from 'three/webgpu';
import { pass, mrt, output, normalView, positionView, metalness, roughness, vec2, smoothstep } from 'three/tsl';
import { ssr } from 'three/addons/tsl/display/SSRNode.js';
import { createPostProcessing } from './post-processing.js';
import { ClusteredLighting } from 'three/addons/lighting/ClusteredLighting.js';
import { GEO } from './brx-geodata.js';
import { WORLD, getLocationLabel, isTypingInField, TELEPORT_LOCATIONS } from './city-config.js';
import { cityUniforms } from './tsl-materials.js';
import { buildBrusselsCity } from './brussels-base-city.js';
import { buildEdgeBarriers } from './city/edge-barriers.js';
import { WORLD_BOUNDS } from './geo-frame.js';
import { buildBrusselsLandmarks } from './brussels-landmarks.js';
import { buildBrusselsRoadNetwork } from './road-network.js';
import { createTrafficSystem } from './traffic.js';
import { buildRoadPaint } from './road-paint.js';
import { ThirdPersonControllerManager, PLAYER_MODES, MODE_INFO } from './controllers.js';
import { TouchControls } from './touch-controls.js';
import { GamepadControls } from './gamepad-controls.js';
import { CameraSystem, CAMERA_PRESETS } from './cameras.js';
import { LightingSystem } from './lighting.js';
import { BrusselsMapSystem } from './brussels-base-map.js';
import { applyBrusselsHud } from './brussels-base-ui.js';
import { createBackend } from './backend.js';
import { RideBXL } from './ridebxl.js';
import { BusDriver } from './bus-driver.js';
import { setupSceneCulling, updateSceneCulling } from './scene-culling.js';
import { createBrusselsLife } from './life/brussels-base-life.js';
import { createBrusselsAudio } from './audio/brussels-base-audio.js';
import { VEHICLE_UNIFORMS } from './brussels-base-vehicles.js';
import { BRUSSELS_LANDMARKS } from './city-config.js';

// js/main.js
// Main entry point for Brussels Loop (Zone 1 at 1:1 from OpenStreetMap) in three.js WebGPURenderer & TSL (vendored r186)

const URL_PARAMS = new URLSearchParams(location.search);
const LITE = URL_PARAMS.has('lite'); // ?lite: no SSR / smaller shadow work for slower machines
const CITY_NAME = 'Brussels';
const CITY_WATER = 'the canal and ponds';
if (CITY_NAME === 'Brussels') document.title = 'Brussels Loop';

async function initApp() {
  const container = document.getElementById('canvas-container');
  const loadingOverlay = document.getElementById('loading-overlay');
  const loadingStatus = document.getElementById('loading-status');
  const loadingTrack = loadingOverlay ? loadingOverlay.querySelector('.loader-track') : null;
  const loadingFill = document.getElementById('loading-progress');
  // The loading bar sweeps while the city is being built (the main thread is busy) and fills as the shaders compile
  const setLoadingProgress = (p) => {
    if (!loadingFill) return;
    if (loadingTrack) loadingTrack.classList.remove('is-indeterminate');
    loadingFill.style.transform = `scaleX(${Math.min(1, Math.max(0, p))})`;
  };

  if (loadingStatus) {
    loadingStatus.textContent = `Initializing Three.js r${THREE.REVISION} WebGPURenderer & TSL Shaders...`;
  }

  // 1. Initialize Three.js WebGPURenderer with 32-bit float reversedDepthBuffer
  const renderer = new THREE.WebGPURenderer({
    antialias: true,
    powerPreference: 'high-performance',
    forceWebGL: URL_PARAMS.has('webgl'),
    reversedDepthBuffer: true
  });
  renderer.setPixelRatio(1.0);
  renderer.setSize(window.innerWidth, window.innerHeight);
  renderer.shadowMap.enabled = true;
  renderer.lighting = new ClusteredLighting(256, 32, 28, 48);
  container.appendChild(renderer.domElement);

  // Start-up phase timings (logged once as "[init] ...") to keep load-time regressions traceable
  let initTimings = [];
  let initMark = performance.now();
  const markInit = (label) => {
    const now = performance.now();
    initTimings.push(`${label} ${Math.round(now - initMark)}ms`);
    initMark = now;
  };

  await renderer.init();
  markInit('renderer');

  // 2. Build Scene & Physical Atmospheric Sky / PMREM IBL / 4096x4096 Shadow Lighting
  const scene = new THREE.Scene();
  const lightingSystem = new LightingSystem(scene, renderer);
  markInit('lighting');

  const status = (t) => { if (loadingStatus) loadingStatus.textContent = t; };
  // yield so the loading text paints between the long synchronous build steps
  const paint = () => new Promise((r) => requestAnimationFrame(() => setTimeout(r, 0)));

  status(CITY_NAME === 'Brussels' ? 'Raising Brussels landmarks...' : 'Raising Big Ben, the Eye, Tower Bridge & friends...');
  await paint();
  const landmarks = buildBrusselsLandmarks(scene, { world: WORLD, uniforms: cityUniforms });
  markInit('landmarks');

  status(`Building ${CITY_NAME}: ${GEO.buildings.count.toLocaleString('en-GB')} buildings, ${GEO.roads.length.toLocaleString('en-GB')} streets & ${CITY_WATER}...`);
  await paint();
  const city = buildBrusselsCity(scene, { geo: GEO, world: WORLD, landmarkZones: landmarks.zones, onProgress: (label) => status(`Building ${CITY_NAME}: ${label}...`) });
  markInit('city');
  const allColliders = [...landmarks.colliders, ...city.colliders];
  const edgeBarriers = buildEdgeBarriers(scene, { geo: GEO, world: WORLD, bounds: WORLD_BOUNDS });

  status('Timing the traffic lights & routing the 24 to Pimlico...');
  await paint();
  const network = buildBrusselsRoadNetwork(GEO, WORLD);
  let onTrafficHit = null; // bound once the controllers exist (traffic knocks count as collisions for RideBXL)
  const trafficSystem = createTrafficSystem(scene, {
    network, geo: GEO, world: WORLD, sidewalks: city.sidewalks, towerBridge: landmarks.towerBridge,
    onPlayerHit: (e) => onTrafficHit && onTrafficHit(e)
  });
  buildRoadPaint(scene, trafficSystem.network);
  if (city.setSignalPhase && trafficSystem.cityPhaseFn) city.setSignalPhase(trafficSystem.cityPhaseFn(city.signalHeads));
  markInit('traffic');

  const controllerManager = new ThirdPersonControllerManager(scene, allColliders, { world: WORLD, mode: 'car' });
  if (controllerManager.setSurfaceHeight && city.surfaceHeight) controllerManager.setSurfaceHeight(city.surfaceHeight); // kerbs
  // edge of the map: the controller brakes the car smoothly; say why
  const edgeToast = document.createElement('div');
  edgeToast.className = 'edge-toast';
  edgeToast.innerHTML = `<b>Edge of the map</b><span>${CITY_NAME} Loop ends here. Turn around, or press M to jump somewhere else.</span>`;
  document.body.appendChild(edgeToast);
  const edgeStyle = document.createElement('style');
  edgeStyle.textContent = `.edge-toast{position:fixed;left:50%;top:96px;transform:translate(-50%,-8px);z-index:45;display:flex;flex-direction:column;gap:2px;align-items:center;
    padding:10px 16px;border-radius:14px;background:rgba(16,17,20,.86);border:1px solid rgba(255,255,255,.1);backdrop-filter:blur(16px);-webkit-backdrop-filter:blur(16px);
    color:#f6f5f2;font:500 13px/1.35 var(--font-sans,Inter,system-ui,sans-serif);opacity:0;pointer-events:none;transition:opacity .25s,transform .25s}
    .edge-toast b{font-weight:700;color:#ffb020;letter-spacing:.02em}.edge-toast.show{opacity:1;transform:translate(-50%,0)}
    body.hud-minimized .edge-toast{display:none}`;
  document.head.appendChild(edgeStyle);
  let edgeTimer = 0;
  controllerManager.addEventListener('edge', () => {
    edgeToast.classList.add('show');
    clearTimeout(edgeTimer);
    edgeTimer = setTimeout(() => edgeToast.classList.remove('show'), 3500);
  });
  onTrafficHit = (e) => { if (controllerManager._emitCollision) controllerManager._emitCollision(controllerManager.getActiveEntity(), e.impulse, 'traffic'); };
  const cameraSystem = new CameraSystem(renderer.domElement, controllerManager);
  const touchControls = new TouchControls(controllerManager);
  // river traffic, aircraft, pigeons + synthesised sound (js/life, js/audio)
  const life = createBrusselsLife(scene, { world: WORLD, surfaceHeight: city.surfaceHeight });
  life.onBoatHit = (e) => controllerManager._emitCollision && controllerManager._emitCollision(controllerManager.getActiveEntity(), e.impulse, 'boat');
  const audio = createBrusselsAudio({ controllers: controllerManager, traffic: trafficSystem, life, lighting: lightingSystem, world: WORLD, geo: GEO,
    landmarks: BRUSSELS_LANDMARKS, cameraSystem, night: () => VEHICLE_UNIFORMS.night.value });
  markInit('controllers');

  // Island-wide static geometry: chunk & distance-cull the small props, shadow stand-ins for the big casters
  // (scene-culling.js)
  const cullingRoots = [
    ...Object.values(city.groups).map((g) => (typeof g === 'string' ? scene.getObjectByName(g) : g)),
    ...landmarks.group.children
  ].filter(Boolean);
  setupSceneCulling(scene, cullingRoots, lightingSystem.sunLight.shadow);
  markInit('culling');

  // Small InstancedMeshes (<= 1000 instances) keep their matrices in uniform buffers that three.js
  // re-uploads on every draw of every pass (~2.5 MB/frame with the shadow cascades, stalling the GPU queue).
  // Storage attributes are only uploaded when instanceMatrix.needsUpdate is set.
  scene.traverse((object) => {
    if (object.isInstancedMesh) {
      object.instanceMatrix = new THREE.StorageInstancedBufferAttribute(object.instanceMatrix.array, 16);
    }
  });

  // 5. TSL RenderPipeline with Half-Res Screen Space Reflections (SSRNode), Bloom & Filmic Toning
  //    SSR skips pixels with zero metalness, so fading it out with distance spares the far facades
  const scenePass = pass(scene, cameraSystem.camera);
  // The multisampled colour attachments (output, normal, metalRough) only need resolving, never storing: discarding
  // them spares the GPU writing 3 x 4 samples per pixel to memory every frame (transient, memoryless attachments where
  // the browser supports them). The multisampled depth stays stored: SSR reads it.
  scenePass.renderTarget.storeMultisampledColorBuffer = false;
  const ssrFade = smoothstep(360.0, 180.0, positionView.z.negate());
  const sceneMRT = mrt({
    output: output,
    normal: normalView,
    metalRough: vec2(metalness.mul(ssrFade), roughness)
  });
  sceneMRT.setBlendMode('normal', new THREE.BlendMode(THREE.MaterialBlending));
  sceneMRT.setBlendMode('metalRough', new THREE.BlendMode(THREE.MaterialBlending));
  scenePass.setMRT(sceneMRT);

  const scenePassColor = scenePass.getTextureNode('output');
  const scenePassDepth = scenePass.getTextureNode('depth');
  const scenePassNormal = scenePass.getTextureNode('normal');
  const scenePassMetalRough = scenePass.getTextureNode('metalRough');

  const ssrPass = ssr(scenePassColor, scenePassDepth, scenePassNormal, {
    metalnessNode: scenePassMetalRough.r,
    roughnessNode: scenePassMetalRough.g,
    camera: cameraSystem.camera
  });
  ssrPass.resolutionScale = 0.5;
  ssrPass.blurQuality = 1;
  ssrPass.maxDistance.value = 42;
  ssrPass.thickness.value = 0.85;
  ssrPass.quality.value = 0.35;
  ssrPass.intensity.value = 0.50;
  ssrPass.screenEdgeFadeBlack = true;

  if (LITE) ssrPass.intensity.value = 0;
  const colorGrade = createPostProcessing(renderer, scenePassColor, ssrPass);
  const renderPipeline = new THREE.RenderPipeline(renderer, colorGrade.outputNode);

  // 6. Wire UI Controls (Strictly using safe DOM APIs: textContent, classList, addEventListener)
  const modeButtons = document.querySelectorAll('[data-mode]');
  const cameraButtons = document.querySelectorAll('[data-camera]');
  const timeButtons = document.querySelectorAll('[data-time]');
  const teleportButtons = document.querySelectorAll('[data-teleport]');
  const hudToggleBtn = document.getElementById('btn-toggle-hud');
  const modeSwitch = document.getElementById('mode-switch');
  touchControls.onAvailabilityChange = placeModeIndicator;

  const elFps = document.getElementById('hud-fps');
  const elMode = document.getElementById('hud-active-mode');
  const elCamera = document.getElementById('hud-active-camera');
  const elSpeed = document.getElementById('hud-speed');
  const elSpeedMeter = document.getElementById('hud-speed-meter');
  const elAltitude = document.getElementById('hud-altitude');
  const elLocation = document.getElementById('hud-location');
  const elControlsHint = document.getElementById('hud-controls-hint');
  const gamepadControls = new GamepadControls(controllerManager, cameraSystem, {
    onCycleMode: (step) => {
      const modes = PLAYER_MODES;
      selectMode(modes[(modes.indexOf(controllerManager.activeMode) + step + modes.length) % modes.length]);
    },
    onCycleCamera: cycleCamera,
    onToggleMap: () => mapSystem.toggleFullMap(!mapSystem.isFullMapOpen),
    onCloseMap: () => mapSystem.toggleFullMap(false)
  });

  // Keyboard guide for each mode: [keys, action]
  const controlHints = Object.fromEntries(PLAYER_MODES.map((m) => [m, MODE_INFO[m]?.hints || []]));
  controlHints.ride = [...(controlHints.ride || []), [['R'], 'RideBXL app'], [['Enter'], 'Accept job']];
  const topSpeedMph = Object.fromEntries(PLAYER_MODES.map((m) => [m, MODE_INFO[m]?.topSpeedMph || 60]));

  function renderControlHints(mode) {
    if (!elControlsHint) return;
    const items = (controlHints[mode] || []).map(([keys, action]) => {
      const item = document.createElement('span');
      item.className = 'hint';
      for (const key of keys) {
        const kbd = document.createElement('kbd');
        kbd.textContent = key;
        item.appendChild(kbd);
      }
      const label = document.createElement('span');
      label.className = 'hint-label';
      label.textContent = action;
      item.appendChild(label);
      return item;
    });
    elControlsHint.replaceChildren(...items);
  }

  // The taxi-yellow pill under the selected mode glides from button to button
  function placeModeIndicator() {
    const active = modeSwitch ? modeSwitch.querySelector('.mode-btn.active') : null;
    if (!active) return;
    modeSwitch.style.setProperty('--ind-x', `${active.offsetLeft}px`);
    modeSwitch.style.setProperty('--ind-w', `${active.offsetWidth}px`);
  }

  function selectMode(mode) {
    if (CITY_NAME === 'Brussels' && mode === 'boat') return;
    controllerManager.setMode(mode);
    touchControls.setMode(controllerManager.activeMode);
    gamepadControls.reset();
    modeButtons.forEach((btn) => {
      btn.classList.toggle('active', btn.getAttribute('data-mode') === mode);
    });
    document.body.dataset.mode = mode;
    placeModeIndicator();
    const ent = controllerManager.getActiveEntity();
    if (elMode) elMode.textContent = ent.label;
    renderControlHints(mode);

    // If currently on a static scenic camera, switch to 3rd-Person Chase so user sees their selected character/vehicle
    const currentCam = cameraSystem.getActivePreset();
    if (currentCam.category !== 'follow') {
      selectCamera('chase', false);
    }
  }

  function selectCamera(camId, snap = false) {
    cameraSystem.setCameraPreset(camId, snap);
    cameraButtons.forEach((btn) => {
      btn.classList.toggle('active', btn.getAttribute('data-camera') === camId);
    });
    const preset = cameraSystem.getActivePreset();
    if (elCamera) elCamera.textContent = preset.name;
  }

  // Steps through CAMERA_PRESETS (V / Shift+V, and the arrows either side of the camera name)
  function cycleCamera(step) {
    const n = CAMERA_PRESETS.length;
    const idx = CAMERA_PRESETS.findIndex((p) => p.id === cameraSystem.activePresetId);
    selectCamera(CAMERA_PRESETS[(idx + step + n) % n].id, true);
  }

  function selectTime(timeId) {
    lightingSystem.applyPreset(timeId);
    colorGrade.applyPreset(lightingSystem.activePresetId);
    timeButtons.forEach((btn) => {
      btn.classList.toggle('active', btn.getAttribute('data-time') === timeId);
    });
  }

  // Popovers (native [popover]: light dismiss & Esc for free) open against the control that toggles them: data-anchor
  // names the element they sit above / below, data-align the one whose right edge they line up with
  const popovers = document.querySelectorAll('.popover[popover]');
  const supportsPopover = typeof HTMLElement.prototype.togglePopover === 'function';
  function closePopovers() {
    if (!supportsPopover) return;
    popovers.forEach((pop) => {
      if (pop.matches(':popover-open')) pop.hidePopover();
    });
  }
  popovers.forEach((pop) => {
    const invoker = document.querySelector(`[popovertarget="${pop.id}"]`);
    pop.addEventListener('beforetoggle', (e) => {
      const open = e.newState === 'open';
      if (invoker) invoker.classList.toggle('is-open', open);
      if (!open) return;
      const anchor = document.getElementById(pop.dataset.anchor) || invoker;
      const align = document.getElementById(pop.dataset.align) || invoker;
      if (!anchor || !align) return;
      const r = anchor.getBoundingClientRect();
      const spaceAbove = Math.max(0, r.top - 20);
      const spaceBelow = Math.max(0, window.innerHeight - r.bottom - 20);
      let above = pop.dataset.side === 'above';
      // The camera control moves to the top on touch screens; open toward the available space.
      if ((above ? spaceAbove : spaceBelow) < 160) above = spaceAbove > spaceBelow;
      pop.style.right = `${Math.max(8, window.innerWidth - align.getBoundingClientRect().right)}px`;
      if (above) {
        pop.style.top = 'auto';
        pop.style.bottom = `${window.innerHeight - r.top + 8}px`;
        pop.style.maxHeight = `${spaceAbove}px`;
      } else {
        pop.style.bottom = 'auto';
        pop.style.top = `${r.bottom + 8}px`;
        pop.style.maxHeight = `${spaceBelow}px`;
      }
    });
  });

  modeButtons.forEach((btn) => {
    btn.addEventListener('click', () => {
      selectMode(btn.getAttribute('data-mode'));
    });
  });

  cameraButtons.forEach((btn) => {
    btn.addEventListener('click', () => {
      selectCamera(btn.getAttribute('data-camera'), true);
      closePopovers();
    });
  });

  const camPrevBtn = document.getElementById('cam-prev');
  const camNextBtn = document.getElementById('cam-next');
  if (camPrevBtn) camPrevBtn.addEventListener('click', () => cycleCamera(-1));
  if (camNextBtn) camNextBtn.addEventListener('click', () => cycleCamera(1));

  timeButtons.forEach((btn) => {
    btn.addEventListener('click', () => {
      selectTime(btn.getAttribute('data-time'));
    });
  });

  // A mouse click mustn't leave the focus on a HUD button, or Space (jump / ascend) and Enter would press it again
  document.addEventListener('click', (e) => {
    const btn = e.target instanceof Element ? e.target.closest('button') : null;
    if (btn && e.detail > 0) btn.blur();
  });

  // Where you are: Brussels street-name plates (js/brussels-base-ui.js)
  let currentWeather = 'clear';
  const hud = applyBrusselsHud({
    mainHooks: {
      lighting: lightingSystem,
      colorGrade,
      onWeather: (id) => {
        currentWeather = id;
        const p = lightingSystem.getWeatherParams ? lightingSystem.getWeatherParams() : null;
        if (p && !LITE) ssrPass.intensity.value = p.ssr;
        if (trafficSystem.setRain) trafficSystem.setRain(id === 'drizzle');
      }
    }
  });
  if (lightingSystem.weather) currentWeather = lightingSystem.weather;
  if (trafficSystem.setRain) trafficSystem.setRain(currentWeather === 'drizzle');
  function setWeather(id) {
    if (lightingSystem.setWeather) lightingSystem.setWeather(id);
    if (colorGrade.applyWeather) colorGrade.applyWeather(id);
    if (hud.setActiveWeather) hud.setActiveWeather(id);
    currentWeather = id;
    if (trafficSystem.setRain) trafficSystem.setRain(id === 'drizzle');
  }

  function teleportTo(x, z, heading = Math.PI) {
    const destination = controllerManager.teleportActiveTo(x, z, heading);
    touchControls.reset();
    gamepadControls.reset();
    cameraSystem.resetForTeleport();
    selectCamera('chase', true);
    mapSystem.waypoint = {
      x: destination.x,
      z: destination.z,
      name: getLocationLabel(destination.x, destination.z).text
    };
    return destination;
  }

  const mapSystem = new BrusselsMapSystem({
    controllerManager,
    cameraSystem,
    trafficSystem,
    onToggle: (open) => {
      controllerManager.resetInput();
      touchControls.setEnabled(!open);
      gamepadControls.setEnabled(!open);
      const mapHint = document.getElementById('fullmap-hover-info');
      if (open && touchControls.available && mapHint) {
        mapHint.textContent = 'Tap to teleport · Drag to pan · Use + / − to zoom';
      }
    },
    onTeleport: teleportTo
  });

  // RideBXL ride-hail (our Uber-style app) + Supabase save / leaderboard
  const backend = createBackend();
  const ridebxl = new RideBXL({
    scene,
    camera: () => cameraSystem.camera,
    controllers: controllerManager,
    world: WORLD,
    geo: GEO,
    backend,
    ui: {
      setMode: (m) => selectMode(m),
      onRouteChange: (route, target) => mapSystem.setRoute && mapSystem.setRoute(route && route.length ? route : null, target)
    }
  });

  // Brussels route data is not valid in Brussels; keep the generic bus vehicle mode but disable the Brussels route job.
  const busDriver = CITY_NAME === 'Brussels' ? { openPicker() {}, update() {} } : new BusDriver({
    scene, camera: () => cameraSystem.camera, controllers: controllerManager, world: WORLD, geo: GEO, backend,
    ui: {
      setMode: (m) => selectMode(m), teleport: (x, z, h) => teleportTo(x, z, h),
      onRouteChange: (r, t) => mapSystem.setRoute && mapSystem.setRoute(r && r.length ? r : null, t),
      onPinsChange: (p) => mapSystem.setPins && mapSystem.setPins(p || []),
      traffic: trafficSystem, renderer
    }
  });
  const busBtn = document.getElementById('btn-bus-driver');
  if (busBtn && CITY_NAME !== 'Brussels') busBtn.addEventListener('click', () => busDriver.openPicker());

  teleportButtons.forEach((btn) => {
    btn.addEventListener('click', () => {
      const key = btn.getAttribute('data-teleport');
      const loc = TELEPORT_LOCATIONS[key];
      if (loc) {
        teleportTo(loc.x, loc.z, loc.heading);
      }
      closePopovers();
    });
  });

  const openMapBtn = document.getElementById('btn-open-map');
  if (openMapBtn) openMapBtn.addEventListener('click', () => mapSystem.toggleFullMap(true));

  if (hudToggleBtn) {
    hudToggleBtn.addEventListener('click', () => {
      document.body.classList.toggle('hud-minimized');
      const isMin = document.body.classList.contains('hud-minimized');
      hudToggleBtn.setAttribute('aria-pressed', String(isMin));
      hudToggleBtn.setAttribute('aria-label', isMin ? 'Show HUD' : 'Hide HUD');
      hudToggleBtn.title = isMin ? 'Show the HUD [U]' : 'Clean view: hide the HUD [U]';
      if (isMin) closePopovers();
    });
  }

  // Global keyboard shortcuts for modes (1-4), cameras (V / 5-0), and HUD (H)
  window.addEventListener('keydown', (e) => {
    if (isTypingInField(e)) return;
    const digit = /^Digit([1-6])$/.exec(e.code);
    if (digit) { selectMode(PLAYER_MODES[+digit[1] - 1]); return; }
    switch (e.code) {
      case 'Digit7':
        selectCamera('chase', true);
        break;
      case 'Digit8':
        selectCamera('action', true);
        break;
      case 'Digit9':
        selectCamera('pov', true);
        break;
      case 'Digit0':
        selectCamera(CITY_NAME === 'Brussels' ? 'chase' : 'westminster', true);
        break;
      case 'KeyV':
        cycleCamera(e.shiftKey ? -1 : 1);
        break;
      case 'KeyN': // drive a Brussels bus
        selectMode('bus');
        break;
      case 'KeyO': // bus doors
        if (controllerManager.activeMode === 'bus' && controllerManager.setBusDoors) controllerManager.setBusDoors(!controllerManager.entities.bus.doorsOpen);
        break;
      case 'KeyU': // H is the cab's TAXI sign in Brussels
        if (hudToggleBtn) hudToggleBtn.click();
        break;
      case 'KeyB': // open / close Tower Bridge
        if (landmarks.towerBridge && landmarks.towerBridge.toggle) landmarks.towerBridge.toggle();
        break;
    }
  });

  window.addEventListener('resize', () => {
    cameraSystem.onResize(window.innerWidth, window.innerHeight);
    renderer.setSize(window.innerWidth, window.innerHeight);
    placeModeIndicator();
    if (mapSystem.isFullMapOpen) {
      mapSystem.resizeFullCanvas();
      mapSystem.renderFullMap();
    }
  });

  // Initialize default selection
  selectMode('car');
  selectCamera('chase', true);
  selectTime(URL_PARAMS.get('time') || 'golden');
  if (URL_PARAMS.get('weather')) setWeather(URL_PARAMS.get('weather'));
  if (URL_PARAMS.get('tp') && TELEPORT_LOCATIONS[URL_PARAMS.get('tp')]) {
    const loc = TELEPORT_LOCATIONS[URL_PARAMS.get('tp')];
    teleportTo(loc.x, loc.z, loc.heading);
  }
  if (mapSystem.prewarm) mapSystem.prewarm();
  // the web fonts change the buttons' widths once they arrive
  if (document.fonts) document.fonts.ready.then(placeModeIndicator);
  markInit('ui');

  // The loading screen stays up while the shaders compile (precompileShaders() & the warm-up frame, see the loop) and
  // until the first frame is on screen
  if (loadingStatus) {
    loadingStatus.textContent = 'Compiling Shaders & Render Pipelines...';
  }

  // 6b. Shader pre-compilation behind the loading screen. compileAsync() builds the node graphs in slices and has the GPU
  //     process compile the pipelines in parallel, but after every 8 ms slice it waits for a rendered frame, which
  //     leaves the main thread idle about half the time while nothing else animates; several calls side by side keep
  //     it busy (warm cache: 2.1 s instead of 4.0 s). (Rendering straight away compiled ~500 pipelines one after
  //     another: ~25 s with a cold shader cache.)
  const COMPILE_POOL = 16;
  const nextTask = () => (globalThis.scheduler?.yield ? globalThis.scheduler.yield() : new Promise((resolve) => setTimeout(resolve, 0)));
  async function precompileShaders() {
    // An empty frame first: it sets up the post-processing chain, which configures the scene pass's render target
    // (MSAA samples, depth format), so the pipelines compiled below are the very ones the scene pass asks for
    scene.visible = false;
    renderPipeline.render();
    scene.visible = true;
    const rainMesh = lightingSystem.rain && lightingSystem.rain.mesh;
    const rainWasVisible = rainMesh ? rainMesh.visible : false;
    if (rainMesh) rainMesh.visible = true;
    markInit('postFX');

    // Every visible object with frustum culling off (like the warm-up frame, see the loop). Plain meshes that share
    // a material share its shader, so one job compiles them in turn (the first build serves the rest); every
    // instanced mesh gets a build of its own
    const culled = [];
    const jobs = [];
    const jobByMaterial = new Map();
    scene.traverseVisible((o) => {
      if (o.frustumCulled) {
        culled.push(o);
        o.frustumCulled = false;
      }
      if (!o.isMesh && !o.isLine && !o.isPoints && !o.isSprite) return;
      // chunks of one mesh share its pipeline (the first one compiles it) and the shadow stand-ins only ever draw in
      // the shadow maps (the warm-up frame compiles those)
      if (o.userData.sharesPipelineWith || o.userData.shadowProxy) return;
      if (o.isInstancedMesh || Array.isArray(o.material)) {
        jobs.push([o]);
        return;
      }
      let job = jobByMaterial.get(o.material);
      if (!job) {
        job = [];
        jobByMaterial.set(o.material, job);
        jobs.push(job);
      }
      job.push(o);
    });

    renderer.setRenderTarget(scenePass.renderTarget);
    renderer.setMRT(sceneMRT);
    const compile = async (object) => {
      // Each compile starts in a task of its own: compileAsync() keeps one precompilation state on the renderer,
      // which must not be mid-step for two of them in the same microtask checkpoint
      await nextTask();
      try {
        await renderer.compileAsync(object, cameraSystem.camera, scene);
      } catch (e) {
        console.warn('[compile]', e); // the warm-up frame compiles it instead
      }
    };
    let next = 0;
    let done = 0;
    const worker = async () => {
      while (next < jobs.length) {
        const job = jobs[next++];
        for (const object of job) await compile(object);
        done++;
        if (loadingStatus) {
          loadingStatus.textContent = `Compiling Shaders & Render Pipelines... ${Math.round((done / jobs.length) * 100)}%`;
        }
        setLoadingProgress(done / jobs.length);
      }
    };
    await Promise.all(Array.from({ length: COMPILE_POOL }, worker));
    renderer.setMRT(null);
    renderer.setRenderTarget(null);
    for (const o of culled) o.frustumCulled = true;
    if (rainMesh) rainMesh.visible = rainWasVisible;
  }

  await precompileShaders();
  markInit('compile');

  // Supabase: driver profile, saved position / mode / time / weather, autosave (after the loading screen)
  function startBackend() {
    backend.init({
      onRestore: (state) => {
        if (!state || URL_PARAMS.has('tp')) return;
        if (state.mode && PLAYER_MODES.includes(state.mode)) selectMode(state.mode);
        if (state.pos && Number.isFinite(state.pos.x) && Number.isFinite(state.pos.z)) teleportTo(state.pos.x, state.pos.z, state.pos.h);
        if (state.time && !URL_PARAMS.has('time')) selectTime(state.time);
        if (state.weather && !URL_PARAMS.has('weather')) setWeather(state.weather);
      }
    }).then(() => backend.startAutosave(() => {
      const e = controllerManager.getActiveEntity();
      return {
        v: 1,
        pos: { x: Math.round(e.position.x * 10) / 10, z: Math.round(e.position.z * 10) / 10, h: Math.round(e.heading * 1000) / 1000 },
        mode: controllerManager.activeMode,
        time: lightingSystem.activePresetId,
        weather: currentWeather
      };
    })).catch((err) => console.warn('[backend]', err));
  }

  // debug / test handle
  window.__bxl = { busDriver, life, audio, scene, renderer, controllerManager, cameraSystem, city, landmarks, trafficSystem, mapSystem, ridebxl, backend, selectMode, selectCamera, selectTime, setWeather, teleportTo };

  // 6. Animation Loop
  let lastTime = performance.now();
  let elapsed = 0;
  let frameCount = 0;
  let fpsTimer = 0;
  let warmedUp = false; // see the first frame below

  if (elFps) elFps.textContent = '60';

  const CAPTURE = URL_PARAMS.has('capture');
  const tick = (now) => {
    const rawDt = (now - lastTime) * 0.001;
    lastTime = now;
    const dt = Math.min(Math.max(rawDt, 0.001), 0.05);
    elapsed += dt;

    // Update 3rd-person controllers, camera, signals, traffic & vehicle collisions, building LODs, and dynamic shadow focus
    gamepadControls.update(dt);
    controllerManager.update(dt, elapsed);
    cameraSystem.update(dt, elapsed);
    ridebxl.update(dt);
    busDriver.update(dt);
    trafficSystem.update(
      dt,
      elapsed,
      cameraSystem.currentPos,
      controllerManager.getActiveEntity(),
      controllerManager.activeMode,
      cameraSystem.camera
    );
    life.update(dt, { camera: cameraSystem.camera, entity: controllerManager.getActiveEntity(), mode: controllerManager.activeMode, peds: trafficSystem.peds, night: VEHICLE_UNIFORMS.night.value });
    audio.update(dt, cameraSystem.camera);
    city.update(dt, cameraSystem.camera);
    landmarks.update(dt);
    edgeBarriers.update(elapsed, VEHICLE_UNIFORMS.night.value);
    lightingSystem.update(cameraSystem.currentPos);
    mapSystem.update();
    if (warmedUp) updateSceneCulling(cameraSystem.camera.position); // the warm-up frame draws every chunk

    // Render frame via TSL RenderPipeline (SSR + Bloom)
    if (!warmedUp) {
      // First frame = pipeline warm-up behind the loading screen, for what precompileShaders() can't reach (the shadow
      // map passes): with frustum culling off, every visible material's pipelines compile now instead of stalling the
      // first time the camera turns towards it (one chunk / shadow stand-in per shared pipeline is enough)
      const culled = [];
      scene.traverse((o) => {
        if (o.frustumCulled && !o.userData.sharesPipelineWith) {
          culled.push(o);
          o.frustumCulled = false;
        }
      });
      renderPipeline.render();
      for (const o of culled) o.frustumCulled = true;
      markInit('warmup');
    }
    renderPipeline.render();
    if (!warmedUp) {
      warmedUp = true;
      markInit('firstFrame');
      // The loading screen stays up until the GPU has got through the first frame (and the pipelines its warm-up
      // compiled), i.e. until the city is actually on screen
      const device = renderer.backend.device;
      Promise.resolve(device && device.queue.onSubmittedWorkDone()).catch(() => {}).then(() => {
        markInit('gpu');
        console.log(`[init] ${initTimings.join(', ')}`);
        initTimings = null;
        if (loadingOverlay) loadingOverlay.classList.add('hidden');
        setLoadingProgress(1);
        startBackend();
      });
    }

    // Telemetry uses wall time, not the clamped simulation step, so slow frames and high-refresh displays report
    // their actual frame rate (updates DOM every 250ms).
    frameCount++;
    fpsTimer += Math.max(0, rawDt);
    if (fpsTimer >= 0.25) {
      const currentFps = Math.round(frameCount / fpsTimer);
      frameCount = 0;
      fpsTimer = 0;

      const activeEnt = controllerManager.getActiveEntity();
      const mode = controllerManager.activeMode;
      const mph = Math.round(Math.abs(activeEnt.speed) * 2.237);
      const altFt = Math.max(0, Math.round(activeEnt.position.y * 3.281));

      if (elFps) {
        elFps.textContent = String(currentFps);
        elFps.className = currentFps >= 50 ? 'fps-ok' : currentFps >= 30 ? 'fps-warn' : 'fps-bad';
      }
      if (elSpeed) elSpeed.textContent = String(mph);
      if (elSpeedMeter) elSpeedMeter.style.transform = `scaleX(${Math.min(1, mph / (topSpeedMph[mode] || 80))})`;
      document.body.classList.toggle('is-boosting', controllerManager.keys.boost && mph > 0);
      if (elAltitude) elAltitude.textContent = altFt.toLocaleString('en-GB');
      // The street corner of the player on the follow cameras, of the camera itself on the scenic ones
      const where = cameraSystem.getActivePreset().category === 'follow' ? activeEnt.position : cameraSystem.currentPos;
      hud.renderLocation(getLocationLabel(where.x, where.z), where);
    }
  };
  if (CAPTURE) {
    // ?capture: frame-by-frame recording with a fixed time step (tools/capture)
    let fakeNow = performance.now();
    lastTime = fakeNow;
    // __bxlTick(dt) renders one frame synchronously, so the caller can read the canvas in the same task;
    // await __bxlGpuIdle() before the next one
    window.__bxlTick = (dt = 1 / 30) => { fakeNow += dt * 1000; tick(fakeNow); };
    window.__bxlGpuIdle = () => (renderer.backend.device ? renderer.backend.device.queue.onSubmittedWorkDone() : Promise.resolve());
  } else renderer.setAnimationLoop(tick);
}

initApp();
