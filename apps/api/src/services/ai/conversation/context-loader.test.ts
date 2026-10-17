/**
 * The context loader's rules (tm 292.3 · SiyahTuş analysis AI-01 §1–§4, §8):
 * the role mapping, the merge, the attachment placeholder, the budget and the
 * opening message it always keeps, the state digest, and how the history
 * yields to the prompt ceiling. Over events already read — the query itself,
 * row level security and the internal note it never returns are pinned
 * against the real database in `test/integration/ai-context-loader.test.ts`.
 */
import { describe, expect, it } from 'vitest';
import {
  AGENT_MARKER,
  GAP_MARKER,
  attachmentPlaceholder,
  buildConnectionContext,
  shortenHistory,
  stateDigest,
  type ConnectionEvent,
} from './context-loader.js';
import { emptyTurnState, type TurnHistory } from './turn.js';

const AT = new Date('2026-10-17T14:02:30Z');

function event(
  sequence: number,
  authorType: string,
  text: string | null,
  extra: Partial<ConnectionEvent> = {},
): ConnectionEvent {
  return {
    sequence,
    type: 'message',
    authorType,
    text,
    attachmentUrl: null,
    properties: {},
    createdAt: AT,
    ...extra,
  };
}

const build = (
  events: ConnectionEvent[],
  options: { processedThrough?: number; gapAfter?: number | null; maxChars?: number } = {},
) =>
  buildConnectionContext(
    { events, gapAfter: options.gapAfter ?? null },
    {
      state: emptyTurnState(),
      processedThrough: options.processedThrough ?? Number.MAX_SAFE_INTEGER,
      budget: { maxMessages: 20, maxChars: options.maxChars ?? 12_000 },
    },
  );

describe('the conversation a turn reads (AI-01)', () => {
  it('maps the visitor to user and the bot and agents to assistant, in order, an agent marked', () => {
    const context = build(
      [
        event(1, 'customer', 'Param yatmadı'),
        event(2, 'bot', 'Hangi yöntemle ve saat kaçta yatırdınız?'),
        event(3, 'agent', 'Bakıyorum.'),
        event(4, 'customer', 'Papara 13:40'),
      ],
      { processedThrough: 3 },
    );

    expect(context.messages).toEqual([
      { role: 'user', content: 'Param yatmadı' },
      {
        role: 'assistant',
        content: `Hangi yöntemle ve saat kaçta yatırdınız?\n${AGENT_MARKER} Bakıyorum.`,
      },
    ]);
    expect(context.newCustomerText).toBe('Papara 13:40');
    expect(context.lastSeq).toBe(4);
    expect(context.visitorMessages).toBe(1);
    expect(context.omitted).toBe(false);
  });

  it('merges consecutive messages of one role, and every unanswered visitor message into the turn', () => {
    const context = build(
      [
        event(1, 'customer', 'Merhaba'),
        event(2, 'customer', 'Param yatmadı'),
        event(3, 'bot', 'Yöntem?'),
        event(4, 'customer', 'Papara'),
        event(5, 'customer', '13:40'),
      ],
      { processedThrough: 3 },
    );

    expect(context.messages).toEqual([
      { role: 'user', content: 'Merhaba\nParam yatmadı' },
      { role: 'assistant', content: 'Yöntem?' },
    ]);
    expect(context.newCustomerText).toBe('Papara\n13:40');
    expect(context.freshMessages).toBe(2);
    expect(context.visitorMessages).toBe(2);
  });

  it('turns system events into timed notes rather than messages', () => {
    const context = build([
      event(1, 'customer', 'Help'),
      event(2, 'system', 'Chat transferred', {
        type: 'system_message',
        properties: { system_event: 'chat_transferred' },
      }),
    ]);

    expect(context.messages).toEqual([{ role: 'user', content: 'Help' }]);
    expect(context.systemNotes).toEqual(['14:02 UTC — Chat transferred']);
  });

  it('gives an attachment a placeholder, never its address, and skips an empty event', () => {
    const context = build([
      event(1, 'customer', 'Dekont ekte', {
        attachmentUrl: '/api/v1/uploads/7-1d2e3f4a-5b6c-4d7e-8f9a-0b1c2d3e4f5a.jpg',
      }),
      event(2, 'customer', null, { type: 'file', properties: { file_name: 'dekont.pdf' } }),
      event(3, 'customer', '   '),
    ]);

    expect(context.messages).toEqual([
      {
        role: 'user',
        content: 'Dekont ekte\n[Attachment: image, .jpg]\n[Attachment: file, dekont.pdf]',
      },
    ]);
    expect(JSON.stringify(context)).not.toContain('uploads');
  });

  it('names the kind of an attachment from its extension', () => {
    const at = (attachmentUrl: string | null, type = 'message') =>
      attachmentPlaceholder({ type, attachmentUrl, properties: {} });
    expect(at('/api/v1/uploads/7-x.png')).toBe('[Attachment: image, .png]');
    expect(at('/api/v1/uploads/7-x.pdf')).toBe('[Attachment: document, .pdf]');
    expect(at('/api/v1/uploads/7-x')).toBe('[Attachment: file]');
    expect(at(null, 'file')).toBe('[Attachment: file]');
    expect(at(null)).toBeNull();
  });

  it('keeps the visitor’s opening message across a cut, and says where the cut is', () => {
    // The loader read the opening message and the window after a gap.
    const context = build(
      [
        event(1, 'customer', 'Param yatmadı'),
        event(30, 'bot', 'Yöntem?'),
        event(31, 'customer', 'Papara'),
      ],
      { processedThrough: 31, gapAfter: 1 },
    );

    expect(context.messages).toEqual([
      { role: 'user', content: 'Param yatmadı' },
      { role: 'assistant', content: `${GAP_MARKER}\nYöntem?` },
      { role: 'user', content: 'Papara' },
    ]);
    expect(context.omitted).toBe(true);
  });

  it('drops the oldest messages over the character budget, never the opening one', () => {
    const events = [event(1, 'customer', 'OPENING question')];
    for (let seq = 2; seq <= 40; seq += 1) {
      events.push(event(seq, seq % 2 === 0 ? 'bot' : 'customer', `${seq} ${'x'.repeat(300)}`));
    }

    const context = build(events, { maxChars: 2_000 });

    const chars = context.messages.reduce((sum, message) => sum + message.content.length, 0);
    // The budget, plus the markers and line breaks the merge writes.
    expect(chars).toBeLessThanOrEqual(2_000 + GAP_MARKER.length + 2);
    // The window happens to open on a visitor message, which joins the opening one.
    expect(context.messages[0]!.role).toBe('user');
    expect(context.messages[0]!.content.startsWith(`OPENING question\n${GAP_MARKER}\n`)).toBe(true);
    expect(context.messages.at(-1)!.content).toContain('40 ');
    expect(context.omitted).toBe(true);
  });

  it('shortens an opening message longer than half the budget rather than dropping it', () => {
    const context = build([event(1, 'customer', 'y'.repeat(5_000)), event(2, 'bot', 'ok')], {
      maxChars: 1_000,
    });

    expect(context.messages[0]!.content).toHaveLength(500);
    expect(context.messages[0]!.content.endsWith('…')).toBe(true);
    expect(context.messages[1]).toEqual({ role: 'assistant', content: 'ok' });
  });
});

