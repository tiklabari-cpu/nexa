/**
 * First-run setup wizard — FR-MOD-00.4.
 *
 * A workspace created through signup opens empty: no groups, no website, no
 * conversations. Rather than drop a new owner on a blank inbox, this walks them
 * through the four things that make it usable — a quick welcome, connecting a
 * site, inviting the team, and laying down sample data — reusing the same
 * endpoints the Settings, Website and Team screens use. Every step is skippable,
 * and a single "Skip setup" exits the whole thing; either way the workspace is
 * marked set up so the wizard never returns.
 *
 * The gate lives in `App.tsx`, keyed off `agent.onboarding_completed` from
 * `/auth/me`, so this component owns only the flow, not the redirect.
 */
import { useMutation } from '@tanstack/react-query';
import { useState, type FormEvent, type ReactElement } from 'react';
import { useNavigate } from 'react-router-dom';
import type { OnboardingSeedResult } from '@nexa/types';
import { ApiClientError, errorMessageKey } from '../../lib/api-client.js';
import { useApiClient, useAuth } from '../../lib/auth-store.js';
import { useTranslate } from '../../lib/i18n.js';
import { useStepper } from '../../lib/stepper.js';

type StepId = 'welcome' | 'website' | 'team' | 'sample';

const STEPS: readonly StepId[] = ['welcome', 'website', 'team', 'sample'];

const STEP_LABEL_KEYS: Record<StepId, string> = {
  welcome: 'auth.onboarding.steps.welcome',
  website: 'auth.onboarding.steps.website',
  team: 'auth.onboarding.steps.team',
  sample: 'auth.onboarding.steps.sample',
};

export function OnboardingWizard(): ReactElement {
  const t = useTranslate();
  const api = useApiClient();
  const navigate = useNavigate();
  const agentName = useAuth((s) => s.agent?.name ?? null);
  const markOnboarded = useAuth((s) => s.markOnboarded);

  // The shared stepper owns the index and its bounds; the wizard only says how
  // many steps there are and what the last one does (FR-EK-A.2).
  const steps = useStepper(STEPS.length);
  const stepId = STEPS[steps.index]!;

  // Completing and skipping are the same server call — the workspace is set up
  // either way. On success the local gate flips and the shell takes over.
  const finish = useMutation({
    mutationFn: () => api.post('/onboarding/complete'),
    onSuccess: () => {
      markOnboarded();
      navigate('/app/inbox', { replace: true });
    },
  });

  const goNext = (): void => {
    if (steps.isLast) finish.mutate();
    else steps.next();
  };

  return (
    <div className="flex min-h-full items-center justify-center bg-canvas px-4 py-10 text-content">
      <div className="w-full max-w-xl rounded-xl border border-border bg-surface shadow-sm">
        <header className="flex items-center justify-between gap-4 border-b border-border px-6 py-4">
          <div>
            <h1 className="text-base font-semibold">{t('auth.onboarding.title')}</h1>
            <p className="text-2xs text-content-tertiary">
              {t('auth.onboarding.stepProgress', { current: steps.current, count: steps.count })}
            </p>
          </div>
          <button
            type="button"
            onClick={() => finish.mutate()}
            disabled={finish.isPending}
            className="rounded-md px-2 py-1 text-2xs text-content-secondary underline-offset-2 transition-colors hover:text-content hover:underline disabled:opacity-50"
          >
            {t('auth.onboarding.skip')}
          </button>
        </header>

        <Stepper current={steps.index} />

        <div className="px-6 py-6">
          {stepId === 'welcome' && <WelcomeStep name={agentName} />}
          {stepId === 'website' && <WebsiteStep />}
          {stepId === 'team' && <TeamStep />}
          {stepId === 'sample' && <SampleStep />}
        </div>

        <footer className="flex items-center justify-between gap-3 border-t border-border px-6 py-4">
          <button
            type="button"
            onClick={steps.back}
            disabled={steps.isFirst || finish.isPending}
            className="rounded-md border border-border px-3 py-1.5 text-sm text-content-secondary transition-colors hover:bg-surface-2 disabled:opacity-40"
          >
            {t('auth.onboarding.back')}
          </button>

          <div className="flex items-center gap-2">
            {finish.isError && (
              <span role="alert" className="text-2xs text-danger">
                {t('auth.onboarding.finishFailed')}
              </span>
            )}
            <button
              type="button"
              onClick={goNext}
              disabled={finish.isPending}
              className="rounded-md bg-brand-500 px-4 py-1.5 text-sm font-medium text-white transition-colors hover:bg-brand-600 disabled:opacity-50"
            >
              {steps.isLast
                ? finish.isPending
                  ? t('auth.onboarding.finishing')
                  : t('auth.onboarding.finish')
                : t('auth.onboarding.continue')}
            </button>
          </div>
        </footer>
      </div>
    </div>
  );
}

