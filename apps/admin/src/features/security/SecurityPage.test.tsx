/**
 * The Security page against a fake platform API (tm 389.16 · FR-ADMIN-22): the blocklist and its
 * add/lift dialogs (with the server's refusals worded for the kind), who sees which button, the
 * counters and the honest "not available" / "not installed" answers, the impersonation list.
 * The server's own rules have their own suite (`platform-security.test.ts`).
 */
import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { PlatformRole } from '@siyahtus/types';
import { type FakePlatform } from '../../test/fake-platform.js';
import { setLocale } from '../../test/i18n.js';
import { installFakePlatform, renderApp, resetSession } from '../../test/render-app.js';

afterEach(resetSession);

beforeEach(() => {
  globalThis.sessionStorage.clear();
});

async function openSecurity(
  role: PlatformRole = 'superadmin',
  tune?: (fake: FakePlatform) => void,
  locale: 'en' | 'tr' = 'en',
): Promise<{ user: ReturnType<typeof userEvent.setup>; fake: FakePlatform }> {
  const fake = installFakePlatform({ role });
  tune?.(fake);
  setLocale(locale);
  const user = userEvent.setup();
  renderApp('/security');
  const words =
    locale === 'tr'
      ? {
          email: 'E-posta',
          password: 'Parola',
          next: 'Devam',
          code: 'Doğrulayıcı kodu',
          verify: 'Doğrula',
          title: 'Güvenlik',
        }
      : {
          email: 'Email',
          password: 'Password',
          next: 'Continue',
          code: 'Authenticator code',
          verify: 'Verify',
          title: 'Security',
        };
  await user.type(await screen.findByLabelText(words.email), 'ops@example.com');
  await user.type(screen.getByLabelText(words.password), 'correct horse battery staple');
  await user.click(screen.getByRole('button', { name: words.next }));
  await user.type(await screen.findByLabelText(words.code), '123456');
  await user.click(screen.getByRole('button', { name: words.verify }));
  await screen.findByRole('heading', { name: words.title, level: 1 });
  return { user, fake };
}

const region = (name: string) => screen.findByRole('region', { name });

