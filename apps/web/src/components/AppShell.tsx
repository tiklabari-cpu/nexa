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
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useEffect, type ReactElement } from 'react';
import { NavLink, Outlet } from 'react-router-dom';
import { useApiClient, useAuth, useBrand } from '../lib/auth-store.js';
import { LOCALES, LOCALE_NAMES, useLocale, useTranslate } from '../lib/i18n.js';
import { useNavPinned } from '../lib/nav-store.js';
import { THEMES, THEME_NAMES, useTheme, type Theme } from '../lib/theme.js';
import { InviteTeammates } from '../features/team/InviteTeammates.js';
import { roleAtLeast } from '../features/team/RoleMenu.js';
import { CommandPalette } from './CommandPalette.js';
import { PresenceAvatars } from './PresenceAvatars.js';
import { FOOTER, MODULES, isNavVisible, type NavDestination } from './navigation.js';
import { Dropdown } from './ui/index.js';

/** Matches the toggle's `aria-controls` to the rail it expands/collapses. */
const NAV_ID = 'app-shell-nav';

export function AppShell(): ReactElement {
  return (
    <div className="flex h-full flex-col bg-canvas text-content">
      <SandboxBadge />
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

interface SandboxInfo {
  is_sandbox: boolean;
}

/**
 * "You are in a sandbox" (FR-MOD-11.5 · 11.5-g) — persistent across every
 * module, because it is the one fact a person must not lose track of: acting
 * on this workspace touches no production data and nothing here is billed.
 *
 * **Read the module doc on `Sandbox.tsx` before touching this.** `is_sandbox`
 * is read fresh from `GET /settings/sandbox` — the same query key that screen
 * uses, so the two share one cache — never inferred from a client flag,
 * `localStorage`, or the current route. A caller below `admin`
 * (`minimumRole: 'admin'` on that route) simply gets a 403, which resolves to
 * `!data` the same way `TrialBanner`'s billing read does below: no retry
 * storm, no banner, not a claim either way about which workspace this is.
 */
function SandboxBadge(): ReactElement | null {
  const api = useApiClient();
  const t = useTranslate();
  const { data } = useQuery({
    queryKey: ['settings', 'sandbox'],
    queryFn: () => api.get<SandboxInfo>('/settings/sandbox'),
    retry: false,
    staleTime: 60_000,
  });

  if (!data?.is_sandbox) return null;

  return (
    <div
      role="status"
      data-testid="sandbox-badge"
      className="flex items-center justify-center gap-2 border-b border-border bg-warning/10 px-4 py-1.5 text-xs text-content"
    >
      <span aria-hidden="true">◐</span>
      <span>{t('shell.sandbox.notice')}</span>
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
      <span>{readOnly ? t('shell.trial.ended') : t('shell.trial.remaining', { count: days })}</span>
      <NavLink
        to="/app/billing"
        className="font-semibold text-content-brand underline-offset-2 hover:underline"
      >
        {t('shell.subscribe')}
      </NavLink>
    </div>
  );
}

function IconRail(): ReactElement {
  const t = useTranslate();
  const scopes = useAuth((s) => s.agent?.scopes ?? []);
  const accountId = useAuth((s) => s.agent?.account_id);
  const role = useAuth((s) => s.agent?.role ?? null);
  const { pinned, setPinned } = useNavPinned(accountId);
  // `POST /invitations` requires `accounts--all:rw` (ADMIN_SCOPES) — an agent
  // role never carries it, so the rail hides the door rather than showing one
  // that only 403s (FR-MOD-01.1.5).
  const canInvite = roleAtLeast(role, 'admin');

  return (
    <nav
      id={NAV_ID}
      aria-label={t('shell.modules')}
      className={`flex shrink-0 flex-col gap-1 bg-rail py-3 ${
        pinned ? 'w-60 items-stretch px-2' : 'w-rail items-center'
      }`}
    >
      <NavPinToggle pinned={pinned} onToggle={() => setPinned(!pinned)} />

      <BrandSwitcher />

      {MODULES.map((item) => (
        <RailButton key={item.to} item={item} pinned={pinned} />
      ))}

      <div className={`mt-auto flex flex-col gap-1 ${pinned ? 'items-stretch' : 'items-center'}`}>
        {/* Online teammates (FR-MOD-01.1.4) — above the account avatar, so the
            rail ends with "who else is here" and then "who I am". */}
        <PresenceAvatars pinned={pinned} />
        {/* Qualified leads (FR-MOD-01.1.2) — "what needs a look", between who's
            online and who to invite. */}
        <LeadsPill pinned={pinned} />
        {canInvite && <InviteRailButton pinned={pinned} />}
        {FOOTER.filter((item) => isNavVisible(item, scopes)).map((item) => (
          <RailButton key={item.to} item={item} pinned={pinned} />
        ))}
        <AccountMenu />
      </div>
    </nav>
  );
}

/**
 * The rail's logo doubles as its pin/unpin control (FR-MOD-01.1.1 · 01.5) — a
 * `<button>` rather than the decorative `<span>` it replaces, so the state it
 * drives (`aria-expanded`) and the rail it drives (`aria-controls`) are both
 * exposed to assistive tech. A native button already answers Enter and Space,
 * so no extra keyboard wiring is needed.
 */
function NavPinToggle({
  pinned,
  onToggle,
}: {
  pinned: boolean;
  onToggle: () => void;
}): ReactElement {
  const t = useTranslate();
  const label = t(pinned ? 'shell.nav.collapse' : 'shell.nav.expand');

  return (
    <button
      type="button"
      aria-expanded={pinned}
      aria-controls={NAV_ID}
      aria-label={label}
      title={label}
      onClick={onToggle}
      className="mb-3 flex h-8 w-8 shrink-0 items-center justify-center rounded-md bg-brand-500 text-sm font-bold text-white hover:bg-brand-600"
    >
      N
    </button>
  );
}

function RailButton({ item, pinned }: { item: NavDestination; pinned: boolean }): ReactElement {
  const t = useTranslate();
  const label = t(item.labelKey);
  const shared = `relative flex h-9 items-center gap-3 rounded-md text-base transition-colors ${
    pinned ? 'px-3' : 'w-9 justify-center'
  }`;

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
              className={`absolute h-5 w-0.5 rounded-full bg-brand-500 ${pinned ? '-left-2' : '-left-3'}`}
            />
          )}
          <span aria-hidden="true">{item.icon}</span>
          {pinned && <span className="truncate text-sm">{label}</span>}
        </>
      )}
    </NavLink>
  );
}

