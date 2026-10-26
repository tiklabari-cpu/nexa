/**
 * One workspace's AI allowance and usage (tm 389.12 · FR-ADMIN-13 · design.md §B3): each layer
 * of its daily caps — the override set here, the plan's default, the deployment's — and which
 * one applies, today's counters (the simulation meters too) and the last 30 days.
 *
 * The override form is the "quota raise" a workspace asks the SiyahTuş team for (#283
 * AI-16-S2). `usage.manage` writes it; a lapsed override is shown as such, and the tenant API
 * already reads the plan's figure again.
 */
import { useRef, useState, type ReactElement } from 'react';
import { Link, useParams } from 'react-router-dom';
import { LoadError } from '../../components/LoadError.js';
import { Page } from '../../components/Page.js';
import { ReasonDialog } from '../../components/ReasonDialog.js';
import { Banner } from '../../components/ui/Banner.js';
import { ApiClientError } from '../../lib/api-client.js';
import { hasPermission, useAuth } from '../../lib/auth-store.js';
import { formatCount, formatDateTime } from '../../lib/format.js';
import { useTranslate } from '../../lib/i18n.js';
import type {
  PlatformAiCapLayers,
  PlatformWorkspaceUsageDetail,
} from '../../lib/platform-types.js';
import {
  Cell,
  DataTable,
  FIELD_CLASS,
  LINK_CLASS,
  Loading,
  SECONDARY_BUTTON_CLASS,
} from '../workspaces/ui.js';
import { usePutWorkspaceAiCaps, useWorkspaceUsage } from './queries.js';
import { parseTokens, TokenChart, UsageSectionCard } from './UsagePage.js';

const count = (value: number | null) =>
  value === null ? null : (formatCount(value) ?? String(value));

export function UsageWorkspacePage(): ReactElement {
  const t = useTranslate();
  const { licenseId = '' } = useParams();
  const query = useWorkspaceUsage(licenseId);
  const me = useAuth((s) => s.me);
  const canManage = hasPermission(me, 'usage.manage');
  const [editing, setEditing] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);

  const title = query.data?.organization_name ?? t('nav.usage');
  return (
    <Page
      title={title}
      description={t('usage.detail.description', { licence: licenseId })}
      actions={
        <div className="flex gap-2">
          <Link to="/usage" className={SECONDARY_BUTTON_CLASS}>
            {t('usage.detail.back')}
          </Link>
          {canManage && query.data && (
            <button
              type="button"
              className={SECONDARY_BUTTON_CLASS}
              onClick={() => setEditing(true)}
            >
              {t('usage.override.open')}
            </button>
          )}
        </div>
      }
    >
      {notice && (
        <Banner tone="success" role="status" dismissible onDismiss={() => setNotice(null)}>
          {notice}
        </Banner>
      )}
      {query.isPending ? (
        <Loading label={t('usage.loading')} />
      ) : query.isError ? (
        <LoadError
          title={t('usage.detail.failed')}
          error={query.error}
          onRetry={() => void query.refetch()}
        />
      ) : (
        <Detail usage={query.data} />
      )}
      {editing && query.data && (
        <OverrideDialog
          usage={query.data}
          onClose={() => setEditing(false)}
          onDone={(unchanged) => {
            setEditing(false);
            setNotice(unchanged ? t('usage.override.unchanged') : t('usage.override.saved'));
          }}
        />
      )}
    </Page>
  );
}

