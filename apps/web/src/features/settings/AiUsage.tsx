/**
 * Settings › Usage and quotas › AI usage (tm 283.4 · AI-16).
 *
 * The workspace's daily AI allowance made visible: how much of each meter is
 * spent today, the last 30 days, which feature spent it, what it cost (when the
 * operator priced it), today's 80%/100% alerts and who receives them. A pure
 * reader of `GET /ai/usage` — every number, cap and percentage is the server's.
 *
 * Three honesties are built in, each from the API's contract:
 *
 *   - **The day is UTC.** The allowance renews at 00:00 UTC, so the screen says
 *     so and prints the renewal moment; the workspace's time zone would draw
 *     bars that do not add up to the allowance they are measured against.
 *   - **Money is an estimate or absent.** `cost_usd` is shown, labelled as an
 *     estimate, only where the endpoint sent it — never a zero standing in for
 *     "not priced".
 *   - **The limit is not editable here.** It is the platform's; the screen says
 *     whom to ask rather than offering a field the server would refuse.
 *
 * The recipient picker is the owner's (`PUT /ai/usage/alert-recipients` is owner
 * only); an admin sees the same list read-only. The role gate mirrors the
 * route's `minimumRole: 'admin'` — the courtesy hide `DataRetention` uses.
 */
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useEffect, useState, type ReactElement } from 'react';
import { AI_LIVE_METERS, type AiLiveMeter, type AiUsageMeter } from '@siyahtus/types';
import { Card, ErrorNotice, Kpi, KpiGrid, Section } from '../../components/Page.js';
import { errorMessageKey } from '../../lib/api-client.js';
import { useApiClient, useAuth } from '../../lib/auth-store.js';
import {
  formatCount,
  formatDateTime,
  formatDay,
  formatRate,
  formatUsdEstimate,
} from '../../lib/format.js';
import { useTranslate, type TFunction } from '../../lib/i18n.js';
import {
  AI_USAGE_QUERY_KEY,
  canViewAiUsage,
  useAiUsage,
  type AiUsage as AiUsageData,
  type AiUsageMeterToday,
} from './ai-usage.js';

interface RosterMember {
  id: string;
  name: string;
  role: string;
  suspended?: boolean;
}

const TEST_METERS: readonly AiUsageMeter[] = ['llm_test', 'embedding_test'];

export function AiUsage({ isOwner }: { isOwner: boolean }): ReactElement | null {
  const role = useAuth((s) => s.agent?.role ?? null);
  if (!canViewAiUsage(role)) return null;
  return <AiUsageCard isOwner={isOwner} />;
}

function AiUsageCard({ isOwner }: { isOwner: boolean }): ReactElement {
  const t = useTranslate();
  const usage = useAiUsage(true);

  return (
    <Section
      id="section-ai-usage"
      title={t('settings.aiUsage.title')}
      description={t('settings.aiUsage.description')}
    >
      {usage.error ? (
        <ErrorNotice message={t('settings.aiUsage.loadError')} />
      ) : usage.isPending ? (
        <Card>
          <p className="p-4 text-sm text-content-secondary">{t('settings.loading')}</p>
        </Card>
      ) : (
        <div className="flex flex-col gap-4">
          <TodayCards usage={usage.data} />
          <DailyChart usage={usage.data} />
          <SurfaceTable usage={usage.data} />
          <AlertsCard usage={usage.data} isOwner={isOwner} />
          <p className="text-2xs text-content-tertiary">{t('settings.aiUsage.capNote')}</p>
        </div>
      )}
    </Section>
  );
}

function meterLabel(t: TFunction, meter: AiUsageMeter): string {
  return t(`settings.aiUsage.meter.${meter}`);
}

/** Today: one card per meter, with the live pair first and the simulation pair after. */
function TodayCards({ usage }: { usage: AiUsageData }): ReactElement {
  const t = useTranslate();
  const byMeter = new Map(usage.meters.map((m) => [m.meter, m]));
  const live = AI_LIVE_METERS.map((m) => byMeter.get(m)).filter(
    (m): m is AiUsageMeterToday => m !== undefined,
  );
  const test = TEST_METERS.map((m) => byMeter.get(m)).filter(
    (m): m is AiUsageMeterToday => m !== undefined,
  );

  return (
    <Card>
      <div className="flex flex-col gap-4 p-4">
        <p className="text-2xs text-content-secondary">
          {t('settings.aiUsage.utcNote', {
            day: formatDay(usage.day) ?? usage.day,
            resets: formatDateTime(usage.resets_at) ?? usage.resets_at,
          })}
        </p>
        <div className="flex flex-col gap-3">
          {live.map((m) => (
            <MeterRow key={m.meter} meter={m} />
          ))}
        </div>
        {test.length > 0 && (
          <div className="flex flex-col gap-3 border-t border-border pt-3">
            <p className="text-2xs font-medium uppercase tracking-wide text-content-tertiary">
              {t('settings.aiUsage.testHeading')}
            </p>
            {test.map((m) => (
              <MeterRow key={m.meter} meter={m} />
            ))}
          </div>
        )}
        <CostLine usage={usage} />
      </div>
    </Card>
  );
}

