/**
 * Same-day memory, the parts without a database (tm 294 · SiyahTuş analysis
 * AI-02; K4, K5): the summary a turn writes, the cut a visitor's identity
 * makes before any prompt exists, when the AI brings the earlier topic up and
 * in which words, the slots it carries and the detail it must not volunteer.
 * The day's reads and the close are `test/integration/ai-daily-memory.test.ts`.
 */
import { describe, expect, it } from 'vitest';
import { DAILY_DIGEST_EXCERPT_MAX, DEFAULT_DAILY_MEMORY, readDailyMemory } from '@siyahtus/types';
import {
  buildDigest,
  earlierTodayLines,
  forTrust,
  isRepeatSameDay,
  recallLine,
  recallTarget,
  repeatsEarlierDetail,
  slotKnown,
  withEarlierToday,
  type EarlierToday,
} from './daily-memory.js';
import { readStoredDigest, type DailyDigest } from '../../chat/ai-digest.js';
import { emptyTurnState, type TurnState } from './turn.js';

const PAPARA = 'skill-papara';

function digest(overrides: Partial<DailyDigest> = {}): DailyDigest {
  return {
    connection: { chat_id: 'CHAT1', thread_id: 'THREAD1' },
    started_at: '2026-10-17T09:12:00.000Z',
    ended_at: '2026-10-17T09:31:00.000Z',
    procedure_key: PAPARA,
    procedure_name: 'Papara deposit',
    intent_label: 'deposit',
    slots: {
      amount: { display: '2.500 TRY', status: 'filled' },
      method: { display: 'Papara', status: 'filled' },
    },
    outcome: 'handed_off',
    awaiting_answer: false,
    handoff: {
      id: null,
      team_id: '7',
      team_name: 'Finance',
      reason_codes: ['ai_handoff'],
      agent_replied: false,
    },
    risk_flags: ['rg_signal'],
    last_ai_excerpt: 'I am passing your 2.500 TRY deposit to finance.',
    ...overrides,
  };
}

function earlier(overrides: Partial<EarlierToday> = {}): EarlierToday {
  return {
    digests: [digest()],
    trust: 'verified',
    recall: 'auto_if_unresolved',
    contact: 2,
    ...overrides,
  };
}

const TURN = {
  skill: { id: PAPARA, name: 'Papara deposit' },
  intent: 'deposit',
  sideEffects: [],
} as const;

