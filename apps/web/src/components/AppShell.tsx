/**
 * The persistent shell: icon rail on the left, the active module beside it.
 *
 * Routes are deep-linkable (`/app/reports`, not a tab in component state) as
 * PRD §8.1 requires — an agent needs to be able to send a colleague a link to
 * what they are looking at, and a reload must not drop them back to the inbox.
 *
 * Every module in the rail is built and reachable. Earlier revisions rendered
 * the unbuilt ones as disabled entries — visible but inert, which said "not
 * here yet" rather than implying the product lacked them. Nothing is inert now,
 * so that branch is gone rather than kept as untested code.
 */
import { useQuery } from '@tanstack/react-query';
import { type ReactElement } from 'react';
import { NavLink, Outlet } from 'react-router-dom';
import { useApiClient, useAuth } from '../lib/auth-store.js';
import { LOCALES, LOCALE_NAMES, useLocale, useTranslate } from '../lib/i18n.js';
import { CommandPalette } from './CommandPalette.js';
import { FOOTER, MODULES, type NavDestination } from './navigation.js';
import { Dropdown } from './ui/index.js';

export function AppShell(): ReactElement {
  return (
    <div className="flex h-full flex-col bg-canvas text-content">
      <TrialBanner />
      <div className="flex min-h-0 flex-1">
        <IconRail />
        <Outlet />
      </div>
      {/* Reachable from every module: ⌘K opens it, and it lives outside the
          scrolling area so it overlays whatever is on screen. */}
      <CommandPalette />
    </div>
  );
}

interface TrialInfo {
  access: 'trialing' | 'active' | 'read_only';
  trial: { days_remaining: number | null };
}

/**
 * Trial countdown + Subscribe (FR-MOD-00.2, 01.1.6).
 *
 * A thin bar rather than a rail item: the rail is icon-width, and "12 days
 * left · Subscribe" is text that has to be readable from any module. It reads
 * the same `['billing', 'subscription']` the Billing page does, so the count is
 * one source and the cache is shared.
 *
 * Only owners and admins carry a billing scope; for anyone else the read is a
 * 403, which resolves to no banner rather than a retry storm — the people who
 * cannot subscribe are also the ones not nagged to. An active workspace shows
 * nothing at all.
 */
function TrialBanner(): ReactElement | null {
  const api = useApiClient();
  const t = useTranslate();
  const { data } = useQuery({
    queryKey: ['billing', 'subscription'],
    queryFn: () => api.get<TrialInfo>('/billing/subscription'),
    retry: false,
    staleTime: 60_000,
  });

  if (!data || data.access === 'active') return null;

  const readOnly = data.access === 'read_only';
  const days = data.trial.days_remaining ?? 0;

  return (
    <div
      role="status"
      data-testid="trial-badge"
      className="flex items-center justify-center gap-2 border-b border-border bg-brand-500/10 px-4 py-1.5 text-xs text-content"
    >
      <span aria-hidden="true">◈</span>
      <span>
        {readOnly
          ? t('shell.trial.ended')
          : t('shell.trial.remaining', { days, s: days === 1 ? '' : 's' })}
      </span>
      <NavLink
        to="/app/billing"
        className="font-semibold text-brand-600 underline-offset-2 hover:underline"
      >
        {t('shell.subscribe')}
      </NavLink>
    </div>
  );
}

function IconRail(): ReactElement {
  const t = useTranslate();
  return (
    <nav
      aria-label={t('shell.modules')}
      className="flex w-rail shrink-0 flex-col items-center gap-1 bg-rail py-3"
    >
      <span
        aria-hidden="true"
        className="mb-3 flex h-8 w-8 items-center justify-center rounded-md bg-brand-500 text-sm font-bold text-white"
      >
        N
      </span>

      {MODULES.map((item) => (
        <RailButton key={item.to} item={item} />
      ))}

      <div className="mt-auto flex flex-col items-center gap-1">
        {FOOTER.map((item) => (
          <RailButton key={item.to} item={item} />
        ))}
        <AccountMenu />
      </div>
    </nav>
  );
}

function RailButton({ item }: { item: NavDestination }): ReactElement {
  const t = useTranslate();
  const label = t(item.labelKey);
  const shared =
    'relative flex h-9 w-9 items-center justify-center rounded-md text-base transition-colors';

  return (
    <NavLink
      to={item.to}
      aria-label={label}
      title={label}
      className={({ isActive }) =>
        `${shared} ${isActive ? 'bg-white/10 text-white' : 'text-white/50 hover:bg-white/5 hover:text-white'}`
      }
    >
      {({ isActive }) => (
        <>
          {isActive && (
            <span
              aria-hidden="true"
              className="absolute -left-3 h-5 w-0.5 rounded-full bg-brand-500"
            />
          )}
          <span aria-hidden="true">{item.icon}</span>
        </>
      )}
    </NavLink>
  );
}

/**
 * Account menu — the shared Dropdown primitive (FR-EK-C.2), which carries the
 * `<details>`-based keyboard operability, Escape-to-close-and-return-focus, the
 * outside-click dismiss, and the `hidden group-open:block` hiding this menu
 * proved out (a closed `<details>`'s children are not hidden once absolutely
 * positioned — they keep their box, hit area and place in the accessibility
 * tree). Every menu in the app now inherits that rather than re-deriving it.
 */
function AccountMenu(): ReactElement {
  const agent = useAuth((s) => s.agent);
  const signOut = useAuth((s) => s.signOut);
  const t = useTranslate();
  const { locale, setLocale } = useLocale();

  const initials = (agent?.name ?? agent?.email ?? '?')
    .split(/[\s@.]+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((part) => part[0]?.toUpperCase() ?? '')
    .join('');

  return (
    <Dropdown
      label={t('shell.account')}
      triggerTitle={agent?.email ?? t('shell.account')}
      trigger={initials}
      triggerClassName="flex h-9 w-9 items-center justify-center rounded-full bg-white/10 text-2xs font-semibold text-white"
      // Anchored above the trigger: the rail sits at the bottom of the screen,
      // so a downward menu would open off-screen.
      panelClassName="bottom-11 left-0 w-56 p-3"
    >
      {({ close }) => (
        <>
          <p className="truncate text-sm font-medium">
            {agent?.name ?? t('shell.account.agentFallback')}
          </p>
          <p className="truncate text-xs text-content-secondary">{agent?.email}</p>
          <p className="mt-1 text-2xs uppercase tracking-wide text-content-tertiary">
            {agent?.role}
          </p>

          {/* Language switcher (I18N1): a plain labelled select so the whole panel
              re-renders in the chosen language the instant it changes. */}
          <label className="mt-3 block text-2xs font-medium uppercase tracking-wide text-content-tertiary">
            {t('shell.account.language')}
            <select
              value={locale}
              onChange={(event) => setLocale(event.target.value as (typeof LOCALES)[number])}
              className="mt-1 w-full rounded-md border border-border bg-surface px-2 py-1.5 text-sm normal-case tracking-normal text-content"
            >
              {LOCALES.map((code) => (
                <option key={code} value={code}>
                  {LOCALE_NAMES[code]}
                </option>
              ))}
            </select>
          </label>

          <button
            type="button"
            onClick={() => {
              close(false);
              void signOut();
            }}
            className="mt-3 w-full rounded-md border border-border px-2 py-1.5 text-sm hover:bg-surface-2"
          >
            {t('shell.account.signOut')}
          </button>
        </>
      )}
    </Dropdown>
  );
}
