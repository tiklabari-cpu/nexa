/**
 * The AI page against a fake platform API (tm 389.19 · FR-ADMIN-23): the catalogue tabs with
 * their versions, the template installs paging, the crisis-text editor (a reasoned save, the
 * validation that holds Save, who may write), the honest "not available yet" for a catalogue
 * whose source has not shipped, and the workspace's AI tab. The server's own rules have their own
 * suite (`platform-ai-catalogs.test.ts`).
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

async function signIn(
  path: string,
  heading: string,
  role: PlatformRole = 'superadmin',
  tune?: (fake: FakePlatform) => void,
  locale: 'en' | 'tr' = 'en',
): Promise<{ user: ReturnType<typeof userEvent.setup>; fake: FakePlatform }> {
  const fake = installFakePlatform({ role });
  tune?.(fake);
  setLocale(locale);
  const user = userEvent.setup();
  renderApp(path);
  const words =
    locale === 'tr'
      ? {
          email: 'E-posta',
          password: 'Parola',
          next: 'Devam',
          code: 'Doğrulayıcı kodu',
          verify: 'Doğrula',
        }
      : {
          email: 'Email',
          password: 'Password',
          next: 'Continue',
          code: 'Authenticator code',
          verify: 'Verify',
        };
  await user.type(await screen.findByLabelText(words.email), 'ops@example.com');
  await user.type(screen.getByLabelText(words.password), 'correct horse battery staple');
  await user.click(screen.getByRole('button', { name: words.next }));
  await user.type(await screen.findByLabelText(words.code), '123456');
  await user.click(screen.getByRole('button', { name: words.verify }));
  await screen.findByRole('heading', { name: heading, level: 1 });
  return { user, fake };
}

const openAi = (
  role: PlatformRole = 'superadmin',
  tune?: (fake: FakePlatform) => void,
  locale: 'en' | 'tr' = 'en',
) => signIn('/ai', locale === 'tr' ? 'Yapay zekâ' : 'AI', role, tune, locale);

describe('the catalogue tabs', () => {
  it('lists the locked rules with the catalogue version, in the operator’s language', async () => {
    await openAi();
    expect(await screen.findByText('2026-10-19.1')).toBeVisible();
    const table = await screen.findByRole('table', { name: 'The locked guardrail rules' });
    const row = within(table).getByText('G1').closest('tr') as HTMLElement;
    expect(within(row).getByText('Self-exclusion')).toBeVisible();
    expect(within(row).getByText('player message')).toBeVisible();
    expect(within(row).getByText('8 in · 0 out')).toBeVisible();
  });

  it('reads the rule titles in Turkish when the panel is Turkish', async () => {
    await openAi('superadmin', undefined, 'tr');
    const table = await screen.findByRole('table', { name: 'Kilitli uyum koruma kuralları' });
    expect(within(table).getByText('Kendini dışlama')).toBeVisible();
  });

  it('shows the template pack, then each workspace’s installs, and pages them', async () => {
    const { user, fake } = await openAi('superadmin', (f) => {
      f.aiState.installsPageSize = 2;
    });
    await user.click(await screen.findByRole('tab', { name: 'Templates' }));
    expect(await screen.findByText('0.1.0')).toBeVisible();
    expect(screen.getByText('Yatırım hesaba geçmedi')).toBeVisible();

    const installs = await screen.findByRole('table', {
      name: 'Template installs per workspace, most copies first',
    });
    const first = within(installs).getByText('Casino 1').closest('tr') as HTMLElement;
    expect(within(first).getByText('30')).toBeVisible();
    expect(within(first).getByText('3')).toBeVisible();
    expect(within(installs).queryByText('Casino 3')).toBeNull();

    await user.click(screen.getByRole('button', { name: 'Load more' }));
    expect(await within(installs).findByText('Casino 3')).toBeVisible();
    expect(fake.calls('/ai-catalogs/templates/installs')).toHaveLength(2);
  });

  it('shows the compliance pack and the QA rubric with their versions', async () => {
    const { user } = await openAi();
    await user.click(await screen.findByRole('tab', { name: 'Compliance pack' }));
    expect(await screen.findByText('2026-10-21.1')).toBeVisible();
    expect(screen.getByText('compliance:G1:tr')).toBeVisible();

    await user.click(screen.getByRole('tab', { name: 'QA rubric' }));
    expect(await screen.findByText('2026-10-27.1')).toBeVisible();
    expect(screen.getByText('Right topic')).toBeVisible();
    expect(screen.getByText('Only when handed over')).toBeVisible();
  });

  it('says the tool catalogue is not available yet rather than showing an empty list', async () => {
    const { user } = await openAi();
    await user.click(await screen.findByRole('tab', { name: 'Tools' }));
    expect(
      await screen.findByText('Not available yet: it ships with the tool slot.'),
    ).toBeVisible();
    expect(screen.queryByRole('table')).toBeNull();
  });

  it('moves between tabs with the arrow keys', async () => {
    const { user } = await openAi();
    const first = await screen.findByRole('tab', { name: 'Guardrails' });
    first.focus();
    await user.keyboard('{ArrowRight}');
    expect(screen.getByRole('tab', { name: 'Crisis texts' })).toHaveAttribute(
      'aria-selected',
      'true',
    );
    await user.keyboard('{ArrowLeft}');
    expect(screen.getByRole('tab', { name: 'Guardrails' })).toHaveAttribute(
      'aria-selected',
      'true',
    );
  });
});

describe('the crisis-text drafts', () => {
  async function openDrafts(role: PlatformRole = 'superadmin') {
    const session = await openAi(role);
    await session.user.click(await screen.findByRole('tab', { name: 'Crisis texts' }));
    const form = await screen.findByRole('form', { name: 'Crisis-text drafts' });
    return { ...session, form };
  }

  it('saves an edited text with a reason, and shows which countries change', async () => {
    const { user, fake, form } = await openDrafts();
    const english = within(form).getByLabelText('English text');
    expect(english).toHaveValue('Please call 183.');
    await user.clear(english);
    await user.type(english, 'Call the helpline on 183.');
    await user.click(within(form).getByRole('button', { name: 'Save' }));

    const dialog = await screen.findByRole('dialog');
    expect(within(dialog).getByText('TR (English 16, Turkish 20 characters)')).toBeVisible();
    expect(within(dialog).getByText('TR (English 25, Turkish 20 characters)')).toBeVisible();
    await user.type(within(dialog).getByLabelText('Reason'), 'Wording agreed with compliance');
    await user.click(within(dialog).getByRole('button', { name: 'Confirm and save' }));

    await waitFor(() =>
      expect(
        fake.calls('/ai-catalogs/crisis-text-drafts').find((c) => c.method === 'PUT')?.body,
      ).toEqual({
        reason: 'Wording agreed with compliance',
        drafts: { TR: { en: 'Call the helpline on 183.', tr: 'Lütfen 183’ü arayın.' } },
      }),
    );
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
    expect(fake.aiState.version).toBe(4);
  });

  it('adds a country and removes another', async () => {
    const { user, fake, form } = await openDrafts();
    await user.type(within(form).getByLabelText('Country code'), 'gb');
    await user.click(within(form).getByRole('button', { name: 'Add country' }));
    const group = await within(form).findByRole('group', { name: 'Drafts for GB' });
    await user.type(within(group).getByLabelText('English text'), 'Call 0808 8020 133.');
    await user.click(within(form).getByRole('button', { name: 'Remove TR' }));
    await user.click(within(form).getByRole('button', { name: 'Save' }));

    const dialog = await screen.findByRole('dialog');
    await user.type(within(dialog).getByLabelText('Reason'), 'UK market, drop Turkey for now');
    await user.click(within(dialog).getByRole('button', { name: 'Confirm and save' }));
    await waitFor(() =>
      expect(
        fake.calls('/ai-catalogs/crisis-text-drafts').find((c) => c.method === 'PUT')?.body,
      ).toEqual({
        reason: 'UK market, drop Turkey for now',
        drafts: { GB: { en: 'Call 0808 8020 133.' } },
      }),
    );
  });

  it('holds Save on a country without a text and on markup', async () => {
    const { user, form } = await openDrafts();
    await user.type(within(form).getByLabelText('Country code'), 'DE');
    await user.click(within(form).getByRole('button', { name: 'Add country' }));
    expect(await within(form).findByRole('alert')).toHaveTextContent(
      'Every country needs a text in at least one language.',
    );
    expect(within(form).getByRole('button', { name: 'Save' })).toBeDisabled();

    const group = within(form).getByRole('group', { name: 'Drafts for DE' });
    await user.type(within(group).getByLabelText('English text'), 'Hello <b>there</b>');
    expect(within(form).getByRole('alert')).toHaveTextContent('plain text');
    expect(within(form).getByRole('button', { name: 'Save' })).toBeDisabled();
  });

  it('refuses a duplicate country code and a malformed one', async () => {
    const { user, form } = await openDrafts();
    await user.type(within(form).getByLabelText('Country code'), 'TR');
    expect(within(form).getByRole('button', { name: 'Add country' })).toBeDisabled();
    await user.clear(within(form).getByLabelText('Country code'));
    await user.type(within(form).getByLabelText('Country code'), 'T');
    expect(within(form).getByRole('button', { name: 'Add country' })).toBeDisabled();
  });

  it('is read-only for a role without ai.manage', async () => {
    const { form } = await openDrafts('readonly');
    expect(within(form).getByLabelText('English text')).toBeDisabled();
    expect(within(form).queryByLabelText('Country code')).toBeNull();
    expect(within(form).queryByRole('button', { name: 'Add country' })).toBeNull();
  });
});

describe('the workspace’s AI tab', () => {
  it('shows counts and states, and marks a source that has not shipped', async () => {
    await signIn('/workspaces/42/ai', 'Acme Gaming');
    expect(await screen.findByText('Behaviour rules')).toBeVisible();
    const facts = screen.getByText('Configuration changes').closest('div') as HTMLElement;
    expect(within(facts).getByText('Not available yet')).toBeVisible();
    const hits = screen.getByText('Guardrail triggers').closest('div') as HTMLElement;
    expect(within(hits).getByText('7')).toBeVisible();

    const table = await screen.findByRole('table', {
      name: 'Guardrail triggers by rule, last 30 days',
    });
    const rows = within(table).getAllByRole('row');
    expect(within(rows[1]!).getByText('G3')).toBeVisible();
    expect(within(table).getByText('Workspace’s own rules')).toBeVisible();
    expect(screen.getByText('Pack 2026-10-21.1: 14 passed, 0 failed (passed).')).toBeVisible();
  });
});
