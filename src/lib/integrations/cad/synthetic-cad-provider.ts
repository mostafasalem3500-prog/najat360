/**
 * SyntheticCadProvider — the default and, in Demo, the ONLY active
 * CadReadProvider (spec 30.14 #13). Pure in-memory implementation: no
 * HTTP calls, no external host, no credentials. It exists so the entire
 * app can be demoed and tested with zero dependency on the real CAD
 * platform this project analyzes but does not integrate with.
 *
 * Two invariants enforced here, not left to the caller:
 *   - Every row this provider can ever return has `synthetic: true`. Any
 *     row passed into the constructor without that flag is dropped rather
 *     than silently served — see `filterSynthetic()`. This backs
 *     acceptance test 30.14 #14 ("لا توجد ... real patient fixtures").
 *   - `health()` always resolves to `{status: 'SIMULATED', provider:
 *     'synthetic'}` and never throws, matching the interface contract
 *     that health is a status, not an exception.
 */
import type { AmbulanceUnit, Incident } from '@/lib/domain/types';
import type { CadReadProvider, ProviderHealth } from './types';

function filterSynthetic<T extends { synthetic: boolean }>(rows: readonly T[]): T[] {
  return rows.filter((row) => row.synthetic === true);
}

export class SyntheticCadProvider implements CadReadProvider {
  readonly name = 'synthetic';

  private readonly incidents: Map<string, Incident>;
  private readonly units: readonly AmbulanceUnit[];

  /**
   * Takes its data by value at construction time (typically the output of
   * scripts/seed-demo.ts, or a fixture array in a test) rather than
   * reaching out to a database or network itself — that is what makes it
   * safe to instantiate in a unit test with no I/O at all.
   */
  constructor(seed: { incidents: readonly Incident[]; units: readonly AmbulanceUnit[] }) {
    const syntheticIncidents = filterSynthetic(seed.incidents);
    this.incidents = new Map(syntheticIncidents.map((incident) => [incident.id, incident]));
    this.units = filterSynthetic(seed.units);
  }

  async getIncident(id: string): Promise<Incident | null> {
    return this.incidents.get(id) ?? null;
  }

  async listActiveIncidents(): Promise<Incident[]> {
    const TERMINAL: readonly Incident['status'][] = ['CLOSED', 'CANCELLED_BY_OPERATOR'];
    return [...this.incidents.values()].filter((incident) => !TERMINAL.includes(incident.status));
  }

  async listUnits(): Promise<AmbulanceUnit[]> {
    return [...this.units];
  }

  async health(): Promise<ProviderHealth> {
    return { status: 'SIMULATED', provider: this.name };
  }
}
