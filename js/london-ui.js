// js/london-ui.js — Workstream E: the London look of the HUD.
//
//   import { applyLondonHud } from './london-ui.js';
//   const hud = applyLondonHud({ mainHooks: { lighting: lightingSystem, colorGrade } });   // once, after the DOM exists
//   hud.renderLocation(getLocationLabel(x, z));   // instead of main.js's NY renderLocation(): London street-name plates
//   hud.setActiveWeather('drizzle');              // keeps the weather buttons in step if weather changes elsewhere
//
// What it does (all at runtime, no index.html edits needed — but see INTEGRATION.md for the preferred static edits):
//   - injects <style id="ldn-ui-style">: London street-name plates, the "LDN" brand badge, weather buttons, paper map frame
//   - brand: "NY" bullets -> "LDN" badge, "Slop New York" -> "London Loop" (and other NY strings, see NY_TEXT below)
//   - weather buttons (Clear / Overcast / Drizzle / Fog) injected next to the time-of-day buttons; a click calls
//     mainHooks.setWeather(id) if given, else mainHooks.lighting.setWeather(id) + mainHooks.colorGrade.applyWeather(id)
//   - street plates: white enamel plate, black sans capitals, thin black inset border, the postcode district in red
//     ("WHITEHALL SW1") and the borough under a rule ("CITY OF WESTMINSTER"), as on real London corners (no Johnston).

import { LONDON_LANDMARKS } from './city-config.js';

// ---------------------------------------------------------------------------------------------------------------------
// Postcode districts & boroughs (rough, by OSM place name; centre of the district wins)
// ---------------------------------------------------------------------------------------------------------------------
const WM = 'City of Westminster', CL = 'City of London', CA = 'London Borough of Camden', SO = 'London Borough of Southwark';
const LA = 'London Borough of Lambeth', KC = 'Royal Borough of Kensington and Chelsea', IS = 'London Borough of Islington';
const HA = 'London Borough of Hackney', TH = 'London Borough of Tower Hamlets', WA = 'London Borough of Wandsworth';
const DISTRICT_INFO = {
  'Mayfair': ['W1', WM], 'Soho': ['W1', WM], 'Fitzrovia': ['W1', WM], 'Marylebone': ['W1', WM], 'East Marylebone': ['W1', WM],
  'West End': ['W1', WM], 'Covent Garden': ['WC2', WM], 'St Giles': ['WC2', CA], 'Seven Dials': ['WC2', CA], 'Strand': ['WC2', WM],
  'Charing Cross': ['WC2', WM], 'Holborn': ['WC1', CA], 'Bloomsbury': ['WC1', CA], "Gray's Inn": ['WC1', CA], 'Hatton Garden': ['EC1', CA],
  'St Clement Danes': ['WC2', WM], 'Temple': ['EC4', CL], 'Whitehall': ['SW1', WM], 'Westminster': ['SW1', WM], "St. James's": ['SW1', WM],
  "St James's": ['SW1', WM], 'Pimlico': ['SW1', WM], 'Victoria': ['SW1', WM], 'Belgravia': ['SW1', WM], 'Millbank': ['SW1', WM],
  'Knightsbridge': ['SW1', KC], 'Hans Town': ['SW3', KC], 'Chelsea': ['SW3', KC], "World's End": ['SW10', KC], 'Brompton': ['SW3', KC],
  'South Kensington': ['SW7', KC], 'Kensington': ['W8', KC], "Earl's Court": ['SW5', KC], 'Walham Green': ['SW6', 'London Borough of Hammersmith and Fulham'],
  'Bayswater': ['W2', WM], 'Paddington': ['W2', WM], 'Westbourne': ['W2', WM], 'Westbourne Green': ['W2', WM], 'Maida Vale': ['W9', WM],
  'Little Venice': ['W9', WM], "St. John's Wood": ['NW8', WM], "St John's Wood": ['NW8', WM], "Lot's Village": ['SW10', KC],
  'Somers Town': ['NW1', CA], "King's Cross": ['N1', CA], 'St Pancras': ['NW1', CA], 'Camden': ['NW1', CA], 'Pentonville': ['N1', IS],
  'Angel': ['N1', IS], 'Hoxton': ['N1', HA], 'Haggerston': ['E2', HA], 'Shoreditch': ['EC2', HA], 'Finsbury': ['EC1', IS],
  'Clerkenwell': ['EC1', IS], 'Clerkenwell Green': ['EC1', IS], "St Luke's": ['EC1', IS], 'Farringdon': ['EC1', CL], 'West Smithfield': ['EC1', CL],
  'Barbican': ['EC2', CL], 'Moorgate': ['EC2', CL], 'Bank': ['EC2', CL], 'The City': ['EC2', CL], 'Monument': ['EC3', CL],
  'Leadenhall Market': ['EC3', CL], 'Aldgate': ['EC3', CL], 'Tower Hill': ['EC3', TH], 'Bishopsgate': ['EC2', CL], 'Bishopsgate Without': ['EC2', CL],
  'East Smithfield': ['E1', TH], 'Spitalfields': ['E1', TH], 'Whitechapel': ['E1', TH], 'Mile End New Town': ['E1', TH],
  "St Paul's": ['EC4', CL], 'Blackfriars': ['EC4', CL], 'Bankside': ['SE1', SO], 'South Bank': ['SE1', LA], 'Waterloo': ['SE1', LA],
  'Southwark': ['SE1', SO], 'The Borough': ['SE1', SO], 'Borough Market': ['SE1', SO], "Butler's Wharf": ['SE1', SO], 'Lambeth': ['SE1', LA],
  'Kennington': ['SE11', LA], 'Kennington Cross': ['SE11', LA], 'Vauxhall': ['SE11', LA], 'Oval': ['SE11', LA],
  'Elephant and Castle': ['SE1', SO], 'Walworth': ['SE17', SO], 'Old Kent Road': ['SE1', SO], 'Bermondsey Village': ['SE1', SO],
  'Bermondsey Spa': ['SE16', SO], 'Nine Elms': ['SW8', WA], 'Battersea': ['SW11', WA], 'Pool of London': ['EC3', CL],
  'London Bridge': ['SE1', SO], 'Bermondsey': ['SE1', SO], 'Tower of London': ['EC3', TH]
};

