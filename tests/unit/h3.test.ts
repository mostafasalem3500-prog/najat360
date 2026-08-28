import { describe, expect, it } from 'vitest';
import { latLngToH3Cell, h3CellToLatLng, h3GridDisk, isValidH3Cell, H3_RESOLUTION } from '@/lib/gis/h3';

// A point inside the demo's Riyadh-area coordinates used elsewhere in this
// project's seed data (see scripts/seed-demo.ts's entrance jitter center).
const RIYADH_POINT = { latitude: 24.7136, longitude: 46.6753 };

describe('latLngToH3Cell / h3CellToLatLng', () => {
  it('produces a valid H3 cell at the project default resolution', () => {
    const cell = latLngToH3Cell(RIYADH_POINT);
    expect(isValidH3Cell(cell)).toBe(true);
  });

  it('is deterministic: the same point always maps to the same cell', () => {
    expect(latLngToH3Cell(RIYADH_POINT)).toBe(latLngToH3Cell(RIYADH_POINT));
  });

  it('two points a few meters apart map to the same resolution-8 cell', () => {
    const nearby = { latitude: RIYADH_POINT.latitude + 0.0002, longitude: RIYADH_POINT.longitude + 0.0002 };
    expect(latLngToH3Cell(RIYADH_POINT)).toBe(latLngToH3Cell(nearby));
  });

  it('a point several kilometers away maps to a different cell', () => {
    const farAway = { latitude: RIYADH_POINT.latitude + 0.5, longitude: RIYADH_POINT.longitude + 0.5 };
    expect(latLngToH3Cell(RIYADH_POINT)).not.toBe(latLngToH3Cell(farAway));
  });

  it('cellToLatLng round-trips to a center point within the same cell', () => {
    const cell = latLngToH3Cell(RIYADH_POINT);
    const center = h3CellToLatLng(cell);
    expect(latLngToH3Cell(center)).toBe(cell);
  });

  it('respects an explicit resolution override', () => {
    const coarseCell = latLngToH3Cell(RIYADH_POINT, 6);
    const fineCell = latLngToH3Cell(RIYADH_POINT, 10);
    expect(coarseCell).not.toBe(fineCell);
    expect(isValidH3Cell(coarseCell)).toBe(true);
    expect(isValidH3Cell(fineCell)).toBe(true);
  });
});

describe('h3GridDisk', () => {
  it('a 0-ring disk is just the center cell itself', () => {
    const center = latLngToH3Cell(RIYADH_POINT);
    expect(h3GridDisk(center, 0)).toEqual([center]);
  });

  it('includes the center cell plus its neighbors for ring size 1 (7 cells for a normal hex grid)', () => {
    const center = latLngToH3Cell(RIYADH_POINT);
    const disk = h3GridDisk(center, 1);
    expect(disk).toContain(center);
    expect(disk.length).toBe(7);
  });

  it('every returned cell is valid', () => {
    const center = latLngToH3Cell(RIYADH_POINT);
    const disk = h3GridDisk(center, 2);
    expect(disk.every((c) => isValidH3Cell(c))).toBe(true);
  });

  it('a larger ring strictly contains a smaller ring from the same center', () => {
    const center = latLngToH3Cell(RIYADH_POINT);
    const small = new Set(h3GridDisk(center, 1));
    const large = h3GridDisk(center, 2);
    expect(large.length).toBeGreaterThan(small.size);
    for (const cell of small) expect(large).toContain(cell);
  });
});

describe('H3_RESOLUTION', () => {
  it('is a valid H3 resolution (0-15)', () => {
    expect(H3_RESOLUTION).toBeGreaterThanOrEqual(0);
    expect(H3_RESOLUTION).toBeLessThanOrEqual(15);
  });
});
