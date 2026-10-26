/**
 * Platform health on the dashboard (tm 389.8 · FR-ADMIN-07): the tenant API's published
 * snapshot, how old it is, and the component record.
 *
 * Three honest states for the snapshot. Fresh: the figures. Stale (older than the 90 s the
 * leader's key lives): the figures under a yellow notice, because "last known" is still more
 * use than nothing. Absent: a red notice and no figures — nothing is publishing, which is
 * itself the finding. The component grid shows `not_installed` as a quiet badge, not an alarm:
 * a module this deployment does not run is not a fault.
 */
import type { ReactElement } from 'react';
import { LoadError } from '../../components/LoadError.js';
import { Card } from '../../components/Page.js';
import { Banner, cn } from '../../components/ui/index.js';
import { formatCount, formatDateTime, formatDuration } from '../../lib/format.js';
import { useTranslate, type TFunction } from '../../lib/i18n.js';
import type {
  PlatformComponentStatus,
  PlatformDashboardHealth,
  PlatformHealthSnapshot,
} from '../../lib/platform-types.js';
import { useHealth } from './queries.js';

export type BadgeState = PlatformComponentStatus['state'];

const BADGE: Record<BadgeState, { glyph: string; style: string }> = {
  ok: { glyph: '●', style: 'bg-success/10 text-success' },
  degraded: { glyph: '▲', style: 'bg-warning/10 text-warning' },
  down: { glyph: '✕', style: 'bg-danger/10 text-danger' },
  not_installed: { glyph: '–', style: 'bg-inset text-content-secondary' },
  unknown: { glyph: '?', style: 'bg-inset text-content-secondary' },
};

export function StateBadge({ state, label }: { state: BadgeState; label: string }): ReactElement {
  const { glyph, style } = BADGE[state];
  return (
    <span
      className={cn(
        'inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-xs font-medium',
        style,
      )}
    >
      <span aria-hidden="true">{glyph}</span>
      {label}
    </span>
  );
}

export function HealthSection(): ReactElement {
  const t = useTranslate();
  const query = useHealth();

  return (
    <section aria-labelledby="dashboard-health" className="flex flex-col gap-6">
      <div>
        <h2 id="dashboard-health" className="mb-3 text-sm font-semibold">
          {t('dashboard.health.heading')}
        </h2>
        {query.isError ? (
          <Card>
            <LoadError
              title={t('dashboard.loadError.title')}
              error={query.error}
              onRetry={() => void query.refetch()}
            />
          </Card>
        ) : query.data ? (
          <SnapshotView health={query.data} t={t} />
        ) : (
          <p role="status" className="text-sm text-content-secondary">
            {t('auth.startup.loading')}
          </p>
        )}
      </div>
      {query.data && <ComponentGrid components={query.data.components} t={t} />}
    </section>
  );
}

function SnapshotView({
  health,
  t,
}: {
  health: PlatformDashboardHealth;
  t: TFunction;
}): ReactElement {
  const snapshot = health.snapshot;
  return (
    <div className="flex flex-col gap-4">
      {snapshot === null && (
        <Banner tone="danger" title={t('dashboard.health.notReporting.title')}>
          {t('dashboard.health.notReporting.body')}
        </Banner>
      )}
      {snapshot !== null && health.stale && (
        <Banner tone="warning" title={t('dashboard.health.stale.title')}>
          {t('dashboard.health.stale.body', { age: Math.round(health.age_s ?? 0) })}
        </Banner>
      )}
      {snapshot !== null && (
        <>
          <SnapshotGrid snapshot={snapshot} t={t} />
          <p className="text-xs text-content-secondary">
            {t('dashboard.health.updated', {
              time: formatDateTime(health.generated_at) ?? '–',
            })}
          </p>
        </>
      )}
    </div>
  );
}

export function Tile({
  label,
  badge,
  lines,
}: {
  label: string;
  badge: ReactElement;
  lines: Array<string | null>;
}): ReactElement {
  return (
    <Card className="p-4">
      <div className="flex items-start justify-between gap-2">
        <h3 className="text-xs text-content-secondary">{label}</h3>
        {badge}
      </div>
      {lines.map(
        (line) =>
          line && (
            <p key={line} className="mt-1 text-xs text-content-secondary">
              {line}
            </p>
          ),
      )}
    </Card>
  );
}

