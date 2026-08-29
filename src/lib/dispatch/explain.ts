/**
 * Human-readable warnings extracted from a dispatch recommendation's
 * `reasoning: string[]` machine tags (`generate-coverage-recommendation.ts`) —
 * same "explain the recommendation, let the human decide" discipline as
 * `lib/location/explain.ts`. Only tags a supervisor should actively notice
 * before confirming a dispatch are translated here; routine tags
 * (CANDIDATES_CONSIDERED, TOP_CANDIDATE, COVERAGE_BEFORE/AFTER,
 * ALTERNATIVE_*) are already represented directly in the operations UI's
 * own cards and are deliberately not duplicated as prose here.
 */

const SHIFT_ENDING_SOON_PREFIX = 'SHIFT_ENDING_SOON:';
const AREA_DEMAND_HIGH_PREFIX = 'AREA_DEMAND_HIGH:';

/** Returns short Arabic warning sentences for any reasoning tags worth flagging — empty array when there is nothing a supervisor needs to be told beyond the recommendation card itself. */
export function explainDispatchWarnings(reasoning: string[]): string[] {
  const warnings: string[] = [];

  const shiftTag = reasoning.find((r) => r.startsWith(SHIFT_ENDING_SOON_PREFIX));
  if (shiftTag) {
    const minutes = shiftTag.slice(SHIFT_ENDING_SOON_PREFIX.length).replace('min', '');
    warnings.push(`⚠️ الوحدة الموصى بها قريبة من نهاية المناوبة (${minutes} دقيقة متبقية) — تحقق من التوفر الفعلي قبل التأكيد.`);
  }

  const demandTag = reasoning.find((r) => r.startsWith(AREA_DEMAND_HIGH_PREFIX));
  if (demandTag) {
    const params = Object.fromEntries(
      demandTag
        .slice(AREA_DEMAND_HIGH_PREFIX.length)
        .split(',')
        .map((pair) => pair.split('=') as [string, string])
    );
    warnings.push(
      `⚠️ منطقة هذا البلاغ ذات طلب متوقع مرتفع (يوصى بـ ${params.recommendedUnits ?? '؟'} وحدات في هذه الخلية) — إسناد هذه الوحدة قد يُضعف التغطية لاحقًا.`
    );
  }

  return warnings;
}
