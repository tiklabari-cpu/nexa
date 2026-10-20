/**
 * The fields that say who a knowledge source is for and who keeps it true
 * (tm 309.3 · AI-14), shared by the "Add source" form and the edit dialog.
 *
 * - **Who uses it** — the AI agent's answers to players, Copilot's drafts for
 *   agents, or both. Copilot alone is "for agents only" and never reaches a
 *   player; the field says so in place, since that is the one consequence an
 *   admin cannot read off the words "Copilot" and "AI agent".
 * - **Brands** — none ticked is every brand. A brand's own rule never reaches
 *   another brand's player, so the help line states the default rather than
 *   leaving an empty list to be read as "nobody".
 * - **Valid until**, **owner**, **language**, **review every N days** — the
 *   source's upkeep (AI-14-S3).
 *
 * A published KB article's source takes its audiences, brands and end date from
 * the article (`reach: false`), so those fields are not drawn — only the upkeep
 * ones are editable here.
 */
import { useQuery } from '@tanstack/react-query';
import type { ReactElement } from 'react';
import { KNOWLEDGE_AUDIENCES, KNOWLEDGE_REVIEW_INTERVAL_DAYS } from '@siyahtus/types';
import { FieldError } from '../../lib/form.js';
import { useApiClient } from '../../lib/auth-store.js';
import { useTranslate } from '../../lib/i18n.js';
import { isValidReviewInterval, type KnowledgeScopeValue } from './knowledge-scope.js';

interface NamedOption {
  id: string;
  name: string | null;
}

const INPUT =
  'rounded-md border border-border bg-inset px-2 py-1.5 text-sm text-content outline-none disabled:opacity-60';
const LABEL = 'text-2xs font-medium uppercase tracking-wide text-content-tertiary';

/** Brands and members, read once for every place a scope is drawn. */
export function useKnowledgeScopeOptions(enabled = true): {
  brands: NamedOption[];
  members: NamedOption[];
} {
  const api = useApiClient();
  const brands = useQuery({
    queryKey: ['brands'],
    queryFn: () => api.get<{ items: NamedOption[] }>('/brands'),
    staleTime: 60_000,
    enabled,
  });
  const members = useQuery({
    queryKey: ['team', 'agents'],
    queryFn: () => api.get<{ items: NamedOption[] }>('/agents'),
    staleTime: 60_000,
    enabled,
  });
  return { brands: brands.data?.items ?? [], members: members.data?.items ?? [] };
}

