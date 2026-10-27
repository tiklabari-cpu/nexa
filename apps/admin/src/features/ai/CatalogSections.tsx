/**
 * The AI page's read-only catalogues (tm 389.19 · FR-ADMIN-23): the G1–G19 rules, the iGaming
 * template pack with each workspace's installs, the compliance scenario pack, the QA rubric and
 * the tool catalogue. What the platform ships is shown with its version, not edited here
 * (editing a catalogue is F2). Keys, counts and versions only — a procedure's text or a
 * scenario's turns are not on this page, and a workspace's content never is.
 */
import type { UseQueryResult } from '@tanstack/react-query';
import type { ReactElement, ReactNode } from 'react';
import { LoadError } from '../../components/LoadError.js';
import { Card } from '../../components/Page.js';
import { formatCount } from '../../lib/format.js';
import { useLocale, useTranslate } from '../../lib/i18n.js';
import { Cell, DataTable, EmptyLine, Loading, SECONDARY_BUTTON_CLASS } from '../workspaces/ui.js';
import {
  useCompliancePack,
  useGuardrailCatalog,
  useQaRubric,
  useTemplateCatalog,
  useTemplateInstalls,
  useToolCatalog,
} from './queries.js';

/** A card that shows its own load state, so one failing catalogue blanks only itself. */
function Frame<T>({
  query,
  children,
}: {
  query: UseQueryResult<T>;
  children: (data: T) => ReactNode;
}): ReactElement {
  const t = useTranslate();
  if (query.isError) {
    return (
      <Card>
        <LoadError
          title={t('ai.loadError')}
          error={query.error}
          onRetry={() => void query.refetch()}
        />
      </Card>
    );
  }
  if (query.data === undefined) {
    return (
      <Card>
        <Loading label={t('ai.loading')} />
      </Card>
    );
  }
  return <Card>{children(query.data)}</Card>;
}

function VersionLine({ label, version }: { label: string; version: string | null }): ReactElement {
  const t = useTranslate();
  return (
    <p className="px-4 pt-4 text-sm">
      <span className="text-content-secondary">{label}: </span>
      <span className="tabular font-medium">{version ?? t('ai.noVersion')}</span>
    </p>
  );
}

function NotInstalled({ owner }: { owner: string }): ReactElement {
  const t = useTranslate();
  return (
    <p role="status" className="p-4 text-sm text-content-secondary">
      {t('ai.notInstalled', { owner })}
    </p>
  );
}

// --- Guardrails ------------------------------------------------------------------------------

export function GuardrailsPanel(): ReactElement {
  const t = useTranslate();
  const { locale } = useLocale();
  const query = useGuardrailCatalog();
  return (
    <Frame query={query}>
      {(data) => (
        <>
          <VersionLine label={t('ai.guardrails.version')} version={data.version} />
          <p className="px-4 pt-1 text-xs text-content-secondary">
            {t('ai.guardrails.intro', { count: data.count })}
          </p>
          <DataTable
            caption={t('ai.guardrails.caption')}
            headers={[
              t('ai.guardrails.col.rule'),
              t('ai.guardrails.col.title'),
              t('ai.guardrails.col.category'),
              t('ai.guardrails.col.action'),
              t('ai.guardrails.col.stages'),
              t('ai.guardrails.col.patterns'),
            ]}
          >
            {data.items.map((item) => (
              <tr key={item.id}>
                <Cell>
                  <span className="tabular font-medium">{item.id}</span>
                </Cell>
                <Cell>
                  <span className="block">{item.title[locale]}</span>
                  <span className="block text-xs text-content-secondary">
                    {item.prompt[locale]}
                  </span>
                </Cell>
                <Cell>{item.category}</Cell>
                <Cell>{item.action}</Cell>
                <Cell>
                  {item.stages.map((stage) => t(`ai.guardrails.stage.${stage}`)).join(', ')}
                </Cell>
                <Cell>
                  <span className="tabular">
                    {t('ai.guardrails.patterns', {
                      input: formatCount(item.input_patterns.tr + item.input_patterns.en) ?? '0',
                      output: formatCount(item.output_patterns.tr + item.output_patterns.en) ?? '0',
                    })}
                  </span>
                </Cell>
              </tr>
            ))}
          </DataTable>
        </>
      )}
    </Frame>
  );
}

// --- Templates and their installs --------------------------------------------------------------

