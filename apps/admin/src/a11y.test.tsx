/**
 * axe over every screen of the root panel (tm 389.6, WCAG 2.1 AA).
 *
 * jsdom has no layout, so the `color-contrast` rule cannot run here — the palette's ratios are
 * held by `styles/tokens.test.ts` and the real-page pass is `apps/e2e/tests/platform-admin.spec.ts`.
 * What axe does see in jsdom is structure: names on controls, labels on inputs, landmarks,
 * heading order, ids, ARIA validity — which is where a copied component most often goes wrong.
 */
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import axe from 'axe-core';
import { afterEach, describe, expect, it } from 'vitest';
import { ReasonDialog } from './components/ReasonDialog.js';
import { useAuth } from './lib/auth-store.js';
import { setLocale } from './test/i18n.js';
import { installFakePlatform, renderApp, resetSession } from './test/render-app.js';

afterEach(resetSession);

async function violations(container: HTMLElement): Promise<string[]> {
  const results = await axe.run(container, {
    runOnly: { type: 'tag', values: ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'best-practice'] },
    rules: { 'color-contrast': { enabled: false } },
  });
  return results.violations.map(
    (violation) =>
      `${violation.id}: ${violation.help} — ${violation.nodes.map((node) => node.target.join(' ')).join(' | ')}`,
  );
}

async function signInAs(user: ReturnType<typeof userEvent.setup>): Promise<void> {
  await user.type(await screen.findByLabelText('Email'), 'ops@example.com');
  await user.type(screen.getByLabelText('Password'), 'correct horse battery staple');
  await user.click(screen.getByRole('button', { name: 'Continue' }));
}

