/**
 * The document worker process (tm 313.2 · AI-18): every document read in a
 * process of its own, with an allow-listed environment, a directory of its
 * own, 30 seconds and 256 MB — and an API process that a parser's hang or
 * blow-up does not touch.
 *
 * These start real worker processes.
 */
import { randomBytes } from 'node:crypto';
import { mkdtemp, readdir, rm, truncate, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { KNOWLEDGE_DOCUMENT_DOCX, KNOWLEDGE_DOCUMENT_PDF } from '@siyahtus/types';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  EXE,
  docm,
  inflatingContent,
  linesPdf,
  pdfDocument,
  pdfText,
  wParagraph,
  wTable,
  wordDocument,
} from '../../../../test/helpers/document-fixtures.js';
import { DEADLINE_PASSED_MARKER } from './types.js';
import {
  DOCUMENT_WORKER_MEMORY_BYTES,
  DOCUMENT_WORKER_TIMEOUT_MS,
  MAX_REPLY_BYTES,
  parseDocumentInWorker,
  readReplyFile,
  readWorkerReply,
  runDocumentWorker,
  workerEnvironment,
  workerExecArgv,
} from './worker.js';

let tmpRoot: string;
beforeEach(async () => {
  tmpRoot = await mkdtemp(join(tmpdir(), 'document-worker-test-'));
});
afterEach(async () => {
  await rm(tmpRoot, { recursive: true, force: true });
});

// Past the 50-character average a page needs to count as text.
const TEXT = [
  { text: 'A refund is paid within fourteen days of a written request to support.', y: 700 },
];

/** AI-18's acceptance document: 120 pages of text, 15 MB with a photo's worth of samples on each. */
function policyPdf(): Buffer {
  const pages = Array.from({ length: 120 }, (_, i) => ({
    content: [
      'q 205 0 0 205 340 80 cm /Im1 Do Q',
      pdfText(
        Array.from({ length: 40 }, (_, line) => ({
          text: `Clause ${i + 1}.${line + 1}: a player may close the account at any time from settings.`,
          size: 10,
          y: 760 - line * 17,
        })),
      ),
    ].join('\n'),
    image: { width: 205, height: 205, rgb: randomBytes(205 * 205 * 3) },
  }));
  return pdfDocument(pages);
}

function gone(pid: number | null): boolean {
  if (pid === null) return false;
  try {
    process.kill(pid, 0);
    return false;
  } catch {
    return true;
  }
}

