/**
 * Tiny fetch wrapper shared by every client page under app/**. Every
 * mutation/read in this UI goes through app/api/** route handlers — not
 * direct repo.ts calls from a client component (impossible anyway, but
 * worth stating: this keeps the RBAC/session enforcement in exactly one
 * server-side layer, per lib/auth/rbac.ts's own "apply RBAC on the server"
 * rule, regardless of which page happens to be asking).
 */
export class ApiError extends Error {
  constructor(
    public readonly status: number,
    public readonly code: string,
    message: string
  ) {
    super(message);
    this.name = 'ApiError';
  }
}

export async function apiFetch<T>(path: string, init?: RequestInit): Promise<T> {
  const response = await fetch(path, {
    ...init,
    headers: { 'Content-Type': 'application/json', ...(init?.headers ?? {}) },
  });
  const body = await response.json().catch(() => ({}));
  if (!response.ok) {
    throw new ApiError(response.status, body.error ?? 'UnknownError', body.message ?? response.statusText);
  }
  return body as T;
}

export const apiGet = <T>(path: string) => apiFetch<T>(path);
export const apiPost = <T>(path: string, body?: unknown) =>
  apiFetch<T>(path, { method: 'POST', body: body !== undefined ? JSON.stringify(body) : undefined });
