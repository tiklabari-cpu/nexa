/**
 * A procedure skill's sections (AI-03 · ADR-14a): when to use it, example
 * sentences, priority, the information to collect, the steps, the reply
 * templates and the hand-over. A form, not a canvas — the decision K8 took:
 * a structured step list with plain-language instructions reads in a review
 * and diffs in a log; a drawn graph does neither.
 *
 * Everything here edits a `ProcedureDraft` through `procedure-authoring.ts`'s
 * pure functions; what the draft may be saved as is the save-time validator's
 * question (`validateDraft`), answered once in `SkillEditor` and handed down
 * as `problems` so each section can say what in it blocks the save.
 *
 * Problems are worded here from their codes (`procedureProblemText`), the
 * same way the one-message step list words `StepProblem` (tm 261): the
 * validator's English sentence would read as English in a Turkish console.
 */
import {
  DEFAULT_RESOLUTION_CRITERIA,
  PROCEDURE_FACTS,
  PROC_OUTCOMES,
  SLOT_ENUM_SOURCES,
  SLOT_PII_LEVELS,
  SLOT_TYPES,
  procedureProblemDetails,
  type Cond,
  type CondOp,
  type HandoffTarget,
  type ProcBranch,
  type ProcStep,
  type ProcStepType,
  type ProcedureProblem,
  type ProcedureProblemDetails,
  type ProcedureWarning,
  type SlotDef,
  type SlotEnumSource,
  type SlotType,
} from '@siyahtus/types';
import { memo, useState, type ReactElement, type ReactNode } from 'react';
import { StatusDot } from '../../components/StatusDot.js';
import { hasMessage, useTranslate, type TFunction } from '../../lib/i18n.js';
import {
  EDITOR_BRANCH_TYPES,
  EDITOR_PROC_STEP_TYPES,
  VALUELESS_OPS,
  addProcStep,
  blankBranch,
  blankCondition,
  blankSlot,
  blankTemplate,
  branchKind,
  changeProcStepType,
  changeSimpleKind,
  changeSlotType,
  condFromSimple,
  formatLines,
  moveProcStep,
  parseLines,
  removeAt,
  removeProcStep,
  renameProcStep,
  replaceAt,
  simpleCond,
  simpleOps,
  simpleValueKind,
  updateProcStep,
  type BranchKind,
  type ProcedureDraft,
  type SimpleCond,
} from './procedure-authoring.js';
import type { AiConversationState } from './types.js';

export type DraftUpdate = (update: (draft: ProcedureDraft) => ProcedureDraft) => void;

export interface TeamOption {
  id: number;
  name: string;
}

export const inputClass =
  'rounded-md border border-border bg-inset px-2 py-1 text-sm outline-none disabled:opacity-60';
export const smallButton =
  'rounded border border-border px-1.5 py-0.5 text-2xs text-content-secondary transition-colors hover:bg-surface-2 disabled:opacity-30';
export const addButton =
  'self-start rounded-md border border-border px-3 py-1.5 text-sm transition-colors hover:bg-surface-2';

// ---------------------------------------------------------------------------
// Wording.
// ---------------------------------------------------------------------------

/** The settings a problem names, in words; a field without one is shown as written. */
function fieldLabel(t: TFunction, field: string | undefined): string {
  if (field === undefined) return '';
  const key = `playbook.procedure.field.${field}`;
  return hasMessage('en', key) ? t(key) : field;
}

/** Where in the definition a problem is — omitted when it is shown in that place already. */
function whereText(t: TFunction, details: ProcedureProblemDetails): string | null {
  const position = details.position;
  switch (details.section) {
    case 'steps':
      return position === undefined
        ? null
        : t('playbook.procedure.where.step', { position, id: details.step_id ?? '' });
    case 'slots':
      return position === undefined ? null : t('playbook.procedure.where.slot', { position });
    case 'templates':
      return position === undefined ? null : t('playbook.procedure.where.template', { position });
    case 'handoff':
      return position === undefined
        ? t('playbook.procedure.where.handoff')
        : t('playbook.procedure.where.handoffCondition', { position });
    default:
      return null;
  }
}

/**
 * One refusal, worded from its code. A code this build has no sentence for
 * (a server ahead of the console) gets the general one — never the server's
 * English.
 */
export function procedureProblemText(
  t: TFunction,
  details: ProcedureProblemDetails,
  options: { where?: boolean } = {},
): string {
  const key = `playbook.procedure.problem.${details.reason}`;
  const text = hasMessage('en', key)
    ? t(key, {
        field: fieldLabel(t, details.field),
        slot: details.slot ?? '',
        step_id: details.step_id ?? '',
        template_key: details.template_key ?? '',
        reference: details.reference ?? '',
      })
    : t('playbook.procedure.problem.generic');
  const where = options.where === false ? null : whereText(t, details);
  return where ? t('playbook.procedure.problemAt', { where, text }) : text;
}

const OP_KEYS: Record<CondOp, string> = {
  eq: 'playbook.procedure.op.eq',
  neq: 'playbook.procedure.op.neq',
  lt: 'playbook.procedure.op.lt',
  lte: 'playbook.procedure.op.lte',
  gt: 'playbook.procedure.op.gt',
  gte: 'playbook.procedure.op.gte',
  in: 'playbook.procedure.op.in',
  not_in: 'playbook.procedure.op.not_in',
  exists: 'playbook.procedure.op.exists',
  missing: 'playbook.procedure.op.missing',
  matches: 'playbook.procedure.op.matches',
};

function condSummary(cond: Cond | undefined, t: TFunction): string {
  const simple = simpleCond(cond);
  if (simple === null) return t('playbook.procedure.cond.complex');
  if (simple.kind === 'ai') return t('playbook.procedure.cond.ai', { question: simple.question });
  if (simple.kind === 'confirmed') return t('playbook.procedure.cond.kindConfirmed');
  const subject =
    simple.kind === 'elapsed'
      ? t('playbook.procedure.cond.elapsedSubject', { slot: simple.subject || '?' })
      : simple.subject || '?';
  const value = VALUELESS_OPS.includes(simple.op) ? '' : (simple.valueFact ?? simple.value);
  return `${subject} ${t(OP_KEYS[simple.op])} ${value}`.trim();
}

function branchSummary(branch: ProcBranch | undefined, t: TFunction): string {
  if (branch === undefined) return t('playbook.procedure.branch.next');
  if ('goto' in branch) return t('playbook.procedure.branch.goto', { id: branch.goto || '?' });
  return t(STEP_TYPE_KEYS[branch.type]);
}

const STEP_TYPE_KEYS: Record<ProcStepType, string> = {
  say: 'playbook.procedure.stepType.say',
  collect: 'playbook.procedure.stepType.collect',
  check: 'playbook.procedure.stepType.check',
  answer_from_knowledge: 'playbook.procedure.stepType.answer_from_knowledge',
  handoff: 'playbook.procedure.stepType.handoff',
  resolve: 'playbook.procedure.stepType.resolve',
  tag: 'playbook.procedure.stepType.tag',
  tool: 'playbook.procedure.stepType.tool',
};

