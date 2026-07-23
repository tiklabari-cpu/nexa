/**
 * Shell navigation and the account menu.
 *
 * The account menu is tested harder than its size suggests because it shipped
 * broken once: it relied on the browser hiding a closed `<details>`'s children,
 * which does not hold once the panel is `position: absolute`. In Chrome the
 * panel kept its 224×130 box, stayed in the accessibility tree with a working
 * "Sign out", and merely painted behind the page — invisible on screen, fully
 * present to a screen reader and to tab order.
 *
 * Note what these tests can and cannot see. `toBeVisible()` special-cases
 * descendants of a closed `<details>` and reports them hidden regardless of
 * CSS, and jsdom loads no stylesheet, so neither can observe the actual defect —
 * verified by reintroducing it and watching them still pass. The visibility
 * assertions cover open/close *behaviour*; the explicit class assertion below is
 * what guards the regression, because that class is the mechanism the browser
 * actually obeys. A real rendered check belongs in the browser E2E suite.
 */
import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { AppShell } from './AppShell.js';
import { useAuth } from '../lib/auth-store.js';

function renderShell(initialPath = '/app/inbox') {
  return render(
    <MemoryRouter initialEntries={[initialPath]}>
      <Routes>
        <Route path="/app" element={<AppShell />}>
          <Route path="inbox" element={<p>Inbox module</p>} />
          <Route path="reports" element={<p>Reports module</p>} />
        </Route>
      </Routes>
    </MemoryRouter>,
  );
}

beforeEach(() => {
  useAuth.setState({
    status: 'signed-in',
    accessToken: 'test-token',
    agent: {
      account_id: 'a-1',
      email: 'dana@acme.localhost',
      name: 'Dana Okonkwo',
      role: 'owner',
      organization_id: 'o-1',
      license_id: '1000003',
      scopes: [],
      routing_status: 'accepting_chats',
    },
  });
});

describe('module navigation', () => {
  it('renders the active module beside the rail', () => {
    renderShell('/app/reports');
    expect(screen.getByText('Reports module')).toBeInTheDocument();
  });

  it('marks the current module as the current page', () => {
    renderShell('/app/reports');
    expect(screen.getByRole('link', { name: 'Reports' })).toHaveAttribute('aria-current', 'page');
    expect(screen.getByRole('link', { name: 'Inbox' })).not.toHaveAttribute('aria-current');
  });

  it('gives every rail control an accessible name', () => {
    // The rail is icon-only, so without these it is a column of unlabelled
    // buttons to anyone not looking at it (NFR-A11Y5).
    renderShell();
    for (const name of ['Inbox', 'Customers', 'Team', 'Playbook', 'Reports', 'Billing']) {
      expect(screen.getByRole('link', { name })).toBeInTheDocument();
    }
  });

  it('leaves no dead entries in the rail', () => {
    // Every module is built, so every rail entry navigates. A disabled entry
    // here would mean a module was linked before it existed.
    renderShell();
    for (const name of [
      'Inbox',
      'Customers',
      'Team',
      'Playbook',
      'Reports',
      'Billing',
      'Settings',
    ]) {
      expect(screen.getByRole('link', { name })).toBeInTheDocument();
    }
    expect(screen.queryByRole('button', { name: /not available yet/ })).toBeNull();
  });
});

describe('account menu', () => {
  it('keeps sign out out of reach while closed', () => {
    renderShell();
    expect(screen.getByRole('button', { name: 'Sign out' })).not.toBeVisible();
  });

  it('hides the panel with display, not merely with paint order', () => {
    // The regression guard. The panel must carry `hidden` so it is display:none
    // when closed, and `group-open:block` so it returns when open. Relying on
    // the browser to hide a closed `<details>`'s children is what failed: an
    // absolutely positioned panel kept its box, its hit area and its place in
    // the accessibility tree while appearing to be gone.
    renderShell();
    const panel = screen.getByRole('button', { name: 'Sign out' }).parentElement;
    expect(panel).toHaveClass('hidden');
    expect(panel).toHaveClass('group-open:block');
  });

  it('reveals the account details on open', async () => {
    const user = userEvent.setup();
    renderShell();

    await user.click(screen.getByRole('button', { name: 'Account' }));

    const signOut = screen.getByRole('button', { name: 'Sign out' });
    expect(signOut).toBeVisible();
    expect(screen.getByText('dana@acme.localhost')).toBeVisible();
  });

  it('closes on Escape and hands focus back to the trigger', async () => {
    const user = userEvent.setup();
    renderShell();

    const summary = screen.getByRole('button', { name: 'Account' });
    await user.click(summary);
    expect(screen.getByRole('button', { name: 'Sign out' })).toBeVisible();

    await user.keyboard('{Escape}');

    expect(screen.getByRole('button', { name: 'Sign out' })).not.toBeVisible();
    // Focus must not be stranded on a node that is now hidden.
    expect(document.activeElement?.tagName).toBe('SUMMARY');
  });

  it('closes when the agent clicks elsewhere', async () => {
    const user = userEvent.setup();
    renderShell();

    await user.click(screen.getByRole('button', { name: 'Account' }));
    expect(screen.getByRole('button', { name: 'Sign out' })).toBeVisible();

    await user.click(screen.getByText('Inbox module'));

    expect(screen.getByRole('button', { name: 'Sign out' })).not.toBeVisible();
  });

  it('signs out and closes the menu behind itself', async () => {
    const user = userEvent.setup();
    const signOut = vi.fn(async () => undefined);
    useAuth.setState({ signOut });

    renderShell();
    await user.click(screen.getByRole('button', { name: 'Account' }));
    await user.click(screen.getByRole('button', { name: 'Sign out' }));

    expect(signOut).toHaveBeenCalledOnce();
    // Leaving it open would flash a stale menu over the sign-in screen.
    expect(screen.getByRole('button', { name: 'Sign out' })).not.toBeVisible();
  });

  it('builds initials from the name, falling back to the email', () => {
    renderShell();
    expect(
      within(screen.getByRole('button', { name: 'Account' })).getByText('DO'),
    ).toBeInTheDocument();

    useAuth.setState({
      agent: {
        account_id: 'a-2',
        email: 'sam.rivera@acme.localhost',
        name: null,
        role: 'agent',
        organization_id: 'o-1',
        license_id: '1000003',
        scopes: [],
        routing_status: 'offline',
      },
    });
    renderShell();
    expect(screen.getAllByText('SR').length).toBeGreaterThan(0);
  });
});