describe('the state digest (AI-01 §3)', () => {
  it('is empty while nothing is settled', () => {
    expect(stateDigest(emptyTurnState())).toBe('');
  });

  it('names the step and the slots collected', () => {
    expect(
      stateDigest({
        ...emptyTurnState(),
        stepId: 'ask_time',
        stepStatus: 'awaiting_answer',
        slots: { method: 'Papara', amount: 500, missing: null },
      }),
    ).toBe(
      'Current step: ask_time (awaiting_answer)\nCollected so far: method = Papara; amount = 500',
    );
  });
});

describe('the history yields to the prompt ceiling', () => {
  const history: TurnHistory = {
    messages: [
      { role: 'user', content: 'opening' },
      { role: 'assistant', content: 'a1' },
      { role: 'user', content: 'u2' },
      { role: 'assistant', content: 'a2' },
    ],
    systemNotes: ['14:02 UTC — Chat transferred'],
    stateDigest: '',
    omitted: false,
    visitorMessages: 2,
  };

  it('drops the oldest messages after the opening one first, keeps the roles apart, and marks the cut', () => {
    const once = shortenHistory(history)!;
    // `a1` goes, and `u2` with it rather than being folded into the opening message.
    expect(once.messages).toEqual([
      { role: 'user', content: 'opening' },
      { role: 'assistant', content: `${GAP_MARKER}\na2` },
    ]);
    expect(once.omitted).toBe(true);
  });

  it('keeps the opening message to the last, then the notes, then nothing', () => {
    const steps: TurnHistory[] = [];
    let current: TurnHistory | undefined = history;
    while (current) {
      steps.push(current);
      current = shortenHistory(current);
    }
    const lastWithMessages = [...steps].reverse().find((step) => step.messages.length > 0)!;
    expect(lastWithMessages.messages).toHaveLength(1);
    expect(lastWithMessages.messages[0]!.content.startsWith('opening')).toBe(true);
    expect(steps.at(-1)).toMatchObject({ messages: [], systemNotes: history.systemNotes });
  });
});
