/**
 * One AI configuration told against another (tm 316.4 · AI-20): the draft
 * against the published version ("Değişiklikleri gör"), or one version against
 * another in Versions. A block per section that changed — profile, skills,
 * behaviour rules, guardrails, hand-over, knowledge — with its counts and the
 * items it names: added, removed, changed.
 *
 * The difference names items by key (a skill's id, `rule:<id>`, a knowledge
 * source's id); `names` turns the ones this page knows into their names. A
 * compliance change says so first: only the Founder approves it.
 */
import type { ReactElement } from 'react';
import type { AiConfigDiffKind } from '@siyahtus/types';
import { useTranslate, type TFunction } from '../../lib/i18n.js';
import type { AiConfigDiffSummary } from './ai-config.js';

const KIND_CLASS: Record<AiConfigDiffKind, string> = {
  added: 'text-success',
  removed: 'text-danger',
  changed: 'text-warning',
};

/** The profile's own fields, and the hand-over settings, read by name rather than key. */
const NAMED_KEYS: Record<string, string> = {
  persona: 'playbook.versions.diff.key.persona',
  style: 'playbook.versions.diff.key.style',
  batch_window_seconds: 'playbook.versions.diff.key.batch_window_seconds',
  daily_memory: 'playbook.versions.diff.key.daily_memory',
  clarify_thresholds: 'playbook.versions.diff.key.clarify_thresholds',
  settings: 'playbook.versions.diff.key.settings',
};

const PREFIX_KEYS: Record<string, string> = {
  rule: 'playbook.versions.diff.key.rule',
  route: 'playbook.versions.diff.key.route',
  phrase: 'playbook.versions.diff.key.phrase',
  settings: 'playbook.versions.diff.key.settings',
};

/** An item as a person reads it: its name when the page knows one, else what kind of thing it is. */
export function diffItemLabel(
  key: string,
  names: ReadonlyMap<string, string>,
  t: TFunction,
): string {
  const named = names.get(key);
  if (named) return named;
  const fixed = NAMED_KEYS[key];
  if (fixed) return t(fixed);
  const colon = key.indexOf(':');
  if (colon > 0) {
    const id = key.slice(colon + 1);
    const prefix = PREFIX_KEYS[key.slice(0, colon)];
    const known = names.get(id);
    if (prefix) return `${t(prefix)} · ${known ?? id.slice(0, 8)}`;
  }
  return key.length > 12 ? key.slice(0, 8) : key;
}

export function DiffView({
  diff,
  names = new Map(),
}: {
  diff: AiConfigDiffSummary;
  names?: ReadonlyMap<string, string>;
}): ReactElement {
  const t = useTranslate();
  return (
    <div className="flex flex-col gap-3" data-testid="ai-config-diff">
      <p className="text-sm">
        {t('playbook.versions.diff.changes', { count: diff.changes })}
        {diff.from_baseline && (
          <span className="ml-2 text-2xs text-content-tertiary">
            {t('playbook.versions.diff.fromBaseline')}
          </span>
        )}
      </p>
      {diff.touches_compliance && (
        <p role="note" className="rounded-md bg-warning/10 px-3 py-2 text-2xs text-warning">
          {t('playbook.versions.diff.compliance', {
            reasons: diff.compliance
              .map((reason) => t(`playbook.versions.diff.complianceReason.${reason}`))
              .join(', '),
          })}
        </p>
      )}
      {diff.sections.length === 0 ? (
        <p className="text-2xs text-content-tertiary">{t('playbook.versions.diff.none')}</p>
      ) : (
        diff.sections.map((section) => {
          const shown = section.items.length;
          const total = section.added + section.removed + section.changed;
          return (
            <section
              key={section.section}
              aria-label={t(`playbook.versions.diff.section.${section.section}`)}
              className="rounded-md border border-border"
              data-testid={`ai-config-diff-${section.section}`}
            >
              <header className="flex flex-wrap items-baseline justify-between gap-2 border-b border-border px-3 py-2">
                <p className="text-xs font-semibold">
                  {t(`playbook.versions.diff.section.${section.section}`)}
                </p>
                <p className="text-2xs text-content-tertiary">
                  {t('playbook.versions.diff.counts', {
                    added: section.added,
                    removed: section.removed,
                    changed: section.changed,
                  })}
                </p>
              </header>
              <ul className="flex flex-col divide-y divide-border">
                {section.items.map((item) => (
                  <li key={item.key} className="flex items-baseline gap-2 px-3 py-1.5 text-xs">
                    <span className={`w-20 shrink-0 text-2xs font-medium ${KIND_CLASS[item.kind]}`}>
                      {t(`playbook.versions.diff.kind.${item.kind}`)}
                    </span>
                    <span className="min-w-0 break-words">{diffItemLabel(item.key, names, t)}</span>
                  </li>
                ))}
              </ul>
              {shown < total && (
                <p className="border-t border-border px-3 py-1.5 text-2xs text-content-tertiary">
                  {t('playbook.versions.diff.more', { count: total - shown })}
                </p>
              )}
            </section>
          );
        })
      )}
    </div>
  );
}
