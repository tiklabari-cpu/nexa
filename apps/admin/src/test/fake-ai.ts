/**
 * The AI catalogues (tm 389.19) for `fake-platform.ts`: fixed catalogues, a crisis-text draft map
 * that replaces the way the server does (a reason on every write, who may write, a refused text),
 * and a template-install list long enough to page. The real rules have their own suite
 * (`platform-ai-catalogs.test.ts`); here the question is what the SPA does with the answers.
 */
import { platformRoleHas, type CrisisTextDrafts, type PlatformRole } from '@siyahtus/types';

export interface FakeAiState {
  drafts: CrisisTextDrafts;
  version: number;
  /** Installs per page, so a test can reach "Load more" with a few rows. */
  installsPageSize: number;
  tools: 'not_installed' | 'available';
}

export function initialAiState(): FakeAiState {
  return {
    drafts: { TR: { en: 'Please call 183.', tr: 'Lütfen 183’ü arayın.' } },
    version: 3,
    installsPageSize: 25,
    tools: 'not_installed',
  };
}

const GUARDRAILS = {
  version: '2026-10-19.1',
  count: 2,
  items: [
    {
      id: 'G1',
      title: { tr: 'Kendini dışlama', en: 'Self-exclusion' },
      prompt: {
        tr: 'Hesap kapatma isteğinde teklif sunma.',
        en: 'Offer nothing to a closing request.',
      },
      category: 'responsible_gaming',
      action: 'force_handoff',
      target: 'responsible_gaming',
      priority: 'urgent',
      handoff_reason: 'self_exclusion',
      risk_flag: 'self_exclusion',
      applies_when: 'always',
      tenant_text: null,
      lexicon_alone: true,
      stages: ['input'],
      input_patterns: { tr: 5, en: 3 },
      output_patterns: { tr: 0, en: 0 },
    },
    {
      id: 'G7',
      title: { tr: 'Garanti verme', en: 'No guarantees' },
      prompt: { tr: 'Garanti ya da süre sözü verme.', en: 'Promise no outcome or time.' },
      category: 'promises',
      action: 'block_output',
      target: null,
      priority: 'normal',
      handoff_reason: null,
      risk_flag: null,
      applies_when: 'always',
      tenant_text: null,
      lexicon_alone: false,
      stages: ['output'],
      input_patterns: { tr: 0, en: 0 },
      output_patterns: { tr: 4, en: 2 },
    },
  ],
};

const TEMPLATES = {
  pack: {
    key: 'igaming_core',
    version: '0.1.0',
    industry: 'igaming',
    lang: 'tr',
    template_count: 2,
  },
  items: [
    {
      key: 'deposit_not_credited',
      name: 'Yatırım hesaba geçmedi',
      version: 1,
      locked: false,
      scenario_count: 3,
      tenant_must_fill_count: 4,
    },
    {
      key: 'self_exclusion',
      name: 'Kendini dışlama',
      version: 1,
      locked: true,
      scenario_count: 3,
      tenant_must_fill_count: 1,
    },
  ],
};

const INSTALLS = Array.from({ length: 30 }, (_, index) => ({
  license_id: String(1_000_001 + index),
  workspace_name: `Casino ${index + 1}`,
  installed: 30 - index,
  active: index === 0 ? 3 : 0,
  outdated: 0,
}));

const COMPLIANCE = {
  version: '2026-10-21.1',
  size: 14,
  items: [
    { key: 'compliance:G1:tr', guardrail: 'G1', language: 'tr' },
    { key: 'compliance:G1:en', guardrail: 'G1', language: 'en' },
  ],
};

const RUBRIC = {
  status: 'available',
  version: '2026-10-27.1',
  scale: { min: 1, max: 5 },
  items: [
    { key: 'topic', handoff_only: false },
    { key: 'handoff_timing', handoff_only: true },
  ],
};

export const AI_SUMMARY = {
  ai_agents: { total: 2, active: 1 },
  guidance_rules: { status: 'available', total: 6, active: 4 },
  config_changes: { status: 'not_installed', last_30_days: 0 },
  guardrail_hits: {
    status: 'available',
    last_30_days: 7,
    by_rule: { G3: 4, G7: 2, workspace_rule: 1 },
  },
  qa: { status: 'not_installed', reviewed_30_days: 0, awaiting_review: 0 },
  compliance_pack: {
    status: 'available',
    last_run: {
      version: '2026-10-21.1',
      run_status: 'passed',
      passed: 14,
      failed: 0,
      finished_at: '2026-10-26T10:00:00.000Z',
    },
  },
};

type Json = (status: number, body: unknown) => Response;
type Problem = (
  status: number,
  type: string,
  message?: string,
  details?: Record<string, unknown>,
) => Response;

export function handleAiCatalogs(
  method: string,
  path: string,
  body: unknown,
  search: URLSearchParams,
  role: PlatformRole,
  state: FakeAiState,
  json: Json,
  problem: Problem,
): Response | null {
  if (!path.startsWith('/ai-catalogs/')) return null;

  if (method === 'GET') {
    if (!platformRoleHas(role, 'ai.read')) return problem(403, 'authorization');
    switch (path) {
      case '/ai-catalogs/guardrails':
        return json(200, GUARDRAILS);
      case '/ai-catalogs/templates':
        return json(200, TEMPLATES);
      case '/ai-catalogs/templates/installs': {
        const cursor = Number(search.get('cursor') ?? '0');
        const page = INSTALLS.slice(cursor, cursor + state.installsPageSize);
        const more = cursor + state.installsPageSize < INSTALLS.length;
        return json(200, {
          data: page,
          next_cursor: more ? String(cursor + state.installsPageSize) : null,
        });
      }
      case '/ai-catalogs/compliance-pack':
        return json(200, COMPLIANCE);
      case '/ai-catalogs/qa-rubric':
        return json(200, RUBRIC);
      case '/ai-catalogs/tools':
        return json(
          200,
          state.tools === 'not_installed'
            ? { status: 'not_installed', version: null, items: [] }
            : { status: 'available', version: '1', items: [{ key: 'check_deposit' }] },
        );
      case '/ai-catalogs/crisis-text-drafts':
        return json(200, {
          drafts: state.drafts,
          version: state.version,
          updated_at: state.version > 0 ? '2026-10-26T09:00:00.000Z' : null,
          max_length: 1000,
        });
      default:
        return null;
    }
  }

  if (method === 'PUT' && path === '/ai-catalogs/crisis-text-drafts') {
    if (!platformRoleHas(role, 'ai.manage')) return problem(403, 'authorization');
    const request = body as { reason?: string; drafts?: CrisisTextDrafts };
    if (!request.reason || request.reason.trim().length < 3) {
      return problem(400, 'platform_reason_required');
    }
    for (const [country, texts] of Object.entries(request.drafts ?? {})) {
      if (!/^[A-Z]{2}$/.test(country)) return problem(400, 'validation', `drafts.${country}`);
      for (const text of Object.values(texts)) {
        if (/<\/?[a-z!][^>]*>/i.test(text ?? '')) {
          return problem(400, 'validation', `drafts.${country}: plain text only: no HTML`);
        }
      }
    }
    if (JSON.stringify(request.drafts) !== JSON.stringify(state.drafts)) {
      state.drafts = structuredClone(request.drafts ?? {});
      state.version += 1;
    }
    return json(200, {
      drafts: state.drafts,
      version: state.version,
      updated_at: '2026-10-27T09:00:00.000Z',
      max_length: 1000,
    });
  }

  return null;
}
