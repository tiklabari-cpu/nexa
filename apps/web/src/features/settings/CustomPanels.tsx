/**
 * Settings › Integrations › Custom panels (KN-05 · owner decision K29 · tm 379).
 *
 * An owner or admin points the Inbox at their own back-office page: a name, an
 * `https://` address, the teams whose conversations show it. The page is
 * framed sandboxed in the Details pane and gets the conversation as a
 * five-minute token signed with the panel's secret — which this screen shows
 * exactly once (on add, and on "New secret"), the way personal access tokens
 * are shown.
 *
 * A list: each panel is added by the form, edited, switched off or removed on
 * its own row — no section-wide draft (`save-pattern.test.tsx` EXEMPT). The
 * address rule is the server's own (`customPanelUrlProblem`), so the form
 * never refuses an address the API would take or takes one it would refuse.
 */
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useState, type ReactElement } from 'react';
import {
  CUSTOM_PANEL_NAME_MAX,
  CUSTOM_PANEL_TOKEN_TTL_SECONDS,
  customPanelUrlProblem,
} from '@siyahtus/types';
import { EmptyState } from '../../components/EmptyState.js';
import { Card, ErrorNotice, Section } from '../../components/Page.js';
import { useSettingsLeaveGuard } from '../../components/settings/FormSaveBar.js';
import { Modal, useConfirm } from '../../components/ui/index.js';
import { ApiClientError, errorMessageKey } from '../../lib/api-client.js';
import { useApiClient } from '../../lib/auth-store.js';
import {
  FieldError,
  compose,
  maxLength,
  required,
  useForm,
  type Validator,
} from '../../lib/form.js';
import { useTranslate, type TFunction } from '../../lib/i18n.js';
import { TEAMS_KEY, type TransferTeam } from '../inbox/transfer.js';

interface CustomPanel {
  id: string;
  name: string;
  url: string;
  origin: string;
  visible_group_ids: number[];
  enabled: boolean;
  created_at: string;
  updated_at: string;
}

type CustomPanelWithSecret = CustomPanel & { signing_secret: string };

interface PanelBody {
  name: string;
  url: string;
  visible_group_ids: number[];
  enabled?: boolean;
}

const LIST_KEY = ['settings', 'custom-panels'] as const;

/** The server's refusals this screen can name; anything else is the generic sentence. */
const KNOWN_REASONS = [
  'limit_reached',
  'unknown_group',
  'url_invalid',
  'url_not_https',
  'url_credentials',
  'url_fragment',
  'url_too_long',
] as const;

function failureMessage(t: TFunction, error: unknown): string {
  const reason = error instanceof ApiClientError ? error.details?.['reason'] : undefined;
  if (typeof reason === 'string' && (KNOWN_REASONS as readonly string[]).includes(reason)) {
    return t(`settings.customPanels.reason.${reason}`);
  }
  return t(errorMessageKey(error));
}

/** The address rule, worded for the form. */
function panelUrl(t: TFunction): Validator {
  return (value) => {
    const problem = customPanelUrlProblem(value.trim());
    return problem ? t(`settings.customPanels.reason.url_${problem}`) : null;
  };
}

const parseTeams = (raw: string): number[] =>
  raw === '' ? [] : raw.split(',').map(Number).filter(Number.isInteger);

