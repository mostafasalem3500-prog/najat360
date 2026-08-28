import { describe, expect, it } from 'vitest';
import { buildAuditLogEntry } from '@/lib/audit';

describe('audit — buildAuditLogEntry', () => {
  it('builds a complete AuditLog row from the required fields', () => {
    const entry = buildAuditLogEntry({
      id: 'audit-1',
      actorId: 'call-taker-1',
      action: 'SUGGESTION_ACCEPTED',
      entityType: 'Incident',
      entityId: 'inc-1',
      before: { floorLevel: null },
      after: { floorLevel: '3' },
      createdAt: new Date('2026-08-24T12:00:00Z'),
    });
    expect(entry).toEqual({
      id: 'audit-1',
      actorId: 'call-taker-1',
      action: 'SUGGESTION_ACCEPTED',
      entityType: 'Incident',
      entityId: 'inc-1',
      before: { floorLevel: null },
      after: { floorLevel: '3' },
      createdAt: new Date('2026-08-24T12:00:00Z'),
    });
  });

  it('defaults actorId to null (SYSTEM-originated entries have no human actor)', () => {
    const entry = buildAuditLogEntry({
      id: 'audit-2',
      action: 'PROVIDER_TIMEOUT_FALLBACK',
      entityType: 'Incident',
      entityId: 'inc-2',
    });
    expect(entry.actorId).toBeNull();
  });

  it('defaults createdAt to now when not provided', () => {
    const before = new Date();
    const entry = buildAuditLogEntry({ id: 'audit-3', action: 'X', entityType: 'Incident', entityId: 'inc-3' });
    const after = new Date();
    expect(entry.createdAt.getTime()).toBeGreaterThanOrEqual(before.getTime());
    expect(entry.createdAt.getTime()).toBeLessThanOrEqual(after.getTime());
  });
});
