/**
 * A refusal's `details.reason`, worded in the console's language
 * (O14, tm 259.18).
 *
 * The server (`routes/settings.ts`, `services/billing/subscription-service.ts`)
 * sends a stable code next to its English prose; the console words the code.
 * This pins both halves: every code the server can send has wording in both
 * catalogues, and a code this build does not know falls through to the caller's
 * error-type sentence instead of printing the server's prose.
 */
import { describe, expect, it } from 'vitest';
import { ApiClientError } from './api-client.js';
import { hasMessage, translate } from './i18n.js';
import { reasonMessage } from './reason-message.js';

const tEn = (key: string, params?: Record<string, string | number>): string =>
  translate('en', key, params);
const tTr = (key: string, params?: Record<string, string | number>): string =>
  translate('tr', key, params);

function refusal(details?: Record<string, unknown>): ApiClientError {
  return new ApiClientError({
    type: 'validation',
    status: 400,
    message: 'English prose that must never reach a Turkish screen.',
    requestId: 'req_r',
    ...(details ? { details } : {}),
  });
}

/** Every reason the API emits today, with the catalogue prefix its screen resolves it under. */
const SERVER_REASONS: ReadonlyArray<readonly [prefix: string, reason: string]> = [
  ['settings.reason', 'ip_allowlist_self_lockout'],
  ['settings.reason', 'sso_no_break_glass_owner'],
  ['settings.reason', 'sso_domain_code_expired'],
  ['settings.reason', 'sso_domain_none_outstanding'],
  ['settings.reason', 'sso_domain_code_mismatch'],
  ['settings.reason', 'sso_domain_challenge_too_soon'],
  ['billing.reason', 'plan_below_usage'],
  ['billing.reason', 'seats_below_active'],
  ['billing.reason', 'plan_unknown'],
  ['billing.reason', 'cycle_unknown'],
];

describe('reasonMessage', () => {
  it.each(SERVER_REASONS)('has wording for %s.%s in English and Turkish', (prefix, reason) => {
    expect(hasMessage('en', `${prefix}.${reason}`)).toBe(true);
    expect(hasMessage('tr', `${prefix}.${reason}`)).toBe(true);
    const en = reasonMessage(
      tEn,
      refusal({ reason, plan: 'Growth', included: 1, used: 2 }),
      prefix,
    );
    const tr = reasonMessage(
      tTr,
      refusal({ reason, plan: 'Growth', included: 1, used: 2 }),
      prefix,
    );
    expect(en).not.toBeNull();
    expect(tr).not.toBeNull();
    expect(tr).not.toBe(en);
  });

  it('fills the figures the sentence is about from details, and lets a caller override one', () => {
    const error = refusal({ reason: 'plan_below_usage', plan: 'growth', included: 200, used: 250 });
    expect(reasonMessage(tEn, error, 'billing.reason')).toBe(
      'The growth plan includes 200 AI resolutions — below the 250 already used this month.',
    );
    expect(reasonMessage(tEn, error, 'billing.reason', { plan: 'Growth' })).toContain(
      'The Growth plan',
    );
    expect(reasonMessage(tTr, error, 'billing.reason', { plan: 'Growth' })).toBe(
      'Growth planı 200 AI çözümü içeriyor — bu ay kullanılan 250 çözümün altında.',
    );
  });

  it('is null when the error carries no code, or one this build has no wording for', () => {
    expect(reasonMessage(tTr, refusal(), 'settings.reason')).toBeNull();
    expect(
      reasonMessage(tTr, refusal({ reason: 'invented_next_year' }), 'settings.reason'),
    ).toBeNull();
    expect(reasonMessage(tTr, refusal({ reason: 42 }), 'settings.reason')).toBeNull();
  });

  it('never answers with the server’s prose, and ignores a value that is not an API error', () => {
    expect(reasonMessage(tTr, new Error('Failed to fetch'), 'settings.reason')).toBeNull();
    expect(reasonMessage(tTr, 'boom', 'settings.reason')).toBeNull();
    const message = reasonMessage(
      tTr,
      refusal({ reason: 'ip_allowlist_self_lockout' }),
      'settings.reason',
    );
    expect(message).not.toMatch(/English prose/);
  });
});
