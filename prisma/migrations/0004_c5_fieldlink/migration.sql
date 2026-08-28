-- NAJAT360 Companion — migration 0004_c5_fieldlink
-- C5: FieldLink / tracking / offline idempotency (spec 30.5, 30.14 #6).
-- Hand-authored to match prisma/schema.prisma exactly, same reason as
-- every prior migration in this project: this sandbox's network egress
-- blocks binaries.prisma.sh, so `prisma migrate dev` cannot run here.
-- Regenerate this file properly with
-- `npx prisma migrate dev --name c5_fieldlink` the first time this repo
-- is opened on a machine with normal internet access.

-- Enum

CREATE TYPE "FieldActionType" AS ENUM (
  'ACCEPT_TASK',
  'START_MOVING',
  'AT_ACCESS_POINT',
  'ON_SCENE',
  'ACCESS_BLOCKED',
  'REQUEST_LOCATION_REFRESH',
  'PROPOSE_ALTERNATE_ENTRANCE',
  'CLOSE_TASK'
);

-- FieldAction (spec 30.5) — APPEND-ONLY, enforced below by the SAME
-- trigger function 0002_c3_location's migration already installed
-- (najat360_forbid_update_or_delete) — not redefined here, just reused,
-- so an UPDATE or DELETE attempt on this table raises the identical
-- "% is append-only: % is not permitted..." error C3's tables do.
--
-- "idempotencyKey" carries a real UNIQUE constraint — spec 30.14 #6's
-- "offline action resubmitted once thanks to idempotency" is enforced
-- here at the DB layer, not just by app-layer convention in
-- lib/fieldlink/field-action.ts's submitFieldAction(). A second INSERT
-- with the same idempotencyKey fails with a unique-violation the
-- application layer is expected to catch and treat as
-- "already processed" rather than surfacing as a hard error to the medic.

CREATE TABLE "FieldAction" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "incidentId" TEXT NOT NULL,
    "unitId" TEXT NOT NULL,
    "actorId" TEXT NOT NULL,
    "actionType" "FieldActionType" NOT NULL,
    "idempotencyKey" TEXT NOT NULL,
    "payload" JSONB,
    "previousStatus" "IncidentStatus",
    "resultingStatus" "IncidentStatus",
    "submittedAt" TIMESTAMP(3) NOT NULL,
    "processedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "synthetic" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "FieldAction_incidentId_fkey" FOREIGN KEY ("incidentId") REFERENCES "Incident"("id") ON DELETE CASCADE,
    CONSTRAINT "FieldAction_unitId_fkey" FOREIGN KEY ("unitId") REFERENCES "AmbulanceUnit"("id"),
    CONSTRAINT "FieldAction_actorId_fkey" FOREIGN KEY ("actorId") REFERENCES "User"("id")
);
CREATE UNIQUE INDEX "FieldAction_idempotencyKey_key" ON "FieldAction"("idempotencyKey");
CREATE INDEX "FieldAction_incidentId_createdAt_idx" ON "FieldAction"("incidentId", "createdAt");
CREATE INDEX "FieldAction_incidentId_actionType_idx" ON "FieldAction"("incidentId", "actionType");

CREATE TRIGGER "FieldAction_append_only"
  BEFORE UPDATE OR DELETE ON "FieldAction"
  FOR EACH ROW EXECUTE FUNCTION najat360_forbid_update_or_delete();
