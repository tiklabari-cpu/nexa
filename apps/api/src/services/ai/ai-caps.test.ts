/**
 * Which daily AI caps apply to a workspace (tm 283.2) — what needs no
 * database: `override ?? plan ?? deployment` per meter, the test meters'
 * share, a stored BIGINT read as a cap, and the resolver's minute-long cache
 * with its invalidation. The licence row, the plan and the counter itself are
 * driven through Postgres in `test/integration/ai-tenant-caps.test.ts`.
 */
import { describe, expect, it } from 'vitest';
import type { TenantContext } from '../../lib/tenant.js';
import { aiDailyTokensForPlan, PLAN_IDS } from '../billing/subscription-service.js';
import { capsChangeTarget } from './ai-caps-events.js';
import {
  AI_CAPS_TTL_MS,
  AiCapResolver,
  resolveAiCaps,
  storedCap,
  testCap,
  type AiDailyCaps,
  type WorkspaceCapInputs,
} from './ai-caps.js';

const DEPLOYMENT: AiDailyCaps = {
  llm: { workspace: 200_000, global: 2_000_000 },
  embedding: { workspace: 2_000_000, global: 20_000_000 },
};

const INHERIT: WorkspaceCapInputs = {
  override: { llm: null, embedding: null },
  plan: { llm: null, embedding: null },
};

const tenant = (id: bigint): TenantContext => ({
  licenseId: id,
  organizationId: `00000000-0000-4000-8000-${String(id).padStart(12, '0')}`,
});

describe('resolveAiCaps', () => {
  it('inherits the deployment’s per-workspace default when neither licence nor plan says', () => {
    expect(resolveAiCaps(INHERIT, DEPLOYMENT)).toEqual({
      workspace: {
        llm: 200_000,
        embedding: 2_000_000,
        llm_test: 40_000,
        embedding_test: 400_000,
      },
      global: { llm: 2_000_000, embedding: 20_000_000 },
    });
  });

  it('takes the licence’s override over the plan’s, and the plan’s over the deployment’s — per meter', () => {
    const planOnly = resolveAiCaps(
      { override: { llm: null, embedding: null }, plan: { llm: 300_000, embedding: null } },
      DEPLOYMENT,
    );
    expect(planOnly.workspace.llm).toBe(300_000);
    expect(planOnly.workspace.embedding).toBe(2_000_000);

    const both = resolveAiCaps(
      { override: { llm: 500_000, embedding: null }, plan: { llm: 300_000, embedding: 9 } },
      DEPLOYMENT,
    );
    expect(both.workspace.llm).toBe(500_000);
    expect(both.workspace.embedding).toBe(9);
  });

  it('gives a simulation a fifth of whatever the live allowance resolved to', () => {
    const caps = resolveAiCaps(
      { override: { llm: 500_000, embedding: 7 }, plan: { llm: null, embedding: null } },
      DEPLOYMENT,
    );
    expect(caps.workspace.llm_test).toBe(100_000);
    // Never zero: a cap of 0 would refuse even an empty call.
    expect(caps.workspace.embedding_test).toBe(1);
  });

  it('leaves the deployment’s own cap to the deployment, whatever a workspace is allowed', () => {
    const caps = resolveAiCaps(
      {
        override: { llm: 9_000_000, embedding: 90_000_000 },
        plan: { llm: null, embedding: null },
      },
      DEPLOYMENT,
    );
    expect(caps.global).toEqual({ llm: 2_000_000, embedding: 20_000_000 });
  });
});

describe('testCap', () => {
  it('is 20% rounded down, at least one token', () => {
    expect(testCap(200_000)).toBe(40_000);
    expect(testCap(9)).toBe(1);
    expect(testCap(1)).toBe(1);
    expect(testCap(12)).toBe(2);
  });
});

describe('storedCap', () => {
  it('reads null as inherit and a BIGINT as a number the counter can take', () => {
    expect(storedCap(null)).toBeNull();
    expect(storedCap(undefined)).toBeNull();
    expect(storedCap(500_000n)).toBe(500_000);
    expect(storedCap(9_223_372_036_854_775_807n)).toBe(Number.MAX_SAFE_INTEGER);
  });
});

describe('the plan layer', () => {
  it('leaves both plans to inherit today, and gives an unknown plan nothing of its own', () => {
    for (const plan of PLAN_IDS) {
      expect(aiDailyTokensForPlan(plan), plan).toEqual({ llm: null, embedding: null });
    }
    expect(aiDailyTokensForPlan('platinum')).toEqual({ llm: null, embedding: null });
    expect(aiDailyTokensForPlan(null)).toEqual({ llm: null, embedding: null });
  });
});

