/**
 * Skill editor: instruction → compiled steps → preview.
 *
 * The three sit on one screen because they are one decision. An admin writing
 * automation needs to see what their words became and what those steps do to a
 * real message, before a customer is the one who finds out.
 */
import { useMutation } from '@tanstack/react-query';
import { useMemo, useState, type ReactElement } from 'react';
import { Card } from '../../components/Page.js';
import { StatusDot } from '../../components/StatusDot.js';
import { errorMessageKey } from '../../lib/api-client.js';
import { useApiClient } from '../../lib/auth-store.js';
import { useTranslate, type TFunction } from '../../lib/i18n.js';
import type { Skill, SkillPreview, SkillStep } from './types.js';
import { moveStep, stepIssues } from './step-reorder.js';

/**
 * Step wording, translated (NFR-I18N2).
 *
 * Mirrors `types.ts`'s `describeStep` and `step-reorder.ts`'s `describeMove`/
 * `issueFor` exactly — those two files stay untouched (their own unit tests
 * pin the exact English sentences with no `t()` involved), so this component
 * carries its own small, translated copy of the same switch instead of
 * threading a translate function into shared, tested logic.
 */
function describeStepText(step: SkillStep, t: TFunction): string {
  switch (step.type) {
    case 'detect_intent':
      return t('playbook.step.detectIntent', { intent: step.intent ?? '?' });
    case 'request_info':
      return t('playbook.step.requestInfo', {
        field: step.field ?? t('playbook.step.requestInfoFallbackField'),
        prompt: step.prompt ?? '',
      });
    case 'tag':
      return t('playbook.step.tag', { tag: step.tag ?? '?' });
    case 'summarize':
      return t('playbook.step.summarize');
    case 'send_message':
      return step.source === 'knowledge'
        ? t('playbook.step.sendKnowledge')
        : t('playbook.step.sendText', { text: step.text ?? '' });
    case 'transfer_to_team':
      return t('playbook.step.transfer', { group: step.group ?? '?' });
    default:
      return step.type;
  }
}

function describeMoveText(
  steps: readonly SkillStep[],
  from: number,
  to: number,
  t: TFunction,
): string {
  const clampedTo = Math.max(0, Math.min(to, steps.length - 1));
  const step = steps[from];
  const label = step ? describeStepText(step, t) : t('playbook.step.genericLabel');
  return t('playbook.step.moveAnnouncement', {
    label,
    position: clampedTo + 1,
    total: steps.length,
  });
}

function isBlank(value: string | undefined): boolean {
  return !value || value.trim().length === 0;
}

/** The one missing required parameter for a step, translated — mirrors step-reorder.ts's `issueFor`. */
function issueMessageText(step: SkillStep, t: TFunction): string | null {
  switch (step.type) {
    case 'transfer_to_team':
      return isBlank(step.group) ? t('playbook.step.issueTransferTeam') : null;
    case 'detect_intent':
      return isBlank(step.intent) ? t('playbook.step.issueDetectIntent') : null;
    case 'request_info':
      if (isBlank(step.field)) return t('playbook.step.issueRequestInfoField');
      return isBlank(step.prompt) ? t('playbook.step.issueRequestInfoPrompt') : null;
    case 'tag':
      return isBlank(step.tag) ? t('playbook.step.issueTag') : null;
    case 'send_message':
      return step.source === 'text' && isBlank(step.text)
        ? t('playbook.step.issueSendMessage')
        : null;
    case 'summarize':
      return null;
    default:
      return null;
  }
}

/**
 * Steps carry a stable client id so the reorderable list keys by identity, not
 * position — which is what lets the browser keep keyboard focus on a row as it
 * moves, and lets React move the DOM node rather than rebuild it.
 */
interface StepEntry {
  id: string;
  step: SkillStep;
}
let stepSeq = 0;
const wrap = (step: SkillStep): StepEntry => ({ id: `step-${stepSeq++}`, step });

