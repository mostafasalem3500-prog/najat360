import { describe, expect, it } from 'vitest';
import { explainDispatchWarnings } from '@/lib/dispatch/explain';

describe('explainDispatchWarnings', () => {
  it('returns no warnings for routine reasoning tags', () => {
    const warnings = explainDispatchWarnings(['CANDIDATES_CONSIDERED:4', 'TOP_CANDIDATE:unit=u1,entrance=e1,score=90']);
    expect(warnings).toEqual([]);
  });

  it('translates SHIFT_ENDING_SOON into an Arabic warning with the minute count', () => {
    const warnings = explainDispatchWarnings(['TOP_CANDIDATE:unit=u1,entrance=e1,score=90', 'SHIFT_ENDING_SOON:12min']);
    expect(warnings).toHaveLength(1);
    expect(warnings[0]).toContain('12');
    expect(warnings[0]).toContain('نهاية المناوبة');
  });

  it('translates AREA_DEMAND_HIGH into an Arabic warning with the recommended-unit count', () => {
    const warnings = explainDispatchWarnings(['AREA_DEMAND_HIGH:predicted=4.2,recommendedUnits=3']);
    expect(warnings).toHaveLength(1);
    expect(warnings[0]).toContain('3');
    expect(warnings[0]).toContain('طلب متوقع مرتفع');
  });

  it('returns both warnings when both tags are present', () => {
    const warnings = explainDispatchWarnings(['SHIFT_ENDING_SOON:5min', 'AREA_DEMAND_HIGH:predicted=2,recommendedUnits=2']);
    expect(warnings).toHaveLength(2);
  });
});
