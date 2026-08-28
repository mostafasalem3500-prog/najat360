/**
 * Small shared geo utilities. Pure math, no I/O, no PostGIS — this project
 * deliberately stays off PostGIS for MVP scope (see prisma/schema.prisma's
 * "ملاحظة PostGIS" note in the original spec: raw-SQL fallback preferred
 * over adding a heavier extension dependency this sandbox may not have).
 * Distances are planar-approximated via the haversine formula, accurate
 * enough at the sub-city scale this project operates at (a single Riyadh
 * zone), not intended for long-range/global-scale distance work.
 */

export interface LatLng {
  latitude: number;
  longitude: number;
}

const EARTH_RADIUS_METERS = 6_371_000;

function toRadians(degrees: number): number {
  return (degrees * Math.PI) / 180;
}

/** Great-circle distance between two points, in meters. */
export function haversineDistanceMeters(a: LatLng, b: LatLng): number {
  const dLat = toRadians(b.latitude - a.latitude);
  const dLng = toRadians(b.longitude - a.longitude);
  const lat1 = toRadians(a.latitude);
  const lat2 = toRadians(b.latitude);

  const h = Math.sin(dLat / 2) ** 2 + Math.cos(lat1) * Math.cos(lat2) * Math.sin(dLng / 2) ** 2;
  const c = 2 * Math.atan2(Math.sqrt(h), Math.sqrt(1 - h));
  return EARTH_RADIUS_METERS * c;
}
