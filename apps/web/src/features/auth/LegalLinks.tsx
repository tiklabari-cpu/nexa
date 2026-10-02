/**
 * The deployment's privacy policy and terms of service, linked under every
 * screen someone sees before they have a session (tm 257.9 · ADR
 * docs/adr/pilot-public-readiness.md K-f).
 *
 * The addresses come from `GET /deployment` — the texts are the owner's, not
 * this repository's — and each link is drawn only when its address is set, so
 * a deployment that names neither shows nothing (dev, the demo, e2e).
 *
 * Its own line, never inside a `<label>`: label text becomes the field's
 * accessible name. Underlined for good, not on hover: links in a run of text
 * must be told apart without colour (axe `link-in-text-block`).
 */
import type { ReactElement } from 'react';
import { useDeployment } from '../../lib/deployment.js';
import { useTranslate } from '../../lib/i18n.js';

/** Opens the document in a new tab, so a half-filled form is not lost. */
export function LegalLink({ href, children }: { href: string; children: string }): ReactElement {
  return (
    <a
      href={href}
      target="_blank"
      rel="noopener noreferrer"
      className="text-content-brand underline"
    >
      {children}
    </a>
  );
}

export function LegalLinks({ className = 'mt-2' }: { className?: string }): ReactElement | null {
  const t = useTranslate();
  const { privacy_policy_url: privacyUrl, terms_url: termsUrl } = useDeployment();
  if (!privacyUrl && !termsUrl) return null;

  return (
    <p className={`${className} text-center text-xs text-content-secondary`}>
      {termsUrl && <LegalLink href={termsUrl}>{t('auth.legal.terms')}</LegalLink>}
      {termsUrl && privacyUrl && <span aria-hidden="true"> · </span>}
      {privacyUrl && <LegalLink href={privacyUrl}>{t('auth.legal.privacy')}</LegalLink>}
    </p>
  );
}
