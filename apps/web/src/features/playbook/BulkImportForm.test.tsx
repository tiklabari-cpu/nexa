/**
 * BulkImportForm's contract (FR-MOD-06.3.2): a selected file is only ever
 * previewed (`dry_run: true`) before Import writes anything, Import stays
 * disabled until that preview names at least one row it would actually
 * import (EK-A.1), and a server refusal surfaces in a Banner without locking
 * the file picker.
 */
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type * as AuthStore from '../../lib/auth-store.js';
import { ApiClientError } from '../../lib/api-client.js';
import type { KnowledgeBulkResult } from './types.js';

const { api } = vi.hoisted(() => ({ api: { post: vi.fn() } }));

vi.mock('../../lib/auth-store.js', async (importOriginal) => {
  const actual = await importOriginal<typeof AuthStore>();
  return { ...actual, useApiClient: () => api };
});

const { BulkImportForm } = await import('./BulkImportForm.js');

const AI_AGENT_ID = 'agent-1';
const VALID_CSV = 'name,type,content,source_url\r\nReturn policy,article,Ships in 3 days,\r\n';

function csvFile(content: string, name = 'sources.csv', type = 'text/csv'): File {
  return new File([content], name, { type });
}

function dryRunResult(imported: number, failed: number): KnowledgeBulkResult {
  return { imported, failed, dry_run: true, results: [] };
}

function renderForm(
  props: { canEdit?: boolean; aiAgentId?: string | null; onImported?: () => void } = {},
): ReturnType<typeof render> & { onImported: () => void } {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  const onImported = props.onImported ?? vi.fn();
  const utils = render(
    <QueryClientProvider client={queryClient}>
      <BulkImportForm
        canEdit={props.canEdit ?? true}
        aiAgentId={props.aiAgentId === undefined ? AI_AGENT_ID : props.aiAgentId}
        onImported={onImported}
      />
    </QueryClientProvider>,
  );
  return { ...utils, onImported };
}

async function openPanel(user: ReturnType<typeof userEvent.setup>): Promise<void> {
  await user.click(screen.getByRole('button', { name: 'Bulk import' }));
}

beforeEach(() => {
  api.post.mockReset();
});

describe('BulkImportForm', () => {
  it('renders nothing when there is no AI agent to import into', () => {
    const { container } = renderForm({ aiAgentId: null });
    expect(container).toBeEmptyDOMElement();
  });

  it('renders nothing without edit permission', () => {
    const { container } = renderForm({ canEdit: false });
    expect(container).toBeEmptyDOMElement();
  });

  it('rejects a non-CSV file with a field error and makes no network call', async () => {
    // `applyAccept: false`: a real OS file dialog still lets a person override
    // its `accept` filter (an "All Files" option), so the component's own
    // precheck — not the browser's filter — is what this test exercises.
    const user = userEvent.setup({ applyAccept: false });
    renderForm();
    await openPanel(user);

    const input = screen.getByLabelText('CSV file');
    await user.upload(input, csvFile(VALID_CSV, 'sources.txt', 'text/plain'));

    expect(await screen.findByText(/Choose a \.csv file/)).toBeInTheDocument();
    expect(api.post).not.toHaveBeenCalled();
  });

  it('keeps Import disabled when the dry run finds no valid rows', async () => {
    api.post.mockResolvedValue(dryRunResult(0, 1));
    const user = userEvent.setup();
    renderForm();
    await openPanel(user);

    const input = screen.getByLabelText('CSV file');
    await user.upload(input, csvFile('name,type,content,source_url\r\nBad,bad-type,,\r\n'));

    await waitFor(() =>
      expect(api.post).toHaveBeenCalledWith('/knowledge-sources/bulk', {
        ai_agent_id: AI_AGENT_ID,
        csv: expect.any(String),
        dry_run: true,
      }),
    );

    expect(await screen.findByText(/1 will be skipped/)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Import' })).toBeDisabled();
  });

  it('shows a Banner without locking the form when the server refuses the dry run', async () => {
    api.post.mockRejectedValue(
      new ApiClientError({
        type: 'validation',
        status: 400,
        message: 'csv: too many rows.',
        requestId: 'req-1',
      }),
    );
    const user = userEvent.setup();
    renderForm();
    await openPanel(user);

    const input = screen.getByLabelText('CSV file');
    await user.upload(input, csvFile(VALID_CSV));

    expect(await screen.findByRole('alert')).toHaveTextContent('csv: too many rows.');
    // The form is not locked: the file input stays enabled for another try.
    expect(screen.getByLabelText('CSV file')).toBeEnabled();
    expect(screen.getByRole('button', { name: 'Import' })).toBeDisabled();
  });

  it('shows a loading preview while the dry run is in flight', async () => {
    let resolveDryRun: (value: KnowledgeBulkResult) => void = () => {};
    api.post.mockImplementation(
      () =>
        new Promise<KnowledgeBulkResult>((resolve) => {
          resolveDryRun = resolve;
        }),
    );
    const user = userEvent.setup();
    renderForm();
    await openPanel(user);

    const input = screen.getByLabelText('CSV file');
    await user.upload(input, csvFile(VALID_CSV));

    expect(await screen.findByTestId('bulk-import-preview-loading')).toBeInTheDocument();

    resolveDryRun(dryRunResult(1, 0));
    await waitFor(() =>
      expect(screen.queryByTestId('bulk-import-preview-loading')).not.toBeInTheDocument(),
    );
  });

  it('imports after a successful dry run and reports back to the caller', async () => {
    api.post
      .mockResolvedValueOnce(dryRunResult(2, 0))
      .mockResolvedValueOnce({ imported: 2, failed: 0, dry_run: false, results: [] });
    const user = userEvent.setup();
    const { onImported } = renderForm();
    await openPanel(user);

    const input = screen.getByLabelText('CSV file');
    await user.upload(
      input,
      csvFile('name,type,content,source_url\r\nA,article,Hi,\r\nB,article,Hi,\r\n'),
    );

    const importButton = await screen.findByRole('button', { name: 'Import' });
    await waitFor(() => expect(importButton).toBeEnabled());
    await user.click(importButton);

    await waitFor(() =>
      expect(api.post).toHaveBeenNthCalledWith(2, '/knowledge-sources/bulk', {
        ai_agent_id: AI_AGENT_ID,
        csv: expect.any(String),
        dry_run: false,
      }),
    );
    await waitFor(() => expect(onImported).toHaveBeenCalledTimes(1));
  });
});
