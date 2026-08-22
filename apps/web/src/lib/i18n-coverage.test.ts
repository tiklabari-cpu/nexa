/**
 * The i18n sentinel (NFR-I18N2, §D113/K7).
 *
 * The console was declared translated once before, on the strength of a
 * language switcher that relabelled the rail and nothing else: 2 of 74 screen
 * files ever called `t()`, and every page body underneath stayed English in
 * both languages. Nothing failed, because nothing was watching. This file is
 * what watches.
 *
 * It is a ratchet rather than a pass/fail wall, because thirteen tasks
 * (I18N-b … I18N-m) translate the console one area at a time and a wall would
 * be red for all of them. What it refuses is *regression*:
 *
 *  - a new untranslated screen file (the remaining count may fall, never rise);
 *  - a file that calls `t()` but was never registered — translated work no
 *    heuristic is checking, and whose size nobody can see;
 *  - a registered file that stopped calling `t()`, or that grew back an English
 *    sentence in its markup, or that renders a server error message raw;
 *  - a key filed in the wrong namespace, or present in one locale only.
 *
 * The prose check is a heuristic and says so: `// i18n-ignore` on the line (or
 * the line above) is how a real false positive is answered, and the comment
 * should say why.
 */
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative, sep } from 'node:path';
import { describe, expect, it } from 'vitest';
import { ERROR_TYPES } from '@nexa/types';
import { NAMESPACES, NAMESPACE_PREFIXES, NAMESPACED_CATALOGUES } from '../locales/index.js';

/**
 * Directories whose `.tsx` files are user-facing screens.
 *
 * `components/` is in as well as `features/`: the shell and the command palette
 * live there, they are the two files already translated, and a rule that could
 * not see them could not check them either.
 */
const SCREEN_ROOTS = ['src/features', 'src/components'];

/**
 * The files whose translation is claimed — and therefore checked.
 *
 * Each I18N task adds its own files here as it finishes them, and lowers
 * `REMAINING_BUDGET` by the same number. Registering a file is the act that
 * switches the heuristics below on for it, so this list is the honest measure of
 * how much of the console is actually translated.
 */
const TRANSLATED_FILES: readonly string[] = [
  'src/components/AppShell.tsx',
  'src/components/CommandPalette.tsx',
  'src/components/PresenceAvatars.tsx',
  'src/features/auth/AuthCallbackPage.tsx',
  'src/features/auth/PublicPages.tsx',
  'src/features/auth/SignInPage.tsx',
  'src/features/onboarding/OnboardingWizard.tsx',
  'src/features/inbox/Attachment.tsx',
  'src/features/inbox/Composer.tsx',
  'src/features/inbox/ConflictBanner.tsx',
  'src/features/inbox/CopilotPanel.tsx',
  'src/features/inbox/CreateTicketButton.tsx',
  'src/features/inbox/DetailsPanel.tsx',
  'src/features/inbox/InboxPage.tsx',
  'src/features/inbox/TicketGrid.tsx',
  'src/features/inbox/TicketPane.tsx',
  'src/features/inbox/Transcript.tsx',
  'src/features/inbox/TypingIndicator.tsx',
  'src/features/customers/CustomersPage.tsx',
  'src/features/customers/CustomerDetailPanel.tsx',
  'src/features/customers/CustomersTabs.tsx',
  'src/features/custom-fields/CustomFields.tsx',
  'src/features/traffic/TrafficPage.tsx',
  'src/features/traffic/TrafficFilters.tsx',
  'src/features/campaigns/CampaignsPage.tsx',
  'src/features/campaigns/CampaignBuilder.tsx',
  'src/features/goals/GoalsPage.tsx',
  'src/features/goals/GoalBuilder.tsx',
  'src/features/goals/GoalsFunnel.tsx',
  'src/features/team/TeamPage.tsx',
  'src/features/team/WorkSchedule.tsx',
  'src/features/team/InviteTeammates.tsx',
  'src/features/team/AgentSkills.tsx',
  'src/features/team/RoleMenu.tsx',
  'src/features/home/HomePage.tsx',
  'src/features/settings/CannedResponses.tsx',
  'src/features/settings/Channels.tsx',
  'src/features/settings/ChatTimeout.tsx',
  'src/features/settings/CustomFieldsSettings.tsx',
  'src/features/developers/DeveloperPortal.tsx',
  'src/features/developers/WebhookSubscriptions.tsx',
  'src/features/settings/Integrations.tsx',
  'src/features/settings/NotificationSettings.tsx',
  'src/features/settings/ChatFormsSettings.tsx',
  'src/features/settings/Tags.tsx',
  'src/features/settings/TicketEmailTemplates.tsx',
  'src/features/settings/TrustedDomains.tsx',
  'src/features/settings/WebsiteWidgets.tsx',
  'src/features/reports/ReportsPage.tsx',
  'src/features/billing/BillingPage.tsx',
  'src/features/playbook/PlaybookPage.tsx',
  'src/features/playbook/SkillEditor.tsx',
  'src/features/playbook/TemplateGallery.tsx',
  'src/features/playbook/RecommendedSkills.tsx',
  'src/features/playbook/ProfileForm.tsx',
  'src/features/playbook/AiPerformance.tsx',
  'src/features/playbook/BulkImportForm.tsx',
  'src/features/playbook/BulkImportResults.tsx',
  'src/features/playbook/KbArticleList.tsx',
  'src/features/playbook/KbArticleEditor.tsx',
  'src/features/apps/AppsMarketplace.tsx',
  'src/features/audit/AuditLogPage.tsx',
  'src/features/settings/AuditLog.tsx',
  'src/features/settings/BannedCustomerIps.tsx',
  'src/features/settings/Brands.tsx',
  'src/features/settings/Compliance.tsx',
  'src/features/settings/FileSharing.tsx',
  'src/features/settings/IpAllowlist.tsx',
  'src/features/settings/McpConnection.tsx',
  'src/features/settings/RoutingRules.tsx',
  'src/features/settings/SalesTracker.tsx',
  'src/features/settings/Sandbox.tsx',
  'src/features/settings/ScheduledExports.tsx',
  'src/features/settings/SettingsPage.tsx',
  'src/features/settings/SiemExport.tsx',
  'src/features/settings/Skills.tsx',
  'src/features/settings/SlaPolicy.tsx',
  'src/features/settings/SsoConnection.tsx',
  'src/features/settings/TicketRules.tsx',
  'src/features/settings/WidgetCustomization.tsx',
  'src/features/team/CopilotKnowledge.tsx',
  'src/features/team/TeamAiPerformance.tsx',
  'src/components/ui/Banner.tsx',
  'src/components/ui/Panel.tsx',
];

