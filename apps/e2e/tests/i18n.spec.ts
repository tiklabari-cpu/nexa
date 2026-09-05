/**
 * The console in Turkish, end to end (NFR-I18N2 · I18N-l, tm 133.12).
 *
 * Twelve tasks translated the console one area at a time, and each proved its
 * own area in jsdom: a component rendered with the locale store set to `tr`,
 * asserting the strings that component owns. What none of them could prove is
 * the claim the requirement actually makes — that *the agent* can change one
 * control and have the whole product follow. That claim spans the switcher, the
 * store, `localStorage`, the router and twenty-two screens, and it is exactly the
 * claim that was once made falsely: §D113 records a console declared translated
 * on the strength of a switcher that relabelled the rail while every page body
 * underneath stayed English in both languages.
 *
 * So the assertions here are deliberately two-sided. A Turkish sentence being
 * present is the weaker half — a screen that renders one Turkish string and
 * fifty English ones satisfies it. The English sentence from the *same
 * catalogue key* being absent is what closes it: for every surface below, the
 * text that English would have shown is asserted gone, so a screen that half
 * switched fails here rather than reading as translated.
 *
 * Turkish first, absence second, always. `toHaveCount(0)` on a page that has
 * not finished rendering passes for the wrong reason; waiting for the Turkish
 * string to be visible is what makes the absence check mean anything.
 *
 * Screenshots go to `kanit/i18n-*.png` in the dark theme, matching the rest of
 * the evidence set (see `theme.spec.ts` for why dark is the default that must
 * not drift).
 */
import type { Page } from '@playwright/test';
import { DEMO, expect, test } from './fixtures.js';

/**
 * One screen, and the pair of sentences that decides whether it switched.
 *
 * `tr` and `en` are the same catalogue key in the two locales, which is what
 * makes the absence check honest rather than decorative: nothing else on the
 * page can accidentally satisfy or break it.
 */
interface Surface {
  /** Evidence filename suffix — `kanit/i18n-<name>.png`. */
  name: string;
  path: string;
  /** Must be on the page in Turkish. */
  tr: string | RegExp;
  /** The same string in English — must not be anywhere on the page. */
  en: string | RegExp;
  /** The `<h1>` in Turkish, where the screen has one worth naming. */
  heading?: string;
}

