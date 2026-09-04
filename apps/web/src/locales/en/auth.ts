import type { Messages } from '../merge.js';

/**
 * Sign-in and the public pages (sign up, forgot/reset, join, OAuth callback,
 * first-run onboarding).
 *
 * `auth.fields.*` and `auth.validation.*` are shared across every page in this
 * namespace on purpose: "Email", "Enter your email." and "Enter a valid email
 * address." are the same sentence wherever a form asks for an address, and one
 * key keeps that true instead of four copies drifting apart.
 */
export const auth: Messages = {
  // Shared field labels (SignInPage + PublicPages)
  'auth.fields.email': 'Email',
  'auth.fields.password': 'Password',
  'auth.fields.newPassword': 'New password',
  'auth.fields.choosePassword': 'Choose a password',
  'auth.fields.workspaceName': 'Workspace name',
  'auth.fields.yourName': 'Your name',
  'auth.fields.dataRegion': 'Data region',
  'auth.fields.twoFactorCode': 'Authentication code',
  'auth.fields.recoveryCode': 'Recovery code',

  // Shared validation messages (lib/form.tsx primitives, called with these overrides)
  'auth.validation.emailRequired': 'Enter your email.',
  'auth.validation.emailInvalid': 'Enter a valid email address.',
  'auth.validation.passwordRequired': 'Enter your password.',
  'auth.validation.nameRequired': 'Enter your name.',
  'auth.validation.organizationRequired': 'Enter a workspace name.',
  'auth.validation.passwordMinLength': 'Use at least {count} characters.',
  'auth.validation.codeRequired': 'Enter your code.',

  // Sign in
  'auth.signin.subtitle': 'Sign in to your workspace',
  'auth.signin.submit': 'Sign in',
  'auth.signin.submitting': 'Signing in…',
  'auth.signin.forgotPassword': 'Forgot your password?',
  'auth.signin.newHere': 'New here?',
  'auth.signin.createWorkspace': 'Create a workspace',
  'auth.signin.demoCredentials': 'Demo: owner@acme.localhost / nexa-demo-password',
  'auth.signin.ssoRequired':
    'This workspace requires single sign-on. Continue from your identity provider’s Nexa tile.',
  'auth.signin.ssoLinkFailed': 'Could not start single sign-on for that link.',
  'auth.signin.ssoStartFailed': 'Could not start single sign-on.',
  'auth.signin.ssoRedirecting': 'Taking you to your identity provider…',
  'auth.signin.noWorkspaces': 'This account is not a member of any workspace.',
  'auth.signin.invalidCredentials': 'Invalid email or password.',
  'auth.signin.workspaceOpenFailed': 'Could not open that workspace.',
  'auth.signin.chooseWorkspace': 'Choose a workspace',
  'auth.signin.ssoRequiredBadge': 'SSO required',
  'auth.signin.codeTitle': 'Enter your code',
  'auth.signin.codeSubtitle':
    '{organization} needs a code from your authenticator app to finish signing in.',
  'auth.signin.codeInvalid': 'That code is not right. Try again.',
  'auth.signin.codeRateLimited': 'Too many attempts. Wait before trying again.',
  'auth.signin.verify': 'Verify',
  'auth.signin.verifying': 'Verifying…',
  'auth.signin.useRecoveryCode': 'Use a recovery code instead',
  'auth.signin.useAuthenticatorCode': 'Use your authenticator app instead',
  'auth.signin.enrollmentRequiredTitle': 'Set up two-factor authentication',
  'auth.signin.enrollmentRequiredBody':
    '{organization} requires two-factor authentication, and this account has not set it up yet. Sign in to a workspace where you already have a session to set it up in Account Settings, then come back here.',
  'auth.signin.enrollmentRequiredHere':
    '{organization} requires two-factor authentication, and this account has not set it up yet. You can do it here — it takes about a minute, and you will need your authenticator app.',
  'auth.signin.enrollmentRequiredLink': 'Go to Account Settings',
  'auth.signin.enroll.startButton': 'Set it up now',
  'auth.signin.enroll.starting': 'Starting…',
  'auth.signin.enroll.failed': 'Could not start setup. Go back and sign in again.',
  'auth.signin.enroll.expired': 'This setup attempt has expired. Go back and sign in again.',
  'auth.signin.enroll.scanBody':
    'Add this setup key to your authenticator app, then type the code it shows.',
  'auth.signin.enroll.secretLabel': 'Setup key',
  'auth.signin.enroll.uriLabel': 'Setup link',
  'auth.signin.enroll.copy': 'Copy',
  'auth.signin.enroll.copied': 'Copied',
  'auth.signin.enroll.copySecretAriaLabel': 'Copy setup key',
  'auth.signin.enroll.copyUriAriaLabel': 'Copy setup link',
  'auth.signin.enroll.codeLabel': 'Authentication code',
  'auth.signin.enroll.codeRequired': 'Enter the code your authenticator app is showing.',
  'auth.signin.enroll.codeInvalid': 'That code is not right. Try again.',
  'auth.signin.enroll.activateButton': 'Verify & activate',
  'auth.signin.enroll.activating': 'Verifying…',
  'auth.signin.enroll.recoveryBody':
    'Each of these signs you in once if you lose your authenticator app. This is the only time they are shown.',
  'auth.signin.enroll.downloadButton': 'Download .txt',
  'auth.signin.enroll.savedConfirm': 'I have saved these codes somewhere safe.',
  'auth.signin.enroll.continueButton': 'Continue to sign in',

  // Sign up
  'auth.signup.title': 'Create a workspace',
  'auth.signup.subtitle': '14 days free. No card.',
  'auth.signup.alreadyHaveAccount': 'Already have an account?',
  'auth.signup.signIn': 'Sign in',
  'auth.signup.passwordHint': 'At least {count} characters. Length is the only rule.',
  'auth.signup.regionWarning':
    "This is where your workspace's data will live. It cannot be changed after your workspace is created.",
  'auth.signup.submit': 'Create workspace',
  'auth.signup.submitting': 'Creating…',
  'auth.signup.errorGeneric': 'Could not create that workspace.',
  'auth.signup.errorAccountExists': 'An account already exists for that email — sign in instead.',
  'auth.signup.errorRegionMismatch':
    'Nothing was created. This address only creates workspaces in {region} — choose that data region, or sign up at the address that serves the one you picked.',
  'auth.signup.errorRegionUnknown':
    'Nothing was created. This address does not create workspaces in the data region you picked.',
  'auth.signup.region.eu': 'European Union',
  'auth.signup.region.us': 'United States',

  // Forgot password
  'auth.forgotPassword.title': 'Reset your password',
  'auth.forgotPassword.subtitle': 'We will send you a link.',
  'auth.forgotPassword.sent':
    'If an account exists for that address, we sent a link. It expires in an hour.',
  'auth.forgotPassword.submit': 'Send link',
  'auth.forgotPassword.submitting': 'Sending…',

  // Reset password
  'auth.resetPassword.title': 'Choose a new password',
  'auth.resetPassword.subtitle': 'The link works once.',
  'auth.resetPassword.done':
    'Your password is set, and any other sessions have been signed out. You can sign in now.',
  'auth.resetPassword.hint': 'At least {count} characters.',
  'auth.resetPassword.submit': 'Set password',
  'auth.resetPassword.submitting': 'Saving…',
  'auth.resetPassword.errorInvalidLink': 'This link is no longer valid. Ask for a new one.',

  // Join (invitation acceptance)
  'auth.join.invalidTitle': 'This invitation is not valid',
  'auth.join.invalidSubtitle': 'It may have expired or been revoked.',
  'auth.join.invalidBody':
    'Ask whoever invited you to send a new one. Links work once and last seven days.',
  'auth.join.checkingTitle': 'Checking your invitation',
  'auth.join.checkingSubtitle': 'One moment.',
  'auth.join.loading': 'Loading…',
  'auth.join.title': 'Join {organization}',
  'auth.join.subtitle': 'Invited as {role} · {email}',
  'auth.join.existingAccountNotice':
    'You already have a Nexa account for this address. Accepting adds this workspace to it.',
  'auth.join.passwordHint': 'At least {count} characters.',
  'auth.join.submit': 'Join workspace',
  'auth.join.submitting': 'Joining…',
  'auth.join.errorGeneric': 'Could not accept that invitation.',

  // Shared across the public pages
  'auth.common.backToSignIn': 'Back to sign in',

  // OAuth/SSO callback
  'auth.callback.signingIn': 'Signing you in…',
  'auth.callback.noCode': 'This sign-in did not complete. Start again from the sign-in page.',
  'auth.callback.genericFailure': 'Sign-in failed.',

  // Onboarding wizard
  'auth.onboarding.steps.welcome': 'Welcome',
  'auth.onboarding.steps.website': 'Website',
  'auth.onboarding.steps.team': 'Team',
  'auth.onboarding.steps.sample': 'Sample data',
  'auth.onboarding.title': 'Set up your workspace',
  'auth.onboarding.stepProgress': 'Step {current} of {count}',
  'auth.onboarding.skip': 'Skip setup',
  'auth.onboarding.progressLabel': 'Setup progress',
  'auth.onboarding.back': 'Back',
  'auth.onboarding.continue': 'Continue',
  'auth.onboarding.finish': 'Finish setup',
  'auth.onboarding.finishing': 'Finishing…',
  'auth.onboarding.finishFailed': 'Could not finish setup. Try again.',
  'auth.onboarding.welcome.heading': 'Welcome{name} 👋',
  'auth.onboarding.welcome.body':
    'Your workspace is ready. A few quick steps get the widget onto your site, your teammates in, and a sample conversation in your inbox so it is not empty on day one.',
  'auth.onboarding.welcome.bulletWebsite': 'Connect your first website',
  'auth.onboarding.welcome.bulletTeam': 'Invite your team',
  'auth.onboarding.welcome.bulletSample': 'Add sample data to explore',
  'auth.onboarding.welcome.footer':
    'Every step is optional — you can skip any of them and set things up later in Settings.',
  'auth.onboarding.website.heading': 'Connect your first website',
  'auth.onboarding.website.body':
    'Add the site you want the chat widget on. This also trusts its domain, so the widget can start conversations there right away.',
  'auth.onboarding.website.domainLabel': 'Website domain',
  'auth.onboarding.website.domainPlaceholder': 'shop.example',
  'auth.onboarding.website.domainRequiredError': 'Enter a website domain.',
  'auth.onboarding.website.submit': 'Add website',
  'auth.onboarding.website.submitting': 'Adding…',
  'auth.onboarding.website.added': 'Added {domain}. You can add more sites later in Settings.',
  'auth.onboarding.team.heading': 'Invite your team',
  'auth.onboarding.team.body':
    'Add teammates by email — separate several with a space or comma. They join as agents; you can change roles later. Skip this if you are flying solo for now.',
  'auth.onboarding.team.emailsLabel': 'Teammate emails',
  'auth.onboarding.team.emailsPlaceholder': 'sam@example.com, priya@example.com',
  'auth.onboarding.team.emailsEmptyError': 'Enter at least one email address.',
  'auth.onboarding.team.emailsInvalidError': 'Not a valid address: {addresses}',
  'auth.onboarding.team.submit': 'Send invites',
  'auth.onboarding.team.submitting': 'Sending…',
  'auth.onboarding.team.sent.one': 'Sent {count} invitation.',
  'auth.onboarding.team.sent.other': 'Sent {count} invitations.',
  'auth.onboarding.sample.addLabel': 'Add sample data',
  'auth.onboarding.sample.body':
    'Populate your workspace with a few saved replies, tags and one sample conversation so you have something to explore straight away. You can archive or delete it any time.',
  'auth.onboarding.sample.submitting': 'Adding…',
  'auth.onboarding.sample.added': 'Sample data added',
  'auth.onboarding.sample.seeded':
    'Added {cannedResponses} saved replies, {tags} tags and {chats} sample conversation.',
  'auth.onboarding.sample.alreadySeeded': 'Sample data is already in your workspace.',
  'auth.onboarding.sample.footerBefore': 'When you are done, choose',
  'auth.onboarding.sample.footerAfter': 'to open your inbox.',
};
