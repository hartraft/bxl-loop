// Runtime city configuration router. Brussels is opt-in with ?city=brussels until the port is validated.
const useBrussels = typeof location !== 'undefined' &&
  new URLSearchParams(location.search).get('city') === 'brussels';
const city = useBrussels ? await import('./brussels-config.js') : await import('./london-config.js');

export const GEO = city.GEO;
export const WORLD_BOUNDS = city.WORLD_BOUNDS;
export const WORLD = city.WORLD;
export const ROADS = city.ROADS;
export const LONDON_LANDMARKS = city.LONDON_LANDMARKS;
export const TELEPORT_LOCATIONS = city.TELEPORT_LOCATIONS;
export const getLocationLabel = city.getLocationLabel;
export const getLocationText = city.getLocationText;
export const isTypingInField = city.isTypingInField;
