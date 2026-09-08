/**
 * First-run setup wizard — FR-MOD-00.4.
 *
 * A workspace created through signup opens empty: no groups, no website, no
 * conversations. Rather than drop a new owner on a blank inbox, this walks them
 * through PRD §8.4's five named steps — a quick welcome, connecting a site, a
 * preview of the other channels available, the workspace's size, and inviting
 * the team — reusing the same endpoints the Settings, Website and Team screens
 * use. "Tohum veri" (sample data) is additional to those five, not a sixth: it
 * rides along on the last step's page rather than its own, which is also why
 * `STEPS` has five entries and the progress indicator reads "Step N of 5".
 * Every step is skippable, and a single "Skip setup" exits the whole thing;
 * either way the workspace is marked set up so the wizard never returns.
 *
 * The channels step is a bridge to Settings → Channels, not a second connect
 * flow — every button that actually connects a channel lives there, and stays
 * there (a single source of truth), because deep-linking there mid-wizard
 * would just bounce back: `App.tsx`'s gate sends every route to `/app/onboarding`
 * while `onboarding_completed` is false.
 *
 * The company-size step and the Settings → Company details screen
 * (`CompanyDetails.tsx`) both read and write the same `organizations.company_size`
 * column through the same `GET`/`PATCH /settings/company` — no second table for
 * one more company fact.
 *
 * The gate lives in `App.tsx`, keyed off `agent.onboarding_completed` from
 * `/auth/me`, so this component owns only the flow, not the redirect. On
 * mount it also reads `GET /onboarding/state` directly: that flag can be
 * stale (another tab or admin finished setup since this session's `/auth/me`
 * load), and the server tracks no per-step progress beyond `demo_seeded`, so
 * a workspace that already has sample data resumes on the last step instead
 * of making the owner click back through welcome/website/channels/company.
 */
import { useMutation, useQuery } from '@tanstack/react-query';
import { useEffect, useRef, useState, type ReactElement } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  COMPANY_SIZES,
  type CompanySize,
  type OnboardingSeedResult,
  type OnboardingState,
} from '@nexa/types';
import { ApiClientError, errorMessageKey } from '../../lib/api-client.js';
import { useApiClient, useAuth } from '../../lib/auth-store.js';
import { emailList, FieldError, required, splitList, useForm } from '../../lib/form.js';
import { useTranslate } from '../../lib/i18n.js';
import { useStepper } from '../../lib/stepper.js';

type StepId = 'welcome' | 'website' | 'channels' | 'company' | 'team';

const STEPS: readonly StepId[] = ['welcome', 'website', 'channels', 'company', 'team'];