/** The sixteen routes an agent reaches from inside the shell. */
const APP_SURFACES: readonly Surface[] = [
  {
    name: 'home',
    path: '/app/home',
    heading: 'Ana Sayfa',
    tr: 'Çalışma alanınıza genel bakış',
    en: 'Your workspace at a glance',
  },
  {
    name: 'inbox',
    path: '/app/inbox',
    heading: 'Gelen Kutusu',
    tr: 'Sohbetlerim',
    en: 'My chats',
  },
  {
    name: 'customers',
    path: '/app/customers',
    heading: 'Müşteriler',
    // The page's own subtitle is replaced by a row count once the list lands,
    // so the sentinel is a control that is always there: the segment filters.
    tr: 'Son 30 gün',
    en: 'Last 30 days',
  },
  {
    name: 'traffic',
    path: '/app/customers/real-time',
    heading: 'Müşteriler',
    // Same as Contacts: the subtitle becomes a visitor count. The status tabs stay.
    tr: 'Yanıt bekliyor',
    en: 'Waiting for reply',
  },
  {
    name: 'campaigns',
    path: '/app/customers/campaigns',
    heading: 'Müşteriler',
    tr: 'Ziyaretçilere proaktif, hedefli mesajlarla ulaşın.',
    en: 'Reach visitors with proactive, targeted messages.',
  },
  {
    name: 'goals',
    path: '/app/customers/goals',
    heading: 'Müşteriler',
    tr: 'Bir ziyaretçinin ulaşmasının dönüşüm sayılacağı sayfaları tanımlayın.',
    en: 'Define the pages a visitor reaching them counts as a conversion.',
  },
  {
    name: 'team',
    path: '/app/team',
    heading: 'Ekip',
    tr: 'Ekip arkadaşları, müsaitlik ve yönlendirmenin iş gönderdiği ekipler.',
    en: 'Teammates, availability and the teams routing sends work to.',
  },
  {
    name: 'team-ai-agents',
    path: '/app/team/ai-agents',
    heading: 'Ekip',
    tr: 'Bot hesapları, AI’ın performansı ve Copilot’un yararlanabileceği bilgiler.',
    en: 'Bot accounts, how the AI is performing, and what Copilot may draw on.',
  },
  {
    name: 'team-teams',
    path: '/app/team/teams',
    heading: 'Ekip',
    tr: 'Ekipler oluşturun ve her birinde kimlerin olacağına karar verin.',
    en: 'Create teams and decide who is in each one.',
  },
  {
    name: 'reports',
    path: '/app/reports',
    heading: 'Raporlar',
    tr: 'Sohbet hacmi, yanıt verme hızı ve memnuniyet.',
    en: 'Conversation volume, responsiveness and satisfaction.',
  },
  {
    name: 'billing',
    path: '/app/billing',
    heading: 'Faturalandırma',
    // The billing period interpolates into both, so match around it.
    tr: /dönemi için plan, kullanım ve ücretler/,
    en: /Plan, usage and charges for period/,
  },
  {
    name: 'playbook',
    path: '/app/playbook',
    heading: 'AI Ajanı',
    tr: 'Kişilik, çalıştırdığı beceriler, neden yanıtladığı ve performansı.',
    en: 'Persona, the skills it runs, what it answers from, and how it is doing.',
  },
  {
    name: 'settings',
    path: '/app/settings',
    heading: 'Ayarlar',
    tr: 'Widget kurulumu, kayıtlı yanıtlar ve yönlendirme.',
    en: 'Widget installation, saved replies and routing.',
  },
  {
    name: 'audit-log',
    path: '/app/settings/audit-log',
    heading: 'Denetim günlüğü',
    tr: 'Oturum açmalar, rol değişiklikleri, silmeler ve webhook değişiklikleri — varsayılan olarak son 30 gün.',
    en: 'Sign-ins, role changes, deletions and webhook changes — the last 30 days by default.',
  },
  {
    name: 'apps',
    path: '/app/apps',
    heading: 'Uygulamalar',
    tr: 'Çalışma alanınız için üçüncü taraf entegrasyonlar.',
    en: 'Third-party integrations for your workspace.',
  },
  {
    name: 'developers',
    path: '/app/developers',
    heading: 'Geliştiriciler',
    tr: 'Bu çalışma alanı adına API üzerinden işlem yapabilecek OAuth uygulamaları kaydedin.',
    en: 'Register OAuth apps that can act on this workspace through the API.',
  },
];

/**
 * The six routes a signed-out visitor can be on.
 *
 * They matter more than their size suggests: the switcher lives in the shell,
 * so these are the screens *no* control on them can translate. They follow only
 * because the preference outlives the session — which is the thing the second
 * test below is really proving.
 *
 * `/join` and `/auth/callback` are reached without the token and code they
 * expect, on purpose: their refusal is the one state of theirs that renders
 * without a fixture, and a refusal in the wrong language is exactly the kind of
 * screen that gets missed.
 */
const PUBLIC_SURFACES: readonly Surface[] = [
  {
    name: 'sign-in',
    path: '/',
    tr: 'Çalışma alanınızda oturum açın',
    en: 'Sign in to your workspace',
  },
  {
    name: 'signup',
    path: '/signup',
    heading: 'Çalışma alanı oluştur',
    tr: '14 gün ücretsiz. Kart gerekmez.',
    en: '14 days free. No card.',
  },
  {
    name: 'forgot-password',
    path: '/forgot-password',
    heading: 'Parolanızı sıfırlayın',
    tr: 'Size bir bağlantı göndereceğiz.',
    en: 'We will send you a link.',
  },
  {
    name: 'reset-password',
    path: '/reset-password',
    heading: 'Yeni bir parola seçin',
    tr: 'Bağlantı yalnızca bir kez çalışır.',
    en: 'The link works once.',
  },
  {
    name: 'join',
    path: '/join',
    heading: 'Bu davet geçerli değil',
    tr: 'Süresi dolmuş veya iptal edilmiş olabilir.',
    en: 'It may have expired or been revoked.',
  },
  {
    name: 'auth-callback',
    path: '/auth/callback',
    tr: 'Bu oturum açma tamamlanmadı. Oturum açma sayfasından yeniden başlayın.',
    en: 'This sign-in did not complete. Start again from the sign-in page.',
  },
];