function Stepper({ current }: { current: number }): ReactElement {
  const t = useTranslate();
  return (
    <ol
      className="flex items-center gap-2 px-6 pt-4"
      aria-label={t('auth.onboarding.progressLabel')}
    >
      {STEPS.map((id, index) => {
        const state = index < current ? 'done' : index === current ? 'current' : 'todo';
        return (
          <li key={id} className="flex flex-1 flex-col gap-1">
            <span
              className={'h-1 rounded-full ' + (state === 'todo' ? 'bg-border' : 'bg-brand-500')}
            />
            <span
              className={
                'text-2xs ' +
                (state === 'current' ? 'font-medium text-content' : 'text-content-tertiary')
              }
            >
              {t(STEP_LABEL_KEYS[id])}
            </span>
          </li>
        );
      })}
    </ol>
  );
}

function WelcomeStep({ name }: { name: string | null }): ReactElement {
  const t = useTranslate();
  const first = name?.trim().split(/\s+/)[0];
  return (
    <div className="flex flex-col gap-3">
      <h2 className="text-lg font-semibold">
        {t('auth.onboarding.welcome.heading', { name: first ? `, ${first}` : '' })}
      </h2>
      <p className="text-sm text-content-secondary">{t('auth.onboarding.welcome.body')}</p>
      <ul className="mt-1 flex flex-col gap-2 text-sm text-content-secondary">
        <li>• {t('auth.onboarding.welcome.bulletWebsite')}</li>
        <li>• {t('auth.onboarding.welcome.bulletTeam')}</li>
        <li>• {t('auth.onboarding.welcome.bulletSample')}</li>
      </ul>
      <p className="text-2xs text-content-tertiary">{t('auth.onboarding.welcome.footer')}</p>
    </div>
  );
}

/** Reuses the Website Widgets flow: adding a site also trusts its domain. */
function WebsiteStep(): ReactElement {
  const t = useTranslate();
  const api = useApiClient();
  const [domain, setDomain] = useState('');
  const [added, setAdded] = useState<string | null>(null);

  const add = useMutation({
    mutationFn: async (value: string) => {
      const website = await api.post<{ domain: string }>('/websites', {
        domain: value,
        setup: 'manual',
      });
      await trustDomain(api, value);
      return website;
    },
    onSuccess: (website) => {
      setAdded(website.domain);
      setDomain('');
    },
  });

  function submit(event: FormEvent): void {
    event.preventDefault();
    if (domain.trim()) add.mutate(domain.trim());
  }

  return (
    <div className="flex flex-col gap-3">
      <h2 className="text-lg font-semibold">{t('auth.onboarding.website.heading')}</h2>
      <p className="text-sm text-content-secondary">{t('auth.onboarding.website.body')}</p>
      <form onSubmit={submit} className="flex flex-wrap items-end gap-2">
        <label htmlFor="onboarding-domain" className="flex min-w-56 flex-1 flex-col gap-1">
          <span className="text-2xs font-medium uppercase tracking-wide text-content-tertiary">
            {t('auth.onboarding.website.domainLabel')}
          </span>
          <input
            id="onboarding-domain"
            value={domain}
            onChange={(event) => setDomain(event.target.value)}
            placeholder={t('auth.onboarding.website.domainPlaceholder')}
            className="rounded-md border border-border bg-inset px-2 py-1.5 text-sm outline-none placeholder:text-content-tertiary"
          />
        </label>
        <button
          type="submit"
          disabled={!domain.trim() || add.isPending}
          className="rounded-md bg-brand-500 px-3 py-1.5 text-sm font-medium text-white transition-colors hover:bg-brand-600 disabled:opacity-50"
        >
          {add.isPending
            ? t('auth.onboarding.website.submitting')
            : t('auth.onboarding.website.submit')}
        </button>
      </form>
      {added && (
        <p role="status" className="text-2xs text-success">
          {t('auth.onboarding.website.added', { domain: added })}
        </p>
      )}
      {add.isError && (
        <p role="alert" className="text-2xs text-danger">
          {t(errorMessageKey(add.error))}
        </p>
      )}
    </div>
  );
}