/** A resolver over a scripted store and a hand-moved clock. */
function harness() {
  let clock = 1_000_000;
  const stored = new Map<string, WorkspaceCapInputs>();
  const loads: string[] = [];
  let deploymentReads = 0;
  let gate: Promise<void> | null = null;
  const resolver = new AiCapResolver({
    load: async (t) => {
      loads.push(t.licenseId.toString());
      const value = stored.get(t.licenseId.toString()) ?? INHERIT;
      if (gate) await gate;
      return value;
    },
    deployment: () => {
      deploymentReads += 1;
      return DEPLOYMENT;
    },
    now: () => clock,
    maxEntries: 2,
  });
  return {
    resolver,
    loads,
    stored,
    deploymentReads: () => deploymentReads,
    tick: (ms: number) => {
      clock += ms;
    },
    hold: () => {
      let open!: () => void;
      gate = new Promise((resolve) => {
        open = resolve;
      });
      return () => {
        gate = null;
        open();
      };
    },
  };
}

const override = (llm: number): WorkspaceCapInputs => ({
  override: { llm, embedding: null },
  plan: { llm: null, embedding: null },
});

describe('AiCapResolver', () => {
  it('reads a workspace once a minute, and again once the minute is up', async () => {
    const h = harness();
    h.stored.set('1', override(500_000));
    expect((await h.resolver.capsFor(tenant(1n))).workspace.llm).toBe(500_000);

    h.stored.set('1', override(600_000));
    h.tick(AI_CAPS_TTL_MS - 1);
    expect((await h.resolver.capsFor(tenant(1n))).workspace.llm).toBe(500_000);
    expect(h.loads).toEqual(['1']);

    h.tick(1);
    expect((await h.resolver.capsFor(tenant(1n))).workspace.llm).toBe(600_000);
    expect(h.loads).toEqual(['1', '1']);
    expect(h.deploymentReads()).toBe(2);
  });

  it('forgets one workspace on its own announcement, and every workspace on `*`', async () => {
    const h = harness();
    await h.resolver.capsFor(tenant(1n));
    await h.resolver.capsFor(tenant(2n));
    h.stored.set('1', override(700_000));

    h.resolver.invalidate(1n);
    expect((await h.resolver.capsFor(tenant(1n))).workspace.llm).toBe(700_000);
    await h.resolver.capsFor(tenant(2n));
    expect(h.loads).toEqual(['1', '2', '1']);

    h.resolver.invalidate();
    await h.resolver.capsFor(tenant(1n));
    await h.resolver.capsFor(tenant(2n));
    expect(h.loads).toEqual(['1', '2', '1', '1', '2']);
  });

  it('does not cache a read an announcement overtook — it may predate the change', async () => {
    const h = harness();
    const release = h.hold();
    const inFlight = h.resolver.capsFor(tenant(1n));
    // The platform commits a new cap and announces it while the read above is
    // still out; what that read saw may be the old value.
    h.stored.set('1', override(800_000));
    h.resolver.invalidate(1n);
    release();
    expect((await inFlight).workspace.llm).toBe(200_000);

    expect((await h.resolver.capsFor(tenant(1n))).workspace.llm).toBe(800_000);
    expect(h.loads).toEqual(['1', '1']);
  });

  it('keeps at most `maxEntries` workspaces, dropping the oldest first', async () => {
    const h = harness();
    await h.resolver.capsFor(tenant(1n));
    await h.resolver.capsFor(tenant(2n));
    await h.resolver.capsFor(tenant(3n));
    await h.resolver.capsFor(tenant(3n));
    await h.resolver.capsFor(tenant(2n));
    expect(h.loads).toEqual(['1', '2', '3']);
    await h.resolver.capsFor(tenant(1n));
    expect(h.loads).toEqual(['1', '2', '3', '1']);
  });
});

describe('capsChangeTarget', () => {
  it('names one licence by its id, and every workspace for `*` or anything it cannot read', () => {
    expect(capsChangeTarget('42')).toBe(42n);
    expect(capsChangeTarget('*')).toBeUndefined();
    expect(capsChangeTarget('')).toBeUndefined();
    expect(capsChangeTarget('0')).toBeUndefined();
    expect(capsChangeTarget('12abc')).toBeUndefined();
    expect(capsChangeTarget('99999999999999999999')).toBeUndefined();
  });
});