export function SkillEditor({
  skill,
  canEdit,
  onSaved,
}: {
  skill: Skill;
  canEdit: boolean;
  onSaved: () => void;
}): ReactElement {
  const t = useTranslate();
  const api = useApiClient();

  const [name, setName] = useState(skill.name);
  const [instruction, setInstruction] = useState(skill.instruction ?? '');
  const [entries, setEntries] = useState<StepEntry[]>(() => skill.steps.map(wrap));
  const [unrecognised, setUnrecognised] = useState<string[]>([]);
  const [sample, setSample] = useState('Where is my order?');
  const [announcement, setAnnouncement] = useState('');
  const [dragIndex, setDragIndex] = useState<number | null>(null);

  const steps = useMemo(() => entries.map((entry) => entry.step), [entries]);
  // Gating (count, index) comes from the shared, tested `stepIssues` — the
  // *messages* shown are `issueMessageText`'s translated mirror of the same
  // predicates, so the two can never disagree on which steps are runnable.
  const issues = useMemo(() => stepIssues(steps), [steps]);
  const issueByIndex = useMemo(
    () =>
      new Map(
        steps
          .map((step, index) => [index, issueMessageText(step, t)] as const)
          .filter((entry): entry is [number, string] => entry[1] !== null),
      ),
    [steps, t],
  );

  const compile = useMutation({
    mutationFn: () =>
      api.post<{ steps: SkillStep[]; unrecognised: string[] }>('/skills/compile', {
        instruction,
      }),
    onSuccess: (result) => {
      setEntries(result.steps.map(wrap));
      setUnrecognised(result.unrecognised);
    },
  });

  const preview = useMutation({
    mutationFn: () =>
      api.post<SkillPreview>('/skills/preview', {
        steps,
        message: sample,
        ai_agent_id: skill.ai_agent_id,
      }),
  });

  const save = useMutation({
    mutationFn: () => api.patch<Skill>(`/skills/${skill.id}`, { name, instruction, steps }),
    onSuccess: onSaved,
  });

  const dirty =
    name !== skill.name ||
    instruction !== (skill.instruction ?? '') ||
    JSON.stringify(steps) !== JSON.stringify(skill.steps);

  // A step with a missing required parameter (most often a hand-over with no
  // team) would be stored and then skipped in silence in front of a customer —
  // so a save is refused until every step is runnable (FR-MOD-06.2.4).
  const canSave = dirty && issues.length === 0 && !save.isPending;

  function reorder(from: number, to: number): void {
    if (!canEdit) return;
    const clampedTo = Math.max(0, Math.min(to, entries.length - 1));
    if (clampedTo === from || from < 0 || from >= entries.length) return;
    setAnnouncement(describeMoveText(steps, from, clampedTo, t));
    setEntries((current) => moveStep(current, from, clampedTo));
  }

  function setTransferTarget(index: number, group: string): void {
    setEntries((current) =>
      current.map((entry, i) =>
        i === index ? { ...entry, step: { ...entry.step, group } } : entry,
      ),
    );
  }

  return (
    <div className="flex flex-col gap-4">
      <Card>
        <div className="flex flex-col gap-3 p-4">
          <label htmlFor="skill-name" className="flex flex-col gap-1">
            <span className="text-2xs font-medium uppercase tracking-wide text-content-tertiary">
              {t('playbook.editor.name')}
            </span>
            <input
              id="skill-name"
              value={name}
              disabled={!canEdit}
              onChange={(event) => setName(event.target.value)}
              className="rounded-md border border-border bg-inset px-2 py-1.5 text-sm outline-none disabled:opacity-60"
            />
          </label>

          <label htmlFor="skill-instruction" className="flex flex-col gap-1">
            <span className="text-2xs font-medium uppercase tracking-wide text-content-tertiary">
              {t('playbook.editor.instruction')}
            </span>
            <textarea
              id="skill-instruction"
              value={instruction}
              disabled={!canEdit}
              onChange={(event) => setInstruction(event.target.value)}
              rows={5}
              placeholder={t('playbook.editor.instructionPlaceholder')}
              className="resize-y rounded-md border border-border bg-inset px-2 py-1.5 text-sm outline-none placeholder:text-content-tertiary disabled:opacity-60"
            />
          </label>

          {canEdit && (
            <div className="flex flex-wrap items-center gap-2">
              <button
                type="button"
                disabled={!instruction.trim() || compile.isPending}
                onClick={() => compile.mutate()}
                className="rounded-md border border-border px-3 py-1.5 text-sm transition-colors hover:bg-surface-2 disabled:opacity-50"
              >
                {compile.isPending ? t('playbook.editor.compiling') : t('playbook.editor.compile')}
              </button>

              <button
                type="button"
                disabled={!canSave}
                onClick={() => save.mutate()}
                className="rounded-md bg-brand-500 px-3 py-1.5 text-sm font-medium text-white transition-colors hover:bg-brand-600 disabled:opacity-50"
              >
                {save.isPending ? t('playbook.editor.saving') : t('playbook.editor.save')}
              </button>

              {issues.length > 0 && (
                <span role="alert" className="text-2xs text-warning">
                  {t('playbook.editor.fixIssues', { count: issues.length })}
                </span>
              )}

              {save.isError && (
                <span role="alert" className="text-2xs text-danger">
                  {t(errorMessageKey(save.error))}
                </span>
              )}
            </div>
          )}

          {unrecognised.length > 0 && (
            <div role="status" className="rounded-md border border-border bg-inset p-3">
              <p className="text-2xs font-medium text-warning">
                {t('playbook.editor.unrecognised', { count: unrecognised.length })}
              </p>
              {/* Reported rather than guessed at: a skill that plausibly does
                  the wrong thing to a customer is worse than one that admits it
                  did not understand. */}
              <ul className="mt-1 flex flex-col gap-0.5">
                {unrecognised.map((line, index) => (
                  <li key={index} className="text-2xs text-content-secondary">
                    “{line}”
                  </li>
                ))}
              </ul>
            </div>
          )}
        </div>
      </Card>

      <Card>
        <div className="flex items-center justify-between border-b border-border px-4 py-2.5">
          <h3 className="text-xs font-medium uppercase tracking-wide text-content-tertiary">
            {t('playbook.editor.stepsTitle')}
          </h3>
          {canEdit && entries.length > 1 && (
            <span className="text-2xs text-content-tertiary">{t('playbook.editor.dragHint')}</span>
          )}
        </div>

        {/* Move confirmations for a keyboard/screen-reader user (NFR-A11Y4). */}
        <p aria-live="polite" className="sr-only">
          {announcement}
        </p>

        {entries.length === 0 ? (
          <p className="px-4 py-3 text-sm text-content-secondary">{t('playbook.editor.noSteps')}</p>
        ) : (
          <ol className="divide-y divide-border">
            {entries.map((entry, index) => {
              const issue = issueByIndex.get(index);
              return (
                <li
                  key={entry.id}
                  draggable={canEdit}
                  onDragStart={() => setDragIndex(index)}
                  onDragEnd={() => setDragIndex(null)}
                  onDragOver={(event) => {
                    if (canEdit && dragIndex !== null) event.preventDefault();
                  }}
                  onDrop={(event) => {
                    event.preventDefault();
                    if (dragIndex !== null) reorder(dragIndex, index);
                    setDragIndex(null);
                  }}
                  className={`flex items-start gap-3 px-4 py-2.5 ${
                    dragIndex === index ? 'opacity-50' : ''
                  }`}
                >
                  {canEdit && (
                    <span aria-hidden="true" className="mt-0.5 cursor-grab text-content-tertiary">
                      ⠿
                    </span>
                  )}
                  <span className="tabular mt-0.5 text-2xs text-content-tertiary">{index + 1}</span>

                  <div className="min-w-0 flex-1">
                    <p className="text-sm">{describeStepText(entry.step, t)}</p>
                    <code className="text-2xs text-content-tertiary">{entry.step.type}</code>

                    {entry.step.type === 'transfer_to_team' && (
                      <label
                        htmlFor={`transfer-${entry.id}`}
                        className="mt-1.5 flex flex-col gap-1"
                      >
                        <span className="text-2xs text-content-tertiary">
                          {t('playbook.editor.team')}
                        </span>
                        <input
                          id={`transfer-${entry.id}`}
                          value={entry.step.group ?? ''}
                          disabled={!canEdit}
                          onChange={(event) => setTransferTarget(index, event.target.value)}
                          aria-invalid={issue ? true : undefined}
                          placeholder={t('playbook.editor.teamPlaceholder')}
                          className="w-48 rounded-md border border-border bg-inset px-2 py-1 text-sm outline-none disabled:opacity-60"
                        />
                      </label>
                    )}

                    {issue && (
                      <p role="alert" className="mt-1 text-2xs text-danger">
                        {issue}
                      </p>
                    )}
                  </div>

                  {canEdit && (
                    <div className="flex shrink-0 flex-col gap-1">
                      <button
                        type="button"
                        aria-label={t('playbook.editor.moveUp', { index: index + 1 })}
                        disabled={index === 0}
                        onClick={() => reorder(index, index - 1)}
                        className="rounded border border-border px-1.5 text-2xs text-content-secondary transition-colors hover:bg-surface-2 disabled:opacity-30"
                      >
                        ↑
                      </button>
                      <button
                        type="button"
                        aria-label={t('playbook.editor.moveDown', { index: index + 1 })}
                        disabled={index === entries.length - 1}
                        onClick={() => reorder(index, index + 1)}
                        className="rounded border border-border px-1.5 text-2xs text-content-secondary transition-colors hover:bg-surface-2 disabled:opacity-30"
                      >
                        ↓
                      </button>
                    </div>
                  )}
                </li>
              );
            })}
          </ol>
        )}
      </Card>

      <Card>
        <h3 className="border-b border-border px-4 py-2.5 text-xs font-medium uppercase tracking-wide text-content-tertiary">
          {t('playbook.editor.previewTitle')}
        </h3>
        <div className="flex flex-col gap-3 p-4">
          <label htmlFor="skill-sample" className="flex flex-col gap-1">
            <span className="text-2xs text-content-secondary">
              {t('playbook.editor.sampleLabel')}
            </span>
            <input
              id="skill-sample"
              value={sample}
              onChange={(event) => setSample(event.target.value)}
              className="rounded-md border border-border bg-inset px-2 py-1.5 text-sm outline-none"
            />
          </label>

          <button
            type="button"
            disabled={!sample.trim() || steps.length === 0 || preview.isPending}
            onClick={() => preview.mutate()}
            className="self-start rounded-md border border-border px-3 py-1.5 text-sm transition-colors hover:bg-surface-2 disabled:opacity-50"
          >
            {preview.isPending ? t('playbook.editor.running') : t('playbook.editor.runPreview')}
          </button>

          {preview.data && <PreviewResult result={preview.data} />}

          {preview.isError && (
            <p role="alert" className="text-2xs text-danger">
              {t('playbook.editor.previewError')}
            </p>
          )}
        </div>
      </Card>
    </div>
  );
}

