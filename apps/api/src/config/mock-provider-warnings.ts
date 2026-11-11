/**
 * Mock providers where real people use the system (tm 433 · F21, F32 · NY-51).
 *
 * Every external dependency has a mock, and the mock is the default (MASTER-PROMPT
 * "dış servisler mock'lanır"). Three of them do something a person would not
 * expect from a running deployment:
 *
 *   - `VIRUS_SCANNER=mock` flags only the EICAR test file and passes every
 *     other upload, so an agent who opens an attachment trusts a scan that
 *     never happened. Warned in production **pilot included** — the pilot has
 *     chat attachments on and no ClamAV (owner 2026-11-06, S9 · S12).
 *   - `STRIPE_PROVIDER=mock` accepts any unexpired card on the masked form and
 *     charges nothing, yet a saved card activates the licence
 *     (`license-activation.ts`). Warned in production only when `PILOT_MODE` is
 *     off — the pilot takes no payments.
 *   - `CRAWLER_PROVIDER=mock` indexes the same invented page for every website
 *     knowledge source. Warned in production under `PILOT_MODE=true`, as it
 *     always was (tm 312.3).
 *
 * A warning, never a refusal: nothing here may join `productionProblems` and
 * stop the boot (owner 2026-10-10 and 2026-11-06 S18). The same list is logged
 * once at boot (`server.ts`) and shown in the published health snapshot
 * (`provider_warnings`), so an operator who never reads the boot log can still
 * see it.
 */
import type { CrawlerProvider } from '../services/ai/crawler/provider.js';
import type { PaymentProviderId } from '../services/billing/payment-provider.js';
import type { VirusScannerProvider } from '../services/storage/virus-scanner.js';

/** The dependency a warning is about — the key it has under `/health`'s `providers`. */
export type MockProviderKey = 'virus_scanner' | 'payment' | 'crawler';

export interface MockProviderWarning {
  provider: MockProviderKey;
  /** The boot log's `event` field. */
  event: string;
  /** One sentence for an operator: what the mock does and which setting replaces it. */
  message: string;
}

export interface MockProviderEnv {
  NODE_ENV: string;
  PILOT_MODE: boolean;
  VIRUS_SCANNER: VirusScannerProvider;
  STRIPE_PROVIDER: PaymentProviderId;
  CRAWLER_PROVIDER: CrawlerProvider;
}

/** The warnings this configuration earns, in a fixed order; empty outside production. */
export function mockProviderWarnings(env: MockProviderEnv): MockProviderWarning[] {
  if (env.NODE_ENV !== 'production') return [];
  const warnings: MockProviderWarning[] = [];
  if (env.VIRUS_SCANNER === 'mock') {
    warnings.push({
      provider: 'virus_scanner',
      event: 'uploads.virus_scanner_mock',
      message:
        'VIRUS_SCANNER is mock in production: uploads are not scanned for viruses (only the EICAR test file is refused), and the agent panel labels each attachment "Not checked for viruses". No real scanner is available yet.',
    });
  }
  if (env.STRIPE_PROVIDER === 'mock' && !env.PILOT_MODE) {
    warnings.push({
      provider: 'payment',
      event: 'payments.mock_in_production',
      message:
        'STRIPE_PROVIDER is mock in production with PILOT_MODE=false: a card saved on the masked form is never charged, yet it activates the workspace. Set STRIPE_PROVIDER=stripe with STRIPE_SECRET_KEY and STRIPE_WEBHOOK_SECRET, or take payment by bank transfer.',
    });
  }
  if (env.CRAWLER_PROVIDER === 'mock' && env.PILOT_MODE) {
    warnings.push({
      provider: 'crawler',
      event: 'crawler.mock_in_pilot',
      message:
        'CRAWLER_PROVIDER is mock under PILOT_MODE=true: website knowledge sources index an invented page instead of the site. Set CRAWLER_PROVIDER=http.',
    });
  }
  return warnings;
}

/** Log each warning once, at `warn`, with its `event` — what `server.ts` calls at boot. */
export function logMockProviderWarnings(
  log: { warn(fields: { event: string; provider: MockProviderKey }, message: string): void },
  env: MockProviderEnv,
): MockProviderWarning[] {
  const warnings = mockProviderWarnings(env);
  for (const warning of warnings) {
    log.warn({ event: warning.event, provider: warning.provider }, warning.message);
  }
  return warnings;
}
