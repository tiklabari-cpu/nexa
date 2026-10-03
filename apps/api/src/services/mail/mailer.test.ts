/**
 * `MAIL_PROVIDER` selects a mailer (M-PROV-a · §D113/K3).
 *
 * The regression this guards is the one the finding named: the key was parsed,
 * validated and never read, while `server.ts` picked the implementation off
 * `NODE_ENV`. A test that only asserted `createMailer('file', …)` returns a
 * `FileMailer` would have passed against that code too, since the function did
 * not exist to be wrong — so each case below checks the *behaviour* the value
 * promises (a message on disk, or nothing on disk), which is the thing an
 * operator setting the key is actually asking for.
 */
import { mkdtemp, readdir, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createMailer, FileMailer, MAIL_PROVIDERS, NullMailer } from './mailer.js';
import { SmtpMailer, type SmtpConfig } from './smtp-mailer.js';

/** Never connected to: these tests only ask which mailer the factory builds. */
const SMTP: SmtpConfig = {
  host: '127.0.0.1',
  port: 587,
  secure: false,
  username: 'info@nolnk.test',
  password: 'not-a-real-password',
  from: 'info@nolnk.test',
  timeoutMs: 1000,
};

const SILENT = { debug() {}, info() {}, warn() {}, error() {} };

const MESSAGE = {
  to: 'someone@example.test',
  subject: 'Reset your password',
  body: 'https://app.example.test/reset-password?token=x',
  licenseId: null,
  kind: 'password_reset',
} as const;

describe('createMailer', () => {
  let dir: string;

  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), 'siyahtus-mailer-factory-'));
  });

  afterEach(async () => {
    await rm(dir, { recursive: true, force: true });
  });

  it('writes the message to MAIL_DIR for "file"', async () => {
    const mailer = createMailer('file', { dir });
    expect(mailer).toBeInstanceOf(FileMailer);

    await mailer.send(MESSAGE);

    const written = await readdir(dir);
    expect(written).toHaveLength(1);
    expect(written[0]).toContain('password_reset');
  });

  it('spools the licence as text and reads it back as a bigint, null for account mail (tm 257.14)', async () => {
    const mailer = new FileMailer(dir);
    await mailer.send({ ...MESSAGE, licenseId: 9_007_199_254_740_993n, kind: 'invitation' });
    await mailer.send({ ...MESSAGE, licenseId: null });

    const [file] = (await readdir(dir)).filter((name) => name.includes('invitation'));
    const raw = JSON.parse(await readFile(join(dir, file!), 'utf8')) as Record<string, unknown>;
    expect(raw['licenseId']).toBe('9007199254740993');

    const byKind = Object.fromEntries((await mailer.outbox()).map((m) => [m.kind, m.licenseId]));
    expect(byKind).toEqual({ invitation: 9_007_199_254_740_993n, password_reset: null });
  });

  it('keeps nothing for "null"', async () => {
    const mailer = createMailer('null', { dir });
    expect(mailer).toBeInstanceOf(NullMailer);

    await mailer.send(MESSAGE);

    // Not merely "no files" — the directory the file provider would have used
    // was never even created, so this cannot pass by writing somewhere else.
    await expect(readdir(dir)).resolves.toEqual([]);
  });

  it('has an implementation for every value the vocabulary allows', () => {
    // The list and the factory are read from opposite ends: `env.ts` builds its
    // zod enum off `MAIL_PROVIDERS`, so a value added there without a case here
    // would be a setting that boots fine and then picks nothing. The `switch`
    // is exhaustive at compile time; this is the runtime half of the same claim.
    for (const provider of MAIL_PROVIDERS) {
      expect(createMailer(provider, { dir, smtp: SMTP, logger: SILENT })).toBeDefined();
    }
    expect(MAIL_PROVIDERS).toEqual(['file', 'null', 'smtp']);
  });

  it('builds the SMTP carrier for "smtp" (tm 255.3)', () => {
    expect(createMailer('smtp', { dir, smtp: SMTP, logger: SILENT })).toBeInstanceOf(SmtpMailer);
  });

  it('refuses a sender that is not a bare address at construction, not on the first send', () => {
    expect(() =>
      createMailer('smtp', {
        dir,
        smtp: { ...SMTP, from: 'SiyahTuş <info@nolnk.test>' },
        logger: SILENT,
      }),
    ).toThrow(/SMTP_FROM/);
  });

  it('throws for "smtp" without its configuration instead of silently falling back to "file" (tm 255.2 · 255.3)', async () => {
    expect(() => createMailer('smtp', { dir })).toThrow(/smtp/i);
    expect(() => createMailer('smtp', { dir, smtp: null })).toThrow(/SMTP_HOST/);

    // Not merely "it throws" — confirm the throw happens before anything is
    // spooled, so a caller that swallowed the error could not mistake this
    // for a silent success.
    await expect(readdir(dir)).resolves.toEqual([]);
  });
});
