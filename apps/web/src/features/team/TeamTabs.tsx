/**
 * Team's module-internal navigation (FR-MOD-04.1 — "İnsan + AI varlıkları tek
 * çatı"). Three entity groups — Teammates, AI agents (+ Copilot), Teams — used
 * to sit as `Section` blocks on one long page with no way to jump between them
 * or link a colleague straight to one. This segmented control switches
 * between them and lives in every one of the three pages' headers, the same
 * shape `CustomersTabs` already gave Contacts/Real-time/Campaigns/Goals: each
 * side stays a deep-linkable route (`/app/team/teams`) rather than a tab kept
 * in component state, and the existing sections underneath are untouched —
 * this sits above them, it does not replace them.
 *
 * **Why a tab bar, not a second sidebar.** The PRD's own wording is "kenar
 * çubuğu" (sidebar), but the icon rail beside every module is already one —
 * a second sidebar next to it would fight the first for width on anything
 * narrower than a wide desktop, which is exactly the kind of layout `nav-store`
 * already treats as scarce (the rail itself only expands to labelled on
 * request, collapsed by default). A segmented control reuses chrome the
 * product already ships and already passed its own a11y scan.
 *
 * A distinct `aria-label` matters here specifically: the shell's own rail is
 * `<nav aria-label="Modules">`, and two `<nav>` landmarks sharing one
 * accessible name is an axe violation (`landmark-unique`) — tm 182.2 hit the
 * same trap the other way, an ambiguous *link* name inside this rail.
 */
import type { ReactElement } from 'react';
import { NavLink } from 'react-router-dom';
import { useTranslate } from '../../lib/i18n.js';

const TABS = [
  // `end` so Teammates is not left highlighted while on a nested Team route.
  { to: '/app/team', labelKey: 'team.tabs.teammates', end: true },
  { to: '/app/team/ai-agents', labelKey: 'team.tabs.aiAgents', end: false },
  { to: '/app/team/teams', labelKey: 'team.tabs.teams', end: false },
];

export function TeamTabs(): ReactElement {
  const t = useTranslate();
  return (
    <nav aria-label={t('team.tabs.ariaLabel')} className="flex gap-1">
      {TABS.map((tab) => (
        <NavLink
          key={tab.to}
          to={tab.to}
          end={tab.end}
          className={({ isActive }) =>
            `rounded-md px-3 py-1.5 text-sm transition-colors ${
              isActive
                ? 'bg-brand-100 font-medium text-brand-700 dark:bg-brand-950 dark:text-content'
                : 'text-content-secondary hover:bg-surface-2'
            }`
          }
        >
          {t(tab.labelKey)}
        </NavLink>
      ))}
    </nav>
  );
}