const STEP_LABEL_KEYS: Record<StepId, string> = {
  welcome: 'auth.onboarding.steps.welcome',
  website: 'auth.onboarding.steps.website',
  channels: 'auth.onboarding.steps.channels',
  company: 'auth.onboarding.steps.company',
  team: 'auth.onboarding.steps.team',
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

  const state = useQuery({
    queryKey: ['onboarding-state'],
    queryFn: () => api.get<OnboardingState>('/onboarding/state'),
  });

  // Server truth wins over the local gate: `App.tsx` already kept this route
  // out of reach for a session that knew it was done, so reaching this point
  // with `completed: true` means the flag went stale after `/auth/me` loaded.
  useEffect(() => {
    if (state.data?.completed) {
      markOnboarded();
      navigate('/app/inbox', { replace: true });
    }
  }, [state.data, markOnboarded, navigate]);

  // Resume once, the first time the state loads — a ref rather than a step
  // check, so it does not re-fire (and yank the owner back) if they navigate
  // to the last step and then Back away from it. `demo_seeded` predates this
  // step count (it was set by a four-step wizard too), so an account with
  // recorded progress from before this task still lands somewhere real: the
  // last step, same as it always has, found by name rather than a hard-coded
  // index so inserting steps ahead of it here cannot silently point stale.
  const resumed = useRef(false);
  useEffect(() => {
    if (resumed.current || !state.data || state.data.completed) return;
    resumed.current = true;
    if (state.data.demo_seeded) steps.goTo(STEPS.indexOf('team'));
  }, [state.data, steps]);

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
          {stepId === 'channels' && <ChannelsStep />}
          {stepId === 'company' && <CompanySizeStep />}
          {stepId === 'team' && (
            <div className="flex flex-col gap-6">
              <TeamStep />
              <div className="flex flex-col gap-3 border-t border-border pt-5">
                <SampleStep initiallySeeded={state.data?.demo_seeded ?? false} />
              </div>
            </div>
          )}
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
        <li>• {t('auth.onboarding.welcome.bulletChannels')}</li>
        <li>• {t('auth.onboarding.welcome.bulletCompany')}</li>
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
    },
  });

  // Only "is this empty?" — `POST /websites` runs the pasted value through
  // `normaliseTrustedDomain`, which deliberately accepts a full URL and keeps
  // only its host (settings.spec.ts's "normalises a pasted URL" case), so a
  // stricter client-side format check would refuse input the server accepts.
  const form = useForm({
    initial: { domain: '' },
    validators: {
      domain: required(t('auth.onboarding.website.domainRequiredError')),
    },
    onSubmit: async (values, { setSubmitError, reset }) => {
      try {
        await add.mutateAsync(values.domain.trim());
        reset();
      } catch (error) {
        setSubmitError(t(errorMessageKey(error)));
      }
    },
  });
  const domainError = form.errorFor('domain');

  return (
    <div className="flex flex-col gap-3">
      <h2 className="text-lg font-semibold">{t('auth.onboarding.website.heading')}</h2>
      <p className="text-sm text-content-secondary">{t('auth.onboarding.website.body')}</p>
      <form onSubmit={form.handleSubmit} noValidate className="flex flex-wrap items-end gap-2">
        <label htmlFor="onboarding-domain" className="flex min-w-56 flex-1 flex-col gap-1">
          <span className="text-2xs font-medium uppercase tracking-wide text-content-tertiary">
            {t('auth.onboarding.website.domainLabel')}
          </span>
          <input
            id="onboarding-domain"
            value={form.values.domain}
            onChange={(event) => form.setValue('domain', event.target.value)}
            onBlur={() => form.blur('domain')}
            aria-invalid={domainError ? true : undefined}
            aria-describedby={domainError ? 'onboarding-domain-error' : undefined}
            placeholder={t('auth.onboarding.website.domainPlaceholder')}
            className="rounded-md border border-border bg-inset px-2 py-1.5 text-sm outline-none placeholder:text-content-tertiary"
          />
          <FieldError id="onboarding-domain-error" message={domainError} />
        </label>
        <button
          type="submit"
          disabled={!form.canSubmit}
          className="rounded-md bg-brand-500 px-3 py-1.5 text-sm font-medium text-white transition-colors hover:bg-brand-600 disabled:opacity-50"
        >
          {form.isSubmitting
            ? t('auth.onboarding.website.submitting')
            : t('auth.onboarding.website.submit')}
        </button>
      </form>
      {added && (
        <p role="status" className="text-2xs text-success">
          {t('auth.onboarding.website.added', { domain: added })}
        </p>
      )}
      {form.submitError && (
        <p role="alert" className="text-2xs text-danger">
          {form.submitError}
        </p>
      )}
    </div>
  );
}

/** The catalogue Settings → Channels shows, minus Website (the previous step
 *  already covers it). Icon + name only — live status/connect belongs to that
 *  screen, not a preview of it. */
const CHANNEL_PREVIEW: readonly { id: string; icon: string }[] = [
  { id: 'email', icon: '✉️' },
  { id: 'messenger', icon: '📨' },
  { id: 'whatsapp', icon: '📱' },
  { id: 'instagram', icon: '📷' },
  { id: 'telegram', icon: '✈️' },
  { id: 'sms', icon: '💬' },
];

