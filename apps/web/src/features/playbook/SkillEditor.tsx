/**
 * Skill editor: a top bar, then instruction → compiled steps → preview.
 *
 * The three sit on one screen because they are one decision. An admin writing
 * automation needs to see what their words became and what those steps do to a
 * real message, before a customer is the one who finds out.
 *
 * The top bar carries what the PRD counts along it (FR-MOD-06.2.1): the run
 * log, the on/off switch, and Save. The run log is there because the question
 * "why did the customer get that?" is asked *about the skill you are looking
 * at* — the endpoint has always answered it, but nothing on the web ever asked.
 * The switch is there because going back to the list to flip a skill you just
 * finished editing is a detour with no reason. And leaving with unsaved edits
 * now asks first, on both paths out: the browser's and the app's own nav.
 *
 * Delete asks through a `Modal`, not the inline swap the KB category row uses
 * (tm 246): this screen is not itself nested inside one, so a confirmation
 * dialog costs nothing extra and matches `DeveloperPortal.tsx`'s own delete —
 * the app's one other single-entity delete off a detail screen. The server
 * cascades a skill's run log with it (`SkillRun.skillId` is `onDelete:
 * Cascade`), which the dialog says plainly rather than leaving as a surprise.
 *
 * The step list is authored here as well as ordered (FR-MOD-06.2.4): each step
 * opens into the parameter form for its own type, can be added, deleted or
 * retyped. Until it could, a skill created from "New skill" was born with
 * `steps: []` and had no way to gain one — the whole ordered-steps surface was
 * reachable only by starting from a template.
 */
import { useMutation, useQuery, useQueryClient, type UseQueryResult } from '@tanstack/react-query';
import { useMemo, useState, type ReactElement } from 'react';
import { Link } from 'react-router-dom';
import { Card, ErrorNotice } from '../../components/Page.js';
import { EmptyState } from '../../components/EmptyState.js';
import { Modal } from '../../components/ui/index.js';
import { StatusDot, type StatusTone } from '../../components/StatusDot.js';
import { errorMessageKey } from '../../lib/api-client.js';
import { useApiClient } from '../../lib/auth-store.js';
import { useLeaveGuard, shouldWarnOnLeave } from '../../lib/dirty-guard.js';
import { formatDateTime } from '../../lib/format.js';
import { useTranslate, type TFunction } from '../../lib/i18n.js';
import type { Skill, SkillPreview, SkillRun, SkillStep } from './types.js';
import { moveStep, stepIssues } from './step-reorder.js';
import {
  STEP_TYPES,
  addStep,
  changeStepType,
  formatPhrases,
  parsePhrases,
  removeStep,
  toEntries,
  updateStep,
  type StepEntry,
  type StepType,
} from './step-authoring.js';
import { useSkillActiveToggle } from './useSkillActiveToggle.js';

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
      if (step.source !== 'text' && step.source !== 'knowledge') {
        return t('playbook.step.issueSendSource');
      }
      return step.source === 'text' && isBlank(step.text)
        ? t('playbook.step.issueSendMessage')
        : null;
    case 'summarize':
      return null;
    default:
      return null;
  }
}

/** The short name of a step type, as the add and retype controls list it. */
const STEP_TYPE_LABEL_KEYS: Record<StepType, string> = {
  detect_intent: 'playbook.editor.typeDetectIntent',
  request_info: 'playbook.editor.typeRequestInfo',
  tag: 'playbook.editor.typeTag',
  summarize: 'playbook.editor.typeSummarize',
  send_message: 'playbook.editor.typeSendMessage',
  transfer_to_team: 'playbook.editor.typeTransferToTeam',
};

/** Ties the run-log disclosure button to the panel it expands (NFR-A11Y). */
const RUN_LOG_ID = 'skill-run-log';

