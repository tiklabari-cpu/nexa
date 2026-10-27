/**
 * The Usage pages against a fake platform API (tm 389.12 · FR-ADMIN-13). The cap resolution,
 * the announcement and the tenant API's answer have their own suite
 * (`platform-billing-usage.test.ts`); here: what the pages show, which role is offered the
 * writes, what the override and plan-default forms send.
 */
import type { PlatformRole } from '@siyahtus/types';
import { screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { FakePlatform } from '../../test/fake-platform.js';
import { installFakePlatform, renderApp, resetSession } from '../../test/render-app.js';
import { parseTokens } from './UsagePage.js';

afterEach(async () => {
  vi.restoreAllMocks();
  await resetSession();
});

beforeEach(() => {
  globalThis.sessionStorage.clear();
});

const user = () => userEvent.setup();

async function open(path: string, heading: string, role: PlatformRole): Promise<FakePlatform> {
  const fake = installFakePlatform({ role });
  renderApp(path);
  await user().type(await screen.findByLabelText('Email'), 'ops@example.com');
  await user().type(screen.getByLabelText('Password'), 'correct horse battery staple');
  await user().click(screen.getByRole('button', { name: 'Continue' }));
  await user().type(await screen.findByLabelText('Authenticator code'), '123456');
  await user().click(screen.getByRole('button', { name: 'Verify' }));
  await screen.findByRole('heading', { name: heading, level: 1 });
  return fake;
}

const sent = (fake: FakePlatform, path: string) =>
  fake.requests
    .filter((request) => request.path === path && request.method !== 'GET')
    .map((request) => request.body);

describe('the usage page', () => {
  it('shows the deployment’s counters against its caps and the heaviest workspaces by meter', async () => {
    const fake = await open('/usage', 'Usage', 'readonly');
    expect(await screen.findByText('900,000 of 2,000,000')).toBeVisible();
    expect(
      screen.getByRole('img', {
        name: 'Model tokens per day across the deployment, last 30 days',
      }),
    ).toBeVisible();
    const top = await screen.findByRole('table', {
      name: 'Heaviest workspaces by Model tokens',
    });
    expect(within(top).getByRole('link', { name: 'Acme Gaming' })).toHaveAttribute(
      'href',
      '/usage/42',
    );
    expect(within(top).getByText('75%')).toBeVisible();

    await user().selectOptions(screen.getByLabelText('Meter'), 'ai_resolutions');
    expect(
      await screen.findByRole('table', { name: 'Heaviest workspaces by AI resolutions' }),
    ).toBeVisible();
    expect(fake.requests.map((r) => `${r.method} ${r.path}`)).toContain('GET /usage/workspaces');
    // readonly reads the plan defaults and is offered no change.
    await screen.findByRole('table', { name: 'Daily AI allowance by plan' });
    expect(screen.queryByRole('button', { name: 'Change plan defaults' })).toBeNull();
  });

  it('sets a plan default as billing — an empty box inherits', async () => {
    const fake = await open('/usage', 'Usage', 'billing');
    await user().click(await screen.findByRole('button', { name: 'Change plan defaults' }));
    const dialog = await screen.findByRole('dialog');
    await user().type(within(dialog).getByLabelText('Growth — Model tokens per day'), '250,000');
    await user().type(within(dialog).getByLabelText('Reason'), 'Raise for the pilot');
    await user().click(within(dialog).getByRole('button', { name: 'Save' }));
    expect(await screen.findByText('The plan defaults were saved.')).toBeVisible();
    expect(sent(fake, '/settings/ai-caps')).toEqual([
      {
        plans: {
          growth: { llm: 250_000, embedding: null },
          enterprise: { llm: null, embedding: null },
        },
        reason: 'Raise for the pilot',
      },
    ]);
  });
});

describe('one workspace’s usage', () => {
  it('shows each cap layer and which applies, and overrides it with an end date', async () => {
    const fake = await open('/usage/42', 'Acme Gaming', 'billing');
    const caps = await screen.findByRole('table', { name: 'Daily AI caps' });
    const llm = within(caps).getByText('Model tokens').closest('tr') as HTMLElement;
    expect(within(llm).getAllByText('Deployment default').length).toBeGreaterThan(0);
    expect(within(llm).getAllByText('200,000').length).toBeGreaterThan(0);

    await user().click(screen.getByRole('button', { name: 'Change AI caps' }));
    const dialog = await screen.findByRole('dialog');
    const confirm = within(dialog).getByRole('button', { name: 'Save caps' });
    await user().type(within(dialog).getByLabelText('Ends on (optional)'), '2027-01-31');
    await user().type(within(dialog).getByLabelText('Reason'), 'Contract raise, ticket SUP-9');
    // An end date with nothing to end is held back.
    expect(confirm).toBeDisabled();
    await user().type(within(dialog).getByLabelText('Model tokens per day'), '500000');
    expect(confirm).toBeEnabled();
    await user().click(confirm);
    expect(await screen.findByText('The caps were saved and apply at once.')).toBeVisible();
    expect(sent(fake, '/usage/workspaces/42/ai-caps')).toEqual([
      {
        llm_daily_tokens_cap: 500_000,
        embedding_daily_tokens_cap: null,
        expires_at: '2027-01-31T23:59:59.000Z',
        reason: 'Contract raise, ticket SUP-9',
      },
    ]);
    const after = within(await screen.findByRole('table', { name: 'Daily AI caps' }))
      .getByText('Model tokens')
      .closest('tr') as HTMLElement;
    expect(await within(after).findByText('Override')).toBeVisible();
    expect(screen.getByText(/The override ends on/)).toBeVisible();
  });

  it('offers support no change', async () => {
    await open('/usage/42', 'Acme Gaming', 'support');
    await screen.findByRole('table', { name: 'Daily AI caps' });
    expect(screen.queryByRole('button', { name: 'Change AI caps' })).toBeNull();
  });
});

describe('parseTokens', () => {
  it('reads a whole number with separators, and refuses anything else', () => {
    expect(parseTokens('')).toBeNull();
    expect(parseTokens('250,000')).toBe(250_000);
    expect(parseTokens('1 000')).toBe(1_000);
    expect(parseTokens('0')).toBeNaN();
    expect(parseTokens('12k')).toBeNaN();
  });
});
