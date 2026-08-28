/**
 * MockAssistedCaptureProvider — spec 30.4 rule #1: mandatory, deterministic
 * AssistedCaptureProvider implementation. Used as the default (and, in the
 * demo build, only) provider so the assisted-intake flow works end-to-end
 * with zero network dependency and zero non-determinism.
 *
 * `extractOperationalFields()` is deliberately simple rule-based keyword
 * matching over the ALREADY-TRANSLATED Arabic text — not a model call —
 * and, just as importantly, deliberately narrow: it only ever proposes
 * ALLOWLIST fields (floorLevel, entranceOrGateHint, accessObstacle,
 * reportedPatientCount). It does NOT attempt to extract anything
 * medical/diagnostic (e.g. "cannot breathe", "unconscious") even though
 * such phrases appear in the demo glossary — those are exactly the kind of
 * inference this project's allowlist/denylist boundary exists to keep an
 * AI-assisted draft from ever producing, so this mock intentionally models
 * that restraint rather than "helpfully" over-extracting.
 *
 * Every candidate this provider produces is still run through
 * `validateAssistedSuggestion()` before being returned — per the corrected
 * C1 design, no provider's output is trusted just because it is the
 * deterministic/mock one; the same Zod boundary applies to all providers
 * equally.
 *
 * `transcribe` is intentionally NOT implemented here (the interface method
 * stays optional). Spec 30.4 says "لا تخزن audio في MVP"; not implementing
 * any audio-handling code path in this phase is the simplest way to
 * guarantee that rule is never violated, rather than implementing
 * transcribe() and then having to prove every call site discards the bytes
 * correctly.
 */
import { validateAssistedSuggestion } from './allowlist';
import { LocalGlossaryTranslationProvider } from './local-glossary-provider';
import type {
  AssistedCaptureProvider,
  ExtractionInput,
  FieldSuggestion,
  TranslationInput,
  TranslationProvider,
  TranslationResult,
} from './provider';
import type { ProviderHealth } from '@/lib/providers/health';

/** One keyword-matching extraction rule. Order matters only in that later rules can still fire independently of earlier ones — each rule is evaluated against the full text, not consumed. */
interface ExtractionRule {
  /** Case-sensitive substring match against the Arabic translatedText — deliberately simple/explicit rather than a fuzzy NLP match, matching this provider's "deterministic and auditable" design goal. */
  matches: string;
  build: (matchedText: string) => Pick<FieldSuggestion, 'fieldName' | 'suggestedValue' | 'confidence'>;
}

const EXTRACTION_RULES: readonly ExtractionRule[] = [
  {
    matches: 'الطابق الثالث',
    build: () => ({ fieldName: 'floorLevel', suggestedValue: '3', confidence: 0.9 }),
  },
  {
    matches: 'البوابة الخلفية مغلقة',
    build: () => ({ fieldName: 'accessObstacle', suggestedValue: 'البوابة الخلفية مغلقة', confidence: 0.85 }),
  },
  {
    matches: 'البوابة الخلفية',
    build: () => ({ fieldName: 'entranceOrGateHint', suggestedValue: 'البوابة الخلفية', confidence: 0.8 }),
  },
  {
    matches: 'شخصان مصابان',
    build: () => ({ fieldName: 'reportedPatientCount', suggestedValue: 2, confidence: 0.75 }),
  },
];

function maskEvidence(sourceText: string, matchedText: string): string {
  const idx = sourceText.indexOf(matchedText);
  if (idx === -1) return matchedText.slice(0, 240);
  const start = Math.max(0, idx - 15);
  const end = Math.min(sourceText.length, idx + matchedText.length + 15);
  const excerpt = `${start > 0 ? '…' : ''}${sourceText.slice(start, end)}${end < sourceText.length ? '…' : ''}`;
  return excerpt.slice(0, 240);
}

export class MockAssistedCaptureProvider implements AssistedCaptureProvider {
  readonly name = 'mock-assisted-capture-provider';
  readonly modelVersion = 'mock-v1';
  private readonly translationProvider: TranslationProvider;

  constructor(translationProvider: TranslationProvider = new LocalGlossaryTranslationProvider()) {
    this.translationProvider = translationProvider;
  }

  async translate(input: TranslationInput): Promise<TranslationResult> {
    return this.translationProvider.translate(input);
  }

  async extractOperationalFields(input: ExtractionInput): Promise<FieldSuggestion[]> {
    const suggestions: FieldSuggestion[] = [];

    for (const rule of EXTRACTION_RULES) {
      if (!input.translatedText.includes(rule.matches)) continue;

      const built = rule.build(rule.matches);
      const evidenceTextMasked = maskEvidence(input.translatedText, rule.matches);

      // Round-trip every candidate through the same layer-2 validation any
      // other provider's output would face — this line is the whole point
      // of this comment block above: "deterministic" does not mean
      // "exempt from validation".
      const validated = validateAssistedSuggestion({
        draftId: input.draftId,
        fieldName: built.fieldName,
        suggestedValue: built.suggestedValue,
        confidence: built.confidence,
        evidenceTextMasked,
      });

      suggestions.push({
        fieldName: validated.fieldName,
        suggestedValue: validated.suggestedValue,
        evidenceTextMasked: validated.evidenceTextMasked,
        confidence: validated.confidence,
      });
    }

    return suggestions;
  }

  async health(): Promise<ProviderHealth> {
    return { status: 'SIMULATED', provider: this.name };
  }
}
