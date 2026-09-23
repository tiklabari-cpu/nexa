/**
 * The mailbox the e2e stack's mail arrives in (tm 255.4).
 *
 * The API under test runs `MAIL_PROVIDER=smtp` against the SMTP stand-in
 * `apps/api/scripts/mock-smtp-server.ts` (see `playwright.config.ts`), which
 * keeps every message it accepts and serves them decoded — quoted-printable
 * undone, subject decoded — the way a mail client would show them. A test reads
 * what a person would have received, after it crossed a real SMTP session with
 * TLS and AUTH, rather than a file the `file` mailer wrote beside the API.
 */
import { expect, type APIRequestContext } from '@playwright/test';

export const MAILBOX = 'http://127.0.0.1:4626';

export interface Mail {
  to: string;
  from: string;
  subject: string;
  body: string;
  /** Arrival order across the whole run. */
  received: number;
}

/** Everything received so far, oldest first; only mail to `to` when given. */
export async function mailbox(request: APIRequestContext, to?: string): Promise<Mail[]> {
  const url = to ? `${MAILBOX}/messages?to=${encodeURIComponent(to)}` : `${MAILBOX}/messages`;
  const response = await request.get(url);
  expect(response.ok(), `mailbox unreachable: ${response.status()}`).toBe(true);
  return ((await response.json()) as { items: Mail[] }).items;
}

/** Wait for the first message to `to` whose subject contains `subject`. */
export async function waitForMail(
  request: APIRequestContext,
  to: string,
  subject: string,
): Promise<Mail> {
  let found: Mail | undefined;
  await expect
    .poll(
      async () => {
        found = (await mailbox(request, to)).find((mail) => mail.subject.includes(subject));
        return found !== undefined;
      },
      { message: `no "${subject}" mail reached ${to}`, timeout: 15_000 },
    )
    .toBe(true);
  return found!;
}

/** The link in a mail body whose path is `path` (`/join`, `/reset-password`). */
export function linkIn(mail: Mail, path: string): string {
  const link = (mail.body.match(/https?:\/\/\S+/g) ?? []).find(
    (candidate) => new URL(candidate).pathname === path,
  );
  expect(link, `the mail carried no ${path} link`).toBeTruthy();
  return link!;
}
