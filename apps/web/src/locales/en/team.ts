import type { Messages } from '../merge.js';

/**
 * Team, and the notification preferences a teammate sets for themself
 * (I18N-e, tm 133.5).
 *
 * Notification preferences (`team.notifications.*`) are filed here rather than
 * under `settings` even though the component currently renders inside
 * `SettingsPage.tsx` — `NotificationSettings.tsx` is its own file precisely so
 * this namespace can register and translate it without claiming the rest of
 * that page, which I18N-i/j (tm 133.9, 133.10) still owns untouched.
 */
export const team: Messages = {
  // Team page — TeamPage.tsx
  'team.page.title': 'Team',
  'team.page.description': 'Teammates, availability and the teams routing sends work to.',
  'team.page.loadError': 'Could not load the team. Check that the API is reachable and try again.',
  'team.page.kpi.teammates': 'Teammates',
  'team.page.kpi.acceptingChats': 'Accepting chats',
  'team.page.kpi.acceptingChatsHint': 'Nobody can be assigned work',
  'team.page.kpi.combinedCapacity': 'Combined capacity',
  'team.page.kpi.combinedCapacityHint': 'Concurrent conversations before queueing',
  'team.page.kpi.teams': 'Teams',
  'team.page.kpi.chatbots': 'Chatbots',
  'team.page.kpi.chatbotsHint': 'Free — bots never use a seat',
  'team.page.pendingInvitationsTitle': 'Pending invitations',
  'team.page.teammatesTitle': 'Teammates',
  'team.page.empty.noTeammatesTitle': 'No teammates yet',
  'team.page.empty.noTeammatesDescription': 'Invite colleagues so conversations can be shared out.',
  'team.page.table.caption': 'Agents on this licence',
  'team.page.table.name': 'Name',
  'team.page.table.role': 'Role',
  'team.page.table.availability': 'Availability',
  'team.page.table.chatLimit': 'Chat limit',
  'team.page.table.twoFactor': '2FA',
  'team.page.table.skills': 'Skills',
  'team.page.table.manage': 'Manage',
  'team.page.you': 'you',
  'team.page.suspendButton': 'Suspend',
  'team.page.chatbots.title': 'Chatbots',
  'team.page.chatbots.description':
    'Bot accounts answer on their own. They are free — a bot never uses a seat (FR-MOD-04.6).',
  'team.page.empty.noChatbotsTitle': 'No chatbots yet',
  'team.page.empty.noChatbotsDescription':
    'Create an AI agent in the Playbook to answer common questions automatically.',
  'team.page.botTable.caption': 'Bot accounts on this licence',
  'team.page.botTable.status': 'Status',
  'team.page.botTable.seatCost': 'Seat cost',
  'team.page.botActive': 'Active',
  'team.page.free': 'Free',
  'team.page.suspended.title': 'Suspended',
  'team.page.suspended.description':
    'Suspended agents keep their teams and history but cannot sign in, take chats or use a seat until reinstated.',
  'team.page.empty.nobodySuspendedTitle': 'Nobody is suspended',
  'team.page.empty.nobodySuspendedDescription':
    'Suspend a teammate from the list above when they should no longer be assigned work.',
  'team.page.suspendedTable.caption': 'Suspended agents',
  'team.page.reinstateButton': 'Reinstate',
  'team.page.teams.title': 'Teams',
  'team.page.teams.description':
    'Routing fills the highest priority tier that still has capacity, then the next.',
  'team.page.empty.noTeamsTitle': 'No teams yet',
  'team.page.empty.noTeamsDescription':
    'Teams decide which conversations an agent can see and who gets them first.',
  'team.page.memberCount.one': '{count} member',
  'team.page.memberCount.other': '{count} members',
  'team.page.noMembers':
    'No members — conversations routed here fall through to the fallback team.',
  'team.page.formerTeammate': 'Former teammate',

  // Routing status / on-off, shared across TeamPage and NotificationSettings
  'team.status.acceptingChats': 'Accepting chats',
  'team.status.notAccepting': 'Not accepting',
  'team.status.offline': 'Offline',
  'team.status.on': 'On',
  'team.status.off': 'Off',

  // Role names — TeamPage's roster, InviteTeammates' role picker and pending list
  'team.role.owner': 'Owner',
  'team.role.viceowner': 'Vice owner',
  'team.role.admin': 'Admin',
  'team.role.agent': 'Agent',

  // Team assignment priority — TeamPage.tsx's group member list
  'team.priority.primary': 'Primary',
  'team.priority.first': 'First',
  'team.priority.normal': 'Normal',
  'team.priority.last': 'Last',

  // Work schedule — WorkSchedule.tsx
  'team.workSchedule.title': 'Work schedule',
  'team.workSchedule.description':
    "Each teammate's standing weekly hours — what the staffing forecast reads to predict coverage gaps.",
  'team.workSchedule.empty.title': 'No one to schedule yet',
  'team.workSchedule.empty.description': 'Invite teammates before setting up a work schedule.',
  'team.workSchedule.teammateLabel': 'Teammate',
  'team.workSchedule.optionYou': '{name} (you)',
  'team.workSchedule.yourWeeklyHours': 'Your weekly hours',
  'team.workSchedule.editButton': 'Edit schedule',
  'team.workSchedule.modalTitle': 'Work schedule — {name}',
  'team.workSchedule.modalDescription':
    "Standing weekly hours, in this teammate's own timezone. An off day keeps its configured hours, just switched off.",
  'team.workSchedule.loading': 'Loading…',
  'team.workSchedule.loadError': 'Could not load this schedule.',
  'team.workSchedule.timezoneLabel': 'Timezone',
  'team.workSchedule.startTimeAriaLabel': '{day} start time',
  'team.workSchedule.endTimeAriaLabel': '{day} end time',
  'team.workSchedule.error.badTime': 'Enter a 24-hour time, like 09:00.',
  'team.workSchedule.error.endBeforeStart': 'End must be after start.',
  'team.workSchedule.discardConfirm': 'Discard your unsaved schedule changes?',
  'team.workSchedule.cancel': 'Cancel',
  'team.workSchedule.saveButton': 'Save schedule',
  'team.workSchedule.saving': 'Saving…',

  // Invite teammates — InviteTeammates.tsx
  'team.invite.title': 'Invite teammates',
  'team.invite.description': 'One address per line, or separated by commas.',
  'team.invite.emailsLabel': 'Email addresses',
  'team.invite.roleLabel': 'Role',
  'team.invite.linkSentNotice':
    'Invitations sent. This link works once and lasts seven days — it is not shown again.',
  'team.invite.copyLink': 'Copy invite link',
  'team.invite.discardConfirm': 'Discard the addresses you have typed?',
  'team.invite.cancel': 'Cancel',
  'team.invite.done': 'Done',
  'team.invite.sending': 'Sending…',
  'team.invite.submit': 'Invite',
  'team.invite.submitCount': 'Invite {count}',
  'team.invite.error.invalidEmails': 'Not a valid address: {emails}',
  'team.invite.error.aboveRole': 'You cannot invite someone above your own role.',
  'team.invite.error.generic': 'Could not send those invitations.',
  'team.invite.pending.caption': 'Invitations not yet accepted',
  'team.invite.pending.email': 'Email',
  'team.invite.pending.role': 'Role',
  'team.invite.pending.invitedBy': 'Invited by',
  'team.invite.pending.revoke': 'Revoke',

  // Per-agent skills — AgentSkills.tsx
  'team.skills.manageAriaLabel': 'Manage skills for {name}',
  'team.skills.noSkills': 'No skills',
  'team.skills.dialogTitle': 'Skills — {name}',
  'team.skills.dialogDescription':
    'Skill-based routing only assigns this agent conversations that require every skill they hold.',
  'team.skills.loading': 'Loading…',
  'team.skills.loadError': 'Could not load the skill catalogue.',
  'team.skills.empty.title': 'No skills in the catalogue yet',
  'team.skills.empty.description':
    'Add a skill in Settings → Skills before assigning one to an agent here.',
  'team.skills.saveError': "Could not save that agent's skills.",
  'team.skills.cancel': 'Cancel',
  'team.skills.close': 'Close',
  'team.skills.saveButton': 'Save',
  'team.skills.saving': 'Saving…',

  // Notification preferences — NotificationSettings.tsx (FR-MOD-13.8)
  'team.notifications.title': 'Notifications',
  'team.notifications.description':
    'How you are alerted to new messages. These follow your account on this workspace; whether this browser may show desktop notifications is its own setting.',
  'team.notifications.enable.label': 'Enable notifications',
  'team.notifications.saveFailed': 'Could not save — please try again.',
  'team.notifications.enable.hint':
    'Turning this off silences sound, desktop, push and tab alerts alike. Email still reaches you.',
  'team.notifications.sound.label': 'Play a sound',
  'team.notifications.sound.hint': 'A short chime when a visitor writes in.',
  'team.notifications.desktop.label': 'Desktop notifications',
  'team.notifications.desktop.granted': 'Shown even when this tab is in the background.',
  'team.notifications.desktop.denied':
    'Blocked in your browser — allow notifications for this site to use them.',
  'team.notifications.desktop.unsupported': 'This browser does not support desktop notifications.',
  'team.notifications.desktop.default': 'Ask your browser for permission to show these.',
  'team.notifications.desktop.enableButton': 'Enable desktop notifications',
  'team.notifications.push.label': 'Mobile push notifications',
  'team.notifications.push.hint':
    'Sent to the Nexa app on any phone you have signed in on. Which handsets those are is managed from the app itself.',
  'team.notifications.email.label': 'Email notifications',
  'team.notifications.email.hint':
    'Emailed when a visitor writes in a chat assigned to you, even when Nexa is closed. Not affected by the switch above — email is the fallback for when you are away.',
};
