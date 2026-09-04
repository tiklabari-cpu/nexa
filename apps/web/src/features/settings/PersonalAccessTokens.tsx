/**
 * Settings → Personal access tokens (FR-MOD-08.8.2 · M-UI-b).
 *
 * The console half of a credential that already existed. `routes/auth.ts` has
 * carried the whole family since Dilim 2 — list, create, revoke, each on the
 * caller's *own* account — and `apps/web` referenced none of it: the string
 * `personal-access-token` did not appear anywhere under `src`. So the only way
 * to obtain a PAT was to call the API with a credential you did not have yet.
 * This section is that missing door; no endpoint, contract or scope changed.
 *
 * Own-account resource, so it is gated on the session's own scopes rather than
 * a `canEdit` prop `SettingsPage.tsx` computes from a workspace role — the same
 * shape `TwoFactor.tsx` uses, and for the same reason: nothing here reaches
 * another person's account. Reading needs `accounts--my:ro`, writing
 * `accounts--my:rw`; both are in every role's default set.
 *
 * THREE RULES THIS SCREEN OWES A CREDENTIAL SURFACE, and where each is kept:
 *
 *  1. **The token is shown once, and the screen says so.** The plaintext exists
 *     in the browser for exactly one panel: it is read straight off the create
 *     response into component state, and closing the panel discards it. It is
 *     never written to the list cache (the server's list never carries one),
 *     never to the URL, never to a log or an analytics call — and creation
 *     deliberately does *not* go through `useMutation`, because a mutation's
 *     `data` is retained by the QueryClient's mutation cache for the lifetime of
 *     the screen. `useForm` already owns the in-flight state a mutation would
 *     have been used for, so the call is a plain `api.post` and the only copy is
 *     the one the panel is showing.
 *
 *  2. **The scope picker offers only what the session holds.** The server
 *     refuses a token stronger than the session that mints it (`auth.ts` —
 *     "Cannot grant scopes the current session does not hold"), and it compares
 *     against the *literal* scope list, not the implication-expanded one. So the
 *     picker lists `agent.scopes` verbatim: expanding it here — offering
 *     `chats--all:ro` to a session holding `chats--all:rw` — would put an option
 *     on screen that the server is certain to reject. A refusal is still
 *     handled, because a role demoted mid-session leaves this list stale, and
 *     the server's sentence is shown as-is since it names which scope was
 *     refused.
 *
 *  3. **Scopes are fixed at creation** (the PRD's KK). There is no edit path,
 *     here or on the server: a token's authority is decided once and the only
 *     way to change it is to revoke and mint another.
 *
 * Closing the one-time panel is *not* guarded the way `TwoFactor.tsx` guards its
 * recovery sheet. That guard exists because a lost recovery sheet cannot be
 * recovered at all; a lost PAT costs one revoke and one create, which is
 * `DeveloperPortal.tsx`'s `SecretOncePanel` situation rather than the sheet's.
 *
 * Out of scope, deliberately (CONVENTIONS §5): the rest of FR-MOD-08.8.2's
 * acceptance line. The API-call billing counter is already on `BillingPage.tsx`
 * and the integration reference on the developer portal's manifest tab — this
 * item is the PAT surface the audit measured as absent.
 */
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useState, type ReactElement } from 'react';
import { Card, ErrorNotice, Section } from '../../components/Page.js';
import { EmptyState } from '../../components/EmptyState.js';
import { Modal } from '../../components/ui/index.js';
import { ApiClientError, errorMessageKey } from '../../lib/api-client.js';
import { useApiClient, useAuth } from '../../lib/auth-store.js';
import { formatDateTime } from '../../lib/format.js';
import { FieldError, required, useForm } from '../../lib/form.js';
import { useTranslate, type TFunction } from '../../lib/i18n.js';

const TOKENS_KEY = ['settings', 'personal-access-tokens'] as const;

/** What the list returns — metadata only, never a secret. */
interface PersonalAccessToken {
  id: string;
  name: string | null;
  scopes: string[];
  created_at: string;
  last_used_at: string | null;
  expires_at: string | null;
}

/** The create response: the same row plus the one and only copy of the secret. */
interface IssuedToken extends PersonalAccessToken {
  token: string;
}

/**
 * The lifetimes offered, in days. `null` is the endpoint's own default — no
 * expiry — and it is the default here too, so the console never quietly
 * disagrees with the API about how long a credential lives. The hint next to it
 * is where the recommendation goes; a surprise expiry six months from now is a
 * support incident, not a security win.
 */
const EXPIRY_CHOICES: readonly (number | null)[] = [null, 30, 90, 365];

