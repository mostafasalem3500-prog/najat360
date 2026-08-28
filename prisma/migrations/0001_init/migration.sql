-- NAJAT360 Companion — migration 0001_init
-- Hand-authored to match prisma/schema.prisma exactly (see phase report for why:
-- this sandbox's network egress blocks binaries.prisma.sh, so `prisma migrate dev`
-- could not run here; this SQL was applied directly to a real Postgres 16 instance
-- to prove the schema is valid and to unblock C1 testing. Regenerate this file
-- properly with `npx prisma migrate dev --name init` the first time this repo is
-- opened on a machine with normal internet access — Prisma will detect the schema
-- already matches and record this migration as applied, or produce an equivalent
-- diff if anything here drifted from schema.prisma.)

-- Enums

CREATE TYPE "Role" AS ENUM ('CALLER', 'CALL_TAKER', 'SUPERVISOR', 'MEDIC', 'RESPONSE_COORDINATOR', 'HOSPITAL_LIAISON', 'ANALYST', 'ADMIN');
CREATE TYPE "ActorType" AS ENUM ('CALLER', 'CALL_TAKER', 'SUPERVISOR', 'MEDIC', 'RESPONSE_COORDINATOR', 'HOSPITAL_LIAISON', 'ANALYST', 'ADMIN', 'SYSTEM');
CREATE TYPE "IncidentStatus" AS ENUM ('NEW', 'VERIFYING', 'READY_FOR_DECISION', 'DISPATCHED', 'EN_ROUTE', 'AT_ACCESS_POINT', 'ON_SCENE', 'CLOSED', 'LOW_CONFIDENCE', 'NO_UNIT_AVAILABLE', 'ACCESS_BLOCKED', 'DUPLICATE_SUSPECTED', 'CANCELLED_BY_OPERATOR', 'LOST_CONNECTIVITY');
CREATE TYPE "Priority" AS ENUM ('HIGH', 'MEDIUM', 'LOW');
CREATE TYPE "PlaceType" AS ENUM ('RESIDENTIAL', 'COMMERCIAL', 'OUTDOOR_PUBLIC', 'RELIGIOUS_SITE', 'TRANSPORT_HUB', 'EVENT_VENUE', 'OTHER');
CREATE TYPE "CrewType" AS ENUM ('AMBULANCE', 'RAPID_RESPONSE', 'FOOT_TEAM');
CREATE TYPE "UnitStatus" AS ENUM ('AVAILABLE', 'BUSY', 'OUT_OF_SERVICE');
CREATE TYPE "EntranceAccessType" AS ENUM ('ROAD', 'PEDESTRIAN', 'SERVICE');
CREATE TYPE "ValidationStatus" AS ENUM ('UNVERIFIED', 'MANUALLY_REVIEWED', 'FIELD_CONFIRMED');
CREATE TYPE "IncidentEventType" AS ENUM ('CREATED', 'LOCATION_UPDATED', 'PRIORITY_PROPOSED', 'PRIORITY_APPROVED', 'UNIT_ASSIGNED', 'RECOMMENDATION_OVERRIDDEN', 'STATUS_TRANSITION', 'EN_ROUTE', 'AT_ACCESS_POINT', 'ON_SCENE', 'DELAY_ALERT', 'ACCESS_BLOCKED', 'SUGGESTION_ACCEPTED', 'SUGGESTION_EDITED', 'SUGGESTION_REJECTED', 'SUGGESTION_REJECTED_INVALID_FIELD', 'CLOSED');
CREATE TYPE "CaptureSourceType" AS ENUM ('TEXT', 'AUDIO_TRANSCRIPT');
CREATE TYPE "DraftStatus" AS ENUM ('DRAFT', 'PARTIALLY_CONFIRMED', 'CONFIRMED', 'REJECTED');
CREATE TYPE "SuggestionStatus" AS ENUM ('PENDING', 'ACCEPTED', 'EDITED', 'REJECTED');
CREATE TYPE "Connectivity" AS ENUM ('ONLINE', 'DEGRADED', 'STALE', 'OUT_OF_REACH');

-- Tables

CREATE TABLE "User" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "name" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "passwordHash" TEXT NOT NULL,
    "role" "Role" NOT NULL,
    "scopeZone" TEXT,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE UNIQUE INDEX "User_email_key" ON "User"("email");
CREATE INDEX "User_role_idx" ON "User"("role");

