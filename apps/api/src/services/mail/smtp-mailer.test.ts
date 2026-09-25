/**
 * The SMTP carrier against a fake server (tm 255.3).
 *
 * No test here reaches the network: `FakeSmtpServer` listens on 127.0.0.1 and
 * speaks real SMTP over real TLS with throwaway certificates, so what is
 * asserted is what crossed the socket. The numbered blocks follow the task's
 * test strategy: (1) the happy path, (2) the envelope and encoding, (3) 4xx is
 * transient and retried on an exponential curve, (4) 5xx is permanent with no
 * retry, (5) a rejected login is permanent, (6) a timeout is transient, (7)
 * nothing is sent twice once the server may have it, (8) certificate
 * verification cannot be turned off, (9) no credential, recipient or body
 * reaches a log line.
 */
import { Writable } from 'node:stream';
import pino from 'pino';
import { afterEach, describe, expect, it } from 'vitest';
import {
  FAKE_SMTP_PASSWORD,
  FAKE_SMTP_USERNAME,
  FakeSmtpServer,
  type FakeSmtpOptions,
} from '../../../test/helpers/fake-smtp-server.js';
import {
  SMTP_SELF_SIGNED_CERT_PEM,
  SMTP_SELF_SIGNED_KEY_PEM,
  SMTP_TEST_CA_PEM,
  SMTP_WRONG_HOST_CERT_PEM,
  SMTP_WRONG_HOST_KEY_PEM,
} from '../../../test/helpers/smtp-certificates.js';
import { MailDeliveryError, PermanentMailError, TransientMailError } from './mail-error.js';
import type { Message } from './mailer.js';
import {
  SMTP_RETRY_BACKOFF_CAP_MS,
  SMTP_SECRET_LOG_PATHS,
  SmtpMailer,
  smtpRetryBackoffMs,
  type MailLogger,
  type SmtpMailerOptions,
} from './smtp-mailer.js';

const FROM = 'info@nolnk.test';
const TO = 'jane.customer@example.test';

const MESSAGE: Message = {
  to: TO,
  subject: 'Reset your password',
  body: 'Follow this link within the hour:\nhttps://app.example.test/reset-password?token=Zq81-secret-body-token',
  kind: 'password_reset',
};

const PLAIN_TOKEN = Buffer.from(`\0${FAKE_SMTP_USERNAME}\0${FAKE_SMTP_PASSWORD}`).toString(
  'base64',
);
const PASSWORD_B64 = Buffer.from(FAKE_SMTP_PASSWORD).toString('base64');

const servers: FakeSmtpServer[] = [];

afterEach(async () => {
  await Promise.all(servers.splice(0).map((server) => server.stop()));
});

async function startServer(options: FakeSmtpOptions): Promise<FakeSmtpServer> {
  const server = await FakeSmtpServer.start(options);
  servers.push(server);
  return server;
}

interface LogEntry {
  level: string;
  details: Record<string, unknown>;
  message: string;
}

function recordingLogger(): { logger: MailLogger; entries: LogEntry[] } {
  const entries: LogEntry[] = [];
  const record = (level: string) => (details: Record<string, unknown>, message: string) =>
    entries.push({ level, details, message });
  return {
    entries,
    logger: {
      debug: record('debug'),
      info: record('info'),
      warn: record('warn'),
      error: record('error'),
    },
  };
}

function carrier(
  server: FakeSmtpServer,
  overrides: { timeoutMs?: number; password?: string; secure?: boolean } & SmtpMailerOptions = {},
) {
  const sleeps: number[] = [];
  const { logger, entries } = recordingLogger();
  const { timeoutMs, password, secure, ...options } = overrides;
  const mailer = new SmtpMailer(
    {
      host: '127.0.0.1',
      port: server.port,
      secure: secure ?? false,
      username: FAKE_SMTP_USERNAME,
      password: password ?? FAKE_SMTP_PASSWORD,
      from: FROM,
      timeoutMs: timeoutMs ?? 2_000,
    },
    {
      logger,
      ca: SMTP_TEST_CA_PEM,
      sleep: async (ms) => {
        sleeps.push(ms);
      },
      now: () => new Date('2026-09-22T12:00:00Z'),
      ...options,
    },
  );
  return { mailer, sleeps, entries };
}

