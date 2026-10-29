import { describe, expect, it } from 'vitest';
import { canTakeOver, ledTeamIds } from './takeover.js';

const TEAMS = [
  { id: 7, name: 'Sales', agents: [{ agent_id: 'lead-1', lead: true }, { agent_id: 'a-2' }] },
  { id: 8, name: 'Support', agents: [{ agent_id: 'lead-1', lead: false }] },
  { id: 9, name: 'VIP', agents: [{ agent_id: 'lead-2', lead: true }] },
];

describe('ledTeamIds', () => {
  it('names the teams the person leads, not the ones they are only in', () => {
    expect(ledTeamIds(TEAMS, 'lead-1')).toEqual([7]);
    expect(ledTeamIds(TEAMS, 'a-2')).toEqual([]);
    expect(ledTeamIds(TEAMS, null)).toEqual([]);
  });
});

describe('canTakeOver — the question ChatService.takeover asks (RL-03)', () => {
  const lead = { role: 'team_lead', accountId: 'lead-1' };

  it('`team`: a chat any of whose teams the caller leads', () => {
    const caller = { ...lead, capabilities: { 'chats.takeover': 'team' } };
    expect(canTakeOver(caller, [7], TEAMS)).toBe(true);
    expect(canTakeOver(caller, [8, 7], TEAMS)).toBe(true);
    expect(canTakeOver(caller, [8], TEAMS)).toBe(false);
    expect(canTakeOver(caller, [9], TEAMS)).toBe(false);
    expect(canTakeOver(caller, [], TEAMS)).toBe(false);
  });

  it('`all` reaches every chat, `none` none, whatever the role', () => {
    expect(canTakeOver({ ...lead, capabilities: { 'chats.takeover': 'all' } }, [9], TEAMS)).toBe(
      true,
    );
    expect(
      canTakeOver(
        { role: 'admin', accountId: 'x', capabilities: { 'chats.takeover': 'none' } },
        [7],
        TEAMS,
      ),
    ).toBe(false);
  });

  it('falls back to the administrator role on a server without the capability', () => {
    expect(canTakeOver({ role: 'admin', accountId: 'x' }, [], [])).toBe(true);
    expect(canTakeOver({ role: 'team_lead', accountId: 'lead-1' }, [7], TEAMS)).toBe(false);
    expect(canTakeOver({ role: null, accountId: null }, [7], TEAMS)).toBe(false);
  });
});