export function SkillEditor({
  skill,
  canEdit,
  onSaved,
  onDeleted,
}: {
  skill: Skill;
  canEdit: boolean;
  onSaved: () => void;
  onDeleted: () => void;
}): ReactElement {
  const t = useTranslate();
  const api = useApiClient();

  const [name, setName] = useState(skill.name);
  const [instruction, setInstruction] = useState(skill.instruction ?? '');
  const [entries, setEntries] = useState<StepEntry[]>(() => toEntries(skill.steps));
  const [unrecognised, setUnrecognised] = useState<string[]>([]);
  const [sample, setSample] = useState('Where is my order?');
  const [announcement, setAnnouncement] = useState('');
  const [dragIndex, setDragIndex] = useState<number | null>(null);
  const [runLogOpen, setRunLogOpen] = useState(false);
  // Which steps are expanded, by row id rather than index: a step keeps its
  // parameter form open across a reorder, which is the whole reason the id
  // exists. Several may be open at once — collapsing the step you just filled
  // in because you opened the next one loses your place in a list you are
  // reading top to bottom.
  const [openStepIds, setOpenStepIds] = useState<ReadonlySet<string>>(() => new Set());
  const [newStepType, setNewStepType] = useState<StepType>('detect_intent');
  const [deleteOpen, setDeleteOpen] = useState(false);

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
      setEntries(toEntries(result.steps));
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

  // What a save would send, and what is already on the server — compared as
  // one value so "is there anything to lose?" has a single answer.
  const draft = useMemo(
    () => JSON.stringify({ name, instruction, steps }),
    [name, instruction, steps],
  );
  const [savedDraft, setSavedDraft] = useState<string | null>(null);

  const save = useMutation({
    mutationFn: () => api.patch<Skill>(`/skills/${skill.id}`, { name, instruction, steps }),
    onSuccess: () => {
      // Remember what we just sent. `onSaved` only *starts* the parent's
      // refetch; until it lands the `skill` prop still describes the old row,
      // and without this the editor would count itself dirty — and warn about
      // discarding — for a skill that was saved a moment ago.
      setSavedDraft(draft);
      onSaved();
    },
  });

  const persisted = JSON.stringify({
    name: skill.name,
    instruction: skill.instruction ?? '',
    steps: skill.steps,
  });
  const dirty = draft !== (savedDraft ?? persisted);

  // Turning the skill on/off from here runs the *same* mutation the list row
  // runs — see `useSkillActiveToggle` for why that is one definition.
  const toggleActive = useSkillActiveToggle();

  // Recent runs are fetched only once the log is opened: an editor that pulls
  // an audit trail nobody asked for on every skill click is an invisible
  // request storm. `staleTime` keeps reopening it from refetching each time.
  const runs = useQuery({
    queryKey: ['playbook', 'skill-runs', skill.id],
    queryFn: () => api.get<{ items: SkillRun[] }>(`/skills/${skill.id}/runs`),
    enabled: runLogOpen,
    staleTime: 30_000,
  });

  // Both ways out of a screen with unsaved work — the browser's (reload, tab
  // close) and the app's own nav — ask first. Not while saving: those changes
  // are already on their way.
  useLeaveGuard(shouldWarnOnLeave(dirty, save.isPending), t('playbook.editor.discardConfirm'));

  // The server rejects a blank name (`z.string().trim().min(1)`) — the client
  // gate must match that threshold exactly, not be stricter (FR-MOD-06.2.2).
  const nameMissing = isBlank(name);

  // A step with a missing required parameter (most often a hand-over with no
  // team) would be stored and then skipped in silence in front of a customer —
  // so a save is refused until every step is runnable (FR-MOD-06.2.4).
  const canSave = dirty && !nameMissing && issues.length === 0 && !save.isPending;

  function reorder(from: number, to: number): void {
    if (!canEdit) return;
    const clampedTo = Math.max(0, Math.min(to, entries.length - 1));
    if (clampedTo === from || from < 0 || from >= entries.length) return;
    setAnnouncement(describeMoveText(steps, from, clampedTo, t));
    setEntries((current) => moveStep(current, from, clampedTo));
  }

  function editStep(index: number, patch: Partial<SkillStep>): void {
    setEntries((current) => updateStep(current, index, patch));
  }

  /**
   * Add a step of the chosen type and open it. Opening it is not a flourish:
   * a new step is blank, so it is a step that blocks the save — leaving it
   * collapsed would show a refusal with the form to fix it folded away.
   */
  function appendStep(): void {
    if (!canEdit) return;
    const next = addStep(entries, newStepType);
    const added = next[next.length - 1];
    setEntries(next);
    if (added) setOpenStepIds((open) => new Set(open).add(added.id));
  }

  function deleteStep(index: number): void {
    if (!canEdit) return;
    setEntries((current) => removeStep(current, index));
  }

  function retypeStep(index: number, type: StepType): void {
    setEntries((current) => changeStepType(current, index, type));
  }

  function toggleStepOpen(id: string): void {
    setOpenStepIds((open) => {
      const next = new Set(open);
      if (!next.delete(id)) next.add(id);
      return next;
    });
  }

  return (
    <div className="flex flex-col gap-4">
      <Card>
        {/* Top bar (FR-MOD-06.2.1): run log · on/off · Save. */}
        <div className="border-b border-border">
          <div className="flex flex-wrap items-center gap-2 px-4 py-2.5">
            <button
              type="button"
              aria-expanded={runLogOpen}
              aria-controls={RUN_LOG_ID}
              onClick={() => setRunLogOpen((open) => !open)}
              className="rounded-md border border-border px-2 py-1 text-2xs text-content-secondary transition-colors hover:bg-surface-2"
            >
              {t('playbook.skills.runsCount', { count: skill.runs_count })}{' '}
              <span aria-hidden="true">{runLogOpen ? '▴' : '▾'}</span>
            </button>

            <StatusDot
              tone={skill.active ? 'success' : 'neutral'}
              label={skill.active ? t('playbook.skills.on') : t('playbook.skills.off')}
            />

            {canEdit && (
              <button
                type="button"
                disabled={toggleActive.isPending}
                onClick={() => toggleActive.mutate({ id: skill.id, active: !skill.active })}
                className="rounded-md border border-border px-2 py-1 text-2xs text-content-secondary transition-colors hover:bg-surface-2 disabled:opacity-50"
              >
                {skill.active ? t('playbook.skills.disable') : t('playbook.skills.enable')}
              </button>
            )}

            {canEdit && (
              <button
                type="button"
                onClick={() => setDeleteOpen(true)}
                className="rounded-md border border-border px-2 py-1 text-2xs text-content-secondary transition-colors hover:border-danger hover:bg-danger/10 hover:text-danger"
              >
                {t('playbook.editor.delete')}
              </button>
            )}

            <span className="flex-1" />

            {canEdit && (
              <>
                <button
                  type="button"
                  disabled={!instruction.trim() || compile.isPending}
                  onClick={() => compile.mutate()}
                  className="rounded-md border border-border px-3 py-1.5 text-sm transition-colors hover:bg-surface-2 disabled:opacity-50"
                >
                  {compile.isPending
                    ? t('playbook.editor.compiling')
                    : t('playbook.editor.compile')}
                </button>

                <button
                  type="button"
                  disabled={!canSave}
                  onClick={() => save.mutate()}
                  className="rounded-md bg-brand-500 px-3 py-1.5 text-sm font-medium text-white transition-colors hover:bg-brand-600 disabled:opacity-50"
                >
                  {save.isPending ? t('playbook.editor.saving') : t('playbook.editor.save')}
                </button>
              </>
            )}
          </div>

          {canEdit &&
            (nameMissing || issues.length > 0 || save.isError || toggleActive.isError) && (
              <div className="flex flex-wrap items-center gap-3 px-4 pb-2.5">
                {nameMissing && (
                  <span role="alert" className="text-2xs text-warning">
                    {t('playbook.editor.nameRequired')}
                  </span>
                )}

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

                {toggleActive.isError && (
                  <span role="alert" className="text-2xs text-danger">
                    {t(errorMessageKey(toggleActive.error))}
                  </span>
                )}
              </div>
            )}
        </div>

        {runLogOpen && <RunLog query={runs} />}

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
          // Named so the list of steps is addressable on its own — the
          // fields inside it share labels with the app shell ("Team" is
          // also a nav destination).
          <ol aria-label={t('playbook.editor.stepsTitle')} className="divide-y divide-border">
            {entries.map((entry, index) => {
              const issue = issueByIndex.get(index);
              const open = openStepIds.has(entry.id);
              const bodyId = `step-body-${entry.id}`;
              return (
                <li
                  key={entry.id}
                  onDragOver={(event) => {
                    if (canEdit && dragIndex !== null) event.preventDefault();
                  }}
                  onDrop={(event) => {
                    event.preventDefault();
                    if (dragIndex !== null) reorder(dragIndex, index);
                    setDragIndex(null);
                  }}
                  className={dragIndex === index ? 'opacity-50' : ''}
                >
                  <div className="flex items-start gap-3 px-4 py-2.5">
                    {/* Only the handle is draggable, not the row: with the row
                        itself draggable, selecting the text in an open step's
                        input starts a drag instead of a selection. */}
                    {canEdit && (
                      <span
                        draggable
                        onDragStart={() => setDragIndex(index)}
                        onDragEnd={() => setDragIndex(null)}
                        aria-hidden="true"
                        className="mt-0.5 cursor-grab text-content-tertiary"
                      >
                        ⠿
                      </span>
                    )}
                    <span className="tabular mt-0.5 text-2xs text-content-tertiary">
                      {index + 1}
                    </span>

                    <div className="min-w-0 flex-1">
                      {/* The summary is the disclosure: what the step does is
                          the most useful name the control can have, so it is
                          the button's own content rather than a generic label. */}
                      <button
                        type="button"
                        aria-expanded={open}
                        aria-controls={bodyId}
                        onClick={() => toggleStepOpen(entry.id)}
                        className="w-full text-left"
                      >
                        <span className="block text-sm">{describeStepText(entry.step, t)}</span>
                        <code className="text-2xs text-content-tertiary">
                          {entry.step.type} <span aria-hidden="true">{open ? '▴' : '▾'}</span>
                        </code>
                      </button>

                      {/* Stays in the collapsed summary on purpose: a step that
                          blocks the save has to be findable without opening
                          every step to look for it. */}
                      {issue && (
                        <p role="alert" className="mt-1 text-2xs text-danger">
                          {issue}
                        </p>
                      )}
                    </div>

                    {canEdit && (
                      <div className="flex shrink-0 items-start gap-1">
                        <div className="flex flex-col gap-1">
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
                        <button
                          type="button"
                          aria-label={t('playbook.editor.deleteStep', { index: index + 1 })}
                          onClick={() => deleteStep(index)}
                          className="rounded border border-border px-1.5 py-0.5 text-2xs text-content-secondary transition-colors hover:bg-surface-2 hover:text-danger"
                        >
                          ✕
                        </button>
                      </div>
                    )}
                  </div>

                  {open && (
                    <div id={bodyId} className="flex flex-col gap-3 px-4 pb-3 pl-12">
                      {canEdit && (
                        <div className="flex flex-col gap-1">
                          {/* Sibling label, not a wrapper: wrapping a <select>
                              folds its option text into the accessible name. */}
                          <label
                            htmlFor={`step-type-${entry.id}`}
                            className="text-2xs text-content-tertiary"
                          >
                            {t('playbook.editor.stepType')}
                          </label>
                          <select
                            id={`step-type-${entry.id}`}
                            value={entry.step.type}
                            onChange={(event) => retypeStep(index, event.target.value as StepType)}
                            className="w-56 rounded-md border border-border bg-inset px-2 py-1 text-sm text-content outline-none"
                          >
                            {STEP_TYPES.map((type) => (
                              <option key={type} value={type}>
                                {t(STEP_TYPE_LABEL_KEYS[type])}
                              </option>
                            ))}
                          </select>
                        </div>
                      )}

                      <StepParameters
                        entry={entry}
                        canEdit={canEdit}
                        invalid={issue !== undefined}
                        onEdit={(patch) => editStep(index, patch)}
                      />
                    </div>
                  )}
                </li>
              );
            })}
          </ol>
        )}

        {/* Authoring, not just ordering (FR-MOD-06.2.4): without this a skill
            created from "New skill" is born with no steps and could never gain
            one, so the ordered-steps surface was unreachable for anything but a
            template. */}
        {canEdit && (
          <div className="flex flex-wrap items-center gap-2 border-t border-border px-4 py-2.5">
            <label htmlFor="add-step-type" className="sr-only">
              {t('playbook.editor.addStepType')}
            </label>
            <select
              id="add-step-type"
              value={newStepType}
              onChange={(event) => setNewStepType(event.target.value as StepType)}
              className="rounded-md border border-border bg-inset px-2 py-1 text-sm text-content outline-none"
            >
              {STEP_TYPES.map((type) => (
                <option key={type} value={type}>
                  {t(STEP_TYPE_LABEL_KEYS[type])}
                </option>
              ))}
            </select>
            <button
              type="button"
              onClick={appendStep}
              className="rounded-md border border-border px-3 py-1.5 text-sm transition-colors hover:bg-surface-2"
            >
              {t('playbook.editor.addStep')}
            </button>
          </div>
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

      {deleteOpen && (
        <DeleteSkillModal
          skill={skill}
          onClose={() => setDeleteOpen(false)}
          onDeleted={onDeleted}
        />
      )}
    </div>
  );
}

