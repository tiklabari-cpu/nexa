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
import { ApiClientError } from '../../lib/api-client.js';
import { useApiClient, useAuth } from '../../lib/auth-store.js';
import { formatDate } from '../../lib/format.js';
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
const VIEW_TABS: { id: PlaybookView; label: string }[] = [
  { id: 'performance', label: 'Performance' },
  { id: 'profile', label: 'Profile' },
  { id: 'skills', label: 'Skills' },
  { id: 'knowledge', label: 'Knowledge' },
  { id: 'kb', label: 'Public KB' },
];

/**
 * The tabs split the list the way an admin reasons about it: what the AI runs
 * (✦), what a workspace automation runs (⚡), and what is not on yet (Drafts).
 * The glyphs are decorative — the visible word is what a screen reader reads.
 */
const SKILL_TABS: { id: SkillTab; label: string; glyph?: string }[] = [
  { id: 'all', label: 'All' },
  { id: 'ai', label: 'AI', glyph: '✦' },
  { id: 'workspace', label: 'Workspace', glyph: '⚡' },
  { id: 'drafts', label: 'Drafts' },
];

/**
 * Tab-specific empty copy, shown when the whole list has skills but this tab
 * has none. `all` is only ever non-empty here (if there are skills at all, the
 * All tab holds them), so its copy is a never-reached fallback.
 */
const EMPTY_BY_TAB: Record<SkillTab, string> = {
  all: 'No skills match.',
  ai: 'No AI skills are on yet. Turn a skill on to have the agent run it.',
  workspace: 'No workspace automations yet.',
  drafts: 'No drafts — every skill here is on.',
};

