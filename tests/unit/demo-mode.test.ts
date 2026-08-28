import { describe, expect, it } from 'vitest';
import { assertDemoModeEnabled, DemoModeDisabledError, isDemoModeEnabled } from '@/lib/demo-mode';

describe('demo-mode (decisions doc correction #3)', () => {
  it('is enabled only for the exact string "true"', () => {
    expect(isDemoModeEnabled({ DEMO_MODE: 'true' })).toBe(true);
  });

  it.each(['1', 'TRUE', 'True', 'yes', '', undefined])(
    'treats %j as disabled, not a loose truthy check',
    (value) => {
      expect(isDemoModeEnabled({ DEMO_MODE: value })).toBe(false);
    }
  );

  it('defaults to disabled when DEMO_MODE is entirely absent from the env', () => {
    expect(isDemoModeEnabled({})).toBe(false);
  });

  it('assertDemoModeEnabled throws DemoModeDisabledError when disabled', () => {
    expect(() => assertDemoModeEnabled({ DEMO_MODE: 'false' })).toThrow(DemoModeDisabledError);
  });

  it('assertDemoModeEnabled does not throw when enabled', () => {
    expect(() => assertDemoModeEnabled({ DEMO_MODE: 'true' })).not.toThrow();
  });
});
