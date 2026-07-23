/**
 * The persistent shell: icon rail on the left, the active module beside it.
 *
 * Routes are deep-linkable (`/app/reports`, not a tab in component state) as
 * PRD §8.1 requires — an agent needs to be able to send a colleague a link to
 * what they are looking at, and a reload must not drop them back to the inbox.
 *
 * Modules with no UI yet are rendered as disabled rail entries rather than
 * hidden. Hiding them would imply the product does not have them; disabling
 * them says "not here yet", which is the truth.
 */
import { useEffect, useRef, useState, type ReactElement } from 'react';
import { NavLink, Outlet } from 'react-router-dom';
import { useAuth } from '../lib/auth-store.js';

interface RailItem {
  to: string;
  label: string;
  icon: string;
  enabled: boolean;
}

const MODULES: RailItem[] = [
  { to: '/app/inbox', label: 'Inbox', icon: '▤', enabled: true },
  { to: '/app/customers', label: 'Customers', icon: '◫', enabled: false },
  { to: '/app/team', label: 'Team', icon: '◑', enabled: true },
  { to: '/app/playbook', label: 'Playbook', icon: '✦', enabled: false },
  { to: '/app/reports', label: 'Reports', icon: '◆', enabled: true },
];

const FOOTER: RailItem[] = [
  { to: '/app/billing', label: 'Billing', icon: '◈', enabled: true },
  { to: '/app/settings', label: 'Settings', icon: '⚙', enabled: false },
];

export function AppShell(): ReactElement {
  return (
    <div className="flex h-full bg-canvas text-content">
      <IconRail />
      <Outlet />
    </div>
  );
}

function IconRail(): ReactElement {
  return (
    <nav
      aria-label="Modules"
      className="flex w-rail shrink-0 flex-col items-center gap-1 bg-rail py-3"
    >
      <span
        aria-hidden="true"
        className="mb-3 flex h-8 w-8 items-center justify-center rounded-md bg-brand-500 text-sm font-bold text-white"
      >
        N
      </span>

      {MODULES.map((item) => (
        <RailButton key={item.label} item={item} />
      ))}

      <div className="mt-auto flex flex-col items-center gap-1">
        {FOOTER.map((item) => (
          <RailButton key={item.label} item={item} />
        ))}
        <AccountMenu />
      </div>
    </nav>
  );
}

function RailButton({ item }: { item: RailItem }): ReactElement {
  const shared =
    'relative flex h-9 w-9 items-center justify-center rounded-md text-base transition-colors';

  if (!item.enabled) {
    return (
      <button
        type="button"
        disabled
        aria-label={`${item.label} — not available yet`}
        title={`${item.label} — not available yet`}
        className={`${shared} cursor-not-allowed text-white/25`}
      >
        <span aria-hidden="true">{item.icon}</span>
      </button>
    );
  }

  return (
    <NavLink
      to={item.to}
      aria-label={item.label}
      title={item.label}
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
 * Account menu, built on `<details>` so it is keyboard-operable without a
 * popover library or a focus trap of our own.
 *
 * The panel is hidden with an explicit `hidden group-open:block` rather than by
 * letting the browser hide a closed `<details>`'s children. That default does
 * not survive `position: absolute`: the panel kept its 224×130 box, stayed in
 * the accessibility tree with a reachable "Sign out", and painted behind the
 * page — invisible on screen but present to a screen reader and to tab order.
 */
function AccountMenu(): ReactElement {
  const agent = useAuth((s) => s.agent);
  const signOut = useAuth((s) => s.signOut);
  const ref = useRef<HTMLDetailsElement>(null);
  const [open, setOpen] = useState(false);

  const close = (returnFocus: boolean): void => {
    const details = ref.current;
    if (!details?.open) return;
    details.open = false;
    setOpen(false);
    if (returnFocus) details.querySelector('summary')?.focus();
  };

  // Escape closes it, as a menu is expected to.
  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent): void => {
      if (event.key === 'Escape') close(true);
    };
    document.addEventListener('keydown', onKeyDown);
    return () => document.removeEventListener('keydown', onKeyDown);
  }, []);

  // Clicking anywhere else closes it, rather than leaving a stray panel open
  // over whatever the agent moved on to.
  useEffect(() => {
    const onPointerDown = (event: PointerEvent): void => {
      const details = ref.current;
      if (!details?.open) return;
      if (event.target instanceof Node && details.contains(event.target)) return;
      close(false);
    };
    document.addEventListener('pointerdown', onPointerDown);
    return () => document.removeEventListener('pointerdown', onPointerDown);
  }, []);

  const initials = (agent?.name ?? agent?.email ?? '?')
    .split(/[\s@.]+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((part) => part[0]?.toUpperCase() ?? '')
    .join('');

  return (
    <details
      ref={ref}
      className="group relative"
      onToggle={(event) => setOpen((event.currentTarget as HTMLDetailsElement).open)}
    >
      <summary
        // `<summary>` alone is announced as a plain grouping element, which
        // tells a screen reader user neither that it opens something nor
        // whether it is currently open. Both have to be stated.
        role="button"
        aria-expanded={open}
        aria-label="Account"
        title={agent?.email ?? 'Account'}
        className="flex h-9 w-9 cursor-pointer list-none items-center justify-center rounded-full bg-white/10 text-2xs font-semibold text-white marker:content-none"
      >
        {initials}
      </summary>

      <div
        // Anchored above the trigger: the rail sits at the bottom of the screen,
        // so a downward menu would open off-screen.
        className="absolute bottom-11 left-0 z-20 hidden w-56 rounded-lg border border-border bg-surface p-3 shadow-md group-open:block"
      >
        <p className="truncate text-sm font-medium">{agent?.name ?? 'Agent'}</p>
        <p className="truncate text-xs text-content-secondary">{agent?.email}</p>
        <p className="mt-1 text-2xs uppercase tracking-wide text-content-tertiary">{agent?.role}</p>

        <button
          type="button"
          onClick={() => {
            close(false);
            void signOut();
          }}
          className="mt-3 w-full rounded-md border border-border px-2 py-1.5 text-sm hover:bg-surface-2"
        >
          Sign out
        </button>
      </div>
    </details>
  );
}
