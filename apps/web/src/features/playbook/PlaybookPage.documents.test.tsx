/**
 * PDF and Word documents in the Files tab (tm 313.3 · AI-18), through the
 * Knowledge tab.
 *
 * What has to hold: a document goes up in two stages (the signed PUT, then the
 * source) and the admin is told it is being read; a refusal the server gives
 * says which rule it was, in a sentence; a document row shows its pages and the
 * reason it could not be read instead of the generic refresh failure, and
 * downloads its original through the signed link.
 */
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ApiClientError } from '../../lib/api-client.js';
import type * as AuthStore from '../../lib/auth-store.js';
import { resetLocale } from '../../test/i18n.js';
import type { KnowledgeSource } from './types.js';

const { api } = vi.hoisted(() => ({
  api: { get: vi.fn(), post: vi.fn(), patch: vi.fn(), delete: vi.fn() },
}));

vi.mock('../../lib/auth-store.js', async (importOriginal) => {
  const actual = await importOriginal<typeof AuthStore>();
  return { ...actual, useApiClient: () => api };
});

const { PlaybookPage } = await import('./PlaybookPage.js');
const { useAuth } = await import('../../lib/auth-store.js');

const PDF = 'application/pdf';

function document_(patch: Partial<KnowledgeSource> = {}): KnowledgeSource {
  return {
    id: 'src-doc',
    ai_agent_id: 'agent-1',
    name: 'Bonus şartları',
    type: 'file',
    status: 'ready',
    source_url: null,
    chunk_count: 12,
    updated_at: '2026-10-27T10:00:00.000Z',
    added_by_name: 'Ada',
    refresh_after_days: null,
    next_refresh_at: null,
    last_refresh_error: null,
    page_count: 12,
    file_mime: PDF,
    file_size: 4096,
    job_id: null,
    ...patch,
  };
}

const fetchMock = vi.fn();

beforeEach(() => {
  window.history.replaceState(null, '', '/app/playbook?view=skills');
  resetLocale();
  for (const fn of Object.values(api)) fn.mockReset();
  fetchMock.mockReset();
  vi.stubGlobal('fetch', fetchMock);
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
});

afterEach(() => {
  vi.unstubAllGlobals();
});

async function openKnowledge(
  user: ReturnType<typeof userEvent.setup>,
  items: KnowledgeSource[] = [],
): Promise<void> {
  api.get.mockImplementation((path: string) => {
    if (path === '/skills') return Promise.resolve({ items: [] });
    if (path === '/ai-agents') {
      return Promise.resolve({
        items: [{ id: 'agent-1', kind: 'ai_agent', name: 'Ada', active: true }],
      });
    }
    if (path === '/knowledge-sources/src-doc/file') {
      return Promise.resolve({
        url: '/api/v1/knowledge-files/k.pdf?signature=s',
        filename: 'Bonus şartları.pdf',
      });
    }
    if (path.startsWith('/knowledge-sources')) return Promise.resolve({ items });
    if (path === '/brands' || path === '/agents') return Promise.resolve({ items: [] });
    return Promise.reject(new Error(`unexpected ${path}`));
  });
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  render(
    <QueryClientProvider client={queryClient}>
      <PlaybookPage />
    </QueryClientProvider>,
  );
  await user.click(await screen.findByRole('tab', { name: 'Knowledge' }));
}

async function chooseFileType(user: ReturnType<typeof userEvent.setup>): Promise<void> {
  await user.selectOptions(await screen.findByLabelText('Type', { exact: true }), 'file');
}

