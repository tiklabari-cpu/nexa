/**
 * The simulation context (tm 314.2 · SiyahTuş analysis AI-19 §6): the one
 * flag that tells every write path a test scenario or a sandbox turn is being
 * played, so that the path refuses.
 *
 * A simulation plays the live engine's turn on the workspace's own
 * configuration. The engine writes nothing by contract (`conversation/turn.ts`);
 * this is what holds the contract when something inside a turn forgets it — a
 * new step, a helper that grew a write. Played inside the context, nothing may
 * write a chat, a thread, an event, a customer, a rating, a `skill_runs` row or
 * `skills.runs_count`, a billing counter or the live AI meter, push to RTM,
 * call a webhook or send mail. What a simulation produces — its results, a
 * sandbox session's state — is written by the runner after the turn, outside
 * the context.
 *
 *   - {@link runInSimulation} sets the flag for everything its function
 *     awaits. It follows the async chain (`AsyncLocalStorage`), so it never
 *     reaches a request running beside it, and a promise the turn left behind
 *     keeps it.
 *   - Each guarded path calls {@link refuseInSimulation} first and throws
 *     {@link SimulationWriteRefusedError} inside the context:
 *       - `database` — `withTenant` opens no writable transaction
 *         (`lib/tenant.ts`); the one allowed write is the test meter's
 *         counters (`ai-daily-budget.ts`), and the turn's own runner is a
 *         read-only transaction besides;
 *       - `live_meter` — the AI budget reserves nothing on a live meter: a
 *         simulation is counted on the test meter alone (AI-19-S2);
 *       - `realtime` — `RealtimePublisher.publish`, the RTM fan-out;
 *       - `webhook` — `WebhookDispatcher.dispatch` and every outbound attempt;
 *       - `mail` — `CappedMailer.send`, which every mail goes through.
 *
 * A refusal is a defect, never a turn's outcome: the scenario it happened in
 * is `errored` and the log names the path.
 */
import { AsyncLocalStorage } from 'node:async_hooks';

/** The write paths a simulation is refused on — see the file header. */
export const SIMULATION_GUARDED_PATHS = [
  'database',
  'live_meter',
  'realtime',
  'webhook',
  'mail',
] as const;
export type SimulationGuardedPath = (typeof SIMULATION_GUARDED_PATHS)[number];

/** What is being played: a run's scenario or a sandbox session's turn. */
export interface SimulationScope {
  readonly kind: 'test_run' | 'sandbox';
  readonly licenseId: bigint;
}

export class SimulationWriteRefusedError extends Error {
  constructor(
    readonly path: SimulationGuardedPath,
    readonly scope: SimulationScope,
  ) {
    super(`a simulation (${scope.kind}) may not write: ${path}`);
    this.name = 'SimulationWriteRefusedError';
  }
}

const storage = new AsyncLocalStorage<SimulationScope>();

/** Run `fn` inside the simulation context. Nested calls keep the innermost scope. */
export function runInSimulation<T>(scope: SimulationScope, fn: () => Promise<T>): Promise<T> {
  return storage.run(scope, fn);
}

/** The simulation being played here, or null outside one. */
export function simulationScope(): SimulationScope | null {
  return storage.getStore() ?? null;
}

/** Throw {@link SimulationWriteRefusedError} when called inside a simulation. */
export function refuseInSimulation(path: SimulationGuardedPath): void {
  const scope = storage.getStore();
  if (scope !== undefined) throw new SimulationWriteRefusedError(path, scope);
}
