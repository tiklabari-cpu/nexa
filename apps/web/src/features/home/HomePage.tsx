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
import { useApiClient } from '../../lib/auth-store.js';
import { ApiClientError } from '../../lib/api-client.js';
import { formatCount, formatRate } from '../../lib/format.js';
import {
  ACTIVATION_COPY,
  activationSummary,
  countDelta,
  liveCards,
  scoreDelta,
  type DeltaDirection,
} from './dashboard.js';

export function HomePage(): ReactElement {
  const api = useApiClient();
  const query = useQuery({
    queryKey: ['home'],
    queryFn: () => api.get<HomeDashboard>('/home'),
  });

  return (
    <Page title="Home" description="Your workspace at a glance">
      {query.isPending ? (
        <KpiGrid>
          <CardSkeleton />
          <CardSkeleton />
          <CardSkeleton />
        </KpiGrid>
      ) : query.isError ? (
        query.error instanceof ApiClientError && query.error.status === 403 ? (
          <EmptyState
            title="Dashboard not available"
            description="The Home dashboard is available to admins and owners. Head to your inbox to start working."
            action={
              <NavLink
                to="/app/inbox"
                className="rounded-md bg-brand-500 px-3 py-1.5 text-sm font-medium text-white transition-colors hover:bg-brand-600"
              >
                Go to inbox
              </NavLink>
            }
          />
        ) : (
          <ErrorNotice message="The dashboard could not be loaded. Please try again." />
        )
      ) : (
        <>
          <ActivationChecklist activation={query.data.activation} />
          <LiveNow live={query.data.live} />
          <WeeklyPerformance weekly={query.data.weekly} />
        </>
      )}
    </Page>
  );
}

// ---------------------------------------------------------------------------
// Activation checklist
// ---------------------------------------------------------------------------

function ActivationChecklist({
  activation,
}: {
  activation: HomeDashboard['activation'];
}): ReactElement {
  const summary = activationSummary(activation);

  return (
    <Section
      title="Get started"
      description={
        summary.allDone
          ? 'Your workspace is fully set up.'
          : `${summary.completed} of ${summary.total} steps complete`
      }
    >
      <Card>
        <div className="border-b border-border p-4">
          <div
            role="progressbar"
            aria-valuenow={summary.completed}
            aria-valuemin={0}
            aria-valuemax={summary.total}
            aria-label="Activation progress"
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
            const copy = ACTIVATION_COPY[step.key];
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
                    {copy.label}
                    <span className="sr-only">{step.done ? ' (done)' : ' (to do)'}</span>
                  </p>
                  {!step.done && (
                    <p className="text-xs text-content-secondary">{copy.description}</p>
                  )}
                </div>
                {!step.done && (
                  <NavLink
                    to={copy.to}
                    className="shrink-0 text-xs font-medium text-brand-600 hover:underline"
                  >
                    Set up
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
// Live counters
// ---------------------------------------------------------------------------

function LiveNow({ live }: { live: HomeDashboard['live'] }): ReactElement {
  return (
    <Section title="Right now" description="Live activity across your workspace">
      <KpiGrid>
        {liveCards(live).map((card) => (
          <Kpi
            key={card.key}
            label={card.label}
            value={formatCount(card.value)}
            hint={card.hint}
          />
        ))}
      </KpiGrid>
    </Section>
  );
}

// ---------------------------------------------------------------------------
// Weekly performance
// ---------------------------------------------------------------------------

function WeeklyPerformance({ weekly }: { weekly: HomeDashboard['weekly'] }): ReactElement {
  const chats = countDelta(weekly.chats, weekly.previous.chats);
  const resolved = countDelta(weekly.resolved, weekly.previous.resolved);
  const csat = scoreDelta(weekly.satisfaction.score, weekly.previous.satisfaction_score);

  return (
    <Section title="This week" description="The last 7 days, compared with the 7 before">
      <KpiGrid>
        <Kpi
          label="New chats"
          value={formatCount(weekly.chats)}
          delta={<DeltaNote direction={chats.direction} text={`${formatCount(Math.abs(chats.change))} vs last week`} />}
        />
        <Kpi
          label="Resolved"
          value={formatCount(weekly.resolved)}
          delta={<DeltaNote direction={resolved.direction} text={`${formatCount(Math.abs(resolved.change))} vs last week`} />}
        />
        <Kpi
          label="Satisfaction"
          value={formatRate(weekly.satisfaction.score)}
          hint={`${formatCount(weekly.satisfaction.responses)} rated`}
          delta={
            csat ? (
              <DeltaNote
                direction={csat.direction}
                text={`${Math.abs(csat.points)} pts vs last week`}
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
function DeltaNote({ direction, text }: { direction: DeltaDirection; text: ReactNode }): ReactElement {
  if (direction === 'flat') {
    return <span className="text-2xs text-content-tertiary">No change vs last week</span>;
  }
  return (
    <span className="text-2xs text-content-tertiary" title="Compared with the previous week">
      {direction === 'up' ? '↑' : '↓'} {text}
    </span>
  );
}
