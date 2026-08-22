/**
 * "Take tour" — a one-time promo above the Inbox for a newly onboarded
 * account (FR-MOD-01.4, 02.2.3).
 *
 * Segment: the licence finished (or skipped) the first-run wizard within the
 * last 7 days — `completed_at` from `GET /onboarding/state`, the same query
 * key `OnboardingWizard.tsx` reads, so an agent who never goes near onboarding
 * costs this banner no extra request once that cache is warm, and one who
 * does share it exactly. An older workspace with no `completed_at` (onboarding
 * predates the field — see `App.tsx`'s own comment on that gap) never sees it.
 *
 * "Tek sefer" (02.2.3's own KK) is read as: the offer is used up the moment it
 * is taken, not only when it is explicitly dismissed. Opening the tour persists
 * the same `localStorage` key Banner's own dismiss button would
 * (`bannerDismissKey`), so a person who steps through the tour — or backs out
 * of it early — never sees the banner again; the manual "×" gives up on the
 * offer without ever opening it, and lands on the same persisted key.
 */
import { useQuery } from '@tanstack/react-query';
import { useState, type ReactElement } from 'react';
import type { OnboardingState } from '@nexa/types';
import { useApiClient } from '../../lib/auth-store.js';
import { useTranslate } from '../../lib/i18n.js';
import { Banner, bannerDismissKey } from '../../components/ui/index.js';
import { Tour, type TourStep } from '../../components/Tour.js';

const TAKE_TOUR_BANNER_ID = 'inbox-take-tour';
const TOUR_WINDOW_MS = 7 * 24 * 60 * 60 * 1000;

function withinTourWindow(completedAt: string | null | undefined): boolean {
  if (!completedAt) return false;
  const completed = new Date(completedAt).getTime();
  if (Number.isNaN(completed)) return false;
  return Date.now() - completed <= TOUR_WINDOW_MS;
}

/** `localStorage` can throw (private mode, sandboxed frames) — never on the offer's account. */
function markTourTaken(): void {
  try {
    localStorage.setItem(bannerDismissKey(TAKE_TOUR_BANNER_ID), '1');
  } catch {
    // Storage unavailable — the tour still opens for this session.
  }
}

export function TakeTourBanner(): ReactElement | null {
  const t = useTranslate();
  const api = useApiClient();
  const [tourOpen, setTourOpen] = useState(false);
  const [taken, setTaken] = useState(false);

  const { data } = useQuery({
    queryKey: ['onboarding-state'],
    queryFn: () => api.get<OnboardingState>('/onboarding/state'),
    retry: false,
    staleTime: 60_000,
  });

  const openTour = (): void => {
    setTaken(true);
    setTourOpen(true);
    markTourTaken();
  };

  const steps: TourStep[] = [
    { title: t('inbox.takeTour.step1.title'), body: t('inbox.takeTour.step1.body') },
    { title: t('inbox.takeTour.step2.title'), body: t('inbox.takeTour.step2.body') },
    { title: t('inbox.takeTour.step3.title'), body: t('inbox.takeTour.step3.body') },
    { title: t('inbox.takeTour.step4.title'), body: t('inbox.takeTour.step4.body') },
  ];

  return (
    <>
      {!taken && withinTourWindow(data?.completed_at) && (
        <Banner
          tone="brand"
          id={TAKE_TOUR_BANNER_ID}
          dismissible
          cta={
            <button
              type="button"
              onClick={openTour}
              className="rounded-md bg-brand-500 px-2.5 py-1 text-xs font-medium text-white transition-colors hover:bg-brand-600"
            >
              {t('inbox.takeTour.cta')}
            </button>
          }
        >
          {t('inbox.takeTour.text')}
        </Banner>
      )}
      {tourOpen && <Tour steps={steps} onClose={() => setTourOpen(false)} />}
    </>
  );
}
