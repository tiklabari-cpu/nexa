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
  /** The AI settings (tm 389.17): what `GET /settings/ai` answers; keys only as last4. */
  ai: Record<string, unknown> & {
    llm: Record<string, unknown> | null;
    embedding: Record<string, unknown> | null;
    reembed: Record<string, unknown>;
  };
  /** What the next connection test answers. */
  aiTest: { ok: boolean; error: string | null };
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
    ai: {
      llm: null,
      embedding: null,
      caps: null,
      prices: null,
      source: { llm: 'env', embedding: 'env' },
      reembed: { ...IDLE_REEMBED },
      updated_at: null,
    },
    aiTest: { ok: true, error: null },
  };
}

export const IDLE_REEMBED = {
  state: 'idle',
  started_at: null,
  finished_at: null,
  target: null,
  sources: 0,
  chunks: 0,
  failed: 0,
  refused: 0,
  capped: false,
};

/** A stored part as the server would keep it: the key reduced to its last four characters. */
function storedPart(
  input: Record<string, unknown> | null | undefined,
  before: Record<string, unknown> | null,
  embedding: boolean,
): Record<string, unknown> | null {
  if (!input) return null;
  const key = input['api_key'];
  const last4 =
    key === undefined
      ? (before?.['api_key_last4'] ?? null)
      : typeof key === 'string'
        ? key.slice(-4)
        : null;
  const part: Record<string, unknown> = {
    provider: input['provider'],
    base_url: input['base_url'] ?? null,
    model: input['model'] ?? null,
    region: input['region'] ?? null,
    api_key_last4: last4,
  };
  if (embedding) part['dimensions'] = 1536;
  else {
    part['model_fast'] = input['model_fast'] ?? null;
    part['timeout_ms'] = input['timeout_ms'] ?? null;
    part['max_output_tokens'] = input['max_output_tokens'] ?? null;
  }
  return part;
}

function handleAi(
  method: string,
  path: string,
  input: Record<string, unknown>,
  role: PlatformRole,
  state: FakeSettingsState,
  json: Json,
  problem: Problem,
): Response | null {
  if (method === 'GET' && path === '/settings/ai') {
    if (!platformRoleHas(role, 'ai.read')) return problem(403, 'authorization');
    return json(200, state.ai);
  }
  const routes: Record<string, 'ai.manage' | 'operations.run'> = {
    'PUT /settings/ai': 'ai.manage',
    'POST /settings/ai/test-connection': 'ai.manage',
    'POST /settings/ai/reembed': 'operations.run',
  };
  const permission = routes[`${method} ${path}`];
  if (!permission) return null;
  if (!platformRoleHas(role, permission)) return problem(403, 'authorization');
  const reason = typeof input['reason'] === 'string' ? input['reason'].trim() : '';
  if (reason.length < 3) return problem(400, 'platform_reason_required');

  if (path === '/settings/ai/test-connection') {
    const target = input['target'] === 'embedding' ? 'embedding' : 'llm';
    const part = state.ai[target];
    return json(200, {
      target,
      provider: part?.['provider'] ?? 'mock',
      source: part ? 'db' : 'env',
      model: part?.['model'] ?? null,
      ok: state.aiTest.ok,
      latency_ms: 42,
      error: state.aiTest.error,
    });
  }
  if (path === '/settings/ai/reembed') {
    if (state.ai.reembed['state'] === 'running') return problem(409, 'platform_operation_running');
    state.ai.reembed = { ...IDLE_REEMBED, state: 'running', started_at: NOW, target: 'openai:m' };
    return json(202, state.ai.reembed);
  }

  if (state.totpStale) return problem(403, 'platform_recent_totp_required');
  const before = state.ai;
  const next = { ...before, updated_at: NOW } as FakeSettingsState['ai'];
  if ('llm' in input)
    next.llm = storedPart(input['llm'] as Record<string, unknown> | null, before.llm, false);
  if ('embedding' in input) {
    next.embedding = storedPart(
      input['embedding'] as Record<string, unknown> | null,
      before.embedding,
      true,
    );
  }
  if ('caps' in input) next['caps'] = input['caps'];
  if ('prices' in input) next['prices'] = input['prices'];
  next['source'] = { llm: next.llm ? 'db' : 'env', embedding: next.embedding ? 'db' : 'env' };
  state.ai = next;
  const moved =
    (before.embedding?.['model'] ?? null) !== (next.embedding?.['model'] ?? null) ||
    (before.embedding?.['provider'] ?? null) !== (next.embedding?.['provider'] ?? null);
  return json(200, moved ? { ...next, warning: 'reembed_required' } : next);
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
  const ai = handleAi(
    method,
    path,
    (body ?? {}) as Record<string, unknown>,
    role,
    state,
    json,
    problem,
  );
  if (ai) return ai;

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
