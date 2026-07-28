/**
 * The skill list, its tabs (05.3) and its controls (05.4).
 *
 * Split out of `PlaybookPage` so the list is a pure render of `selectSkills`:
 * the page owns the data and the mutations, this owns "which of them do I show,
 * and in what order". The tabs are the view (All / AI / Workspace / Drafts); the
 * toolbar refines the current view by name, type, status and owner, and sorts
 * it. Search is debounced so typing does not re-filter on every keystroke.
 */
import { useEffect, useMemo, useState, type ReactElement } from 'react';
import { Card } from '../../components/Page.js';
import { EmptyState } from '../../components/EmptyState.js';
import { VirtualList } from '../../components/VirtualList.js';
import { StatusDot } from '../../components/StatusDot.js';
import {
  DEFAULT_SKILL_QUERY,
  SKILL_TABS,
  isFiltering,
  ownerOf,
  selectSkills,
  tabCounts,
  UNASSIGNED_OWNER,
  type SkillQuery,
  type SkillSort,
  type SkillStatusFilter,
  type SkillTab,
  type SkillTypeFilter,
} from './skill-filters.js';
import type { Skill } from './types.js';

const SORTS: { id: SkillSort; label: string }[] = [
  { id: 'recent', label: 'Recently updated' },
  { id: 'name', label: 'Name (A–Z)' },
  { id: 'runs', label: 'Most runs' },
];

export function SkillBrowser({
  skills,
  agents,
  selectedId,
  onSelect,
  canEdit,
  onToggleActive,
  togglePending,
  isLoading,
}: {
  skills: Skill[];
  agents: { id: string; name: string }[];
  selectedId: string | null;
  onSelect: (id: string) => void;
  canEdit: boolean;
  onToggleActive: (skill: Skill) => void;
  togglePending: boolean;
  isLoading: boolean;
}): ReactElement {
  const [tab, setTab] = useState<SkillTab>('all');
  const [search, setSearch] = useState('');
  const [debounced, setDebounced] = useState('');
  const [type, setType] = useState<SkillTypeFilter>('any');
  const [status, setStatus] = useState<SkillStatusFilter>('any');
  const [owner, setOwner] = useState('any');
  const [sort, setSort] = useState<SkillSort>('recent');

  // Same 250ms debounce the customers directory uses, so the two search inputs
  // feel identical.
  useEffect(() => {
    const timer = setTimeout(() => setDebounced(search.trim()), 250);
    return () => clearTimeout(timer);
  }, [search]);

  const query: SkillQuery = { tab, search: debounced, type, status, owner, sort };
  const counts = useMemo(() => tabCounts(skills), [skills]);
  const visible = useMemo(() => selectSkills(skills, query), [skills, tab, debounced, type, status, owner, sort]);

  // Owner options come from the skills actually present, named via the agents.
  const ownerOptions = useMemo(() => {
    const present = new Set(skills.map(ownerOf));
    const named = agents
      .filter((a) => present.has(a.id))
      .map((a) => ({ value: a.id, label: a.name }));
    if (present.has(UNASSIGNED_OWNER)) named.push({ value: UNASSIGNED_OWNER, label: 'Unassigned' });
    return named;
  }, [skills, agents]);

  return (
    <div className="flex flex-col gap-3">
      <div role="tablist" aria-label="Skill views" className="flex flex-wrap gap-1 border-b border-border pb-2">
        {SKILL_TABS.map((item) => {
          const selected = tab === item.id;
          return (
            <button
              key={item.id}
              type="button"
              role="tab"
              aria-selected={selected}
              onClick={() => setTab(item.id)}
              className={`flex items-center gap-1.5 rounded-md px-3 py-1.5 text-sm transition-colors ${
                selected
                  ? 'bg-brand-100 font-medium text-brand-700 dark:bg-brand-950 dark:text-content'
                  : 'text-content-secondary hover:bg-surface-2'
              }`}
            >
              {item.icon && <span aria-hidden="true">{item.icon}</span>}
              {item.label}
              <span className="tabular text-2xs text-content-tertiary">{counts[item.id]}</span>
            </button>
          );
        })}
      </div>

      <div className="flex flex-wrap items-center gap-2">
        <label className="min-w-0 flex-1">
          <span className="sr-only">Search skills by name</span>
          <input
            type="search"
            value={search}
            onChange={(event) => setSearch(event.target.value)}
            placeholder="Search skills…"
            className="w-full rounded-md border border-border bg-inset px-3 py-1.5 text-sm outline-none placeholder:text-content-tertiary"
          />
        </label>

        <Select label="Filter by type" value={type} onChange={(v) => setType(v as SkillTypeFilter)}>
          <option value="any">Any type</option>
          <option value="ai_agent">AI</option>
          <option value="workspace">Workspace</option>
        </Select>

        <Select label="Filter by status" value={status} onChange={(v) => setStatus(v as SkillStatusFilter)}>
          <option value="any">Any status</option>
          <option value="live">Live</option>
          <option value="draft">Draft</option>
        </Select>

        {ownerOptions.length > 0 && (
          <Select label="Filter by owner" value={owner} onChange={setOwner}>
            <option value="any">Any owner</option>
            {ownerOptions.map((o) => (
              <option key={o.value} value={o.value}>
                {o.label}
              </option>
            ))}
          </Select>
        )}

        <Select label="Sort skills" value={sort} onChange={(v) => setSort(v as SkillSort)}>
          {SORTS.map((s) => (
            <option key={s.id} value={s.id}>
              {s.label}
            </option>
          ))}
        </Select>
      </div>

      <Card>
        {isLoading ? (
          <p className="p-4 text-sm text-content-secondary">Loading…</p>
        ) : skills.length === 0 ? (
          <EmptyState
            title="No skills yet"
            description="A skill decides what the AI does with an incoming message."
          />
        ) : visible.length === 0 ? (
          <EmptyState
            title={isFiltering(query) ? 'No skills match' : 'Nothing here yet'}
            description={
              isFiltering(query)
                ? 'Try a shorter search, or clear a filter.'
                : 'Skills you create in this view will show up here.'
            }
          />
        ) : (
          <VirtualList
            items={visible}
            rowHeight={56}
            label="Skills"
            renderRow={(skill) => (
              <div key={skill.id} role="listitem" className="border-b border-border last:border-0">
                <div
                  className={`flex items-center gap-2 px-4 py-2.5 ${
                    selectedId === skill.id ? 'bg-brand-100 dark:bg-brand-950' : ''
                  }`}
                >
                  <button
                    type="button"
                    onClick={() => onSelect(skill.id)}
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
                      disabled={togglePending}
                      onClick={() => onToggleActive(skill)}
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
      </Card>
    </div>
  );
}

function Select({
  label,
  value,
  onChange,
  children,
}: {
  label: string;
  value: string;
  onChange: (value: string) => void;
  children: ReactElement | ReactElement[];
}): ReactElement {
  return (
    <label>
      <span className="sr-only">{label}</span>
      <select
        aria-label={label}
        value={value}
        onChange={(event) => onChange(event.target.value)}
        className="rounded-md border border-border bg-inset px-2 py-1.5 text-sm outline-none"
      >
        {children}
      </select>
    </label>
  );
}

export { DEFAULT_SKILL_QUERY };