/**
 * Delete confirmation (FR-MOD-06.2.1, tm 246) — the one destructive action off
 * this screen, and the only one that never had a caller: the skill could be
 * created, edited and toggled, but never removed, so the list only ever grew.
 */
function DeleteSkillModal({
  skill,
  onClose,
  onDeleted,
}: {
  skill: Skill;
  onClose: () => void;
  onDeleted: () => void;
}): ReactElement {
  const t = useTranslate();
  const api = useApiClient();
  const queryClient = useQueryClient();

  const remove = useMutation({
    mutationFn: () => api.delete(`/skills/${skill.id}`),
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ['playbook'] });
      onDeleted();
    },
  });

  return (
    <Modal
      onClose={onClose}
      title={t('playbook.editor.deleteTitle', { name: skill.name })}
      description={t('playbook.editor.deleteDescription')}
    >
      {remove.isError && <ErrorNotice message={t(errorMessageKey(remove.error))} />}
      <div className="mt-4 flex justify-end gap-2">
        <button
          type="button"
          onClick={onClose}
          className="rounded-md border border-border px-3 py-1.5 text-sm"
        >
          {t('playbook.editor.deleteCancel')}
        </button>
        <button
          type="button"
          onClick={() => remove.mutate()}
          disabled={remove.isPending}
          className="rounded-md border border-danger px-3 py-1.5 text-sm font-medium text-danger transition-colors hover:bg-danger/10 disabled:opacity-50"
        >
          {remove.isPending ? t('playbook.editor.deleting') : t('playbook.editor.deleteConfirm')}
        </button>
      </div>
    </Modal>
  );
}

