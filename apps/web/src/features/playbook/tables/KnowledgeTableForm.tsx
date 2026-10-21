/**
 * One structured-table row, added or edited (tm 310.5 · AI-13).
 *
 * The fields are `table-form.ts`'s, drawn generically — a payment method, a
 * bonus, a KYC document and a rule differ only in which fields they list. The
 * server is the only validator (min ≤ max, delay ≥ expected, no overlapping
 * windows, a name taken in an overlapping brand scope): a refused save keeps
 * the form open and puts each problem beside its field, every problem at once,
 * so a row is fixed in one pass rather than one refusal at a time.
 */
import { useMutation } from '@tanstack/react-query';
import { useState, type ReactElement } from 'react';
import type { KnowledgeTable } from '@siyahtus/types';
import { Banner } from '../../../components/ui/Banner.js';
import { ApiClientError, errorMessageKey } from '../../../lib/api-client.js';
import { useApiClient } from '../../../lib/auth-store.js';
import { FieldError } from '../../../lib/form.js';
import { useTranslate } from '../../../lib/i18n.js';
import { useKnowledgeScopeOptions } from '../KnowledgeScopeFields.js';
import {
  emptyState,
  fieldSpecs,
  payloadOf,
  problemsOf,
  segmentOf,
  stateOf,
  type FieldSpec,
  type LocalProblem,
  type TableFormState,
  type TableRow,
} from './table-form.js';

const INPUT =
  'rounded-md border border-border bg-inset px-2 py-1.5 text-sm text-content outline-none disabled:opacity-60';
const LABEL = 'text-2xs font-medium uppercase tracking-wide text-content-tertiary';