/** What a step does, in one line — the step's disclosure button and its row's name. */
export function describeProcStep(step: ProcStep, t: TFunction): string {
  switch (step.type) {
    case 'say':
      if (step.template_key) {
        return t('playbook.procedure.summary.sayTemplate', { key: step.template_key });
      }
      return step.instruction?.trim()
        ? t('playbook.procedure.summary.sayInstruction', { text: step.instruction })
        : t('playbook.procedure.summary.sayEmpty');
    case 'collect':
      return step.slots.length > 0
        ? t('playbook.procedure.summary.collect', { slots: step.slots.join(', ') })
        : t('playbook.procedure.summary.collectEmpty');
    case 'check':
      return t('playbook.procedure.summary.check', {
        cond: condSummary(step.when, t),
        then: branchSummary(step.then, t),
        else: branchSummary(step.else, t),
      });
    case 'answer_from_knowledge':
      return t('playbook.procedure.summary.answer');
    case 'handoff':
      return t('playbook.procedure.summary.handoff', { reason: step.reason_code || '?' });
    case 'resolve':
      return step.outcome === 'resolved_waiting'
        ? t('playbook.procedure.summary.resolveWaiting')
        : t('playbook.procedure.summary.resolve');
    case 'tag':
      return t('playbook.procedure.summary.tag', { tag: step.tag || '?' });
    case 'tool':
      return t('playbook.procedure.summary.tool', { tool: step.tool_key || '?' });
  }
}

// ---------------------------------------------------------------------------
// The sections.
// ---------------------------------------------------------------------------

function SectionCard({
  title,
  id,
  children,
}: {
  title: string;
  id: string;
  children: ReactNode;
}): ReactElement {
  return (
    <section
      aria-labelledby={id}
      className="flex flex-col gap-3 border-t border-border px-4 py-3 first:border-t-0"
    >
      <h4 id={id} className="text-xs font-medium uppercase tracking-wide text-content-tertiary">
        {title}
      </h4>
      {children}
    </section>
  );
}

function ProblemList({
  problems,
  where = true,
}: {
  problems: readonly ProcedureProblemDetails[];
  where?: boolean;
}): ReactElement | null {
  const t = useTranslate();
  if (problems.length === 0) return null;
  return (
    <ul role="alert" className="flex flex-col gap-0.5">
      {problems.map((problem, index) => (
        <li key={index} className="text-2xs text-danger">
          {procedureProblemText(t, problem, { where })}
        </li>
      ))}
    </ul>
  );
}

/**
 * The editor for a procedure skill's definition. `problems` is the
 * validator's verdict on `draft`; `teams` the license's teams, for a
 * hand-over's target. Memoised: typing a preview message or the name
 * re-renders the editor, and a long procedure need not re-render with it.
 */
export const ProcedureEditor = memo(function ProcedureEditor({
  draft,
  onChange,
  canEdit,
  problems,
  warnings,
  teams,
}: {
  draft: ProcedureDraft;
  onChange: DraftUpdate;
  canEdit: boolean;
  problems: readonly ProcedureProblem[];
  warnings: readonly ProcedureWarning[];
  teams: readonly TeamOption[];
}): ReactElement {
  const t = useTranslate();
  const details = problems.map(procedureProblemDetails);
  const inSection = (section: ProcedureProblemDetails['section']) =>
    details.filter((problem) => problem.section === section);

  return (
    <div className="flex flex-col">
      <SectionCard title={t('playbook.procedure.selectionTitle')} id="procedure-selection">
        <ProblemList problems={inSection('procedure')} />
        <SelectionFields draft={draft} onChange={onChange} canEdit={canEdit} />
      </SectionCard>

      <SectionCard title={t('playbook.procedure.slotsTitle')} id="procedure-slots">
        <ProblemList problems={inSection('slots').filter((p) => p.position === undefined)} />
        <SlotsSection
          draft={draft}
          onChange={onChange}
          canEdit={canEdit}
          problems={inSection('slots')}
        />
      </SectionCard>

      <SectionCard title={t('playbook.procedure.stepsTitle')} id="procedure-steps">
        <ProblemList problems={inSection('steps').filter((p) => p.position === undefined)} />
        <StepsSection
          draft={draft}
          onChange={onChange}
          canEdit={canEdit}
          problems={inSection('steps')}
          warnings={warnings}
          teams={teams}
        />
      </SectionCard>

      <SectionCard title={t('playbook.procedure.templatesTitle')} id="procedure-templates">
        <ProblemList problems={inSection('templates').filter((p) => p.position === undefined)} />
        <TemplatesSection
          draft={draft}
          onChange={onChange}
          canEdit={canEdit}
          problems={inSection('templates')}
        />
      </SectionCard>

      <SectionCard title={t('playbook.procedure.handoffTitle')} id="procedure-handoff">
        <ProblemList problems={[...inSection('handoff'), ...inSection('limits')]} />
        <HandoffSection draft={draft} onChange={onChange} canEdit={canEdit} teams={teams} />
      </SectionCard>
    </div>
  );
});

/** When to use · example sentences · priority — what selects the procedure (AI-05). */
function SelectionFields({
  draft,
  onChange,
  canEdit,
}: {
  draft: ProcedureDraft;
  onChange: DraftUpdate;
  canEdit: boolean;
}): ReactElement {
  const t = useTranslate();
  return (
    <>
      <label htmlFor="procedure-when-to-use" className="flex flex-col gap-1">
        <span className="text-2xs text-content-tertiary">{t('playbook.procedure.whenToUse')}</span>
        <textarea
          id="procedure-when-to-use"
          value={draft.when_to_use}
          disabled={!canEdit}
          rows={2}
          placeholder={t('playbook.procedure.whenToUsePlaceholder')}
          onChange={(event) => {
            const when_to_use = event.target.value;
            onChange((current) => ({ ...current, when_to_use }));
          }}
          className={`resize-y ${inputClass}`}
        />
      </label>

      <LinesField
        id="procedure-examples"
        label={t('playbook.procedure.examples')}
        help={t('playbook.procedure.examplesHelp')}
        lines={draft.examples}
        disabled={!canEdit}
        onChange={(examples) => onChange((current) => ({ ...current, examples }))}
      />

      <label htmlFor="procedure-priority" className="flex flex-col gap-1">
        <span className="text-2xs text-content-tertiary">{t('playbook.procedure.priority')}</span>
        <NumberInput
          id="procedure-priority"
          value={draft.priority}
          disabled={!canEdit}
          describedBy="procedure-priority-help"
          onChange={(priority) => onChange((current) => ({ ...current, priority }))}
        />
      </label>
      {/* Outside the label: a hint inside one becomes part of the field's name. */}
      <p id="procedure-priority-help" className="-mt-2 text-2xs text-content-tertiary">
        {t('playbook.procedure.priorityHelp')}
      </p>
    </>
  );
}

/**
 * A number box that can be emptied while typing. The draft keeps a number —
 * an empty box is `NaN`, which the validator refuses by name — and the box
 * keeps the text, for the same reason `PhrasesField` keeps its own.
 */
export function NumberInput({
  id,
  value,
  disabled,
  onChange,
  describedBy,
}: {
  id: string;
  value: number;
  disabled: boolean;
  onChange: (value: number) => void;
  describedBy?: string;
}): ReactElement {
  const [text, setText] = useState(() => (Number.isFinite(value) ? String(value) : ''));
  return (
    <input
      id={id}
      inputMode="numeric"
      value={text}
      disabled={disabled}
      aria-describedby={describedBy}
      onChange={(event) => {
        setText(event.target.value);
        const trimmed = event.target.value.trim();
        onChange(trimmed === '' ? Number.NaN : Number(trimmed));
      }}
      className={`w-28 ${inputClass}`}
    />
  );
}

/** One entry per line; the textarea keeps the text, the draft the parsed list. */
function LinesField({
  id,
  label,
  help,
  lines,
  disabled,
  onChange,
}: {
  id: string;
  label: string;
  help?: string;
  lines: readonly string[];
  disabled: boolean;
  onChange: (lines: string[]) => void;
}): ReactElement {
  const [text, setText] = useState(() => formatLines(lines));
  return (
    <>
      <label htmlFor={id} className="flex flex-col gap-1">
        <span className="text-2xs text-content-tertiary">{label}</span>
        <textarea
          id={id}
          value={text}
          disabled={disabled}
          rows={3}
          aria-describedby={help ? `${id}-help` : undefined}
          onChange={(event) => {
            setText(event.target.value);
            onChange(parseLines(event.target.value));
          }}
          className={`resize-y ${inputClass}`}
        />
      </label>
      {help && (
        <p id={`${id}-help`} className="-mt-2 text-2xs text-content-tertiary">
          {help}
        </p>
      )}
    </>
  );
}

