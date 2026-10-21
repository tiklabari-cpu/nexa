/**
 * The "iGaming" tab of the template gallery (tm 311.4 · AI-15): the twenty
 * ready-made Turkish procedures, a preview of each, the install step that maps
 * the topics a template hands over to onto the workspace's teams, and the
 * "Kiracının doldurması gerekenler" panel an install leaves behind.
 *
 * It is a tab of the gallery rather than a screen of its own so an admin finds
 * it where they already look for a starting point — and a separate component so
 * the static catalogue's tabs stay free of any query: this one mounts, and so
 * reads `GET /ai-templates`, only once the tab is chosen. Browsing and
 * previewing write nothing (the server guarantees it); `Kur` is the only
 * write, and it is idempotent per agent and template, so a second click says
 * "already installed" instead of making another copy.
 *
 * The steps are views of one panel (list → detail → install → result) rather
 * than nested modals: the gallery is already the dialog, and a second one would
 * need its own focus trap and its own Escape.
 */
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useState, type ReactElement, type ReactNode } from 'react';
import { LoadError } from '../../components/LoadError.js';
import { useApiClient, useAuth } from '../../lib/auth-store.js';
import { hasMessage, useTranslate, type TFunction } from '../../lib/i18n.js';
import {
  IGAMING_PACK_KEY,
  PACK_TOPICS,
  aiTemplatesKey,
  installErrorKey,
  installState,
  packUnfilled,
  routeMappingBody,
  type AiTemplateDetail,
  type AiTemplateInstallResult,
  type AiTemplateList,
  type AiTemplatePackInstallResult,
  type AiTemplateSummary,
  type TemplateMustFill,
} from './ai-templates.js';
import { Select, type TeamOption } from './ProcedureSections.js';
import type { Skill } from './types.js';

type View =
  | { name: 'list' }
  | { name: 'detail'; key: string }
  | { name: 'install'; key: string }
  | { name: 'pack' };

const primaryButton =
  'rounded-md bg-brand-500 px-3 py-1.5 text-2xs font-medium text-white transition-colors hover:bg-brand-600 disabled:opacity-50';
const quietButton =
  'rounded-md border border-border px-3 py-1.5 text-2xs text-content-secondary transition-colors hover:bg-surface-2 disabled:opacity-50';

function topicLabel(t: TFunction, topic: string): string {
  const key = `team.queue.role.${topic}`;
  return hasMessage('en', key) ? t(key) : topic;
}

export function IGamingTemplates({
  aiAgentId,
  onOpenSkill,
}: {
  /** The workspace's AI agent — a copy belongs to one; null until the roster has loaded. */
  aiAgentId: string | null;
  /** Open the installed draft in the editor (the gallery closes). */
  onOpenSkill: (skill: Skill) => void;
}): ReactElement {
  const t = useTranslate();
  const api = useApiClient();
  const [view, setView] = useState<View>({ name: 'list' });

  const list = useQuery({
    queryKey: aiTemplatesKey,
    queryFn: () => api.get<AiTemplateList>('/ai-templates?industry=igaming&lang=tr'),
  });

  if (list.isError)
    return (
      <LoadError
        title={t('playbook.aiTemplates.loadError')}
        error={list.error}
        onRetry={() => void list.refetch()}
      />
    );
  if (list.isPending) {
    return (
      <p className="p-4 text-sm text-content-secondary">{t('playbook.aiTemplates.loading')}</p>
    );
  }

  const back = (): void => setView({ name: 'list' });
  const templates = list.data.items;

  if (view.name === 'detail') {
    return (
      <TemplateDetail
        templateKey={view.key}
        summary={templates.find((item) => item.key === view.key) ?? null}
        onBack={back}
        onInstall={() => setView({ name: 'install', key: view.key })}
      />
    );
  }
  if (view.name === 'install') {
    const template = templates.find((item) => item.key === view.key);
    if (template) {
      return (
        <InstallPanel
          template={template}
          aiAgentId={aiAgentId}
          onBack={back}
          onOpenSkill={onOpenSkill}
        />
      );
    }
  }
  if (view.name === 'pack') {
    return <PackPanel aiAgentId={aiAgentId} onBack={back} />;
  }

  const pack = list.data.packs.find((item) => item.key === IGAMING_PACK_KEY) ?? null;

  return (
    <div className="flex flex-col gap-3">
      {pack && (
        <div className="flex flex-wrap items-center justify-between gap-3 rounded-md border border-border bg-surface-2 p-3">
          <div className="min-w-0">
            <p className="text-sm font-medium">{t('playbook.aiTemplates.pack.title')}</p>
            <p className="text-2xs text-content-secondary">
              {t('playbook.aiTemplates.pack.summary', {
                templates: pack.template_keys.length,
                rules: pack.default_rules_count,
                rows: pack.sample_rows_count,
              })}
            </p>
          </div>
          <button type="button" onClick={() => setView({ name: 'pack' })} className={quietButton}>
            {t('playbook.aiTemplates.pack.open')}
          </button>
        </div>
      )}
      <ul
        aria-label={t('playbook.aiTemplates.listLabel')}
        className="flex max-h-[45vh] flex-col overflow-y-auto"
      >
        {templates.map((template) => (
          <TemplateItem
            key={template.key}
            template={template}
            onPreview={() => setView({ name: 'detail', key: template.key })}
            onInstall={() => setView({ name: 'install', key: template.key })}
          />
        ))}
      </ul>
      <p className="text-2xs text-content-tertiary">{t('playbook.aiTemplates.listFooter')}</p>
    </div>
  );
}

