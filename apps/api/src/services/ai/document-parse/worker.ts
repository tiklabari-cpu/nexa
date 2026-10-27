/**
 * Reading a PDF or Word document outside the API process (tm 313.2 ·
 * SiyahTuş analysis AI-18). `parseDocumentInWorker` is the only way a
 * document's bytes reach a parser: the job branch (tm 313.3) calls it and
 * chunks what comes back.
 *
 * Each document gets its own process (`worker-entry.ts`), and the process
 * gets nothing it does not need:
 *
 * - **A directory of its own.** The bytes are written to a fresh `0700`
 *   directory under the OS temp directory, which is also the process' working
 *   and temp directory; it is removed when the process has exited, however it
 *   ended.
 * - **No secrets.** The environment is an allow-list — `NODE_ENV`, the temp
 *   directory, and on Windows the two variables Node needs to start — never a
 *   copy of the API's, which holds the database URL and every key. Nor
 *   `NODE_OPTIONS`, nor the API's own Node flags.
 * - **30 seconds.** Past the deadline it is killed (`SIGKILL`, no grace):
 *   `parse_timeout`. Its watchdog thread keeps the same deadline, so a
 *   worker whose API process died ends itself.
 * - **256 MB.** V8's heap is capped at the same size, and the watchdog kills
 *   the process when its resident size passes it (pdf.js decodes streams
 *   into buffers outside the heap): `parse_timeout` too — the vocabulary's
 *   one word for "stopped for using too much".
 * - **No channel back but a file.** The job is its one argument; the answer
 *   is a reply file the API process reads only under {@link MAX_REPLY_BYTES},
 *   and its stderr, of which only the tail is kept. No IPC channel: over one
 *   a subverted parser could send a message the API process must hold whole
 *   before it can refuse it.
 *
 * The reply is not trusted because it came back: a parser a hostile file
 * subverted could answer anything. It is checked against its schema and
 * against the job (the type asked for, the ceilings, page numbers within the
 * page count, the character count the blocks actually add up to); anything
 * else is `parse_failed`.
 *
 * What this is not: an OS sandbox. The worker runs as the API's user with
 * the same file system view; the container is the boundary around both. What
 * the separation buys is that a parser's crash, hang or memory blow-up ends a
 * process that is not the API, with no credential in reach.
 */
