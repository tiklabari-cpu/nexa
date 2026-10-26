/**
 * The tenant API's effective configuration, for the root panel (tm 389.13 ·
 * FR-ADMIN-16).
 *
 * The platform process never reads the tenant API's environment — it may run
 * in another container with another `.env` (design.md §A) — so the tenant
 * API's scheduler leader says what it runs with, beside the health snapshot
 * (`health-publisher.ts`): every key of its environment schema, as parsed,
 * under `siyahtus:ops:config` with the same 90-second expiry.
 *
 * What leaves this process is held to two rules, because the screen it ends
 * up on is exactly what somebody screenshots into a support chat:
 *
 * - **A secret is only `set` or `unset`.** Any key with a `SECRET`, `KEY`,
 *   `PASSWORD`, `PASS`, `TOKEN` or `CREDENTIAL` word in its name — a wider net
 *   than `SECRET_KEYS`, which lists only the signing keys — unless the name
 *   ends in a lifetime or a rate (`ACCESS_TOKEN_TTL`, `RATE_LIMIT_TOKEN_PER_MIN`);
 *   `…_TOKENS` limits are not caught at all. A public value it does catch
 *   (`TURNSTILE_SITE_KEY`) loses nothing worth keeping: its presence is what
 *   the panel shows.
 * - **A URL keeps no credentials.** The user name and password go, and so
 *   does the value of any query parameter whose name holds one of those words
 *   (`DATABASE_URL`, `REDIS_URL`, an SMTP or OTLP address).
 *
 * Each key also says where its value came from: the root panel's row (`db`,
 * only `SIGNUP_ENABLED` and `TRIAL_DAYS` have one), the environment (`env`)
 * or the schema's default (`default`).
 */
import type { EffectiveConfigSource } from '@siyahtus/types';
import { envSchema, type Env } from '../../config/env.js';
import type { ResolvedPublicSettings } from '../platform/public-settings.js';

/** Same expiry as the health snapshot: with the leader gone, nothing renews it. */
export const OPS_CONFIG_TTL_S = 90;

const SECRET_WORD = /(^|_)(SECRET|KEY|PASSWORD|PASS|TOKEN|CREDENTIAL)(_|$)/;
/** A lifetime or a rate named after what it limits, not a secret. */
const LIMIT_NAME = /(_TTL|_PER_[A-Z]+)$/;
/** Query parameters are anyone's spelling (`sslpassword`, `api_key`): a substring will do. */
const SECRET_PARAM = /secret|key|pass|token|credential|sig/i;

/** The keys the root panel's `PATCH /settings` can override. */
export const PANEL_KEYS: ReadonlySet<string> = new Set(['SIGNUP_ENABLED', 'TRIAL_DAYS']);

export interface EffectiveConfigEntry {
  key: string;
  value: string | null;
  source: EffectiveConfigSource;
  redacted: boolean;
  panel: boolean;
}

export interface StoredEffectiveConfig {
  /** ISO-8601, the publisher's clock. */
  generated_at: string;
  entries: EffectiveConfigEntry[];
}

/** Whether a key's value is a secret by its name. Exported for its unit test. */
export function isSecretKey(key: string): boolean {
  return SECRET_WORD.test(key) && !LIMIT_NAME.test(key);
}

/** `value` with no user name, password or secret-named query value, if it is a URL. */
export function stripUrlCredentials(value: string): string {
  if (!/^[a-z][a-z0-9+.-]*:\/\//i.test(value)) return value;
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    // Looks like a URL and is not one: say nothing of what it holds.
    return '[unparsed]';
  }
  url.username = '';
  url.password = '';
  for (const name of [...url.searchParams.keys()]) {
    if (SECRET_PARAM.test(name)) url.searchParams.set(name, 'redacted');
  }
  return url.toString();
}

function render(value: unknown): string | null {
  if (value === undefined || value === null) return null;
  if (Array.isArray(value)) return value.map((item) => render(item) ?? '').join(',');
  if (typeof value === 'string') {
    // A list of addresses (`WEB_ORIGIN`) is cleaned one address at a time.
    return value.includes('://')
      ? value
          .split(',')
          .map((part) => stripUrlCredentials(part.trim()))
          .join(',')
      : value;
  }
  if (typeof value === 'boolean' || typeof value === 'number' || typeof value === 'bigint') {
    return String(value);
  }
  // Nothing in the schema parses to an object today; one that does is not
  // printed until somebody decides what of it is safe to show.
  return '[object]';
}

function present(value: unknown): boolean {
  if (value === undefined || value === null) return false;
  if (typeof value === 'string') return value !== '';
  if (Array.isArray(value)) return value.length > 0;
  return true;
}

/** Every key of the environment schema, alphabetically, redacted and sourced. */
export function buildEffectiveConfig(
  env: Env,
  settings: Pick<
    ResolvedPublicSettings,
    'signupEnabled' | 'signupEnabledSource' | 'trialDays' | 'trialDaysSource'
  >,
): EffectiveConfigEntry[] {
  const parsed = env as unknown as Record<string, unknown>;
  return Object.keys(envSchema.shape)
    .sort()
    .map((key): EffectiveConfigEntry => {
      const panel = PANEL_KEYS.has(key);
      if (key === 'SIGNUP_ENABLED') {
        return {
          key,
          value: String(settings.signupEnabled),
          source: settings.signupEnabledSource,
          redacted: false,
          panel,
        };
      }
      if (key === 'TRIAL_DAYS') {
        return {
          key,
          value: String(settings.trialDays),
          source: settings.trialDaysSource,
          redacted: false,
          panel,
        };
      }
      const source: EffectiveConfigSource = env.explicitKeys.includes(key) ? 'env' : 'default';
      const value = parsed[key];
      if (isSecretKey(key)) {
        return { key, value: present(value) ? 'set' : 'unset', source, redacted: true, panel };
      }
      return { key, value: render(value), source, redacted: false, panel };
    });
}
