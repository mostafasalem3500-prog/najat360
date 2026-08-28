/**
 * LocalGlossaryTranslationProvider — spec 30.4 rule #2: mandatory,
 * deterministic, dictionary-based translation for a FIXED set of demo
 * phrases. This is NOT a general-purpose translator; it is deliberately
 * scoped to the exact utterances the hackathon demo scenario needs
 * (spec 30.14/section 24's "narrowest winning scope": caller translation →
 * entrance/floor pinning → coverage-protecting unit selection → medic
 * card). A phrase outside `GLOSSARY_ENTRIES` is a GLOSSARY_MISS, not a
 * best-effort guess — guessing at emergency-caller speech is worse than
 * clearly falling back to manual entry.
 *
 * Per the C0 report's recommendation (docs/product, corrections review):
 * this provider is the ONLY translation path enabled in the demo build —
 * any cloud provider stays behind an environment flag and is not wired up
 * this session, so a live demo has zero network-dependent translation
 * failure modes.
 */
import type { ProviderHealth } from '@/lib/providers/health';
import type { TranslationInput, TranslationProvider, TranslationResult } from './provider';

interface GlossaryEntry {
  sourceLanguage: string;
  targetLanguage: string;
  /** Matched case-insensitively, trimmed, with internal whitespace collapsed — see normalizePhrase(). Not a regex/fuzzy match; this provider only ever recognizes phrases verbatim. */
  sourcePhrase: string;
  translatedText: string;
}

/**
 * Fixed demo glossary. Scoped to the golden-path scenario's caller
 * utterances only (three demo source languages × the handful of phrases a
 * caller needs to say to get entrance/floor/hazard/patient-count
 * information across to an Arabic-speaking call-taker). Extend this list
 * only for a real, planned demo beat — not as a general translation
 * dictionary.
 */
export const GLOSSARY_ENTRIES: readonly GlossaryEntry[] = [
  // Urdu (ur) -> Arabic (ar)
  { sourceLanguage: 'ur', targetLanguage: 'ar', sourcePhrase: 'مدد چاہیے', translatedText: 'أحتاج مساعدة' },
  { sourceLanguage: 'ur', targetLanguage: 'ar', sourcePhrase: 'وہ سانس نہیں لے سکتا', translatedText: 'لا يستطيع التنفس' },
  { sourceLanguage: 'ur', targetLanguage: 'ar', sourcePhrase: 'تیسری منزل پر ہیں', translatedText: 'نحن في الطابق الثالث' },
  { sourceLanguage: 'ur', targetLanguage: 'ar', sourcePhrase: 'پچھلا گیٹ بند ہے', translatedText: 'البوابة الخلفية مغلقة' },
  { sourceLanguage: 'ur', targetLanguage: 'ar', sourcePhrase: 'وہ بیہوش ہے', translatedText: 'هو فاقد الوعي' },

  // English (en) -> Arabic (ar)
  { sourceLanguage: 'en', targetLanguage: 'ar', sourcePhrase: 'i need help', translatedText: 'أحتاج مساعدة' },
  { sourceLanguage: 'en', targetLanguage: 'ar', sourcePhrase: 'he cannot breathe', translatedText: 'لا يستطيع التنفس' },
  { sourceLanguage: 'en', targetLanguage: 'ar', sourcePhrase: 'we are on the third floor', translatedText: 'نحن في الطابق الثالث' },
  { sourceLanguage: 'en', targetLanguage: 'ar', sourcePhrase: 'the back gate is locked', translatedText: 'البوابة الخلفية مغلقة' },
  { sourceLanguage: 'en', targetLanguage: 'ar', sourcePhrase: 'he is unconscious', translatedText: 'هو فاقد الوعي' },
  { sourceLanguage: 'en', targetLanguage: 'ar', sourcePhrase: 'there are two injured people', translatedText: 'يوجد شخصان مصابان' },

  // Tagalog (tl) -> Arabic (ar)
  { sourceLanguage: 'tl', targetLanguage: 'ar', sourcePhrase: 'kailangan ko ng tulong', translatedText: 'أحتاج مساعدة' },
  { sourceLanguage: 'tl', targetLanguage: 'ar', sourcePhrase: 'hindi siya makahinga', translatedText: 'لا يستطيع التنفس' },
  { sourceLanguage: 'tl', targetLanguage: 'ar', sourcePhrase: 'nasa ikatlong palapag kami', translatedText: 'نحن في الطابق الثالث' },
] as const;

function normalizePhrase(text: string): string {
  return text.trim().replace(/\s+/g, ' ').toLowerCase();
}

const GLOSSARY_INDEX = new Map<string, GlossaryEntry>(
  GLOSSARY_ENTRIES.map((entry) => [
    `${entry.sourceLanguage}:${entry.targetLanguage}:${normalizePhrase(entry.sourcePhrase)}`,
    entry,
  ])
);

export class LocalGlossaryTranslationProvider implements TranslationProvider {
  readonly name = 'local-glossary-translation-provider';
  readonly modelVersion = 'local-glossary-v1';

  async translate(input: TranslationInput): Promise<TranslationResult> {
    const key = `${input.sourceLanguage}:${input.targetLanguage}:${normalizePhrase(input.sourceText)}`;
    const entry = GLOSSARY_INDEX.get(key);

    if (!entry) {
      // GLOSSARY_MISS — this is a fixed, scoped dictionary by design; an
      // unrecognized phrase falls back to manual entry rather than being
      // guessed at. `translatedText` intentionally echoes the untranslated
      // source so downstream code always has *something* to display,
      // clearly tagged as not actually translated.
      return {
        translatedText: input.sourceText,
        provider: this.name,
        modelVersion: this.modelVersion,
        fallbackReason: 'GLOSSARY_MISS',
      };
    }

    return {
      translatedText: entry.translatedText,
      provider: this.name,
      modelVersion: this.modelVersion,
    };
  }

  async health(): Promise<ProviderHealth> {
    // Pure in-memory dictionary lookup — no I/O, so this is always
    // SIMULATED rather than a real network health check, matching
    // SyntheticCadProvider's convention from C1.
    return { status: 'SIMULATED', provider: this.name };
  }
}
