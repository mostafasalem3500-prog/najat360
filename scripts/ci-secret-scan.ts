/**
 * CI secret/PII scan — spec section 30.10 ("لا تستخدم اسم الشركة المطورة أو
 * رابط المنصة في UI أو seed أو logs") plus acceptance test 30.14 #14 ("لا
 * توجد domain/JWT/session/real patient fixtures في المستودع").
 *
 * CORRECTED SCOPE (docs/product/NAJAT360-قرارات-ما-بعد-C0.md, correction
 * #2): an earlier draft of this rule blanket-banned the literal word
 * "Avaya" everywhere. The user corrected that — a vendor name can appear
 * legitimately in a risk-documentation file (e.g. "we do not integrate
 * with the incumbent's Avaya-based CTI layer"), and banning the word
 * outright would make writing that documentation impossible. The rule
 * actually needed:
 *
 *   - Real domain, JWT-shaped tokens, real KSA phone numbers: banned
 *     EVERYWHERE, including inside docs/ — these are secrets/PII shapes,
 *     not vendor references, and a risk doc never needs to contain an
 *     actual live example of one.
 *   - Vendor/company names (e.g. "Avaya"): banned in code/seed/src/scripts
 *     — anywhere that ships or runs — but explicitly ALLOWED inside docs/,
 *     where they may legitimately appear in prose describing the
 *     incumbent system this project does not integrate with.
 *
 * DOMAIN CHECK, HASH-BASED (not a literal substring match): comparing this
 * script against a second independent C1 attempt (ChatGPT, given the same
 * build prompt) surfaced a cleaner technique than a literal
 * `/realdomain/i` regex — extract domain-shaped tokens from the text,
 * SHA-256 each one, and compare against a precomputed hash set. That way
 * THIS FILE never contains the real domain string as plaintext anywhere,
 * closing the one gap a literal-regex scanner always has (its own source
 * necessarily contains the exact string it's banning). The vendor-name
 * rule still needs the literal word "Avaya" in this file to define a
 * substring/word-boundary match over free-flowing prose — hashing doesn't
 * help there, since there's no single exact token to hash — so
 * SELF_EXCLUDED_FILES below still matters for that one rule.
 *
 * This script has no dependencies beyond Node's fs/path/crypto — it is
 * meant to run in CI with nothing but `tsx` available, same as the rest of
 * package.json's scripts.
 */
import { createHash } from 'node:crypto';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { extname, join, relative } from 'node:path';

const ROOT = process.cwd();

const EXCLUDED_DIRS = new Set(['node_modules', '.git', 'dist', 'build', '.next', 'coverage']);

// This scanner's own source (and its test file) necessarily contains the
// literal patterns/names it looks for, to define them — excluding self
// from the scan is standard practice for secret scanners, not a loophole.
const SELF_EXCLUDED_FILES = new Set(['scripts/ci-secret-scan.ts', 'tests/unit/ci-secret-scan.test.ts']);

const SCANNABLE_EXTENSIONS = new Set(['.ts', '.tsx', '.js', '.jsx', '.json', '.md', '.sql', '.env', '.yml', '.yaml']);

export interface Violation {
  file: string;
  line: number;
  rule: string;
  excerpt: string;
}

export interface SecretRule {
  name: string;
  /** Either a regex to test each line against, or a custom matcher (used by the hash-based domain rule) that returns the matched substring, or null/undefined if no match. Exactly one of `pattern`/`check` is set. */
  pattern?: RegExp;
  check?: (line: string) => string | null | undefined;
  /** true = this rule is skipped for files under docs/ (vendor-name rule only). Domain/JWT/phone rules leave this false — they apply everywhere. */
  skipInDocs: boolean;
}

// Domain-shaped token: one or more `label.` segments followed by a 2+
// letter TLD, e.g. "example.com" or "cad.example.gov.sa". Used only to
// find CANDIDATES to hash-check below — it is intentionally broad (it
// will also match plenty of harmless domains); the hash comparison is
// what actually decides whether a candidate is the banned one.
const DOMAIN_CANDIDATE_PATTERN = /\b(?:[a-z0-9-]+\.)+[a-z]{2,}\b/gi;

// SHA-256 hex digests of the real production CAD domain (and its `cad.`
// subdomain) this project analyzes but never integrates with. Banned
// everywhere, docs included — a documented risk note never needs the
// literal hostname to make its point, and this project must never
// accidentally point at the real system. See the module docstring for why
// this is a hash set rather than a literal string/regex.
const FORBIDDEN_HOST_HASHES = new Set([
  'e0bd1a0b4b4a57d849857c590a3fa282ba5b92ef4c876c093431ce6ab65b3d45',
  '4118602edb34411f52fb3769dd802c4a6491c1c8ce08ffe9cf6fa4b5dbc106c2',
]);

