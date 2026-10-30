// js/backend.js — London Loop save game & RideLDN ride records on Supabase, with a localStorage mock for offline play.
// Plain fetch against PostgREST RPCs (no supabase-js). Workstream D.
//
//   const backend = createBackend();                 // ?offline in the URL forces the mock
//   await backend.init({ onRestore(state, profile) { ... } });   // asks for a driver name on first play
//   backend.startAutosave(() => ({ pos: {x, z, h}, mode, time, weather }));
//   backend.addDistance(metres);                     // movement since the last call (sent with the next save)
//   await backend.finishRide({ pickup, dropoff, distance_m, duration_s, rating }) // -> { fare, ride_count, ride_earnings, rating }
//   await backend.finishBusShift({ route, variant, from, to, stops_total, stops_served, passengers, distance_m, duration_s,
//     on_time_pct, comfort, penalties })            // -> { pay, shifts, passengers, earnings, on_time, rank }  (bus driver)
//   await backend.busLeaderboard(limit); await backend.recentBusShifts();

export const SUPABASE_URL = 'https://huorgiwdzlqpnyzmfmoi.supabase.co';
export const SUPABASE_KEY = 'sb_publishable_02C3aAYazBjZDsZxRgcPAQ_tjZjNOSx';

const PLAYER_KEY = 'londonloop_player';
const MOCK_KEY = 'londonloop_mock_db';
const NAME_RE = /^[A-Za-z0-9 _.-]{2,20}$/;
const STATE_MAX = 4000; // the server rejects p_state longer than this (as text)

/** The Brussels fare formula (slop_finish_ride): €3 + €1.60/km + €0.25/min, capped €250, × (0.8 + 0.05 × rating) */
export function computeFare(distance_m, duration_s, rating = 5) {
  const r = Math.max(1, Math.min(5, Math.round(rating || 5)));
  const base = Math.min(250, 3 + 1.6 * (distance_m / 1000) + 0.25 * (duration_s / 60));
  return Math.round(base * (0.8 + 0.05 * r) * 100) / 100;
}

/**
 * The server's bus pay formula (slop_bus_finish_shift):
 *   base = min(150, €2.50 + €1.10/km + €0.35/passenger + €0.15/stop served)
 *   pay  = max(0, base × (0.6 + 0.25 × on-time% + 0.15 × comfort%) − €0.25 × min(penalties, 40))
 */
export function computeBusPay({ distance_m = 0, passengers = 0, stops_served = 0, on_time_pct = 0, comfort = 0, penalties = 0 } = {}) {
  const ot = Math.max(0, Math.min(100, Math.round(on_time_pct || 0)));
  const cf = Math.max(0, Math.min(100, Math.round(comfort || 0)));
  const pen = Math.max(0, Math.min(999, Math.round(penalties || 0)));
  const base = Math.min(150, 2.5 + 1.1 * (distance_m / 1000) + 0.35 * passengers + 0.15 * stops_served);
  return Math.round(Math.max(0, base * (0.6 + 0.25 * ot / 100 + 0.15 * cf / 100) - 0.25 * Math.min(pen, 40)) * 100) / 100;
}
const BUS_ROUTE_RE = /^[A-Za-z0-9]{1,5}$/;

/** "Cabbie_4821" and friends */
export function randomDriverName(rng = Math.random) {
  const pre = ['Cabbie', 'Minicab', 'Knowledge', 'Bermondsey', 'Peckham', 'Hackney', 'Brixton', 'Camden', 'Mayfair',
    'Soho', 'Clapham', 'Bow', 'Stepney', 'Lambeth', 'Pimlico', 'Islington', 'Borough', 'Wapping', 'Southwark', 'Fitzrovia'];
  return `${pre[Math.floor(rng() * pre.length)]}_${String(1000 + Math.floor(rng() * 9000))}`;
}

export class RpcError extends Error {
  constructor(message, { status = 0, code = '', network = false } = {}) {
    super(message);
    this.name = 'RpcError';
    this.status = status;
    this.code = code;
    this.network = network; // true: couldn't reach the server (offline, timeout, 5xx gateway)
  }
}

// localStorage that never throws (private windows, blocked storage, sandboxes)
const memoryStore = new Map();
export const safeStorage = {
  get(key) {
    try {
      const v = globalThis.localStorage ? localStorage.getItem(key) : memoryStore.get(key);
      return v == null ? null : JSON.parse(v);
    } catch {
      return memoryStore.has(key) ? JSON.parse(memoryStore.get(key)) : null;
    }
  },
  set(key, value) {
    const s = JSON.stringify(value);
    memoryStore.set(key, s);
    try {
      if (globalThis.localStorage) localStorage.setItem(key, s);
    } catch { /* memory only */ }
  },
  remove(key) {
    memoryStore.delete(key);
    try {
      if (globalThis.localStorage) localStorage.removeItem(key);
    } catch { /* ignore */ }
  }
};

