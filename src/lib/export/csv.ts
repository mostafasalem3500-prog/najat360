/**
 * CSV export — section 30.9's explicit MVP export bar: "client-side
 * CSV/XLSX يكفي للـMVP؛ PDF اختياري" (CSV/XLSX is enough for MVP; PDF is
 * optional). CSV is what this module produces: it opens directly in Excel
 * (satisfying "export Excel" for a manager without needing a binary .xlsx
 * writer), needs no new dependency, and is trivial to verify byte-for-byte
 * in a test — unlike a binary spreadsheet format.
 *
 * Deliberately does NOT decide what data goes in: callers must (1) already
 * have applied `serializeIncidentForRole()` per row — this module has no
 * idea what a "role" is and never should — and (2) pass the filters that
 * produced these rows, so `buildExportMetadata` can record them. Per spec
 * 30.9: "export البيانات المصرح بها فقط" (export only already-authorized
 * data present in our own app), "أضف metadata: generatedAt, filters,
 * synthetic, schemaVersion", "سجل export في AuditLog" (the AuditLog write
 * itself is the caller's job — see lib/audit.ts's buildAuditLogEntry).
 */

export const INCIDENT_EXPORT_SCHEMA_VERSION = 'najat360.incident-export.v1';

export interface ExportMetadata {
  generatedAt: Date;
  /** Whatever filter object produced these rows — recorded verbatim (JSON-stringified) so an export is reproducible/auditable. Pass `{}` for an unfiltered export, not `undefined`. */
  filters: Record<string, unknown>;
  /** True for every export this app can currently produce — there is no non-synthetic data source (see project README). Kept as an explicit field rather than assumed, so the day a real data source exists this becomes a real per-export flag instead of a silent lie. */
  synthetic: boolean;
  schemaVersion: string;
}

export function buildExportMetadata(filters: Record<string, unknown>, generatedAt: Date): ExportMetadata {
  return { generatedAt, filters, synthetic: true, schemaVersion: INCIDENT_EXPORT_SCHEMA_VERSION };
}

function escapeCsvField(value: unknown): string {
  if (value === null || value === undefined) return '';
  const stringValue = value instanceof Date ? value.toISOString() : String(value);
  const needsQuoting = /[",\n\r]/.test(stringValue);
  if (!needsQuoting) return stringValue;
  return `"${stringValue.replace(/"/g, '""')}"`;
}

/**
 * Column order: `id` first when present (it's the natural anchor column in
 * any spreadsheet a manager scrolls through), then every other key seen
 * across ALL rows, alphabetically — deterministic regardless of which row
 * happened to have which fields first (role-projected rows can have
 * different shapes; a CALL_TAKER row and a SUPERVISOR row exporting
 * together should still line up under one stable header).
 */
function collectColumns(rows: readonly Record<string, unknown>[]): string[] {
  const seen = new Set<string>();
  for (const row of rows) {
    for (const key of Object.keys(row)) seen.add(key);
  }
  const rest = [...seen].filter((k) => k !== 'id').sort();
  return seen.has('id') ? ['id', ...rest] : rest;
}

/**
 * Builds the full CSV text: a small metadata preamble (each line
 * `key,value`, so the file is one valid CSV throughout rather than a CSV
 * body with a foreign header format bolted on), a blank separator line,
 * then the column header and data rows.
 */
export function buildIncidentExportCsv(rows: readonly Record<string, unknown>[], metadata: ExportMetadata): string {
  const lines: string[] = [];

  lines.push(`generatedAt,${escapeCsvField(metadata.generatedAt)}`);
  lines.push(`schemaVersion,${escapeCsvField(metadata.schemaVersion)}`);
  lines.push(`synthetic,${escapeCsvField(metadata.synthetic)}`);
  lines.push(`filters,${escapeCsvField(JSON.stringify(metadata.filters))}`);
  lines.push('');

  const columns = collectColumns(rows);
  lines.push(columns.map(escapeCsvField).join(','));
  for (const row of rows) {
    lines.push(columns.map((col) => escapeCsvField(row[col])).join(','));
  }

  return lines.join('\r\n');
}