async function failure(promise: Promise<unknown>): Promise<MailDeliveryError> {
  try {
    await promise;
  } catch (error) {
    if (error instanceof MailDeliveryError) return error;
    throw error;
  }
  throw new Error('expected the send to fail');
}

/** The verbs a session issued, credentials and arguments dropped. */
function verbs(server: FakeSmtpServer, session = 0): string[] {
  return server.sessions[session]!.commands.map((line) => line.split(/[\s:]/)[0]!.toUpperCase());
}

function decodeQuotedPrintable(encoded: string): string {
  const joined = encoded.replace(/=\r\n/g, '');
  const bytes: number[] = [];
  for (let i = 0; i < joined.length; i += 1) {
    const hex = joined.slice(i + 1, i + 3);
    if (joined[i] === '=' && /^[0-9A-F]{2}$/.test(hex)) {
      bytes.push(parseInt(hex, 16));
      i += 2;
    } else {
      bytes.push(joined.charCodeAt(i));
    }
  }
  return Buffer.from(bytes).toString('utf8');
}

describe('(1) happy path', () => {
  it('goes EHLO → STARTTLS → EHLO → AUTH → MAIL FROM → RCPT TO → DATA and resolves on the 250', async () => {
    const server = await startServer({ mode: 'starttls' });
    const { mailer, entries } = carrier(server);

    await expect(mailer.send(MESSAGE)).resolves.toBeUndefined();

    expect(server.sessions).toHaveLength(1);
    expect(verbs(server)).toEqual([
      'EHLO',
      'STARTTLS',
      'EHLO',
      'AUTH',
      'MAIL',
      'RCPT',
      'DATA',
      'QUIT',
    ]);
    expect(server.sessions[0]!.secure).toBe(true);
    expect(server.sessions[0]!.commands[3]).toBe(`AUTH PLAIN ${PLAIN_TOKEN}`);
    expect(server.messages).toHaveLength(1);
    const accepted = entries.find((entry) => entry.details.event === 'smtp.accepted');
    expect(accepted?.level).toBe('info');
    expect(accepted?.details).toMatchObject({ attempt: 1, auth: 'PLAIN', kind: 'password_reset' });
    expect(String(accepted?.details.tls)).toMatch(/^TLSv1\.[23]$/);
  });

  it('speaks TLS from the first byte when secure (port 465) — no STARTTLS', async () => {
    const server = await startServer({ mode: 'implicit' });
    const { mailer } = carrier(server, { secure: true });

    await mailer.send(MESSAGE);

    expect(verbs(server)).toEqual(['EHLO', 'AUTH', 'MAIL', 'RCPT', 'DATA', 'QUIT']);
    expect(server.sessions[0]!.secure).toBe(true);
    expect(server.messages).toHaveLength(1);
  });

  it('falls back to AUTH LOGIN when PLAIN is not offered', async () => {
    const server = await startServer({ mode: 'starttls', authMechanisms: ['LOGIN'] });
    const { mailer } = carrier(server);

    await mailer.send(MESSAGE);

    const commands = server.sessions[0]!.commands;
    const login = commands.indexOf('AUTH LOGIN');
    expect(login).toBeGreaterThan(0);
    expect(Buffer.from(commands[login + 1]!, 'base64').toString()).toBe(FAKE_SMTP_USERNAME);
    expect(Buffer.from(commands[login + 2]!, 'base64').toString()).toBe(FAKE_SMTP_PASSWORD);
    expect(server.messages).toHaveLength(1);
  });
});