/**
 * A bridge to Settings → Channels (FR-MOD-08.5), not a second connect flow —
 * every button that actually connects one of these lives there. Purely
 * informational, so there is nothing to submit and Continue always works.
 */
function ChannelsStep(): ReactElement {
  const t = useTranslate();
  return (
    <div className="flex flex-col gap-3">
      <h2 className="text-lg font-semibold">{t('auth.onboarding.channels.heading')}</h2>
      <p className="text-sm text-content-secondary">{t('auth.onboarding.channels.body')}</p>
      <ul className="grid grid-cols-2 gap-2 sm:grid-cols-3">
        {CHANNEL_PREVIEW.map(({ id, icon }) => (
          <li
            key={id}
            className="flex items-center gap-2 rounded-md border border-border bg-inset px-3 py-2 text-sm"
          >
            <span aria-hidden="true">{icon}</span>
            <span>{t(`auth.onboarding.channels.${id}`)}</span>
          </li>
        ))}
      </ul>
      <p className="text-2xs text-content-tertiary">{t('auth.onboarding.channels.footer')}</p>
    </div>
  );
}

/**
 * Company size (FR-MOD-00.4 · FR-MOD-08.3): writes through the same
 * `PATCH /settings/company` the Settings → Company details screen uses — one
 * surface for this fact, not a second. Optional like every other step: the
 * select starts unset and Continue works without a choice; only the
 * in-page Save button is gated on one being made.
 */
function CompanySizeStep(): ReactElement {
  const t = useTranslate();
  const api = useApiClient();

  const save = useMutation({
    mutationFn: (size: CompanySize) => api.patch('/settings/company', { company_size: size }),
  });

  const form = useForm({
    initial: { company_size: '' },
    validators: {
      company_size: required(t('auth.onboarding.company.sizeRequiredError')),
    },
    onSubmit: async (values, { setSubmitError }) => {
      try {
        await save.mutateAsync(values.company_size as CompanySize);
      } catch (error) {
        setSubmitError(t(errorMessageKey(error)));
      }
    },
  });
  const sizeError = form.errorFor('company_size');
  // Only while the current selection is exactly what was last saved —
  // changing it again hides the note rather than leaving it over a value
  // that was never sent.
  const justSaved = save.isSuccess && save.variables === form.values.company_size;

  return (
    <div className="flex flex-col gap-3">
      <h2 className="text-lg font-semibold">{t('auth.onboarding.company.heading')}</h2>
      <p className="text-sm text-content-secondary">{t('auth.onboarding.company.body')}</p>
      <form onSubmit={form.handleSubmit} noValidate className="flex flex-wrap items-end gap-2">
        <label htmlFor="onboarding-company-size" className="flex min-w-56 flex-1 flex-col gap-1">
          <span className="text-2xs font-medium uppercase tracking-wide text-content-tertiary">
            {t('auth.onboarding.company.sizeLabel')}
          </span>
          <select
            id="onboarding-company-size"
            value={form.values.company_size}
            onChange={(event) => form.setValue('company_size', event.target.value)}
            onBlur={() => form.blur('company_size')}
            aria-invalid={sizeError ? true : undefined}
            aria-describedby={sizeError ? 'onboarding-company-size-error' : undefined}
            className="rounded-md border border-border bg-inset px-2 py-1.5 text-sm outline-none"
          >
            <option value="">{t('auth.onboarding.company.sizePlaceholder')}</option>
            {COMPANY_SIZES.map((size) => (
              <option key={size} value={size}>
                {t(`auth.onboarding.company.size.${size}`)}
              </option>
            ))}
          </select>
          <FieldError id="onboarding-company-size-error" message={sizeError} />
        </label>
        <button
          type="submit"
          disabled={!form.canSubmit}
          className="rounded-md bg-brand-500 px-3 py-1.5 text-sm font-medium text-white transition-colors hover:bg-brand-600 disabled:opacity-50"
        >
          {form.isSubmitting
            ? t('auth.onboarding.company.submitting')
            : t('auth.onboarding.company.submit')}
        </button>
      </form>
      {justSaved && (
        <p role="status" className="text-2xs text-success">
          {t('auth.onboarding.company.saved')}
        </p>
      )}
      {form.submitError && (
        <p role="alert" className="text-2xs text-danger">
          {form.submitError}
        </p>
      )}
    </div>
  );
}

