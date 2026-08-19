import type { Messages } from '../merge.js';

/**
 * The home dashboard (I18N-e, tm 133.5).
 *
 * `home.activation.<ActivationStepKey>.*` keys are named after the server's own
 * step keys (`install_widget`, `invite_teammate`, …) rather than a screen-local
 * shorthand, so `HomePage.tsx` can build the key straight from `step.key` with
 * no lookup table of its own to keep in sync with `@nexa/types`.
 */
export const home: Messages = {
  'home.page.title': 'Home',
  'home.page.description': 'Your workspace at a glance',
  'home.page.notAvailable.title': 'Dashboard not available',
  'home.page.notAvailable.description':
    'The Home dashboard is available to admins and owners. Head to your inbox to start working.',
  'home.page.goToInbox': 'Go to inbox',
  'home.page.loadError': 'The dashboard could not be loaded. Please try again.',

  // Activation checklist
  'home.activation.title': 'Get started',
  'home.activation.allDone': 'Your workspace is fully set up.',
  'home.activation.progress': '{completed} of {total} steps complete',
  'home.activation.progressAriaLabel': 'Activation progress',
  'home.activation.doneSuffix': ' (done)',
  'home.activation.todoSuffix': ' (to do)',
  'home.activation.setUp': 'Set up',
  'home.activation.install_widget.label': 'Install the chat widget',
  'home.activation.install_widget.description': 'Add your website so the widget can go live on it.',
  'home.activation.invite_teammate.label': 'Invite a teammate',
  'home.activation.invite_teammate.description': 'Bring the rest of your team into the workspace.',
  'home.activation.customize_widget.label': 'Customize your widget',
  'home.activation.customize_widget.description':
    'Match the widget’s colour, theme and position to your brand.',
  'home.activation.add_canned_response.label': 'Create a canned response',
  'home.activation.add_canned_response.description': 'Save a reply your team can drop in with #.',
  'home.activation.set_up_ai_agent.label': 'Set up an AI Agent',
  'home.activation.set_up_ai_agent.description':
    'Let the AI answer the easy questions before a human steps in.',

  // Live counters
  'home.live.title': 'Right now',
  'home.live.description': 'Live activity across your workspace',
  'home.live.visitors_online.label': 'Visitors online',
  'home.live.visitors_online.hint': 'On the site right now',
  'home.live.ongoing_chats.label': 'Ongoing chats',
  'home.live.ongoing_chats.hint': 'Open conversations',
  'home.live.agents_online.label': 'Agents online',
  'home.live.agents_online.hint': 'Accepting chats',

  // Weekly performance
  'home.weekly.title': 'This week',
  'home.weekly.description': 'The last 7 days, compared with the 7 before',
  'home.weekly.newChats': 'New chats',
  'home.weekly.resolved': 'Resolved',
  'home.weekly.satisfaction': 'Satisfaction',
  'home.weekly.ratedCount': '{count} rated',
  'home.weekly.vsLastWeek': '{count} vs last week',
  'home.weekly.ptsVsLastWeek': '{points} pts vs last week',
  'home.weekly.noChange': 'No change vs last week',
  'home.weekly.comparedHint': 'Compared with the previous week',
};
