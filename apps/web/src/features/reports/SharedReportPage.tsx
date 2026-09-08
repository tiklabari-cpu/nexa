/**
 * The page a share link opens (FR-MOD-07.3.1).
 *
 * Rendered outside the console shell and outside the signed-in tree: whoever
 * follows a share link has no account, and everything the console assumes —
 * a session, a brand, a nav — is absent by design. What is left is one report
 * group's table over the window the link pinned.
 *
 * **The token is read from the fragment, never the query.** A fragment is not
 * sent to any server, so following the link leaves the credential out of the web
 * host's access log and out of the `Referer` of anything this page loads. It is
 * then handed to the API as `?token=`, the one form `lib/log-redact.ts` already
 * masks — so the credential is invisible on both hops for two different reasons.
 *
 * Every failure is the same message. The API answers one indistinguishable 404
 * for an unknown, expired, revoked or cancelled link (NFR-S5), and this page
 * must not undo that by guessing which happened: "this link is no longer
 * available" is the whole truth a holder is entitled to. A missing token in the
 * URL is the only case worth separating, because the fix is theirs — the link
 * was truncated somewhere.
 *
 * Nothing here offers a way in: no sign-in prompt, no workspace name, no link
 * back into the app. The page is the report, and the report is all a share link
 * grants.
 */
import { type ReactElement } from 'react';
import { useQuery } from '@tanstack/react-query';
import type { SharedReport } from '@nexa/types';
import { ApiClient } from '../../lib/api-client.js';
import { formatDate, formatDateTime } from '../../lib/format.js';
import { useTranslate } from '../../lib/i18n.js';
import { SHARED_REPORT_TOKEN_KEY } from './ShareControl.js';

/**
 * No session, so no bearer token and no brand header — a plain client, exactly
 * as `PublicPages.tsx` builds one for signup and password reset.
 */
const anonymous = new ApiClient();

/**
 * The token out of `#token=…`.
 *
 * Tolerates the bare `#<token>` form as well, because a link that loses its
 * `token=` prefix to a chat client's URL mangling should still open rather than
 * silently reading as "no token". Anything unrecognisable comes back as null and
 * takes the "the link is incomplete" path.
 */
export function tokenFromHash(hash: string): string | null {
  const raw = hash.startsWith('#') ? hash.slice(1) : hash;
  if (!raw) return null;
  const params = new URLSearchParams(raw);
  const named = params.get(SHARED_REPORT_TOKEN_KEY);
  if (named) return named;
  // A single opaque segment with no `=` in it is the whole token.
  return raw.includes('=') ? null : decodeURIComponent(raw);
}

export function SharedReportPage(): ReactElement {
  const t = useTranslate();
  const token = tokenFromHash(window.location.hash);

  const report = useQuery({
    // Keyed on the token so two links opened in one session cannot serve each
    // other's cached table.
    queryKey: ['shared-report', token],
    enabled: token !== null,
    queryFn: () =>
      anonymous.get<SharedReport>(
        `/reports/shared?${SHARED_REPORT_TOKEN_KEY}=${encodeURIComponent(token as string)}`,
      ),
  });

  return (
    <div className="flex min-h-full justify-center bg-canvas px-4 py-10">
      <main className="flex w-full max-w-4xl flex-col gap-4">
        <h1 className="text-lg font-semibold text-content">
          {report.data ? report.data.label : t('reports.shared.title')}
        </h1>

        {token === null ? (
          <p role="alert" className="text-sm text-content-secondary">
            {t('reports.shared.incomplete')}
          </p>
        ) : report.isPending ? (
          <p role="status" className="text-sm text-content-secondary">
            {t('reports.shared.loading')}
          </p>
        ) : report.isError ? (
          // One message for every failure — see the file header. Guessing which
          // miss occurred would undo the uniformity the API deliberately holds.
          <p role="alert" className="text-sm text-content-secondary">
            {t('reports.shared.unavailable')}
          </p>
        ) : (
          <SharedReportTable report={report.data} />
        )}
      </main>
    </div>
  );
}

function SharedReportTable({ report }: { report: SharedReport }): ReactElement {
  const t = useTranslate();
  const range = `${formatDate(report.from) ?? report.from} – ${formatDate(report.to) ?? report.to}`;

  return (
    <>
      <p className="text-sm text-content-secondary">{t('reports.shared.range', { range })}</p>
      <table className="w-full border-collapse text-sm">
        <caption className="sr-only">
          {t('reports.shared.caption', { label: report.label, range })}
        </caption>
        <thead>
          <tr>
            {report.headers.map((header) => (
              <th
                key={header}
                scope="col"
                className="border-b border-border px-3 py-2 text-left text-2xs font-semibold uppercase tracking-wide text-content-tertiary"
              >
                {header}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {report.rows.map((row, index) => (
            // The table is positional and its rows carry no id — the same table
            // the CSV export serialises — so the index is the only stable key,
            // and it is stable because nothing here reorders or filters.
            <tr key={index}>
              {row.map((cell, cellIndex) => (
                <td
                  key={cellIndex}
                  className="border-b border-border px-3 py-2 text-content-secondary"
                >
                  {cell ?? ''}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
      <p className="text-2xs text-content-tertiary">
        {t('reports.shared.generated', {
          when: formatDateTime(report.generated_at) ?? report.generated_at,
        })}
      </p>
      <p className="text-2xs text-content-tertiary">
        {t('reports.shared.expires', {
          when: formatDateTime(report.expires_at) ?? report.expires_at,
        })}
      </p>
    </>
  );
}