/** A meter's bar. Past 100% the bar stays full and the number says by how much. */
function MeterRow({ meter }: { meter: AiUsageMeterToday }): ReactElement {
  const t = useTranslate();
  const label = meterLabel(t, meter.meter);
  const width = Math.min(100, Math.max(0, meter.percent));
  const tone =
    meter.percent >= 100 ? 'bg-danger' : meter.percent >= 80 ? 'bg-warning' : 'bg-brand-500';
  return (
    <div className="flex flex-col gap-1">
      <div className="flex flex-wrap items-baseline justify-between gap-x-3 text-sm">
        <span className="font-medium">{label}</span>
        <span className="text-content-secondary">
          {t('settings.aiUsage.usedOfCap', {
            used: formatCount(meter.used) ?? '0',
            cap: formatCount(meter.cap) ?? '0',
            percent: formatRate(meter.percent / 100) ?? '0%',
          })}
        </span>
      </div>
      <div
        role="progressbar"
        aria-label={label}
        aria-valuemin={0}
        aria-valuemax={100}
        aria-valuenow={Math.round(width)}
        aria-valuetext={t('settings.aiUsage.percentOfCap', {
          percent: formatRate(meter.percent / 100) ?? '0%',
        })}
        className="h-2 overflow-hidden rounded-full bg-inset"
      >
        <div className={`h-full ${tone}`} style={{ width: `${width}%` }} />
      </div>
      {meter.reserved > 0 && (
        <p className="text-2xs text-content-tertiary">
          {t('settings.aiUsage.reserved', { count: formatCount(meter.reserved) ?? '0' })}
        </p>
      )}
    </div>
  );
}

/**
 * Today's estimated cost, only for the meters the endpoint priced. No price
 * configured at all → no money on the screen, and no placeholder for it.
 */
function CostLine({ usage }: { usage: AiUsageData }): ReactElement | null {
  const t = useTranslate();
  const priced = usage.meters.filter((m) => m.cost_usd !== undefined);
  if (priced.length === 0) return null;
  const total = priced.reduce((sum, m) => sum + (m.cost_usd ?? 0), 0);
  return (
    <div className="flex flex-col gap-2 border-t border-border pt-3">
      <KpiGrid>
        <Kpi
          label={t('settings.aiUsage.costToday')}
          value={formatUsdEstimate(total)}
          hint={t('settings.aiUsage.costEstimateHint')}
        />
      </KpiGrid>
      {usage.pricing && <PricingNote usage={usage} />}
    </div>
  );
}

function PricingNote({ usage }: { usage: AiUsageData }): ReactElement | null {
  const t = useTranslate();
  const p = usage.pricing;
  if (!p) return null;
  const parts: string[] = [];
  if (p.llm_input_usd_per_mtok !== undefined && p.llm_output_usd_per_mtok !== undefined) {
    parts.push(
      t('settings.aiUsage.priceLlm', {
        input: formatUsdEstimate(p.llm_input_usd_per_mtok) ?? '',
        output: formatUsdEstimate(p.llm_output_usd_per_mtok) ?? '',
      }),
    );
  }
  if (p.embedding_usd_per_mtok !== undefined) {
    parts.push(
      t('settings.aiUsage.priceEmbedding', {
        price: formatUsdEstimate(p.embedding_usd_per_mtok) ?? '',
      }),
    );
  }
  return (
    <p className="text-2xs text-content-tertiary">
      {t('settings.aiUsage.pricingNote', { prices: parts.join(' · ') })}
    </p>
  );
}

/**
 * The 30 UTC days as bars, one chart per live meter. The bars are decoration
 * for the eye; the same numbers sit in a visually hidden table so the series is
 * not a picture to a screen reader.
 */
function DailyChart({ usage }: { usage: AiUsageData }): ReactElement {
  const t = useTranslate();
  return (
    <Card>
      <div className="flex flex-col gap-4 p-4">
        <h3 className="text-sm font-semibold">
          {t('settings.aiUsage.chartHeading', { days: usage.window_days })}
        </h3>
        {AI_LIVE_METERS.map((meter) => (
          <MeterBars key={meter} meter={meter} usage={usage} />
        ))}
      </div>
    </Card>
  );
}