const num = (v, d = 0) => (v == null || v === '' || !Number.isFinite(Number(v)) ? d : Number(v));
const one = (v) => (Array.isArray(v) ? v[0] : v);

// ------------------------------------------------------------------------------------------------------------------
// Online transport: POST /rest/v1/rpc/<fn>
// ------------------------------------------------------------------------------------------------------------------
function makeRemoteRpc({ url, key, fetchImpl, timeoutMs }) {
  return async function rpc(name, args = {}, { keepalive = false } = {}) {
    const ctrl = typeof AbortController !== 'undefined' ? new AbortController() : null;
    const timer = ctrl ? setTimeout(() => ctrl.abort(), timeoutMs) : 0;
    let res;
    try {
      res = await fetchImpl(`${url}/rest/v1/rpc/${name}`, {
        method: 'POST',
        headers: { apikey: key, 'Content-Type': 'application/json', Accept: 'application/json' },
        body: JSON.stringify(args),
        signal: ctrl ? ctrl.signal : undefined,
        keepalive
      });
    } catch (e) {
      const timedOut = e && e.name === 'AbortError';
      throw new RpcError(timedOut ? `Server took too long (${name})` : `Can't reach the server (${name})`, { network: true });
    } finally {
      clearTimeout(timer);
    }
    const text = await res.text().catch(() => '');
    let body = null;
    if (text) {
      try { body = JSON.parse(text); } catch { body = text; }
    }
    if (!res.ok) {
      const msg = (body && typeof body === 'object' && (body.message || body.error || body.hint)) || `${name} failed (HTTP ${res.status})`;
      throw new RpcError(String(msg), {
        status: res.status,
        code: (body && body.code) || '',
        network: res.status === 0 || res.status === 502 || res.status === 503 || res.status === 504
      });
    }
    return body;
  };
}

// ------------------------------------------------------------------------------------------------------------------
// Offline transport: the same RPCs (same validation & fare formula as the SQL functions) over localStorage
// ------------------------------------------------------------------------------------------------------------------
function uuid() {
  if (globalThis.crypto && crypto.randomUUID) return crypto.randomUUID();
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (c) => {
    const r = (Math.random() * 16) | 0;
    return (c === 'x' ? r : (r & 3) | 8).toString(16);
  });
}

