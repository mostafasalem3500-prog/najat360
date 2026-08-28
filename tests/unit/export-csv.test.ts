import { describe, expect, it } from 'vitest';
import { buildExportMetadata, buildIncidentExportCsv, INCIDENT_EXPORT_SCHEMA_VERSION } from '@/lib/export/csv';

describe('buildExportMetadata', () => {
  it('always marks synthetic true and stamps the schema version', () => {
    const meta = buildExportMetadata({ zone: 'zone-north' }, new Date('2026-08-24T12:00:00Z'));
    expect(meta.synthetic).toBe(true);
    expect(meta.schemaVersion).toBe(INCIDENT_EXPORT_SCHEMA_VERSION);
    expect(meta.filters).toEqual({ zone: 'zone-north' });
  });
});

describe('buildIncidentExportCsv', () => {
  const metadata = buildExportMetadata({ zone: 'zone-north' }, new Date('2026-08-24T12:00:00Z'));

  it('includes generatedAt, schemaVersion, synthetic, and filters as a metadata preamble', () => {
    const csv = buildIncidentExportCsv([], metadata);
    const lines = csv.split('\r\n');
    expect(lines[0]).toBe('generatedAt,2026-08-24T12:00:00.000Z');
    expect(lines[1]).toBe(`schemaVersion,${INCIDENT_EXPORT_SCHEMA_VERSION}`);
    expect(lines[2]).toBe('synthetic,true');
    expect(lines[3]).toBe('filters,"{""zone"":""zone-north""}"');
    expect(lines[4]).toBe('');
  });

  it('derives the header from the union of keys across all rows, id first then alphabetical', () => {
    const csv = buildIncidentExportCsv(
      [
        { id: 'a', status: 'NEW' },
        { id: 'b', priority: 'HIGH' },
      ],
      metadata
    );
    const header = csv.split('\r\n')[5];
    expect(header).toBe('id,priority,status');
  });

  it('renders missing fields as empty cells rather than dropping columns', () => {
    const csv = buildIncidentExportCsv(
      [
        { id: 'a', status: 'NEW' },
        { id: 'b', priority: 'HIGH' },
      ],
      metadata
    );
    const rows = csv.split('\r\n').slice(6);
    expect(rows).toEqual(['a,,NEW', 'b,HIGH,']);
  });

  it('escapes commas, quotes, and newlines per CSV rules', () => {
    const csv = buildIncidentExportCsv([{ id: 'a', description: 'hazard, "gas leak"\nnear gate' }], metadata);
    const dataLine = csv.split('\r\n')[6];
    expect(dataLine).toBe('a,"hazard, ""gas leak""\nnear gate"');
  });

  it('formats Date values as ISO strings', () => {
    const csv = buildIncidentExportCsv([{ id: 'a', createdAt: new Date('2026-08-24T08:00:00Z') }], metadata);
    const dataLine = csv.split('\r\n')[6];
    expect(dataLine).toBe('a,2026-08-24T08:00:00.000Z');
  });

  it('renders null and undefined as empty strings, not the literal word', () => {
    const csv = buildIncidentExportCsv([{ id: 'a', priority: null, floorLevel: undefined }], metadata);
    const dataLine = csv.split('\r\n')[6];
    expect(dataLine).toBe('a,,');
  });

  it('produces a stable, identical header across rows with different shapes even when the first row is the smallest', () => {
    const csv = buildIncidentExportCsv([{ id: 'a' }, { id: 'b', zone: 'zone-north', status: 'NEW' }], metadata);
    const header = csv.split('\r\n')[5];
    expect(header).toBe('id,status,zone');
  });
});
