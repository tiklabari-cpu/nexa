/**
 * A player's e-mail in the ticket pane (tm 357 · HD-02), in a real browser
 * against the real stack: what they wrote is the ticket's first message, the
 * quoted earlier mail sits behind "Show full message", the dekont opens, an ID
 * card waits behind a click, an infected file is named in a system line and
 * never stored, and "Formatted view" draws the HTML in a frame with every
 * sandbox allowance off — no script of the mail's survives into it.
 *
 * The mail arrives the way a provider's adapter would deliver it: a POST to the
 * inbound webhook, which the e2e stack leaves unsigned and outside the pilot.
 * Each test sends its own mail — a fresh subject, sender and Message-ID — so
 * the shared, re-seeded workspace cannot decide the outcome.
 */
import type { APIRequestContext, Page } from '@playwright/test';
import { API_BASE, expect, test } from './fixtures.js';

/** A real 1×1 PNG, so the preview is an image a browser can draw. */
const PNG_BASE64 =
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==';
const PDF_BASE64 = Buffer.from('%PDF-1.4\n1 0 obj << /Type /Catalog >> endobj\n%%EOF\n').toString(
  'base64',
);
/** The EICAR test file (not a virus) inside a PDF's opening bytes. */
const EICAR_BASE64 = Buffer.from(
  '%PDF-1.4\nX5O!P%@AP[4\\PZX54(P^)7CC)7}$EICAR-STANDARD-ANTIVIRUS-TEST-FILE!$H+H*',
  'latin1',
).toString('base64');

async function sendMail(
  request: APIRequestContext,
  organizationId: string,
  mail: Record<string, unknown>,
): Promise<string> {
  const response = await request.post(`${API_BASE}/channels/email/inbound`, {
    data: { to: `${organizationId}@inbound.siyahtus.localhost`, ...mail },
  });
  expect(response.ok(), `inbound failed: ${response.status()} ${await response.text()}`).toBe(true);
  const body = (await response.json()) as { status: string; ticket_id: string };
  expect(body.status).toBe('created');
  return body.ticket_id;
}

async function openTicket(page: Page, id: string): Promise<void> {
  await page.goto(`/app/inbox?ticket=${id}`);
  await expect(page.getByRole('region', { name: 'Conversation' })).toBeVisible();
}

test.describe("a player's e-mail in the ticket pane (HD-02)", () => {
  test.use({ viewport: { width: 1680, height: 1050 } });

  test('shows what they wrote, the quote behind a click, and the files they sent', async ({
    agentPage,
    organizationId,
    request,
  }) => {
    // Base 36: a 13-digit timestamp can pass the Luhn check and be masked as a card.
    const stamp = Date.now().toString(36);
    const reply = `Yatırımım geçmedi, 2.500 TL, saat 14:42, dekont ektedir. ${stamp}`;
    const ticketId = await sendMail(request, organizationId, {
      from: `Ali Veli <ali.${stamp}@oyuncu.example>`,
      subject: `E2E inbound ${stamp}`,
      message_id: `<e2e.${stamp}@mail.oyuncu.example>`,
      text: [
        reply,
        '',
        '20 Eki 2026 Pzt, 14:50 tarihinde Destek <destek@ornek.example> şunu yazdı:',
        `> Dekontunuzu iletir misiniz? ${stamp}`,
      ].join('\n'),
      attachments: [
        { filename: 'dekont.pdf', content_type: 'application/pdf', content_base64: PDF_BASE64 },
        { filename: 'kimlik_on.png', content_type: 'image/png', content_base64: PNG_BASE64 },
        { filename: 'virus.pdf', content_type: 'application/pdf', content_base64: EICAR_BASE64 },
      ],
    });
    await openTicket(agentPage, ticketId);

    const thread = agentPage.getByRole('region', { name: 'Conversation' });
    const mail = thread.locator('li[data-kind="customer_message"]');
    await expect(mail.getByText(reply)).toBeVisible();
    // The quoted earlier mail is not in the thread until asked for.
    await expect(
      mail.getByText(`Dekontunuzu iletir misiniz? ${stamp}`, { exact: false }),
    ).toHaveCount(0);
    await mail.getByRole('button', { name: 'Show full message' }).click();
    await expect(
      mail.getByText(`Dekontunuzu iletir misiniz? ${stamp}`, { exact: false }),
    ).toBeVisible();

    // The dekont opens straight away; the ID card waits behind a click and
    // says the opening is recorded.
    await expect(mail.getByTestId('attachment-file')).toHaveText(/dekont\.pdf/);
    await expect(mail.getByText('Opening it is recorded in the audit log.')).toBeVisible();
    await expect(mail.getByTestId('attachment-image')).toHaveCount(0);
    await mail.getByRole('button', { name: 'Show sensitive file: kimlik_on.png' }).click();
    await expect(mail.getByTestId('attachment-image')).toBeVisible();

    // The infected file was never kept, and the ticket says so.
    const note = thread.locator('li[data-kind="system"]');
    await expect(note).toContainText('“virus.pdf” — it did not pass the virus scan');
    await expect(mail).not.toContainText('virus.pdf');
  });

  test('draws the HTML in a sandboxed frame with none of the mail’s script', async ({
    agentPage,
    organizationId,
    request,
  }) => {
    // Base 36: a 13-digit timestamp can pass the Luhn check and be masked as a card.
    const stamp = Date.now().toString(36);
    const ticketId = await sendMail(request, organizationId, {
      from: `oyuncu.${stamp}@oyuncu.example`,
      subject: `E2E inbound html ${stamp}`,
      message_id: `<e2e.html.${stamp}@mail.oyuncu.example>`,
      html:
        `<p>Biçimli <b>metin</b> ${stamp}</p>` +
        '<script>window.top.__pwned = true</script>' +
        '<img src="https://tracker.example/open.gif" onerror="window.top.__pwned = true">',
    });
    await openTicket(agentPage, ticketId);

    const mail = agentPage
      .getByRole('region', { name: 'Conversation' })
      .locator('li[data-kind="customer_message"]');
    // The text comes from the HTML when the mail had no plain part.
    await expect(mail.getByText(`Biçimli metin ${stamp}`)).toBeVisible();

    await mail.getByRole('button', { name: 'Formatted view' }).click();
    const frame = mail.locator('iframe');
    await expect(frame).toHaveAttribute('sandbox', '');
    const inside = agentPage.frameLocator('li[data-kind="customer_message"] iframe');
    await expect(inside.locator('b')).toHaveText('metin');
    // Sanitised at intake: no script element, and the remote image parked.
    await expect(inside.locator('script')).toHaveCount(0);
    await expect(inside.locator('img')).toHaveAttribute(
      'data-src',
      'https://tracker.example/open.gif',
    );
    await expect(inside.locator('img')).not.toHaveAttribute('src', /.+/);
    expect(
      await agentPage.evaluate(() => (window as { __pwned?: boolean }).__pwned),
    ).toBeUndefined();
  });
});
