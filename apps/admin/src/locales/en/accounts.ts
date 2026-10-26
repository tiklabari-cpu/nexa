import type { Messages } from '../merge.js';

/** The account search, the account detail and its actions (tm 389.11). */
export const accounts: Messages = {
  'accounts.loading': 'Loading…',
  'accounts.yes': 'Yes',
  'accounts.no': 'No',

  'accounts.search.label': 'Search accounts',
  'accounts.search.q': 'Search',
  'accounts.search.hint':
    'An email address or its beginning, the beginning of a name, or an account ID.',
  'accounts.search.submit': 'Search',

  'accounts.list.caption': 'Accounts',
  'accounts.list.loadError': 'The account list could not be loaded',
  'accounts.list.empty': 'No account matches.',
  'accounts.list.name': 'Name',
  'accounts.list.email': 'Email',
  'accounts.list.verified': 'Email verified',
  'accounts.list.state': 'State',
  'accounts.list.memberships': 'Workspaces',
  'accounts.list.created': 'Created',
  'accounts.list.more': 'Load more',

  'accounts.state.active': 'Active',
  'accounts.state.suspended': 'Suspended',

  'accounts.detail.loadError': 'The account could not be loaded',
  'accounts.detail.notFound.title': 'No such account',
  'accounts.detail.notFound.body': 'There is no account with this ID. It may have been erased.',
  'accounts.detail.erased': 'The account was erased.',
  'accounts.detail.back': 'Back to accounts',
  'accounts.detail.profile': 'Profile and sign-in',
  'accounts.detail.id': 'Account ID',
  'accounts.detail.created': 'Created',
  'accounts.detail.verified': 'Email verified',
  'accounts.detail.unverified': 'Not verified',
  'accounts.detail.lastSignIn': 'Last sign-in',
  'accounts.detail.lastSeen': 'Last seen',
  'accounts.detail.password': 'Has a password',
  'accounts.detail.twoFactor': 'Two-factor authentication',
  'accounts.detail.twoFactorOn': 'On · {left} recovery codes left',
  'accounts.detail.twoFactorOff': 'Off',
  'accounts.detail.sessions': 'Active sessions',
  'accounts.detail.personalTokens': 'Personal access tokens',
  'accounts.detail.memberships': 'Workspaces',
  'accounts.detail.noMemberships': 'The account belongs to no workspace.',

  'accounts.membership.workspace': 'Workspace',
  'accounts.membership.licence': 'Licence',
  'accounts.membership.role': 'Role',
  'accounts.membership.workspaceStatus': 'Workspace status',
  'accounts.membership.member': 'Membership',
  'accounts.membership.twoFactorRequired': 'Requires 2FA',
  'accounts.membership.joined': 'Joined',
  'accounts.membership.sandbox': 'Sandbox',
  'accounts.membership.active': 'Active',
  'accounts.membership.suspended': 'Suspended by the workspace',
  'accounts.membership.awaiting': 'Awaiting approval',

  'accounts.banner.suspendedTitle': 'This account is suspended',
  'accounts.banner.suspended':
    'Since {when}, the person cannot sign in to any workspace and every token they hold is refused.',
  'accounts.banner.reason': 'Reason: {reason}',

  'accounts.actions.menu': 'Actions',
  'accounts.actions.done': '{action}: done.',
  'accounts.actions.unchanged': '{action}: nothing to change.',
  'accounts.actions.mailFailed': '{action}: done, but the email could not be sent.',
  'accounts.actions.state.account_is_sole_owner':
    'This person is the Founder of a workspace. Transfer the ownership from the workspace page first.',

  'accounts.actions.resendVerification.label': 'Resend verification email',
  'accounts.actions.resendVerification.title': 'Resend the verification email',
  'accounts.actions.resendVerification.body':
    'A new link goes to {email}; the earlier one stops working.',
  'accounts.actions.resendVerification.confirm': 'Send link',

  'accounts.actions.forcePasswordReset.label': 'Force a password reset',
  'accounts.actions.forcePasswordReset.title': 'Force a password reset',
  'accounts.actions.forcePasswordReset.body':
    'Every session of {email} ends in every workspace, and a reset link goes to that address.',
  'accounts.actions.forcePasswordReset.confirm': 'Reset password',

  'accounts.actions.revokeSessions.label': 'Sign out everywhere',
  'accounts.actions.revokeSessions.title': 'Sign out everywhere',
  'accounts.actions.revokeSessions.body':
    'Every session of {email} ends. Personal access tokens keep working.',
  'accounts.actions.revokeSessions.confirm': 'Sign out',

  'accounts.actions.revokeTokens.label': 'Revoke all tokens',
  'accounts.actions.revokeTokens.title': 'Revoke all tokens',
  'accounts.actions.revokeTokens.body':
    'Every session and every personal access token of {email} stops working.',
  'accounts.actions.revokeTokens.confirm': 'Revoke tokens',

  'accounts.actions.resetTwoFactor.label': 'Reset two-factor authentication',
  'accounts.actions.resetTwoFactor.title': 'Reset two-factor authentication',
  'accounts.actions.resetTwoFactor.body':
    'The authenticator and recovery codes of {email} are removed. A workspace that requires 2FA asks the person to set it up again.',
  'accounts.actions.resetTwoFactor.confirm': 'Reset 2FA',

  'accounts.actions.suspend.label': 'Suspend account',
  'accounts.actions.suspend.title': 'Suspend this account',
  'accounts.actions.suspend.body':
    '{email} is signed out and cannot sign in to any workspace until the suspension is lifted. Memberships stay as they are.',
  'accounts.actions.suspend.confirm': 'Suspend',

  'accounts.actions.unsuspend.label': 'Lift suspension',
  'accounts.actions.unsuspend.title': 'Lift the suspension',
  'accounts.actions.unsuspend.body': '{email} can sign in again.',
  'accounts.actions.unsuspend.confirm': 'Lift suspension',

  'accounts.actions.export.label': 'Export account data',
  'accounts.actions.export.title': 'Export the account’s data',
  'accounts.actions.export.body':
    'Downloads the profile, memberships and token list of {email} as JSON. No workspace content is included.',
  'accounts.actions.export.confirm': 'Export',

  'accounts.actions.erase.label': 'Erase account',
  'accounts.actions.erase.title': 'Erase this account',
  'accounts.actions.erase.body':
    '{email} is deleted with its memberships, tokens and second factor. This cannot be undone.',
  'accounts.actions.erase.confirm': 'Erase',
  'accounts.actions.erase.confirmEmail': 'Type the email address to confirm',
  'accounts.actions.erase.confirmHint': 'Type {email} exactly.',
  'accounts.actions.erase.mismatch': 'The address you typed is not this account’s.',
};