function Detail({ usage }: { usage: PlatformWorkspaceUsageDetail }): ReactElement {
  const t = useTranslate();
  const layer = (row: PlatformAiCapLayers) => [
    count(row.effective),
    t(`usage.source.${row.source}`),
    count(row.override),
    row.plan === null ? t('usage.plans.deployment') : count(row.plan),
    count(row.deployment),
  ];
  return (
    <>
      {usage.caps.expires_at && (
        <Banner tone={usage.caps.in_force ? 'info' : 'warning'}>
          {usage.caps.in_force
            ? t('usage.override.until', { at: formatDateTime(usage.caps.expires_at) ?? '' })
            : t('usage.override.lapsed', { at: formatDateTime(usage.caps.expires_at) ?? '' })}
        </Banner>
      )}
      <UsageSectionCard id="usage-caps" title={t('usage.caps.title')}>
        <DataTable
          caption={t('usage.caps.title')}
          headers={[
            t('usage.caps.meter'),
            t('usage.caps.effective'),
            t('usage.caps.source'),
            t('usage.caps.override'),
            t('usage.caps.plan'),
            t('usage.caps.deployment'),
          ]}
        >
          {(['llm', 'embedding'] as const).map((meter) => (
            <tr key={meter}>
              <Cell>{t(`usage.meter.${meter}`)}</Cell>
              {layer(usage.caps[meter]).map((value, index) => (
                <Cell key={index}>{value}</Cell>
              ))}
            </tr>
          ))}
        </DataTable>
      </UsageSectionCard>
      <UsageSectionCard id="usage-today" title={t('usage.detail.today')}>
        <DataTable
          caption={t('usage.detail.today')}
          headers={[
            t('usage.caps.meter'),
            t('usage.top.used'),
            t('usage.detail.reserved'),
            t('usage.top.limit'),
          ]}
        >
          {(['llm', 'embedding', 'llm_test', 'embedding_test'] as const).map((meter) => (
            <tr key={meter}>
              <Cell>{t(`usage.meter.${meter}`)}</Cell>
              <Cell>{count(usage.today[meter].used)}</Cell>
              <Cell>{count(usage.today[meter].reserved)}</Cell>
              <Cell>{count(usage.today[meter].cap)}</Cell>
            </tr>
          ))}
        </DataTable>
        <TokenChart
          series={usage.series}
          label={t('usage.detail.chart', { days: usage.series.length })}
          t={t}
        />
      </UsageSectionCard>
      <p className="text-xs text-content-secondary">
        <Link to={`/workspaces/${usage.license_id}`} className={LINK_CLASS}>
          {t('usage.detail.workspace')}
        </Link>
      </p>
    </>
  );
}

function OverrideDialog({
  usage,
  onClose,
  onDone,
}: {
  usage: PlatformWorkspaceUsageDetail;
  onClose: () => void;
  onDone: (unchanged: boolean) => void;
}): ReactElement {
  const t = useTranslate();
  const save = usePutWorkspaceAiCaps(usage.license_id);
  const initial = {
    llm: usage.caps.llm.override === null ? '' : String(usage.caps.llm.override),
    embedding: usage.caps.embedding.override === null ? '' : String(usage.caps.embedding.override),
    expires: usage.caps.expires_at ? usage.caps.expires_at.slice(0, 10) : '',
  };
  const [draft, setDraft] = useState(initial);
  const unchanged = useRef(false);
  const llm = parseTokens(draft.llm);
  const embedding = parseTokens(draft.embedding);
  const expires = /^\d{4}-\d{2}-\d{2}$/.test(draft.expires)
    ? `${draft.expires}T23:59:59.000Z`
    : null;
  const valid =
    !Number.isNaN(llm) &&
    !Number.isNaN(embedding) &&
    (draft.expires === '' || (expires !== null && (llm !== null || embedding !== null)));

  const describeError = (error: unknown): string | null => {
    if (!(error instanceof ApiClientError)) return null;
    const reason = error.details?.['reason'];
    if (reason === 'expires_at_past') return t('usage.override.past');
    if (reason === 'expires_without_override') return t('usage.override.needsCap');
    return null;
  };

  return (
    <ReasonDialog
      title={t('usage.override.title', { name: usage.organization_name })}
      description={t('usage.override.body')}
      confirmLabel={t('usage.override.confirm')}
      confirmDisabled={!valid}
      extraDirty={JSON.stringify(draft) !== JSON.stringify(initial)}
      describeError={describeError}
      onCancel={onClose}
      onDone={() => onDone(unchanged.current)}
      onConfirm={async ({ reason }) => {
        const result = await save.mutateAsync({
          llm_daily_tokens_cap: llm,
          embedding_daily_tokens_cap: embedding,
          expires_at: expires,
          reason,
        });
        unchanged.current = result.unchanged;
      }}
    >
      {(['llm', 'embedding'] as const).map((meter) => (
        <div key={meter}>
          <label htmlFor={`override-${meter}`} className="text-sm font-medium">
            {t(`usage.override.${meter}`)}
          </label>
          <input
            id={`override-${meter}`}
            inputMode="numeric"
            className={FIELD_CLASS}
            value={draft[meter]}
            placeholder={t('usage.plans.inherit')}
            onChange={(event) => setDraft({ ...draft, [meter]: event.target.value })}
          />
        </div>
      ))}
      <div>
        <label htmlFor="override-expires" className="text-sm font-medium">
          {t('usage.override.expires')}
        </label>
        <input
          id="override-expires"
          type="date"
          className={FIELD_CLASS}
          value={draft.expires}
          aria-describedby="override-expires-hint"
          onChange={(event) => setDraft({ ...draft, expires: event.target.value })}
        />
        <p id="override-expires-hint" className="mt-1 text-xs text-content-secondary">
          {t('usage.override.expiresHint')}
        </p>
      </div>
    </ReasonDialog>
  );
}