/**
 * The parameter form for one open step (FR-MOD-06.2.4).
 *
 * One switch, six shapes, matching `@nexa/ai-mock`'s `SkillStep` union field
 * for field — the fields shown are exactly the ones `validateStep` reads for
 * that type. Anything more would be a control that edits something the engine
 * ignores; anything less would be a required parameter with no way to fill it,
 * which is the state every type but `transfer_to_team` was in until now.
 */
function StepParameters({
  entry,
  canEdit,
  invalid,
  onEdit,
}: {
  entry: StepEntry;
  canEdit: boolean;
  invalid: boolean;
  onEdit: (patch: Partial<SkillStep>) => void;
}): ReactElement {
  const t = useTranslate();
  const { step, id } = entry;

  const inputClass =
    'rounded-md border border-border bg-inset px-2 py-1 text-sm outline-none disabled:opacity-60';

  switch (step.type) {
    case 'detect_intent':
      return (
        <>
          <label htmlFor={`intent-${id}`} className="flex flex-col gap-1">
            <span className="text-2xs text-content-tertiary">{t('playbook.editor.intent')}</span>
            <input
              id={`intent-${id}`}
              value={step.intent ?? ''}
              disabled={!canEdit}
              onChange={(event) => onEdit({ intent: event.target.value })}
              aria-invalid={invalid ? true : undefined}
              placeholder={t('playbook.editor.intentPlaceholder')}
              className={`w-56 ${inputClass}`}
            />
          </label>

          <PhrasesField
            id={id}
            phrases={step.phrases}
            disabled={!canEdit}
            onChange={(phrases) => onEdit({ phrases })}
          />
        </>
      );

    case 'request_info':
      return (
        <>
          <label htmlFor={`field-${id}`} className="flex flex-col gap-1">
            <span className="text-2xs text-content-tertiary">{t('playbook.editor.field')}</span>
            <input
              id={`field-${id}`}
              value={step.field ?? ''}
              disabled={!canEdit}
              onChange={(event) => onEdit({ field: event.target.value })}
              aria-invalid={invalid ? true : undefined}
              placeholder={t('playbook.editor.fieldPlaceholder')}
              className={`w-56 ${inputClass}`}
            />
          </label>

          <label htmlFor={`prompt-${id}`} className="flex flex-col gap-1">
            <span className="text-2xs text-content-tertiary">{t('playbook.editor.prompt')}</span>
            <input
              id={`prompt-${id}`}
              value={step.prompt ?? ''}
              disabled={!canEdit}
              onChange={(event) => onEdit({ prompt: event.target.value })}
              placeholder={t('playbook.editor.promptPlaceholder')}
              className={inputClass}
            />
          </label>
        </>
      );

    case 'tag':
      return (
        <label htmlFor={`tag-${id}`} className="flex flex-col gap-1">
          <span className="text-2xs text-content-tertiary">{t('playbook.editor.tag')}</span>
          <input
            id={`tag-${id}`}
            value={step.tag ?? ''}
            disabled={!canEdit}
            onChange={(event) => onEdit({ tag: event.target.value })}
            aria-invalid={invalid ? true : undefined}
            placeholder={t('playbook.editor.tagPlaceholder')}
            className={`w-56 ${inputClass}`}
          />
        </label>
      );

    case 'summarize':
      return <p className="text-2xs text-content-tertiary">{t('playbook.editor.noParameters')}</p>;

    case 'send_message':
      return (
        <>
          <div className="flex flex-col gap-1">
            <label htmlFor={`source-${id}`} className="text-2xs text-content-tertiary">
              {t('playbook.editor.replySource')}
            </label>
            <select
              id={`source-${id}`}
              value={step.source ?? ''}
              disabled={!canEdit}
              onChange={(event) =>
                // Switching to a knowledge answer drops the fixed text rather
                // than keeping it out of sight: the engine would never send it,
                // and a save would store a reply nobody wrote on purpose.
                onEdit(
                  event.target.value === 'knowledge'
                    ? { source: 'knowledge', text: undefined }
                    : { source: 'text', text: step.text ?? '' },
                )
              }
              className="w-56 rounded-md border border-border bg-inset px-2 py-1 text-sm text-content outline-none disabled:opacity-60"
            >
              <option value="text">{t('playbook.editor.sourceText')}</option>
              <option value="knowledge">{t('playbook.editor.sourceKnowledge')}</option>
            </select>
          </div>

          {step.source !== 'knowledge' && (
            <label htmlFor={`text-${id}`} className="flex flex-col gap-1">
              <span className="text-2xs text-content-tertiary">
                {t('playbook.editor.replyText')}
              </span>
              <textarea
                id={`text-${id}`}
                value={step.text ?? ''}
                disabled={!canEdit}
                rows={3}
                onChange={(event) => onEdit({ text: event.target.value })}
                aria-invalid={invalid ? true : undefined}
                placeholder={t('playbook.editor.replyTextPlaceholder')}
                className={`resize-y ${inputClass}`}
              />
            </label>
          )}
        </>
      );

    case 'transfer_to_team':
      return (
        <label htmlFor={`transfer-${id}`} className="flex flex-col gap-1">
          <span className="text-2xs text-content-tertiary">{t('playbook.editor.team')}</span>
          <input
            id={`transfer-${id}`}
            value={step.group ?? ''}
            disabled={!canEdit}
            onChange={(event) => onEdit({ group: event.target.value })}
            aria-invalid={invalid ? true : undefined}
            placeholder={t('playbook.editor.teamPlaceholder')}
            className={`w-48 ${inputClass}`}
          />
        </label>
      );

    default:
      return <p className="text-2xs text-content-tertiary">{t('playbook.editor.noParameters')}</p>;
  }
}

