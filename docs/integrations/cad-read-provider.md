<!-- Title -->
# CAD Read Provider — integration posture

Required by section 30.10 of the build prompt: this document explains how
NAJAT360 is meant to read CAD data across three deployment tiers, and the
hard rules that hold at every tier. Only the first tier (Demo) is
implemented in C1 — the other two are documented intent, not code, so a
reader can see the whole shape without this project claiming integrations
it doesn't have.

## The interface

Every part of the app that needs incident/unit data from a CAD system
depends on one interface, never a concrete implementation:

```ts
export interface CadReadProvider {
  readonly name: string;
  getIncident(id: string): Promise<Incident | null>;
  listActiveIncidents(): Promise<Incident[]>;
  listUnits(): Promise<AmbulanceUnit[]>;
  health(): Promise<ProviderHealth>;
}
```

See `src/lib/integrations/cad/types.ts`. No route, server action, or React
component may import a concrete provider class directly — they take a
`CadReadProvider` and receive an implementation through composition. That
is what makes "the synthetic provider is the only active one by default"
(acceptance test 30.14 #13) a structural fact rather than a configuration
setting someone could flip by accident.

## Tier 1 — Demo: simulator (implemented in C1)

`src/lib/integrations/cad/synthetic-cad-provider.ts` — `SyntheticCadProvider`.

- Pure in-memory implementation. No HTTP calls, no external host, no
  credentials, no network dependency of any kind.
- Constructed from plain arrays (typically the output of
  `scripts/seed-demo.ts`), and filters out any row that is not explicitly
  marked `synthetic: true` before it can ever be served — see
  `tests/unit/synthetic-cad-provider.test.ts`.
- `health()` always resolves to `{status: 'SIMULATED', provider:
  'synthetic'}` and never throws.
- This is the ONLY provider wired up anywhere in C1. There is no code path
  in this repository, at this phase, that reaches a real CAD system.

## Tier 2 — Pilot: de-identified export/API read (not implemented)

If NAJAT360 is ever piloted against a real CAD deployment, the intended
shape is read-only and de-identified at the source:

- A `Pilot*CadProvider` would read from an export or read-only API the
  CAD operator has explicitly documented and authorized for this purpose
  — never a scraped page, never a session borrowed from a human operator's
  login, never an endpoint discovered by inspecting network traffic.
- Data crossing that boundary is de-identified before it reaches this
  app's database: caller name/phone and other direct identifiers are
  stripped or hashed at the integration edge, not filtered later by RBAC.
  RBAC (`src/lib/auth/rbac.ts`) is a second layer on top of that, not a
  substitute for it.
- Every record would carry provenance metadata (`generatedAt`, `provider`,
  `schemaVersion`) so a de-identified pilot row is never mistaken for a
  live production one.

## Tier 3 — Production: signed event contracts (not implemented)

A production integration, if one were ever built with the CAD operator's
explicit agreement, would not read the operator's live system directly at
all. The intended shape is an operator-published, signed event contract —
the operator emits events NAJAT360 consumes — so the coupling runs through
a documented, versioned contract both parties can inspect, rather than
through implicit knowledge of the other system's internals.

None of this exists today. This section documents the shape a future,
explicitly-authorized integration would take — it is not a plan to
integrate unilaterally, and nothing in this repository attempts to.

## Hard rules — every tier, no exceptions

1. **No scraping.** No provider implementation may read pages/DOM/exports
   not explicitly documented and authorized by the CAD operator for
   programmatic use.
2. **No session reuse.** No provider may hold or replay a human operator's
   authenticated session. Each tier's access, if any, is its own
   independently authorized credential.
3. **No undocumented endpoints.** A provider only calls interfaces the CAD
   operator has published and authorized. Discovering an endpoint by
   inspecting traffic does not make it documented.
4. **No vendor name or platform URL in UI, seed data, or logs.** This
   applies to anything the app ships or runs (`src/`, `scripts/`, seeded
   rows, log output). It does NOT apply to this documentation tree, where
   describing the incumbent system by name is sometimes necessary to
   explain a risk or a design decision — see
   `scripts/ci-secret-scan.ts` and
   `docs/product/NAJAT360-قرارات-ما-بعد-C0.md` (correction #2) for exactly
   where that line sits and how CI enforces it.
