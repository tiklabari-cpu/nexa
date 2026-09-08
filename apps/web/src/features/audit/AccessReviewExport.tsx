/**
 * The access review, downloadable (tm 215 · NFR-C6 · SOC 2 CC6.1).
 *
 * `GET /reports/access-review` has been complete since C6-e — members with
 * their role, standing, 2FA state and last recorded sign-in, plus every live
 * bearer credential with its owner and scopes, in JSON or as a named CSV per
 * section — and no client called it. The evidence a CC6.1 review is supposed to
 * *produce* could only be produced with a token and a terminal, which is not a
 * control an auditor can watch a workspace perform.
 *
 * Here rather than under Reports, and that is the endpoint's own reasoning
 * rather than a layout preference: the route sits under `/reports` but is gated
 * on `audit_log--all:ro` + `minimumRole: admin`, explicitly *not* on
 * `reports_read`, because "`reports_read` is held by every dashboard
 * integration that draws a chart of chat volume". Those are exactly the two
 * gates `AuditLogPage` is already behind, so this is the one screen in the
 * console whose audience is the report's audience.
 *
 * Two buttons and no table. The report is evidence to hand to somebody — it
 * carries its own `generated_at`, its own filename, and a deliberate refusal to
 * judge what it lists (`services/reports/access-review.ts`: no risk score, no
 * "stale — consider revoking"). Rendering it as a screen would invite exactly
 * the summarising the service refuses to do, and would need a second opinion
 * about which columns matter. The CSV is the artefact; this is the door to it.
 */
import { useState, type ReactElement } from 'react';
import { Card, Section } from '../../components/Page.js';
import { errorMessageKey } from '../../lib/api-client.js';
import { useApiClient, useAuth } from '../../lib/auth-store.js';
import { useTranslate } from '../../lib/i18n.js';

/** `minimumRole: 'admin'` on the route; the same courtesy hide `Compliance` uses. */
const VIEWER_ROLES = new Set(['admin', 'viceowner', 'owner']);

type ReviewSection = 'members' | 'credentials';

export function AccessReviewExport(): ReactElement | null {
  const t = useTranslate();
  const api = useApiClient();
  const role = useAuth((s) => s.agent?.role ?? null);
  const [pending, setPending] = useState<ReviewSection | null>(null);
  const [error, setError] = useState<string | null>(null);

  if (role === null || !VIEWER_ROLES.has(role)) return null;

  const download = async (section: ReviewSection): Promise<void> => {
    setPending(section);
    setError(null);
    try {
      const { blob, filename } = await api.getFile(
        `/reports/access-review?format=csv&section=${section}`,
      );
      const url = URL.createObjectURL(blob);
      const link = document.createElement('a');
      link.href = url;
      // The server stamps the file with the section and the day it was
      // generated (`accessReviewFilename`), and that date is part of the
      // evidence — a caller-invented name would drop it.
      link.download = filename ?? `nexa-access-review-${section}.csv`;
      document.body.appendChild(link);
      link.click();
      link.remove();
      URL.revokeObjectURL(url);
    } catch (cause) {
      setError(t(errorMessageKey(cause)));
    } finally {
      setPending(null);
    }
  };

  return (
    <Section
      title={t('audit.accessReview.title')}
      description={t('audit.accessReview.description')}
    >
      <Card>
        <div className="flex flex-col gap-2 p-4">
          <div className="flex flex-wrap items-center gap-2">
            <button
              type="button"
              onClick={() => void download('members')}
              disabled={pending !== null}
              className="rounded-md border border-border px-3 py-1.5 text-sm font-medium text-content-secondary transition-colors hover:bg-surface-2 disabled:opacity-50"
            >
              {pending === 'members'
                ? t('audit.accessReview.downloading')
                : t('audit.accessReview.members')}
            </button>
            <button
              type="button"
              onClick={() => void download('credentials')}
              disabled={pending !== null}
              className="rounded-md border border-border px-3 py-1.5 text-sm font-medium text-content-secondary transition-colors hover:bg-surface-2 disabled:opacity-50"
            >
              {pending === 'credentials'
                ? t('audit.accessReview.downloading')
                : t('audit.accessReview.credentials')}
            </button>
          </div>

          <p className="text-2xs text-content-tertiary">{t('audit.accessReview.note')}</p>

          {error && (
            <p role="alert" className="text-2xs text-danger">
              {error}
            </p>
          )}
        </div>
      </Card>
    </Section>
  );
}
