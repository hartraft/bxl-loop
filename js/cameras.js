import * as THREE from 'three/webgpu';

const IS_BRUSSELS = typeof location !== 'undefined' && new URLSearchParams(location.search).get('city') === 'brussels';

// js/cameras.js
// Multi-camera system supporting Third-Person Chase (with mouse/touch orbit + zoom),
// Low-Angle Action Cam, POV/Cockpit Cam, 7 Iconic NYC Architectural Cameras, and Auto-Director Drone.

const CAMERA_PRESETS = [
  { id: 'chase',       name: '3rd-Person Chase',         short: 'Chase',       category: 'follow', fov: 56 },
  { id: 'action',      name: 'Low-Angle Action',         short: 'Action',      category: 'follow', fov: 60 },
  { id: 'pov',         name: 'First-Person / Cockpit',   short: 'POV / Dash',  category: 'follow', fov: 68 },
  { id: 'westminster', name: IS_BRUSSELS ? 'Grand-Place Overview' : 'Westminster Bridge & Big Ben', short: IS_BRUSSELS ? 'Grand-Place' : 'Big Ben',    category: 'scenic', fov: 50 },
  { id: 'southBank',   name: IS_BRUSSELS ? 'Mont des Arts' : 'South Bank & London Eye',      short: IS_BRUSSELS ? 'Mont des Arts' : 'London Eye', category: 'scenic', fov: 54 },
  { id: 'trafalgar',   name: IS_BRUSSELS ? 'Royal Palace' : "Trafalgar Square & Nelson",    short: IS_BRUSSELS ? 'Royal Palace' : 'Trafalgar',  category: 'scenic', fov: 56 },
  { id: 'piccadilly',  name: IS_BRUSSELS ? 'European Quarter' : 'Piccadilly Circus Lights',     short: IS_BRUSSELS ? 'EU Quarter' : 'Piccadilly', category: 'scenic', fov: 58 },
  { id: 'stPauls',     name: IS_BRUSSELS ? 'Cathedral Quarter' : "Millennium Bridge to St Paul's", short: IS_BRUSSELS ? 'Cathedral' : "St Paul's", category: 'scenic', fov: 48 },
  { id: 'shard',       name: IS_BRUSSELS ? 'Palace of Justice' : 'The Shard from London Bridge', short: IS_BRUSSELS ? 'Justice' : 'The Shard',  category: 'scenic', fov: 52 },
  { id: 'towerBridge', name: IS_BRUSSELS ? 'Koekelberg Basilica' : 'Tower Bridge on the Thames',   short: IS_BRUSSELS ? 'Basilica' : 'Tower Br',   category: 'scenic', fov: 50 },
  { id: 'waterfront',  name: IS_BRUSSELS ? 'Canal Skyline' : 'Thames & City Skyline',        short: IS_BRUSSELS ? 'Canal' : 'Skyline',    category: 'scenic', fov: 46 },
  { id: 'drone',       name: 'Auto-Director Aerial',     short: 'Director',    category: 'scenic', fov: 50 }
];

const wrapAngle = (a) => a - Math.round(a / (Math.PI * 2)) * (Math.PI * 2);

/** Critically damped spring towards `target` (Game Programming Gems 4 "SmoothDamp"): stable at any frame time */
function smoothDamp(state, key, target, smoothTime, dt) {
  const omega = 2 / Math.max(1e-4, smoothTime);
  const x = omega * dt;
  const e = 1 / (1 + x + 0.48 * x * x + 0.235 * x * x * x);
  const change = state[key] - target;
  const vk = key + 'Vel';
  const temp = (state[vk] + omega * change) * dt;
  state[vk] = (state[vk] - omega * temp) * e;
  state[key] = target + (change + temp) * e;
}

/** Chase-camera yaw lag (s) per entity type: heavier things swing round more lazily */
const CHASE_YAW_LAG = { car: 0.2, person: 0.24, cyclist: 0.24, helicopter: 0.45, boat: 0.6 };