/** Reuses the Team invite flow: `POST /invitations` with the same body. */
function TeamStep(): ReactElement {
  const t = useTranslate();
  const api = useApiClient();
  const [sent, setSent] = useState<number | null>(null);

  const invite = useMutation({
    mutationFn: (list: string[]) =>
      api.post<{ items: unknown[] }>('/invitations', { emails: list, role: 'agent' }),
    onSuccess: (result) => {
      setSent(result.items.length);
    },
  });

  const form = useForm({
    initial: { emails: '' },
    validators: {
      emails: emailList({
        emptyMessage: t('auth.onboarding.team.emailsEmptyError'),
        invalidMessage: (bad) =>
          t('auth.onboarding.team.emailsInvalidError', { addresses: bad.join(', ') }),
      }),
    },
    onSubmit: async (values, { setSubmitError, reset }) => {
      try {
        await invite.mutateAsync(splitList(values.emails));
        reset();
      } catch (error) {
        setSubmitError(t(errorMessageKey(error)));
      }
    },
  });
  const emailsError = form.errorFor('emails');

  return (
    <div className="flex flex-col gap-3">
      <h2 className="text-lg font-semibold">{t('auth.onboarding.team.heading')}</h2>
      <p className="text-sm text-content-secondary">{t('auth.onboarding.team.body')}</p>
      <form onSubmit={form.handleSubmit} noValidate className="flex flex-col gap-2">
        <label htmlFor="onboarding-emails" className="flex flex-col gap-1">
          <span className="text-2xs font-medium uppercase tracking-wide text-content-tertiary">
            {t('auth.onboarding.team.emailsLabel')}
          </span>
          <input
            id="onboarding-emails"
            value={form.values.emails}
            onChange={(event) => form.setValue('emails', event.target.value)}
            onBlur={() => form.blur('emails')}
            aria-invalid={emailsError ? true : undefined}
            aria-describedby={emailsError ? 'onboarding-emails-error' : undefined}
            placeholder={t('auth.onboarding.team.emailsPlaceholder')}
            className="rounded-md border border-border bg-inset px-2 py-1.5 text-sm outline-none placeholder:text-content-tertiary"
          />
          <FieldError id="onboarding-emails-error" message={emailsError} />
        </label>
        <div>
          <button
            type="submit"
            disabled={!form.canSubmit}
            className="rounded-md bg-brand-500 px-3 py-1.5 text-sm font-medium text-white transition-colors hover:bg-brand-600 disabled:opacity-50"
          >
            {form.isSubmitting
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
      {form.submitError && (
        <p role="alert" className="text-2xs text-danger">
          {form.submitError}
        </p>
      )}
    </div>
  );
}

/**
 * Lays down sample data so the inbox is not empty on first run.
 * `initiallySeeded` reflects `GET /onboarding/state` — the workspace may
 * already have the demo from an earlier visit, in which case the step opens
 * as already done rather than asking the owner to seed it again.
 */
function SampleStep({ initiallySeeded }: { initiallySeeded: boolean }): ReactElement {
  const t = useTranslate();
  const api = useApiClient();
  const [result, setResult] = useState<OnboardingSeedResult | null>(null);

  const seed = useMutation({
    mutationFn: () => api.post<OnboardingSeedResult>('/onboarding/seed-demo'),
    onSuccess: setResult,
  });

  const done = result !== null || initiallySeeded;
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
      {done && (
        <p role="status" className="text-2xs text-success">
          {result?.seeded && counts
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
