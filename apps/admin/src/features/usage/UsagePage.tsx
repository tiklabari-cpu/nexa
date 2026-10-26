/**
 * Usage across the deployment (tm 389.12 · FR-ADMIN-13): the deployment's daily AI tokens for
 * the last 30 days against its cap, the open period's resolutions and API calls, the heaviest
 * workspaces on one meter, and each plan's default daily AI allowance.
 *
 * Numbers and names only. A workspace row opens its own usage page (`/usage/:licenseId`), where
 * its override is set. The plan defaults are `usage.manage` (billing and superadmin); a role
 * without it reads them.
 */
import { useState, type ReactElement, type ReactNode } from 'react';
import { Link } from 'react-router-dom';
import { LoadError } from '../../components/LoadError.js';
import { Card, Page } from '../../components/Page.js';
import { ReasonDialog } from '../../components/ReasonDialog.js';
import { Banner } from '../../components/ui/Banner.js';
import { hasPermission, useAuth } from '../../lib/auth-store.js';
import { formatCount, formatDay, formatPeriod } from '../../lib/format.js';
import { useTranslate, type TFunction } from '../../lib/i18n.js';
import type { PlatformGlobalUsage, PlatformUsageTopMeter } from '../../lib/platform-types.js';
import {
  Cell,
  DataTable,
  EmptyLine,
  FIELD_CLASS,
  LINK_CLASS,
  Loading,
  SECONDARY_BUTTON_CLASS,
} from '../workspaces/ui.js';
import { TOP_METERS, useGlobalUsage, usePlanCaps, usePutPlanCaps, useTopUsage } from './queries.js';

export function UsagePage(): ReactElement {
  const t = useTranslate();
  return (
    <Page title={t('nav.usage')} description={t('shell.pages.usage.description')}>
      <GlobalSection />
      <TopSection />
      <PlanCapsSection />
    </Page>
  );
}

export function UsageSectionCard({
  id,
  title,
  children,
}: {
  id: string;
  title: string;
  children: ReactNode;
}): ReactElement {
  return (
    <section aria-labelledby={id}>
      <h2 id={id} className="mb-3 text-sm font-semibold">
        {title}
      </h2>
      <Card>{children}</Card>
    </section>
  );
}

const count = (value: number) => formatCount(value) ?? String(value);

export function TokenChart({
  series,
  label,
  t,
}: {
  series: PlatformGlobalUsage['series'];
  label: string;
  t: TFunction;
}): ReactElement {
  const peak = Math.max(1, ...series.map((point) => point.llm));
  const first = series[0];
  const last = series[series.length - 1];
  return (
    <div className="p-4">
      <div role="img" aria-label={label} className="flex h-24 items-end gap-0.5">
        {series.map((point) => (
          <div
            key={point.date}
            title={t('usage.chart.bar', {
              date: formatDay(point.date) ?? point.date,
              count: count(point.llm),
            })}
            className={point.llm > 0 ? 'flex-1 rounded-t-sm bg-brand-500' : 'flex-1 bg-border'}
            style={{ height: point.llm > 0 ? `${Math.max(6, (point.llm / peak) * 100)}%` : '2px' }}
          />
        ))}
      </div>
      {first && last && (
        <p className="mt-1 text-2xs text-content-tertiary">
          {t('usage.chart.range', {
            from: formatDay(first.date) ?? first.date,
            to: formatDay(last.date) ?? last.date,
          })}
        </p>
      )}
    </div>
  );
}