/** rough postcode district by position (frame origin = Nelson's Column), for places without a known district */
function postcodeByPosition(x, z) {
  if (z > 250 && x > -1500) return x > 1800 ? 'SE16' : z > 1800 ? 'SE11' : 'SE1';
  if (z > 900) return x < -1800 ? 'SW3' : 'SW1';
  if (x > 1300) return z < -1500 ? 'N1' : 'EC2';
  if (x > 300) return z < -900 ? 'WC1' : 'WC2';
  if (x < -2800) return 'W2';
  return z < -1800 ? 'NW1' : z > 200 ? 'SW1' : 'W1';
}

/** { postcode, borough } for a district name (and position, as the fallback) */
export function postcodeFor(district, x = 0, z = 0) {
  const d = district && DISTRICT_INFO[district];
  if (d) return { postcode: d[0], borough: d[1] };
  return { postcode: postcodeByPosition(x, z), borough: '' };
}

// ---------------------------------------------------------------------------------------------------------------------
// Styles
// ---------------------------------------------------------------------------------------------------------------------
const CSS = `
:root { --ldn-red: #c8102e; --ldn-plate: #fbfbf7; --ldn-ink: #141414; --taxi: #e3283e; --taxi-ink: #ffffff; }
/* brand badge (replaces the NY subway bullet) */
.ldn-badge { width: 34px; height: 30px; border-radius: 7px; background: var(--ldn-red); color: #fff; font: 800 11px/1 Inter, -apple-system, sans-serif;
  letter-spacing: .04em; display: inline-flex; align-items: center; justify-content: center; flex: none;
  box-shadow: inset 0 -1px 0 rgba(0,0,0,.25), inset 0 0 0 1.5px rgba(255,255,255,.18); }
.loader .ldn-badge { width: 52px; height: 44px; font-size: 16px; border-radius: 10px; margin-bottom: 4px; }
.mta-bullet.ldn-badge { background: var(--ldn-red); color: #fff; border-radius: 7px; width: 34px; }

/* London street-name plate */
.location .ldn-plates { display: flex; flex-direction: column; align-items: flex-start; gap: 7px; animation: rise-in .4s cubic-bezier(.22,1,.36,1) both; }
.ldn-plate { display: inline-block; max-width: 330px; padding: 3px; background: var(--ldn-plate); border-radius: 3px;
  box-shadow: 0 1px 0 rgba(0,0,0,.35), 0 10px 22px -10px rgba(0,0,0,.75); }
.ldn-plate-inner { border: 1.6px solid var(--ldn-ink); border-radius: 2px; padding: 6px 12px 5px; display: flex; flex-direction: column; align-items: center; min-width: 120px; }
.ldn-plate-row { display: flex; align-items: baseline; gap: 7px; max-width: 100%; }
.ldn-plate-name { font: 700 15px/1.05 Inter, "Helvetica Neue", Arial, sans-serif; letter-spacing: .035em; text-transform: uppercase; color: var(--ldn-ink);
  white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.ldn-plate-pc { font: 800 14px/1.05 Inter, "Helvetica Neue", Arial, sans-serif; color: var(--ldn-red); letter-spacing: .02em; flex: none; }
.ldn-plate-borough { align-self: stretch; margin-top: 4px; padding-top: 3px; border-top: 1px solid var(--ldn-ink); text-align: center;
  font: 650 7.5px/1.1 Inter, Arial, sans-serif; letter-spacing: .14em; text-transform: uppercase; color: var(--ldn-ink); white-space: nowrap; }
.ldn-place { max-width: 330px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; font-size: 11px; font-weight: 700; letter-spacing: .1em;
  text-transform: uppercase; color: rgba(255,255,255,.94); text-shadow: 0 1px 2px rgba(0,0,0,.7), 0 0 14px rgba(0,0,0,.4); }
.ldn-district { font-size: 10.5px; font-weight: 650; letter-spacing: .12em; text-transform: uppercase; color: rgba(255,255,255,.82);
  text-shadow: 0 1px 2px rgba(0,0,0,.7); }

/* weather buttons share the time-of-day button look */
.weather-switch { display: flex; gap: 2px; }
.weather-btn .icon { width: 18px; height: 18px; }

/* the radar sits on map paper */
.radar { background: #f4f0e5; }
.radar-north { background: #141414; box-shadow: 0 0 0 1.5px #fff; }
.radar:hover .radar-key { color: #fff; background: var(--ldn-red); }
@media (max-width: 1240px) { .weather-btn.active .seg-label { display: none; } .weather-btn.active { padding: 0 9px; gap: 0; } }
@media (max-width: 820px) { .weather-switch { display: none; } }
`;

