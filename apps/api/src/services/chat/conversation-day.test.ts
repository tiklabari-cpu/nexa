import { Prisma } from '@prisma/client';
import { describe, expect, it } from 'vitest';
import { localDayKey } from '@siyahtus/types';
import {
  ConnectionRaceLost,
  DEFAULT_CONNECTION_IDLE_SECONDS,
  connectionGroup,
  continuesConnection,
  dayDate,
  dayKeyOf,
  idleSecondsFrom,
  isConnectionRace,
  reopensInPlace,
  visitorOpenedVia,
} from './conversation-day.js';

const MINUTE = 60_000;

describe('the idle window (K2)', () => {
  it('is 30 minutes for a workspace that set no chat timeout', () => {
    expect(DEFAULT_CONNECTION_IDLE_SECONDS).toBe(1800);
    expect(idleSecondsFrom(null)).toBe(1800);
    expect(idleSecondsFrom(undefined)).toBe(1800);
  });

  it("is the workspace's own window when it set one", () => {
    expect(idleSecondsFrom(600)).toBe(600);
    expect(idleSecondsFrom(86_400)).toBe(86_400);
  });

  it('never reads a stored non-positive window as "no window"', () => {
    expect(idleSecondsFrom(0)).toBe(1800);
    expect(idleSecondsFrom(-5)).toBe(1800);
  });
});

describe('continuesConnection — does the open chat take the message? (ID-02, 05 logic 2a)', () => {
  // Istanbul is UTC+3 all year: 23:50 local = 20:50 UTC.
  const at = (iso: string) => new Date(iso);
  const base = { idleSeconds: 1800 };

  it('takes it into a chat filed under no day, however long it was silent (the model before ID-02)', () => {
    expect(
      continuesConnection({
        ...base,
        chatDay: null,
        today: '2026-10-15',
        lastActivityAt: at('2026-10-01T09:00:00Z'),
        now: at('2026-10-15T09:00:00Z'),
      }),
    ).toBe(true);
  });

  it("takes it into today's chat, however long it was silent — closing is the sweep's job", () => {
    expect(
      continuesConnection({
        ...base,
        chatDay: '2026-10-15',
        today: '2026-10-15',
        lastActivityAt: at('2026-10-15T06:00:00Z'),
        now: at('2026-10-15T12:00:00Z'),
      }),
    ).toBe(true);
  });

  it("does not split a live conversation at midnight: 23:50's chat takes 00:10's message (scenario 5)", () => {
    const now = at('2026-10-15T21:10:00Z'); // 00:10 on the 16th, Istanbul
    expect(localDayKey(now, 'Europe/Istanbul', 0)).toBe('2026-10-16');
    expect(
      continuesConnection({
        ...base,
        chatDay: '2026-10-15',
        today: localDayKey(now, 'Europe/Istanbul', 0),
        lastActivityAt: new Date(now.getTime() - 20 * MINUTE),
        now,
      }),
    ).toBe(true);
  });

  it("rolls yesterday's connection over once it has been silent past the window (scenario 6)", () => {
    const now = at('2026-10-16T06:00:00Z');
    expect(
      continuesConnection({
        ...base,
        chatDay: '2026-10-15',
        today: '2026-10-16',
        lastActivityAt: new Date(now.getTime() - 31 * MINUTE),
        now,
      }),
    ).toBe(false);
  });

  it('holds exactly at the window and rolls over just past it', () => {
    const now = at('2026-10-16T06:00:00Z');
    const silentFor = (ms: number) =>
      continuesConnection({
        ...base,
        chatDay: '2026-10-15',
        today: '2026-10-16',
        lastActivityAt: new Date(now.getTime() - ms),
        now,
      });
    expect(silentFor(30 * MINUTE)).toBe(true);
    expect(silentFor(30 * MINUTE + 1)).toBe(false);
  });

  it("uses the workspace's own window as the rollover gap", () => {
    const now = at('2026-10-16T06:00:00Z');
    expect(
      continuesConnection({
        chatDay: '2026-10-15',
        today: '2026-10-16',
        lastActivityAt: new Date(now.getTime() - 3 * 60 * MINUTE),
        now,
        idleSeconds: 4 * 3600,
      }),
    ).toBe(true);
  });

  it('never rolls over a conversation nothing closes by silence (a channel one with no workspace timeout)', () => {
    const now = at('2026-10-16T06:00:00Z');
    expect(
      continuesConnection({
        chatDay: '2026-10-15',
        today: '2026-10-16',
        lastActivityAt: new Date(now.getTime() - 3 * 24 * 60 * MINUTE),
        now,
        idleSeconds: null,
      }),
    ).toBe(true);
  });

  it('treats a chat filed under a later key than today as today’s (the boundary moved east)', () => {
    expect(
      continuesConnection({
        ...base,
        chatDay: '2026-10-17',
        today: '2026-10-16',
        lastActivityAt: at('2026-10-15T00:00:00Z'),
        now: at('2026-10-16T12:00:00Z'),
      }),
    ).toBe(true);
  });
});

