/**
 * Recommended skills (FR-MOD-05.2).
 *
 * A short, always-visible strip of starting points on the Playbook page — the
 * discovery counterpart to the "Browse templates" gallery. Each card names its
 * category (Prebuilt ◆ / AI ✦ / Trending ↗) so an admin can tell a canned answer
 * from an assistant-driven one at a glance, and "Try this" copies the template
 * into a real, editable skill exactly as the gallery's "Use template" does — the
 * same `onUse` round trip, so the admin lands in a pre-filled editor either way.
 * "See more" opens the full gallery when the shortlist is not enough.
 *
 * A card whose skill needs an external system says so before you pick it: a "Try
 * this" that quietly minted a skill that could never resolve would be a trap.
 */
import type { ReactElement } from 'react';
import { Section } from '../../components/Page.js';
import { findCategoryMeta, recommendedTemplates, type SkillTemplate } from './templates.js';

export function RecommendedSkills({
  onTry,
  onBrowseAll,
  pendingId,
}: {
  /** Copy the template into a skill and open it — same contract as the gallery. */
  onTry: (template: SkillTemplate) => void;
  /** Open the full "Browse templates" gallery ("See more"). */
  onBrowseAll: () => void;
  /** Id of the template currently being turned into a skill, if any. */
  pendingId: string | null;
}): ReactElement {
  const templates = recommendedTemplates();

  return (
    <Section
      title="Recommended skills"
      description="Ready-made starting points — try one, then make it yours."
    >
      <div
        role="list"
        aria-label="Recommended skills"
        className="grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-3"
      >
        {templates.map((template) => (
          <RecommendedCard
            key={template.id}
            template={template}
            pending={pendingId === template.id}
            onTry={() => onTry(template)}
          />
        ))}
      </div>

      <button
        type="button"
        onClick={onBrowseAll}
        className="self-start rounded-md border border-border px-3 py-1.5 text-2xs font-medium text-content-secondary transition-colors hover:bg-surface-2"
      >
        See more
      </button>
    </Section>
  );
}

function RecommendedCard({
  template,
  pending,
  onTry,
}: {
  template: SkillTemplate;
  pending: boolean;
  onTry: () => void;
}): ReactElement {
  const category = findCategoryMeta(template.category);

  return (
    <div
      role="listitem"
      className="flex flex-col gap-2 rounded-lg border border-border bg-surface p-3 shadow-xs"
    >
      {category && (
        <span className="flex items-center gap-1 text-2xs font-medium uppercase tracking-wide text-content-tertiary">
          <span aria-hidden="true" className="text-brand-500">
            {category.icon}
          </span>
          {category.label}
        </span>
      )}

      <div className="min-w-0 flex-1">
        <p className="text-sm font-medium">{template.name}</p>
        <p className="mt-0.5 text-2xs text-content-secondary">{template.summary}</p>
      </div>

      {template.requiresIntegration && (
        <p className="text-2xs text-warning">
          Needs the {template.requiresIntegration} app connected.
        </p>
      )}

      <button
        type="button"
        disabled={pending}
        onClick={onTry}
        className="self-start rounded-md bg-brand-500 px-3 py-1.5 text-2xs font-medium text-white transition-colors hover:bg-brand-600 disabled:opacity-50"
      >
        {pending ? 'Opening…' : 'Try this'}
      </button>
    </div>
  );
}
