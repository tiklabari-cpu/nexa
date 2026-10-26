/**
 * The operator's landing screen (tm 389.8 · FR-ADMIN-07): key figures, the sign-up timeline,
 * and — in `HealthSection` — what the tenant API says about itself.
 *
 * Counts and states only; a workspace is never named here (requirements §2), the card links to
 * the list. The three reads are independent queries, so each section loads, fails and retries
 * on its own — a health read that times out must not blank the figures an operator opened the
 * page for.
 */
import type { ReactElement, ReactNode } from 'react';
import { SUBSCRIPTION_STATUSES } from '@siyahtus/types';
import { Link } from 'react-router-dom';
import { LoadError } from '../../components/LoadError.js';
import { Card, Page } from '../../components/Page.js';
import { useTranslate, type TFunction } from '../../lib/i18n.js';
import { formatCount } from '../../lib/format.js';
import type { PlatformDashboardKpis, PlatformDashboardSignups } from '../../lib/platform-types.js';
import { HealthSection } from './HealthSection.js';
import { useKpis, useSignups } from './queries.js';

export function DashboardPage(): ReactElement {
  const t = useTranslate();
  return (
    <Page title={t('nav.dashboard')} description={t('shell.pages.dashboard.description')}>
      <KpiSection />
      <SignupSection />
      <HealthSection />
    </Page>
  );
}

function SectionHeading({ id, children }: { id: string; children: string }): ReactElement {
  return (
    <h2 id={id} className="mb-3 text-sm font-semibold">
      {children}
    </h2>
  );
}

function Figure({
  label,
  value,
  detail,
  children,
}: {
  label: string;
  value: string;
  detail?: string | undefined;
  children?: ReactNode;
}): ReactElement {
  return (
    <Card className="p-4">
      <dt className="text-xs text-content-secondary">{label}</dt>
      <dd className="mt-1 text-2xl font-semibold tabular-nums">{value}</dd>
      {detail && <dd className="mt-1 text-xs text-content-secondary">{detail}</dd>}
      {children}
    </Card>
  );
}

function KpiSection(): ReactElement {
  const t = useTranslate();
  const query = useKpis();

  return (
    <section aria-labelledby="dashboard-kpis">
      <SectionHeading id="dashboard-kpis">{t('dashboard.kpis.heading')}</SectionHeading>
      {query.isError ? (
        <Card>
          <LoadError
            title={t('dashboard.loadError.title')}
            error={query.error}
            onRetry={() => void query.refetch()}
          />
        </Card>
      ) : query.data ? (
        <KpiCards kpis={query.data} t={t} />
      ) : (
        <p role="status" className="text-sm text-content-secondary">
          {t('auth.startup.loading')}
        </p>
      )}
    </section>
  );
}

function KpiCards({ kpis, t }: { kpis: PlatformDashboardKpis; t: TFunction }): ReactElement {
  const count = (value: number) => formatCount(value) ?? String(value);
  return (
    <dl className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-4">
      <Figure label={t('dashboard.kpis.workspaces.label')} value={count(kpis.workspaces.total)}>
        <>
          <dd>
            <ul className="mt-2 grid grid-cols-2 gap-x-3 gap-y-0.5 text-xs text-content-secondary">
              {SUBSCRIPTION_STATUSES.map((status) => (
                <li key={status} className="flex justify-between gap-2">
                  <span>{t(`dashboard.kpis.status.${status}`)}</span>
                  <span className="tabular-nums text-content">
                    {count(kpis.workspaces.by_status[status])}
                  </span>
                </li>
              ))}
            </ul>
          </dd>
          <dd className="mt-2 text-xs">
            <Link to="/workspaces" className="text-content-brand underline">
              {t('dashboard.kpis.workspaces.link')}
            </Link>
          </dd>
        </>
      </Figure>
      <Figure label={t('dashboard.kpis.trialsEnding.label')} value={count(kpis.trials_ending_7d)} />
      <Figure
        label={t('dashboard.kpis.sessions.label')}
        value={count(kpis.active_operator_sessions)}
      />
      <Figure
        label={t('dashboard.kpis.payments.label')}
        value={count(kpis.pending_payment_requests)}
      />
      <Figure
        label={t('dashboard.kpis.aiTokens.label')}
        value={count(kpis.usage.ai_tokens_today.llm)}
        detail={t('dashboard.kpis.aiTokens.detail', {
          embedding: count(kpis.usage.ai_tokens_today.embedding),
        })}
      />
      <Figure
        label={t('dashboard.kpis.aiResolutions.label')}
        value={count(kpis.usage.ai_resolutions_month)}
      />
      <Figure
        label={t('dashboard.kpis.apiCalls.label')}
        value={count(kpis.usage.api_calls_month)}
      />
    </dl>
  );
}

function SignupSection(): ReactElement {
  const t = useTranslate();
  const query = useSignups();

  return (
    <section aria-labelledby="dashboard-signups">
      <SectionHeading id="dashboard-signups">{t('dashboard.signups.heading')}</SectionHeading>
      <Card className="p-4">
        {query.isError ? (
          <LoadError
            title={t('dashboard.loadError.title')}
            error={query.error}
            onRetry={() => void query.refetch()}
            compact
          />
        ) : query.data ? (
          <SignupChart series={query.data} t={t} />
        ) : (
          <p role="status" className="text-sm text-content-secondary">
            {t('auth.startup.loading')}
          </p>
        )}
      </Card>
    </section>
  );
}

function SignupChart({
  series,
  t,
}: {
  series: PlatformDashboardSignups;
  t: TFunction;
}): ReactElement {
  const first = series.data[0];
  const last = series.data[series.data.length - 1];
  const peak = Math.max(1, ...series.data.map((point) => point.count));

  return (
    <div>
      <p className="text-sm">
        {t('dashboard.signups.summary', {
          count: formatCount(series.total) ?? series.total,
          days: series.days,
        })}
      </p>
      {series.total === 0 && (
        <p className="mt-1 text-xs text-content-secondary">{t('dashboard.signups.empty')}</p>
      )}
      <div
        role="img"
        aria-label={t('dashboard.signups.chart', { days: series.days })}
        className="mt-3 flex h-24 items-end gap-0.5"
      >
        {series.data.map((point) => (
          <div
            key={point.date}
            title={t('dashboard.signups.bar', { date: point.date, count: point.count })}
            className={point.count > 0 ? 'flex-1 rounded-t-sm bg-brand-500' : 'flex-1 bg-border'}
            style={{
              height: point.count > 0 ? `${Math.max(6, (point.count / peak) * 100)}%` : '2px',
            }}
          />
        ))}
      </div>
      {first && last && (
        <p className="mt-1 text-2xs text-content-tertiary">
          {t('dashboard.signups.range', { from: first.date, to: last.date })}
        </p>
      )}
    </div>
  );
}