class CameraSystem {
  constructor(domElement, controllerManager) {
    this.domElement = domElement;
    this.controllerManager = controllerManager;

    this.camera = new THREE.PerspectiveCamera(
      56,
      window.innerWidth / window.innerHeight,
      0.35,
      60000 // at 1:1 the boroughs & harbor run out ~20-40 km to the fogged horizon (reversed float depth keeps precision)
    );

    this.activePresetId = 'chase';
    this.orbitYawOffset = 0.0;
    this.orbitPitchOffset = 0.09;
    this.zoomMultiplier = 1.0;
    this.isDragging = false;
    this.userOrbitTimer = 0;

    this.currentPos = new THREE.Vector3(0, 10, 380);
    this.currentLookAt = new THREE.Vector3(0, 8, 440);
    this.initialized = false;

    // Follow cameras (chase / action) are smoothed relative to the followed entity, see update()
    this.followEntity = null;
    this.followOffset = new THREE.Vector3();
    this.followLookOffset = new THREE.Vector3();
    this.followBaseY = 0;
    this.smoothedSpeed = 0;
    this._desiredPos = new THREE.Vector3();
    this._desiredLook = new THREE.Vector3();
    // chase camera: smoothed yaw (+ velocity), collision pull-in (fraction of the boom), FOV, mode-switch glide
    this._chase = { yaw: 0, yawVel: 0, pull: 1, glide: 0 };
    this._glidePos = new THREE.Vector3();
    this._glideLook = new THREE.Vector3();
    this._fov = 56;

    this.bindPointerControls();
  }

  bindPointerControls() {
    const canvas = this.domElement;
    const pointers = new Map();
    canvas.style.touchAction = 'none';

    canvas.addEventListener('pointerdown', (e) => {
      if (e.button !== 0 || pointers.size >= 2) return;
      // Only two touch pointers may share a gesture; mouse and pen drags stay independent.
      if (pointers.size && (e.pointerType !== 'touch' || pointers.values().next().value.type !== 'touch')) return;
      e.preventDefault();
      pointers.set(e.pointerId, { x: e.clientX, y: e.clientY, type: e.pointerType });
      canvas.setPointerCapture(e.pointerId);
      this.isDragging = true;
      this.userOrbitTimer = 4.0;
    });

    canvas.addEventListener('pointermove', (e) => {
      const pointer = pointers.get(e.pointerId);
      if (!pointer) return;
      e.preventDefault();
      const dx = e.clientX - pointer.x;
      const dy = e.clientY - pointer.y;
      const pair = pointers.size === 2 ? [...pointers.values()] : null;
      const previousDistance = pair ? Math.hypot(pair[0].x - pair[1].x, pair[0].y - pair[1].y) : 0;
      pointer.x = e.clientX;
      pointer.y = e.clientY;

      if (pair) {
        const distance = Math.hypot(pair[0].x - pair[1].x, pair[0].y - pair[1].y);
        if (previousDistance > 1 && distance > 1) {
          this.zoomMultiplier = Math.max(0.45, Math.min(2.4, this.zoomMultiplier * previousDistance / distance));
        }
      } else {
        this.orbitYawOffset -= dx * 0.0065;
        this.orbitPitchOffset = Math.max(-0.32, Math.min(0.68, this.orbitPitchOffset + dy * 0.005));
      }
      this.userOrbitTimer = 4.0;
    });

    const releasePointer = (id) => {
      if (!pointers.delete(id)) return;
      this.isDragging = pointers.size > 0;
      if (canvas.hasPointerCapture(id)) canvas.releasePointerCapture(id);
    };
    for (const type of ['pointerup', 'pointercancel', 'lostpointercapture']) {
      canvas.addEventListener(type, (e) => releasePointer(e.pointerId));
    }
    const clearPointers = () => {
      for (const id of pointers.keys()) releasePointer(id);
    };
    this._clearPointers = clearPointers;
    window.addEventListener('blur', clearPointers);
    document.addEventListener('visibilitychange', () => {
      if (document.hidden) clearPointers();
    });

    canvas.addEventListener('wheel', (e) => {
      e.preventDefault();
      this.zoomMultiplier = Math.max(0.45, Math.min(2.4, this.zoomMultiplier + e.deltaY * 0.001));
    }, { passive: false });
  }

