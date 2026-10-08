/**
 * The open conversation's header and the Details panel stay on screen
 * (tm 259.12 · UX audit O3 + O4).
 *
 * The audit saw three things at 1440 px: the visitor's name cut to "U.." in the
 * header (and missing in Turkish, where the buttons are wider), "Create ticket"
 * opening a 256 px field that pushed the Details panel off the right edge, and
 * the Turkish Details panel clipped to "Et", "Ekl", "Chrome on Windo". The web
 * suite cannot see any of it — jsdom has no layout — so every claim here is a
 * measurement: `scrollWidth <= clientWidth` for the page, `boundingBox()` for the
 * panel, and the width the header gives the name against the width the first
 * twelve characters of that name need.
 *
 * The visitor is real (a widget in a second context); only the name is written,
 * through the same `PATCH /customers/:id` the contact editor uses, because the
 * widget does not ask for one.
 */
import type { Locator, Page } from '@playwright/test';
import {
  API_BASE,
  allChats,
  expect,
  openWidget,
  ownerAccessToken,
  test,
  visitorSends,
} from './fixtures.js';

/** 28 characters: longer than the 380 px list or the header can ever show whole. */
const LONG_NAME = 'Alexandria Montgomery-Fitzro';

/** How many leading characters of the name the header must keep on screen. */
const READABLE = 12;

const SIZES = [
  { width: 1280, height: 800 },
  { width: 1440, height: 900 },
] as const;

const LOCALES = ['en', 'tr'] as const;

const LABELS = {
  en: {
    details: 'Conversation details',
    ticket: 'Create ticket',
    subject: 'Ticket subject',
    send: 'Send',
  },
  tr: {
    details: 'Sohbet ayrıntıları',
    ticket: 'Talep oluştur',
    subject: 'Talep konusu',
    send: 'Gönder',
  },
} as const;

/** The name's room against the room its first `READABLE` characters need. */
async function nameRoom(heading: Locator): Promise<{ room: number; needed: number }> {
  return heading.evaluate(
    (el, args) => {
      const style = getComputedStyle(el);
      const canvas = document.createElement('canvas').getContext('2d')!;
      canvas.font = `${style.fontWeight} ${style.fontSize} ${style.fontFamily}`;
      return {
        room: el.clientWidth,
        needed: Math.ceil(canvas.measureText(args.name.slice(0, args.count)).width),
      };
    },
    { name: LONG_NAME, count: READABLE },
  );
}

/** Everything inside `root` that is clipped without being meant to be (`truncate`). */
async function clippedInside(root: Locator): Promise<string[]> {
  return root.evaluate((el) => {
    const clipped: string[] = [];
    for (const node of Array.from(el.querySelectorAll<HTMLElement>('*'))) {
      if (node.children.length > 0 || !node.textContent?.trim()) continue;
      // Screen-reader-only text is a 1 px clip by design.
      if (node.closest('.sr-only')) continue;
      if (node.scrollWidth > node.clientWidth + 1) clipped.push(node.textContent.trim());
    }
    return clipped;
  });
}

async function openNamedChat(
  page: Page,
  chatId: string,
  locale: (typeof LOCALES)[number],
  size: (typeof SIZES)[number],
): Promise<void> {
  await page.setViewportSize(size);
  await page.addInitScript((value) => localStorage.setItem('siyahtus.locale', value), locale);
  await page.goto(`/app/inbox?chat=${chatId}`);
  await expect(page.getByRole('complementary', { name: LABELS[locale].details })).toBeVisible({
    timeout: 20_000,
  });
}

test.describe('inbox header layout (tm 259.12)', () => {
  let chatId = '';
  let visitorClose: (() => Promise<void>) | undefined;

  test.beforeAll(async ({ browser, request, organizationId }) => {
    const context = await browser.newContext();
    visitorClose = () => context.close();
    const visitor = await context.newPage();
    const question = `Header layout — ${Date.now().toString().slice(-6)}`;
    await openWidget(visitor, organizationId);
    await visitorSends(visitor, question);

    const auth = { Authorization: `Bearer ${await ownerAccessToken(request)}` };
    await expect
      .poll(
        async () =>
          (await allChats(request, auth)).find((chat) => chat.last_event?.text === question)?.id,
        { timeout: 20_000 },
      )
      .toBeTruthy();
    chatId = (await allChats(request, auth)).find((chat) => chat.last_event?.text === question)!.id;

    const chat = await request.get(`${API_BASE}/chats/${chatId}`, { headers: auth });
    const { customer_id: customerId } = (await chat.json()) as { customer_id: string };
    const renamed = await request.patch(`${API_BASE}/customers/${customerId}`, {
      headers: auth,
      data: { name: LONG_NAME },
    });
    expect(renamed.ok(), `rename failed: ${renamed.status()}`).toBe(true);
  });

  test.afterAll(async () => {
    await visitorClose?.();
  });

  for (const size of SIZES) {
    for (const locale of LOCALES) {
      for (const ticketOpen of [false, true]) {
        const title = `${size.width}px · ${locale} · ${ticketOpen ? 'Create ticket open' : 'closed'}`;

        test(`the name reads and nothing leaves the screen — ${title}`, async ({ agentPage }) => {
          await openNamedChat(agentPage, chatId, locale, size);

          const main = agentPage.locator('main');
          const heading = main.getByRole('heading', { name: LONG_NAME });
          await expect(heading).toBeVisible({ timeout: 20_000 });

          if (ticketOpen) {
            await main.getByRole('button', { name: LABELS[locale].ticket }).click();
            await expect(agentPage.getByLabel(LABELS[locale].subject)).toBeVisible();
          }

          // The name has room for at least its first twelve characters.
          const { room, needed } = await nameRoom(heading);
          expect(
            room,
            `the header gives the name ${room}px, ${READABLE} characters need ${needed}px`,
          ).toBeGreaterThanOrEqual(needed);

          // The page does not scroll sideways, and the Details panel is whole.
          const page = await agentPage.evaluate(() => ({
            scroll: document.documentElement.scrollWidth,
            client: document.documentElement.clientWidth,
          }));
          expect(page.scroll).toBeLessThanOrEqual(page.client);

          const panel = agentPage.getByRole('complementary', { name: LABELS[locale].details });
          const box = (await panel.boundingBox())!;
          expect(box.x + box.width).toBeLessThanOrEqual(size.width);

          // The reply box stays inside its own column: at 1280 px that column is
          // 284 px, and its toolbar once ran on under the Details panel.
          const column = (await main.boundingBox())!;
          const send = (await main
            .getByRole('button', { name: LABELS[locale].send })
            .boundingBox())!;
          expect(send.x + send.width).toBeLessThanOrEqual(column.x + column.width);

          // Nothing inside the panel is cut off mid-word, and nothing in the
          // header is wider than the column that holds it.
          expect(await clippedInside(panel)).toEqual([]);
          expect(
            await main
              .locator('header')
              .first()
              .evaluate((el) => el.scrollWidth - el.clientWidth),
          ).toBeLessThanOrEqual(0);

          await agentPage.screenshot({
            path: `kanit/259.12-inbox-header-${size.width}-${locale}${ticketOpen ? '-ticket' : ''}.png`,
          });
        });
      }
    }
  }
});
