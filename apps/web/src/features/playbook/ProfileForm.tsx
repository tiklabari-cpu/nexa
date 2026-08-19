/**
 * The AI agent's persona (FR-MOD-06.4).
 *
 * Everything here is what a visitor will see, so it sits next to a live preview
 * of the widget header it feeds: change the name and the preview renames, before
 * a customer is the one who notices. The name is required — an unnamed assistant
 * has nothing to put in that header — and languages are multi-select because the
 * same persona answers more than one. Saving PATCHes only what changed and the
 * widget, which already reads the persona (FR-MOD-11.3), picks it up.
 */
import { useMutation } from '@tanstack/react-query';
import { useState, type ReactElement } from 'react';
import { Card } from '../../components/Page.js';
import { StatusDot } from '../../components/StatusDot.js';
import { errorMessageKey } from '../../lib/api-client.js';
import { useApiClient } from '../../lib/auth-store.js';
import { useTranslate } from '../../lib/i18n.js';
import { FieldError, required } from '../../lib/form.js';
import type { AiAgent, AnswerLength } from './types.js';

const LANGUAGE_OPTIONS: [string, string][] = [
  ['en', 'English'],
  ['tr', 'Türkçe'],
  ['de', 'Deutsch'],
  ['fr', 'Français'],
  ['es', 'Español'],
];

const ANSWER_LENGTH_LABEL_KEYS: Record<AnswerLength, string> = {
  short: 'playbook.profile.lengthShort',
  medium: 'playbook.profile.lengthMedium',
  long: 'playbook.profile.lengthLong',
};
const ANSWER_LENGTHS: AnswerLength[] = ['short', 'medium', 'long'];

export function ProfileForm({
  agent,
  canEdit,
  onSaved,
}: {
  agent: AiAgent;
  canEdit: boolean;
  onSaved: () => void;
}): ReactElement {
  const t = useTranslate();
  const api = useApiClient();

  const [name, setName] = useState(agent.name);
  const [nameTouched, setNameTouched] = useState(false);
  const [avatarUrl, setAvatarUrl] = useState(agent.avatar_url ?? '');
  const [tone, setTone] = useState(agent.tone ?? '');
  const [languages, setLanguages] = useState<string[]>(agent.languages);
  const [answerLength, setAnswerLength] = useState<AnswerLength | ''>(agent.answer_length ?? '');

  const save = useMutation({
    mutationFn: () =>
      api.patch<AiAgent>(`/ai-agents/${agent.id}`, {
        name: name.trim(),
        avatar_url: avatarUrl.trim() || null,
        tone: tone.trim() || null,
        languages,
        answer_length: answerLength || null,
      }),
    onSuccess: onSaved,
  });

  const nameError = required(t('playbook.profile.nameRequired'))(name);
  // Dirty is measured against the live agent prop, so a successful save (which
  // refetches the agent) settles the form back to clean with no manual reset.
  const dirty =
    name !== agent.name ||
    avatarUrl !== (agent.avatar_url ?? '') ||
    tone !== (agent.tone ?? '') ||
    JSON.stringify(languages) !== JSON.stringify(agent.languages) ||
    (answerLength || null) !== (agent.answer_length ?? null);

  const canSave = canEdit && !nameError && dirty && !save.isPending;

  function toggleLanguage(code: string): void {
    setLanguages((current) =>
      current.includes(code) ? current.filter((c) => c !== code) : [...current, code],
    );
  }

  return (
    <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
      <Card>
        <form
          onSubmit={(event) => {
            event.preventDefault();
            if (canSave) save.mutate();
          }}
          className="flex flex-col gap-3 p-4"
        >
          <label htmlFor="persona-name" className="flex flex-col gap-1">
            <span className="text-2xs font-medium uppercase tracking-wide text-content-tertiary">
              {t('playbook.profile.name')}
            </span>
            <input
              id="persona-name"
              value={name}
              disabled={!canEdit}
              onChange={(event) => setName(event.target.value)}
              onBlur={() => setNameTouched(true)}
              aria-invalid={nameTouched && nameError ? true : undefined}
              aria-describedby={nameTouched && nameError ? 'persona-name-error' : undefined}
              className="rounded-md border border-border bg-inset px-2 py-1.5 text-sm outline-none disabled:opacity-60"
            />
            <FieldError id="persona-name-error" message={nameTouched ? nameError : null} />
          </label>

          <label htmlFor="persona-avatar" className="flex flex-col gap-1">
            <span className="text-2xs font-medium uppercase tracking-wide text-content-tertiary">
              {t('playbook.profile.avatarUrl')}
            </span>
            <input
              id="persona-avatar"
              value={avatarUrl}
              disabled={!canEdit}
              onChange={(event) => setAvatarUrl(event.target.value)}
              placeholder={t('playbook.profile.avatarPlaceholder')}
              className="rounded-md border border-border bg-inset px-2 py-1.5 text-sm outline-none placeholder:text-content-tertiary disabled:opacity-60"
            />
          </label>

          <label htmlFor="persona-tone" className="flex flex-col gap-1">
            <span className="text-2xs font-medium uppercase tracking-wide text-content-tertiary">
              {t('playbook.profile.tone')}
            </span>
            <input
              id="persona-tone"
              value={tone}
              disabled={!canEdit}
              onChange={(event) => setTone(event.target.value)}
              placeholder={t('playbook.profile.tonePlaceholder')}
              className="rounded-md border border-border bg-inset px-2 py-1.5 text-sm outline-none placeholder:text-content-tertiary disabled:opacity-60"
            />
          </label>

          <fieldset className="flex flex-col gap-1.5" disabled={!canEdit}>
            <legend className="text-2xs font-medium uppercase tracking-wide text-content-tertiary">
              {t('playbook.profile.languages')}
            </legend>
            <div className="flex flex-wrap gap-1.5">
              {LANGUAGE_OPTIONS.map(([code, label]) => {
                const on = languages.includes(code);
                return (
                  <button
                    key={code}
                    type="button"
                    role="switch"
                    aria-checked={on}
                    disabled={!canEdit}
                    onClick={() => toggleLanguage(code)}
                    className={`rounded-full border px-3 py-1 text-2xs transition-colors disabled:opacity-60 ${
                      on
                        ? 'border-brand-500 bg-brand-100 text-brand-700 dark:bg-brand-950 dark:text-content'
                        : 'border-border text-content-secondary hover:bg-surface-2'
                    }`}
                  >
                    {label}
                  </button>
                );
              })}
            </div>
          </fieldset>

          {/* Sibling label: wrapping a <select> would fold its option text into
              the accessible name, so "Answer length" alone would not find it. */}
          <div className="flex flex-col gap-1">
            <label
              htmlFor="persona-length"
              className="text-2xs font-medium uppercase tracking-wide text-content-tertiary"
            >
              {t('playbook.profile.answerLength')}
            </label>
            <select
              id="persona-length"
              value={answerLength}
              disabled={!canEdit}
              onChange={(event) => setAnswerLength(event.target.value as AnswerLength | '')}
              className="rounded-md border border-border bg-inset px-2 py-1.5 text-sm text-content outline-none disabled:opacity-60"
            >
              <option value="">{t('playbook.profile.noPreference')}</option>
              {ANSWER_LENGTHS.map((value) => (
                <option key={value} value={value}>
                  {t(ANSWER_LENGTH_LABEL_KEYS[value])}
                </option>
              ))}
            </select>
          </div>

          {canEdit && (
            <div className="flex items-center gap-3">
              <button
                type="submit"
                disabled={!canSave}
                className="rounded-md bg-brand-500 px-3 py-1.5 text-sm font-medium text-white transition-colors hover:bg-brand-600 disabled:opacity-50"
              >
                {save.isPending ? t('playbook.profile.saving') : t('playbook.profile.save')}
              </button>
              {save.isError && (
                <span role="alert" className="text-2xs text-danger">
                  {t(errorMessageKey(save.error))}
                </span>
              )}
            </div>
          )}
        </form>
      </Card>

      <PersonaPreview
        name={name}
        avatarUrl={avatarUrl}
        tone={tone}
        languages={languages}
        answerLength={answerLength}
      />
    </div>
  );
}

