/**
 * Tour — a short stepped walkthrough, one step at a time (FR-MOD-02.2.3).
 *
 * Reuses `Modal` rather than a spotlight/tooltip library: each step is its own
 * centred dialog, and the index bookkeeping is the same `useStepper` the
 * onboarding wizard already uses (FR-EK-A.2) — Back and Next cannot walk past
 * either end. A tour keeps no server state of its own, so every way out
 * (Skip, Escape, the backdrop, or finishing the last step) resolves through
 * the same `onClose` — a caller that wants "seen once" persistence (a banner's
 * dismiss, say) does that itself, exactly the way it already does for Banner.
 */
import type { ReactElement, ReactNode } from 'react';
import { useTranslate } from '../lib/i18n.js';
import { useStepper } from '../lib/stepper.js';
import { Modal } from './ui/index.js';

export interface TourStep {
  title: ReactNode;
  body: ReactNode;
}

interface TourProps {
  steps: readonly TourStep[];
  onClose: () => void;
}

export function Tour({ steps, onClose }: TourProps): ReactElement {
  const t = useTranslate();
  const stepper = useStepper(steps.length);
  const step = steps[stepper.index]!;

  return (
    <Modal onClose={onClose} title={step.title} className="max-w-sm">
      <div className="text-sm text-content-secondary">{step.body}</div>

      <div className="mt-5 flex items-center justify-between">
        <div className="flex items-center gap-1" aria-hidden="true">
          {steps.map((_, index) => (
            <span
              key={index}
              className={`h-1.5 w-1.5 rounded-full ${
                index === stepper.index ? 'bg-brand-500' : 'bg-border'
              }`}
            />
          ))}
        </div>
        <p className="text-2xs text-content-tertiary" aria-live="polite">
          {t('common.actions.tourProgress', { current: stepper.current, count: stepper.count })}
        </p>
      </div>

      <div className="mt-4 flex items-center justify-between gap-2">
        <button
          type="button"
          onClick={onClose}
          className="rounded-md px-3 py-1.5 text-sm text-content-secondary hover:bg-surface-2"
        >
          {t('common.actions.tourSkip')}
        </button>
        <div className="flex items-center gap-2">
          {!stepper.isFirst && (
            <button
              type="button"
              onClick={stepper.back}
              className="rounded-md border border-border px-3 py-1.5 text-sm text-content-secondary hover:bg-surface-2"
            >
              {t('common.actions.tourBack')}
            </button>
          )}
          <button
            type="button"
            onClick={() => (stepper.isLast ? onClose() : stepper.next())}
            className="rounded-md bg-brand-500 px-3 py-1.5 text-sm font-medium text-white transition-colors hover:bg-brand-600"
          >
            {stepper.isLast ? t('common.actions.tourDone') : t('common.actions.tourNext')}
          </button>
        </div>
      </div>
    </Modal>
  );
}
