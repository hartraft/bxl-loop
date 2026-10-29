// Compatibility shim for remaining legacy modules that still import the
// London vehicle module. The Brussels port uses the shared Brussels vehicle
// factories; preserve the legacy path while exposing the complete API.
export * from './brussels-base-vehicles.js';
