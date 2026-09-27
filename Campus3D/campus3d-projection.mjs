// FIU GLB coordinates: X east, Y up, Z south, metres at this local origin.
// EPSG:3857 uses spherical Mercator metres, not physical ground metres.
export const MODEL_ORIGIN = Object.freeze({ latitude: 25.7565, longitude: -80.3745 });
export const EARTH_RADIUS = 6378137;
export const WORLD_CIRCUMFERENCE = 2 * Math.PI * EARTH_RADIUS;
export const METRES_PER_DEGREE = 111320;
const RAD = Math.PI / 180;
const LATITUDE_SCALE = Math.cos(MODEL_ORIGIN.latitude * RAD);
export const HEIGHT_SCALE = 1 / LATITUDE_SCALE;
const ORIGIN_EAST = EARTH_RADIUS * MODEL_ORIGIN.longitude * RAD;
const ORIGIN_NORTH = northing(MODEL_ORIGIN.latitude);

function northing(latitude) {
  if (!Number.isFinite(latitude) || Math.abs(latitude) > 85.0511287798066) {
    throw new RangeError('Latitude is outside the Web Mercator range.');
  }
  return EARTH_RADIUS * Math.log(Math.tan(Math.PI / 4 + latitude * RAD / 2));
}

export function modelToGeographic(x, z) {
  if (!Number.isFinite(x) || !Number.isFinite(z)) throw new TypeError('Model coordinates must be finite.');
  return {
    latitude: MODEL_ORIGIN.latitude - z / METRES_PER_DEGREE,
    longitude: MODEL_ORIGIN.longitude + x / (METRES_PER_DEGREE * LATITUDE_SCALE),
  };
}

export function geographicToLocalMercator(latitude, longitude) {
  if (!Number.isFinite(longitude)) throw new TypeError('Longitude must be finite.');
  return {
    x: EARTH_RADIUS * longitude * RAD - ORIGIN_EAST,
    z: ORIGIN_NORTH - northing(latitude),
  };
}

export function modelToLocalMercator(x, y, z) {
  if (!Number.isFinite(y)) throw new TypeError('Height must be finite.');
  const geographic = modelToGeographic(x, z);
  const projected = geographicToLocalMercator(geographic.latitude, geographic.longitude);
  return { x: projected.x, y: y * HEIGHT_SCALE, z: projected.z };
}

// A shear changes elevated geometry only. Every Y=0 point stays registered.
export function applyHeightRelief(point, relief = 0.65) {
  if (!Number.isFinite(relief) || relief < 0 || relief > 1.5) throw new RangeError('Relief must be between 0 and 1.5.');
  return { x: point.x, y: point.y, z: point.z - relief * point.y };
}

// Use actual projected viewport pixels, including the current drag offset;
// getCenter() alone can differ from the on-screen pixel origin by rounding.
export function leafletViewport(map) {
  const size = map.getSize();
  const offset = map.containerPointToLayerPoint([0, 0]);
  const origin = map.getPixelOrigin();
  const zoom = map.getZoom();
  const topLeft = map.unproject({ x: origin.x + offset.x, y: origin.y + offset.y }, zoom);
  const corner = geographicToLocalMercator(topLeft.lat, topLeft.lng);
  const metresPerPixel = WORLD_CIRCUMFERENCE / map.options.crs.scale(zoom);
  return {
    width: size.x, height: size.y, offset,
    metresPerPixel,
    centerX: corner.x + size.x * metresPerPixel / 2,
    centerZ: corner.z + size.y * metresPerPixel / 2,
    halfWidth: size.x * metresPerPixel / 2,
    halfHeight: size.y * metresPerPixel / 2,
  };
}

export function isPresentationOnlyNode(name) {
  const normalized = String(name || '').replace(/[\s_]+/g, '').toLowerCase();
  return normalized === 'campusbase' || normalized === '08orientation';
}