interface SeatsInfo {
  seats: number;
}

interface RosterCount {
  items: unknown[];
}

/**
 * "Invite +N" (FR-MOD-01.1.5) — reachable from every module, not just Team.
 *
 * Opens `InviteTeammates`'s own modal through its `trigger` render prop, so
 * the form, validation and mutation stay in one place (CONVENTIONS §5 — no
 * second copy); only this button is new. Mounted only when `canInvite`
 * (IconRail), which already mirrors the server's role gate, so the button
 * itself does not repeat that check.
 *
 * "+N" is free seats (`seats − active teammates`), read through the same
 * `['billing','subscription']` and `['agents']` cache keys `TrialBanner` and
 * `PresenceAvatars` already populate on every mount — no extra request in the
 * common case. Either read not yet resolved (or refused) falls back to the
 * plain label rather than blocking the button on two round trips.
 */
function InviteRailButton({ pinned }: { pinned: boolean }): ReactElement {
  const t = useTranslate();
  const api = useApiClient();

  const subscription = useQuery({
    queryKey: ['billing', 'subscription'],
    queryFn: () => api.get<SeatsInfo>('/billing/subscription'),
    retry: false,
    staleTime: 60_000,
  });
  const roster = useQuery({
    queryKey: ['agents'],
    queryFn: () => api.get<RosterCount>('/agents'),
    retry: false,
  });

  const free =
    subscription.data && roster.data ? subscription.data.seats - roster.data.items.length : null;
  const label =
    free === null ? t('shell.invite.label') : t('shell.invite.labelWithCount', { count: free });

  return (
    <InviteTeammates
      trigger={(open) => (
        <button
          type="button"
          onClick={open}
          aria-label={label}
          title={label}
          className={`flex h-9 items-center gap-3 rounded-md text-base text-white/50 transition-colors hover:bg-white/5 hover:text-white ${
            pinned ? 'px-3' : 'w-9 justify-center'
          }`}
        >
          <span aria-hidden="true">⊕</span>
          {pinned && <span className="truncate text-sm">{label}</span>}
        </button>
      )}
    />
  );
}

interface LeadsCount {
  total: number;
}

/**
 * "N Leads qualified" pill (FR-MOD-01.1.2) — reachable from every module, next
 * to `PresenceAvatars` and `InviteRailButton` above.
 *
 * **"Qualified"** is `segment=leads` on `GET /customers` ("gave an email") —
 * the exact filter the Customers page's own Leads tab already uses, read with
 * `limit=1` since only the response's `total` is needed here, not a page of
 * rows. `/reports/overview` also carries a lead figure, but this one is the
 * literal PRD wording ("lead görünümü") and keeps the count and the screen it
 * links to answering the same question.
 *
 * No RTM push carries this count (opening one would be a new RTM action, out
 * of scope here), so — like `PresenceAvatars`'s off-Inbox fallback — it polls.
 *
 * Hidden entirely at 0, including while the read is pending or refused: the
 * PRD's own acceptance text ("Sayı>0 iken görünür") asks for exactly that,
 * and a caller without `customers:ro` should see one fewer rail item rather
 * than a pill stuck at zero.
 */
