import type { Messages } from '../merge.js';

/** Operator sign-in: password → authenticator → recovery codes, and the invitation page (tm 389.6). */
export const auth: Messages = {
  'auth.startup.loading': 'Loading…',
  'auth.title': 'Platform sign-in',
  'auth.sessionEnded': 'Your session ended. Sign in again.',

  'auth.signIn.title': 'Sign in to the platform panel',
  'auth.signIn.description': 'For SiyahTuş operators. A workspace login does not work here.',
  'auth.signIn.email': 'Email',
  'auth.signIn.password': 'Password',
  'auth.signIn.submit': 'Continue',
  'auth.signIn.submitting': 'Signing in…',
  'auth.signIn.invalid': 'The email or password is wrong, or this account is disabled.',

  'auth.verify.title': 'Enter your authenticator code',
  'auth.verify.description': 'Open your authenticator app and type the six-digit code.',
  'auth.verify.code': 'Authenticator code',
  'auth.verify.recoveryCode': 'Recovery code',
  'auth.verify.useRecovery': 'Use a recovery code instead',
  'auth.verify.useApp': 'Use the authenticator app instead',
  'auth.verify.submit': 'Verify',
  'auth.verify.submitting': 'Verifying…',
  'auth.verify.invalid':
    'That code did not work. Check the code and your device clock, then try again. A code works only once.',
  'auth.verify.recoveryLow': 'Only {count} recovery codes are left. Generate a new sheet soon.',

  'auth.enroll.title': 'Set up your authenticator',
  'auth.enroll.description':
    'Platform access needs a second factor. Add this account to an authenticator app, then confirm with a code.',
  'auth.enroll.secretLabel': 'Secret key',
  'auth.enroll.secretHint': 'Type it into your authenticator app, or open the link below.',
  'auth.enroll.openLink': 'Open in the authenticator app',
  'auth.enroll.code': 'Code from the app',
  'auth.enroll.submit': 'Activate',
  'auth.enroll.submitting': 'Activating…',
  'auth.enroll.invalid': 'That code did not match. Check your device clock and try again.',
  'auth.enroll.starting': 'Preparing your secret…',

  'auth.recovery.title': 'Save your recovery codes',
  'auth.recovery.description':
    'Each code works once if you lose your authenticator. They are shown only now.',
  'auth.recovery.list': 'Recovery codes',
  'auth.recovery.download': 'Download as a file',
  'auth.recovery.saved': 'I have saved these codes',
  'auth.recovery.continue': 'Continue to the panel',

  'auth.invite.title': 'Accept your invitation',
  'auth.invite.description':
    'Choose a password of at least 12 characters. Next you set up the authenticator.',
  'auth.invite.password': 'Password',
  'auth.invite.passwordHint': 'At least 12 characters.',
  'auth.invite.submit': 'Accept and continue',
  'auth.invite.submitting': 'Accepting…',
  'auth.invite.missingToken':
    'This invitation link is incomplete. Open the link from the email again.',
  'auth.invite.invalid': 'This invitation is not valid any more. Ask a superadmin for a new one.',
  'auth.invite.signIn': 'Back to sign-in',

  'auth.cancel': 'Use a different account',
};
