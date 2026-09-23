/**
 * A scriptable SMTP server on 127.0.0.1, for the carrier's tests (tm 255.3).
 *
 * The carrier must never meet a real server in this repository (MASTER-PROMPT
 * §5; the pilot's PrivateEmail credentials exist only in an operator's `.env`).
 * What it meets instead speaks enough RFC 5321 to be believed — a greeting,
 * EHLO with real capabilities, STARTTLS that actually upgrades, AUTH PLAIN and
 * LOGIN that check the credentials, DATA with dot-unstuffing — and records
 * every session, so a test asserts on what went over the wire rather than on
 * what the client says it sent.
 *
 * Every step can be overridden with {@link FakeSmtpOptions.respond}: a reply
 * line, silence (`hang`), a dropped connection (`close`), or a reply followed
 * by a drop. That is enough to stage each failure the carrier classifies —
 * a 4xx at any step, a 5xx, a 535, a server that never answers, a connection
 * that dies after the message's `250`.
 *
 * TLS uses the throwaway hierarchy in `smtp-certificates.ts`.
 */
import net from 'node:net';
import tls from 'node:tls';
import { SMTP_SERVER_CERT_PEM, SMTP_SERVER_KEY_PEM } from './smtp-certificates.js';

export type FakeReply = string | { hang: true } | { close: true } | { reply: string; close: true };

export interface FakeStep {
  /** Zero-based index of the connection this step belongs to. */
  session: number;
  /** `GREETING`, `MESSAGE` (the body after DATA), or the upper-cased command verb. */
  verb: string;
  /** The command line as received; the message itself for `MESSAGE`. */
  line: string;
}

export interface FakeSmtpOptions {
  /** `starttls`: plaintext greeting, upgrade on STARTTLS (587). `implicit`: TLS from the first byte (465). */
  mode: 'starttls' | 'implicit';
  key?: string;
  cert?: string;
  /** Whether EHLO offers STARTTLS on a plaintext session. Default true. */
  advertiseStartTls?: boolean;
  /** Offered after TLS. Default `['PLAIN', 'LOGIN']`. */
  authMechanisms?: string[];
  username?: string;
  password?: string;
  /** Override any step; `undefined` keeps the default behaviour. */
  respond?: (step: FakeStep) => FakeReply | undefined;
  /** A fixed port — the e2e stand-in needs one the API can be configured with. Default: any free port. */
  port?: number;
}

export interface FakeSession {
  index: number;
  /** Every command line, in order (AUTH LOGIN's credential lines included). */
  commands: string[];
  /** Messages received after DATA, dot-unstuffed, one per completed DATA. */
  messages: string[];
  /** Whether the session was encrypted by the time it ended. */
  secure: boolean;
}

export const FAKE_SMTP_USERNAME = 'info@nolnk.test';
export const FAKE_SMTP_PASSWORD = 'fake-smtp-password-not-a-secret';

export class FakeSmtpServer {
  readonly sessions: FakeSession[] = [];
  readonly #options: FakeSmtpOptions;
  readonly #server: net.Server;
  readonly #sockets = new Set<net.Socket>();
  #port = 0;

