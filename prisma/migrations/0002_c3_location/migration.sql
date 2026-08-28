-- NAJAT360 Companion — migration 0002_c3_location
-- C3: Rescue Anchors (spec 29.1), merged location sources (spec 29.2), and
-- last-100-meters/floor Entrance extensions (spec 29.3). Hand-authored to
-- match prisma/schema.prisma exactly — same reason as 0001_init (this
-- sandbox's network egress blocks binaries.prisma.sh, so `prisma migrate
-- dev` cannot run here). Applied directly to a real Postgres 16 instance.
-- Regenerate properly with `npx prisma migrate dev` on a machine with
-- normal internet access; Prisma should detect the schema already matches.

-- Enums

CREATE TYPE "LocationObservationSource" AS ENUM ('BROWSER_GPS', 'MANUAL_PIN', 'ANCHOR_QR', 'LANDMARK', 'NATIONAL_ADDRESS', 'WHAT3WORDS_OPTIONAL', 'CALL_TAKER');
CREATE TYPE "AnchorType" AS ENUM ('ENTRANCE', 'FLOOR', 'ZONE');

-- Entrance extensions (spec 29.3 "آخر 100 متر والطابق")

ALTER TABLE "Entrance"
  ADD COLUMN "vehicleStopLatitude" NUMERIC(9,6),
  ADD COLUMN "vehicleStopLongitude" NUMERIC(9,6),
  ADD COLUMN "pedestrianPathGeoJson" TEXT,
  ADD COLUMN "floorLevel" TEXT,
  ADD COLUMN "hasStairs" BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN "hasElevator" BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN "accessibilityNotes" TEXT,
  ADD COLUMN "isServiceGate" BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN "temporaryRestriction" TEXT,
  ADD COLUMN "lastValidatedBySource" TEXT;

-- LocationAnchor (spec 29.1 "Rescue Anchors")

CREATE TABLE "LocationAnchor" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "code" TEXT NOT NULL,
    "entranceId" TEXT NOT NULL,
    "floorLevel" TEXT,
    "latitude" NUMERIC(9,6) NOT NULL,
    "longitude" NUMERIC(9,6) NOT NULL,
    "anchorType" "AnchorType" NOT NULL,
    "validationStatus" "ValidationStatus" NOT NULL DEFAULT 'UNVERIFIED',
    "validFrom" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "validUntil" TIMESTAMP(3),
    "active" BOOLEAN NOT NULL DEFAULT true,
    "synthetic" BOOLEAN NOT NULL DEFAULT true,
    CONSTRAINT "LocationAnchor_entranceId_fkey" FOREIGN KEY ("entranceId") REFERENCES "Entrance"("id")
);
CREATE UNIQUE INDEX "LocationAnchor_code_key" ON "LocationAnchor"("code");
CREATE INDEX "LocationAnchor_entranceId_idx" ON "LocationAnchor"("entranceId");

-- LocationObservation (spec 29.2) — APPEND-ONLY, enforced below by trigger.

CREATE TABLE "LocationObservation" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "incidentId" TEXT NOT NULL,
    "source" "LocationObservationSource" NOT NULL,
    "latitude" NUMERIC(9,6) NOT NULL,
    "longitude" NUMERIC(9,6) NOT NULL,
    "horizontalAccuracyMeters" DOUBLE PRECISION,
    "verticalAccuracyMeters" DOUBLE PRECISION,
    "floorLevel" TEXT,
    "capturedAt" TIMESTAMP(3) NOT NULL,
    "provenanceLabel" TEXT NOT NULL,
    "metadata" JSONB NOT NULL DEFAULT '{}',
    "synthetic" BOOLEAN NOT NULL DEFAULT true,
    CONSTRAINT "LocationObservation_incidentId_fkey" FOREIGN KEY ("incidentId") REFERENCES "Incident"("id") ON DELETE CASCADE
);
CREATE INDEX "LocationObservation_incidentId_capturedAt_idx" ON "LocationObservation"("incidentId", "capturedAt");

-- LocationResolution (spec 29.2) — APPEND-ONLY, enforced below by trigger.

CREATE TABLE "LocationResolution" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "incidentId" TEXT NOT NULL,
    "latitude" NUMERIC(9,6) NOT NULL,
    "longitude" NUMERIC(9,6) NOT NULL,
    "uncertaintyRadiusMeters" DOUBLE PRECISION NOT NULL,
    "confidenceIndex" INTEGER NOT NULL,
    "primaryObservationId" TEXT NOT NULL,
    "supportingObservationIds" JSONB NOT NULL DEFAULT '[]',
    "conflictingObservationIds" JSONB NOT NULL DEFAULT '[]',
    "selectedEntranceId" TEXT,
    "floorLevel" TEXT,
    "algorithmVersion" TEXT NOT NULL,
    "resolvedById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "LocationResolution_incidentId_fkey" FOREIGN KEY ("incidentId") REFERENCES "Incident"("id") ON DELETE CASCADE
);
CREATE INDEX "LocationResolution_incidentId_createdAt_idx" ON "LocationResolution"("incidentId", "createdAt");

-- Append-only enforcement (spec 29.2 rule #1/#2: "لا تحذف أو تعدل الملاحظة
-- التاريخية" / "كل إعادة حل تنشئ snapshot جديدًا"). A generic trigger
-- function shared by both tables — stronger defense-in-depth than a CHECK
-- constraint here, since CHECK cannot forbid UPDATE/DELETE outright. Idea
-- credited to comparing this phase's design against a third independent AI
-- attempt at the same phase (see docs/product for the comparison notes);
-- this project's own addition is sharing one function across both tables
-- rather than duplicating it, and naming the exception per-table so a
-- blocked statement's error message says exactly which append-only rule it
-- violated.
CREATE OR REPLACE FUNCTION najat360_forbid_update_or_delete() RETURNS TRIGGER AS $$
BEGIN
  RAISE EXCEPTION '% is append-only: % is not permitted on this table (row id: %)',
    TG_TABLE_NAME, TG_OP, COALESCE(OLD."id", 'unknown');
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER "LocationObservation_append_only"
  BEFORE UPDATE OR DELETE ON "LocationObservation"
  FOR EACH ROW EXECUTE FUNCTION najat360_forbid_update_or_delete();

CREATE TRIGGER "LocationResolution_append_only"
  BEFORE UPDATE OR DELETE ON "LocationResolution"
  FOR EACH ROW EXECUTE FUNCTION najat360_forbid_update_or_delete();