function GlobalSection(): ReactElement {
  const t = useTranslate();
  const query = useGlobalUsage();
  return (
    <UsageSectionCard id="usage-global" title={t('usage.global.title')}>
      {query.isPending ? (
        <Loading label={t('usage.loading')} />
      ) : query.isError ? (
        <LoadError
          title={t('usage.global.failed')}
          error={query.error}
          onRetry={() => void query.refetch()}
        />
      ) : (
        <>
          <dl className="grid grid-cols-1 gap-3 p-4 text-sm sm:grid-cols-2 lg:grid-cols-4">
            {(['llm', 'embedding'] as const).map((meter) => (
              <div key={meter}>
                <dt className="text-xs text-content-secondary">{t(`usage.today.${meter}`)}</dt>
                <dd className="mt-0.5 tabular-nums">
                  {t('usage.ofCap', {
                    used: count(query.data.today[meter].used),
                    cap: count(query.data.today[meter].cap),
                  })}
                </dd>
              </div>
            ))}
            <div>
              <dt className="text-xs text-content-secondary">
                {t('usage.period.resolutions', {
                  period: formatPeriod(query.data.period.period) ?? '',
                })}
              </dt>
              <dd className="mt-0.5 tabular-nums">{count(query.data.period.ai_resolutions)}</dd>
            </div>
            <div>
              <dt className="text-xs text-content-secondary">
                {t('usage.period.apiCalls', {
                  period: formatPeriod(query.data.period.period) ?? '',
                })}
              </dt>
              <dd className="mt-0.5 tabular-nums">{count(query.data.period.api_calls)}</dd>
            </div>
          </dl>
          <TokenChart
            series={query.data.series}
            label={t('usage.global.chart', { days: query.data.days })}
            t={t}
          />
        </>
      )}
    </UsageSectionCard>
  );
}

function TopSection(): ReactElement {
  const t = useTranslate();
  const [meter, setMeter] = useState<PlatformUsageTopMeter>('llm');
  const query = useTopUsage(meter);
  return (
    <UsageSectionCard id="usage-top" title={t('usage.top.title')}>
      <div className="border-b border-border p-4">
        <label htmlFor="usage-meter" className="text-xs text-content-secondary">
          {t('usage.top.meter')}
        </label>
        <select
          id="usage-meter"
          className={FIELD_CLASS}
          value={meter}
          onChange={(event) => setMeter(event.target.value as PlatformUsageTopMeter)}
        >
          {TOP_METERS.map((id) => (
            <option key={id} value={id}>
              {t(`usage.meter.${id}`)}
            </option>
          ))}
        </select>
      </div>
      {query.isPending ? (
        <Loading label={t('usage.loading')} />
      ) : query.isError ? (
        <LoadError
          title={t('usage.top.failed')}
          error={query.error}
          onRetry={() => void query.refetch()}
        />
      ) : query.data.data.length === 0 ? (
        <EmptyLine>{t('usage.top.empty')}</EmptyLine>
      ) : (
        <DataTable
          caption={t('usage.top.caption', { meter: t(`usage.meter.${meter}`) })}
          headers={[
            t('usage.workspace'),
            t('usage.plan'),
            t('usage.top.used'),
            t('usage.top.limit'),
            t('usage.top.percent'),
          ]}
        >
          {query.data.data.map((row) => (
            <tr key={row.license_id}>
              <Cell>
                <Link to={`/usage/${row.license_id}`} className={LINK_CLASS}>
                  {row.organization_name}
                </Link>
              </Cell>
              <Cell>{t(`billing.plan.${row.plan}`)}</Cell>
              <Cell>
                <span className="tabular-nums">{count(row.used)}</span>
              </Cell>
              <Cell>{row.limit === null ? null : count(row.limit)}</Cell>
              <Cell>
                {row.percent === null ? null : t('usage.percent', { value: row.percent })}
              </Cell>
            </tr>
          ))}
        </DataTable>
      )}
    </UsageSectionCard>
  );
}

/** A whole number of tokens typed into a box, null for an empty box, NaN for anything else. */
export function parseTokens(value: string): number | null {
  const trimmed = value.replace(/[\s.,_]/g, '');
  if (trimmed === '') return null;
  return /^\d{1,11}$/.test(trimmed) && Number(trimmed) >= 1 && Number(trimmed) <= 1e10
    ? Number(trimmed)
    : Number.NaN;
}

const text = (value: number | null) => (value === null ? '' : String(value));

