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
import {
  DEFAULT_NOTIFICATION_PREFERENCES,
  applyNotificationPatch,
  type NotificationPreferences,
  type NotificationPreferencesPatch,
} from '@siyahtus/types';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { NotificationSettings } from './SettingsPage.js';
import { useAuth } from '../../lib/auth-store.js';
import { renderWithLocale, resetLocale } from '../../test/i18n.js';

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

let patches: Array<NotificationPreferencesPatch>;
let nextSaveFails: boolean;

function signIn(prefs: NotificationPreferences = DEFAULT_NOTIFICATION_PREFERENCES): void {
  useAuth.setState({
    status: 'signed-in',
    accessToken: 'test-token',
    agent: { ...AGENT, notification_preferences: prefs },
    // Stand in for the real action: the store's own optimistic/rollback path is
    // its business, and this test is about what the screen sends and shows.
    setNotificationPreferences: async (patch: NotificationPreferencesPatch) => {
      patches.push(patch);
      if (nextSaveFails) throw new Error('save failed');
      const agent = useAuth.getState().agent;
      useAuth.setState({
        agent: {
          ...agent!,
          notification_preferences: applyNotificationPatch(agent!.notification_preferences!, patch),
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

const checkbox = (name: RegExp) => screen.getByRole('switch', { name });

describe('NotificationSettings', () => {
  it('renders every channel from the account, without looping', () => {
    render(<NotificationSettings />);

    expect(checkbox(/Enable notifications/)).toBeChecked();
    expect(checkbox(/Play a sound/)).toBeChecked();
    expect(checkbox(/Mobile push notifications/)).toBeChecked();
    expect(checkbox(/Email notifications/)).toBeChecked();
  });

  it('saves each row the moment it is flipped, and says so with an Undo (GV-06)', async () => {
    const { container } = render(<NotificationSettings />);
    // Every row is the person's own preference: the instant pattern, never a Save bar.
    expect(container.querySelectorAll('[data-save-pattern="instant"]')).toHaveLength(12);
    expect(container.querySelector('[data-save-pattern="form"]')).toBeNull();

    await userEvent.click(checkbox(/Play a sound/));
    expect(await screen.findByText('Saved')).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: 'Undo' }));

    await waitFor(() => expect(patches).toEqual([{ sound: false }, { sound: true }]));
    await waitFor(() => expect(checkbox(/Play a sound/)).toBeChecked());
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

  // IN-10 · tm 367
  describe('the event list (FR-MOD-13.8)', () => {
    it('lists the six events, with the visitor’s message locked on', () => {
      render(<NotificationSettings />);

      const locked = checkbox(/New messages from visitors/);
      expect(locked).toBeChecked();
      expect(locked).toBeDisabled();
      expect(checkbox(/transferred to me/)).toBeChecked();
      expect(checkbox(/transferred to my team/)).toBeChecked();
      expect(checkbox(/waiting in the queue/)).not.toBeChecked();
      expect(checkbox(/A new ticket/)).toBeChecked();
      expect(checkbox(/A reply on a ticket/)).toBeChecked();
    });

    it('sends just the one event that moved, as a partial events object', async () => {
      render(<NotificationSettings />);
      await userEvent.click(checkbox(/A new ticket/));

      await waitFor(() => expect(patches).toEqual([{ events: { new_ticket: false } }]));
      await waitFor(() => expect(checkbox(/A new ticket/)).not.toBeChecked());
      expect(checkbox(/A reply on a ticket/)).toBeChecked();
    });

    it('turns the master switch into a stop for every event row', async () => {
      signIn({ ...DEFAULT_NOTIFICATION_PREFERENCES, enabled: false });
      render(<NotificationSettings />);

      expect(checkbox(/A new ticket/)).toBeDisabled();
      expect(checkbox(/transferred to me/)).toBeDisabled();
    });
  });

  describe('the repeating sound (FR-MOD-13.8)', () => {
    it('starts off, and is a plain preference write when turned on', async () => {
      render(<NotificationSettings />);
      expect(checkbox(/Repeat the sound until the message is read/)).not.toBeChecked();

      await userEvent.click(checkbox(/Repeat the sound until the message is read/));
      await waitFor(() => expect(patches).toEqual([{ repeat_sound: true }]));
    });

    it('has nothing to repeat when the sound itself is off', () => {
      signIn({ ...DEFAULT_NOTIFICATION_PREFERENCES, sound: false });
      render(<NotificationSettings />);

      expect(checkbox(/Repeat the sound until the message is read/)).toBeDisabled();
    });
  });

  it('says so when the save fails, rather than showing a switch that lies', async () => {
    nextSaveFails = true;
    render(<NotificationSettings />);
    await userEvent.click(checkbox(/Play a sound/));

    expect(await screen.findByText(/couldn't be saved/)).toBeInTheDocument();
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

describe('NotificationSettings localisation (NFR-I18N2)', () => {
  afterEach(() => {
    resetLocale();
  });

  it('paints the notification section in Turkish when that is the active locale', () => {
    renderWithLocale(<NotificationSettings />, 'tr');

    expect(screen.getByRole('region', { name: 'Bildirimler' })).toBeInTheDocument();
    expect(screen.getByRole('switch', { name: /Bildirimleri etkinleştir/ })).toBeChecked();
  });
});
