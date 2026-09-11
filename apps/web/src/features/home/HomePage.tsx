/**
 * Home — the workspace landing dashboard (FR-MOD-13.1).
 *
 * Three sections from one read (`GET /home`): an activation checklist derived
 * from real setup state, the live real-time counters, and a week-over-week
 * performance summary. Every figure comes from the server already computed; this
 * screen only lays them out, so it can never quote a number the API did not.
 *
 * Report-flavoured data, so the endpoint is `reports_read`-gated like Reports.
 * A teammate without that scope gets an honest "not for you" panel rather than a
 * raw error — the dashboard summarises the reports they cannot open either.
 */
import { useQuery } from '@tanstack/react-query';
import type { ReactElement, ReactNode } from 'react';
import { NavLink } from 'react-router-dom';
import type { HomeDashboard } from '@nexa/types';
import {
  Card,
  CardSkeleton,
  ErrorNotice,
  Kpi,
  KpiGrid,
  Page,
  Section,
} from '../../components/Page.js';
import { EmptyState } from '../../components/EmptyState.js';
import { useApiClient, useAuth } from '../../lib/auth-store.js';
import { ApiClientError } from '../../lib/api-client.js';
import { formatCount, formatDuration, formatRate } from '../../lib/format.js';
import { useTranslate, type TFunction } from '../../lib/i18n.js';
import {
  ACTIVATION_STEP_ROUTE,
  activationSummary,
  countDelta,
  liveCards,
  numberDelta,
  scoreDelta,
  type DeltaDirection,
} from './dashboard.js';

export function HomePage(): ReactElement {
  const t = useTranslate();
  const api = useApiClient();
  const agentName = useAuth((s) => s.agent?.name);
  const query = useQuery({
    queryKey: ['home'],
    queryFn: () => api.get<HomeDashboard>('/home'),
  });

  return (
    <Page title={t('home.page.title')} description={t('home.page.description')}>
      <Welcome name={agentName ?? null} t={t} />
      {query.isPending ? (
        <KpiGrid>
          <CardSkeleton />
          <CardSkeleton />
          <CardSkeleton />
        </KpiGrid>
      ) : query.isError ? (
        query.error instanceof ApiClientError && query.error.status === 403 ? (
          <EmptyState
            title={t('home.page.notAvailable.title')}
            description={t('home.page.notAvailable.description')}
            action={
              <NavLink
                to="/app/inbox"
                className="rounded-md bg-brand-500 px-3 py-1.5 text-sm font-medium text-white transition-colors hover:bg-brand-600"
              >
                {t('home.page.goToInbox')}
              </NavLink>
            }
          />
        ) : (
          <ErrorNotice message={t('home.page.loadError')} />
        )
      ) : (
        <>
          <ActivationChecklist activation={query.data.activation} t={t} />
          <PerformanceOverview performance={query.data.performance} t={t} />
          <LiveNow live={query.data.live} t={t} />
          <WeeklyPerformance weekly={query.data.weekly} t={t} />
        </>
      )}
    </Page>
  );
}

// ---------------------------------------------------------------------------
// Personalized welcome
// ---------------------------------------------------------------------------

/**
 * The welcome line (FR-MOD-13.1's "kişiselleştirilmiş karşılama"). Deliberately
 * in the body, not the page `title`/`description` above — those sit in the
 * fixed top bar every module shares (Reports, Team, Billing…), and changing
 * that shared header's shape for one screen was not worth it when the body
 * already scrolls into view first. The name never reaches `document.title`
 * either way (that is owned by the unread-count badge, `useNotifications.ts`),
 * so this choice is about layout, not about keeping data out of browser
 * history.
 *
 * Renders a name-free fallback rather than nothing when the session has none
 * (a brand-new account, or a name left blank) — a missing personalization is
 * not a reason to show no greeting at all.
 */
function Welcome({ name, t }: { name: string | null; t: TFunction }): ReactElement {
  const trimmed = name?.trim();
  return (
    <p className="text-sm font-medium text-content">
      {trimmed ? t('home.welcome.greeting', { name: trimmed }) : t('home.welcome.greetingFallback')}
    </p>
  );
}

