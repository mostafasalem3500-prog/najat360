/**
 * Phase-gate regression guard — codifies the C0–C9 phase boundaries from
 * docs/product/NAJAT360-قرارات-ما-بعد-C0.md as an automated check instead
 * of relying only on doc/comment discipline. Idea credited to comparing
 * this project against a second independent C1 attempt (ChatGPT), whose
 * first draft silently pulled Hospital-handover (C8) and Abort (C9)
 * statuses into what was supposed to be a C1 state machine — exactly the
 * kind of scope creep this script catches automatically going forward,
 * in this project or that comparison one.
 *
 * Deliberately NOT a general secret/architecture scanner (that's
 * scripts/ci-secret-scan.ts) — this one thing only: are any
 * explicitly-deferred phase's concepts present where they shouldn't be yet.
 */
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const ROOT = process.cwd();

// Statuses that belong to Hospital Readiness (C8) or Abort/stretch (C9),
// per the phase gate list — must not appear anywhere in the current schema
// or state machine until their phase actually starts.
export const DEFERRED_STATUSES = [
  'TRANSPORT_DECISION',
  'TRANSPORTING',
  'START_HANDOVER',
  'END_HANDOVER',
  'ABORTED',
];

interface CheckResult {
  ok: boolean;
  message: string;
}

/**
 * Strips `//` line comments and `/* *‍/` block comments before scanning.
 * Without this, a header comment that explains a deferred term IS
 * excluded (e.g. "Hospital handover states (TRANSPORT_DECISION -> ... ->
 * END_HANDOVER) are explicitly deferred to C8") trips the same alarm as
 * actually including it in the TRANSITIONS map/enum — which is exactly
 * backwards, since that sentence is the discipline this scan exists to
 * protect, not a violation of it. Good enough for this codebase's style
 * (no `//` inside string literals containing that pattern); not a full
 * tokenizer.
 */
export function stripComments(content: string): string {
  return content.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*$/gm, '');
}

export function checkContentDoesNotContain(
  relativePath: string,
  content: string,
  forbidden: readonly string[]
): CheckResult[] {
  const stripped = stripComments(content);
  return forbidden.map((term) => ({
    ok: !stripped.includes(term),
    message: stripped.includes(term)
      ? `${relativePath}: contains deferred-phase term "${term}" outside a comment — this belongs to a later phase gate, not the current one`
      : `${relativePath}: clean of "${term}"`,
  }));
}

function checkFileDoesNotContain(relativePath: string, forbidden: readonly string[]): CheckResult[] {
  const fullPath = resolve(ROOT, relativePath);
  let raw: string;
  try {
    raw = readFileSync(fullPath, 'utf-8');
  } catch {
    return [{ ok: false, message: `${relativePath}: could not be read (does it still exist at this path?)` }];
  }
  return checkContentDoesNotContain(relativePath, raw, forbidden);
}

function main(): void {
  const results: CheckResult[] = [
    ...checkFileDoesNotContain('prisma/schema.prisma', DEFERRED_STATUSES),
    ...checkFileDoesNotContain('src/lib/incidents/state-machine.ts', DEFERRED_STATUSES),
    ...checkFileDoesNotContain('src/lib/domain/types.ts', DEFERRED_STATUSES),
  ];

  const failures = results.filter((r) => !r.ok);
  if (failures.length === 0) {
    console.log(`phase-gate-scan: clean — no C8/C9 concepts (${DEFERRED_STATUSES.join(', ')}) present yet.`);
    return;
  }

  console.error(`phase-gate-scan: ${failures.length} violation(s):\n`);
  for (const f of failures) console.error(`  ${f.message}`);
  process.exitCode = 1;
}

const isMainModule = import.meta.url === `file://${process.argv[1]}`;
if (isMainModule) {
  main();
}
