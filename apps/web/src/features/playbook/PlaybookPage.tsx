/**
 * AI Agent — persona, the skills it runs, the knowledge it answers from, and how
 * it is performing, under one tabbed surface (FR-MOD-06.1).
 *
 * The editor's shape follows what an admin actually needs to trust automation:
 * write the instruction, see the steps it compiled to, and run it against a
 * real message before anyone else does. The preview uses the same engine that
 * serves customers, so what it shows is what will happen. And the agent is not
 * let live until it has something to answer with — a readiness check the whole
 * page reads from, so an empty agent cannot be switched on to say nothing.
 */
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useEffect, useMemo, useState, type ReactElement } from 'react';
import { Card, ErrorNotice, Page, Section } from '../../components/Page.js';
import { EmptyState } from '../../components/EmptyState.js';
import { VirtualList } from '../../components/VirtualList.js';
import { StatusDot } from '../../components/StatusDot.js';
import { errorMessageKey } from '../../lib/api-client.js';
import { useApiClient, useAuth } from '../../lib/auth-store.js';
import { formatDate } from '../../lib/format.js';
import { FieldError, required, useForm } from '../../lib/form.js';
import { useTranslate } from '../../lib/i18n.js';
import { describeStep, type AiAgent, type KnowledgeSource, type Skill } from './types.js';
import { SkillEditor } from './SkillEditor.js';
import { ProfileForm } from './ProfileForm.js';
import { AiPerformance } from './AiPerformance.js';
import { TemplateGallery } from './TemplateGallery.js';
import { BulkImportForm } from './BulkImportForm.js';
import { RecommendedSkills } from './RecommendedSkills.js';
import { KbArticleList } from './KbArticleList.js';
import { templateToDraft, type SkillTemplate } from './templates.js';
import { countSkillsByTab, filterSkillsByTab, type SkillTab } from './skill-tabs.js';
import {
  applySkillControls,
  hasActiveSkillFilters,
  skillOwnerOptions,
  type SkillControls,
  type SkillOwnerFilter,
  type SkillSort,
  type SkillStatusFilter,
  type SkillTypeFilter,
} from './skill-filter.js';
import { evaluateReadiness } from './readiness.js';
import {
  countSourcesByTab,
  filterSourcesByTab,
  KNOWLEDGE_TYPES,
  type KnowledgeTab,
  type KnowledgeType,
} from './knowledge-tabs.js';

/**
 * The faces of the AI agent (FR-MOD-06.1), in the order the tabs read. `kb` is
 * the Public KB surface (PUBKB-g) — the self-service article list, distinct
 * from the AI's own `knowledge` (what it answers a customer from).
 */
type PlaybookView = 'performance' | 'profile' | 'skills' | 'knowledge' | 'kb';
const VIEW_TABS: readonly PlaybookView[] = ['performance', 'profile', 'skills', 'knowledge', 'kb'];
const VIEW_TAB_LABEL_KEYS: Record<PlaybookView, string> = {
  performance: 'playbook.tabs.performance',
  profile: 'playbook.tabs.profile',
  skills: 'playbook.tabs.skills',
  knowledge: 'playbook.tabs.knowledge',
  kb: 'playbook.tabs.kb',
};

/**
 * The tabs split the list the way an admin reasons about it: what the AI runs
 * (✦), what a workspace automation runs (⚡), and what is not on yet (Drafts).
 * The glyphs are decorative — the visible word is what a screen reader reads.
 */
const SKILL_TABS: { id: SkillTab; labelKey: string; glyph?: string }[] = [
  { id: 'all', labelKey: 'playbook.skillTabs.all' },
  { id: 'ai', labelKey: 'playbook.skillTabs.ai', glyph: '✦' },
  { id: 'workspace', labelKey: 'playbook.skillTabs.workspace', glyph: '⚡' },
  { id: 'drafts', labelKey: 'playbook.skillTabs.drafts' },
];

/**
 * Tab-specific empty copy, shown when the whole list has skills but this tab
 * has none. `all` is only ever non-empty here (if there are skills at all, the
 * All tab holds them), so its copy is a never-reached fallback.
 */
const EMPTY_BY_TAB_KEY: Record<SkillTab, string> = {
  all: 'playbook.skillsEmpty.all',
  ai: 'playbook.skillsEmpty.ai',
  workspace: 'playbook.skillsEmpty.workspace',
  drafts: 'playbook.skillsEmpty.drafts',
};

/** Static English labels `skillOwnerOptions` (skill-filter.ts) mints — mapped to
 * catalog keys here rather than touched at the source, since that file also
 * carries the dynamic, untranslatable agent names and its own pinned-English
 * test. */