/**
 * The phrase list of a `detect_intent` step: one per line.
 *
 * The textarea keeps the text; the step keeps the parsed list. That split is
 * not tidiness — a textarea whose value is `formatPhrases(parsePhrases(text))`
 * cannot be typed into at all, because the parse trims the trailing space away
 * before the next character arrives and "where is my order" comes out
 * "whereismyorder".
 */
function PhrasesField({
  id,
  phrases,
  disabled,
  onChange,
}: {
  id: string;
  phrases: string[] | undefined;
  disabled: boolean;
  onChange: (phrases: string[] | undefined) => void;
}): ReactElement {
  const t = useTranslate();
  const [text, setText] = useState(() => formatPhrases(phrases));

  return (
    <>
      <label htmlFor={`phrases-${id}`} className="flex flex-col gap-1">
        <span className="text-2xs text-content-tertiary">{t('playbook.editor.phrases')}</span>
        <textarea
          id={`phrases-${id}`}
          value={text}
          disabled={disabled}
          rows={3}
          aria-describedby={`phrases-help-${id}`}
          onChange={(event) => {
            setText(event.target.value);
            onChange(parsePhrases(event.target.value));
          }}
          className="resize-y rounded-md border border-border bg-inset px-2 py-1 text-sm outline-none disabled:opacity-60"
        />
      </label>
      {/* Outside the label on purpose: a hint inside one becomes part of the
          field's accessible name. */}
      <p id={`phrases-help-${id}`} className="-mt-2 text-2xs text-content-tertiary">
        {t('playbook.editor.phrasesHelp')}
      </p>
    </>
  );
}

