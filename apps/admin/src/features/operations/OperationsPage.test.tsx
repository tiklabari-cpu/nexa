/**
 * The Operations page against a fake platform API (tm 389.14 · FR-ADMIN-20): the job table and
 * "Run now" with its four possible answers, the queues, the backlog and SIEM figures, the
 * partitions and their opener, the purge with its fresh-code requirement, and who sees which
 * button. The server's own rules have their own suite (`platform-operations.test.ts`).
 */
import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { json, problem, type FakePlatform } from '../../test/fake-platform.js';
import { OPERATIONS_SCHEDULER } from '../../test/fake-operations.js';
import { setLocale } from '../../test/i18n.js';
import { installFakePlatform, renderApp, resetSession } from '../../test/render-app.js';

afterEach(resetSession);

beforeEach(() => {
  globalThis.sessionStorage.clear();
});

async function openOperations(fake: FakePlatform): Promise<ReturnType<typeof userEvent.setup>> {
  const user = userEvent.setup();
  renderApp('/operations');
  await user.type(await screen.findByLabelText('Email'), 'ops@example.com');
  await user.type(screen.getByLabelText('Password'), 'correct horse battery staple');
  await user.click(screen.getByRole('button', { name: 'Continue' }));
  await user.type(await screen.findByLabelText('Authenticator code'), '123456');
  await user.click(screen.getByRole('button', { name: 'Verify' }));
  await screen.findByRole('heading', { name: 'Operations', level: 1 });
  expect(fake.calls('/auth/me').length).toBeGreaterThan(0);
  return user;
}

const region = (name: string) => screen.findByRole('region', { name });

async function rowOf(job: string): Promise<HTMLElement> {
  const section = await region('Scheduler jobs');
  return (await within(section).findByText(job)).closest('tr') as HTMLElement;
}