const OWNER_LABEL_KEYS: Record<string, string> = {
  'All owners': 'playbook.skills.filterOwnerAll',
  Unassigned: 'playbook.skills.filterOwnerUnassigned',
  'Unknown agent': 'playbook.skills.filterOwnerUnknown',
};

export function PlaybookPage(): ReactElement {
  const t = useTranslate();
  const api = useApiClient();
  const queryClient = useQueryClient();
  const scopes = useAuth((s) => s.agent?.scopes ?? []);
  const canEdit = scopes.includes('agents-bot--all:rw');
  const canViewReports = scopes.includes('reports_read');

  // The AI Agent surface is one place with four tabs (FR-MOD-06.1). Skills is the
  // landing tab — the thing an admin opens the Playbook to do.
  const [view, setView] = useState<PlaybookView>('skills');
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [galleryOpen, setGalleryOpen] = useState(false);
  const [tab, setTab] = useState<SkillTab>('all');

  // List controls (FR-MOD-05.4). `search` is the raw input; it settles into
  // `query` after a beat so filtering a long list does not run on every
  // keystroke. Type/status/owner narrow; sort reorders.
  const [search, setSearch] = useState('');
  const [query, setQuery] = useState('');
  const [type, setType] = useState<SkillTypeFilter>('all');
  const [status, setStatus] = useState<SkillStatusFilter>('all');
  const [owner, setOwner] = useState<SkillOwnerFilter>('all');
  const [sort, setSort] = useState<SkillSort>('name-asc');

  useEffect(() => {
    const timer = setTimeout(() => setQuery(search.trim()), 200);
    return () => clearTimeout(timer);
  }, [search]);

  const skills = useQuery({
    queryKey: ['playbook', 'skills'],
    queryFn: () => api.get<{ items: Skill[] }>('/skills'),
  });

  const agents = useQuery({
    queryKey: ['playbook', 'ai-agents'],
    queryFn: () => api.get<{ items: AiAgent[] }>('/ai-agents'),
  });

  const invalidate = () => void queryClient.invalidateQueries({ queryKey: ['playbook'] });

  const toggleSkill = useMutation({
    mutationFn: ({ id, active }: { id: string; active: boolean }) =>
      api.patch<Skill>(`/skills/${id}`, { active }),
    onSuccess: invalidate,
  });

  const toggleAgent = useMutation({
    mutationFn: ({ id, active }: { id: string; active: boolean }) =>
      api.patch<AiAgent>(`/ai-agents/${id}`, { active }),
    onSuccess: invalidate,
  });

  const createSkill = useMutation({
    mutationFn: (name: string) =>
      api.post<Skill>('/skills', {
        name,
        ...(agents.data?.items.find((a) => a.kind === 'ai_agent')?.id
          ? { ai_agent_id: agents.data.items.find((a) => a.kind === 'ai_agent')!.id }
          : {}),
      }),
    onSuccess: (skill) => {
      // Seed the list cache synchronously *before* selecting — same reason
      // `createFromTemplate` below does: an invalidate alone leaves a render
      // where the refetch is still in flight, `items` does not contain the new
      // id yet, and the guard effect clears the selection right back out from
      // under it before the refetch ever lands. Without this, "New skill"
      // silently never opened its own editor.
      queryClient.setQueryData<{ items: Skill[] }>(['playbook', 'skills'], (old) =>
        old
          ? { items: [skill, ...old.items.filter((s) => s.id !== skill.id)] }
          : { items: [skill] },
      );
      setSelectedId(skill.id);
      invalidate();
    },
  });

  // Minting a skill from a template posts the whole draft — name, instruction
  // and the already-valid compiled steps — so the editor it selects into opens
  // filled in, not blank. The steps are the same shapes `POST /skills` validates
  // (proven in templates.test.ts), so a chosen template never 400s here.
  const createFromTemplate = useMutation({
    mutationFn: (template: SkillTemplate) => {
      const aiAgentId = agents.data?.items.find((a) => a.kind === 'ai_agent')?.id;
      return api.post<Skill>('/skills', {
        ...templateToDraft(template),
        ...(aiAgentId ? { ai_agent_id: aiAgentId } : {}),
      });
    },
    onSuccess: (skill) => {
      // Seed the list cache synchronously *before* selecting: an invalidate
      // alone leaves a render where the refetch is still in flight, and the
      // guard effect below would see the new id missing from `items` and clear
      // the selection out from under us — the editor would never open. With the
      // skill already in the cache, the selection sticks; the invalidate then
      // reconciles ordering with the server.
      queryClient.setQueryData<{ items: Skill[] }>(['playbook', 'skills'], (old) =>
        old
          ? { items: [skill, ...old.items.filter((s) => s.id !== skill.id)] }
          : { items: [skill] },
      );
      setSelectedId(skill.id);
      setGalleryOpen(false);
      invalidate();
    },
  });

  const items = skills.data?.items ?? [];
  // Selection is looked up across the whole list, not the current tab: a skill
  // stays open when you switch tabs, even to a tab that does not contain it.
  const selected = items.find((s) => s.id === selectedId) ?? null;
  const tabCounts = countSkillsByTab(items);

  const controls: SkillControls = { query, type, status, owner, sort };
  // The tab is the coarse cut; the controls refine within it. Owner options are
  // built from the whole list (not the current tab) so the choice survives a
  // tab switch, and resolved to agent names from the roster.
  const agentNameById = useMemo(() => {
    const map = new Map<string, string>();
    for (const agent of agents.data?.items ?? []) map.set(agent.id, agent.name);
    return map;
  }, [agents.data]);
  const ownerOptions = useMemo(
    () => skillOwnerOptions(items, (id) => agentNameById.get(id)),
    [items, agentNameById],
  );
  const tabItems = filterSkillsByTab(items, tab);
  const visibleItems = applySkillControls(tabItems, controls);

  const clearFilters = () => {
    setSearch('');
    setQuery('');
    setType('all');
    setStatus('all');
    setOwner('all');
  };

  useEffect(() => {
    if (selectedId && !items.some((s) => s.id === selectedId)) setSelectedId(null);
  }, [items, selectedId]);

  // If the selected owner disappears from the list (e.g. its last skill was
  // deleted), fall back to All rather than leave the select on a dead value.
  useEffect(() => {
    if (owner !== 'all' && !ownerOptions.some((option) => option.value === owner)) setOwner('all');
  }, [owner, ownerOptions]);

  const aiAgent = agents.data?.items.find((a) => a.kind === 'ai_agent') ?? null;

  // The knowledge list is read here too (React Query dedupes it with the
  // Knowledge tab's own query) so readiness can be judged from the whole agent —
  // knowledge and skills together — wherever the admin currently is.
  const knowledge = useQuery({
    queryKey: ['playbook', 'knowledge'],
    queryFn: () => api.get<{ items: KnowledgeSource[] }>('/knowledge-sources'),
  });
  const readiness = evaluateReadiness(knowledge.data?.items ?? [], items);
  const blockActivation = aiAgent !== null && !aiAgent.active && !readiness.ready;

  return (
    <Page
      title={t('playbook.page.title')}
      description={t('playbook.page.description')}
      actions={
        canEdit && view === 'skills' ? (
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={() => setGalleryOpen(true)}
              className="rounded-md border border-border px-3 py-1.5 text-sm font-medium text-content-secondary transition-colors hover:bg-surface-2"
            >
              {t('playbook.actions.browseTemplates')}
            </button>
            <button
              type="button"
              disabled={createSkill.isPending}
              onClick={() => createSkill.mutate(`New skill ${items.length + 1}`)}
              className="rounded-md bg-brand-500 px-3 py-1.5 text-sm font-medium text-white transition-colors hover:bg-brand-600 disabled:opacity-50"
            >
              {createSkill.isPending
                ? t('playbook.actions.creating')
                : t('playbook.actions.newSkill')}
            </button>
          </div>
        ) : undefined
      }
    >
      {skills.error || agents.error ? (
        <ErrorNotice message={t('playbook.page.loadError')} />
      ) : (
        <>
          {aiAgent && (
            <Card>
              <div className="flex flex-wrap items-center gap-3 px-4 py-3">
                <div className="min-w-0 flex-1">
                  <p className="text-sm font-medium">{aiAgent.name}</p>
                  <p className="text-2xs text-content-tertiary">
                    {t('playbook.agent.skillsCount', { count: aiAgent.skills_count })}
                    {aiAgent.tone ? ` · ${aiAgent.tone}` : ''}
                  </p>
                </div>
                <StatusDot
                  tone={aiAgent.active ? 'success' : 'neutral'}
                  label={
                    aiAgent.active ? t('playbook.agent.answering') : t('playbook.agent.paused')
                  }
                />
                {canEdit && (
                  <button
                    type="button"
                    disabled={blockActivation}
                    title={blockActivation ? t('playbook.agent.notReady') : undefined}
                    onClick={() => toggleAgent.mutate({ id: aiAgent.id, active: !aiAgent.active })}
                    className="rounded-md border border-border px-2 py-1 text-2xs text-content-secondary transition-colors hover:bg-surface-2 disabled:opacity-50"
                  >
                    {aiAgent.active ? t('playbook.agent.pauseAll') : t('playbook.agent.resume')}
                  </button>
                )}
              </div>
              {!aiAgent.active && !blockActivation && (
                <p className="border-t border-border px-4 py-2 text-2xs text-warning">
                  {t('playbook.agent.pausedNote')}
                </p>
              )}
              {blockActivation && (
                <p role="alert" className="border-t border-border px-4 py-2 text-2xs text-warning">
                  {t('playbook.agent.notReady')}
                </p>
              )}
            </Card>
          )}

          <div
            role="tablist"
            aria-label={t('playbook.page.tabsLabel')}
            className="flex gap-1 border-b border-border"
          >
            {VIEW_TABS.map((tabId) => {
              const active = view === tabId;
              return (
                <button
                  key={tabId}
                  type="button"
                  role="tab"
                  id={`ai-tab-${tabId}`}
                  aria-selected={active}
                  aria-controls="ai-tabpanel"
                  onClick={() => setView(tabId)}
                  className={`-mb-px border-b-2 px-3 py-2 text-sm font-medium transition-colors ${
                    active
                      ? 'border-brand-500 text-content'
                      : 'border-transparent text-content-secondary hover:text-content'
                  }`}
                >
                  {t(VIEW_TAB_LABEL_KEYS[tabId])}
                </button>
              );
            })}
          </div>

          <div role="tabpanel" id="ai-tabpanel" aria-labelledby={`ai-tab-${view}`}>
            {view === 'performance' && (
              <AiPerformance agentActive={aiAgent?.active ?? false} canRead={canViewReports} />
            )}

            {view === 'profile' &&
              (aiAgent ? (
                <ProfileForm
                  key={aiAgent.id}
                  agent={aiAgent}
                  canEdit={canEdit}
                  onSaved={invalidate}
                />
              ) : (
                <Card>
                  <EmptyState
                    title={t('playbook.profile.noAgentTitle')}
                    description={t('playbook.profile.noAgentDescription')}
                  />
                </Card>
              ))}

            {view === 'skills' && (
              <div className="flex flex-col gap-4">
                {canEdit && (
                  <RecommendedSkills
                    onTry={(template) => createFromTemplate.mutate(template)}
                    onBrowseAll={() => setGalleryOpen(true)}
                    pendingId={
                      createFromTemplate.isPending
                        ? (createFromTemplate.variables?.id ?? null)
                        : null
                    }
                  />
                )}

                <div className="grid grid-cols-1 gap-4 xl:grid-cols-[minmax(0,360px)_1fr]">
                  <Section title={t('playbook.skills.title')}>
                    {items.length > 0 && (
                      <div
                        role="tablist"
                        aria-label={t('playbook.skills.title')}
                        className="flex gap-1 border-b border-border"
                      >
                        {SKILL_TABS.map((skillTab) => {
                          const active = tab === skillTab.id;
                          return (
                            <button
                              key={skillTab.id}
                              type="button"
                              role="tab"
                              id={`skills-tab-${skillTab.id}`}
                              aria-selected={active}
                              aria-controls="skills-tabpanel"
                              onClick={() => setTab(skillTab.id)}
                              className={`-mb-px flex items-center gap-1 border-b-2 px-3 py-2 text-sm font-medium transition-colors ${
                                active
                                  ? 'border-brand-500 text-content'
                                  : 'border-transparent text-content-secondary hover:text-content'
                              }`}
                            >
                              {skillTab.glyph && (
                                <span aria-hidden="true" className="text-content-brand">
                                  {skillTab.glyph}
                                </span>
                              )}
                              <span>{t(skillTab.labelKey)}</span>
                              <span className="text-2xs text-content-tertiary">
                                {tabCounts[skillTab.id]}
                              </span>
                            </button>
                          );
                        })}
                      </div>
                    )}

                    {items.length > 0 && (
                      <div className="mt-2 flex flex-col gap-2">
                        <label className="flex items-center">
                          <span className="sr-only">{t('playbook.skills.searchLabel')}</span>
                          <input
                            type="search"
                            value={search}
                            onChange={(event) => setSearch(event.target.value)}
                            placeholder={t('playbook.skills.searchPlaceholder')}
                            className="w-full rounded-md border border-border bg-inset px-3 py-1.5 text-sm outline-none placeholder:text-content-tertiary"
                          />
                        </label>
                        <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
                          <FilterSelect
                            label={t('playbook.skills.filterType')}
                            value={type}
                            onChange={setType}
                            options={[
                              ['all', t('playbook.skills.filterTypeAll')],
                              ['ai', t('playbook.skills.filterTypeAi')],
                              ['workspace', t('playbook.skills.filterTypeWorkspace')],
                            ]}
                          />
                          <FilterSelect
                            label={t('playbook.skills.filterStatus')}
                            value={status}
                            onChange={setStatus}
                            options={[
                              ['all', t('playbook.skills.filterStatusAny')],
                              ['on', t('playbook.skills.on')],
                              ['off', t('playbook.skills.off')],
                            ]}
                          />
                          <FilterSelect
                            label={t('playbook.skills.filterOwner')}
                            value={owner}
                            onChange={setOwner}
                            options={ownerOptions.map(
                              (option) =>
                                [
                                  option.value,
                                  OWNER_LABEL_KEYS[option.label]
                                    ? t(OWNER_LABEL_KEYS[option.label]!)
                                    : option.label,
                                ] as const,
                            )}
                          />
                          <FilterSelect
                            label={t('playbook.skills.filterSort')}
                            value={sort}
                            onChange={setSort}
                            options={[
                              ['name-asc', t('playbook.skills.sortNameAsc')],
                              ['name-desc', t('playbook.skills.sortNameDesc')],
                              ['recent', t('playbook.skills.sortRecent')],
                              ['runs', t('playbook.skills.sortRuns')],
                            ]}
                          />
                          {hasActiveSkillFilters(controls) && (
                            <button
                              type="button"
                              onClick={clearFilters}
                              className="rounded-md border border-border px-2 py-1 text-2xs text-content-secondary transition-colors hover:bg-surface-2"
                            >
                              {t('playbook.skills.clear')}
                            </button>
                          )}
                        </div>
                      </div>
                    )}

                    <Card>
                      <div
                        role="tabpanel"
                        id="skills-tabpanel"
                        aria-labelledby={`skills-tab-${tab}`}
                      >
                        {skills.isPending ? (
                          <p className="p-4 text-sm text-content-secondary">
                            {t('playbook.skills.loading')}
                          </p>
                        ) : items.length === 0 ? (
                          <EmptyState
                            title={t('playbook.skills.emptyTitle')}
                            description={t('playbook.skills.emptyDescription')}
                          />
                        ) : tabItems.length === 0 ? (
                          <EmptyState
                            title={t('playbook.skills.nothingHereTitle')}
                            description={t(EMPTY_BY_TAB_KEY[tab])}
                          />
                        ) : visibleItems.length === 0 ? (
                          <EmptyState
                            title={t('playbook.skills.noMatchTitle')}
                            description={t('playbook.skills.noMatchDescription')}
                            action={
                              <button
                                type="button"
                                onClick={clearFilters}
                                className="rounded-md border border-border px-3 py-1.5 text-sm font-medium text-content-secondary transition-colors hover:bg-surface-2"
                              >
                                {t('playbook.skills.clearFilters')}
                              </button>
                            }
                          />
                        ) : (
                          <VirtualList
                            items={visibleItems}
                            rowHeight={56}
                            label="Skills"
                            renderRow={(skill) => (
                              <div
                                key={skill.id}
                                role="listitem"
                                className="border-b border-border last:border-0"
                              >
                                <div
                                  className={`flex items-center gap-2 px-4 py-2.5 ${
                                    selectedId === skill.id ? 'bg-brand-100 dark:bg-brand-950' : ''
                                  }`}
                                >
                                  <button
                                    type="button"
                                    onClick={() => setSelectedId(skill.id)}
                                    className="min-w-0 flex-1 text-left"
                                  >
                                    <span className="block truncate text-sm font-medium">
                                      {skill.name}
                                    </span>
                                    <span className="block text-2xs text-content-tertiary">
                                      {t('playbook.skills.stepsCount', {
                                        count: skill.steps.length,
                                      })}{' '}
                                      ·{' '}
                                      {t('playbook.skills.runsCount', { count: skill.runs_count })}
                                    </span>
                                  </button>

                                  <StatusDot
                                    tone={skill.active ? 'success' : 'neutral'}
                                    label={
                                      skill.active
                                        ? t('playbook.skills.on')
                                        : t('playbook.skills.off')
                                    }
                                  />

                                  {canEdit && (
                                    <button
                                      type="button"
                                      disabled={toggleSkill.isPending}
                                      onClick={() =>
                                        toggleSkill.mutate({ id: skill.id, active: !skill.active })
                                      }
                                      className="rounded-md border border-border px-2 py-1 text-2xs text-content-secondary transition-colors hover:bg-surface-2 disabled:opacity-50"
                                    >
                                      {skill.active
                                        ? t('playbook.skills.disable')
                                        : t('playbook.skills.enable')}
                                    </button>
                                  )}
                                </div>

                                {!skill.active && skill.steps.length === 0 && (
                                  <p className="px-4 pb-2 text-2xs text-content-tertiary">
                                    {t('playbook.skills.needsStep')}
                                  </p>
                                )}
                              </div>
                            )}
                          />
                        )}
                      </div>
                    </Card>

                    {toggleSkill.isError && (
                      <p role="alert" className="text-2xs text-danger">
                        {t(errorMessageKey(toggleSkill.error))}
                      </p>
                    )}
                  </Section>

                  <Section title={selected ? selected.name : t('playbook.skills.editorTitle')}>
                    {selected ? (
                      <SkillEditor
                        key={selected.id}
                        skill={selected}
                        canEdit={canEdit}
                        onSaved={invalidate}
                      />
                    ) : (
                      <Card>
                        <EmptyState
                          title={t('playbook.skills.noSelectionTitle')}
                          description={t('playbook.skills.noSelectionDescription')}
                        />
                      </Card>
                    )}
                  </Section>
                </div>

                {createFromTemplate.isError && (
                  <p role="alert" className="text-2xs text-danger">
                    {t(errorMessageKey(createFromTemplate.error))}
                  </p>
                )}
              </div>
            )}

            {view === 'knowledge' && (
              <KnowledgePanel canEdit={canEdit} aiAgentId={aiAgent?.id ?? null} />
            )}

            {view === 'kb' && <KbArticleList canEdit={canEdit} />}
          </div>

          <TemplateGallery
            open={galleryOpen}
            onClose={() => setGalleryOpen(false)}
            onUse={(template) => createFromTemplate.mutate(template)}
            pendingId={
              createFromTemplate.isPending ? (createFromTemplate.variables?.id ?? null) : null
            }
          />
        </>
      )}
    </Page>
  );
}

