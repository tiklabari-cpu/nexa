/**
 * The tenant API's configuration as it runs (tm 389.13 · FR-ADMIN-16), as its scheduler leader
 * published it: every environment key, secrets as "set"/"unset" only, URLs without their
 * credentials, and where each value came from — this panel, the environment or the default.
 * The keys the panel can override are marked; the rest (`APPS_LIVE_PROVIDERS`, the Turnstile
 * keys, `TICKET_MAIL_OUTBOUND`, `PILOT_MODE`, `LLM_PROVIDER`, …) are only shown here.
 */
import { EFFECTIVE_CONFIG_SOURCES, type EffectiveConfigSource } from '@siyahtus/types';
import { useState, type ReactElement } from 'react';
import { LoadError } from '../../components/LoadError.js';
import { Card } from '../../components/Page.js';
import { Banner, cn } from '../../components/ui/index.js';
import { formatDate } from '../../lib/format.js';
import { useTranslate } from '../../lib/i18n.js';
import { Cell, DataTable, EmptyLine, FIELD_CLASS, Loading } from '../workspaces/ui.js';
import { useEffectiveConfig } from './queries.js';

type SourceFilter = 'all' | EffectiveConfigSource;

/** Shown here, set elsewhere — named by the requirement (FR-ADMIN-16). */
export const NOTABLE_KEYS: ReadonlySet<string> = new Set([
  'APPS_LIVE_PROVIDERS',
  'CAPTCHA_PROVIDER',
  'TURNSTILE_SITE_KEY',
  'TURNSTILE_SECRET_KEY',
  'TICKET_MAIL_OUTBOUND',
  'PILOT_MODE',
  'LLM_PROVIDER',
]);

const SOURCE_CLASS: Record<EffectiveConfigSource, string> = {
  db: 'bg-brand-500/10 text-content-brand',
  env: 'bg-surface-2 text-content',
  default: 'bg-surface-2 text-content-secondary',
};

export function EffectiveConfigSection(): ReactElement {
  const t = useTranslate();
  const query = useEffectiveConfig();
  const [q, setQ] = useState('');
  const [source, setSource] = useState<SourceFilter>('all');
  const [notableOnly, setNotableOnly] = useState(false);

  const needle = q.trim().toLowerCase();
  const rows = (query.data?.entries ?? []).filter(
    (entry) =>
      (source === 'all' || entry.source === source) &&
      (!notableOnly || NOTABLE_KEYS.has(entry.key) || entry.panel) &&
      (needle === '' ||
        entry.key.toLowerCase().includes(needle) ||
        (!entry.redacted && (entry.value ?? '').toLowerCase().includes(needle))),
  );

  return (
    <Card>
      <section aria-labelledby="settings-config-title" className="flex flex-col gap-3 p-4">
        <h2 id="settings-config-title" className="text-sm font-semibold">
          {t('settings.config.title')}
        </h2>
        <p className="text-xs text-content-secondary">{t('settings.config.hint')}</p>
        {query.data?.stale &&
          (query.data.generated_at === null ? (
            <Banner tone="danger" title={t('settings.config.notReporting.title')}>
              {t('settings.config.notReporting.body')}
            </Banner>
          ) : (
            <Banner tone="warning" title={t('settings.config.stale.title')}>
              {t('settings.config.stale.body', {
                date: formatDate(query.data.generated_at) ?? '—',
              })}
            </Banner>
          ))}
        <div
          role="search"
          aria-label={t('settings.config.filter')}
          className="flex flex-wrap items-end gap-3"
        >
          <div className="min-w-[14rem] flex-1">
            <label htmlFor="settings-config-q" className="text-xs font-medium">
              {t('settings.config.search')}
            </label>
            <input
              id="settings-config-q"
              type="search"
              value={q}
              onChange={(event) => setQ(event.target.value)}
              className={FIELD_CLASS}
            />
          </div>
          <div>
            <label htmlFor="settings-config-source" className="text-xs font-medium">
              {t('settings.config.source')}
            </label>
            <select
              id="settings-config-source"
              value={source}
              onChange={(event) => setSource(event.target.value as SourceFilter)}
              className={FIELD_CLASS}
            >
              <option value="all">{t('settings.config.source.all')}</option>
              {EFFECTIVE_CONFIG_SOURCES.map((value) => (
                <option key={value} value={value}>
                  {t(`settings.config.source.${value}`)}
                </option>
              ))}
            </select>
          </div>
          <label className="flex items-center gap-2 pb-2 text-sm">
            <input
              type="checkbox"
              checked={notableOnly}
              onChange={(event) => setNotableOnly(event.target.checked)}
            />
            {t('settings.config.notableOnly')}
          </label>
        </div>
      </section>
      {query.isError ? (
        <LoadError
          title={t('settings.config.loadError')}
          error={query.error}
          onRetry={() => void query.refetch()}
        />
      ) : query.isPending ? (
        <Loading label={t('settings.loading')} />
      ) : rows.length === 0 ? (
        <EmptyLine>{t('settings.config.empty')}</EmptyLine>
      ) : (
        <DataTable
          caption={t('settings.config.title')}
          headers={[
            t('settings.config.key'),
            t('settings.config.value'),
            t('settings.config.source'),
          ]}
        >
          {rows.map((entry) => (
            <tr key={entry.key} data-testid={`config-${entry.key}`}>
              <Cell>
                <code className="text-xs">{entry.key}</code>
                {entry.panel && (
                  <span className="ml-2 rounded bg-brand-500/10 px-1.5 py-0.5 text-[11px] text-content-brand">
                    {t('settings.config.panel')}
                  </span>
                )}
              </Cell>
              <Cell>
                {entry.redacted ? (
                  <span className="text-content-secondary">
                    {t(entry.value === 'set' ? 'settings.config.set' : 'settings.config.unset')}
                  </span>
                ) : entry.value === null ? (
                  <span className="text-content-secondary">{t('settings.config.none')}</span>
                ) : (
                  <code className="break-all text-xs">{entry.value}</code>
                )}
              </Cell>
              <Cell>
                <span
                  className={cn('rounded px-1.5 py-0.5 text-[11px]', SOURCE_CLASS[entry.source])}
                >
                  {t(`settings.config.source.${entry.source}`)}
                </span>
              </Cell>
            </tr>
          ))}
        </DataTable>
      )}
    </Card>
  );
}