export function CustomPanels({ canEdit }: { canEdit: boolean }): ReactElement {
  const t = useTranslate();
  const api = useApiClient();
  const queryClient = useQueryClient();
  const { confirm, dialog } = useConfirm();
  const [revealed, setRevealed] = useState<CustomPanelWithSecret | null>(null);
  const [editing, setEditing] = useState<string | null>(null);

  const list = useQuery({
    queryKey: LIST_KEY,
    queryFn: () => api.get<{ items: CustomPanel[] }>('/settings/custom-panels'),
  });
  // The same key the Teams page and the inbox use — no second request.
  const teams = useQuery({
    queryKey: TEAMS_KEY,
    queryFn: () => api.get<{ items: TransferTeam[] }>('/groups'),
    staleTime: 60_000,
  });
  const teamItems = teams.data?.items ?? [];

  const invalidate = (): void => void queryClient.invalidateQueries({ queryKey: LIST_KEY });

  const add = useMutation({
    mutationFn: (body: PanelBody) =>
      api.post<CustomPanelWithSecret>('/settings/custom-panels', body),
    onSuccess: (created) => {
      setRevealed(created);
      invalidate();
    },
  });
  const update = useMutation({
    mutationFn: ({ id, body }: { id: string; body: Partial<PanelBody> & { enabled?: boolean } }) =>
      api.patch<CustomPanel>(`/settings/custom-panels/${id}`, body),
    onSuccess: invalidate,
  });
  const remove = useMutation({
    mutationFn: (id: string) => api.delete(`/settings/custom-panels/${id}`),
    onSuccess: invalidate,
  });
  const rotate = useMutation({
    mutationFn: (id: string) =>
      api.post<CustomPanelWithSecret>(`/settings/custom-panels/${id}/rotate-secret`),
    onSuccess: (rotated) => {
      setRevealed(rotated);
      invalidate();
    },
  });

  const form = useForm({
    initial: { name: '', url: '', teams: '' },
    validators: {
      name: compose(
        required(t('settings.customPanels.nameRequired')),
        maxLength(CUSTOM_PANEL_NAME_MAX),
      ),
      url: panelUrl(t),
    },
    onSubmit: async (values, { setSubmitError, reset }) => {
      try {
        await add.mutateAsync({
          name: values.name.trim(),
          url: values.url.trim(),
          visible_group_ids: parseTeams(values.teams),
        });
        reset();
      } catch (error) {
        setSubmitError(failureMessage(t, error));
      }
    },
  });
  useSettingsLeaveGuard(form.isDirty, form.isSubmitting);

  const teamLabel = (ids: number[]): string => {
    if (ids.length === 0) return t('settings.customPanels.allTeams');
    const names = new Map(teamItems.map((team) => [team.id, team.name]));
    return ids
      .map((id) => names.get(id) ?? t('settings.customPanels.unknownTeam', { id }))
      .join(', ');
  };

  return (
    <Section
      title={t('settings.customPanels.title')}
      description={t('settings.customPanels.description')}
    >
      {list.error ? (
        <ErrorNotice message={t('settings.customPanels.loadError')} />
      ) : (
        <Card>
          {canEdit && (
            <form
              onSubmit={form.handleSubmit}
              noValidate
              aria-label={t('settings.customPanels.addFormLabel')}
              className="flex flex-col gap-3 border-b border-border p-4"
            >
              <PanelFields
                idPrefix="new-panel"
                values={form.values}
                setValue={form.setValue}
                blur={form.blur}
                errorFor={form.errorFor}
                teams={teamItems}
              />
              <div className="flex items-center gap-3">
                <button
                  type="submit"
                  disabled={!form.canSubmit}
                  className="rounded-md bg-brand-500 px-3 py-1.5 text-sm font-medium text-white transition-colors hover:bg-brand-600 disabled:opacity-50"
                >
                  {form.isSubmitting ? t('settings.adding') : t('settings.customPanels.addButton')}
                </button>
                {form.submitError && (
                  <p role="alert" className="text-2xs text-danger">
                    {form.submitError}
                  </p>
                )}
              </div>
            </form>
          )}

          {list.isPending ? (
            <p className="p-4 text-sm text-content-secondary">{t('settings.loading')}</p>
          ) : list.data.items.length === 0 ? (
            <EmptyState
              title={t('settings.customPanels.empty.title')}
              description={t('settings.customPanels.empty.description')}
            />
          ) : (
            <ul className="divide-y divide-border">
              {list.data.items.map((panel) =>
                editing === panel.id ? (
                  <li key={panel.id} className="p-4">
                    <PanelEditor
                      panel={panel}
                      teams={teamItems}
                      onCancel={() => setEditing(null)}
                      onSave={async (body) => {
                        await update.mutateAsync({ id: panel.id, body });
                        setEditing(null);
                      }}
                    />
                  </li>
                ) : (
                  <li
                    key={panel.id}
                    data-testid={`custom-panel-row-${panel.id}`}
                    className="flex flex-wrap items-center gap-3 px-4 py-3"
                  >
                    <div className="flex min-w-48 flex-1 flex-col gap-0.5">
                      <span className="flex items-center gap-2 text-sm font-medium">
                        {panel.name}
                        <span
                          className={`rounded-sm px-1 text-2xs ${
                            panel.enabled
                              ? 'bg-success/10 text-success'
                              : 'bg-inset text-content-tertiary'
                          }`}
                        >
                          {panel.enabled
                            ? t('settings.customPanels.status.on')
                            : t('settings.customPanels.status.off')}
                        </span>
                      </span>
                      <span
                        className="truncate font-mono text-2xs text-content-secondary"
                        title={panel.url}
                      >
                        {panel.url}
                      </span>
                      <span className="text-2xs text-content-tertiary">
                        {t('settings.customPanels.teamsLine', {
                          teams: teamLabel(panel.visible_group_ids),
                        })}
                      </span>
                    </div>
                    {canEdit && (
                      <div className="flex flex-wrap gap-1.5">
                        <RowButton
                          label={t('settings.customPanels.edit')}
                          ariaLabel={t('settings.customPanels.editAriaLabel', { name: panel.name })}
                          onClick={() => setEditing(panel.id)}
                        />
                        <RowButton
                          label={
                            panel.enabled
                              ? t('settings.customPanels.turnOff')
                              : t('settings.customPanels.turnOn')
                          }
                          ariaLabel={
                            panel.enabled
                              ? t('settings.customPanels.turnOffAriaLabel', { name: panel.name })
                              : t('settings.customPanels.turnOnAriaLabel', { name: panel.name })
                          }
                          onClick={() =>
                            update.mutate({ id: panel.id, body: { enabled: !panel.enabled } })
                          }
                        />
                        <RowButton
                          label={t('settings.customPanels.rotate')}
                          ariaLabel={t('settings.customPanels.rotateAriaLabel', {
                            name: panel.name,
                          })}
                          onClick={() =>
                            confirm({
                              title: t('settings.customPanels.rotateConfirmTitle', {
                                name: panel.name,
                              }),
                              description: t('settings.customPanels.rotateConfirmDescription'),
                              confirmLabel: t('settings.customPanels.rotate'),
                              failureTitle: t('settings.customPanels.rotateFailure', {
                                name: panel.name,
                              }),
                              onConfirm: () => rotate.mutateAsync(panel.id),
                            })
                          }
                        />
                        <RowButton
                          label={t('settings.remove')}
                          ariaLabel={t('settings.customPanels.removeAriaLabel', {
                            name: panel.name,
                          })}
                          onClick={() =>
                            confirm({
                              title: t('settings.customPanels.removeConfirmTitle', {
                                name: panel.name,
                              }),
                              description: t('settings.customPanels.removeConfirmDescription'),
                              confirmLabel: t('settings.remove'),
                              failureTitle: t('ui.writeError.remove', { name: panel.name }),
                              onConfirm: () => remove.mutateAsync(panel.id),
                            })
                          }
                        />
                      </div>
                    )}
                  </li>
                ),
              )}
            </ul>
          )}
          {update.isError && editing === null && (
            <p role="alert" className="px-4 pb-3 text-2xs text-danger">
              {failureMessage(t, update.error)}
            </p>
          )}
        </Card>
      )}

      <DeveloperNotes />
      {revealed && <SecretPanel panel={revealed} onClose={() => setRevealed(null)} />}
      {dialog}
    </Section>
  );
}

