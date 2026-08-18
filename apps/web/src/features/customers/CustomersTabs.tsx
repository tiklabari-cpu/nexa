/**
 * The Customers area has two faces (PRD §8.1 "Customers (Real-time/Contacts)"):
 * the CRM directory and the live-visitor board. This segmented control switches
 * between them and lives in both pages' headers, so wherever an agent is they
 * can cross over — and each side stays a deep-linkable route rather than a tab
 * in component state.
 */
import type { ReactElement } from 'react';
import { NavLink } from 'react-router-dom';
import { useTranslate } from '../../lib/i18n.js';

const TABS = [
  // `end` so Contacts is not left highlighted while on the nested Real-time route.
  { to: '/app/customers', labelKey: 'customers.tabs.contacts', end: true },
  { to: '/app/customers/real-time', labelKey: 'customers.tabs.realTime', end: false },
  { to: '/app/customers/campaigns', labelKey: 'customers.tabs.campaigns', end: false },
  { to: '/app/customers/goals', labelKey: 'customers.tabs.goals', end: false },
];

export function CustomersTabs(): ReactElement {
  const t = useTranslate();
  return (
    <nav aria-label={t('customers.tabs.ariaLabel')} className="flex gap-1">
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
