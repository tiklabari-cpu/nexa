/**
 * Settings → My profile (tm 327 · SiyahTuş analysis RL-06): every member edits
 * their own name, the optional name visitors see in the widget, and their
 * password.
 *
 * Two forms, because they are two different kinds of write. The names are a
 * setting: a draft, the SaveBar and the leave guard (`SettingsForm`, GV-06),
 * saved with `PATCH /agents/me`. The password is an action: three fields and
 * one button, nothing kept as a draft once it is done — `POST /auth/password`
 * signs every other device out (RL-06-S1), and the form says so before and
 * after.
 *
 * Both names are the account's, not the workspace's: the hint says the change
 * follows the person into every workspace they belong to. The visitor-facing
 * name is only ever shown in the widget; empty means the panel name is shown
 * there too (RL-06-S2).
 */
import { useState, type ReactElement } from 'react';
import { Card, Section } from '../../components/Page.js';
import { SettingsForm } from '../../components/settings/SettingsForm.js';
import { ApiClientError, errorMessageKey } from '../../lib/api-client.js';
import { useApiClient, useAuth } from '../../lib/auth-store.js';
import { FieldError, useForm } from '../../lib/form.js';
import { useTranslate, type TFunction } from '../../lib/i18n.js';

/** `PATCH /agents/me`'s bounds (`apps/api/src/routes/agents.ts`, `myProfileBody`). */
const NAME_MAX = 120;
/** `POST /auth/password`'s bound for the new password, sign-up's rule. */
const PASSWORD_MIN = 12;
const PASSWORD_MAX = 200;

interface NamesDraft {
  name: string;
  public_name: string;
}

const INPUT_CLASS =
  'w-full rounded-md border border-border bg-inset px-2 py-1.5 text-sm outline-none disabled:opacity-50';
const LABEL_CLASS = 'text-2xs font-medium uppercase tracking-wide text-content-tertiary';

export function MyProfile(): ReactElement {
  const t = useTranslate();
  const agent = useAuth((s) => s.agent);

  return (
    <>
      <Section
        id="section-profile"
        title={t('settings.profile.title')}
        description={t('settings.profile.description')}
      >
        <Card>
          {agent ? (
            <NamesForm
              // A new save resets the baseline through `saved`; a different
              // person signing in on this tab gets a fresh draft.
              key={agent.account_id}
              saved={{ name: agent.name ?? '', public_name: agent.public_name ?? '' }}
              email={agent.email}
            />
          ) : (
            <p className="p-4 text-sm text-content-secondary">{t('settings.loading')}</p>
          )}
        </Card>
      </Section>
      <Section
        id="section-password"
        title={t('settings.profile.password.title')}
        description={t('settings.profile.password.description')}
      >
        <Card>
          <PasswordForm />
        </Card>
      </Section>
    </>
  );
}

function nameProblem(t: TFunction, value: string): string | null {
  const trimmed = value.trim();
  if (trimmed === '') return t('settings.profile.name.required');
  return trimmed.length > NAME_MAX ? t('settings.profile.tooLong', { max: NAME_MAX }) : null;
}

function publicNameProblem(t: TFunction, value: string): string | null {
  return value.trim().length > NAME_MAX ? t('settings.profile.tooLong', { max: NAME_MAX }) : null;
}

function NamesForm({ saved, email }: { saved: NamesDraft; email: string | null }): ReactElement {
  const t = useTranslate();
  const updateProfile = useAuth((s) => s.updateProfile);
  const [note, setNote] = useState<string | null>(null);

  async function save(values: NamesDraft): Promise<void> {
    setNote(null);
    const name = values.name.trim();
    const publicName = values.public_name.trim();
    // Only what changed: a save of the visitor name alone does not read as a
    // rename in the trail.
    await updateProfile({
      ...(name !== saved.name ? { name } : {}),
      ...(publicName !== saved.public_name
        ? { public_name: publicName === '' ? null : publicName }
        : {}),
    });
    setNote(t('settings.profile.saved'));
  }

  return (
    <SettingsForm
      saved={saved}
      onSave={save}
      isValid={(values) =>
        nameProblem(t, values.name) === null && publicNameProblem(t, values.public_name) === null
      }
      label={t('settings.profile.title')}
    >
      {(form) => {
        const nameError = nameProblem(t, form.values.name);
        const publicError = publicNameProblem(t, form.values.public_name);
        return (
          <div className="flex max-w-md flex-col gap-4 p-4">
            {email && (
              <p className="text-sm text-content-secondary">
                {t('settings.profile.email', { email })}
              </p>
            )}
            <div className="flex flex-col gap-1">
              <label htmlFor="profile-name" className={LABEL_CLASS}>
                {t('settings.profile.name.label')}
              </label>
              <input
                id="profile-name"
                autoComplete="name"
                value={form.values.name}
                maxLength={NAME_MAX + 20}
                onChange={(event) => {
                  form.setValue('name', event.target.value);
                  setNote(null);
                }}
                aria-invalid={nameError ? true : undefined}
                aria-describedby={nameError ? 'profile-name-error' : 'profile-name-hint'}
                className={INPUT_CLASS}
              />
              <p id="profile-name-hint" className="text-2xs text-content-tertiary">
                {t('settings.profile.name.hint')}
              </p>
              <FieldError id="profile-name-error" message={nameError} />
            </div>
            <div className="flex flex-col gap-1">
              <label htmlFor="profile-public-name" className={LABEL_CLASS}>
                {t('settings.profile.publicName.label')}
              </label>
              <input
                id="profile-public-name"
                value={form.values.public_name}
                maxLength={NAME_MAX + 20}
                placeholder={form.values.name.trim()}
                onChange={(event) => {
                  form.setValue('public_name', event.target.value);
                  setNote(null);
                }}
                aria-invalid={publicError ? true : undefined}
                aria-describedby={
                  publicError ? 'profile-public-name-error' : 'profile-public-name-hint'
                }
                className={INPUT_CLASS}
              />
              <p id="profile-public-name-hint" className="text-2xs text-content-tertiary">
                {t('settings.profile.publicName.hint')}
              </p>
              <FieldError id="profile-public-name-error" message={publicError} />
            </div>
            {note && <p className="text-sm text-success">{note}</p>}
          </div>
        );
      }}
    </SettingsForm>
  );
}

