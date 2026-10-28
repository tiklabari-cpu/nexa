/**
 * The tabs of Playbook › AI Agent (tm 390.2) — the one place that names them.
 *
 * Every face of the AI agent is a tab here; a later task that adds a surface
 * (Test lab, History, Suggestions…) adds one row to `PLAYBOOK_TABS` and one
 * panel to `PlaybookPage`, and nothing else has to learn the new id. The ids
 * are addresses (`?view=…` from Settings › AI Agent and the command palette),
 * so they are stable: `behaviour` in particular is the home of the guidance,
 * hand-over and guardrail cards of the AI-07/09/10 tasks and does not move.
 */
export const PLAYBOOK_VIEWS = [
  'general',
  'behaviour',
  'guardrails',
  'skills',
  'knowledge',
  'tables',
  'kb',
  'test',
  'performance',
  'unresolved',
  'versions',
  'history',
  'suggestions',
] as const;

export type PlaybookView = (typeof PLAYBOOK_VIEWS)[number];

export interface PlaybookTab {
  id: PlaybookView;
  /** i18n key of the tab's label. */
  labelKey: string;
  /** Needs the AI configuration read scope (`agents-bot--all:ro` / `:rw`). */
  needsConfigScope?: true;
}

/** In the order the tabs read. */
export const PLAYBOOK_TABS: readonly PlaybookTab[] = [
  { id: 'general', labelKey: 'playbook.tabs.general' },
  { id: 'behaviour', labelKey: 'playbook.tabs.behaviour' },
  { id: 'guardrails', labelKey: 'playbook.tabs.guardrails' },
  { id: 'skills', labelKey: 'playbook.tabs.skills' },
  { id: 'knowledge', labelKey: 'playbook.tabs.knowledge' },
  { id: 'tables', labelKey: 'playbook.tabs.tables' },
  { id: 'kb', labelKey: 'playbook.tabs.kb' },
  { id: 'test', labelKey: 'playbook.tabs.test', needsConfigScope: true },
  { id: 'performance', labelKey: 'playbook.tabs.performance' },
  { id: 'unresolved', labelKey: 'playbook.tabs.unresolved', needsConfigScope: true },
  // The published versions and the review line (tm 316.4 · AI-20).
  { id: 'versions', labelKey: 'playbook.tabs.versions', needsConfigScope: true },
  { id: 'history', labelKey: 'playbook.tabs.history', needsConfigScope: true },
  // The coaching queue (tm 318.2 · AI-23): not behind the configuration scope —
  // a Team Lead reviews their team's suggestions without reading the rest.
  { id: 'suggestions', labelKey: 'playbook.tabs.suggestions' },
];

/** Links written before the rename: `profile` was today's `general`. */
const LEGACY_VIEWS: Readonly<Record<string, PlaybookView>> = { profile: 'general' };

/**
 * The tab a `?view=` value names, or null when it names none (absent, empty,
 * or an id this build does not have — a stale link lands on the default tab
 * rather than on a blank panel).
 */
export function resolveView(value: string | null | undefined): PlaybookView | null {
  if (!value) return null;
  const legacy = LEGACY_VIEWS[value];
  if (legacy) return legacy;
  return (PLAYBOOK_VIEWS as readonly string[]).includes(value) ? (value as PlaybookView) : null;
}
