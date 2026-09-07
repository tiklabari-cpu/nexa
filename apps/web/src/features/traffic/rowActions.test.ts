import { describe, expect, it } from 'vitest';
import { visitorRowActions, type RowActionContext, type RowActionId } from './rowActions.js';
import type { TrafficActivity } from './types.js';

const FULL: RowActionContext = { canChatWrite: true, canChatRead: true, canEditCustomer: true };

/** The enabled action ids for a visitor in a given state, with full permissions. */
function enabledFor(activity: TrafficActivity, chatId: string | null): RowActionId[] {
  return visitorRowActions({ activity, chat_id: chatId }, FULL)
    .filter((a) => a.enabled)
    .map((a) => a.id);
}

describe('visitorRowActions', () => {
  it('always offers the same five actions, in a stable order', () => {
    const ids = visitorRowActions({ activity: 'browsing', chat_id: null }, FULL).map((a) => a.id);
    expect(ids).toEqual(['start_chat', 'supervise', 'assign_to_me', 'view_profile', 'edit']);
  });

  describe('by visitor state', () => {
    it('offers only Start chat (and View profile / Edit) to a browsing visitor', () => {
      // Nobody to supervise or take over — there is no conversation yet.
      expect(enabledFor('browsing', null)).toEqual(['start_chat', 'view_profile', 'edit']);
    });

    it.each<[TrafficActivity]>([['queued'], ['waiting'], ['chatting']])(
      'offers Supervise and Assign — not Start — to a %s visitor',
      (activity) => {
        expect(enabledFor(activity, 'CHAT12345678')).toEqual([
          'supervise',
          'assign_to_me',
          'view_profile',
          'edit',
        ]);
      },
    );
  });

  describe('by permission', () => {
    it('disables Start and Assign without chat write', () => {
      const ctx: RowActionContext = { ...FULL, canChatWrite: false };
      const browsing = visitorRowActions({ activity: 'browsing', chat_id: null }, ctx);
      const chatting = visitorRowActions({ activity: 'chatting', chat_id: 'CHAT12345678' }, ctx);

      expect(browsing.find((a) => a.id === 'start_chat')?.enabled).toBe(false);
      expect(chatting.find((a) => a.id === 'assign_to_me')?.enabled).toBe(false);
      // Supervising is a read, so it survives losing write.
      expect(chatting.find((a) => a.id === 'supervise')?.enabled).toBe(true);
    });

    it('disables Supervise without chat read', () => {
      const ctx: RowActionContext = { ...FULL, canChatRead: false };
      const chatting = visitorRowActions({ activity: 'chatting', chat_id: 'CHAT12345678' }, ctx);
      expect(chatting.find((a) => a.id === 'supervise')?.enabled).toBe(false);
    });

    it('gates Edit on the customers write scope', () => {
      const ctx: RowActionContext = { ...FULL, canEditCustomer: false };
      const actions = visitorRowActions({ activity: 'browsing', chat_id: null }, ctx);
      expect(actions.find((a) => a.id === 'edit')?.enabled).toBe(false);
    });

    it('View profile stays enabled with no scopes at all — the panel withholds PII itself (FR-MOD-13.2)', () => {
      const ctx: RowActionContext = {
        canChatWrite: false,
        canChatRead: false,
        canEditCustomer: false,
      };
      const actions = visitorRowActions({ activity: 'browsing', chat_id: null }, ctx);
      expect(actions.find((a) => a.id === 'view_profile')?.enabled).toBe(true);
    });
  });

  describe('releasing a watch (FR-MOD-02.1.1, tm 213)', () => {
    it('offers Stop supervising instead of Supervise once the caller is watching', () => {
      const ids = visitorRowActions(
        { activity: 'chatting', chat_id: 'CHAT12345678', is_supervising: true },
        FULL,
      ).map((a) => a.id);
      // Same five slots — Stop supervising occupies Supervise's, not a sixth.
      expect(ids).toEqual(['start_chat', 'unsupervise', 'assign_to_me', 'view_profile', 'edit']);
    });

    it('Stop supervising is a read, so it survives losing write, same as Supervise', () => {
      const ctx: RowActionContext = { ...FULL, canChatWrite: false };
      const actions = visitorRowActions(
        { activity: 'chatting', chat_id: 'CHAT12345678', is_supervising: true },
        ctx,
      );
      expect(actions.find((a) => a.id === 'unsupervise')?.enabled).toBe(true);
    });

    it('disables Stop supervising without chat read, same as Supervise', () => {
      const ctx: RowActionContext = { ...FULL, canChatRead: false };
      const actions = visitorRowActions(
        { activity: 'chatting', chat_id: 'CHAT12345678', is_supervising: true },
        ctx,
      );
      expect(actions.find((a) => a.id === 'unsupervise')?.enabled).toBe(false);
    });

    it('a visitor with no chat cannot be "supervising" even if the flag is stale', () => {
      // Defensive: a chat closing (chat_id -> null) must not leave a dangling
      // Stop supervising button with nothing left to release.
      const ids = visitorRowActions(
        { activity: 'browsing', chat_id: null, is_supervising: true },
        FULL,
      ).map((a) => a.id);
      expect(ids).toContain('supervise');
      expect(ids).not.toContain('unsupervise');
    });
  });
});
