/**
 * Minimal .env loader shared by scripts (seed, ci-secret-scan). No
 * `dotenv` dependency: this is ~15 lines and keeps the dependency list
 * exactly what section 16's environment variable list implies is needed,
 * nothing more.
 */
import { readFileSync, existsSync } from 'node:fs';
import { resolve } from 'node:path';

export function loadEnvFile(path = resolve(process.cwd(), '.env')): void {
  if (!existsSync(path)) return;
  const contents = readFileSync(path, 'utf-8');
  for (const line of contents.split('\n')) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;
    const eq = trimmed.indexOf('=');
    if (eq === -1) continue;
    const key = trimmed.slice(0, eq).trim();
    const value = trimmed.slice(eq + 1).trim();
    if (key && process.env[key] === undefined) {
      process.env[key] = value;
    }
  }
}