function TemplateItem({
  template,
  onPreview,
  onInstall,
}: {
  template: AiTemplateSummary;
  onPreview: () => void;
  onInstall: () => void;
}): ReactElement {
  const t = useTranslate();
  const state = installState(template);
  return (
    <li className="flex items-center gap-3 border-b border-border px-1 py-2 last:border-0">
      <div className="min-w-0 flex-1">
        <div className="flex flex-wrap items-center gap-1.5">
          <p className="text-sm font-medium">{template.name}</p>
          {template.locked && (
            <span className="rounded-sm bg-warning/10 px-1.5 py-0.5 text-2xs font-medium text-warning">
              {t('playbook.aiTemplates.badge.locked')}
            </span>
          )}
          {state === 'installed' && (
            <span className="rounded-sm bg-success/10 px-1.5 py-0.5 text-2xs font-medium text-success">
              {t('playbook.aiTemplates.badge.installed')}
            </span>
          )}
          {state === 'update' && (
            <span className="rounded-sm bg-info/10 px-1.5 py-0.5 text-2xs font-medium text-info">
              {t('playbook.aiTemplates.badge.update')}
            </span>
          )}
        </div>
        <p className="text-2xs text-content-secondary">{template.summary}</p>
        {template.tenant_must_fill_count > 0 && (
          <p className="text-2xs text-content-tertiary">
            {t('playbook.aiTemplates.mustFillCount', { count: template.tenant_must_fill_count })}
          </p>
        )}
      </div>
      <button
        type="button"
        onClick={onPreview}
        aria-label={t('playbook.aiTemplates.previewLabel', { name: template.name })}
        className={quietButton}
      >
        {t('playbook.aiTemplates.preview')}
      </button>
      <button
        type="button"
        onClick={onInstall}
        aria-label={t('playbook.aiTemplates.installLabel', { name: template.name })}
        className={primaryButton}
      >
        {t('playbook.aiTemplates.install')}
      </button>
    </li>
  );
}