/**
 * What the skill actually did, the last twenty-five times it ran — the audit an
 * admin reads when a customer got an answer nobody expected (FR-MOD-06.2.1).
 *
 * Each of loading, failed, empty and populated renders something that says
 * which it is. A skill that has never run is a normal state, not a blank
 * rectangle (design-brief §1.5), and it is the state every newly created skill
 * is in — so it is the one an admin is most likely to open first.
 */
function RunLog({
  query,
}: {
  query: UseQueryResult<{ items: SkillRun[] }, unknown>;
}): ReactElement {
  const t = useTranslate();

  return (
    <div id={RUN_LOG_ID} role="region" aria-label={t('playbook.editor.runLogTitle')}>
      {query.isPending && (
        <p role="status" className="px-4 py-3 text-2xs text-content-tertiary">
          {t('playbook.editor.runLogLoading')}
        </p>
      )}

      {query.isError && (
        <p role="alert" className="px-4 py-3 text-2xs text-danger">
          {t('playbook.editor.runLogError')}
        </p>
      )}

      {query.data &&
        (query.data.items.length === 0 ? (
          <EmptyState
            title={t('playbook.editor.runLogEmptyTitle')}
            description={t('playbook.editor.runLogEmptyDescription')}
          />
        ) : (
          <ol className="divide-y divide-border border-b border-border">
            {query.data.items.map((run) => (
              <li key={run.id} className="flex flex-wrap items-center gap-2 px-4 py-2">
                <span className="text-2xs text-content-tertiary">
                  {formatDateTime(run.ran_at) ?? run.ran_at}
                </span>
                <StatusDot tone={runTone(run)} label={runLabel(run, t)} />
                {run.chat_id && (
                  // The conversation that set it off. It may since have been
                  // archived — the inbox opens it read-only rather than 404ing,
                  // which is why this is a plain deep link and not a guard.
                  <Link
                    to={`/app/inbox?chat=${run.chat_id}`}
                    className="text-2xs text-content-brand underline underline-offset-2"
                  >
                    {t('playbook.editor.runLogOpenChat')}
                  </Link>
                )}
              </li>
            ))}
          </ol>
        ))}
    </div>
  );
}

