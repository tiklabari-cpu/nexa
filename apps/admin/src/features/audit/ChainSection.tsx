/**
 * The chain's two whole-trail actions (tm 391 · FR-ADMIN-06): "Verify the chain" and "Export".
 *
 * Verify walks every entry and answers with what it found — a clean walk says how many entries
 * it checked and between which positions; a broken one lists each finding by kind and position
 * (the server reports the first hundred and counts the rest). Export downloads one signed page
 * of NDJSON, oldest first, and shows what the page says about itself: the seal
 * (`X-Siyahtus-Signature`, checked offline with the chain key — runbook §13.2), its range and the
 * cursor to resume from. A copy of a trail is evidence only if it is whole, so there is no
 * filter on the export.
 */
import { useState, type ReactElement, type ReactNode } from 'react';
import { Banner } from '../../components/ui/index.js';
import { errorMessageKey } from '../../lib/api-client.js';
import { formatCount } from '../../lib/format.js';
import { useTranslate } from '../../lib/i18n.js';
import { Card } from '../../components/Page.js';
import { Cell, DataTable, PRIMARY_BUTTON_CLASS, SECONDARY_BUTTON_CLASS } from '../workspaces/ui.js';
import { fetchExportPage, useVerifyChain, type ExportPage } from './queries.js';

/** Hand the page to the browser as a file; a test environment without object URLs skips it. */
function saveFile(page: ExportPage): void {
  if (typeof URL.createObjectURL !== 'function') return;
  const url = URL.createObjectURL(page.body);
  const link = document.createElement('a');
  link.href = url;
  link.download = `platform-audit-${page.firstSeq || 'empty'}-${page.lastSeq || 'empty'}.ndjson`;
  document.body.appendChild(link);
  link.click();
  link.remove();
  URL.revokeObjectURL(url);
}

export function ChainSection(): ReactElement {
  const t = useTranslate();
  return (
    <section aria-labelledby="audit-chain" className="flex flex-col gap-4">
      <h2 id="audit-chain" className="text-sm font-semibold">
        {t('audit.chain.heading')}
      </h2>
      <div className="grid gap-4 lg:grid-cols-2">
        <VerifyCard />
        <ExportCard />
      </div>
    </section>
  );
}

function VerifyCard(): ReactElement {
  const t = useTranslate();
  const verify = useVerifyChain();
  const result = verify.data;

  return (
    <Card>
      <div className="flex flex-col gap-3 p-4">
        <p className="text-sm text-content-secondary">{t('audit.verify.intro')}</p>
        <div>
          <button
            type="button"
            className={PRIMARY_BUTTON_CLASS}
            disabled={verify.isPending}
            onClick={() => verify.mutate()}
          >
            {verify.isPending ? t('audit.verify.running') : t('audit.verify.run')}
          </button>
        </div>
        {verify.isError && (
          <p role="alert" className="text-sm text-danger">
            {t(errorMessageKey(verify.error))}
          </p>
        )}
        {result?.ok && (
          <Banner tone="success">
            {t('audit.verify.ok', {
              checked: formatCount(result.checked) ?? result.checked,
              first: result.first_seq ?? '—',
              last: result.last_seq ?? '—',
            })}
          </Banner>
        )}
        {result && !result.ok && (
          <>
            <Banner tone="danger" role="alert">
              {t('audit.verify.broken', {
                total: formatCount(result.findings_total) ?? result.findings_total,
              })}
            </Banner>
            <DataTable
              caption={t('audit.verify.findings')}
              headers={[
                t('audit.verify.col.kind'),
                t('audit.verify.col.position'),
                t('audit.verify.col.detail'),
              ]}
            >
              {result.findings.map((finding, index) => (
                <tr key={`${finding.kind}-${finding.seq ?? 'none'}-${index}`}>
                  <Cell>{t(`audit.verify.kind.${finding.kind}`)}</Cell>
                  <Cell>
                    <code className="text-xs">{finding.seq ?? '—'}</code>
                  </Cell>
                  <Cell>{finding.detail}</Cell>
                </tr>
              ))}
            </DataTable>
            {result.findings_total > result.findings.length && (
              <p className="text-xs text-content-secondary">
                {t('audit.verify.truncated', { shown: result.findings.length })}
              </p>
            )}
          </>
        )}
      </div>
    </Card>
  );
}

function ExportCard(): ReactElement {
  const t = useTranslate();
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<unknown>(null);
  const [page, setPage] = useState<ExportPage | null>(null);

  const run = async (cursor: string): Promise<void> => {
    setPending(true);
    setError(null);
    try {
      const next = await fetchExportPage(cursor);
      saveFile(next);
      setPage(next);
    } catch (failure) {
      setError(failure);
    } finally {
      setPending(false);
    }
  };

  return (
    <Card>
      <div className="flex flex-col gap-3 p-4">
        <p className="text-sm text-content-secondary">{t('audit.export.intro')}</p>
        <div className="flex flex-wrap gap-2">
          <button
            type="button"
            className={page ? SECONDARY_BUTTON_CLASS : PRIMARY_BUTTON_CLASS}
            disabled={pending}
            onClick={() => void run('')}
          >
            {pending && !page ? t('audit.export.running') : t('audit.export.first')}
          </button>
          {page?.hasMore && (
            <button
              type="button"
              className={PRIMARY_BUTTON_CLASS}
              disabled={pending}
              onClick={() => void run(page.cursor)}
            >
              {t('audit.export.next')}
            </button>
          )}
        </div>
        {error !== null && (
          <p role="alert" className="text-sm text-danger">
            {t(errorMessageKey(error))}
          </p>
        )}
        {page && (
          <dl aria-label={t('audit.export.result')} className="grid gap-2 text-sm">
            <Fact label={t('audit.export.count')} value={formatCount(page.count) ?? page.count} />
            <Fact
              label={t('audit.export.range')}
              value={page.count === 0 ? '—' : `${page.firstSeq} – ${page.lastSeq}`}
            />
            <Fact
              label={t('audit.export.more')}
              value={page.hasMore ? t('audit.export.more.yes') : t('audit.export.more.no')}
            />
            <Fact label={t('audit.export.cursor')} value={<code>{page.cursor || '—'}</code>} />
            <Fact
              label={t('audit.export.signature')}
              value={<code className="break-all">{page.signature || '—'}</code>}
            />
            <Fact
              label={t('audit.export.chain')}
              value={page.chainOk ? t('audit.export.chain.ok') : t('audit.export.chain.broken')}
            />
          </dl>
        )}
      </div>
    </Card>
  );
}

function Fact({ label, value }: { label: string; value: ReactNode }): ReactElement {
  return (
    <div className="min-w-0">
      <dt className="text-xs text-content-secondary">{label}</dt>
      <dd className="mt-0.5 break-words text-xs">{value}</dd>
    </div>
  );
}
