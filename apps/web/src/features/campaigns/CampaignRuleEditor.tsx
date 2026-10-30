/**
 * The campaign trigger as rows (EN-03 · tm 352.2): field → operator → value,
 * joined by "all" or "any". The same list the API validates; the person sees
 * what is wrong with a row (`draftProblem`) once they have left its value.
 */
import { useState, type ReactElement } from 'react';
import {
  CAMPAIGN_RULES_MAX,
  CAMPAIGN_RULE_FIELDS,
  CAMPAIGN_VISITOR_TYPES,
  campaignRuleOps,
  type CampaignMatchMode,
} from '@siyahtus/types';
import { useTranslate } from '../../lib/i18n.js';
import { blankRule, draftProblem, withField, type RuleDraft } from './campaign-rules.js';

const CONTROL = 'rounded-md border border-border bg-inset px-2 py-2 text-sm';

export function CampaignRuleEditor({
  match,
  drafts,
  onChange,
}: {
  match: CampaignMatchMode;
  drafts: readonly RuleDraft[];
  onChange: (next: { match: CampaignMatchMode; drafts: RuleDraft[] }) => void;
}): ReactElement {
  const t = useTranslate();
  // Rows whose value the person has left: only those show their problem.
  const [touched, setTouched] = useState<ReadonlySet<number>>(new Set());

  const replace = (id: number, patch: (draft: RuleDraft) => RuleDraft): void =>
    onChange({ match, drafts: drafts.map((draft) => (draft.id === id ? patch(draft) : draft)) });
  const touch = (id: number): void => setTouched((current) => new Set(current).add(id));
  const nextId = drafts.reduce((highest, draft) => Math.max(highest, draft.id), 0) + 1;

  return (
    <fieldset className="flex flex-col gap-2">
      <legend className="mb-1 text-sm font-medium">{t('campaigns.builder.triggerLabel')}</legend>
      <p className="text-2xs text-content-tertiary">{t('campaigns.builder.triggerHint')}</p>

      {drafts.length > 1 && (
        <div className="flex items-center gap-2 text-sm">
          <label htmlFor="campaign-match">{t('campaigns.rule.matchLabel')}</label>
          <select
            id="campaign-match"
            value={match}
            onChange={(event) =>
              onChange({ match: event.target.value === 'any' ? 'any' : 'all', drafts: [...drafts] })
            }
            className={CONTROL}
          >
            <option value="all">{t('campaigns.rule.match.all')}</option>
            <option value="any">{t('campaigns.rule.match.any')}</option>
          </select>
        </div>
      )}

      <ul className="flex flex-col gap-2">
        {drafts.map((draft, index) => {
          const n = index + 1;
          const problem = touched.has(draft.id) ? draftProblem(draft) : null;
          return (
            <li key={draft.id} className="flex flex-col gap-1">
              <div className="flex flex-wrap items-center gap-2">
                <select
                  aria-label={t('campaigns.rule.fieldLabel', { n })}
                  value={draft.field}
                  onChange={(event) =>
                    replace(draft.id, (row) =>
                      withField(row, event.target.value as RuleDraft['field']),
                    )
                  }
                  className={CONTROL}
                >
                  {CAMPAIGN_RULE_FIELDS.map((field) => (
                    <option key={field} value={field}>
                      {t(`campaigns.rule.field.${field}`)}
                    </option>
                  ))}
                </select>

                {draft.field === 'custom_var' && (
                  <input
                    aria-label={t('campaigns.rule.keyLabel', { n })}
                    value={draft.key}
                    onChange={(event) =>
                      replace(draft.id, (row) => ({ ...row, key: event.target.value }))
                    }
                    onBlur={() => touch(draft.id)}
                    className={`${CONTROL} w-28`}
                  />
                )}

                {draft.field === 'exit_intent' ? (
                  <span className="text-sm text-content-secondary">
                    {t('campaigns.rule.exitIntentText')}
                  </span>
                ) : (
                  <>
                    <select
                      aria-label={t('campaigns.rule.opLabel', { n })}
                      value={draft.op}
                      onChange={(event) =>
                        replace(draft.id, (row) => ({
                          ...row,
                          op: event.target.value as RuleDraft['op'],
                        }))
                      }
                      className={CONTROL}
                    >
                      {campaignRuleOps(draft.field).map((op) => (
                        <option key={op} value={op}>
                          {t(`campaigns.rule.op.${op}`)}
                        </option>
                      ))}
                    </select>

                    {draft.field === 'visitor_type' ? (
                      <select
                        aria-label={t('campaigns.rule.valueLabel', { n })}
                        value={draft.value}
                        onChange={(event) =>
                          replace(draft.id, (row) => ({ ...row, value: event.target.value }))
                        }
                        className={CONTROL}
                      >
                        {CAMPAIGN_VISITOR_TYPES.map((type) => (
                          <option key={type} value={type}>
                            {t(`campaigns.rule.visitor.${type}`)}
                          </option>
                        ))}
                      </select>
                    ) : (
                      <input
                        aria-label={t('campaigns.rule.valueLabel', { n })}
                        value={draft.value}
                        onChange={(event) =>
                          replace(draft.id, (row) => ({ ...row, value: event.target.value }))
                        }
                        onBlur={() => touch(draft.id)}
                        aria-invalid={problem ? true : undefined}
                        placeholder={PLACEHOLDER[draft.field]}
                        inputMode={draft.field === 'time_on_page' ? 'numeric' : undefined}
                        className={`${CONTROL} min-w-0 flex-1`}
                      />
                    )}
                  </>
                )}

                {drafts.length > 1 && (
                  <button
                    type="button"
                    onClick={() =>
                      onChange({ match, drafts: drafts.filter((row) => row.id !== draft.id) })
                    }
                    aria-label={t('campaigns.rule.remove', { n })}
                    className="rounded-md border border-border px-2 py-1.5 text-sm text-content-secondary hover:bg-surface-2"
                  >
                    ×
                  </button>
                )}
              </div>
              {problem && (
                <p role="alert" className="text-2xs text-danger">
                  {t(`campaigns.rule.problem.${problem}`)}
                </p>
              )}
            </li>
          );
        })}
      </ul>

      <div className="flex items-center gap-2">
        <button
          type="button"
          disabled={drafts.length >= CAMPAIGN_RULES_MAX}
          onClick={() => onChange({ match, drafts: [...drafts, blankRule(nextId)] })}
          className="rounded-md border border-border px-2 py-1 text-2xs font-medium text-content-secondary hover:bg-surface-2 disabled:opacity-40"
        >
          {t('campaigns.rule.add')}
        </button>
        {drafts.length >= CAMPAIGN_RULES_MAX && (
          <span className="text-2xs text-content-tertiary">
            {t('campaigns.rule.max', { max: CAMPAIGN_RULES_MAX })}
          </span>
        )}
      </div>
    </fieldset>
  );
}

const PLACEHOLDER: Record<string, string> = {
  current_url: '/pricing',
  session_url: '/checkout',
  referrer: 'google.com',
  country: 'TR',
  time_on_page: '30',
  custom_var: 'premium',
};
