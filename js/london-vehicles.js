// Compatibility shim for remaining legacy modules that still import the
// London vehicle module. The Brussels port uses the shared Brussels vehicle
// factories; keep the old import path valid while the remaining port is
// completed.
export {
  VEHICLE_FACTORIES,
  VEHICLE_UNIFORMS,
  CAR_COLOURS,
  getInstanceParts,
  createVehicleUniforms
} from './brussels-base-vehicles.js';
