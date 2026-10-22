/**
 * The save-pattern sentinel (tm 323.1 · GV-06).
 *
 * Settings sections used to save three different ways (a box that writes the
 * moment it is ticked, a form that writes on Save, a draft that vanishes when
 * another section is opened). Once the permission matrix lands (RL-02) that
 * inconsistency stops being untidy and becomes a hole: a checkbox that grants
 * access silently. This file is what stops a new section from adding a fourth
 * way.
 *
 * Every section file in `settings-sections.ts` must do exactly one of:
 *
 *   - use the **form** pattern — `SettingsForm` / `SaveBar` (the bar carries
 *     `data-save-pattern="form"`);
 *   - use the **instant** pattern — `InstantToggle` (`data-save-pattern="instant"`),
 *     which is for a person's *own* preference only;
 *   - be listed in `EXEMPT` with a reason (a section with no setting of its own to
 *     save — a read-only report, or a list whose rows save one at a time behind
 *     their own button);
 *   - be listed in `PENDING` — the migration queue of tm 323.2. `PENDING` is a
 *     ratchet: a section that now conforms must be removed from it (red until it
 *     is), and nothing new may be added to it.
 *
 * The scan reads each section's source rather than rendering all 36 against
 * mocked APIs: what is being protected is "this file reaches for the shared
 * pattern", and the rendered half — the markers the two components emit — is
 * pinned below, so a marker rename cannot silently blind the scan.
 */
import { render } from '@testing-library/react';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it, vi } from 'vitest';
import { InstantToggle } from '../../components/settings/InstantToggle.js';
import { SaveBar } from '../../components/settings/SaveBar.js';
import { SettingsForm } from '../../components/settings/SettingsForm.js';
import { SETTINGS_SECTIONS } from './settings-sections.js';

/** Sections with nothing of their own to save, and why. Filled in by tm 323.2. */
const EXEMPT: Readonly<Record<string, string>> = {};

/** Sections not yet moved onto the pattern — tm 323.2 empties this. Never grows. */
const PENDING: readonly string[] = [
  'NotificationSettings',
  'CompanyDetails',
  'Appearance',
  'Brands',
  'Channels',
  'WebsiteWidgets',
  'WidgetCustomization',
  'SalesTracker',
  'RoutingRules',
  'Skills',
  'TicketRules',
  'SlaPolicy',
  'CannedResponses',
  'Tags',
  'ChatTimeout',
  'TicketEmailTemplates',
  'CustomFieldsSettings',
  'ChatFormsSettings',
  'Integrations',
  'McpConnection',
  'PersonalAccessTokens',
  'ScheduledExports',
  'Sandbox',
  'TrustedDomains',
  'BannedCustomerIps',
  'MemberRecognition',
  'FileSharing',
  'SensitiveData',
  'IpAllowlist',
  'SsoConnection',
  'TwoFactor',
  'Compliance',
  'DataRetention',
  'RiskFlagSettings',
  'SiemExport',
  'AiUsage',
];

/** How a section's source reaches for the shared save pattern, if it does. */
function usesSavePattern(source: string): boolean {
  return (
    /from '\.\.\/\.\.\/components\/settings\/(?:SettingsForm|SaveBar|InstantToggle)\.js'/.test(
      source,
    ) || /data-save-pattern=["{]/.test(source)
  );
}

const SECTION_FILES = SETTINGS_SECTIONS.flatMap((section) => (section.file ? [section.file] : []));

function sourceOf(file: string): string {
  return readFileSync(join(process.cwd(), 'src/features/settings', `${file}.tsx`), 'utf8');
}

describe('settings sections follow the save pattern (GV-06)', () => {
  it('knows how to tell a conforming section from one that is not', () => {
    expect(
      usesSavePattern(
        "import { SettingsForm } from '../../components/settings/SettingsForm.js';\n<SettingsForm />",
      ),
    ).toBe(true);
    expect(
      usesSavePattern(
        "import { InstantToggle } from '../../components/settings/InstantToggle.js';",
      ),
    ).toBe(true);
    expect(usesSavePattern('<div data-save-pattern="instant" />')).toBe(true);
    // A bare checkbox that writes on change is exactly what the pattern forbids.
    expect(
      usesSavePattern(
        '<input type="checkbox" onChange={(e) => mutation.mutate(e.target.checked)} />',
      ),
    ).toBe(false);
  });

  it('puts every section on the pattern, an exemption, or the migration queue', () => {
    const unaccounted = SECTION_FILES.filter(
      (file) => !usesSavePattern(sourceOf(file)) && !(file in EXEMPT) && !PENDING.includes(file),
    );
    expect(
      unaccounted,
      'these sections save in their own way — build them on SettingsForm (writes on Save) or ' +
        'InstantToggle (own preference only), or add an EXEMPT entry with a reason',
    ).toEqual([]);
  });

  it('removes a section from the migration queue once it conforms', () => {
    const stale = PENDING.filter((file) => usesSavePattern(sourceOf(file)));
    expect(stale, 'these conform now — delete them from PENDING').toEqual([]);
  });

  it('keeps the queue and the exemptions pointing at real sections', () => {
    const real = new Set(SECTION_FILES);
    expect(PENDING.filter((file) => !real.has(file))).toEqual([]);
    expect(Object.keys(EXEMPT).filter((file) => !real.has(file))).toEqual([]);
    expect(new Set(PENDING).size).toBe(PENDING.length);
    for (const [file, reason] of Object.entries(EXEMPT)) {
      expect(reason.trim().length, `${file} needs a reason`).toBeGreaterThan(10);
      expect(PENDING.includes(file), `${file} is both exempt and pending`).toBe(false);
    }
  });
});

describe('the markers the scan relies on are really rendered (GV-06)', () => {
  it('SettingsForm draws a SaveBar marked as the form pattern', () => {
    const { container } = render(
      <SettingsForm saved={{ a: '1' }} onSave={vi.fn()}>
        {() => <p>fields</p>}
      </SettingsForm>,
    );
    expect(container.querySelectorAll('[data-save-pattern="form"]')).toHaveLength(1);
  });

  it('SaveBar on its own is marked as the form pattern', () => {
    const { container } = render(<SaveBar dirty={false} saving={false} onDiscard={vi.fn()} />);
    expect(container.querySelector('[data-save-pattern="form"]')).not.toBeNull();
  });

  it('InstantToggle is marked as the instant pattern', () => {
    const { container } = render(<InstantToggle label="x" checked={false} onChange={vi.fn()} />);
    expect(container.querySelector('[data-save-pattern="instant"]')).not.toBeNull();
  });
});
