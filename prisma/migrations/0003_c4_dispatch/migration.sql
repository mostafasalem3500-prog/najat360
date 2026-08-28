-- NAJAT360 Companion — migration 0003_c4_dispatch
-- C4: Call-taker Review + Supervisor Decision (spec sections 4/15/16, ERD's
-- RouteSnapshot/Recommendation models). Hand-authored to match
-- prisma/schema.prisma exactly, same reason as 0001_init/0002_c3_location:
-- this sandbox's network egress blocks binaries.prisma.sh, so
-- `prisma migrate dev` cannot run here. Regenerate this file properly with
-- `npx prisma migrate dev --name c4_dispatch` the first time this repo is
-- opened on a machine with normal internet access.

-- Enums

CREATE TYPE "RoutingProviderMode" AS ENUM ('MOCK', 'LIVE', 'FALLBACK');

-- RouteSnapshot (spec 15/16 ERD) — one evaluated (unit, entrance) candidate
-- route per generateRecommendation() call. Not marked append-only by spec
-- (unlike LocationObservation/LocationResolution in 0002_c3_location) — a
-- normal insert-only-in-practice table, no forbid-update-or-delete trigger.

CREATE TABLE "RouteSnapshot" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "incidentId" TEXT NOT NULL,
    "unitId" TEXT NOT NULL,
    "entranceId" TEXT NOT NULL,
    "provider" TEXT NOT NULL,
    "providerMode" "RoutingProviderMode" NOT NULL,
    "distanceMeters" DOUBLE PRECISION NOT NULL,
    "durationSeconds" DOUBLE PRECISION NOT NULL,
    "geometry" JSONB NOT NULL,
    "dataFreshnessAt" TIMESTAMP(3) NOT NULL,
    "synthetic" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "RouteSnapshot_incidentId_fkey" FOREIGN KEY ("incidentId") REFERENCES "Incident"("id") ON DELETE CASCADE,
    CONSTRAINT "RouteSnapshot_unitId_fkey" FOREIGN KEY ("unitId") REFERENCES "AmbulanceUnit"("id"),
    CONSTRAINT "RouteSnapshot_entranceId_fkey" FOREIGN KEY ("entranceId") REFERENCES "Entrance"("id")
);
CREATE INDEX "RouteSnapshot_incidentId_createdAt_idx" ON "RouteSnapshot"("incidentId", "createdAt");

-- Recommendation (spec 15 ERD) — DELIBERATELY MUTABLE (see schema.prisma's
-- doc comment): acceptedById/acceptedAt/rejectedAt/overrideReason are
-- updated in place by lib/dispatch/decision.ts's decideDispatch(), unlike
-- LocationObservation/LocationResolution's append-only history.
--
-- recommendedUnitId/alternativeUnitId/recommendedEntranceId/
-- alternativeEntranceId are plain columns in schema.prisma (no Prisma
-- relation, to avoid four separate named relations into
-- AmbulanceUnit/Entrance) but still get real FOREIGN KEY constraints here,
-- same raw-SQL-only pattern as Incident_one_active_assignment_per_unit and
-- Incident_cancel_requires_reason in 0001_init.

CREATE TABLE "Recommendation" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "incidentId" TEXT NOT NULL,
    "algorithmVersion" TEXT NOT NULL,
    "recommendedUnitId" TEXT NOT NULL,
    "alternativeUnitId" TEXT,
    "recommendedEntranceId" TEXT NOT NULL,
    "alternativeEntranceId" TEXT,
    "accessScore" INTEGER NOT NULL,
    "confidenceScore" INTEGER NOT NULL,
    "reasoning" JSONB NOT NULL,
    "scoreBreakdown" JSONB NOT NULL,
    "acceptedById" TEXT,
    "acceptedAt" TIMESTAMP(3),
    "rejectedAt" TIMESTAMP(3),
    "overrideReason" TEXT,
    "synthetic" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "Recommendation_incidentId_fkey" FOREIGN KEY ("incidentId") REFERENCES "Incident"("id") ON DELETE CASCADE,
    CONSTRAINT "Recommendation_acceptedById_fkey" FOREIGN KEY ("acceptedById") REFERENCES "User"("id"),
    CONSTRAINT "Recommendation_recommendedUnitId_fkey" FOREIGN KEY ("recommendedUnitId") REFERENCES "AmbulanceUnit"("id"),
    CONSTRAINT "Recommendation_alternativeUnitId_fkey" FOREIGN KEY ("alternativeUnitId") REFERENCES "AmbulanceUnit"("id"),
    CONSTRAINT "Recommendation_recommendedEntranceId_fkey" FOREIGN KEY ("recommendedEntranceId") REFERENCES "Entrance"("id"),
    CONSTRAINT "Recommendation_alternativeEntranceId_fkey" FOREIGN KEY ("alternativeEntranceId") REFERENCES "Entrance"("id")
);
CREATE INDEX "Recommendation_incidentId_createdAt_idx" ON "Recommendation"("incidentId", "createdAt");

-- Defense-in-depth mirror of lib/dispatch/decision.ts's
-- MissingDispatchOverrideReasonError / lib/incidents/state-machine.ts's
-- MIN_OVERRIDE_REASON_LENGTH (5): rejectedAt is set on this row precisely
-- when a supervisor's decision was an override (decideDispatch()'s
-- `wasOverride`) — accepting the top recommendation as-is only ever sets
-- acceptedAt. So "rejectedAt IS NOT NULL" and "this was an override" are
-- the same condition, and the same reason-length rule the app layer
-- enforces belongs here too, so a raw UPDATE bypassing the app can't leave
-- a reasonless override on record — same
-- app-layer-check-must-never-be-looser-than-the-DB's discipline as
-- Incident_cancel_requires_reason.
-- NOTE: the OR-branch must explicitly check overrideReason IS NOT NULL, not
-- just its length — Postgres CHECK constraints treat a NULL comparison
-- result (length(trim(NULL)) >= 5 is NULL, not false) as PASSING, not
-- failing. A first version of this constraint without the IS NOT NULL
-- clause was live-tested and confirmed to silently accept a
-- rejectedAt-with-no-reason row before being caught and fixed here.
ALTER TABLE "Recommendation" ADD CONSTRAINT "Recommendation_reject_requires_reason"
  CHECK ("rejectedAt" IS NULL OR ("overrideReason" IS NOT NULL AND length(trim("overrideReason")) >= 5));
