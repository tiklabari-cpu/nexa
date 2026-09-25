/**
 * The Settings side navigation (FR-MOD-08.1 · tm 255.10 + search tm 255.11).
 *
 * Groups and sections come from `settings-sections.ts`, filtered by the
 * caller's scopes: a section the caller cannot read is not linked, and a group
 * left with nothing in it loses its heading too. A typed search query is the
 * same filter applied a second way (`searchSections`) — a hidden section never
 * surfaces as a result either, so the search box cannot leak what the grouped
 * list already would not show.
 *
 * The search box is a combobox over a flat result list, the same shape as the
 * command palette's (`CommandPalette.tsx`) but scoped to this one catalogue:
 * arrow keys move a highlighted result, Enter opens it, Escape clears the
 * query and returns to the grouped list. Unlike the palette this list is
 * always on screen rather than a modal, so "Escape closes" here means closing
 * the *search*, not the navigation itself.
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
import { useEffect, useMemo, useState, type KeyboardEvent, type ReactElement } from 'react';
import { NavLink, useNavigate } from 'react-router-dom';
import { DEFAULT_UI_PREFERENCES, hasAnyScope, type UiPreferences } from '@nexa/types';
import { useApiClient, useAuth } from '../../lib/auth-store.js';
import { useTranslate } from '../../lib/i18n.js';
import { searchSections, sectionHref, visibleGroups } from './settings-sections.js';

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

const SEARCH_INPUT_ID = 'settings-nav-search';
const SEARCH_RESULTS_ID = 'settings-nav-search-results';

export function SettingsNav(): ReactElement {
  const t = useTranslate();
  const navigate = useNavigate();
  const scopes = useAuth((s) => s.agent?.scopes ?? []);
  const groups = visibleGroups(scopes);
  const { pinned, canToggle, toggle, saving } = useSettingsNavPin();

  const [query, setQuery] = useState('');
  const [activeIndex, setActiveIndex] = useState(0);
  const searching = query.trim().length > 0;
  const results = useMemo(
    () => searchSections(scopes, query, (section) => t(section.labelKey)),
    [scopes, query, t],
  );
  // A fresh query — or a shorter result set — must not leave the highlight
  // pointing past the end, or Enter would select nothing.
  useEffect(() => setActiveIndex(0), [results]);

  const onSearchKeyDown = (event: KeyboardEvent<HTMLInputElement>): void => {
    if (event.key === 'Escape') {
      // Closes the search, not the navigation: the grouped list beneath it
      // was never gone, only covered.
      event.preventDefault();
      setQuery('');
      return;
    }
    if (!searching || results.length === 0) return;
    if (event.key === 'ArrowDown') {
      event.preventDefault();
      setActiveIndex((index) => (index + 1) % results.length);
    } else if (event.key === 'ArrowUp') {
      event.preventDefault();
      setActiveIndex((index) => (index - 1 + results.length) % results.length);
    } else if (event.key === 'Enter') {
      event.preventDefault();
      const target = results[activeIndex];
      if (target) {
        navigate(sectionHref(target));
        setQuery('');
      }
    }
  };

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

  const searchBox = (
    <div className="flex flex-col gap-1 px-3 pt-3">
      <label htmlFor={SEARCH_INPUT_ID} className="sr-only">
        {t('settings.nav.search.label')}
      </label>
      <input
        id={SEARCH_INPUT_ID}
        type="text"
        role="combobox"
        aria-expanded={searching}
        aria-controls={SEARCH_RESULTS_ID}
        aria-autocomplete="list"
        aria-activedescendant={
          searching && results[activeIndex]
            ? `settings-nav-search-option-${activeIndex}`
            : undefined
        }
        placeholder={t('settings.nav.search.placeholder')}
        value={query}
        onChange={(event) => setQuery(event.target.value)}
        onKeyDown={onSearchKeyDown}
        className="w-full rounded-md border border-border bg-inset px-2 py-1.5 text-sm outline-none"
      />
      {/* Announced rather than read from the visible list itself, so a screen
          reader hears the count once rather than walking every result row. */}
      <p aria-live="polite" className="sr-only">
        {searching ? t('settings.nav.search.resultsCount', { count: results.length }) : ''}
      </p>
    </div>
  );

  const searchResults = (
    <div className="flex flex-col gap-0.5 p-3 pt-1">
      {results.length === 0 ? (
        <p className="px-2 py-1.5 text-sm text-content-tertiary">
          {t('settings.nav.search.empty', { query: query.trim() })}
        </p>
      ) : (
        <ul
          id={SEARCH_RESULTS_ID}
          role="listbox"
          aria-label={t('settings.nav.search.resultsLabel')}
          className="flex flex-col gap-0.5"
        >
          {results.map((section, index) => (
            <li key={section.slug} role="presentation">
              <NavLink
                id={`settings-nav-search-option-${index}`}
                role="option"
                aria-selected={index === activeIndex}
                to={sectionHref(section)}
                onMouseEnter={() => setActiveIndex(index)}
                onClick={() => setQuery('')}
                className={`block truncate rounded-md px-2 py-1.5 text-sm transition-colors ${
                  index === activeIndex
                    ? 'bg-brand-100 font-medium text-brand-700 dark:bg-brand-950 dark:text-content'
                    : 'text-content-secondary hover:bg-surface-2 hover:text-content'
                }`}
              >
                {t(section.labelKey)}
              </NavLink>
            </li>
          ))}
        </ul>
      )}
    </div>
  );

  const groupList = (
    <div className="flex flex-col gap-4 p-3 pt-1">
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
    </div>
  );

  const list = (
    <nav aria-label={t('settings.nav.label')} className="flex flex-col">
      {searchBox}
      {searching ? searchResults : groupList}
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