describe('the blocklist', () => {
  it('lists each entry with its kind, value, reason and who added it', async () => {
    await openSecurity();
    const section = await region('Sign-up blocklist');
    const row = (await within(section).findByText('burner.test')).closest('tr') as HTMLElement;
    expect(within(row).getByText('Domain')).toBeVisible();
    expect(within(row).getByText('Disposable mailbox provider')).toBeVisible();
    expect(within(row).getByText('ops@example.com')).toBeVisible();
    expect(within(section).getByText('203.0.113.0/24')).toBeVisible();
  });

  it('asks for the kind, the value and a reason, then shows the normalised entry', async () => {
    const { user, fake } = await openSecurity();
    const section = await region('Sign-up blocklist');
    await user.click(await within(section).findByRole('button', { name: 'Block…' }));

    const dialog = await screen.findByRole('dialog');
    await user.selectOptions(within(dialog).getByLabelText('Kind'), 'email');
    await user.type(within(dialog).getByLabelText('Value'), '  Spammer@Bad.test ');
    await user.type(within(dialog).getByLabelText('Reason'), 'Mailed 400 invitations in a day');
    await user.click(within(dialog).getByRole('button', { name: 'Block' }));

    expect(await screen.findByText('spammer@bad.test is blocked from signing up.')).toBeVisible();
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
    expect(fake.calls('/security/blocklist').find((c) => c.method === 'POST')?.body).toEqual({
      kind: 'email',
      value: '  Spammer@Bad.test ',
      reason: 'Mailed 400 invitations in a day',
    });
    const rows = within(await region('Sign-up blocklist')).getAllByRole('row');
    expect(within(rows[1]!).getByText('spammer@bad.test')).toBeVisible();
  });

  it('keeps the dialog open and words the refusal for the kind', async () => {
    const { user } = await openSecurity();
    const section = await region('Sign-up blocklist');
    await user.click(await within(section).findByRole('button', { name: 'Block…' }));
    const dialog = await screen.findByRole('dialog');

    // The same range twice.
    await user.type(within(dialog).getByLabelText('Value'), 'burner.test');
    await user.type(within(dialog).getByLabelText('Reason'), 'second time');
    await user.click(within(dialog).getByRole('button', { name: 'Block' }));
    expect(await within(dialog).findByRole('alert')).toHaveTextContent(
      'That entry is already on the blocklist.',
    );

    // Not a value of its kind.
    await user.selectOptions(within(dialog).getByLabelText('Kind'), 'ip');
    const value = within(dialog).getByLabelText('Value');
    await user.clear(value);
    await user.type(value, 'example.com');
    await user.click(within(dialog).getByRole('button', { name: 'Block' }));
    expect(await within(dialog).findByRole('alert')).toHaveTextContent(
      'Enter an IP address or a CIDR range, such as 203.0.113.7 or 203.0.113.0/24.',
    );
    expect(screen.getByRole('dialog')).toBeVisible();
    expect(within(dialog).getByLabelText('Reason')).toHaveValue('second time');
  });

  it('holds the Block button until there is a value', async () => {
    const { user } = await openSecurity();
    const section = await region('Sign-up blocklist');
    await user.click(await within(section).findByRole('button', { name: 'Block…' }));
    const dialog = await screen.findByRole('dialog');
    expect(within(dialog).getByRole('button', { name: 'Block' })).toBeDisabled();
    await user.type(within(dialog).getByLabelText('Value'), 'x.test');
    await user.type(within(dialog).getByLabelText('Reason'), 'because');
    expect(within(dialog).getByRole('button', { name: 'Block' })).toBeEnabled();
  });

  it('lifts an entry with a reason sent in the DELETE body', async () => {
    const { user, fake } = await openSecurity();
    await user.click(await screen.findByRole('button', { name: 'Lift the block on burner.test' }));
    const dialog = await screen.findByRole('dialog');
    expect(within(dialog).getByText('Lift the block on burner.test?')).toBeVisible();
    await user.type(within(dialog).getByLabelText('Reason'), 'A customer uses this domain');
    await user.click(within(dialog).getByRole('button', { name: 'Lift' }));

    expect(await screen.findByText('The block on burner.test is lifted.')).toBeVisible();
    const sent = fake
      .calls('/security/blocklist/11111111-1111-4111-8111-111111111111')
      .find((call) => call.method === 'DELETE');
    expect(sent?.body).toEqual({ reason: 'A customer uses this domain' });
    const section = await region('Sign-up blocklist');
    expect(within(section).queryByText('burner.test')).toBeNull();
    expect(within(section).getByText('203.0.113.0/24')).toBeVisible();
  });

  it('shows read-only operators the list and no way to change it', async () => {
    await openSecurity('readonly');
    const section = await region('Sign-up blocklist');
    expect(await within(section).findByText('burner.test')).toBeVisible();
    expect(within(section).queryByRole('button', { name: 'Block…' })).toBeNull();
    expect(within(section).queryByRole('button', { name: /^Lift/ })).toBeNull();
    expect(within(section).queryByRole('columnheader', { name: 'Actions' })).toBeNull();
  });

  it('filters by kind and by text, and says when nothing matches', async () => {
    const { user } = await openSecurity();
    const section = await region('Sign-up blocklist');
    await within(section).findByText('burner.test');

    await user.selectOptions(within(section).getByLabelText('Kind'), 'ip');
    await waitFor(() => expect(within(section).queryByText('burner.test')).toBeNull());
    expect(within(section).getByText('203.0.113.0/24')).toBeVisible();

    await user.type(within(section).getByLabelText('Search values'), 'nothing-like-this');
    expect(await within(section).findByText('No entry matches.')).toBeVisible();
  });

  it('pages by keyset with Load more', async () => {
    const { user } = await openSecurity('superadmin', (fake) => {
      fake.securityState.pageSize = 1;
    });
    const section = await region('Sign-up blocklist');
    await within(section).findByText('burner.test');
    expect(within(section).queryByText('203.0.113.0/24')).toBeNull();
    await user.click(within(section).getByRole('button', { name: 'Load more' }));
    expect(await within(section).findByText('203.0.113.0/24')).toBeVisible();
    expect(within(section).queryByRole('button', { name: 'Load more' })).toBeNull();
  });
});