function PlanCapsSection(): ReactElement {
  const t = useTranslate();
  const me = useAuth((s) => s.me);
  const canManage = hasPermission(me, 'usage.manage');
  const query = usePlanCaps();
  const [editing, setEditing] = useState(false);
  const [saved, setSaved] = useState(false);

  return (
    <UsageSectionCard id="usage-plan-caps" title={t('usage.plans.title')}>
      {saved && (
        <div className="p-4 pb-0">
          <Banner tone="success" role="status" dismissible onDismiss={() => setSaved(false)}>
            {t('usage.plans.saved')}
          </Banner>
        </div>
      )}
      {query.isPending ? (
        <Loading label={t('usage.loading')} />
      ) : query.isError ? (
        <LoadError
          title={t('usage.plans.failed')}
          error={query.error}
          onRetry={() => void query.refetch()}
        />
      ) : (
        <>
          <p className="px-4 pt-3 text-xs text-content-secondary">
            {t('usage.plans.hint', {
              llm: count(query.data.deployment.llm),
              embedding: count(query.data.deployment.embedding),
            })}
          </p>
          <DataTable
            caption={t('usage.plans.title')}
            headers={[t('usage.plan'), t('usage.meter.llm'), t('usage.meter.embedding')]}
          >
            {query.data.plans.map((row) => (
              <tr key={row.plan}>
                <Cell>{t(`billing.plan.${row.plan}`)}</Cell>
                {(['llm', 'embedding'] as const).map((meter) => (
                  <Cell key={meter}>
                    {row.set[meter] !== null
                      ? count(row.set[meter])
                      : row.catalogue[meter] !== null
                        ? t('usage.plans.catalogue', { value: count(row.catalogue[meter]) })
                        : t('usage.plans.deployment')}
                  </Cell>
                ))}
              </tr>
            ))}
          </DataTable>
          {canManage && (
            <div className="border-t border-border p-3">
              <button
                type="button"
                className={SECONDARY_BUTTON_CLASS}
                onClick={() => setEditing(true)}
              >
                {t('usage.plans.edit')}
              </button>
            </div>
          )}
          {editing && (
            <PlanCapsDialog
              plans={query.data.plans}
              onClose={() => setEditing(false)}
              onDone={() => {
                setEditing(false);
                setSaved(true);
              }}
            />
          )}
        </>
      )}
    </UsageSectionCard>
  );
}

function PlanCapsDialog({
  plans,
  onClose,
  onDone,
}: {
  plans: Array<{ plan: string; set: { llm: number | null; embedding: number | null } }>;
  onClose: () => void;
  onDone: () => void;
}): ReactElement {
  const t = useTranslate();
  const save = usePutPlanCaps();
  const initial = Object.fromEntries(
    plans.map((row) => [row.plan, { llm: text(row.set.llm), embedding: text(row.set.embedding) }]),
  );
  const [draft, setDraft] = useState<Record<string, { llm: string; embedding: string }>>(initial);
  const parsed = Object.fromEntries(
    Object.entries(draft).map(([plan, figures]) => [
      plan,
      { llm: parseTokens(figures.llm), embedding: parseTokens(figures.embedding) },
    ]),
  );
  const valid = Object.values(parsed).every(
    (figures) => !Number.isNaN(figures.llm) && !Number.isNaN(figures.embedding),
  );

  return (
    <ReasonDialog
      title={t('usage.plans.dialogTitle')}
      description={t('usage.plans.dialogBody')}
      confirmLabel={t('usage.plans.confirm')}
      confirmDisabled={!valid}
      extraDirty={JSON.stringify(draft) !== JSON.stringify(initial)}
      onCancel={onClose}
      onDone={onDone}
      onConfirm={({ reason }) => save.mutateAsync({ plans: parsed, reason })}
    >
      {plans.map((row) =>
        (['llm', 'embedding'] as const).map((meter) => {
          const id = `plan-cap-${row.plan}-${meter}`;
          return (
            <div key={id}>
              <label htmlFor={id} className="text-sm font-medium">
                {t('usage.plans.field', {
                  plan: t(`billing.plan.${row.plan}`),
                  meter: t(`usage.meter.${meter}`),
                })}
              </label>
              <input
                id={id}
                inputMode="numeric"
                className={FIELD_CLASS}
                value={draft[row.plan]?.[meter] ?? ''}
                placeholder={t('usage.plans.inherit')}
                onChange={(event) =>
                  setDraft({
                    ...draft,
                    [row.plan]: {
                      ...(draft[row.plan] ?? { llm: '', embedding: '' }),
                      [meter]: event.target.value,
                    },
                  })
                }
              />
            </div>
          );
        }),
      )}
    </ReasonDialog>
  );
}
