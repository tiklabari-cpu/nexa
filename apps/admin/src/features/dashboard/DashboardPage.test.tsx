/**
 * The dashboard against a fake platform API (tm 389.8 · FR-ADMIN-07): the key-figure cards, the
 * sign-up timeline, and the three states of the health snapshot — fresh, stale (yellow) and
 * absent (red) — plus the "not installed" badge on a component this deployment does not run.
 * The server's own numbers have their own suite (`platform-dashboard.test.ts`).
 */
import { screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { DASHBOARD_HEALTH, problem, type FakePlatform } from '../../test/fake-platform.js';
import { installFakePlatform, renderApp, resetSession } from '../../test/render-app.js';
import { setLocale } from '../../test/i18n.js';

afterEach(resetSession);

beforeEach(() => {
  globalThis.sessionStorage.clear();
});

async function openDashboard(fake: FakePlatform): Promise<void> {
  const user = userEvent.setup();
  renderApp('/dashboard');
  await user.type(await screen.findByLabelText('Email'), 'ops@example.com');
  await user.type(screen.getByLabelText('Password'), 'correct horse battery staple');
  await user.click(screen.getByRole('button', { name: 'Continue' }));
  await user.type(await screen.findByLabelText('Authenticator code'), '123456');
  await user.click(screen.getByRole('button', { name: 'Verify' }));
  await screen.findByRole('heading', { name: 'Dashboard', level: 1 });
  expect(fake.calls('/auth/me').length).toBeGreaterThan(0);
}

describe('the key figures', () => {
  it('shows the counts, the split by status and a link to the workspace list', async () => {
    const fake = installFakePlatform();
    await openDashboard(fake);

    const section = (await screen.findByRole('region', { name: 'Key figures' })) as HTMLElement;
    expect(within(section).getByText('Workspaces').nextElementSibling).toHaveTextContent('12');
    expect(within(section).getByText('Trialing').nextElementSibling).toHaveTextContent('5');
    expect(within(section).getByText('Suspended').nextElementSibling).toHaveTextContent('1');
    expect(
      within(section).getByText('Trials ending within 7 days').nextElementSibling,
    ).toHaveTextContent('3');
    expect(within(section).getByText('AI tokens today (UTC)').nextElementSibling).toHaveTextContent(
      '120,345',
    );
    expect(within(section).getByText('Embeddings: 8,000')).toBeVisible();
    expect(within(section).getByRole('link', { name: 'Open the workspace list' })).toHaveAttribute(
      'href',
      '/workspaces',
    );
    expect(fake.calls('/dashboard/kpis')).toHaveLength(1);
  });

  it('says a failed read failed, with a retry, and still draws the other sections', async () => {
    const fake = installFakePlatform();
    fake.override('GET', '/dashboard/kpis', () => problem(500, 'internal'));
    await openDashboard(fake);

    const section = (await screen.findByRole('region', { name: 'Key figures' })) as HTMLElement;
    expect(await within(section).findByRole('alert')).toHaveTextContent(
      'The dashboard could not be loaded',
    );
    expect(within(section).getByRole('button', { name: 'Try again' })).toBeVisible();
    // The health read did not depend on it.
    expect(await screen.findByText('Healthy')).toBeVisible();
  });
});

describe('the sign-up timeline', () => {
  it('asks for thirty days and describes the chart', async () => {
    const fake = installFakePlatform();
    await openDashboard(fake);

    expect(
      await screen.findByRole('img', { name: 'New workspaces per day, last 30 days' }),
    ).toBeVisible();
    expect(fake.calls('/dashboard/signups')[0]).toBeDefined();
    expect(screen.getByText(/in the last 30 days$/)).toBeVisible();
  });
});

describe('the health snapshot', () => {
  it('shows a fresh snapshot: dependencies, scheduler, queue and the component grid', async () => {
    const fake = installFakePlatform();
    await openDashboard(fake);

    expect(await screen.findByText('Healthy')).toBeVisible();
    expect(screen.getByText('Version 0.1.0 · region eu')).toBeVisible();
    expect(screen.getByText('2 of 2 jobs ran cleanly')).toBeVisible();
    expect(screen.getByText('1 waiting, 0 running')).toBeVisible();
    expect(screen.queryByText('The health snapshot is out of date')).toBeNull();
    expect(screen.queryByText('The tenant API is not reporting')).toBeNull();

    const grid = screen.getByRole('list', { name: 'Components' });
    expect(within(grid).getAllByRole('listitem')).toHaveLength(12);
  });

  it('marks a component this deployment does not run as "Not installed", not as a fault', async () => {
    const fake = installFakePlatform();
    await openDashboard(fake);

    const grid = await screen.findByRole('list', { name: 'Components' });
    const geoip = within(grid)
      .getAllByRole('listitem')
      .find((item) => within(item).queryByText('GeoIP'));
    expect(geoip).toBeDefined();
    expect(within(geoip!).getByText('Not installed')).toBeVisible();
    expect(within(geoip!).queryByText('Down')).toBeNull();
    const neverReported = within(grid)
      .getAllByRole('listitem')
      .find((item) => within(item).queryByText('Webhooks'));
    expect(within(neverReported!).getByText('Unknown')).toBeVisible();
    expect(within(neverReported!).getByText('Nothing reported yet')).toBeVisible();
  });

  it('keeps the figures under a yellow notice when the snapshot is stale', async () => {
    const fake = installFakePlatform();
    fake.override('GET', '/dashboard/health', () =>
      Response.json({ ...DASHBOARD_HEALTH, stale: true, age_s: 140.4 }),
    );
    await openDashboard(fake);

    expect(await screen.findByText('The health snapshot is out of date')).toBeVisible();
    expect(screen.getByText(/The last snapshot is 140 s old/)).toBeVisible();
    // Last known is still shown: it is more use than nothing.
    expect(screen.getByText('Version 0.1.0 · region eu')).toBeVisible();
  });

  it('turns red and draws no figures when nothing is published', async () => {
    const fake = installFakePlatform();
    fake.override('GET', '/dashboard/health', () =>
      Response.json({
        stale: true,
        generated_at: null,
        age_s: null,
        snapshot: null,
        components: DASHBOARD_HEALTH.components,
      }),
    );
    await openDashboard(fake);

    expect(await screen.findByRole('alert')).toHaveTextContent('The tenant API is not reporting');
    expect(screen.queryByText('Healthy')).toBeNull();
    expect(screen.queryByText(/Version 0.1.0/)).toBeNull();
    // The component record is still drawn: it is the other half of "what do we know".
    expect(screen.getByRole('list', { name: 'Components' })).toBeVisible();
  });
});

describe('in Turkish', () => {
  it('reads the same page in Turkish', async () => {
    const fake = installFakePlatform();
    setLocale('tr');
    const user = userEvent.setup();
    renderApp('/dashboard');
    await user.type(await screen.findByLabelText('E-posta'), 'ops@example.com');
    await user.type(screen.getByLabelText('Parola'), 'correct horse battery staple');
    await user.click(screen.getByRole('button', { name: 'Devam' }));
    await user.type(await screen.findByLabelText('Doğrulayıcı kodu'), '123456');
    await user.click(screen.getByRole('button', { name: 'Doğrula' }));

    expect(await screen.findByText('Platform sağlığı')).toBeVisible();
    expect(await screen.findByText('Kurulu değil')).toBeVisible();
    expect(screen.getByText('Sağlıklı')).toBeVisible();
    expect(fake.calls('/dashboard/health').length).toBeGreaterThan(0);
  });
});