const WEATHER_ICONS = {
  clear: '<circle cx="12" cy="12" r="4"/><path d="M12 3.2v2M12 18.8v2M3.2 12h2M18.8 12h2M5.8 5.8l1.4 1.4M16.8 16.8l1.4 1.4M5.8 18.2l1.4-1.4M16.8 7.2l1.4-1.4"/>',
  overcast: '<path d="M7.2 18.5h10a4 4 0 0 0 .4-8 5.6 5.6 0 0 0-10.8 1.4 3.3 3.3 0 0 0 .4 6.6z"/>',
  drizzle: '<path d="M7.2 14.5h10a3.6 3.6 0 0 0 .4-7.2 5.2 5.2 0 0 0-10 1.3 3 3 0 0 0-.4 5.9z"/><path d="M8.5 17.2l-.9 2.3M12.3 17.2l-.9 2.3M16.1 17.2l-.9 2.3"/>',
  fog: '<path d="M4 8.5h16M6 12h14M4 15.5h13M7 19h10"/>'
};
const WEATHER_NAMES = { clear: 'Clear', overcast: 'Overcast', drizzle: 'Drizzle', fog: 'Fog' };

// NY strings in index.html replaced at runtime ([selector, attribute | 'text', London value])
const NY_TEXT = [
  ['title', 'text', 'London Loop'],
  ['.loader-title', 'text', 'London Loop'],
  ['.brand-titles h1', 'text', 'London Loop'],
  ['#canvas-container', 'aria-label', '3D London Loop viewport'],
  ['#btn-open-map', 'title', 'London Street Atlas [M]'],
  ['#minimap-card', 'aria-label', 'Live London street radar'],
  ['#minimap-card', 'title', 'Open the London Street Atlas [M]'],
  ['#fullmap-modal', 'aria-label', 'London Street Atlas'],
  ['.fullmap-title h2', 'text', 'London Street Atlas']
];