function SnapshotGrid({
  snapshot,
  t,
}: {
  snapshot: PlatformHealthSnapshot;
  t: TFunction;
}): ReactElement {
  const dependency = (key: 'database' | 'redis') => {
    const dep = snapshot.dependencies[key];
    return (
      <Tile
        label={t(`dashboard.health.${key}.label`)}
        badge={
          <StateBadge
            state={dep.status === 'up' ? 'ok' : 'down'}
            label={t(`dashboard.health.dependency.${dep.status}`)}
          />
        }
        lines={[
          dep.latency_ms === undefined
            ? null
            : t('dashboard.health.dependency.latency', { ms: dep.latency_ms }),
        ]}
      />
    );
  };

  const jobs = snapshot.scheduler.jobs.filter((job) => job.enabled);
  const failing = jobs.filter((job) => job.last_status === 'error').map((job) => job.name);
  const clean = jobs.filter((job) => job.last_status === 'ok').length;
  const aiJobs = snapshot.ai_jobs;

  return (
    <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-4">
      <Tile
        label={t('dashboard.health.overall.label')}
        badge={
          <StateBadge
            state={snapshot.status === 'ok' ? 'ok' : 'degraded'}
            label={t(`dashboard.health.overall.${snapshot.status}`)}
          />
        }
        lines={[
          t('dashboard.health.build', { version: snapshot.version, region: snapshot.region }),
          t('dashboard.health.uptime', {
            duration: formatDuration(snapshot.uptime_s) ?? '–',
          }),
        ]}
      />
      {dependency('database')}
      {dependency('redis')}
      <Tile
        label={t('dashboard.health.scheduler.label')}
        badge={
          snapshot.scheduler.enabled ? (
            <StateBadge
              state={failing.length > 0 ? 'degraded' : 'ok'}
              label={t(
                failing.length > 0
                  ? 'dashboard.components.state.degraded'
                  : 'dashboard.components.state.ok',
              )}
            />
          ) : (
            <StateBadge
              state="not_installed"
              label={t('dashboard.components.state.not_installed')}
            />
          )
        }
        lines={
          snapshot.scheduler.enabled
            ? [
                t('dashboard.health.scheduler.jobs', { ok: clean, total: jobs.length }),
                failing.length > 0
                  ? t('dashboard.health.scheduler.failing', { names: failing.join(', ') })
                  : null,
              ]
            : [t('dashboard.health.scheduler.off')]
        }
      />
      <Tile
        label={t('dashboard.health.aiJobs.label')}
        badge={
          aiJobs === null ? (
            <StateBadge state="unknown" label={t('dashboard.components.state.unknown')} />
          ) : (
            <StateBadge state="ok" label={t('dashboard.components.state.ok')} />
          )
        }
        lines={
          aiJobs === null
            ? [t('dashboard.health.aiJobs.unknown')]
            : [
                t('dashboard.health.aiJobs.value', {
                  pending: formatCount(aiJobs.pending) ?? aiJobs.pending,
                  running: formatCount(aiJobs.running) ?? aiJobs.running,
                }),
                aiJobs.oldest_age_s === null
                  ? null
                  : t('dashboard.health.aiJobs.oldest', { seconds: aiJobs.oldest_age_s }),
              ]
        }
      />
    </div>
  );
}

function ComponentGrid({
  components,
  t,
}: {
  components: PlatformComponentStatus[];
  t: TFunction;
}): ReactElement {
  return (
    <div>
      <h2 id="dashboard-components" className="mb-3 text-sm font-semibold">
        {t('dashboard.components.heading')}
      </h2>
      <ul
        aria-labelledby="dashboard-components"
        className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-4"
      >
        {components.map((component) => (
          <li key={component.key}>
            <Tile
              label={t(`dashboard.components.name.${component.key}`)}
              badge={
                <StateBadge
                  state={component.state}
                  label={t(`dashboard.components.state.${component.state}`)}
                />
              }
              lines={[
                component.detail,
                component.updated_at
                  ? t('dashboard.components.updated', {
                      time: formatDateTime(component.updated_at) ?? '–',
                    })
                  : t('dashboard.components.neverReported'),
              ]}
            />
          </li>
        ))}
      </ul>
    </div>
  );
}
