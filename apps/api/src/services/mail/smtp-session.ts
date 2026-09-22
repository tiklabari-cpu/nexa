/**
 * One SMTP session: connect, secure, authenticate, hand one message over
 * (tm 255.3).
 *
 * The retry policy lives in `smtp-mailer.ts`; this module's job is to make that
 * policy *possible*, by turning everything that can go wrong into a
 * {@link TransientMailError} or a {@link PermanentMailError} that is right
 * about one fact: whether the server may already have the message.
 *
 * ## The one flag that matters
 *
 * `#handedOver` is set immediately before the terminating `.` is written. Up to
 * that point every failure — a timeout, a reset, a dropped connection — means
 * the server has not accepted anything, and trying again is safe. From that
 * point until the `250`, the server may have accepted the message and only its
 * answer is missing, so a failure there is `unconfirmed` and permanent: a
 * second attempt could deliver a second copy of a single-use token. After the
 * `250` nothing that happens (QUIT unanswered, connection dropped) can undo the
 * delivery or cause another one. This is the fact a general-purpose client
 * would have to expose for the policy to work, and why the session is written
 * here rather than imported (§D178).
 *
 * ## TLS is not optional, and verification cannot be switched off
 *
 * `secure` picks *when* TLS starts — the first byte (465) or after STARTTLS
 * (587) — never *whether*. A server that does not offer STARTTLS is refused
 * before the credentials are sent. The TLS options set `rejectUnauthorized:
 * true` explicitly, which Node honours even under
 * `NODE_TLS_REJECT_UNAUTHORIZED=0`, and nothing in the configuration reaches
 * them except extra trust anchors (`ca`) — which add a root to verify against,
 * and remove no check. After STARTTLS, anything the server sent before the
 * handshake is treated as an injection attempt, not as a reply.
 *
 * ## What never leaves this module
 *
 * Nothing here logs. Reply text reaches an error only through the caller's
 * `scrub`, so the recipient, the credentials and anything address-shaped a
 * server echoes back ("550 <jane@…>: user unknown") are gone before an error
 * or a log line can hold them.
 */
import net from 'node:net';
import tls from 'node:tls';
import { StringDecoder } from 'node:string_decoder';
import {
  MailDeliveryError,
  PermanentMailError,
  TransientMailError,
  type MailErrorCode,
  type MailPhase,
} from './mail-error.js';

/** Everything the carrier connects with. Assembled once, in `parseEnv` (`env.mail.smtp`). */
export interface SmtpConfig {
  host: string;
  port: number;
  /** `true`: TLS from the first byte (465). `false`: plaintext greeting, then STARTTLS — mandatory. */
  secure: boolean;
  username: string;
  password: string;
  /** The envelope sender and the `From:` header. A bare address. */
  from: string;
  /** Applied to the connection and to every reply the session waits for. */
  timeoutMs: number;
}

export interface SmtpSessionOptions {
  config: SmtpConfig;
  /** The name sent with EHLO. */
  clientName: string;
  /** Extra trust anchors for the server certificate. Adds roots; removes no check. */
  ca?: string | undefined;
  /** Strips the recipient, credentials and addresses from server text before it is kept. */
  scrub: (text: string) => string;
}

export interface Envelope {
  from: string;
  to: string;
}

export interface SmtpReceipt {
  /** The negotiated TLS version, e.g. `TLSv1.3`. */
  tlsProtocol: string | null;
  /** `PLAIN` or `LOGIN`. */
  authMechanism: string;
}

interface Reply {
  code: number;
  lines: string[];
}

/** How a read ended without a reply. Classified by the session, which knows the phase. */
type SocketFailure =
  | { kind: 'timeout' }
  | { kind: 'closed' }
  | { kind: 'error'; error: NodeJS.ErrnoException }
  | { kind: 'protocol' };

class SocketFailureError extends Error {
  constructor(readonly failure: SocketFailure) {
    super(`smtp socket ${failure.kind}`);
  }
}

/** Errno codes that describe the network rather than the peer's TLS configuration. */
const NETWORK_ERRORS = new Set([
  'ECONNREFUSED',
  'ECONNRESET',
  'ECONNABORTED',
  'EPIPE',
  'ETIMEDOUT',
  'EHOSTUNREACH',
  'EHOSTDOWN',
  'ENETUNREACH',
  'ENETDOWN',
  'EADDRNOTAVAIL',
  'EAI_AGAIN',
  'ENOTFOUND',
]);

/** A reply line longer than this is not SMTP (RFC 5321 §4.5.3.1.5 allows 512). */
const MAX_BUFFERED_REPLY = 64 * 1024;

