/**
 * Event detection and reply picking for event-bound suggestions (IN-07 · tm 364).
 * Pure functions, so every rule is a table row rather than a rendered composer.
 */
import { describe, expect, it } from 'vitest';
import {
  detectActiveEvents,
  idleDueAt,
  pickEventReplies,
  type DetectInput,
  type EventReply,
  type EventTurn,
} from './eventSuggestions.js';
import { withCopilotDraft, withEventChips, type ReplyChip } from './replySuggestions.js';

const ME = 'agent-me';
const T0 = Date.parse('2026-10-01T10:00:00.000Z');

function turn(partial: Partial<EventTurn> & Pick<EventTurn, 'id'>, minutes = 0): EventTurn {
  return {
    type: 'message',
    author_type: 'customer',
    recipients: 'all',
    created_at: new Date(T0 + minutes * 60_000).toISOString(),
    properties: {},
    ...partial,
  };
}

const customer = (id: string, minutes = 0): EventTurn => turn({ id }, minutes);
const agent = (id: string, minutes = 0): EventTurn => turn({ id, author_type: 'agent' }, minutes);
const note = (id: string, minutes = 0): EventTurn =>
  turn({ id, author_type: 'agent', recipients: 'agents' }, minutes);
const transfer = (id: string, agentId: string | null, minutes = 0): EventTurn =>
  turn(
    {
      id,
      type: 'system_message',
      author_type: 'system',
      properties: {
        system_event: 'chat_transferred',
        ...(agentId ? { agent_id: agentId } : { group_id: 7 }),
      },
    },
    minutes,
  );

function detect(turns: EventTurn[], extra: Partial<DetectInput> = {}) {
  return detectActiveEvents({
    agentId: ME,
    assigneeId: ME,
    turns,
    active: true,
    idleSeconds: 180,
    now: T0 + 60 * 60_000,
    rating: null,
    ...extra,
  });
}

const names = (turns: EventTurn[], extra: Partial<DetectInput> = {}) =>
  detect(turns, extra).map((e) => e.event);

describe('detectActiveEvents — chat_started (IN-07)', () => {
  it('is active when the player wrote and no person has answered', () => {
    expect(detect([customer('m1')])).toEqual([{ event: 'chat_started', key: 'started:m1' }]);
  });

  it('is not active once an agent has written to the player', () => {
    expect(names([customer('m1'), agent('a1', 1)])).not.toContain('chat_started');
  });

  it('is still active when the only agent line is an internal note', () => {
    expect(names([customer('m1'), note('n1', 1)])).toContain('chat_started');
  });

  it('a bot greeting is not an agent having started', () => {
    const bot = turn({ id: 'b1', author_type: 'bot' }, 1);
    expect(names([customer('m1'), bot])).toContain('chat_started');
  });

  it('is not active before the player has said anything', () => {
    expect(names([])).toEqual([]);
  });

  it('is never active on a chat that cannot be answered', () => {
    expect(names([customer('m1')], { active: false })).toEqual([]);
  });
});

describe('detectActiveEvents — chat_transferred (IN-07)', () => {
  it('is active when the newest hand-over names this agent', () => {
    expect(names([customer('m1'), transfer('s1', ME, 1)])).toContain('chat_transferred');
  });

  it('is not active when the hand-over names someone else', () => {
    expect(names([customer('m1'), transfer('s1', 'other', 1)])).not.toContain('chat_transferred');
  });

  it('a hand-over to a team counts when the connection is this agent’s', () => {
    expect(names([customer('m1'), transfer('s1', null, 1)])).toContain('chat_transferred');
    expect(names([customer('m1'), transfer('s1', null, 1)], { assigneeId: 'other' })).not.toContain(
      'chat_transferred',
    );
  });

  it('is not active once somebody has written after the hand-over', () => {
    expect(names([customer('m1'), transfer('s1', ME, 1), agent('a1', 2)])).not.toContain(
      'chat_transferred',
    );
  });

  it('only the newest hand-over counts', () => {
    const events = [customer('m1'), transfer('s1', ME, 1), transfer('s2', 'other', 2)];
    expect(names(events)).not.toContain('chat_transferred');
    expect(
      detect([customer('m1'), transfer('s1', 'other', 1), transfer('s2', ME, 2)]),
    ).toContainEqual({
      event: 'chat_transferred',
      key: 'transferred:s2',
    });
  });
});

describe('detectActiveEvents — customer_idle (IN-07)', () => {
  it('is active when the agent spoke last and the silence has lasted the threshold', () => {
    const turns = [customer('m1'), agent('a1', 1)];
    expect(detect(turns, { now: T0 + 60_000 + 180_000 })).toContainEqual({
      event: 'customer_idle',
      key: 'idle:a1',
    });
  });

  it('is not active a second before the threshold', () => {
    const turns = [customer('m1'), agent('a1', 1)];
    expect(names(turns, { now: T0 + 60_000 + 179_000 })).not.toContain('customer_idle');
  });

  it('is not active when the player spoke last', () => {
    expect(names([agent('a1'), customer('m2', 1)])).not.toContain('customer_idle');
  });

  it('an internal note does not restart the silence or end it', () => {
    const turns = [customer('m1'), agent('a1', 1), note('n1', 50)];
    expect(names(turns)).toContain('customer_idle');
  });

  it('uses the workspace’s own threshold', () => {
    const turns = [customer('m1'), agent('a1', 1)];
    expect(names(turns, { now: T0 + 60_000 + 30_000, idleSeconds: 30 })).toContain('customer_idle');
  });

  it('idleDueAt says when, or null when the player spoke last', () => {
    expect(idleDueAt([customer('m1'), agent('a1', 1)], 180)).toBe(T0 + 60_000 + 180_000);
    expect(idleDueAt([agent('a1'), customer('m1', 1)], 180)).toBeNull();
    expect(idleDueAt([], 180)).toBeNull();
  });
});

