/**
 * The billing and usage surface (tm 389.12) for `fake-platform.ts`: a page of subscriptions,
 * one statement, a credit, the plans and packages, the deployment's usage, one workspace's AI
 * caps — and the writes with the server's rules in miniature, enough to see the SPA react. The
 * real rules have their own suite (`platform-billing-usage.test.ts`).
 */
import { platformRoleHas, type PlatformRole } from '@siyahtus/types';

const NOW = '2026-10-25T10:00:00.000Z';

export const INVOICE_ID = '00000000-0000-4000-8000-0000000000c1';
export const USAGE_LICENSE_ID = '42';

type Json = (status: number, body: unknown) => Response;
type Problem = (
  status: number,
  type: string,
  message?: string,
  details?: Record<string, unknown>,
) => Response;

export interface FakeBillingState {
  credits: Array<Record<string, unknown>>;
  override: { llm: number | null; embedding: number | null; expires_at: string | null };
  planCaps: Record<string, { llm: number | null; embedding: number | null }>;
}

export function initialBillingState(): FakeBillingState {
  return {
    credits: [
      {
        id: '00000000-0000-4000-8000-0000000000d1',
        license_id: '42',
        organization_name: 'Acme Gaming',
        amount_minor: 2_500,
        currency: 'USD',
        reason: 'Outage on 3 October',
        admin_email: 'ops@example.com',
        invoice_id: null,
        invoice_number: null,
        invoice_period: null,
        remainder_of: null,
        created_at: NOW,
      },
    ],
    override: { llm: null, embedding: null, expires_at: null },
    planCaps: {},
  };
}

function subscription(id: string, name: string, status: string): Record<string, unknown> {
  return {
    license_id: id,
    organization_name: name,
    license_status: status,
    plan: 'growth',
    status,
    billing_cycle: 'monthly',
    seats: 3,
    unit_price_cents: 9_900,
    current_period_end: '2026-11-25T00:00:00.000Z',
    cancel_at_period_end: false,
    created_at: NOW,
  };
}

const DEPLOYMENT = { llm: 200_000, embedding: 2_000_000 };

function layers(
  meter: 'llm' | 'embedding',
  override: number | null,
  plan: number | null,
): Record<string, unknown> {
  const deployment = DEPLOYMENT[meter];
  return {
    effective: override ?? plan ?? deployment,
    source: override !== null ? 'override' : plan !== null ? 'plan' : 'deployment',
    override,
    plan,
    deployment,
  };
}

function series(days: number): Array<Record<string, unknown>> {
  return Array.from({ length: days }, (_, index) => {
    const at = new Date(Date.UTC(2026, 9, 25) - (days - 1 - index) * 86_400_000);
    return { date: at.toISOString().slice(0, 10), llm: index * 1_000, embedding: index * 10 };
  });
}

function workspaceUsage(state: FakeBillingState): Record<string, unknown> {
  const plan = state.planCaps['growth'] ?? { llm: null, embedding: null };
  const llm = layers('llm', state.override.llm, plan.llm);
  const embedding = layers('embedding', state.override.embedding, plan.embedding);
  const counter = (used: number, cap: number) => ({ used, reserved: 0, cap });
  return {
    license_id: USAGE_LICENSE_ID,
    organization_name: 'Acme Gaming',
    plan: 'growth',
    caps: {
      llm,
      embedding,
      expires_at: state.override.expires_at,
      in_force: state.override.llm !== null || state.override.embedding !== null,
    },
    today: {
      llm: counter(150_000, llm['effective'] as number),
      embedding: counter(4_000, embedding['effective'] as number),
      llm_test: counter(0, Math.floor((llm['effective'] as number) / 5)),
      embedding_test: counter(0, Math.floor((embedding['effective'] as number) / 5)),
    },
    series: series(30),
  };
}