function svgIcon(inner) {
  const ns = 'http://www.w3.org/2000/svg';
  const svg = document.createElementNS(ns, 'svg');
  svg.setAttribute('class', 'icon');
  svg.setAttribute('viewBox', '0 0 24 24');
  svg.setAttribute('aria-hidden', 'true');
  svg.setAttribute('fill', 'none');
  svg.setAttribute('stroke', 'currentColor');
  svg.setAttribute('stroke-width', '1.7');
  svg.setAttribute('stroke-linecap', 'round');
  svg.setAttribute('stroke-linejoin', 'round');
  // static, trusted markup from this module
  svg.innerHTML = inner;
  return svg;
}

function el(tag, cls, text) {
  const e = document.createElement(tag);
  if (cls) e.className = cls;
  if (text != null) e.textContent = text;
  return e;
}

const safeGet = (k) => { try { return localStorage.getItem(k); } catch { return null; } };
const safeSet = (k, v) => { try { localStorage.setItem(k, v); } catch { /* private mode */ } };

// ---------------------------------------------------------------------------------------------------------------------
// Street plates
// ---------------------------------------------------------------------------------------------------------------------
const LANDMARK_NAMES = new Map(LONDON_LANDMARKS.map((l) => [l.name, l]));

/** one plate element: name + red postcode, borough under a rule */
export function makeStreetPlate(name, postcode = '', borough = '') {
  const plate = el('div', 'ldn-plate');
  const inner = el('div', 'ldn-plate-inner');
  const row = el('div', 'ldn-plate-row');
  row.appendChild(el('span', 'ldn-plate-name', name));
  if (postcode) row.appendChild(el('span', 'ldn-plate-pc', postcode));
  inner.appendChild(row);
  if (borough) inner.appendChild(el('div', 'ldn-plate-borough', borough));
  plate.appendChild(inner);
  return plate;
}

/**
 * Renders getLocationLabel()'s {primary, secondary} (or its "primary · secondary" text) into the #hud-location element
 * as London plates. Landmarks get a caption over the plate of the street they're on.
 */
export function renderLocationPlates(container, label, pos = null) {
  if (!container || !label) return;
  const lab = typeof label === 'string' ? (() => { const i = label.indexOf(' · '); return i < 0 ? { primary: label, secondary: '' } : { primary: label.slice(0, i), secondary: label.slice(i + 3) }; })() : label;
  const key = `${lab.primary}|${lab.secondary}`;
  if (container.dataset.ldnKey === key) return;
  container.dataset.ldnKey = key;
  const lm = LANDMARK_NAMES.get(lab.primary);
  if (typeof location !== 'undefined' && new URLSearchParams(location.search).get('city') === 'brussels') {
    const wrap = el('div', 'ldn-plates');
    const street = lm ? lab.secondary : lab.primary;
    const district = lm ? lm.district : lab.secondary;
    if (lm) wrap.appendChild(el('div', 'ldn-place', lm.name));
    if (street) wrap.appendChild(makeStreetPlate(street, '', district || 'Brussels'));
    if (!lm && district && district !== street) wrap.appendChild(el('div', 'ldn-district', district));
    container.replaceChildren(wrap);
    return;
  }
  let street = lab.primary, district = lab.secondary, place = '';
  if (lm) {
    place = lm.name;
    street = lab.secondary;
    district = lm.district;
  }
  const x = pos ? pos.x : lm ? lm.x : 0, z = pos ? pos.z : lm ? lm.z : 0;
  const { postcode, borough } = postcodeFor(district, x, z);
  const wrap = el('div', 'ldn-plates');
  if (place) wrap.appendChild(el('div', 'ldn-place', place));
  if (street) wrap.appendChild(makeStreetPlate(street, /river|thames/i.test(street) ? '' : postcode, borough));
  if (!lm && district && district !== street) wrap.appendChild(el('div', 'ldn-district', district));
  container.replaceChildren(wrap);
}

// ---------------------------------------------------------------------------------------------------------------------
// applyLondonHud
// ---------------------------------------------------------------------------------------------------------------------
/**
 * @param {object} [o]
 * @param {object} [o.mainHooks]
 * @param {object} [o.mainHooks.lighting]    LightingSystem (setWeather, weather, onWeatherChange)
 * @param {object} [o.mainHooks.colorGrade]  createPostProcessing() result (applyWeather)
 * @param {(id: string) => void} [o.mainHooks.setWeather]  overrides the two above
 * @param {(id: string) => void} [o.mainHooks.onWeather]    told after every change
 * @param {string} [o.mainHooks.initialWeather]  apply this weather now (default: the last one picked, else none)
 * @returns {{ renderLocation(label, pos?), setActiveWeather(id), weatherButtons: HTMLElement[] }}
 */
