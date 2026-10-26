import type { Messages } from '../merge.js';

/** Deployment settings, the announcement, maintenance mode and the effective configuration (tm 389.13). */
export const settings: Messages = {
  'settings.loading': 'Loading…',
  'settings.loadError': 'The settings could not be loaded',
  'settings.updatedAt': 'Last changed {date}',
  'settings.on': 'On',
  'settings.off': 'Off',

  'settings.general.title': 'Sign-up and trial',
  'settings.general.signup': 'Public sign-up',
  'settings.general.signup.env': 'As the environment says (SIGNUP_ENABLED)',
  'settings.general.signup.open': 'Open',
  'settings.general.signup.closed': 'Closed',
  'settings.general.signup.hint':
    'Closing here closes sign-up at once. Opening here cannot override SIGNUP_ENABLED=false: the stricter of the two wins. Invitations always work.',
  'settings.general.trialDays': 'Trial length (days)',
  'settings.general.trialDays.env': 'As the environment says (TRIAL_DAYS)',
  'settings.general.trialDays.hint':
    'Applies to workspaces created from now on; 1 to {max}. Empty: the environment’s TRIAL_DAYS.',

  'settings.announcement.title': 'Announcement',
  'settings.announcement.hint':
    'Shown at the top of every workspace console, in the language each person reads it in. Write both.',
  'settings.announcement.expired': 'Its end time has passed: it is no longer shown.',
  'settings.announcement.enabled': 'Show an announcement',
  'settings.announcement.level': 'Level',
  'settings.announcement.level.info': 'Information',
  'settings.announcement.level.warning': 'Warning',
  'settings.announcement.level.critical': 'Critical',
  'settings.announcement.until': 'Hide after',
  'settings.announcement.until.hint': 'Your local time. Empty: shown until you remove it.',
  'settings.announcement.en': 'English text',
  'settings.announcement.tr': 'Turkish text',
  'settings.announcement.preview': 'Preview',
  'settings.announcement.preview.empty': '(empty)',

  'settings.maintenance.title': 'Maintenance mode',
  'settings.maintenance.state.off': 'Off — every workspace works normally.',
  'settings.maintenance.state.read_only':
    'On, read-only: workspaces can read and sign in, every change is refused.',
  'settings.maintenance.state.full':
    'On, full: workspaces are offline and the realtime gateway refuses connections.',
  'settings.maintenance.hint':
    'Every change needs a reason and a fresh authenticator code. Workspace consoles pick it up within a few seconds.',
  'settings.maintenance.turnOn': 'Turn on maintenance mode',
  'settings.maintenance.change': 'Change maintenance mode',
  'settings.maintenance.turnOff': 'Turn off maintenance mode',
  'settings.maintenance.consequence.read_only':
    'Every workspace becomes read-only: reading and signing in work, every change is refused.',
  'settings.maintenance.consequence.full':
    'Every workspace goes offline: the API refuses everything but signing out, and open realtime connections are closed.',
  'settings.maintenance.consequence.off': 'Every workspace works normally again.',
  'settings.maintenance.mode': 'Mode',
  'settings.maintenance.mode.read_only': 'Read-only — reads work, changes are refused',
  'settings.maintenance.mode.full': 'Full — the service is offline',
  'settings.maintenance.message.hint':
    'Optional: your own words for the consoles, in both languages. Empty: the console’s own sentence.',
  'settings.maintenance.message.en': 'English message',
  'settings.maintenance.message.tr': 'Turkish message',
  'settings.maintenance.message.bothLanguages':
    'Write the message in both languages, or in neither.',

  'settings.config.title': 'Effective configuration',
  'settings.config.hint':
    'The tenant API’s settings as it runs, published every 30 seconds. Secrets show only whether they are set; addresses lose their credentials. Values marked as set in the environment are changed there, not here.',
  'settings.config.notReporting.title': 'The tenant API is not reporting',
  'settings.config.notReporting.body':
    'No configuration has been published. The tenant API’s scheduler may be stopped, or Redis cannot be read.',
  'settings.config.stale.title': 'This configuration is out of date',
  'settings.config.stale.body': 'Last published {date}.',
  'settings.config.filter': 'Filter the configuration',
  'settings.config.search': 'Search keys and values',
  'settings.config.source': 'Source',
  'settings.config.source.all': 'Every source',
  'settings.config.source.db': 'This panel',
  'settings.config.source.env': 'Environment',
  'settings.config.source.default': 'Default',
  'settings.config.notableOnly':
    'Only the deployment switches: sign-up, pilot, AI, captcha, live apps, ticket mail',
  'settings.config.loadError': 'The configuration could not be loaded',
  'settings.config.empty': 'No setting matches.',
  'settings.config.key': 'Key',
  'settings.config.value': 'Value',
  'settings.config.panel': 'set here',
  'settings.config.set': 'set',
  'settings.config.unset': 'not set',
  'settings.config.none': 'none',
};