/**
 * Screen files that carry no user-facing text of their own (I18N-l, tm 133.12).
 *
 * The budget below could only ever reach zero if every screen file were either
 * translated or accounted for, and nine of them cannot be translated because
 * there is nothing in them to translate: the design-system primitives take every
 * word they render from a caller (`<EmptyState title={t(…)} />`). Registering
 * them as translated would be a lie the file above already refuses — a
 * registered file must call `t()` — so they are claimed here instead, and the
 * claim is checked: a primitive that grows a sentence, or hard-codes the default
 * of a label-shaped prop the way `Banner` and `Panel` did until this task, fails
 * the tests below and has to move up into `TRANSLATED_FILES`.
 */
const TEXT_FREE_FILES: readonly string[] = [
  'src/components/EmptyState.tsx',
  'src/components/Page.tsx',
  'src/components/Skeleton.tsx',
  'src/components/StatusDot.tsx',
  'src/components/VirtualList.tsx',
  'src/components/ui/Dropdown.tsx',
  'src/components/ui/Modal.tsx',
];

/**
 * How many screen files are still untranslated. Measured, not guessed — lower it
 * when you translate files, and never raise it. A new untranslated screen fails
 * here, which is the point: the debt has to be paid down, not added to.
 *
 * It reached **zero** in I18N-l (tm 133.12), which turns the ratchet into the
 * wall it could not be while thirteen tasks were still landing: from here every
 * screen file is either translated or proven text-free, and a new untranslated
 * one is a failure on the commit that adds it rather than a number someone has
 * to notice drifting.
 */
const REMAINING_BUDGET = 0;

/** Every `.tsx` under the screen roots that is not a test, repo-relative and posix-slashed. */
function screenFiles(): string[] {
  const found: string[] = [];
  for (const root of SCREEN_ROOTS) walk(join(process.cwd(), root), found);
  return found
    .filter((file) => file.endsWith('.tsx') && !file.endsWith('.test.tsx'))
    .map((file) => relative(process.cwd(), file).split(sep).join('/'))
    .sort();
}

function walk(dir: string, into: string[]): void {
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) walk(full, into);
    else into.push(full);
  }
}

function read(file: string): string {
  return readFileSync(join(process.cwd(), file), 'utf8');
}