function MeterBars({ meter, usage }: { meter: AiLiveMeter; usage: AiUsageData }): ReactElement {
  const t = useTranslate();
  const label = meterLabel(t, meter);
  const values = usage.daily.map((d) => d[meter]);
  const peak = Math.max(1, ...values);
  const total = values.reduce((a, b) => a + b, 0);
  return (
    <figure className="flex flex-col gap-1">
      <figcaption className="flex flex-wrap items-baseline justify-between gap-x-3 text-sm">
        <span className="font-medium">{label}</span>
        <span className="text-content-secondary">
          {t('settings.aiUsage.chartTotal', { total: formatCount(total) ?? '0' })}
        </span>
      </figcaption>
      <div aria-hidden="true" className="flex h-24 items-end gap-0.5">
        {usage.daily.map((d, i) => (
          <div
            key={d.day}
            title={`${formatDay(d.day) ?? d.day}: ${formatCount(values[i]) ?? '0'}`}
            className="min-w-0 flex-1 rounded-t-sm bg-brand-500"
            style={{ height: `${values[i]! === 0 ? 1 : Math.max(2, (values[i]! / peak) * 100)}%` }}
          />
        ))}
      </div>
      <table className="sr-only">
        <caption>{t('settings.aiUsage.chartTableCaption', { meter: label })}</caption>
        <thead>
          <tr>
            <th scope="col">{t('settings.aiUsage.col.day')}</th>
            <th scope="col">{label}</th>
          </tr>
        </thead>
        <tbody>
          {usage.daily.map((d) => (
            <tr key={d.day}>
              <th scope="row">{formatDay(d.day) ?? d.day}</th>
              <td>{formatCount(d[meter]) ?? '0'}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </figure>
  );
}

/** Which feature spent what over the window, from the ledger. */
function SurfaceTable({ usage }: { usage: AiUsageData }): ReactElement {
  const t = useTranslate();
  const priced = usage.surfaces.some((s) => s.cost_usd !== undefined);
  return (
    <Card>
      <div className="flex flex-col gap-3 p-4">
        <h3 className="text-sm font-semibold">
          {t('settings.aiUsage.surfaceHeading', { days: usage.window_days })}
        </h3>
        {usage.surfaces.length === 0 ? (
          <p className="text-sm text-content-secondary">{t('settings.aiUsage.surfaceEmpty')}</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-left text-sm">
              <thead>
                <tr className="text-2xs uppercase tracking-wide text-content-tertiary">
                  <th scope="col" className="py-1 pr-3 font-medium">
                    {t('settings.aiUsage.col.surface')}
                  </th>
                  <th scope="col" className="py-1 pr-3 font-medium">
                    {t('settings.aiUsage.col.meter')}
                  </th>
                  <th scope="col" className="py-1 pr-3 text-right font-medium">
                    {t('settings.aiUsage.col.input')}
                  </th>
                  <th scope="col" className="py-1 pr-3 text-right font-medium">
                    {t('settings.aiUsage.col.output')}
                  </th>
                  {priced && (
                    <th scope="col" className="py-1 text-right font-medium">
                      {t('settings.aiUsage.col.cost')}
                    </th>
                  )}
                </tr>
              </thead>
              <tbody>
                {usage.surfaces.map((row) => (
                  <tr key={`${row.surface}-${row.meter}`} className="border-t border-border">
                    <th scope="row" className="py-1.5 pr-3 font-normal">
                      {t(`settings.aiUsage.surface.${row.surface}`)}
                    </th>
                    <td className="py-1.5 pr-3 text-content-secondary">
                      {meterLabel(t, row.meter)}
                    </td>
                    <td className="py-1.5 pr-3 text-right tabular-nums">
                      {formatCount(row.input_tokens) ?? '0'}
                    </td>
                    <td className="py-1.5 pr-3 text-right tabular-nums">
                      {formatCount(row.output_tokens) ?? '0'}
                    </td>
                    {priced && (
                      <td className="py-1.5 text-right tabular-nums">
                        {row.cost_usd !== undefined ? formatUsdEstimate(row.cost_usd) : '—'}
                      </td>
                    )}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </Card>
  );
}

/** Today's alerts, and who besides the owner is told next time. */
function AlertsCard({ usage, isOwner }: { usage: AiUsageData; isOwner: boolean }): ReactElement {
  const t = useTranslate();
  return (
    <Card>
      <div className="flex flex-col gap-4 p-4">
        <div className="flex flex-col gap-2">
          <h3 className="text-sm font-semibold">{t('settings.aiUsage.alertsHeading')}</h3>
          <p className="text-2xs text-content-secondary">{t('settings.aiUsage.alertsNote')}</p>
          {usage.alerts.length === 0 ? (
            <p className="text-sm text-content-secondary">{t('settings.aiUsage.alertsNone')}</p>
          ) : (
            <ul className="flex flex-col gap-1 text-sm">
              {usage.alerts.map((alert) => (
                <li key={`${alert.meter}-${alert.threshold}`}>
                  {t('settings.aiUsage.alertRow', {
                    threshold: formatRate(alert.threshold / 100) ?? `${alert.threshold}%`,
                    meter: meterLabel(t, alert.meter),
                    time: formatDateTime(alert.created_at) ?? alert.created_at,
                  })}
                </li>
              ))}
            </ul>
          )}
        </div>
        <Recipients selected={usage.alert_recipients} isOwner={isOwner} />
      </div>
    </Card>
  );
}

function Recipients({
  selected,
  isOwner,
}: {
  selected: readonly string[];
  isOwner: boolean;
}): ReactElement {
  const t = useTranslate();
  const api = useApiClient();
  const queryClient = useQueryClient();

  const roster = useQuery({
    queryKey: ['ai', 'usage', 'roster'],
    queryFn: () => api.get<{ items: RosterMember[] }>('/agents'),
  });
  // The owner is told regardless; the picker is for the people besides them.
  const candidates = (roster.data?.items ?? []).filter(
    (m) => m.role !== 'agent' && m.role !== 'owner' && m.suspended !== true,
  );

  const [chosen, setChosen] = useState<ReadonlySet<string>>(new Set(selected));
  // A refetch (or a save elsewhere) is the server's word; the box follows it.
  const savedKey = selected.join(',');
  useEffect(() => {
    setChosen(new Set(savedKey === '' ? [] : savedKey.split(',')));
  }, [savedKey]);

  const save = useMutation({
    mutationFn: (accountIds: string[]) =>
      api.put<{ alert_recipients: string[] }>('/ai/usage/alert-recipients', {
        account_ids: accountIds,
      }),
    onSuccess: (data) =>
      queryClient.setQueryData<AiUsageData>(AI_USAGE_QUERY_KEY, (old) =>
        old ? { ...old, alert_recipients: data.alert_recipients } : old,
      ),
  });

  const dirty = chosen.size !== selected.length || selected.some((id) => !chosen.has(id));
  const toggle = (id: string): void => {
    save.reset();
    setChosen((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  return (
    <fieldset className="flex flex-col gap-2 border-t border-border pt-3">
      <legend className="text-2xs font-medium uppercase tracking-wide text-content-tertiary">
        {t('settings.aiUsage.recipientsLegend')}
      </legend>
      <p className="text-2xs text-content-secondary">
        {t(
          isOwner ? 'settings.aiUsage.recipientsNoteOwner' : 'settings.aiUsage.recipientsNoteOther',
        )}
      </p>
      {roster.isPending ? (
        <p className="text-sm text-content-secondary">{t('settings.loading')}</p>
      ) : candidates.length === 0 ? (
        <p className="text-sm text-content-secondary">{t('settings.aiUsage.recipientsNone')}</p>
      ) : (
        <div className="flex flex-wrap gap-x-4 gap-y-1.5">
          {candidates.map((member) => (
            <label key={member.id} className="flex items-center gap-1.5 text-sm">
              <input
                type="checkbox"
                checked={chosen.has(member.id)}
                disabled={!isOwner || save.isPending}
                onChange={() => toggle(member.id)}
              />
              {member.name}
            </label>
          ))}
        </div>
      )}
      {save.isError && <ErrorNotice message={t(errorMessageKey(save.error))} />}
      {isOwner && candidates.length > 0 && (
        <div className="flex items-center gap-3">
          <button
            type="button"
            disabled={!dirty || save.isPending}
            onClick={() => save.mutate([...chosen])}
            className="rounded-md bg-brand-500 px-3 py-1.5 text-sm font-medium text-white transition-colors hover:bg-brand-600 disabled:opacity-50"
          >
            {t('settings.aiUsage.recipientsSave')}
          </button>
          {save.isSuccess && !dirty && (
            <span role="status" className="text-2xs text-content-secondary">
              {t('settings.aiUsage.recipientsSaved')}
            </span>
          )}
        </div>
      )}
    </fieldset>
  );
}
