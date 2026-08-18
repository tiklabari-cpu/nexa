/**
 * `GET /health`'s `scheduler` block (M-SCHED-b, sixth job M-SCHED-e · §D113/K1).
 *
 * The dependency probes (`database`, `redis`) already existed and are
 * unchanged by this slice. What is new is the one thing `/health` used to be
 * unable to say: whether the background sweeps are actually ticking in this
 * process, or registered and silent — the exact ambiguity that let a
 * `make dev` with no scheduler at all look identical to one that simply had
 * nothing to sweep.
 *
 * Boots the real server (`buildServer`) rather than the route in isolation,
 * because `app.scheduler` only exists once the real plugin chain has run —
 * the same reason `contract-parity.test.ts` and `scheduler-lock.test.ts` boot
 * real servers rather than stubbing around them.
 */
import { describe, expect, it } from 'vitest';
import { startTestServer } from '../helpers/server.js';

interface SchedulerJobBody {
  name: string;
  interval_ms: number;
  enabled: boolean;
  last_run_at: string | null;
  last_status: string | null;
}

interface HealthBody {
  scheduler: { enabled: boolean; jobs: SchedulerJobBody[] };
}

describe('GET /health — scheduler', () => {
  it('lists every registered job, disabled by default under test', async () => {
    const server = await startTestServer();
    try {
      const response = await server.get('/health');
      expect(response.statusCode).toBe(200);
      const body = response.json() as HealthBody;

      expect(body.scheduler.enabled).toBe(false);
      expect(body.scheduler.jobs.map((job) => job.name)).toEqual([
        'chat_timeout',
        'sla',
        'siem',
        'scheduled_reports',
        'retention',
        'webhook_redelivery',
      ]);
      // Registered but never ticked — `SCHEDULER_ENABLED` defaults to off
      // under `NODE_ENV=test` (env.ts), same as every other suite's server.
      for (const job of body.scheduler.jobs) {
        expect(job.last_run_at).toBeNull();
      }
    } finally {
      await server.close();
    }
  });

  it('marks retention disabled from registration — no other job is gated', async () => {
    const server = await startTestServer();
    try {
      const body = (await server.get('/health')).json() as HealthBody;
      const byName = Object.fromEntries(body.scheduler.jobs.map((job) => [job.name, job]));

      expect(byName['retention']).toMatchObject({ enabled: false, last_status: 'disabled' });
      for (const name of [
        'chat_timeout',
        'sla',
        'siem',
        'scheduled_reports',
        'webhook_redelivery',
      ]) {
        expect(byName[name]).toMatchObject({ enabled: true, last_status: null });
      }
    } finally {
      await server.close();
    }
  });

  it('reflects SCHEDULER_ENABLED and RETENTION_ENABLED from the environment', async () => {
    const server = await startTestServer({ SCHEDULER_ENABLED: 'true', RETENTION_ENABLED: 'true' });
    try {
      const body = (await server.get('/health')).json() as HealthBody;

      expect(body.scheduler.enabled).toBe(true);
      expect(body.scheduler.jobs.every((job) => job.enabled)).toBe(true);
    } finally {
      // Stops the now-running scheduler (`onClose`) before the process moves
      // on — the same reason `scheduler.test.ts` never lets a started one
      // outlive its test.
      await server.close();
    }
  });
});
