/**
 * Shared provider-health shape — used by every "provider" abstraction in
 * this codebase (CadReadProvider, AssistedCaptureProvider, and any future
 * RoutingProvider per section 16). Pulled out of
 * lib/integrations/cad/types.ts into its own module once a second
 * provider family (Assisted Intake, C2) needed the exact same shape —
 * duplicating it per-provider-family would have let them drift apart for
 * no reason.
 */

export type ProviderHealthStatus = 'SIMULATED' | 'HEALTHY' | 'DEGRADED' | 'UNREACHABLE';

export interface ProviderHealth {
  status: ProviderHealthStatus;
  provider: string;
  /** ISO timestamp of the last successful check, or the last attempt if unhealthy. Absent for providers with no I/O to fail (e.g. any synthetic/mock provider). */
  lastCheckedAt?: string;
  detail?: string;
}
