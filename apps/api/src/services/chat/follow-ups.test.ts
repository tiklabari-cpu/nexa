/**
 * `FollowUps` (tm 256.10) — the per-chat queue a visitor's message hands its
 * answer and notice to, with the jobs replaced by gates the test opens. What
 * it does to a real request (201 before the model answers, replay, drain on
 * close) is proved in `test/integration/visitor-follow-ups.test.ts`.
 */
import { describe, expect, it } from 'vitest';
import { FollowUps, MAX_FOLLOW_UPS_PER_KEY } from './follow-ups.js';

/** A job that records when it starts and finishes only when the test says so. */
function gate(name: string, log: string[]) {
  let open!: () => void;
  const opened = new Promise<void>((resolve) => {
    open = resolve;
  });
  let started!: () => void;
  const running = new Promise<void>((resolve) => {
    started = resolve;
  });
  return {
    open,
    running,
    job: async () => {
      log.push(`start ${name}`);
      started();
      await opened;
      log.push(`end ${name}`);
    },
  };
}

function queue(maxPerKey?: number) {
  const errors: Array<{ error: unknown; key: string }> = [];
  const followUps = new FollowUps({
    onError: (error, key) => errors.push({ error, key }),
    ...(maxPerKey !== undefined ? { maxPerKey } : {}),
  });
  return { followUps, errors };
}

describe('FollowUps', () => {
  it('starts a job on a later turn of the event loop, after the caller has answered', async () => {
    const { followUps } = queue();
    const log: string[] = [];

    followUps.enqueue('chat-1', async () => {
      log.push('ran');
    });
    // The caller's own next steps — sending its response is a chain of
    // promise callbacks — all come first, not only its synchronous ones.
    log.push('caller continues');
    for (let i = 0; i < 10; i += 1) await Promise.resolve();
    log.push('caller answered');
    await followUps.settled();

    expect(log).toEqual(['caller continues', 'caller answered', 'ran']);
  });

  it("runs one key's jobs one at a time, in the order they were handed in", async () => {
    const { followUps } = queue();
    const log: string[] = [];
    const first = gate('first', log);
    const second = gate('second', log);

    followUps.enqueue('chat-1', first.job);
    followUps.enqueue('chat-1', second.job);
    await first.running;
    // A second message's answer waits for the first's — it has not started.
    await new Promise((resolve) => setImmediate(resolve));
    expect(log).toEqual(['start first']);

    second.open(); // opening the later gate early changes nothing
    first.open();
    await followUps.settled();

    expect(log).toEqual(['start first', 'end first', 'start second', 'end second']);
  });

  it('does not make one chat wait for another', async () => {
    const { followUps } = queue();
    const log: string[] = [];
    const slow = gate('slow', log);
    const other = gate('other', log);

    followUps.enqueue('chat-1', slow.job);
    followUps.enqueue('chat-2', other.job);

    await Promise.all([slow.running, other.running]);
    expect(log).toEqual(['start slow', 'start other']);

    other.open();
    slow.open();
    await followUps.settled();
  });

  it('keeps going after a job throws, and hands the error to the backstop', async () => {
    const { followUps, errors } = queue();
    const failure = new Error('boom');
    const log: string[] = [];

    followUps.enqueue('chat-1', async () => {
      throw failure;
    });
    followUps.enqueue('chat-1', async () => {
      log.push('next ran');
    });
    await followUps.settled();

    expect(errors).toEqual([{ error: failure, key: 'chat-1' }]);
    expect(log).toEqual(['next ran']);
  });

  it('survives a backstop that throws', async () => {
    const followUps = new FollowUps({
      onError: () => {
        throw new Error('the logger is gone');
      },
    });
    const log: string[] = [];

    followUps.enqueue('chat-1', async () => {
      throw new Error('boom');
    });
    followUps.enqueue('chat-1', async () => {
      log.push('next ran');
    });
    await followUps.settled();

    expect(log).toEqual(['next ran']);
  });

  it("refuses a key's job past the bound and keeps the jobs it holds", async () => {
    const { followUps } = queue(2);
    const log: string[] = [];
    const first = gate('first', log);

    expect(followUps.enqueue('chat-1', first.job)).toBe(true);
    expect(followUps.enqueue('chat-1', async () => void log.push('second'))).toBe(true);
    // The running job counts: two held, the third is refused and never runs.
    expect(followUps.enqueue('chat-1', async () => void log.push('third'))).toBe(false);
    // Another chat has its own bound.
    expect(followUps.enqueue('chat-2', async () => void log.push('other'))).toBe(true);

    first.open();
    await followUps.settled();
    expect(log).toEqual(expect.arrayContaining(['start first', 'end first', 'second', 'other']));
    expect(log).not.toContain('third');

    // Once drained, the key takes jobs again.
    expect(followUps.enqueue('chat-1', async () => void log.push('later'))).toBe(true);
    await followUps.settled();
    expect(log).toContain('later');
  });

  it('bounds a key at MAX_FOLLOW_UPS_PER_KEY by default', async () => {
    const { followUps } = queue();
    const log: string[] = [];
    const first = gate('first', log);

    followUps.enqueue('chat-1', first.job);
    for (let i = 1; i < MAX_FOLLOW_UPS_PER_KEY; i += 1) {
      expect(followUps.enqueue('chat-1', async () => undefined)).toBe(true);
    }
    expect(followUps.enqueue('chat-1', async () => undefined)).toBe(false);
    expect(followUps.size).toBe(MAX_FOLLOW_UPS_PER_KEY);

    first.open();
    await followUps.settled();
    expect(followUps.size).toBe(0);
  });

  it('settles only once jobs handed in while it waits have finished too', async () => {
    const { followUps } = queue();
    const log: string[] = [];
    const first = gate('first', log);

    followUps.enqueue('chat-1', first.job);
    let settled = false;
    const waiting = followUps.settled().then(() => {
      settled = true;
    });
    await first.running;
    // A request that finishes during a drain hands its job in late.
    followUps.enqueue('chat-2', async () => {
      await new Promise((resolve) => setTimeout(resolve, 20));
      log.push('late');
    });
    first.open();
    await waiting;

    expect(settled).toBe(true);
    expect(log).toContain('late');
    expect(followUps.size).toBe(0);
  });
});
