/**
 * DEMO_MODE gate — docs/product/NAJAT360-قرارات-ما-بعد-C0.md correction
 * #3: the Demo Role Switcher (and any other demo-only affordance) "يجب أن
 * يعمل فقط عند: DEMO_MODE=true ويُعطّل كليًا في أي نشر غير تجريبي" — must
 * work ONLY when DEMO_MODE=true and be structurally disabled in any
 * non-demo deployment, not just hidden in the UI.
 *
 * A single small module for this (rather than each demo-only route/action
 * checking `process.env.DEMO_MODE` inline) means there is exactly one
 * place to audit for "is demo-gating actually strict", and one place a
 * future demo-only feature plugs into instead of re-deriving the check.
 */

export interface DemoModeEnv {
  DEMO_MODE?: string;
  /**
   * Index signature so `process.env` (whose properties are only known to
   * TypeScript via `NodeJS.ProcessEnv`'s own index signature, not a
   * declared `DEMO_MODE` member) satisfies this otherwise-all-optional
   * ("weak") type — without this, TS's weak-type check looks for a NAMED
   * property in common and finds none, even though `process.env.DEMO_MODE`
   * works fine at runtime. Surfaced by `tsc --noEmit` after this phase's
   * @types/node upgrade; not a behavior change, just satisfying the checker.
   */
  [key: string]: string | undefined;
}

/** Strict equality against the literal string "true" — DEMO_MODE=1, "TRUE", "yes" etc. are all treated as OFF, on purpose. An operator who typos this env var gets demo affordances disabled, never accidentally enabled. */
export function isDemoModeEnabled(env: DemoModeEnv = process.env): boolean {
  return env.DEMO_MODE === 'true';
}

export class DemoModeDisabledError extends Error {
  constructor() {
    super('This action/route is demo-only and DEMO_MODE is not "true"');
    this.name = 'DemoModeDisabledError';
  }
}

/** Throwing guard for the top of any demo-only route/server action/RBAC action. */
export function assertDemoModeEnabled(env: DemoModeEnv = process.env): void {
  if (!isDemoModeEnabled(env)) {
    throw new DemoModeDisabledError();
  }
}