describe('the summary a turn writes (AI-02 §1–§2)', () => {
  it('keeps the topic, the collected slots in either shape, and the risk flags', () => {
    const state: TurnState = {
      ...emptyTurnState(),
      slots: {
        amount: { value: 2500, display: '2.500 TRY', status: 'filled' },
        method: 'Papara',
        empty: '',
        noise: 42,
      },
      signals: { risk_flags: ['rg_signal', 7] },
    };
    const built = buildDigest(null, state, {
      ...TURN,
      outcome: 'answered',
      reply: 'Deposits by Papara take up to 15 minutes.',
      replyKind: 'answer',
    });
    expect(built).toEqual({
      procedure_key: PAPARA,
      procedure_name: 'Papara deposit',
      intent_label: 'deposit',
      slots: {
        amount: { display: '2.500 TRY', status: 'filled' },
        method: { display: 'Papara', status: 'filled' },
      },
      outcome: 'resolved',
      awaiting_answer: false,
      handoff: null,
      risk_flags: ['rg_signal'],
      last_ai_excerpt: 'Deposits by Papara take up to 15 minutes.',
    });
  });

  it('leaves a question unsettled and marks it as waiting for the answer', () => {
    const built = buildDigest(null, emptyTurnState(), {
      ...TURN,
      outcome: 'answered',
      reply: 'How much did you deposit?',
      replyKind: 'question',
    });
    expect(built.outcome).toBeNull();
    expect(built.awaiting_answer).toBe(true);
  });

  it('records a hand-over by the team the skill named, and keeps it on a later turn', () => {
    const handed = buildDigest(null, emptyTurnState(), {
      ...TURN,
      outcome: 'handed_off',
      reply: null,
      replyKind: null,
      sideEffects: [{ kind: 'handoff', team: 'Finance' }],
    });
    expect(handed.outcome).toBe('handed_off');
    expect(handed.handoff).toEqual({
      id: null,
      team_id: null,
      team_name: 'Finance',
      reason_codes: ['ai_handoff'],
      agent_replied: false,
    });

    const later = buildDigest(handed as never, emptyTurnState(), {
      ...TURN,
      intent: null,
      outcome: 'skipped',
      reply: null,
      replyKind: null,
    });
    expect(later.handoff).toEqual(handed.handoff);
    expect(later.outcome).toBe('handed_off');
    expect(later.intent_label).toBe('deposit');
  });

  it(`cuts the AI's last words to ${DAILY_DIGEST_EXCERPT_MAX} characters`, () => {
    const built = buildDigest(null, emptyTurnState(), {
      ...TURN,
      outcome: 'answered',
      reply: 'word '.repeat(100),
      replyKind: 'answer',
    });
    expect(built.last_ai_excerpt).toHaveLength(DAILY_DIGEST_EXCERPT_MAX);
    expect(built.last_ai_excerpt!.endsWith('…')).toBe(true);
  });

  it('reads a stored summary of the wrong shape as empty rather than trusting it', () => {
    expect(
      readStoredDigest({ outcome: 'won', slots: [1], handoff: 'x', risk_flags: 'rg' }),
    ).toEqual({
      procedure_key: null,
      procedure_name: null,
      intent_label: null,
      slots: {},
      outcome: null,
      awaiting_answer: false,
      handoff: null,
      risk_flags: [],
      last_ai_excerpt: null,
    });
  });
});

describe("the identity's cut, before any prompt (K4)", () => {
  it.each(['verified', 'session'] as const)('gives a %s visitor the summaries whole', (trust) => {
    expect(forTrust([digest()], trust)).toEqual([digest()]);
  });

  it('gives a claimed identity only how each connection ended — no topic, slot, excerpt or team', () => {
    const [cut] = forTrust([digest()], 'claimed');
    expect(cut).toMatchObject({
      outcome: 'handed_off',
      procedure_key: PAPARA,
      procedure_name: null,
      intent_label: null,
      slots: {},
      handoff: null,
      risk_flags: [],
      last_ai_excerpt: null,
    });
    const text = JSON.stringify(cut);
    expect(text).not.toMatch(/2\.500|Papara|Finance|deposit/);
  });

  it('tells the model of a claimed identity nothing it could repeat', () => {
    const lines = earlierTodayLines(
      earlier({ trust: 'claimed', digests: forTrust([digest()], 'claimed') }),
      true,
    ).join('\n');
    expect(lines).toMatch(/not verified/);
    expect(lines).not.toMatch(/2\.500|Papara|Finance|deposit|rg_signal/);
  });

  it("tells the model of a verified member the topic, the slots and how it ended, as the player's unverified word and internal context (K5)", () => {
    const lines = earlierTodayLines(earlier(), false).join('\n');
    expect(lines).toContain("the player's own statements, not verified");
    expect(lines).toContain('topic "Papara deposit" (deposit)');
    expect(lines).toContain('amount = 2.500 TRY; method = Papara');
    expect(lines).toContain('ended: handed to a person; no agent reply yet');
    expect(lines).toMatch(/Do not repeat amounts, IBANs, transaction or document numbers/);
    expect(lines).toMatch(/Do not bring the earlier conversation up yourself/);
    expect(earlierTodayLines(earlier(), true).join('\n')).toMatch(
      /already opens by acknowledging the earlier conversation/,
    );
  });

  it('adds nothing when the day has no summary', () => {
    expect(earlierTodayLines(earlier({ digests: [] }), false)).toEqual([]);
  });
});