function RowButton({
  label,
  ariaLabel,
  onClick,
}: {
  label: string;
  ariaLabel: string;
  onClick: () => void;
}): ReactElement {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-label={ariaLabel}
      className="rounded-md border border-border px-2 py-1 text-2xs text-content-secondary transition-colors hover:bg-surface-2"
    >
      {label}
    </button>
  );
}

type FieldValues = { name: string; url: string; teams: string };

/** Name, address, teams — the add form's and the editor's fields. */
function PanelFields({
  idPrefix,
  values,
  setValue,
  blur,
  errorFor,
  teams,
}: {
  idPrefix: string;
  values: FieldValues;
  setValue: (name: keyof FieldValues, value: string) => void;
  blur: (name: keyof FieldValues) => void;
  errorFor: (name: keyof FieldValues) => string | null;
  teams: TransferTeam[];
}): ReactElement {
  const t = useTranslate();
  const nameError = errorFor('name');
  const urlError = errorFor('url');
  const selected = new Set(parseTeams(values.teams));
  const toggle = (id: number, on: boolean): void => {
    const next = new Set(selected);
    if (on) next.add(id);
    else next.delete(id);
    setValue('teams', [...next].sort((a, b) => a - b).join(','));
  };
  const labelClass = 'text-2xs font-medium uppercase tracking-wide text-content-tertiary';
  const inputClass =
    'rounded-md border border-border bg-inset px-2 py-1.5 text-sm outline-none placeholder:text-content-tertiary';
  return (
    <div className="flex flex-col gap-3">
      <div className="flex flex-wrap gap-3">
        <div className="flex min-w-48 flex-1 flex-col gap-1">
          <label htmlFor={`${idPrefix}-name`} className={labelClass}>
            {t('settings.customPanels.nameLabel')}
          </label>
          <input
            id={`${idPrefix}-name`}
            value={values.name}
            maxLength={CUSTOM_PANEL_NAME_MAX}
            onChange={(event) => setValue('name', event.target.value)}
            onBlur={() => blur('name')}
            aria-invalid={nameError ? true : undefined}
            aria-describedby={nameError ? `${idPrefix}-name-error` : undefined}
            placeholder={t('settings.customPanels.namePlaceholder')}
            className={inputClass}
          />
          <FieldError id={`${idPrefix}-name-error`} message={nameError} />
        </div>
        <div className="flex min-w-64 flex-[2] flex-col gap-1">
          <label htmlFor={`${idPrefix}-url`} className={labelClass}>
            {t('settings.customPanels.urlLabel')}
          </label>
          <input
            id={`${idPrefix}-url`}
            type="url"
            value={values.url}
            onChange={(event) => setValue('url', event.target.value)}
            onBlur={() => blur('url')}
            aria-invalid={urlError ? true : undefined}
            aria-describedby={`${idPrefix}-url-hint${urlError ? ` ${idPrefix}-url-error` : ''}`}
            placeholder="https://backoffice.example/player"
            className={`${inputClass} font-mono`}
          />
          <p id={`${idPrefix}-url-hint`} className="text-2xs text-content-tertiary">
            {t('settings.customPanels.urlHint')}
          </p>
          <FieldError id={`${idPrefix}-url-error`} message={urlError} />
        </div>
      </div>
      <fieldset className="flex flex-col gap-1.5">
        <legend className={labelClass}>{t('settings.customPanels.teamsLabel')}</legend>
        <p className="text-2xs text-content-tertiary">{t('settings.customPanels.teamsHint')}</p>
        {teams.length === 0 ? (
          <p className="text-2xs text-content-tertiary">{t('settings.customPanels.noTeams')}</p>
        ) : (
          <div className="flex flex-wrap gap-x-4 gap-y-1">
            {teams.map((team) => (
              <label key={team.id} className="flex items-center gap-1.5 text-sm">
                <input
                  type="checkbox"
                  checked={selected.has(team.id)}
                  onChange={(event) => toggle(team.id, event.target.checked)}
                />
                {team.name}
              </label>
            ))}
          </div>
        )}
      </fieldset>
    </div>
  );
}

