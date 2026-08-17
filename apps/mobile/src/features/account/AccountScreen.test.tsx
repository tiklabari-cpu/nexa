import { act, fireEvent, render, screen } from '@testing-library/react-native';
import type { ReactElement } from 'react';

import { AccountScreen } from './AccountScreen';
import type { SessionPrincipal } from '../../auth/session';
import { ThemeProvider } from '../../theme/theme';

function principal(overrides: Partial<SessionPrincipal> = {}): SessionPrincipal {
  return {
    account_id: 'acc-1',
    email: 'ada@acme.test',
    name: 'Ada Owner',
    role: 'owner',
    organization_id: 'org-1',
    organization_name: 'Acme',
    license_id: '4',
    scopes: [],
    ...overrides,
  };
}

interface Harness {
  onSignOut: jest.Mock;
  onSwitchAccount: jest.Mock;
}

function harness(): Harness {
  return {
    onSignOut: jest.fn(async () => undefined),
    onSwitchAccount: jest.fn(),
  };
}

/**
 * RNTL v14 renders through a concurrent root, so `render` returns a promise —
 * an un-awaited one leaves `screen` empty rather than failing loudly (the same
 * note `BillingScreen.test.tsx` carries).
 */
async function mount(p: SessionPrincipal | null, h: Harness): Promise<void> {
  const tree: ReactElement = (
    <ThemeProvider>
      <AccountScreen principal={p} onSignOut={h.onSignOut} onSwitchAccount={h.onSwitchAccount} />
    </ThemeProvider>
  );
  await render(tree);
  await act(async () => {});
}

describe('AccountScreen', () => {
  it('shows who is signed in, on which workspace, and their role', async () => {
    const h = harness();
    await mount(principal(), h);

    expect(screen.getByTestId('account-name')).toHaveTextContent('Ada Owner');
    expect(screen.getByTestId('account-email')).toHaveTextContent('ada@acme.test');
    expect(screen.getByTestId('account-workspace')).toHaveTextContent('Acme');
    expect(screen.getByTestId('account-role')).toHaveTextContent('owner');
  });

  it('reads a missing field as unknown rather than blank', async () => {
    const h = harness();
    await mount(null, h);

    expect(screen.getByTestId('account-name')).toHaveTextContent('—');
    expect(screen.getByTestId('account-email')).toHaveTextContent('—');
    expect(screen.getByTestId('account-workspace')).toHaveTextContent('—');
    expect(screen.getByTestId('account-role')).toHaveTextContent('—');
  });

  it('sends "Switch account" straight to the sign-in screen — it signs nobody out itself', async () => {
    const h = harness();
    await mount(principal(), h);

    await fireEvent.press(screen.getByTestId('account-switch'));

    expect(h.onSwitchAccount).toHaveBeenCalledTimes(1);
    expect(h.onSignOut).not.toHaveBeenCalled();
  });

  it('asks before signing out rather than acting on the first press', async () => {
    const h = harness();
    await mount(principal(), h);

    await fireEvent.press(screen.getByTestId('account-sign-out'));

    expect(screen.getByTestId('account-sign-out-confirm-group')).toBeOnTheScreen();
    expect(h.onSignOut).not.toHaveBeenCalled();
  });

  it('signs out once the confirmation is pressed', async () => {
    const h = harness();
    await mount(principal(), h);

    await fireEvent.press(screen.getByTestId('account-sign-out'));
    await fireEvent.press(screen.getByTestId('account-sign-out-confirm'));

    expect(h.onSignOut).toHaveBeenCalledTimes(1);
  });

  it('backs out of the confirmation without signing out', async () => {
    const h = harness();
    await mount(principal(), h);

    await fireEvent.press(screen.getByTestId('account-sign-out'));
    await fireEvent.press(screen.getByTestId('account-sign-out-cancel'));

    expect(screen.queryByTestId('account-sign-out-confirm-group')).not.toBeOnTheScreen();
    expect(h.onSignOut).not.toHaveBeenCalled();
  });
});
