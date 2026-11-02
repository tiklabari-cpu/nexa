/**
 * The install code and how to hand it off — FR-MOD-08.5.2, WG-13 (tm 349).
 *
 * One component for both places the code is shown: Settings → Website widgets
 * and the setup wizard's website step. The snippet text is whatever the server
 * built (`website-service.snippet`); neither screen makes its own copy of it, so
 * the wizard cannot drift from Settings.
 */
import { useState, type ReactElement } from 'react';
import { useInstallGuideUrl } from '../lib/install-guide.js';
import { useTranslate } from '../lib/i18n.js';

/**
 * Documentation only (FR-MOD-13.5, 13.5-g) — shown alongside the install
 * snippet so a developer wiring up the checkout confirmation page sees the
 * call right next to where the widget itself is pasted in. `siyahtus` is the
 * general command surface the loader exposes once pasted above; calling it
 * before the widget has finished loading queues the call rather than losing
 * it.
 */
const TRACK_SALE_EXAMPLE =
  "siyahtus('trackSale', { external_order_id: 'order-123', amount_cents: 4999, currency: 'USD' });";

/**
 * Documentation only (ID-03 · K4 · tm 287.3) — the host page's sign-out. The
 * widget forgets its visitor (localStorage and the `HttpOnly` member cookie)
 * and the returned promise resolves once it has, so the page awaits it before
 * navigating away.
 */
const SIGN_OUT_EXAMPLE = "await siyahtus('logout');";

/**
 * The code to paste, plus the two ways to hand it off: copy it, or mail it to a
 * developer. The mail is composed as a `mailto:` so it is the admin's own mail
 * client that sends it, never us.
 *
 * `compact` leaves out the two developer-facing examples under the code (report
 * a sale, sign a visitor out): the wizard is a first install, and those belong
 * to Settings, where the code can be fetched again at any time.
 */
export function SnippetPanel({
  snippet,
  domain,
  compact = false,
}: {
  snippet: string;
  domain: string;
  compact?: boolean;
}): ReactElement {
  const t = useTranslate();
  const [copied, setCopied] = useState(false);

  const copy = (): void => {
    void navigator.clipboard?.writeText(snippet).then(
      () => {
        setCopied(true);
        window.setTimeout(() => setCopied(false), 1_500);
      },
      () => setCopied(false),
    );
  };

  const mailto = `mailto:?subject=${encodeURIComponent(
    t('settings.websiteWidgets.mailtoSubject', { domain }),
  )}&body=${encodeURIComponent(t('settings.websiteWidgets.mailtoBody', { domain, snippet }))}`;

  return (
    <div className="rounded-md border border-border bg-inset">
      <pre
        data-testid="website-snippet"
        className="overflow-x-auto px-3 py-2 font-mono text-2xs leading-relaxed text-content-secondary"
      >
        {snippet}
      </pre>
      {!compact && (
        <div className="border-t border-border px-3 py-2">
          <p className="text-2xs text-content-tertiary">
            {t('settings.websiteWidgets.snippet.reportSale')}
          </p>
          <pre
            data-testid="website-snippet-track-sale"
            className="mt-1 overflow-x-auto font-mono text-2xs leading-relaxed text-content-secondary"
          >
            {TRACK_SALE_EXAMPLE}
          </pre>
          <p className="mt-2 text-2xs text-content-tertiary">
            {t('settings.websiteWidgets.snippet.signOut')}
          </p>
          <pre
            data-testid="website-snippet-sign-out"
            className="mt-1 overflow-x-auto font-mono text-2xs leading-relaxed text-content-secondary"
          >
            {SIGN_OUT_EXAMPLE}
          </pre>
        </div>
      )}
      <div className="flex items-center gap-2 border-t border-border px-3 py-2">
        <button
          type="button"
          onClick={copy}
          className="rounded-md bg-brand-500 px-2.5 py-1 text-2xs font-medium text-white transition-colors hover:bg-brand-600"
        >
          {copied ? t('settings.copied') : t('settings.websiteWidgets.snippet.copyCode')}
        </button>
        <a
          href={mailto}
          className="rounded-md border border-border px-2.5 py-1 text-2xs text-content-secondary transition-colors hover:bg-surface-2"
        >
          {t('settings.websiteWidgets.snippet.inviteDeveloper')}
        </a>
      </div>
    </div>
  );
}

/**
 * The "Installation guide" link (WG-15). It opens in a new tab so the wizard —
 * which sends every other route back to itself until setup is finished — is
 * still there when the reader returns.
 */
export function InstallGuideLink({ className }: { className?: string }): ReactElement {
  const t = useTranslate();
  const href = useInstallGuideUrl();
  return (
    <a
      href={href}
      target="_blank"
      rel="noopener noreferrer"
      className={
        className ??
        'rounded-md border border-border px-2 py-1 text-2xs text-content-secondary transition-colors hover:bg-surface-2'
      }
    >
      {t('settings.websiteWidgets.installGuide')}
    </a>
  );
}
