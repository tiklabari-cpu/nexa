/**
 * The Settings side navigation (FR-MOD-08.1 · tm 255.10).
 *
 * Groups and sections come from `settings-sections.ts`, filtered by the
 * caller's scopes: a section the caller cannot read is not linked, and a group
 * left with nothing in it loses its heading too.
 *
 * "Unpin side navigation" folds the list away to a narrow strip; hovering or
 * focusing the strip opens it over the page, so a section is still one move
 * away. The choice is the caller's own and follows them between browsers — it
 * is stored on the membership (`/agents/me/ui-preferences`), not in
 * `localStorage`. The toggle flips only once the server has answered: an
 * optimistic flip would let a reload that races the write bring the old layout
 * back (the trap tm 250 measured in e2e).
 */
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type { ReactElement } from 'react';
import { NavLink } from 'react-router-dom';
import { DEFAULT_UI_PREFERENCES, hasAnyScope, type UiPreferences } from '@nexa/types';
import { useApiClient, useAuth } from '../../lib/auth-store.js';
import { useTranslate } from '../../lib/i18n.js';
import { sectionHref, visibleGroups } from './settings-sections.js';

export const UI_PREFERENCES_QUERY_KEY = ['ui-preferences'] as const;

/** The caller's pin, read from the server; pinned until it answers. */
function useSettingsNavPin(): {
  pinned: boolean;
  canToggle: boolean;
  toggle: () => void;
  saving: boolean;
} {
  const api = useApiClient();
  const queryClient = useQueryClient();
  const scopes = useAuth((s) => s.agent?.scopes ?? []);
  const canRead = hasAnyScope(scopes, ['agents--my:ro', 'agents--all:ro']);
  const canToggle = hasAnyScope(scopes, ['agents--my:rw', 'agents--all:rw']);

  const query = useQuery({
    queryKey: UI_PREFERENCES_QUERY_KEY,
    queryFn: () => api.get<UiPreferences>('/agents/me/ui-preferences'),
    enabled: canRead,
  });
  const pinned = (query.data ?? DEFAULT_UI_PREFERENCES).settings_nav_pinned;

  const mutation = useMutation({
    mutationFn: (next: boolean) =>
      api.put<UiPreferences>('/agents/me/ui-preferences', { settings_nav_pinned: next }),
    onSuccess: (prefs) => queryClient.setQueryData(UI_PREFERENCES_QUERY_KEY, prefs),
  });

  return {
    pinned,
    canToggle,
    toggle: () => mutation.mutate(!pinned),
    saving: mutation.isPending,
  };
}

export function SettingsNav(): ReactElement {
  const t = useTranslate();
  const scopes = useAuth((s) => s.agent?.scopes ?? []);
  const groups = visibleGroups(scopes);
  const { pinned, canToggle, toggle, saving } = useSettingsNavPin();

  const toggleLabel = t(pinned ? 'settings.nav.unpin' : 'settings.nav.pin');
  const toggleButton = canToggle ? (
    <button
      type="button"
      onClick={toggle}
      disabled={saving}
      aria-label={toggleLabel}
      title={toggleLabel}
      className="flex h-7 w-7 shrink-0 items-center justify-center rounded-md text-content-secondary transition-colors hover:bg-surface-2 hover:text-content disabled:opacity-50"
    >
      <span aria-hidden="true">{pinned ? '«' : '»'}</span>
    </button>
  ) : null;

  const list = (
    <nav aria-label={t('settings.nav.label')} className="flex flex-col gap-4 p-3">
      {groups.map((group) => {
        const headingId = `settings-nav-group-${group.key}`;
        return (
          <div key={group.key} className="flex flex-col gap-0.5">
            <p
              id={headingId}
              className="px-2 pb-1 text-2xs font-semibold uppercase tracking-wide text-content-tertiary"
            >
              {t(group.labelKey)}
            </p>
            <ul aria-labelledby={headingId} className="flex flex-col gap-0.5">
              {group.sections.map((section) => (
                <li key={section.slug}>
                  <NavLink
                    to={sectionHref(section)}
                    className={({ isActive }) =>
                      `block truncate rounded-md px-2 py-1.5 text-sm transition-colors ${
                        isActive
                          ? 'bg-brand-100 font-medium text-brand-700 dark:bg-brand-950 dark:text-content'
                          : 'text-content-secondary hover:bg-surface-2 hover:text-content'
                      }`
                    }
                  >
                    {t(section.labelKey)}
                  </NavLink>
                </li>
              ))}
            </ul>
          </div>
        );
      })}
    </nav>
  );

  if (pinned) {
    return (
      <aside
        data-testid="settings-nav"
        data-pinned="true"
        className="flex w-60 shrink-0 flex-col overflow-y-auto border-r border-border bg-surface"
      >
        <div className="flex justify-end px-3 pt-3">{toggleButton}</div>
        {list}
      </aside>
    );
  }

  // Unpinned: a strip that opens the list over the page on hover or focus.
  return (
    <aside
      data-testid="settings-nav"
      data-pinned="false"
      className="group relative flex w-10 shrink-0 flex-col items-center border-r border-border bg-surface pt-4"
    >
      {toggleButton}
      <div className="invisible absolute inset-y-0 left-full z-20 w-60 overflow-y-auto border-r border-border bg-surface shadow-lg group-focus-within:visible group-hover:visible">
        {list}
      </div>
    </aside>
  );
}