CREATE TABLE "Entrance" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "code" TEXT NOT NULL,
    "nameAr" TEXT NOT NULL,
    "nameEn" TEXT NOT NULL,
    "latitude" NUMERIC(9,6) NOT NULL,
    "longitude" NUMERIC(9,6) NOT NULL,
    "zone" TEXT NOT NULL,
    "accessType" "EntranceAccessType" NOT NULL,
    "vehicleAccessible" BOOLEAN NOT NULL DEFAULT true,
    "pedestrianAccessible" BOOLEAN NOT NULL DEFAULT true,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "validationStatus" "ValidationStatus" NOT NULL DEFAULT 'UNVERIFIED',
    "lastValidatedAt" TIMESTAMP(3),
    "synthetic" BOOLEAN NOT NULL DEFAULT true
);
CREATE UNIQUE INDEX "Entrance_code_key" ON "Entrance"("code");

CREATE TABLE "AmbulanceUnit" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "code" TEXT NOT NULL,
    "label" TEXT NOT NULL,
    "crewType" "CrewType" NOT NULL,
    "status" "UnitStatus" NOT NULL DEFAULT 'AVAILABLE',
    "readinessScore" INTEGER NOT NULL DEFAULT 100,
    "homeZone" TEXT NOT NULL,
    "estimatedAvailabilityMinutes" INTEGER,
    "synthetic" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL
);
CREATE UNIQUE INDEX "AmbulanceUnit_code_key" ON "AmbulanceUnit"("code");

CREATE TABLE "Incident" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "rescueCode" TEXT NOT NULL,
    "callerTokenHash" TEXT NOT NULL,
    "callerTokenExpiresAt" TIMESTAMP(3) NOT NULL,
    "status" "IncidentStatus" NOT NULL DEFAULT 'NEW',
    "priority" "Priority",
    "proposedPriority" "Priority",
    "latitude" NUMERIC(9,6) NOT NULL,
    "longitude" NUMERIC(9,6) NOT NULL,
    "gpsAccuracyMeters" DOUBLE PRECISION,
    "locationCapturedAt" TIMESTAMP(3),
    "uncertaintyRadiusMeters" DOUBLE PRECISION,
    "confidenceScore" INTEGER,
    "confidenceVersion" TEXT,
    "placeType" "PlaceType",
    "floorLevel" TEXT,
    "language" TEXT NOT NULL DEFAULT 'ar',
    "unableToSpeak" BOOLEAN NOT NULL DEFAULT false,
    "callerName" TEXT,
    "callerPhone" TEXT,
    "description" TEXT,
    "reportedPatientCount" INTEGER,
    "entranceOrGateHint" TEXT,
    "landmarkText" TEXT,
    "accessObstacle" TEXT,
    "sceneHazardReported" TEXT,
    "preferredCommunicationMode" TEXT,
    "h3Index" TEXT,
    "suggestedEntranceId" TEXT,
    "assignedEntranceId" TEXT,
    "assignedUnitId" TEXT,
    "cancellationOverrideReason" TEXT,
    "statusBeforeConnectivityLoss" "IncidentStatus",
    "synthetic" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "closedAt" TIMESTAMP(3),
    CONSTRAINT "Incident_assignedEntranceId_fkey" FOREIGN KEY ("assignedEntranceId") REFERENCES "Entrance"("id"),
    CONSTRAINT "Incident_suggestedEntranceId_fkey" FOREIGN KEY ("suggestedEntranceId") REFERENCES "Entrance"("id"),
    CONSTRAINT "Incident_assignedUnitId_fkey" FOREIGN KEY ("assignedUnitId") REFERENCES "AmbulanceUnit"("id")
);
CREATE UNIQUE INDEX "Incident_rescueCode_key" ON "Incident"("rescueCode");
CREATE UNIQUE INDEX "Incident_callerTokenHash_key" ON "Incident"("callerTokenHash");
CREATE INDEX "Incident_status_priority_createdAt_idx" ON "Incident"("status", "priority", "createdAt");

-- Defense in depth: operator cancellation can never exist without a
-- documented reason, enforced at the DB boundary in addition to
-- lib/incidents/state-machine.ts's MissingOverrideReasonError. Idea
-- credited to comparing this migration against a second independent C1
-- attempt (ChatGPT) — see docs/product/NAJAT360-قرارات-ما-بعد-C0.md.
ALTER TABLE "Incident" ADD CONSTRAINT "Incident_cancel_requires_reason"
CHECK (
  "status" <> 'CANCELLED_BY_OPERATOR'
  OR ("cancellationOverrideReason" IS NOT NULL AND length(trim("cancellationOverrideReason")) >= 5)
);

-- A unit cannot be assigned to two active (non-terminal) incidents, even
-- under concurrent dispatch decisions. Partial unique index — not
-- expressible in Prisma's stable schema.prisma syntax. Same credit as above.
CREATE UNIQUE INDEX "Incident_one_active_assignment_per_unit"
ON "Incident" ("assignedUnitId")
WHERE "assignedUnitId" IS NOT NULL AND "status" NOT IN ('CANCELLED_BY_OPERATOR', 'CLOSED');