describe('parseDocumentInWorker', () => {
  it('reads a PDF and a DOCX each in a process of its own, leaving no directory behind (FR-MOD-06.3.2)', async () => {
    const pdf = await parseDocumentInWorker(linesPdf([TEXT]), KNOWLEDGE_DOCUMENT_PDF, { tmpRoot });
    expect(pdf).toMatchObject({
      ok: true,
      document: { mime: KNOWLEDGE_DOCUMENT_PDF, pageCount: 1, blocks: [{ text: TEXT[0]!.text }] },
      run: { exitCode: 0 },
    });
    expect(pdf.run!.pid).not.toBe(process.pid);
    expect(gone(pdf.run!.pid)).toBe(true);

    const docx = await parseDocumentInWorker(
      wordDocument({
        body:
          wParagraph('Fees') +
          wTable([
            ['Plan', 'Fee'],
            ['Gold', '0%'],
          ]),
      }),
      KNOWLEDGE_DOCUMENT_DOCX,
      { tmpRoot },
    );
    expect(docx.ok && docx.document.blocks.map((b) => b.text)).toEqual([
      'Fees',
      '| Plan | Fee |',
      '| Gold | 0% |',
    ]);
    expect(await readdir(tmpRoot)).toEqual([]);
  });

  it('reads a 15 MB, 120-page text PDF within 30 s and 256 MB, every block on its own page (FR-MOD-06.3.2)', async () => {
    const bytes = policyPdf();
    expect(bytes.length).toBeGreaterThan(15_000_000);

    const outcome = await parseDocumentInWorker(bytes, KNOWLEDGE_DOCUMENT_PDF, { tmpRoot });
    if (!outcome.ok) throw new Error(`${outcome.error}: ${outcome.detail}`);
    expect(outcome.document.pageCount).toBe(120);
    expect(new Set(outcome.document.blocks.map((b) => b.pageFrom)).size).toBe(120);
    for (const page of [1, 60, 120]) {
      const block = outcome.document.blocks.find((b) => b.text.includes(`Clause ${page}.17:`));
      expect(block).toMatchObject({ pageFrom: page, pageTo: page });
    }
    expect(outcome.run.elapsedMs).toBeLessThan(DOCUMENT_WORKER_TIMEOUT_MS);
  });

  it('stops a parse past its deadline: parse_timeout, the process killed, the directory gone (FR-MOD-06.3.2)', async () => {
    const outcome = await parseDocumentInWorker(linesPdf([TEXT]), KNOWLEDGE_DOCUMENT_PDF, {
      tmpRoot,
      timeoutMs: 50,
    });
    expect(outcome).toMatchObject({ ok: false, error: 'parse_timeout', detail: 'timeout' });
    expect(gone(outcome.run!.pid)).toBe(true);
    expect(await readdir(tmpRoot)).toEqual([]);
  });

  it('stops a compression bomb past 256 MB without the API process growing or stalling (FR-MOD-06.3.2)', async () => {
    // ~1 MB of file that inflates to 1 GiB of content stream.
    const bomb = pdfDocument([{ content: inflatingContent(1024) }]);
    expect(bomb.length).toBeLessThan(2 * 1024 * 1024);

    const rssBefore = process.memoryUsage.rss();
    let ticks = 0;
    const started = Date.now();
    const interval = setInterval(() => (ticks += 1), 20);
    let outcome;
    try {
      outcome = await parseDocumentInWorker(bomb, KNOWLEDGE_DOCUMENT_PDF, { tmpRoot });
    } finally {
      clearInterval(interval);
    }
    const elapsed = Date.now() - started;

    expect(outcome).toMatchObject({ ok: false, error: 'parse_timeout', detail: 'memory' });
    expect(gone(outcome.run!.pid)).toBe(true);
    // The gigabyte was the worker's: this process barely moved, and its timers kept firing.
    expect(process.memoryUsage.rss() - rssBefore).toBeLessThan(64 * 1024 * 1024);
    expect(ticks).toBeGreaterThan((elapsed / 20) * 0.3);
    expect(await readdir(tmpRoot)).toEqual([]);
  });

  it('carries a reader refusal back: an encrypted PDF', async () => {
    const locked = linesPdf([TEXT], {
      encrypt: { userPassword: 'secret', ownerPassword: 'owner' },
    });
    expect(await parseDocumentInWorker(locked, KNOWLEDGE_DOCUMENT_PDF, { tmpRoot })).toMatchObject({
      ok: false,
      error: 'encrypted',
    });
  });

  it('starts no worker for bytes that are not the declared type, a macro document or a file over 20 MiB', async () => {
    const cases: [Buffer, string, string][] = [
      [EXE, KNOWLEDGE_DOCUMENT_PDF, 'unsupported_type'],
      [linesPdf([TEXT]), KNOWLEDGE_DOCUMENT_DOCX, 'unsupported_type'],
      [docm(['Macro document']), KNOWLEDGE_DOCUMENT_DOCX, 'unsupported_type'],
      [Buffer.alloc(20 * 1024 * 1024 + 1, 0x25), KNOWLEDGE_DOCUMENT_PDF, 'file_too_large'],
    ];
    for (const [bytes, mime, error] of cases) {
      const outcome = await parseDocumentInWorker(bytes, mime as typeof KNOWLEDGE_DOCUMENT_PDF, {
        tmpRoot,
      });
      expect(outcome).toMatchObject({ ok: false, error, run: null });
    }
    expect(await readdir(tmpRoot)).toEqual([]);
  });
});

