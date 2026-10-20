/**
 * What a knowledge source's row says about its scope and upkeep (tm 309.3 ·
 * AI-14): who uses it (the audience chips), which brands, until when, who owns
 * it, and whether a person is due to look at it again. Drawn on the Playbook's
 * single list and on the Copilot page, so the two never word one source two ways.
 *
 * "Review needed" and "ended" are warnings of different weight, and the row says
 * so: a source past its review still answers (only a person can clear the
 * badge), a source past its end date answers nothing.
 */
import type { ReactElement } from 'react';
import { formatDate } from '../../lib/format.js';
import { useTranslate } from '../../lib/i18n.js';
import {
  audienceKindOf,
  hasEnded,
  isArticleSource,
  needsReview,
  type AudienceKind,
} from './knowledge-scope.js';
import type { KnowledgeSource } from './types.js';

const CHIP = 'rounded-full border px-2 py-0.5 text-2xs leading-4';
const CHIP_NEUTRAL = `${CHIP} border-border text-content-secondary`;
const CHIP_WARNING = `${CHIP} border-warning text-warning`;

const AUDIENCE_CHIP_KEYS: Record<AudienceKind, string> = {
  both: 'playbook.knowledge.scope.chip.both',
  ai_agent: 'playbook.knowledge.scope.chip.aiAgent',
  agents_only: 'playbook.knowledge.scope.chip.agentsOnly',
};

export function KnowledgeRowMeta({
  source,
  brandNames,
  now = new Date(),
}: {
  source: KnowledgeSource;
  /** Brand id → name; an id not in it (a deleted brand) is shown as a bare "brand". */
  brandNames: ReadonlyMap<string, string>;
  now?: Date;
}): ReactElement {
  const t = useTranslate();
  const kind = audienceKindOf(source);
  const brandIds = source.brand_ids ?? [];
  const due = needsReview(source, now);
  const ended = hasEnded(source, now);

  return (
    <div className="mt-1 flex flex-wrap items-center gap-1.5">
      <span
        className={kind === 'agents_only' ? `${CHIP} border-brand-500 text-content` : CHIP_NEUTRAL}
        title={t(`${AUDIENCE_CHIP_KEYS[kind]}.title`)}
      >
        {t(AUDIENCE_CHIP_KEYS[kind])}
      </span>
      {brandIds.length === 0
        ? null
        : brandIds.map((id) => (
            <span key={id} className={CHIP_NEUTRAL}>
              {brandNames.get(id) ?? t('playbook.knowledge.scope.chip.unknownBrand')}
            </span>
          ))}
      {isArticleSource(source) && (
        <span className={CHIP_NEUTRAL}>{t('playbook.knowledge.scope.chip.article')}</span>
      )}
      {source.valid_until &&
        (ended ? (
          <span className={CHIP_WARNING}>
            {t('playbook.knowledge.scope.chip.ended', {
              date: formatDate(source.valid_until) ?? '',
            })}
          </span>
        ) : (
          <span className={CHIP_NEUTRAL}>
            {t('playbook.knowledge.scope.chip.until', {
              date: formatDate(source.valid_until) ?? '',
            })}
          </span>
        ))}
      {due && (
        <span className={CHIP_WARNING}>{t('playbook.knowledge.scope.chip.reviewNeeded')}</span>
      )}
      <span className="text-2xs text-content-tertiary">
        {source.owner_name
          ? t('playbook.knowledge.scope.ownerLine', { name: source.owner_name })
          : t('playbook.knowledge.scope.noOwnerLine')}
        {source.reviewed_at
          ? ` · ${t('playbook.knowledge.scope.reviewedLine', {
              date: formatDate(source.reviewed_at) ?? '',
            })}`
          : ''}
      </span>
    </div>
  );
}
