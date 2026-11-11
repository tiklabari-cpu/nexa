import { describe, expect, it } from 'vitest';
import { MailCapError, PermanentMailError } from '../services/mail/mail-error.js';
import { smtpTestError, smtpTestResult } from './settings-email.js';

describe('the test e-mail answer (tm 464.3)', () => {
  it('reads a carrier failure as its classification, never its reply text', () => {
    const error = new PermanentMailError({
      code: 'rejected',
      phase: 'rcpt_to',
      smtpCode: 550,
      detail: 'no such user someone@example.test',
    });
    expect(smtpTestError(error)).toEqual({ code: 'rejected', phase: 'rcpt_to', smtp_code: 550 });
    expect(JSON.stringify(smtpTestError(error))).not.toContain('example.test');
  });

  it('names a daily cap, and a failure that was not the server’s', () => {
    expect(smtpTestError(new MailCapError('workspace'))).toEqual({
      code: 'cap_reached',
      phase: 'compose',
      smtp_code: null,
    });
    expect(smtpTestError(new Error('socket hang up at 10.0.0.1'))).toEqual({
      code: 'unexpected',
      phase: null,
      smtp_code: null,
    });
  });

  it('has no error when sent, or when another sender holds the row', () => {
    expect(smtpTestResult({ status: 'sent' }, 'a@x.test', 'smtp')).toEqual({
      status: 'sent',
      to: 'a@x.test',
      provider: 'smtp',
      error: null,
    });
    expect(smtpTestResult({ status: 'queued' }, 'a@x.test', 'file').error).toBeNull();
  });
});
