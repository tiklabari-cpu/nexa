/**
 * Real, separate OS processes for the two-pod verification (M-SCALE-a).
 *
 * Every other suite in this repository builds its server *in* the test process
 * — `startTestServer` returns a Fastify instance, `startRtm` returns a gateway
 * object — and that is the right shape for almost everything, because almost
 * everything under test is a property of one instance. The three questions
 * M-SCALE-a asks are not: they are properties of a *fleet*, and a fleet is the
 * one thing a single process cannot honestly stand in for. Two `Scheduler`s
 * sharing an event loop can never actually tick at the same instant, so a lock
 * that held only because Node serialised them would look exactly like a lock
 * that works. Two gateway objects in one heap could pass a message between them
 * through any number of accidents that do not exist between two containers.
 *
 * So this spawns the real entrypoints — `apps/api/src/index.ts` and
 * `apps/rtm/src/index.ts`, the same files the Dockerfile runs — as child
 * processes, and the tests reach them only over HTTP and WebSocket.
 *
 * **The children share this run's datastores, which is the opposite of what the
 * harness normally does.** CONVENTIONS §1.1 gives every run its own
 * `nexa_test_<id>` database and its own Redis index precisely so two runs cannot
 * see each other; here two *processes* have to see each other or there is
 * nothing to measure. Both are true at once because the isolation happens one
 * level up: `with-test-datastores.ts` repoints `DATABASE_URL`,
 * `DATABASE_APP_URL` and `REDIS_URL` in the environment of the vitest process,
 * and a child inherits that environment. The fleet is therefore isolated from
 * every other run and shared within this one, with no bypass and no second copy
 * of the harness.
 *
 * Ports are reserved by binding an ephemeral socket and closing it, rather than
 * passing 0 to the child: `API_PORT` refuses 0 (`config/env.ts`), and the
 * gateway's boot line reports the port it was *configured* with, so a child that
 * picked its own would have no way to tell us which one it picked.
 */
import { spawn, type ChildProcess } from 'node:child_process';
import { createRequire } from 'node:module';
import { createServer, type AddressInfo, type Server } from 'node:net';
import { dirname, resolve } from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';
import { fileURLToPath, pathToFileURL } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
/** `apps/api` — the package this file lives in. */
const API_DIR = resolve(HERE, '../..');
const RTM_DIR = resolve(API_DIR, '../rtm');

/**
 * tsx's ESM loader, resolved rather than spelled: `node --import tsx` needs the
 * specifier to resolve from the *child's* working directory, and the two
 * children have different ones. An absolute `file://` URL resolves the same
 * from anywhere.
 */
const TSX_LOADER = pathToFileURL(createRequire(import.meta.url).resolve('tsx')).href;

/** Boot budget per pod. Generous: a cold tsx start transpiles the whole tree. */
const READY_TIMEOUT_MS = 60_000;
const READY_POLL_MS = 150;
/** How long a pod gets to exit on SIGTERM before it is taken out. */
const STOP_TIMEOUT_MS = 10_000;

export interface Pod {
  /** `api-a`, `rtm-b` — used in assertion messages and nothing else. */
  readonly name: string;
  readonly port: number;
  /** `http://127.0.0.1:<port>`, with no path. */
  readonly origin: string;
  /** Everything the process wrote to stdout and stderr, newest kept. */
  output: () => string;
  stop: () => Promise<void>;
}

/**
 * Reserve `count` ports nobody is listening on.
 *
 * There is a window between the close here and the bind in the child, and it is
 * accepted knowingly: the alternative is a fixed range, which collides with the
 * *other* windows CONVENTIONS §1.1 expects to be running at the same time. A
 * lost race surfaces as `EADDRINUSE` in the child's captured output, which
 * {@link startPod} puts in the failure message — noisy and obvious rather than
 * silent and confusing.
 */
export async function reserveFreePorts(count: number): Promise<number[]> {
  const servers = await Promise.all(
    Array.from(
      { length: count },
      () =>
        new Promise<Server>((resolvePort, reject) => {
          const server = createServer();
          server.once('error', reject);
          server.listen(0, '127.0.0.1', () => resolvePort(server));
        }),
    ),
  );

  const ports = servers.map((server) => (server.address() as AddressInfo).port);
  await Promise.all(
    servers.map((server) => new Promise<void>((done) => server.close(() => done()))),
  );
  return ports;
}

interface Exit {
  code: number | null;
  signal: NodeJS.Signals | null;
}

interface PodOptions {
  name: string;
  /** Directory the child runs in — its package's root, so `tsx` resolves. */
  cwd: string;
  /** Entry file, absolute. */
  entry: string;
  port: number;
  /** Path polled until it answers 2xx. */
  readyPath: string;
  env: NodeJS.ProcessEnv;
}

