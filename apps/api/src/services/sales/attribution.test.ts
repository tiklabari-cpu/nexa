/**
 * The attribution rule (FR-MOD-13.5).
 *
 * This function decides which conversations get credited with revenue, so the
 * three branches the requirement names — a chat inside the window, a chat only
 * outside it, no chat at all — are pinned here rather than inferred from the
 * integration test, where a wrong boundary would still look like a green POST.
 */
import { describe, expect, it } from 'vitest';
import { resolveAttribution } from './attribution.js';

const SALE_AT = new Date('2026-08-10T12:00:00.000Z');

/** `days` before the sale, to the millisecond. */
function daysBefore(days: number): Date {
  return new Date(SALE_AT.getTime() - days * 86_400_000);
}

describe('resolveAttribution', () => {
  it('credits the most recent conversation inside the window', () => {
    const result = resolveAttribution({
      chats: [
        { chatId: 'older', at: daysBefore(5) },
        { chatId: 'newest', at: daysBefore(1) },
        { chatId: 'middle', at: daysBefore(3) },
      ],
      now: SALE_AT,
      windowDays: 7,
    });

    expect(result).toEqual({ chatId: 'newest', attributed: true });
  });

  it('attributes nothing when every conversation is older than the window', () => {
    // Still a recorded sale — the route writes the row either way — but not one
    // chat may be credited for.
    const result = resolveAttribution({
      chats: [
        { chatId: 'ancient', at: daysBefore(40) },
        { chatId: 'old', at: daysBefore(8) },
      ],
      now: SALE_AT,
      windowDays: 7,
    });

    expect(result).toEqual({ chatId: null, attributed: false });
  });

  it('attributes nothing when the visitor has never chatted', () => {
    expect(resolveAttribution({ chats: [], now: SALE_AT, windowDays: 7 })).toEqual({
      chatId: null,
      attributed: false,
    });
  });

  it('counts a conversation exactly at the edge of the window as inside it', () => {
    // The boundary has to fall one way; this way "7 days" means what the
    // workspace typed instead of missing by a millisecond.
    expect(
      resolveAttribution({
        chats: [{ chatId: 'edge', at: daysBefore(7) }],
        now: SALE_AT,
        windowDays: 7,
      }),
    ).toEqual({ chatId: 'edge', attributed: true });

    expect(
      resolveAttribution({
        chats: [{ chatId: 'just-outside', at: new Date(daysBefore(7).getTime() - 1) }],
        now: SALE_AT,
        windowDays: 7,
      }),
    ).toEqual({ chatId: null, attributed: false });
  });

  it('ignores a conversation that started after the sale', () => {
    // "Where is my receipt?", opened seconds after checkout. It cannot have
    // produced the order, so crediting it would overstate what chat achieved.
    const result = resolveAttribution({
      chats: [
        { chatId: 'after', at: new Date(SALE_AT.getTime() + 60_000) },
        { chatId: 'before', at: daysBefore(2) },
      ],
      now: SALE_AT,
      windowDays: 7,
    });

    expect(result).toEqual({ chatId: 'before', attributed: true });
  });

  it('credits a conversation happening at the very moment of the sale', () => {
    expect(
      resolveAttribution({ chats: [{ chatId: 'live', at: SALE_AT }], now: SALE_AT, windowDays: 7 }),
    ).toEqual({ chatId: 'live', attributed: true });
  });

  it('is a function of its input, not of the order rows arrive in', () => {
    // Two conversations sharing a timestamp — a fixture, or two rows written in
    // one transaction. Whichever order the query returns them in, the answer is
    // the same, so a report cannot change between runs without the data changing.
    const at = daysBefore(2);
    const forwards = resolveAttribution({
      chats: [
        { chatId: 'aaa', at },
        { chatId: 'bbb', at },
      ],
      now: SALE_AT,
      windowDays: 7,
    });
    const backwards = resolveAttribution({
      chats: [
        { chatId: 'bbb', at },
        { chatId: 'aaa', at },
      ],
      now: SALE_AT,
      windowDays: 7,
    });

    expect(forwards).toEqual(backwards);
    expect(forwards.chatId).toBe('bbb');
  });

  it('honours a narrower window', () => {
    const chats = [{ chatId: 'yesterday', at: daysBefore(1) }];

    expect(resolveAttribution({ chats, now: SALE_AT, windowDays: 2 }).attributed).toBe(true);
    // The same conversation, judged by a one-day window instead: two days back
    // is outside it, so the workspace's setting is what moves the answer.
    expect(
      resolveAttribution({
        chats: [{ chatId: 'two-days', at: daysBefore(2) }],
        now: SALE_AT,
        windowDays: 1,
      }).attributed,
    ).toBe(false);
  });

  it('credits nothing rather than everything when the window is not a usable number', () => {
    // `attribution_window_days` is CHECK-constrained above zero, so this is the
    // hand-edited-row case. A zero or NaN window must fail closed: widening
    // attribution to every conversation ever held would silently restate the
    // revenue chat is credited for.
    const chats = [{ chatId: 'recent', at: daysBefore(1) }];

    expect(resolveAttribution({ chats, now: SALE_AT, windowDays: 0 }).attributed).toBe(false);
    expect(resolveAttribution({ chats, now: SALE_AT, windowDays: -7 }).attributed).toBe(false);
    expect(resolveAttribution({ chats, now: SALE_AT, windowDays: Number.NaN }).attributed).toBe(
      false,
    );
    expect(
      resolveAttribution({ chats, now: SALE_AT, windowDays: Number.POSITIVE_INFINITY }).attributed,
    ).toBe(false);
  });

  it('skips a candidate with an unreadable timestamp instead of throwing', () => {
    const result = resolveAttribution({
      chats: [
        { chatId: 'broken', at: new Date(Number.NaN) },
        { chatId: 'fine', at: daysBefore(1) },
      ],
      now: SALE_AT,
      windowDays: 7,
    });

    expect(result).toEqual({ chatId: 'fine', attributed: true });
  });
});
