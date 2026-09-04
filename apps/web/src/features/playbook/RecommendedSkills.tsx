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
import { useTranslate } from '../../lib/i18n.js';
import {
  findCategoryMeta,
  recommendedTemplates,
  type SkillTemplate,
  type TemplateBadge,
  type TemplateCategory,
} from './templates.js';

/** Mirrors TemplateGallery.tsx's own copy — see that file's note on why the
 * small Record is duplicated rather than shared. */
const CATEGORY_LABEL_KEYS: Record<TemplateCategory, string> = {
  prebuilt: 'playbook.category.prebuilt',
  ai: 'playbook.category.ai',
  trending: 'playbook.category.trending',
};

/** Mirrors TemplateGallery.tsx's own copy. A highlight, not a category (FR-MOD-05.2) —
 * so it never borrows the category's brand colour or its `text-content-tertiary` chrome. */
const BADGE_LABEL_KEYS: Record<TemplateBadge, string> = {
  popular: 'playbook.badge.popular',
  essential: 'playbook.badge.essential',
};

/** Reuses existing status tokens (already AA-checked in tokens.test.ts) rather than
 * minting a new colour for a two-value highlight. */
const BADGE_CLASSES: Record<TemplateBadge, string> = {
  popular: 'bg-info/10 text-info',
  essential: 'bg-ai/10 text-ai',
};

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
  const t = useTranslate();
  const templates = recommendedTemplates();

  return (
    <Section
      title={t('playbook.recommended.title')}
      description={t('playbook.recommended.description')}
    >
      <div
        role="list"
        aria-label={t('playbook.recommended.listLabel')}
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
        {t('playbook.recommended.seeMore')}
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
  const t = useTranslate();
  const category = findCategoryMeta(template.category);

  return (
    <div
      role="listitem"
      className="flex flex-col gap-2 rounded-lg border border-border bg-surface p-3 shadow-xs"
    >
      {(category || template.badge) && (
        <div className="flex items-center justify-between gap-1">
          {category && (
            <span className="flex items-center gap-1 text-2xs font-medium uppercase tracking-wide text-content-tertiary">
              <span aria-hidden="true" className="text-content-brand">
                {category.icon}
              </span>
              {t(CATEGORY_LABEL_KEYS[category.id])}
            </span>
          )}
          {template.badge && (
            <span
              className={`shrink-0 rounded-sm px-1.5 py-0.5 text-2xs font-medium ${BADGE_CLASSES[template.badge]}`}
            >
              {t(BADGE_LABEL_KEYS[template.badge])}
            </span>
          )}
        </div>
      )}

      <div className="min-w-0 flex-1">
        <p className="text-sm font-medium">{t(`playbook.template.${template.id}.name`)}</p>
        <p className="mt-0.5 text-2xs text-content-secondary">
          {t(`playbook.template.${template.id}.summary`)}
        </p>
      </div>

      {template.requiresIntegration && (
        <p className="text-2xs text-warning">
          {t('playbook.common.needsIntegration', { app: template.requiresIntegration })}
        </p>
      )}

      <button
        type="button"
        disabled={pending}
        onClick={onTry}
        className="self-start rounded-md bg-brand-500 px-3 py-1.5 text-2xs font-medium text-white transition-colors hover:bg-brand-600 disabled:opacity-50"
      >
        {pending ? t('playbook.common.opening') : t('playbook.recommended.tryThis')}
      </button>
    </div>
  );
}
