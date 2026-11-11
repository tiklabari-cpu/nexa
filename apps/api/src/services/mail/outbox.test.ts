/**
 * The mail outbox's pure decisions (tm 464.1): the backoff curve, what a send's
 * outcome means for its row, and the message a claimed row describes. The
 * queue itself — claim, lease, settle, RLS — is `test/integration/mail-outbox.test.ts`.
 */
import { describe, expect, it } from 'vitest';
import {
  MAIL_OUTBOX_MAX_ATTEMPTS,
  mailOutboxBackoffMs,
  messageFromClaim,
  settlementFor,
  type MailOutboxClaim,
} from './outbox.js';
import { MailCapError, PermanentMailError, TransientMailError } from './mail-error.js';

const policy = { maxAttempts: MAIL_OUTBOX_MAX_ATTEMPTS, backoffMs: mailOutboxBackoffMs };

describe('mailOutboxBackoffMs', () => {
  it('waits 1, 4 and 16 minutes, then an hour — about 81 minutes before the fifth try', () => {
    expect([1, 2, 3, 4, 5, 9].map(mailOutboxBackoffMs)).toEqual([
      60_000, 240_000, 960_000, 3_600_000, 3_600_000, 3_600_000,
    ]);
    const beforeFifth = [1, 2, 3, 4].reduce(
      (sum, attempt) => sum + mailOutboxBackoffMs(attempt),
      0,
    );
    expect(beforeFifth).toBe(4_860_000);
  });
});

describe('settlementFor', () => {
  it('records a sent mail as sent and an unconfirmed one as unconfirmed — never a retry', () => {
    expect(settlementFor({ status: 'sent' }, 1, policy)).toEqual({ status: 'sent' });
    const error = new PermanentMailError({ code: 'unconfirmed', phase: 'message' });
    expect(settlementFor({ status: 'unconfirmed', error }, 1, policy)).toEqual({
      status: 'unconfirmed',
      error: 'unconfirmed',
    });
  });

  it('retries a transient failure with the backoff of its attempt, until the last attempt', () => {
    const error = new TransientMailError({ code: 'timeout', phase: 'greeting' });
    expect(settlementFor({ status: 'failed', error }, 2, policy)).toEqual({
      status: 'pending',
      error: 'timeout',
      retryAfterMs: 240_000,
    });
    expect(settlementFor({ status: 'failed', error }, MAIL_OUTBOX_MAX_ATTEMPTS, policy)).toEqual({
      status: 'failed',
      error: 'timeout',
    });
  });

  it('fails at once what the carrier may not send again: a refusal, a refused login, a daily cap', () => {
    for (const error of [
      new PermanentMailError({ code: 'rejected', phase: 'rcpt_to', smtpCode: 550 }),
      new PermanentMailError({ code: 'auth', phase: 'auth', smtpCode: 535 }),
      new MailCapError('global'),
    ]) {
      expect(settlementFor({ status: 'failed', error }, 1, policy)).toEqual({
        status: 'failed',
        error: error.code,
      });
    }
  });

  it('retries an error that never reached a carrier, as `unexpected`', () => {
    expect(settlementFor({ status: 'failed', error: new Error('ENOSPC') }, 1, policy)).toEqual({
      status: 'pending',
      error: 'unexpected',
      retryAfterMs: 60_000,
    });
  });
});

describe('messageFromClaim', () => {
  const claim = (payload: unknown): MailOutboxClaim => ({
    id: '00000000-0000-4000-8000-000000000001',
    licenseId: 7n,
    kind: 'invitation',
    recipient: 'invitee@example.test',
    payload,
    attempts: 1,
    createdAt: new Date(0),
  });

  it('rebuilds the message from the columns and the payload', () => {
    expect(messageFromClaim(claim({ subject: 'Join', body: 'Welcome', locale: 'tr' }))).toEqual({
      to: 'invitee@example.test',
      licenseId: 7n,
      kind: 'invitation',
      subject: 'Join',
      body: 'Welcome',
      locale: 'tr',
    });
  });

  it('lets no payload name another recipient, workspace or kind', () => {
    const message = messageFromClaim(
      claim({ subject: 's', body: 'b', to: 'other@example.test', licenseId: null, kind: 'x' }),
    );
    expect(message).toMatchObject({
      to: 'invitee@example.test',
      licenseId: 7n,
      kind: 'invitation',
    });
  });

  it('answers null for a payload that is not a message', () => {
    for (const payload of [{}, null, [], 'text', { subject: 's' }, { subject: 1, body: 'b' }]) {
      expect(messageFromClaim(claim(payload))).toBeNull();
    }
  });
});
