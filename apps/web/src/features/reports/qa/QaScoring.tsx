/**
 * The rubric as a form (tm 319.3 · AI-24 §4): one fieldset per criterion —
 * pass / fail or 1–5, "does not apply" for a criterion that is not critical —
 * and, on a critical one, the box the reviewer ticks to say they looked at it
 * on its own. The pre-score never ticks it: taking the model's values leaves
 * every critical criterion unconfirmed. The verdict follows the rule the API
 * keeps: a failed critical criterion is a `fail`.
 *
 * Shared by the review pane (`QaReview`) and the calibration round
 * (`QaCalibration`), which the server holds to the same rule.
 */
import type { ReactElement } from 'react';
import type { QaFinal, QaRubricCriterion, QaScoreValue } from '@siyahtus/types';
import { useTranslate } from '../../../lib/i18n.js';
import { criterionLabel, type QaPrescore, type ScoreDraft } from './qa.js';

const PASS_FAIL: readonly QaScoreValue[] = ['pass', 'fail'];
const ONE_TO_FIVE: readonly QaScoreValue[] = [1, 2, 3, 4, 5];

/** A radio's value: `pass`, `fail`, `1`–`5`, or `na` for null. */
function encode(value: QaScoreValue): string {
  return value === null ? 'na' : String(value);
}

function decode(raw: string): QaScoreValue {
  if (raw === 'na') return null;
  if (raw === 'pass' || raw === 'fail') return raw;
  return Number(raw) as QaScoreValue;
}

export function scoreValueLabel(t: (key: string) => string, value: QaScoreValue): string {
  if (value === null) return t('reports.qa.score.notApplicable');
  if (value === 'pass' || value === 'fail') return t(`reports.qa.final.${value}`);
  return String(value);
}

