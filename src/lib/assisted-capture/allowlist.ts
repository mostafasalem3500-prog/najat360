/**
 * AI output allowlist — the boundary that stops an AI-assisted intake draft
 * from ever writing a dispatch/medical decision field on an Incident.
 *
 * IMPORTANT — corrected design (docs/product/NAJAT360-قرارات-ما-بعد-C0.md,
 * correction #1): an earlier draft of the C0 report said "any one of these
 * layers is enough on its own." That was wrong and the user corrected it.
 * TypeScript's `AllowedField` union is a COMPILE-TIME hint for the code
 * that builds a suggestion — it enforces nothing at runtime, because AI
 * output arrives at this boundary as untyped JSON. The real protection is
 * these four layers holding TOGETHER, not any single one:
 *
 *   1. `AllowedField` literal-union type — keeps hand-written code honest
 *      at compile time (does not touch AI output at all).
 *   2. `AssistedFieldSuggestionSchema` — Zod RUNTIME validation. This is
 *      the layer that actually inspects the JSON an AI call returns and
 *      rejects anything whose `fieldName` isn't in ALLOWLIST, regardless
 *      of what the type system assumed.
 *   3. Architectural isolation — AI output is written ONLY into the
 *      `ExtractedFieldSuggestion` staging table (see prisma schema). It is
 *      structurally impossible for an AI call's output to reach the
 *      `Incident` row directly; there is no code path that does that.
 *   4. `acceptSuggestion()` — the single gatekeeper function through
 *      which a *human-approved* suggestion is copied from
 *      `ExtractedFieldSuggestion` onto `Incident`. It re-validates against
 *      ALLOWLIST/DENYLIST at the moment of acceptance, independent of
 *      whatever validated the suggestion when it was first created.
 *
 * A fuzz/denylist test suite (tests/unit/allowlist.test.ts) asserts layers
 * 2 and 4 both reject every DENYLIST field and every field not in
 * ALLOWLIST, so removing or weakening either layer alone breaks a test —
 * that is what "required together" is meant to guarantee in practice.
 */
import { z } from 'zod';
import { COMMUNICATION_MODES, PLACE_TYPES } from '@/lib/domain/types';

/**
 * Fields an AI-assisted draft may ever suggest. All of these are
 * caller-observation / caller-preference fields — nothing here is a
 * clinical or dispatch decision.
 */
export const ALLOWLIST = [
  'preferredLanguage',
  'unableToSpeak',
  'reportedPatientCount',
  'placeType',
  'floorLevel',
  'entranceOrGateHint',
  'landmarkText',
  'accessObstacle',
  'sceneHazardReported',
  'preferredCommunicationMode',
] as const;

export type AllowedField = (typeof ALLOWLIST)[number];

/**
 * Fields an AI-assisted draft must NEVER be able to set, named explicitly
 * (rather than left as "everything not in ALLOWLIST") so the denylist test
 * suite has concrete, spec-traceable cases to assert against. These are
 * exactly the medical/dispatch decision fields a human must own per the
 * spec's "لا تعتمد dispatch" / "لا يعدل" role rules.
 */
export const DENYLIST = [
  'proqaCode',
  'mpdsCode',
  'medicalPriority',
  'diagnosis',
  'dispatchDecision',
  'abortDecision',
  'destinationDecision',
] as const;

export type DeniedField = (typeof DENYLIST)[number];

const ALLOWLIST_SET: ReadonlySet<string> = new Set(ALLOWLIST);
const DENYLIST_SET: ReadonlySet<string> = new Set(DENYLIST);

export function isAllowedField(fieldName: string): fieldName is AllowedField {
  return ALLOWLIST_SET.has(fieldName);
}

export function isDeniedField(fieldName: string): fieldName is DeniedField {
  return DENYLIST_SET.has(fieldName);
}

/**
 * Fields shared by every suggestion regardless of which field it names.
 * Split out so each per-field branch below only has to add `fieldName`
 * (as a literal) and `suggestedValue` (with its real type/range).
 */
const SUGGESTION_COMMON_FIELDS = {
  draftId: z.string().min(1),
  /** Concise, masked-when-needed excerpt of the source text that supports this suggestion — spec 30.4's call-taker review UI requirement. Never the full transcript (that stays out of this table entirely; see AssistedCaptureDraft.translatedText). */
  evidenceTextMasked: z.string().max(240).optional(),
  confidence: z.number().min(0).max(1),
};