/** One row's editor: the same fields, saved with its own button. */
function PanelEditor({
  panel,
  teams,
  onCancel,
  onSave,
}: {
  panel: CustomPanel;
  teams: TransferTeam[];
  onCancel: () => void;
  onSave: (body: PanelBody) => Promise<void>;
}): ReactElement {
  const t = useTranslate();
  const form = useForm({
    initial: { name: panel.name, url: panel.url, teams: panel.visible_group_ids.join(',') },
    validators: {
      name: compose(
        required(t('settings.customPanels.nameRequired')),
        maxLength(CUSTOM_PANEL_NAME_MAX),
      ),
      url: panelUrl(t),
    },
    onSubmit: async (values, { setSubmitError }) => {
      try {
        await onSave({
          name: values.name.trim(),
          url: values.url.trim(),
          visible_group_ids: parseTeams(values.teams),
        });
      } catch (error) {
        setSubmitError(failureMessage(t, error));
      }
    },
  });
  useSettingsLeaveGuard(form.isDirty, form.isSubmitting);
  return (
    <form
      onSubmit={form.handleSubmit}
      noValidate
      aria-label={t('settings.customPanels.editFormLabel', { name: panel.name })}
      className="flex flex-col gap-3"
    >
      <PanelFields
        idPrefix={`panel-${panel.id}`}
        values={form.values}
        setValue={form.setValue}
        blur={form.blur}
        errorFor={form.errorFor}
        teams={teams}
      />
      <div className="flex items-center gap-2">
        <button
          type="submit"
          disabled={!form.canSubmit || !form.isDirty}
          className="rounded-md bg-brand-500 px-3 py-1.5 text-sm font-medium text-white transition-colors hover:bg-brand-600 disabled:opacity-50"
        >
          {t('settings.customPanels.save')}
        </button>
        <button
          type="button"
          onClick={onCancel}
          className="rounded-md border border-border px-3 py-1.5 text-sm"
        >
          {t('settings.customPanels.cancel')}
        </button>
        {form.submitError && (
          <p role="alert" className="text-2xs text-danger">
            {form.submitError}
          </p>
        )}
      </div>
    </form>
  );
}

