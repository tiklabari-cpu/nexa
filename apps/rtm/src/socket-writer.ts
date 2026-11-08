/**
 * The one place a frame is written to a socket (tm 428).
 *
 * `ws.send` never refuses. A frame the peer has not read waits in this
 * process's memory until it does, and nothing bounded how much could wait: a
 * visitor sending ten `sync` requests a second whose long cursor keys came back
 * in `removed_chat_ids`, without ever reading its end of the TCP connection,
 * grew the gateway's send buffer for as long as the socket stayed open. The
 * cursors are bounded now (`input-bounds.ts`), but any socket that stops
 * reading while pushes keep arriving does the same thing more slowly.
 *
 * So before every write the socket's unsent bytes (`ws.bufferedAmount`) are
 * read, and a socket already holding more than `RTM_MAX_BUFFERED_BYTES` is not
 * written to: it is closed with 1013 ("try again later") and one `warn` line.
 * Nothing already written is thrown away — the close frame queues behind it —
 * and the frame refused here is not lost either: every client reconnects on a
 * close it did not ask for, and its reconnect `sync` reads from the database
 * what the socket did not carry (NFR-R2). A peer that is not reading never
 * answers the close frame; `ws` tears the socket down after its own close
 * timeout, and until then nothing more is written to it, so what it holds stays
 * at the limit plus one frame.
 *
 * Every write in `apps/rtm/src` goes through {@link SocketWriter.write} — a test
 * holds that line (`socket-writer.test.ts`).
 */
import type { Logger } from 'pino';
import { WebSocket } from 'ws';
import { connectionLogContext, type Connection } from './connection.js';

/** RFC 6455 "Try Again Later": a client reads it as "reconnect", which is the remedy. */
export const SLOW_CONSUMER_CLOSE_CODE = 1013;

export class SocketWriter {
  constructor(
    /** `RTM_MAX_BUFFERED_BYTES`, or null when the check is off. */
    readonly maxBufferedBytes: number | null,
    private readonly log: Logger,
  ) {}

  /**
   * Write `frame` to the connection's socket. False when it was not written:
   * the socket is not open, it is a slow consumer (closed here), or the write
   * itself threw.
   */
  write(connection: Connection, frame: string): boolean {
    const { ws } = connection;
    // Not open: a write would only be counted towards `bufferedAmount` by `ws`
    // and dropped — and on a socket the drain or the client is closing anyway,
    // that count must not read as a slow consumer.
    if (ws.readyState !== WebSocket.OPEN) return false;
    if (connection.closedBy === 'slow_consumer') return false;

    const buffered = ws.bufferedAmount;
    if (this.maxBufferedBytes !== null && buffered > this.maxBufferedBytes) {
      this.#closeSlowConsumer(connection, buffered);
      return false;
    }

    try {
      ws.send(frame);
      return true;
    } catch {
      // Closed between the decision to write and the write itself.
      return false;
    }
  }

  #closeSlowConsumer(connection: Connection, buffered: number): void {
    connection.closedBy = 'slow_consumer';
    // Ids and sizes only — never a frame, which can carry a visitor's words.
    this.log.warn(
      {
        ...connectionLogContext(connection),
        connection_id: connection.id,
        buffered_bytes: buffered,
        max_buffered_bytes: this.maxBufferedBytes,
      },
      'rtm slow consumer: closing a socket that is not reading',
    );
    try {
      connection.ws.close(SLOW_CONSUMER_CLOSE_CODE, 'slow consumer');
    } catch {
      // Already torn down.
    }
  }
}
