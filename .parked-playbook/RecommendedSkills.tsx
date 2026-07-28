/**
 * Recommended skills (FR-MOD-05.2).
 *
 * Discovery cards on the Playbook page. "Try this" copies the template into a
 * new skill and opens it — the same path as the gallery, so there is one way a
 * template becomes a skill, not two. A card whose skill needs an outside system
 * says so up front, because the alternative is an admin shipping automation that
 * silently cannot do its job.
 *
 * A short list by default with "See more", so the section stays a nudge rather
 * than a wall.
 */
import { useState, type ReactElement } from 'react';
import { Card, Section } from '../../components/Page.js';
import {
  SKILL_TEMPLATES,
  TEMPLATE_CATEGORIES,
  type SkillTemplate,
  type TemplateCategory,
} from './templates.js';

const INITIAL_COUNT = 4;

const CATEGORY_LABEL: Record<TemplateCategory, { label: string; icon: string }> = Object.fromEntries(
  TEMPLATE_CATEGORIES.map((c) => [c.id, { label: c.label, icon: c.icon }]),
) as Record<TemplateCategory, { label: string; icon: string }>;

export function RecommendedSkills({
  onUse,
  pendingId,
}: {
  onUse: (template: SkillTemplate) => void;
  pendingId: string | null;
}): ReactElement {
  const [showAll, setShowAll] = useState(false);
  const visible = showAll ? SKILL_TEMPLATES : SKILL_TEMPLATES.slice(0, INITIAL_COUNT);
  const hasMore = SKILL_TEMPLATES.length > INITIAL_COUNT;

  return (
    <Section
      title="Recommended skills"
      description="Start from one of these — “Try this” copies it into a new skill you can edit."
    >
      <div className="grid grid-cols-1 gap-2 sm:grid-cols-2 xl:grid-cols-3">
        {visible.map((template) => (
          <RecommendedCard
            key={template.id}
            template={template}
            pending={pendingId === template.id}
            onUse={() => onUse(template)}
          />
        ))}
      </div>

      {hasMore && (
        <button
          type="button"
          onClick={() => setShowAll((v) => !v)}
          className="self-start rounded-md border border-border px-3 py-1.5 text-2xs text-content-secondary transition-colors hover:bg-surface-2"
        >
          {showAll ? 'See fewer' : 'See more'}
        </button>
      )}
    </Section>
  );
}

function RecommendedCard({
  template,
  pending,
  onUse,
}: {
  template: SkillTemplate;
  pending: boolean;
  onUse: () => void;
}): ReactElement {
  const category = CATEGORY_LABEL[template.category];
  return (
    <Card>
      <div className="flex h-full flex-col gap-2 p-3">
        <span className="flex items-center gap-1 text-2xs font-medium uppercase tracking-wide text-content-tertiary">
          <span aria-hidden="true">{category.icon}</span>
          {category.label}
        </span>

        <div className="min-w-0 flex-1">
          <p className="text-sm font-medium">{template.name}</p>
          <p className="mt-0.5 text-2xs text-content-secondary">{template.summary}</p>
        </div>

        {template.requiresIntegration && (
          <p className="text-2xs text-warning">
            Needs the {template.requiresIntegration} app connected first.
          </p>
        )}

        <button
          type="button"
          disabled={pending}
          onClick={onUse}
          className="self-start rounded-md border border-border px-3 py-1.5 text-2xs font-medium text-content-secondary transition-colors hover:bg-surface-2 disabled:opacity-50"
        >
          {pending ? 'Opening…' : 'Try this'}
        </button>
      </div>
    </Card>
  );
}
