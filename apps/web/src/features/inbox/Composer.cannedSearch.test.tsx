/**
 * The composer's `#` picker as a search (IN-06): every match, Turkish folding,
 * a personal badge, and variables filled in as the reply is inserted.
 */
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { Composer } from './Composer.js';

const PAPARA = Array.from({ length: 10 }, (_, i) => ({
  id: `p${i}`,
  shortcut: `yatirim${i}`,
  text: `Papara yatırımınız ${i} dakikada hesabınızda.`,
  visibility: 'all',
}));

const LIBRARY = [
  ...PAPARA,
  { id: 'w', shortcut: 'withdraw', text: 'Çekim talebiniz alındı.', visibility: 'all' },
  { id: 'hs', shortcut: 'hosgeldin', text: 'Hoş geldiniz {{customer.name}}!', visibility: 'all' },
  { id: 'hp', shortcut: 'hosgeldin', text: 'Selam {{customer.first_name}}', visibility: 'private' },
];

function setup(customerName: string | null): HTMLTextAreaElement {
  vi.stubGlobal(
    'fetch',
    vi.fn(async (input: RequestInfo | URL) => {
      const url = typeof input === 'string' ? input : String(input);
      const body = url.includes('/customer-context')
        ? {
            chat_id: 'CHAT1',
            customer: { id: 'cu1', name: customerName, username: null, email: null },
            contact_visible: true,
            pre_chat: [],
            today: [],
            history: { items: [] },
            restricted_count: 0,
          }
        : url.includes('/settings/canned-responses')
          ? { items: LIBRARY, fallback_text: 'Değerli üyemiz', company_name: 'Acme' }
          : { items: [] };
      return { ok: true, status: 200, headers: { get: () => null }, json: async () => body };
    }),
  );
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  render(
    <QueryClientProvider client={queryClient}>
      <Composer chatId="CHAT1" disabled={false} />
    </QueryClientProvider>,
  );
  return screen.getByLabelText('Reply to the customer') as HTMLTextAreaElement;
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('Composer — the `#` picker searches saved replies (IN-06)', () => {
  it('lists every reply whose text mentions the word, more than six (FR-MOD-08.7.2)', async () => {
    const textarea = setup('Ayşe');
    await userEvent.type(textarea, '#papara');

    const list = await screen.findByRole('listbox', { name: 'Saved replies' });
    await waitFor(() => expect(screen.getAllByRole('option')).toHaveLength(10));
    // At most eight rows tall; the rest scroll.
    expect(list).toHaveStyle({ maxHeight: '288px' });
  });

  it('finds "çekim" when the agent types "cekim"', async () => {
    const textarea = setup('Ayşe');
    await userEvent.type(textarea, '#cekim');

    expect(await screen.findByRole('option', { name: /Çekim talebiniz/ })).toBeInTheDocument();
  });

  it('keeps the picker open on a Turkish letter', async () => {
    const textarea = setup('Ayşe');
    await userEvent.type(textarea, '#çekim');

    expect(await screen.findByRole('option', { name: /Çekim talebiniz/ })).toBeInTheDocument();
  });

  it('shows the personal reply first, with its badge', async () => {
    const textarea = setup('Ayşe');
    await userEvent.type(textarea, '#hosg');

    const options = await screen.findAllByRole('option');
    expect(options).toHaveLength(2);
    expect(options[0]).toHaveTextContent('Personal');
    expect(options[1]).not.toHaveTextContent('Personal');
  });

  it("fills {{customer.name}} with the player's name", async () => {
    const textarea = setup('Ayşe Yılmaz');
    // The player card has to have arrived before the reply is picked.
    await waitFor(() =>
      expect(
        vi.mocked(fetch).mock.calls.some(([u]) => String(u).includes('customer-context')),
      ).toBe(true),
    );
    await userEvent.type(textarea, '#hosgeldin');
    await userEvent.click(await screen.findByRole('option', { name: /Hoş geldiniz/ }));

    await waitFor(() => expect(textarea).toHaveValue('Hoş geldiniz Ayşe Yılmaz! '));
  });

  it('moves the highlight with the arrow keys and inserts it on Enter', async () => {
    const textarea = setup('Ayşe Yılmaz');
    await userEvent.type(textarea, '#hosgeldin');
    await screen.findAllByRole('option');
    await userEvent.keyboard('{ArrowDown}');

    // The key-up no longer resets the highlight to the first row.
    const options = screen.getAllByRole('option');
    expect(options[1]).toHaveAttribute('aria-selected', 'true');
    await userEvent.keyboard('{Enter}');
    await waitFor(() => expect(textarea.value.startsWith('Hoş geldiniz')).toBe(true));
  });

  it('puts the fallback phrase in, selected, when the player gave no name', async () => {
    const textarea = setup(null);
    await userEvent.type(textarea, '#hosgeldin');
    await userEvent.click(await screen.findByRole('option', { name: /Hoş geldiniz/ }));

    await waitFor(() => expect(textarea).toHaveValue('Hoş geldiniz Değerli üyemiz! '));
    await waitFor(() =>
      expect(textarea.value.slice(textarea.selectionStart, textarea.selectionEnd)).toBe(
        'Değerli üyemiz',
      ),
    );
  });
});