/** Labels for the knowledge sub-tabs (FR-MOD-06.3.1). */
const KNOWLEDGE_TAB_LABEL_KEYS: Record<KnowledgeTab, string> = {
  all: 'playbook.knowledge.tabAll',
  website: 'playbook.knowledge.tabWebsite',
  file: 'playbook.knowledge.tabFile',
  article: 'playbook.knowledge.tabArticle',
  faq: 'playbook.knowledge.tabFaq',
};

const KNOWLEDGE_TYPE_LABEL_KEYS: Record<KnowledgeType, string> = {
  website: 'playbook.knowledge.typeWebsite',
  file: 'playbook.knowledge.typeFile',
  article: 'playbook.knowledge.typeArticle',
  faq: 'playbook.knowledge.typeFaq',
};

function KnowledgePanel({
  canEdit,
  aiAgentId,
}: {
  canEdit: boolean;
  aiAgentId: string | null;
}): ReactElement {
  const t = useTranslate();
  const api = useApiClient();
  const queryClient = useQueryClient();
  const [sourceType, setSourceType] = useState<KnowledgeType>('article');
  const [subtab, setSubtab] = useState<KnowledgeTab>('all');

  const sources = useQuery({
    queryKey: ['playbook', 'knowledge'],
    queryFn: () => api.get<{ items: KnowledgeSource[] }>('/knowledge-sources'),
  });

  const invalidate = () => void queryClient.invalidateQueries({ queryKey: ['playbook'] });

  // A website is crawled from a URL; everything else indexes pasted content.
  const isWebsite = sourceType === 'website';

  const create = useMutation({
    mutationFn: (body: { name: string; type: KnowledgeType; sourceUrl: string; content: string }) =>
      api.post<KnowledgeSource>('/knowledge-sources', {
        ai_agent_id: aiAgentId,
        name: body.name,
        type: body.type,
        ...(body.type === 'website' ? { source_url: body.sourceUrl } : { content: body.content }),
      }),
    onSuccess: invalidate,
  });

  const remove = useMutation({
    mutationFn: (id: string) => api.delete(`/knowledge-sources/${id}`),
    onSuccess: invalidate,
  });

  const form = useForm({
    initial: { name: '', sourceUrl: '', content: '' },
    validators: {
      name: required(t('playbook.knowledge.formTitleRequiredError')),
      sourceUrl: isWebsite ? required(t('playbook.knowledge.formUrlRequiredError')) : undefined,
      content: isWebsite ? undefined : required(t('playbook.knowledge.formContentRequiredError')),
    },
    onSubmit: async (values, { setSubmitError, reset }) => {
      try {
        await create.mutateAsync({
          name: values.name.trim(),
          type: sourceType,
          sourceUrl: values.sourceUrl.trim(),
          content: values.content.trim(),
        });
        reset();
      } catch (error) {
        setSubmitError(t(errorMessageKey(error)));
      }
    },
  });
  const nameError = form.errorFor('name');
  const sourceUrlError = form.errorFor('sourceUrl');
  const contentError = form.errorFor('content');

  const allItems = sources.data?.items ?? [];
  const counts = countSourcesByTab(allItems);
  const visible = filterSourcesByTab(allItems, subtab);

  return (
    <Section
      title={t('playbook.knowledge.title')}
      description={t('playbook.knowledge.description')}
    >
      <Card>
        {canEdit && aiAgentId && (
          <form
            onSubmit={form.handleSubmit}
            noValidate
            className="flex flex-col gap-2 border-b border-border p-4"
          >
            <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
              <label htmlFor="source-name" className="flex flex-col gap-1">
                <span className="text-2xs font-medium uppercase tracking-wide text-content-tertiary">
                  {t('playbook.knowledge.formTitle')}
                </span>
                <input
                  id="source-name"
                  value={form.values.name}
                  onChange={(event) => form.setValue('name', event.target.value)}
                  onBlur={() => form.blur('name')}
                  aria-invalid={nameError ? true : undefined}
                  aria-describedby={nameError ? 'source-name-error' : undefined}
                  placeholder={t('playbook.knowledge.formTitlePlaceholder')}
                  className="rounded-md border border-border bg-inset px-2 py-1.5 text-sm outline-none placeholder:text-content-tertiary"
                />
                <FieldError id="source-name-error" message={nameError} />
              </label>

              {/* Sibling label, not a wrapper: wrapping a <select> folds its
                  option text into the control's accessible name, so it stops
                  being findable by the word "Type" alone. */}
              <div className="flex flex-col gap-1">
                <label
                  htmlFor="source-type"
                  className="text-2xs font-medium uppercase tracking-wide text-content-tertiary"
                >
                  {t('playbook.knowledge.formType')}
                </label>
                <select
                  id="source-type"
                  value={sourceType}
                  onChange={(event) => setSourceType(event.target.value as KnowledgeType)}
                  className="rounded-md border border-border bg-inset px-2 py-1.5 text-sm text-content outline-none"
                >
                  {KNOWLEDGE_TYPES.map((knowledgeType) => (
                    <option key={knowledgeType} value={knowledgeType}>
                      {t(KNOWLEDGE_TYPE_LABEL_KEYS[knowledgeType])}
                    </option>
                  ))}
                </select>
              </div>
            </div>

            {isWebsite ? (
              <label htmlFor="source-url" className="flex flex-col gap-1">
                <span className="text-2xs font-medium uppercase tracking-wide text-content-tertiary">
                  {t('playbook.knowledge.formUrl')}
                </span>
                <input
                  id="source-url"
                  value={form.values.sourceUrl}
                  onChange={(event) => form.setValue('sourceUrl', event.target.value)}
                  onBlur={() => form.blur('sourceUrl')}
                  aria-invalid={sourceUrlError ? true : undefined}
                  aria-describedby={sourceUrlError ? 'source-url-error' : undefined}
                  placeholder={t('playbook.knowledge.formUrlPlaceholder')}
                  className="rounded-md border border-border bg-inset px-2 py-1.5 text-sm outline-none placeholder:text-content-tertiary"
                />
                <span className="text-2xs text-content-tertiary">
                  {t('playbook.knowledge.formUrlHelp')}
                </span>
                <FieldError id="source-url-error" message={sourceUrlError} />
              </label>
            ) : (
              <label htmlFor="source-content" className="flex flex-col gap-1">
                <span className="text-2xs font-medium uppercase tracking-wide text-content-tertiary">
                  {t('playbook.knowledge.formContent')}
                </span>
                <textarea
                  id="source-content"
                  value={form.values.content}
                  onChange={(event) => form.setValue('content', event.target.value)}
                  onBlur={() => form.blur('content')}
                  rows={4}
                  aria-invalid={contentError ? true : undefined}
                  aria-describedby={contentError ? 'source-content-error' : undefined}
                  placeholder={t('playbook.knowledge.formContentPlaceholder')}
                  className="resize-y rounded-md border border-border bg-inset px-2 py-1.5 text-sm outline-none placeholder:text-content-tertiary"
                />
                <FieldError id="source-content-error" message={contentError} />
              </label>
            )}

            <div className="flex items-center gap-3">
              <button
                type="submit"
                disabled={!form.canSubmit}
                className="rounded-md bg-brand-500 px-3 py-1.5 text-sm font-medium text-white transition-colors hover:bg-brand-600 disabled:opacity-50"
              >
                {form.isSubmitting
                  ? isWebsite
                    ? t('playbook.knowledge.crawling')
                    : t('playbook.knowledge.indexing')
                  : t('playbook.knowledge.addSource')}
              </button>
              {form.submitError && (
                <span role="alert" className="text-2xs text-danger">
                  {form.submitError}
                </span>
              )}
            </div>
          </form>
        )}

        <BulkImportForm canEdit={canEdit} aiAgentId={aiAgentId} onImported={invalidate} />

        {allItems.length > 0 && (
          <div
            role="tablist"
            aria-label={t('playbook.knowledge.tabsLabel')}
            className="flex flex-wrap gap-1 border-b border-border px-2"
          >
            {(['all', ...KNOWLEDGE_TYPES] as KnowledgeTab[]).map((knowledgeTab) => {
              const active = subtab === knowledgeTab;
              return (
                <button
                  key={knowledgeTab}
                  type="button"
                  role="tab"
                  aria-selected={active}
                  onClick={() => setSubtab(knowledgeTab)}
                  className={`-mb-px flex items-center gap-1 border-b-2 px-3 py-2 text-sm font-medium transition-colors ${
                    active
                      ? 'border-brand-500 text-content'
                      : 'border-transparent text-content-secondary hover:text-content'
                  }`}
                >
                  <span>{t(KNOWLEDGE_TAB_LABEL_KEYS[knowledgeTab])}</span>
                  <span className="text-2xs text-content-tertiary">{counts[knowledgeTab]}</span>
                </button>
              );
            })}
          </div>
        )}

        {sources.isPending ? (
          <p className="p-4 text-sm text-content-secondary">{t('playbook.knowledge.loading')}</p>
        ) : allItems.length === 0 ? (
          <EmptyState
            title={t('playbook.knowledge.emptyTitle')}
            description={t('playbook.knowledge.emptyDescription')}
          />
        ) : visible.length === 0 ? (
          <EmptyState
            title={t('playbook.skills.nothingHereTitle')}
            description={t('playbook.knowledge.noneInTab', {
              type: t(KNOWLEDGE_TAB_LABEL_KEYS[subtab]),
            })}
          />
        ) : (
          <ul className="divide-y divide-border">
            {visible.map((source) => (
              <li key={source.id} className="flex items-center gap-3 px-4 py-2.5">
                <div className="min-w-0 flex-1">
                  <p className="truncate text-sm font-medium">{source.name}</p>
                  <p className="truncate text-2xs text-content-tertiary">
                    {KNOWLEDGE_TYPE_LABEL_KEYS[source.type as KnowledgeType]
                      ? t(KNOWLEDGE_TYPE_LABEL_KEYS[source.type as KnowledgeType])
                      : source.type}{' '}
                    · {t('playbook.knowledge.chunkCount', { count: source.chunk_count })} ·{' '}
                    {formatDate(source.updated_at)}
                    {source.source_url ? ` · ${source.source_url}` : ''}
                  </p>
                </div>
                <StatusDot
                  tone={source.chunk_count > 0 ? 'success' : 'warning'}
                  label={
                    source.chunk_count > 0
                      ? t('playbook.knowledge.indexed')
                      : t('playbook.knowledge.empty')
                  }
                />
                {canEdit && (
                  <button
                    type="button"
                    aria-label={t('playbook.knowledge.deleteLabel', { name: source.name })}
                    onClick={() => remove.mutate(source.id)}
                    className="rounded-md border border-border px-2 py-1 text-2xs text-content-secondary transition-colors hover:bg-surface-2"
                  >
                    {t('playbook.knowledge.delete')}
                  </button>
                )}
              </li>
            ))}
          </ul>
        )}
      </Card>
    </Section>
  );
}

