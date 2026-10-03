/**
 * The caller's side of a mail failure (tm 255.4).
 *
 * `deliver` is what lets a caller tell `unconfirmed` apart from `failed` without
 * a `catch` that blurs them; `mailFailureFields` is what it may log; and
 * `BackgroundMail` is what keeps the password reset's answer independent of the
 * carrier. The route-level proof — identical answers whatever the carrier does —
 * is `test/integration/auth-mail-delivery.test.ts`; these pin the pieces it is
 * built from.
 */
import { describe, expect, it } from 'vitest';
import {
  BackgroundMail,
  deliver,
  isCapRefusal,
  logUnsentMail,
  mailFailureFields,
  type MailOutcome,
} from './delivery.js';
import type { Mailer, Message } from './mailer.js';
import { MailCapError, PermanentMailError, TransientMailError } from './mail-error.js';

const MESSAGE: Message = {
  to: 'someone@example.test',
  subject: 'Reset your SiyahTuş password',
  body: 'https://app.example.test/reset-password?token=x',
  licenseId: null,
  kind: 'password_reset',
};

function failingWith(error: unknown): Mailer {
  return {
    send: async () => {
      throw error;
    },
  };
}

describe('deliver', () => {
  it('reports a send that completed as sent', async () => {
    const sent: Message[] = [];
    const outcome = await deliver({ send: async (m) => void sent.push(m) }, MESSAGE);
    expect(outcome).toEqual({ status: 'sent' });
    expect(sent).toEqual([MESSAGE]);
  });

  it('keeps unconfirmed apart from failed — it may have arrived', async () => {
    const error = new PermanentMailError({ code: 'unconfirmed', phase: 'message' });
    const outcome = await deliver(failingWith(error), MESSAGE);
    expect(outcome).toEqual({ status: 'unconfirmed', error });
  });

  it('reports a refusal, an exhausted retry and an unclassified error as failed', async () => {
    const refused = new PermanentMailError({ code: 'rejected', phase: 'rcpt_to', smtpCode: 550 });
    const exhausted = new TransientMailError({ code: 'timeout', phase: 'greeting' });
    const broken = new Error('ENOSPC: no space left on device');

    for (const error of [refused, exhausted, broken]) {
      await expect(deliver(failingWith(error), MESSAGE)).resolves.toEqual({
        status: 'failed',
        error,
      });
    }
  });
});

describe('mailFailureFields', () => {
  it('carries the classification of a carrier error', () => {
    const error = new PermanentMailError({
      code: 'rejected',
      phase: 'rcpt_to',
      smtpCode: 550,
      enhancedCode: '5.1.1',
      detail: 'Mailbox unavailable',
    });
    error.attempts = 1;

    expect(mailFailureFields(error)).toEqual({
      code: 'rejected',
      phase: 'rcpt_to',
      retryable: false,
      attempts: 1,
      smtpCode: 550,
      enhancedCode: '5.1.1',
      reply: 'Mailbox unavailable',
    });
  });

  it('masks an address inside an error nobody classified', () => {
    const fields = mailFailureFields(new Error('could not write mail for someone@example.test'));
    expect(fields).toMatchObject({ code: 'unexpected', name: 'Error' });
    expect(JSON.stringify(fields)).not.toContain('someone@example.test');
  });
});

describe('BackgroundMail', () => {
  it('returns before the mailer is touched, and reports the outcome afterwards', async () => {
    const calls: string[] = [];
    const background = new BackgroundMail({
      send: async () => {
        calls.push('send');
      },
    });
    const outcomes: MailOutcome[] = [];

    background.send(MESSAGE, (outcome) => outcomes.push(outcome));
    // Synchronously after `send` returns — and after the microtask queue has
    // drained, which is when an awaited reply would already have been written.
    await Promise.resolve();
    expect(calls).toEqual([]);

    await background.settled();
    expect(calls).toEqual(['send']);
    expect(outcomes).toEqual([{ status: 'sent' }]);
  });

  it('hands a failure to the callback instead of throwing it', async () => {
    const error = new TransientMailError({ code: 'connection', phase: 'connect' });
    const background = new BackgroundMail(failingWith(error));
    const outcomes: MailOutcome[] = [];

    background.send(MESSAGE, (outcome) => outcomes.push(outcome));
    await background.settled();

    expect(outcomes).toEqual([{ status: 'failed', error }]);
  });

  it('survives a callback that throws', async () => {
    const background = new BackgroundMail({ send: async () => undefined });
    const unhandled: unknown[] = [];
    const onUnhandled = (reason: unknown) => unhandled.push(reason);
    process.on('unhandledRejection', onUnhandled);
    try {
      background.send(MESSAGE, () => {
        throw new Error('the logger broke');
      });
      await background.settled();
      // One more turn, so a rejection that escaped would have been reported.
      await new Promise((resolve) => setImmediate(resolve));
    } finally {
      process.off('unhandledRejection', onUnhandled);
    }
    expect(unhandled).toEqual([]);
  });

  it('settles only once every send in flight has finished', async () => {
    let release!: () => void;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    const background = new BackgroundMail({ send: () => gate });
    let settled = false;

    background.send(MESSAGE, () => undefined);
    const waiting = background.settled().then(() => {
      settled = true;
    });
    await new Promise((resolve) => setImmediate(resolve));
    await new Promise((resolve) => setImmediate(resolve));
    expect(settled).toBe(false);

    release();
    await waiting;
    expect(settled).toBe(true);
  });
});

