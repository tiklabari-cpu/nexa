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
import { BackgroundMail, deliver, mailFailureFields, type MailOutcome } from './delivery.js';
import type { Mailer, Message } from './mailer.js';
import { PermanentMailError, TransientMailError } from './mail-error.js';

const MESSAGE: Message = {
  to: 'someone@example.test',
  subject: 'Reset your SiyahTuş password',
  body: 'https://app.example.test/reset-password?token=x',
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
