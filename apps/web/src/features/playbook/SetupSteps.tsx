/**
 * What is left before the AI agent can be switched on (tm 390.2).
 *
 * A freshly created agent is off and has nothing to answer with. The readiness
 * rule (`readiness.ts`: indexed knowledge AND an active skill with steps) is
 * already what gates the on switch; this lists its two halves as steps with a
 * door to the tab where each is done, so "why can't I turn it on?" has an
 * answer that is a place to click rather than a sentence to interpret.
 */
import type { ReactElement } from 'react';
import { Card } from '../../components/Page.js';
import { useTranslate } from '../../lib/i18n.js';
import type { Readiness } from './readiness.js';
import type { PlaybookView } from './playbook-tabs.js';

export function SetupSteps({
  readiness,
  canEdit,
  onOpen,
}: {
  readiness: Pick<Readiness, 'hasKnowledge' | 'hasSkill'>;
  canEdit: boolean;
  onOpen: (view: PlaybookView) => void;
}): ReactElement | null {
  const t = useTranslate();
  if (readiness.hasKnowledge && readiness.hasSkill) return null;

  const steps: { done: boolean; labelKey: string; target: PlaybookView }[] = [
    { done: readiness.hasKnowledge, labelKey: 'playbook.setup.knowledge', target: 'knowledge' },
    { done: readiness.hasSkill, labelKey: 'playbook.setup.skill', target: 'skills' },
  ];

  return (
    <Card>
      <section aria-labelledby="setup-steps-title" className="flex flex-col gap-2 p-4">
        <h2 id="setup-steps-title" className="text-sm font-medium">
          {t('playbook.setup.title')}
        </h2>
        <ol className="flex flex-col gap-1.5">
          {steps.map((step) => (
            <li key={step.target} className="flex flex-wrap items-center gap-2 text-sm">
              <span
                aria-hidden="true"
                className={step.done ? 'text-success' : 'text-content-tertiary'}
              >
                {step.done ? '✓' : '○'}
              </span>
              <span className={step.done ? 'text-content-tertiary line-through' : undefined}>
                {t(step.labelKey)}
              </span>
              <span className="sr-only">
                {step.done ? t('playbook.setup.done') : t('playbook.setup.todo')}
              </span>
              {!step.done && canEdit && (
                <button
                  type="button"
                  onClick={() => onOpen(step.target)}
                  className="rounded-md border border-border px-2 py-0.5 text-2xs text-content-secondary transition-colors hover:bg-surface-2"
                >
                  {t('playbook.setup.open')}
                </button>
              )}
            </li>
          ))}
        </ol>
      </section>
    </Card>
  );
}