describe('(2) envelope and encoding', () => {
  it('uses SMTP_FROM and the recipient for the envelope and carries a non-ASCII subject and body intact', async () => {
    const server = await startServer({ mode: 'starttls' });
    const { mailer } = carrier(server);
    const subject = 'Şifre sıfırlama — SiyahTuş çalışma alanınız "Ağaç İşleri"';
    const body =
      'Merhaba Çağla,\n.bu satır noktayla başlıyor\n\nBağlantı: https://app.example.test/r?t=a=b';

    await mailer.send({ ...MESSAGE, subject, body });

    const commands = server.sessions[0]!.commands;
    expect(commands).toContain(`MAIL FROM:<${FROM}>`);
    expect(commands).toContain(`RCPT TO:<${TO}>`);

    const message = server.messages[0]!;
    const head = message.slice(0, message.indexOf('\r\n\r\n'));
    const encodedBody = message.slice(message.indexOf('\r\n\r\n') + 4);
    expect(head).toMatch(new RegExp(`^From: ${FROM}$`, 'm'));
    expect(head).toMatch(new RegExp(`^To: ${TO}$`, 'm'));
    expect(head).toMatch(/^Message-ID: <[0-9a-f-]{36}@nolnk\.test>$/m);
    expect(head).toMatch(/^Date: Tue, 22 Sep 2026 12:00:00 \+0000$/m);

    const subjectValue = /^Subject: (.*(?:\r\n .*)*)/m.exec(head)![1]!;
    const decodedSubject = subjectValue
      .split(/\r\n | /)
      .map((word) =>
        Buffer.from(/^=\?UTF-8\?B\?(.*)\?=$/.exec(word)![1]!, 'base64').toString('utf8'),
      )
      .join('');
    expect(decodedSubject).toBe(subject);
    // The server dot-unstuffed the line that began with "."; the body arrives whole.
    expect(decodeQuotedPrintable(encodedBody)).toBe(`${body.replace(/\n/g, '\r\n')}\r\n`);
  });

  it('refuses a recipient that is not an address without contacting the server', async () => {
    const server = await startServer({ mode: 'starttls' });
    const { mailer } = carrier(server);

    const error = await failure(
      mailer.send({ ...MESSAGE, to: 'jane@example.test>\r\nRCPT TO:<x@y.test' }),
    );

    expect(error).toBeInstanceOf(PermanentMailError);
    expect(error.code).toBe('invalid_message');
    expect(server.sessions).toHaveLength(0);
  });
});

describe('(3) 4xx is transient: retried, on an exponential curve', () => {
  it('retries the configured number of times and then surfaces a TransientMailError', async () => {
    const server = await startServer({
      mode: 'starttls',
      respond: ({ verb }) =>
        verb === 'RCPT' ? '451 4.3.0 Mail server temporarily rejected message' : undefined,
    });
    const { mailer, sleeps } = carrier(server, { maxAttempts: 3 });

    const error = await failure(mailer.send(MESSAGE));

    expect(error).toBeInstanceOf(TransientMailError);
    expect(error).toMatchObject({
      retryable: true,
      code: 'rejected',
      phase: 'rcpt_to',
      smtpCode: 451,
      enhancedCode: '4.3.0',
      attempts: 3,
    });
    expect(server.sessions).toHaveLength(3);
    expect(sleeps).toEqual([1_000, 2_000]);
    expect(server.dataCommands).toBe(0);
  });

  it('delivers exactly once when a later attempt succeeds', async () => {
    const server = await startServer({
      mode: 'starttls',
      respond: ({ verb, session }) =>
        verb === 'MAIL' && session < 2
          ? '421 4.7.0 Try again later, closing connection'
          : undefined,
    });
    const { mailer, sleeps } = carrier(server, { maxAttempts: 3 });

    await mailer.send(MESSAGE);

    expect(server.sessions).toHaveLength(3);
    expect(server.messages).toHaveLength(1);
    expect(sleeps).toEqual([1_000, 2_000]);
  });

  it('grows the wait exponentially from one second and caps it', () => {
    expect([1, 2, 3, 4, 5, 6].map(smtpRetryBackoffMs)).toEqual([
      1_000, 2_000, 4_000, 8_000, 8_000, 8_000,
    ]);
    expect(smtpRetryBackoffMs(50)).toBe(SMTP_RETRY_BACKOFF_CAP_MS);
  });
});