/** Every route this spec walks — the count the requirement is stated in. */
const SURFACES = [...APP_SURFACES, ...PUBLIC_SURFACES];

/** The remembered choice, read where the product writes it. */
function storedLocale(page: Page): Promise<string | null> {
  return page.evaluate(() => localStorage.getItem('nexa.locale'));
}

type Locale = 'en' | 'tr';

/** The account menu's trigger and its language field, in each language. */
const ACCOUNT_LABEL: Record<Locale, string> = { en: 'Account', tr: 'Hesap' };
const LANGUAGE_LABEL: Record<Locale, string> = { en: 'Language', tr: 'Dil' };

/**
 * Open the account menu, pick a language, and close the menu again.
 *
 * The closing matters: the menu is a `<details>`, so its trigger toggles. A
 * caller that reaches for another control in the same menu right after would
 * otherwise click it shut and then wait out its timeout on a control that is
 * there but hidden.
 */
async function chooseLanguage(page: Page, from: Locale, to: Locale): Promise<void> {
  // The trigger and the field are themselves translated, so which name they
  // answer to depends on the language being left.
  await page.getByRole('button', { name: ACCOUNT_LABEL[from] }).click();
  await page.getByLabel(LANGUAGE_LABEL[from]).selectOption(to);
  await page.keyboard.press('Escape');
  await expect(page.getByLabel(LANGUAGE_LABEL[to])).toBeHidden();
}

/**
 * Walk one screen: Turkish present, English gone, evidence taken.
 *
 * The heading is asserted separately from the body sentence where a screen has
 * one — a page whose chrome translated and whose body did not (§D113's exact
 * failure) passes a heading-only check.
 */
async function walk(page: Page, surface: Surface): Promise<void> {
  await page.goto(surface.path);

  if (surface.heading) {
    await expect(
      page.getByRole('heading', { name: surface.heading, level: 1 }),
      `${surface.path}: Turkish heading`,
    ).toBeVisible();
  }

  const turkish =
    typeof surface.tr === 'string'
      ? page.getByText(surface.tr, { exact: true })
      : page.getByText(surface.tr);
  await expect(turkish.first(), `${surface.path}: Turkish body text`).toBeVisible();

  // Only now is the absence check worth anything — the screen has rendered.
  const english =
    typeof surface.en === 'string'
      ? page.getByText(surface.en, { exact: true })
      : page.getByText(surface.en);
  await expect(english, `${surface.path}: English text left behind`).toHaveCount(0);

  // Photograph the loaded screen, not its skeleton. A page's chrome translates
  // before its data arrives, so an evidence set taken mid-load would show
  // shimmer bars where the translated rows, empty states and error notices are
  // — the half of each screen this whole task was about.
  await expect(page.locator('.animate-pulse'), `${surface.path}: still loading`).toHaveCount(0);

  await page.screenshot({ path: `kanit/i18n-${surface.name}.png`, fullPage: true });
}

