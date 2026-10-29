// Brussels is the default city on GitHub Pages and in local development.
const city = await import('./brussels-config.js');

export const GEO = city.GEO;
export const WORLD_BOUNDS = city.WORLD_BOUNDS;
export const WORLD = city.WORLD;
export const ROADS = city.ROADS;
export const BRUSSELS_LANDMARKS = city.BRUSSELS_LANDMARKS;
export const TELEPORT_LOCATIONS = city.TELEPORT_LOCATIONS;
export const getLocationLabel = city.getLocationLabel;
export const getLocationText = city.getLocationText;
export const isTypingInField = city.isTypingInField;