function makeMockRpc(storage = safeStorage) {
  const load = () => {
    const db = storage.get(MOCK_KEY);
    if (db && db.players && db.rides) return db;
    // A few rival drivers so the offline leaderboard has some life in it
    const bots = [['Knowledge_Kev', 214, 2876.4, 4.91], ['Peckham_Priya', 168, 2190.75, 4.86], ['Bow_Bells_Bill', 121, 1564.2, 4.72],
      ['Soho_Sid', 88, 1093.1, 4.64], ['Mayfair_Maud', 47, 655.9, 4.95], ['Minicab_Mo', 19, 231.4, 4.4]];
    const players = {};
    for (const [name, rides, earn, rating] of bots) {
      const id = uuid();
      players[id] = { id, token: '', name, state: null, ride_count: rides, ride_earnings: earn, rating_sum: Math.round(rating * rides),
        distance_m: rides * 3100, last_ride_at: 0, bot: true };
    }
    return { players, rides: [] };
  };
  // bus-driver data (added in round 2; older mock DBs get it on first use)
  const busDb = (db) => {
    if (!db.busShifts) db.busShifts = [];
    if (!db.busStats) {
      db.busStats = {};
      const bots = [['Route38_Rosie', 41, 1890, 1244.6, 88], ['Clapham_Omnibus', 33, 1502, 1003.2, 81], ['Bendy_Bob', 19, 811, 548.9, 74],
        ['Night_Bus_Nadia', 9, 377, 240.15, 90]];
      for (const [name, shifts, pax, earn, ot] of bots) {
        const id = uuid();
        db.players[id] = { id, token: '', name, state: null, ride_count: 0, ride_earnings: 0, rating_sum: 0, distance_m: shifts * 7000, last_ride_at: 0, bot: true };
        db.busStats[id] = { shifts, passengers: pax, earnings: earn, distance_m: shifts * 7000, on_time_sum: ot * shifts, comfort_sum: 85 * shifts, last_shift_at: 0 };
      }
    }
    return db;
  };
  const save = (db) => {
    if (db.rides.length > 200) db.rides = db.rides.slice(-200);
    if (db.busShifts && db.busShifts.length > 200) db.busShifts = db.busShifts.slice(-200);
    storage.set(MOCK_KEY, db);
  };
  const fail = (msg) => { throw new RpcError(msg, { status: 400, code: 'P0001' }); };
  const auth = (db, id, token) => {
    let p = db.players[id];
    // Adopt an online identity when the network drops mid-game, so play just carries on
    if (!p && id && token) {
      const stored = storage.get(PLAYER_KEY);
      if (stored && stored.id === id && stored.token === token) {
        p = db.players[id] = { id, token, name: stored.name, state: null, ride_count: 0, ride_earnings: 0, rating_sum: 0, distance_m: 0, last_ride_at: 0 };
      }
    }
    if (!p || p.bot || p.token !== token) fail('Unknown player');
    return p;
  };
  const avg = (p) => (p.ride_count > 0 ? Math.round((p.rating_sum / p.ride_count) * 100) / 100 : null);

  const fns = {
    slop_join({ p_name }) {
      const name = String(p_name || '').trim();
      if (!NAME_RE.test(name)) fail('Name must be 2-20 letters, numbers, spaces, _ . -');
      const db = load();
      const id = uuid();
      const token = (uuid() + uuid()).replace(/-/g, '');
      db.players[id] = { id, token, name, state: null, ride_count: 0, ride_earnings: 0, rating_sum: 0, distance_m: 0, last_ride_at: 0 };
      save(db);
      return { id, token, name };
    },
    slop_load({ p_id, p_token }) {
      const db = load();
      const p = auth(db, p_id, p_token);
      save(db);
      return { id: p.id, name: p.name, state: p.state, ride_count: p.ride_count, ride_earnings: p.ride_earnings, distance_m: p.distance_m, rating: avg(p) };
    },
    slop_save({ p_id, p_token, p_state, p_distance_m = 0 }) {
      const db = load();
      const p = auth(db, p_id, p_token);
      if (!p_state || typeof p_state !== 'object' || Array.isArray(p_state) || JSON.stringify(p_state).length > STATE_MAX) fail('Bad state');
      p.state = p_state;
      p.distance_m += Math.max(0, Math.min(num(p_distance_m), 20000));
      save(db);
      return null;
    },
    slop_rename({ p_id, p_token, p_name }) {
      const db = load();
      const p = auth(db, p_id, p_token);
      const name = String(p_name || '').trim();
      if (!NAME_RE.test(name)) fail('Name must be 2-20 letters, numbers, spaces, _ . -');
      p.name = name;
      save(db);
      return name;
    },
    slop_finish_ride({ p_id, p_token, p_pickup, p_dropoff, p_distance_m, p_duration_s, p_rating }) {
      const db = load();
      const p = auth(db, p_id, p_token);
      const rating = Math.max(1, Math.min(5, Math.round(num(p_rating, 5))));
      const dist = num(p_distance_m, NaN);
      const dur = num(p_duration_s, NaN);
      const now = Date.now();
      if (p.last_ride_at && p.last_ride_at > now - 15000) fail('Slow down - one ride at a time');
      if (!(dist >= 100 && dist <= 25000)) fail('Ride distance out of range');
      if (!(dur >= dist / 45 && dur <= 3600)) fail('Ride time out of range');
      const fare = computeFare(dist, dur, rating);
      db.rides.push({ id: db.rides.length + 1, player_id: p.id, pickup: String(p_pickup || '?').slice(0, 80), dropoff: String(p_dropoff || '?').slice(0, 80),
        distance_m: Math.round(dist * 10) / 10, duration_s: Math.round(dur * 10) / 10, fare, rating, created_at: new Date(now).toISOString() });
      p.ride_count += 1;
      p.ride_earnings = Math.round((p.ride_earnings + fare) * 100) / 100;
      p.rating_sum += rating;
      p.last_ride_at = now;
      save(db);
      return { fare, ride_count: p.ride_count, ride_earnings: p.ride_earnings, rating: avg(p) };
    },
    slop_leaderboard({ p_limit = 10 } = {}) {
      const db = load();
      const limit = Math.max(1, Math.min(num(p_limit, 10), 50));
      return Object.values(db.players).filter((p) => p.ride_count > 0)
        .sort((a, b) => b.ride_earnings - a.ride_earnings).slice(0, limit)
        .map((p) => ({ name: p.name, rides: p.ride_count, earnings: p.ride_earnings, rating: avg(p) }));
    },
    slop_recent_rides({ p_id, p_token }) {
      const db = load();
      auth(db, p_id, p_token);
      return db.rides.filter((r) => r.player_id === p_id).reverse().slice(0, 20);
    },
    // ---- bus driver (same checks & formula as the SQL in migration slop_london_002_buses) ----
    slop_bus_finish_shift(a) {
      const db = busDb(load());
      const p = auth(db, a.p_id, a.p_token);
      const route = String(a.p_route ?? '');
      const total = num(a.p_stops_total, NaN), served = num(a.p_stops_served, NaN), pax = num(a.p_passengers, NaN);
      const dist = num(a.p_distance_m, NaN), dur = num(a.p_duration_s, NaN);
      if (!BUS_ROUTE_RE.test(route)) fail('Bad route');
      if (!(total >= 2 && total <= 80)) fail('Stops out of range');
      if (!(served >= 1 && served <= total)) fail('Stops out of range');
      if (!(pax >= 0 && pax <= served * 15 && pax <= 600)) fail('Passengers out of range');
      if (!(dist >= 300 && dist <= 30000)) fail('Shift distance out of range');
      if (!(dur >= dist / 18 && dur >= served * 5 && dur <= 10800)) fail('Shift time out of range');
      const st = db.busStats[p.id] || (db.busStats[p.id] = { shifts: 0, passengers: 0, earnings: 0, distance_m: 0, on_time_sum: 0, comfort_sum: 0, last_shift_at: 0 });
      const now = Date.now();
      if (st.last_shift_at && st.last_shift_at > now - 30000) fail('Slow down - one shift at a time');
      const ot = Math.max(0, Math.min(100, Math.round(num(a.p_on_time_pct)))), cf = Math.max(0, Math.min(100, Math.round(num(a.p_comfort))));
      const pen = Math.max(0, Math.min(999, Math.round(num(a.p_penalties))));
      const pay = computeBusPay({ distance_m: dist, passengers: pax, stops_served: served, on_time_pct: ot, comfort: cf, penalties: pen });
      db.busShifts.push({ id: db.busShifts.length + 1, player_id: p.id, route: route.toUpperCase(), variant: String(a.p_variant || '?').slice(0, 40),
        from_stop: String(a.p_from || '?').slice(0, 80), to_stop: String(a.p_to || '?').slice(0, 80), stops_total: total, stops_served: served,
        passengers: pax, distance_m: Math.round(dist * 10) / 10, duration_s: Math.round(dur * 10) / 10, on_time_pct: ot, comfort: cf, penalties: pen,
        pay, created_at: new Date(now).toISOString() });
      st.shifts += 1; st.passengers += pax; st.earnings = Math.round((st.earnings + pay) * 100) / 100; st.distance_m += dist;
      st.on_time_sum += ot; st.comfort_sum += cf; st.last_shift_at = now;
      const rank = 1 + Object.values(db.busStats).filter((o) => o.earnings > st.earnings).length;
      save(db);
      return { pay, shifts: st.shifts, passengers: st.passengers, earnings: st.earnings, on_time: Math.round(st.on_time_sum / st.shifts), rank };
    },
    slop_bus_leaderboard({ p_limit = 10 } = {}) {
      const db = busDb(load());
      save(db);
      const limit = Math.max(1, Math.min(num(p_limit, 10), 50));
      return Object.entries(db.busStats).filter(([id, s]) => s.shifts > 0 && db.players[id])
        .sort((a, b) => b[1].earnings - a[1].earnings).slice(0, limit)
        .map(([id, s]) => ({ name: db.players[id].name, shifts: s.shifts, passengers: s.passengers, earnings: s.earnings, on_time: Math.round(s.on_time_sum / s.shifts) }));
    },
    slop_bus_recent_shifts({ p_id, p_token }) {
      const db = busDb(load());
      auth(db, p_id, p_token);
      return db.busShifts.filter((r) => r.player_id === p_id).reverse().slice(0, 20)
        .map(({ id, player_id, variant, ...r }) => r);
    }
  };

  return async function rpc(name, args = {}) {
    const fn = fns[name];
    if (!fn) throw new RpcError(`Unknown function ${name}`, { status: 404 });
    await new Promise((r) => setTimeout(r, 40)); // a hint of latency, so the UI's async paths get exercised
    return JSON.parse(JSON.stringify(fn(args) ?? null));
  };
}

