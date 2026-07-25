/**
 * Playbook — the AI agent's skills and the knowledge they answer from.
 *
 * The editor's shape follows what an admin actually needs to trust automation:
 * write the instruction, see the steps it compiled to, and run it against a
 * real message before anyone else does. The preview uses the same engine that
 * serves customers, so what it shows is what will happen.
 */
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useEffect, useState, type ReactElement } from 'react';
import { Card, ErrorNotice, Page, Section } from '../../components/Page.js';
import { EmptyState } from '../../components/EmptyState.js';
import { VirtualList } from '../../components/VirtualList.js';
import { StatusDot } from '../../components/StatusDot.js';
import { ApiClientError } from '../../lib/api-client.js';
import { useApiClient, useAuth } from '../../lib/auth-store.js';
import { formatDate } from '../../lib/format.js';
import { describeStep, type AiAgent, type KnowledgeSource, type Skill } from './types.js';
import { SkillEditor } from './SkillEditor.js';
import { TemplateGallery } from './TemplateGallery.js';
import { templateToDraft, type SkillTemplate } from './templates.js';
import { countSkillsByTab, filterSkillsByTab, type SkillTab } from './skill-tabs.js';

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

  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [galleryOpen, setGalleryOpen] = useState(false);
  const [tab, setTab] = useState<SkillTab>('all');

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
  const visibleItems = filterSkillsByTab(items, tab);
  const tabCounts = countSkillsByTab(items);

  useEffect(() => {
    if (selectedId && !items.some((s) => s.id === selectedId)) setSelectedId(null);
  }, [items, selectedId]);

  const aiAgent = agents.data?.items.find((a) => a.kind === 'ai_agent') ?? null;

  return (
    <Page
      title="Playbook"
      description="Skills the AI runs on incoming messages, and what it answers from."
      actions={
        canEdit && (
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
        )
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
                    onClick={() => toggleAgent.mutate({ id: aiAgent.id, active: !aiAgent.active })}
                    className="rounded-md border border-border px-2 py-1 text-2xs text-content-secondary transition-colors hover:bg-surface-2"
                  >
                    {aiAgent.active ? 'Pause all skills' : 'Resume'}
                  </button>
                )}
              </div>
              {!aiAgent.active && (
                <p className="border-t border-border px-4 py-2 text-2xs text-warning">
                  Paused — no skill runs, whatever its own switch says.
                </p>
              )}
            </Card>
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
              <Card>
                <div role="tabpanel" id="skills-tabpanel" aria-labelledby={`skills-tab-${tab}`}>
                {skills.isPending ? (
                  <p className="p-4 text-sm text-content-secondary">Loading…</p>
                ) : items.length === 0 ? (
                  <EmptyState
                    title="No skills yet"
                    description="A skill decides what the AI does with an incoming message."
                  />
                ) : visibleItems.length === 0 ? (
                  <EmptyState title="Nothing here" description={EMPTY_BY_TAB[tab]} />
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
                            <span className="block truncate text-sm font-medium">{skill.name}</span>
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

          <KnowledgePanel canEdit={canEdit} aiAgentId={aiAgent?.id ?? null} />

          <TemplateGallery
            open={galleryOpen}
            onClose={() => setGalleryOpen(false)}
            onUse={(template) => createFromTemplate.mutate(template)}
            pendingId={
              createFromTemplate.isPending ? (createFromTemplate.variables?.id ?? null) : null
            }
          />

          {createFromTemplate.isError && (
            <p role="alert" className="text-2xs text-danger">
              {createFromTemplate.error instanceof ApiClientError
                ? createFromTemplate.error.message
                : 'Could not start a skill from that template.'}
            </p>
          )}
        </>
      )}
    </Page>
  );
}

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

  const sources = useQuery({
    queryKey: ['playbook', 'knowledge'],
    queryFn: () => api.get<{ items: KnowledgeSource[] }>('/knowledge-sources'),
  });

  const invalidate = () => void queryClient.invalidateQueries({ queryKey: ['playbook'] });

  const create = useMutation({
    mutationFn: () =>
      api.post<KnowledgeSource>('/knowledge-sources', {
        ai_agent_id: aiAgentId,
        name: name.trim(),
        content: content.trim(),
      }),
    onSuccess: () => {
      setName('');
      setContent('');
      invalidate();
    },
  });

  const remove = useMutation({
    mutationFn: (id: string) => api.delete(`/knowledge-sources/${id}`),
    onSuccess: invalidate,
  });

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
              if (name.trim() && content.trim()) create.mutate();
            }}
            className="flex flex-col gap-2 border-b border-border p-4"
          >
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

            <div className="flex items-center gap-3">
              <button
                type="submit"
                disabled={!name.trim() || !content.trim() || create.isPending}
                className="rounded-md bg-brand-500 px-3 py-1.5 text-sm font-medium text-white transition-colors hover:bg-brand-600 disabled:opacity-50"
              >
                {create.isPending ? 'Indexing…' : 'Add source'}
              </button>
              {create.isError && (
                <span role="alert" className="text-2xs text-danger">
                  Could not add that source.
                </span>
              )}
            </div>
          </form>
        )}

        {sources.isPending ? (
          <p className="p-4 text-sm text-content-secondary">Loading…</p>
        ) : (sources.data?.items.length ?? 0) === 0 ? (
          <EmptyState
            title="Nothing indexed"
            description="Without knowledge, a skill can only send fixed replies."
          />
        ) : (
          <ul className="divide-y divide-border">
            {sources.data!.items.map((source) => (
              <li key={source.id} className="flex items-center gap-3 px-4 py-2.5">
                <div className="min-w-0 flex-1">
                  <p className="truncate text-sm font-medium">{source.name}</p>
                  <p className="text-2xs text-content-tertiary">
                    {source.type} · {source.chunk_count} chunk
                    {source.chunk_count === 1 ? '' : 's'} · {formatDate(source.updated_at)}
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

export { describeStep };
