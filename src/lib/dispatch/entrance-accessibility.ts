/**
 * Entrance accessibility scoring — spec section 15's "ترتيب المداخل" list
 * (distance, vehicle access, pedestrian access, entrance status,
 * validation recency, ETA) minus ETA (that is the Access Score's separate
 * 0.40 `etaScore` term) and minus distance (already used by
 * `resolver.ts`'s entrance SELECTION — an entrance reaching this function
 * has already been chosen as nearby; this function scores how USABLE it
 * is once you're there, not how far away it is).
 *
 * Spec lists the factors but gives no formula for combining them (unlike
 * the Access Score itself, which spec pins exactly) — the point deductions
 * below are this project's own choice, documented so they can be tuned
 * later without guessing what they were trying to encode.
 */
import type { Entrance, ValidationStatus } from '@/lib/domain/types';

export const ENTRANCE_ACCESSIBILITY_VERSION = 'entrance-accessibility-v1';

const VALIDATION_PENALTY: Record<ValidationStatus, number> = {
  FIELD_CONFIRMED: 0,
  MANUALLY_REVIEWED: 10,
  UNVERIFIED: 20,
};

export interface EntranceAccessibilityInput {
  entrance: Pick<
    Entrance,
    | 'active'
    | 'validationStatus'
    | 'vehicleAccessible'
    | 'pedestrianAccessible'
    | 'isServiceGate'
    | 'temporaryRestriction'
    | 'floorLevel'
    | 'hasElevator'
  >;
  /** The incident's own resolved floor (from `LocationResolution.floorLevel`), if any. */
  resolvedFloorLevel?: string | null;
}

/**
 * Returns a 0-100 score. An inactive entrance scores 0 outright — callers
 * should exclude inactive entrances from candidate selection entirely
 * (this is a defensive floor, not the primary exclusion mechanism).
 */
export function computeEntranceAccessibilityScore(input: EntranceAccessibilityInput): number {
  const { entrance, resolvedFloorLevel } = input;

  if (!entrance.active) return 0;

  let score = 100;
  score -= VALIDATION_PENALTY[entrance.validationStatus];
  if (!entrance.vehicleAccessible) score -= 25;
  if (!entrance.pedestrianAccessible) score -= 10;
  if (entrance.isServiceGate) score -= 15;
  if (entrance.temporaryRestriction && entrance.temporaryRestriction.trim().length > 0) score -= 30;

  const floorKnown = Boolean(resolvedFloorLevel) && Boolean(entrance.floorLevel);
  if (floorKnown && resolvedFloorLevel !== entrance.floorLevel) {
    // Soft signal, not a hard exclusion — the same physical entrance often
    // serves multiple floors via stairs/elevator, so a mismatch alone
    // shouldn't disqualify it. Lacking an elevator makes a floor mismatch
    // materially worse (stairs-only access to an unconfirmed floor).
    score -= entrance.hasElevator ? 5 : 15;
  }

  return Math.min(100, Math.max(0, Math.round(score)));
}