  setCameraPreset(presetId, snapImmediately = false) {
    const preset = CAMERA_PRESETS.find((p) => p.id === presetId);
    if (!preset) return;
    this.activePresetId = preset.id;
    this.camera.fov = preset.fov;
    this._fov = preset.fov;
    this.camera.updateProjectionMatrix();
    if (snapImmediately) {
      this.initialized = false;
    }
  }

  applyGamepadInput(lookX, lookY, zoom, dt) {
    if (!(dt > 0) || !Number.isFinite(dt)) return;
    if (this.activePresetId !== 'chase' && this.activePresetId !== 'pov') return;
    // POV uses the orbit angles, but only chase renders a zoomed camera distance.
    if (this.activePresetId !== 'chase') zoom = 0;
    if (!lookX && !lookY && !zoom) return;
    this.orbitYawOffset -= lookX * 2.0 * dt;
    this.orbitPitchOffset = Math.max(-0.32, Math.min(0.68, this.orbitPitchOffset + lookY * 1.25 * dt));
    this.zoomMultiplier = Math.max(0.45, Math.min(2.4, this.zoomMultiplier + zoom * 0.9 * dt));
    this.userOrbitTimer = 4.0;
  }

  resetOrbit() {
    this.orbitYawOffset = 0;
    this.orbitPitchOffset = 0.09;
    this.zoomMultiplier = 1;
    this.userOrbitTimer = 0;
  }

  resetForTeleport() {
    // Arrive with a fresh chase view, without carrying a previous drive or gesture into the destination.
    this._clearPointers();
    this.isDragging = false;
    this.resetOrbit();
    this.smoothedSpeed = 0;
    this.followEntity = null;
    this.followOffset.set(0, 0, 0);
    this.followLookOffset.set(0, 0, 0);
    this.followBaseY = 0;
    this._chase.glide = 0;
    this.setCameraPreset('chase', true);
  }

  /**
   * How far along the boom pivot → camera (0..1) the camera can sit without being inside a collider (building),
   * with ~0.35 m of clearance. Needs controllerManager.nearColliders (controllers.js); 1 when unavailable.
   */
  _boomClearance(px, py, pz, cx, cy, cz) {
    const cm = this.controllerManager;
    if (!cm || typeof cm.nearColliders !== 'function') return 1;
    const dx = cx - px, dz = cz - pz, dy = cy - py;
    const len = Math.hypot(dx, dz);
    if (len < 0.5) return 1;
    let best = 1;
    const pad = 0.35;
    const list = cm.nearColliders((px + cx) / 2, (pz + cz) / 2, len / 2 + 1);
    for (let i = 0; i < list.length; i++) {
      const c = list[i];
      if (c.maxY < Math.min(py, cy)) continue;
      // segment in the box's frame
      let ax, az, bx, bz, hx, hz;
      if (c.obb) {
        const o = c.obb;
        const rx0 = px - o.cx, rz0 = pz - o.cz, rx1 = cx - o.cx, rz1 = cz - o.cz;
        ax = rx0 * o.cs - rz0 * o.sn; az = rx0 * o.sn + rz0 * o.cs;
        bx = rx1 * o.cs - rz1 * o.sn; bz = rx1 * o.sn + rz1 * o.cs;
        hx = o.hx; hz = o.hz;
      } else {
        const mx = (c.minX + c.maxX) / 2, mz = (c.minZ + c.maxZ) / 2;
        ax = px - mx; az = pz - mz; bx = cx - mx; bz = cz - mz;
        hx = (c.maxX - c.minX) / 2; hz = (c.maxZ - c.minZ) / 2;
      }
      for (const p of [pad, 0]) {
        const ex = hx + p, ez = hz + p;
        if (Math.abs(ax) < ex && Math.abs(az) < ez) continue; // the pivot is inside (padded) box: try unpadded / skip
        let t0 = 0, t1 = 1;
        const ux = bx - ax, uz = bz - az;
        let ok = true;
        for (const [a, u, e] of [[ax, ux, ex], [az, uz, ez]]) {
          if (Math.abs(u) < 1e-9) { if (a < -e || a > e) { ok = false; break; } continue; }
          let ta = (-e - a) / u, tb = (e - a) / u;
          if (ta > tb) [ta, tb] = [tb, ta];
          if (ta > t0) t0 = ta;
          if (tb < t1) t1 = tb;
          if (t0 > t1) { ok = false; break; }
        }
        if (ok && t0 < best) {
          const y = py + dy * t0;
          if (!(y > c.maxY + 0.2) && !(c.minY !== undefined && y < c.minY - 0.2)) best = t0;
        }
        break;
      }
    }
    return Math.max(Math.min(1, 1.2 / len), best);
  }

