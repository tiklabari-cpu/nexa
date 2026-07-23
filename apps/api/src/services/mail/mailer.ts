/**
 * Outgoing mail — written to disk, never sent (PLAN assumption A4).
 *
 * A real SMTP client would be a dependency this project is not allowed to use
 * and a network call the tests could not rely on. Writing a file keeps the
 * *shape* honest — the code that needs to send an email calls something that
 * takes a recipient, a subject and a body, and swapping in a provider means
 * replacing one method — while making delivery inspectable: the tests read the
 * file back rather than asserting on a mock's call log, and a developer can see
 * the reset link they just asked for.
 */
import { mkdir, readdir, readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';

export interface Message {
  to: string;
  subject: string;
  body: string;
  /** Correlates a message with the thing that caused it, for tests and support. */
  kind: 'password_reset' | 'invitation';
}

export interface Mailer {
  send(message: Message): Promise<void>;
}

export class FileMailer implements Mailer {
  readonly #dir: string;

  constructor(dir: string) {
    this.#dir = dir;
  }

  async send(message: Message): Promise<void> {
    await mkdir(this.#dir, { recursive: true });
    const stamp = new Date().toISOString().replace(/[:.]/g, '-');
    await writeFile(
      join(this.#dir, `${stamp}-${message.kind}-${randomUUID().slice(0, 8)}.json`),
      JSON.stringify({ ...message, sent_at: new Date().toISOString() }, null, 2),
      'utf8',
    );
  }

  /** Test and developer affordance: what would have gone out, newest first. */
  async outbox(): Promise<Array<Message & { sent_at: string }>> {
    let names: string[];
    try {
      names = await readdir(this.#dir);
    } catch {
      return [];
    }
    const messages = await Promise.all(
      names
        .filter((n) => n.endsWith('.json'))
        .map(async (n) => JSON.parse(await readFile(join(this.#dir, n), 'utf8'))),
    );
    return messages.sort((a, b) => b.sent_at.localeCompare(a.sent_at));
  }
}

/**
 * Discards everything.
 *
 * Used by the test server so a suite that sends hundreds of invitations does
 * not leave hundreds of files behind; the tests that care about delivery use a
 * `FileMailer` pointed at a temporary directory.
 */
export class NullMailer implements Mailer {
  async send(): Promise<void> {
    // Intentionally empty.
  }
}