/**
 * The real value shape for each ALLOWLIST field. Exported (not just used
 * inline below) so `acceptSuggestion()` can re-validate a human-edited
 * value against the SAME per-field schema at acceptance time, independent
 * of the schema used when the suggestion was first created — a reviewer
 * "correcting" `reportedPatientCount` to a non-numeric string must be
 * rejected just as firmly as a malformed AI suggestion would be.
 */
export const ALLOWED_FIELD_VALUE_SCHEMAS = {
  preferredLanguage: z.string().min(2).max(40),
  unableToSpeak: z.boolean(),
  reportedPatientCount: z.number().int().min(1).max(50),
  placeType: z.enum(PLACE_TYPES),
  floorLevel: z.string().min(1).max(24),
  entranceOrGateHint: z.string().min(1).max(120),
  landmarkText: z.string().min(1).max(200),
  accessObstacle: z.string().min(1).max(200),
  sceneHazardReported: z.string().min(1).max(200),
  preferredCommunicationMode: z.enum(COMMUNICATION_MODES),
} as const satisfies Record<AllowedField, z.ZodTypeAny>;

/** Builds one discriminated-union branch: `fieldName` pinned to a single ALLOWLIST literal, `suggestedValue` constrained to that field's real shape. */
function suggestionBranch<Lit extends AllowedField>(fieldName: Lit, suggestedValue: z.ZodTypeAny) {
  return z.object({
    fieldName: z.literal(fieldName),
    suggestedValue,
    ...SUGGESTION_COMMON_FIELDS,
  });
}

/**
 * Layer 2: runtime schema for a single AI-produced field suggestion,
 * BEFORE it is persisted to the `ExtractedFieldSuggestion` staging table.
 *
 * This is a Zod `discriminatedUnion` keyed on `fieldName`, not a flat
 * object with `suggestedValue: z.unknown()` — every ALLOWLIST field has
 * its own branch constraining the *value*'s real type/range (e.g.
 * `reportedPatientCount` must be an integer 1–50, `placeType` must be one
 * of the real PlaceType enum values). A suggestion naming a denylisted or
 * unknown field fails validation here regardless of what the caller's
 * TypeScript type assumed, AND a suggestion naming an allowed field but
 * carrying a wrong-shaped value (e.g. `reportedPatientCount: "many"`)
 * fails too — value-shape checking that a flat `z.unknown()` schema would
 * have silently let through. (Gap found and closed after comparing this
 * module against an independent second implementation of this same
 * boundary — see docs/product for the comparison notes.)
 */
export const AssistedFieldSuggestionSchema = z.discriminatedUnion('fieldName', [
  suggestionBranch('preferredLanguage', ALLOWED_FIELD_VALUE_SCHEMAS.preferredLanguage),
  suggestionBranch('unableToSpeak', ALLOWED_FIELD_VALUE_SCHEMAS.unableToSpeak),
  suggestionBranch('reportedPatientCount', ALLOWED_FIELD_VALUE_SCHEMAS.reportedPatientCount),
  suggestionBranch('placeType', ALLOWED_FIELD_VALUE_SCHEMAS.placeType),
  suggestionBranch('floorLevel', ALLOWED_FIELD_VALUE_SCHEMAS.floorLevel),
  suggestionBranch('entranceOrGateHint', ALLOWED_FIELD_VALUE_SCHEMAS.entranceOrGateHint),
  suggestionBranch('landmarkText', ALLOWED_FIELD_VALUE_SCHEMAS.landmarkText),
  suggestionBranch('accessObstacle', ALLOWED_FIELD_VALUE_SCHEMAS.accessObstacle),
  suggestionBranch('sceneHazardReported', ALLOWED_FIELD_VALUE_SCHEMAS.sceneHazardReported),
  suggestionBranch('preferredCommunicationMode', ALLOWED_FIELD_VALUE_SCHEMAS.preferredCommunicationMode),
]);

export type AssistedFieldSuggestionInput = z.infer<typeof AssistedFieldSuggestionSchema>;

// Compile-time exhaustiveness check: if a field is ever added to ALLOWLIST
// without a matching branch above, this line fails to typecheck (the
// branches' inferred `fieldName` literals must cover every AllowedField).
const _exhaustiveBranchCheck: AllowedField extends AssistedFieldSuggestionInput['fieldName'] ? true : never = true;
void _exhaustiveBranchCheck;

export class SuggestionRejectedError extends Error {
  constructor(
    public readonly fieldName: string,
    public readonly reason: string
  ) {
    super(`Suggestion for "${fieldName}" rejected: ${reason}`);
    this.name = 'SuggestionRejectedError';
  }
}

