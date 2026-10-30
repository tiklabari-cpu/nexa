/**
 * The campaign report (EN-05): displayed, clicks, chats, conversion and
 * suppressed per campaign and per day, with the CSV that carries the same
 * numbers (`GET /reports/campaigns`, `GET /reports/export?group=campaigns`).
 * Archived campaigns stay in it — that is why deleting one only archives it.
 *
 * The picker lists every campaign the unfiltered report names; choosing one
 * asks the server for that campaign alone, so the screen and the file always
 * come from the same filtered query.
 */
import { useQuery } from '@tanstack/react-query';
import { useMemo, useState, type ReactElement } from 'react';
import { Card, ErrorNotice } from '../../components/Page.js';
import { EmptyState } from '../../components/EmptyState.js';
import { ListSkeleton } from '../../components/Skeleton.js';
import { errorMessageKey } from '../../lib/api-client.js';
import { useApiClient } from '../../lib/auth-store.js';
import { formatCount, formatDay, formatRate } from '../../lib/format.js';
import { useTranslate } from '../../lib/i18n.js';
import type { CampaignReportCounts, CampaignsReport } from '@siyahtus/types';

const PRESETS = [7, 30, 90] as const;
type Preset = (typeof PRESETS)[number];

const FIGURES = ['displayed', 'clicks', 'chats', 'conversion', 'suppressed'] as const;

/** Conversion as a share of what was displayed; null when nothing was. */
function conversionShare(counts: CampaignReportCounts): number | null {
  return counts.displayed === 0 ? null : counts.conversion / counts.displayed;
}

