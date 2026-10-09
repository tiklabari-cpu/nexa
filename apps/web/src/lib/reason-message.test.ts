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

/**
 * The reasons tm 261 added, with the facts the server sends beside each and the
 * sentence both catalogues must produce. A value the sentence is about (`uri`,
 * `scopes`, `columns`) arrives as a detail and fills a placeholder, so the
 * rejected thing is still named in the viewer's language.
 */
const WORDED: ReadonlyArray<
  readonly [prefix: string, details: Record<string, unknown>, en: string, tr: string]
> = [
  [
    'apps.developers.reason',
    { reason: 'redirect_uri_scheme', uri: 'http://evil.test/cb' },
    'The redirect URI “http://evil.test/cb” must use https (http is allowed only on localhost, for development).',
    '“http://evil.test/cb” yönlendirme adresi https kullanmalı (http yalnızca geliştirme için localhost’ta kabul edilir).',
  ],
  [
    'apps.developers.reason',
    {
      reason: 'redirect_uri_not_canonical',
      uri: 'https://A.test/cb',
      canonical: 'https://a.test/cb',
    },
    'The redirect URI “https://A.test/cb” is not in canonical form and would never match; register “https://a.test/cb” instead.',
    '“https://A.test/cb” yönlendirme adresi kanonik biçimde değil ve hiçbir zaman eşleşmez; bunun yerine “https://a.test/cb” kaydedin.',
  ],
  [
    'apps.developers.reason',
    { reason: 'redirect_uris_too_many', max: 10 },
    'An app can have at most 10 redirect URIs.',
    'Bir uygulamanın en fazla 10 yönlendirme adresi olabilir.',
  ],
  [
    'apps.developers.reason',
    { reason: 'scopes_not_held', scopes: 'chats--all:rw, billing_manage' },
    'You cannot grant scopes your own session does not hold: chats--all:rw, billing_manage.',
    'Kendi oturumunuzun sahip olmadığı kapsamları veremezsiniz: chats--all:rw, billing_manage.',
  ],
  [
    'apps.developers.webhooks.reason',
    { reason: 'url_private_host' },
    'That address points at a private or internal host and cannot be called.',
    'Bu adres özel ya da dahili bir sunucuya çıkıyor ve çağrılamaz.',
  ],
  [
    'apps.developers.webhooks.reason',
    { reason: 'app_not_connected', app_name: 'Zapier' },
    'Connect Zapier in the app marketplace first.',
    'Önce uygulama pazaryerinde Zapier uygulamasını bağlayın.',
  ],
  [
    'settings.pat.reason',
    { reason: 'scopes_not_held', scopes: 'reports_read' },
    'You cannot grant scopes your own session does not hold: reports_read.',
    'Kendi oturumunuzun sahip olmadığı kapsamları veremezsiniz: reports_read.',
  ],
  [
    'playbook.bulk.reason',
    { reason: 'csv_too_many_rows', line: 202, column: 1, max_rows: 200 },
    'Line 202, column 1: the file holds more than 200 rows.',
    '202. satır, 1. sütun: dosya 200 satırdan fazla içeriyor.',
  ],
  [
    'playbook.bulk.reason',
    { reason: 'csv_header_missing', columns: 'type, source_url' },
    'The first row is missing required column(s): type, source_url.',
    'İlk satırda gerekli sütun(lar) eksik: type, source_url.',
  ],
  [
    'playbook.editor.stepProblem',
    { reason: 'transfer_to_team_needs_team', step: 3 },
    'Step 3: choose a team to hand the conversation over to.',
    '3. adım: sohbetin devredileceği bir takım seçin.',
  ],
];

describe('reasonMessage — the refusals worded in tm 261', () => {
  it.each(WORDED)(
    '%s: %j reads the same facts in English and Turkish',
    (prefix, details, en, tr) => {
      expect(reasonMessage(tEn, refusal(details), prefix)).toBe(en);
      expect(reasonMessage(tTr, refusal(details), prefix)).toBe(tr);
    },
  );

  it('every code the server can send has wording in both catalogues', () => {
    const CODES: Record<string, string[]> = {
      'apps.developers.reason': [
        'redirect_uri_too_long',
        'redirect_uri_not_absolute',
        'redirect_uri_fragment',
        'redirect_uri_path_traversal',
        'redirect_uri_wildcard',
        'redirect_uri_credentials',
        'redirect_uri_no_host',
        'redirect_uri_scheme',
        'redirect_uri_not_canonical',
        'redirect_uris_required',
        'redirect_uris_too_many',
        'redirect_uris_duplicate',
        'scopes_required',
        'scopes_not_held',
      ],
      'apps.developers.webhooks.reason': [
        'url_invalid',
        'url_scheme',
        'url_credentials',
        'url_private_host',
        'app_not_automation',
        'app_not_connected',
      ],
      'settings.pat.reason': ['scopes_required', 'scopes_not_held'],
      'playbook.bulk.reason': [
        'csv_file_too_large',
        'csv_too_many_rows',
        'csv_cell_too_long',
        'csv_unclosed_quote',
        'csv_text_after_closing_quote',
        'csv_header_missing',
        'csv_too_many_website_rows',
        'ai_agent_not_found',
      ],
      'playbook.editor.stepProblem': [
        'steps_not_array',
        'step_not_object',
        'unknown_step_type',
        'detect_intent_needs_intent',
        'detect_intent_bad_phrases',
        'request_info_needs_field',
        'request_info_needs_prompt',
        'tag_needs_tag',
        'send_message_bad_source',
        'send_message_needs_text',
        'transfer_to_team_needs_team',
      ],
    };
    const missing: string[] = [];
    for (const [prefix, reasons] of Object.entries(CODES)) {
      for (const reason of reasons) {
        for (const locale of ['en', 'tr'] as const) {
          if (!hasMessage(locale, `${prefix}.${reason}`))
            missing.push(`${locale}:${prefix}.${reason}`);
        }
      }
    }
    expect(missing).toEqual([]);
  });
});

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