describe('the counters', () => {
  it('shows who is failing now, what the workspaces refused and what this panel refused', async () => {
    await openSecurity('support');
    const section = await region('Failed sign-ins');
    const live = await within(section).findByRole('table', {
      name: 'Addresses with recent failed authentications',
    });
    const locked = within(live).getByText('198.51.100.2').closest('tr') as HTMLElement;
    expect(within(locked).getByText('60')).toBeVisible();
    expect(within(locked).getByText('Locked out')).toBeVisible();
    const counting = within(live).getByText('198.51.100.1').closest('tr') as HTMLElement;
    expect(within(counting).getByText('Counting')).toBeVisible();

    expect(within(section).getByText('Refused sign-ins')).toBeVisible();
    expect(within(section).getByRole('link', { name: '1001' })).toHaveAttribute(
      'href',
      '/workspaces/1001',
    );
    expect(within(section).getByText('Wrong password')).toBeVisible();
    expect(within(section).getByText('203.0.113.9')).toBeVisible();
  });

  it('asks for another period and says plainly when the live counters cannot be read', async () => {
    const { user } = await openSecurity('superadmin', (f) => {
      f.securityState.failedLogins = 'redis_down';
    });
    const section = await region('Failed sign-ins');
    expect(await within(section).findByText(/could not be read/)).toBeVisible();
    // The trail is still there.
    expect(within(section).getByText('Refused sign-ins')).toBeVisible();

    await user.click(within(section).getByRole('button', { name: '72 h' }));
    expect(await within(section).findByText('Workspace sign-ins refused, last 72 h')).toBeVisible();
    expect(within(section).getByRole('button', { name: '72 h' })).toHaveAttribute(
      'aria-pressed',
      'true',
    );
  });

  it('reads a quiet deployment as quiet', async () => {
    await openSecurity('superadmin', (f) => {
      f.securityState.failedLogins = 'quiet';
    });
    const section = await region('Failed sign-ins');
    expect(await within(section).findByText('No address is failing right now.')).toBeVisible();
    expect(within(section).getAllByText('None in this period.').length).toBeGreaterThan(0);
  });

  it('says that sign-ups by address are not available instead of showing an empty list', async () => {
    await openSecurity();
    const section = await region('Sign-ups by address');
    expect(await within(section).findByText('Not available')).toBeVisible();
    expect(within(section).getByText(/does not keep the address it came from/)).toBeVisible();
    expect(within(section).queryByRole('table')).toBeNull();
  });

  it('counts workspaces at their allowances and shows the human check’s state', async () => {
    await openSecurity();
    const section = await region('Abuse counters');
    expect(
      await within(section).findByText('Workspaces that sent 50 invitations today (UTC)'),
    ).toBeVisible();
    expect(
      within(section).getByText('Members who used all of their AI turns on 2026-10-26'),
    ).toBeVisible();
    expect(within(section).getByRole('link', { name: '1002' })).toHaveAttribute(
      'href',
      '/workspaces/1002',
    );
    expect(within(section).getByText('Provider state: ok (mock provider)')).toBeVisible();
  });

  it('names a guard that is not in this database rather than showing a zero', async () => {
    await openSecurity('superadmin', (f) => {
      f.securityState.abuse = 'not_installed';
    });
    const section = await region('Abuse counters');
    expect(
      await within(section).findByText('This guard is not part of this deployment’s database.'),
    ).toBeVisible();
    expect(
      within(section).queryByText('Members who used all of their AI turns on 2026-10-26'),
    ).toBeNull();
  });
});

describe('the impersonation sessions', () => {
  it('lists every session with how it stands, and narrows to the open ones', async () => {
    const { user } = await openSecurity('readonly');
    const section = await region('Impersonation sessions');
    const ended = (await within(section).findByText('Acme Oyun')).closest('tr') as HTMLElement;
    expect(within(ended).getByText('agent@acme.test')).toBeVisible();
    expect(within(ended).getByText('Read-only')).toBeVisible();
    expect(within(ended).getByText('Ended by the operator')).toBeVisible();
    // A workspace without a name falls back to its licence number.
    const open = within(section).getByText('lead@beta.test').closest('tr') as HTMLElement;
    expect(within(open).getByText('Full')).toBeVisible();
    expect(within(open).getByText(/^Open until /)).toBeVisible();

    await user.click(within(section).getByLabelText('Open sessions only'));
    await waitFor(() => expect(within(section).queryByText('Acme Oyun')).toBeNull());
    expect(within(section).getByText('lead@beta.test')).toBeVisible();
  });
});

describe('access', () => {
  it('shows a billing operator the no-access page, not the sections', async () => {
    const fake = installFakePlatform({ role: 'billing' });
    const user = userEvent.setup();
    renderApp('/security');
    await user.type(await screen.findByLabelText('Email'), 'ops@example.com');
    await user.type(screen.getByLabelText('Password'), 'correct horse battery staple');
    await user.click(screen.getByRole('button', { name: 'Continue' }));
    await user.type(await screen.findByLabelText('Authenticator code'), '123456');
    await user.click(screen.getByRole('button', { name: 'Verify' }));
    await screen.findByRole('heading', { level: 1 });
    expect(screen.queryByRole('region', { name: 'Sign-up blocklist' })).toBeNull();
    expect(fake.calls('/security/blocklist')).toHaveLength(0);
  });
});

describe('in Turkish', () => {
  it('words the page in Turkish', async () => {
    try {
      await openSecurity('superadmin', undefined, 'tr');
      const section = await screen.findByRole('region', { name: 'Kayıt engel listesi' });
      expect(await within(section).findByText('burner.test')).toBeVisible();
      expect(within(section).getByRole('button', { name: 'Engelle…' })).toBeVisible();
    } finally {
      setLocale('en');
    }
  });
});
