import { describe, expect, it } from 'vitest';
import { scanContent, scanRepo } from '../../scripts/ci-secret-scan';

describe('ci-secret-scan — rules (corrected scope, decisions doc correction #2)', () => {
  it('flags the real CAD domain anywhere, including inside docs/', () => {
    const inCode = scanContent('src/lib/integrations/cad/real.ts', `const url = "https://cad.alsahab.sa/live-map";`);
    const inDocs = scanContent('docs/risk-notes.md', `We do not connect to alsahab.sa in any environment.`);
    expect(inCode.some((v) => v.rule === 'real-cad-domain')).toBe(true);
    expect(inDocs.some((v) => v.rule === 'real-cad-domain')).toBe(true);
  });

  it('flags a JWT-shaped token anywhere, including inside docs/', () => {
    const fakeJwt = 'eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiIxMjM0NTY3ODkwIn0.dQw4w9WgXcQrandomsignature';
    const inCode = scanContent('src/lib/session.ts', `const token = "${fakeJwt}";`);
    const inDocs = scanContent('docs/incident-notes.md', `Captured token example: ${fakeJwt}`);
    expect(inCode.some((v) => v.rule === 'jwt-shaped-token')).toBe(true);
    expect(inDocs.some((v) => v.rule === 'jwt-shaped-token')).toBe(true);
  });

  it('flags a real-shaped KSA phone number anywhere, including inside docs/', () => {
    const inCode = scanContent('scripts/seed-demo.ts', `const phone = "+966512345678";`);
    const inDocs = scanContent('docs/field-notes.md', `Reach the coordinator at 0512345678.`);
    expect(inCode.some((v) => v.rule === 'real-ksa-phone-number')).toBe(true);
    expect(inDocs.some((v) => v.rule === 'real-ksa-phone-number')).toBe(true);
  });

  it('does NOT flag the seed script\'s own SYN-CALLER-PHONE placeholder as a real phone number', () => {
    const violations = scanContent('scripts/seed-demo.ts', `callerPhone: "SYN-CALLER-PHONE-000123",`);
    expect(violations.some((v) => v.rule === 'real-ksa-phone-number')).toBe(false);
  });

  it('flags a vendor name in code/src/scripts but NOT inside docs/ (the corrected rule)', () => {
    const inCode = scanContent('src/lib/integrations/telephony/notes.ts', `// legacy vendor: Avaya`);
    const inDocs = scanContent(
      'docs/risk/incumbent-stack.md',
      `The incumbent platform is understood to run an Avaya-based CTI softphone layer; NAJAT360 does not integrate with it.`
    );
    expect(inCode.some((v) => v.rule === 'vendor-name-outside-docs')).toBe(true);
    expect(inDocs.some((v) => v.rule === 'vendor-name-outside-docs')).toBe(false);
  });

  it('a clean file with none of the banned patterns produces zero violations', () => {
    const violations = scanContent(
      'src/lib/rescue-code.ts',
      `export function generateRescueCode() { return { id: 'x', rescueCode: 'NJT-7K4-92' }; }`
    );
    expect(violations).toEqual([]);
  });

  it('reports the correct 1-indexed line number', () => {
    const content = ['line one', 'line two is fine', 'const domain = "alsahab.sa";', 'line four'].join('\n');
    const violations = scanContent('src/example.ts', content);
    expect(violations).toHaveLength(1);
    expect(violations[0]!.line).toBe(3);
  });
});

describe('ci-secret-scan — full repo scan', () => {
  it('the actual najat360 repository is currently clean', () => {
    const violations = scanRepo();
    if (violations.length > 0) {
      console.error('Unexpected violations in repo:', violations);
    }
    expect(violations).toEqual([]);
  });
});