type PasswordValues = { current: string; next: string; confirm: string };

/** What a refusal of `POST /auth/password` reads as, by its type and reason. */
function passwordRefusalKey(error: unknown): string {
  if (error instanceof ApiClientError) {
    if (error.type === 'authentication') return 'settings.profile.password.wrongCurrent';
    const reason = error.details?.['reason'];
    if (error.type === 'not_allowed' && reason === 'sso_enforced') {
      return 'settings.profile.password.ssoEnforced';
    }
    if (error.type === 'not_allowed' && reason === 'no_password') {
      return 'settings.profile.password.noPassword';
    }
  }
  return errorMessageKey(error);
}

function PasswordForm(): ReactElement {
  const t = useTranslate();
  const api = useApiClient();
  const [done, setDone] = useState(false);

  const form = useForm<PasswordValues>({
    initial: { current: '', next: '', confirm: '' },
    validators: {
      current: (value) => (value === '' ? t('settings.profile.password.currentRequired') : null),
      next: (value) =>
        value.length < PASSWORD_MIN || value.length > PASSWORD_MAX
          ? t('settings.profile.password.length', { min: PASSWORD_MIN, max: PASSWORD_MAX })
          : null,
    },
    onSubmit: async (values, { setFieldError, setSubmitError, reset }) => {
      setDone(false);
      if (values.next === values.current) {
        setFieldError('next', t('settings.profile.password.same'));
        return;
      }
      if (values.confirm !== values.next) {
        setFieldError('confirm', t('settings.profile.password.mismatch'));
        return;
      }
      try {
        await api.post('/auth/password', {
          current_password: values.current,
          new_password: values.next,
        });
        reset();
        setDone(true);
      } catch (error) {
        const key = passwordRefusalKey(error);
        if (key === 'settings.profile.password.wrongCurrent') setFieldError('current', t(key));
        else setSubmitError(t(key));
      }
    },
  });

  const fields: Array<{ name: keyof PasswordValues; id: string; autoComplete: string }> = [
    { name: 'current', id: 'password-current', autoComplete: 'current-password' },
    { name: 'next', id: 'password-new', autoComplete: 'new-password' },
    { name: 'confirm', id: 'password-confirm', autoComplete: 'new-password' },
  ];

  return (
    <form
      onSubmit={form.handleSubmit}
      noValidate
      aria-label={t('settings.profile.password.title')}
      className="flex max-w-md flex-col gap-4 p-4"
    >
      <p className="text-2xs text-content-tertiary">
        {t('settings.profile.password.otherSessions')}
      </p>
      {fields.map(({ name, id, autoComplete }) => {
        const error = form.errorFor(name);
        return (
          <div key={name} className="flex flex-col gap-1">
            <label htmlFor={id} className={LABEL_CLASS}>
              {t(`settings.profile.password.${name}`)}
            </label>
            <input
              id={id}
              type="password"
              autoComplete={autoComplete}
              value={form.values[name]}
              onChange={(event) => {
                form.setValue(name, event.target.value);
                setDone(false);
              }}
              onBlur={() => form.blur(name)}
              aria-invalid={error ? true : undefined}
              aria-describedby={error ? `${id}-error` : undefined}
              className={INPUT_CLASS}
            />
            <FieldError id={`${id}-error`} message={error} />
          </div>
        );
      })}
      {form.submitError && (
        <p role="alert" className="text-sm text-danger">
          {form.submitError}
        </p>
      )}
      {done && (
        <p role="status" className="text-sm text-success">
          {t('settings.profile.password.changed')}
        </p>
      )}
      <div>
        <button
          type="submit"
          disabled={!form.canSubmit}
          className="rounded-md bg-brand-500 px-3 py-1.5 text-sm font-medium text-white transition-colors hover:bg-brand-600 disabled:opacity-50"
        >
          {form.isSubmitting
            ? t('settings.profile.password.submitting')
            : t('settings.profile.password.submit')}
        </button>
      </div>
    </form>
  );
}