describe('(4) 5xx is permanent: no retry at all', () => {
  it('stops after the first 5xx — one session, no wait', async () => {
    const server = await startServer({
      mode: 'starttls',
      respond: ({ verb }) =>
        verb === 'RCPT' ? `550 5.1.1 <${TO}>: Recipient address rejected: User unknown` : undefined,
    });
    const { mailer, sleeps } = carrier(server, { maxAttempts: 5 });

    const error = await failure(mailer.send(MESSAGE));

    expect(error).toBeInstanceOf(PermanentMailError);
    expect(error).toMatchObject({ retryable: false, code: 'rejected', smtpCode: 550, attempts: 1 });
    expect(server.sessions).toHaveLength(1);
    expect(sleeps).toEqual([]);
    expect(server.dataCommands).toBe(0);
  });

  it('does not retry a 5xx to the message itself either', async () => {
    const server = await startServer({
      mode: 'starttls',
      respond: ({ verb }) =>
        verb === 'MESSAGE' ? '554 5.7.1 Message rejected as spam' : undefined,
    });
    const { mailer, sleeps } = carrier(server, { maxAttempts: 5 });

    const error = await failure(mailer.send(MESSAGE));

    expect(error).toMatchObject({
      retryable: false,
      code: 'rejected',
      phase: 'message',
      smtpCode: 554,
    });
    expect(server.sessions).toHaveLength(1);
    expect(sleeps).toEqual([]);
  });
});

describe('(5) a rejected login is permanent', () => {
  it('treats 535 as permanent and never reaches MAIL FROM', async () => {
    const server = await startServer({ mode: 'starttls' });
    const { mailer, sleeps } = carrier(server, { password: 'wrong-password', maxAttempts: 5 });

    const error = await failure(mailer.send(MESSAGE));

    expect(error).toBeInstanceOf(PermanentMailError);
    expect(error).toMatchObject({
      code: 'auth',
      phase: 'auth',
      smtpCode: 535,
      enhancedCode: '5.7.8',
    });
    expect(server.sessions).toHaveLength(1);
    expect(verbs(server)).not.toContain('MAIL');
    expect(sleeps).toEqual([]);
  });

  it('treats 535 after AUTH LOGIN the same way', async () => {
    const server = await startServer({ mode: 'starttls', authMechanisms: ['LOGIN'] });
    const { mailer } = carrier(server, { password: 'wrong-password', maxAttempts: 5 });

    const error = await failure(mailer.send(MESSAGE));

    expect(error).toMatchObject({ retryable: false, code: 'auth', smtpCode: 535 });
    expect(server.sessions).toHaveLength(1);
  });

  it('retries a temporary authentication failure (454)', async () => {
    const server = await startServer({
      mode: 'starttls',
      respond: ({ verb, session }) =>
        verb === 'AUTH' && session === 0 ? '454 4.7.0 Temporary authentication failure' : undefined,
    });
    const { mailer } = carrier(server);

    await mailer.send(MESSAGE);

    expect(server.sessions).toHaveLength(2);
    expect(server.messages).toHaveLength(1);
  });

  it('refuses a server that offers no mechanism it can log in with', async () => {
    const server = await startServer({ mode: 'starttls', authMechanisms: ['CRAM-MD5'] });
    const { mailer } = carrier(server);

    const error = await failure(mailer.send(MESSAGE));

    expect(error).toMatchObject({ retryable: false, code: 'auth' });
    expect(verbs(server)).not.toContain('MAIL');
  });
});

