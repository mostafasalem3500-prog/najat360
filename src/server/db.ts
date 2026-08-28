/**
 * Shared Postgres pool for the Next.js server layer (API routes / server
 * components). Deliberately plain `pg`, matching `scripts/seed-demo.ts`'s
 * own access pattern — not Prisma Client — because this sandbox's network
 * egress blocks binaries.prisma.sh, so no generated Prisma Client engine is
 * guaranteed to exist. `prisma/schema.prisma` stays the single source of
 * truth for the shape; this file only executes hand-written SQL against it,
 * same discipline as the seed script.
 *
 * Cached on `globalThis` so Next.js dev-mode hot-reloading (which re-imports
 * route modules on every request) does not open a new pool per reload.
 */
import { Pool, types } from 'pg';

// pg's default type parsing leaves NUMERIC/DECIMAL columns (OID 1700) as
// strings, to avoid silent float-precision loss for money-shaped data. This
// schema's only DECIMAL columns are latitude/longitude/distance values
// (see prisma/schema.prisma's `@db.Decimal(9, 6)` fields) — every one of
// them is meant to be consumed as a plain JS number by lib/geo.ts and every
// gatekeeper in src/lib, so this repo layer parses them as floats globally
// rather than making every call site remember to `Number(...)` a read-back
// column (a call site that forgets produces a silent "24.7136" string bug,
// not a type error, since `+row.latitude` and `row.latitude` both satisfy
// a loose `any`-typed pg result).
types.setTypeParser(1700, (value: string) => parseFloat(value));

declare global {
  // eslint-disable-next-line no-var
  var __najat360Pool: Pool | undefined;
}

export function getPool(): Pool {
  if (!global.__najat360Pool) {
    const databaseUrl = process.env.DATABASE_URL;
    if (!databaseUrl) {
      throw new Error('DATABASE_URL is not set — see .env.example');
    }
    global.__najat360Pool = new Pool({ connectionString: databaseUrl, max: 5 });
  }
  return global.__najat360Pool;
}
