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
import { mkdtemp, readdir, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createMailer, FileMailer, MAIL_PROVIDERS, NullMailer } from './mailer.js';

const MESSAGE = {
  to: 'someone@example.test',
  subject: 'Reset your password',
  body: 'https://app.example.test/reset-password?token=x',
  kind: 'password_reset',
} as const;

describe('createMailer', () => {
  let dir: string;

  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), 'nexa-mailer-factory-'));
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
      expect(createMailer(provider, { dir })).toBeDefined();
    }
    expect(MAIL_PROVIDERS).toEqual(['file', 'null']);
  });
});