describe('(6) a timeout is transient', () => {
  it('times out a server that accepts the connection and never greets, and retries it', async () => {
    const server = await startServer({
      mode: 'starttls',
      respond: ({ verb }) => (verb === 'GREETING' ? { hang: true } : undefined),
    });
    const { mailer, sleeps } = carrier(server, { timeoutMs: 150, maxAttempts: 2 });

    const error = await failure(mailer.send(MESSAGE));

    expect(error).toBeInstanceOf(TransientMailError);
    expect(error).toMatchObject({ code: 'timeout', phase: 'greeting', attempts: 2 });
    expect(server.sessions).toHaveLength(2);
    expect(sleeps).toEqual([1_000]);
  });

  it('applies the timeout per command, not only to the connection', async () => {
    const server = await startServer({
      mode: 'starttls',
      respond: ({ verb }) => (verb === 'RCPT' ? { hang: true } : undefined),
    });
    const { mailer } = carrier(server, { timeoutMs: 150, maxAttempts: 1 });

    const error = await failure(mailer.send(MESSAGE));

    expect(error).toMatchObject({ retryable: true, code: 'timeout', phase: 'rcpt_to' });
    expect(server.dataCommands).toBe(0);
  });

  it('treats a refused connection as transient', async () => {
    const closed = await FakeSmtpServer.start({ mode: 'starttls' });
    const port = closed.port;
    await closed.stop();
    const { mailer } = carrier({ port } as FakeSmtpServer, { maxAttempts: 2 });

    const error = await failure(mailer.send(MESSAGE));

    expect(error).toMatchObject({
      retryable: true,
      code: 'connection',
      phase: 'connect',
      attempts: 2,
    });
  });
});

describe('(7) never twice: nothing is resent once the server may have the message', () => {
  it('resolves when the connection drops right after the 250 — one DATA, one message', async () => {
    const server = await startServer({
      mode: 'starttls',
      respond: ({ verb }) =>
        verb === 'MESSAGE' ? { reply: '250 2.0.0 Ok: queued as FAKE1', close: true } : undefined,
    });
    const { mailer, sleeps } = carrier(server, { maxAttempts: 3 });

    await expect(mailer.send(MESSAGE)).resolves.toBeUndefined();

    expect(server.sessions).toHaveLength(1);
    expect(server.dataCommands).toBe(1);
    expect(server.messages).toHaveLength(1);
    expect(sleeps).toEqual([]);
  });

  it('does not retry when the 250 never arrives after the terminating dot (timeout)', async () => {
    const server = await startServer({
      mode: 'starttls',
      respond: ({ verb }) => (verb === 'MESSAGE' ? { hang: true } : undefined),
    });
    const { mailer, sleeps } = carrier(server, { timeoutMs: 200, maxAttempts: 3 });

    const error = await failure(mailer.send(MESSAGE));

    expect(error).toBeInstanceOf(PermanentMailError);
    expect(error).toMatchObject({ code: 'unconfirmed', phase: 'message', attempts: 1 });
    expect(server.sessions).toHaveLength(1);
    expect(server.dataCommands).toBe(1);
    expect(sleeps).toEqual([]);
  });

  it('does not retry when the connection drops after the terminating dot', async () => {
    const server = await startServer({
      mode: 'starttls',
      respond: ({ verb }) => (verb === 'MESSAGE' ? { close: true } : undefined),
    });
    const { mailer } = carrier(server, { maxAttempts: 3 });

    const error = await failure(mailer.send(MESSAGE));

    expect(error).toMatchObject({ retryable: false, code: 'unconfirmed' });
    expect(server.sessions).toHaveLength(1);
    expect(server.dataCommands).toBe(1);
  });

  it('still retries a drop that happens before the message is handed over', async () => {
    // The contrast that makes the two tests above meaningful: the same dropped
    // connection one step earlier is safe to retry, because nothing was sent.
    const server = await startServer({
      mode: 'starttls',
      respond: ({ verb, session }) =>
        verb === 'DATA' && session === 0 ? { close: true } : undefined,
    });
    const { mailer } = carrier(server, { maxAttempts: 3 });

    await mailer.send(MESSAGE);

    expect(server.sessions).toHaveLength(2);
    expect(server.messages).toHaveLength(1);
  });

  it('retries an explicit 4xx to the message — the server said it did not take it', async () => {
    const server = await startServer({
      mode: 'starttls',
      respond: ({ verb, session }) =>
        verb === 'MESSAGE' && session === 0 ? '451 4.3.0 Queue temporarily unavailable' : undefined,
    });
    const { mailer } = carrier(server, { maxAttempts: 3 });

    await mailer.send(MESSAGE);

    expect(server.sessions).toHaveLength(2);
    // Received twice, accepted once: the first copy was refused with a 4xx.
    expect(server.messages).toHaveLength(2);
    // One message, one identity: every attempt carries the same Message-ID.
    const ids = server.messages.map((message) => /^Message-ID: (.*)$/m.exec(message)![1]);
    expect(new Set(ids).size).toBe(1);
  });
});