describe('the scheduler table', () => {
  it('shows each job’s interval, last run, duration, result and next run', async () => {
    const fake = installFakePlatform();
    await openOperations(fake);

    const siem = await rowOf('siem');
    expect(within(siem).getByText('5m')).toBeVisible();
    expect(within(siem).getByText('1,250 ms')).toBeVisible();
    expect(within(siem).getByText('Ran cleanly')).toBeVisible();

    const sla = await rowOf('sla');
    expect(within(sla).getByText('Failed')).toBeVisible();
    // The class, never the message.
    expect(within(sla).getByText('Error: PrismaClientKnownRequestError')).toBeVisible();
    expect(within(sla).getByText(/^Ran .* \(42 ms\)$/)).toBeVisible();

    const retention = await rowOf('retention');
    expect(within(retention).getAllByText('Switched off').length).toBeGreaterThan(0);
    // A switched-off job offers no "Run now".
    expect(within(retention).queryByRole('button')).toBeNull();
  });

  it('asks for a reason, sends it and says the request was heard', async () => {
    const fake = installFakePlatform();
    const user = await openOperations(fake);

    await user.click(await screen.findByRole('button', { name: 'Run siem now' }));
    const dialog = await screen.findByRole('dialog');
    await user.type(within(dialog).getByLabelText('Reason'), 'checking the export after a deploy');
    await user.click(within(dialog).getByRole('button', { name: 'Run now' }));

    expect(await screen.findByText(/siem: the request was heard/)).toBeVisible();
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
    expect(fake.calls('/operations/scheduler/siem/run')[0]?.body).toEqual({
      reason: 'checking the export after a deploy',
    });
  });

  it.each([
    ['already_running', /sla is already running; nothing was started/],
    ['disabled', /sla is switched off and is not run on request/],
    ['no_listener', /No scheduler is listening, so sla was not started/],
  ])('says what became of a request that came to nothing (%s)', async (result, sentence) => {
    const fake = installFakePlatform();
    fake.override('POST', '/operations/scheduler/sla/run', () =>
      json(200, { name: 'sla', request_id: '6f1c1f2e-0d6a-4c53-9a43-1f1f0a9a1b2c', result }),
    );
    const user = await openOperations(fake);

    await user.click(await screen.findByRole('button', { name: 'Run sla now' }));
    const dialog = await screen.findByRole('dialog');
    await user.type(within(dialog).getByLabelText('Reason'), 'trying it');
    await user.click(within(dialog).getByRole('button', { name: 'Run now' }));

    expect(await screen.findByText(sentence)).toBeVisible();
  });

  it('keeps a refusal inside the dialog with the reason still typed', async () => {
    const fake = installFakePlatform();
    fake.override('POST', '/operations/scheduler/siem/run', () => problem(403, 'authorization'));
    const user = await openOperations(fake);

    await user.click(await screen.findByRole('button', { name: 'Run siem now' }));
    const dialog = await screen.findByRole('dialog');
    await user.type(within(dialog).getByLabelText('Reason'), 'trying it');
    await user.click(within(dialog).getByRole('button', { name: 'Run now' }));

    expect(await within(dialog).findByRole('alert')).toBeVisible();
    expect(within(dialog).getByLabelText('Reason')).toHaveValue('trying it');
  });

  it('disables the button of a job that is executing and marks it', async () => {
    const fake = installFakePlatform();
    fake.override('GET', '/operations/scheduler', () =>
      json(200, {
        ...OPERATIONS_SCHEDULER,
        jobs: OPERATIONS_SCHEDULER.jobs.map((job) =>
          job.name === 'siem' ? { ...job, running: true } : job,
        ),
      }),
    );
    await openOperations(fake);

    const siem = await rowOf('siem');
    expect(within(siem).getByText('Running')).toBeVisible();
    expect(within(siem).getByRole('button', { name: 'Run siem now' })).toBeDisabled();
  });

  it('turns red and draws no rows when nothing publishes the table', async () => {
    const fake = installFakePlatform();
    fake.override('GET', '/operations/scheduler', () =>
      json(200, { stale: true, generated_at: null, enabled: null, jobs: [] }),
    );
    await openOperations(fake);

    const section = await region('Scheduler jobs');
    expect(await within(section).findByText('No scheduler is reporting')).toBeVisible();
    expect(within(section).queryByRole('table')).toBeNull();
  });

  it('keeps the rows under a yellow notice when the table is stale', async () => {
    const fake = installFakePlatform();
    fake.override('GET', '/operations/scheduler', () =>
      json(200, { ...OPERATIONS_SCHEDULER, stale: true }),
    );
    await openOperations(fake);

    expect(await screen.findByText('The job table is out of date')).toBeVisible();
    expect(await rowOf('siem')).toBeVisible();
  });

  it('says so when the publishing process has its scheduler switched off', async () => {
    const fake = installFakePlatform();
    fake.override('GET', '/operations/scheduler', () =>
      json(200, { ...OPERATIONS_SCHEDULER, enabled: false }),
    );
    await openOperations(fake);

    expect(
      await screen.findByText('The scheduler is switched off where this table comes from'),
    ).toBeVisible();
  });
});

describe('who sees what', () => {
  it('shows a read-only operator every figure and not one button that changes anything', async () => {
    const fake = installFakePlatform({ role: 'readonly' });
    await openOperations(fake);

    await rowOf('siem');
    await region('Event partitions');
    await region('Unverified sign-ups');
    expect(screen.queryByRole('button', { name: /^Run / })).toBeNull();
    expect(screen.queryByRole('button', { name: 'Open the window’s partitions' })).toBeNull();
    expect(screen.queryByRole('button', { name: 'Purge expired sign-ups' })).toBeNull();
  });

  it('lets support run a job and open partitions but not purge', async () => {
    const fake = installFakePlatform({ role: 'support' });
    await openOperations(fake);

    expect(await screen.findByRole('button', { name: 'Run siem now' })).toBeVisible();
    expect(screen.getByRole('button', { name: 'Open the window’s partitions' })).toBeVisible();
    expect(screen.queryByRole('button', { name: 'Purge expired sign-ups' })).toBeNull();
  });
});