  private constructor(options: FakeSmtpOptions) {
    this.#options = options;
    const onSocket = (socket: net.Socket) => this.#session(socket, options.mode === 'implicit');
    this.#server =
      options.mode === 'implicit'
        ? tls.createServer(this.#tlsContext(), onSocket)
        : net.createServer(onSocket);
    // A client that rejects our certificate aborts the handshake; that is the
    // outcome several tests want, not an error in the server.
    this.#server.on('tlsClientError', () => {});
  }

  static async start(options: FakeSmtpOptions): Promise<FakeSmtpServer> {
    const server = new FakeSmtpServer(options);
    await new Promise<void>((resolve, reject) => {
      server.#server.once('error', reject);
      server.#server.listen(options.port ?? 0, '127.0.0.1', resolve);
    });
    server.#port = (server.#server.address() as net.AddressInfo).port;
    return server;
  }

  get port(): number {
    return this.#port;
  }

  /** Every message the server received, across all sessions. */
  get messages(): string[] {
    return this.sessions.flatMap((session) => session.messages);
  }

  /** How many DATA commands were issued, across all sessions. */
  get dataCommands(): number {
    return this.sessions.reduce(
      (count, session) => count + session.commands.filter((c) => c.toUpperCase() === 'DATA').length,
      0,
    );
  }

  async stop(): Promise<void> {
    for (const socket of this.#sockets) socket.destroy();
    await new Promise<void>((resolve) => this.#server.close(() => resolve()));
  }

  #tlsContext(): tls.TlsOptions {
    return {
      key: this.#options.key ?? SMTP_SERVER_KEY_PEM,
      cert: this.#options.cert ?? SMTP_SERVER_CERT_PEM,
    };
  }

  #session(initial: net.Socket, secure: boolean): void {
    const session: FakeSession = {
      index: this.sessions.length,
      commands: [],
      messages: [],
      secure,
    };
    this.sessions.push(session);
    const options = this.#options;
    const username = options.username ?? FAKE_SMTP_USERNAME;
    const password = options.password ?? FAKE_SMTP_PASSWORD;
    const mechanisms = options.authMechanisms ?? ['PLAIN', 'LOGIN'];

    let socket = initial;
    let buffer = '';
    let state: 'command' | 'data' | 'login-user' | 'login-pass' = 'command';
    let dataLines: string[] = [];
    let loginUser = '';

    const track = (s: net.Socket) => {
      this.#sockets.add(s);
      s.on('error', () => {});
      s.on('close', () => this.#sockets.delete(s));
    };
    track(socket);

    const write = (line: string) => {
      if (!socket.destroyed) socket.write(`${line}\r\n`);
    };

    /** Apply an override; returns true when it replaced the default. */
    const override = (verb: string, line: string): boolean => {
      const scripted = options.respond?.({ session: session.index, verb, line });
      if (scripted === undefined) return false;
      if (typeof scripted === 'string') {
        write(scripted);
      } else if ('reply' in scripted) {
        write(scripted.reply);
        socket.destroy();
      } else if ('close' in scripted) {
        socket.destroy();
      }
      // `hang`: say nothing, keep the connection open.
      return true;
    };

    const ehlo = () => {
      const lines = ['fake.smtp.test greets you'];
      if (!session.secure && options.mode === 'starttls' && options.advertiseStartTls !== false) {
        lines.push('STARTTLS');
      }
      if (session.secure && mechanisms.length) lines.push(`AUTH ${mechanisms.join(' ')}`);
      lines.push('8BITMIME');
      lines.forEach((text, i) => write(`250${i === lines.length - 1 ? ' ' : '-'}${text}`));
    };

    const onCommand = (line: string) => {
      session.commands.push(line);
      if (state === 'login-user') {
        loginUser = Buffer.from(line, 'base64').toString('utf8');
        state = 'login-pass';
        if (!override('AUTH', line)) write('334 UGFzc3dvcmQ6');
        return;
      }
      if (state === 'login-pass') {
        state = 'command';
        const pass = Buffer.from(line, 'base64').toString('utf8');
        if (override('AUTH', line)) return;
        write(
          loginUser === username && pass === password
            ? '235 2.7.0 Authentication successful'
            : '535 5.7.8 Authentication credentials invalid',
        );
        return;
      }

      const verb = (line.split(/[\s:]/)[0] ?? '').toUpperCase();
      if (override(verb, line)) {
        // An overridden DATA that did not answer 354 leaves the session in
        // command mode, as a real server's refusal would.
        return;
      }
      switch (verb) {
        case 'EHLO':
          ehlo();
          return;
        case 'STARTTLS':
          if (session.secure || options.mode !== 'starttls') {
            write('503 5.5.1 TLS already active');
            return;
          }
          write('220 2.0.0 Ready to start TLS');
          upgrade();
          return;
        case 'AUTH': {
          const [, mechanism = '', initial] = line.split(' ');
          if (!session.secure) {
            write('530 5.7.0 Must issue a STARTTLS command first');
          } else if (mechanism.toUpperCase() === 'PLAIN' && initial) {
            const [, user, pass] = Buffer.from(initial, 'base64').toString('utf8').split('\0');
            write(
              user === username && pass === password
                ? '235 2.7.0 Authentication successful'
                : '535 5.7.8 Authentication credentials invalid',
            );
          } else if (mechanism.toUpperCase() === 'LOGIN') {
            state = 'login-user';
            write('334 VXNlcm5hbWU6');
          } else {
            write('504 5.5.4 Unrecognized authentication type');
          }
          return;
        }
        case 'MAIL':
          write('250 2.1.0 Ok');
          return;
        case 'RCPT':
          write('250 2.1.5 Ok');
          return;
        case 'DATA':
          state = 'data';
          dataLines = [];
          write('354 End data with <CR><LF>.<CR><LF>');
          return;
        case 'QUIT':
          write('221 2.0.0 Bye');
          socket.end();
          return;
        default:
          write('502 5.5.2 Command not recognized');
      }
    };

    const onDataLine = (line: string) => {
      if (line === '.') {
        state = 'command';
        const message = `${dataLines.join('\r\n')}\r\n`;
        session.messages.push(message);
        if (!override('MESSAGE', message)) write('250 2.0.0 Ok: queued as FAKE1');
        return;
      }
      dataLines.push(line.startsWith('..') ? line.slice(1) : line);
    };

    const onData = (chunk: Buffer) => {
      const reading = socket;
      buffer += chunk.toString('utf8');
      let newline = buffer.indexOf('\r\n');
      while (newline >= 0) {
        const line = buffer.slice(0, newline);
        buffer = buffer.slice(newline + 2);
        if (state === 'data') onDataLine(line);
        else onCommand(line);
        if (socket !== reading) return; // upgraded: the rest belongs to TLS
        newline = buffer.indexOf('\r\n');
      }
    };

    const upgrade = () => {
      socket.off('data', onData);
      buffer = '';
      const secureSocket = new tls.TLSSocket(socket, { isServer: true, ...this.#tlsContext() });
      track(secureSocket);
      secureSocket.on('secure', () => {
        session.secure = true;
      });
      socket = secureSocket;
      secureSocket.on('data', onData);
    };

    socket.on('data', onData);
    if (!override('GREETING', '')) write('220 fake.smtp.test ESMTP ready');
  }
}
