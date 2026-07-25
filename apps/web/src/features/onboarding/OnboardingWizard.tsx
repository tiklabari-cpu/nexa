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
import { ApiClientError } from '../../lib/api-client.js';
import { useApiClient, useAuth } from '../../lib/auth-store.js';

type StepId = 'welcome' | 'website' | 'team' | 'sample';

const STEPS: Array<{ id: StepId; label: string }> = [
  { id: 'welcome', label: 'Welcome' },
  { id: 'website', label: 'Website' },
  { id: 'team', label: 'Team' },
  { id: 'sample', label: 'Sample data' },
];

export function OnboardingWizard(): ReactElement {
  const api = useApiClient();
  const navigate = useNavigate();
  const agentName = useAuth((s) => s.agent?.name ?? null);
  const markOnboarded = useAuth((s) => s.markOnboarded);

  const [stepIndex, setStepIndex] = useState(0);
  const step = STEPS[stepIndex]!;

  // Completing and skipping are the same server call — the workspace is set up
  // either way. On success the local gate flips and the shell takes over.
  const finish = useMutation({
    mutationFn: () => api.post('/onboarding/complete'),
    onSuccess: () => {
      markOnboarded();
      navigate('/app/inbox', { replace: true });
    },
  });

  const isLast = stepIndex === STEPS.length - 1;
  const goNext = (): void => {
    if (isLast) finish.mutate();
    else setStepIndex((i) => Math.min(i + 1, STEPS.length - 1));
  };
  const goBack = (): void => setStepIndex((i) => Math.max(i - 1, 0));

  return (
    <div className="flex min-h-full items-center justify-center bg-canvas px-4 py-10 text-content">
      <div className="w-full max-w-xl rounded-xl border border-border bg-surface shadow-sm">
        <header className="flex items-center justify-between gap-4 border-b border-border px-6 py-4">
          <div>
            <h1 className="text-base font-semibold">Set up your workspace</h1>
            <p className="text-2xs text-content-tertiary">
              Step {stepIndex + 1} of {STEPS.length}
            </p>
          </div>
          <button
            type="button"
            onClick={() => finish.mutate()}
            disabled={finish.isPending}
            className="rounded-md px-2 py-1 text-2xs text-content-secondary underline-offset-2 transition-colors hover:text-content hover:underline disabled:opacity-50"
          >
            Skip setup
          </button>
        </header>

        <Stepper current={stepIndex} />

        <div className="px-6 py-6">
          {step.id === 'welcome' && <WelcomeStep name={agentName} />}
          {step.id === 'website' && <WebsiteStep />}
          {step.id === 'team' && <TeamStep />}
          {step.id === 'sample' && <SampleStep />}
        </div>

        <footer className="flex items-center justify-between gap-3 border-t border-border px-6 py-4">
          <button
            type="button"
            onClick={goBack}
            disabled={stepIndex === 0 || finish.isPending}
            className="rounded-md border border-border px-3 py-1.5 text-sm text-content-secondary transition-colors hover:bg-surface-2 disabled:opacity-40"
          >
            Back
          </button>

          <div className="flex items-center gap-2">
            {finish.isError && (
              <span role="alert" className="text-2xs text-danger">
                Could not finish setup. Try again.
              </span>
            )}
            <button
              type="button"
              onClick={goNext}
              disabled={finish.isPending}
              className="rounded-md bg-brand-500 px-4 py-1.5 text-sm font-medium text-white transition-colors hover:bg-brand-600 disabled:opacity-50"
            >
              {isLast ? (finish.isPending ? 'Finishing…' : 'Finish setup') : 'Continue'}
            </button>
          </div>
        </footer>
      </div>
    </div>
  );
}

function Stepper({ current }: { current: number }): ReactElement {
  return (
    <ol className="flex items-center gap-2 px-6 pt-4" aria-label="Setup progress">
      {STEPS.map((s, index) => {
        const state = index < current ? 'done' : index === current ? 'current' : 'todo';
        return (
          <li key={s.id} className="flex flex-1 flex-col gap-1">
            <span
              className={
                'h-1 rounded-full ' +
                (state === 'todo' ? 'bg-border' : 'bg-brand-500')
              }
            />
            <span
              className={
                'text-2xs ' +
                (state === 'current' ? 'font-medium text-content' : 'text-content-tertiary')
              }
            >
              {s.label}
            </span>
          </li>
        );
      })}
    </ol>
  );
}

function WelcomeStep({ name }: { name: string | null }): ReactElement {
  const first = name?.trim().split(/\s+/)[0];
  return (
    <div className="flex flex-col gap-3">
      <h2 className="text-lg font-semibold">Welcome{first ? `, ${first}` : ''} 👋</h2>
      <p className="text-sm text-content-secondary">
        Your workspace is ready. A few quick steps get the widget onto your site, your
        teammates in, and a sample conversation in your inbox so it is not empty on day one.
      </p>
      <ul className="mt-1 flex flex-col gap-2 text-sm text-content-secondary">
        <li>• Connect your first website</li>
        <li>• Invite your team</li>
        <li>• Add sample data to explore</li>
      </ul>
      <p className="text-2xs text-content-tertiary">
        Every step is optional — you can skip any of them and set things up later in Settings.
      </p>
    </div>
  );
}