/**
 * A labelled <select> for one list-control axis. Generic over its value type so
 * each control keeps its own union (SkillTypeFilter, SkillSort, …) end to end,
 * with no `any` at the callsite.
 */
function FilterSelect<T extends string>({
  label,
  value,
  onChange,
  options,
}: {
  label: string;
  value: T;
  onChange: (value: T) => void;
  options: readonly (readonly [T, string])[];
}): ReactElement {
  const id = `skill-filter-${label.toLowerCase()}`;
  // The label is a sibling tied by htmlFor, not a wrapper: wrapping the <select>
  // folds its option text ("Name A–Z"…) into the control's accessible name,
  // which then collides with getByLabel('Name') in the editor. A sibling label
  // keeps the accessible name exactly the axis word ("Sort", "Type", …).
  return (
    <span className="inline-flex items-center gap-1.5 text-2xs text-content-tertiary">
      <label htmlFor={id}>{label}</label>
      <select
        id={id}
        value={value}
        onChange={(event) => onChange(event.target.value as T)}
        className="rounded-md border border-border bg-inset px-2 py-1 text-xs text-content outline-none"
      >
        {options.map(([optionValue, optionLabel]) => (
          <option key={optionValue} value={optionValue}>
            {optionLabel}
          </option>
        ))}
      </select>
    </span>
  );
}

export { describeStep };