export function KnowledgeScopeFields({
  idPrefix,
  value,
  onChange,
  reach = true,
  disabled = false,
  intervalError,
}: {
  /** Distinguishes the ids when two forms can be on screen (the add form and an edit dialog). */
  idPrefix: string;
  value: KnowledgeScopeValue;
  onChange: (next: KnowledgeScopeValue) => void;
  /** False for a KB article's source: its audiences, brands and end come from the article. */
  reach?: boolean;
  disabled?: boolean;
  intervalError?: string | null;
}): ReactElement {
  const t = useTranslate();
  const { brands, members } = useKnowledgeScopeOptions();

  const copilotOnly = value.audiences.length === 1 && value.audiences[0] === 'copilot';

  function toggleAudience(audience: (typeof KNOWLEDGE_AUDIENCES)[number], on: boolean): void {
    const next = on
      ? KNOWLEDGE_AUDIENCES.filter((a) => a === audience || value.audiences.includes(a))
      : value.audiences.filter((a) => a !== audience);
    onChange({ ...value, audiences: next });
  }

  function toggleBrand(id: string, on: boolean): void {
    onChange({
      ...value,
      brandIds: on ? [...value.brandIds, id] : value.brandIds.filter((b) => b !== id),
    });
  }

  return (
    <div className="flex flex-col gap-3">
      {reach && (
        <fieldset className="flex flex-col gap-1" disabled={disabled}>
          <legend className={LABEL}>{t('playbook.knowledge.scope.audiencesLabel')}</legend>
          <div className="flex flex-wrap gap-x-4 gap-y-1">
            {KNOWLEDGE_AUDIENCES.map((audience) => (
              <label key={audience} className="flex items-center gap-1.5 text-sm">
                <input
                  type="checkbox"
                  checked={value.audiences.includes(audience)}
                  onChange={(event) => toggleAudience(audience, event.target.checked)}
                />
                {t(`playbook.knowledge.scope.audience.${audience}`)}
              </label>
            ))}
          </div>
          <p
            className={`text-2xs ${
              value.audiences.length === 0 ? 'text-danger' : 'text-content-tertiary'
            }`}
            role={value.audiences.length === 0 ? 'alert' : undefined}
          >
            {value.audiences.length === 0
              ? t('playbook.knowledge.scope.audiencesNoneError')
              : copilotOnly
                ? t('playbook.knowledge.scope.audiencesAgentsOnlyHelp')
                : t('playbook.knowledge.scope.audiencesHelp')}
          </p>
        </fieldset>
      )}

      {reach && brands.length > 0 && (
        <fieldset className="flex flex-col gap-1" disabled={disabled}>
          <legend className={LABEL}>{t('playbook.knowledge.scope.brandsLabel')}</legend>
          <div className="flex flex-wrap gap-x-4 gap-y-1">
            {brands.map((brand) => (
              <label key={brand.id} className="flex items-center gap-1.5 text-sm">
                <input
                  type="checkbox"
                  checked={value.brandIds.includes(brand.id)}
                  onChange={(event) => toggleBrand(brand.id, event.target.checked)}
                />
                {brand.name ?? brand.id}
              </label>
            ))}
          </div>
          <p className="text-2xs text-content-tertiary">
            {value.brandIds.length === 0
              ? t('playbook.knowledge.scope.brandsEveryHelp')
              : t('playbook.knowledge.scope.brandsPickedHelp')}
          </p>
        </fieldset>
      )}

      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        {reach && (
          <div className="flex flex-col gap-1">
            <label htmlFor={`${idPrefix}-valid-until`} className={LABEL}>
              {t('playbook.knowledge.scope.validUntilLabel')}
            </label>
            <input
              id={`${idPrefix}-valid-until`}
              type="date"
              value={value.validUntil}
              disabled={disabled}
              onChange={(event) => onChange({ ...value, validUntil: event.target.value })}
              aria-describedby={`${idPrefix}-valid-until-help`}
              className={INPUT}
            />
            <span id={`${idPrefix}-valid-until-help`} className="text-2xs text-content-tertiary">
              {t('playbook.knowledge.scope.validUntilHelp')}
            </span>
          </div>
        )}

        <div className="flex flex-col gap-1">
          <label htmlFor={`${idPrefix}-owner`} className={LABEL}>
            {t('playbook.knowledge.scope.ownerLabel')}
          </label>
          <select
            id={`${idPrefix}-owner`}
            value={value.ownerId}
            disabled={disabled}
            onChange={(event) => onChange({ ...value, ownerId: event.target.value })}
            className={INPUT}
          >
            <option value="">{t('playbook.knowledge.scope.ownerNone')}</option>
            {members.map((member) => (
              <option key={member.id} value={member.id}>
                {member.name ?? member.id}
              </option>
            ))}
          </select>
        </div>

        <div className="flex flex-col gap-1">
          <label htmlFor={`${idPrefix}-interval`} className={LABEL}>
            {t('playbook.knowledge.scope.intervalLabel')}
          </label>
          <input
            id={`${idPrefix}-interval`}
            type="number"
            inputMode="numeric"
            min={KNOWLEDGE_REVIEW_INTERVAL_DAYS.min}
            max={KNOWLEDGE_REVIEW_INTERVAL_DAYS.max}
            value={value.reviewIntervalDays}
            disabled={disabled}
            onChange={(event) => onChange({ ...value, reviewIntervalDays: event.target.value })}
            aria-invalid={isValidReviewInterval(value.reviewIntervalDays) ? undefined : true}
            aria-describedby={`${idPrefix}-interval-help`}
            className={INPUT}
          />
          <span id={`${idPrefix}-interval-help`} className="text-2xs text-content-tertiary">
            {t('playbook.knowledge.scope.intervalHelp', {
              min: KNOWLEDGE_REVIEW_INTERVAL_DAYS.min,
              max: KNOWLEDGE_REVIEW_INTERVAL_DAYS.max,
            })}
          </span>
          <FieldError id={`${idPrefix}-interval-error`} message={intervalError ?? null} />
        </div>

        <div className="flex flex-col gap-1">
          <label htmlFor={`${idPrefix}-language`} className={LABEL}>
            {t('playbook.knowledge.scope.languageLabel')}
          </label>
          <input
            id={`${idPrefix}-language`}
            value={value.language}
            disabled={disabled}
            maxLength={35}
            onChange={(event) => onChange({ ...value, language: event.target.value })}
            placeholder={t('playbook.knowledge.scope.languagePlaceholder')}
            className={`${INPUT} placeholder:text-content-tertiary`}
          />
        </div>
      </div>
    </div>
  );
}

/** Whether the form's scope may be sent: at least one audience, a valid interval. */
export function scopeIsValid(value: KnowledgeScopeValue, reach: boolean): boolean {
  return (!reach || value.audiences.length > 0) && isValidReviewInterval(value.reviewIntervalDays);
}