CREATE TABLE "IncidentEvent" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "incidentId" TEXT NOT NULL,
    "actorType" "ActorType" NOT NULL,
    "actorId" TEXT,
    "eventType" "IncidentEventType" NOT NULL,
    "previousStatus" "IncidentStatus",
    "nextStatus" "IncidentStatus",
    "latitude" NUMERIC(9,6),
    "longitude" NUMERIC(9,6),
    "overrideReason" TEXT,
    "metadata" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "IncidentEvent_incidentId_fkey" FOREIGN KEY ("incidentId") REFERENCES "Incident"("id") ON DELETE CASCADE,
    CONSTRAINT "IncidentEvent_actorId_fkey" FOREIGN KEY ("actorId") REFERENCES "User"("id")
);
CREATE INDEX "IncidentEvent_incidentId_createdAt_idx" ON "IncidentEvent"("incidentId", "createdAt");

CREATE TABLE "UnitLocation" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "unitId" TEXT NOT NULL,
    "latitude" NUMERIC(9,6) NOT NULL,
    "longitude" NUMERIC(9,6) NOT NULL,
    "accuracyMeters" DOUBLE PRECISION,
    "heading" DOUBLE PRECISION,
    "speed" DOUBLE PRECISION,
    "capturedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "synthetic" BOOLEAN NOT NULL DEFAULT true,
    CONSTRAINT "UnitLocation_unitId_fkey" FOREIGN KEY ("unitId") REFERENCES "AmbulanceUnit"("id") ON DELETE CASCADE
);
CREATE INDEX "UnitLocation_unitId_capturedAt_idx" ON "UnitLocation"("unitId", "capturedAt");

CREATE TABLE "AssistedCaptureDraft" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "incidentId" TEXT NOT NULL,
    "sourceType" "CaptureSourceType" NOT NULL,
    "sourceLanguage" TEXT NOT NULL,
    "targetLanguage" TEXT NOT NULL,
    "translatedText" TEXT,
    "provider" TEXT NOT NULL,
    "modelVersion" TEXT NOT NULL,
    "status" "DraftStatus" NOT NULL DEFAULT 'DRAFT',
    "synthetic" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "AssistedCaptureDraft_incidentId_fkey" FOREIGN KEY ("incidentId") REFERENCES "Incident"("id") ON DELETE CASCADE
);
CREATE INDEX "AssistedCaptureDraft_incidentId_idx" ON "AssistedCaptureDraft"("incidentId");

CREATE TABLE "ExtractedFieldSuggestion" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "draftId" TEXT NOT NULL,
    "fieldName" TEXT NOT NULL,
    "suggestedValue" JSONB NOT NULL,
    "evidenceTextMasked" TEXT,
    "confidence" DOUBLE PRECISION NOT NULL,
    "status" "SuggestionStatus" NOT NULL DEFAULT 'PENDING',
    "finalValue" JSONB,
    "reviewedById" TEXT,
    "reviewedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "ExtractedFieldSuggestion_draftId_fkey" FOREIGN KEY ("draftId") REFERENCES "AssistedCaptureDraft"("id") ON DELETE CASCADE,
    CONSTRAINT "ExtractedFieldSuggestion_reviewedById_fkey" FOREIGN KEY ("reviewedById") REFERENCES "User"("id")
);
CREATE INDEX "ExtractedFieldSuggestion_draftId_status_idx" ON "ExtractedFieldSuggestion"("draftId", "status");

CREATE TABLE "DeviceHeartbeat" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "unitId" TEXT NOT NULL,
    "deviceIdHash" TEXT NOT NULL,
    "connectivity" "Connectivity" NOT NULL,
    "batteryLevel" INTEGER,
    "capturedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "synthetic" BOOLEAN NOT NULL DEFAULT true,
    CONSTRAINT "DeviceHeartbeat_unitId_fkey" FOREIGN KEY ("unitId") REFERENCES "AmbulanceUnit"("id") ON DELETE CASCADE
);
CREATE INDEX "DeviceHeartbeat_unitId_capturedAt_idx" ON "DeviceHeartbeat"("unitId", "capturedAt");

CREATE TABLE "AuditLog" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "actorId" TEXT,
    "action" TEXT NOT NULL,
    "entityType" TEXT NOT NULL,
    "entityId" TEXT NOT NULL,
    "before" JSONB,
    "after" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "AuditLog_actorId_fkey" FOREIGN KEY ("actorId") REFERENCES "User"("id")
);
CREATE INDEX "AuditLog_entityType_entityId_createdAt_idx" ON "AuditLog"("entityType", "entityId", "createdAt");