async function startPod(options: PodOptions): Promise<Pod> {
  const { name, cwd, entry, port, readyPath } = options;
  const origin = `http://127.0.0.1:${port}`;

  const child: ChildProcess = spawn(process.execPath, ['--import', TSX_LOADER, entry], {
    cwd,
    env: { ...process.env, ...options.env },
    stdio: ['ignore', 'pipe', 'pipe'],
    windowsHide: true,
  });

  let captured = '';
  const capture = (chunk: Buffer): void => {
    captured += chunk.toString();
    // Keep the tail: a boot failure says why on its last few lines, and an
    // unbounded buffer would hold a whole run's logs for a pod that is fine.
    if (captured.length > 32_000) captured = captured.slice(-32_000);
  };
  child.stdout?.on('data', capture);
  child.stderr?.on('data', capture);

  let exit: Exit | null = null;
  /**
   * Read through a function rather than off the variable: assigned only inside
   * the callback below, control-flow analysis narrows the binding itself to
   * `null` and every later `exit.code` stops compiling.
   */
  const exitedWith = (): Exit | null => exit;
  const exited = new Promise<void>((done) => {
    child.once('exit', (code, signal) => {
      exit = { code, signal };
      done();
    });
  });
  // Nothing awaits a spawn error directly; without a listener it would be an
  // unhandled 'error' event, which takes the whole vitest worker down.
  child.on('error', (error) => capture(Buffer.from(`spawn error: ${error.message}\n`)));

  const pod: Pod = {
    name,
    port,
    origin,
    output: () => captured,
    stop: async () => {
      if (exitedWith() !== null) return;
      child.kill('SIGTERM');
      const hammer = setTimeout(() => child.kill('SIGKILL'), STOP_TIMEOUT_MS);
      hammer.unref();
      await exited;
      clearTimeout(hammer);
    },
  };

  const deadline = Date.now() + READY_TIMEOUT_MS;
  for (;;) {
    const finished = exitedWith();
    if (finished !== null) {
      throw new Error(
        `${name} exited before it was ready (code ${String(finished.code)}, signal ${String(
          finished.signal,
        )})\n${captured}`,
      );
    }
    try {
      const response = await fetch(`${origin}${readyPath}`, { signal: AbortSignal.timeout(2_000) });
      if (response.ok) return pod;
    } catch {
      // Not listening yet, or listening and not ready — both mean "wait".
    }
    if (Date.now() > deadline) {
      await pod.stop();
      throw new Error(`${name} was not ready within ${READY_TIMEOUT_MS} ms\n${captured}`);
    }
    await delay(READY_POLL_MS);
  }
}

/**
 * Environment every pod gets, whatever it is.
 *
 * `NODE_ENV` rides in from the vitest process (`test`), which is what keeps the
 * children's provider defaults and the suite's own `testEnv()` in step. The two
 * providers are named for the same reason `testEnv` names them: a developer's
 * `.env` must not be able to make a spawned pod spool mail to disk.
 */
function sharedPodEnv(): NodeJS.ProcessEnv {
  return {
    LOG_LEVEL: 'warn',
    MAIL_PROVIDER: 'null',
    PUSH_PROVIDER: 'null',
  };
}

export async function startApiPod(
  name: string,
  port: number,
  env: NodeJS.ProcessEnv = {},
): Promise<Pod> {
  return startPod({
    name,
    cwd: API_DIR,
    entry: resolve(API_DIR, 'src/index.ts'),
    port,
    // Readiness, not liveness: `/health/live` answers before Postgres and Redis
    // have been reached, and a pod that is listening but cannot read is not a
    // pod a test can send anything to.
    readyPath: '/api/v1/health/ready',
    env: {
      ...sharedPodEnv(),
      API_PORT: String(port),
      API_HOST: '127.0.0.1',
      // Off unless a suite asks: five sweeps ticking against another test's
      // fixtures is the second writer nobody declared (the same reason the e2e
      // config turns them off).
      SCHEDULER_ENABLED: 'false',
      // Four pods behind one loopback address share one anonymous bucket, and
      // the limiter is Redis-backed, so it is shared across them too. The
      // limiter has its own suite; a 429 here would only ever be noise.
      RATE_LIMIT_ANON_PER_MIN: '2000',
      ...env,
    },
  });
}

export async function startRtmPod(
  name: string,
  port: number,
  env: NodeJS.ProcessEnv = {},
): Promise<Pod> {
  return startPod({
    name,
    cwd: RTM_DIR,
    entry: resolve(RTM_DIR, 'src/index.ts'),
    port,
    readyPath: '/health/ready',
    env: {
      ...sharedPodEnv(),
      RTM_PORT: String(port),
      RTM_HOST: '127.0.0.1',
      ...env,
    },
  });
}

/**
 * Stop every pod, and stop all of them even if one refuses.
 *
 * A pod left running holds its port and its share of the connection budget for
 * the rest of the run, so teardown that gives up on the first failure is how one
 * red test becomes a red file.
 */
export async function stopPods(pods: Pod[]): Promise<void> {
  await Promise.allSettled(pods.map((pod) => pod.stop()));
}

export interface PodResponse {
  status: number;
  body: unknown;
}

/**
 * A GET against a pod's root, with no API prefix — the gateway's `/health` is
 * not mounted under one.
 */
export async function podGet(
  pod: Pod,
  path: string,
  options: { token?: string } = {},
): Promise<PodResponse> {
  const headers: Record<string, string> = {};
  if (options.token) headers['authorization'] = `Bearer ${options.token}`;
  const response = await fetch(`${pod.origin}${path}`, {
    headers,
    signal: AbortSignal.timeout(15_000),
  });
  return { status: response.status, body: await readBody(response) };
}

/**
 * One REST call to a named pod.
 *
 * Real HTTP, not `app.inject()`: the question in this file is always "does it
 * matter *which* process answered", and an injected request never leaves the
 * one that made it.
 */
export async function podRequest(
  pod: Pod,
  method: 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE',
  path: string,
  options: { token?: string; body?: unknown } = {},
): Promise<PodResponse> {
  const headers: Record<string, string> = {};
  if (options.token) headers['authorization'] = `Bearer ${options.token}`;
  if (options.body !== undefined) headers['content-type'] = 'application/json';

  const response = await fetch(`${pod.origin}/api/v1${path}`, {
    method,
    headers,
    ...(options.body === undefined ? {} : { body: JSON.stringify(options.body) }),
    signal: AbortSignal.timeout(15_000),
  });

  return { status: response.status, body: await readBody(response) };
}

async function readBody(response: Response): Promise<unknown> {
  const text = await response.text();
  if (text.length === 0) return null;
  try {
    return JSON.parse(text);
  } catch {
    return text;
  }
}
