/**
 * "What are you tracking?" — the one-time onboarding survey popover shown on
 * first visit to Reports (FR-MOD-07.2, rapor-1-fonksiyonel.md:1249).
 *
 * Reuses `Modal` rather than a dedicated overlay primitive — there is no
 * second "popover" shape in the design system, and this needs none of
 * Modal's alternatives (a banner cannot ask a question, a tour has no
 * choice to record). Segment: `GET /onboarding/state`'s `survey_answered_at`
 * is null — the same query key `TakeTourBanner.tsx` and `OnboardingWizard.tsx`
 * already read, so an agent who never opens Reports costs the cache nothing
 * extra, and one who does share it exactly.
 *
 * "Tek sefer, atlanabilir" (the KK) is read as: every way out — a submitted
 * choice, the Skip button, Escape or the backdrop — ends the popover for
 * good. Modal already converges Escape/backdrop onto `onClose`, so wiring
 * that to the same skip request as the Skip button (`answer: null`) is one
 * exit path, not four. Because the hide is driven by the mutation's success
 * (not optimistic), a slow or failed request leaves the popover open with an
 * inline error rather than silently discarding the "never ask again" signal.
 * Visibility is a pure function of the cached `['onboarding-state']` query,
 * not separate local state: `onSuccess` writes the mutation's own response
 * straight into that cache, so a remount within the same session (navigate
 * away from Reports and back, no full reload) reads the answered state
 * immediately rather than racing `staleTime` for a refetch.
 *
 * The five options mirror `ONBOARDING_SURVEY_ANSWERS`' PRD order exactly
 * (`@nexa/types`); the personalization payoff — which one of them (if any)
 * moves to the front of the Home checklist — lives server-side in
 * `orderActivationSteps` (`packages/types/src/home.ts`), read by
 * `HomeService#activation`.
 */
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type { ReactElement } from 'react';
import {
  ONBOARDING_SURVEY_ANSWERS,
  type OnboardingState,
  type OnboardingSurveyAnswer,
} from '@nexa/types';
import { useApiClient } from '../../lib/auth-store.js';
import { errorMessageKey } from '../../lib/api-client.js';
import { useTranslate } from '../../lib/i18n.js';
import { Modal } from '../../components/ui/index.js';

export function SurveyPopover(): ReactElement | null {
  const t = useTranslate();
  const api = useApiClient();
  const queryClient = useQueryClient();

  const state = useQuery({
    queryKey: ['onboarding-state'],
    queryFn: () => api.get<OnboardingState>('/onboarding/state'),
    retry: false,
    staleTime: 60_000,
  });

  const answer = useMutation({
    mutationFn: (value: OnboardingSurveyAnswer | null) =>
      api.post<OnboardingState>('/onboarding/survey', { answer: value }),
    onSuccess: (data) => queryClient.setQueryData(['onboarding-state'], data),
  });

  if (!state.data || state.data.survey_answered_at !== null) return null;

  const skip = (): void => answer.mutate(null);

  return (
    <Modal
      onClose={skip}
      title={t('reports.survey.title')}
      description={t('reports.survey.description')}
      className="max-w-sm"
    >
      <div className="flex flex-col gap-2">
        {ONBOARDING_SURVEY_ANSWERS.map((option) => (
          <button
            key={option}
            type="button"
            onClick={() => answer.mutate(option)}
            disabled={answer.isPending}
            className="rounded-md border border-border px-3 py-2 text-left text-sm text-content transition-colors hover:bg-surface-2 disabled:opacity-50"
          >
            {t(`reports.survey.option.${option}`)}
          </button>
        ))}
      </div>

      <div className="mt-4 flex items-center justify-between gap-2">
        {answer.isError && (
          <span role="alert" className="text-2xs text-danger">
            {t(errorMessageKey(answer.error))}
          </span>
        )}
        <button
          type="button"
          onClick={skip}
          disabled={answer.isPending}
          className="ml-auto rounded-md px-2 py-1 text-2xs text-content-secondary underline-offset-2 transition-colors hover:text-content hover:underline disabled:opacity-50"
        >
          {t('reports.survey.skip')}
        </button>
      </div>
    </Modal>
  );
}
