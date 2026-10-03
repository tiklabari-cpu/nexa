import { EMAIL_UNVERIFIED, signInErrorMessage } from './messages';
import { ApiClientError } from '../../lib/api-client';

function refusal(details?: Record<string, unknown>): ApiClientError {
  return new ApiClientError({
    type: 'not_allowed',
    status: 403,
    // The server's own prose, which must never be what the screen shows.
    message: 'Confirm your email address first.',
    requestId: 'req-u1',
    ...(details ? { details } : {}),
  });
}

describe('signInErrorMessage for an unconfirmed address (tm 257.16)', () => {
  it('sends the person to the web panel, in the app’s own words', () => {
    const message = signInErrorMessage(refusal({ reason: 'email_unverified' }));
    expect(message).toBe(EMAIL_UNVERIFIED);
    expect(message).toMatch(/web panel/);
    expect(message).not.toContain('Confirm your email address first.');
  });

  it('keeps the generic sentence for any other not_allowed refusal', () => {
    expect(signInErrorMessage(refusal({ reason: 'pilot_mode' }))).toBe(
      'Could not sign in. Try again.',
    );
    expect(signInErrorMessage(refusal())).toBe('Could not sign in. Try again.');
  });
});
