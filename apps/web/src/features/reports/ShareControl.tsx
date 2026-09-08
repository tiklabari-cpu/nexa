/**
 * Share (FR-MOD-07.3.1) — the "link" half of the Overview header's
 * "Share export/link".
 *
 * Export hands a file to whoever is already signed in. This hands a URL to
 * somebody who is not, so the control's whole job is to make the two ways it can
 * go wrong hard to reach: minting a link nobody remembers, and losing track of
 * one that is still live.
 *
 * Three shapes carry that:
 *
 *   - **The token is shown exactly once**, in a modal that says so, with a copy
 *     button — the `SecretOncePanel` pattern the developer portal already uses
 *     for a client secret, and for the same reason. Closing the modal discards
 *     it from state; nothing here writes it anywhere. Re-opening Share shows the
 *     row, never the token, because the server no longer has it either.
 *   - **The share URL carries the token in the fragment**, `#token=…`, not the
 *     query. A fragment is never sent to a server, so the credential stays out
 *     of the web host's access log and out of `Referer` when the shared page
 *     links anywhere. The API call the shared page then makes uses `?token=`,
 *     which `lib/log-redact.ts` already masks.
 *   - **The list is the inventory**, so revoking is one click from the same
 *     place minting is. A link that has lapsed stays in the list, marked, rather
 *     than vanishing — "why did my link stop working?" has to be answerable.
 *
 * The group is the tab the agent is looking at and the window is the range they
 * have chosen: a share is the view in front of them, not a second set of
 * choices to get wrong.
 */
import { useState, type ReactElement } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type { ReportShareLink, ReportShareLinkCreated } from '@nexa/types';
import { Dropdown, Modal } from '../../components/ui/index.js';
import { useApiClient } from '../../lib/auth-store.js';
import { errorMessageKey } from '../../lib/api-client.js';
import { formatDateTime } from '../../lib/format.js';
import { useTranslate } from '../../lib/i18n.js';

/** The lifetimes the control offers, inside the contract's 1–90 day bound. */
const EXPIRY_CHOICES = [7, 30, 90] as const;

/**
 * The console path the share URL points at, and the fragment key it carries.
 *
 * Exported so `App.tsx` routes the same string this builds — two literals one
 * typo apart would produce links that open the sign-in page.
 */
export const SHARED_REPORT_PATH = '/shared/report';
export const SHARED_REPORT_TOKEN_KEY = 'token';

/**
 * The URL a recipient is given.
 *
 * `#token=` rather than `?token=`: browsers never send a fragment to a server,
 * so the credential cannot land in the web host's access log, in a proxy's, or
 * in a `Referer` header. Built from the console's own origin, so a workspace on
 * a custom host gets a link to that host rather than to whatever the API happens
 * to believe `WEB_ORIGIN` is.
 */
export function shareUrl(origin: string, token: string): string {
  return `${origin}${SHARED_REPORT_PATH}#${SHARED_REPORT_TOKEN_KEY}=${encodeURIComponent(token)}`;
}

/** `formatDateTime` with the raw ISO as the fallback, so a row never renders "null". */
function when(iso: string): string {
  return formatDateTime(iso) ?? iso;
}

