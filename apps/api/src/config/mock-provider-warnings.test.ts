/**
 * The mock-provider warnings (tm 433 · F21, F32): which configuration earns
 * which line, that the boot logs each once, and that none of them stops a
 * production boot (owner 2026-11-06 S18 — warnings, never refusals).
 */
import { describe, expect, it, vi } from 'vitest';
import { testEnv } from '../../test/helpers/fixtures.js';
import {
  logMockProviderWarnings,
  type MockProviderEnv,
  mockProviderWarnings,
} from './mock-provider-warnings.js';

const PRODUCTION: MockProviderEnv = {
  NODE_ENV: 'production',
  PILOT_MODE: false,
  VIRUS_SCANNER: 'mock',
  STRIPE_PROVIDER: 'mock',
  CRAWLER_PROVIDER: 'mock',
};

const providers = (env: MockProviderEnv): string[] =>
  mockProviderWarnings(env).map((warning) => warning.provider);

describe('mockProviderWarnings', () => {
  it('warns production of the mock virus scanner, outside the pilot and inside it', () => {
    expect(providers(PRODUCTION)).toContain('virus_scanner');
    // The pilot has attachments on and no ClamAV (S9 · S12): not silenced there.
    expect(providers({ ...PRODUCTION, PILOT_MODE: true })).toContain('virus_scanner');
    const [warning] = mockProviderWarnings({ ...PRODUCTION, PILOT_MODE: true });
    expect(warning).toMatchObject({
      provider: 'virus_scanner',
      event: 'uploads.virus_scanner_mock',
    });
    expect(warning!.message).toMatch(/VIRUS_SCANNER is mock in production/);
    // `unavailable` refuses every upload — nothing unscanned is stored.
    expect(providers({ ...PRODUCTION, VIRUS_SCANNER: 'unavailable' })).not.toContain(
      'virus_scanner',
    );
  });

  it('warns production of the mock card processor only outside the pilot, and not on stripe', () => {
    const payment = mockProviderWarnings(PRODUCTION).find((w) => w.provider === 'payment');
    expect(payment).toMatchObject({ event: 'payments.mock_in_production' });
    expect(payment!.message).toMatch(/STRIPE_PROVIDER is mock in production with PILOT_MODE=false/);
    // The pilot takes no payments.
    expect(providers({ ...PRODUCTION, PILOT_MODE: true })).not.toContain('payment');
    expect(providers({ ...PRODUCTION, STRIPE_PROVIDER: 'stripe' })).not.toContain('payment');
  });

  it('keeps the crawler line it moved here with: production pilot on the mock only', () => {
    expect(providers(PRODUCTION)).not.toContain('crawler');
    const pilot = { ...PRODUCTION, PILOT_MODE: true };
    const crawler = mockProviderWarnings(pilot).find((w) => w.provider === 'crawler');
    expect(crawler).toMatchObject({ event: 'crawler.mock_in_pilot' });
    expect(crawler!.message).toBe(
      'CRAWLER_PROVIDER is mock under PILOT_MODE=true: website knowledge sources index an invented page instead of the site. Set CRAWLER_PROVIDER=http.',
    );
    expect(providers({ ...pilot, CRAWLER_PROVIDER: 'http' })).not.toContain('crawler');
  });

  it('says nothing outside production, whatever is mocked', () => {
    for (const NODE_ENV of ['development', 'test']) {
      expect(mockProviderWarnings({ ...PRODUCTION, NODE_ENV })).toEqual([]);
      expect(mockProviderWarnings({ ...PRODUCTION, NODE_ENV, PILOT_MODE: true })).toEqual([]);
    }
  });

  it('reads the parsed environment as it is (the defaults are all mock)', () => {
    expect(mockProviderWarnings(testEnv())).toEqual([]);
  });
});

describe('logMockProviderWarnings', () => {
  it('logs each warning once at warn, with its event and provider', () => {
    const warn = vi.fn();
    const logged = logMockProviderWarnings({ warn }, PRODUCTION);
    expect(warn).toHaveBeenCalledTimes(2);
    expect(warn).toHaveBeenNthCalledWith(
      1,
      { event: 'uploads.virus_scanner_mock', provider: 'virus_scanner' },
      logged[0]!.message,
    );
    expect(warn).toHaveBeenNthCalledWith(
      2,
      { event: 'payments.mock_in_production', provider: 'payment' },
      logged[1]!.message,
    );
  });

  it('logs the same lines under the pilot: the scanner and the crawler, no payment', () => {
    const warn = vi.fn();
    logMockProviderWarnings({ warn }, { ...PRODUCTION, PILOT_MODE: true });
    expect(warn.mock.calls.map(([fields]) => fields.event)).toEqual([
      'uploads.virus_scanner_mock',
      'crawler.mock_in_pilot',
    ]);
  });

  it('logs nothing when nothing is mocked where it matters', () => {
    const warn = vi.fn();
    logMockProviderWarnings(
      { warn },
      { ...PRODUCTION, VIRUS_SCANNER: 'unavailable', STRIPE_PROVIDER: 'stripe' },
    );
    expect(warn).not.toHaveBeenCalled();
  });
});