function PreviewResult({ result }: { result: SkillPreview }): ReactElement {
  const t = useTranslate();
  const tone =
    result.outcome === 'answered'
      ? 'success'
      : result.outcome === 'handed_off'
        ? 'info'
        : 'warning';
  const label =
    result.outcome === 'answered'
      ? t('playbook.editor.outcomeAnswered')
      : result.outcome === 'handed_off'
        ? t('playbook.editor.outcomeHandedOff')
        : t('playbook.editor.outcomeNothing');

  return (
    <div className="flex flex-col gap-2 rounded-md border border-border bg-inset p-3">
      <StatusDot tone={tone} label={label} />

      {result.errors.length > 0 && (
        <ul role="alert" className="flex flex-col gap-0.5">
          {result.errors.map((error, index) => (
            <li key={index} className="text-2xs text-danger">
              {error}
            </li>
          ))}
        </ul>
      )}

      {result.reply && (
        <p className="rounded-md bg-surface p-2 text-sm">
          <span className="mb-1 block text-2xs text-content-tertiary">
            {t('playbook.editor.replyLabel')}
          </span>
          {result.reply}
        </p>
      )}

      {result.transfer_to && (
        <p className="text-sm text-content-secondary">
          {t('playbook.editor.handsOverTo', { name: result.transfer_to })}
        </p>
      )}

      {result.tags.length > 0 && (
        <p className="text-2xs text-content-secondary">
          {t('playbook.editor.tagsLabel', { tags: result.tags.join(', ') })}
        </p>
      )}

      {result.log.length > 0 && (
        <ol className="mt-1 flex flex-col gap-0.5">
          {result.log.map((entry, index) => (
            <li key={index} className="flex items-start gap-2 text-2xs">
              <span aria-hidden="true" className={entry.ok ? 'text-success' : 'text-warning'}>
                {entry.ok ? '●' : '○'}
              </span>
              <span className="text-content-tertiary">
                <code>{entry.step}</code> — {entry.detail}
              </span>
            </li>
          ))}
        </ol>
      )}
    </div>
  );
}