function sha256Hex(value: string): string {
  return createHash('sha256').update(value.toLowerCase()).digest('hex');
}

function findForbiddenHost(line: string): string | null {
  const candidates = line.match(DOMAIN_CANDIDATE_PATTERN);
  if (!candidates) return null;
  for (const candidate of candidates) {
    if (FORBIDDEN_HOST_HASHES.has(sha256Hex(candidate))) {
      return candidate;
    }
  }
  return null;
}

// JWT-shaped token: three dot-separated base64url segments, the first
// starting with the base64 encoding of `{"` (`eyJ`). Matches a real
// captured token, not the word "token" or a UUID.
const JWT_PATTERN = /\beyJ[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\b/;

// Real Saudi mobile numbers: +9665XXXXXXXX (9 digits after +966) or
// 05XXXXXXXX (10 digits including the leading 0). Seed data uses the
// non-phone-shaped `SYN-CALLER-PHONE-000123` placeholder specifically so
// it can never collide with this pattern — see tests/unit/seed-synthetic.test.ts.
const KSA_PHONE_PATTERN = /(?:\+?9665\d{8}|05\d{8})\b/;

// Vendor/company names for the real platform's incumbent stack. Banned in
// shipped/runnable code; allowed in docs/ prose (see module docstring).
const VENDOR_NAMES = ['Avaya'];
const VENDOR_NAME_PATTERN = new RegExp(`\\b(${VENDOR_NAMES.join('|')})\\b`, 'i');

export const RULES: SecretRule[] = [
  { name: 'real-cad-domain', check: findForbiddenHost, skipInDocs: false },
  { name: 'jwt-shaped-token', pattern: JWT_PATTERN, skipInDocs: false },
  { name: 'real-ksa-phone-number', pattern: KSA_PHONE_PATTERN, skipInDocs: false },
  { name: 'vendor-name-outside-docs', pattern: VENDOR_NAME_PATTERN, skipInDocs: true },
];

function isUnderDocs(relativePath: string): boolean {
  return relativePath === 'docs' || relativePath.startsWith('docs/') || relativePath.startsWith('docs\\');
}

function listFiles(dir: string, root: string): string[] {
  const entries = readdirSync(dir);
  const files: string[] = [];
  for (const entry of entries) {
    const fullPath = join(dir, entry);
    const rel = relative(root, fullPath);
    if (EXCLUDED_DIRS.has(entry)) continue;
    const stat = statSync(fullPath);
    if (stat.isDirectory()) {
      files.push(...listFiles(fullPath, root));
    } else if (SCANNABLE_EXTENSIONS.has(extname(entry)) || entry === '.env.example') {
      if (SELF_EXCLUDED_FILES.has(rel)) continue;
      files.push(fullPath);
    }
  }
  return files;
}

export function scanContent(relativePath: string, content: string): Violation[] {
  const violations: Violation[] = [];
  const inDocs = isUnderDocs(relativePath);
  const lines = content.split('\n');

  for (const rule of RULES) {
    if (rule.skipInDocs && inDocs) continue;
    lines.forEach((line, idx) => {
      const matched = rule.check ? rule.check(line) : rule.pattern!.exec(line)?.[0];
      if (matched) {
        violations.push({
          file: relativePath,
          line: idx + 1,
          rule: rule.name,
          excerpt: line.trim().slice(0, 120),
        });
      }
      if (rule.pattern) rule.pattern.lastIndex = 0; // rule patterns are not global, but reset defensively
    });
  }

  return violations;
}

export function scanRepo(root: string = ROOT): Violation[] {
  const files = listFiles(root, root);
  const violations: Violation[] = [];
  for (const file of files) {
    const rel = relative(root, file).split('\\').join('/');
    const content = readFileSync(file, 'utf-8');
    violations.push(...scanContent(rel, content));
  }
  return violations;
}

function main(): void {
  const violations = scanRepo();
  if (violations.length === 0) {
    console.log('ci-secret-scan: clean — no real domain/JWT/phone patterns, no vendor names outside docs/.');
    return;
  }

  console.error(`ci-secret-scan: ${violations.length} violation(s) found:\n`);
  for (const v of violations) {
    console.error(`  [${v.rule}] ${v.file}:${v.line}\n    ${v.excerpt}`);
  }
  process.exitCode = 1;
}

const isMainModule = import.meta.url === `file://${process.argv[1]}`;
if (isMainModule) {
  main();
}