describe('when the AI brings the earlier topic up (AI-02-S1)', () => {
  it.each(['handed_off', 'abandoned', 'resolved_waiting'] as const)(
    'auto: recalls the latest connection that ended %s',
    (outcome) => {
      const latest = digest({ outcome });
      expect(recallTarget(earlier({ digests: [latest] }), 'another-skill')).toBe(latest);
    },
  );

  it('auto: says nothing of a latest connection that was resolved, even on the same topic', () => {
    expect(
      recallTarget(earlier({ digests: [digest({ outcome: 'resolved' })] }), PAPARA),
    ).toBeNull();
  });

  it('auto: says nothing when the new message is plainly about something else', () => {
    expect(recallTarget(earlier({ relatesToPrevious: false }), PAPARA)).toBeNull();
  });

  it('on topic only: recalls the same topic, resolved or not, and nothing for another topic', () => {
    const resolved = digest({ outcome: 'resolved' });
    const onTopic = earlier({ recall: 'on_topic_only', digests: [resolved] });
    expect(recallTarget(onTopic, PAPARA)).toBe(resolved);
    expect(recallTarget(onTopic, 'another-skill')).toBeNull();
    expect(recallTarget({ ...onTopic, relatesToPrevious: true }, 'another-skill')).toBe(resolved);
  });

  it('writes the topic and how it ended — never an amount — in the answer language', () => {
    expect(recallLine(digest(), 'verified', 'tr')).toBe(
      'Bugün daha önce «Papara deposit» konusunda yazmıştınız; konu ekibimize iletilmişti.',
    );
    expect(recallLine(digest({ outcome: 'abandoned' }), 'session', 'en')).toBe(
      'Earlier today you wrote to us about "Papara deposit"; the conversation was left unfinished.',
    );
    expect(recallLine(digest({ outcome: 'resolved' }), 'verified', null)).toBe(
      'Earlier today you wrote to us about "Papara deposit"; it was answered.',
    );
    for (const language of ['en', 'tr', 'de', 'fr', 'es'] as const) {
      expect(recallLine(digest(), 'verified', language)).not.toMatch(/2\.?500|TRY/);
    }
  });

  it('asks a claimed identity only whether they wrote earlier today', () => {
    const cut = forTrust([digest()], 'claimed')[0]!;
    expect(recallLine(cut, 'claimed', 'tr')).toBe('Bugün daha önce de bize yazmış mıydınız?');
    expect(recallLine(cut, 'claimed', 'en')).toBe('Did you write to us earlier today?');
  });
});

