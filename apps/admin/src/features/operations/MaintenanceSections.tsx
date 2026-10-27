/**
 * The two Operations sections that change something besides running a job (tm 389.14 ·
 * FR-ADMIN-20): opening `events` partitions and purging expired unverified sign-ups.
 *
 * Both go through `ReasonDialog`. Opening a partition is harmless and idempotent (support may);
 * the purge deletes workspaces and asks a superadmin for a fresh authenticator code, and the
 * dialog names the age it will respect so the operator is not guessing what "expired" means.
 */
import { useState, type ReactElement } from 'react';
import { ReasonDialog } from '../../components/ReasonDialog.js';
import { Banner } from '../../components/ui/index.js';
import { hasPermission, useAuth } from '../../lib/auth-store.js';
import { formatCount, formatDuration } from '../../lib/format.js';
import { useTranslate } from '../../lib/i18n.js';
import type { PlatformOperationsEnsureResult } from '../../lib/platform-types.js';
import { Cell, DataTable, PRIMARY_BUTTON_CLASS, SECONDARY_BUTTON_CLASS } from '../workspaces/ui.js';
import { StateBadge } from '../dashboard/HealthSection.js';
import {
  useEnsurePartitions,
  usePartitions,
  usePurgeUnverified,
  useUnverifiedSignups,
} from './queries.js';
import { Figures, QuerySection, formatBytes } from './ui.js';

type Notice = { tone: 'success' | 'warning'; text: string };

export function PartitionsSection(): ReactElement {
  const t = useTranslate();
  const query = usePartitions();
  const me = useAuth((s) => s.me);
  const canOpen = hasPermission(me, 'operations.trigger');
  const ensure = useEnsurePartitions();
  const [open, setOpen] = useState(false);
  const [notice, setNotice] = useState<Notice | null>(null);

  function describe(result: PlatformOperationsEnsureResult): Notice {
    if (result.failed.length === 0) {
      return {
        tone: 'success',
        text: t('operations.partitions.result.ok', { count: result.ensured.length }),
      };
    }
    return {
      tone: 'warning',
      text: t('operations.partitions.result.partial', {
        failed: result.failed
          .map((row) =>
            t('operations.partitions.failed', { month: row.month, code: row.error_code }),
          )
          .join(', '),
      }),
    };
  }

  return (
    <QuerySection
      id="operations-partitions"
      title={t('operations.partitions.heading')}
      query={query}
      actions={
        canOpen && (
          <button type="button" className={SECONDARY_BUTTON_CLASS} onClick={() => setOpen(true)}>
            {t('operations.partitions.ensure')}
          </button>
        )
      }
    >
      {(data) => (
        <div className="flex flex-col gap-3">
          {notice && (
            <div className="p-4 pb-0">
              <Banner tone={notice.tone} dismissible>
                {notice.text}
              </Banner>
            </div>
          )}
          {data.missing_months.length > 0 && (
            <div className="p-4 pb-0">
              <Banner tone="warning" title={t('operations.partitions.missing.title')}>
                {t('operations.partitions.missing.body', {
                  months: data.missing_months.join(', '),
                })}
              </Banner>
            </div>
          )}
          {data.default_has_rows === true && (
            <div className="p-4 pb-0">
              <Banner tone="danger" title={t('operations.partitions.defaultRows.title')}>
                {t('operations.partitions.defaultRows.body')}
              </Banner>
            </div>
          )}
          {data.missing_months.length === 0 && (
            <p className="px-4 pt-4 text-sm text-content-secondary">
              {t('operations.partitions.ok', {
                behind: data.window.behind,
                ahead: data.window.ahead,
              })}
            </p>
          )}
          <DataTable
            caption={t('operations.partitions.caption')}
            headers={[
              t('operations.partitions.col.partition'),
              t('operations.partitions.col.month'),
              t('operations.partitions.col.rows'),
              t('operations.partitions.col.size'),
            ]}
          >
            {data.partitions.map((row) => (
              <tr key={row.name}>
                <Cell>
                  <code className="text-xs">{row.name}</code>
                </Cell>
                <Cell>
                  {row.default ? (
                    <StateBadge
                      state={data.default_has_rows === true ? 'down' : 'not_installed'}
                      label={t('operations.partitions.catchAll')}
                    />
                  ) : (
                    (row.month ?? '—')
                  )}
                </Cell>
                <Cell>{formatCount(row.est_rows)}</Cell>
                <Cell>{formatBytes(row.size_bytes)}</Cell>
              </tr>
            ))}
          </DataTable>

          {open && (
            <ReasonDialog
              title={t('operations.partitions.dialog.title')}
              description={t('operations.partitions.dialog.description')}
              confirmLabel={t('operations.partitions.dialog.confirm')}
              onConfirm={async ({ reason }) => {
                setNotice(describe(await ensure.mutateAsync({ reason })));
              }}
              onDone={() => setOpen(false)}
              onCancel={() => setOpen(false)}
            />
          )}
        </div>
      )}
    </QuerySection>
  );
}

export function UnverifiedSection(): ReactElement {
  const t = useTranslate();
  const query = useUnverifiedSignups();
  const me = useAuth((s) => s.me);
  const canPurge = hasPermission(me, 'operations.run');
  const purge = usePurgeUnverified();
  const [open, setOpen] = useState(false);
  const [notice, setNotice] = useState<Notice | null>(null);

  return (
    <QuerySection
      id="operations-unverified"
      title={t('operations.unverified.heading')}
      query={query}
      actions={
        canPurge && (
          <button type="button" className={PRIMARY_BUTTON_CLASS} onClick={() => setOpen(true)}>
            {t('operations.unverified.purge')}
          </button>
        )
      }
    >
      {(data) => {
        const days = Math.round(data.ttl_hours / 24);
        return (
          <div className="flex flex-col">
            {notice && (
              <div className="p-4 pb-0">
                <Banner tone={notice.tone} dismissible>
                  {notice.text}
                </Banner>
              </div>
            )}
            <Figures
              items={[
                { label: t('operations.unverified.total'), value: formatCount(data.total) },
                {
                  label: t('operations.unverified.older', { days }),
                  value: formatCount(data.older_than_ttl),
                },
                {
                  label: t('operations.unverified.oldest'),
                  value: formatDuration(data.oldest_age_s) ?? '—',
                },
              ]}
            />
            <p className="px-4 pb-4 text-xs text-content-secondary">
              {t('operations.unverified.note', { days })}
            </p>
            {open && (
              <ReasonDialog
                title={t('operations.unverified.dialog.title')}
                description={t('operations.unverified.dialog.description', { days })}
                confirmLabel={t('operations.unverified.dialog.confirm')}
                requireTotp
                onConfirm={async ({ reason }) => {
                  const result = await purge.mutateAsync({ reason });
                  setNotice({
                    tone: 'success',
                    text: t('operations.unverified.result', {
                      count: formatCount(result.purged) ?? result.purged,
                    }),
                  });
                }}
                onDone={() => setOpen(false)}
                onCancel={() => setOpen(false)}
              />
            )}
          </div>
        );
      }}
    </QuerySection>
  );
}
