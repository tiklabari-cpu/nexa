/**
 * The tenant end of the root panel's command channel (tm 389.14 · FR-ADMIN-20).
 *
 * The handler's own logic against fakes: which messages it acts on, that one
 * request is acted on once however many processes hear it, and what it leaves
 * for the job table. The wiring against a real Redis and a real scheduler is
 * `test/integration/platform-operations.test.ts`.
 */
import { EventEmitter } from 'node:events';
import { PLATFORM_OPS_CHANNEL } from '@siyahtus/types';
import type { Redis } from 'ioredis';
import { describe, expect, it, vi } from 'vitest';
import { recordingLogger } from '../../../test/helpers/scheduler.js';
import type { ManualRunResult } from '../scheduler/types.js';
import { OPS_JOB_CLAIM_PREFIX } from './health-keys.js';
import { OpsChannel } from './ops-channel.js';

const REQUEST = '6f1c1f2e-0d6a-4c53-9a43-1f1f0a9a1b2c';

function setup(answer: ManualRunResult = { result: 'finished', status: 'ok', duration_ms: 12 }) {
  const claims = new Set<string>();
  const hashes = new Map<string, string>();
  const redis = {
    set: vi.fn(async (key: string) => {
      if (claims.has(key)) return null;
      claims.add(key);
      return 'OK';
    }),
    hset: vi.fn(async (_key: string, field: string, value: string) => {
      hashes.set(field, value);
      return 1;
    }),
  };
  const runNow = vi.fn(async (_name: string) => answer);
  const subscriber = Object.assign(new EventEmitter(), {
    subscribe: vi.fn(async () => 1),
  });
  const log = recordingLogger();
  const channel = new OpsChannel({
    subscriber: subscriber as unknown as Redis,
    redis,
    scheduler: { runNow },
    logger: log.logger,
    now: () => Date.parse('2026-10-26T12:00:00.000Z'),
  });
  return { channel, redis, runNow, hashes, claims, subscriber, log };
}

const runMessage = (name: string, requestId = REQUEST) =>
  JSON.stringify({ type: 'job.run', name, request_id: requestId });

describe('OpsChannel.handle', () => {
  it('runs the named job and leaves the outcome for the job table', async () => {
    const { channel, runNow, hashes } = setup();

    expect(await channel.handle(runMessage('siem'))).toMatchObject({ result: 'finished' });

    expect(runNow).toHaveBeenCalledTimes(1);
    expect(runNow).toHaveBeenCalledWith('siem');
    expect(JSON.parse(hashes.get('siem')!)).toEqual({
      at: '2026-10-26T12:00:00.000Z',
      result: 'finished',
      status: 'ok',
      duration_ms: 12,
      error_class: null,
    });
  });

  it('records a failed run by its error class', async () => {
    const { channel, hashes } = setup({
      result: 'finished',
      status: 'error',
      duration_ms: 3,
      error_class: 'RangeError',
    });
    await channel.handle(runMessage('siem'));
    expect(JSON.parse(hashes.get('siem')!)).toMatchObject({
      status: 'error',
      error_class: 'RangeError',
    });
  });

  it('records a refusal too, so the panel can say what became of the request', async () => {
    const { channel, hashes } = setup({ result: 'already_running' });
    await channel.handle(runMessage('siem'));
    expect(JSON.parse(hashes.get('siem')!)).toMatchObject({
      result: 'already_running',
      status: null,
      duration_ms: null,
    });
  });

  it('acts once per request id however many processes hear it', async () => {
    const first = setup();
    const claimed = first.claims;
    // A second process shares the Redis, so shares the claim set.
    const second = setup();
    second.redis.set.mockImplementation(async (key: string) => {
      if (claimed.has(key)) return null;
      claimed.add(key);
      return 'OK';
    });

    const answers = await Promise.all([
      first.channel.handle(runMessage('siem')),
      second.channel.handle(runMessage('siem')),
    ]);

    expect(answers.filter((answer) => answer === 'ignored')).toHaveLength(1);
    expect(first.runNow.mock.calls.length + second.runNow.mock.calls.length).toBe(1);
    expect(first.redis.set.mock.calls[0]?.[0]).toBe(`${OPS_JOB_CLAIM_PREFIX}${REQUEST}`);
  });

  it('runs a second request for the same job — the claim is per request, not per job', async () => {
    const { channel, runNow } = setup();
    await channel.handle(runMessage('siem', 'aaaaaaaa-1111'));
    await channel.handle(runMessage('siem', 'bbbbbbbb-2222'));
    expect(runNow).toHaveBeenCalledTimes(2);
  });

  it.each([
    ['not JSON', 'job.run siem'],
    ['not an object', '"job.run"'],
    ['another message type', JSON.stringify({ type: 'settings.changed', keys: ['x'] })],
    ['no name', JSON.stringify({ type: 'job.run', request_id: REQUEST })],
    ['a name that is not a job name', runMessage('Siem; DROP')],
    ['a name with a path in it', runMessage('../siem')],
    ['no request id', JSON.stringify({ type: 'job.run', name: 'siem' })],
    ['a request id that is not an id', runMessage('siem', 'x'.repeat(200))],
  ])('ignores a message that is %s', async (_label, message) => {
    const { channel, runNow, redis } = setup();
    expect(await channel.handle(message)).toBe('ignored');
    expect(runNow).not.toHaveBeenCalled();
    expect(redis.set).not.toHaveBeenCalled();
  });

  it('never throws — a Redis that fails mid-handling is logged and dropped', async () => {
    const { channel, redis, log } = setup();
    redis.set.mockRejectedValueOnce(new Error('ECONNRESET'));
    expect(await channel.handle(runMessage('siem'))).toBe('ignored');
    expect(log.at('warn')).toHaveLength(1);
  });

  it('still answers when the scheduler rejects (Redis unreachable inside runNow)', async () => {
    const { channel, runNow, log, hashes } = setup();
    runNow.mockRejectedValueOnce(new Error('ECONNREFUSED'));
    expect(await channel.handle(runMessage('siem'))).toBe('ignored');
    expect(log.at('warn')).toHaveLength(1);
    expect(hashes.size).toBe(0);
  });
});

describe('OpsChannel.start', () => {
  it('subscribes to the ops channel and hands its messages to the handler', async () => {
    const { channel, subscriber, runNow } = setup();
    await channel.start();
    expect(subscriber.subscribe).toHaveBeenCalledTimes(1);
    expect(subscriber.subscribe).toHaveBeenCalledWith(PLATFORM_OPS_CHANNEL);

    subscriber.emit('message', 'some:other:channel', runMessage('siem'));
    subscriber.emit('message', PLATFORM_OPS_CHANNEL, runMessage('siem'));
    await channel.stop();

    expect(runNow).toHaveBeenCalledTimes(1);
    expect(runNow).toHaveBeenCalledWith('siem');
  });

  it('subscribes once however often it is started', async () => {
    const { channel, subscriber } = setup();
    await channel.start();
    await channel.start();
    expect(subscriber.subscribe).toHaveBeenCalledTimes(1);
  });
});
