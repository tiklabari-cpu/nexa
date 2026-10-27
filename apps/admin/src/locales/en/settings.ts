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

  // AI providers (tm 389.17).
  'settings.ai.title': 'AI providers',
  'settings.ai.hint':
    'The model and the embedding provider every workspace’s AI uses. A part set here overrides the tenant API’s environment (LLM_*, EMBEDDING_*) and reaches every running server within seconds, without a restart. Saving needs a reason and a fresh authenticator code.',
  'settings.ai.loadError': 'The AI settings could not be loaded',
  'settings.ai.source.db': 'Set here',
  'settings.ai.source.env': 'From the environment',
  'settings.ai.llm.title': 'Model',
  'settings.ai.embedding.title': 'Embedding model',
  'settings.ai.provider': 'Provider',
  'settings.ai.provider.env': 'As the environment says',
  'settings.ai.provider.mock': 'Built-in stub (mock)',
  'settings.ai.provider.openai': 'OpenAI',
  'settings.ai.baseUrl': 'Base URL',
  'settings.ai.baseUrl.hint':
    'In production: the OpenAI regional host of the region beside it — never api.openai.com.',
  'settings.ai.model': 'Model name',
  'settings.ai.modelFast': 'Fast model',
  'settings.ai.modelFast.hint': 'Classifying and summarising. Empty: the model above.',
  'settings.ai.region': 'Region',
  'settings.ai.region.none': 'Not set',
  'settings.ai.region.eu': 'EU',
  'settings.ai.region.us': 'US',
  'settings.ai.timeout': 'Timeout (ms)',
  'settings.ai.maxOutputTokens': 'Reply limit (tokens)',
  'settings.ai.limits.hint': 'Empty: the environment’s LLM_TIMEOUT_MS and LLM_MAX_OUTPUT_TOKENS.',
  'settings.ai.dimensions': 'Vector width: {n}, fixed by the database.',
  'settings.ai.apiKey': 'API key',
  'settings.ai.apiKey.stored': '•••• {last4}',
  'settings.ai.apiKey.none':
    'No key is stored here: the environment’s key is used, if it has one. Once saved, only its last four characters are shown.',
  'settings.ai.apiKey.hint': 'Write-only: once saved, only its last four characters are shown.',
  'settings.ai.apiKey.change': 'Change key',
  'settings.ai.apiKey.remove': 'Remove key',
  'settings.ai.apiKey.removing': 'The stored key is removed when you save.',
  'settings.ai.apiKey.undo': 'Keep the key',
  'settings.ai.apiKey.cancel': 'Cancel',
  'settings.ai.apiKey.tooShort': 'A key is at least 8 characters long.',
  'settings.ai.required': 'A remote provider needs a base URL, a model name and a region.',
  'settings.ai.embedding.changeWarning':
    'A new embedding provider or model means the knowledge base has to be re-embedded; until then, questions are answered from the knowledge already moved.',
  'settings.ai.caps.title': 'Daily caps (tokens)',
  'settings.ai.caps.hint':
    'The deployment’s defaults. Empty: the environment’s AI_DAILY_* values. A plan’s default and a workspace’s own override still come first.',
  'settings.ai.caps.llmWorkspace': 'Model, per workspace',
  'settings.ai.caps.llmGlobal': 'Model, whole deployment',
  'settings.ai.caps.embeddingWorkspace': 'Embeddings, per workspace',
  'settings.ai.caps.embeddingGlobal': 'Embeddings, whole deployment',
  'settings.ai.caps.incomplete': 'Fill in all four caps with whole numbers, or none.',
  'settings.ai.prices.title': 'Prices (USD per million tokens)',
  'settings.ai.prices.hint':
    'For the AI usage report’s cost estimate. Empty: the environment’s AI_PRICE_* values.',
  'settings.ai.prices.llmInput': 'Model input',
  'settings.ai.prices.llmOutput': 'Model output',
  'settings.ai.prices.embedding': 'Embeddings',
  'settings.ai.prices.invalid': 'A price is a number, 0 or more.',
  'settings.ai.save': 'Save AI settings',
  'settings.ai.saveTitle': 'Save the AI settings',
  'settings.ai.saveDescription': 'Every tenant server rebuilds its AI providers within seconds.',
  'settings.ai.reembedRequired': 'The embedding model changed: re-embed the knowledge base below.',
  'settings.ai.test.title': 'Connection',
  'settings.ai.test.llm': 'Test the model',
  'settings.ai.test.embedding': 'Test the embedding provider',
  'settings.ai.test.description':
    'Sends one small request. It is counted on the deployment’s daily allowance, never a workspace’s.',
  'settings.ai.test.target.llm': 'Model',
  'settings.ai.test.target.embedding': 'Embeddings',
  'settings.ai.test.ok': '{target}: answered in {ms} ms ({provider}, {source}).',
  'settings.ai.test.failed': '{target}: no answer ({error}).',
  'settings.ai.reembed.title': 'Re-embedding',
  'settings.ai.reembed.start': 'Re-embed the knowledge base',
  'settings.ai.reembed.description':
    'Every knowledge source still in another embedding space is embedded again with the current provider, one at a time. The cost is counted on the deployment’s daily allowance.',
  'settings.ai.reembed.state.idle': 'No re-embedding recorded.',
  'settings.ai.reembed.state.running':
    'Running. Sources moved: {sources} · chunks: {chunks} · failed: {failed}.',
  'settings.ai.reembed.state.finished':
    'Finished {date}. Sources moved: {sources} · chunks: {chunks} · failed: {failed}.',
  'settings.ai.reembed.state.failed': 'Stopped before it finished. Start it again.',
  'settings.ai.reembed.target': 'Target space: {target}.',
  'settings.ai.reembed.capped':
    'The deployment’s daily embedding allowance ran out. Start again after 00:00 UTC.',
};
