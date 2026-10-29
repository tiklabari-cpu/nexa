/**
 * Widget texts (tm 344 · WG-05): one language at a time, the widget's own
 * text as each empty field's placeholder, an unknown placeholder refused
 * before Save, "Reset to default" sends the key no more.
 */
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { WIDGET_PHRASE_DEFAULTS } from '@siyahtus/types';
import { WidgetPhrasesSettings } from './WidgetPhrases.js';
import { useAuth, useBrandStore } from '../../../lib/auth-store.js';

function okJson(body: unknown): Response {
  return {
    ok: true,
    status: 200,
    headers: { get: () => null },
    json: async () => body,
  } as unknown as Response;
}

let saved: Record<string, Record<string, string>>;
let puts: Array<{ locale: string; phrases: Record<string, string> }>;

function stubFetch(): void {
  puts = [];
  vi.stubGlobal(
    'fetch',
    vi.fn(async (url: string, init?: RequestInit) => {
      const locale = new URL(String(url), 'https://api.test').searchParams.get('locale') ?? 'en';
      if ((init?.method ?? 'GET') === 'PUT') {
        const body = JSON.parse(String(init?.body)) as { phrases: Record<string, string> };
        puts.push({ locale, phrases: body.phrases });
        saved[locale] = body.phrases;
      }
      return okJson({
        brand_id: 'brand-1',
        locale,
        phrases: saved[locale] ?? {},
        updated_at: null,
      });
    }),
  );
}

function renderPhrases() {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={queryClient}>
      <WidgetPhrasesSettings canEdit />
    </QueryClientProvider>,
  );
}

beforeEach(() => {
  saved = { tr: { 'status.offline': 'Değerli üyemiz, şu an kapalıyız.' } };
  useAuth.setState({ status: 'signed-in', accessToken: 'test-token', agent: null });
  useBrandStore.setState({ brandId: null });
  stubFetch();
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('WidgetPhrasesSettings (tm 344 · WG-05)', () => {
  it('shows the widget’s own text as the placeholder of each empty field', async () => {
    renderPhrases();
    const placeholder = await screen.findByLabelText('Message box placeholder');
    expect(placeholder).toHaveValue('');
    expect(placeholder).toHaveAttribute(
      'placeholder',
      WIDGET_PHRASE_DEFAULTS.en['input.placeholder'],
    );
  });

  it('switches language and reads that language’s saved texts', async () => {
    renderPhrases();
    await screen.findByLabelText('Nobody available');
    await userEvent.selectOptions(screen.getByLabelText('Language'), 'tr');
    await waitFor(() =>
      expect(screen.getByLabelText('Nobody available')).toHaveValue(
        'Değerli üyemiz, şu an kapalıyız.',
      ),
    );
    expect(screen.getByLabelText('Message box placeholder')).toHaveAttribute(
      'placeholder',
      WIDGET_PHRASE_DEFAULTS.tr['input.placeholder'],
    );
  });

  it('refuses an unknown placeholder before Save', async () => {
    renderPhrases();
    const queue = await screen.findByLabelText('Queue position');
    await userEvent.type(queue, 'Sıranız {{pos}');
    expect(screen.getByRole('alert')).toHaveTextContent(/Only these can go in braces here: \{n\}/);
    expect(screen.getByRole('button', { name: 'Save' })).toBeDisabled();
    expect(puts).toEqual([]);
  });

  it('saves only the written texts, and "Reset to default" drops a key', async () => {
    renderPhrases();
    await userEvent.selectOptions(await screen.findByLabelText('Language'), 'tr');
    await waitFor(() =>
      expect(screen.getByLabelText('Nobody available')).toHaveValue(
        'Değerli üyemiz, şu an kapalıyız.',
      ),
    );
    await userEvent.click(screen.getByRole('button', { name: 'Reset to default' }));
    await userEvent.type(screen.getByLabelText('Message box placeholder'), 'Sorunuzu yazın');
    await userEvent.click(screen.getByRole('button', { name: 'Save' }));

    await waitFor(() => expect(puts).toHaveLength(1));
    expect(puts[0]).toEqual({ locale: 'tr', phrases: { 'input.placeholder': 'Sorunuzu yazın' } });
  });
});
