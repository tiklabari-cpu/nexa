/**
 * Settings → Sandbox: create/reset a second, disconnected tenant (FR-MOD-11.5 · 11.5-g).
 *
 * A pure consumer of `GET|POST /settings/sandbox` + `POST /settings/sandbox/reset`
 * (`11.5-f`) — this screen opens no new server surface. The read is open on
 * every plan for `admin` and above (mirrors `minimumRole: 'admin'`); creating
 * is Enterprise-only and owner-only (`exactRole: 'owner'`, `entitlement:
 * 'sandbox'`); resetting is owner-only and refused anywhere but inside the
 * sandbox itself — a production workspace cannot wipe a sandbox it merely owns.
 *
 * **Mandatory invariant (audit finding — a wrong read here deletes PRODUCTION
 * data):** every piece of state this screen renders comes from `view.is_sandbox`
 * in the server's own response to *this session's* credential — never from a
 * client flag, `localStorage`, or a route guess. The reset button in particular
 * is gated on that field alone, matching the server's own check
 * (`sandbox-service.ts`'s `resetSandbox`); the server independently refuses
 * reset on a non-sandbox licence too (`11.5-f`'s negative test), so this is a
 * courtesy hide, not the only defence — but it has to agree with the server,
 * not merely look plausible.
 *
 * Destructive-confirmation pattern follows `WebhookSubscriptions.tsx`'s
 * `DeleteWebhookModal`: a `Modal` naming exactly what is lost, Cancel beside a
 * danger-styled confirm button, the pending label swapped in while the
 * mutation runs. Reset additionally signs the caller out on success — the
 * licence row it deletes is the one the caller's own token is scoped to.
 */
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useState, type ReactElement } from 'react';
import type { SandboxView } from '@nexa/types';
import { Card, ErrorNotice, Section } from '../../components/Page.js';
import { StatusDot } from '../../components/StatusDot.js';
import { Modal } from '../../components/ui/index.js';
import { ApiClientError, errorMessageKey } from '../../lib/api-client.js';
import { useApiClient, useAuth } from '../../lib/auth-store.js';
import { formatDateTime } from '../../lib/format.js';
import { useTranslate, type TFunction } from '../../lib/i18n.js';

export const SANDBOX_QUERY_KEY = ['settings', 'sandbox'];

interface SandboxResetResult {
  reset_at: string;
  signed_out: true;
}

/** Mirrors `GET /settings/sandbox`'s `minimumRole: 'admin'` — the courtesy hide `Compliance`/`SsoConnection`/`SiemExport` all use. */
const VIEWER_ROLES = new Set(['admin', 'viceowner', 'owner']);

export function Sandbox({ canEdit }: { canEdit: boolean }): ReactElement | null {
  const role = useAuth((s) => s.agent?.role ?? null);
  if (role === null || !VIEWER_ROLES.has(role)) return null;

  // Create and reset are both `exactRole: 'owner'` server-side — strictly
  // above the read gate above, because minting or wiping a whole second
  // workspace is an owner decision, not an admin one.
  const isOwner = role === 'owner';

  return <SandboxCard canManage={canEdit && isOwner} restricted={canEdit && !isOwner} />;
}

function SandboxCard({
  canManage,
  restricted,
}: {
  canManage: boolean;
  /** Scope allows writing but the role does not — explain the missing button, not just omit it. */
  restricted: boolean;
}): ReactElement {
  const t = useTranslate();
  const api = useApiClient();
  const queryClient = useQueryClient();
  const signOut = useAuth((s) => s.signOut);
  const [confirmingReset, setConfirmingReset] = useState(false);

  const settings = useQuery({
    queryKey: SANDBOX_QUERY_KEY,
    queryFn: () => api.get<SandboxView>('/settings/sandbox'),
  });

  const create = useMutation({
    mutationFn: () => api.post<SandboxView>('/settings/sandbox'),
    onSuccess: (data) => queryClient.setQueryData(SANDBOX_QUERY_KEY, data),
  });

  const reset = useMutation({
    mutationFn: () => api.post<SandboxResetResult>('/settings/sandbox/reset'),
    onSuccess: () => {
      setConfirmingReset(false);
      // The licence row this token is scoped to no longer exists — revoking
      // it server-side will 401/404, which `signOut` already tolerates
      // (`Promise.allSettled`), and clearing local state is what returns the
      // caller to sign-in.
      void signOut();
    },
  });

  return (
    <Section
      id="section-sandbox"
      title={t('settings.sandbox.title')}
      description={t('settings.sandbox.description')}
    >
      {settings.error ? (
        <ErrorNotice message={t('settings.sandbox.loadError')} />
      ) : (
        <Card>
          {settings.isPending ? (
            <p className="p-4 text-sm text-content-secondary">{t('settings.loading')}</p>
          ) : (
            <SandboxBody
              view={settings.data!}
              canManage={canManage}
              restricted={restricted}
              onCreate={() => create.mutate()}
              creating={create.isPending}
              createError={create.error}
              onRequestReset={() => setConfirmingReset(true)}
            />
          )}
        </Card>
      )}

      {confirmingReset && (
        <ResetSandboxModal
          onClose={() => setConfirmingReset(false)}
          onConfirm={() => reset.mutate()}
          resetting={reset.isPending}
          resetError={reset.error}
        />
      )}
    </Section>
  );
}

