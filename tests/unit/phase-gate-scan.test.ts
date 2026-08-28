import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { checkContentDoesNotContain, DEFERRED_STATUSES, stripComments } from '../../scripts/phase-gate-scan';

describe('phase-gate-scan', () => {
  it('flags a deferred status used as real code (e.g. inside a transitions map)', () => {
    const content = `const TRANSITIONS = { ON_SCENE: ['TRANSPORT_DECISION'] };`;
    const results = checkContentDoesNotContain('fake.ts', content, ['TRANSPORT_DECISION']);
    expect(results.every((r) => r.ok)).toBe(false);
  });

  it('does NOT flag a deferred status mentioned only inside a comment explaining it is excluded', () => {
    // This is the exact false positive this scanner produced against its
    // own project's state-machine.ts header comment before this fix.
    const content = [
      '/**',
      ' * Hospital handover states (TRANSPORT_DECISION -> ... -> END_HANDOVER)',
      ' * are explicitly deferred to C8.',
      ' */',
      'const x = 1;',
    ].join('\n');
    const results = checkContentDoesNotContain('fake.ts', content, DEFERRED_STATUSES);
    expect(results.every((r) => r.ok)).toBe(true);
  });

  it('does not flag a term mentioned only in a single-line // comment', () => {
    const content = `// ABORTED is deferred to C9\nconst x = 1;`;
    const results = checkContentDoesNotContain('fake.ts', content, ['ABORTED']);
    expect(results.every((r) => r.ok)).toBe(true);
  });

  it('stripComments removes both block and line comments, leaving code intact', () => {
    const content = `const a = 1; // trailing\n/* block */ const b = 2;`;
    const stripped = stripComments(content);
    expect(stripped).not.toContain('trailing');
    expect(stripped).not.toContain('block');
    expect(stripped).toContain('const a = 1;');
    expect(stripped).toContain('const b = 2;');
  });

  it('the actual najat360 project files are currently clean of every deferred status', () => {
    // Exercises the real files through the same code path main() uses.
    const root = process.cwd();
    for (const relativePath of [
      'prisma/schema.prisma',
      'src/lib/incidents/state-machine.ts',
      'src/lib/domain/types.ts',
    ]) {
      const content = readFileSync(resolve(root, relativePath), 'utf-8');
      const results = checkContentDoesNotContain(relativePath, content, DEFERRED_STATUSES);
      const failures = results.filter((r) => !r.ok);
      expect(failures, JSON.stringify(failures)).toEqual([]);
    }
  });
});
