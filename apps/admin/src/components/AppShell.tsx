/**
 * The signed-in shell (tm 389.6): the PLATFORM strip with the operator's own controls, the
 * side menu built from the operator's permissions, and the page under it.
 *
 * Desktop-only by decision (≥ 1280 px): a back office is worked at a desk, and below that width
 * a fixed notice says so instead of a half-usable layout (the workspace panel's narrow-screen
 * work, #385, belongs to that panel and is not carried over).
 */
import type { ReactElement } from 'react';
import { NavLink, Outlet } from 'react-router-dom';
import { useAuth } from '../lib/auth-store.js';
import { useTranslate } from '../lib/i18n.js';
import { visibleNavItems } from '../lib/navigation.js';
import { PlatformStrip } from './PlatformStrip.js';
import { PreferenceControls } from './PreferenceControls.js';

export function AppShell(): ReactElement {
  const t = useTranslate();
  const me = useAuth((s) => s.me);
  const signOut = useAuth((s) => s.signOut);
  const items = visibleNavItems(me?.permissions ?? []);

  return (
    <div className="flex h-full flex-col">
      <a
        href="#main"
        className="sr-only focus:not-sr-only focus:absolute focus:left-2 focus:top-2 focus:z-50 focus:rounded focus:bg-surface focus:px-3 focus:py-1.5 focus:text-sm"
      >
        {t('shell.skipToContent')}
      </a>
      <PlatformStrip>
        {me && (
          <>
            <p className="text-xs">
              <span>{t('shell.account.signedInAs', { email: me.admin.email })}</span>
              <span className="ml-2 rounded bg-strip-text px-1.5 py-0.5 text-2xs font-semibold text-strip">
                {t(`shell.role.${me.admin.role}`)}
              </span>
            </p>
            <PreferenceControls />
            <button
              type="button"
              onClick={() => void signOut()}
              className="rounded border border-strip-text/50 px-2 py-0.5 text-xs font-medium text-strip-text hover:bg-strip-text/10"
            >
              {t('shell.account.signOut')}
            </button>
          </>
        )}
      </PlatformStrip>

      <div className="flex min-h-0 flex-1">
        <nav
          aria-label={t('shell.nav.label')}
          className="flex w-sidebar shrink-0 flex-col gap-0.5 overflow-y-auto bg-rail p-3"
        >
          {items.map((item) => (
            <NavLink
              key={item.id}
              to={item.path}
              className={({ isActive }) =>
                `rounded-md px-3 py-1.5 text-sm font-medium ${
                  isActive ? 'bg-white/15 text-white' : 'text-white/80 hover:bg-white/10'
                }`
              }
            >
              {t(item.labelKey)}
            </NavLink>
          ))}
        </nav>
        <main id="main" tabIndex={-1} className="flex min-w-0 flex-1 flex-col outline-none">
          <p
            role="note"
            className="border-b border-border bg-surface-2 px-6 py-2 text-xs text-content-secondary xl:hidden"
          >
            {t('shell.narrow.notice')}
          </p>
          <Outlet />
        </main>
      </div>
    </div>
  );
}
