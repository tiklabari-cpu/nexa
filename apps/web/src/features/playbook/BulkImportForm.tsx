/**
 * Bulk import — CSV → dry-run preview → import (FR-MOD-06.3.2, "bulk/CSV
 * import").
 *
 * A secondary action inside the Knowledge panel, next to the one-source-at-a-
 * time form above it. Selecting a file never writes anything by itself: it is
 * read locally (`bulk-file.ts`'s prechecks reject an obviously wrong file
 * before a byte is sent), then posted to `POST /knowledge-sources/bulk` with
 * `dry_run: true`. `BulkImportResults` renders the row-by-row verdict that
 * call returns and *is* the preview — there is no client-side CSV parser
 * duplicating the server's column/row rules, so the preview can never
 * disagree with what Import actually does.
 *
 * A completed import (`dry_run: false`) reuses the same table, titled
 * differently — an admin who clicks Import sees the real per-row result, not
 * a summary that vanishes the instant the request resolves. The panel only
 * resets and closes once they dismiss it with "Done".
 */
import { useMutation, type UseMutationResult } from '@tanstack/react-query';
import { useState, type ChangeEvent, type ReactElement } from 'react';
import { Banner } from '../../components/ui/Banner.js';
import { Skeleton } from '../../components/Skeleton.js';
import { ApiClientError } from '../../lib/api-client.js';
import { useApiClient } from '../../lib/auth-store.js';
import { FieldError } from '../../lib/form.js';
import { BulkImportResults } from './BulkImportResults.js';
import { readBulkFile } from './bulk-file.js';
import { BULK_TEMPLATE_FILENAME, toTemplateBlob } from './bulk-template.js';
import type { KnowledgeBulkResult } from './types.js';

function errorMessage(error: unknown): string | null {
  if (!error) return null;
  return error instanceof ApiClientError ? error.message : 'Could not process that file.';
}

function downloadTemplate(): void {
  const url = URL.createObjectURL(toTemplateBlob());
  const link = document.createElement('a');
  link.href = url;
  link.download = BULK_TEMPLATE_FILENAME;
  document.body.appendChild(link);
  link.click();
  link.remove();
  URL.revokeObjectURL(url);
}

export function BulkImportForm({
  canEdit,
  aiAgentId,
  onImported,
}: {
  canEdit: boolean;
  aiAgentId: string | null;
  onImported: () => void;
}): ReactElement | null {
  const api = useApiClient();
  const [open, setOpen] = useState(false);
  const [fileName, setFileName] = useState<string | null>(null);
  const [csv, setCsv] = useState<string | null>(null);
  const [fieldError, setFieldError] = useState<string | null>(null);

  const dryRun = useMutation({
    mutationFn: (text: string) =>
      api.post<KnowledgeBulkResult>('/knowledge-sources/bulk', {
        ai_agent_id: aiAgentId,
        csv: text,
        dry_run: true,
      }),
  });

  const runImport: UseMutationResult<KnowledgeBulkResult, unknown, string> = useMutation({
    mutationFn: (text: string) =>
      api.post<KnowledgeBulkResult>('/knowledge-sources/bulk', {
        ai_agent_id: aiAgentId,
        csv: text,
        dry_run: false,
      }),
    onSuccess: onImported,
  });

  // Not this admin's to do, or no agent yet to import into — same gate the
  // single-source form above uses, so the two forms appear and disappear
  // together.
  if (!canEdit || !aiAgentId) return null;

  function resetPanel(): void {
    setOpen(false);
    setFileName(null);
    setCsv(null);
    setFieldError(null);
    dryRun.reset();
    runImport.reset();
  }

  async function handleFileChange(event: ChangeEvent<HTMLInputElement>): Promise<void> {
    const file = event.target.files?.[0];
    // Reset so picking the same file again still fires onChange.
    event.target.value = '';
    if (!file) return;

    setFieldError(null);
    setCsv(null);
    setFileName(null);
    dryRun.reset();
    runImport.reset();

    const result = await readBulkFile(file);
    if (!result.ok) {
      setFieldError(result.message);
      return;
    }
    setFileName(file.name);
    setCsv(result.text);
    dryRun.mutate(result.text);
  }

  // EK-A.1: Import stays disabled until the dry run names at least one row
  // it would actually write.
  const canImport = csv !== null && (dryRun.data?.imported ?? 0) > 0 && !runImport.isPending;
  const message = errorMessage(dryRun.error ?? runImport.error);

  return (
    <div className="border-b border-border p-4">
      <button
        type="button"
        aria-expanded={open}
        onClick={() => setOpen((current) => !current)}
        className="rounded-md border border-border px-3 py-1.5 text-2xs font-medium text-content-secondary transition-colors hover:bg-surface-2"
      >
        Bulk import
      </button>

      {open && (
        <div className="mt-3 flex flex-col gap-3 rounded-md border border-border bg-inset p-3">
          {runImport.isSuccess && runImport.data ? (
            <>
              <BulkImportResults
                title="Import complete"
                imported={runImport.data.imported}
                failed={runImport.data.failed}
                results={runImport.data.results}
              />
              <button
                type="button"
                onClick={resetPanel}
                className="self-start rounded-md border border-border px-3 py-1.5 text-sm font-medium text-content-secondary transition-colors hover:bg-surface-2"
              >
                Done
              </button>
            </>
          ) : (
            <>
              <div className="flex flex-wrap items-center justify-between gap-2">
                <p className="text-2xs text-content-tertiary">
                  Import many sources at once from a CSV file — name, type, content, source_url.
                </p>
                <button
                  type="button"
                  onClick={downloadTemplate}
                  className="shrink-0 rounded-md border border-border px-2 py-1 text-2xs text-content-secondary transition-colors hover:bg-surface-2"
                >
                  Download template
                </button>
              </div>

              <label htmlFor="bulk-import-file" className="flex flex-col gap-1">
                <span className="text-2xs font-medium uppercase tracking-wide text-content-tertiary">
                  CSV file
                </span>
                <input
                  id="bulk-import-file"
                  type="file"
                  accept=".csv,text/csv"
                  onChange={(event) => void handleFileChange(event)}
                  aria-describedby={fieldError ? 'bulk-import-file-error' : undefined}
                  className="text-sm"
                />
              </label>
              <FieldError id="bulk-import-file-error" message={fieldError} />

              {message && <Banner tone="danger">{message}</Banner>}

              {dryRun.isPending && (
                <div
                  aria-hidden="true"
                  data-testid="bulk-import-preview-loading"
                  className="flex animate-pulse flex-col gap-1.5"
                >
                  <Skeleton width="70%" />
                  <Skeleton width="45%" />
                </div>
              )}

              {dryRun.data && !dryRun.isPending && (
                <BulkImportResults
                  title={fileName ? `Preview — ${fileName}` : 'Preview'}
                  imported={dryRun.data.imported}
                  failed={dryRun.data.failed}
                  results={dryRun.data.results}
                />
              )}

              <button
                type="button"
                disabled={!canImport}
                onClick={() => {
                  if (csv) runImport.mutate(csv);
                }}
                className="self-start rounded-md bg-brand-500 px-3 py-1.5 text-sm font-medium text-white transition-colors hover:bg-brand-600 disabled:opacity-50"
              >
                {runImport.isPending ? 'Importing…' : 'Import'}
              </button>
            </>
          )}
        </div>
      )}
    </div>
  );
}
