/**
 * Skill editor: instruction → compiled steps → preview.
 *
 * The three sit on one screen because they are one decision. An admin writing
 * automation needs to see what their words became and what those steps do to a
 * real message, before a customer is the one who finds out.
 */
import { useMutation } from '@tanstack/react-query';
import { useState, type ReactElement } from 'react';
import { Card } from '../../components/Page.js';
import { StatusDot } from '../../components/StatusDot.js';
import { ApiClientError } from '../../lib/api-client.js';
import { useApiClient } from '../../lib/auth-store.js';
import { describeStep, type Skill, type SkillPreview, type SkillStep } from './types.js';

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
  const [steps, setSteps] = useState<SkillStep[]>(skill.steps);
  const [unrecognised, setUnrecognised] = useState<string[]>([]);
  const [sample, setSample] = useState('Where is my order?');

  const compile = useMutation({
    mutationFn: () =>
      api.post<{ steps: SkillStep[]; unrecognised: string[] }>('/skills/compile', {
        instruction,
      }),
    onSuccess: (result) => {
      setSteps(result.steps);
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
                disabled={!dirty || save.isPending}
                onClick={() => save.mutate()}
                className="rounded-md bg-brand-500 px-3 py-1.5 text-sm font-medium text-white transition-colors hover:bg-brand-600 disabled:opacity-50"
              >
                {save.isPending ? 'Saving…' : 'Save changes'}
              </button>

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
        <h3 className="border-b border-border px-4 py-2.5 text-xs font-medium uppercase tracking-wide text-content-tertiary">
          Steps
        </h3>
        {steps.length === 0 ? (
          <p className="px-4 py-3 text-sm text-content-secondary">
            No steps yet. Write an instruction and compile it.
          </p>
        ) : (
          <ol className="divide-y divide-border">
            {steps.map((step, index) => (
              <li key={index} className="flex items-start gap-3 px-4 py-2.5">
                <span className="tabular mt-0.5 text-2xs text-content-tertiary">{index + 1}</span>
                <div className="min-w-0 flex-1">
                  <p className="text-sm">{describeStep(step)}</p>
                  <code className="text-2xs text-content-tertiary">{step.type}</code>
                </div>
              </li>
            ))}
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