export function ShareControl({
  group,
  range,
}: {
  group: string;
  range: { from: string; to: string } | null;
}): ReactElement {
  const t = useTranslate();
  const api = useApiClient();
  const queryClient = useQueryClient();
  const [days, setDays] = useState<number>(EXPIRY_CHOICES[0]);
  const [minted, setMinted] = useState<ReportShareLinkCreated | null>(null);
  const [error, setError] = useState<string | null>(null);

  const links = useQuery({
    queryKey: ['report-share-links'],
    queryFn: () => api.get<{ items: ReportShareLink[] }>('/reports/share-links'),
  });

  const invalidate = (): void => {
    void queryClient.invalidateQueries({ queryKey: ['report-share-links'] });
  };

  const create = useMutation({
    mutationFn: () =>
      api.post<ReportShareLinkCreated>('/reports/share-links', {
        group,
        ...(range ? { from: range.from, to: range.to } : {}),
        expires_in_days: days,
      }),
    onSuccess: (link) => {
      setError(null);
      // The only moment the token exists outside the recipient's URL. Held in
      // state until the modal closes, and nowhere else.
      setMinted(link);
      invalidate();
    },
    // The server's own message, not a generic one: "you may not share this
    // report" and "you already hold 25 links" are different problems with
    // different fixes, and swallowing both would leave the agent clicking.
    onError: (cause) => setError(t(errorMessageKey(cause))),
  });

  const revoke = useMutation({
    mutationFn: (id: string) => api.delete<void>(`/reports/share-links/${id}`),
    onSuccess: () => {
      setError(null);
      invalidate();
    },
    onError: (cause) => setError(t(errorMessageKey(cause))),
  });

  const items = links.data?.items ?? [];

  return (
    <>
      <Dropdown
        label={t('reports.share.ariaLabel')}
        trigger={t('reports.share.trigger')}
        triggerClassName="rounded-md border border-border bg-inset px-2.5 py-1.5 text-xs font-medium text-content-secondary transition-colors hover:text-content"
        panelClassName="right-0 top-full mt-1 w-80 p-2"
      >
        {() => (
          <div className="flex flex-col gap-2">
            <p className="px-1 text-2xs text-content-tertiary">{t('reports.share.description')}</p>

            <div className="flex items-center gap-1.5 border-t border-border pt-2">
              <label
                className="text-2xs font-medium uppercase tracking-wide text-content-tertiary"
                htmlFor="report-share-expiry"
              >
                {t('reports.share.expiresLabel')}
              </label>
              <select
                id="report-share-expiry"
                value={days}
                onChange={(event) => setDays(Number(event.target.value))}
                className="rounded-md border border-border bg-inset px-2 py-1 text-xs text-content"
              >
                {EXPIRY_CHOICES.map((choice) => (
                  <option key={choice} value={choice}>
                    {t('reports.share.expiresDays', { count: String(choice) })}
                  </option>
                ))}
              </select>
              <button
                type="button"
                disabled={!range || create.isPending}
                onClick={() => create.mutate()}
                className="ml-auto rounded-md bg-brand-500 px-2.5 py-1 text-2xs font-medium text-white transition-colors hover:bg-brand-600 disabled:opacity-50"
              >
                {create.isPending ? t('reports.share.creating') : t('reports.share.create')}
              </button>
            </div>

            {items.length > 0 && (
              <ul className="flex flex-col gap-0.5 border-t border-border pt-2">
                {items.map((link) => (
                  <li key={link.id} className="flex items-center gap-2 px-1 py-1">
                    <span className="flex min-w-0 flex-1 flex-col">
                      <span className="truncate text-xs text-content">
                        {t('reports.share.rowGroup', {
                          group: link.group,
                          suffix: link.token_last_four,
                        })}
                      </span>
                      <span className="text-2xs text-content-tertiary">
                        {link.expired
                          ? t('reports.share.rowExpired', { when: when(link.expires_at) })
                          : t('reports.share.rowExpires', { when: when(link.expires_at) })}
                      </span>
                    </span>
                    <button
                      type="button"
                      onClick={() => revoke.mutate(link.id)}
                      aria-label={t('reports.share.revoke', { suffix: link.token_last_four })}
                      className="shrink-0 rounded-md px-1.5 py-1 text-2xs text-content-tertiary transition-colors hover:text-danger"
                    >
                      {t('reports.share.revokeShort')}
                    </button>
                  </li>
                ))}
              </ul>
            )}

            {error && (
              <p role="alert" className="px-1 text-2xs text-danger">
                {error}
              </p>
            )}
          </div>
        )}
      </Dropdown>

      {/* Outside the dropdown on purpose: the panel lives inside a `<details>`
          that stays mounted when closed, so a token rendered in there would
          still be in the DOM after the menu shut. A modal that unmounts is what
          makes "shown once" true rather than merely hidden. */}
      {minted && <ShareLinkOnce link={minted} onClose={() => setMinted(null)} />}
    </>
  );
}

/**
 * The link, once.
 *
 * Same shape as the developer portal's `SecretOncePanel`: the value, a copy
 * button, and an explicit "this will not be shown again". Closing discards it —
 * there is no endpoint that reads it back, because the server stored only a
 * digest.
 */
function ShareLinkOnce({
  link,
  onClose,
}: {
  link: ReportShareLinkCreated;
  onClose: () => void;
}): ReactElement {
  const t = useTranslate();
  const [copied, setCopied] = useState(false);
  const url = shareUrl(window.location.origin, link.token);

  function copy(): void {
    void navigator.clipboard?.writeText(url).then(
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
      title={t('reports.share.onceTitle')}
      description={t('reports.share.onceDescription', { when: when(link.expires_at) })}
      className="w-[30rem]"
    >
      <div className="flex flex-col gap-3">
        <div className="flex items-center gap-2">
          <code
            data-testid="report-share-url"
            className="flex-1 truncate rounded-md border border-border bg-inset px-2 py-1.5 text-2xs"
          >
            {url}
          </code>
          <button
            type="button"
            onClick={copy}
            className="shrink-0 rounded-md bg-brand-500 px-2.5 py-1 text-2xs font-medium text-white transition-colors hover:bg-brand-600"
          >
            {copied ? t('reports.share.copied') : t('reports.share.copy')}
          </button>
        </div>
        <p className="text-2xs text-content-tertiary">{t('reports.share.onceWarning')}</p>
        <button
          type="button"
          onClick={onClose}
          className="self-end rounded-md border border-border px-2.5 py-1 text-2xs font-medium text-content-secondary transition-colors hover:bg-surface-2"
        >
          {t('reports.share.done')}
        </button>
      </div>
    </Modal>
  );
}
