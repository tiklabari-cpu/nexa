/**
 * Browse templates (FR-MOD-05.1, FR-MOD-05.2, FR-EK-B.1, NFR-P4).
 *
 * A gallery of ready-made skills. Choosing one is choosing a starting point:
 * the dialog closes and the editor opens on a skill already filled from the
 * template, so the admin edits rather than starts from nothing.
 *
 * At 31+ entries a flat grouped list stopped scaling (a long modal, nothing to
 * narrow it with), so the catalogue is windowed through the same `VirtualList`
 * primitive the Skills list uses (T6-a, tm 30) and cut down by a debounced
 * name/summary search plus a category tab — the same arrange-then-narrow shape
 * `skill-filter.ts`/`kb-tabs.ts` use elsewhere in Playbook. Every row is a fixed
 * height (the primitive's one hard requirement) — a template with no
 * `requiresIntegration` still reserves that line, invisible and
 * `aria-hidden`, so a row's height never depends on which fields it happens to
 * carry.
 *
 * The dialog is deliberately small-but-honest about accessibility — labelled,
 * modal, closes on Escape and on a backdrop click, and moves focus in on open —
 * because it is reached from a primary header action and a keyboard user must be
 * able to open it, pick, and leave without a mouse. That contract is unchanged
 * by the search/filter/virtualization work above.
 */
import { useEffect, useRef, useState, type ReactElement } from 'react';
import { EmptyState } from '../../components/EmptyState.js';
import { VirtualList } from '../../components/VirtualList.js';
import {
  findCategoryMeta,
  SKILL_TEMPLATES,
  TEMPLATE_CATEGORIES,
  type SkillTemplate,
  type TemplateCategory,
} from './templates.js';

type GalleryCategoryFilter = TemplateCategory | 'all';

/** Fixed row height (px) the `VirtualList` spacer maths are built on — every row must render at exactly this height. */
const ROW_HEIGHT = 88;

/** How many templates fall under each tab, computed once — the catalogue is a static module constant. */
const CATEGORY_COUNTS: Record<TemplateCategory, number> = { prebuilt: 0, ai: 0, trending: 0 };
for (const template of SKILL_TEMPLATES) CATEGORY_COUNTS[template.category] += 1;

/** Case-insensitive substring match against a card's visible text (name or summary). */
function templateMatchesQuery(template: SkillTemplate, query: string): boolean {
  const needle = query.trim().toLowerCase();
  if (!needle) return true;
  return (
    template.name.toLowerCase().includes(needle) || template.summary.toLowerCase().includes(needle)
  );
}