/** Reuses the Team invite flow: `POST /invitations` with the same body. */
function TeamStep(): ReactElement {
  const t = useTranslate();
  const api = useApiClient();
  const [emails, setEmails] = useState('');
  const [sent, setSent] = useState<number | null>(null);

  const invite = useMutation({
    mutationFn: (list: string[]) =>
      api.post<{ items: unknown[] }>('/invitations', { emails: list, role: 'agent' }),
    onSuccess: (result) => {
      setSent(result.items.length);
      setEmails('');
    },
  });

  function submit(event: FormEvent): void {
    event.preventDefault();
    const list = emails
      .split(/[\s,]+/)
      .map((value) => value.trim())
      .filter(Boolean);
    if (list.length > 0) invite.mutate(list);
  }

  return (
    <div className="flex flex-col gap-3">
      <h2 className="text-lg font-semibold">{t('auth.onboarding.team.heading')}</h2>
      <p className="text-sm text-content-secondary">{t('auth.onboarding.team.body')}</p>
      <form onSubmit={submit} className="flex flex-col gap-2">
        <label htmlFor="onboarding-emails" className="flex flex-col gap-1">
          <span className="text-2xs font-medium uppercase tracking-wide text-content-tertiary">
            {t('auth.onboarding.team.emailsLabel')}
          </span>
          <input
            id="onboarding-emails"
            value={emails}
            onChange={(event) => setEmails(event.target.value)}
            placeholder={t('auth.onboarding.team.emailsPlaceholder')}
            className="rounded-md border border-border bg-inset px-2 py-1.5 text-sm outline-none placeholder:text-content-tertiary"
          />
        </label>
        <div>
          <button
            type="submit"
            disabled={!emails.trim() || invite.isPending}
            className="rounded-md bg-brand-500 px-3 py-1.5 text-sm font-medium text-white transition-colors hover:bg-brand-600 disabled:opacity-50"
          >
            {invite.isPending
              ? t('auth.onboarding.team.submitting')
              : t('auth.onboarding.team.submit')}
          </button>
        </div>
      </form>
      {sent !== null && (
        <p role="status" className="text-2xs text-success">
          {t('auth.onboarding.team.sent', { count: sent })}
        </p>
      )}
      {invite.isError && (
        <p role="alert" className="text-2xs text-danger">
          {t(errorMessageKey(invite.error))}
        </p>
      )}
    </div>
  );
}

/** Lays down sample data so the inbox is not empty on first run. */
function SampleStep(): ReactElement {
  const t = useTranslate();
  const api = useApiClient();
  const [result, setResult] = useState<OnboardingSeedResult | null>(null);

  const seed = useMutation({
    mutationFn: () => api.post<OnboardingSeedResult>('/onboarding/seed-demo'),
    onSuccess: setResult,
  });

  const done = result !== null;
  const counts = result?.counts;

  return (
    <div className="flex flex-col gap-3">
      <h2 className="text-lg font-semibold">{t('auth.onboarding.sample.addLabel')}</h2>
      <p className="text-sm text-content-secondary">{t('auth.onboarding.sample.body')}</p>
      <div>
        <button
          type="button"
          onClick={() => seed.mutate()}
          disabled={seed.isPending || done}
          className="rounded-md bg-brand-500 px-3 py-1.5 text-sm font-medium text-white transition-colors hover:bg-brand-600 disabled:opacity-50"
        >
          {seed.isPending
            ? t('auth.onboarding.sample.submitting')
            : done
              ? t('auth.onboarding.sample.added')
              : t('auth.onboarding.sample.addLabel')}
        </button>
      </div>
      {done && counts && (
        <p role="status" className="text-2xs text-success">
          {result?.seeded
            ? t('auth.onboarding.sample.seeded', {
                cannedResponses: counts.canned_responses,
                tags: counts.tags,
                chats: counts.chats,
              })
            : t('auth.onboarding.sample.alreadySeeded')}
        </p>
      )}
      {seed.isError && (
        <p role="alert" className="text-2xs text-danger">
          {t(errorMessageKey(seed.error))}
        </p>
      )}
      <p className="text-2xs text-content-tertiary">
        {t('auth.onboarding.sample.footerBefore')} <strong>{t('auth.onboarding.finish')}</strong>{' '}
        {t('auth.onboarding.sample.footerAfter')}
      </p>
    </div>
  );
}

/**
 * Trust a domain, treating "already trusted" as success — mirrors the Website
 * Widgets screen. Adding a website only needs the domain on the allowlist, not
 * to have put it there itself.
 */
// i18n-ignore: a TS generic (`ReturnType<...>`), not JSX text — the prose heuristic misreads it.
async function trustDomain(api: ReturnType<typeof useApiClient>, domain: string): Promise<void> {
  try {
    await api.post('/settings/trusted-domains', { domain, include_subdomains: false });
  } catch (error) {
    if (
      error instanceof ApiClientError &&
      (error.type === 'not_allowed' || error.status === 409 || error.status === 403)
    ) {
      return;
    }
    throw error;
  }
}
