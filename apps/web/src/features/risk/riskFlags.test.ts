/**
 * What the risk-flag screens decide without drawing anything (AI-27 · tm 302.3):
 * which flags a conversation shows and in what order, who gets a Clear button,
 * and which words a refusal is shown in.
 */
import { describe, expect, it } from 'vitest';
import { RISK_FLAG_ALREADY_CLEARED_REASON, RISK_FLAG_CLEAR_ROLE_REASON } from '@siyahtus/types';
import { ApiClientError } from '../../lib/api-client.js';
import { flag } from '../../test/risk-flags.js';
import {
  activeFlagsOf,
  firstBadEmail,
  flaggableTypes,
  isFromEarlierChat,
  mayClear,
  parseEmailList,
  policyKeys,
  riskFlagErrorKey,
} from './riskFlags.js';

const refusal = (type: ApiClientError['type'], status: number, reason: string) =>
  new ApiClientError({
    type,
    status,
    message: 'refused',
    requestId: 'req-1',
    details: { reason },
  });

describe('activeFlagsOf (AI-27)', () => {
  it('lists urgent flags before high before info, newest first within a severity', () => {
    const list = activeFlagsOf(
      [
        flag({ id: 'a', severity: 'info', type: 'abusive' }),
        flag({ id: 'b', severity: 'urgent', type: 'self_harm' }),
        flag({ id: 'c', severity: 'high', raised_at: '2026-10-19T09:00:00.000Z' }),
        flag({ id: 'd', severity: 'high', raised_at: '2026-10-19T11:00:00.000Z' }),
      ],
      [],
    );
    expect(list.map((f) => f.id)).toEqual(['b', 'd', 'c', 'a']);
  });

  it("leaves out cleared flags — history is not the conversation's state", () => {
    const list = activeFlagsOf(
      [flag({ id: 'a', status: 'cleared' }), flag({ id: 'b', type: 'abusive' })],
      [flag({ id: 'c', scope: 'member', status: 'cleared', type: 'rg_signal' })],
    );
    expect(list.map((f) => f.id)).toEqual(['b']);
  });

  it("adds the player's member flags from an earlier conversation, once", () => {
    const own = flag({ id: 'm', scope: 'member', type: 'rg_signal', severity: 'high' });
    const earlier = flag({
      id: 'e',
      scope: 'member',
      type: 'self_exclusion_request',
      severity: 'urgent',
      chat_id: 'YESTERDAY',
    });
    const list = activeFlagsOf([own], [own, earlier]);
    expect(list.map((f) => f.id)).toEqual(['e', 'm']);
    expect(isFromEarlierChat(earlier, 'CHAT1')).toBe(true);
    expect(isFromEarlierChat(own, 'CHAT1')).toBe(false);
  });

  it("does not borrow another conversation's chat-scope flag through the player", () => {
    const list = activeFlagsOf([], [flag({ id: 'x', scope: 'chat', chat_id: 'OTHER' })]);
    expect(list).toEqual([]);
  });
});

describe('flaggableTypes (AI-27)', () => {
  it('offers every type except those the conversation already carries', () => {
    const types = flaggableTypes([flag({ type: 'complaint_formal' })], 'CHAT1');
    expect(types).not.toContain('complaint_formal');
    expect(types).toContain('rg_signal');
    expect(types).toHaveLength(9);
  });

  it("still offers a type only the player's earlier conversation carries", () => {
    const earlier = flag({ scope: 'member', type: 'rg_signal', chat_id: 'YESTERDAY' });
    expect(flaggableTypes([earlier], 'CHAT1')).toContain('rg_signal');
  });
});

describe('mayClear (AI-27-S2)', () => {
  it.each([
    ['agent', false],
    ['admin', true],
    ['viceowner', true],
    ['owner', true],
  ] as const)('%s clears a responsible-gaming flag: %s', (role, allowed) => {
    expect(mayClear({ type: 'rg_signal' }, role)).toBe(allowed);
  });

  it('is false for a role it does not know, and for no role', () => {
    expect(mayClear({ type: 'abusive' }, 'intern')).toBe(false);
    expect(mayClear({ type: 'abusive' }, null)).toBe(false);
  });
});

describe('policyKeys', () => {
  it('names what a responsible-gaming flag does, and nothing for a plain one', () => {
    expect(policyKeys('self_exclusion_request')).toEqual([
      'inbox.risk.policy.mustHandoff',
      'inbox.risk.policy.noBonusTalk',
      'inbox.risk.policy.noPromotions',
    ]);
    expect(policyKeys('abusive')).toEqual([]);
  });
});

describe('riskFlagErrorKey', () => {
  it('words a clear below the type’s clearer, and a second clear, apart', () => {
    expect(riskFlagErrorKey(refusal('authorization', 403, RISK_FLAG_CLEAR_ROLE_REASON))).toBe(
      'inbox.risk.error.clearRole',
    );
    expect(riskFlagErrorKey(refusal('not_allowed', 403, RISK_FLAG_ALREADY_CLEARED_REASON))).toBe(
      'inbox.risk.error.alreadyCleared',
    );
  });

  it('falls back to the sentence for the error type', () => {
    expect(riskFlagErrorKey(refusal('authorization', 403, 'something_else'))).toBe(
      'common.errors.authorization',
    );
    expect(riskFlagErrorKey(new Error('boom'))).toBe('common.errors.unknown');
  });
});

describe('the notify-address list', () => {
  it('splits on commas, spaces and lines, lower-cases, and drops repeats', () => {
    expect(parseEmailList('A@x.com, b@x.com;\n a@X.com  ')).toEqual(['a@x.com', 'b@x.com']);
    expect(parseEmailList('  ')).toEqual([]);
  });

  it('names the first address that cannot be one', () => {
    expect(firstBadEmail(['a@x.com', 'nope', 'b@x'])).toBe('nope');
    expect(firstBadEmail(['a@x.com'])).toBeNull();
    expect(firstBadEmail([])).toBeNull();
  });
});
