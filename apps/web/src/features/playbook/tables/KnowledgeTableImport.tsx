/**
 * CSV import for one structured table (tm 310.5 · AI-13 §8), the bulk-import
 * pattern: choosing a file writes nothing — it is posted with `dry_run: true`
 * and the per-row verdict that comes back *is* the preview. Valid rows are
 * taken and invalid ones skipped with their problems, line by line, so one bad
 * row never costs the other four hundred. The preview is the server's report,
 * not a second CSV parser here, so it cannot disagree with what Import does.
 */
import { useMutation } from '@tanstack/react-query';
import { useState, type ChangeEvent, type ReactElement } from 'react';
import {
  KNOWLEDGE_TABLE_COLUMNS,
  KNOWLEDGE_TABLE_META_WRITE_FIELDS,
  type KnowledgeTable,
} from '@siyahtus/types';
import { Banner } from '../../../components/ui/Banner.js';
import { Skeleton } from '../../../components/Skeleton.js';
import { ApiClientError, errorMessageKey } from '../../../lib/api-client.js';
import { useApiClient } from '../../../lib/auth-store.js';
import { FieldError } from '../../../lib/form.js';
import { useTranslate, type TFunction } from '../../../lib/i18n.js';
import { reasonMessage } from '../../../lib/reason-message.js';
import { BulkImportResults } from '../BulkImportResults.js';
import { BULK_FILE_MAX_BYTES, readBulkFile, type BulkFileRejectionReason } from '../bulk-file.js';
import type { KnowledgeBulkRowResult } from '../types.js';
import { segmentOf } from './table-form.js';

interface ImportRowResult {
  line: number;
  status: 'imported' | 'skipped';
  id: string | null;
  label: string | null;
  problems: Array<{ field: string; code: string }>;
}

interface ImportResult {
  imported: number;
  failed: number;
  dry_run: boolean;
  results: ImportRowResult[];
}

const REJECTION_KEYS: Record<BulkFileRejectionReason, string> = {
  invalid_type: 'playbook.bulk.rejectInvalidType',
  empty_file: 'playbook.bulk.rejectEmptyFile',
  too_large: 'playbook.bulk.rejectTooLarge',
};

/** The shared results table speaks of a source; a table row's problems are its error. */
function asBulkRows(results: ImportRowResult[], t: TFunction): KnowledgeBulkRowResult[] {
  return results.map((result) => ({
    line: result.line,
    name: result.label,
    type: null,
    status: result.status,
    id: result.id,
    chunk_count: null,
    added_by_name: null,
    error:
      result.problems.length === 0
        ? null
        : result.problems
            .map(
              (problem) =>
                `${t(`playbook.tables.field.${problem.field}`)}: ${t(`playbook.tables.problem.${problem.code}`)}`,
            )
            .join(' · '),
  }));
}

/** The file with just the header — the columns this table's import reads. */
function downloadTemplate(table: KnowledgeTable): void {
  const header = [
    ...KNOWLEDGE_TABLE_META_WRITE_FIELDS,
    ...KNOWLEDGE_TABLE_COLUMNS[table].map(([name]) => name),
  ].join(',');
  const url = URL.createObjectURL(new Blob([`${header}\n`], { type: 'text/csv;charset=utf-8' }));
  const link = document.createElement('a');
  link.href = url;
  link.download = `${segmentOf(table)}-template.csv`;
  document.body.appendChild(link);
  link.click();
  link.remove();
  URL.revokeObjectURL(url);
}