export function PlaybookPage(): ReactElement {
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
      invalidate();
      setSelectedId(skill.id);
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
        old ? { items: [skill, ...old.items.filter((s) => s.id !== skill.id)] } : { items: [skill] },
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
      title="AI Agent"
      description="Persona, the skills it runs, what it answers from, and how it is doing."
      actions={
        canEdit && view === 'skills' ? (
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={() => setGalleryOpen(true)}
              className="rounded-md border border-border px-3 py-1.5 text-sm font-medium text-content-secondary transition-colors hover:bg-surface-2"
            >
              Browse templates
            </button>
            <button
              type="button"
              disabled={createSkill.isPending}
              onClick={() => createSkill.mutate(`New skill ${items.length + 1}`)}
              className="rounded-md bg-brand-500 px-3 py-1.5 text-sm font-medium text-white transition-colors hover:bg-brand-600 disabled:opacity-50"
            >
              {createSkill.isPending ? 'Creating…' : 'New skill'}
            </button>
          </div>
        ) : undefined
      }
    >
      {skills.error || agents.error ? (
        <ErrorNotice message="Could not load the playbook. Check that the API is reachable." />
      ) : (
        <>
          {aiAgent && (
            <Card>
              <div className="flex flex-wrap items-center gap-3 px-4 py-3">
                <div className="min-w-0 flex-1">
                  <p className="text-sm font-medium">{aiAgent.name}</p>
                  <p className="text-2xs text-content-tertiary">
                    {aiAgent.skills_count} skill{aiAgent.skills_count === 1 ? '' : 's'}
                    {aiAgent.tone ? ` · ${aiAgent.tone}` : ''}
                  </p>
                </div>
                <StatusDot
                  tone={aiAgent.active ? 'success' : 'neutral'}
                  label={aiAgent.active ? 'Answering' : 'Paused'}
                />
                {canEdit && (
                  <button
                    type="button"
                    disabled={blockActivation}
                    title={blockActivation ? (readiness.reason ?? undefined) : undefined}
                    onClick={() => toggleAgent.mutate({ id: aiAgent.id, active: !aiAgent.active })}
                    className="rounded-md border border-border px-2 py-1 text-2xs text-content-secondary transition-colors hover:bg-surface-2 disabled:opacity-50"
                  >
                    {aiAgent.active ? 'Pause all skills' : 'Resume'}
                  </button>
                )}
              </div>
              {!aiAgent.active && !blockActivation && (
                <p className="border-t border-border px-4 py-2 text-2xs text-warning">
                  Paused — no skill runs, whatever its own switch says.
                </p>
              )}
              {blockActivation && (
                <p role="alert" className="border-t border-border px-4 py-2 text-2xs text-warning">
                  Not ready to turn on. {readiness.reason}
                </p>
              )}
            </Card>
          )}

          <div role="tablist" aria-label="AI Agent" className="flex gap-1 border-b border-border">
            {VIEW_TABS.map((t) => {
              const active = view === t.id;
              return (
                <button
                  key={t.id}
                  type="button"
                  role="tab"
                  id={`ai-tab-${t.id}`}
                  aria-selected={active}
                  aria-controls="ai-tabpanel"
                  onClick={() => setView(t.id)}
                  className={`-mb-px border-b-2 px-3 py-2 text-sm font-medium transition-colors ${
                    active
                      ? 'border-brand-500 text-content'
                      : 'border-transparent text-content-secondary hover:text-content'
                  }`}
                >
                  {t.label}
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
                <ProfileForm key={aiAgent.id} agent={aiAgent} canEdit={canEdit} onSaved={invalidate} />
              ) : (
                <Card>
                  <EmptyState
                    title="No AI agent"
                    description="Once an AI agent exists on this workspace, its persona is edited here."
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
                      createFromTemplate.isPending ? (createFromTemplate.variables?.id ?? null) : null
                    }
                  />
                )}

                <div className="grid grid-cols-1 gap-4 xl:grid-cols-[minmax(0,360px)_1fr]">
                  <Section title="Skills">
                    {items.length > 0 && (
                      <div role="tablist" aria-label="Skills" className="flex gap-1 border-b border-border">
                        {SKILL_TABS.map((t) => {
                          const active = tab === t.id;
                          return (
                            <button
                              key={t.id}
                              type="button"
                              role="tab"
                              id={`skills-tab-${t.id}`}
                              aria-selected={active}
                              aria-controls="skills-tabpanel"
                              onClick={() => setTab(t.id)}
                              className={`-mb-px flex items-center gap-1 border-b-2 px-3 py-2 text-sm font-medium transition-colors ${
                                active
                                  ? 'border-brand-500 text-content'
                                  : 'border-transparent text-content-secondary hover:text-content'
                              }`}
                            >
                              {t.glyph && (
                                <span aria-hidden="true" className="text-brand-500">
                                  {t.glyph}
                                </span>
                              )}
                              <span>{t.label}</span>
                              <span className="text-2xs text-content-tertiary">{tabCounts[t.id]}</span>
                            </button>
                          );
                        })}
                      </div>
                    )}

                    {items.length > 0 && (
                      <div className="mt-2 flex flex-col gap-2">
                        <label className="flex items-center">
                          <span className="sr-only">Search skills</span>
                          <input
                            type="search"
                            value={search}
                            onChange={(event) => setSearch(event.target.value)}
                            placeholder="Search skills…"
                            className="w-full rounded-md border border-border bg-inset px-3 py-1.5 text-sm outline-none placeholder:text-content-tertiary"
                          />
                        </label>
                        <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
                          <FilterSelect
                            label="Type"
                            value={type}
                            onChange={setType}
                            options={[
                              ['all', 'All types'],
                              ['ai', 'AI'],
                              ['workspace', 'Workspace'],
                            ]}
                          />
                          <FilterSelect
                            label="Status"
                            value={status}
                            onChange={setStatus}
                            options={[
                              ['all', 'Any status'],
                              ['on', 'On'],
                              ['off', 'Off'],
                            ]}
                          />
                          <FilterSelect
                            label="Owner"
                            value={owner}
                            onChange={setOwner}
                            options={ownerOptions.map((option) => [option.value, option.label] as const)}
                          />
                          <FilterSelect
                            label="Sort"
                            value={sort}
                            onChange={setSort}
                            options={[
                              ['name-asc', 'Name A–Z'],
                              ['name-desc', 'Name Z–A'],
                              ['recent', 'Recently updated'],
                              ['runs', 'Most used'],
                            ]}
                          />
                          {hasActiveSkillFilters(controls) && (
                            <button
                              type="button"
                              onClick={clearFilters}
                              className="rounded-md border border-border px-2 py-1 text-2xs text-content-secondary transition-colors hover:bg-surface-2"
                            >
                              Clear
                            </button>
                          )}
                        </div>
                      </div>
                    )}

                    <Card>
                      <div role="tabpanel" id="skills-tabpanel" aria-labelledby={`skills-tab-${tab}`}>
                        {skills.isPending ? (
                          <p className="p-4 text-sm text-content-secondary">Loading…</p>
                        ) : items.length === 0 ? (
                          <EmptyState
                            title="No skills yet"
                            description="A skill decides what the AI does with an incoming message."
                          />
                        ) : tabItems.length === 0 ? (
                          <EmptyState title="Nothing here" description={EMPTY_BY_TAB[tab]} />
                        ) : visibleItems.length === 0 ? (
                          <EmptyState
                            title="No skills match"
                            description="Try a different search, or clear the filters to see them all."
                            action={
                              <button
                                type="button"
                                onClick={clearFilters}
                                className="rounded-md border border-border px-3 py-1.5 text-sm font-medium text-content-secondary transition-colors hover:bg-surface-2"
                              >
                                Clear filters
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
                                      {skill.steps.length} step{skill.steps.length === 1 ? '' : 's'} ·{' '}
                                      {skill.runs_count} run{skill.runs_count === 1 ? '' : 's'}
                                    </span>
                                  </button>

                                  <StatusDot
                                    tone={skill.active ? 'success' : 'neutral'}
                                    label={skill.active ? 'On' : 'Off'}
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
                                      {skill.active ? 'Disable' : 'Enable'}
                                    </button>
                                  )}
                                </div>

                                {!skill.active && skill.steps.length === 0 && (
                                  <p className="px-4 pb-2 text-2xs text-content-tertiary">
                                    Needs at least one step before it can be turned on.
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
                        {toggleSkill.error instanceof ApiClientError
                          ? toggleSkill.error.message
                          : 'Could not change that skill.'}
                      </p>
                    )}
                  </Section>

                  <Section title={selected ? selected.name : 'Editor'}>
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
                          title="No skill selected"
                          description="Pick a skill to write its instruction and preview what it does."
                        />
                      </Card>
                    )}
                  </Section>
                </div>

                {createFromTemplate.isError && (
                  <p role="alert" className="text-2xs text-danger">
                    {createFromTemplate.error instanceof ApiClientError
                      ? createFromTemplate.error.message
                      : 'Could not start a skill from that template.'}
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
const KNOWLEDGE_TAB_LABELS: Record<KnowledgeTab, string> = {
  all: 'All',
  website: 'Websites',
  file: 'Files',
  article: 'Articles',
  faq: 'FAQ',
};

const KNOWLEDGE_TYPE_LABELS: Record<KnowledgeType, string> = {
  website: 'Website',
  file: 'File',
  article: 'Article',
  faq: 'FAQ',
};

function KnowledgePanel({
  canEdit,
  aiAgentId,
}: {
  canEdit: boolean;
  aiAgentId: string | null;
}): ReactElement {
  const api = useApiClient();
  const queryClient = useQueryClient();
  const [name, setName] = useState('');
  const [content, setContent] = useState('');
  const [sourceType, setSourceType] = useState<KnowledgeType>('article');
  const [sourceUrl, setSourceUrl] = useState('');
  const [subtab, setSubtab] = useState<KnowledgeTab>('all');

  const sources = useQuery({
    queryKey: ['playbook', 'knowledge'],
    queryFn: () => api.get<{ items: KnowledgeSource[] }>('/knowledge-sources'),
  });

  const invalidate = () => void queryClient.invalidateQueries({ queryKey: ['playbook'] });

  const isWebsite = sourceType === 'website';
  // A website is crawled from a URL; everything else indexes pasted content.
  const canAdd =
    name.trim().length > 0 && (isWebsite ? sourceUrl.trim().length > 0 : content.trim().length > 0);

  const create = useMutation({
    mutationFn: () =>
      api.post<KnowledgeSource>('/knowledge-sources', {
        ai_agent_id: aiAgentId,
        name: name.trim(),
        type: sourceType,
        ...(isWebsite ? { source_url: sourceUrl.trim() } : { content: content.trim() }),
      }),
    onSuccess: () => {
      setName('');
      setContent('');
      setSourceUrl('');
      invalidate();
    },
  });

  const remove = useMutation({
    mutationFn: (id: string) => api.delete(`/knowledge-sources/${id}`),
    onSuccess: invalidate,
  });

  const allItems = sources.data?.items ?? [];
  const counts = countSourcesByTab(allItems);
  const visible = filterSourcesByTab(allItems, subtab);

  return (
    <Section
      title="Knowledge"
      description="What the AI answers from. Indexed on save, so it is answerable immediately."
    >
      <Card>
        {canEdit && aiAgentId && (
          <form
            onSubmit={(event) => {
              event.preventDefault();
              if (canAdd) create.mutate();
            }}
            className="flex flex-col gap-2 border-b border-border p-4"
          >
            <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
              <label htmlFor="source-name" className="flex flex-col gap-1">
                <span className="text-2xs font-medium uppercase tracking-wide text-content-tertiary">
                  Title
                </span>
                <input
                  id="source-name"
                  value={name}
                  onChange={(event) => setName(event.target.value)}
                  placeholder="Delivery and returns"
                  className="rounded-md border border-border bg-inset px-2 py-1.5 text-sm outline-none placeholder:text-content-tertiary"
                />
              </label>

              {/* Sibling label, not a wrapper: wrapping a <select> folds its
                  option text into the control's accessible name, so it stops
                  being findable by the word "Type" alone. */}
              <div className="flex flex-col gap-1">
                <label
                  htmlFor="source-type"
                  className="text-2xs font-medium uppercase tracking-wide text-content-tertiary"
                >
                  Type
                </label>
                <select
                  id="source-type"
                  value={sourceType}
                  onChange={(event) => setSourceType(event.target.value as KnowledgeType)}
                  className="rounded-md border border-border bg-inset px-2 py-1.5 text-sm text-content outline-none"
                >
                  {KNOWLEDGE_TYPES.map((t) => (
                    <option key={t} value={t}>
                      {KNOWLEDGE_TYPE_LABELS[t]}
                    </option>
                  ))}
                </select>
              </div>
            </div>

            {isWebsite ? (
              <label htmlFor="source-url" className="flex flex-col gap-1">
                <span className="text-2xs font-medium uppercase tracking-wide text-content-tertiary">
                  Website URL
                </span>
                <input
                  id="source-url"
                  value={sourceUrl}
                  onChange={(event) => setSourceUrl(event.target.value)}
                  placeholder="https://example.com/help/delivery"
                  className="rounded-md border border-border bg-inset px-2 py-1.5 text-sm outline-none placeholder:text-content-tertiary"
                />
                <span className="text-2xs text-content-tertiary">
                  Crawled and indexed on save. Private and internal addresses are refused.
                </span>
              </label>
            ) : (
              <label htmlFor="source-content" className="flex flex-col gap-1">
                <span className="text-2xs font-medium uppercase tracking-wide text-content-tertiary">
                  Content
                </span>
                <textarea
                  id="source-content"
                  value={content}
                  onChange={(event) => setContent(event.target.value)}
                  rows={4}
                  placeholder="Standard delivery takes 3 to 5 working days…"
                  className="resize-y rounded-md border border-border bg-inset px-2 py-1.5 text-sm outline-none placeholder:text-content-tertiary"
                />
              </label>
            )}

            <div className="flex items-center gap-3">
              <button
                type="submit"
                disabled={!canAdd || create.isPending}
                className="rounded-md bg-brand-500 px-3 py-1.5 text-sm font-medium text-white transition-colors hover:bg-brand-600 disabled:opacity-50"
              >
                {create.isPending ? (isWebsite ? 'Crawling…' : 'Indexing…') : 'Add source'}
              </button>
              {create.isError && (
                <span role="alert" className="text-2xs text-danger">
                  {create.error instanceof ApiClientError
                    ? create.error.message
                    : 'Could not add that source.'}
                </span>
              )}
            </div>
          </form>
        )}

        <BulkImportForm canEdit={canEdit} aiAgentId={aiAgentId} onImported={invalidate} />

        {allItems.length > 0 && (
          <div
            role="tablist"
            aria-label="Knowledge types"
            className="flex flex-wrap gap-1 border-b border-border px-2"
          >
            {(['all', ...KNOWLEDGE_TYPES] as KnowledgeTab[]).map((t) => {
              const active = subtab === t;
              return (
                <button
                  key={t}
                  type="button"
                  role="tab"
                  aria-selected={active}
                  onClick={() => setSubtab(t)}
                  className={`-mb-px flex items-center gap-1 border-b-2 px-3 py-2 text-sm font-medium transition-colors ${
                    active
                      ? 'border-brand-500 text-content'
                      : 'border-transparent text-content-secondary hover:text-content'
                  }`}
                >
                  <span>{KNOWLEDGE_TAB_LABELS[t]}</span>
                  <span className="text-2xs text-content-tertiary">{counts[t]}</span>
                </button>
              );
            })}
          </div>
        )}

        {sources.isPending ? (
          <p className="p-4 text-sm text-content-secondary">Loading…</p>
        ) : allItems.length === 0 ? (
          <EmptyState
            title="Nothing indexed"
            description="Without knowledge, a skill can only send fixed replies."
          />
        ) : visible.length === 0 ? (
          <EmptyState
            title="Nothing here"
            description={`No ${KNOWLEDGE_TAB_LABELS[subtab].toLowerCase()} sources yet.`}
          />
        ) : (
          <ul className="divide-y divide-border">
            {visible.map((source) => (
              <li key={source.id} className="flex items-center gap-3 px-4 py-2.5">
                <div className="min-w-0 flex-1">
                  <p className="truncate text-sm font-medium">{source.name}</p>
                  <p className="truncate text-2xs text-content-tertiary">
                    {source.type} · {source.chunk_count} chunk
                    {source.chunk_count === 1 ? '' : 's'} · {formatDate(source.updated_at)}
                    {source.source_url ? ` · ${source.source_url}` : ''}
                  </p>
                </div>
                <StatusDot
                  tone={source.chunk_count > 0 ? 'success' : 'warning'}
                  label={source.chunk_count > 0 ? 'Indexed' : 'Empty'}
                />
                {canEdit && (
                  <button
                    type="button"
                    aria-label={`Delete ${source.name}`}
                    onClick={() => remove.mutate(source.id)}
                    className="rounded-md border border-border px-2 py-1 text-2xs text-content-secondary transition-colors hover:bg-surface-2"
                  >
                    Delete
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
