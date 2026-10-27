/**
 * The document worker process (tm 313.2 · SiyahTuş analysis AI-18) — the
 * program `worker.ts` starts for each document. Nothing in the API process
 * imports it.
 *
 * It takes its job as its one argument, reads the file from the job's
 * directory, parses it with `pdf.ts` or `docx.ts`, writes one reply file
 * beside it and exits. It has no channel to the API process but that file
 * and its stderr, and holds no secret (its environment is an allow-list
 * without one), no database or Redis connection and no logger: a parser that
 * a hostile file took over finds a process with nothing to read but the file
 * it was given.
 *
 * Its ceilings are watched from inside too, by a thread that does nothing
 * else: the parse runs on this process' main thread, often in one synchronous
 * stretch (a stream inflating, a font being read) during which no timer of
 * that thread could fire — a second thread's can. It reads the process'
 * resident size, so it counts what V8's own heap limit
 * (`--max-old-space-size`, set too) does not: the buffers pdf.js decodes
 * streams into. And it keeps the deadline the API process keeps, so a worker
 * whose API process died does not outlive it by more than the job's time.
 * Past either it writes a marker to stderr and kills the process outright.
 */
import { readFile, rename, writeFile } from 'node:fs/promises';
import { Worker } from 'node:worker_threads';
import { KNOWLEDGE_DOCUMENT_PDF } from '@siyahtus/types';
import { parseDocx } from './docx.js';
import { parsePdf } from './pdf.js';
import {
  DEADLINE_PASSED_MARKER,
  DocumentParseError,
  MEMORY_EXCEEDED_MARKER,
  type DocumentWorkerJob,
  type DocumentWorkerReply,
} from './types.js';

/** How often the watchdog reads the resident size and the clock. */
const WATCHDOG_INTERVAL_MS = 25;

const WATCHDOG_SOURCE = `
const { workerData } = require('node:worker_threads');
const { writeSync } = require('node:fs');
const stop = (marker) => {
  try { writeSync(2, marker + '\\n'); } catch {}
  process.kill(process.pid, 'SIGKILL');
};
setInterval(() => {
  if (process.memoryUsage.rss() > workerData.limit) stop(workerData.memoryMarker);
  if (Date.now() > workerData.deadline) stop(workerData.deadlineMarker);
}, workerData.interval);
`;

function startWatchdog(job: DocumentWorkerJob): void {
  const watchdog = new Worker(WATCHDOG_SOURCE, {
    eval: true,
    execArgv: [],
    workerData: {
      limit: job.memoryBytes,
      deadline: Date.now() + job.timeoutMs,
      interval: WATCHDOG_INTERVAL_MS,
      memoryMarker: MEMORY_EXCEEDED_MARKER,
      deadlineMarker: DEADLINE_PASSED_MARKER,
    },
  });
  // The parse finishing is what ends the process, not the watchdog.
  watchdog.unref();
}

let replied = false;

/** Writes the one reply — whole or not at all: a temporary file renamed into place — and exits. */
function reply(job: DocumentWorkerJob, message: DocumentWorkerReply): void {
  if (replied) return;
  replied = true;
  const partial = `${job.replyPath}.partial`;
  writeFile(partial, JSON.stringify(message), { mode: 0o600 })
    .then(() => rename(partial, job.replyPath))
    .then(
      () => process.exit(0),
      () => process.exit(1),
    );
}

function failed(error: unknown): DocumentWorkerReply {
  if (error instanceof DocumentParseError) {
    return { ok: false, error: error.code, detail: error.detail };
  }
  // A reader's own exception says nothing a log needs and may quote the file.
  return { ok: false, error: 'parse_failed', detail: 'reader_exception' };
}

async function run(job: DocumentWorkerJob): Promise<void> {
  startWatchdog(job);
  process.on('uncaughtException', (error) => reply(job, failed(error)));
  process.on('unhandledRejection', (error) => reply(job, failed(error)));
  try {
    const bytes = await readFile(job.path);
    const document =
      job.mime === KNOWLEDGE_DOCUMENT_PDF
        ? await parsePdf(bytes, job.limits)
        : parseDocx(bytes, job.limits);
    reply(job, { ok: true, document });
  } catch (error) {
    reply(job, failed(error));
  }
}

void run(JSON.parse(process.argv[2] ?? '{}') as DocumentWorkerJob);
