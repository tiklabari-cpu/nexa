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
 *   - use the **form** pattern — `SettingsForm`, `FormSaveBar` (the same bar
 *     bound to a `useForm` draft) or `SaveBar` (the bar carries
 *     `data-save-pattern="form"`);
 *   - use the **instant** pattern — `InstantToggle` (`data-save-pattern="instant"`),
 *     which is for a person's *own* preference only;
 *   - be listed in `EXEMPT` with a reason (a section with no setting of its own to
 *     save — a read-only report, or a list whose rows save one at a time behind
 *     their own button);
 *   - be listed in `PENDING` — the migration queue of tm 323.2, emptied by it.
 *     `PENDING` is a ratchet: a section that now conforms must be removed from
 *     it (red until it is), and nothing new may be added to it.
 *
 * Two more ratchets close what an exemption could otherwise hide (tm 323.2):
 *
 *   - an exempt section that holds a draft of its own (a `useForm` "add" form)
 *     must ask before it is left — `useSettingsLeaveGuard` — so a half-typed
 *     entry does not vanish when another section is clicked;
 *   - no section writes from a change handler (`onChange={… .mutate(…)}`)
 *     outside `InstantToggle`, bar the cases in `INSTANT_WRITES` with a reason.
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

/** Sections with no setting draft of their own to save, and why (tm 323.2). */
const EXEMPT: Readonly<Record<string, string>> = {
  // A list: each row is added by its own form and saved, renamed or removed on
  // its own — there is no section-wide draft for a Save bar to hold.
  Brands:
    'A list of brands: added by its form, renamed in place (Enter / leaving the box), removed with a confirmation.',
  Channels: 'Channel cards: each is connected or disconnected through its own dialog.',
  WebsiteWidgets:
    'A list of websites: added by its form; each row has its own snippet and actions.',
  RoutingRules: 'A list of routing rules: added by its form, edited or removed one row at a time.',
  Skills: 'A list of skills: added by its form, removed one row at a time.',
  TicketRules: 'A list of ticket rules: added by its form, removed one row at a time.',
  CannedResponses:
    'A list of canned replies: added or edited by its form, removed one row at a time.',
  TicketEmailTemplates:
    'A list of e-mail templates: added or edited by its form, removed one row at a time.',
  CustomFieldsSettings:
    'A list of custom fields: added by its form, renamed in place (Enter / leaving the box), removed with a confirmation.',
  PersonalAccessTokens:
    "The person's own API tokens: issued by its form, revoked one at a time behind a confirmation.",
  ScheduledExports:
    'A list of scheduled exports: added by its form, edited in a dialog, removed one row at a time.',
  TrustedDomains: 'A list of trusted domains: added by its form, removed one row at a time.',
  BannedCustomerIps: 'A list of banned addresses: added by its form, removed one row at a time.',
  SsoConnection:
    'SSO connections and SCIM tokens: each added by its form; switching, requiring and removing a connection each ask first.',
  // Nothing to save at all.
  Integrations: 'Read-only: the doors to the integration pages.',
  McpConnection: 'Read-only: the MCP manifest and the values to copy.',
  SensitiveData: 'Read-only: what is masked, built from the policy itself.',
  MyPermissions: "Read-only: the person's own capabilities, from `/auth/me`.",
  // One act, not a setting: confirmed where it is taken, nothing held as a draft.
  Compliance:
    'Accepting the BAA is one irreversible act behind its own confirmation, not a setting.',
  Sandbox:
    'Creating and resetting the sandbox are actions behind their own confirmations, not settings.',
  TwoFactor:
    "The person's own two-factor enrolment: a guided flow of dialogs, each step confirmed by a password or a code.",
};

/**
 * Exempt sections whose `useForm` is not a draft worth guarding, and why.
 */
const NO_DRAFT: Readonly<Record<string, string>> = {
  TwoFactor: 'Its forms are a password or a one-time code inside a dialog — nothing to keep.',
};

/**
 * Change handlers that write at once outside `InstantToggle`, and why. Each is
 * a decision on record, not an oversight — a new one fails until it is here.
 */
const INSTANT_WRITES: Readonly<Record<string, string>> = {
  SsoConnection:
    'Turning "Require SSO" off reopens the password door at once — asymmetric on purpose (S11-h); turning it on asks.',
};

/** Sections not yet moved onto the pattern — tm 323.2 emptied this. Never grows. */
const PENDING: readonly string[] = [];