/**
 * What the run decided, if it recorded one; otherwise whether it finished.
 * `status` and `outcome` answer different questions — a run can succeed and
 * still decide to do nothing — so a failed run is always reported as failed,
 * whatever outcome it managed to write first.
 */
function runLabel(run: SkillRun, t: TFunction): string {
  if (run.status !== 'succeeded') {
    return run.status === 'failed'
      ? t('playbook.editor.runFailed')
      : t('playbook.editor.runAborted');
  }
  switch (run.outcome) {
    case 'answered':
      return t('playbook.editor.runAnswered');
    case 'handed_off':
      return t('playbook.editor.runHandedOff');
    case 'skipped':
      return t('playbook.editor.runSkipped');
    default:
      return t('playbook.editor.runSucceeded');
  }
}

function runTone(run: SkillRun): StatusTone {
  if (run.status === 'failed') return 'danger';
  if (run.status === 'aborted') return 'warning';
  if (run.outcome === 'handed_off') return 'info';
  if (run.outcome === 'skipped') return 'neutral';
  return 'success';
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

      {result.summary && (
        <p className="rounded-md bg-surface p-2 text-sm">
          <span className="mb-1 block text-2xs text-content-tertiary">
            {t('playbook.editor.summaryLabel')}
          </span>
          {result.summary}
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