import { spawn } from 'node:child_process';
import { mkdtemp, readFile, rm, stat, writeFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import { dirname, extname, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import {
  KNOWLEDGE_DOCUMENT_ERRORS,
  KNOWLEDGE_DOCUMENT_LIMITS,
  KNOWLEDGE_DOCUMENT_MIME_TYPES,
  type KnowledgeDocumentMimeType,
} from '@siyahtus/types';
import { z } from 'zod';
import { identifyKnowledgeDocument } from '../knowledge-document-type.js';
import {
  DOCUMENT_BLOCK_KINDS,
  DEADLINE_PASSED_MARKER,
  MAX_HEADING_LEVEL,
  MEMORY_EXCEEDED_MARKER,
  type DocumentParseErrorCode,
  type DocumentParseLimits,
  type DocumentWorkerJob,
  type DocumentWorkerReply,
  type ParsedDocument,
} from './types.js';

/** AI-18: a document that takes longer than this to read is stopped. */
export const DOCUMENT_WORKER_TIMEOUT_MS = 30_000;
/** AI-18: a document whose reading needs more than this is stopped. */
export const DOCUMENT_WORKER_MEMORY_BYTES = 256 * 1024 * 1024;
/** How much of the worker's stderr is kept to classify how it died (never logged). */
const STDERR_TAIL_BYTES = 4_096;

/** The logger a worker's failures go to; a Fastify or pino logger is one. */
export interface DocumentWorkerLogger {
  warn(object: Record<string, unknown>, message: string): void;
}

export interface DocumentWorkerOptions {
  timeoutMs?: number;
  memoryBytes?: number;
  limits?: DocumentParseLimits;
  /** Where the job's directory is made: the OS temp directory unless a test watches its own. */
  tmpRoot?: string;
  logger?: DocumentWorkerLogger;
}

/** How the worker process ran — for the log, and for a test to check nothing was left behind. */
export interface DocumentWorkerRun {
  pid: number | null;
  elapsedMs: number;
  exitCode: number | null;
  signal: string | null;
}

export type DocumentParseOutcome =
  | { ok: true; document: ParsedDocument; run: DocumentWorkerRun }
  | { ok: false; error: DocumentParseErrorCode; detail: string; run: DocumentWorkerRun | null };

/** The worker's program: the compiled `.js` beside this file, or the `.ts` source under tsx and vitest. */
function workerEntry(): string {
  const here = fileURLToPath(import.meta.url);
  return join(dirname(here), `worker-entry${extname(here)}`);
}

/**
 * The worker's Node flags, all module paths as absolute URLs (its working
 * directory is the job's empty one):
 *
 * - its heap ceiling;
 * - pdf.js and its worker half, preloaded — the worker half registers
 *   itself on `globalThis`, so pdf.js runs it in this thread instead of
 *   importing it;
 * - when it runs from TypeScript source (development and tests; the image
 *   runs compiled code), tsx's loader — **after** pdf.js, so tsx never sees
 *   it. Transformed by tsx, pdf.js' 3 MB of JavaScript started the worker at
 *   420 MB resident instead of 75 (measured), past the ceiling before a
 *   document was opened; loaded first, both modes run the same pdf.js.
 */
export function workerExecArgv(memoryBytes: number, entry: string): string[] {
  const require = createRequire(import.meta.url);
  const url = (specifier: string) => pathToFileURL(require.resolve(specifier)).href;
  const heapMb = Math.max(16, Math.floor(memoryBytes / (1024 * 1024)));
  const flags = [
    `--max-old-space-size=${heapMb}`,
    '--import',
    url('pdfjs-dist/legacy/build/pdf.worker.mjs'),
    '--import',
    url('pdfjs-dist/legacy/build/pdf.mjs'),
  ];
  if (entry.endsWith('.ts')) flags.push('--import', url('tsx'));
  return flags;
}

/** Windows will not start Node without these; they name system directories, not secrets. */
const WINDOWS_SYSTEM_VARIABLES = ['SystemRoot', 'windir'];

/** The worker's whole environment — an allow-list, never a filtered copy of `parent`. */
export function workerEnvironment(
  parent: NodeJS.ProcessEnv,
  directory: string,
  platform: NodeJS.Platform = process.platform,
): NodeJS.ProcessEnv {
  const env: NodeJS.ProcessEnv = {
    NODE_ENV: parent['NODE_ENV'] ?? 'production',
    TMPDIR: directory,
    TMP: directory,
    TEMP: directory,
  };
  if (platform === 'win32') {
    for (const name of WINDOWS_SYSTEM_VARIABLES) {
      const value = parent[name] ?? parent[name.toUpperCase()];
      if (value !== undefined) env[name] = value;
    }
  }
  return env;
}

const blockSchema = z
  .object({
    kind: z.enum(DOCUMENT_BLOCK_KINDS),
    level: z.number().int().min(1).max(MAX_HEADING_LEVEL).optional(),
    text: z.string().min(1),
    pageFrom: z.number().int().min(1),
    pageTo: z.number().int().min(1),
  })
  .strict();

const replySchema = z.discriminatedUnion('ok', [
  z
    .object({
      ok: z.literal(true),
      document: z
        .object({
          mime: z.enum(KNOWLEDGE_DOCUMENT_MIME_TYPES),
          pageCount: z.number().int().min(1),
          characterCount: z.number().int().min(1),
          blocks: z.array(blockSchema).min(1),
        })
        .strict(),
    })
    .strict(),
  z
    .object({
      ok: z.literal(false),
      error: z.enum(KNOWLEDGE_DOCUMENT_ERRORS).exclude(['virus_detected']),
      detail: z.string().regex(/^[a-z0-9_]{1,64}$/),
    })
    .strict(),
]);

/**
 * The worker's reply, checked: its shape, and that the document is the one
 * asked for and inside the ceilings. `null` for anything else.
 */
export function readWorkerReply(
  message: unknown,
  mime: KnowledgeDocumentMimeType,
  limits: DocumentParseLimits,
): DocumentWorkerReply | null {
  const parsed = replySchema.safeParse(message);
  if (!parsed.success) return null;
  if (!parsed.data.ok) return parsed.data;
  const { document } = parsed.data;
  if (document.mime !== mime || document.pageCount > limits.maxPages) return null;
  let characters = 0;
  for (const block of document.blocks) {
    if (block.pageFrom > block.pageTo || block.pageTo > document.pageCount) return null;
    if ((block.kind === 'heading') !== (block.level !== undefined)) return null;
    characters += block.text.length;
  }
  if (characters !== document.characterCount || characters > limits.maxChars) return null;
  return { ok: true, document };
}

/** What a worker process left behind when it ended. */
export interface DocumentWorkerExit {
  /** The reply file's content, parsed — `undefined` when the worker wrote none, `null` when it was not JSON or too large to be honest. */
  reply: unknown;
  /** The API process killed it at the deadline. */
  timedOut: boolean;
  code: number | null;
  signal: NodeJS.Signals | null;
  /** The last few KB of its stderr: what the watchdog and V8 say when they stop it. Never logged. */
  stderr: string;
  pid: number | null;
}

/**
 * The largest reply file read. A million characters of blocks is a few MB of
 * JSON; a worker that writes more is not answering, it is trying to make the
 * API process read it.
 */
export const MAX_REPLY_BYTES = 16 * 1024 * 1024;

/** The reply a worker wrote to `path`: `undefined` if none, `null` if over {@link MAX_REPLY_BYTES} or not JSON. */
export async function readReplyFile(path: string): Promise<unknown> {
  let size: number;
  try {
    size = (await stat(path)).size;
  } catch {
    return undefined;
  }
  if (size > MAX_REPLY_BYTES) return null;
  try {
    return JSON.parse(await readFile(path, 'utf8')) as unknown;
  } catch {
    return null;
  }
}

/**
 * Runs one worker process on `job` (its document already in `directory`)
 * and waits for it to end — killing it at `timeoutMs` — then reads what it
 * left. There is no channel back from the worker but its reply file and its
 * stderr, and the API process reads both bounded: an IPC channel would let a
 * subverted parser send a message the API process has to hold whole before
 * it can refuse it. Rejects only when no process could be started.
 */
export function runDocumentWorker(
  job: DocumentWorkerJob,
  directory: string,
  timeoutMs: number,
): Promise<DocumentWorkerExit> {
  const entry = workerEntry();
  const child = spawn(
    process.execPath,
    [...workerExecArgv(job.memoryBytes, entry), entry, JSON.stringify(job)],
    {
      cwd: directory,
      env: workerEnvironment(process.env, directory),
      stdio: ['ignore', 'ignore', 'pipe'],
      windowsHide: true,
    },
  );

  return new Promise<DocumentWorkerExit>((resolve, reject) => {
    let timedOut = false;
    let stderr = '';
    const timer = setTimeout(() => {
      timedOut = true;
      child.kill('SIGKILL');
    }, timeoutMs);

    child.stderr?.setEncoding('utf8');
    child.stderr?.on('data', (chunk: string) => {
      stderr = (stderr + chunk).slice(-STDERR_TAIL_BYTES);
    });
    child.once('error', (error) => {
      // Only a process that never started ends here; one that did still closes.
      if (child.pid === undefined) {
        clearTimeout(timer);
        reject(error);
      }
    });
    child.once('close', (code, signal) => {
      clearTimeout(timer);
      void readReplyFile(job.replyPath).then((reply) =>
        resolve({ reply, timedOut, code, signal, stderr, pid: child.pid ?? null }),
      );
    });
  });
}

/** Why a worker that left no reply stopped. */
function classify(exit: DocumentWorkerExit): { error: DocumentParseErrorCode; detail: string } {
  if (exit.timedOut || exit.stderr.includes(DEADLINE_PASSED_MARKER)) {
    return { error: 'parse_timeout', detail: 'timeout' };
  }
  const outOfMemory =
    exit.stderr.includes(MEMORY_EXCEEDED_MARKER) ||
    /heap out of memory|Reached heap limit/i.test(exit.stderr) ||
    exit.signal === 'SIGKILL'; // the API process did not send it: the watchdog or the kernel's OOM killer
  return outOfMemory
    ? { error: 'parse_timeout', detail: 'memory' }
    : { error: 'parse_failed', detail: 'worker_crashed' };
}

/**
 * Reads `bytes`, a document of type `mime`, in a worker process of its own
 * and returns its blocks — or the refusal, with a detail for the log. Throws
 * only when no worker could be started (an infrastructure fault, not the
 * document's: the job should be retried).
 */
export async function parseDocumentInWorker(
  bytes: Buffer,
  mime: KnowledgeDocumentMimeType,
  options: DocumentWorkerOptions = {},
): Promise<DocumentParseOutcome> {
  const limits = options.limits ?? {
    maxPages: KNOWLEDGE_DOCUMENT_LIMITS.maxPages,
    maxChars: KNOWLEDGE_DOCUMENT_LIMITS.maxChars,
  };
  if (bytes.length > KNOWLEDGE_DOCUMENT_LIMITS.maxBytes) {
    return { ok: false, error: 'file_too_large', detail: 'over_limit', run: null };
  }
  // The upload checked this; the worker is handed only what is still true.
  const type = identifyKnowledgeDocument(bytes);
  if (!type.ok || type.mime !== mime) {
    return {
      ok: false,
      error: 'unsupported_type',
      detail: type.ok ? 'type_mismatch' : type.why,
      run: null,
    };
  }

  const directory = await mkdtemp(join(options.tmpRoot ?? tmpdir(), 'siyahtus-document-'));
  const started = Date.now();
  try {
    const path = join(directory, 'document');
    await writeFile(path, bytes, { mode: 0o600 });
    const timeoutMs = options.timeoutMs ?? DOCUMENT_WORKER_TIMEOUT_MS;
    const exit = await runDocumentWorker(
      {
        path,
        replyPath: join(directory, 'reply.json'),
        mime,
        limits,
        memoryBytes: options.memoryBytes ?? DOCUMENT_WORKER_MEMORY_BYTES,
        timeoutMs,
      },
      directory,
      timeoutMs,
    );
    const run: DocumentWorkerRun = {
      pid: exit.pid,
      elapsedMs: Date.now() - started,
      exitCode: exit.code,
      signal: exit.signal,
    };

    // A reply written in time is the answer, however the process then ended.
    if (exit.reply !== undefined && !exit.timedOut) {
      const reply = readWorkerReply(exit.reply, mime, limits);
      if (reply === null) {
        options.logger?.warn(
          { elapsed_ms: run.elapsedMs },
          'document worker sent an invalid reply',
        );
        return { ok: false, error: 'parse_failed', detail: 'invalid_reply', run };
      }
      return { ...reply, run };
    }
    const { error, detail } = classify(exit);
    options.logger?.warn(
      { reason: detail, elapsed_ms: run.elapsedMs, exit_code: run.exitCode, signal: run.signal },
      'document worker stopped without an answer',
    );
    return { ok: false, error, detail, run };
  } finally {
    await rm(directory, { recursive: true, force: true, maxRetries: 3 });
  }
}