/** The widget header, as the visitor will see it — the reason any of this matters. */
function PersonaPreview({
  name,
  avatarUrl,
  tone,
  languages,
  answerLength,
}: {
  name: string;
  avatarUrl: string;
  tone: string;
  languages: string[];
  answerLength: AnswerLength | '';
}): ReactElement {
  const t = useTranslate();
  const trimmed = name.trim();
  const initial = (trimmed || '?').charAt(0).toUpperCase();
  return (
    <Card>
      <div className="p-4">
        <p className="mb-3 text-2xs font-medium uppercase tracking-wide text-content-tertiary">
          {t('playbook.profile.previewTitle')}
        </p>
        <div className="flex items-center gap-3 rounded-lg border border-border bg-inset p-3">
          {avatarUrl.trim() ? (
            <img
              src={avatarUrl}
              alt={trimmed || t('playbook.profile.aiAssistant')}
              className="h-10 w-10 rounded-full object-cover"
            />
          ) : (
            <span
              aria-hidden="true"
              className="flex h-10 w-10 items-center justify-center rounded-full bg-brand-500 text-sm font-semibold text-white"
            >
              {initial}
            </span>
          )}
          <div className="min-w-0">
            <p className="truncate text-sm font-medium">
              {trimmed || t('playbook.profile.unnamedAssistant')}
            </p>
            <p className="text-2xs text-content-tertiary">
              {tone.trim() ? tone.trim() : t('playbook.profile.aiAssistant')}
            </p>
          </div>
          <StatusDot tone="success" label={t('playbook.profile.online')} />
        </div>
        <dl className="mt-3 flex flex-col gap-1 text-2xs text-content-secondary">
          <div className="flex justify-between gap-2">
            <dt className="text-content-tertiary">{t('playbook.profile.languages')}</dt>
            <dd>{languages.length > 0 ? languages.join(', ') : t('playbook.profile.noneYet')}</dd>
          </div>
          <div className="flex justify-between gap-2">
            <dt className="text-content-tertiary">{t('playbook.profile.answerLength')}</dt>
            <dd>
              {answerLength
                ? t(ANSWER_LENGTH_LABEL_KEYS[answerLength])
                : t('playbook.profile.noPreference')}
            </dd>
          </div>
        </dl>
      </div>
    </Card>
  );
}
