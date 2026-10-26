/**
 * The Settings page against a fake platform API (tm 389.13 · FR-ADMIN-15/16). The server's rules
 * — "the stricter wins", the cache and its announcement, maintenance at the tenant edge, the
 * redaction — have their own suite (`platform-settings.test.ts`); here: what each section sends,
 * what it holds back until it is complete, what each role may touch, and how the published
 * configuration reads.
 */
import type { PlatformRole } from '@siyahtus/types';
import { screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { FakePlatform, FakePlatformOptions } from '../../test/fake-platform.js';
import { installFakePlatform, renderApp, resetSession } from '../../test/render-app.js';
import { fromLocalInput, toLocalInput } from './SettingsPage.js';

afterEach(async () => {
  vi.restoreAllMocks();
  await resetSession();
});

beforeEach(() => {
  globalThis.sessionStorage.clear();
});

const user = () => userEvent.setup();

async function open(
  options: FakePlatformOptions & { role?: PlatformRole } = {},
): Promise<FakePlatform> {
  const fake = installFakePlatform({ role: options.role ?? 'superadmin', ...options });
  renderApp('/settings');
  await user().type(await screen.findByLabelText('Email'), 'ops@example.com');
  await user().type(screen.getByLabelText('Password'), 'correct horse battery staple');
  await user().click(screen.getByRole('button', { name: 'Continue' }));
  await user().type(await screen.findByLabelText('Authenticator code'), '123456');
  await user().click(screen.getByRole('button', { name: 'Verify' }));
  await screen.findByRole('heading', { name: 'Settings' });
  return fake;
}

function sent(fake: FakePlatform, method: string, path: string): unknown[] {
  return fake.requests
    .filter((request) => request.method === method && request.path === path)
    .map((request) => request.body);
}

async function confirmWithReason(reason: string): Promise<void> {
  const dialog = await screen.findByRole('dialog');
  await user().type(within(dialog).getByLabelText('Reason'), reason);
  await user().click(within(dialog).getByRole('button', { name: 'Confirm and save' }));
}

describe('Settings — sign-up and trial', () => {
  it('closes sign-up and sets the trial length with a reason, showing the before and after', async () => {
    const fake = await open();
    const form = await screen.findByRole('form', { name: 'Sign-up and trial' });
    await user().selectOptions(within(form).getByLabelText('Public sign-up'), 'closed');
    await user().type(within(form).getByLabelText('Trial length (days)'), '7');
    await user().click(within(form).getByRole('button', { name: 'Save' }));

    const dialog = await screen.findByRole('dialog');
    expect(within(dialog).getByText('As the environment says (SIGNUP_ENABLED)')).toBeVisible();
    expect(within(dialog).getByText('Closed')).toBeVisible();
    await confirmWithReason('Spam wave from new sign-ups');

    await vi.waitFor(() =>
      expect(sent(fake, 'PATCH', '/settings')).toEqual([
        { reason: 'Spam wave from new sign-ups', signup_enabled: false, trial_days: 7 },
      ]),
    );
    expect(fake.settingsState.settings.signup_enabled).toBe(false);
  });

  it('holds Save on a trial length outside 1–365, and hands an empty one back to the environment', async () => {
    const fake = await open({ settings: { trial_days: 30 } });
    const form = await screen.findByRole('form', { name: 'Sign-up and trial' });
    const field = within(form).getByLabelText('Trial length (days)');
    expect(field).toHaveValue(30);
    await user().clear(field);
    await user().type(field, '400');
    expect(within(form).getByRole('button', { name: 'Save' })).toBeDisabled();
    await user().clear(field);
    await user().click(within(form).getByRole('button', { name: 'Save' }));
    await confirmWithReason('Back to the deployment default');
    await vi.waitFor(() =>
      expect(sent(fake, 'PATCH', '/settings')).toEqual([
        { reason: 'Back to the deployment default', signup_enabled: null, trial_days: null },
      ]),
    );
  });
});

describe('Settings — announcement', () => {
  it('previews both languages and sends the announcement with its level', async () => {
    const fake = await open();
    const form = await screen.findByRole('form', { name: 'Announcement' });
    await user().click(within(form).getByLabelText('Show an announcement'));
    await user().selectOptions(within(form).getByLabelText('Level'), 'warning');
    await user().type(within(form).getByLabelText('English text'), 'Maintenance tonight at 22:00');
    expect(within(form).getByRole('button', { name: 'Save' })).toBeDisabled();
    await user().type(within(form).getByLabelText('Turkish text'), 'Bu gece 22:00 bakım');

    expect(screen.getByTestId('announcement-preview-en')).toHaveTextContent(
      'Maintenance tonight at 22:00',
    );
    expect(screen.getByTestId('announcement-preview-tr')).toHaveTextContent('Bu gece 22:00 bakım');

    await user().click(within(form).getByRole('button', { name: 'Save' }));
    await confirmWithReason('Planned database upgrade');
    await vi.waitFor(() =>
      expect(sent(fake, 'PATCH', '/settings')).toEqual([
        {
          reason: 'Planned database upgrade',
          announcement: {
            level: 'warning',
            en: 'Maintenance tonight at 22:00',
            tr: 'Bu gece 22:00 bakım',
            until: null,
          },
        },
      ]),
    );
  });

  it('removes the announcement when it is switched off', async () => {
    const fake = await open({
      settings: {
        announcement: { level: 'info', en: 'Hello', tr: 'Merhaba', until: null },
      },
    });
    const form = await screen.findByRole('form', { name: 'Announcement' });
    expect(within(form).getByLabelText('English text')).toHaveValue('Hello');
    await user().click(within(form).getByLabelText('Show an announcement'));
    await user().click(within(form).getByRole('button', { name: 'Save' }));
    await confirmWithReason('Over now');
    await vi.waitFor(() =>
      expect(sent(fake, 'PATCH', '/settings')).toEqual([
        { reason: 'Over now', announcement: null },
      ]),
    );
  });

  it('round-trips the end time through the operator’s local clock', () => {
    const iso = '2026-11-01T18:30:00.000Z';
    expect(fromLocalInput(toLocalInput(iso))).toBe(iso);
    expect(toLocalInput(null)).toBe('');
    expect(fromLocalInput('')).toBeNull();
  });
});

describe('Settings — maintenance mode', () => {
  it('turns full maintenance on with a reason and a fresh code', async () => {
    const fake = await open();
    expect(screen.getByText('Off — every workspace works normally.')).toBeVisible();
    await user().click(screen.getByRole('button', { name: 'Turn on maintenance mode' }));
    const dialog = await screen.findByRole('dialog');
    await user().click(within(dialog).getByLabelText('Full — the service is offline'));
    await user().type(within(dialog).getByLabelText('Reason'), 'Database migration');
    await user().type(within(dialog).getByLabelText('Authenticator code'), '123456');
    await user().click(within(dialog).getByRole('button', { name: 'Confirm' }));

    await vi.waitFor(() =>
      expect(sent(fake, 'PUT', '/settings/maintenance')).toEqual([
        { reason: 'Database migration', enabled: true, mode: 'full', message: null },
      ]),
    );
    expect(fake.calls('/auth/totp/reverify')).toHaveLength(1);
    expect(
      await screen.findByText(
        'On, full: workspaces are offline and the realtime gateway refuses connections.',
      ),
    ).toBeVisible();
    expect(screen.getByRole('button', { name: 'Turn off maintenance mode' })).toBeVisible();
  });

  it('wants the message in both languages or neither', async () => {
    await open();
    await user().click(screen.getByRole('button', { name: 'Turn on maintenance mode' }));
    const dialog = await screen.findByRole('dialog');
    await user().type(within(dialog).getByLabelText('English message'), 'Back at 23:00');
    expect(
      within(dialog).getByText('Write the message in both languages, or in neither.'),
    ).toHaveAttribute('role', 'alert');
    expect(within(dialog).getByRole('button', { name: 'Confirm' })).toBeDisabled();
    await user().type(within(dialog).getByLabelText('Turkish message'), '23:00’te dönüyoruz');
    expect(within(dialog).getByRole('button', { name: 'Confirm' })).toBeEnabled();
  });

  it('turns it off again, keeping the mode it had', async () => {
    const fake = await open({
      settings: { maintenance: { enabled: true, mode: 'read_only', message: null } },
    });
    await user().click(screen.getByRole('button', { name: 'Turn off maintenance mode' }));
    const dialog = await screen.findByRole('dialog');
    await user().type(within(dialog).getByLabelText('Reason'), 'Upgrade finished');
    await user().type(within(dialog).getByLabelText('Authenticator code'), '123456');
    await user().click(within(dialog).getByRole('button', { name: 'Confirm' }));
    await vi.waitFor(() =>
      expect(sent(fake, 'PUT', '/settings/maintenance')).toEqual([
        { reason: 'Upgrade finished', enabled: false, mode: 'read_only', message: null },
      ]),
    );
  });
});

describe('Settings — who may change what', () => {
  it('shows readonly every value with every field disabled and no maintenance switch', async () => {
    await open({ role: 'readonly', settings: { trial_days: 21 } });
    const form = await screen.findByRole('form', { name: 'Sign-up and trial' });
    expect(within(form).getByLabelText('Trial length (days)')).toBeDisabled();
    expect(within(form).getByLabelText('Trial length (days)')).toHaveValue(21);
    expect(
      screen.queryByRole('button', { name: 'Turn on maintenance mode' }),
    ).not.toBeInTheDocument();
  });

  it('does not offer the page to billing', async () => {
    installFakePlatform({ role: 'billing' });
    renderApp('/dashboard');
    await user().type(await screen.findByLabelText('Email'), 'ops@example.com');
    await user().type(screen.getByLabelText('Password'), 'correct horse battery staple');
    await user().click(screen.getByRole('button', { name: 'Continue' }));
    await user().type(await screen.findByLabelText('Authenticator code'), '123456');
    await user().click(screen.getByRole('button', { name: 'Verify' }));
    const nav = await screen.findByRole('navigation');
    expect(within(nav).queryByRole('link', { name: 'Settings' })).not.toBeInTheDocument();
  });
});

describe('Settings — effective configuration', () => {
  it('lists every key with its source, secrets only as set or not set', async () => {
    await open();
    const row = await screen.findByTestId('config-LLM_API_KEY');
    expect(row).toHaveTextContent('set');
    expect(row).toHaveTextContent('Environment');
    expect(screen.getByTestId('config-TURNSTILE_SECRET_KEY')).toHaveTextContent('not set');
    expect(screen.getByTestId('config-TRIAL_DAYS')).toHaveTextContent('This panel');
    expect(screen.getByTestId('config-TRIAL_DAYS')).toHaveTextContent('set here');
    expect(screen.getByTestId('config-DATABASE_URL')).toHaveTextContent(
      'postgresql://db:5432/siyahtus',
    );
  });

  it('filters by source, by text and to the deployment switches', async () => {
    await open();
    await screen.findByTestId('config-LOG_LEVEL');
    await user().selectOptions(screen.getByLabelText('Source'), 'db');
    expect(screen.getByTestId('config-TRIAL_DAYS')).toBeVisible();
    expect(screen.queryByTestId('config-LOG_LEVEL')).not.toBeInTheDocument();

    await user().selectOptions(screen.getByLabelText('Source'), 'all');
    await user().type(screen.getByLabelText('Search keys and values'), 'telegram');
    expect(screen.getByTestId('config-APPS_LIVE_PROVIDERS')).toBeVisible();
    expect(screen.queryByTestId('config-TRIAL_DAYS')).not.toBeInTheDocument();
    await user().clear(screen.getByLabelText('Search keys and values'));
    // A redacted value is not searchable by what it hides.
    await user().type(screen.getByLabelText('Search keys and values'), 'set');
    expect(screen.queryByTestId('config-LLM_API_KEY')).not.toBeInTheDocument();
    await user().clear(screen.getByLabelText('Search keys and values'));

    await user().click(screen.getByLabelText(/Only the deployment switches/));
    expect(screen.getByTestId('config-PILOT_MODE')).toBeVisible();
    expect(screen.getByTestId('config-SIGNUP_ENABLED')).toBeVisible();
    expect(screen.queryByTestId('config-LOG_LEVEL')).not.toBeInTheDocument();
  });

  it('says so when the tenant API has published nothing', async () => {
    await open({ effectiveConfig: 'missing' });
    expect(await screen.findByText('The tenant API is not reporting')).toBeVisible();
    expect(screen.getByText('No setting matches.')).toBeVisible();
  });
});