// ------------------------------------------------------------------------------------------------------------------
// Small UI bits: the "Offline" pill and the first-play driver-name modal (scoped .rl- styles)
// ------------------------------------------------------------------------------------------------------------------
const BACKEND_CSS = `
.rl-offline-pill{position:fixed;z-index:40;bottom:calc(max(20px,env(safe-area-inset-bottom)) + 156px);right:max(20px,env(safe-area-inset-right));display:flex;align-items:center;gap:6px;
  padding:5px 11px 5px 9px;border-radius:999px;font:600 11.5px/1 var(--font-sans,Inter,system-ui,sans-serif);letter-spacing:.02em;color:rgba(246,245,242,.86);
  background:rgba(16,17,20,.72);border:1px solid rgba(255,255,255,.1);backdrop-filter:blur(16px);-webkit-backdrop-filter:blur(16px);pointer-events:auto;cursor:default}
.rl-offline-pill i{width:7px;height:7px;border-radius:50%;background:#ffc857;box-shadow:0 0 0 3px rgba(255,200,87,.18)}
body.hud-minimized .rl-offline-pill{opacity:0}
.rl-modal-scrim{position:fixed;inset:0;z-index:60;display:grid;place-items:center;background:rgba(6,7,9,.5);backdrop-filter:blur(6px);-webkit-backdrop-filter:blur(6px);
  animation:rl-fade .25s ease both;font-family:var(--font-sans,Inter,system-ui,sans-serif);color:#f6f5f2}
.rl-modal{width:min(340px,calc(100vw - 32px));padding:22px 22px 18px;border-radius:18px;background:rgba(16,17,20,.94);border:1px solid rgba(255,255,255,.1);
  box-shadow:0 30px 60px -20px rgba(0,0,0,.8);animation:rl-rise .35s cubic-bezier(.22,1,.36,1) both}
.rl-modal h2{font-size:18px;font-weight:750;letter-spacing:-.01em;margin:10px 0 4px}
.rl-modal p{font-size:13px;line-height:1.45;color:rgba(246,245,242,.66);margin:0 0 14px}
.rl-modal input{width:100%;height:40px;padding:0 12px;border-radius:10px;border:1px solid rgba(255,255,255,.14);background:rgba(255,255,255,.06);color:inherit;
  font:600 15px var(--font-sans,Inter,system-ui,sans-serif);outline:none;user-select:text}
.rl-modal input:focus{border-color:#3ee6b4;box-shadow:0 0 0 3px rgba(62,230,180,.2)}
.rl-modal .rl-err{min-height:16px;font-size:11.5px;color:#ff7a6b;margin:6px 2px 8px}
.rl-modal-row{display:flex;gap:8px}
.rl-modal button{flex:1;height:40px;border-radius:10px;border:0;font:700 14px var(--font-sans,Inter,system-ui,sans-serif);cursor:pointer}
.rl-btn-primary{background:#3ee6b4;color:#06221a}.rl-btn-primary:hover{filter:brightness(1.07)}
.rl-btn-ghost{flex:0 0 auto!important;padding:0 14px;background:rgba(255,255,255,.08);color:#f6f5f2}
.rl-logo{display:inline-flex;align-items:center;gap:7px;font:800 14px/1 var(--font-sans,Inter,system-ui,sans-serif);letter-spacing:-.01em}
.rl-logo b{display:grid;place-items:center;width:24px;height:24px;border-radius:7px;background:#3ee6b4;color:#06221a;font-size:12px;font-weight:900}
@keyframes rl-fade{from{opacity:0}to{opacity:1}}
@keyframes rl-rise{from{opacity:0;transform:translateY(10px) scale(.98)}to{opacity:1;transform:none}}
`;