export function PersonalAccessTokens(): ReactElement {
  const t = useTranslate();
  const api = useApiClient();
  const queryClient = useQueryClient();

  const sessionScopes = useAuth((s) => s.agent?.scopes ?? []);
  const canEdit = sessionScopes.includes('accounts--my:rw');
  // `:rw` satisfies `:ro` at the route gate (`expandScope`), so a session with
  // either can read the list.
  const canRead = canEdit || sessionScopes.includes('accounts--my:ro');

  const list = useQuery({
    queryKey: TOKENS_KEY,
    queryFn: () => api.get<{ items: PersonalAccessToken[] }>('/auth/personal-access-tokens'),
    enabled: canRead,
  });

  const [issued, setIssued] = useState<IssuedToken | null>(null);
  const [revokeTarget, setRevokeTarget] = useState<PersonalAccessToken | null>(null);
  const [selectedScopes, setSelectedScopes] = useState<string[]>([]);
  const [expiresInDays, setExpiresInDays] = useState<number | null>(null);

  const form = useForm({
    initial: { name: '' },
    validators: { name: required(t('settings.pat.form.nameError')) },
    onSubmit: async (values, { setFieldError, setSubmitError, reset }) => {
      try {
        const created = await api.post<IssuedToken>('/auth/personal-access-tokens', {
          name: values.name.trim(),
          scopes: selectedScopes,
          ...(expiresInDays === null ? {} : { expires_in_days: expiresInDays }),
        });
        setIssued(created);
        reset();
        setSelectedScopes([]);
        setExpiresInDays(null);
        void queryClient.invalidateQueries({ queryKey: TOKENS_KEY });
      } catch (error) {
        if (error instanceof ApiClientError) {
          // A 4xx becomes a visible error rather than being swallowed. Two of
          // them say something the catalogue's general sentence would lose: a
          // `validation` refusal names the field, and an `authorization` one
          // names the scope the session turned out not to hold (which reaches
          // here only when a demotion has left `sessionScopes` stale).
          const field = firstRejectedField(error);
          if (field === 'name') {
            // i18n-ignore: server-specific validation detail, see the note above.
            setFieldError('name', error.message);
            return;
          }
          if (error.type === 'validation' || error.type === 'authorization') {
            // i18n-ignore: server-specific refusal detail, see the note above.
            setSubmitError(error.message);
            return;
          }
        }
        setSubmitError(t(errorMessageKey(error)));
      }
    },
  });

  const nameError = form.errorFor('name');
  // A token with no scopes is unbounded at the API's default, not restricted —
  // the same reason `DeveloperPortal.tsx` refuses an empty set rather than
  // round-tripping it.
  const canSubmit = form.canSubmit && selectedScopes.length > 0;

  function toggleScope(scope: string): void {
    setSelectedScopes((current) =>
      current.includes(scope) ? current.filter((s) => s !== scope) : [...current, scope],
    );
  }

  if (!canRead) {
    return (
      <Section title={t('settings.pat.title')} description={t('settings.pat.description')}>
        <Card>
          <p className="p-4 text-sm text-content-secondary">{t('settings.pat.noAccess')}</p>
        </Card>
      </Section>
    );
  }

  return (
    <Section title={t('settings.pat.title')} description={t('settings.pat.description')}>
      {list.error ? (
        <ErrorNotice message={t('settings.pat.loadError')} />
      ) : (
        <Card>
          {canEdit && (
            <form
              onSubmit={form.handleSubmit}
              noValidate
              className="flex flex-col gap-3 border-b border-border p-4"
            >
              <div className="flex flex-wrap items-end gap-3">
                {/* The error line sits outside the `<label>`, not inside it:
                    nested prose folds into the label's accessible name, so
                    `getByLabelText('Token name')` would stop matching the
                    moment a refusal appeared — `DeveloperPortal.tsx`'s redirect
                    URIs field carries the same note. */}
                <div className="flex min-w-56 flex-1 flex-col gap-1">
                  <label
                    htmlFor="new-pat-name"
                    className="text-2xs font-medium uppercase tracking-wide text-content-tertiary"
                  >
                    {t('settings.pat.form.nameLabel')}
                  </label>
                  <input
                    id="new-pat-name"
                    value={form.values.name}
                    onChange={(event) => form.setValue('name', event.target.value)}
                    onBlur={() => form.blur('name')}
                    aria-invalid={nameError ? true : undefined}
                    aria-describedby={nameError ? 'new-pat-name-error' : undefined}
                    placeholder={t('settings.pat.form.namePlaceholder')}
                    maxLength={120}
                    className="rounded-md border border-border bg-inset px-2 py-1.5 text-sm outline-none placeholder:text-content-tertiary"
                  />
                  <FieldError id="new-pat-name-error" message={nameError} />
                </div>

                <label htmlFor="new-pat-expiry" className="flex flex-col gap-1">
                  <span className="text-2xs font-medium uppercase tracking-wide text-content-tertiary">
                    {t('settings.pat.form.expiryLabel')}
                  </span>
                  <select
                    id="new-pat-expiry"
                    value={expiresInDays === null ? 'never' : String(expiresInDays)}
                    onChange={(event) =>
                      setExpiresInDays(
                        event.target.value === 'never' ? null : Number(event.target.value),
                      )
                    }
                    className="rounded-md border border-border bg-inset px-2 py-1.5 text-sm outline-none"
                  >
                    {EXPIRY_CHOICES.map((days) => (
                      <option key={days ?? 'never'} value={days === null ? 'never' : String(days)}>
                        {days === null
                          ? t('settings.never')
                          : t('settings.pat.form.days', { days })}
                      </option>
                    ))}
                  </select>
                </label>

                <button
                  type="submit"
                  disabled={!canSubmit}
                  className="rounded-md bg-brand-500 px-3 py-1.5 text-sm font-medium text-white transition-colors hover:bg-brand-600 disabled:opacity-50"
                >
                  {form.isSubmitting
                    ? t('settings.pat.form.creating')
                    : t('settings.pat.form.createButton')}
                </button>
              </div>

              <fieldset className="flex flex-col gap-1.5">
                <legend className="text-2xs font-medium uppercase tracking-wide text-content-tertiary">
                  {t('settings.pat.form.scopesLabel')}
                </legend>
                <p className="text-2xs text-content-tertiary">
                  {t('settings.pat.form.scopesHint')}
                </p>
                <ul className="max-h-40 space-y-1 overflow-y-auto rounded-md border border-border p-2">
                  {sessionScopes.map((scope) => (
                    <li key={scope}>
                      <label className="flex items-center gap-2 text-2xs">
                        <input
                          type="checkbox"
                          checked={selectedScopes.includes(scope)}
                          onChange={() => toggleScope(scope)}
                        />
                        <code>{scope}</code>
                      </label>
                    </li>
                  ))}
                </ul>
              </fieldset>

              {form.submitError && (
                <p role="alert" className="text-2xs text-danger">
                  {form.submitError}
                </p>
              )}
            </form>
          )}

          {list.isPending ? (
            <p className="p-4 text-sm text-content-secondary">{t('settings.loading')}</p>
          ) : list.data.items.length === 0 ? (
            <EmptyState
              title={t('settings.pat.empty.title')}
              description={t('settings.pat.empty.description')}
            />
          ) : (
            <ul className="divide-y divide-border">
              {list.data.items.map((token) => (
                <TokenRow
                  key={token.id}
                  token={token}
                  t={t}
                  canEdit={canEdit}
                  onRevoke={() => setRevokeTarget(token)}
                />
              ))}
            </ul>
          )}
        </Card>
      )}

      {/* The plaintext lives only here. Closing drops the state, not just the
          dialog — there is no second copy anywhere to leak. */}
      {issued && <IssuedTokenPanel issued={issued} onClose={() => setIssued(null)} />}

      {revokeTarget && (
        <RevokeTokenModal token={revokeTarget} onClose={() => setRevokeTarget(null)} />
      )}
    </Section>
  );
}

