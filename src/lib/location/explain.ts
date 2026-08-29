/**
 * Human-readable explanation for a `resolveLocation()` result — the
 * "اعرض التوصية مع تفسيرها" requirement: a call-taker/supervisor should
 * never have to read `reasoning: string[]`'s machine tags (PRIMARY_SOURCE:
 * ANCHOR_QR, SOURCE_CONFLICT:1, ...) or a bare confidenceIndex number to
 * understand WHY the system landed on this point and how much to trust it.
 * This module turns that same data into short Arabic sentences for the
 * operations UI. Pure, no I/O — same discipline as resolver.ts/
 * confidence.ts, and kept separate from both so neither has to know about
 * UI-facing copy.
 */
import type { LocationObservationSource } from '@/lib/domain/types';
import type { ConfidenceBand } from '@/lib/confidence';

const SOURCE_LABELS_AR: Record<LocationObservationSource, string> = {
  ANCHOR_QR: 'مسح رمز نقطة نجاة (موثّق فعليًا)',
  MANUAL_PIN: 'تثبيت يدوي على الخريطة',
  CALL_TAKER: 'وصف مستقبل البلاغ',
  NATIONAL_ADDRESS: 'العنوان الوطني المسجّل',
  LANDMARK: 'معلم مذكور من المتصل',
  BROWSER_GPS: 'تحديد GPS من جهاز المتصل',
  WHAT3WORDS_OPTIONAL: 'مرجع ثلاث كلمات',
};

const BAND_LABELS_AR: Record<ConfidenceBand, string> = {
  HIGH: 'مرتفعة',
  MEDIUM: 'متوسطة',
  LOW: 'منخفضة',
};

export interface ExplainLocationInput {
  confidenceBand: ConfidenceBand;
  confidenceIndex: number;
  primarySource: LocationObservationSource;
  hasConflict: boolean;
  conflictingCount: number;
  /** The largest distance (meters) between the primary point and a conflicting source — undefined when there's no conflict. */
  maxConflictDistanceMeters?: number;
  isStale: boolean;
  ageMinutes: number;
  hasEntrance: boolean;
}

/**
 * Returns an ordered list of short Arabic sentences — always at least a
 * confidence-band line and a source line; conflict/staleness lines are
 * appended only when relevant. Render each string as its own line/item in
 * the UI (not concatenated into one paragraph) so a skimming operator can
 * scan it in under two seconds, matching how the rest of the operations
 * screen presents evidence.
 */
export function explainLocationResolution(input: ExplainLocationInput): string[] {
  const lines: string[] = [];

  lines.push(
    `درجة الثقة بالموقع ${BAND_LABELS_AR[input.confidenceBand]} (${input.confidenceIndex}/100) — المصدر الأساسي: ${SOURCE_LABELS_AR[input.primarySource]}.`
  );

  if (input.hasConflict) {
    const distanceText =
      input.maxConflictDistanceMeters != null ? ` بمسافة تصل إلى ${input.maxConflictDistanceMeters} م` : '';
    lines.push(
      `⚠️ تم رصد تعارض مع ${input.conflictingCount} ${input.conflictingCount === 1 ? 'مصدر آخر' : 'مصادر أخرى'}${distanceText} — راجع الأدلة قبل التثبيت.`
    );
  } else {
    lines.push('لا يوجد تعارض بين مصادر الموقع المتاحة.');
  }

  if (input.isStale) {
    lines.push(`⚠️ آخر تحديث للموقع قبل ${input.ageMinutes} دقيقة — يُنصح بطلب تحديث جديد من المتصل إن أمكن.`);
  }

  if (!input.hasEntrance) {
    lines.push('لم يتم العثور على مدخل مبنى مسجّل ضمن نطاق قريب من هذه النقطة.');
  }

  return lines;
}