describe('carried slots and the repeat contact (AI-02 §5, §7)', () => {
  it('pre-fills an earlier same-topic slot as carried for a verified member, keeping what this connection holds', () => {
    const state: TurnState = {
      ...emptyTurnState(),
      slots: { method: { display: 'Havale', status: 'filled' } },
    };
    const next = withEarlierToday(state, earlier(), PAPARA);
    expect(next.slots).toEqual({
      method: { display: 'Havale', status: 'filled' },
      amount: { display: '2.500 TRY', status: 'carried' },
    });
    expect(slotKnown(next.slots, 'amount')).toBe(true);
    expect(slotKnown(next.slots, 'iban')).toBe(false);
    expect(next.signals).toEqual({ repeat_same_day: true });
  });

  it('carries only a settled slot — a partial moment or a refused amount is still to be asked (AI-04 §5)', () => {
    const partial = earlier({
      digests: [
        digest({
          slots: {
            method: { display: 'Papara', status: 'filled' },
            when: { display: '16.10.2026 akşam', status: 'partial' },
            amount: { display: 'not given', status: 'refused' },
          },
        }),
      ],
    });
    const next = withEarlierToday(emptyTurnState(), partial, PAPARA);
    expect(next.slots).toEqual({ method: { display: 'Papara', status: 'carried' } });
    expect(slotKnown(next.slots, 'when')).toBe(false);
  });

  it('leaves a pii high slot out of the summary — its value stays on the connection (AI-04 §9)', () => {
    const state: TurnState = {
      ...emptyTurnState(),
      slots: {
        iban_last4: { value: '8841', display: '8841', status: 'filled', pii: 'high' },
        method: { value: 'Papara', display: 'Papara', status: 'filled' },
      },
    };
    const built = buildDigest(null, state, {
      ...TURN,
      outcome: 'answered',
      reply: 'Thanks.',
      replyKind: 'answer',
    });
    expect(built.slots).toEqual({ method: { display: 'Papara', status: 'filled' } });
    expect(JSON.stringify(built)).not.toContain('8841');
  });

  it('carries nothing for a claimed identity, or from another topic', () => {
    expect(withEarlierToday(emptyTurnState(), earlier({ trust: 'claimed' }), PAPARA).slots).toEqual(
      {},
    );
    expect(withEarlierToday(emptyTurnState(), earlier(), 'another-skill').slots).toEqual({});
  });

  it.each([
    ['handed_off', true],
    ['resolved_waiting', true],
    ['abandoned', false],
    ['resolved', false],
  ] as const)(
    'a same-topic connection that ended %s is a repeat contact: %s',
    (outcome, repeat) => {
      const day = earlier({ digests: [digest({ outcome })] });
      expect(isRepeatSameDay(day, PAPARA)).toBe(repeat);
      expect(isRepeatSameDay(day, 'another-skill')).toBe(false);
    },
  );

  it('reads a slot of an unknown status as not known', () => {
    expect(slotKnown({ a: { status: 'missing' }, b: 'x', c: '  ' }, 'a')).toBe(false);
    expect(slotKnown({ b: 'x' }, 'b')).toBe(true);
    expect(slotKnown({ c: '  ' }, 'c')).toBe(false);
  });
});

describe('the detail the AI must not volunteer (K5 · the AI-08 hook)', () => {
  it('finds an earlier amount or method in the reply, however it is written', () => {
    expect(
      repeatsEarlierDetail('Your 2500 TL deposit is on its way.', earlier(), 'hâlâ gelmedi'),
    ).toEqual(['2.500 TRY']);
    expect(repeatsEarlierDetail('Your 2,500 deposit…', earlier(), 'hâlâ gelmedi')).toEqual([
      '2.500 TRY',
    ]);
    expect(repeatsEarlierDetail('Your PAPARA deposit…', earlier(), 'hâlâ gelmedi')).toEqual([
      'Papara',
    ]);
  });

  it('lets a detail through once the player has said it again in this connection', () => {
    expect(
      repeatsEarlierDetail('Your 2.500 TRY Papara deposit…', earlier(), 'Papara 2500 TL hâlâ yok'),
    ).toEqual([]);
  });

  it('finds nothing without earlier connections, or in a reply that names no detail', () => {
    expect(repeatsEarlierDetail('2500', undefined, '')).toEqual([]);
    expect(repeatsEarlierDetail('We are checking it now.', earlier(), '')).toEqual([]);
  });
});

describe("the agent's setting (AiAgent.daily_memory)", () => {
  it('reads the default for an agent that never set it, or set something malformed', () => {
    expect(readDailyMemory(null)).toEqual(DEFAULT_DAILY_MEMORY);
    expect(readDailyMemory({ dailyMemory: { enabled: 'yes', recall: 'always' } })).toEqual(
      DEFAULT_DAILY_MEMORY,
    );
    expect(readDailyMemory({ dailyMemory: { enabled: false } })).toEqual({
      enabled: false,
      recall: 'auto_if_unresolved',
    });
    expect(readDailyMemory({ dailyMemory: { recall: 'on_topic_only' } })).toEqual({
      enabled: true,
      recall: 'on_topic_only',
    });
  });

  it('defaults to on, recalling an unresolved topic (AI-02-S1)', () => {
    expect(DEFAULT_DAILY_MEMORY).toEqual({ enabled: true, recall: 'auto_if_unresolved' });
  });
});
