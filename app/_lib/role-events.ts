/**
 * Cross-component "the demo role changed" signal.
 *
 * RoleSwitcher.tsx is mounted once in the shared layout, but
 * app/operations/page.tsx and app/medic/page.tsx each fetch their own
 * /api/demo-session snapshot exactly once on mount (a plain `useEffect`
 * with an empty dependency array) and gate their whole screen on it. When
 * a demo operator switches role from the header, nothing told those pages
 * their stale `role`/`session` state was now wrong — the QA report's
 * Moderate Bug #1 ("role switch requires a manual reload"). Rather than
 * introduce a context provider or a data-fetching library for one small
 * broadcast, RoleSwitcher dispatches this DOM CustomEvent right after its
 * own /api/demo-session POST resolves, and each gated page listens for it
 * to update its local state directly from the event's payload — no extra
 * round trip, no reload.
 */
export const ROLE_CHANGED_EVENT = 'najat360:role-changed';

export interface DemoSessionPayload {
  role: string;
  userId: string;
  unitId?: string | null;
}

export function broadcastRoleChanged(session: DemoSessionPayload): void {
  if (typeof window === 'undefined') return;
  window.dispatchEvent(new CustomEvent<DemoSessionPayload>(ROLE_CHANGED_EVENT, { detail: session }));
}

export function onRoleChanged(handler: (session: DemoSessionPayload) => void): () => void {
  if (typeof window === 'undefined') return () => {};
  const listener = (e: Event) => handler((e as CustomEvent<DemoSessionPayload>).detail);
  window.addEventListener(ROLE_CHANGED_EVENT, listener);
  return () => window.removeEventListener(ROLE_CHANGED_EVENT, listener);
}