export function KnowledgeTableForm({
  table,
  row,
  methods,
  onSaved,
  onCancel,
}: {
  table: KnowledgeTable;
  /** The row being edited; null adds one. */
  row: TableRow | null;
  /** The payment methods a bonus may exclude. */
  methods: Array<{ id: string; name: string }>;
  onSaved: () => void;
  onCancel: () => void;
}): ReactElement {
  const t = useTranslate();
  const api = useApiClient();
  const { brands, members } = useKnowledgeScopeOptions();
  const [state, setState] = useState<TableFormState>(() =>
    row ? stateOf(table, row) : emptyState(table),
  );
  const [problems, setProblems] = useState<LocalProblem[]>([]);
  const idPrefix = row ? `table-edit-${row.id}` : 'table-add';

  const save = useMutation({
    mutationFn: (body: Record<string, unknown>) =>
      row
        ? api.patch<TableRow>(`/knowledge-tables/${segmentOf(table)}/${row.id}`, body)
        : api.post<TableRow>(`/knowledge-tables/${segmentOf(table)}`, body),
    onSuccess: onSaved,
    onError: (error) => {
      if (error instanceof ApiClientError) setProblems(problemsOf(error.details));
    },
  });

  function setField(name: string, value: string | boolean): void {
    setState((current) => ({ ...current, fields: { ...current.fields, [name]: value } }));
  }

  function submit(): void {
    const payload = payloadOf(table, state, row ? 'update' : 'create');
    setProblems(payload.problems);
    if (payload.problems.length > 0) return;
    save.mutate(payload.body);
  }

  const problemFor = (field: string): string | null => {
    const found = problems.find((problem) => problem.field === field);
    return found ? t(`playbook.tables.problem.${found.code}`) : null;
  };

  // A refusal naming a field this form has no input for is still shown.
  const known = new Set([
    ...fieldSpecs(table).map((spec) => spec.name),
    'review_interval_days',
    'brand_ids',
    'owner_id',
  ]);
  const unplaced = problems.filter((problem) => !known.has(problem.field));
  const refusal =
    save.error && !(save.error instanceof ApiClientError && problems.length > 0)
      ? t(errorMessageKey(save.error))
      : null;

  function control(spec: FieldSpec): ReactElement {
    const id = `${idPrefix}-${spec.name}`;
    const error = problemFor(spec.name);
    const describedBy = error ? `${id}-error` : undefined;
    const value = state.fields[spec.name];
    switch (spec.input) {
      case 'boolean':
        return (
          <label className="flex items-center gap-2 text-sm">
            <input
              id={id}
              type="checkbox"
              checked={value === true}
              onChange={(event) => setField(spec.name, event.target.checked)}
            />
            {t(`playbook.tables.field.${spec.name}`)}
          </label>
        );
      case 'select':
        return (
          <select
            id={id}
            value={typeof value === 'string' ? value : ''}
            aria-describedby={describedBy}
            onChange={(event) => setField(spec.name, event.target.value)}
            className={INPUT}
          >
            {spec.optional && <option value="">{t('playbook.tables.form.none')}</option>}
            {spec.options!.map((option) => (
              <option key={option} value={option}>
                {t(`playbook.tables.option.${option}`)}
              </option>
            ))}
          </select>
        );
      case 'methods':
        return methods.length === 0 ? (
          <p className="text-2xs text-content-tertiary">{t('playbook.tables.form.noMethods')}</p>
        ) : (
          <div className="flex flex-wrap gap-x-4 gap-y-1">
            {methods.map((method) => (
              <label key={method.id} className="flex items-center gap-1.5 text-sm">
                <input
                  type="checkbox"
                  checked={state.excludedMethodIds.includes(method.id)}
                  onChange={(event) =>
                    setState((current) => ({
                      ...current,
                      excludedMethodIds: event.target.checked
                        ? [...current.excludedMethodIds, method.id]
                        : current.excludedMethodIds.filter((other) => other !== method.id),
                    }))
                  }
                />
                {method.name}
              </label>
            ))}
          </div>
        );
      case 'textarea':
      case 'json':
        return (
          <textarea
            id={id}
            rows={spec.input === 'json' ? 5 : 3}
            value={typeof value === 'string' ? value : ''}
            aria-describedby={describedBy}
            spellCheck={spec.input !== 'json'}
            onChange={(event) => setField(spec.name, event.target.value)}
            className={`${INPUT} ${spec.input === 'json' ? 'font-mono text-xs' : ''}`}
          />
        );
      default:
        return (
          <input
            id={id}
            type={spec.input === 'date' ? 'date' : 'text'}
            inputMode={spec.input === 'number' ? 'decimal' : undefined}
            value={typeof value === 'string' ? value : ''}
            aria-describedby={describedBy}
            aria-required={spec.required || undefined}
            onChange={(event) => setField(spec.name, event.target.value)}
            className={INPUT}
          />
        );
    }
  }

  return (
    <form
      aria-label={t(row ? 'playbook.tables.form.editTitle' : 'playbook.tables.form.addTitle')}
      onSubmit={(event) => {
        event.preventDefault();
        submit();
      }}
      className="flex flex-col gap-3 rounded-md border border-border bg-inset p-3"
    >
      <div className="grid gap-3 sm:grid-cols-2">
        {fieldSpecs(table).map((spec) => (
          <div
            key={spec.name}
            className={`flex flex-col gap-1 ${
              spec.input === 'textarea' || spec.input === 'json' || spec.input === 'methods'
                ? 'sm:col-span-2'
                : ''
            }`}
          >
            {spec.input !== 'boolean' && (
              <label htmlFor={`${idPrefix}-${spec.name}`} className={LABEL}>
                {t(`playbook.tables.field.${spec.name}`)}
                {spec.required ? ' *' : ''}
              </label>
            )}
            {control(spec)}
            {spec.input === 'list' && (
              <p className="text-2xs text-content-tertiary">{t('playbook.tables.form.listHelp')}</p>
            )}
            {spec.input === 'json' && (
              <p className="text-2xs text-content-tertiary">
                {t(`playbook.tables.form.jsonHelp.${spec.name}`)}
              </p>
            )}
            <FieldError id={`${idPrefix}-${spec.name}-error`} message={problemFor(spec.name)} />
          </div>
        ))}
      </div>

      <fieldset className="flex flex-col gap-1">
        <legend className={LABEL}>{t('playbook.tables.field.brand_ids')}</legend>
        <div className="flex flex-wrap gap-x-4 gap-y-1">
          {brands.map((brand) => (
            <label key={brand.id} className="flex items-center gap-1.5 text-sm">
              <input
                type="checkbox"
                checked={state.brandIds.includes(brand.id)}
                onChange={(event) =>
                  setState((current) => ({
                    ...current,
                    brandIds: event.target.checked
                      ? [...current.brandIds, brand.id]
                      : current.brandIds.filter((other) => other !== brand.id),
                  }))
                }
              />
              {brand.name ?? brand.id}
            </label>
          ))}
        </div>
        <p className="text-2xs text-content-tertiary">{t('playbook.tables.form.brandsHelp')}</p>
        <FieldError message={problemFor('brand_ids')} />
      </fieldset>

      <div className="grid gap-3 sm:grid-cols-2">
        <div className="flex flex-col gap-1">
          <label htmlFor={`${idPrefix}-owner`} className={LABEL}>
            {t('playbook.tables.field.owner_id')}
          </label>
          <select
            id={`${idPrefix}-owner`}
            value={state.ownerId}
            onChange={(event) =>
              setState((current) => ({ ...current, ownerId: event.target.value }))
            }
            className={INPUT}
          >
            <option value="">{t('playbook.tables.form.noOwner')}</option>
            {members.map((member) => (
              <option key={member.id} value={member.id}>
                {member.name ?? member.id}
              </option>
            ))}
          </select>
          <FieldError message={problemFor('owner_id')} />
        </div>
        <div className="flex flex-col gap-1">
          <label htmlFor={`${idPrefix}-interval`} className={LABEL}>
            {t('playbook.tables.field.review_interval_days')}
          </label>
          <input
            id={`${idPrefix}-interval`}
            type="text"
            inputMode="numeric"
            value={state.reviewIntervalDays}
            onChange={(event) =>
              setState((current) => ({ ...current, reviewIntervalDays: event.target.value }))
            }
            className={INPUT}
          />
          <FieldError message={problemFor('review_interval_days')} />
        </div>
      </div>

      {unplaced.length > 0 && (
        <Banner tone="danger">
          {unplaced
            .map((problem) => `${problem.field}: ${t(`playbook.tables.problem.${problem.code}`)}`)
            .join(' · ')}
        </Banner>
      )}
      {refusal && <Banner tone="danger">{refusal}</Banner>}

      <div className="flex gap-2">
        <button
          type="submit"
          disabled={save.isPending}
          className="rounded-md bg-brand-500 px-3 py-1.5 text-sm font-medium text-white transition-colors hover:bg-brand-600 disabled:opacity-60"
        >
          {save.isPending ? t('playbook.tables.form.saving') : t('playbook.tables.form.save')}
        </button>
        <button
          type="button"
          onClick={onCancel}
          className="rounded-md border border-border px-3 py-1.5 text-sm text-content-secondary transition-colors hover:bg-surface-2"
        >
          {t('playbook.tables.form.cancel')}
        </button>
      </div>
    </form>
  );
}
