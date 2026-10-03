/**
 * The six "Enterprise feature — upgrade the plan" notes in the public pilot
 * (tm 257.15 · ADR docs/adr/pilot-public-readiness.md K-d §3.1): an ordinary
 * deployment keeps each sentence exactly, the pilot swaps all six for the one
 * that names the contact address — in both languages.
 *
 * `useDeployment` is mocked at its one seam, as `AppShell.pilot.test.tsx` does.
 */
import { render, screen } from '@testing-library/react';
import type { DeploymentConfig } from '@siyahtus/types';
import type { ReactElement } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { renderWithLocale, resetLocale } from '../test/i18n.js';
import { useEntitlementNote } from './entitlement-note.js';

const BASE: DeploymentConfig = {
  pilot_mode: false,
  contact_email: null,
  signup_enabled: true,
  email_verification_required: false,
  privacy_policy_url: null,
  terms_url: null,
  terms_version: null,
};
const PILOT: DeploymentConfig = {
  ...BASE,
  pilot_mode: true,
  contact_email: 'pilot-contact@example.test',
};

const deployment = vi.hoisted(() => ({ current: null as unknown as DeploymentConfig }));
vi.mock('./deployment.js', () => ({ useDeployment: () => deployment.current }));

/** The six keys the settings screens route through the hook, with their ordinary English. */
const NOTES: ReadonlyArray<readonly [string, string]> = [
  [
    'settings.widgetCustomization.entitlementError',
    'Removing the SiyahTuş badge is an Enterprise feature. Upgrade the plan to hide it.',
  ],
  [
    'settings.sso.entitlementError',
    'Single sign-on is an Enterprise feature. Upgrade the plan to add a connection.',
  ],
  [
    'settings.compliance.entitlementError',
    'HIPAA cover is an Enterprise feature. Upgrade the plan to accept the agreement.',
  ],
  [
    'settings.siemExport.entitlementError',
    'SIEM export is an Enterprise feature. Upgrade the plan to turn it on.',
  ],
  [
    'settings.sla.entitlementError',
    'SLA targets are an Enterprise feature. Upgrade the plan to save changes here.',
  ],
  [
    'settings.sandbox.entitlementNote',
    'A sandbox is an Enterprise feature. Upgrade the plan to create one.',
  ],
];

function Probe({ noteKey }: { noteKey: string }): ReactElement {
  const note = useEntitlementNote();
  return <p data-testid="note">{note(noteKey)}</p>;
}

beforeEach(() => {
  deployment.current = BASE;
});

afterEach(() => {
  resetLocale();
});

describe('useEntitlementNote (tm 257.15)', () => {
  it.each(NOTES)('keeps %s exactly as it was on an ordinary deployment', (key, english) => {
    render(<Probe noteKey={key} />);
    expect(screen.getByTestId('note')).toHaveTextContent(english);
  });

  it.each(NOTES)('answers %s with the contact variant in the pilot', (key) => {
    deployment.current = PILOT;
    render(<Probe noteKey={key} />);
    expect(screen.getByTestId('note').textContent).toBe(
      'This feature is not available in the pilot — contact pilot-contact@example.test.',
    );
  });

  it('speaks Turkish in the pilot too', () => {
    deployment.current = PILOT;
    renderWithLocale(<Probe noteKey="settings.sso.entitlementError" />, 'tr');
    expect(screen.getByTestId('note').textContent).toBe(
      'Bu özellik pilotta kapalı — pilot-contact@example.test ile iletişime geçin.',
    );
  });

  it('never tells a pilot to upgrade, even with no address configured', () => {
    deployment.current = { ...PILOT, contact_email: null };
    render(<Probe noteKey="settings.sandbox.entitlementNote" />);
    expect(screen.getByTestId('note').textContent).toBe(
      'This feature is not available in the pilot.',
    );
  });
});