function entitlementMessage(t: TFunction, error: unknown): string {
  if (error instanceof ApiClientError && error.details?.['entitlement'] === 'sandbox') {
    return t('settings.sandbox.entitlementNote');
  }
  return t(errorMessageKey(error));
}

function SandboxBody({
  view,
  canManage,
  restricted,
  onCreate,
  creating,
  createError,
  onRequestReset,
}: {
  view: SandboxView;
  canManage: boolean;
  restricted: boolean;
  onCreate: () => void;
  creating: boolean;
  createError: unknown;
  onRequestReset: () => void;
}): ReactElement {
  const t = useTranslate();

  if (view.is_sandbox) {
    return (
      <div className="flex flex-col gap-3 p-4">
        <div className="flex items-center gap-2 text-sm font-medium">
          <StatusDot tone="warning" label={t('settings.sandbox.isSandboxLabel')} />
        </div>
        <p className="text-2xs text-content-tertiary">{t('settings.sandbox.isSandboxNote')}</p>

        {canManage ? (
          <button
            type="button"
            onClick={onRequestReset}
            className="self-start rounded-md border border-danger px-3 py-1.5 text-sm font-medium text-danger transition-colors hover:bg-danger/10"
          >
            {t('settings.sandbox.resetButton')}
          </button>
        ) : restricted ? (
          <p className="text-2xs text-content-tertiary">{t('settings.sandbox.resetRestricted')}</p>
        ) : null}
      </div>
    );
  }

  if (!view.entitled) {
    return (
      <div className="flex flex-col gap-2 p-4">
        <div className="flex items-center gap-2 text-sm font-medium">
          <StatusDot tone="neutral" label={t('settings.sandbox.notAvailable')} />
        </div>
        <p className="text-2xs text-content-tertiary">{t('settings.sandbox.entitlementNote')}</p>
      </div>
    );
  }

  if (view.sandbox) {
    return (
      <div className="flex flex-col gap-2 p-4">
        <div className="flex items-center gap-2 text-sm font-medium">
          <StatusDot tone="success" label={t('settings.sandbox.createdLabel')} />
        </div>
        <p className="text-2xs text-content-tertiary">
          {t('settings.sandbox.createdSummary', {
            created:
              formatDateTime(view.sandbox.created_at) ?? t('settings.sandbox.createdUnknown'),
            reset: formatDateTime(view.sandbox.reset_at) ?? t('settings.sandbox.resetNever'),
          })}
        </p>
        <p className="text-2xs text-content-tertiary">
          {t('settings.sandbox.resetFromInsideNote')}
        </p>
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-3 p-4">
      <p className="text-sm text-content-secondary">{t('settings.sandbox.emptyNote')}</p>

      {canManage ? (
        <div className="flex flex-col gap-2">
          <button
            type="button"
            onClick={onCreate}
            disabled={creating}
            className="self-start rounded-md bg-brand-500 px-3 py-1.5 text-sm font-medium text-white transition-colors hover:bg-brand-600 disabled:opacity-50"
          >
            {creating ? t('settings.sandbox.creating') : t('settings.sandbox.createButton')}
          </button>
          {createError !== null && (
            <p role="alert" className="text-2xs text-danger">
              {entitlementMessage(t, createError)}
            </p>
          )}
        </div>
      ) : restricted ? (
        <p className="text-2xs text-content-tertiary">{t('settings.sandbox.createRestricted')}</p>
      ) : null}
    </div>
  );
}

function ResetSandboxModal({
  onClose,
  onConfirm,
  resetting,
  resetError,
}: {
  onClose: () => void;
  onConfirm: () => void;
  resetting: boolean;
  resetError: unknown;
}): ReactElement {
  const t = useTranslate();
  return (
    <Modal
      onClose={onClose}
      title={t('settings.sandbox.resetModalTitle')}
      description={t('settings.sandbox.resetModalDescription')}
    >
      {resetError !== null && (
        <p role="alert" className="text-2xs text-danger">
          {t(errorMessageKey(resetError))}
        </p>
      )}
      <div className="mt-4 flex justify-end gap-2">
        <button
          type="button"
          onClick={onClose}
          className="rounded-md border border-border px-3 py-1.5 text-sm"
        >
          {t('settings.cancel')}
        </button>
        <button
          type="button"
          onClick={onConfirm}
          disabled={resetting}
          className="rounded-md border border-danger px-3 py-1.5 text-sm font-medium text-danger transition-colors hover:bg-danger/10 disabled:opacity-50"
        >
          {resetting ? t('settings.sandbox.resetting') : t('settings.sandbox.resetButton')}
        </button>
      </div>
    </Modal>
  );
}
