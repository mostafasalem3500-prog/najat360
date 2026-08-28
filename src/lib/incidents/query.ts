/**
 * Incident filtering/search — built to answer the operator's explicit ask:
 * "فعّل الفلاتر والبحث بالمدة والفريق والمنطقة" (filters + search by date
 * range, crew/team, and zone/region) so a SUPERVISOR/RESPONSE_COORDINATOR/
 * ANALYST can find what they need for a decision without scrolling a raw
 * incident list.
 *
 * Pure, no I/O — operates on already-fetched rows (typically the output of
 * a repository join, or CadReadProvider.listActiveIncidents() /
 * listUnits() combined via `enrichIncidentsWithZone`). This mirrors every
 * other module in this codebase: filtering logic is unit-testable with
 * plain arrays, and the actual Prisma/SQL query is a separate, later
 * concern for whichever service layer wires this to a database.
 *
 * IMPORTANT — role masking happens BEFORE this, not after: callers must
 * run each row through `serializeIncidentForRole()` (lib/auth/rbac.ts)
 * before filtering/exporting, never the reverse. Filtering unmasked data
 * and masking afterward would let filter values leak information about
 * fields a role isn't supposed to see (e.g. filtering by exact
 * coordinates a MEDIC's projection never included).
 */
import type { AmbulanceUnit, CrewType, Entrance, Incident, IncidentStatus, Priority } from '@/lib/domain/types';

/**
 * An Incident enriched with the zone information a raw Incident row
 * doesn't carry directly (zone lives on Entrance/AmbulanceUnit). Building
 * this is a plain join, not a query concern — see `enrichIncidentsWithZone`.
 */
export type EnrichedIncident = Incident & {
  entranceZone: string | null;
  unitHomeZone: string | null;
  unitCrewType: CrewType | null;
};

export function enrichIncidentsWithZone(
  incidents: readonly Incident[],
  entrances: readonly Entrance[],
  units: readonly AmbulanceUnit[]
): EnrichedIncident[] {
  const entranceById = new Map(entrances.map((e) => [e.id, e]));
  const unitById = new Map(units.map((u) => [u.id, u]));

  return incidents.map((incident) => {
    const entrance = incident.assignedEntranceId ? entranceById.get(incident.assignedEntranceId) : undefined;
    const unit = incident.assignedUnitId ? unitById.get(incident.assignedUnitId) : undefined;
    return {
      ...incident,
      entranceZone: entrance?.zone ?? null,
      unitHomeZone: unit?.homeZone ?? null,
      unitCrewType: unit?.crewType ?? null,
    };
  });
}

export interface IncidentQueryFilters {
  /** Inclusive lower bound on createdAt — the start of the date-range/duration filter. */
  createdFrom?: Date;
  /** Inclusive upper bound on createdAt. */
  createdTo?: Date;
  /** Crew/team filter — matches the assigned unit's crewType. */
  crewType?: CrewType;
  /** A specific unit's id, when the ask is "this team specifically" rather than a crew type in general. */
  unitId?: string;
  /** Zone/region filter — matches EITHER the assigned entrance's zone OR the assigned unit's home zone, whichever is set, so a supervisor can search by geography regardless of which side of the dispatch has zone data. */
  zone?: string;
  status?: readonly IncidentStatus[];
  priority?: readonly Priority[];
  /**
   * Free-text search — case-insensitive substring match against rescueCode,
   * description, placeType, and callerName. Deliberately does NOT search
   * callerPhone (a partial-phone substring match is a common way to
   * accidentally narrow in on one real person even in synthetic data
   * modeling, and phone lookup isn't part of the ask) — search by
   * rescueCode instead, which is exactly what the code exists for.
   */
  searchText?: string;
}

function matchesSearchText(incident: EnrichedIncident, searchText: string): boolean {
  const needle = searchText.trim().toLowerCase();
  if (!needle) return true;
  const haystacks = [incident.rescueCode, incident.description, incident.placeType, incident.callerName];
  return haystacks.some((field) => field?.toLowerCase().includes(needle));
}

export function queryIncidents(
  incidents: readonly EnrichedIncident[],
  filters: IncidentQueryFilters = {}
): EnrichedIncident[] {
  return incidents.filter((incident) => {
    if (filters.createdFrom && incident.createdAt < filters.createdFrom) return false;
    if (filters.createdTo && incident.createdAt > filters.createdTo) return false;
    if (filters.crewType && incident.unitCrewType !== filters.crewType) return false;
    if (filters.unitId && incident.assignedUnitId !== filters.unitId) return false;
    if (filters.zone) {
      const matchesZone = incident.entranceZone === filters.zone || incident.unitHomeZone === filters.zone;
      if (!matchesZone) return false;
    }
    if (filters.status && filters.status.length > 0 && !filters.status.includes(incident.status)) return false;
    if (filters.priority && filters.priority.length > 0) {
      if (!incident.priority || !filters.priority.includes(incident.priority)) return false;
    }
    if (filters.searchText && !matchesSearchText(incident, filters.searchText)) return false;
    return true;
  });
}

/**
 * Incident age in minutes — the concrete number behind a "duration" filter
 * like "open longer than 30 minutes". `asOf` defaults to the incident's own
 * `closedAt` when set (a closed incident's duration is fixed), otherwise
 * the caller must supply "now" explicitly (this module has no I/O and
 * never calls `new Date()` itself) so the result stays deterministic and
 * testable.
 */
export function incidentAgeMinutes(incident: Pick<Incident, 'createdAt' | 'closedAt'>, now: Date): number {
  const end = incident.closedAt ?? now;
  return Math.round((end.getTime() - incident.createdAt.getTime()) / 60_000);
}