// ---------------------------------------------------------------------------
// Activation checklist
// ---------------------------------------------------------------------------

function ActivationChecklist({
  activation,
  t,
}: {
  activation: HomeDashboard['activation'];
  t: TFunction;
}): ReactElement {
  const summary = activationSummary(activation);

  return (
    <Section
      title={t('home.activation.title')}
      description={
        summary.allDone
          ? t('home.activation.allDone')
          : t('home.activation.progress', { completed: summary.completed, total: summary.total })
      }
    >
      <Card>
        <div className="border-b border-border p-4">
          <div
            role="progressbar"
            aria-valuenow={summary.completed}
            aria-valuemin={0}
            aria-valuemax={summary.total}
            aria-label={t('home.activation.progressAriaLabel')}
            className="h-2 overflow-hidden rounded-full bg-canvas"
          >
            <div
              className="h-full rounded-full bg-brand-500 transition-[width]"
              style={{ width: `${Math.round(summary.ratio * 100)}%` }}
            />
          </div>
        </div>
        <ul className="divide-y divide-border">
          {activation.steps.map((step) => {
            const label = t(`home.activation.${step.key}.label`);
            const description = t(`home.activation.${step.key}.description`);
            const to = ACTIVATION_STEP_ROUTE[step.key];
            return (
              <li key={step.key} className="flex items-center gap-3 p-4">
                <span
                  aria-hidden="true"
                  className={`flex size-6 shrink-0 items-center justify-center rounded-full text-xs ${
                    step.done
                      ? 'bg-success/10 text-success'
                      : 'border border-border text-content-tertiary'
                  }`}
                >
                  {step.done ? '✓' : ''}
                </span>
                <div className="min-w-0 flex-1">
                  <p
                    className={`text-sm font-medium ${
                      step.done ? 'text-content-secondary line-through' : 'text-content'
                    }`}
                  >
                    {label}
                    <span className="sr-only">
                      {step.done
                        ? t('home.activation.doneSuffix')
                        : t('home.activation.todoSuffix')}
                    </span>
                  </p>
                  {!step.done && <p className="text-xs text-content-secondary">{description}</p>}
                </div>
                {!step.done && (
                  <NavLink
                    to={to}
                    className="shrink-0 text-xs font-medium text-content-brand hover:underline"
                  >
                    {t('home.activation.setUp')}
                  </NavLink>
                )}
              </li>
            );
          })}
        </ul>
      </Card>
    </Section>
  );
}

// ---------------------------------------------------------------------------
// Performance overview
// ---------------------------------------------------------------------------

/**
 * The Performance overview quartet (FR-MOD-13.1): Total chats, Satisfaction,
 * Response time and Efficiency — every figure read off the same
 * `GET /reports/overview` computation the Reports tab uses (`home-service.ts`),
 * never a client-side second source. Efficiency shows no week-over-week delta;
 * see the field's own doc comment in `@nexa/types` for why.
 */
function PerformanceOverview({
  performance,
  t,
}: {
  performance: HomeDashboard['performance'];
  t: TFunction;
}): ReactElement {
  const chats = countDelta(performance.total_chats, performance.previous.total_chats);
  const satisfaction = scoreDelta(
    performance.satisfaction_score,
    performance.previous.satisfaction_score,
  );
  const responseTime = numberDelta(
    performance.response_time_seconds,
    performance.previous.response_time_seconds,
  );

  return (
    <Section title={t('home.performance.title')} description={t('home.performance.description')}>
      <KpiGrid>
        <Kpi
          label={t('home.performance.totalChats')}
          value={formatCount(performance.total_chats)}
          delta={
            <DeltaNote
              direction={chats.direction}
              text={t('home.weekly.vsLastWeek', {
                count: formatCount(Math.abs(chats.change)) ?? 0,
              })}
              t={t}
            />
          }
        />
        <Kpi
          label={t('home.performance.satisfaction')}
          value={formatRate(performance.satisfaction_score)}
          delta={
            satisfaction ? (
              <DeltaNote
                direction={satisfaction.direction}
                text={t('home.weekly.ptsVsLastWeek', { points: Math.abs(satisfaction.points) })}
                t={t}
              />
            ) : undefined
          }
        />
        <Kpi
          label={t('home.performance.responseTime')}
          value={formatDuration(performance.response_time_seconds)}
          delta={
            responseTime ? (
              <DeltaNote
                direction={responseTime.direction}
                text={t('home.performance.secondsVsLastWeek', {
                  seconds: Math.abs(responseTime.change),
                })}
                t={t}
              />
            ) : undefined
          }
        />
        <Kpi
          label={t('home.performance.efficiency')}
          value={formatCount(performance.efficiency_chats_per_agent_hour)}
          hint={t('home.performance.efficiencyHint')}
        />
      </KpiGrid>
    </Section>
  );
}

