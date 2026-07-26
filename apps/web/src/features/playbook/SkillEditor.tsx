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
import { ApiClientError } from '../../lib/api-client.js';
import { useApiClient } from '../../lib/auth-store.js';
import { describeStep, type Skill, type SkillPreview, type SkillStep } from './types.js';
import { describeMove, moveStep, stepIssues } from './step-reorder.js';

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
  const api = useApiClient();

  const [name, setName] = useState(skill.name);
  const [instruction, setInstruction] = useState(skill.instruction ?? '');
  const [entries, setEntries] = useState<StepEntry[]>(() => skill.steps.map(wrap));
  const [unrecognised, setUnrecognised] = useState<string[]>([]);
  const [sample, setSample] = useState('Where is my order?');
  const [announcement, setAnnouncement] = useState('');
  const [dragIndex, setDragIndex] = useState<number | null>(null);

  const steps = useMemo(() => entries.map((entry) => entry.step), [entries]);
  const issues = useMemo(() => stepIssues(steps), [steps]);
  const issueByIndex = useMemo(
    () => new Map(issues.map((issue) => [issue.index, issue.message])),
    [issues],
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
    setAnnouncement(describeMove(steps, from, clampedTo));
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
              Name
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
              Instruction
            </span>
            <textarea
              id="skill-instruction"
              value={instruction}
              disabled={!canEdit}
              onChange={(event) => setInstruction(event.target.value)}
              rows={5}
              placeholder={
                'When someone asks about delivery times, ask for their order number.\nTag it as shipping.\nAnswer from the knowledge base.'
              }
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
                {compile.isPending ? 'Compiling…' : 'Compile to steps'}
              </button>

              <button
                type="button"
                disabled={!canSave}
                onClick={() => save.mutate()}
                className="rounded-md bg-brand-500 px-3 py-1.5 text-sm font-medium text-white transition-colors hover:bg-brand-600 disabled:opacity-50"
              >
                {save.isPending ? 'Saving…' : 'Save changes'}
              </button>

              {issues.length > 0 && (
                <span role="alert" className="text-2xs text-warning">
                  Fix {issues.length} step{issues.length === 1 ? '' : 's'} before saving.
                </span>
              )}

              {save.isError && (
                <span role="alert" className="text-2xs text-danger">
                  {save.error instanceof ApiClientError ? save.error.message : 'Could not save.'}
                </span>
              )}
            </div>
          )}

          {unrecognised.length > 0 && (
            <div role="status" className="rounded-md border border-border bg-inset p-3">
              <p className="text-2xs font-medium text-warning">
                {unrecognised.length} line{unrecognised.length === 1 ? '' : 's'} produced no step
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
          <h3 className="text-xs font-medium uppercase tracking-wide text-content-tertiary">Steps</h3>
          {canEdit && entries.length > 1 && (
            <span className="text-2xs text-content-tertiary">Drag, or use ↑ ↓ to reorder</span>
          )}
        </div>

        {/* Move confirmations for a keyboard/screen-reader user (NFR-A11Y4). */}
        <p aria-live="polite" className="sr-only">
          {announcement}
        </p>

        {entries.length === 0 ? (
          <p className="px-4 py-3 text-sm text-content-secondary">
            No steps yet. Write an instruction and compile it.
          </p>
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
                    <p className="text-sm">{describeStep(entry.step)}</p>
                    <code className="text-2xs text-content-tertiary">{entry.step.type}</code>

                    {entry.step.type === 'transfer_to_team' && (
                      <label
                        htmlFor={`transfer-${entry.id}`}
                        className="mt-1.5 flex flex-col gap-1"
                      >
                        <span className="text-2xs text-content-tertiary">Team</span>
                        <input
                          id={`transfer-${entry.id}`}
                          value={entry.step.group ?? ''}
                          disabled={!canEdit}
                          onChange={(event) => setTransferTarget(index, event.target.value)}
                          aria-invalid={issue ? true : undefined}
                          placeholder="Support"
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
                        aria-label={`Move step ${index + 1} up`}
                        disabled={index === 0}
                        onClick={() => reorder(index, index - 1)}
                        className="rounded border border-border px-1.5 text-2xs text-content-secondary transition-colors hover:bg-surface-2 disabled:opacity-30"
                      >
                        ↑
                      </button>
                      <button
                        type="button"
                        aria-label={`Move step ${index + 1} down`}
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
          Preview
        </h3>
        <div className="flex flex-col gap-3 p-4">
          <label htmlFor="skill-sample" className="flex flex-col gap-1">
            <span className="text-2xs text-content-secondary">A message a customer might send</span>
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
            {preview.isPending ? 'Running…' : 'Run preview'}
          </button>

          {preview.data && <PreviewResult result={preview.data} />}

          {preview.isError && (
            <p role="alert" className="text-2xs text-danger">
              Could not run the preview.
            </p>
          )}
        </div>
      </Card>
    </div>
  );
}

function PreviewResult({ result }: { result: SkillPreview }): ReactElement {
  const tone =
    result.outcome === 'answered'
      ? 'success'
      : result.outcome === 'handed_off'
        ? 'info'
        : 'warning';
  const label =
    result.outcome === 'answered'
      ? 'Would answer'
      : result.outcome === 'handed_off'
        ? 'Would hand over'
        : 'Would do nothing';

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
          <span className="mb-1 block text-2xs text-content-tertiary">Reply to the customer</span>
          {result.reply}
        </p>
      )}

      {result.transfer_to && (
        <p className="text-sm text-content-secondary">Hands over to {result.transfer_to}</p>
      )}

      {result.tags.length > 0 && (
        <p className="text-2xs text-content-secondary">Tags: {result.tags.join(', ')}</p>
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