function TemplateDetail({
  templateKey,
  summary,
  onBack,
  onInstall,
}: {
  templateKey: string;
  summary: AiTemplateSummary | null;
  onBack: () => void;
  onInstall: () => void;
}): ReactElement {
  const t = useTranslate();
  const api = useApiClient();
  const detail = useQuery({
    queryKey: [...aiTemplatesKey, templateKey],
    queryFn: () => api.get<AiTemplateDetail>(`/ai-templates/${templateKey}`),
  });

  return (
    <div className="flex flex-col gap-3">
      <div className="flex items-center justify-between gap-3">
        <button type="button" onClick={onBack} className={quietButton}>
          {t('playbook.aiTemplates.back')}
        </button>
        <button type="button" onClick={onInstall} className={primaryButton}>
          {t('playbook.aiTemplates.install')}
        </button>
      </div>
      <h3 className="text-sm font-semibold">{summary?.name ?? templateKey}</h3>
      {detail.isError && (
        <LoadError
          title={t('playbook.aiTemplates.detailLoadError')}
          error={detail.error}
          onRetry={() => void detail.refetch()}
          compact
        />
      )}
      {detail.isPending && (
        <p className="text-sm text-content-secondary">{t('playbook.aiTemplates.loading')}</p>
      )}
      {detail.data && (
        <div className="flex max-h-[45vh] flex-col gap-3 overflow-y-auto pr-1 text-sm">
          <p className="text-content-secondary">{detail.data.summary}</p>
          <PreviewSection title={t('playbook.aiTemplates.detail.whenToUse')}>
            <p>{detail.data.when_to_use}</p>
          </PreviewSection>
          {detail.data.examples.length > 0 && (
            <PreviewSection title={t('playbook.aiTemplates.detail.examples')}>
              <ul className="list-disc pl-5">
                {detail.data.examples.map((example) => (
                  <li key={example}>{example}</li>
                ))}
              </ul>
            </PreviewSection>
          )}
          <PreviewSection title={t('playbook.aiTemplates.detail.handsOverTo')}>
            <p>
              {detail.data.topics.length === 0
                ? t('playbook.aiTemplates.detail.noHandover')
                : detail.data.topics.map((topic) => topicLabel(t, topic)).join(', ')}
            </p>
            {detail.data.card_example && (
              <p className="mt-1 whitespace-pre-line rounded-md bg-surface-2 p-2 text-2xs">
                {detail.data.card_example}
              </p>
            )}
          </PreviewSection>
          {detail.data.forbidden_phrases.length > 0 && (
            <PreviewSection title={t('playbook.aiTemplates.detail.forbidden')}>
              <ul className="list-disc pl-5">
                {detail.data.forbidden_phrases.map((item) => (
                  <li key={item.phrase}>
                    <span className="font-medium">{item.phrase}</span>
                    <span className="text-content-secondary"> — {item.why}</span>
                  </li>
                ))}
              </ul>
            </PreviewSection>
          )}
          {detail.data.scenarios.length > 0 && (
            <PreviewSection title={t('playbook.aiTemplates.detail.scenarios')}>
              <ul className="list-disc pl-5">
                {detail.data.scenarios.map((scenario) => (
                  <li key={scenario.key}>{scenario.name}</li>
                ))}
              </ul>
            </PreviewSection>
          )}
          <MustFillPanel items={detail.data.tenant_must_fill} />
        </div>
      )}
    </div>
  );
}

function PreviewSection({ title, children }: { title: string; children: ReactNode }): ReactElement {
  return (
    <section className="flex flex-col gap-1">
      <h4 className="text-2xs font-medium uppercase tracking-wide text-content-tertiary">
        {title}
      </h4>
      {children}
    </section>
  );
}

/** One line per thing the workspace must give the copy before it can go live. */
function mustFillText(t: TFunction, item: TemplateMustFill): string {
  if (item.kind === 'placeholder') {
    return t('playbook.aiTemplates.mustFill.placeholder', {
      label: item.label,
      key: `{${item.key ?? ''}}`,
      example: item.example ?? '',
    });
  }
  if (item.kind === 'table') {
    return t('playbook.aiTemplates.mustFill.table', {
      label: item.label,
      columns: (item.columns ?? []).join(', '),
    });
  }
  return t('playbook.aiTemplates.mustFill.setting', { label: item.label });
}