export function TemplatesPanel(): ReactElement {
  const t = useTranslate();
  const catalog = useTemplateCatalog();
  const installs = useTemplateInstalls();
  const rows = installs.data?.pages.flatMap((page) => page.data) ?? [];
  return (
    <div className="flex flex-col gap-6">
      <Frame query={catalog}>
        {(data) => (
          <>
            <VersionLine
              label={t('ai.templates.version', { pack: data.pack.key })}
              version={data.pack.version}
            />
            <p className="px-4 pt-1 text-xs text-content-secondary">
              {t('ai.templates.intro', { count: data.pack.template_count })}
            </p>
            <DataTable
              caption={t('ai.templates.caption')}
              headers={[
                t('ai.templates.col.key'),
                t('ai.templates.col.name'),
                t('ai.templates.col.version'),
                t('ai.templates.col.locked'),
                t('ai.templates.col.scenarios'),
                t('ai.templates.col.mustFill'),
              ]}
            >
              {data.items.map((item) => (
                <tr key={item.key}>
                  <Cell>
                    <span className="tabular">{item.key}</span>
                  </Cell>
                  <Cell>{item.name}</Cell>
                  <Cell>{item.version}</Cell>
                  <Cell>{item.locked ? t('ai.yes') : t('ai.no')}</Cell>
                  <Cell>{formatCount(item.scenario_count)}</Cell>
                  <Cell>{formatCount(item.tenant_must_fill_count)}</Cell>
                </tr>
              ))}
            </DataTable>
          </>
        )}
      </Frame>

      <section aria-labelledby="ai-installs-heading">
        <h2 id="ai-installs-heading" className="mb-3 text-sm font-semibold">
          {t('ai.installs.heading')}
        </h2>
        <Card>
          {installs.isError ? (
            <LoadError
              title={t('ai.loadError')}
              error={installs.error}
              onRetry={() => void installs.refetch()}
            />
          ) : installs.data === undefined ? (
            <Loading label={t('ai.loading')} />
          ) : rows.length === 0 ? (
            <EmptyLine>{t('ai.installs.empty')}</EmptyLine>
          ) : (
            <>
              <p className="px-4 pt-4 text-xs text-content-secondary">{t('ai.installs.intro')}</p>
              <DataTable
                caption={t('ai.installs.caption')}
                headers={[
                  t('ai.installs.col.workspace'),
                  t('ai.installs.col.installed'),
                  t('ai.installs.col.active'),
                  t('ai.installs.col.outdated'),
                ]}
              >
                {rows.map((row) => (
                  <tr key={row.license_id}>
                    <Cell>
                      <span className="block">{row.workspace_name}</span>
                      <span className="tabular block text-xs text-content-secondary">
                        {row.license_id}
                      </span>
                    </Cell>
                    <Cell>{formatCount(row.installed)}</Cell>
                    <Cell>{formatCount(row.active)}</Cell>
                    <Cell>{formatCount(row.outdated)}</Cell>
                  </tr>
                ))}
              </DataTable>
              {installs.hasNextPage && (
                <div className="p-4">
                  <button
                    type="button"
                    className={SECONDARY_BUTTON_CLASS}
                    disabled={installs.isFetchingNextPage}
                    onClick={() => void installs.fetchNextPage()}
                  >
                    {t('ai.loadMore')}
                  </button>
                </div>
              )}
            </>
          )}
        </Card>
      </section>
    </div>
  );
}

// --- Compliance pack ---------------------------------------------------------------------------

export function CompliancePanel(): ReactElement {
  const t = useTranslate();
  const query = useCompliancePack();
  return (
    <Frame query={query}>
      {(data) => (
        <>
          <VersionLine label={t('ai.compliance.version')} version={data.version} />
          <p className="px-4 pt-1 text-xs text-content-secondary">
            {t('ai.compliance.intro', { count: data.size })}
          </p>
          <DataTable
            caption={t('ai.compliance.caption')}
            headers={[
              t('ai.compliance.col.key'),
              t('ai.compliance.col.rule'),
              t('ai.compliance.col.language'),
            ]}
          >
            {data.items.map((item) => (
              <tr key={item.key}>
                <Cell>
                  <span className="tabular">{item.key}</span>
                </Cell>
                <Cell>{item.guardrail}</Cell>
                <Cell>{item.language}</Cell>
              </tr>
            ))}
          </DataTable>
        </>
      )}
    </Frame>
  );
}

// --- QA rubric ---------------------------------------------------------------------------------

export function RubricPanel(): ReactElement {
  const t = useTranslate();
  const query = useQaRubric();
  return (
    <Frame query={query}>
      {(data) => (
        <>
          <VersionLine label={t('ai.rubric.version')} version={data.version} />
          <p className="px-4 pt-1 text-xs text-content-secondary">
            {t('ai.rubric.intro', { min: data.scale.min, max: data.scale.max })}
          </p>
          <DataTable
            caption={t('ai.rubric.caption')}
            headers={[t('ai.rubric.col.criterion'), t('ai.rubric.col.applies')]}
          >
            {data.items.map((item) => (
              <tr key={item.key}>
                <Cell>{t(`ai.rubric.criterion.${item.key}`)}</Cell>
                <Cell>
                  {item.handoff_only ? t('ai.rubric.handoffOnly') : t('ai.rubric.always')}
                </Cell>
              </tr>
            ))}
          </DataTable>
        </>
      )}
    </Frame>
  );
}

// --- Tools -------------------------------------------------------------------------------------

export function ToolsPanel(): ReactElement {
  const t = useTranslate();
  const query = useToolCatalog();
  return (
    <Frame query={query}>
      {(data) =>
        data.status === 'not_installed' ? (
          <NotInstalled owner={t('ai.tools.owner')} />
        ) : (
          <>
            <VersionLine label={t('ai.tools.version')} version={data.version} />
            <DataTable caption={t('ai.tools.caption')} headers={[t('ai.tools.col.key')]}>
              {data.items.map((item) => (
                <tr key={item.key}>
                  <Cell>
                    <span className="tabular">{item.key}</span>
                  </Cell>
                </tr>
              ))}
            </DataTable>
          </>
        )
      }
    </Frame>
  );
}
