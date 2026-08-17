/**
 * Settings → Security: data region + HIPAA/BAA status (C4-f).
 *
 * A pure consumer of two endpoints C4-d already built and owns:
 * `GET /settings/compliance` and `POST /settings/compliance/baa`
 * (`exactRole: 'owner'`). This screen opens no new server surface — the
 * region display, the BAA state and who may accept it are all the server's
 * word; this only shows what it said and calls it with the right shape.
 * Section layout follows `IpAllowlist.tsx`; the role gate follows
 * `SsoConnection.tsx`, whose two read routes carry the same
 * `minimumRole: 'admin'` `GET /settings/compliance` does.
 */
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type { ReactElement } from 'react';
import { Card, ErrorNotice, Section } from '../../components/Page.js';
import { StatusDot } from '../../components/StatusDot.js';
import { ApiClientError } from '../../lib/api-client.js';
import { useApiClient, useAuth } from '../../lib/auth-store.js';
import { formatDate } from '../../lib/format.js';
import type { Region } from '@nexa/types';

interface ComplianceSettings {
  region: Region;
  baa_available: boolean;
  hipaa_baa_signed_at: string | null;
}

const REGION_LABELS: Record<Region, string> = {
  eu: 'European Union',
  us: 'United States',
};

/**
 * Mirrors the server's `minimumRole: 'admin'` gate on `GET
 * /settings/compliance` (`routes/settings.ts`) — the same courtesy hide
 * `AuditLog` and `SsoConnection` use: whoever cannot read this is not shown a
 * door that only leads to a 403. The route itself stays the real boundary.
 */
const VIEWER_ROLES = new Set(['admin', 'viceowner', 'owner']);

export function Compliance({ canEdit }: { canEdit: boolean }): ReactElement | null {
  const role = useAuth((s) => s.agent?.role ?? null);
  if (role === null || !VIEWER_ROLES.has(role)) return null;

  // Acceptance is `exactRole: 'owner'` server-side — strictly above the read
  // gate above, and deliberately so (POST /settings/compliance/baa's
  // description: an admin cannot commit the organisation to HIPAA cover on
  // its behalf). `admin`/`viceowner` still read this card, just never the
  // button.
  const isOwner = role === 'owner';

  return <ComplianceCard canAccept={canEdit && isOwner} restricted={canEdit && !isOwner} />;
}

function ComplianceCard({
  canAccept,
  restricted,
}: {
  canAccept: boolean;
  /** Scope allows writing but the role does not — explain the missing button, not just omit it. */
  restricted: boolean;
}): ReactElement {
  const api = useApiClient();
  const queryClient = useQueryClient();

  const settings = useQuery({
    queryKey: ['settings', 'compliance'],
    queryFn: () => api.get<ComplianceSettings>('/settings/compliance'),
  });

  const accept = useMutation({
    mutationFn: () => api.post<ComplianceSettings>('/settings/compliance/baa', { accepted: true }),
    onSuccess: (data) => queryClient.setQueryData(['settings', 'compliance'], data),
  });

  return (
    <Section
      title="Data region and compliance"
      description="Where this workspace's data lives, and its HIPAA Business Associate Agreement status."
    >
      {settings.error ? (
        <ErrorNotice message="Could not load compliance settings." />
      ) : (
        <Card>
          {settings.isPending ? (
            <p className="p-4 text-sm text-content-secondary">Loading…</p>
          ) : (
            <div className="flex flex-col gap-4 p-4">
              <div>
                <p className="text-sm font-medium">Data region</p>
                <p className="text-sm text-content-secondary">
                  {REGION_LABELS[settings.data!.region]}
                </p>
                <p className="text-2xs text-content-tertiary">
                  Fixed at signup — a workspace's region can never be changed.
                </p>
              </div>

              <div>
                <p className="flex items-center gap-2 text-sm font-medium">
                  HIPAA Business Associate Agreement
                  <StatusDot
                    tone={settings.data!.hipaa_baa_signed_at ? 'success' : 'neutral'}
                    label={settings.data!.hipaa_baa_signed_at ? 'Signed' : 'Not signed'}
                  />
                </p>

                {settings.data!.hipaa_baa_signed_at ? (
                  <p className="text-sm text-content-secondary">
                    Accepted {formatDate(settings.data!.hipaa_baa_signed_at)}.
                  </p>
                ) : !settings.data!.baa_available ? (
                  <p className="text-2xs text-content-tertiary">
                    HIPAA cover is only available to workspaces hosted in the United States.
                  </p>
                ) : restricted ? (
                  <p className="text-2xs text-content-tertiary">
                    Only the workspace owner can accept the BAA.
                  </p>
                ) : canAccept ? (
                  <div className="mt-1 flex flex-col gap-2">
                    <button
                      type="button"
                      onClick={() => accept.mutate()}
                      disabled={accept.isPending}
                      className="self-start rounded-md bg-brand-500 px-3 py-1.5 text-sm font-medium text-white transition-colors hover:bg-brand-600 disabled:opacity-50"
                    >
                      {accept.isPending ? 'Accepting…' : 'Accept the BAA'}
                    </button>
                    {accept.isError && (
                      <p role="alert" className="text-2xs text-danger">
                        {accept.error instanceof ApiClientError
                          ? accept.error.message
                          : 'Could not accept the agreement.'}
                      </p>
                    )}
                  </div>
                ) : null}
              </div>
            </div>
          )}
        </Card>
      )}
    </Section>
  );
}