/** "Kiracının doldurması gerekenler" — the same panel the preview and an install result show. */
export function MustFillPanel({ items }: { items: TemplateMustFill[] }): ReactElement | null {
  const t = useTranslate();
  if (items.length === 0) return null;
  return (
    <section
      aria-label={t('playbook.aiTemplates.mustFill.title')}
      className="flex flex-col gap-1 rounded-md border border-border p-3"
    >
      <h4 className="text-xs font-semibold">{t('playbook.aiTemplates.mustFill.title')}</h4>
      <p className="text-2xs text-content-secondary">{t('playbook.aiTemplates.mustFill.hint')}</p>
      <ul className="list-disc pl-5 text-2xs">
        {items.map((item, index) => (
          <li key={`${item.kind}-${item.key ?? item.table ?? item.setting ?? index}`}>
            {mustFillText(t, item)}
          </li>
        ))}
      </ul>
    </section>
  );
}

/** Topic → team choices, one select per topic; "later" leaves it unmapped. */
function TeamMapping({
  topics,
  teams,
  chosen,
  onChange,
  disabled,
}: {
  topics: readonly string[];
  teams: TeamOption[];
  chosen: Record<string, string>;
  onChange: (topic: string, team: string) => void;
  disabled: boolean;
}): ReactElement | null {
  const t = useTranslate();
  if (topics.length === 0) return null;
  const options: Array<readonly [string, string]> = [
    ['', t('playbook.aiTemplates.mapping.later')],
    ...teams.map((team) => [String(team.id), team.name] as const),
  ];
  return (
    <fieldset className="flex flex-col gap-2 rounded-md border border-border p-3">
      <legend className="px-1 text-xs font-semibold">
        {t('playbook.aiTemplates.mapping.title')}
      </legend>
      <p className="text-2xs text-content-secondary">{t('playbook.aiTemplates.mapping.hint')}</p>
      <div className="flex flex-wrap gap-3">
        {topics.map((topic) => (
          <Select
            key={topic}
            id={`template-map-${topic}`}
            label={topicLabel(t, topic)}
            value={chosen[topic] ?? ''}
            options={options}
            disabled={disabled}
            onChange={(team) => onChange(topic, team)}
          />
        ))}
      </div>
    </fieldset>
  );
}

function useTeams(enabled: boolean): TeamOption[] {
  const api = useApiClient();
  const teams = useQuery({
    queryKey: ['playbook', 'teams'],
    queryFn: () => api.get<{ items: TeamOption[] }>('/groups'),
    enabled,
  });
  return teams.data?.items ?? [];
}