describe('the queues and the backlog', () => {
  it('lists the queues with their counts and marks a missing one as not installed', async () => {
    const fake = installFakePlatform();
    await openOperations(fake);

    const section = await region('Job queues');
    const ai = (await within(section).findByText('AI replies')).closest('tr') as HTMLElement;
    expect(within(ai).getByText('pending: 2 · done: 40')).toBeVisible();
    expect(within(ai).getByText('1m 35s')).toBeVisible();
    const knowledge = within(section).getByText('Knowledge indexing').closest('tr') as HTMLElement;
    expect(within(knowledge).getByText('Not installed')).toBeVisible();
    expect(within(knowledge).queryByText('Could not be read')).toBeNull();
  });

  it('shows the webhook backlog and failure rate', async () => {
    const fake = installFakePlatform();
    await openOperations(fake);

    const section = await region('Webhook deliveries');
    expect(within(section).getByText('Waiting for a retry').nextElementSibling).toHaveTextContent(
      '4',
    );
    expect(
      within(section).getByText('Overdue by more than 10 minutes').nextElementSibling,
    ).toHaveTextContent('1');
    expect(
      within(section).getByText('Failure rate, last 24 h').nextElementSibling,
    ).toHaveTextContent('10%');
    expect(
      within(section).getByText('Workspaces with failures').nextElementSibling,
    ).toHaveTextContent('3');
  });

  it('shows the SIEM export', async () => {
    const fake = installFakePlatform();
    await openOperations(fake);

    const section = await region('SIEM export');
    expect(within(section).getByText('Workspaces exporting').nextElementSibling).toHaveTextContent(
      '5',
    );
    expect(
      within(section).getByText('Stalled (silent for 24 h)').nextElementSibling,
    ).toHaveTextContent('1');
    expect(
      within(section).getByText('Entries shipped, in total').nextElementSibling,
    ).toHaveTextContent('12,345');
  });

  it('says a failed section failed, with a retry, and still draws the others', async () => {
    const fake = installFakePlatform();
    fake.override('GET', '/operations/webhooks', () => problem(500, 'internal'));
    await openOperations(fake);

    const section = await region('Webhook deliveries');
    expect(await within(section).findByRole('alert')).toHaveTextContent(
      'This section could not be loaded',
    );
    expect(within(section).getByRole('button', { name: 'Try again' })).toBeVisible();
    expect(await rowOf('siem')).toBeVisible();
  });

  it('draws the component record in the dashboard’s words', async () => {
    const fake = installFakePlatform();
    await openOperations(fake);

    const section = await region('Component status');
    const geoip = within(section).getByText('GeoIP').closest('li') as HTMLElement;
    expect(within(geoip).getByText('Degraded')).toBeVisible();
    expect(within(geoip).getByText('DBIP · 120 days old')).toBeVisible();
    const worker = within(section).getByText('Document worker').closest('li') as HTMLElement;
    expect(within(worker).getByText('Not installed')).toBeVisible();
    const captcha = within(section).getByText('Captcha').closest('li') as HTMLElement;
    expect(within(captcha).getByText('Nothing reported yet')).toBeVisible();
  });
});

