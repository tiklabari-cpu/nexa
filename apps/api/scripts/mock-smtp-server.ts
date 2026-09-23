/**
 * An SMTP server the e2e stack's API really sends to, and a mailbox a browser
 * test can read (tm 255.4).
 *
 * The integration suite proves the carrier against `FakeSmtpServer` in-process.
 * What it cannot prove is the product with the carrier switched on: an API
 * process started the way an operator starts one, `MAIL_PROVIDER=smtp`, TLS
 * verified against a trust anchor given to the *process* (`NODE_EXTRA_CA_CERTS`)
 * rather than to a constructor — and then a person opening the link the mail
 * carried. So the e2e suite gets a mail server, standing where PrivateEmail
 * would, and the tests read what arrived instead of reading a spool the `file`
 * mailer wrote.
 *
 * Two listeners, both loopback only:
 *
 * - SMTP on `MOCK_SMTP_PORT` (4625): STARTTLS with the throwaway certificate in
 *   `test/helpers/smtp-certificates.ts`, AUTH with the fake credentials
 *   `FAKE_SMTP_USERNAME`/`FAKE_SMTP_PASSWORD` — neither is a secret, and neither
 *   is the pilot's.
 * - HTTP on `MOCK_SMTP_HTTP_PORT` (4626): `GET /health`, and `GET /messages`,
 *   every message received so far decoded the way a mail client shows it
 *   (`received-mail.ts`), oldest first, optionally `?to=<address>`.
 *
 * Test infrastructure, not product code: nothing under `src/` imports it, and it
 * is started only by `apps/e2e/playwright.config.ts`.
 */
import { createServer } from 'node:http';
import { FakeSmtpServer } from '../test/helpers/fake-smtp-server.js';
import { readReceivedMail, type ReceivedMail } from '../test/helpers/received-mail.js';

const SMTP_PORT = Number(process.env['MOCK_SMTP_PORT'] ?? 4625);
const HTTP_PORT = Number(process.env['MOCK_SMTP_HTTP_PORT'] ?? 4626);

const smtp = await FakeSmtpServer.start({ mode: 'starttls', port: SMTP_PORT });

/** Decoded once per message; the server only ever appends. */
const decoded: Array<ReceivedMail & { received: number }> = [];

function inbox(): Array<ReceivedMail & { received: number }> {
  const raw = smtp.messages;
  for (let i = decoded.length; i < raw.length; i += 1) {
    decoded.push({ ...readReceivedMail(raw[i]!), received: i });
  }
  return decoded;
}

const http = createServer((request, response) => {
  const url = new URL(request.url ?? '/', `http://127.0.0.1:${HTTP_PORT}`);

  if (request.method === 'GET' && url.pathname === '/health') {
    response.writeHead(200, { 'content-type': 'text/plain' });
    response.end('ok');
    return;
  }

  if (request.method === 'GET' && url.pathname === '/messages') {
    const to = url.searchParams.get('to')?.toLowerCase();
    const items = inbox().filter((mail) => !to || mail.to.toLowerCase() === to);
    response.writeHead(200, { 'content-type': 'application/json' });
    response.end(JSON.stringify({ items }));
    return;
  }

  response.writeHead(404, { 'content-type': 'text/plain' });
  response.end('not found');
});

await new Promise<void>((resolve) => http.listen(HTTP_PORT, '127.0.0.1', resolve));
process.stdout.write(
  `mock smtp listening on 127.0.0.1:${SMTP_PORT} (STARTTLS); mailbox on http://127.0.0.1:${HTTP_PORT}/messages\n`,
);

const shutdown = () => {
  http.close();
  void smtp.stop().finally(() => process.exit(0));
};
process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);