export function Select<T extends string>({
  id,
  label,
  value,
  options,
  disabled,
  onChange,
  className = 'w-56',
}: {
  id: string;
  label: string;
  value: T;
  options: ReadonlyArray<readonly [T, string]>;
  disabled: boolean;
  onChange: (value: T) => void;
  className?: string;
}): ReactElement {
  return (
    <div className="flex flex-col gap-1">
      {/* Sibling label, not a wrapper: wrapping a <select> folds its options into its name. */}
      <label htmlFor={id} className="text-2xs text-content-tertiary">
        {label}
      </label>
      <select
        id={id}
        value={value}
        disabled={disabled}
        onChange={(event) => onChange(event.target.value as T)}
        className={`${className} rounded-md border border-border bg-inset px-2 py-1 text-sm text-content outline-none disabled:opacity-60`}
      >
        {options.map(([option, text]) => (
          <option key={option} value={option}>
            {text}
          </option>
        ))}
      </select>
    </div>
  );
}

export function TextInput({
  id,
  label,
  value,
  disabled,
  onChange,
  placeholder,
  invalid,
  className = 'w-56',
}: {
  id: string;
  label: string;
  value: string;
  disabled: boolean;
  onChange: (value: string) => void;
  placeholder?: string;
  invalid?: boolean;
  className?: string;
}): ReactElement {
  return (
    <label htmlFor={id} className="flex flex-col gap-1">
      <span className="text-2xs text-content-tertiary">{label}</span>
      <input
        id={id}
        value={value}
        disabled={disabled}
        placeholder={placeholder}
        aria-invalid={invalid ? true : undefined}
        onChange={(event) => onChange(event.target.value)}
        className={`${className} ${inputClass}`}
      />
    </label>
  );
}

// ---------------------------------------------------------------------------
// Information to collect.
// ---------------------------------------------------------------------------

function SlotsSection({
  draft,
  onChange,
  canEdit,
  problems,
}: {
  draft: ProcedureDraft;
  onChange: DraftUpdate;
  canEdit: boolean;
  problems: readonly ProcedureProblemDetails[];
}): ReactElement {
  const t = useTranslate();
  const edit = (index: number, slot: SlotDef<Cond>) =>
    onChange((current) => ({ ...current, slots: replaceAt(current.slots, index, slot) }));

  return (
    <>
      {draft.slots.length === 0 ? (
        <p className="text-sm text-content-secondary">{t('playbook.procedure.noSlots')}</p>
      ) : (
        <ol aria-label={t('playbook.procedure.slotsTitle')} className="flex flex-col gap-3">
          {draft.slots.map((slot, index) => (
            <li
              key={index}
              aria-label={slot.label || slot.name || t('playbook.procedure.slotFallback')}
              className="flex flex-col gap-2 rounded-md border border-border p-3"
            >
              <ProblemList
                problems={problems.filter((p) => p.position === index + 1)}
                where={false}
              />
              <SlotFields
                slot={slot}
                index={index}
                canEdit={canEdit}
                onEdit={(next) => edit(index, next)}
              />
              {canEdit && (
                <button
                  type="button"
                  onClick={() =>
                    onChange((current) => ({ ...current, slots: removeAt(current.slots, index) }))
                  }
                  className={`${smallButton} self-start hover:text-danger`}
                >
                  {t('playbook.procedure.removeSlot')}
                </button>
              )}
            </li>
          ))}
        </ol>
      )}
      {canEdit && (
        <button
          type="button"
          onClick={() =>
            onChange((current) => ({ ...current, slots: [...current.slots, blankSlot()] }))
          }
          className={addButton}
        >
          {t('playbook.procedure.addSlot')}
        </button>
      )}
    </>
  );
}