/** The field a `validation` refusal blames, when it blames exactly one. */
function firstRejectedField(error: ApiClientError): string | null {
  if (error.type !== 'validation') return null;
  const fields = error.details?.['fields'];
  if (!Array.isArray(fields)) return null;
  for (const entry of fields) {
    if (typeof entry === 'object' && entry !== null) {
      const field = (entry as { field?: unknown }).field;
      if (typeof field === 'string') return field;
    }
  }
  return null;
}

/** `formatDateTime` with the raw ISO as the fallback, so a row never renders "null". */
function when(iso: string): string {
  return formatDateTime(iso) ?? iso;
}

function TokenRow({
  token,
  t,
  canEdit,
  onRevoke,
}: {
  token: PersonalAccessToken;
  t: TFunction;
  canEdit: boolean;
  onRevoke: () => void;
}): ReactElement {
  const name = token.name ?? t('settings.pat.unnamed');
  return (
    <li className="flex flex-wrap items-center gap-3 px-4 py-2.5">
      <span className="min-w-0 flex-1 truncate text-sm font-medium">{name}</span>
      <span className="text-2xs text-content-tertiary" title={token.scopes.join(', ')}>
        {t('settings.pat.scopeCount', { count: token.scopes.length })}
      </span>
      <span className="text-2xs text-content-tertiary">
        {t('settings.pat.created', { when: when(token.created_at) })}
      </span>
      <span className="text-2xs text-content-tertiary">
        {token.last_used_at
          ? t('settings.pat.lastUsed', { when: when(token.last_used_at) })
          : t('settings.pat.neverUsed')}
      </span>
      <span className="text-2xs text-content-tertiary">
        {token.expires_at
          ? t('settings.pat.expires', { when: when(token.expires_at) })
          : t('settings.pat.neverExpires')}
      </span>
      {canEdit && (
        <button
          type="button"
          onClick={onRevoke}
          aria-label={t('settings.pat.revokeAriaLabel', { name })}
          className="rounded-md border border-border px-2 py-1 text-2xs text-content-secondary transition-colors hover:bg-surface-2"
        >
          {t('settings.pat.revokeButton')}
        </button>
      )}
    </li>
  );
}