/** Reuses the Website Widgets flow: adding a site also trusts its domain. */
function WebsiteStep(): ReactElement {
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
      <h2 className="text-lg font-semibold">Connect your first website</h2>
      <p className="text-sm text-content-secondary">
        Add the site you want the chat widget on. This also trusts its domain, so the widget
        can start conversations there right away.
      </p>
      <form onSubmit={submit} className="flex flex-wrap items-end gap-2">
        <label htmlFor="onboarding-domain" className="flex min-w-56 flex-1 flex-col gap-1">
          <span className="text-2xs font-medium uppercase tracking-wide text-content-tertiary">
            Website domain
          </span>
          <input
            id="onboarding-domain"
            value={domain}
            onChange={(event) => setDomain(event.target.value)}
            placeholder="shop.example"
            className="rounded-md border border-border bg-inset px-2 py-1.5 text-sm outline-none placeholder:text-content-tertiary"
          />
        </label>
        <button
          type="submit"
          disabled={!domain.trim() || add.isPending}
          className="rounded-md bg-brand-500 px-3 py-1.5 text-sm font-medium text-white transition-colors hover:bg-brand-600 disabled:opacity-50"
        >
          {add.isPending ? 'Adding…' : 'Add website'}
        </button>
      </form>
      {added && (
        <p role="status" className="text-2xs text-success">
          Added {added}. You can add more sites later in Settings.
        </p>
      )}
      {add.isError && (
        <p role="alert" className="text-2xs text-danger">
          {add.error instanceof ApiClientError ? add.error.message : 'Could not add that website.'}
        </p>
      )}
    </div>
  );
}

/** Reuses the Team invite flow: `POST /invitations` with the same body. */
function TeamStep(): ReactElement {
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
      <h2 className="text-lg font-semibold">Invite your team</h2>
      <p className="text-sm text-content-secondary">
        Add teammates by email — separate several with a space or comma. They join as agents;
        you can change roles later. Skip this if you are flying solo for now.
      </p>
      <form onSubmit={submit} className="flex flex-col gap-2">
        <label htmlFor="onboarding-emails" className="flex flex-col gap-1">
          <span className="text-2xs font-medium uppercase tracking-wide text-content-tertiary">
            Teammate emails
          </span>
          <input
            id="onboarding-emails"
            value={emails}
            onChange={(event) => setEmails(event.target.value)}
            placeholder="sam@example.com, priya@example.com"
            className="rounded-md border border-border bg-inset px-2 py-1.5 text-sm outline-none placeholder:text-content-tertiary"
          />
        </label>
        <div>
          <button
            type="submit"
            disabled={!emails.trim() || invite.isPending}
            className="rounded-md bg-brand-500 px-3 py-1.5 text-sm font-medium text-white transition-colors hover:bg-brand-600 disabled:opacity-50"
          >
            {invite.isPending ? 'Sending…' : 'Send invites'}
          </button>
        </div>
      </form>
      {sent !== null && (
        <p role="status" className="text-2xs text-success">
          Sent {sent} invitation{sent === 1 ? '' : 's'}.
        </p>
      )}
      {invite.isError && (
        <p role="alert" className="text-2xs text-danger">
          {invite.error instanceof ApiClientError
            ? invite.error.message
            : 'Could not send those invitations.'}
        </p>
      )}
    </div>
  );
}

/** Lays down sample data so the inbox is not empty on first run. */
function SampleStep(): ReactElement {
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
      <h2 className="text-lg font-semibold">Add sample data</h2>
      <p className="text-sm text-content-secondary">
        Populate your workspace with a few saved replies, tags and one sample conversation so
        you have something to explore straight away. You can archive or delete it any time.
      </p>
      <div>
        <button
          type="button"
          onClick={() => seed.mutate()}
          disabled={seed.isPending || done}
          className="rounded-md bg-brand-500 px-3 py-1.5 text-sm font-medium text-white transition-colors hover:bg-brand-600 disabled:opacity-50"
        >
          {seed.isPending ? 'Adding…' : done ? 'Sample data added' : 'Add sample data'}
        </button>
      </div>
      {done && counts && (
        <p role="status" className="text-2xs text-success">
          {result?.seeded
            ? `Added ${counts.canned_responses} saved replies, ${counts.tags} tags and ${counts.chats} sample conversation.`
            : 'Sample data is already in your workspace.'}
        </p>
      )}
      {seed.isError && (
        <p role="alert" className="text-2xs text-danger">
          {seed.error instanceof ApiClientError
            ? seed.error.message
            : 'Could not add sample data.'}
        </p>
      )}
      <p className="text-2xs text-content-tertiary">
        When you are done, choose <strong>Finish setup</strong> to open your inbox.
      </p>
    </div>
  );
}

/**
 * Trust a domain, treating "already trusted" as success — mirrors the Website
 * Widgets screen. Adding a website only needs the domain on the allowlist, not
 * to have put it there itself.
 */
async function trustDomain(
  api: ReturnType<typeof useApiClient>,
  domain: string,
): Promise<void> {
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