/** Run one session to the server's `250` for the message, or throw a classified error. */
export async function deliverOnce(
  options: SmtpSessionOptions,
  envelope: Envelope,
  data: string,
): Promise<SmtpReceipt> {
  const session = new SmtpSession(options);
  try {
    return await session.run(envelope, data);
  } finally {
    session.destroy();
  }
}

/**
 * `.` at the start of a line gains a second `.` (RFC 5321 §4.5.2), and the
 * stream ends with the terminating `.` line. `data` already ends in CRLF.
 */
export function dotStuff(data: string): string {
  const body = data.endsWith('\r\n') ? data : `${data}\r\n`;
  return `${body.replace(/(^|\r\n)\./g, '$1..')}.\r\n`;
}

class SmtpSession {
  readonly #options: SmtpSessionOptions;
  #socket: net.Socket | null = null;
  #decoder = new StringDecoder('utf8');
  #buffer = '';
  #partial: string[] = [];
  #partialCode = 0;
  #replies: Reply[] = [];
  #waiter: { resolve: (reply: Reply) => void; reject: (error: Error) => void } | null = null;
  #failure: SocketFailure | null = null;
  #phase: MailPhase = 'connect';
  #handedOver = false;
  #accepted = false;
  #tlsProtocol: string | null = null;

  constructor(options: SmtpSessionOptions) {
    this.#options = options;
  }

  async run(envelope: Envelope, data: string): Promise<SmtpReceipt> {
    try {
      return await this.#run(envelope, data);
    } catch (error) {
      throw this.#classify(error);
    }
  }

  destroy(): void {
    const socket = this.#socket;
    if (!socket) return;
    this.#detach(socket);
    // A late error from a socket already being torn down must not become an
    // unhandled 'error' event and take the process with it.
    socket.on('error', () => {});
    socket.destroy();
    this.#socket = null;
  }

  async #run(envelope: Envelope, data: string): Promise<SmtpReceipt> {
    const { config, clientName } = this.#options;

    this.#phase = 'connect';
    await this.#connect();

    this.#phase = 'greeting';
    this.#expect(await this.#read(), [220]);

    this.#phase = 'ehlo';
    let capabilities = parseCapabilities(
      this.#expect(await this.#command(`EHLO ${clientName}`), [250]),
    );

    if (!config.secure) {
      this.#phase = 'starttls';
      if (!capabilities.has('STARTTLS')) {
        // Refused before anything else is sent: PrivateEmail accepts only
        // encrypted sessions, and the credentials come next.
        throw new PermanentMailError({ code: 'tls', phase: 'starttls' });
      }
      this.#expect(await this.#command('STARTTLS'), [220]);
      await this.#upgrade();
      this.#phase = 'ehlo';
      // RFC 3207 §4.2: what the server said before TLS is discarded.
      capabilities = parseCapabilities(
        this.#expect(await this.#command(`EHLO ${clientName}`), [250]),
      );
    }

    this.#phase = 'auth';
    const authMechanism = await this.#authenticate(capabilities);

    this.#phase = 'mail_from';
    this.#expect(await this.#command(`MAIL FROM:<${envelope.from}>`), [250]);

    this.#phase = 'rcpt_to';
    this.#expect(await this.#command(`RCPT TO:<${envelope.to}>`), [250, 251]);

    this.#phase = 'data';
    this.#expect(await this.#command('DATA'), [354]);

    this.#phase = 'message';
    const socket = this.#socket!;
    if (this.#failure || socket.destroyed || !socket.writable) {
      // Nothing of the message has left: still safe to try again.
      throw new SocketFailureError(this.#failure ?? { kind: 'closed' });
    }
    this.#handedOver = true;
    socket.write(dotStuff(data));
    this.#expect(await this.#read(), [250]);
    this.#accepted = true;

    await this.#quit();
    return { tlsProtocol: this.#tlsProtocol, authMechanism };
  }

  /** Map whatever stopped the session onto the two classes, by phase and by `#handedOver`. */
  #classify(error: unknown): MailDeliveryError {
    if (error instanceof MailDeliveryError) return error;
    const phase = this.#phase;
    if (this.#handedOver && !this.#accepted) {
      return new PermanentMailError({ code: 'unconfirmed', phase: 'message' });
    }
    if (error instanceof SocketFailureError) {
      const failure = error.failure;
      if (failure.kind === 'timeout') return new TransientMailError({ code: 'timeout', phase });
      if (failure.kind === 'protocol') return new PermanentMailError({ code: 'protocol', phase });
      return new TransientMailError({ code: 'connection', phase });
    }
    // Not a failure this module knows how to have. Without knowing what state
    // it left the session in, the only safe answer is not to try again.
    return new PermanentMailError({ code: 'protocol', phase });
  }

