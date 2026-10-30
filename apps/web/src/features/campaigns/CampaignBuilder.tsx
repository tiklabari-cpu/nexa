/**
 * The New / Edit campaign builder (FR-MOD-03.3.2/.3).
 *
 * A trigger and a message are both required — Submit stays disabled until they
 * are given, the same rule the server enforces (a campaign that could not target
 * or say anything is not saved). The message is a line of text or a card
 * (EN-02 · `CampaignCardEditor`): a title, an image, a body and up to five
 * buttons, checked by the same function the API runs. Scheduling is optional: leave the dates empty
 * and the campaign runs now; set a start in the future and it saves as scheduled.
 * Saving a running campaign fires it at the matching visitors, so the success
 * toast reports how many it reached.
 */
import { useMutation } from '@tanstack/react-query';
import { useState, type ReactElement } from 'react';
import { Modal } from '../../components/ui/index.js';
import { ApiClientError, errorMessageKey, type ApiClient } from '../../lib/api-client.js';
import { FieldError, required, useForm } from '../../lib/form.js';
import { useCloseGuard } from '../../lib/dirty-guard.js';
import { useTranslate } from '../../lib/i18n.js';
import {
  normalizeRichCard,
  type Campaign,
  type CampaignContentType,
  type CampaignMatchMode,
  type CampaignWriteResult,
  type RichCard,
} from '@siyahtus/types';
import { CampaignCardEditor, blankCard, cardProblems } from './CampaignCardEditor.js';
import { CampaignRuleEditor } from './CampaignRuleEditor.js';
import {
  conditionsFromDrafts,
  draftProblem,
  draftsFromConditions,
  type RuleDraft,
} from './campaign-rules.js';