  getActivePreset() {
    return CAMERA_PRESETS.find((p) => p.id === this.activePresetId) || CAMERA_PRESETS[0];
  }

  onResize(width, height) {
    this.camera.aspect = width / height;
    this.camera.updateProjectionMatrix();
  }

  update(dt, elapsed) {
    const entity = this.controllerManager.getActiveEntity();
    const desiredPos = this._desiredPos;
    const desiredLook = this._desiredLook;

    if (this.userOrbitTimer > 0 && !this.isDragging) {
      this.userOrbitTimer = Math.max(0, this.userOrbitTimer - dt);
    }

    if (!this.isDragging && this.userOrbitTimer <= 0 && Math.abs(entity.speed) > 0.5) {
      this.orbitYawOffset -= Math.round(this.orbitYawOffset / (Math.PI * 2)) * (Math.PI * 2);
      this.orbitYawOffset += (0.0 - this.orbitYawOffset) * (1 - Math.exp(-dt * 2.2));
    }

    // The follow cameras pull back with speed, eased so that they drift back as the entity speeds up (and in as it
    // slows down); speedLag is about how far their former world-space smoothing left them trailing at 60 FPS
    this.smoothedSpeed += (Math.abs(entity.speed) - this.smoothedSpeed) * (1 - Math.exp(-dt * 3.0));
    const speedLag = this.smoothedSpeed * 0.1;

    const totalYaw = entity.heading + this.orbitYawOffset;

    switch (this.activePresetId) {
      case 'chase': {
        // The boom swings round after the vehicle on a critically damped spring (weight, no jitter at any frame
        // rate), looking a little towards where it's sliding; it stays locked to the vehicle's position, pulls back
        // and widens the FOV with speed, and pulls in ahead of walls instead of ending up inside a building.
        const ch = this._chase;
        let yawT = entity.heading;
        const sp = entity.speed || 0;
        if (sp > 2) {
          const vx = Math.sin(entity.heading) * sp + (entity.vx || 0), vz = Math.cos(entity.heading) * sp + (entity.vz || 0);
          const v = Math.hypot(vx, vz);
          if (v > 2) yawT += wrapAngle(Math.atan2(vx, vz) - entity.heading) * 0.35 * Math.min(1, (v - 2) / 6);
        }
        const fresh = !this.initialized || this.followEntity !== entity || this._lastPreset !== 'chase';
        if (fresh) {
          ch.yaw = yawT;
          ch.yawVel = 0;
        } else {
          ch.yaw = yawT + wrapAngle(ch.yaw - yawT);
          smoothDamp(ch, 'yaw', yawT, entity.camYawLag ?? CHASE_YAW_LAG[entity.type] ?? 0.22, dt);
        }
        const yaw = ch.yaw + this.orbitYawOffset;
        const dist = entity.chaseDistance * this.zoomMultiplier * (1 + Math.min(0.25, this.smoothedSpeed * 0.01));
        const height = entity.chaseHeight * this.zoomMultiplier + Math.sin(this.orbitPitchOffset) * dist * 0.85;
        const horizDist = Math.cos(this.orbitPitchOffset) * dist + speedLag;
        if (fresh) this.followBaseY = entity.position.y;
        else this.followBaseY += (entity.position.y - this.followBaseY) * (1 - Math.exp(-dt * 8.5));
        const baseY = this.followBaseY;
        desiredPos.set(
          entity.position.x - Math.sin(yaw) * horizDist,
          Math.max(0.65, baseY + height),
          entity.position.z - Math.cos(yaw) * horizDist
        );
        const lookUpBias = (entity.type === 'helicopter' || entity.type === 'boat') ? 0.2 : (entity.type === 'car' ? 0.52 : 1.55);
        desiredLook.set(
          entity.position.x + Math.sin(ch.yaw) * 5.2,
          baseY + entity.cameraTargetOffset.y + lookUpBias,
          entity.position.z + Math.cos(ch.yaw) * 5.2
        );
        // keep out of buildings: pull in instantly, ease back out
        const pivotY = baseY + entity.cameraTargetOffset.y + 0.4;
        const allowed = this._boomClearance(entity.position.x, pivotY, entity.position.z, desiredPos.x, desiredPos.y, desiredPos.z);
        ch.pull = fresh || allowed < ch.pull ? allowed : ch.pull + (allowed - ch.pull) * (1 - Math.exp(-dt * 2.2));
        if (ch.pull < 0.999) {
          desiredPos.set(
            entity.position.x + (desiredPos.x - entity.position.x) * ch.pull,
            pivotY + (desiredPos.y - pivotY) * ch.pull + (1 - ch.pull) * horizDist * 0.3, // up & over the roof when tight
            entity.position.z + (desiredPos.z - entity.position.z) * ch.pull
          );
        }
        break;
      }

      case 'action': {
        const sideOffset = entity.type === 'boat' ? 6.0 : entity.type === 'car' ? 2.65 : (entity.type === 'helicopter' ? 4.2 : 0.95);
        const backDist = (entity.type === 'boat' ? 16.0 : entity.type === 'car' ? 3.6 : (entity.type === 'helicopter' ? 8.5 : 2.8)) + speedLag;
        const lowY = entity.type === 'helicopter' ? entity.position.y + 1.2 : entity.type === 'boat' ? entity.position.y + 3.0 : entity.position.y + 0.92;

        desiredPos.set(
          entity.position.x - Math.sin(entity.heading) * backDist + Math.cos(entity.heading) * sideOffset,
          Math.max(0.55, lowY),
          entity.position.z - Math.cos(entity.heading) * backDist - Math.sin(entity.heading) * sideOffset
        );
        desiredLook.set(
          entity.position.x + Math.sin(entity.heading) * 3.2,
          entity.position.y + 1.05,
          entity.position.z + Math.cos(entity.heading) * 3.2
        );
        break;
      }

      case 'pov': {
        let fwdOffset = 0.35;
        let eyeY = 1.68;
        if (entity.type === 'car') {
          fwdOffset = 0.55;
          eyeY = 1.52;
        } else if (entity.type === 'cyclist') {
          fwdOffset = 0.35;
          eyeY = 1.55;
        } else if (entity.type === 'helicopter') {
          fwdOffset = 1.65;
          eyeY = 1.65;
        }

        desiredPos.set(
          entity.position.x + Math.sin(entity.heading) * fwdOffset,
          entity.position.y + eyeY,
          entity.position.z + Math.cos(entity.heading) * fwdOffset
        );
        // London: right-hand-drive seat / cockpit eye from the controller when it knows it
        if (this.controllerManager.getPovPosition) {
          this.controllerManager.getPovPosition(desiredPos);
          eyeY = desiredPos.y - entity.position.y;
        }
        const povYaw = totalYaw + Math.max(-0.12, Math.min(0.12, (entity.yawRate || 0) * 0.12)); // glance into turns
        desiredLook.set(
          entity.position.x + Math.sin(povYaw) * 40.0,
          entity.position.y + eyeY + Math.sin(-this.orbitPitchOffset) * 18.0 + 1.5,
          entity.position.z + Math.cos(povYaw) * 40.0
        );
        break;
      }

      case 'westminster': {
        if (IS_BRUSSELS) { desiredPos.set(220, 135, 300); desiredLook.set(0, 12, 0); break; }
        // East end of Westminster Bridge looking west across the Thames at Elizabeth Tower & the Palace
        const sway = Math.sin(elapsed * 0.22) * 2.5;
        desiredPos.set(505.0 + sway, 11.0, 800.0);
        desiredLook.set(236.0, 55.0, 790.0);
        break;
      }

      case 'southBank': {
        if (IS_BRUSSELS) { const sway = Math.sin(elapsed * 0.2) * 3; desiredPos.set(500 + sway, 90, -250); desiredLook.set(-350, 10, 100); break; }
        // Jubilee Gardens looking up at the London Eye
        const sway = Math.sin(elapsed * 0.2) * 3.0;
        desiredPos.set(700.0 + sway, 6.0, 640.0);
        desiredLook.set(590.0, 60.0, 493.0);
        break;
      }

      case 'trafalgar': {
        if (IS_BRUSSELS) { const sway = Math.sin(elapsed * 0.3) * 2; desiredPos.set(-100 + sway, 80, 240); desiredLook.set(450, 15, -200); break; }
        // Top of Whitehall looking north up at Nelson's Column, the fountains & the National Gallery
        const sway = Math.sin(elapsed * 0.3) * 2.0;
        desiredPos.set(8.0 + sway, 5.0, 150.0);
        desiredLook.set(0.0, 30.0, -60.0);
        break;
      }

      case 'piccadilly': {
        if (IS_BRUSSELS) { const sway = Math.sin(elapsed * 0.3) * 3; desiredPos.set(1900 + sway, 120, 1150); desiredLook.set(1600, 15, 900); break; }
        // Lower Regent St looking at Eros and the curved screens
        const sway = Math.sin(elapsed * 0.3) * 2.0;
        desiredPos.set(-395.0 + sway, 5.5, -175.0);
        desiredLook.set(-470.0, 16.0, -265.0);
        break;
      }

      case 'stPauls': {
        if (IS_BRUSSELS) { const sway = Math.sin(elapsed * 0.22) * 2; desiredPos.set(850 + sway, 85, -300); desiredLook.set(550, 20, 0); break; }
        // South end of the Millennium Bridge looking north to the dome
        const sway = Math.sin(elapsed * 0.22) * 1.5;
        desiredPos.set(2050.0 + sway, 10.0, 10.0);
        desiredLook.set(2057.0, 75.0, -676.0);
        break;
      }

      case 'shard': {
        if (IS_BRUSSELS) { const sway = Math.cos(elapsed * 0.2) * 2; desiredPos.set(350 + sway, 145, 1300); desiredLook.set(-50, 25, 1100); break; }
        // London Bridge looking south up the Shard
        const sway = Math.cos(elapsed * 0.2) * 2.0;
        desiredPos.set(2779.0 + sway, 12.0, -40.0);
        desiredLook.set(2884.0, 170.0, 359.0);
        break;
      }

      case 'towerBridge': {
        if (IS_BRUSSELS) { const drift = Math.sin(elapsed * 0.15) * 8; desiredPos.set(-1750, 130, -2500 + drift); desiredLook.set(-1900, 30, -2250); break; }
        // Low over the Thames upstream of Tower Bridge
        const drift = Math.sin(elapsed * 0.15) * 25.0;
        desiredPos.set(3380.0, 16.0, 320.0 + drift);
        desiredLook.set(3654.0, 35.0, 253.0);
        break;
      }

      case 'waterfront': {
        if (IS_BRUSSELS) { const drift = Math.sin(elapsed * 0.15) * 20; desiredPos.set(-1450, 85, drift); desiredLook.set(-2350, 15, -100); break; }
        // Above Waterloo Bridge looking down the river to the City & the Shard
        const drift = Math.sin(elapsed * 0.15) * 40.0;
        desiredPos.set(905.0, 55.0, 260.0 + drift);
        desiredLook.set(2700.0, 110.0, -250.0);
        break;
      }

      case 'drone': {
        const angle = elapsed * 0.07 + 0.65;
        const radius = 1500.0 + Math.sin(elapsed * 0.23) * 250.0;
        const alt = 330.0 + Math.cos(elapsed * 0.19) * 90.0;
        const cx = IS_BRUSSELS ? 0 : 1300, cz = IS_BRUSSELS ? 0 : 150;
        desiredPos.set(Math.cos(angle) * radius + cx, alt, Math.sin(angle) * radius + cz);
        desiredLook.set(cx, 90.0, cz);
        break;
      }
    }

    if (this.activePresetId === 'chase') {
      // chase: already smoothed above. A preset or mode switch glides over from where the camera was.
      if (this.initialized && (this.followEntity !== entity || this._lastPreset !== 'chase')) {
        this._glidePos.subVectors(this.currentPos, desiredPos);
        this._glideLook.subVectors(this.currentLookAt, desiredLook);
        this._chase.glide = 1;
      }
      this.followEntity = entity;
      this.initialized = true;
      this.currentPos.copy(desiredPos);
      this.currentLookAt.copy(desiredLook);
      if (this._chase.glide > 1e-3) {
        const g = (this._chase.glide *= Math.exp(-dt * 4.5));
        this.currentPos.set(this.currentPos.x + this._glidePos.x * g, this.currentPos.y + this._glidePos.y * g, this.currentPos.z + this._glidePos.z * g);
        this.currentLookAt.set(this.currentLookAt.x + this._glideLook.x * g, this.currentLookAt.y + this._glideLook.y * g, this.currentLookAt.z + this._glideLook.z * g);
      } else this._chase.glide = 0;
      this.currentPos.y = Math.max(0.55, this.currentPos.y);
      // keep the action camera's entity-relative state current, so switching to it glides from here
      this.followOffset.subVectors(this.currentPos, entity.position);
      this.followLookOffset.subVectors(this.currentLookAt, entity.position);
    } else if (!this.initialized || this.activePresetId === 'pov') {
      this.currentPos.copy(desiredPos);
      this.currentLookAt.copy(desiredLook);
      this.initialized = true;
      this.followEntity = null; // the follow cameras re-anchor from here
    } else if (this.activePresetId === 'action') {
      // Smoothed in the followed entity's frame rather than in world space. A world-space follower trails a moving
      // target by a distance that depends on the frame time (about speed x dt), so with uneven frame times the camera
      // surged back and forth behind an accelerating or fast car. Relative to the entity a steady drive keeps the
      // camera steady, while turns, orbit drags, zoom & the speed pull-back are still eased. The entity's height is
      // eased in world space (curbs, park lawns, jumps, the helicopter climbing).
      if (this.followEntity !== entity) {
        // preset or mode switch: start from where the camera is and glide over to the new framing
        this.followEntity = entity;
        this.followBaseY = entity.position.y;
        this.followOffset.subVectors(this.currentPos, entity.position);
        this.followLookOffset.subVectors(this.currentLookAt, entity.position);
      }
      const k = 1 - Math.exp(-dt * 8.5);
      this.followBaseY += (entity.position.y - this.followBaseY) * k;
      this.followOffset.lerp(desiredPos.sub(entity.position), k);
      this.followLookOffset.lerp(desiredLook.sub(entity.position), k);
      this.currentPos.set(entity.position.x, this.followBaseY, entity.position.z).add(this.followOffset);
      this.currentLookAt.set(entity.position.x, this.followBaseY, entity.position.z).add(this.followLookOffset);
      this.currentPos.y = Math.max(0.55, this.currentPos.y);
    } else {
      this.followEntity = null;
      const k = 1 - Math.exp(-dt * 8.5);
      this.currentPos.lerp(desiredPos, k);
      this.currentLookAt.lerp(desiredLook, k);
    }

    // a touch wider with speed in the follow cameras (sense of speed), eased
    const preset = this.getActivePreset();
    let fovT = preset.fov;
    if (preset.id === 'chase' || preset.id === 'action') {
      const u = Math.max(0, Math.min(1, (this.smoothedSpeed - 6) / 22));
      fovT += 9 * u * u * (3 - 2 * u);
    }
    this._fov += (fovT - this._fov) * (1 - Math.exp(-dt * 3));
    if (Math.abs(this.camera.fov - this._fov) > 0.01) {
      this.camera.fov = this._fov;
      this.camera.updateProjectionMatrix();
    }
    if (this.controllerManager.setPovView) this.controllerManager.setPovView(this.activePresetId === 'pov');
    this._lastPreset = this.activePresetId;

    this.camera.position.copy(this.currentPos);
    this.camera.lookAt(this.currentLookAt);
  }
}

export { CAMERA_PRESETS, CameraSystem };
