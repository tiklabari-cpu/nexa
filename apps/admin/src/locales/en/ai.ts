import type { Messages } from '../merge.js';

/** AI: the platform's catalogues, the crisis-text drafts and the template installs (tm 389.19). */
export const ai: Messages = {
  'ai.loadError': 'This catalogue could not be loaded',
  'ai.loading': 'Loading…',
  'ai.loadMore': 'Load more',
  'ai.noVersion': 'No version',
  'ai.notInstalled': 'Not available yet: it ships with {owner}.',
  'ai.yes': 'Yes',
  'ai.no': 'No',

  'ai.tabs.label': 'AI catalogues',
  'ai.tabs.guardrails': 'Guardrails',
  'ai.tabs.crisis': 'Crisis texts',
  'ai.tabs.templates': 'Templates',
  'ai.tabs.compliance': 'Compliance pack',
  'ai.tabs.rubric': 'QA rubric',
  'ai.tabs.tools': 'Tools',

  'ai.guardrails.version': 'Catalogue version',
  'ai.guardrails.intro':
    '{count} locked rules every AI agent runs under. A workspace can add stricter rules of its own; it cannot switch these off or loosen them.',
  'ai.guardrails.caption': 'The locked guardrail rules',
  'ai.guardrails.col.rule': 'Rule',
  'ai.guardrails.col.title': 'What it does',
  'ai.guardrails.col.category': 'Category',
  'ai.guardrails.col.action': 'Action',
  'ai.guardrails.col.stages': 'Checked on',
  'ai.guardrails.col.patterns': 'Patterns',
  'ai.guardrails.stage.input': 'player message',
  'ai.guardrails.stage.output': 'AI draft',
  'ai.guardrails.patterns': '{input} in · {output} out',

  'ai.templates.version': 'Template pack {pack}, package version',
  'ai.templates.intro':
    '{count} iGaming procedure templates (Turkish). A workspace installs a copy and fills in what is its own; the text of a template is not shown here.',
  'ai.templates.caption': 'The templates in the pack',
  'ai.templates.col.key': 'Key',
  'ai.templates.col.name': 'Name',
  'ai.templates.col.version': 'Version',
  'ai.templates.col.locked': 'Locked',
  'ai.templates.col.scenarios': 'Test scenarios',
  'ai.templates.col.mustFill': 'To fill in',

  'ai.installs.heading': 'Installs per workspace',
  'ai.installs.empty': 'No workspace has installed a template yet.',
  'ai.installs.intro':
    'Installed copies, how many are switched on for the AI to use, and how many are behind the pack’s version of their template. Counts only.',
  'ai.installs.caption': 'Template installs per workspace, most copies first',
  'ai.installs.col.workspace': 'Workspace',
  'ai.installs.col.installed': 'Installed',
  'ai.installs.col.active': 'Live',
  'ai.installs.col.outdated': 'Behind',

  'ai.compliance.version': 'Pack version',
  'ai.compliance.intro':
    '{count} scenarios every pre-publish test run plays on top of the workspace’s own. A run that fails any of them stops publishing.',
  'ai.compliance.caption': 'The compliance scenarios',
  'ai.compliance.col.key': 'Scenario',
  'ai.compliance.col.rule': 'Rule',
  'ai.compliance.col.language': 'Language',

  'ai.rubric.version': 'Rubric version',
  'ai.rubric.intro':
    'What the AI judge scores each conversation on, {min} (poor) to {max} (right). Advice only: it never decides a pass or a fail.',
  'ai.rubric.caption': 'The QA rubric criteria',
  'ai.rubric.col.criterion': 'Criterion',
  'ai.rubric.col.applies': 'Applies',
  'ai.rubric.always': 'Every conversation',
  'ai.rubric.handoffOnly': 'Only when handed over',
  'ai.rubric.criterion.topic': 'Right topic',
  'ai.rubric.criterion.required_info': 'Required information',
  'ai.rubric.criterion.faithfulness': 'Faithful to the knowledge',
  'ai.rubric.criterion.guardrails': 'Within the guardrails',
  'ai.rubric.criterion.handoff_timing': 'Handed over at the right moment',
  'ai.rubric.criterion.handoff_summary': 'Complete hand-over summary',
  'ai.rubric.criterion.tone': 'Tone',

  'ai.tools.owner': 'the tool slot',
  'ai.tools.version': 'Catalogue version',
  'ai.tools.caption': 'The tool catalogue',
  'ai.tools.col.key': 'Tool',

  'ai.crisis.title': 'Crisis-text drafts',
  'ai.crisis.intro':
    'Suggested wording for the responsible-gaming hand-over, per country. A workspace is offered the one for its country as “use the platform’s draft”; it edits and approves the text itself. Nothing is published for it.',
  'ai.crisis.updatedAt': 'Last saved {date}',
  'ai.crisis.none': 'No countries',
  'ai.crisis.confirmRow': '{country} (English {en}, Turkish {tr} characters)',
  'ai.crisis.empty': 'No drafts yet. Add a country to write one.',
  'ai.crisis.country': 'Drafts for {country}',
  'ai.crisis.remove': 'Remove {country}',
  'ai.crisis.lang.en': 'English text',
  'ai.crisis.lang.tr': 'Turkish text',
  'ai.crisis.newCountry': 'Country code',
  'ai.crisis.newCountry.hint':
    'Two letters, ISO 3166-1 (TR, GB, MT…). Up to {max} countries. A workspace’s country is read from its time zone.',
  'ai.crisis.add': 'Add country',
  'ai.crisis.problem.country': 'A country is two upper-case letters.',
  'ai.crisis.problem.duplicate': 'A country appears twice.',
  'ai.crisis.problem.empty': 'Every country needs a text in at least one language.',
  'ai.crisis.problem.text': 'A text is plain text of at most {max} characters, without HTML.',
};
