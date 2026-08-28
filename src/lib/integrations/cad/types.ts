/**
 * CadReadProvider — the ONLY interface the app is allowed to depend on for
 * reading external CAD data. No route/component may import a concrete
 * provider directly; they depend on this interface and receive an
 * implementation through composition (see providers.ts once a real
 * provider exists). This is what makes "SyntheticCadProvider is the only
 * active provider by default" (spec 30.14 #13) a structural fact rather
 * than a configuration hope.
 */
import type { AmbulanceUnit, Incident } from '@/lib/domain/types';
import type { ProviderHealth } from '@/lib/providers/health';

// Re-exported for backward compatibility — every existing import of
// ProviderHealth/ProviderHealthStatus from this module keeps working.
// Canonical definition now lives in lib/providers/health.ts since C2's
// AssistedCaptureProvider needs the identical shape.
export type { ProviderHealth, ProviderHealthStatus } from '@/lib/providers/health';

export interface CadReadProvider {
  /** The provider's own identifier, used in health output and audit logs — never a real vendor/domain name (spec 30.10: "لا تستخدم اسم الشركة المطورة أو رابط المنصة"). */
  readonly name: string;

  getIncident(id: string): Promise<Incident | null>;

  listActiveIncidents(): Promise<Incident[]>;

  listUnits(): Promise<AmbulanceUnit[]>;

  /** Never throws — a failed health check is a returned DEGRADED/UNREACHABLE status, not an exception, so callers can render provider state without a try/catch. */
  health(): Promise<ProviderHealth>;
}