describe('the worker process', () => {
  /** One worker on AI-18's 120-page PDF (~0.7 s of reading), with its own deadline and this process' set apart. */
  async function runOnPolicy(workerTimeoutMs: number, parentTimeoutMs: number) {
    const path = join(tmpRoot, 'document');
    await writeFile(path, policyPdf());
    return runDocumentWorker(
      {
        path,
        replyPath: join(tmpRoot, 'reply.json'),
        mime: KNOWLEDGE_DOCUMENT_PDF,
        limits: { maxPages: 300, maxChars: 1_000_000 },
        memoryBytes: DOCUMENT_WORKER_MEMORY_BYTES,
        timeoutMs: workerTimeoutMs,
      },
      tmpRoot,
      parentTimeoutMs,
    );
  }

  it('is killed at the deadline from outside, whatever the worker does', async () => {
    const exit = await runOnPolicy(60_000, 50);
    expect(exit.timedOut).toBe(true);
    expect(exit.stderr).not.toContain(DEADLINE_PASSED_MARKER);
    expect(exit.reply).toBeUndefined();
    expect(gone(exit.pid)).toBe(true);
  });

  it('ends itself at its own deadline, should the API process not kill it', async () => {
    // The watchdog's first 25 ms tick comes long before the reply would.
    const exit = await runOnPolicy(1, 20_000);
    expect(exit.timedOut).toBe(false);
    expect(exit.stderr).toContain(DEADLINE_PASSED_MARKER);
    expect(exit.reply).toBeUndefined();
    expect(gone(exit.pid)).toBe(true);
  });

  it('reads a reply file only when it is small enough to be honest', async () => {
    const path = join(tmpRoot, 'reply.json');
    expect(await readReplyFile(path)).toBeUndefined();
    await writeFile(path, '{"ok":false,"error":"parse_failed","detail":"x"}');
    expect(await readReplyFile(path)).toEqual({ ok: false, error: 'parse_failed', detail: 'x' });
    await writeFile(path, '{"ok":');
    expect(await readReplyFile(path)).toBeNull();
    // Valid JSON, one byte past the ceiling: refused by its size, not by its content.
    const filler = 'x'.repeat(MAX_REPLY_BYTES);
    await writeFile(path, `{"ok":false,"error":"parse_failed","detail":"${filler}"}`);
    expect(await readReplyFile(path)).toBeNull();
    await truncate(path, MAX_REPLY_BYTES); // now within it: read, parsed (and found not JSON)
    expect(await readReplyFile(path)).toBeNull();
  });

  it('runs with 30 seconds and 256 MB, AI-18', () => {
    expect(DOCUMENT_WORKER_TIMEOUT_MS).toBe(30_000);
    expect(DOCUMENT_WORKER_MEMORY_BYTES).toBe(256 * 1024 * 1024);
    const flags = workerExecArgv(DOCUMENT_WORKER_MEMORY_BYTES, '/app/dist/worker-entry.js');
    expect(flags[0]).toBe('--max-old-space-size=256');
    expect(flags.filter((flag) => flag === '--import')).toHaveLength(2); // pdf.js' two halves
    expect(flags.some((flag) => flag.includes('tsx'))).toBe(false);
    // From source, tsx comes after pdf.js, so it never transforms it.
    const source = workerExecArgv(DOCUMENT_WORKER_MEMORY_BYTES, '/repo/src/worker-entry.ts');
    expect(source.at(-1)).toMatch(/tsx/);
    expect(source.findIndex((f) => f.includes('pdf.mjs'))).toBeLessThan(source.length - 2);
  });

  it('gets an allow-listed environment — never a secret of the API process', () => {
    const parent = {
      NODE_ENV: 'production',
      DATABASE_URL: 'postgresql://siyahtus:secret@db/siyahtus',
      REDIS_URL: 'redis://redis:6379',
      AI_API_KEY: 'sk-live-123',
      UPLOAD_SIGNING_KEY: 'k',
      NODE_OPTIONS: '--require /tmp/hook.js',
      PATH: '/usr/bin',
      SystemRoot: 'C:\\Windows',
      windir: 'C:\\Windows',
    };
    expect(workerEnvironment(parent, '/tmp/job', 'linux')).toEqual({
      NODE_ENV: 'production',
      TMPDIR: '/tmp/job',
      TMP: '/tmp/job',
      TEMP: '/tmp/job',
    });
    expect(Object.keys(workerEnvironment(parent, 'C:\\job', 'win32')).sort()).toEqual([
      'NODE_ENV',
      'SystemRoot',
      'TEMP',
      'TMP',
      'TMPDIR',
      'windir',
    ]);
  });

  it('trusts no reply it cannot check against the job', () => {
    const limits = { maxPages: 300, maxChars: 1_000_000 };
    const block = { kind: 'paragraph', text: 'abc', pageFrom: 1, pageTo: 1 };
    const reply = (document: Record<string, unknown>) => ({
      ok: true,
      document: {
        mime: KNOWLEDGE_DOCUMENT_PDF,
        pageCount: 1,
        characterCount: 3,
        blocks: [block],
        ...document,
      },
    });
    expect(readWorkerReply(reply({}), KNOWLEDGE_DOCUMENT_PDF, limits)).toMatchObject({ ok: true });
    for (const bad of [
      reply({ mime: KNOWLEDGE_DOCUMENT_DOCX }), // not the type asked for
      reply({ characterCount: 2 }), // does not add up
      reply({ blocks: [{ ...block, pageTo: 2 }] }), // past the page count
      reply({ blocks: [{ ...block, kind: 'heading' }] }), // a heading with no level
      reply({ blocks: [{ ...block, script: 'x' }] }), // an unknown field
      reply({ pageCount: 301 }), // past the ceiling
      { ok: false, error: 'virus_detected', detail: 'x' }, // never the worker's to say
      { ok: false, error: 'parse_failed', detail: 'has spaces in it' },
      'not even an object',
    ]) {
      expect(readWorkerReply(bad, KNOWLEDGE_DOCUMENT_PDF, limits)).toBeNull();
    }
    expect(
      readWorkerReply(
        { ok: false, error: 'no_text_layer', detail: 'below_average' },
        KNOWLEDGE_DOCUMENT_PDF,
        limits,
      ),
    ).toEqual({ ok: false, error: 'no_text_layer', detail: 'below_average' });
  });
});