export function TemplateGallery({
  open,
  onClose,
  onUse,
  pendingId,
}: {
  open: boolean;
  onClose: () => void;
  onUse: (template: SkillTemplate) => void;
  /** Id of the template currently being turned into a skill, if any. */
  pendingId: string | null;
}): ReactElement | null {
  const closeRef = useRef<HTMLButtonElement>(null);
  const [search, setSearch] = useState('');
  const [query, setQuery] = useState('');
  const [category, setCategory] = useState<GalleryCategoryFilter>('all');

  useEffect(() => {
    if (!open) return;
    // A fresh browse every time the gallery opens — a filter left over from a
    // previous visit would otherwise silently hide templates the admin expects
    // to see.
    setSearch('');
    setQuery('');
    setCategory('all');
    closeRef.current?.focus();
    const onKey = (event: KeyboardEvent): void => {
      if (event.key === 'Escape') onClose();
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [open, onClose]);

  // Debounced so filtering the catalogue does not run on every keystroke, the
  // same 200ms beat `skill-filter.ts`'s caller and `kb-tabs.ts`'s caller use.
  useEffect(() => {
    const timer = setTimeout(() => setQuery(search.trim()), 200);
    return () => clearTimeout(timer);
  }, [search]);

  if (!open) return null;

  const categoryTemplates =
    category === 'all' ? SKILL_TEMPLATES : SKILL_TEMPLATES.filter((t) => t.category === category);
  const visibleTemplates = categoryTemplates.filter((t) => templateMatchesQuery(t, query));
  const hasActiveFilters = query.trim() !== '' || category !== 'all';

  const clearFilters = (): void => {
    setSearch('');
    setQuery('');
    setCategory('all');
  };

  return (
    <div
      className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto bg-black/40 p-4 sm:p-8"
      onClick={onClose}
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="template-gallery-title"
        className="w-full max-w-3xl rounded-lg border border-border bg-surface shadow-lg"
        onClick={(event) => event.stopPropagation()}
      >
        <header className="flex items-center justify-between gap-4 border-b border-border px-5 py-3">
          <div>
            <h2 id="template-gallery-title" className="text-sm font-semibold">
              Browse templates
            </h2>
            <p className="text-2xs text-content-tertiary">
              Pick a starting point — it opens in the editor, yours to change.
            </p>
          </div>
          <button
            ref={closeRef}
            type="button"
            onClick={onClose}
            className="rounded-md border border-border px-2 py-1 text-2xs text-content-secondary transition-colors hover:bg-surface-2"
          >
            Close
          </button>
        </header>

        <div className="flex flex-col gap-3 p-5">
          <div role="tablist" aria-label="Template category" className="flex flex-wrap gap-1 border-b border-border">
            <button
              type="button"
              role="tab"
              id="gallery-tab-all"
              aria-selected={category === 'all'}
              aria-controls="gallery-tabpanel"
              onClick={() => setCategory('all')}
              className={`-mb-px flex items-center gap-1 border-b-2 px-3 py-2 text-sm font-medium transition-colors ${
                category === 'all'
                  ? 'border-brand-500 text-content'
                  : 'border-transparent text-content-secondary hover:text-content'
              }`}
            >
              <span>All</span>
              <span className="text-2xs text-content-tertiary">{SKILL_TEMPLATES.length}</span>
            </button>
            {TEMPLATE_CATEGORIES.map((meta) => {
              const active = category === meta.id;
              return (
                <button
                  key={meta.id}
                  type="button"
                  role="tab"
                  id={`gallery-tab-${meta.id}`}
                  aria-selected={active}
                  aria-controls="gallery-tabpanel"
                  onClick={() => setCategory(meta.id)}
                  className={`-mb-px flex items-center gap-1 border-b-2 px-3 py-2 text-sm font-medium transition-colors ${
                    active
                      ? 'border-brand-500 text-content'
                      : 'border-transparent text-content-secondary hover:text-content'
                  }`}
                >
                  <span aria-hidden="true" className="text-content-brand">
                    {meta.icon}
                  </span>
                  <span>{meta.label}</span>
                  <span className="text-2xs text-content-tertiary">{CATEGORY_COUNTS[meta.id]}</span>
                </button>
              );
            })}
          </div>

          <label className="flex items-center">
            <span className="sr-only">Search templates</span>
            <input
              type="search"
              value={search}
              onChange={(event) => setSearch(event.target.value)}
              placeholder="Search templates…"
              className="w-full rounded-md border border-border bg-inset px-3 py-1.5 text-sm outline-none placeholder:text-content-tertiary"
            />
          </label>

          <div
            id="gallery-tabpanel"
            role="tabpanel"
            aria-labelledby={category === 'all' ? 'gallery-tab-all' : `gallery-tab-${category}`}
            className="max-h-[55vh]"
          >
            {visibleTemplates.length === 0 ? (
              <EmptyState
                title="No templates match"
                description="Try a different search, or clear the filters to see them all."
                action={
                  hasActiveFilters && (
                    <button
                      type="button"
                      onClick={clearFilters}
                      className="rounded-md border border-border px-3 py-1.5 text-sm font-medium text-content-secondary transition-colors hover:bg-surface-2"
                    >
                      Clear filters
                    </button>
                  )
                }
              />
            ) : (
              <VirtualList
                items={visibleTemplates}
                rowHeight={ROW_HEIGHT}
                label="Templates"
                maxHeight="55vh"
                renderRow={(template) => (
                  <TemplateRow
                    key={template.id}
                    template={template}
                    pending={pendingId === template.id}
                    onUse={() => onUse(template)}
                  />
                )}
              />
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

function TemplateRow({
  template,
  pending,
  onUse,
}: {
  template: SkillTemplate;
  pending: boolean;
  onUse: () => void;
}): ReactElement {
  const category = findCategoryMeta(template.category);

  return (
    <div
      role="listitem"
      style={{ height: ROW_HEIGHT }}
      className="flex items-center gap-3 overflow-hidden border-b border-border px-1 py-2 last:border-0"
    >
      {category && (
        <span aria-hidden="true" className="shrink-0 text-sm text-content-brand">
          {category.icon}
        </span>
      )}
      <div className="min-w-0 flex-1">
        <p className="truncate text-sm font-medium">{template.name}</p>
        <p className="truncate text-2xs text-content-secondary">{template.summary}</p>
        {template.requiresIntegration ? (
          <p className="truncate text-2xs text-warning">
            Needs the {template.requiresIntegration} app connected.
          </p>
        ) : (
          // Reserves the same line every other row spends on the integration
          // warning, so a card without one is not a shorter row — see the
          // module note on why row height must stay uniform.
          <p aria-hidden="true" className="truncate text-2xs text-transparent">
            &nbsp;
          </p>
        )}
      </div>
      <button
        type="button"
        disabled={pending}
        onClick={onUse}
        className="shrink-0 self-center rounded-md bg-brand-500 px-3 py-1.5 text-2xs font-medium text-white transition-colors hover:bg-brand-600 disabled:opacity-50"
      >
        {pending ? 'Opening…' : 'Use template'}
      </button>
    </div>
  );
}