function SlotFields({
  slot,
  index,
  canEdit,
  onEdit,
}: {
  slot: SlotDef<Cond>;
  index: number;
  canEdit: boolean;
  onEdit: (slot: SlotDef<Cond>) => void;
}): ReactElement {
  const t = useTranslate();
  const id = `slot-${index}`;
  const required = typeof slot.required === 'object' ? 'when' : slot.required;
  const enumSource = slot.validate?.enum_source;

  return (
    <div className="flex flex-wrap gap-3">
      <TextInput
        id={`${id}-name`}
        label={t('playbook.procedure.slotName')}
        value={slot.name}
        disabled={!canEdit}
        onChange={(name) => onEdit({ ...slot, name })}
        className="w-44"
      />
      <TextInput
        id={`${id}-label`}
        label={t('playbook.procedure.slotLabel')}
        value={slot.label}
        disabled={!canEdit}
        onChange={(label) => onEdit({ ...slot, label })}
        className="w-44"
      />
      <Select<SlotType>
        id={`${id}-type`}
        label={t('playbook.procedure.slotType')}
        value={slot.type}
        disabled={!canEdit}
        options={SLOT_TYPES.map(
          (type) => [type, t(`playbook.procedure.slotTypes.${type}`)] as const,
        )}
        onChange={(type) => onEdit(changeSlotType(slot, type))}
        className="w-44"
      />
      <TextInput
        id={`${id}-ask`}
        label={t('playbook.procedure.slotAsk')}
        value={slot.ask}
        disabled={!canEdit}
        onChange={(ask) => onEdit({ ...slot, ask })}
        className="w-full"
      />
      {/* A condition on `required` is kept as written: the form offers the two
          plain answers, and says so when the stored one is neither. */}
      <Select<'always' | 'never' | 'when'>
        id={`${id}-required`}
        label={t('playbook.procedure.slotRequired')}
        value={required}
        disabled={!canEdit}
        options={[
          ['always', t('playbook.procedure.requiredAlways')],
          ['never', t('playbook.procedure.requiredNever')],
          ...(required === 'when'
            ? ([['when', t('playbook.procedure.requiredWhen')]] as const)
            : []),
        ]}
        onChange={(value) => {
          if (value !== 'when') onEdit({ ...slot, required: value });
        }}
        className="w-44"
      />
      <Select
        id={`${id}-pii`}
        label={t('playbook.procedure.slotPii')}
        value={slot.pii}
        disabled={!canEdit}
        options={SLOT_PII_LEVELS.map((pii) => [pii, t(`playbook.procedure.pii.${pii}`)] as const)}
        onChange={(pii) => onEdit({ ...slot, pii })}
        className="w-44"
      />
      <label htmlFor={`${id}-card`} className="flex items-center gap-2 self-end text-sm">
        <input
          id={`${id}-card`}
          type="checkbox"
          checked={slot.show_in_card}
          disabled={!canEdit}
          onChange={(event) => onEdit({ ...slot, show_in_card: event.target.checked })}
        />
        {t('playbook.procedure.slotShowInCard')}
      </label>

      {slot.type === 'enum' && (
        <div className="flex w-full flex-wrap gap-3">
          <Select<'' | SlotEnumSource>
            id={`${id}-enum-source`}
            label={t('playbook.procedure.enumSource')}
            value={enumSource ?? ''}
            disabled={!canEdit}
            options={[
              ['', t('playbook.procedure.enumWritten')],
              ...SLOT_ENUM_SOURCES.map(
                (source) => [source, t(`playbook.procedure.enumSources.${source}`)] as const,
              ),
            ]}
            onChange={(source) =>
              onEdit({
                ...slot,
                validate: source === '' ? { enum_values: [] } : { enum_source: source },
              })
            }
          />
          {enumSource === undefined && (
            <div className="flex min-w-56 flex-1 flex-col">
              <LinesField
                id={`${id}-enum-values`}
                label={t('playbook.procedure.enumValues')}
                lines={slot.validate?.enum_values ?? []}
                disabled={!canEdit}
                onChange={(enum_values) => onEdit({ ...slot, validate: { enum_values } })}
              />
            </div>
          )}
        </div>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Steps.
// ---------------------------------------------------------------------------

function StepsSection({
  draft,
  onChange,
  canEdit,
  problems,
  warnings,
  teams,
}: {
  draft: ProcedureDraft;
  onChange: DraftUpdate;
  canEdit: boolean;
  problems: readonly ProcedureProblemDetails[];
  warnings: readonly ProcedureWarning[];
  teams: readonly TeamOption[];
}): ReactElement {
  const t = useTranslate();
  const [openKeys, setOpenKeys] = useState<ReadonlySet<string>>(() => new Set());
  const [newType, setNewType] = useState<(typeof EDITOR_PROC_STEP_TYPES)[number]>('say');
  const [announcement, setAnnouncement] = useState('');
  const steps = draft.steps;
  const stepIds = steps.map((entry) => entry.step.id).filter((id) => id.length > 0);

  const setSteps = (update: (steps: ProcedureDraft['steps']) => ProcedureDraft['steps']) =>
    onChange((current) => ({ ...current, steps: update(current.steps) }));

  function reorder(from: number, to: number): void {
    const clamped = Math.max(0, Math.min(to, steps.length - 1));
    const entry = steps[from];
    if (!canEdit || !entry || clamped === from) return;
    setAnnouncement(
      t('playbook.step.moveAnnouncement', {
        label: describeProcStep(entry.step, t),
        position: clamped + 1,
        total: steps.length,
      }),
    );
    setSteps((current) => moveProcStep(current, from, clamped));
  }

  function toggle(key: string): void {
    setOpenKeys((open) => {
      const next = new Set(open);
      if (!next.delete(key)) next.add(key);
      return next;
    });
  }

  return (
    <>
      <p aria-live="polite" className="sr-only">
        {announcement}
      </p>
      {steps.length === 0 ? (
        <p className="text-sm text-content-secondary">{t('playbook.procedure.noSteps')}</p>
      ) : (
        <ol aria-label={t('playbook.editor.stepsTitle')} className="divide-y divide-border">
          {steps.map((entry, index) => {
            const open = openKeys.has(entry.key);
            const bodyId = `proc-step-body-${entry.key}`;
            const stepProblems = problems.filter((p) => p.position === index + 1);
            const unreachable = warnings.some((w) => w.index === index);
            return (
              <li key={entry.key} className="flex flex-col gap-2 py-2.5">
                <div className="flex items-start gap-3">
                  <span className="tabular mt-0.5 text-2xs text-content-tertiary">{index + 1}</span>
                  <div className="min-w-0 flex-1">
                    <button
                      type="button"
                      aria-expanded={open}
                      aria-controls={bodyId}
                      onClick={() => toggle(entry.key)}
                      className="w-full text-left"
                    >
                      <span className="block text-sm">{describeProcStep(entry.step, t)}</span>
                      <span className="text-2xs text-content-tertiary">
                        {t(STEP_TYPE_KEYS[entry.step.type])} · {entry.step.id || '?'}{' '}
                        <span aria-hidden="true">{open ? '▴' : '▾'}</span>
                      </span>
                    </button>
                    {/* In the collapsed row on purpose: a step that blocks the save
                        has to be findable without opening every step. */}
                    <ProblemList problems={stepProblems} where={false} />
                    {unreachable && (
                      <p className="mt-1 text-2xs text-warning">
                        {t('playbook.procedure.problem.procedure_unreachable_step')}
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
                          className={smallButton}
                        >
                          ↑
                        </button>
                        <button
                          type="button"
                          aria-label={t('playbook.editor.moveDown', { index: index + 1 })}
                          disabled={index === steps.length - 1}
                          onClick={() => reorder(index, index + 1)}
                          className={smallButton}
                        >
                          ↓
                        </button>
                      </div>
                      <button
                        type="button"
                        aria-label={t('playbook.editor.deleteStep', { index: index + 1 })}
                        onClick={() => setSteps((current) => removeProcStep(current, index))}
                        className={`${smallButton} hover:text-danger`}
                      >
                        ✕
                      </button>
                    </div>
                  )}
                </div>

                {open && (
                  <div id={bodyId} className="flex flex-col gap-3 pl-6">
                    <div className="flex flex-wrap gap-3">
                      <TextInput
                        id={`${entry.key}-id`}
                        label={t('playbook.procedure.stepId')}
                        value={entry.step.id}
                        disabled={!canEdit}
                        onChange={(id) => setSteps((current) => renameProcStep(current, index, id))}
                        className="w-44"
                      />
                      <Select<ProcStepType>
                        id={`${entry.key}-type`}
                        label={t('playbook.editor.stepType')}
                        value={entry.step.type}
                        disabled={!canEdit}
                        options={[
                          ...EDITOR_PROC_STEP_TYPES.map(
                            (type) => [type, t(STEP_TYPE_KEYS[type])] as const,
                          ),
                          ...(entry.step.type === 'tool'
                            ? ([['tool', t(STEP_TYPE_KEYS.tool)]] as const)
                            : []),
                        ]}
                        onChange={(type) =>
                          setSteps((current) => changeProcStepType(current, index, type))
                        }
                      />
                    </div>

                    <StepBody
                      step={entry.step}
                      idPrefix={entry.key}
                      draft={draft}
                      stepIds={stepIds}
                      teams={teams}
                      canEdit={canEdit}
                      onEdit={(patch) =>
                        setSteps((current) => updateProcStep(current, index, patch))
                      }
                    />
                  </div>
                )}
              </li>
            );
          })}
        </ol>
      )}

      {canEdit && (
        <div className="flex flex-wrap items-center gap-2">
          <label htmlFor="add-proc-step-type" className="sr-only">
            {t('playbook.editor.addStepType')}
          </label>
          <select
            id="add-proc-step-type"
            value={newType}
            onChange={(event) =>
              setNewType(event.target.value as (typeof EDITOR_PROC_STEP_TYPES)[number])
            }
            className="rounded-md border border-border bg-inset px-2 py-1 text-sm text-content outline-none"
          >
            {EDITOR_PROC_STEP_TYPES.map((type) => (
              <option key={type} value={type}>
                {t(STEP_TYPE_KEYS[type])}
              </option>
            ))}
          </select>
          <button
            type="button"
            onClick={() => {
              const next = addProcStep(steps, newType);
              const added = next[next.length - 1];
              setSteps(() => next);
              // A new step is blank — it blocks the save — so it opens.
              if (added) setOpenKeys((open) => new Set(open).add(added.key));
            }}
            className="rounded-md border border-border px-3 py-1.5 text-sm transition-colors hover:bg-surface-2"
          >
            {t('playbook.editor.addStep')}
          </button>
        </div>
      )}
    </>
  );
}

/**
 * A step's own fields: instruction, its optional "Only if…", and what its type
 * takes. Shared with a `check` branch's step written in place (`inline`),
 * which has no id and no guard of its own.
 */
function StepBody({
  step,
  idPrefix,
  draft,
  stepIds,
  teams,
  canEdit,
  onEdit,
  inline = false,
}: {
  step: ProcStep | (ProcBranch & { type: string });
  idPrefix: string;
  draft: ProcedureDraft;
  stepIds: readonly string[];
  teams: readonly TeamOption[];
  canEdit: boolean;
  onEdit: (patch: Record<string, unknown>) => void;
  inline?: boolean;
}): ReactElement {
  const t = useTranslate();
  const s = step as ProcStep;
  const templateOptions = [
    ['', t('playbook.procedure.noTemplate')] as const,
    ...draft.templates
      .map((template) => template.key)
      .filter((key) => key.length > 0)
      .map((key) => [key, key] as const),
  ];

  const instruction = (
    <label htmlFor={`${idPrefix}-instruction`} className="flex flex-col gap-1">
      <span className="text-2xs text-content-tertiary">
        {t('playbook.procedure.stepInstruction')}
      </span>
      <textarea
        id={`${idPrefix}-instruction`}
        value={s.instruction ?? ''}
        disabled={!canEdit}
        rows={2}
        placeholder={t('playbook.procedure.stepInstructionPlaceholder')}
        onChange={(event) => onEdit({ instruction: event.target.value })}
        className={`resize-y ${inputClass}`}
      />
    </label>
  );

  let fields: ReactNode = null;
  switch (s.type) {
    case 'say':
      fields = (
        <Select
          id={`${idPrefix}-template`}
          label={t('playbook.procedure.stepTemplate')}
          value={s.template_key ?? ''}
          disabled={!canEdit}
          options={templateOptions}
          onChange={(key) => onEdit({ template_key: key === '' ? undefined : key })}
        />
      );
      break;
    case 'collect': {
      const known = draft.slots.map((slot) => slot.name).filter((name) => name.length > 0);
      // A slot the step names that the list no longer has stays visible, ticked,
      // so it can be unticked — the validator names it meanwhile.
      const names = [...known, ...s.slots.filter((name) => !known.includes(name))];
      fields = (
        <fieldset className="flex flex-col gap-1">
          <legend className="text-2xs text-content-tertiary">
            {t('playbook.procedure.stepSlots')}
          </legend>
          {names.length === 0 ? (
            <p className="text-2xs text-content-tertiary">
              {t('playbook.procedure.stepSlotsNone')}
            </p>
          ) : (
            <div className="flex flex-wrap gap-3">
              {names.map((name) => (
                <label key={name} className="flex items-center gap-1.5 text-sm">
                  <input
                    type="checkbox"
                    checked={s.slots.includes(name)}
                    disabled={!canEdit}
                    onChange={(event) =>
                      onEdit({
                        slots: event.target.checked
                          ? [...s.slots, name]
                          : s.slots.filter((slot) => slot !== name),
                      })
                    }
                  />
                  {name}
                </label>
              ))}
            </div>
          )}
        </fieldset>
      );
      break;
    }
    case 'check':
      fields = (
        <>
          <CondEditor
            idPrefix={`${idPrefix}-if`}
            label={t('playbook.procedure.checkIf')}
            cond={s.when}
            slots={draft.slots}
            canEdit={canEdit}
            onChange={(when) => onEdit({ when })}
          />
          <BranchEditor
            field="then"
            branch={s.then}
            idPrefix={`${idPrefix}-then`}
            draft={draft}
            stepIds={stepIds}
            teams={teams}
            canEdit={canEdit}
            onChange={(then) => onEdit({ then })}
          />
          <BranchEditor
            field="else"
            branch={s.else}
            idPrefix={`${idPrefix}-else`}
            draft={draft}
            stepIds={stepIds}
            teams={teams}
            canEdit={canEdit}
            onChange={(otherwise) => onEdit({ else: otherwise })}
          />
        </>
      );
      break;
    case 'answer_from_knowledge':
      fields = (
        <TextInput
          id={`${idPrefix}-query`}
          label={t('playbook.procedure.stepQueryHint')}
          value={s.query_hint ?? ''}
          disabled={!canEdit}
          onChange={(query_hint) => onEdit({ query_hint })}
          className="w-full"
        />
      );
      break;
    case 'handoff':
      fields = (
        <div className="flex flex-wrap gap-3">
          <TextInput
            id={`${idPrefix}-reason`}
            label={t('playbook.procedure.stepReason')}
            value={s.reason_code}
            disabled={!canEdit}
            onChange={(reason_code) => onEdit({ reason_code })}
          />
          <TargetField
            id={`${idPrefix}-target`}
            target={s.target}
            teams={teams}
            canEdit={canEdit}
            onChange={(target) => onEdit({ target })}
          />
        </div>
      );
      break;
    case 'resolve':
      fields = (
        <div className="flex flex-wrap gap-3">
          <Select
            id={`${idPrefix}-outcome`}
            label={t('playbook.procedure.stepOutcome')}
            value={s.outcome}
            disabled={!canEdit}
            options={PROC_OUTCOMES.map(
              (outcome) => [outcome, t(`playbook.procedure.outcome.${outcome}`)] as const,
            )}
            onChange={(outcome) => onEdit({ outcome })}
          />
          <Select
            id={`${idPrefix}-followup`}
            label={t('playbook.procedure.stepFollowup')}
            value={s.followup_template ?? ''}
            disabled={!canEdit}
            options={templateOptions}
            onChange={(key) => onEdit({ followup_template: key === '' ? undefined : key })}
          />
        </div>
      );
      break;
    case 'tag':
      fields = (
        <TextInput
          id={`${idPrefix}-tag`}
          label={t('playbook.editor.tag')}
          value={s.tag}
          disabled={!canEdit}
          onChange={(tag) => onEdit({ tag })}
        />
      );
      break;
    case 'tool':
      fields = (
        <p className="text-2xs text-content-tertiary">{t('playbook.procedure.toolPassive')}</p>
      );
      break;
  }

  return (
    <>
      {instruction}
      {fields}
      {!inline && s.type !== 'check' && (
        <GuardField
          idPrefix={`${idPrefix}-when`}
          cond={s.when}
          slots={draft.slots}
          canEdit={canEdit}
          onChange={(when) => onEdit({ when })}
        />
      )}
    </>
  );
}

/** "Only if…": a step's optional guard — off means the step always runs. */
function GuardField({
  idPrefix,
  cond,
  slots,
  canEdit,
  onChange,
}: {
  idPrefix: string;
  cond: Cond | undefined;
  slots: readonly SlotDef<Cond>[];
  canEdit: boolean;
  onChange: (cond: Cond | undefined) => void;
}): ReactElement {
  const t = useTranslate();
  return (
    <div className="flex flex-col gap-2">
      <label htmlFor={`${idPrefix}-on`} className="flex items-center gap-2 text-sm">
        <input
          id={`${idPrefix}-on`}
          type="checkbox"
          checked={cond !== undefined}
          disabled={!canEdit}
          onChange={(event) => onChange(event.target.checked ? blankCondition() : undefined)}
        />
        {t('playbook.procedure.onlyIf')}
      </label>
      {cond !== undefined && (
        <CondEditor
          idPrefix={idPrefix}
          label={t('playbook.procedure.onlyIfCondition')}
          cond={cond}
          slots={slots}
          canEdit={canEdit}
          onChange={onChange}
        />
      )}
    </div>
  );
}

/** A `check` branch: go to a step (the target step), or a step written in place. */
function BranchEditor({
  field,
  branch,
  idPrefix,
  draft,
  stepIds,
  teams,
  canEdit,
  onChange,
}: {
  field: 'then' | 'else';
  branch: ProcBranch | undefined;
  idPrefix: string;
  draft: ProcedureDraft;
  stepIds: readonly string[];
  teams: readonly TeamOption[];
  canEdit: boolean;
  onChange: (branch: ProcBranch | undefined) => void;
}): ReactElement {
  const t = useTranslate();
  const kind: BranchKind | 'next' = branch === undefined ? 'next' : branchKind(branch);
  const options: Array<readonly [BranchKind | 'next', string]> = [
    ...(field === 'else' ? ([['next', t('playbook.procedure.branch.next')]] as const) : []),
    ['goto', t('playbook.procedure.branch.gotoOption')],
    ...EDITOR_BRANCH_TYPES.map((type) => [type, t(STEP_TYPE_KEYS[type])] as const),
  ];
  const target = branch !== undefined && 'goto' in branch ? branch.goto : '';

  return (
    <div className="flex flex-col gap-2 rounded-md border border-border p-3">
      <div className="flex flex-wrap gap-3">
        <Select
          id={`${idPrefix}-kind`}
          label={t(
            field === 'then' ? 'playbook.procedure.thenLabel' : 'playbook.procedure.elseLabel',
          )}
          value={kind}
          disabled={!canEdit}
          options={options}
          onChange={(next) => onChange(next === 'next' ? undefined : blankBranch(next))}
        />
        {kind === 'goto' && (
          <Select
            id={`${idPrefix}-goto`}
            label={t('playbook.procedure.gotoTarget')}
            value={target}
            disabled={!canEdit}
            options={[
              ['', t('playbook.procedure.gotoChoose')],
              // A target the list no longer has stays selectable, so the
              // dangling goto shows what it was until it is changed.
              ...[...stepIds, ...(target && !stepIds.includes(target) ? [target] : [])].map(
                (id) => [id, id] as const,
              ),
            ]}
            onChange={(goto) => onChange({ goto })}
          />
        )}
      </div>
      {branch !== undefined && !('goto' in branch) && (
        <StepBody
          step={branch}
          idPrefix={`${idPrefix}-step`}
          draft={draft}
          stepIds={stepIds}
          teams={teams}
          canEdit={canEdit}
          inline
          onEdit={(patch) => {
            const next: Record<string, unknown> = { ...branch };
            for (const [key, value] of Object.entries(patch)) {
              if (value === undefined) delete next[key];
              else next[key] = value;
            }
            onChange(next as ProcBranch);
          }}
        />
      )}
    </div>
  );
}

/** Who a hand-over goes to: the routes decide (no target), a team, or a routing topic. */
export function TargetField({
  id,
  target,
  teams,
  canEdit,
  onChange,
}: {
  id: string;
  target: HandoffTarget | undefined;
  teams: readonly TeamOption[];
  canEdit: boolean;
  onChange: (target: HandoffTarget | undefined) => void;
}): ReactElement {
  const t = useTranslate();
  const value =
    target === undefined ? '' : 'group_id' in target ? `group:${target.group_id}` : 'topic';
  const known = teams.some((team) => `group:${team.id}` === value);
  return (
    <div className="flex flex-wrap gap-3">
      <Select
        id={id}
        label={t('playbook.procedure.target')}
        value={value}
        disabled={!canEdit}
        options={[
          ['', t('playbook.procedure.targetRoutes')],
          ...teams.map((team) => [`group:${team.id}`, team.name] as const),
          // A team id this license does not list (deleted since) stays visible.
          ...(value.startsWith('group:') && !known
            ? ([[value, t('playbook.procedure.targetUnknownTeam')]] as const)
            : []),
          ['topic', t('playbook.procedure.targetTopic')],
        ]}
        onChange={(next) => {
          if (next === '') onChange(undefined);
          else if (next === 'topic') onChange({ topic: '' });
          else onChange({ group_id: Number(next.slice('group:'.length)) });
        }}
      />
      {target !== undefined && 'topic' in target && (
        <TextInput
          id={`${id}-topic`}
          label={t('playbook.procedure.targetTopicName')}
          value={target.topic}
          disabled={!canEdit}
          onChange={(topic) => onChange({ topic })}
        />
      )}
    </div>
  );
}

/**
 * One condition: the one-row form when it can hold it, JSON otherwise. The
 * form never rewrites a condition it cannot show — opening a step with an
 * `all` of three comparisons and closing it again leaves it as written.
 */
export function CondEditor({
  idPrefix,
  label,
  cond,
  slots,
  canEdit,
  onChange,
  resolution,
}: {
  idPrefix: string;
  label: string;
  cond: Cond | undefined;
  slots: readonly SlotDef<Cond>[];
  canEdit: boolean;
  onChange: (cond: Cond) => void;
  /**
   * Editing "resolved" criteria (K9): adds the player's yes, and for the
   * workspace's default — which has no slots — drops the kinds that read one.
   */
  resolution?: 'procedure' | 'workspace';
}): ReactElement {
  const t = useTranslate();
  // `player_confirmed()` is only the form's to show where it is valid.
  const found = simpleCond(cond);
  const simple = found?.kind === 'confirmed' && resolution === undefined ? null : found;
  const [json, setJson] = useState<string | null>(() =>
    simple === null ? JSON.stringify(cond ?? {}, null, 2) : null,
  );
  const [jsonError, setJsonError] = useState(false);
  const kind: SimpleCond['kind'] | 'json' =
    json !== null ? 'json' : (simple?.kind ?? (resolution === 'workspace' ? 'confirmed' : 'slot'));

  const allKinds: Array<readonly [SimpleCond['kind'] | 'json', string]> = [
    ['confirmed', t('playbook.procedure.cond.kindConfirmed')],
    ['slot', t('playbook.procedure.cond.kindSlot')],
    ['fact', t('playbook.procedure.cond.kindFact')],
    ['elapsed', t('playbook.procedure.cond.kindElapsed')],
    ['ai', t('playbook.procedure.cond.kindAi')],
    ['json', t('playbook.procedure.cond.kindJson')],
  ];
  const kinds = allKinds.filter(([id]) => {
    if (id === 'confirmed') return resolution !== undefined;
    if (resolution === 'workspace') return id === 'ai' || id === 'json';
    return true;
  });

  function setKind(next: SimpleCond['kind'] | 'json'): void {
    if (next === 'json') {
      setJson(JSON.stringify(cond ?? {}, null, 2));
      setJsonError(false);
      return;
    }
    setJson(null);
    const base: SimpleCond = simple ?? { kind: 'slot', subject: '', op: 'exists', value: '' };
    onChange(condFromSimple(changeSimpleKind(base, next, slots), slots));
  }

  const emit = (next: SimpleCond) => onChange(condFromSimple(next, slots));

  let body: ReactNode = null;
  if (kind === 'json') {
    body = (
      <>
        <label htmlFor={`${idPrefix}-json`} className="flex flex-col gap-1">
          <span className="text-2xs text-content-tertiary">
            {t('playbook.procedure.cond.json')}
          </span>
          <textarea
            id={`${idPrefix}-json`}
            value={json ?? ''}
            disabled={!canEdit}
            rows={5}
            aria-invalid={jsonError ? true : undefined}
            onChange={(event) => {
              setJson(event.target.value);
              try {
                onChange(JSON.parse(event.target.value) as Cond);
                setJsonError(false);
              } catch {
                // Not JSON yet: the draft gets a value the validator refuses by
                // name, so Save waits for the author rather than storing the last
                // condition that happened to parse.
                onChange(event.target.value as unknown as Cond);
                setJsonError(true);
              }
            }}
            className={`resize-y font-mono ${inputClass}`}
          />
        </label>
        {jsonError && (
          <p role="alert" className="text-2xs text-danger">
            {t('playbook.procedure.cond.jsonInvalid')}
          </p>
        )}
      </>
    );
  } else if (simple !== null && simple.kind === 'confirmed') {
    body = (
      <p className="text-2xs text-content-secondary">
        {t('playbook.procedure.cond.confirmedBody')}
      </p>
    );
  } else if (simple !== null && simple.kind === 'ai') {
    body = (
      <TextInput
        id={`${idPrefix}-question`}
        label={t('playbook.procedure.cond.question')}
        value={simple.question}
        disabled={!canEdit}
        onChange={(question) => emit({ kind: 'ai', question })}
        className="w-full"
      />
    );
  } else if (simple !== null) {
    const valueKind = simpleValueKind(simple, slots);
    const subjects =
      simple.kind === 'fact'
        ? Object.keys(PROCEDURE_FACTS)
        : slots
            .filter((slot) => simple.kind !== 'elapsed' || slot.type === 'datetime')
            .map((slot) => slot.name)
            .filter((name) => name.length > 0);
    const subjectOptions = [
      ['', t('playbook.procedure.cond.choose')] as const,
      ...[
        ...subjects,
        ...(simple.subject && !subjects.includes(simple.subject) ? [simple.subject] : []),
      ].map((name) => [name, name] as const),
    ];
    const valueless = VALUELESS_OPS.includes(simple.op);
    body = (
      <div className="flex flex-wrap gap-3">
        <Select
          id={`${idPrefix}-subject`}
          label={t(
            simple.kind === 'fact'
              ? 'playbook.procedure.cond.fact'
              : simple.kind === 'elapsed'
                ? 'playbook.procedure.cond.since'
                : 'playbook.procedure.cond.slot',
          )}
          value={simple.subject}
          disabled={!canEdit}
          options={subjectOptions}
          onChange={(subject) => {
            const next = { ...simple, subject };
            const ops = simpleOps(next, slots);
            emit(ops.includes(next.op) ? next : { ...next, op: ops[0] ?? 'exists' });
          }}
          className="w-52"
        />
        <Select<CondOp>
          id={`${idPrefix}-op`}
          label={t('playbook.procedure.cond.op')}
          value={simple.op}
          disabled={!canEdit}
          options={simpleOps(simple, slots).map((op) => [op, t(OP_KEYS[op])] as const)}
          onChange={(op) => emit({ ...simple, op })}
          className="w-40"
        />
        {!valueless &&
          (valueKind === 'boolean' && simple.valueFact === undefined ? (
            <Select
              id={`${idPrefix}-value`}
              label={t('playbook.procedure.cond.value')}
              value={simple.value === 'false' ? 'false' : simple.value === 'true' ? 'true' : ''}
              disabled={!canEdit}
              options={[
                ['', t('playbook.procedure.cond.choose')],
                ['true', t('playbook.procedure.cond.yes')],
                ['false', t('playbook.procedure.cond.no')],
              ]}
              onChange={(value) => emit({ ...simple, value })}
              className="w-32"
            />
          ) : simple.valueFact !== undefined ? (
            <Select
              id={`${idPrefix}-value-fact`}
              label={t('playbook.procedure.cond.valueFact')}
              value={simple.valueFact}
              disabled={!canEdit}
              options={[
                ['', t('playbook.procedure.cond.choose')],
                ...Object.keys(PROCEDURE_FACTS).map((path) => [path, path] as const),
              ]}
              onChange={(valueFact) => emit({ ...simple, valueFact })}
              className="w-60"
            />
          ) : (
            <TextInput
              id={`${idPrefix}-value`}
              label={t('playbook.procedure.cond.value')}
              value={simple.value}
              disabled={!canEdit}
              placeholder={
                simple.op === 'in' || simple.op === 'not_in'
                  ? t('playbook.procedure.cond.listPlaceholder')
                  : undefined
              }
              onChange={(value) => emit({ ...simple, value })}
              className="w-40"
            />
          ))}
        {!valueless && valueKind === 'number' && (
          <label
            htmlFor={`${idPrefix}-use-fact`}
            className="flex items-center gap-2 self-end text-sm"
          >
            <input
              id={`${idPrefix}-use-fact`}
              type="checkbox"
              checked={simple.valueFact !== undefined}
              disabled={!canEdit}
              onChange={(event) => {
                const { valueFact: _drop, ...rest } = simple;
                emit(event.target.checked ? { ...rest, valueFact: '' } : rest);
              }}
            />
            {t('playbook.procedure.cond.compareFact')}
          </label>
        )}
      </div>
    );
  }

  return (
    <fieldset className="flex flex-col gap-2">
      <legend className="mb-1 text-2xs font-medium text-content-secondary">{label}</legend>
      <Select
        id={`${idPrefix}-kind`}
        label={t('playbook.procedure.cond.kind')}
        value={kind}
        disabled={!canEdit}
        options={kinds}
        onChange={setKind}
      />
      {body}
    </fieldset>
  );
}

// ---------------------------------------------------------------------------
// Templates.
// ---------------------------------------------------------------------------

function TemplatesSection({
  draft,
  onChange,
  canEdit,
  problems,
}: {
  draft: ProcedureDraft;
  onChange: DraftUpdate;
  canEdit: boolean;
  problems: readonly ProcedureProblemDetails[];
}): ReactElement {
  const t = useTranslate();
  const edit = (index: number, patch: Partial<ProcedureDraft['templates'][number]>) =>
    onChange((current) => {
      const template = current.templates[index];
      if (!template) return current;
      const next: Record<string, unknown> = { ...template };
      for (const [key, value] of Object.entries(patch)) {
        if (value === undefined) delete next[key];
        else next[key] = value;
      }
      return {
        ...current,
        templates: replaceAt(
          current.templates,
          index,
          next as unknown as ProcedureDraft['templates'][number],
        ),
      };
    });

  return (
    <>
      <p className="text-2xs text-content-tertiary">{t('playbook.procedure.templatesHelp')}</p>
      {draft.templates.length === 0 ? (
        <p className="text-sm text-content-secondary">{t('playbook.procedure.noTemplates')}</p>
      ) : (
        <ol aria-label={t('playbook.procedure.templatesTitle')} className="flex flex-col gap-3">
          {draft.templates.map((template, index) => (
            <li
              key={index}
              aria-label={template.key || t('playbook.procedure.templateFallback')}
              className="flex flex-col gap-2 rounded-md border border-border p-3"
            >
              <ProblemList
                problems={problems.filter((p) => p.position === index + 1)}
                where={false}
              />
              <TextInput
                id={`template-${index}-key`}
                label={t('playbook.procedure.templateKey')}
                value={template.key}
                disabled={!canEdit}
                onChange={(key) => edit(index, { key })}
              />
              <label htmlFor={`template-${index}-text`} className="flex flex-col gap-1">
                <span className="text-2xs text-content-tertiary">
                  {t('playbook.procedure.templateText')}
                </span>
                <textarea
                  id={`template-${index}-text`}
                  value={template.text}
                  disabled={!canEdit}
                  rows={3}
                  onChange={(event) => edit(index, { text: event.target.value })}
                  className={`resize-y ${inputClass}`}
                />
              </label>
              <label
                htmlFor={`template-${index}-verbatim`}
                className="flex items-center gap-2 text-sm"
              >
                <input
                  id={`template-${index}-verbatim`}
                  type="checkbox"
                  checked={template.verbatim === true}
                  disabled={!canEdit}
                  onChange={(event) =>
                    edit(index, { verbatim: event.target.checked ? true : undefined })
                  }
                />
                {t('playbook.procedure.templateVerbatim')}
              </label>
              {canEdit && (
                <button
                  type="button"
                  onClick={() =>
                    onChange((current) => ({
                      ...current,
                      templates: removeAt(current.templates, index),
                    }))
                  }
                  className={`${smallButton} self-start hover:text-danger`}
                >
                  {t('playbook.procedure.removeTemplate')}
                </button>
              )}
            </li>
          ))}
        </ol>
      )}
      {canEdit && (
        <button
          type="button"
          onClick={() =>
            onChange((current) => ({
              ...current,
              templates: [...current.templates, blankTemplate()],
            }))
          }
          className={addButton}
        >
          {t('playbook.procedure.addTemplate')}
        </button>
      )}
    </>
  );
}

// ---------------------------------------------------------------------------
// Hand-over.
// ---------------------------------------------------------------------------

function HandoffSection({
  draft,
  onChange,
  canEdit,
  teams,
}: {
  draft: ProcedureDraft;
  onChange: DraftUpdate;
  canEdit: boolean;
  teams: readonly TeamOption[];
}): ReactElement {
  const t = useTranslate();
  const handoff = draft.handoff;
  const setHandoff = (patch: Partial<ProcedureDraft['handoff']>) =>
    onChange((current) => {
      const next: Record<string, unknown> = { ...current.handoff };
      for (const [key, value] of Object.entries(patch)) {
        if (value === undefined) delete next[key];
        else next[key] = value;
      }
      return { ...current, handoff: next as unknown as ProcedureDraft['handoff'] };
    });

  return (
    <>
      <p className="text-2xs text-content-tertiary">{t('playbook.procedure.handoffHelp')}</p>
      {handoff.conditions.length > 0 && (
        <ol aria-label={t('playbook.procedure.handoffConditions')} className="flex flex-col gap-3">
          {handoff.conditions.map((cond, index) => (
            <li key={index} className="flex flex-col gap-2 rounded-md border border-border p-3">
              <CondEditor
                idPrefix={`handoff-${index}`}
                label={t('playbook.procedure.handoffCondition', { position: index + 1 })}
                cond={cond}
                slots={draft.slots}
                canEdit={canEdit}
                onChange={(next) =>
                  setHandoff({ conditions: replaceAt(handoff.conditions, index, next) })
                }
              />
              {canEdit && (
                <button
                  type="button"
                  onClick={() => setHandoff({ conditions: removeAt(handoff.conditions, index) })}
                  className={`${smallButton} self-start hover:text-danger`}
                >
                  {t('playbook.procedure.removeCondition')}
                </button>
              )}
            </li>
          ))}
        </ol>
      )}
      {canEdit && (
        <button
          type="button"
          onClick={() => setHandoff({ conditions: [...handoff.conditions, blankCondition()] })}
          className={addButton}
        >
          {t('playbook.procedure.addCondition')}
        </button>
      )}

      <TargetField
        id="handoff-target"
        target={handoff.target}
        teams={teams}
        canEdit={canEdit}
        onChange={(target) => setHandoff({ target })}
      />

      <LinesField
        id="handoff-card-fields"
        label={t('playbook.procedure.cardFields')}
        help={t('playbook.procedure.cardFieldsHelp')}
        lines={handoff.card_fields}
        disabled={!canEdit}
        onChange={(card_fields) => setHandoff({ card_fields })}
      />

      <label htmlFor="handoff-next-step" className="flex flex-col gap-1">
        <span className="text-2xs text-content-tertiary">
          {t('playbook.procedure.nextStepHint')}
        </span>
        <textarea
          id="handoff-next-step"
          value={handoff.next_step_hint ?? ''}
          disabled={!canEdit}
          rows={2}
          onChange={(event) => setHandoff({ next_step_hint: event.target.value })}
          className={`resize-y ${inputClass}`}
        />
      </label>

      <label htmlFor="procedure-max-turns" className="flex flex-col gap-1">
        <span className="text-2xs text-content-tertiary">{t('playbook.procedure.maxTurns')}</span>
        <NumberInput
          id="procedure-max-turns"
          value={draft.limits.max_turns}
          disabled={!canEdit}
          onChange={(max_turns) =>
            onChange((current) => ({ ...current, limits: { ...current.limits, max_turns } }))
          }
        />
      </label>

      <ResolutionCriteriaField
        idPrefix="procedure-resolution"
        scope="procedure"
        value={draft.resolution_criteria}
        slots={draft.slots}
        canEdit={canEdit}
        onChange={(resolution_criteria) =>
          onChange((current) => {
            const { resolution_criteria: _drop, ...rest } = current;
            return resolution_criteria === undefined ? rest : { ...rest, resolution_criteria };
          })
        }
      />
    </>
  );
}

/**
 * When the AI may say a matter is solved (K9): the platform's default is the
 * player's explicit yes; a procedure — or the agent, for the procedures
 * without their own — may require more ("the slots are filled AND the player
 * said yes"). Unchecked is no criteria of its own: the next level up decides.
 */
export function ResolutionCriteriaField({
  idPrefix,
  scope,
  value,
  slots,
  canEdit,
  onChange,
}: {
  idPrefix: string;
  scope: 'procedure' | 'workspace';
  value: Cond | null | undefined;
  slots: readonly SlotDef<Cond>[];
  canEdit: boolean;
  onChange: (value: Cond | undefined) => void;
}): ReactElement {
  const t = useTranslate();
  const custom = value !== undefined && value !== null;
  return (
    <fieldset className="flex flex-col gap-2">
      <legend className="text-2xs font-medium text-content-secondary">
        {t('playbook.resolution.title')}
      </legend>
      <p className="text-2xs text-content-tertiary">
        {t(
          scope === 'procedure'
            ? 'playbook.resolution.helpProcedure'
            : 'playbook.resolution.helpWorkspace',
        )}
      </p>
      <label htmlFor={`${idPrefix}-custom`} className="flex items-center gap-2 text-sm">
        <input
          id={`${idPrefix}-custom`}
          type="checkbox"
          checked={custom}
          disabled={!canEdit}
          onChange={(event) =>
            onChange(
              event.target.checked ? structuredClone(DEFAULT_RESOLUTION_CRITERIA) : undefined,
            )
          }
        />
        {t(
          scope === 'procedure'
            ? 'playbook.resolution.customProcedure'
            : 'playbook.resolution.customWorkspace',
        )}
      </label>
      {custom ? (
        <CondEditor
          idPrefix={idPrefix}
          label={t('playbook.resolution.condition')}
          cond={value}
          slots={slots}
          canEdit={canEdit}
          onChange={onChange}
          resolution={scope}
        />
      ) : (
        <p className="text-2xs text-content-secondary">
          {t(
            scope === 'procedure'
              ? 'playbook.resolution.inheritProcedure'
              : 'playbook.resolution.inheritWorkspace',
          )}
        </p>
      )}
    </fieldset>
  );
}

// ---------------------------------------------------------------------------
// Preview: where the turn would leave the conversation.
// ---------------------------------------------------------------------------

/** The procedure's step, its status and the information collected — what the next turn starts from. */
export function ProcedureStateView({ state }: { state: AiConversationState }): ReactElement {
  const t = useTranslate();
  const procedure = state.procedure;
  return (
    <div
      role="region"
      aria-label={t('playbook.procedure.stateTitle')}
      className="flex flex-col gap-1.5 rounded-md bg-surface p-2"
    >
      <span className="text-2xs text-content-tertiary">{t('playbook.procedure.stateTitle')}</span>
      {procedure ? (
        <p className="text-sm">
          {t('playbook.procedure.stateStep', {
            step: procedure.step_id ?? '—',
            status: procedure.step_status
              ? t(`playbook.procedure.stepStatus.${procedure.step_status}`)
              : '—',
          })}
        </p>
      ) : (
        <p className="text-sm text-content-secondary">{t('playbook.procedure.stateNoProcedure')}</p>
      )}
      {state.outcome && (
        <StatusDot
          tone={state.outcome === 'handed_off' ? 'info' : 'success'}
          label={t(`playbook.procedure.stateOutcome.${state.outcome}`)}
        />
      )}
      {state.slots.length > 0 && (
        <ul aria-label={t('playbook.procedure.stateSlots')} className="flex flex-col gap-0.5">
          {state.slots.map((slot) => (
            <li key={slot.name} className="text-2xs text-content-secondary">
              {slot.label}: {slot.sensitive ? '••••' : (slot.display ?? '—')} ·{' '}
              {t(`playbook.procedure.slotStatus.${slot.status}`)}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
