/**
 * Settings → Security: SIEM export screen (NFR-C6 · C6-f).
 *
 * A pure consumer of endpoints `C6-b` already built and owns: `GET|PATCH
 * /settings/siem` (destination + on/off) and `GET /settings/siem/status`
 * (delivery position, backlog, chain-gap flag from `C6-c`). This screen opens
 * no new server surface. Role gate follows `Compliance.tsx`/`SsoConnection.tsx`
 * — visible only `admin` and above, mirroring both routes'
 * `minimumRole: 'admin'`; `canEdit` mirrors `access_rules:rw`, the scope the
 * write route itself requires, so there is no separate "restricted" state to
 * explain the way the BAA/SSO screens do.
 *
 * The gap banner reads `chain_gap_detected` literally, per `C6-b`'s own
 * contract: `null` (no chain yet — not answerable) and `false` (checked, clean)
 * both render nothing; only `true` warns. Folding `null` into "no gap" would be
 * exactly the false assurance the flag was built to avoid.
 *
 * The write is Enterprise-only (`entitlement: 'siem_export'`, FR-MOD-11.5), so
 * a PATCH can 403 with `details.entitlement` on a workspace that has never
 * upgraded — read here to show the upsell instead of ADR-06's generic
 * `not_allowed` sentence, the same pattern `Sandbox.tsx`/`SlaPolicy.tsx` use
 * (tm 133.12's finding, closed here for this screen — tm 144).
 */
import { useQuery, useQueryClient } from '@tanstack/react-query';
import type { ReactElement } from 'react';
import { Card, ErrorNotice, Section } from '../../components/Page.js';
import { SettingsForm } from '../../components/settings/SettingsForm.js';
import { Banner } from '../../components/ui/index.js';
import { StatusDot } from '../../components/StatusDot.js';
import { ApiClientError } from '../../lib/api-client.js';
import { useApiClient, useAuth } from '../../lib/auth-store.js';
import { formatCount, formatDateTime } from '../../lib/format.js';
import { useEntitlementNote } from '../../lib/entitlement-note.js';
import { useTranslate, type TFunction } from '../../lib/i18n.js';
import { SIEM_EXPORT_TARGETS, type SiemExportTarget } from '@siyahtus/types';

interface SiemExportSettings {
  enabled: boolean;
  /** Null when the workspace has never configured an export. */
  target: SiemExportTarget | null;
}

interface SiemExportStatus extends SiemExportSettings {
  last_run_at: string | null;
  last_exported_at: string | null;
  exported_count: number;
  pending_count: number;
  /** `null` = no chain to check yet, not "no gap". See module doc. */
  chain_gap_detected: boolean | null;
}

function targetLabel(t: TFunction, target: SiemExportTarget): string {
  return t(`settings.siemExport.target.${target}`);
}

/** Mirrors both SIEM routes' `minimumRole: 'admin'` — same set `Compliance`/`SsoConnection` use. */
const VIEWER_ROLES = new Set(['admin', 'viceowner', 'owner']);

/** The two things this section writes — on Save, never on a click (GV-06). */
interface SiemDraft {
  enabled: boolean;
  target: SiemExportTarget;
}

export function SiemExport({ canEdit }: { canEdit: boolean }): ReactElement | null {
  const role = useAuth((s) => s.agent?.role ?? null);
  if (role === null || !VIEWER_ROLES.has(role)) return null;

  return <SiemExportCard canEdit={canEdit} />;
}

