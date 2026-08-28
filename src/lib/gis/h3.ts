/**
 * H3 wrapper — spec section 17/18/29.4's coverage grid needs a real
 * hexagonal-cell index, not hand-rolled hexagon math. Uses the official
 * `h3-js` library (Uber's H3 grid system) rather than reimplementing cell
 * indexing/adjacency — this project's own "don't reinvent geometry a
 * battle-tested library already solves correctly" rule, same reasoning as
 * using the real `haversineDistanceMeters()` formula in `lib/geo.ts`
 * instead of an approximation.
 *
 * This file is a THIN wrapper: it exists so the rest of the codebase
 * imports `@/lib/gis/h3` (this project's own module boundary) rather than
 * `h3-js` directly everywhere, and so the demo's fixed resolution/grid
 * choices live in exactly one documented place.
 */
import { latLngToCell, cellToLatLng, gridDisk, isValidCell } from 'h3-js';
import type { LatLng } from '@/lib/geo';

/**
 * Resolution 8 (~0.74 km² average cell area) — this project's own choice,
 * not spec-mandated (spec just says "H3" without a resolution). Chosen
 * because the demo operates in a single limited zone (spec section 19: "20
 * -30 entrances... within a limited demo extent") where a coarser
 * resolution (e.g. 6) would collapse the whole demo area into a handful of
 * cells, and a finer one (e.g. 10) would produce more cells than the
 * demo's ~10 units could ever meaningfully cover — 8 is the standard
 * "city block to small neighborhood" H3 resolution used in most published
 * H3 coverage-analysis examples.
 */
export const H3_RESOLUTION = 8;

export function latLngToH3Cell(point: LatLng, resolution: number = H3_RESOLUTION): string {
  return latLngToCell(point.latitude, point.longitude, resolution);
}

export function h3CellToLatLng(h3Index: string): LatLng {
  const [latitude, longitude] = cellToLatLng(h3Index);
  return { latitude, longitude };
}

/**
 * Every cell within `ringSize` grid-steps of `centerH3Index`, INCLUDING
 * the center cell itself (h3-js's own `gridDisk` semantics) — used to
 * build the demo's coverage-evaluation grid around the seeded entrances.
 */
export function h3GridDisk(centerH3Index: string, ringSize: number): string[] {
  return gridDisk(centerH3Index, ringSize);
}

export function isValidH3Cell(h3Index: string): boolean {
  return isValidCell(h3Index);
}