export function injectStyle(id, css) {
  if (typeof document === 'undefined' || document.getElementById(id)) return;
  const el = document.createElement('style');
  el.id = id;
  el.textContent = css;
  document.head.appendChild(el);
}

function el(tag, cls, text) {
  const e = document.createElement(tag);
  if (cls) e.className = cls;
  if (text != null) e.textContent = text;
  return e;
}

/** Asks for a driver name. Resolves with the name (or the prefilled one if the player just presses Enter / Skip). */
export function askDriverName({ initial = randomDriverName(), validate = null } = {}) {
  if (typeof document === 'undefined') return Promise.resolve(initial);
  injectStyle('rl-backend-style', BACKEND_CSS);
  return new Promise((resolve) => {
    const scrim = el('div', 'rl-modal-scrim');
    const box = el('form', 'rl-modal');
    box.setAttribute('role', 'dialog');
    box.setAttribute('aria-modal', 'true');
    const logo = el('div', 'rl-logo');
    logo.append(el('b', '', 'R'), document.createTextNode('RideLDN'));
    const h = el('h2', '', 'Pick a driver name');
    const p = el('p', '', 'It goes on the leaderboard and keeps your saved game. Letters, numbers, spaces, _ . - (2–20).');
    const input = el('input');
    input.type = 'text';
    input.maxLength = 20;
    input.value = initial;
    input.autocomplete = 'off';
    input.spellcheck = false;
    input.setAttribute('aria-label', 'Driver name');
    const err = el('div', 'rl-err');
    const row = el('div', 'rl-modal-row');
    const reroll = el('button', 'rl-btn-ghost', '🎲');
    reroll.type = 'button';
    reroll.title = 'Another name';
    reroll.setAttribute('aria-label', 'Suggest another name');
    const go = el('button', 'rl-btn-primary', 'Start driving');
    go.type = 'submit';
    row.append(reroll, go);
    box.append(logo, h, p, input, err, row);
    scrim.appendChild(box);
    document.body.appendChild(scrim);
    // keep game keys (WASD, R, H…) from firing while typing
    const stop = (e) => e.stopPropagation();
    box.addEventListener('keydown', stop);
    box.addEventListener('keyup', stop);
    reroll.addEventListener('click', () => { input.value = randomDriverName(); input.focus(); input.select(); });
    box.addEventListener('submit', async (e) => {
      e.preventDefault();
      const name = input.value.trim();
      if (!NAME_RE.test(name)) {
        err.textContent = 'Use 2–20 letters, numbers, spaces, _ . -';
        return;
      }
      go.disabled = true;
      go.textContent = 'Joining…';
      const msg = validate ? await validate(name) : null;
      if (msg) {
        err.textContent = msg;
        go.disabled = false;
        go.textContent = 'Start driving';
        return;
      }
      scrim.remove();
      resolve(name);
    });
    setTimeout(() => { input.focus(); input.select(); }, 30);
  });
}