/** The secret, once — closing it is what discards it from the screen's state. */
function SecretPanel({
  panel,
  onClose,
}: {
  panel: CustomPanelWithSecret;
  onClose: () => void;
}): ReactElement {
  const t = useTranslate();
  const [copied, setCopied] = useState(false);
  const copy = (): void => {
    void navigator.clipboard?.writeText(panel.signing_secret).then(
      () => {
        setCopied(true);
        window.setTimeout(() => setCopied(false), 1_500);
      },
      () => setCopied(false),
    );
  };
  return (
    <Modal
      onClose={onClose}
      title={t('settings.customPanels.secret.title', { name: panel.name })}
      description={t('settings.customPanels.secret.description')}
      className="w-[32rem]"
    >
      <div className="flex flex-col gap-3">
        <div className="flex items-center gap-2">
          <code
            data-testid="custom-panel-secret"
            className="flex-1 truncate rounded-md border border-border bg-inset px-2 py-1.5 text-2xs"
          >
            {panel.signing_secret}
          </code>
          <button
            type="button"
            onClick={copy}
            aria-label={t('settings.customPanels.secret.copyAriaLabel')}
            className="shrink-0 rounded-md bg-brand-500 px-2.5 py-1 text-2xs font-medium text-white transition-colors hover:bg-brand-600"
          >
            {copied ? t('settings.copied') : t('settings.copy')}
          </button>
        </div>
        <p role="alert" className="text-2xs text-warning">
          {t('settings.customPanels.secret.warning')}
        </p>
        <div className="flex justify-end">
          <button
            type="button"
            onClick={onClose}
            className="rounded-md border border-border px-3 py-1.5 text-sm"
          >
            {t('settings.customPanels.secret.done')}
          </button>
        </div>
      </div>
    </Modal>
  );
}

/** What the page's developer needs: the messages, and how to check the token. */
function DeveloperNotes(): ReactElement {
  const t = useTranslate();
  const minutes = CUSTOM_PANEL_TOKEN_TTL_SECONDS / 60;
  return (
    <details className="mt-3 rounded-md border border-border p-3 text-xs">
      <summary className="cursor-pointer font-medium">
        {t('settings.customPanels.dev.title')}
      </summary>
      <ol className="mt-2 flex list-decimal flex-col gap-1.5 pl-5 text-content-secondary">
        <li>{t('settings.customPanels.dev.sandbox')}</li>
        <li>{t('settings.customPanels.dev.ready')}</li>
        <li>{t('settings.customPanels.dev.context', { minutes })}</li>
        <li>{t('settings.customPanels.dev.verify')}</li>
        <li>{t('settings.customPanels.dev.extras')}</li>
        <li>{t('settings.customPanels.dev.newTab')}</li>
      </ol>
    </details>
  );
}
