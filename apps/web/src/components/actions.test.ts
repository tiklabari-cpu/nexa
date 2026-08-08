/**
 * The action catalogue's own shape and the `PaletteResult` union it feeds —
 * the palette's rendering/wiring behaviour is `CommandPalette.test.tsx`'s job,
 * unchanged by this refactor and asserted as a regression at the bottom.
 */
import { describe, expect, it } from 'vitest';
import { ACTIONS, type ActionDeps, type PaletteResult } from './actions.js';

const acceptingDeps: ActionDeps = {
  agent: { routing_status: 'accepting_chats' },
  applyRoutingStatus: () => {},
  setRoutingStatus: async () => {},
};

const notAcceptingDeps: ActionDeps = {
  agent: { routing_status: 'not_accepting_chats' },
  applyRoutingStatus: () => {},
  setRoutingStatus: async () => {},
};

/**
 * A stand-in for the store the palette hands over: `applied` is the local
 * snapshot the optimistic guess writes to, `requested` the wire calls. Keeping
 * them apart is what lets a test see a guess that was written and then taken
 * back — a single combined log cannot tell rollback from never having tried.
 */
function trackedDeps(
  status: 'accepting_chats' | 'not_accepting_chats' | 'offline',
  setRoutingStatus: ActionDeps['setRoutingStatus'] = async () => {},
): ActionDeps & { applied: string[]; requested: string[] } {
  const applied: string[] = [];
  const requested: string[] = [];
  return {
    agent: { routing_status: status },
    applied,
    requested,
    applyRoutingStatus: (next) => {
      applied.push(next);
    },
    setRoutingStatus: async (next) => {
      requested.push(next);
      await setRoutingStatus(next);
    },
  };
}

describe('action catalogue', () => {
  it('has every field filled in for every record', () => {
    expect(ACTIONS.length).toBeGreaterThan(0);
    for (const action of ACTIONS) {
      expect(action.id.length).toBeGreaterThan(0);
      expect(action.label(acceptingDeps).length).toBeGreaterThan(0);
      expect(action.keywords.length).toBeGreaterThan(0);
      expect(action.requiredScope.length).toBeGreaterThan(0);
      expect(typeof action.run).toBe('function');
    }
  });

  it('matches "stop accepting" to the toggle-accepting-chats record', () => {
    const needle = 'stop accepting';
    const found = ACTIONS.find((action) => action.keywords.some((k) => k.includes(needle)));
    expect(found?.id).toBe('toggle-accepting-chats');
  });

  // The other half of this pair lives in the API suite: `route-config.test.ts`
  // pins the route's own `config.scopes` to the same literal, so a change on
  // either side breaks a test instead of quietly leaving the palette gating by
  // a list the endpoint no longer uses.
  it('requires the same scopes as the endpoint it calls (PUT /agents/me/routing-status)', () => {
    const toggle = ACTIONS.find((action) => action.id === 'toggle-accepting-chats');
    expect(toggle?.requiredScope).toEqual(['agents--my:rw', 'agents--all:rw']);
  });

  it("labels itself by the caller's current routing status", () => {
    const toggle = ACTIONS.find((action) => action.id === 'toggle-accepting-chats')!;
    expect(toggle.label(acceptingDeps)).toBe('Stop Accepting Chats');
    expect(toggle.label(notAcceptingDeps)).toBe('Start Accepting Chats');
    expect(toggle.label({ ...acceptingDeps, agent: null })).toBe('Start Accepting Chats');
  });

  it('flips to the opposite status when run', async () => {
    const toggle = ACTIONS.find((action) => action.id === 'toggle-accepting-chats')!;

    const off = trackedDeps('accepting_chats');
    await toggle.run(off);
    expect(off.requested).toEqual(['not_accepting_chats']);

    const on = trackedDeps('not_accepting_chats');
    await toggle.run(on);
    expect(on.requested).toEqual(['accepting_chats']);
  });
});

/**
 * The optimistic contract (FR-EK-A.2).
 *
 * The negatives come first because they are the ones that matter: an action
 * whose request fails has already moved the screen, and a rollback that never
 * runs leaves the agent believing they stopped taking chats while the router
 * keeps sending them work.
 */
describe('toggle-accepting-chats — optimistic result and rollback', () => {
  const toggle = ACTIONS.find((action) => action.id === 'toggle-accepting-chats')!;

  it('puts the previous status back when the request fails, and rethrows', async () => {
    const deps = trackedDeps('accepting_chats', async () => {
      throw new Error('Request failed with status 500.');
    });

    await expect(toggle.run(deps)).rejects.toThrow('Request failed with status 500.');

    // Guessed, then undone — and undone to exactly what was there before, not
    // to a default that happens to look right in this one direction.
    expect(deps.applied).toEqual(['not_accepting_chats', 'accepting_chats']);
  });

  it('rolls back a refused toggle in the other direction too', async () => {
    const deps = trackedDeps('not_accepting_chats', async () => {
      throw new Error('insufficient_scope');
    });

    await expect(toggle.run(deps)).rejects.toThrow('insufficient_scope');
    expect(deps.applied).toEqual(['accepting_chats', 'not_accepting_chats']);
  });

  it('shows the new status before the request is even sent', async () => {
    const seen: string[] = [];
    const deps = trackedDeps('accepting_chats', async () => {
      // By the time the request runs, the optimistic write must already have
      // landed — that ordering is the whole point of calling it optimistic.
      seen.push(...deps.applied);
    });

    await toggle.run(deps);
    expect(seen).toEqual(['not_accepting_chats']);
  });

  it('keeps the optimistic value when the request succeeds', async () => {
    const deps = trackedDeps('accepting_chats');

    await toggle.run(deps);

    expect(deps.applied).toEqual(['not_accepting_chats']);
    expect(deps.requested).toEqual(['not_accepting_chats']);
  });
});

describe('PaletteResult union', () => {
  it('accepts all four result kinds', () => {
    const results: PaletteResult[] = [
      {
        kind: 'nav',
        id: 'route:/app/inbox',
        group: 'Go to',
        label: 'Inbox',
        icon: '▤',
        run: () => {},
      },
      {
        kind: 'content',
        id: 'customer:c-1',
        group: 'Customers',
        label: 'Mira Haddad',
        sub: 'mira@acme-customer.localhost',
        icon: '◫',
        run: () => {},
      },
      {
        kind: 'action',
        id: 'action:toggle-accepting-chats',
        group: 'Actions',
        label: 'Stop Accepting Chats',
        icon: '⏻',
        run: () => {},
      },
      {
        kind: 'ai',
        id: 'ai:ask',
        group: 'Ask AI',
        label: "Summarize my team's activity",
        icon: '✦',
        run: () => {},
      },
    ];

    expect(results.map((r) => r.kind)).toEqual(['nav', 'content', 'action', 'ai']);
    for (const result of results) {
      expect(result.id.length).toBeGreaterThan(0);
      expect(result.label.length).toBeGreaterThan(0);
    }
  });
});
