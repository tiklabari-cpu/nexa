import { describe, expect, it } from 'vitest';
import {
  assigneeEmailKey,
  claimAssigneeEmailWindow,
  shouldEmailAssignee,
  type AssigneeEmailWindowRedis,
} from './assignee-email.js';

describe('shouldEmailAssignee', () => {
  it('e-mails a human assignee who has the channel on and an address', () => {
    expect(shouldEmailAssignee({ email: 'agent@example.test', emailEnabled: true })).toBe(true);
  });

  it('does not e-mail when there is no human assignee (queued / AI-only chat)', () => {
    // The route passes null when the active thread has no assignee — nobody to
    // write to.
    expect(shouldEmailAssignee(null)).toBe(false);
  });

  it('does not e-mail when the agent has turned the channel off (FR-MOD-08.2)', () => {
    // The negative the whole preference exists for.
    expect(shouldEmailAssignee({ email: 'agent@example.test', emailEnabled: false })).toBe(false);
  });

  it('does not e-mail an assignee with no deliverable address', () => {
    expect(shouldEmailAssignee({ email: null, emailEnabled: true })).toBe(false);
    expect(shouldEmailAssignee({ email: '', emailEnabled: true })).toBe(false);
  });

  it('narrows email to a string on a positive decision', () => {
    // The type guard lets the caller send without a non-null assertion; this
    // pins the runtime side of that promise.
    const channel = { email: 'agent@example.test', emailEnabled: true };
    if (shouldEmailAssignee(channel)) {
      expect(channel.email.length).toBeGreaterThan(0);
    } else {
      throw new Error('expected a positive decision');
    }
  });
});

describe('claimAssigneeEmailWindow (tm 256.4)', () => {
  const WINDOW = { licenseId: 7n, chatId: 'chat-1', assigneeId: 'agent-1', cooldownMs: 900_000 };

  /** SET NX PX over a map, with a clock the test moves — Redis's semantics, none of its I/O. */
  function fakeRedis() {
    let now = 0;
    const keys = new Map<string, number>();
    const calls: unknown[][] = [];
    const redis: AssigneeEmailWindowRedis = {
      set: async (key, _value, _px, ms, _nx) => {
        calls.push([key, _value, _px, ms, _nx]);
        const expiresAt = keys.get(key);
        if (expiresAt !== undefined && expiresAt > now) return null;
        keys.set(key, now + ms);
        return 'OK';
      },
    };
    return { redis, calls, advance: (ms: number) => (now += ms) };
  }

  const ignore = () => undefined;

  it('lets the first message of a window mail and holds the rest of it', async () => {
    const { redis } = fakeRedis();
    const claims = [];
    for (let i = 0; i < 5; i += 1)
      claims.push(await claimAssigneeEmailWindow(redis, WINDOW, ignore));
    expect(claims).toEqual([true, false, false, false, false]);
  });

  it('opens again once the window has passed', async () => {
    const { redis, advance } = fakeRedis();
    expect(await claimAssigneeEmailWindow(redis, WINDOW, ignore)).toBe(true);
    advance(WINDOW.cooldownMs - 1);
    expect(await claimAssigneeEmailWindow(redis, WINDOW, ignore)).toBe(false);
    advance(1);
    expect(await claimAssigneeEmailWindow(redis, WINDOW, ignore)).toBe(true);
  });

  it('claims and expires in one command, keyed by licence, chat and assignee', async () => {
    const { redis, calls } = fakeRedis();
    await claimAssigneeEmailWindow(redis, WINDOW, ignore);
    expect(calls).toEqual([['siyahtus:assignee-email:7:chat-1:agent-1', '1', 'PX', 900_000, 'NX']]);
    expect(assigneeEmailKey(7n, 'chat-1', 'agent-1')).toBe(calls[0]![0]);
  });

  it('gives a new assignee of the same chat their own window', async () => {
    // A transfer hands the conversation to somebody who has not been told yet.
    const { redis } = fakeRedis();
    expect(await claimAssigneeEmailWindow(redis, WINDOW, ignore)).toBe(true);
    expect(
      await claimAssigneeEmailWindow(redis, { ...WINDOW, assigneeId: 'agent-2' }, ignore),
    ).toBe(true);
    expect(await claimAssigneeEmailWindow(redis, { ...WINDOW, chatId: 'chat-2' }, ignore)).toBe(
      true,
    );
  });

  it('mails every message and never asks Redis when the window is 0', async () => {
    const { redis, calls } = fakeRedis();
    for (let i = 0; i < 3; i += 1) {
      expect(await claimAssigneeEmailWindow(redis, { ...WINDOW, cooldownMs: 0 }, ignore)).toBe(
        true,
      );
    }
    expect(calls).toEqual([]);
  });

  it('grants the claim when Redis cannot answer, and says why', async () => {
    const outage = new Error('Connection is closed.');
    const reasons: unknown[] = [];
    const broken: AssigneeEmailWindowRedis = {
      set: async () => {
        throw outage;
      },
    };
    expect(await claimAssigneeEmailWindow(broken, WINDOW, (error) => reasons.push(error))).toBe(
      true,
    );
    expect(reasons).toEqual([outage]);
  });
});