describe('visitorOpenedVia — how the opened connection came to exist', () => {
  it('first_of_day with no chat for today, same_day_return with one', () => {
    expect(visitorOpenedVia({ rolledOver: false, dayChatExists: false })).toBe('first_of_day');
    expect(visitorOpenedVia({ rolledOver: false, dayChatExists: true })).toBe('same_day_return');
  });

  it('day_rollover whenever yesterday’s connection was closed on the way in', () => {
    expect(visitorOpenedVia({ rolledOver: true, dayChatExists: false })).toBe('day_rollover');
    expect(visitorOpenedVia({ rolledOver: true, dayChatExists: true })).toBe('day_rollover');
  });
});

describe("reopensInPlace — where an agent's Reopen continues (ID-02-S6)", () => {
  it("reopens today's chat in place, and one filed under a later key (the boundary moved east)", () => {
    expect(reopensInPlace({ chatDay: '2026-10-16', today: '2026-10-16' })).toBe(true);
    expect(reopensInPlace({ chatDay: '2026-10-17', today: '2026-10-16' })).toBe(true);
  });

  it('reopens a chat filed under no day in place — it keeps the model it was opened in', () => {
    expect(reopensInPlace({ chatDay: null, today: '2026-10-16' })).toBe(true);
  });

  it('does not add a connection to a day that has ended, however recent (scenario 9)', () => {
    expect(reopensInPlace({ chatDay: '2026-10-15', today: '2026-10-16' })).toBe(false);
    expect(reopensInPlace({ chatDay: '2025-12-31', today: '2026-01-01' })).toBe(false);
  });
});

describe('connectionGroup — the one team a connection went to', () => {
  it('is that team when there was exactly one', () => {
    expect(connectionGroup([7n])).toBe(7n);
  });

  it('is null for none, and for several named at once rather than an invented pick', () => {
    expect(connectionGroup([])).toBeNull();
    expect(connectionGroup([3n, 7n])).toBeNull();
  });
});

describe('the day as stored', () => {
  it('round-trips a key through the DATE column value (UTC midnight)', () => {
    expect(dayDate('2026-10-15').toISOString()).toBe('2026-10-15T00:00:00.000Z');
    expect(dayKeyOf(dayDate('2026-02-28'))).toBe('2026-02-28');
  });
});

describe('isConnectionRace — what a second attempt can resolve (05 logic 2c)', () => {
  const prismaError = (code: string, meta?: Record<string, unknown>) =>
    new Prisma.PrismaClientKnownRequestError('failed', {
      code,
      clientVersion: 'test',
      ...(meta ? { meta } : {}),
    });

  it('is true for a unique violation, however it surfaced, and for a race the attempt noticed itself', () => {
    expect(isConnectionRace(prismaError('P2002'))).toBe(true);
    // A raw query reports the same violation as P2010 with the SQLSTATE.
    expect(isConnectionRace(prismaError('P2010', { code: '23505' }))).toBe(true);
    expect(isConnectionRace(new ConnectionRaceLost('the day chat was reopened'))).toBe(true);
  });

  it('is true for a deadlock or write conflict the database already rolled back', () => {
    expect(isConnectionRace(prismaError('P2034'))).toBe(true);
    expect(isConnectionRace(prismaError('P2010', { code: '40P01' }))).toBe(true);
    expect(isConnectionRace(prismaError('P2010', { code: '40001' }))).toBe(true);
  });

  it('is false for anything else — a real failure must not be retried into a second write', () => {
    expect(isConnectionRace(prismaError('P2025'))).toBe(false);
    expect(isConnectionRace(prismaError('P2010', { code: '23503' }))).toBe(false);
    expect(isConnectionRace(prismaError('P2010'))).toBe(false);
    expect(isConnectionRace(new Error('boom'))).toBe(false);
  });
});
