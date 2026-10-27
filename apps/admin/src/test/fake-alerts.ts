/**
 * The operator's alert preferences (tm 389.20) for `fake-platform.ts`: the default per role until a
 * choice is saved, then the saved one, with the closed list of kinds enforced. The real rules have
 * their own suite (`platform-alerts.test.ts`); here the question is what the SPA does with the
 * answers.
 */
import { PLATFORM_ALERT_KINDS, type PlatformRole } from '@siyahtus/types';

export interface FakeAlertPrefsState {
  /** `null`: never saved. */
  saved: { kinds: string[]; locale: 'en' | 'tr' } | null;
}

export function initialAlertPrefsState(): FakeAlertPrefsState {
  return { saved: null };
}

type Json = (status: number, body: unknown) => Response;
type Problem = (status: number, type: string, message?: string) => Response;

function view(role: PlatformRole, state: FakeAlertPrefsState): Record<string, unknown> {
  return {
    kinds: state.saved?.kinds ?? (role === 'superadmin' ? [...PLATFORM_ALERT_KINDS] : []),
    locale: state.saved?.locale ?? 'en',
    customized: state.saved !== null,
    available: [...PLATFORM_ALERT_KINDS],
  };
}

export function handleAlertPrefs(
  method: string,
  path: string,
  body: unknown,
  role: PlatformRole,
  state: FakeAlertPrefsState,
  json: Json,
  problem: Problem,
): Response | null {
  if (path !== '/auth/me/alert-prefs') return null;
  if (method === 'GET') return json(200, view(role, state));
  if (method === 'PUT') {
    const input = body as { kinds?: unknown; locale?: unknown };
    const known = (kind: string): boolean =>
      (PLATFORM_ALERT_KINDS as readonly string[]).includes(kind);
    if (
      !Array.isArray(input.kinds) ||
      !input.kinds.every((kind) => typeof kind === 'string' && known(kind)) ||
      (input.locale !== 'en' && input.locale !== 'tr')
    ) {
      return problem(400, 'validation', 'Invalid request.');
    }
    const kinds = input.kinds as string[];
    state.saved = {
      kinds: PLATFORM_ALERT_KINDS.filter((kind) => kinds.includes(kind)),
      locale: input.locale,
    };
    return json(200, view(role, state));
  }
  return null;
}