describe('(8) TLS is mandatory and its verification cannot be switched off (NFR-S9)', () => {
  it('refuses a server whose certificate chains to nothing it trusts — before any credential is sent', async () => {
    const server = await startServer({
      mode: 'starttls',
      key: SMTP_SELF_SIGNED_KEY_PEM,
      cert: SMTP_SELF_SIGNED_CERT_PEM,
    });
    const { mailer, sleeps } = carrier(server, { maxAttempts: 3 });

    const error = await failure(mailer.send(MESSAGE));

    expect(error).toBeInstanceOf(PermanentMailError);
    expect(error).toMatchObject({ code: 'tls', phase: 'starttls' });
    expect(verbs(server)).toEqual(['EHLO', 'STARTTLS']);
    expect(server.sessions).toHaveLength(1);
    expect(sleeps).toEqual([]);
  });

  it('refuses an untrusted certificate on an implicit-TLS connection too', async () => {
    const server = await startServer({
      mode: 'implicit',
      key: SMTP_SELF_SIGNED_KEY_PEM,
      cert: SMTP_SELF_SIGNED_CERT_PEM,
    });
    const { mailer } = carrier(server, { secure: true });

    const error = await failure(mailer.send(MESSAGE));

    expect(error).toMatchObject({ retryable: false, code: 'tls', phase: 'connect' });
    expect(server.sessions[0]?.commands ?? []).toEqual([]);
  });

  it('refuses a trusted certificate issued for another host', async () => {
    const server = await startServer({
      mode: 'starttls',
      key: SMTP_WRONG_HOST_KEY_PEM,
      cert: SMTP_WRONG_HOST_CERT_PEM,
    });
    const { mailer } = carrier(server);

    const error = await failure(mailer.send(MESSAGE));

    expect(error).toMatchObject({ retryable: false, code: 'tls' });
    expect(verbs(server)).not.toContain('AUTH');
  });

  it('keeps refusing it under NODE_TLS_REJECT_UNAUTHORIZED=0', async () => {
    // The process-wide escape hatch only changes Node's *default*; the carrier
    // sets `rejectUnauthorized: true` explicitly, so the hatch does not reach it.
    const server = await startServer({
      mode: 'starttls',
      key: SMTP_SELF_SIGNED_KEY_PEM,
      cert: SMTP_SELF_SIGNED_CERT_PEM,
    });
    const { mailer } = carrier(server);
    const previous = process.env.NODE_TLS_REJECT_UNAUTHORIZED;
    // Node prints its "makes TLS connections … insecure" warning once here —
    // the proof that the hatch really was open while the carrier refused.
    process.env.NODE_TLS_REJECT_UNAUTHORIZED = '0';
    try {
      const error = await failure(mailer.send(MESSAGE));
      expect(error).toMatchObject({ code: 'tls' });
      expect(verbs(server)).not.toContain('AUTH');
    } finally {
      if (previous === undefined) delete process.env.NODE_TLS_REJECT_UNAUTHORIZED;
      else process.env.NODE_TLS_REJECT_UNAUTHORIZED = previous;
    }
  });

  it('refuses to continue in plaintext when STARTTLS is not offered', async () => {
    const server = await startServer({ mode: 'starttls', advertiseStartTls: false });
    const { mailer } = carrier(server, { maxAttempts: 3 });

    const error = await failure(mailer.send(MESSAGE));

    expect(error).toMatchObject({ retryable: false, code: 'tls', phase: 'starttls' });
    // Nothing after EHLO: no AUTH, no MAIL, and certainly no message in the clear.
    expect(verbs(server)).toEqual(['EHLO']);
    expect(server.sessions).toHaveLength(1);
  });

  it('refuses plaintext the server slips in after agreeing to STARTTLS (command injection)', async () => {
    const server = await startServer({
      mode: 'starttls',
      respond: ({ verb }) =>
        verb === 'STARTTLS' ? '220 2.0.0 Ready to start TLS\r\n250 2.0.0 injected' : undefined,
    });
    const { mailer } = carrier(server);

    const error = await failure(mailer.send(MESSAGE));

    expect(error).toMatchObject({ retryable: false, code: 'protocol', phase: 'starttls' });
    expect(verbs(server)).toEqual(['EHLO', 'STARTTLS']);
  });
});