test.describe('console i18n', () => {
  test('one switch turns every screen in the shell Turkish, and back', async ({ agentPage }) => {
    await agentPage.goto('/app/inbox');
    // English is where an agent starts: the seeded session has no stored
    // preference and the browser under test asks for English.
    await expect(agentPage.getByRole('heading', { name: 'Inbox', level: 1 })).toBeVisible();

    await chooseLanguage(agentPage, 'en', 'tr');

    // The rail is the surface §D113's false claim rested on — it switching is
    // necessary and nowhere near sufficient, hence the sixteen screens below.
    await expect(agentPage.getByRole('heading', { name: 'Gelen Kutusu', level: 1 })).toBeVisible();
    expect(await storedLocale(agentPage)).toBe('tr');

    for (const surface of APP_SURFACES) await walk(agentPage, surface);

    // Team's two AI sections moved to their own route (`/app/team/ai-agents`,
    // FR-MOD-04.1) but are still inside the shell's own scroll container,
    // where a full-page screenshot does not always reach — and they were the
    // last two screens the console had left in English (missed by I18N-e,
    // translated by a later task). Scroll to them and say so plainly; the
    // `team-ai-agents` surface above already proved the page's own heading and
    // description translate, this goes one layer deeper into the two sections
    // that sentinel does not name.
    await agentPage.goto('/app/team/ai-agents');
    const aiPerformance = agentPage.getByRole('heading', { name: 'AI temsilci performansı' });
    await aiPerformance.scrollIntoViewIfNeeded();
    await expect(aiPerformance).toBeVisible();
    await expect(agentPage.getByRole('heading', { name: 'Copilot bilgisi' })).toBeVisible();
    await expect(agentPage.getByText('AI agent performance')).toHaveCount(0);
    await expect(agentPage.getByText('Copilot knowledge')).toHaveCount(0);
    await agentPage.screenshot({ path: 'kanit/i18n-team-ai.png', fullPage: true });

    // The choice is a real preference, not a repaint: it is written down and
    // re-applied on the next load, which is the only thing that makes an agent
    // who works in Turkish able to keep doing so.
    await agentPage.goto('/app/reports');
    // Let the load settle before reloading it: the access token is held in
    // memory and re-minted on each load, so reloading a page that is still
    // mid-restore signs the session out rather than testing the preference.
    await expect(agentPage.getByRole('heading', { name: 'Raporlar', level: 1 })).toBeVisible();
    await agentPage.reload();
    await expect(agentPage.getByRole('heading', { name: 'Raporlar', level: 1 })).toBeVisible();
    await expect(
      agentPage.getByText('Conversation volume, responsiveness and satisfaction.'),
    ).toHaveCount(0);

    // And it is not a one-way door.
    await chooseLanguage(agentPage, 'tr', 'en');
    await expect(agentPage.getByRole('heading', { name: 'Reports', level: 1 })).toBeVisible();
    await expect(
      agentPage.getByText('Conversation volume, responsiveness and satisfaction.'),
    ).toBeVisible();
    expect(await storedLocale(agentPage)).toBe('en');
  });

  test('the preference outlives the session, and the signed-out screens follow', async ({
    page,
  }) => {
    // Sign in by hand rather than through the fixture: this test needs to sign
    // back *out* on the same page, and the switcher only exists while signed in.
    await page.goto('/');
    await page.getByLabel('Email').fill(DEMO.email);
    await page.getByLabel('Password').fill(DEMO.password);
    await page.getByRole('button', { name: 'Sign in' }).click();
    await expect(page.getByRole('link', { name: 'Inbox' })).toBeVisible();

    await chooseLanguage(page, 'en', 'tr');
    await expect(page.getByRole('link', { name: 'Gelen Kutusu' })).toBeVisible();

    await page.getByRole('button', { name: ACCOUNT_LABEL.tr }).click();
    await page.getByRole('button', { name: 'Çıkış Yap' }).click();

    // The session is gone; the language is not. Everything below renders with
    // no shell around it and no control on it that could have set a language.
    await expect(page.getByText('Çalışma alanınızda oturum açın')).toBeVisible();
    expect(await storedLocale(page)).toBe('tr');

    for (const surface of PUBLIC_SURFACES) await walk(page, surface);
  });

  test('walks every route the requirement is stated in', () => {
    // A guard on the two lists above rather than on the product: a route
    // quietly dropped from the walk would leave both tests green and the claim
    // — "the whole console" — unproven, which is the failure mode this file
    // exists to prevent.
    expect(SURFACES).toHaveLength(22);
    expect(new Set(SURFACES.map((surface) => surface.path)).size).toBe(22);
    expect(new Set(SURFACES.map((surface) => surface.name)).size).toBe(22);
  });
});
