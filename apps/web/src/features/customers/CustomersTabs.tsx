/**
 * The Customers area has two faces (PRD §8.1 "Customers (Real-time/Contacts)"):
 * the CRM directory and the live-visitor board. This segmented control switches
 * between them and lives in both pages' headers, so wherever an agent is they
 * can cross over — and each side stays a deep-linkable route rather than a tab
 * in component state.
 */
import type { ReactElement } from 'react';
import { NavLink } from 'react-router-dom';

const TABS = [
  // `end` so Contacts is not left highlighted while on the nested Real-time route.
  { to: '/app/customers', label: 'Contacts', end: true },
  { to: '/app/customers/real-time', label: 'Real-time', end: false },
  { to: '/app/customers/campaigns', label: 'Campaigns', end: false },
];

export function CustomersTabs(): ReactElement {
  return (
    <nav aria-label="Customer views" className="flex gap-1">
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
          {tab.label}
        </NavLink>
      ))}
    </nav>
  );
}