describe('BackgroundMail.asMailer (tm 256.4)', () => {
  it('resolves before the mailer is touched, and reports the message with its outcome', async () => {
    let release!: () => void;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    const sent: Message[] = [];
    const background = new BackgroundMail({
      send: async (message) => {
        await gate;
        sent.push(message);
      },
    });
    const reports: Array<{ message: Message; outcome: MailOutcome }> = [];
    const mailer = background.asMailer((message, outcome) => reports.push({ message, outcome }));

    // A carrier that has not answered does not hold the caller up.
    await mailer.send(MESSAGE);
    expect(sent).toEqual([]);
    expect(reports).toEqual([]);

    release();
    await background.settled();
    expect(sent).toEqual([MESSAGE]);
    expect(reports).toEqual([{ message: MESSAGE, outcome: { status: 'sent' } }]);
  });

  it('keeps a failure away from the caller and gives it to the callback', async () => {
    const error = new PermanentMailError({ code: 'rejected', phase: 'rcpt_to', smtpCode: 550 });
    const background = new BackgroundMail(failingWith(error));
    const outcomes: MailOutcome[] = [];

    await expect(
      background.asMailer((_message, outcome) => outcomes.push(outcome)).send(MESSAGE),
    ).resolves.toBeUndefined();
    await background.settled();

    expect(outcomes).toEqual([{ status: 'failed', error }]);
  });
});

describe('logUnsentMail (tm 256.4)', () => {
  function recorder() {
    const lines: Array<{ details: Record<string, unknown>; message: string }> = [];
    return {
      lines,
      warn: (details: Record<string, unknown>, message: string) => lines.push({ details, message }),
    };
  }

  it('is silent about a mail that went out', () => {
    const log = recorder();
    logUnsentMail(log, 'ticket.notice_mail', { status: 'sent' });
    expect(log.lines).toEqual([]);
  });

  it('names the event, the outcome and the classification — and not the recipient', () => {
    const log = recorder();
    const error = new TransientMailError({ code: 'connection', phase: 'connect' });
    logUnsentMail(log, 'ticket.notice_mail', { status: 'failed', error }, { ticket_id: 't-1' });

    expect(log.lines).toHaveLength(1);
    expect(log.lines[0]!.details).toEqual({
      event: 'ticket.notice_mail',
      outcome: 'failed',
      mail: mailFailureFields(error),
      ticket_id: 't-1',
    });
    expect(JSON.stringify(log.lines)).not.toContain(MESSAGE.to);
  });

  it('is silent about a daily cap refusal, which the cap has already logged (tm 257.14)', () => {
    const log = recorder();
    logUnsentMail(log, 'ticket.notice_mail', {
      status: 'failed',
      error: new MailCapError('external'),
    });
    expect(log.lines).toEqual([]);
  });

  it('logs unconfirmed as its own outcome, not as failed', () => {
    const log = recorder();
    const error = new PermanentMailError({ code: 'unconfirmed', phase: 'data' });
    logUnsentMail(log, 'chat.transcript_mail', { status: 'unconfirmed', error });
    expect(log.lines[0]!.details['outcome']).toBe('unconfirmed');
  });
});

describe('isCapRefusal (tm 257.14)', () => {
  it('is true only for a failed send whose error is the daily cap', async () => {
    const capped = await deliver(failingWith(new MailCapError('workspace')), MESSAGE);
    expect(capped.status).toBe('failed');
    expect(isCapRefusal(capped)).toBe(true);

    expect(isCapRefusal({ status: 'sent' })).toBe(false);
    expect(
      isCapRefusal({
        status: 'failed',
        error: new PermanentMailError({ code: 'rejected', phase: 'rcpt_to' }),
      }),
    ).toBe(false);
    expect(
      isCapRefusal({
        status: 'unconfirmed',
        error: new PermanentMailError({ code: 'unconfirmed', phase: 'data' }),
      }),
    ).toBe(false);
  });

  it('carries the scope and logs as cap_reached, contacting nothing', () => {
    const error = new MailCapError('global');
    expect(error.scope).toBe('global');
    expect(mailFailureFields(error)).toEqual({
      code: 'cap_reached',
      phase: 'compose',
      retryable: false,
      attempts: 1,
    });
  });
});
