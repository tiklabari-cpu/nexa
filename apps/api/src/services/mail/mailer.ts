/**
 * Outgoing mail — written to disk by default, sent only when asked (PLAN
 * assumption A4 · tm 255.3).
 *
 * Writing a file keeps the *shape* honest — the code that needs to send an
 * email calls something that takes a recipient, a subject and a body, and
 * swapping in a provider means replacing one method — while making delivery
 * inspectable: the tests read the file back rather than asserting on a mock's
 * call log, and a developer can see the reset link they just asked for. That is
 * still the default. `smtp` is the swap A4 promised (`smtp-mailer.ts`): the
 * same method, a carrier that really sends, and the only mailer that can fail.
 */
import { mkdir, readdir, readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import { SmtpMailer, type MailLogger, type SmtpConfig } from './smtp-mailer.js';

export interface Message {
  to: string;
  subject: string;
  body: string;
  /**
   * Correlates a message with the thing that caused it, for tests and support.
   *
   * `scheduled_report` is its own kind rather than reusing `notification` — the
   * file name embeds it (`${stamp}-${kind}-...`), so a scheduled delivery is
   * distinguishable from an ordinary notification in the mailbox and in a test
   * that filters `outbox()` by kind, without opening every message to tell them
   * apart. `ticket_notice` — a ticket transition mailed to a customer from a
   * workspace's own template (FR-MOD-08.7.5) — is separate for the same reason,
   * and for one more: it is the only kind that leaves the workspace carrying
   * text the workspace wrote, so "what did we send our customers" is a mailbox
   * filter rather than an audit reconstruction.
   *
   * `email_verification` (the sign-up link) and `account_exists_notice` (what
   * a taken address is sent instead) are the two halves of one indistinguishable
   * 202 (tm 257.7): the answer cannot say which happened, so the mailbox is
   * where a test — and the pilot rehearsal's spool check — tells them apart.
   */
  kind:
    | 'password_reset'
    | 'invitation'
    | 'notification'
    | 'scheduled_report'
    | 'ticket_notice'
    | 'email_verification'
    | 'account_exists_notice';
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

/** The mailers this deployment can select between (`MAIL_PROVIDER`). */
export const MAIL_PROVIDERS = ['file', 'null', 'smtp'] as const;
export type MailProvider = (typeof MAIL_PROVIDERS)[number];

export interface MailerOptions {
  /** Where the `file` provider writes (`env.MAIL_DIR`). */
  dir: string;
  /**
   * What `smtp` connects with (`env.mail.smtp`). `null` unless `MAIL_PROVIDER`
   * is `smtp` and every key it needs is set — see `mailOptions` in `env.ts`.
   */
  smtp?: SmtpConfig | null;
  /** Where `smtp` logs connection and delivery events. Omitted, stderr. */
  logger?: MailLogger;
}

/**
 * The mailer `MAIL_PROVIDER` names (M-PROV-a).
 *
 * Before this, `server.ts` branched on `NODE_ENV` — file in dev and prod, null
 * under test — and `MAIL_PROVIDER` was validated by zod and then never read,
 * which made it a setting that looked like a choice and was not one. The two
 * mocks are now named after what they do rather than after the environment that
 * happens to want them, so a test that wants a real spool asks for `file` and a
 * dev run that wants silence asks for `null`, neither by changing `NODE_ENV`.
 *
 * A `switch` rather than a ternary, like `createObjectStore`: adding an `smtp`
 * value to the enum should fail to compile here, not fall through to a file.
 */
export function createMailer(provider: MailProvider, options: MailerOptions): Mailer {
  switch (provider) {
    case 'file':
      return new FileMailer(options.dir);
    case 'null':
      return new NullMailer();
    case 'smtp':
      // Throws rather than falling back to `file`, as `createObjectStore` does
      // for `s3`: a deployment that asked to send mail and quietly spooled it
      // to disk would answer every password reset with "check your inbox" and
      // deliver nothing. `parseEnv` refuses production without these keys; this
      // is the same refusal everywhere else.
      if (!options.smtp) {
        throw new Error(
          'MAIL_PROVIDER=smtp needs SMTP_HOST, SMTP_PORT, SMTP_USERNAME, SMTP_PASSWORD and SMTP_FROM.',
        );
      }
      return new SmtpMailer(options.smtp, { logger: options.logger });
  }
}