export function QaScoring({
  idPrefix,
  rubric,
  draft,
  onChange,
  final,
  onFinal,
  criticalFail,
  problems,
  prescore = null,
  onEvidence,
  readOnly = false,
}: {
  /** Keeps the radio groups of two forms on one page apart. */
  idPrefix: string;
  rubric: readonly QaRubricCriterion[];
  draft: ScoreDraft;
  onChange: (next: ScoreDraft) => void;
  final: QaFinal | null;
  onFinal: (final: QaFinal) => void;
  /** A critical criterion failed: the verdict can only be a fail. */
  criticalFail: boolean;
  /** Drawn beside their criterion — after a refused completion, or while the person completes. */
  problems: readonly { field: string; code: string }[];
  prescore?: QaPrescore | null;
  /** Point at one of the excerpt's messages — the pre-score's evidence. */
  onEvidence?: (eventId: string) => void;
  readOnly?: boolean;
}): ReactElement {
  const t = useTranslate();
  const problemOf = (key: string): string | null => {
    const hit = problems.find(
      (problem) => problem.field === `scores.${key}` || problem.field.startsWith(`scores.${key}.`),
    );
    return hit ? t(`reports.qa.problem.${hit.code}`) : null;
  };
  const finalProblem = problems.find((problem) => problem.field === 'final');

  return (
    <div className="flex flex-col gap-3">
      {rubric.map((criterion) => {
        const label = criterionLabel(t, criterion);
        const score = draft[criterion.key] ?? { value: undefined, confirmed: false };
        const options = [
          ...(criterion.type === 'pass_fail' ? PASS_FAIL : ONE_TO_FIVE),
          ...(criterion.critical ? [] : [null]),
        ];
        const suggested = prescore?.criteria.find((row) => row.key === criterion.key);
        const problem = problemOf(criterion.key);
        const name = `${idPrefix}-${criterion.key}`;
        return (
          <fieldset
            key={criterion.key}
            data-testid="qa-criterion"
            data-criterion={criterion.key}
            className={`flex flex-col gap-1.5 rounded-md border px-3 py-2 ${
              problem ? 'border-danger' : 'border-border'
            }`}
          >
            <legend className="px-1 text-xs font-medium">
              {label}
              {criterion.critical && (
                <span className="ml-1.5 rounded-sm bg-danger/10 px-1 text-2xs text-danger">
                  {t('reports.qa.score.critical')}
                </span>
              )}
              <span className="ml-1.5 text-2xs font-normal text-content-tertiary">
                {t('reports.qa.score.weight', { weight: String(criterion.weight) })}
              </span>
            </legend>
            <div className="flex flex-wrap gap-1.5">
              {options.map((option) => {
                const checked = score.value === option;
                return (
                  <label
                    key={encode(option)}
                    className={`rounded-full border px-2.5 py-0.5 text-xs ${
                      readOnly ? '' : 'cursor-pointer'
                    } ${
                      checked
                        ? 'border-brand-500 bg-brand-500/10 font-medium text-content'
                        : 'border-border text-content-secondary hover:bg-surface-2'
                    }`}
                  >
                    <input
                      type="radio"
                      name={name}
                      value={encode(option)}
                      checked={checked}
                      disabled={readOnly}
                      onChange={(event) =>
                        onChange({
                          ...draft,
                          // A new value is a new look: the confirmation was for the old one.
                          [criterion.key]: { value: decode(event.target.value), confirmed: false },
                        })
                      }
                      className="sr-only"
                    />
                    {scoreValueLabel(t, option)}
                  </label>
                );
              })}
            </div>
            {criterion.critical && (
              <label className="flex items-center gap-1.5 text-2xs text-content-secondary">
                <input
                  type="checkbox"
                  checked={score.confirmed}
                  disabled={readOnly || score.value === undefined}
                  onChange={(event) =>
                    onChange({
                      ...draft,
                      [criterion.key]: { ...score, confirmed: event.target.checked },
                    })
                  }
                />
                {t('reports.qa.score.confirm', { criterion: label })}
              </label>
            )}
            {suggested && (
              <div className="flex flex-col gap-0.5 rounded-sm bg-surface-2 px-2 py-1 text-2xs text-content-secondary">
                <span>
                  {t('reports.qa.prescore.suggests', {
                    value: scoreValueLabel(t, suggested.value),
                  })}
                  {suggested.rationale && ` — ${suggested.rationale}`}
                </span>
                {suggested.evidence_event_ids.length > 0 && onEvidence && (
                  <span className="flex flex-wrap items-center gap-1">
                    {t('reports.qa.prescore.evidence')}
                    {suggested.evidence_event_ids.map((eventId, index) => (
                      <button
                        key={eventId}
                        type="button"
                        onClick={() => onEvidence(eventId)}
                        className="rounded-sm border border-border px-1 hover:bg-surface"
                        aria-label={t('reports.qa.prescore.evidenceLink', {
                          criterion: label,
                          n: String(index + 1),
                        })}
                      >
                        {index + 1}
                      </button>
                    ))}
                  </span>
                )}
              </div>
            )}
            {problem && <p className="text-2xs text-danger">{problem}</p>}
          </fieldset>
        );
      })}

      <fieldset
        className={`flex flex-col gap-1.5 rounded-md border px-3 py-2 ${
          finalProblem ? 'border-danger' : 'border-border'
        }`}
      >
        <legend className="px-1 text-xs font-medium">{t('reports.qa.final.legend')}</legend>
        <div className="flex flex-wrap gap-1.5">
          {(['pass', 'fail'] as const).map((option) => {
            const blocked = option === 'pass' && criticalFail;
            const checked = final === option;
            return (
              <label
                key={option}
                className={`rounded-full border px-2.5 py-0.5 text-xs ${
                  blocked || readOnly ? 'opacity-60' : 'cursor-pointer'
                } ${
                  checked
                    ? 'border-brand-500 bg-brand-500/10 font-medium text-content'
                    : 'border-border text-content-secondary hover:bg-surface-2'
                }`}
              >
                <input
                  type="radio"
                  name={`${idPrefix}-final`}
                  value={option}
                  checked={checked}
                  disabled={readOnly || blocked}
                  onChange={() => onFinal(option)}
                  className="sr-only"
                />
                {t(`reports.qa.final.${option}`)}
              </label>
            );
          })}
        </div>
        {criticalFail && (
          <p className="text-2xs text-content-secondary">{t('reports.qa.final.criticalFail')}</p>
        )}
        {finalProblem && (
          <p className="text-2xs text-danger">
            {t(
              finalProblem.code === 'required'
                ? 'reports.qa.final.required'
                : `reports.qa.problem.${finalProblem.code}`,
            )}
          </p>
        )}
      </fieldset>
    </div>
  );
}