// ------------------------------------------------------------------------------------------------------------------
// The backend
// ------------------------------------------------------------------------------------------------------------------
export class Backend {
  /**
   * @param {object} o
   * @param {boolean} [o.offline] force the mock (default: ?offline in the URL)
   * @param {string} [o.url] [o.key] Supabase project URL & publishable key
   * @param {Function} [o.fetchImpl] fetch stand-in (tests)
   * @param {number} [o.timeoutMs] per-request timeout (default 8000)
   * @param {boolean} [o.autoFallback] switch to the mock when the network fails (default true)
   */
  constructor({ offline, url = SUPABASE_URL, key = SUPABASE_KEY, fetchImpl, timeoutMs = 8000, autoFallback = true, storage = safeStorage } = {}) {
    const qs = typeof location !== 'undefined' ? new URLSearchParams(location.search) : new URLSearchParams();
    this.storage = storage;
    this.autoFallback = autoFallback;
    this._remote = makeRemoteRpc({ url, key, fetchImpl: fetchImpl || ((...a) => globalThis.fetch(...a)), timeoutMs });
    this._mock = makeMockRpc(storage);
    this.offline = offline ?? qs.has('offline');
    this.player = storage.get(PLAYER_KEY); // {id, token, name}
    this.profile = null; // {name, ride_count, ride_earnings, distance_m, rating}
    this.pendingDistance = 0;
    this._listeners = new Set();
    this._autosave = null;
    this._pill = null;
    this.lastError = null;
    this._renderPill();
  }

  /** cb({ offline, player, profile }) whenever something changes */
  onChange(cb) {
    this._listeners.add(cb);
    return () => this._listeners.delete(cb);
  }

  _emit() {
    for (const cb of this._listeners) {
      try { cb({ offline: this.offline, player: this.player, profile: this.profile }); } catch (e) { console.warn('[backend] listener', e); }
    }
  }

  _goOffline(reason) {
    if (this.offline) return;
    console.warn(`[backend] offline mode: ${reason}`);
    this.offline = true;
    this._renderPill();
    this._emit();
  }

  _renderPill() {
    if (typeof document === 'undefined' || !document.body) return;
    injectStyle('rl-backend-style', BACKEND_CSS);
    if (this.offline && !this._pill) {
      this._pill = el('div', 'rl-offline-pill');
      this._pill.title = 'Playing offline: rides and saves stay in this browser';
      this._pill.append(el('i'), document.createTextNode('Offline'));
      document.body.appendChild(this._pill);
    } else if (!this.offline && this._pill) {
      this._pill.remove();
      this._pill = null;
    }
  }

  /** Low-level RPC (falls back to the mock when the network is unreachable). */
  async rpc(name, args = {}, opts = {}) {
    if (!this.offline) {
      try {
        return await this._remote(name, args, opts);
      } catch (e) {
        if (!(e instanceof RpcError) || !e.network || !this.autoFallback) throw e;
        this.lastError = e;
        this._goOffline(e.message);
      }
    }
    return this._mock(name, args);
  }

  get name() {
    return (this.player && this.player.name) || (this.profile && this.profile.name) || '';
  }

  _setPlayer(p) {
    this.player = p ? { id: p.id, token: p.token, name: p.name } : null;
    if (this.player) this.storage.set(PLAYER_KEY, this.player);
    else this.storage.remove(PLAYER_KEY);
  }

  _auth() {
    if (!this.player) throw new RpcError('Not signed in');
    return { p_id: this.player.id, p_token: this.player.token };
  }