  #tlsOptions(): tls.ConnectionOptions {
    const { host } = this.#options.config;
    return {
      host,
      // SNI carries a name, never an address (RFC 6066 §3); the certificate is
      // still checked against `host` either way.
      ...(net.isIP(host) ? {} : { servername: host }),
      rejectUnauthorized: true,
      minVersion: 'TLSv1.2',
      ...(this.#options.ca ? { ca: this.#options.ca } : {}),
    };
  }

  async #connect(): Promise<void> {
    const { host, port, secure, timeoutMs } = this.#options.config;
    const socket = secure
      ? tls.connect({ ...this.#tlsOptions(), port })
      : net.connect({ host, port });
    this.#socket = socket;
    await this.#established(socket, secure ? 'secureConnect' : 'connect', timeoutMs, secure);
    if (socket instanceof tls.TLSSocket) this.#tlsProtocol = socket.getProtocol();
    this.#attach(socket);
  }

  /**
   * Hand the connection to TLS after the server's `220` to STARTTLS.
   *
   * Anything already buffered at this point arrived in plaintext *after* the
   * server agreed to encrypt — the STARTTLS command-injection shape — so it is
   * refused rather than read as the first reply of the secure session.
   */
  async #upgrade(): Promise<void> {
    const raw = this.#socket!;
    if (this.#buffer || this.#partial.length || this.#replies.length) {
      throw new PermanentMailError({ code: 'protocol', phase: 'starttls' });
    }
    this.#detach(raw);
    raw.on('error', () => {});
    const secure = tls.connect({ ...this.#tlsOptions(), socket: raw });
    this.#socket = secure;
    this.#decoder = new StringDecoder('utf8');
    await this.#established(secure, 'secureConnect', this.#options.config.timeoutMs, true);
    this.#tlsProtocol = secure.getProtocol();
    this.#attach(secure);
  }

  /**
   * Wait for a socket to be usable. During a TLS handshake, an error that is
   * not the network's is the peer's certificate or TLS setup — permanent, and
   * reported as `tls`.
   */
  #established(
    socket: net.Socket,
    event: 'connect' | 'secureConnect',
    timeoutMs: number,
    handshake: boolean,
  ): Promise<void> {
    return new Promise((resolve, reject) => {
      const cleanup = () => {
        clearTimeout(timer);
        socket.off(event, onReady);
        socket.off('error', onError);
        socket.off('close', onClose);
      };
      const onReady = () => {
        cleanup();
        resolve();
      };
      const onError = (error: NodeJS.ErrnoException) => {
        cleanup();
        socket.on('error', () => {});
        if (handshake && !NETWORK_ERRORS.has(error.code ?? '')) {
          reject(new PermanentMailError({ code: 'tls', phase: this.#phase }));
        } else {
          reject(new SocketFailureError({ kind: 'error', error }));
        }
      };
      const onClose = () => {
        cleanup();
        reject(new SocketFailureError({ kind: 'closed' }));
      };
      const timer = setTimeout(() => {
        cleanup();
        socket.on('error', () => {});
        socket.destroy();
        reject(new SocketFailureError({ kind: 'timeout' }));
      }, timeoutMs);
      socket.once(event, onReady);
      socket.once('error', onError);
      socket.once('close', onClose);
    });
  }

  readonly #onData = (chunk: Buffer) => {
    this.#buffer += this.#decoder.write(chunk);
    let newline = this.#buffer.indexOf('\n');
    while (newline >= 0) {
      const line = this.#buffer.slice(0, newline).replace(/\r$/, '');
      this.#buffer = this.#buffer.slice(newline + 1);
      if (!this.#line(line)) return;
      newline = this.#buffer.indexOf('\n');
    }
    if (this.#buffer.length > MAX_BUFFERED_REPLY) this.#fail({ kind: 'protocol' });
  };

  readonly #onError = (error: NodeJS.ErrnoException) => this.#fail({ kind: 'error', error });
  readonly #onClose = () => this.#fail({ kind: 'closed' });

  #attach(socket: net.Socket): void {
    socket.on('data', this.#onData);
    socket.on('error', this.#onError);
    socket.on('close', this.#onClose);
    socket.on('end', this.#onClose);
  }

  #detach(socket: net.Socket): void {
    socket.off('data', this.#onData);
    socket.off('error', this.#onError);
    socket.off('close', this.#onClose);
    socket.off('end', this.#onClose);
  }

  /** One reply line (RFC 5321 §4.2): `ddd-text` continues, `ddd text` or `ddd` ends. */
  #line(line: string): boolean {
    const match = /^(\d{3})(?:([ -])(.*))?$/.exec(line);
    if (!match) {
      this.#fail({ kind: 'protocol' });
      return false;
    }
    const code = Number(match[1]);
    if (this.#partial.length && code !== this.#partialCode) {
      this.#fail({ kind: 'protocol' });
      return false;
    }
    this.#partialCode = code;
    this.#partial.push(match[3] ?? '');
    if (match[2] !== '-') {
      this.#deliver({ code, lines: this.#partial });
      this.#partial = [];
    }
    return true;
  }

  #deliver(reply: Reply): void {
    const waiter = this.#waiter;
    if (waiter) {
      this.#waiter = null;
      waiter.resolve(reply);
    } else {
      this.#replies.push(reply);
    }
  }

  #fail(failure: SocketFailure): void {
    if (this.#failure) return;
    this.#failure = failure;
    const waiter = this.#waiter;
    if (waiter) {
      this.#waiter = null;
      waiter.reject(new SocketFailureError(failure));
    }
  }

  #read(): Promise<Reply> {
    const queued = this.#replies.shift();
    if (queued) return Promise.resolve(queued);
    if (this.#failure) return Promise.reject(new SocketFailureError(this.#failure));
    return new Promise<Reply>((resolve, reject) => {
      const timer = setTimeout(() => {
        this.#waiter = null;
        reject(new SocketFailureError({ kind: 'timeout' }));
      }, this.#options.config.timeoutMs);
      this.#waiter = {
        resolve: (reply) => {
          clearTimeout(timer);
          resolve(reply);
        },
        reject: (error) => {
          clearTimeout(timer);
          reject(error);
        },
      };
    });
  }

  #command(line: string): Promise<Reply> {
    const socket = this.#socket!;
    if (!this.#failure && socket.writable) socket.write(`${line}\r\n`);
    return this.#read();
  }

  /**
   * Accept one of `expected`, or throw what the reply means: 4xx transient,
   * 5xx permanent, anything else a protocol violation (permanent too — a server
   * answering out of turn will not start making sense on a retry).
   */
  #expect(reply: Reply, expected: number[]): Reply {
    if (expected.includes(reply.code)) return reply;
    const phase = this.#phase;
    const text = reply.lines.join(' ');
    const enhanced = /^([245]\.\d{1,3}\.\d{1,3})(?:\s|$)/.exec(text)?.[1];
    const details = {
      phase,
      smtpCode: reply.code,
      ...(enhanced ? { enhancedCode: enhanced } : {}),
      detail: this.#options.scrub(text),
    };
    const code: MailErrorCode = phase === 'auth' ? 'auth' : 'rejected';
    if (reply.code >= 400 && reply.code < 500) throw new TransientMailError({ code, ...details });
    if (reply.code >= 500 && reply.code < 600) throw new PermanentMailError({ code, ...details });
    throw new PermanentMailError({ code: 'protocol', ...details });
  }

  /**
   * AUTH PLAIN when offered (one round trip), AUTH LOGIN otherwise (RFC 4954).
   * Only ever after TLS: `#run` reaches this line on a secure socket or not at all.
   */
  async #authenticate(capabilities: Map<string, string[]>): Promise<string> {
    const { username, password } = this.#options.config;
    const offered = new Set(
      (capabilities.get('AUTH') ?? []).map((mechanism) => mechanism.toUpperCase()),
    );
    if (offered.has('PLAIN')) {
      const token = Buffer.from(`\0${username}\0${password}`, 'utf8').toString('base64');
      this.#expect(await this.#command(`AUTH PLAIN ${token}`), [235]);
      return 'PLAIN';
    }
    if (offered.has('LOGIN')) {
      this.#expect(await this.#command('AUTH LOGIN'), [334]);
      this.#expect(await this.#command(Buffer.from(username, 'utf8').toString('base64')), [334]);
      this.#expect(await this.#command(Buffer.from(password, 'utf8').toString('base64')), [235]);
      return 'LOGIN';
    }
    // No mechanism this carrier speaks: sending the message unauthenticated is
    // not an option (a submission server that allows it is misconfigured).
    throw new PermanentMailError({ code: 'auth', phase: 'auth' });
  }

  /** Best effort, after the `250`: nothing here can make the message undelivered. */
  async #quit(): Promise<void> {
    try {
      await this.#command('QUIT');
    } catch {
      // Delivered already; a server that hangs up without a 221 changes nothing.
    }
  }
}

/** EHLO keywords (RFC 5321 §4.1.1.1), upper-cased, with their parameters. `AUTH=` is the pre-RFC 4954 spelling. */
function parseCapabilities(reply: Reply): Map<string, string[]> {
  const capabilities = new Map<string, string[]>();
  for (const line of reply.lines.slice(1)) {
    const [keyword, ...params] = line.trim().split(/[\s=]+/);
    if (!keyword) continue;
    const key = keyword.toUpperCase();
    capabilities.set(key, [...(capabilities.get(key) ?? []), ...params]);
  }
  return capabilities;
}
