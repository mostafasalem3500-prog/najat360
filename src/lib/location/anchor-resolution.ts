/**
 * Server-side resolution of a Rescue Anchor QR code into a location
 * observation (spec 29.1). This is the ONLY code path in this project
 * allowed to produce an `ANCHOR_QR` observation, and it is structurally
 * incapable of trusting caller-supplied coordinates: `buildObservationFromAnchor()`
 * takes an already-looked-up `LocationAnchorRecord` (never a raw lat/lng
 * parameter), and `resolveAnchorToObservation()` only ever gets coordinates
 * from `AnchorLookup.getActiveAnchorByCode()` — there is no parameter on
 * either function through which a client-controlled coordinate could flow
 * into the returned observation. This mirrors the C1 allowlist's
 * "architectural isolation" layer: the safety property is a shape of the
 * code, not a runtime check that could be forgotten at a call site.
 *
 * `AnchorLookup` is an injected interface (not a direct DB import) for the
 * same testability reason as `CadReadProvider`/`AssistedCaptureProvider` —
 * a future Next.js route handler for `/caller/[token]?anchor=[anchorCode]`
 * implements this against Prisma and passes it in.
 */
import type { AnchorType, LocationObservationSource, ValidationStatus } from '@/lib/domain/types';

export interface LocationAnchorRecord {
  id: string;
  code: string;
  entranceId: string;
  floorLevel?: string | null;
  latitude: number;
  longitude: number;
  anchorType: AnchorType;
  validationStatus: ValidationStatus;
  validFrom: Date;
  validUntil?: Date | null;
  active: boolean;
}

export interface AnchorLookup {
  /** Returns null for a code that does not exist at all — never throws for "not found" so callers can distinguish "no such code" from a real lookup failure. */
  getActiveAnchorByCode(code: string): Promise<LocationAnchorRecord | null>;
}

export class AnchorNotFoundError extends Error {
  constructor(public readonly code: string) {
    super(`No LocationAnchor found for code "${code}"`);
    this.name = 'AnchorNotFoundError';
  }
}

export class AnchorNotActiveError extends Error {
  constructor(
    public readonly code: string,
    public readonly reason: string
  ) {
    super(`Anchor "${code}" is not currently usable: ${reason}`);
    this.name = 'AnchorNotActiveError';
  }
}

/** New-observation shape (no `id` — the caller's repository layer assigns one on insert), matching `LocationObservation` minus the generated fields. */
export interface NewLocationObservationInput {
  incidentId: string;
  source: LocationObservationSource;
  latitude: number;
  longitude: number;
  horizontalAccuracyMeters?: number;
  floorLevel?: string;
  capturedAt: Date;
  provenanceLabel: string;
  metadata: Record<string, unknown>;
}

/**
 * Turns an already-resolved anchor record into an observation. Pure — no
 * lookup here, so it is trivially unit-testable and cannot itself be
 * tricked into using different coordinates than the anchor record it was
 * given.
 */
export function buildObservationFromAnchor(
  anchor: LocationAnchorRecord,
  incidentId: string,
  capturedAt: Date
): NewLocationObservationInput {
  return {
    incidentId,
    source: 'ANCHOR_QR',
    latitude: anchor.latitude,
    longitude: anchor.longitude,
    floorLevel: anchor.floorLevel ?? undefined,
    capturedAt,
    provenanceLabel: `Rescue Anchor ${anchor.code}`,
    metadata: {
      coordinateAuthority: 'SERVER_ANCHOR_RECORD',
      anchorId: anchor.id,
      anchorType: anchor.anchorType,
    },
  };
}

/**
 * Looks up `code` via the injected `lookup`, validates it is currently
 * usable (exists, active, within its valid window), and returns the
 * observation to persist. Throws `AnchorNotFoundError`/`AnchorNotActiveError`
 * rather than returning null, so a route handler's error branch is forced
 * to handle "bad anchor code" explicitly instead of silently falling
 * through to some other location source.
 */
export async function resolveAnchorToObservation(
  lookup: AnchorLookup,
  code: string,
  incidentId: string,
  capturedAt: Date
): Promise<NewLocationObservationInput> {
  const anchor = await lookup.getActiveAnchorByCode(code);
  if (!anchor) {
    throw new AnchorNotFoundError(code);
  }
  if (!anchor.active) {
    throw new AnchorNotActiveError(code, 'anchor is marked inactive');
  }
  if (anchor.validFrom.getTime() > capturedAt.getTime()) {
    throw new AnchorNotActiveError(code, 'anchor is not valid yet (before validFrom)');
  }
  if (anchor.validUntil && anchor.validUntil.getTime() < capturedAt.getTime()) {
    throw new AnchorNotActiveError(code, 'anchor has expired (past validUntil)');
  }
  return buildObservationFromAnchor(anchor, incidentId, capturedAt);
}

/**
 * Builder for the OTHER end of the provenance-tagging pattern above: an
 * observation whose coordinates genuinely did come from the caller's own
 * device (BROWSER_GPS) or a human's deliberate placement (MANUAL_PIN).
 * Tagging `coordinateAuthority: 'CALLER_DEVICE'` here — rather than only
 * ever writing `'SERVER_ANCHOR_RECORD'` for anchors and leaving everything
 * else untagged — means a future call-taker/audit view can tell at a
 * glance which observations are server-verified vs. self-reported, for
 * EVERY observation, not just anchor ones.
 */
export function buildObservationFromDeviceInput(input: {
  incidentId: string;
  source: Extract<LocationObservationSource, 'BROWSER_GPS' | 'MANUAL_PIN'>;
  latitude: number;
  longitude: number;
  horizontalAccuracyMeters?: number;
  capturedAt: Date;
}): NewLocationObservationInput {
  return {
    incidentId: input.incidentId,
    source: input.source,
    latitude: input.latitude,
    longitude: input.longitude,
    horizontalAccuracyMeters: input.horizontalAccuracyMeters,
    capturedAt: input.capturedAt,
    provenanceLabel: input.source === 'BROWSER_GPS' ? 'Caller device GPS' : 'Manually placed pin',
    metadata: {
      coordinateAuthority: 'CALLER_DEVICE',
    },
  };
}