export function KnowledgeTableImport({
  table,
  onImported,
}: {
  table: KnowledgeTable;
  onImported: () => void;
}): ReactElement {
  const t = useTranslate();
  const api = useApiClient();
  const [fileName, setFileName] = useState<string | null>(null);
  const [csv, setCsv] = useState<string | null>(null);
  const [fieldError, setFieldError] = useState<string | null>(null);

  const post = (text: string, dryRun: boolean): Promise<ImportResult> =>
    api.post<ImportResult>(`/knowledge-tables/${segmentOf(table)}/import`, {
      csv: text,
      dry_run: dryRun,
    });
  const dryRun = useMutation({ mutationFn: (text: string) => post(text, true) });
  const runImport = useMutation({
    mutationFn: (text: string) => post(text, false),
    onSuccess: onImported,
  });

  async function handleFile(event: ChangeEvent<HTMLInputElement>): Promise<void> {
    const file = event.target.files?.[0];
    event.target.value = '';
    if (!file) return;
    setFieldError(null);
    setCsv(null);
    setFileName(null);
    dryRun.reset();
    runImport.reset();
    const result = await readBulkFile(file);
    if (!result.ok) {
      setFieldError(
        t(REJECTION_KEYS[result.reason], { size: Math.round(BULK_FILE_MAX_BYTES / (1024 * 1024)) }),
      );
      return;
    }
    setFileName(file.name);
    setCsv(result.text);
    dryRun.mutate(result.text);
  }

  const failure = dryRun.error ?? runImport.error;
  const message = !failure
    ? null
    : !(failure instanceof ApiClientError)
      ? t('playbook.tables.import.processError')
      : (reasonMessage(t, failure, 'playbook.tables.reason') ?? t(errorMessageKey(failure)));
  const canImport = csv !== null && (dryRun.data?.imported ?? 0) > 0 && !runImport.isPending;

  return (
    <div className="flex flex-col gap-3 rounded-md border border-border bg-inset p-3">
      {runImport.isSuccess ? (
        <BulkImportResults
          title={t('playbook.bulk.importComplete')}
          imported={runImport.data.imported}
          failed={runImport.data.failed}
          results={asBulkRows(runImport.data.results, t)}
        />
      ) : (
        <>
          <div className="flex flex-wrap items-center justify-between gap-2">
            <p className="text-2xs text-content-tertiary">
              {t('playbook.tables.import.description')}
            </p>
            <button
              type="button"
              onClick={() => downloadTemplate(table)}
              className="shrink-0 rounded-md border border-border px-2 py-1 text-2xs text-content-secondary transition-colors hover:bg-surface-2"
            >
              {t('playbook.tables.import.template')}
            </button>
          </div>
          <label htmlFor={`table-import-file-${table}`} className="flex flex-col gap-1">
            <span className="text-2xs font-medium uppercase tracking-wide text-content-tertiary">
              {t('playbook.bulk.fileLabel')}
            </span>
            <input
              id={`table-import-file-${table}`}
              type="file"
              accept=".csv,text/csv"
              onChange={(event) => void handleFile(event)}
              className="text-sm"
            />
          </label>
          <FieldError message={fieldError} />
          {message && <Banner tone="danger">{message}</Banner>}
          {dryRun.isPending && (
            <div aria-hidden="true" className="flex animate-pulse flex-col gap-1.5">
              <Skeleton width="70%" />
              <Skeleton width="45%" />
            </div>
          )}
          {dryRun.data && !dryRun.isPending && (
            <BulkImportResults
              title={
                fileName
                  ? t('playbook.bulk.previewNamed', { name: fileName })
                  : t('playbook.bulk.preview')
              }
              imported={dryRun.data.imported}
              failed={dryRun.data.failed}
              results={asBulkRows(dryRun.data.results, t)}
            />
          )}
          <button
            type="button"
            disabled={!canImport}
            onClick={() => {
              if (csv) runImport.mutate(csv);
            }}
            className="self-start rounded-md bg-brand-500 px-3 py-1.5 text-sm font-medium text-white transition-colors hover:bg-brand-600 disabled:opacity-60"
          >
            {runImport.isPending ? t('playbook.bulk.importing') : t('playbook.bulk.import')}
          </button>
        </>
      )}
    </div>
  );
}
