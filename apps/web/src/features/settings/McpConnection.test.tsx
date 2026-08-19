/**
 * Settings → MCP server (FR-MOD-08.8.3-g). Pins the four literal KK phrases —
 * "mcp URL + Copy", "Claude setup", "örnek prompt" — against the rendered DOM,
 * plus the two negatives that matter for a screen fed by live manifest data:
 * no token/secret text ever appears, and an empty tool list gets a real empty
 * state rather than a blank rectangle.
 */
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { McpConnection } from './McpConnection.js';
import { useAuth } from '../../lib/auth-store.js';
import { renderWithLocale, resetLocale } from '../../test/i18n.js';

const MANIFEST = {
  protocol_version: '2025-06-18',
  server: { name: 'nexa', url: 'http://localhost:4000/api/v1/mcp', version: '1.0.0' },
  tools: [
    {
      name: 'search_tickets',
      title: 'Search tickets',
      description: 'Search tickets by free-text query.',
      input_schema: { type: 'object' },
      required_scopes: ['tickets--all:ro'],
    },
    {
      name: 'list_chats',
      title: 'List chats',
      description: 'List conversations in this workspace.',
      input_schema: { type: 'object' },
      required_scopes: ['chats--all:ro'],
    },
  ],
};

function okJson(body: unknown): Response {
  return {
    ok: true,
    status: 200,
    headers: { get: () => null },
    json: async () => body,
  } as unknown as Response;
}

function stubFetch(manifest: unknown = MANIFEST, ok = true): void {
  vi.stubGlobal(
    'fetch',
    vi.fn(async (url: string) => {
      if (String(url).endsWith('/mcp/manifest')) {
        if (!ok) {
          return {
            ok: false,
            status: 500,
            headers: { get: () => null },
            json: async () => ({ type: 'internal_error', message: 'boom' }),
          } as unknown as Response;
        }
        return okJson(manifest);
      }
      return okJson({});
    }),
  );
}

function renderMcp() {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={queryClient}>
      <McpConnection />
    </QueryClientProvider>,
  );
}

beforeEach(() => {
  useAuth.setState({ status: 'signed-in', accessToken: 'test-token', agent: null });
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('McpConnection', () => {
  it('shows the MCP server URL and copies it to the clipboard', async () => {
    stubFetch();
    const writeText = vi.fn().mockResolvedValue(undefined);
    vi.stubGlobal('navigator', { ...navigator, clipboard: { writeText } });

    renderMcp();

    const field = await screen.findByLabelText('MCP server URL');
    expect(field).toHaveValue(MANIFEST.server.url);

    await userEvent.click(screen.getByRole('button', { name: 'Copy' }));
    expect(writeText).toHaveBeenCalledWith(MANIFEST.server.url);
    expect(await screen.findByRole('button', { name: 'Copied' })).toBeInTheDocument();
  });

  it('renders a collapsible "Claude setup" section, closed by default', async () => {
    stubFetch();
    renderMcp();

    const toggle = await screen.findByRole('button', { name: 'Claude setup' });
    expect(toggle).toHaveAttribute('aria-expanded', 'false');
    expect(screen.queryByText(/Add custom connector/)).not.toBeInTheDocument();

    await userEvent.click(toggle);
    expect(toggle).toHaveAttribute('aria-expanded', 'true');
    expect(screen.getByText(/Add custom connector/)).toBeInTheDocument();

    await userEvent.click(toggle);
    expect(toggle).toHaveAttribute('aria-expanded', 'false');
    expect(screen.queryByText(/Add custom connector/)).not.toBeInTheDocument();
  });

  it('renders the example prompt from rapor-1', async () => {
    stubFetch();
    renderMcp();

    expect(
      await screen.findByText('“Find all tickets where customers ask about bulk orders”'),
    ).toBeInTheDocument();
  });

  it('lists the tools published in the manifest', async () => {
    stubFetch();
    renderMcp();

    expect(await screen.findByText('search_tickets')).toBeInTheDocument();
    expect(screen.getByText('list_chats')).toBeInTheDocument();
  });

  it('shows a meaningful empty state when no tools are published', async () => {
    stubFetch({ ...MANIFEST, tools: [] });
    renderMcp();

    expect(await screen.findByText('No tools published yet')).toBeInTheDocument();
  });

  it('shows an error notice when the manifest call fails', async () => {
    stubFetch(undefined, false);
    renderMcp();

    expect(await screen.findByText('Could not load the MCP server details.')).toBeInTheDocument();
  });

  it('never renders any token or secret text', async () => {
    stubFetch();
    const { container } = renderMcp();
    await waitFor(() =>
      expect(screen.getByLabelText('MCP server URL')).toHaveValue(MANIFEST.server.url),
    );

    const text = container.textContent ?? '';
    expect(text).not.toMatch(/token/i);
    expect(text).not.toMatch(/secret/i);
    expect(text).not.toMatch(/api[_-]?key/i);
  });
});

/** One sentinel for this file's DoD claim of being translated (I18N-j, tm 133.10). */
describe('McpConnection localisation (NFR-I18N2)', () => {
  afterEach(() => {
    resetLocale();
  });

  it('paints MCP server in Turkish when that is the active locale', async () => {
    stubFetch();
    const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    renderWithLocale(
      <QueryClientProvider client={queryClient}>
        <McpConnection />
      </QueryClientProvider>,
      'tr',
    );

    expect(await screen.findByRole('region', { name: 'MCP sunucusu' })).toBeInTheDocument();
  });
});
