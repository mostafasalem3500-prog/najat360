/**
 * AssistedCaptureProvider — the interface abstraction for spec 30.4's
 * "Assisted Intake والترجمة". Matches the same pattern established in C1
 * for CadReadProvider: the app depends on this interface only; concrete
 * implementations (MockAssistedCaptureProvider, LocalGlossaryTranslationProvider,
 * and any future cloud provider kept behind an environment flag) are
 * injected, never imported directly by call sites.
 *
 * Hard rules from spec 30.4, all enforced by this module's shape or by its
 * companion modules — not left as unenforced convention:
 *   - No LLM call may originate from the browser (this interface is a
 *     server-side abstraction; nothing here is exported to client code).
 *   - Every output is Zod-validated before it can become a suggestion —
 *     see assisted-capture/allowlist.ts's `validateAssistedSuggestion()`.
 *     `extractOperationalFields()` returning a `FieldSuggestion[]` does NOT
 *     by itself satisfy this rule; callers MUST still run each item through
 *     `validateAssistedSuggestion()` (see mock-provider.ts for the pattern).
 *   - No field outside ALLOWLIST may be accepted — `FieldSuggestion.fieldName`
 *     is typed as `AllowedField`, and the runtime layer re-checks it anyway.
 *   - No prompt/transcript text is ever logged by any function in this
 *     module family — callers must not `console.log`/audit-log raw
 *     `sourceText`/`translatedText`; only `evidenceTextMasked` (already
 *     capped at 240 chars by the allowlist schema) is safe to display/store
 *     on a suggestion.
 *   - timeout → fallback to manual entry — see timeout-fallback.ts.
 *   - No audio storage in MVP — `transcribe` stays optional on this
 *     interface and is deliberately NOT implemented by
 *     MockAssistedCaptureProvider in this phase (see that file's header
 *     comment) specifically so there is no code path that could persist
 *     audio bytes.
 */
import type { AllowedField } from './allowlist';
import type { ProviderHealth } from '@/lib/providers/health';

/**
 * Why an AI provider might not have produced its normal output, threaded
 * through as a typed field (not a free-text error string) so calling code
 * and tests can branch on it precisely. Not itself an error — a
 * `TranslationResult`/extraction outcome carrying a `fallbackReason` is
 * still a valid, usable result; it just came from the fallback path rather
 * than the primary provider.
 */
export type FallbackReason = 'PROVIDER_TIMEOUT' | 'GLOSSARY_MISS' | 'PROVIDER_ERROR';

/**
 * 0-1 raw confidence banded into the three buckets spec 30.4's call-taker
 * review UI must show ("confidence band: HIGH/MEDIUM/LOW"). Deliberately a
 * DIFFERENT scale/metric from `lib/confidence.ts`'s 0-100 Location
 * Confidence Index (spec section 14) — the two are unrelated indices over
 * unrelated things (an AI field suggestion vs. a resolved location), and
 * must not be confused or unified into one function.
 */
export type SuggestionConfidenceBand = 'HIGH' | 'MEDIUM' | 'LOW';

/**
 * Ephemeral only — this type deliberately has no `AssistedCaptureDraft`-style
 * persistence path anywhere in this codebase. `audioBase64` must never be
 * written to disk/DB/logs by any implementation; process it in memory and
 * discard. See file header re: "no audio storage in MVP".
 */
export interface AudioInput {
  incidentId: string;
  audioBase64: string;
  sourceLanguageHint?: string;
}

export interface TranscriptResult {
  transcript: string;
  detectedLanguage: string;
  provider: string;
  modelVersion: string;
}

export interface TranslationInput {
  incidentId: string;
  sourceText: string;
  sourceLanguage: string;
  targetLanguage: string;
}

export interface TranslationResult {
  translatedText: string;
  provider: string;
  modelVersion: string;
  /** Present only when the normal translation path did not run and a fallback produced this result instead. */
  fallbackReason?: FallbackReason;
}

export interface ExtractionInput {
  incidentId: string;
  draftId: string;
  translatedText: string;
  sourceLanguage: string;
}

/**
 * One AI-proposed field value, BEFORE it has passed through
 * `validateAssistedSuggestion()`. Note `suggestedValue` is `unknown` here,
 * same as the allowlist schema's per-field branches — a provider is not
 * trusted to have gotten the value's shape right just because it got the
 * field name right.
 */
export interface FieldSuggestion {
  fieldName: AllowedField;
  suggestedValue: unknown;
  evidenceTextMasked?: string;
  /** Raw 0-1 confidence; band it for display with `computeSuggestionConfidenceBand()`. */
  confidence: number;
}

/** Narrow interface for a translation-only implementation (spec 29.6's "TranslationProvider قابل للاستبدال"). `LocalGlossaryTranslationProvider` implements this; `AssistedCaptureProvider` implementations compose one internally rather than duplicating translation logic. */
export interface TranslationProvider {
  readonly name: string;
  translate(input: TranslationInput): Promise<TranslationResult>;
  health(): Promise<ProviderHealth>;
}

export interface AssistedCaptureProvider {
  readonly name: string;
  transcribe?(input: AudioInput): Promise<TranscriptResult>;
  translate(input: TranslationInput): Promise<TranslationResult>;
  extractOperationalFields(input: ExtractionInput): Promise<FieldSuggestion[]>;
  /** Never throws — a failed health check is a returned DEGRADED/UNREACHABLE status, matching CadReadProvider's convention. */
  health(): Promise<ProviderHealth>;
}