/**
 * Layer 3 entry point: validate a raw AI response object into a
 * persistable suggestion row. Callers must feed the AI's raw JSON output
 * straight into this function — never assign it to an `AllowedField`-typed
 * variable first, since that would only be a compile-time cast with no
 * runtime effect on untrusted data.
 *
 * Throws `SuggestionRejectedError` (not a Zod error) so call sites don't
 * need to know about Zod to handle rejection.
 */
export function validateAssistedSuggestion(raw: unknown): AssistedFieldSuggestionInput {
  const result = AssistedFieldSuggestionSchema.safeParse(raw);
  if (!result.success) {
    const fieldName =
      raw !== null && typeof raw === 'object' && 'fieldName' in raw
        ? String((raw as Record<string, unknown>).fieldName)
        : '(missing)';
    throw new SuggestionRejectedError(fieldName, result.error.issues.map((i) => i.message).join('; '));
  }
  return result.data;
}

/**
 * Re-validates a single value against one ALLOWLIST field's real shape,
 * independent of the full suggestion object. Used by `acceptSuggestion()`
 * so a human-edited value gets exactly the same scrutiny an AI-produced
 * value gets — accepting is not a bypass of layer 2, it is a second pass
 * through the same per-field schema.
 */
export function validateSuggestedValueForField(fieldName: AllowedField, value: unknown): unknown {
  const schema = ALLOWED_FIELD_VALUE_SCHEMAS[fieldName];
  const result = schema.safeParse(value);
  if (!result.success) {
    throw new SuggestionRejectedError(fieldName, result.error.issues.map((i) => i.message).join('; '));
  }
  return result.data;
}

/**
 * Minimal shape `acceptSuggestion()` needs of a staged suggestion row and
 * of the persistence functions it drives. Kept as an injected interface
 * (rather than importing a DB client directly) so this module stays unit
 * testable without a database, matching the state-machine module's style.
 */
export interface StagedSuggestion {
  id: string;
  fieldName: string;
  suggestedValue: unknown;
  finalValue?: unknown;
  status: 'PENDING' | 'ACCEPTED' | 'EDITED' | 'REJECTED';
}

export interface AcceptSuggestionInput {
  suggestion: StagedSuggestion;
  /** The human reviewer approving this suggestion. Required — there is no unattended acceptance path. */
  reviewedById: string;
  /** If the reviewer edited the AI's value before accepting, the corrected value; otherwise the AI's own value is used. */
  editedValue?: unknown;
}

export interface AcceptSuggestionResult {
  fieldName: AllowedField;
  valueToWrite: unknown;
  reviewedById: string;
  wasEdited: boolean;
}

/**
 * Layer 4 — the ONLY function in the codebase permitted to copy a value
 * from `ExtractedFieldSuggestion` onto an `Incident`. It re-validates the
 * field name against ALLOWLIST/DENYLIST at acceptance time (not trusting
 * that the row already passed validation when it was created — defense in
 * depth against a suggestion row created some other way, e.g. a future
 * migration or a bug elsewhere).
 *
 * This function does not touch the database itself; it returns the
 * validated `{fieldName, valueToWrite}` pair for the caller's repository
 * layer to persist inside a transaction alongside the IncidentEvent +
 * AuditLog rows the spec requires for every suggestion decision.
 *
 * The value that will actually be written — the AI's own `suggestedValue`
 * if unedited, or `editedValue` if a reviewer corrected it — is re-parsed
 * through `validateSuggestedValueForField()` before this function returns,
 * so an edit that breaks the field's real shape (e.g. a non-numeric
 * `reportedPatientCount`) is rejected here rather than silently written.
 */
export function acceptSuggestion(input: AcceptSuggestionInput): AcceptSuggestionResult {
  const { suggestion, reviewedById, editedValue } = input;

  if (!reviewedById?.trim()) {
    throw new SuggestionRejectedError(suggestion.fieldName, 'a human reviewedById is required to accept');
  }

  if (isDeniedField(suggestion.fieldName)) {
    throw new SuggestionRejectedError(
      suggestion.fieldName,
      'field is on DENYLIST and can never be written via AI suggestion acceptance'
    );
  }

  if (!isAllowedField(suggestion.fieldName)) {
    throw new SuggestionRejectedError(suggestion.fieldName, 'field is not in ALLOWLIST');
  }

  const wasEdited = editedValue !== undefined;
  const candidateValue = wasEdited ? editedValue : suggestion.suggestedValue;
  const valueToWrite = validateSuggestedValueForField(suggestion.fieldName, candidateValue);

  return {
    fieldName: suggestion.fieldName,
    valueToWrite,
    reviewedById,
    wasEdited,
  };
}