  async join(name) {
    const r = one(await this.rpc('slop_join', { p_name: String(name).trim() }));
    this._setPlayer(r);
    this.profile = { name: r.name, ride_count: 0, ride_earnings: 0, distance_m: 0, rating: null };
    this._emit();
    return r;
  }

  async load() {
    const r = one(await this.rpc('slop_load', this._auth()));
    this.profile = { name: r.name, ride_count: num(r.ride_count), ride_earnings: num(r.ride_earnings), distance_m: num(r.distance_m),
      rating: r.rating == null ? null : num(r.rating) };
    if (r.name && this.player.name !== r.name) this._setPlayer({ ...this.player, name: r.name });
    this._emit();
    return r;
  }

  /**
   * Boot: load the saved player (or ask for a name and join), then hand the saved state back.
   * @param {object} o
   * @param {(state: object|null, profile: object) => void} [o.onRestore]
   * @param {boolean} [o.askName=true] show the name modal when there is no player yet (false: join as a random name)
   */
  async init({ onRestore, askName = true } = {}) {
    let state = null;
    if (this.player) {
      try {
        state = (await this.load()).state || null;
      } catch (e) {
        if (e instanceof RpcError && /unknown player/i.test(e.message)) {
          // the account is gone (or the mock was cleared): start over under the same name
          const old = this.player.name;
          this._setPlayer(null);
          await this._joinWithName(old, askName);
        } else {
          console.warn('[backend] load failed', e);
        }
      }
    } else {
      await this._joinWithName(null, askName);
    }
    if (onRestore && state && typeof state === 'object') {
      try { onRestore(state, this.profile); } catch (e) { console.warn('[backend] restore', e); }
    }
    return { player: this.player, profile: this.profile, state };
  }

  async _joinWithName(prefill, askName) {
    const validate = async (name) => {
      try {
        await this.join(name);
        return null;
      } catch (e) {
        return e.message || 'Could not join';
      }
    };
    if (askName) {
      await askDriverName({ initial: prefill || randomDriverName(), validate });
    } else {
      const err = await validate(prefill || randomDriverName());
      if (err) await validate(randomDriverName());
    }
  }

  async rename(name) {
    const r = one(await this.rpc('slop_rename', { ...this._auth(), p_name: name }));
    const newName = typeof r === 'string' ? r : name;
    this._setPlayer({ ...this.player, name: newName });
    if (this.profile) this.profile.name = newName;
    this._emit();
    return newName;
  }

  /** metres moved since the last call; sent with the next save */
  addDistance(m) {
    if (Number.isFinite(m) && m > 0) this.pendingDistance += m;
  }

  /** Save the game state (object, ≤ 4 KB as JSON) together with the distance travelled since the last save. */
  async save(state, { keepalive = false } = {}) {
    if (!this.player) return false;
    let s = state && typeof state === 'object' ? state : {};
    let json = JSON.stringify(s);
    if (json.length > STATE_MAX) {
      console.warn(`[backend] state is ${json.length} B (> ${STATE_MAX}); saving the core keys only`);
      const { v, pos, mode, time, weather } = s;
      s = { v, pos, mode, time, weather };
      json = JSON.stringify(s);
    }
    const dist = Math.min(20000, Math.round(this.pendingDistance));
    this.pendingDistance -= dist;
    try {
      await this.rpc('slop_save', { ...this._auth(), p_state: s, p_distance_m: dist }, { keepalive });
      if (this.profile) this.profile.distance_m += dist;
      return true;
    } catch (e) {
      this.pendingDistance += dist;
      console.warn('[backend] save failed:', e.message);
      return false;
    }
  }

  /** getState() -> the object to save. Saves every intervalMs and when the tab is hidden. */
  startAutosave(getState, intervalMs = 30000) {
    this.stopAutosave();
    const doSave = (keepalive = false) => {
      let st;
      try { st = getState(); } catch (e) { console.warn('[backend] getState', e); return; }
      this.save(st, { keepalive });
    };
    const timer = setInterval(() => doSave(false), intervalMs);
    const onVis = () => { if (document.visibilityState === 'hidden') doSave(true); };
    const onHide = () => doSave(true);
    if (typeof document !== 'undefined') document.addEventListener('visibilitychange', onVis);
    if (typeof window !== 'undefined') window.addEventListener('pagehide', onHide);
    this._autosave = { timer, onVis, onHide, doSave };
  }

  saveNow() {
    if (this._autosave) this._autosave.doSave(false);
  }

  stopAutosave() {
    const a = this._autosave;
    if (!a) return;
    clearInterval(a.timer);
    if (typeof document !== 'undefined') document.removeEventListener('visibilitychange', a.onVis);
    if (typeof window !== 'undefined') window.removeEventListener('pagehide', a.onHide);
    this._autosave = null;
  }

