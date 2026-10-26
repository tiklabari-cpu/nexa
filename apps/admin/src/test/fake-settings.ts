/**
 * The settings surface (tm 389.13) for `fake-platform.ts`: the stored deployment settings, the
 * two writes with the server's gates in miniature (permission, reason, a fresh code for
 * maintenance), and a published effective configuration. The real rules have their own suite
 * (`platform-settings.test.ts`).
 */
import { platformRoleHas, type PlatformRole } from '@siyahtus/types';

type Problem = (
  status: number,
  type: string,
  message?: string,
  details?: Record<string, unknown>,
) => Response;
type Json = (status: number, body: unknown) => Response;

export interface FakeSettingsState {
  settings: {
    signup_enabled: boolean | null;
    trial_days: number | null;
    announcement: Record<string, unknown> | null;
    maintenance: Record<string, unknown> | null;
    updated_at: string | null;
  };
  /** Whether the session's last code is older than five minutes. */
  totpStale: boolean;
  /** `null`: the tenant API has not published (`stale: true`, no entries). */
  config: 'fresh' | 'missing';
}

export function initialSettingsState(): FakeSettingsState {
  return {
    settings: {
      signup_enabled: null,
      trial_days: null,
      announcement: null,
      maintenance: null,
      updated_at: null,
    },
    totpStale: false,
    config: 'fresh',
  };
}

export const EFFECTIVE_CONFIG = {
  stale: false,
  generated_at: '2026-10-25T09:59:40.000Z',
  age_s: 20,
  entries: [
    { key: 'APPS_LIVE_PROVIDERS', value: 'telegram', source: 'env', redacted: false, panel: false },
    {
      key: 'DATABASE_URL',
      value: 'postgresql://db:5432/siyahtus',
      source: 'env',
      redacted: false,
      panel: false,
    },
    { key: 'LLM_API_KEY', value: 'set', source: 'env', redacted: true, panel: false },
    { key: 'LOG_LEVEL', value: 'info', source: 'default', redacted: false, panel: false },
    { key: 'PILOT_MODE', value: 'false', source: 'default', redacted: false, panel: false },
    { key: 'SIGNUP_ENABLED', value: 'true', source: 'default', redacted: false, panel: true },
    { key: 'TRIAL_DAYS', value: '7', source: 'db', redacted: false, panel: true },
    {
      key: 'TURNSTILE_SECRET_KEY',
      value: 'unset',
      source: 'default',
      redacted: true,
      panel: false,
    },
  ],
};

const NOW = '2026-10-25T10:00:00.000Z';

export function handleSettings(
  method: string,
  path: string,
  body: unknown,
  role: PlatformRole,
  state: FakeSettingsState,
  json: Json,
  problem: Problem,
): Response | null {
  if (method === 'GET' && path === '/settings') {
    if (!platformRoleHas(role, 'settings.read')) return problem(403, 'authorization');
    return json(200, state.settings);
  }

  if (method === 'GET' && path === '/settings/effective-config') {
    if (!platformRoleHas(role, 'settings.read')) return problem(403, 'authorization');
    return json(
      200,
      state.config === 'fresh'
        ? EFFECTIVE_CONFIG
        : { stale: true, generated_at: null, age_s: null, entries: [] },
    );
  }

  const write =
    (method === 'PATCH' && path === '/settings') ||
    (method === 'PUT' && path === '/settings/maintenance');
  if (!write) return null;

  if (!platformRoleHas(role, 'settings.manage')) return problem(403, 'authorization');
  const input = (body ?? {}) as Record<string, unknown>;
  const reason = typeof input['reason'] === 'string' ? input['reason'].trim() : '';
  if (reason.length < 3) return problem(400, 'platform_reason_required');

  if (method === 'PUT') {
    if (state.totpStale) return problem(403, 'platform_recent_totp_required');
    state.settings = {
      ...state.settings,
      maintenance: {
        enabled: input['enabled'],
        mode: input['mode'],
        message: input['message'] ?? null,
      },
      updated_at: NOW,
    };
    return json(200, state.settings);
  }

  const next = { ...state.settings, updated_at: NOW };
  for (const key of ['signup_enabled', 'trial_days', 'announcement'] as const) {
    if (key in input) (next as Record<string, unknown>)[key] = input[key];
  }
  state.settings = next;
  return json(200, state.settings);
}