describe.each(['en', 'tr'] as const)('axe, %s', (locale) => {
  it('finds nothing on the sign-in page', async () => {
    installFakePlatform();
    setLocale(locale);
    const { container } = renderApp();
    await screen.findByRole('heading', { level: 1 });
    await screen.findByText(/^PLATFORM · EU$/);

    expect(await violations(container)).toEqual([]);
  });

  it('finds nothing on the code page', async () => {
    installFakePlatform();
    setLocale(locale);
    const user = userEvent.setup();
    const { container } = renderApp();
    if (locale === 'tr') {
      await user.type(await screen.findByLabelText('E-posta'), 'ops@example.com');
      await user.type(screen.getByLabelText('Parola'), 'correct horse battery staple');
      await user.click(screen.getByRole('button', { name: 'Devam' }));
      await screen.findByLabelText('Doğrulayıcı kodu');
    } else {
      await signInAs(user);
      await screen.findByLabelText('Authenticator code');
    }

    expect(await violations(container)).toEqual([]);
  });

  it('finds nothing on the enrolment page or the recovery sheet', async () => {
    installFakePlatform({ enrolled: false });
    setLocale(locale);
    const user = userEvent.setup();
    const { container } = renderApp();
    if (locale === 'tr') {
      await user.type(await screen.findByLabelText('E-posta'), 'ops@example.com');
      await user.type(screen.getByLabelText('Parola'), 'correct horse battery staple');
      await user.click(screen.getByRole('button', { name: 'Devam' }));
    } else {
      await signInAs(user);
    }
    await screen.findByTestId('enroll-secret');
    expect(await violations(container)).toEqual([]);

    await user.type(
      screen.getByLabelText(locale === 'tr' ? 'Uygulamadaki kod' : 'Code from the app'),
      '123456',
    );
    await user.click(
      screen.getByRole('button', { name: locale === 'tr' ? 'Etkinleştir' : 'Activate' }),
    );
    await screen.findByRole('list');
    expect(await violations(container)).toEqual([]);
  });

  it('finds nothing on the 403 screen, on a page, or on the not-found screen', async () => {
    installFakePlatform({ role: 'readonly' });
    setLocale(locale);
    const user = userEvent.setup();
    // A read-only operator opens /support by hand: the shell around the refusal.
    const { container } = renderApp('/support');
    if (locale === 'tr') {
      await user.type(await screen.findByLabelText('E-posta'), 'ops@example.com');
      await user.type(screen.getByLabelText('Parola'), 'correct horse battery staple');
      await user.click(screen.getByRole('button', { name: 'Devam' }));
      await user.type(await screen.findByLabelText('Doğrulayıcı kodu'), '123456');
      await user.click(screen.getByRole('button', { name: 'Doğrula' }));
    } else {
      await signInAs(user);
      await user.type(await screen.findByLabelText('Authenticator code'), '123456');
      await user.click(screen.getByRole('button', { name: 'Verify' }));
    }
    await screen.findByRole('navigation');
    await screen.findByRole('alert');
    expect(await violations(container)).toEqual([]);

    // The dashboard (the first menu entry), once its three reads have landed.
    await user.click(within(screen.getByRole('navigation')).getAllByRole('link')[0]!);
    await screen.findByText(locale === 'tr' ? 'Bileşenler' : 'Components');
    await screen.findByText(locale === 'tr' ? 'Temel rakamlar' : 'Key figures');
    await screen.findByText(locale === 'tr' ? 'Sağlıklı' : 'Healthy');
    expect(await violations(container)).toEqual([]);

    // The workspace list (the second entry, tm 389.9), then one workspace's overview.
    await user.click(within(screen.getByRole('navigation')).getAllByRole('link')[1]!);
    const workspace = await screen.findByRole('link', { name: 'Acme Gaming' });
    expect(await violations(container)).toEqual([]);
    await user.click(workspace);
    await screen.findByText('ayse@acme.example');
    expect(await violations(container)).toEqual([]);

    // The account search (the third entry, tm 389.11). The shell's menu is the first
    // navigation; the workspace's tabs are the second.
    const menu = screen.getAllByRole('navigation')[0]!;
    await user.click(within(menu).getAllByRole('link')[2]!);
    await screen.findByRole('link', { name: 'Lead Person' });
    expect(await violations(container)).toEqual([]);

    // A page still waiting for its task: the fourth.
    await user.click(within(screen.getAllByRole('navigation')[0]!).getAllByRole('link')[3]!);
    await screen.findByText(locale === 'tr' ? 'Burada henüz bir şey yok' : 'Nothing here yet');
    expect(await violations(container)).toEqual([]);
  });

  it('finds nothing on the not-found screen', async () => {
    installFakePlatform();
    setLocale(locale);
    const user = userEvent.setup();
    const { container } = renderApp('/no-such-page');
    if (locale === 'tr') {
      await user.type(await screen.findByLabelText('E-posta'), 'ops@example.com');
      await user.type(screen.getByLabelText('Parola'), 'correct horse battery staple');
      await user.click(screen.getByRole('button', { name: 'Devam' }));
      await user.type(await screen.findByLabelText('Doğrulayıcı kodu'), '123456');
      await user.click(screen.getByRole('button', { name: 'Doğrula' }));
    } else {
      await signInAs(user);
      await user.type(await screen.findByLabelText('Authenticator code'), '123456');
      await user.click(screen.getByRole('button', { name: 'Verify' }));
    }
    await screen.findByRole('navigation');
    await screen.findByRole('heading', {
      name: locale === 'tr' ? 'Sayfa bulunamadı' : 'Page not found',
    });

    expect(await violations(container)).toEqual([]);
  });

  it('finds nothing in the workspace actions menu and the dialogs with fields of their own (tm 389.10)', async () => {
    installFakePlatform();
    setLocale(locale);
    const user = userEvent.setup();
    renderApp('/workspaces/42');
    if (locale === 'tr') {
      await user.type(await screen.findByLabelText('E-posta'), 'ops@example.com');
      await user.type(screen.getByLabelText('Parola'), 'correct horse battery staple');
      await user.click(screen.getByRole('button', { name: 'Devam' }));
      await user.type(await screen.findByLabelText('Doğrulayıcı kodu'), '123456');
      await user.click(screen.getByRole('button', { name: 'Doğrula' }));
    } else {
      await signInAs(user);
      await user.type(await screen.findByLabelText('Authenticator code'), '123456');
      await user.click(screen.getByRole('button', { name: 'Verify' }));
    }
    await screen.findByRole('heading', { name: 'Acme Gaming' });
    const menu = locale === 'tr' ? 'Eylemler' : 'Actions';
    await user.click(screen.getByRole('button', { name: menu }));
    expect(await violations(document.body)).toEqual([]);

    const dialogs =
      locale === 'tr'
        ? ['Geçersiz kılmalar', 'Sahipliği devret', 'Çalışma alanını sil']
        : ['Overrides', 'Transfer ownership', 'Delete workspace'];
    for (const label of dialogs) {
      if (!screen.queryByRole('button', { name: label })) {
        await user.click(screen.getByRole('button', { name: menu }));
      }
      await user.click(screen.getByRole('button', { name: label }));
      const dialog = await screen.findByRole('dialog');
      await within(dialog).findByLabelText(locale === 'tr' ? 'Gerekçe' : 'Reason');
      // The override form and the member list arrive after a read.
      await new Promise((resolve) => setTimeout(resolve, 50));
      expect(await violations(document.body), label).toEqual([]);
      await user.click(
        within(dialog).getByRole('button', { name: locale === 'tr' ? 'Vazgeç' : 'Cancel' }),
      );
    }
  });

  it('finds nothing in the enter-as-customer dialog and its one-time link (tm 389.15)', async () => {
    installFakePlatform();
    setLocale(locale);
    const user = userEvent.setup();
    renderApp('/workspaces/42');
    if (locale === 'tr') {
      await user.type(await screen.findByLabelText('E-posta'), 'ops@example.com');
      await user.type(screen.getByLabelText('Parola'), 'correct horse battery staple');
      await user.click(screen.getByRole('button', { name: 'Devam' }));
      await user.type(await screen.findByLabelText('Doğrulayıcı kodu'), '123456');
      await user.click(screen.getByRole('button', { name: 'Doğrula' }));
    } else {
      await signInAs(user);
      await user.type(await screen.findByLabelText('Authenticator code'), '123456');
      await user.click(screen.getByRole('button', { name: 'Verify' }));
    }
    await screen.findByRole('heading', { name: 'Acme Gaming' });
    await user.click(
      screen.getByRole('button', {
        name: locale === 'tr' ? 'Müşteri olarak gir' : 'Enter as customer',
      }),
    );
    const dialog = await screen.findByRole('dialog');
    const member = within(dialog).getByLabelText(locale === 'tr' ? 'Üye' : 'Member');
    // The member list arrives after a read.
    await waitFor(() => expect(member).not.toBeDisabled());
    await user.click(within(dialog).getByRole('radio', { name: locale === 'tr' ? /Tam/ : /Full/ }));
    expect(await violations(document.body)).toEqual([]);

    await user.selectOptions(member, '00000000-0000-4000-8000-0000000000b2');
    await user.type(
      within(dialog).getByLabelText(locale === 'tr' ? 'Gerekçe' : 'Reason'),
      'Looking',
    );
    await user.type(
      within(dialog).getByLabelText(locale === 'tr' ? 'Doğrulayıcı kodu' : 'Authenticator code'),
      '123456',
    );
    await user.click(
      within(dialog).getByRole('button', {
        name: locale === 'tr' ? 'Bağlantıyı oluştur' : 'Create the link',
      }),
    );
    await screen.findByTestId('impersonation-handoff');
    expect(await violations(document.body)).toEqual([]);
  });

  it('finds nothing on an account, its actions menu and the erasure dialog (tm 389.11)', async () => {
    installFakePlatform();
    setLocale(locale);
    const user = userEvent.setup();
    renderApp('/accounts/00000000-0000-4000-8000-0000000000b2');
    if (locale === 'tr') {
      await user.type(await screen.findByLabelText('E-posta'), 'ops@example.com');
      await user.type(screen.getByLabelText('Parola'), 'correct horse battery staple');
      await user.click(screen.getByRole('button', { name: 'Devam' }));
      await user.type(await screen.findByLabelText('Doğrulayıcı kodu'), '123456');
      await user.click(screen.getByRole('button', { name: 'Doğrula' }));
    } else {
      await signInAs(user);
      await user.type(await screen.findByLabelText('Authenticator code'), '123456');
      await user.click(screen.getByRole('button', { name: 'Verify' }));
    }
    await screen.findByRole('heading', { name: 'Lead Person' });
    expect(await violations(document.body)).toEqual([]);
    const menu = locale === 'tr' ? 'Eylemler' : 'Actions';
    await user.click(screen.getByRole('button', { name: menu }));
    expect(await violations(document.body)).toEqual([]);
    await user.click(
      screen.getByRole('button', { name: locale === 'tr' ? 'Hesabı sil' : 'Erase account' }),
    );
    const dialog = await screen.findByRole('dialog');
    await within(dialog).findByLabelText(locale === 'tr' ? 'Gerekçe' : 'Reason');
    expect(await violations(document.body)).toEqual([]);
  });

  it('finds nothing on the settings page, with an announcement open and the maintenance dialog (tm 389.13)', async () => {
    installFakePlatform({
      settings: {
        announcement: { level: 'warning', en: 'Hello', tr: 'Merhaba', until: null },
        maintenance: { enabled: true, mode: 'read_only', message: null },
      },
    });
    setLocale(locale);
    const user = userEvent.setup();
    renderApp('/settings');
    if (locale === 'tr') {
      await user.type(await screen.findByLabelText('E-posta'), 'ops@example.com');
      await user.type(screen.getByLabelText('Parola'), 'correct horse battery staple');
      await user.click(screen.getByRole('button', { name: 'Devam' }));
      await user.type(await screen.findByLabelText('Doğrulayıcı kodu'), '123456');
      await user.click(screen.getByRole('button', { name: 'Doğrula' }));
    } else {
      await signInAs(user);
      await user.type(await screen.findByLabelText('Authenticator code'), '123456');
      await user.click(screen.getByRole('button', { name: 'Verify' }));
    }
    await screen.findByTestId('config-LLM_API_KEY');
    // The AI providers section (tm 389.17), with its write-only key field.
    await screen.findByRole('form', {
      name: locale === 'tr' ? 'AI sağlayıcıları' : 'AI providers',
    });
    expect(await violations(document.body)).toEqual([]);
    await user.click(
      screen.getByRole('button', {
        name: locale === 'tr' ? 'Bakım modunu değiştir' : 'Change maintenance mode',
      }),
    );
    await screen.findByRole('dialog');
    expect(await violations(document.body)).toEqual([]);
  });

  it('finds nothing on the Operations page and the dialogs it opens (tm 389.14)', async () => {
    installFakePlatform();
    setLocale(locale);
    const user = userEvent.setup();
    renderApp('/operations');
    if (locale === 'tr') {
      await user.type(await screen.findByLabelText('E-posta'), 'ops@example.com');
      await user.type(screen.getByLabelText('Parola'), 'correct horse battery staple');
      await user.click(screen.getByRole('button', { name: 'Devam' }));
      await user.type(await screen.findByLabelText('Doğrulayıcı kodu'), '123456');
      await user.click(screen.getByRole('button', { name: 'Doğrula' }));
    } else {
      await signInAs(user);
      await user.type(await screen.findByLabelText('Authenticator code'), '123456');
      await user.click(screen.getByRole('button', { name: 'Verify' }));
    }
    await screen.findByRole('heading', {
      name: locale === 'tr' ? 'Operasyonlar' : 'Operations',
      level: 1,
    });
    // Every section has landed: the job table, the partitions and the component record.
    await screen.findByText('sla');
    await screen.findByText('events_2026_09');
    await screen.findByText(locale === 'tr' ? 'Henüz bildirim yok' : 'Nothing reported yet');
    expect(await violations(document.body)).toEqual([]);

    await user.click(
      screen.getByRole('button', {
        name: locale === 'tr' ? 'siem işini şimdi çalıştır' : 'Run siem now',
      }),
    );
    const run = await screen.findByRole('dialog');
    await within(run).findByLabelText(locale === 'tr' ? 'Gerekçe' : 'Reason');
    expect(await violations(document.body)).toEqual([]);
    await user.click(
      within(run).getByRole('button', { name: locale === 'tr' ? 'Vazgeç' : 'Cancel' }),
    );

    await user.click(
      screen.getByRole('button', {
        name: locale === 'tr' ? 'Süresi dolan kayıtları temizle' : 'Purge expired sign-ups',
      }),
    );
    const purge = await screen.findByRole('dialog');
    await within(purge).findByLabelText(locale === 'tr' ? 'Gerekçe' : 'Reason');
    expect(await violations(document.body)).toEqual([]);
  });

  it('finds nothing on the Security page and its dialogs (tm 389.16)', async () => {
    installFakePlatform();
    setLocale(locale);
    const user = userEvent.setup();
    renderApp('/security');
    if (locale === 'tr') {
      await user.type(await screen.findByLabelText('E-posta'), 'ops@example.com');
      await user.type(screen.getByLabelText('Parola'), 'correct horse battery staple');
      await user.click(screen.getByRole('button', { name: 'Devam' }));
      await user.type(await screen.findByLabelText('Doğrulayıcı kodu'), '123456');
      await user.click(screen.getByRole('button', { name: 'Doğrula' }));
    } else {
      await signInAs(user);
      await user.type(await screen.findByLabelText('Authenticator code'), '123456');
      await user.click(screen.getByRole('button', { name: 'Verify' }));
    }
    await screen.findByRole('heading', {
      name: locale === 'tr' ? 'Güvenlik' : 'Security',
      level: 1,
    });
    // Every section has landed: the blocklist, the counters and the session list.
    await screen.findByText('burner.test');
    await screen.findAllByText('198.51.100.2');
    await screen.findByText('lead@beta.test');
    expect(await violations(document.body)).toEqual([]);

    await user.click(screen.getByRole('button', { name: locale === 'tr' ? 'Engelle…' : 'Block…' }));
    const add = await screen.findByRole('dialog');
    await within(add).findByLabelText(locale === 'tr' ? 'Gerekçe' : 'Reason');
    expect(await violations(document.body)).toEqual([]);
  });

  it('finds nothing in the reason dialog', async () => {
    setLocale(locale);
    render(
      <ReasonDialog
        title="Suspend “Acme Bikes”?"
        description="Every member is locked out until you lift it."
        requireTotp
        onConfirm={async () => undefined}
        onDone={() => undefined}
        onCancel={() => undefined}
      />,
    );
    await screen.findByRole('dialog');

    // The dialog portals nothing: it is in the document body, outside the render container.
    expect(await violations(document.body)).toEqual([]);
  });
});

describe('the invitation page', () => {
  it('finds nothing, with a token and without one', async () => {
    installFakePlatform();
    globalThis.history.replaceState(null, '', '/invite#token=good-invite');
    const { container, unmount } = renderApp('/invite');
    await screen.findByLabelText('Password');
    await screen.findByText(/^PLATFORM · EU$/);
    expect(await violations(container)).toEqual([]);
    unmount();

    renderApp('/invite');
    await screen.findByRole('alert');
    await screen.findByText(/^PLATFORM · EU$/);
    expect(await violations(document.body)).toEqual([]);
    expect(useAuth.getState().status).toBe('signed-out');
  });
});

describe('the checker itself', () => {
  it('does report an unlabelled input, so the assertions above are not vacuous', async () => {
    const { container } = render(<input type="text" />);

    expect((await violations(container)).join('\n')).toMatch(/label/);
  });
});
