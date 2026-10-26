/**
 * The shell for each role (tm 389.6 · FR-ADMIN-02): the menu shows what the role can open, a
 * route opened by hand that the role cannot open says so, and — the half that is the real rule —
 * a page whose own request the *server* refuses with 403 says so too. Hiding is courtesy, not
 * security.
 */
import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { PLATFORM_PERMISSIONS, PLATFORM_ROLES, type PlatformRole } from '@siyahtus/types';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ApiClientError } from '../lib/api-client.js';
import { NAV_ITEMS } from '../lib/navigation.js';
import { installFakePlatform, renderApp, resetSession } from '../test/render-app.js';
import { LoadError } from './LoadError.js';

afterEach(resetSession);

beforeEach(() => {
  globalThis.sessionStorage.clear();
});

/** Sign in as `role` and land in the shell at `path`. */
async function enter(role: PlatformRole, path: string): Promise<void> {
  installFakePlatform({ role });
  const user = userEvent.setup();
  renderApp(path);
  await user.type(await screen.findByLabelText('Email'), 'ops@example.com');
  await user.type(screen.getByLabelText('Password'), 'correct horse battery staple');
  await user.click(screen.getByRole('button', { name: 'Continue' }));
  await user.type(await screen.findByLabelText('Authenticator code'), '123456');
  await user.click(screen.getByRole('button', { name: 'Verify' }));
  await screen.findByRole('navigation', { name: 'Main menu' });
}

function menuLabels(): string[] {
  return within(screen.getByRole('navigation', { name: 'Main menu' }))
    .getAllByRole('link')
    .map((link) => link.textContent ?? '');
}

const LABEL: Record<string, string> = {
  dashboard: 'Dashboard',
  workspaces: 'Workspaces',
  accounts: 'Accounts',
  billing: 'Billing',
  usage: 'Usage',
  settings: 'Settings',
  ai: 'AI',
  operations: 'Operations',
  audit: 'Audit',
  security: 'Security',
  admins: 'Admins',
  support: 'Support',
};

describe('the menu', () => {
  it('lists the twelve pages for a superadmin, in order', async () => {
    await enter('superadmin', '/');

    expect(menuLabels()).toEqual(NAV_ITEMS.map((item) => LABEL[item.id]));
    expect(menuLabels()).toHaveLength(12);
  });

  it.each(PLATFORM_ROLES)('shows %s exactly the pages its permissions open', async (role) => {
    await enter(role, '/');

    const expected = NAV_ITEMS.filter((item) =>
      (PLATFORM_PERMISSIONS[item.permission].roles as readonly string[]).includes(role),
    ).map((item) => LABEL[item.id]);
    expect(menuLabels()).toEqual(expected);
  });

  it('hides Support and Accounts from a billing operator', async () => {
    await enter('billing', '/');

    expect(menuLabels()).not.toContain('Support');
    expect(menuLabels()).not.toContain('Accounts');
    expect(menuLabels()).toContain('Billing');
  });
});

describe('a route opened by hand', () => {
  it('shows the 403 screen for a read-only operator at /support, and none of the page', async () => {
    await enter('readonly', '/support');

    expect(
      await screen.findByRole('heading', { name: 'You do not have access to this page' }),
    ).toBeVisible();
    expect(screen.getByRole('alert')).toHaveTextContent(
      'Your role (Read-only) does not include it.',
    );
    expect(screen.queryByText('Nothing here yet')).toBeNull();
  });

  it('shows the 403 screen for a billing operator at /settings', async () => {
    await enter('billing', '/settings');

    expect(
      await screen.findByRole('heading', { name: 'You do not have access to this page' }),
    ).toBeVisible();
  });

  it('opens the same address for a superadmin', async () => {
    await enter('superadmin', '/settings');

    expect(await screen.findByRole('heading', { name: 'Settings', level: 1 })).toBeVisible();
  });

  it('shows a page that is not built yet as its placeholder', async () => {
    await enter('superadmin', '/operations');

    expect(await screen.findByRole('heading', { name: 'Operations', level: 1 })).toBeVisible();
    expect(screen.getByText('Nothing here yet')).toBeVisible();
  });

  it('keeps the shell around the refusal, so the menu is still there to leave by', async () => {
    const user = userEvent.setup();
    await enter('readonly', '/support');
    await screen.findByRole('heading', { name: 'You do not have access to this page' });

    await user.click(screen.getByRole('link', { name: 'Audit' }));

    expect(await screen.findByRole('heading', { name: 'Audit', level: 1 })).toBeVisible();
  });

  it('says an address that is not a page is not a page', async () => {
    await enter('superadmin', '/no-such-page');

    expect(await screen.findByRole('heading', { name: 'Page not found' })).toBeVisible();
    expect(screen.getByRole('navigation', { name: 'Main menu' })).toBeVisible();
  });

  it('goes to the dashboard from the bare address', async () => {
    await enter('superadmin', '/');

    expect(await screen.findByRole('heading', { name: 'Dashboard', level: 1 })).toBeVisible();
  });
});

describe('a page the server refuses', () => {
  it('reads a 403 `authorization` as "no access", with no retry', () => {
    const onRetry = vi.fn();
    render(
      <LoadError
        title="Workspaces could not be loaded"
        error={
          new ApiClientError({
            type: 'authorization',
            status: 403,
            message: 'Your operator role does not allow this.',
            requestId: 'r1',
          })
        }
        onRetry={onRetry}
      />,
    );

    expect(screen.getByRole('alert')).toHaveTextContent('You do not have access to this page');
    expect(screen.getByRole('alert')).toHaveTextContent(
      'The server refused this request for your role.',
    );
    expect(screen.queryByRole('button', { name: 'Try again' })).toBeNull();
    // Never the server's own English wording.
    expect(screen.queryByText(/operator role does not allow/)).toBeNull();
  });

  it('still offers a retry for a failure that retrying can fix', async () => {
    const user = userEvent.setup();
    const onRetry = vi.fn();
    render(
      <LoadError
        title="Workspaces could not be loaded"
        error={
          new ApiClientError({ type: 'network', status: 0, message: 'offline', requestId: '-' })
        }
        onRetry={onRetry}
      />,
    );

    expect(screen.getByRole('alert')).toHaveTextContent('Could not reach the server');
    await user.click(screen.getByRole('button', { name: 'Try again' }));
    expect(onRetry).toHaveBeenCalledOnce();
  });
});

describe('the narrow-screen notice', () => {
  it('is in the page for the CSS to show below 1280 px and hide above it', async () => {
    await enter('superadmin', '/');

    const notice = screen.getByRole('note');
    expect(notice).toHaveTextContent('built for screens at least 1280 px wide');
    // Tailwind's `xl` breakpoint is 1280 px: the class is what hides it on a desktop.
    expect(notice).toHaveClass('xl:hidden');
  });
});