/** An ISO instant as the `YYYY-MM-DDTHH:mm` a `datetime-local` input wants. */
function toDateTimeLocal(iso: string | null): string {
  if (!iso) return '';
  const date = new Date(iso);
  const pad = (n: number): string => String(n).padStart(2, '0');
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}T${pad(date.getHours())}:${pad(date.getMinutes())}`;
}

/** `YYYY-MM-DDTHH:mm` from the input back to an ISO instant, or null when blank. */
function fromDateTimeLocal(value: string): string | null {
  const trimmed = value.trim();
  return trimmed ? new Date(trimmed).toISOString() : null;
}

export function CampaignBuilder({
  campaign,
  api,
  onClose,
  onSaved,
}: {
  /** The campaign to edit, or null to create a new one. */
  campaign: Campaign | null;
  api: ApiClient;
  onClose: () => void;
  onSaved: (result: { campaign: Campaign; reached: number }) => void;
}): ReactElement {
  const t = useTranslate();
  const save = useMutation({
    mutationFn: (body: unknown) =>
      campaign
        ? api.patch<CampaignWriteResult>(`/campaigns/${campaign.id}`, body)
        : api.post<CampaignWriteResult>('/campaigns', body),
  });

  // The trigger is a list of rows, not a string, so it lives beside the form.
  const [initialRules] = useState(() => draftsFromConditions(campaign?.conditions));
  const [rules, setRules] = useState<{ match: CampaignMatchMode; drafts: RuleDraft[] }>(
    initialRules,
  );
  const rulesChanged =
    JSON.stringify(conditionsFromDrafts(rules.match, rules.drafts)) !==
    JSON.stringify(conditionsFromDrafts(initialRules.match, initialRules.drafts));
  const rulesReady = rules.drafts.every((draft) => draftProblem(draft) === null);

  // Text or a card (EN-02), beside the form like the rules: a card is a tree.
  const initialKind: CampaignContentType = campaign?.content.type === 'card' ? 'card' : 'text';
  const [kind, setKind] = useState<CampaignContentType>(initialKind);
  const [initialCard] = useState<RichCard>(() => {
    const saved = campaign?.content.card;
    return saved
      ? { ...saved, title: saved.title ?? '', image: saved.image ?? { url: '', alt: '' } }
      : blankCard();
  });
  const [card, setCard] = useState<RichCard>(initialCard);
  const contentChanged =
    kind !== initialKind || JSON.stringify(card) !== JSON.stringify(initialCard);
  const cardReady = kind === 'text' || cardProblems(card).length === 0;

  const form = useForm({
    initial: {
      name: campaign?.name ?? '',
      message: campaign?.content.message ?? '',
      starts_at: toDateTimeLocal(campaign?.starts_at ?? null),
      ends_at: toDateTimeLocal(campaign?.ends_at ?? null),
    },
    validators: {
      name: required(t('campaigns.builder.nameRequired')),
      ...(kind === 'text' ? { message: required(t('campaigns.builder.messageRequired')) } : {}),
    },
    onSubmit: async (values, { setFieldError, setSubmitError }) => {
      try {
        const saved = await save.mutateAsync({
          name: values.name,
          conditions: conditionsFromDrafts(rules.match, rules.drafts),
          content:
            kind === 'card'
              ? { type: 'card', card: normalizeRichCard(card) }
              : { message: values.message.trim() },
          starts_at: fromDateTimeLocal(values.starts_at),
          ends_at: fromDateTimeLocal(values.ends_at),
        });
        // `matched` is how many it just reached; on an edit that re-fires,
        // only newly-matched visitors count (`performance.displayed` is
        // always 0 here — delivery hasn't happened yet, see CampaignWriteResult).
        onSaved({ campaign: saved, reached: saved.matched });
      } catch (failure) {
        // The window check is the one field-specific server verdict worth pinning;
        // the message text is inspected only to route it, never shown as-is.
        if (
          failure instanceof ApiClientError &&
          failure.type === 'validation' &&
          // i18n-ignore: inspected only, not displayed — see comment above.
          failure.message.toLowerCase().includes('ends_at')
        ) {
          setFieldError('ends_at', t('campaigns.builder.endsError'));
          return;
        }
        setSubmitError(t(errorMessageKey(failure)));
      }
    },
  });

  const close = useCloseGuard({
    isDirty: form.isDirty || rulesChanged || contentChanged,
    message: t('campaigns.builder.discardConfirm'),
    onClose,
  });

  const nameError = form.errorFor('name');
  const messageError = form.errorFor('message');
  const endsError = form.errorFor('ends_at');

  return (
    <Modal
      onClose={close}
      title={campaign ? t('campaigns.builder.editTitle') : t('campaigns.builder.newTitle')}
      description={t('campaigns.builder.description')}
      align="top"
      className="max-h-[80vh] max-w-[34rem] overflow-y-auto"
    >
      <form onSubmit={form.handleSubmit} noValidate className="flex flex-col gap-3">
        {form.submitError && (
          <p role="alert" className="text-sm text-danger">
            {form.submitError}
          </p>
        )}

        <Field label={t('campaigns.builder.nameLabel')} htmlFor="campaign-name" error={nameError}>
          <input
            id="campaign-name"
            autoFocus
            value={form.values.name}
            onChange={(event) => form.setValue('name', event.target.value)}
            onBlur={() => form.blur('name')}
            aria-invalid={nameError ? true : undefined}
            className="w-full rounded-md border border-border bg-inset px-3 py-2 text-sm"
          />
        </Field>

        <CampaignRuleEditor match={rules.match} drafts={rules.drafts} onChange={setRules} />

        <fieldset className="flex flex-col gap-1">
          <legend className="mb-1 text-sm font-medium">
            {t('campaigns.builder.contentLabel')}
          </legend>
          <div className="flex gap-4 text-sm">
            {(['text', 'card'] as const).map((option) => (
              <label key={option} className="flex items-center gap-1.5">
                <input
                  type="radio"
                  name="campaign-content-type"
                  value={option}
                  checked={kind === option}
                  onChange={() => setKind(option)}
                />
                {t(`campaigns.builder.content.${option}`)}
              </label>
            ))}
          </div>
        </fieldset>

        {kind === 'card' ? (
          <CampaignCardEditor card={card} onChange={setCard} />
        ) : (
          <Field
            label={t('campaigns.builder.messageLabel')}
            htmlFor="campaign-message"
            error={messageError}
          >
            <textarea
              id="campaign-message"
              rows={3}
              value={form.values.message}
              onChange={(event) => form.setValue('message', event.target.value)}
              onBlur={() => form.blur('message')}
              aria-invalid={messageError ? true : undefined}
              placeholder={t('campaigns.builder.messagePlaceholder')}
              className="w-full rounded-md border border-border bg-inset px-3 py-2 text-sm"
            />
          </Field>
        )}

        <div className="grid grid-cols-2 gap-3">
          <Field label={t('campaigns.builder.startsLabel')} htmlFor="campaign-starts">
            <input
              id="campaign-starts"
              type="datetime-local"
              value={form.values.starts_at}
              onChange={(event) => form.setValue('starts_at', event.target.value)}
              className="w-full rounded-md border border-border bg-inset px-2 py-2 text-sm"
            />
          </Field>
          <Field label={t('campaigns.builder.endsLabel')} htmlFor="campaign-ends" error={endsError}>
            <input
              id="campaign-ends"
              type="datetime-local"
              value={form.values.ends_at}
              onChange={(event) => form.setValue('ends_at', event.target.value)}
              onBlur={() => form.blur('ends_at')}
              aria-invalid={endsError ? true : undefined}
              className="w-full rounded-md border border-border bg-inset px-2 py-2 text-sm"
            />
          </Field>
        </div>

        <div className="mt-2 flex justify-end gap-2">
          <button
            type="button"
            onClick={close}
            className="rounded-md border border-border px-3 py-1.5 text-sm font-medium text-content-secondary hover:bg-surface-2"
          >
            {t('campaigns.builder.cancel')}
          </button>
          <button
            type="submit"
            disabled={!form.canSubmit || !rulesReady || !cardReady}
            className="rounded-md bg-brand-500 px-3 py-1.5 text-sm font-medium text-white disabled:cursor-not-allowed disabled:opacity-50"
          >
            {form.isSubmitting
              ? t('campaigns.builder.saving')
              : campaign
                ? t('campaigns.builder.saveChanges')
                : t('campaigns.builder.create')}
          </button>
        </div>
      </form>
    </Modal>
  );
}

function Field({
  label,
  htmlFor,
  hint,
  error,
  children,
}: {
  label: string;
  htmlFor: string;
  hint?: string;
  error?: string | null;
  children: ReactElement;
}): ReactElement {
  return (
    <div>
      <label htmlFor={htmlFor} className="mb-1 block text-sm font-medium">
        {label}
      </label>
      {children}
      {hint && !error && <p className="mt-1 text-2xs text-content-tertiary">{hint}</p>}
      <FieldError id={`${htmlFor}-error`} message={error ?? null} />
    </div>
  );
}
