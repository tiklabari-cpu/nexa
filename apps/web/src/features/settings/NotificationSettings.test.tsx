/**
 * Settings → Notifications (FR-MOD-13.8 · 13.7-c).
 *
 * The section stopped being a browser preference form when push arrived: it now
 * reads the account and writes to it. Three things that change makes worth
 * pinning without a real browser —
 *
 *   - **It renders at all.** The store holds the preferences as an object, and
 *     zustand v5 compares a selector's result with `Object.is`; normalising
 *     inside the selector hands back a new identity every render and takes the
 *     whole Settings page down in a loop. The e2e suite caught that once. This
 *     catches it in a second rather than fourteen minutes, and does it by
 *     rendering with a store that updates.
 *   - **A toggle sends only what moved.** The endpoint takes a partial body, and
 *     a screen that restated all five would overwrite a channel a second tab had
 *     just changed.
 *   - **The master switch does not reach e-mail.** That is the one rule in this
 *     surface a reader is likely to assume the other way round.
 */
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { DEFAULT_NOTIFICATION_PREFERENCES, type NotificationPreferences } from '@nexa/types';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { NotificationSettings } from './SettingsPage.js';
import { useAuth } from '../../lib/auth-store.js';

const AGENT = {
  account_id: 'acc-1',
  email: 'agent@example.test',
  name: 'Agent',
  role: 'agent',
  organization_id: 'org-1',
  license_id: '1000001',
  scopes: [],
  routing_status: 'accepting_chats' as const,
};

let patches: Array<Partial<NotificationPreferences>>;
let nextSaveFails: boolean;

function signIn(prefs: NotificationPreferences = DEFAULT_NOTIFICATION_PREFERENCES): void {
  useAuth.setState({
    status: 'signed-in',
    accessToken: 'test-token',
    agent: { ...AGENT, notification_preferences: prefs },
    // Stand in for the real action: the store's own optimistic/rollback path is
    // its business, and this test is about what the screen sends and shows.
    setNotificationPreferences: async (patch: Partial<NotificationPreferences>) => {
      patches.push(patch);
      if (nextSaveFails) throw new Error('save failed');
      const agent = useAuth.getState().agent;
      useAuth.setState({
        agent: {
          ...agent!,
          notification_preferences: { ...agent!.notification_preferences!, ...patch },
        },
      });
    },
  });
}

beforeEach(() => {
  patches = [];
  nextSaveFails = false;
  // No permission prompt in jsdom: `Notification` is absent, so the component
  // reads `unsupported` — the desktop row is disabled and the rest is unaffected.
  signIn();
});

afterEach(() => {
  vi.unstubAllGlobals();
});

const checkbox = (name: RegExp) => screen.getByRole('checkbox', { name });

describe('NotificationSettings', () => {
  it('renders every channel from the account, without looping', () => {
    render(<NotificationSettings />);

    expect(checkbox(/Enable notifications/)).toBeChecked();
    expect(checkbox(/Play a sound/)).toBeChecked();
    expect(checkbox(/Mobile push notifications/)).toBeChecked();
    expect(checkbox(/Email notifications/)).toBeChecked();
  });

  it('reflects a channel the account has switched off', () => {
    signIn({ ...DEFAULT_NOTIFICATION_PREFERENCES, push: false, email: false });
    render(<NotificationSettings />);

    expect(checkbox(/Mobile push notifications/)).not.toBeChecked();
    expect(checkbox(/Email notifications/)).not.toBeChecked();
    expect(checkbox(/Play a sound/)).toBeChecked();
  });

  it('sends only the channel that moved', async () => {
    render(<NotificationSettings />);
    await userEvent.click(checkbox(/Play a sound/));

    await waitFor(() => expect(patches).toEqual([{ sound: false }]));
    // And the screen follows the store rather than its own copy.
    await waitFor(() => expect(checkbox(/Play a sound/)).not.toBeChecked());
  });

  it('lets the master switch disable the interruptive channels — but not e-mail', async () => {
    render(<NotificationSettings />);
    await userEvent.click(checkbox(/Enable notifications/));

    await waitFor(() => expect(patches).toEqual([{ enabled: false }]));
    await waitFor(() => expect(checkbox(/Play a sound/)).toBeDisabled());
    expect(checkbox(/Mobile push notifications/)).toBeDisabled();
    // E-mail is the fallback for somebody who is not at a screen at all, so
    // "stop interrupting me" leaves it alone and usable.
    expect(checkbox(/Email notifications/)).toBeEnabled();
    expect(checkbox(/Email notifications/)).toBeChecked();
  });

  it('says so when the save fails, rather than showing a switch that lies', async () => {
    nextSaveFails = true;
    render(<NotificationSettings />);
    await userEvent.click(checkbox(/Play a sound/));

    expect(await screen.findByText(/Could not save/)).toBeInTheDocument();
    // Nothing was applied: the store still holds the old value.
    expect(checkbox(/Play a sound/)).toBeChecked();
  });

  it('falls back to reachable when the profile carries no preferences at all', () => {
    // An older server, or a profile fetched before the field existed. Reading
    // that as "off" would silence somebody who never asked for quiet.
    useAuth.setState({ status: 'signed-in', accessToken: 't', agent: { ...AGENT } });
    render(<NotificationSettings />);

    expect(checkbox(/Enable notifications/)).toBeChecked();
    expect(checkbox(/Mobile push notifications/)).toBeChecked();
    expect(checkbox(/Email notifications/)).toBeChecked();
  });
});
