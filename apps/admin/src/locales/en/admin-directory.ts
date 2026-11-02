import type { Messages } from '../merge.js';

/** Admins: the operator directory (tm 391 · FR-ADMIN-04). */
export const adminDirectory: Messages = {
  'admins.dir.heading': 'Operators',
  'admins.dir.intro':
    'Operators are disabled, never deleted — every audit entry keeps the name of whoever wrote it.',
  'admins.dir.loading': 'Loading…',
  'admins.dir.loadError': 'The operators could not be loaded',
  'admins.dir.invite': 'Invite an operator',
  'admins.dir.col.email': 'Email',
  'admins.dir.col.role': 'Role',
  'admins.dir.col.status': 'Status',
  'admins.dir.col.twoFactor': 'Authenticator',
  'admins.dir.col.sessions': 'Open sessions',
  'admins.dir.col.lastSeen': 'Last seen',
  'admins.dir.col.actions': 'Actions',
  'admins.dir.status.active': 'Active',
  'admins.dir.status.disabled': 'Disabled {date}',
  'admins.dir.twoFactor.on': 'Set up',
  'admins.dir.twoFactor.off': 'Not set up yet',
  'admins.dir.never': 'Never',
  'admins.dir.you': '(you)',
  'admins.dir.actions.menu': 'Actions',
  'admins.dir.actions.for': 'Actions for {email}',

  'admins.invites.heading': 'Pending invitations',
  'admins.invites.loadError': 'The invitations could not be loaded',
  'admins.invites.empty': 'No invitation is waiting.',
  'admins.invites.col.invitedBy': 'Invited by',
  'admins.invites.col.expires': 'Expires',
  'admins.invites.revoke': 'Revoke',
  'admins.invites.revokeLabel': 'Revoke the invitation for {email}',

  'admins.field.email': 'Email address',
  'admins.field.role': 'Role',

  'admins.invite.title': 'Invite an operator',
  'admins.invite.body':
    'They get a link by e-mail, valid for 72 hours. They choose a password and set up their authenticator before anything else opens.',
  'admins.invite.confirm': 'Send invitation',
  'admins.invite.sent': 'Invitation sent to {email}.',
  'admins.invite.mailFailed':
    'The e-mail to {email} could not be sent. Give them this link yourself — it is shown only now:',

  'admins.revokeInvite.title': 'Revoke the invitation',
  'admins.revokeInvite.body': 'The link sent to {email} stops working.',
  'admins.revokeInvite.confirm': 'Revoke invitation',
  'admins.revokeInvite.done': 'The invitation for {email} was revoked.',

  'admins.action.role.label': 'Change role',
  'admins.action.role.title': 'Change role',
  'admins.action.role.body': 'Choose the role {email} should have from now on.',
  'admins.action.role.confirm': 'Change role',
  'admins.action.role.done': '{email} is now {role}.',
  'admins.action.disable.label': 'Disable',
  'admins.action.disable.title': 'Disable the operator',
  'admins.action.disable.body':
    '{email} can no longer sign in and every open session of theirs ends. Their audit entries stay.',
  'admins.action.disable.confirm': 'Disable',
  'admins.action.disable.done': '{email} was disabled.',
  'admins.action.enable.label': 'Enable',
  'admins.action.enable.title': 'Enable the operator',
  'admins.action.enable.body': '{email} can sign in again with their password and authenticator.',
  'admins.action.enable.confirm': 'Enable',
  'admins.action.enable.done': '{email} was enabled.',
  'admins.action.resetTwoFactor.label': 'Reset authenticator',
  'admins.action.resetTwoFactor.title': 'Reset the authenticator',
  'admins.action.resetTwoFactor.body':
    '{email} signs in with their password and sets up a new authenticator; their recovery codes stop working.',
  'admins.action.resetTwoFactor.confirm': 'Reset authenticator',
  'admins.action.resetTwoFactor.verified':
    'I have confirmed that this really is {email}, by a channel other than the e-mail asking for the reset.',
  'admins.action.resetTwoFactor.done': 'The authenticator of {email} was reset.',
  'admins.action.revokeSessions.label': 'End sessions',
  'admins.action.revokeSessions.title': 'End all sessions',
  'admins.action.revokeSessions.body':
    'Every open session of {email} ends; they sign in again to continue.',
  'admins.action.revokeSessions.confirm': 'End sessions',
  'admins.action.revokeSessions.done': 'The sessions of {email} ended. Sessions ended: {count}.',

  'admins.error.lastSuperadmin':
    'This is the last active superadmin, and the platform needs one. Make another operator a superadmin first, then try again.',
};