export function applyLondonHud({ mainHooks = {} } = {}) {
  const isBrussels = typeof location !== 'undefined' && new URLSearchParams(location.search).get('city') === 'brussels';
  const weatherStorageKey = isBrussels ? 'brusselsloop_weather' : 'londonloop_weather';
  if (!document.getElementById('ldn-ui-style')) {
    const st = document.createElement('style');
    st.id = 'ldn-ui-style';
    st.textContent = CSS;
    document.head.appendChild(st);
  }

  // NY text -> selected city
  const brusselsText = {
    title: 'Brussels Loop',
    '.loader-title': 'Brussels Loop',
    '.brand-titles h1': 'Brussels Loop',
    '#canvas-container': '3D Brussels Loop viewport',
    '#btn-open-map': 'Brussels Street Atlas [M]',
    '#minimap-card': 'Live Brussels street radar',
    '#fullmap-modal': 'Brussels Street Atlas',
    '.fullmap-title h2': 'Brussels Street Atlas'
  };
  for (const [sel, attr, value] of NY_TEXT) {
    const selectedValue = isBrussels ? (brusselsText[sel] || value) : value;
    for (const node of document.querySelectorAll(sel)) {
      if (attr === 'text') node.textContent = selectedValue;
      else node.setAttribute(attr, selectedValue);
    }
  }
  for (const b of document.querySelectorAll('.mta-bullet')) {
    b.textContent = isBrussels ? 'BRU' : 'LDN';
    b.classList.add('ldn-badge');
  }
  const desc = document.querySelector('meta[name="description"]');
  if (desc) desc.setAttribute('content', isBrussels ? 'Brussels Loop: a playable 1:1-scale Brussels city built from OpenStreetMap with three.js WebGPU & TSL.' : 'London Loop: a GTA-style 1:1 Zone 1 London built from OpenStreetMap with three.js WebGPU & TSL.');

  // weather buttons
  const buttons = [];
  const setActiveWeather = (id) => {
    for (const b of buttons) b.classList.toggle('active', b.dataset.weather === id);
  };
  const applyWeather = (id) => {
    if (mainHooks.setWeather) mainHooks.setWeather(id);
    else {
      if (mainHooks.lighting && mainHooks.lighting.setWeather) mainHooks.lighting.setWeather(id);
      if (mainHooks.colorGrade && mainHooks.colorGrade.applyWeather) mainHooks.colorGrade.applyWeather(id);
    }
    setActiveWeather(id);
    safeSet(weatherStorageKey, id);
    if (mainHooks.onWeather) mainHooks.onWeather(id);
  };
  const timeSwitch = document.querySelector('.time-switch');
  if (timeSwitch && !document.querySelector('.weather-switch')) {
    const group = el('div', 'weather-switch');
    group.setAttribute('role', 'group');
    group.setAttribute('aria-label', 'Weather');
    for (const id of Object.keys(WEATHER_ICONS)) {
      const b = el('button', 'time-btn weather-btn');
      b.type = 'button';
      b.dataset.weather = id;
      b.title = `${WEATHER_NAMES[id]} weather`;
      b.appendChild(svgIcon(WEATHER_ICONS[id]));
      b.appendChild(el('span', 'seg-label', WEATHER_NAMES[id]));
      b.addEventListener('click', () => applyWeather(id));
      group.appendChild(b);
      buttons.push(b);
    }
    const div = el('span', 'toolbar-divider');
    div.setAttribute('aria-hidden', 'true');
    timeSwitch.after(div, group);
  }
  const lighting = mainHooks.lighting;
  if (lighting && lighting.onWeatherChange) lighting.onWeatherChange((id) => setActiveWeather(id));
  const initial = mainHooks.initialWeather || (mainHooks.restoreWeather !== false && safeGet(weatherStorageKey)) || (lighting && lighting.weather) || '';
  if (initial && WEATHER_NAMES[initial]) {
    if (mainHooks.initialWeather || safeGet('londonloop_weather')) applyWeather(initial);
    else setActiveWeather(initial);
  }

  const elLocation = document.getElementById('hud-location');
  return {
    renderLocation: (label, pos) => renderLocationPlates(elLocation, label, pos),
    setActiveWeather,
    weatherButtons: buttons
  };
}
