/**
 * Settings › Chat forms › Built-in fields (WG-01): the widget's own pre-chat
 * form as a per-brand setting. The controls keep `required ⇒ visible`, the
 * warnings the item asks for appear when they should (username hidden; form
 * off while custom questions exist), the preview follows the draft, and Save
 * sends the whole form at once.
 */
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { ReactElement } from 'react';
import { DEFAULT_PRECHAT_CONFIG, type PrechatConfig } from '@siyahtus/types';
import type * as AuthStore from '../../lib/auth-store.js';
import { renderWithLocale } from '../../test/i18n.js';

const { api } = vi.hoisted(() => ({
  api: { get: vi.fn(), post: vi.fn(), put: vi.fn(), patch: vi.fn(), delete: vi.fn() },
}));

vi.mock('../../lib/auth-store.js', async (importOriginal) => {
  const actual = await importOriginal<typeof AuthStore>();
  return { ...actual, useApiClient: () => api };
});

const { ChatFormsSettings } = await import('./SettingsPage.js');

const BRAND = '11111111-1111-4111-8111-111111111111';
let prechat: PrechatConfig & { brand_id: string; configured: boolean };
let customFields: Array<Record<string, unknown>>;

function renderCard(ui: ReactElement = <ChatFormsSettings canEdit />): void {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  render(<QueryClientProvider client={queryClient}>{ui}</QueryClientProvider>);
}

/** The built-in fields card — the section's first card. */
async function card(): Promise<HTMLElement> {
  const heading = await screen.findByRole('heading', { name: 'Built-in fields' });
  const box = heading.closest<HTMLElement>('.rounded-lg')!;
  // The heading is there from the first frame; the controls once the form loads.
  await within(box).findByRole('checkbox', { name: 'Ask before the chat starts' });
  return box;
}

beforeEach(() => {
  prechat = { brand_id: BRAND, configured: false, ...structuredClone(DEFAULT_PRECHAT_CONFIG) };
  customFields = [];
  api.get.mockReset();
  api.get.mockImplementation(async (url: string) =>
    url === '/settings/prechat' ? prechat : { items: customFields },
  );
  api.put.mockReset();
  api.put.mockImplementation(async (_url: string, body: PrechatConfig) => ({
    brand_id: BRAND,
    configured: true,
    ...body,
  }));
});

describe('built-in pre-chat fields (WG-01)', () => {
  it('shows today’s form for a brand that never saved one, and says so', async () => {
    renderCard();
    const box = await card();

    expect(within(box).getByRole('checkbox', { name: 'Ask before the chat starts' })).toBeChecked();
    for (const field of ['Full name', 'Username', 'Email', 'Opening message']) {
      expect(within(box).getByRole('checkbox', { name: `Show ${field}` })).toBeChecked();
      expect(within(box).getByRole('checkbox', { name: `Require ${field}` })).toBeChecked();
    }
    expect(within(box).getByText(/have not been saved/)).toBeInTheDocument();
    expect(within(box).getByRole('button', { name: 'Save' })).toBeDisabled();
  });

  it('hiding the username clears its requirement, warns, and saves the whole form', async () => {
    renderCard();
    const box = await card();

    await userEvent.click(within(box).getByRole('checkbox', { name: 'Show Username' }));
    const require = within(box).getByRole('checkbox', { name: 'Require Username' });
    expect(require).not.toBeChecked();
    expect(require).toBeDisabled();
    expect(within(box).getByText(/member recognition and same-day/)).toBeInTheDocument();
    // The preview no longer asks for it.
    expect(within(screen.getByTestId('prechat-preview')).queryByText('Username')).toBeNull();

    await userEvent.click(within(box).getByRole('button', { name: 'Save' }));
    await vi.waitFor(() => expect(api.put).toHaveBeenCalledTimes(1));
    expect(api.put).toHaveBeenCalledWith('/settings/prechat', {
      enabled: true,
      fields: {
        ...DEFAULT_PRECHAT_CONFIG.fields,
        username: { visible: false, required: false },
      },
    });
    // Saved: the draft is gone and the button rests again.
    await vi.waitFor(() =>
      expect(within(box).getByRole('button', { name: 'Save' })).toBeDisabled(),
    );
  });

  it('an optional username keeps its row and drops its star in the preview', async () => {
    renderCard();
    const box = await card();
    await userEvent.click(within(box).getByRole('checkbox', { name: 'Require Username' }));

    const preview = screen.getByTestId('prechat-preview');
    expect(within(preview).getByText('Username').textContent).toBe('Username');
    expect(within(preview).getByText('Full name').textContent).toBe('Full name *');
    expect(within(box).queryByText(/member recognition/)).toBeNull();
  });

  it('turning the form off warns that custom questions go too, and previews no form', async () => {
    customFields = [
      {
        id: 'cf-1',
        entity: 'contact',
        label: 'Account id',
        type: 'text',
        required: false,
        form_placement: 'pre_chat',
      },
    ];
    renderCard();
    const box = await card();
    await screen.findByText('Account id');

    await userEvent.click(
      within(box).getByRole('checkbox', { name: 'Ask before the chat starts' }),
    );
    expect(within(box).getByText(/own pre-chat questions/)).toBeInTheDocument();
    expect(within(box).getByRole('checkbox', { name: 'Show Email' })).toBeDisabled();
    expect(screen.getByTestId('prechat-preview')).toHaveTextContent(/straight to the chat/);
  });

  it('discarding returns to the saved form', async () => {
    prechat = {
      ...prechat,
      configured: true,
      fields: { ...prechat.fields, email: { visible: true, required: false } },
    };
    renderCard();
    const box = await card();
    expect(within(box).queryByText(/have not been saved/)).toBeNull();

    await userEvent.click(within(box).getByRole('checkbox', { name: 'Show Email' }));
    await userEvent.click(within(box).getByRole('button', { name: 'Discard' }));
    expect(within(box).getByRole('checkbox', { name: 'Show Email' })).toBeChecked();
    expect(within(box).getByRole('checkbox', { name: 'Require Email' })).not.toBeChecked();
  });

  it('is read-only without edit rights', async () => {
    renderCard(<ChatFormsSettings canEdit={false} />);
    const box = await card();
    expect(within(box).getByRole('checkbox', { name: 'Show Username' })).toBeDisabled();
    expect(within(box).queryByRole('button', { name: 'Save' })).toBeNull();
  });

  it('warns in Turkish when the username is hidden', async () => {
    const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    renderWithLocale(
      <QueryClientProvider client={queryClient}>
        <ChatFormsSettings canEdit />
      </QueryClientProvider>,
      'tr',
    );
    await userEvent.click(
      await screen.findByRole('checkbox', { name: 'Kullanıcı adı alanını göster' }),
    );
    expect(
      screen.getByText('Üye tanıma ve gün içi hafıza bu alan olmadan zayıflar.'),
    ).toBeInTheDocument();
  });
});
