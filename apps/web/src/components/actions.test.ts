/**
 * The action catalogue's own shape and the `PaletteResult` union it feeds —
 * the palette's rendering/wiring behaviour is `CommandPalette.test.tsx`'s job,
 * unchanged by this refactor and asserted as a regression at the bottom.
 */
import { describe, expect, it } from 'vitest';
import { ACTIONS, type ActionDeps, type PaletteResult } from './actions.js';

const acceptingDeps: ActionDeps = {
  agent: { routing_status: 'accepting_chats' },
  setRoutingStatus: async () => {},
};

const notAcceptingDeps: ActionDeps = {
  agent: { routing_status: 'not_accepting_chats' },
  setRoutingStatus: async () => {},
};

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

  it('requires the same scopes as the endpoint it calls (PUT /agents/me/routing-status)', () => {
    const toggle = ACTIONS.find((action) => action.id === 'toggle-accepting-chats');
    expect(toggle?.requiredScope).toEqual(['agents--my:rw', 'agents--all:rw']);
  });

  it("labels itself by the caller's current routing status", () => {
    const toggle = ACTIONS.find((action) => action.id === 'toggle-accepting-chats')!;
    expect(toggle.label(acceptingDeps)).toBe('Stop Accepting Chats');
    expect(toggle.label(notAcceptingDeps)).toBe('Start Accepting Chats');
    expect(toggle.label({ agent: null, setRoutingStatus: acceptingDeps.setRoutingStatus })).toBe(
      'Start Accepting Chats',
    );
  });

  it('flips to the opposite status when run', async () => {
    const calls: string[] = [];
    const toggle = ACTIONS.find((action) => action.id === 'toggle-accepting-chats')!;

    await toggle.run({
      agent: { routing_status: 'accepting_chats' },
      setRoutingStatus: async (status) => {
        calls.push(status);
      },
    });
    expect(calls).toEqual(['not_accepting_chats']);

    await toggle.run({
      agent: { routing_status: 'not_accepting_chats' },
      setRoutingStatus: async (status) => {
        calls.push(status);
      },
    });
    expect(calls).toEqual(['not_accepting_chats', 'accepting_chats']);
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
