/**
 * The gateway's one writer (tm 428): a socket whose unsent frames passed
 * `RTM_MAX_BUFFERED_BYTES` is not written to but closed with 1013, once, with
 * one `warn` line — and every write in `apps/rtm/src` goes through it.
 *
 * Against a stand-in socket whose `bufferedAmount` the test sets: a real slow
 * consumer is proven end to end in `test/integration/slow-consumer.test.ts`.
 */
import { readdirSync, readFileSync } from 'node:fs';
import { dirname, join, relative } from 'node:path';
import { Writable } from 'node:stream';
import { fileURLToPath } from 'node:url';
import { pino } from 'pino';
import { describe, expect, it } from 'vitest';
import type { WebSocket } from 'ws';
import { ConnectionRegistry, type Connection } from './connection.js';
import { SLOW_CONSUMER_CLOSE_CODE, SocketWriter } from './socket-writer.js';

const ORG = '11111111-1111-4111-8111-111111111111';
const LIMIT = 1024 * 1024;

interface FakeSocket {
  readyState: number;
  bufferedAmount: number;
  frames: string[];
  closes: Array<{ code: number; reason: string }>;
  throwOnSend: boolean;
  send(frame: string): void;
  close(code: number, reason: string): void;
}

function fakeSocket(): FakeSocket {
  return {
    readyState: 1, // WebSocket.OPEN
    bufferedAmount: 0,
    frames: [],
    closes: [],
    throwOnSend: false,
    send(frame: string) {
      if (this.throwOnSend) throw new Error('WebSocket is not open');
      this.frames.push(frame);
    },
    close(code: number, reason: string) {
      this.closes.push({ code, reason });
    },
  };
}

function setup(limit: number | null = LIMIT) {
  const lines: Array<Record<string, unknown>> = [];
  const stream = new Writable({
    write(chunk: Buffer, _encoding, done) {
      lines.push(JSON.parse(chunk.toString()) as Record<string, unknown>);
      done();
    },
  });
  const writer = new SocketWriter(limit, pino({ level: 'info' }, stream));
  const registry = new ConnectionRegistry();
  const fake = fakeSocket();
  const connection: Connection = registry.add({
    ws: fake as unknown as WebSocket,
    side: 'customer',
    organizationId: ORG,
  });
  registry.authenticate(connection.id, { licenseId: '7', actorId: 'cust-1' });
  const slowLines = () =>
    lines.filter((line) => String(line['msg']).startsWith('rtm slow consumer'));
  return { writer, connection, fake, lines, slowLines };
}

describe('SocketWriter (tm 428)', () => {
  it('writes to a socket at or below the limit, and says so', () => {
    const { writer, connection, fake } = setup();
    expect(writer.write(connection, 'a')).toBe(true);
    fake.bufferedAmount = LIMIT; // at, not above
    expect(writer.write(connection, 'b')).toBe(true);
    expect(fake.frames).toEqual(['a', 'b']);
    expect(fake.closes).toEqual([]);
    expect(connection.closedBy).toBeNull();
  });

  it('does not write to a socket above the limit: closes it with 1013 and logs one line (NFR-S8)', () => {
    const { writer, connection, fake, slowLines } = setup();
    fake.bufferedAmount = LIMIT + 1;

    expect(writer.write(connection, 'SENTINEL-frame')).toBe(false);
    expect(fake.frames).toEqual([]);
    expect(fake.closes).toEqual([{ code: SLOW_CONSUMER_CLOSE_CODE, reason: 'slow consumer' }]);
    expect(SLOW_CONSUMER_CLOSE_CODE).toBe(1013);
    expect(connection.closedBy).toBe('slow_consumer');

    expect(slowLines()).toHaveLength(1);
    expect(slowLines()[0]).toMatchObject({
      level: 40,
      connection_id: connection.id,
      organization_id: ORG,
      license_id: '7',
      actor_id: 'cust-1',
      buffered_bytes: LIMIT + 1,
      max_buffered_bytes: LIMIT,
    });
    // Ids and sizes, never a frame — a frame can carry a visitor's words.
    expect(JSON.stringify(slowLines())).not.toContain('SENTINEL');
  });

  it('writes nothing more to a slow consumer once it is closing, and closes and logs it once', () => {
    const { writer, connection, fake, slowLines } = setup();
    fake.bufferedAmount = LIMIT + 1;
    writer.write(connection, 'a');

    // The buffer drains a little before the close completes: still nothing.
    fake.bufferedAmount = 0;
    expect(writer.write(connection, 'b')).toBe(false);
    fake.bufferedAmount = LIMIT * 4;
    expect(writer.write(connection, 'c')).toBe(false);

    expect(fake.frames).toEqual([]);
    expect(fake.closes).toHaveLength(1);
    expect(slowLines()).toHaveLength(1);
  });

  it('writes nothing to a socket that is not open — the count a closing socket keeps is not a slow consumer', () => {
    const { writer, connection, fake, slowLines } = setup();
    // `ws` counts a write after close towards `bufferedAmount` and drops it.
    fake.readyState = 2; // CLOSING
    fake.bufferedAmount = LIMIT * 8;

    expect(writer.write(connection, 'a')).toBe(false);
    expect(fake.frames).toEqual([]);
    expect(fake.closes).toEqual([]);
    expect(connection.closedBy).toBeNull();
    expect(slowLines()).toEqual([]);
  });

  it('checks nothing with the limit off', () => {
    const { writer, connection, fake } = setup(null);
    fake.bufferedAmount = 256 * 1024 * 1024;
    expect(writer.write(connection, 'a')).toBe(true);
    expect(fake.frames).toEqual(['a']);
    expect(fake.closes).toEqual([]);
  });

  it('answers false, and does not throw, when the write itself throws', () => {
    const { writer, connection, fake } = setup();
    fake.throwOnSend = true;
    expect(writer.write(connection, 'a')).toBe(false);
    expect(fake.closes).toEqual([]);
  });
});

describe('every write in apps/rtm/src goes through the writer (tm 428)', () => {
  const SRC = dirname(fileURLToPath(import.meta.url));

  /** Every production source file under apps/rtm/src — tests excluded. */
  function sources(dir: string): string[] {
    return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
      const path = join(dir, entry.name);
      if (entry.isDirectory()) return sources(path);
      return entry.name.endsWith('.ts') && !entry.name.endsWith('.test.ts') ? [path] : [];
    });
  }

  const files = sources(SRC).map((path) => ({
    name: relative(SRC, path).replaceAll('\\', '/'),
    text: readFileSync(path, 'utf8'),
  }));

  it('scans the real gateway (guards a vacuous pass)', () => {
    const names = files.map((file) => file.name);
    expect(names).toEqual(expect.arrayContaining(['server.ts', 'fanout.ts', 'socket-writer.ts']));
    expect(names.some((name) => name.endsWith('.test.ts'))).toBe(false);
  });

  it('finds `.send(` in socket-writer.ts and nowhere else', () => {
    const calls = files.flatMap((file) =>
      [...file.text.matchAll(/\.send\(/g)].map(() => file.name),
    );
    expect(calls).toEqual(['socket-writer.ts']);
  });
});
