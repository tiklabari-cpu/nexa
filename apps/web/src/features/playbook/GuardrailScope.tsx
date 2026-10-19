/**
 * Where a compliance rule or a forbidden phrase applies (tm 301.4 · AI-08): the
 * same three-way scope the behaviour rules carry — every conversation, the turns
 * of some procedures — and its one-line description for a list row.
 */
import { readGuidanceScope } from '@siyahtus/types';
import type { ReactElement } from 'react';
import { useTranslate, type TFunction } from '../../lib/i18n.js';
import type { GuidanceSkillOption } from './GuidanceRules.js';
import { scopeIsEmpty, type ScopeDraft } from './guardrails.js';

export function scopeLabel(
  rawScope: unknown,
  skills: readonly GuidanceSkillOption[],
  t: TFunction,
): string {
  const scope = readGuidanceScope(rawScope);
  if (scope && 'skill_ids' in scope) {
    const names = scope.skill_ids.map(
      (id) =>
        skills.find((skill) => skill.id === id)?.name ?? t('playbook.guidance.scopeUnknownSkill'),
    );
    return t('playbook.guidance.scopeSkills', { names: names.join(', ') });
  }
  if (scope && 'brand_ids' in scope) {
    return t('playbook.guidance.scopeBrands', { count: scope.brand_ids.length });
  }
  return t('playbook.guidance.scopeAll');
}

export function ScopeFields({
  name,
  draft,
  skills,
  onChange,
}: {
  /** Names the radio group, so two editors on one screen do not share a selection. */
  name: string;
  draft: ScopeDraft;
  skills: readonly GuidanceSkillOption[];
  onChange: (draft: ScopeDraft) => void;
}): ReactElement {
  const t = useTranslate();
  return (
    <fieldset className="flex flex-col gap-1.5">
      <legend className="text-2xs font-medium uppercase tracking-wide text-content-tertiary">
        {t('playbook.guidance.scopeField')}
      </legend>
      <label className="flex items-center gap-2 text-sm">
        <input
          type="radio"
          name={name}
          checked={draft.mode === 'all'}
          onChange={() => onChange({ ...draft, mode: 'all' })}
        />
        {t('playbook.guidance.scopeAll')}
      </label>
      <label className="flex items-center gap-2 text-sm">
        <input
          type="radio"
          name={name}
          checked={draft.mode === 'skills'}
          disabled={skills.length === 0}
          onChange={() => onChange({ ...draft, mode: 'skills' })}
        />
        {t('playbook.guidance.scopeSome')}
      </label>
      {draft.mode === 'skills' && (
        <ul role="list" className="ml-6 flex flex-col gap-1">
          {skills.map((skill) => (
            <li key={skill.id}>
              <label className="flex items-center gap-2 text-sm">
                <input
                  type="checkbox"
                  checked={draft.skillIds.includes(skill.id)}
                  onChange={(event) =>
                    onChange({
                      ...draft,
                      skillIds: event.target.checked
                        ? [...draft.skillIds, skill.id]
                        : draft.skillIds.filter((id) => id !== skill.id),
                    })
                  }
                />
                {skill.name}
              </label>
            </li>
          ))}
        </ul>
      )}
      {draft.mode === 'brands' && (
        <p className="ml-6 text-2xs text-content-tertiary">
          {t('playbook.guidance.scopeBrandsKept')}
        </p>
      )}
      {scopeIsEmpty(draft) && (
        <p role="alert" className="ml-6 text-2xs text-danger">
          {t('playbook.guidance.scopeEmpty')}
        </p>
      )}
    </fieldset>
  );
}
