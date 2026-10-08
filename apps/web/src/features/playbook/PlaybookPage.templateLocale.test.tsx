/**
 * Picking a template mints a skill in the console's language (D18, tm 259.18).
 *
 * The gallery has shown each card's name in the panel's language for a long
 * time; what it posted to `POST /skills` was the English catalogue. Driven
 * through the real page: open the gallery, use the first card, read the body.
 */
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type * as AuthStore from '../../lib/auth-store.js';
import { renderWithLocale, resetLocale } from '../../test/i18n.js';

const { api } = vi.hoisted(() => ({ api: { get: vi.fn(), post: vi.fn() } }));

vi.mock('../../lib/auth-store.js', async (importOriginal) => {
  const actual = await importOriginal<typeof AuthStore>();
  return { ...actual, useApiClient: () => api };
});

const { PlaybookPage } = await import('./PlaybookPage.js');
const { useAuth } = await import('../../lib/auth-store.js');

beforeEach(() => {
  api.get.mockReset();
  api.post.mockReset();
  // A real, stable `agent`: the page's own scopes selector mints a fresh `[]` on
  // every call when it is nullish, which spins into "Maximum update depth".
  useAuth.setState({
    status: 'signed-in',
    accessToken: 'test-token',
    agent: {
      account_id: 'a-1',
      email: 'dana@acme.localhost',
      name: 'Dana Okonkwo',
      role: 'owner',
      organization_id: 'o-1',
      license_id: '1000003',
      scopes: ['agents-bot--all:rw'],
      routing_status: 'accepting_chats',
    },
  });
  api.get.mockImplementation((path: string) => {
    if (path === '/skills') return Promise.resolve({ items: [] });
    if (path === '/ai-agents') {
      return Promise.resolve({
        items: [{ id: 'ai-1', kind: 'ai_agent', name: 'Ada', active: true }],
      });
    }
    if (path === '/knowledge-sources') return Promise.resolve({ items: [] });
    return Promise.reject(new Error(`unexpected ${path}`));
  });
  // Only the request is under test; the skill that would come back opens an editor.
  api.post.mockReturnValue(new Promise(() => undefined));
});

afterEach(() => {
  resetLocale();
});

function renderPage(locale: 'en' | 'tr'): void {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  renderWithLocale(
    <QueryClientProvider client={queryClient}>
      <PlaybookPage />
    </QueryClientProvider>,
    locale,
  );
}

async function useFirstTemplate(opener: string, use: string): Promise<void> {
  const user = userEvent.setup();
  await user.click(await screen.findByRole('button', { name: opener }));
  const dialog = await screen.findByRole('dialog');
  await user.click(within(dialog).getAllByRole('button', { name: use })[0]!);
}

describe('PlaybookPage — a template used in a given language', () => {
  it('posts a Turkish skill from a Turkish console', async () => {
    renderPage('tr');
    await useFirstTemplate('Şablonlara göz at', 'Şablonu kullan');

    expect(api.post).toHaveBeenCalledTimes(1);
    const [path, body] = api.post.mock.calls[0]! as [string, Record<string, unknown>];
    expect(path).toBe('/skills');
    expect(body['name']).toBe('Siparişim nerede?');
    expect(body['instruction']).toContain('sipariş numarasını iste');
    expect(body['steps']).toEqual([
      expect.objectContaining({ type: 'detect_intent', intent: 'order_status' }),
      { type: 'request_info', field: 'order_number', prompt: 'Sipariş numaranız nedir?' },
      { type: 'tag', tag: 'shipping' },
      { type: 'send_message', source: 'knowledge' },
    ]);
    expect(JSON.stringify(body)).not.toMatch(/What is your order number|Where is my order/);
  });

  it('still posts the English catalogue from an English console', async () => {
    renderPage('en');
    await useFirstTemplate('Browse templates', 'Use template');

    const [, body] = api.post.mock.calls[0]! as [string, Record<string, unknown>];
    expect(body['name']).toBe('Where is my order?');
    expect(body['steps']).toContainEqual({
      type: 'request_info',
      field: 'order_number',
      prompt: 'What is your order number?',
    });
  });
});