/**
 * Whether a section renders the shared save pattern: one of its components in
 * JSX, or the marker itself. Rendered, not imported — a list section imports
 * `useSettingsLeaveGuard` from the same module without drawing a bar.
 */
function usesSavePattern(source: string): boolean {
  return (
    /<(?:SettingsForm|FormSaveBar|SaveBar|InstantToggle)\b/.test(source) ||
    /data-save-pattern=["{]/.test(source)
  );
}

/** A draft the section holds — a `useForm` of its own. */
function holdsDraft(source: string): boolean {
  return /\buseForm(?:<[^>]*>)?\(/.test(source);
}

/** Whether a section asks before its draft is left behind. */
function guardsLeaving(source: string): boolean {
  return /\buseSettingsLeaveGuard\(|<FormSaveBar\b|<SettingsForm\b/.test(source);
}

/** A change handler that writes on the spot: `onChange={… .mutate(…)}` within a few lines. */
function writesOnChange(source: string): boolean {
  const lines = source.split('\n');
  return lines.some(
    (line, index) =>
      line.includes('onChange={') &&
      /\.mutate(?:Async)?\(/.test(lines.slice(index, index + 4).join('\n')),
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
    expect(usesSavePattern('<InstantToggle label="Sound" checked onChange={save} />')).toBe(true);
    // Importing the leave guard is not drawing a bar.
    expect(
      usesSavePattern(
        "import { useSettingsLeaveGuard } from '../../components/settings/FormSaveBar.js';",
      ),
    ).toBe(false);
    expect(usesSavePattern('<div data-save-pattern="instant" />')).toBe(true);
    expect(usesSavePattern('<FormSaveBar form={form} />')).toBe(true);
    // A bare checkbox that writes on change is exactly what the pattern forbids.
    expect(
      usesSavePattern(
        '<input type="checkbox" onChange={(e) => mutation.mutate(e.target.checked)} />',
      ),
    ).toBe(false);
    // And the two extra ratchets read what they claim to.
    expect(
      writesOnChange('<input onChange={(e) =>\n  save.mutate({ on: e.target.checked })} />'),
    ).toBe(true);
    expect(writesOnChange('<input onChange={(e) => form.setValue("on", "true")} />')).toBe(false);
    expect(holdsDraft('const form = useForm<Values>({')).toBe(true);
    expect(guardsLeaving('useSettingsLeaveGuard(form.isDirty, form.isSubmitting);')).toBe(true);
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

  it('has emptied the migration queue (tm 323.2)', () => {
    expect(PENDING).toEqual([]);
  });

  it('asks before an exempt section with a draft of its own is left (GV-06)', () => {
    const unguarded = Object.keys(EXEMPT).filter((file) => {
      const source = sourceOf(file);
      return holdsDraft(source) && !guardsLeaving(source) && !(file in NO_DRAFT);
    });
    expect(
      unguarded,
      'these hold a useForm draft but never call useSettingsLeaveGuard — a half-typed entry ' +
        'would vanish without a word when another section is clicked',
    ).toEqual([]);
  });

  it('writes from a change handler only through InstantToggle, or with a reason on record', () => {
    const silent = SECTION_FILES.filter(
      (file) => writesOnChange(sourceOf(file)) && !(file in INSTANT_WRITES),
    );
    expect(
      silent,
      'these write the moment a control changes — move the write behind Save (SettingsForm / ' +
        'FormSaveBar), a confirmation, or InstantToggle for a personal preference',
    ).toEqual([]);
    const stale = Object.keys(INSTANT_WRITES).filter((file) => !writesOnChange(sourceOf(file)));
    expect(stale, 'these no longer write on change — delete them from INSTANT_WRITES').toEqual([]);
  });

  it('removes a section from the migration queue once it conforms', () => {
    const stale = PENDING.filter((file) => usesSavePattern(sourceOf(file)));
    expect(stale, 'these conform now — delete them from PENDING').toEqual([]);
  });

  it('keeps the queue and the exemptions pointing at real sections', () => {
    const real = new Set(SECTION_FILES);
    expect(PENDING.filter((file) => !real.has(file))).toEqual([]);
    expect(Object.keys(EXEMPT).filter((file) => !real.has(file))).toEqual([]);
    expect(Object.keys(INSTANT_WRITES).filter((file) => !real.has(file))).toEqual([]);
    expect(Object.keys(NO_DRAFT).filter((file) => !(file in EXEMPT))).toEqual([]);
    // An exemption is for a section that does not conform; one that does is stale.
    expect(Object.keys(EXEMPT).filter((file) => usesSavePattern(sourceOf(file)))).toEqual([]);
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