function SiemExportCard({ canEdit }: { canEdit: boolean }): ReactElement {
  const t = useTranslate();
  const entitlementNote = useEntitlementNote();
  const api = useApiClient();
  const queryClient = useQueryClient();

  const settings = useQuery({
    queryKey: ['settings', 'siem'],
    queryFn: () => api.get<SiemExportSettings>('/settings/siem'),
  });

  const status = useQuery({
    queryKey: ['settings', 'siem', 'status'],
    queryFn: () => api.get<SiemExportStatus>('/settings/siem/status'),
  });

  /** Only what moved — the audit entry names the fields written. */
  async function save(values: SiemDraft): Promise<void> {
    const saved = settings.data!;
    const body: Partial<SiemDraft> = {};
    if (values.enabled !== saved.enabled) body.enabled = values.enabled;
    if (values.target !== (saved.target ?? SIEM_EXPORT_TARGETS[0])) body.target = values.target;
    try {
      const data = await api.patch<SiemExportSettings>('/settings/siem', body);
      queryClient.setQueryData(['settings', 'siem'], data);
      // The delivery position doesn't change here, but `enabled`/`target`
      // shown alongside it must not go stale.
      void queryClient.invalidateQueries({ queryKey: ['settings', 'siem', 'status'] });
    } catch (error) {
      // The plan, not the request, is what refused: say which plan has it.
      if (error instanceof ApiClientError && error.details?.['entitlement'] === 'siem_export') {
        throw entitlementNote('settings.siemExport.entitlementError');
      }
      throw error;
    }
  }

  return (
    <Section
      title={t('settings.siemExport.title')}
      description={t('settings.siemExport.description')}
    >
      {status.data?.chain_gap_detected === true && (
        <Banner tone="danger" role="alert" title={t('settings.siemExport.gapTitle')}>
          {t('settings.siemExport.gapBody')}
        </Banner>
      )}

      {settings.error || status.error ? (
        <ErrorNotice message={t('settings.siemExport.loadError')} />
      ) : (
        <Card>
          {settings.isPending || status.isPending ? (
            <p className="p-4 text-sm text-content-secondary">{t('settings.loading')}</p>
          ) : (
            <div className="divide-y divide-border">
              <SettingsForm<SiemDraft>
                saved={{
                  enabled: settings.data!.enabled,
                  target: settings.data!.target ?? SIEM_EXPORT_TARGETS[0],
                }}
                onSave={save}
                label={t('settings.siemExport.title')}
              >
                {(form) => (
                  <fieldset disabled={!canEdit} className="m-0 divide-y divide-border border-0 p-0">
                    <label className="flex items-center gap-3 p-4">
                      <input
                        type="checkbox"
                        checked={form.values.enabled}
                        onChange={(event) => form.setValue('enabled', event.target.checked)}
                      />
                      <span className="flex-1 text-sm">
                        {t('settings.siemExport.enableLabel')}
                        <span className="block text-2xs text-content-tertiary">
                          {t('settings.siemExport.enableHint')}
                        </span>
                      </span>
                      <StatusDot
                        tone={form.values.enabled ? 'success' : 'neutral'}
                        label={form.values.enabled ? t('settings.on') : t('settings.off')}
                      />
                    </label>

                    <div className="flex flex-wrap items-end gap-3 p-4">
                      <label htmlFor="siem-target" className="flex w-56 flex-col gap-1">
                        <span className="text-2xs font-medium uppercase tracking-wide text-content-tertiary">
                          {t('settings.siemExport.destinationLabel')}
                        </span>
                        <select
                          id="siem-target"
                          value={form.values.target}
                          onChange={(event) =>
                            form.setValue('target', event.target.value as SiemExportTarget)
                          }
                          className="rounded-md border border-border bg-inset px-2 py-1.5 text-sm outline-none disabled:opacity-50"
                        >
                          {SIEM_EXPORT_TARGETS.map((value) => (
                            <option key={value} value={value}>
                              {targetLabel(t, value)}
                            </option>
                          ))}
                        </select>
                      </label>
                    </div>
                  </fieldset>
                )}
              </SettingsForm>

              <div className="grid grid-cols-2 gap-4 p-4 sm:grid-cols-4">
                <StatusFigure
                  label={t('settings.siemExport.lastExport')}
                  value={formatDateTime(status.data!.last_exported_at) ?? t('settings.never')}
                />
                <StatusFigure
                  label={t('settings.siemExport.lastRun')}
                  value={formatDateTime(status.data!.last_run_at) ?? t('settings.never')}
                />
                <StatusFigure
                  label={t('settings.siemExport.delivered')}
                  value={formatCount(status.data!.exported_count) ?? '0'}
                />
                <StatusFigure
                  label={t('settings.siemExport.pending')}
                  value={formatCount(status.data!.pending_count) ?? '0'}
                />
              </div>
            </div>
          )}
        </Card>
      )}
    </Section>
  );
}

function StatusFigure({ label, value }: { label: string; value: string }): ReactElement {
  return (
    <div>
      <p className="text-2xs font-medium uppercase tracking-wide text-content-tertiary">{label}</p>
      <p className="text-sm font-medium">{value}</p>
    </div>
  );
}