function InstallPanel({
  template,
  aiAgentId,
  onBack,
  onOpenSkill,
}: {
  template: AiTemplateSummary;
  aiAgentId: string | null;
  onBack: () => void;
  onOpenSkill: (skill: Skill) => void;
}): ReactElement {
  const t = useTranslate();
  const api = useApiClient();
  const queryClient = useQueryClient();
  const scopes = useAuth((s) => s.agent?.scopes ?? []);
  const canEdit = scopes.includes('agents-bot--all:rw');
  const canMapRoutes = scopes.includes('access_rules:rw');
  const [chosen, setChosen] = useState<Record<string, string>>({});
  const teams = useTeams(canMapRoutes && template.topics.length > 0);

  const install = useMutation({
    mutationFn: () => {
      const routeMapping = canMapRoutes ? routeMappingBody(chosen) : undefined;
      return api.post<AiTemplateInstallResult>(`/ai-templates/${template.key}/install`, {
        ai_agent_id: aiAgentId,
        ...(routeMapping ? { route_mapping: routeMapping } : {}),
      });
    },
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: aiTemplatesKey });
      void queryClient.invalidateQueries({ queryKey: ['playbook', 'skills'] });
    },
  });

  const result = install.data;

  return (
    <div className="flex flex-col gap-3">
      <div className="flex items-center justify-between gap-3">
        <button type="button" onClick={onBack} className={quietButton}>
          {t('playbook.aiTemplates.back')}
        </button>
      </div>
      <h3 className="text-sm font-semibold">
        {t('playbook.aiTemplates.installTitle', { name: template.name })}
      </h3>

      {!result && (
        <>
          <p className="text-2xs text-content-secondary">{t('playbook.aiTemplates.installHint')}</p>
          {template.locked && (
            <p className="text-2xs text-warning">{t('playbook.aiTemplates.lockedHint')}</p>
          )}
          {canMapRoutes ? (
            <TeamMapping
              topics={template.topics}
              teams={teams}
              chosen={chosen}
              onChange={(topic, team) => setChosen((old) => ({ ...old, [topic]: team }))}
              disabled={install.isPending}
            />
          ) : (
            template.topics.length > 0 && (
              <p className="text-2xs text-content-secondary">
                {t('playbook.aiTemplates.mapping.noScope')}
              </p>
            )
          )}
          {!canEdit && (
            <p className="text-2xs text-content-secondary">
              {t('playbook.aiTemplates.noInstallScope')}
            </p>
          )}
          {install.isError && (
            <p role="alert" className="text-2xs text-danger">
              {t(installErrorKey(install.error))}
            </p>
          )}
          <div>
            <button
              type="button"
              onClick={() => install.mutate()}
              disabled={!canEdit || !aiAgentId || install.isPending}
              className={primaryButton}
            >
              {install.isPending
                ? t('playbook.aiTemplates.installing')
                : t('playbook.aiTemplates.installConfirm')}
            </button>
          </div>
        </>
      )}

      {result && (
        <div className="flex flex-col gap-3" role="status">
          <p className="text-sm font-medium">
            {result.created
              ? t('playbook.aiTemplates.result.created')
              : t('playbook.aiTemplates.result.existing')}
          </p>
          <p className="text-2xs text-content-secondary">
            {t('playbook.aiTemplates.result.draftHint')}
          </p>
          <PublishBlockers
            unfilled={result.unfilled_placeholders}
            unmapped={result.unmapped_topics}
          />
          <MustFillPanel items={result.tenant_must_fill} />
          <div>
            <button
              type="button"
              onClick={() => onOpenSkill(result.skill)}
              className={primaryButton}
            >
              {t('playbook.aiTemplates.result.openDraft')}
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

/** What still stops publishing: `template_unfilled` and `template_unmapped`, said before the 400 does. */
function PublishBlockers({
  unfilled,
  unmapped,
}: {
  unfilled: string[];
  unmapped: string[];
}): ReactElement | null {
  const t = useTranslate();
  if (unfilled.length === 0 && unmapped.length === 0) {
    return (
      <p className="text-2xs text-success">{t('playbook.aiTemplates.result.readyToPublish')}</p>
    );
  }
  return (
    <div className="flex flex-col gap-2 rounded-md border border-warning/40 bg-warning/5 p-3">
      <p className="text-xs font-semibold">{t('playbook.aiTemplates.result.blockedTitle')}</p>
      {unfilled.length > 0 && (
        <div>
          <p className="text-2xs">{t('playbook.aiTemplates.result.unfilled')}</p>
          <ul className="flex flex-wrap gap-1.5 pt-1">
            {unfilled.map((key) => (
              <li key={key} className="rounded-sm bg-surface-2 px-1.5 py-0.5 font-mono text-2xs">
                {`{${key}}`}
              </li>
            ))}
          </ul>
        </div>
      )}
      {unmapped.length > 0 && (
        <div>
          <p className="text-2xs">{t('playbook.aiTemplates.result.unmapped')}</p>
          <ul className="flex flex-wrap gap-1.5 pt-1">
            {unmapped.map((topic) => (
              <li key={topic} className="rounded-sm bg-surface-2 px-1.5 py-0.5 text-2xs">
                {topicLabel(t, topic)}
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}

function PackPanel({
  aiAgentId,
  onBack,
}: {
  aiAgentId: string | null;
  onBack: () => void;
}): ReactElement {
  const t = useTranslate();
  const api = useApiClient();
  const queryClient = useQueryClient();
  const scopes = useAuth((s) => s.agent?.scopes ?? []);
  const canEdit = scopes.includes('agents-bot--all:rw');
  const canMapRoutes = scopes.includes('access_rules:rw');
  const canCreateGroups = scopes.includes('groups--all:rw');
  const [chosen, setChosen] = useState<Record<string, string>>({});
  const [createGroups, setCreateGroups] = useState(false);
  const teams = useTeams(canMapRoutes);

  const install = useMutation({
    mutationFn: () => {
      const routeMapping = canMapRoutes ? routeMappingBody(chosen) : undefined;
      return api.post<AiTemplatePackInstallResult>(
        `/ai-templates/packs/${IGAMING_PACK_KEY}/install`,
        {
          ai_agent_id: aiAgentId,
          ...(routeMapping ? { route_mapping: routeMapping } : {}),
          ...(canCreateGroups && createGroups ? { create_groups: true } : {}),
        },
      );
    },
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: aiTemplatesKey });
      void queryClient.invalidateQueries({ queryKey: ['playbook', 'skills'] });
    },
  });

  const result = install.data;

  return (
    <div className="flex flex-col gap-3">
      <div>
        <button type="button" onClick={onBack} className={quietButton}>
          {t('playbook.aiTemplates.back')}
        </button>
      </div>
      <h3 className="text-sm font-semibold">{t('playbook.aiTemplates.pack.title')}</h3>

      {!result && (
        <>
          <p className="text-2xs text-content-secondary">{t('playbook.aiTemplates.pack.hint')}</p>
          {canMapRoutes && (
            <TeamMapping
              topics={PACK_TOPICS}
              teams={teams}
              chosen={chosen}
              onChange={(topic, team) => setChosen((old) => ({ ...old, [topic]: team }))}
              disabled={install.isPending}
            />
          )}
          {canCreateGroups ? (
            <label className="flex items-start gap-2 text-sm">
              <input
                type="checkbox"
                checked={createGroups}
                onChange={(event) => setCreateGroups(event.target.checked)}
                className="mt-1"
              />
              <span>
                {t('playbook.aiTemplates.pack.createGroups')}
                <span className="block text-2xs text-content-secondary">
                  {t('playbook.aiTemplates.pack.createGroupsHint')}
                </span>
              </span>
            </label>
          ) : (
            <p className="text-2xs text-content-secondary">
              {t('playbook.aiTemplates.pack.noGroupsScope')}
            </p>
          )}
          {install.isError && (
            <p role="alert" className="text-2xs text-danger">
              {t(installErrorKey(install.error))}
            </p>
          )}
          <div>
            <button
              type="button"
              onClick={() => install.mutate()}
              disabled={!canEdit || !aiAgentId || install.isPending}
              className={primaryButton}
            >
              {install.isPending
                ? t('playbook.aiTemplates.installing')
                : t('playbook.aiTemplates.pack.confirm')}
            </button>
          </div>
        </>
      )}

      {result && <PackResult result={result} />}
    </div>
  );
}

function PackResult({ result }: { result: AiTemplatePackInstallResult }): ReactElement {
  const t = useTranslate();
  const created = result.templates.filter((template) => template.created).length;
  return (
    <div className="flex max-h-[45vh] flex-col gap-3 overflow-y-auto" role="status">
      <p className="text-sm font-medium">{t('playbook.aiTemplates.pack.done')}</p>
      <ul className="list-disc pl-5 text-2xs">
        <li>
          {t('playbook.aiTemplates.pack.resultTemplates', {
            created,
            existing: result.templates.length - created,
          })}
        </li>
        <li>
          {t('playbook.aiTemplates.pack.resultRules', {
            created: result.rules.created.length,
            existing: result.rules.existing,
          })}
        </li>
        <li>
          {t('playbook.aiTemplates.pack.resultRows', {
            created: result.sample_rows.created,
            skipped: result.sample_rows.skipped,
          })}
        </li>
        {result.groups_created.length > 0 && (
          <li>
            {t('playbook.aiTemplates.pack.resultGroups', {
              names: result.groups_created.map((group) => group.name).join(', '),
            })}
          </li>
        )}
      </ul>
      <p className="text-2xs text-content-secondary">
        {t('playbook.aiTemplates.pack.persona', {
          form: result.persona_style.address_form,
          questions: result.persona_style.max_questions_per_message,
        })}
      </p>
      <PublishBlockers unfilled={packUnfilled(result)} unmapped={result.unmapped_topics} />
      <p className="text-2xs text-content-secondary">{t('playbook.aiTemplates.pack.sampleHint')}</p>
    </div>
  );
}