function LeadsPill({ pinned }: { pinned: boolean }): ReactElement | null {
  const t = useTranslate();
  const api = useApiClient();

  const { data } = useQuery({
    queryKey: ['customers', 'leads', 'count'],
    queryFn: () => api.get<LeadsCount>('/customers?segment=leads&limit=1'),
    retry: false,
    refetchInterval: 60_000,
  });

  const count = data?.total ?? 0;
  if (count === 0) return null;

  const label = t('shell.leads.label', { count });

  return (
    <NavLink
      to="/app/customers?segment=leads"
      aria-label={label}
      title={label}
      className={`relative flex h-9 items-center gap-3 rounded-md text-base text-white/50 transition-colors hover:bg-white/5 hover:text-white ${
        pinned ? 'px-3' : 'w-9 justify-center'
      }`}
    >
      <span aria-hidden="true">◔</span>
      {pinned ? (
        <span className="truncate text-sm">{label}</span>
      ) : (
        <span
          aria-hidden="true"
          className="absolute -top-1 -right-1 flex h-4 min-w-4 items-center justify-center rounded-full bg-brand-500 px-1 text-[10px] font-semibold leading-none text-white"
        >
          {count}
        </span>
      )}
    </NavLink>
  );
}

interface BrandSummary {
  id: string;
  name: string;
  is_default: boolean;
}

/**
 * Brand switcher (PRD §5.3-Marka) — hidden entirely on a single-brand license,
 * so the common case carries no extra chrome. The selection is persisted the
 * same way as the language preference (`lib/i18n.ts`), and every request
 * after a change picks it up through `api-client.ts`'s `X-Nexa-Brand` header.
 *
 * The reconciliation effect below is what makes "invalid/deleted brand id"
 * safe: a remembered selection that the license no longer has (or a license
 * that now has just one brand) is treated the same as no selection, falling
 * back to the license's default brand rather than sending a header the server
 * would 404 on.
 */
function BrandSwitcher(): ReactElement | null {
  const api = useApiClient();
  const queryClient = useQueryClient();
  const { brandId, setBrandId } = useBrand();
  const t = useTranslate();

  const { data } = useQuery({
    queryKey: ['settings', 'brands'],
    queryFn: () => api.get<{ items: BrandSummary[] }>('/brands'),
    staleTime: 60_000,
  });
  const brands = data?.items ?? [];

  useEffect(() => {
    if (brands.length === 0) return;
    if (brands.length < 2) {
      // A single brand needs no header at all — NULL context already resolves
      // to it — so a stale id from a since-shrunk license is cleared too.
      if (brandId !== null) setBrandId(null);
      return;
    }
    if (!brands.some((brand) => brand.id === brandId)) {
      setBrandId((brands.find((brand) => brand.is_default) ?? brands[0])!.id);
    }
  }, [brands, brandId, setBrandId]);

  if (brands.length < 2) return null;

  const current = brands.find((brand) => brand.id === brandId) ?? brands[0]!;

  function selectBrand(id: string, close: (returnFocus?: boolean) => void): void {
    if (id !== current.id) {
      setBrandId(id);
      // Every screen's data is scoped by brand; nothing about the previous
      // brand's cache is still valid once the header changes.
      void queryClient.invalidateQueries();
    }
    close(true);
  }

  return (
    <Dropdown
      label={t('shell.brand')}
      triggerTitle={current.name}
      trigger={current.name.slice(0, 2).toUpperCase()}
      triggerClassName="mb-2 flex h-9 w-9 items-center justify-center rounded-md bg-white/10 text-2xs font-semibold text-white"
      panelClassName="left-11 top-0 w-48 p-1"
    >
      {({ close }) => (
        <ul role="listbox" aria-label={t('shell.brand')}>
          {brands.map((brand) => (
            <li key={brand.id}>
              <button
                type="button"
                role="option"
                aria-selected={brand.id === current.id}
                onClick={() => selectBrand(brand.id, close)}
                className="flex w-full items-center justify-between rounded-md px-2 py-1.5 text-left text-sm hover:bg-surface-2"
              >
                {brand.name}
                {brand.id === current.id && <span aria-hidden="true">✓</span>}
              </button>
            </li>
          ))}
        </ul>
      )}
    </Dropdown>
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
  const { theme, setTheme } = useTheme();

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

          {/* Theme switcher (NFR-I18N2), beside the language it is paired with in
              the requirement. The attribute it drives is on `<html>`, so the
              whole panel — and the widget preview inside Settings — repaints at
              once; nothing here has to re-render for the change to land. */}
          <label className="mt-3 block text-2xs font-medium uppercase tracking-wide text-content-tertiary">
            {t('shell.account.theme')}
            <select
              value={theme}
              onChange={(event) => setTheme(event.target.value as Theme)}
              className="mt-1 w-full rounded-md border border-border bg-surface px-2 py-1.5 text-sm normal-case tracking-normal text-content"
            >
              {THEMES.map((code) => (
                <option key={code} value={code}>
                  {t(THEME_NAMES[code])}
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