function planCaps(state: FakeBillingState): Record<string, unknown> {
  return {
    plans: ['growth', 'enterprise'].map((plan) => ({
      plan,
      set: state.planCaps[plan] ?? { llm: null, embedding: null },
      catalogue: { llm: null, embedding: null },
    })),
    deployment: DEPLOYMENT,
    updated_at: null,
  };
}

/** The billing and usage answers, or null for a path this surface does not own. */
export function handleBilling(
  method: string,
  path: string,
  body: unknown,
  search: URLSearchParams,
  role: PlatformRole,
  state: FakeBillingState,
  workspace: () => Record<string, unknown>,
  json: Json,
  problem: Problem,
): Response | null {
  const input = (body ?? {}) as Record<string, unknown>;
  const write = (permission: string): Response | null => {
    if (!platformRoleHas(role, permission)) return problem(403, 'not_allowed');
    const reason = typeof input['reason'] === 'string' ? input['reason'].trim() : '';
    if (reason.length < 3) return problem(400, 'validation', 'A reason is required.');
    return null;
  };

  if (method === 'GET' && path === '/billing/plans') {
    return json(200, {
      data: [
        {
          id: 'growth',
          pricing: 'listed',
          unit_price_cents: 9_900,
          ai_resolutions_included: 200,
          entitlements: [],
          ai_daily_tokens: state.planCaps['growth'] ?? { llm: null, embedding: null },
          workspaces: 9,
        },
        {
          id: 'enterprise',
          pricing: 'quoted',
          unit_price_cents: null,
          ai_resolutions_included: null,
          entitlements: ['sso'],
          ai_daily_tokens: { llm: null, embedding: null },
          workspaces: 1,
        },
      ],
    });
  }

  if (method === 'GET' && path === '/billing/subscriptions') {
    if (search.get('cursor') === 'page-2') {
      return json(200, {
        data: [subscription('9', 'Beta Casino', 'past_due')],
        next_cursor: null,
      });
    }
    if (search.get('past_due') === 'true') {
      return json(200, { data: [subscription('9', 'Beta Casino', 'past_due')], next_cursor: null });
    }
    return json(200, {
      data: [subscription('42', 'Acme Gaming', 'active')],
      next_cursor: 'page-2',
    });
  }

  if (method === 'GET' && path === '/billing/invoices') {
    return json(200, {
      data: [
        {
          id: INVOICE_ID,
          license_id: '42',
          organization_name: 'Acme Gaming',
          number: 'SIYAHTUS-202609',
          period: '202609',
          origin: 'issued',
          status: 'paid',
          currency: 'usd',
          subtotal_cents: 29_700,
          credit_cents: 2_500,
          total_cents: 27_200,
          issued_at: '2026-09-30T00:00:00.000Z',
        },
      ],
      next_cursor: null,
    });
  }

  if (method === 'GET' && path === `/billing/invoices/${INVOICE_ID}/download`) {
    return new Response('item,amount_cents\nTotal,27200\n', {
      status: 200,
      headers: { 'content-type': 'text/csv' },
    });
  }

  if (method === 'GET' && path === '/billing/packages') {
    return json(200, {
      period: '202610',
      api_packages: [
        {
          id: 'essential',
          name: 'Essential',
          api_calls: 100_000,
          price_cents: 2_999,
          sold: { count: 2, revenue_cents: 5_998 },
        },
      ],
      ai_resolution_pack: {
        resolutions_per_pack: 50,
        pack_price_cents: 2_500,
        max_packs: 20,
        sold: { count: 3, revenue_cents: 7_500 },
      },
    });
  }

  if (method === 'GET' && path === '/billing/revenue') {
    return json(200, {
      months: [
        {
          period: '202608',
          currency: 'usd',
          invoices: 3,
          subtotal_cents: 59_400,
          credit_cents: 0,
          total_cents: 59_400,
        },
        {
          period: '202609',
          currency: 'usd',
          invoices: 4,
          subtotal_cents: 89_100,
          credit_cents: 2_500,
          total_cents: 86_600,
        },
      ],
      open_period: { period: '202610', package_purchases_cents: 13_498 },
      open_credits: [{ currency: 'USD', amount_minor: 2_500, credits: 1 }],
    });
  }

  if (method === 'GET' && path === '/billing/credits') {
    const rows =
      search.get('open') === 'true'
        ? state.credits.filter((row) => row['invoice_id'] === null)
        : state.credits;
    return json(200, { data: rows, next_cursor: null });
  }

  if (method === 'POST' && path === '/billing/credits') {
    const refused = write('billing.manage');
    if (refused) return refused;
    if (input['license_id'] !== '42') return problem(404, 'not_found', 'Workspace not found.');
    const credit = {
      ...(state.credits[0] as Record<string, unknown>),
      id: `00000000-0000-4000-8000-0000000000d${state.credits.length + 1}`,
      amount_minor: input['amount_minor'],
      reason: input['reason'],
    };
    state.credits.unshift(credit);
    return json(201, { credit });
  }

  if (method === 'POST' && path === '/billing/manual-subscription') {
    const refused = write('billing.manage');
    if (refused) return refused;
    if (input['license_id'] !== '42') return problem(404, 'not_found', 'Workspace not found.');
    if (typeof input['period_end'] !== 'string' || input['period_end'] < NOW) {
      return problem(400, 'validation', 'period_end must be in the future.', {
        reason: 'period_end_past',
      });
    }
    return json(200, { unchanged: false, workspace: workspace() });
  }

  if (method === 'GET' && path === '/usage/global') {
    return json(200, {
      days: Number(search.get('days') ?? 30),
      series: series(Number(search.get('days') ?? 30)),
      today: {
        llm: { used: 900_000, reserved: 1_200, cap: 2_000_000 },
        embedding: { used: 40_000, reserved: 0, cap: 20_000_000 },
      },
      period: { period: '202610', ai_resolutions: 340, api_calls: 15_200 },
    });
  }

  if (method === 'GET' && path === '/usage/workspaces') {
    const meter = search.get('meter') ?? 'llm';
    const tokens = meter === 'llm' || meter === 'embedding';
    return json(200, {
      meter,
      window: tokens ? '2026-10-25' : '202610',
      data: [
        {
          license_id: USAGE_LICENSE_ID,
          organization_name: 'Acme Gaming',
          plan: 'growth',
          used: tokens ? 150_000 : 300,
          limit: tokens ? 200_000 : 200,
          percent: tokens ? 75 : 150,
        },
      ],
    });
  }

  if (method === 'GET' && path === `/usage/workspaces/${USAGE_LICENSE_ID}`) {
    return json(200, workspaceUsage(state));
  }

  if (method === 'PUT' && path === `/usage/workspaces/${USAGE_LICENSE_ID}/ai-caps`) {
    const refused = write('usage.manage');
    if (refused) return refused;
    const next = {
      llm: (input['llm_daily_tokens_cap'] as number | null) ?? null,
      embedding: (input['embedding_daily_tokens_cap'] as number | null) ?? null,
      expires_at: (input['expires_at'] as string | null) ?? null,
    };
    if (next.expires_at !== null && next.expires_at < NOW) {
      return problem(400, 'validation', 'expires_at must be in the future.', {
        reason: 'expires_at_past',
      });
    }
    const unchanged = JSON.stringify(next) === JSON.stringify(state.override);
    state.override = next;
    return json(200, { unchanged, usage: workspaceUsage(state) });
  }

  if (method === 'GET' && path === '/settings/ai-caps') return json(200, planCaps(state));

  if (method === 'PUT' && path === '/settings/ai-caps') {
    const refused = write('usage.manage');
    if (refused) return refused;
    const plans = (input['plans'] ?? {}) as FakeBillingState['planCaps'];
    const unchanged = JSON.stringify(plans) === JSON.stringify(state.planCaps);
    state.planCaps = plans;
    return json(200, { unchanged, caps: planCaps(state) });
  }

  return null;
}