export function CampaignsReportView(): ReactElement {
  const t = useTranslate();
  const api = useApiClient();
  const [days, setDays] = useState<Preset>(30);
  const [campaignId, setCampaignId] = useState('');
  const [downloading, setDownloading] = useState(false);
  const [downloadError, setDownloadError] = useState<string | null>(null);

  // Whole minutes, so a re-render does not read as a new window.
  const range = useMemo(() => {
    const to = new Date(Math.floor(Date.now() / 60_000) * 60_000);
    const from = new Date(to.getTime() - days * 86_400_000);
    return { from: from.toISOString(), to: to.toISOString() };
  }, [days]);
  const windowQuery = `from=${encodeURIComponent(range.from)}&to=${encodeURIComponent(range.to)}`;
  const only = campaignId ? `&campaign_id=${campaignId}` : '';

  const all = useQuery({
    queryKey: ['campaign-report', days, ''],
    queryFn: () => api.get<CampaignsReport>(`/reports/campaigns?${windowQuery}`),
  });
  const narrowed = useQuery({
    queryKey: ['campaign-report', days, campaignId],
    enabled: campaignId !== '',
    queryFn: () => api.get<CampaignsReport>(`/reports/campaigns?${windowQuery}${only}`),
  });
  const query = campaignId ? narrowed : all;
  const report = query.data;

  const download = async (): Promise<void> => {
    setDownloading(true);
    setDownloadError(null);
    try {
      const { blob, filename } = await api.getFile(
        `/reports/export?group=campaigns&${windowQuery}${only}&format=csv`,
      );
      const url = URL.createObjectURL(blob);
      const link = document.createElement('a');
      link.href = url;
      link.download = filename ?? 'siyahtus-campaigns.csv';
      document.body.appendChild(link);
      link.click();
      link.remove();
      URL.revokeObjectURL(url);
    } catch (cause) {
      setDownloadError(t(errorMessageKey(cause)));
    } finally {
      setDownloading(false);
    }
  };

  return (
    <section aria-label={t('campaigns.report.title')} className="flex flex-col gap-4">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div className="flex flex-wrap items-end gap-3">
          <div>
            <label htmlFor="campaign-report-range" className="mb-1 block text-xs font-medium">
              {t('campaigns.report.rangeLabel')}
            </label>
            <select
              id="campaign-report-range"
              value={days}
              onChange={(event) => setDays(Number(event.target.value) as Preset)}
              className="rounded-md border border-border bg-inset px-2 py-1.5 text-sm"
            >
              {PRESETS.map((preset) => (
                <option key={preset} value={preset}>
                  {t('campaigns.report.lastDays', { count: preset })}
                </option>
              ))}
            </select>
          </div>
          <div>
            <label htmlFor="campaign-report-campaign" className="mb-1 block text-xs font-medium">
              {t('campaigns.report.campaignLabel')}
            </label>
            <select
              id="campaign-report-campaign"
              value={campaignId}
              onChange={(event) => setCampaignId(event.target.value)}
              className="max-w-[16rem] rounded-md border border-border bg-inset px-2 py-1.5 text-sm"
            >
              <option value="">{t('campaigns.report.allCampaigns')}</option>
              {(all.data?.campaigns ?? []).map((row) => (
                <option key={row.campaign_id} value={row.campaign_id}>
                  {row.archived ? t('campaigns.report.archivedName', { name: row.name }) : row.name}
                </option>
              ))}
            </select>
          </div>
        </div>
        <div className="flex flex-col items-end gap-1">
          <button
            type="button"
            disabled={downloading || !report}
            onClick={() => void download()}
            className="rounded-md border border-border px-2.5 py-1.5 text-xs font-medium text-content-secondary hover:bg-surface-2 disabled:opacity-50"
          >
            {downloading ? t('campaigns.report.exporting') : t('campaigns.report.export')}
          </button>
          {downloadError && (
            <p role="alert" className="text-2xs text-danger">
              {downloadError}
            </p>
          )}
        </div>
      </div>

      {query.error ? (
        <ErrorNotice message={t('campaigns.report.loadError')} />
      ) : query.isPending || !report ? (
        <Card>
          <ListSkeleton />
        </Card>
      ) : report.campaigns.length === 0 ? (
        <Card>
          <EmptyState
            title={t('campaigns.report.emptyTitle')}
            description={t('campaigns.report.emptyDescription')}
          />
        </Card>
      ) : (
        <>
          <dl
            data-testid="campaign-report-totals"
            className="grid grid-cols-2 gap-3 sm:grid-cols-5"
          >
            {FIGURES.map((figure) => (
              <div key={figure} className="rounded-lg border border-border bg-surface p-3">
                <dt className="text-2xs font-medium uppercase tracking-wide text-content-tertiary">
                  {t(`campaigns.report.col.${figure}`)}
                </dt>
                <dd className="tabular text-lg font-semibold">
                  {formatCount(report.totals[figure]) ?? '0'}
                  {figure === 'conversion' && conversionShare(report.totals) !== null && (
                    <span className="ml-1 text-2xs font-normal text-content-tertiary">
                      {formatRate(conversionShare(report.totals)!)}
                    </span>
                  )}
                </dd>
              </div>
            ))}
          </dl>

          <Card>
            <table className="w-full text-sm">
              <caption className="sr-only">{t('campaigns.report.byCampaignCaption')}</caption>
              <thead>
                <tr className="border-b border-border text-left">
                  <th scope="col" className="px-4 py-2 text-xs font-medium text-content-secondary">
                    {t('campaigns.report.col.campaign')}
                  </th>
                  {FIGURES.map((figure) => (
                    <th
                      key={figure}
                      scope="col"
                      className="px-3 py-2 text-right text-xs font-medium text-content-secondary"
                    >
                      {t(`campaigns.report.col.${figure}`)}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {report.campaigns.map((row) => (
                  <tr key={row.campaign_id} className="border-b border-border last:border-0">
                    <td className="px-4 py-2">
                      {row.name}
                      {row.archived && (
                        <span className="ml-2 text-2xs text-content-tertiary">
                          {t('campaigns.report.archived')}
                        </span>
                      )}
                    </td>
                    {FIGURES.map((figure) => (
                      <td key={figure} className="tabular px-3 py-2 text-right">
                        {formatCount(row[figure]) ?? '0'}
                      </td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          </Card>

          <Card>
            <table className="w-full text-sm">
              <caption className="sr-only">{t('campaigns.report.byDayCaption')}</caption>
              <thead>
                <tr className="border-b border-border text-left">
                  <th scope="col" className="px-4 py-2 text-xs font-medium text-content-secondary">
                    {t('campaigns.report.col.day')}
                  </th>
                  <th scope="col" className="px-3 py-2 text-xs font-medium text-content-secondary">
                    {t('campaigns.report.col.campaign')}
                  </th>
                  {FIGURES.map((figure) => (
                    <th
                      key={figure}
                      scope="col"
                      className="px-3 py-2 text-right text-xs font-medium text-content-secondary"
                    >
                      {t(`campaigns.report.col.${figure}`)}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {report.by_day.map((row) => (
                  <tr
                    key={`${row.date}-${row.campaign_id}`}
                    className="border-b border-border last:border-0"
                  >
                    <td className="tabular px-4 py-2">{formatDay(row.date) ?? row.date}</td>
                    <td className="px-3 py-2">{row.name}</td>
                    {FIGURES.map((figure) => (
                      <td key={figure} className="tabular px-3 py-2 text-right">
                        {formatCount(row[figure]) ?? '0'}
                      </td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          </Card>
          <p className="text-2xs text-content-tertiary">{t('campaigns.report.dayNote')}</p>
        </>
      )}
    </section>
  );
}