describe('(9) no credential, recipient or body reaches a log line', () => {
  /** Everything that must never be logged, in every form it crosses the wire in. */
  const FORBIDDEN = [
    FAKE_SMTP_PASSWORD,
    PASSWORD_B64,
    PLAIN_TOKEN,
    FAKE_SMTP_USERNAME,
    TO,
    MESSAGE.subject,
    'Zq81-secret-body-token',
  ];

  it('keeps them out of the error and the log even when the server echoes them back', async () => {
    const server = await startServer({
      mode: 'starttls',
      respond: ({ verb }) =>
        verb === 'RCPT'
          ? `550 5.1.1 <${TO.toUpperCase()}> unknown; you sent ${PLAIN_TOKEN} as ${FAKE_SMTP_PASSWORD}`
          : undefined,
    });
    const { mailer, entries } = carrier(server);

    const error = await failure(mailer.send(MESSAGE));

    const failed = entries.find((entry) => entry.details.event === 'smtp.failed');
    expect(failed?.level).toBe('error');
    expect(failed?.details).toMatchObject({
      code: 'rejected',
      smtpCode: 550,
      enhancedCode: '5.1.1',
    });
    // The reply survives, scrubbed — it is what an operator debugs with.
    expect(error.detail).toMatch(/unknown/);
    const written = JSON.stringify(entries) + error.message + String(error.detail);
    for (const value of FORBIDDEN) expect(written).not.toContain(value);
  });

  it('keeps them out of a real pino stream through a failed login and a retry', async () => {
    const server = await startServer({
      mode: 'starttls',
      respond: ({ verb, session }) =>
        verb === 'AUTH' && session === 0 ? '454 4.7.0 Temporary authentication failure' : undefined,
    });
    const lines: string[] = [];
    const sink = new Writable({
      write(chunk, _encoding, done) {
        lines.push(String(chunk));
        done();
      },
    });
    const logger = pino(
      { level: 'debug', redact: { paths: SMTP_SECRET_LOG_PATHS, censor: '[redacted]' } },
      sink,
    );
    const { mailer } = carrier(server, { logger, password: 'wrong-password' });

    await failure(mailer.send(MESSAGE));

    const output = lines.join('');
    expect(output).toMatch(/"event":"smtp\.retry"/);
    expect(output).toMatch(/"event":"smtp\.failed"/);
    for (const value of [...FORBIDDEN, 'wrong-password']) expect(output).not.toContain(value);
  });

  it('censors the configuration if anyone logs it', () => {
    const lines: string[] = [];
    const sink = new Writable({
      write(chunk, _encoding, done) {
        lines.push(String(chunk));
        done();
      },
    });
    const logger = pino({ redact: { paths: SMTP_SECRET_LOG_PATHS, censor: '[redacted]' } }, sink);

    logger.info(
      { SMTP_PASSWORD: FAKE_SMTP_PASSWORD, SMTP_USERNAME: FAKE_SMTP_USERNAME },
      'top level',
    );
    logger.info(
      { env: { SMTP_PASSWORD: FAKE_SMTP_PASSWORD, SMTP_HOST: 'mail.example.test' } },
      'env',
    );
    logger.info({ smtp: { username: FAKE_SMTP_USERNAME, password: FAKE_SMTP_PASSWORD } }, 'config');
    logger.info({ mail: { smtp: { password: FAKE_SMTP_PASSWORD } } }, 'nested');

    const output = lines.join('');
    expect(output).not.toContain(FAKE_SMTP_PASSWORD);
    expect(output).not.toContain(FAKE_SMTP_USERNAME);
    // Only the credentials go; the host is not a secret (ADR §9.3).
    expect(output).toContain('mail.example.test');
  });
});