/**
 * The shown-once panel (the PRD's "PAT bir kez gösterilir").
 *
 * It renders the value, a copy button, and a warning that says plainly this is
 * the only time. Closing — Done, Escape or a backdrop click, all routed through
 * `onClose` — is what discards it from the parent's state.
 */
function IssuedTokenPanel({
  issued,
  onClose,
}: {
  issued: IssuedToken;
  onClose: () => void;
}): ReactElement {
  const t = useTranslate();
  const [copied, setCopied] = useState(false);

  function copy(): void {
    void navigator.clipboard?.writeText(issued.token).then(
      () => {
        setCopied(true);
        window.setTimeout(() => setCopied(false), 1_500);
      },
      () => setCopied(false),
    );
  }

  return (
    <Modal
      onClose={onClose}
      title={t('settings.pat.issued.title', { name: issued.name ?? t('settings.pat.unnamed') })}
      description={t('settings.pat.issued.description')}
      className="w-[30rem]"
    >
      <div className="flex flex-col gap-3">
        <div className="flex flex-col gap-1">
          <span className="text-2xs font-medium uppercase tracking-wide text-content-tertiary">
            {t('settings.pat.issued.tokenLabel')}
          </span>
          <div className="flex items-center gap-2">
            <code
              data-testid="pat-token"
              className="flex-1 truncate rounded-md border border-border bg-inset px-2 py-1.5 text-2xs"
            >
              {issued.token}
            </code>
            <button
              type="button"
              onClick={copy}
              aria-label={t('settings.pat.issued.copyAriaLabel')}
              className="shrink-0 rounded-md bg-brand-500 px-2.5 py-1 text-2xs font-medium text-white transition-colors hover:bg-brand-600"
            >
              {copied ? t('settings.copied') : t('settings.copy')}
            </button>
          </div>
          <p role="alert" className="text-2xs text-warning">
            {t('settings.pat.issued.warning')}
          </p>
        </div>

        <div className="flex flex-col gap-1">
          <span className="text-2xs font-medium uppercase tracking-wide text-content-tertiary">
            {t('settings.pat.issued.usageLabel')}
          </span>
          {/* The header shape, not the value — one copy of the secret on screen
              is one more than anything else in the product keeps. */}
          <code className="rounded-md border border-border bg-inset px-2 py-1.5 text-2xs">
            Authorization: Bearer &lt;token&gt;
          </code>
        </div>

        <div className="mt-1 flex justify-end">
          <button
            type="button"
            onClick={onClose}
            className="rounded-md border border-border px-3 py-1.5 text-sm"
          >
            {t('settings.pat.issued.doneButton')}
          </button>
        </div>
      </div>
    </Modal>
  );
}

/**
 * Revoking asks first. Unlike a tag or a saved reply, the thing being deleted is
 * live somewhere else — a script, a cron job, an integration — and it stops
 * working the moment this returns, with no undo.
 */
function RevokeTokenModal({
  token,
  onClose,
}: {
  token: PersonalAccessToken;
  onClose: () => void;
}): ReactElement {
  const t = useTranslate();
  const api = useApiClient();
  const queryClient = useQueryClient();
  const name = token.name ?? t('settings.pat.unnamed');

  const revoke = useMutation({
    mutationFn: () => api.delete<void>(`/auth/personal-access-tokens/${token.id}`),
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: TOKENS_KEY });
      onClose();
    },
  });

  return (
    <Modal
      onClose={onClose}
      title={t('settings.pat.revoke.title', { name })}
      description={t('settings.pat.revoke.description')}
      className="w-[26rem]"
    >
      <div className="flex flex-col gap-3">
        {revoke.isError && (
          <p role="alert" className="text-2xs text-danger">
            {t(errorMessageKey(revoke.error))}
          </p>
        )}
        <div className="flex justify-end gap-2">
          <button
            type="button"
            onClick={onClose}
            className="rounded-md border border-border px-3 py-1.5 text-sm"
          >
            {t('settings.cancel')}
          </button>
          <button
            type="button"
            onClick={() => revoke.mutate()}
            disabled={revoke.isPending}
            className="rounded-md border border-danger px-3 py-1.5 text-sm font-medium text-danger transition-colors hover:bg-danger/10 disabled:opacity-50"
          >
            {revoke.isPending
              ? t('settings.pat.revoke.revoking')
              : t('settings.pat.revoke.confirmButton')}
          </button>
        </div>
      </div>
    </Modal>
  );
}