describe('detectActiveEvents — rated (IN-07)', () => {
  it('maps the vote to its event with the vote’s own key', () => {
    const turns = [customer('m1'), agent('a1', 1)];
    expect(detect(turns, { now: T0, rating: { value: 'good', key: 'rated:t1:x' } })).toEqual([
      { event: 'rated_good', key: 'rated:t1:x' },
    ]);
    expect(detect(turns, { now: T0, rating: { value: 'bad', key: 'rated:t1:y' } })).toContainEqual({
      event: 'rated_bad',
      key: 'rated:t1:y',
    });
  });
});

describe('detectActiveEvents — order', () => {
  it('lists a verdict, then the quiet, then the hand-over, then the start', () => {
    // A hand-over to me answered by nobody, with an earlier agent line making the player quiet.
    const turns = [customer('m1'), transfer('s1', ME, 1)];
    expect(names(turns, { rating: { value: 'good', key: 'k' } })).toEqual([
      'rated_good',
      'chat_transferred',
      'chat_started',
    ]);
  });
});

function reply(
  id: string,
  on: EventReply['suggest_on'],
  extra: Partial<EventReply> = {},
): EventReply {
  return { id, shortcut: id, text: `Text ${id}`, suggest_on: on, ...extra };
}

const STARTED = { event: 'chat_started' as const, key: 'k1' };
const TRANSFERRED = { event: 'chat_transferred' as const, key: 'k2' };

describe('pickEventReplies (IN-07)', () => {
  it('keeps only replies bound to an active event', () => {
    const picks = pickEventReplies(
      [reply('a', ['chat_started']), reply('b', ['customer_idle']), reply('c', [])],
      [STARTED],
      { promoSuppressed: false },
    );
    expect(picks.map((p) => p.reply.id)).toEqual(['a']);
  });

  it('orders by the active event, then suggest_order, then shortcut', () => {
    const picks = pickEventReplies(
      [
        reply('z', ['chat_started'], { suggest_order: 1 }),
        reply('b', ['chat_started'], { suggest_order: 1 }),
        reply('t', ['chat_transferred'], { suggest_order: 0 }),
        reply('a', ['chat_started'], { suggest_order: 0 }),
      ],
      [TRANSFERRED, STARTED],
      { promoSuppressed: false },
    );
    expect(picks.map((p) => p.reply.id)).toEqual(['t', 'a', 'b', 'z']);
  });

  it('lists a reply bound to two active events once, under the first', () => {
    const picks = pickEventReplies(
      [reply('a', ['chat_started', 'chat_transferred'])],
      [TRANSFERRED, STARTED],
      {
        promoSuppressed: false,
      },
    );
    expect(picks).toHaveLength(1);
    expect(picks[0]!.event.event).toBe('chat_transferred');
  });

  it('never picks more than four', () => {
    const many = ['a', 'b', 'c', 'd', 'e', 'f'].map((id) => reply(id, ['chat_started']));
    expect(pickEventReplies(many, [STARTED], { promoSuppressed: false })).toHaveLength(4);
  });

  it('leaves a promotion reply out for a player kept from promotions — and only that one', () => {
    const replies = [
      reply('promo', ['chat_started'], { category: 'promotion' }),
      reply('plain', ['chat_started'], { category: 'general' }),
      reply('legacy', ['chat_started']),
    ];
    expect(
      pickEventReplies(replies, [STARTED], { promoSuppressed: true }).map((p) => p.reply.id),
    ).toEqual(['legacy', 'plain']);
    expect(
      pickEventReplies(replies, [STARTED], { promoSuppressed: false }).map((p) => p.reply.id),
    ).toEqual(['legacy', 'plain', 'promo']);
  });
});

describe('the order of a row: event, then Copilot, then template (IN-07)', () => {
  const eventChip: ReplyChip = { text: 'E', source: 'event', event: 'chat_started' };
  const templates: ReplyChip[] = ['T1', 'T2', 'T3', 'T4'].map((text) => ({
    text,
    source: 'template' as const,
  }));

  it('puts event chips first and holds the row to four', () => {
    expect(withEventChips(templates, [eventChip]).map((c) => c.text)).toEqual([
      'E',
      'T1',
      'T2',
      'T3',
    ]);
  });

  it('drops a template that repeats an event chip', () => {
    const dup: ReplyChip = { text: 'T2', source: 'event', event: 'chat_started' };
    expect(withEventChips(templates, [dup]).map((c) => c.text)).toEqual(['T2', 'T1', 'T3', 'T4']);
  });

  it('Copilot’s draft lands after the event chips and before the templates', () => {
    const row = withEventChips(templates, [eventChip]);
    expect(withCopilotDraft(row, 'C').map((c) => c.text)).toEqual(['E', 'C', 'T1', 'T2']);
  });
});