/** Whether the file asks `t()` for anything at all. */
function callsTranslate(source: string): boolean {
  return /\bt\(\s*['"`]/.test(source) || /\buseTranslate\(/.test(source);
}

/** Lines carrying an explicit waiver, plus the line after (a comment above the code). */
function waivedLines(source: string): Set<number> {
  const waived = new Set<number>();
  source.split('\n').forEach((line, index) => {
    if (line.includes('i18n-ignore')) {
      waived.add(index + 1);
      waived.add(index + 2);
    }
  });
  return waived;
}

function lineOf(source: string, index: number): number {
  return source.slice(0, index).split('\n').length;
}

/**
 * Blank out comments, keeping every byte's line number where it was.
 *
 * This file's own house style writes long JSDoc that quotes JSX — "`<details>`'s
 * children are not hidden" — and a scanner that reads comments finds English
 * prose between a `>` and a `<` in every one of them. That is noise the eleven
 * remaining translation tasks would each have to wave off by hand, so the
 * comments come out before the prose check goes in.
 *
 * `//` is only treated as a comment when it is not preceded by `:`, so the `//`
 * in a URL survives; the trailing text is not prose anyway.
 */
function stripComments(source: string): string {
  const blank = (text: string): string => text.replace(/[^\n]/g, ' ');
  return source
    .replace(/\/\*[\s\S]*?\*\//g, blank)
    .replace(
      /(^|[^:])\/\/[^\n]*/g,
      (whole, lead: string) => lead + blank(whole.slice(lead.length)),
    );
}

/**
 * Plain-text JSX children that read like an English sentence.
 *
 * Matches the text between a `>` and the next `<` with no `{`, `}`, `<` or `>`
 * in between — which excludes almost all expression syntax, since JS that long
 * without a brace is rare. Three words or more, at least one lowercase letter,
 * and no `=` or `;`: shorter runs are labels a screen legitimately shares
 * between languages ("CSV", "ID", "⌘K"), and code-shaped text is not prose.
 */
function englishProse(original: string): { line: number; text: string }[] {
  const waived = waivedLines(original);
  const source = stripComments(original);
  const hits: { line: number; text: string }[] = [];

  for (const match of source.matchAll(/>([^<>{}]+)</g)) {
    const text = match[1]!.replace(/\s+/g, ' ').trim();
    if (!text || /[=;]/.test(text)) continue;
    if (!/[a-z]/.test(text)) continue;

    const words = text.split(' ').filter((word) => /[A-Za-z]/.test(word));
    if (words.length < 3) continue;

    const line = lineOf(source, match.index + 1);
    if (waived.has(line)) continue;
    hits.push({ line, text });
  }
  return hits;
}

/** `error.message` and friends reaching the screen without passing the catalogue. */
function rawServerMessages(original: string): number[] {
  const waived = waivedLines(original);
  // Comments out, or a note *explaining* why the server message is not shown
  // would itself be reported as showing it.
  const source = stripComments(original);
  const lines: number[] = [];
  for (const match of source.matchAll(/\b(?:error|err|e|cause|failure|reason)\.message\b/g)) {
    const line = lineOf(source, match.index);
    if (!waived.has(line)) lines.push(line);
  }
  return lines;
}

const SCREENS = screenFiles();
const REGISTERED = new Set(TRANSLATED_FILES);
const TEXT_FREE = new Set(TEXT_FREE_FILES);

/**
 * A string literal handed to an attribute a user can read or hear.
 *
 * `className` and friends are deliberately not in the list: the point is text
 * that reaches a person, not every literal in the file.
 */
const LITERAL_LABEL_ATTRIBUTE =
  /\b(?:aria-label|aria-description|title|placeholder|alt|label|caption)\s*=\s*(?:["'`]|\{\s*["'`])/g;

/** A label-shaped prop given a hard-coded default in a destructuring pattern. */
const LITERAL_LABEL_DEFAULT =
  /\b\w*(?:Label|Title|Text|Description|Placeholder|Caption)\s*=\s*["'`]/g;

function keysOf(locale: 'en' | 'tr'): string[] {
  return NAMESPACES.flatMap((namespace) => Object.keys(NAMESPACED_CATALOGUES[locale][namespace]));
}

describe('catalogue layout', () => {
  it('ships the same namespace files in every locale', () => {
    for (const [locale, namespaces] of Object.entries(NAMESPACED_CATALOGUES)) {
      expect(Object.keys(namespaces).sort(), `locale ${locale} is missing a namespace`).toEqual([
        ...NAMESPACES,
      ]);
    }
  });

  it('files every key under the namespace that owns its prefix', () => {
    const misfiled: string[] = [];
    for (const [locale, namespaces] of Object.entries(NAMESPACED_CATALOGUES)) {
      for (const namespace of NAMESPACES) {
        const prefixes = NAMESPACE_PREFIXES[namespace];
        for (const key of Object.keys(namespaces[namespace])) {
          if (!prefixes.some((prefix) => key.startsWith(prefix))) {
            misfiled.push(`${locale}/${namespace}.ts: ${key}`);
          }
        }
      }
    }
    expect(misfiled, 'keys filed under a namespace that does not own their prefix').toEqual([]);
  });

  it('carries the identical key set in English and Turkish', () => {
    const en = new Set(keysOf('en'));
    const tr = new Set(keysOf('tr'));

    // Turkish missing a key silently shows English — that fallback is deliberate
    // and load-bearing at runtime, which is exactly why it needs a test here: a
    // silent fallback nobody measures is how "translated" gets claimed.
    expect([...en].filter((key) => !tr.has(key)).sort(), 'en keys with no Turkish').toEqual([]);
    // English missing one is worse: `en` is the fallback, so the key resolves to
    // itself and a developer string reaches the screen.
    expect([...tr].filter((key) => !en.has(key)).sort(), 'tr keys en does not define').toEqual([]);
  });

  it('answers every ADR-06 error type with a sentence, and invents none', () => {
    const expected = [...ERROR_TYPES, 'network', 'unknown']
      .map((type) => `common.errors.${type}`)
      .sort();
    for (const locale of ['en', 'tr'] as const) {
      const actual = Object.keys(NAMESPACED_CATALOGUES[locale].common)
        .filter((key) => key.startsWith('common.errors.'))
        .sort();
      expect(actual, `${locale} error catalogue is out of step with ERROR_TYPES`).toEqual(expected);
    }
  });
});

describe('screen coverage', () => {
  it('registers every file that already calls t()', () => {
    const unregistered = SCREENS.filter(
      (file) => !REGISTERED.has(file) && callsTranslate(read(file)),
    );
    expect(
      unregistered,
      'these call t() but are not in TRANSLATED_FILES — add them and lower REMAINING_BUDGET',
    ).toEqual([]);
  });

  it('holds every registered file to the catalogue', () => {
    const silent = TRANSLATED_FILES.filter((file) => !callsTranslate(read(file)));
    expect(silent, 'registered as translated but never calls t()').toEqual([]);
  });

  it('leaves no English sentence in a registered file’s markup', () => {
    const offenders: string[] = [];
    for (const file of TRANSLATED_FILES) {
      for (const hit of englishProse(read(file))) {
        offenders.push(`${file}:${hit.line} — ${hit.text}`);
      }
    }
    expect(
      offenders,
      'untranslated prose in markup; if the heuristic is wrong, say why with // i18n-ignore',
    ).toEqual([]);
  });

  it('never shows a registered file the server’s own error wording', () => {
    const offenders: string[] = [];
    for (const file of TRANSLATED_FILES) {
      for (const line of rawServerMessages(read(file))) {
        offenders.push(`${file}:${line}`);
      }
    }
    expect(
      offenders,
      'server error message used directly — resolve errorMessageKey(error) through t() instead',
    ).toEqual([]);
  });

  it('names no file twice and no file that is gone', () => {
    const claimed = [...TRANSLATED_FILES, ...TEXT_FREE_FILES];
    const duplicated = claimed.filter((file, index) => claimed.indexOf(file) !== index);
    expect(duplicated, 'claimed both translated and text-free').toEqual([]);

    const onDisk = new Set(SCREENS);
    expect(
      claimed.filter((file) => !onDisk.has(file)).sort(),
      'claimed but no longer a screen file — delete the entry',
    ).toEqual([]);
  });

  it('lets no user-facing text into a file claimed text-free', () => {
    const offenders: string[] = [];
    for (const file of TEXT_FREE_FILES) {
      const original = read(file);
      const source = stripComments(original);
      const waived = waivedLines(original);

      for (const hit of englishProse(original)) {
        offenders.push(`${file}:${hit.line} — prose: ${hit.text}`);
      }
      for (const pattern of [LITERAL_LABEL_ATTRIBUTE, LITERAL_LABEL_DEFAULT]) {
        for (const match of source.matchAll(pattern)) {
          const line = lineOf(source, match.index);
          if (!waived.has(line)) offenders.push(`${file}:${line} — literal: ${match[0].trim()}`);
        }
      }
    }
    expect(
      offenders,
      'a primitive claimed text-free now ships words of its own — translate it and register it',
    ).toEqual([]);
  });

  it('reports how much of the console is still untranslated', () => {
    const remaining = SCREENS.filter((file) => !REGISTERED.has(file) && !TEXT_FREE.has(file));

    // The one line this suite prints. The number is the point of the whole file:
    // "the console is translated" is a claim, and this is its measurement.
    console.warn(
      `[i18n] ${remaining.length}/${SCREENS.length} console files not translated yet ` +
        `(budget ${REMAINING_BUDGET}); ${TRANSLATED_FILES.length} registered, ` +
        `${TEXT_FREE_FILES.length} text-free.`,
    );

    expect(
      remaining.length,
      `untranslated screens grew past the budget:\n${remaining.join('\n')}`,
    ).toBeLessThanOrEqual(REMAINING_BUDGET);
  });
});