// ---------------------------------------------------------------------------
// Live counters
// ---------------------------------------------------------------------------

function LiveNow({ live, t }: { live: HomeDashboard['live']; t: TFunction }): ReactElement {
  return (
    <Section title={t('home.live.title')} description={t('home.live.description')}>
      <KpiGrid>
        {liveCards(live).map((card) => (
          <Kpi
            key={card.key}
            label={t(`home.live.${card.key}.label`)}
            value={formatCount(card.value)}
            hint={t(`home.live.${card.key}.hint`)}
          />
        ))}
      </KpiGrid>
    </Section>
  );
}

// ---------------------------------------------------------------------------
// Weekly performance
// ---------------------------------------------------------------------------

function WeeklyPerformance({
  weekly,
  t,
}: {
  weekly: HomeDashboard['weekly'];
  t: TFunction;
}): ReactElement {
  const chats = countDelta(weekly.chats, weekly.previous.chats);
  const resolved = countDelta(weekly.resolved, weekly.previous.resolved);
  const csat = scoreDelta(weekly.satisfaction.score, weekly.previous.satisfaction_score);

  return (
    <Section title={t('home.weekly.title')} description={t('home.weekly.description')}>
      <KpiGrid>
        <Kpi
          label={t('home.weekly.newChats')}
          value={formatCount(weekly.chats)}
          delta={
            <DeltaNote
              direction={chats.direction}
              text={t('home.weekly.vsLastWeek', {
                count: formatCount(Math.abs(chats.change)) ?? 0,
              })}
              t={t}
            />
          }
        />
        <Kpi
          label={t('home.weekly.resolved')}
          value={formatCount(weekly.resolved)}
          delta={
            <DeltaNote
              direction={resolved.direction}
              text={t('home.weekly.vsLastWeek', {
                count: formatCount(Math.abs(resolved.change)) ?? 0,
              })}
              t={t}
            />
          }
        />
        <Kpi
          label={t('home.weekly.satisfaction')}
          value={formatRate(weekly.satisfaction.score)}
          hint={t('home.weekly.ratedCount', {
            count: formatCount(weekly.satisfaction.responses) ?? 0,
          })}
          delta={
            csat ? (
              <DeltaNote
                direction={csat.direction}
                text={t('home.weekly.ptsVsLastWeek', { points: Math.abs(csat.points) })}
                t={t}
              />
            ) : undefined
          }
        />
      </KpiGrid>
    </Section>
  );
}

/**
 * A neutral week-over-week annotation — an arrow and the magnitude, no colour.
 * Up is good for chats and satisfaction but the card stays uncoloured on purpose
 * (design mirrors Reports' Delta): the baseline is on the card, this only marks
 * the movement, and a red/green verdict would mislead where "more" is not
 * always "better".
 */
function DeltaNote({
  direction,
  text,
  t,
}: {
  direction: DeltaDirection;
  text: ReactNode;
  t: TFunction;
}): ReactElement {
  if (direction === 'flat') {
    return <span className="text-2xs text-content-tertiary">{t('home.weekly.noChange')}</span>;
  }
  return (
    <span className="text-2xs text-content-tertiary" title={t('home.weekly.comparedHint')}>
      {direction === 'up' ? '↑' : '↓'} {text}
    </span>
  );
}
