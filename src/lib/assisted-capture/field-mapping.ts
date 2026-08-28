/**
 * Maps an accepted AI suggestion's `fieldName` (from ALLOWLIST — see
 * allowlist.ts) onto the actual Incident column it should be written to.
 *
 * Why this exists as its own module: comparing this project's C1 build
 * against a second, independent C1 attempt (ChatGPT, given the same build
 * prompt) surfaced that most ALLOWLIST field names are NOT 1:1 with a
 * database column name — `preferredLanguage` is the AI-facing/intake name,
 * but the actual column (see prisma/schema.prisma / domain/types.ts) is
 * `language`, matching the rest of the codebase's terminology. Without an
 * explicit mapping, `acceptSuggestion()`'s caller would have no documented
 * way to turn an accepted suggestion into a real Prisma update, and could
 * easily ship a bug writing to a `preferredLanguage` column that doesn't
 * exist. The other five ALLOWLIST fields DO map 1:1, and are listed here
 * anyway rather than left implicit, so this table is the single place that
 * answers "where does this AI-suggestible field actually live" — auditable
 * at a glance instead of split across two files' worth of implicit
 * assumptions.
 */
import type { AllowedField } from './allowlist';
import type { Incident } from '@/lib/domain/types';

type IncidentColumn = keyof Pick<
  Incident,
  | 'language'
  | 'unableToSpeak'
  | 'reportedPatientCount'
  | 'placeType'
  | 'floorLevel'
  | 'entranceOrGateHint'
  | 'landmarkText'
  | 'accessObstacle'
  | 'sceneHazardReported'
  | 'preferredCommunicationMode'
>;

const FIELD_TO_COLUMN: Record<AllowedField, IncidentColumn> = {
  preferredLanguage: 'language',
  unableToSpeak: 'unableToSpeak',
  reportedPatientCount: 'reportedPatientCount',
  placeType: 'placeType',
  floorLevel: 'floorLevel',
  entranceOrGateHint: 'entranceOrGateHint',
  landmarkText: 'landmarkText',
  accessObstacle: 'accessObstacle',
  sceneHazardReported: 'sceneHazardReported',
  preferredCommunicationMode: 'preferredCommunicationMode',
};

/**
 * Turns `{fieldName, valueToWrite}` (the output of `acceptSuggestion()`)
 * into a `{ [realColumnName]: value }` patch a repository layer can pass
 * straight to a Prisma/`pg` update against the `Incident` row. Does not
 * validate `value`'s shape against the column's real type (e.g. that
 * `reportedPatientCount` is actually a number) — that belongs to the
 * repository/DB layer, which already enforces column types at the SQL
 * level; this function's only job is the name mapping.
 */
export function mapAllowedFieldToIncidentPatch(
  fieldName: AllowedField,
  value: unknown
): Partial<Record<IncidentColumn, unknown>> {
  const column = FIELD_TO_COLUMN[fieldName];
  return { [column]: value };
}
