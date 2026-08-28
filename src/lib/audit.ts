/**
 * AuditLog row builder — a small, pure helper so every place that needs to
 * record an audit entry (suggestion acceptance, dispatch decision, cancel
 * override, ...) builds the same shape the same way, instead of each call
 * site hand-assembling the object. Deliberately has no I/O: it returns a
 * row for the caller's repository layer to insert alongside whatever
 * transaction it's already running (e.g. an accepted suggestion's
 * Incident update + IncidentEvent insert + this AuditLog insert, all in
 * one transaction) — this module has no opinion about how that happens.
 */
import type { AuditLog } from '@/lib/domain/types';

export interface BuildAuditLogInput {
  id: string;
  actorId?: string | null;
  action: string;
  entityType: string;
  entityId: string;
  before?: unknown;
  after?: unknown;
  createdAt?: Date;
}

export function buildAuditLogEntry(input: BuildAuditLogInput): AuditLog {
  return {
    id: input.id,
    actorId: input.actorId ?? null,
    action: input.action,
    entityType: input.entityType,
    entityId: input.entityId,
    before: input.before,
    after: input.after,
    createdAt: input.createdAt ?? new Date(),
  };
}
