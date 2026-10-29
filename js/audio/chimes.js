// js/audio/chimes.js — Workstream L: the Westminster Quarters (public domain, 1793) and Big Ben's hour strike, in real
// London time. Pure functions (no WebAudio) so the schedule is unit-tested in Node.
//
// The four quarter bells are G#4, F#4, E4 and B3; Big Ben itself is an E (E3 here). The five "changes":
//   1: G# F# E B    2: E G# F# B    3: E F# G# E    4: G# E F# B    5: B F# G# E
// :15 → 1 · :30 → 2 3 · :45 → 4 5 1 · :00 → 2 3 4 5, then the hour on Big Ben (12-hour count).

export const QUARTER_BELLS = { 'G#': 415.3, 'F#': 369.99, E: 329.63, B: 246.94 };
export const BIG_BEN_HZ = 164.81; // E3
const CHANGES = [
  ['G#', 'F#', 'E', 'B'],
  ['E', 'G#', 'F#', 'B'],
  ['E', 'F#', 'G#', 'E'],
  ['G#', 'E', 'F#', 'B'],
  ['B', 'F#', 'G#', 'E']
];
const SEQ = { 1: [0], 2: [1, 2], 3: [3, 4, 0], 4: [1, 2, 3, 4] };
export const NOTE_GAP = 0.78; // s between strokes in a change
export const CHANGE_GAP = 1.9; // s from a change's last stroke to the next change's first
export const HOUR_GAP = 4.6; // s between Big Ben's strokes
export const HOUR_PAUSE = 4.2; // s after the quarters before the first hour stroke

/**
 * The strokes for a quarter (1 = :15, 2 = :30, 3 = :45, 4 = the hour) → [{t (s from the start), bell: 'G#'|…|'BEN', hz, gain}].
 * `hour` (1–12) adds Big Ben's strokes after the full chime.
 */
export function chimeSchedule(quarter, hour = 12) {
  const out = [];
  let t = 0;
  const seq = SEQ[quarter] || [];
  seq.forEach((ci, k) => {
    const ch = CHANGES[ci];
    ch.forEach((b, i) => {
      out.push({ t, bell: b, hz: QUARTER_BELLS[b], gain: i === 3 ? 1 : 0.85 });
      if (i < 3) t += NOTE_GAP;
    });
    if (k < seq.length - 1) t += CHANGE_GAP;
  });
  if (quarter === 4) {
    t += HOUR_PAUSE;
    const n = ((hour - 1) % 12 + 12) % 12 + 1;
    for (let i = 0; i < n; i++) { out.push({ t, bell: 'BEN', hz: BIG_BEN_HZ, gain: 1.25 }); t += HOUR_GAP; }
  }
  return out;
}

/** London wall-clock {h, m, s} for a JS Date (Europe/London, so BST/GMT are right) */
export function londonTime(date = new Date()) {
  try {
    const f = londonTime._f || (londonTime._f = new Intl.DateTimeFormat('en-GB', { timeZone: 'Europe/London', hour: '2-digit', minute: '2-digit', second: '2-digit', hourCycle: 'h23' }));
    const parts = f.formatToParts(date);
    const g = (t) => +parts.find((p) => p.type === t).value;
    return { h: g('hour'), m: g('minute'), s: g('second') + (date.getMilliseconds() / 1000) };
  } catch {
    return { h: date.getUTCHours(), m: date.getUTCMinutes(), s: date.getUTCSeconds() };
  }
}

/** Brussels wall-clock {h, m, s} for a JS Date (Europe/Brussels, including CET/CEST). */
export function brusselsTime(date = new Date()) {
  try {
    const f = brusselsTime._f || (brusselsTime._f = new Intl.DateTimeFormat('en-GB', { timeZone: 'Europe/Brussels', hour: '2-digit', minute: '2-digit', second: '2-digit', hourCycle: 'h23' }));
    const parts = f.formatToParts(date);
    const g = (t) => +parts.find((p) => p.type === t).value;
    return { h: g('hour'), m: g('minute'), s: g('second') + (date.getMilliseconds() / 1000) };
  } catch {
    return { h: date.getUTCHours(), m: date.getUTCMinutes(), s: date.getUTCSeconds() };
  }
}

/**
 * Which chime is due: the quarter that started within the last `window` seconds → {quarter, hour, key, age} or null.
 * The quarters of the hour chime start ~20 s before the hour in reality; we start every chime on the quarter itself.
 */
export function dueChime(t, window = 2.5) {
  const into = (t.m % 15) * 60 + t.s;
  if (into > window) return null;
  const q = Math.floor(t.m / 15); // 0 = :00
  const quarter = q === 0 ? 4 : q;
  const hour12 = t.h % 12 === 0 ? 12 : t.h % 12;
  return { quarter, hour: hour12, key: `${t.h}:${q}`, age: into };
}
