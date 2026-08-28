-- NAJAT360 Companion — migration 0005_c6_coverage
-- C6: Coverage-aware dispatch / H3 / P90 (spec 17, 18, 29.4).
-- Hand-authored to match prisma/schema.prisma exactly, same reason as
-- every prior migration in this project: this sandbox's network egress
-- blocks binaries.prisma.sh, so `prisma migrate dev` cannot run here.
-- Regenerate this file properly with
-- `npx prisma migrate dev --name c6_coverage` the first time this repo
-- is opened on a machine with normal internet access.
--
-- Only ONE new table this phase. "Recommendation" (from 0003_c4_dispatch)
-- is reused unchanged — its "accessScore"/"reasoning"/"scoreBreakdown"
-- columns now also carry C6's Dispatch Score rows, disambiguated by
-- "algorithmVersion" ('access-score-v1' vs 'dispatch-score-v1'). See
-- schema.prisma's updated doc comment on that model for the reasoning; no
-- ALTER TABLE needed since the column shapes were already generic enough.

-- H3Prediction (spec 17's ERD) — one row per (H3 cell, 1-hour window)
-- baseline demand prediction. No FK to Incident/AmbulanceUnit: describes a
-- grid cell's demand over time, not any single incident.

CREATE TABLE "H3Prediction" (
    "id"               TEXT NOT NULL PRIMARY KEY,
    "h3Index"          TEXT NOT NULL,
    "windowStart"      TIMESTAMP(3) NOT NULL,
    "windowEnd"        TIMESTAMP(3) NOT NULL,
    "historicalDemand" INTEGER NOT NULL,
    "predictedDemand"  DOUBLE PRECISION NOT NULL,
    "lowerBound"       DOUBLE PRECISION NOT NULL,
    "upperBound"       DOUBLE PRECISION NOT NULL,
    "recommendedUnits" INTEGER NOT NULL,
    "modelVersion"     TEXT NOT NULL,
    "synthetic"        BOOLEAN NOT NULL DEFAULT true,
    "createdAt"        TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX "H3Prediction_h3Index_windowStart_idx" ON "H3Prediction"("h3Index", "windowStart");