  /** -> { fare, ride_count, ride_earnings, rating }; throws RpcError with the server's message on rejection */
  async finishRide({ pickup, dropoff, distance_m, duration_s, rating }) {
    const r = one(await this.rpc('slop_finish_ride', {
      ...this._auth(),
      p_pickup: String(pickup || '?').slice(0, 80),
      p_dropoff: String(dropoff || '?').slice(0, 80),
      p_distance_m: Math.round(distance_m * 10) / 10,
      p_duration_s: Math.round(duration_s * 10) / 10,
      p_rating: Math.max(1, Math.min(5, Math.round(rating)))
    }));
    const out = { fare: num(r.fare), ride_count: num(r.ride_count), ride_earnings: num(r.ride_earnings), rating: r.rating == null ? null : num(r.rating) };
    if (this.profile) Object.assign(this.profile, { ride_count: out.ride_count, ride_earnings: out.ride_earnings, rating: out.rating });
    this._emit();
    return out;
  }

  async leaderboard(limit = 10) {
    const rows = (await this.rpc('slop_leaderboard', { p_limit: limit })) || [];
    return (Array.isArray(rows) ? rows : [rows]).map((r) => ({
      name: r.name, rides: num(r.rides ?? r.ride_count), earnings: num(r.earnings ?? r.ride_earnings), rating: r.rating == null ? null : num(r.rating)
    }));
  }

  async recentRides() {
    const rows = (await this.rpc('slop_recent_rides', this._auth())) || [];
    return (Array.isArray(rows) ? rows : [rows]).map((r) => ({
      pickup: r.pickup, dropoff: r.dropoff, distance_m: num(r.distance_m), duration_s: num(r.duration_s), fare: num(r.fare),
      rating: num(r.rating, 5), created_at: r.created_at
    }));
  }

  // ---- bus driver ------------------------------------------------------------------------------------------------
  /**
   * Record a finished bus shift; the server computes the pay. -> { pay, shifts, passengers, earnings, on_time, rank }
   * Throws RpcError with the server's message on rejection.
   */
  async finishBusShift({ route, variant, from, to, stops_total, stops_served, passengers, distance_m, duration_s, on_time_pct, comfort, penalties }) {
    const r = one(await this.rpc('slop_bus_finish_shift', {
      ...this._auth(),
      p_route: String(route || '').slice(0, 5),
      p_variant: String(variant || '?').slice(0, 40),
      p_from: String(from || '?').slice(0, 80),
      p_to: String(to || '?').slice(0, 80),
      p_stops_total: Math.round(num(stops_total)),
      p_stops_served: Math.round(num(stops_served)),
      p_passengers: Math.round(num(passengers)),
      p_distance_m: Math.round(num(distance_m) * 10) / 10,
      p_duration_s: Math.round(num(duration_s) * 10) / 10,
      p_on_time_pct: Math.max(0, Math.min(100, Math.round(num(on_time_pct)))),
      p_comfort: Math.max(0, Math.min(100, Math.round(num(comfort)))),
      p_penalties: Math.max(0, Math.min(999, Math.round(num(penalties))))
    }));
    const out = { pay: num(r.pay), shifts: num(r.shifts), passengers: num(r.passengers), earnings: num(r.earnings),
      on_time: r.on_time == null ? null : num(r.on_time), rank: r.rank == null ? null : num(r.rank) };
    this.busProfile = out;
    this._emit();
    return out;
  }

  /** -> [{ name, shifts, passengers, earnings, on_time }] by earnings */
  async busLeaderboard(limit = 10) {
    const rows = (await this.rpc('slop_bus_leaderboard', { p_limit: limit })) || [];
    return (Array.isArray(rows) ? rows : [rows]).map((r) => ({
      name: r.name, shifts: num(r.shifts), passengers: num(r.passengers), earnings: num(r.earnings), on_time: r.on_time == null ? null : num(r.on_time)
    }));
  }

  /** -> last 20 shifts [{ route, from_stop, to_stop, stops_served, stops_total, passengers, distance_m, duration_s, on_time_pct, comfort, penalties, pay, created_at }] */
  async recentBusShifts() {
    const rows = (await this.rpc('slop_bus_recent_shifts', this._auth())) || [];
    return (Array.isArray(rows) ? rows : [rows]).map((r) => ({ ...r, passengers: num(r.passengers), distance_m: num(r.distance_m),
      duration_s: num(r.duration_s), pay: num(r.pay), on_time_pct: num(r.on_time_pct), comfort: num(r.comfort), penalties: num(r.penalties) }));
  }

  dispose() {
    this.stopAutosave();
    if (this._pill) this._pill.remove();
    this._pill = null;
    this._listeners.clear();
  }
}

export function createBackend(opts) {
  return new Backend(opts);
}