describe('adding a PDF or Word document (FR-MOD-06.3.2)', () => {
  it('uploads in two stages, then says the document is being read', async () => {
    const user = userEvent.setup();
    api.post.mockImplementation((path: string) => {
      if (path === '/uploads') {
        return Promise.resolve({ upload_url: '/api/v1/uploads/k.pdf?sig=1', upload_id: 'k.pdf' });
      }
      return Promise.resolve(document_({ status: 'processing', chunk_count: 0, page_count: 0 }));
    });
    fetchMock.mockResolvedValue({ ok: true });
    await openKnowledge(user);
    await chooseFileType(user);

    const file = new File(['%PDF-1.4'], 'bonus.pdf', { type: PDF });
    await user.upload(screen.getByLabelText('File'), file);
    expect(screen.getByText('Ready to upload: bonus.pdf')).toBeTruthy();
    await user.click(screen.getByRole('button', { name: 'Add source' }));

    await waitFor(() =>
      expect(
        screen.getByText(
          'Uploaded. Reading bonus.pdf in the background — the list updates when it is ready.',
        ),
      ).toBeTruthy(),
    );
    expect(api.post).toHaveBeenNthCalledWith(1, '/uploads', {
      content_type: PDF,
      size_bytes: file.size,
      purpose: 'knowledge_document',
    });
    expect(fetchMock).toHaveBeenCalledWith(
      '/api/v1/uploads/k.pdf?sig=1',
      expect.objectContaining({ method: 'PUT', body: file }),
    );
    expect(api.post).toHaveBeenNthCalledWith(
      2,
      '/knowledge-sources/document',
      expect.objectContaining({
        ai_agent_id: 'agent-1',
        upload_id: 'k.pdf',
        filename: 'bonus.pdf',
      }),
    );
    // No name typed: the server titles it from the filename.
    expect(api.post.mock.calls[1]![1]).not.toHaveProperty('name');
  });

  it('refuses a document over 20 MiB before any request', async () => {
    const user = userEvent.setup();
    await openKnowledge(user);
    await chooseFileType(user);

    const big = new File(['x'], 'huge.pdf', { type: PDF });
    Object.defineProperty(big, 'size', { value: 21 * 1024 * 1024 });
    await user.upload(screen.getByLabelText('File'), big);

    expect(await screen.findByText('The file is over the 20 MiB limit.')).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Add source' }).hasAttribute('disabled')).toBe(true);
    expect(api.post).not.toHaveBeenCalled();
  });

  it('names the rule when the server refuses the upload', async () => {
    const user = userEvent.setup();
    api.post.mockRejectedValue(
      new ApiClientError({
        type: 'validation',
        status: 400,
        message: 'infected',
        requestId: 'r-1',
        details: { reason: 'virus_detected' },
      }),
    );
    await openKnowledge(user);
    await chooseFileType(user);
    await user.upload(
      screen.getByLabelText('File'),
      new File(['%PDF-1.4'], 'bad.pdf', { type: PDF }),
    );
    await user.click(screen.getByRole('button', { name: 'Add source' }));

    expect(await screen.findByText('The file contains malware and was not added.')).toBeTruthy();
  });

  it('accepts a dropped document the same way', async () => {
    const user = userEvent.setup();
    await openKnowledge(user);
    await chooseFileType(user);

    const zone = screen.getByText('Drop a PDF or Word file here').closest('div')!;
    const file = new File(['%PDF-1.4'], 'dropped.pdf', { type: PDF });
    const { fireEvent } = await import('@testing-library/react');
    fireEvent.drop(zone, { dataTransfer: { files: [file] } });

    expect(await screen.findByText('Ready to upload: dropped.pdf')).toBeTruthy();
  });
});

describe('a document row', () => {
  it('shows its pages and downloads the original through the signed link', async () => {
    const user = userEvent.setup();
    const click = vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => {});
    await openKnowledge(user, [document_()]);

    expect(await screen.findByText('12 pages')).toBeTruthy();
    await user.click(
      screen.getByRole('button', { name: 'Download the original of Bonus şartları' }),
    );

    await waitFor(() => expect(click).toHaveBeenCalledTimes(1));
    expect(api.get).toHaveBeenCalledWith('/knowledge-sources/src-doc/file');
    click.mockRestore();
  });

  it('says why a document could not be read, not the generic refresh failure', async () => {
    const user = userEvent.setup();
    await openKnowledge(user, [
      document_({
        status: 'failed',
        chunk_count: 0,
        page_count: 0,
        last_refresh_error: 'encrypted',
      }),
    ]);

    expect(
      await screen.findByText(
        'The document is password-protected. Upload a copy without the password.',
      ),
    ).toBeTruthy();
    expect(screen.queryByText('Could not refresh automatically')).toBeNull();
  });

  it('shows a document still being read as such', async () => {
    const user = userEvent.setup();
    await openKnowledge(user, [
      document_({ status: 'processing', chunk_count: 0, page_count: 0, job_id: 'job-1' }),
    ]);

    expect(await screen.findAllByText('Reading the document…')).not.toHaveLength(0);
  });
});