describe('the partitions', () => {
  it('names the months without a partition and the catch-all, and sizes what exists', async () => {
    const fake = installFakePlatform();
    await openOperations(fake);

    const section = await region('Event partitions');
    expect(await within(section).findByText('Months without a partition')).toBeVisible();
    expect(within(section).getByText(/2026-11, 2026-12, 2027-01/)).toBeVisible();
    expect(within(section).getByText('3.0 MB')).toBeVisible();
    expect(within(section).getByText('Catch-all')).toBeVisible();
    expect(within(section).queryByText('The catch-all partition holds rows')).toBeNull();
  });

  it('raises the alarm when the catch-all holds rows', async () => {
    const fake = installFakePlatform();
    fake.override('GET', '/operations/partitions', () =>
      json(200, {
        generated_at: '2026-10-25T10:00:00.000Z',
        window: { behind: 1, ahead: 3 },
        partitions: [
          { name: 'events_default', month: null, default: true, est_rows: 9, size_bytes: 8192 },
        ],
        missing_months: [],
        default_has_rows: true,
      }),
    );
    await openOperations(fake);

    expect(await screen.findByText('The catch-all partition holds rows')).toBeVisible();
  });

  it('opens the window’s partitions with a reason and says all are open', async () => {
    const fake = installFakePlatform();
    const user = await openOperations(fake);

    await user.click(await screen.findByRole('button', { name: 'Open the window’s partitions' }));
    const dialog = await screen.findByRole('dialog');
    await user.type(within(dialog).getByLabelText('Reason'), 'closing the gap');
    await user.click(within(dialog).getByRole('button', { name: 'Open partitions' }));

    expect(await screen.findByText('All 5 months of the window have a partition.')).toBeVisible();
    expect(fake.calls('/operations/partitions/ensure')[0]?.body).toEqual({
      reason: 'closing the gap',
    });
  });

  it('lists the months the database refused, by their error code', async () => {
    const fake = installFakePlatform();
    fake.override('POST', '/operations/partitions/ensure', () =>
      json(200, {
        ensured: [],
        failed: [{ month: '2026-11', error_code: '23514' }],
      }),
    );
    const user = await openOperations(fake);

    await user.click(await screen.findByRole('button', { name: 'Open the window’s partitions' }));
    const dialog = await screen.findByRole('dialog');
    await user.type(within(dialog).getByLabelText('Reason'), 'closing the gap');
    await user.click(within(dialog).getByRole('button', { name: 'Open partitions' }));

    expect(
      await screen.findByText('Some months could not be opened: 2026-11 (error 23514).'),
    ).toBeVisible();
  });
});

describe('unverified sign-ups', () => {
  it('shows the counts against the age the purge respects', async () => {
    const fake = installFakePlatform();
    await openOperations(fake);

    const section = await region('Unverified sign-ups');
    expect(
      within(section).getByText('Accounts never verified').nextElementSibling,
    ).toHaveTextContent('9');
    expect(within(section).getByText('Older than 7 days').nextElementSibling).toHaveTextContent(
      '4',
    );
    expect(within(section).getByText(/never touches a sign-up younger than 7 days/)).toBeVisible();
  });

  it('purges with a reason and a fresh code, then says how many went', async () => {
    const fake = installFakePlatform();
    const user = await openOperations(fake);

    await user.click(await screen.findByRole('button', { name: 'Purge expired sign-ups' }));
    const dialog = await screen.findByRole('dialog');
    // A destructive action asks for the code up front, not after a refusal.
    expect(within(dialog).getByLabelText('Authenticator code')).toBeVisible();
    await user.type(within(dialog).getByLabelText('Reason'), 'a bot wave on the 20th');
    await user.type(within(dialog).getByLabelText('Authenticator code'), '123456');
    await user.click(within(dialog).getByRole('button', { name: 'Purge' }));

    expect(await screen.findByText('Purged 3 sign-ups.')).toBeVisible();
    expect(fake.calls('/auth/totp/reverify')).toHaveLength(1);
    expect(fake.calls('/operations/unverified-signups/purge')[0]?.body).toEqual({
      reason: 'a bot wave on the 20th',
    });
  });
});

describe('in Turkish', () => {
  it('reads the same page in Turkish', async () => {
    const fake = installFakePlatform();
    setLocale('tr');
    const user = userEvent.setup();
    renderApp('/operations');
    await user.type(await screen.findByLabelText('E-posta'), 'ops@example.com');
    await user.type(screen.getByLabelText('Parola'), 'correct horse battery staple');
    await user.click(screen.getByRole('button', { name: 'Devam' }));
    await user.type(await screen.findByLabelText('Doğrulayıcı kodu'), '123456');
    await user.click(screen.getByRole('button', { name: 'Doğrula' }));

    expect(await screen.findByRole('heading', { name: 'Zamanlayıcı işleri' })).toBeVisible();
    expect(await screen.findByRole('button', { name: 'siem işini şimdi çalıştır' })).toBeVisible();
    expect(screen.getByRole('heading', { name: 'Olay bölümleri' })).toBeVisible();
    expect(screen.getByRole('heading', { name: 'Doğrulanmamış kayıtlar' })).toBeVisible();
    expect(fake.calls('/operations/scheduler').length).toBeGreaterThan(0);
  });
});
