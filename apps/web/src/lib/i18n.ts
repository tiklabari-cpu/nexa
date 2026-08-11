/**
 * Panel internationalisation (I18N1/2).
 *
 * Deliberately dependency-free: a flat message catalogue plus a `t()` that looks
 * a key up in the active locale, falls back to English, then to the key itself.
 * A heavier library (ICU, plural rules, lazy-loaded bundles) buys nothing at two
 * locales and this many strings, and it would pull weight into a bundle the
 * widget half of the same feature is fighting to keep small.
 *
 * English is the source of truth: every key a component references exists in
 * `en`, so the English column can never be missing. `tr` may be partial while
 * the product's surface is translated screen by screen — a missing Turkish key
 * shows the English text rather than a raw `some.key`, which is the whole point
 * of the fallback (the "eksik-anahtar güvenliği" the task asks for).
 *
 * Live/machine translation of conversation content is explicitly out of scope
 * (PRD §9); this is chrome only.
 */
import { useCallback } from 'react';
import { create } from 'zustand';
import { setFormatLocale } from './format.js';

export type Locale = 'en' | 'tr';

/** The locales offered in the switcher, in display order. */
export const LOCALES: readonly Locale[] = ['en', 'tr'];

/** How each locale names itself — shown in its own language in both catalogues. */
export const LOCALE_NAMES: Record<Locale, string> = {
  en: 'English',
  tr: 'Türkçe',
};

const STORAGE_KEY = 'nexa.locale';

/**
 * The catalogue. `en` is complete by construction; `tr` fills in what has been
 * translated and leans on the fallback for the rest. Interpolation is `{name}`,
 * substituted from the params object — unknown params are left untouched and
 * unused ones ignored, so a template can differ between languages (English
 * pluralises "day/days"; Turkish does not, and simply omits the marker).
 */
const MESSAGES: Record<Locale, Record<string, string>> = {
  en: {
    // Shell chrome
    'shell.modules': 'Modules',
    'shell.subscribe': 'Subscribe',
    'shell.trial.ended': 'Your trial has ended — subscribe to start new conversations.',
    'shell.trial.remaining': '{days} day{s} left in your trial.',
    'shell.account': 'Account',
    'shell.account.agentFallback': 'Agent',
    'shell.account.signOut': 'Sign out',
    'shell.account.language': 'Language',
    'shell.account.theme': 'Theme',
    'shell.account.theme.dark': 'Dark',
    'shell.account.theme.light': 'Light',
    'shell.brand': 'Brand',

    // Navigation (rail + command palette)
    'nav.home': 'Home',
    'nav.inbox': 'Inbox',
    'nav.customers': 'Customers',
    'nav.team': 'Team',
    'nav.playbook': 'Playbook',
    'nav.reports': 'Reports',
    'nav.billing': 'Billing',
    'nav.settings': 'Settings',
    'nav.developers': 'Developers',

    // Command palette
    'palette.label': 'Command palette',
    'palette.search': 'Search or jump to',
    // FR-MOD-01.1.3's acceptance criterion quotes this string verbatim. The
    // longer, more descriptive line it replaced said the same thing in more
    // words; the criterion is checkable and the prose was not, so the prose
    // lost. What the palette can find is spelled out by the group headings a
    // keystroke later anyway.
    'palette.placeholder': 'Search Text or go to…',
    'palette.searching': 'Searching…',
    'palette.noMatches': 'No matches.',
    'palette.group.goTo': 'Go to',
    'palette.group.actions': 'Actions',
    'palette.group.customers': 'Customers',
    'palette.group.conversations': 'Conversations',
    'palette.group.tickets': 'Tickets',
    'palette.unnamedVisitor': 'Unnamed visitor',
    'palette.visitor': 'Visitor',
    'palette.action.failed': 'That action did not go through.',
    'palette.action.failedFallback': 'Nothing was changed — try again.',
    'palette.action.failedDismiss': 'Dismiss',
    'palette.group.ai': 'Ask AI',
    'palette.ai.ask': 'Ask AI: "{query}"',
    'palette.ai.source': 'Source: {source}',
    'palette.ai.noData.title': 'No data yet',
    'palette.ai.notUnderstood.title': 'Not sure what you mean',
    'palette.ai.error': 'Could not get an answer — try again.',

    // Playbook — skill template catalogue (NFR-I18N2). Keys are
    // `playbook.template.<id>.name` / `.summary`, `<id>` matching
    // `SkillTemplate.id` in `features/playbook/templates.ts`. `instruction`/
    // `steps` are deliberately absent here — see that file's module note.
    'playbook.template.order-status.name': 'Where is my order?',
    'playbook.template.order-status.summary':
      'Collect the order number, tag it, and answer from your knowledge base.',
    'playbook.template.returns-policy.name': 'Returns policy',
    'playbook.template.returns-policy.summary':
      'Recognise a returns question and answer it from your indexed policy.',
    'playbook.template.business-hours.name': 'Opening hours',
    'playbook.template.business-hours.summary':
      'A fixed reply for “are you open?”, no knowledge base required.',
    'playbook.template.shipping-cost.name': 'Shipping costs',
    'playbook.template.shipping-cost.summary':
      'Answer shipping cost questions straight from your knowledge base.',
    'playbook.template.order-cancellation.name': 'Cancel an order',
    'playbook.template.order-cancellation.summary':
      'Collect the order number and route a cancellation request to support.',
    'playbook.template.payment-methods.name': 'Accepted payment methods',
    'playbook.template.payment-methods.summary':
      'Recognise a payment-methods question and answer it from your knowledge base.',
    'playbook.template.change-shipping-address.name': 'Change a shipping address',
    'playbook.template.change-shipping-address.summary':
      'Collect the order number and route an address change to support.',
    'playbook.template.warranty-coverage.name': 'Warranty coverage',
    'playbook.template.warranty-coverage.summary':
      'A fixed explanation of what your warranty covers, answered from your knowledge base.',
    'playbook.template.contact-support.name': 'How to reach us',
    'playbook.template.contact-support.summary':
      'A fixed reply with your contact channels, no knowledge base required.',
    'playbook.template.discount-code-issue.name': 'Discount code not working',
    'playbook.template.discount-code-issue.summary':
      'Collect the code and route it to support to sort out.',
    'playbook.template.delete-my-account.name': 'Delete my account',
    'playbook.template.delete-my-account.summary':
      'Recognise an account-deletion request and route it to the support team.',
    'playbook.template.greet-and-route.name': 'Greet and find the topic',
    'playbook.template.greet-and-route.summary':
      'Open warmly, then let the assistant answer from what it knows.',
    'playbook.template.collect-then-handover.name': 'Collect details, then hand over',
    'playbook.template.collect-then-handover.summary':
      'Ask for an email, summarise the chat, and pass it to a human team.',
    'playbook.template.troubleshoot-then-escalate.name': 'Troubleshoot, then escalate',
    'playbook.template.troubleshoot-then-escalate.summary':
      'Try a knowledge-based answer first, then summarise and hand over if that is not enough.',
    'playbook.template.angry-customer-deescalate.name': 'De-escalate an upset customer',
    'playbook.template.angry-customer-deescalate.summary':
      'Acknowledge the frustration, summarise the issue, and hand it to a senior agent.',
    'playbook.template.product-recommendation.name': 'Recommend a product',
    'playbook.template.product-recommendation.summary':
      'Ask what the customer needs, then answer with a recommendation from your knowledge base.',
    'playbook.template.onboarding-walkthrough.name': 'Guide a new user',
    'playbook.template.onboarding-walkthrough.summary':
      'Welcome a new user warmly, then answer their first questions from the knowledge base.',
    'playbook.template.billing-question-lookup.name': 'Answer a billing question',
    'playbook.template.billing-question-lookup.summary':
      'Tag billing questions and answer them from your knowledge base.',
    'playbook.template.cancel-subscription-handover.name': 'Cancel a subscription',
    'playbook.template.cancel-subscription-handover.summary':
      'Understand why, summarise it, and route the cancellation to the billing team.',
    'playbook.template.vip-customer-priority.name': 'Prioritise a VIP customer',
    'playbook.template.vip-customer-priority.summary':
      'Recognise a top-tier customer and route them straight to a senior agent.',
    'playbook.template.multilingual-greeting.name': 'Greet in the customer’s language',
    'playbook.template.multilingual-greeting.summary':
      'Recognise a Spanish greeting and reply in kind before answering.',
    'playbook.template.post-purchase-checkin.name': 'Check in after a purchase',
    'playbook.template.post-purchase-checkin.summary':
      'Ask how the product is working out, then answer from your knowledge base.',
    'playbook.template.shopify-order-lookup.name': 'Look up an order in Shopify',
    'playbook.template.shopify-order-lookup.summary':
      'Ask for the order number and check its status in your store.',
    'playbook.template.stripe-refund.name': 'Start a refund in Stripe',
    'playbook.template.stripe-refund.summary':
      'Take the order number and route the refund to the billing team.',
    'playbook.template.csat-followup.name': 'Ask for feedback',
    'playbook.template.csat-followup.summary':
      'Once things are resolved, summarise and ask how it went.',
    'playbook.template.paypal-refund.name': 'Start a refund in PayPal',
    'playbook.template.paypal-refund.summary':
      'Take the order number and send the PayPal refund to the billing team.',
    'playbook.template.salesforce-case-sync.name': 'Log a case in Salesforce',
    'playbook.template.salesforce-case-sync.summary':
      'Capture the details and file the issue as a case for the support team.',
    'playbook.template.klaviyo-abandoned-cart.name': 'Recover an abandoned cart',
    'playbook.template.klaviyo-abandoned-cart.summary':
      'Reply to a cart question and offer a hand finishing the purchase.',
    'playbook.template.recharge-subscription-pause.name': 'Pause a subscription in Recharge',
    'playbook.template.recharge-subscription-pause.summary':
      'Collect the subscription id and route the pause request to billing.',
    'playbook.template.calendly-book-a-call.name': 'Book a call in Calendly',
    'playbook.template.calendly-book-a-call.summary':
      'Reply with a scheduling link when someone wants to talk to a person.',
    'playbook.template.shipstation-tracking-update.name': 'Check a live tracking update',
    'playbook.template.shipstation-tracking-update.summary':
      'Ask for the order number and reply that you are checking its tracking status.',
    'playbook.template.quickbooks-invoice-lookup.name': 'Look up an invoice in QuickBooks',
    'playbook.template.quickbooks-invoice-lookup.summary':
      'Ask for the invoice number and route billing questions to the billing team.',
    'playbook.template.edit-order-before-shipping.name': 'Edit an order before it ships',
    'playbook.template.edit-order-before-shipping.summary':
      'Collect the order number and change request, then route it to support fast.',
  },
  tr: {
    // Shell chrome
    'shell.modules': 'Modüller',
    'shell.subscribe': 'Abone Ol',
    'shell.trial.ended': 'Deneme süreniz sona erdi — yeni sohbetler başlatmak için abone olun.',
    'shell.trial.remaining': 'Deneme sürenizde {days} gün kaldı.',
    'shell.account': 'Hesap',
    'shell.account.agentFallback': 'Temsilci',
    'shell.account.signOut': 'Çıkış Yap',
    'shell.account.language': 'Dil',
    'shell.account.theme': 'Tema',
    'shell.account.theme.dark': 'Koyu',
    'shell.account.theme.light': 'Açık',
    'shell.brand': 'Marka',

    // Navigation
    'nav.home': 'Ana Sayfa',
    'nav.inbox': 'Gelen Kutusu',
    'nav.customers': 'Müşteriler',
    'nav.team': 'Ekip',
    'nav.playbook': 'Senaryolar',
    'nav.reports': 'Raporlar',
    'nav.billing': 'Faturalandırma',
    'nav.settings': 'Ayarlar',
    'nav.developers': 'Geliştiriciler',

    // Command palette
    'palette.label': 'Komut paleti',
    'palette.search': 'Ara veya git',
    'palette.placeholder': 'Metin ara veya git…',
    'palette.searching': 'Aranıyor…',
    'palette.noMatches': 'Eşleşme yok.',
    'palette.group.goTo': 'Git',
    'palette.group.actions': 'Aksiyonlar',
    'palette.group.customers': 'Müşteriler',
    'palette.group.conversations': 'Sohbetler',
    'palette.group.tickets': 'Talepler',
    'palette.unnamedVisitor': 'İsimsiz ziyaretçi',
    'palette.visitor': 'Ziyaretçi',
    'palette.action.failed': 'Bu aksiyon gerçekleşmedi.',
    'palette.action.failedFallback': 'Hiçbir şey değişmedi — yeniden deneyin.',
    'palette.action.failedDismiss': 'Kapat',
    'palette.group.ai': "AI'ya Sor",
    'palette.ai.ask': `AI'ya sor: "{query}"`,
    'palette.ai.source': 'Kaynak: {source}',
    'palette.ai.noData.title': 'Henüz veri yok',
    'palette.ai.notUnderstood.title': 'Ne demek istediğinizden emin değilim',
    'palette.ai.error': 'Cevap alınamadı — yeniden deneyin.',

    // Playbook — skill template catalogue (NFR-I18N2)
    'playbook.template.order-status.name': 'Siparişim nerede?',
    'playbook.template.order-status.summary':
      'Sipariş numarasını isteyin, etiketleyin ve bilgi tabanından yanıtlayın.',
    'playbook.template.returns-policy.name': 'İade politikası',
    'playbook.template.returns-policy.summary':
      'Bir iade sorusunu tanıyın ve dizinlenmiş politikanızdan yanıtlayın.',
    'playbook.template.business-hours.name': 'Çalışma saatleri',
    'playbook.template.business-hours.summary':
      '“Açık mısınız?” sorusuna sabit bir yanıt, bilgi tabanı gerekmez.',
    'playbook.template.shipping-cost.name': 'Kargo ücretleri',
    'playbook.template.shipping-cost.summary':
      'Kargo ücreti sorularını doğrudan bilgi tabanınızdan yanıtlayın.',
    'playbook.template.order-cancellation.name': 'Sipariş iptali',
    'playbook.template.order-cancellation.summary':
      'Sipariş numarasını isteyin ve iptal talebini destek ekibine yönlendirin.',
    'playbook.template.payment-methods.name': 'Kabul edilen ödeme yöntemleri',
    'playbook.template.payment-methods.summary':
      'Bir ödeme yöntemi sorusunu tanıyın ve bilgi tabanınızdan yanıtlayın.',
    'playbook.template.change-shipping-address.name': 'Teslimat adresini değiştirme',
    'playbook.template.change-shipping-address.summary':
      'Sipariş numarasını isteyin ve adres değişikliğini destek ekibine yönlendirin.',
    'playbook.template.warranty-coverage.name': 'Garanti kapsamı',
    'playbook.template.warranty-coverage.summary':
      'Garantinizin neyi kapsadığına dair sabit bir açıklama, bilgi tabanından yanıtlanır.',
    'playbook.template.contact-support.name': 'Bize nasıl ulaşılır',
    'playbook.template.contact-support.summary':
      'İletişim kanallarınızla sabit bir yanıt, bilgi tabanı gerekmez.',
    'playbook.template.discount-code-issue.name': 'İndirim kodu çalışmıyor',
    'playbook.template.discount-code-issue.summary':
      'Kodu isteyin ve destek ekibine yönlendirerek çözüme kavuşturun.',
    'playbook.template.delete-my-account.name': 'Hesabımı sil',
    'playbook.template.delete-my-account.summary':
      'Bir hesap silme talebini tanıyın ve destek ekibine yönlendirin.',
    'playbook.template.greet-and-route.name': 'Karşıla ve konuyu bul',
    'playbook.template.greet-and-route.summary':
      'Sıcak bir açılış yapın, ardından asistanın bildiğinden yanıtlamasına izin verin.',
    'playbook.template.collect-then-handover.name': 'Bilgi topla, sonra devret',
    'playbook.template.collect-then-handover.summary':
      'E-posta isteyin, sohbeti özetleyin ve insan bir ekibe aktarın.',
    'playbook.template.troubleshoot-then-escalate.name': 'Sorun gider, sonra yükselt',
    'playbook.template.troubleshoot-then-escalate.summary':
      'Önce bilgi tabanı tabanlı bir yanıt deneyin, yetmezse özetleyip devredin.',
    'playbook.template.angry-customer-deescalate.name': 'Kızgın bir müşteriyi yatıştır',
    'playbook.template.angry-customer-deescalate.summary':
      'Hayal kırıklığını kabul edin, sorunu özetleyin ve kıdemli bir temsilciye aktarın.',
    'playbook.template.product-recommendation.name': 'Ürün öner',
    'playbook.template.product-recommendation.summary':
      'Müşterinin ihtiyacını sorun, ardından bilgi tabanından bir öneriyle yanıtlayın.',
    'playbook.template.onboarding-walkthrough.name': 'Yeni bir kullanıcıya rehberlik et',
    'playbook.template.onboarding-walkthrough.summary':
      'Yeni bir kullanıcıyı sıcak karşılayın, ardından ilk sorularını bilgi tabanından yanıtlayın.',
    'playbook.template.billing-question-lookup.name': 'Bir faturalandırma sorusunu yanıtla',
    'playbook.template.billing-question-lookup.summary':
      'Faturalandırma sorularını etiketleyin ve bilgi tabanınızdan yanıtlayın.',
    'playbook.template.cancel-subscription-handover.name': 'Abonelik iptali',
    'playbook.template.cancel-subscription-handover.summary':
      'Nedenini anlayın, özetleyin ve iptali faturalandırma ekibine yönlendirin.',
    'playbook.template.vip-customer-priority.name': 'VIP müşteriye öncelik ver',
    'playbook.template.vip-customer-priority.summary':
      'Üst düzey bir müşteriyi tanıyın ve doğrudan kıdemli bir temsilciye yönlendirin.',
    'playbook.template.multilingual-greeting.name': 'Müşterinin dilinde karşıla',
    'playbook.template.multilingual-greeting.summary':
      'İspanyolca bir selamlamayı tanıyın ve yanıtlamadan önce aynı dilde karşılık verin.',
    'playbook.template.post-purchase-checkin.name': 'Satın alma sonrası kontrol',
    'playbook.template.post-purchase-checkin.summary':
      'Ürünün nasıl gittiğini sorun, ardından bilgi tabanından yanıtlayın.',
    'playbook.template.shopify-order-lookup.name': 'Shopify’da bir siparişi sorgula',
    'playbook.template.shopify-order-lookup.summary':
      'Sipariş numarasını isteyin ve mağazanızdaki durumunu kontrol edin.',
    'playbook.template.stripe-refund.name': 'Stripe’ta bir iade başlat',
    'playbook.template.stripe-refund.summary':
      'Sipariş numarasını alın ve iadeyi faturalandırma ekibine yönlendirin.',
    'playbook.template.csat-followup.name': 'Geri bildirim iste',
    'playbook.template.csat-followup.summary':
      'İşler çözüldüğünde özetleyin ve nasıl geçtiğini sorun.',
    'playbook.template.paypal-refund.name': 'PayPal’da bir iade başlat',
    'playbook.template.paypal-refund.summary':
      'Sipariş numarasını alın ve PayPal iadesini faturalandırma ekibine gönderin.',
    'playbook.template.salesforce-case-sync.name': 'Salesforce’ta bir vaka kaydet',
    'playbook.template.salesforce-case-sync.summary':
      'Ayrıntıları toplayın ve sorunu destek ekibi için bir vaka olarak kaydedin.',
    'playbook.template.klaviyo-abandoned-cart.name': 'Terk edilmiş sepeti kurtar',
    'playbook.template.klaviyo-abandoned-cart.summary':
      'Bir sepet sorusunu yanıtlayın ve siparişi tamamlamada yardım teklif edin.',
    'playbook.template.recharge-subscription-pause.name': 'Recharge’da bir aboneliği duraklat',
    'playbook.template.recharge-subscription-pause.summary':
      'Abonelik kimliğini isteyin ve duraklatma talebini faturalandırmaya yönlendirin.',
    'playbook.template.calendly-book-a-call.name': 'Calendly’de bir görüşme ayarla',
    'playbook.template.calendly-book-a-call.summary':
      'Biri görüşmek isteyince bir randevu bağlantısıyla yanıt verin.',
    'playbook.template.shipstation-tracking-update.name': 'Canlı kargo takibi kontrolü',
    'playbook.template.shipstation-tracking-update.summary':
      'Sipariş numarasını isteyin ve takip durumunu kontrol ettiğinizi bildirin.',
    'playbook.template.quickbooks-invoice-lookup.name': 'QuickBooks’ta bir faturayı sorgula',
    'playbook.template.quickbooks-invoice-lookup.summary':
      'Fatura numarasını isteyin ve faturalandırma sorularını ilgili ekibe yönlendirin.',
    'playbook.template.edit-order-before-shipping.name': 'Kargoya verilmeden önce siparişi düzenle',
    'playbook.template.edit-order-before-shipping.summary':
      'Sipariş numarasını ve değişiklik talebini toplayın, hızla destek ekibine yönlendirin.',
  },
};

export type TranslateParams = Record<string, string | number>;

/** Substitute `{name}` placeholders from `params`. */
function interpolate(template: string, params?: TranslateParams): string {
  if (!params) return template;
  return template.replace(/\{(\w+)\}/g, (whole, name: string) =>
    name in params ? String(params[name]) : whole,
  );
}

/**
 * Resolve a key in `locale`, falling back to English, then to the key itself.
 *
 * Pure and locale-explicit so the fallback is a plain unit test with no store or
 * React involved.
 */
export function translate(locale: Locale, key: string, params?: TranslateParams): string {
  const template = MESSAGES[locale]?.[key] ?? MESSAGES.en[key] ?? key;
  return interpolate(template, params);
}

/**
 * Whether `key` has an explicit entry in `locale`'s own catalogue — unlike
 * `translate`, this does not fall back to English or the key. Catalogue
 * completeness tests (a missing translation must fail loudly) need this; UI
 * rendering never should, which is why `translate`'s fallback stays silent.
 */
export function hasMessage(locale: Locale, key: string): boolean {
  return key in MESSAGES[locale];
}

/** Narrow anything to a supported locale, defaulting to English. */
function coerceLocale(value: string | null | undefined): Locale {
  if (!value) return 'en';
  const base = value.toLowerCase().split('-')[0];
  return base === 'tr' ? 'tr' : 'en';
}

/**
 * Initial locale: a remembered choice wins, then the browser's preference, then
 * English. Wrapped because storage access throws in locked-down browsers.
 */
export function detectLocale(): Locale {
  try {
    const stored = globalThis.localStorage?.getItem(STORAGE_KEY);
    if (stored) return coerceLocale(stored);
  } catch {
    // Ignore — fall through to the browser preference.
  }
  return coerceLocale(globalThis.navigator?.language);
}

/**
 * Apply the side effects of a locale: remember it, tell the Intl formatters, and
 * set `<html lang>` so assistive tech and the browser agree on the language.
 */
function applyLocale(locale: Locale): void {
  setFormatLocale(locale);
  try {
    globalThis.localStorage?.setItem(STORAGE_KEY, locale);
  } catch {
    // A locale that cannot be remembered simply resets next load — not fatal.
  }
  if (typeof document !== 'undefined') {
    document.documentElement.lang = locale;
  }
}

interface LocaleStore {
  locale: Locale;
  setLocale: (locale: Locale) => void;
}

const initialLocale = detectLocale();
applyLocale(initialLocale);

/** The one source of the active locale; components subscribe through the hooks. */
export const useLocaleStore = create<LocaleStore>((set) => ({
  locale: initialLocale,
  setLocale: (locale) => {
    applyLocale(locale);
    set({ locale });
  },
}));

/** `[locale, setLocale]` — for the language switcher. */
export function useLocale(): { locale: Locale; setLocale: (locale: Locale) => void } {
  const locale = useLocaleStore((s) => s.locale);
  const setLocale = useLocaleStore((s) => s.setLocale);
  return { locale, setLocale };
}

export type TFunction = (key: string, params?: TranslateParams) => string;

/**
 * A `t()` bound to the active locale. Subscribing here is what re-renders a
 * component when the agent switches languages.
 *
 * Memoised on the locale so its identity is stable across renders — callers put
 * it in `useMemo`/`useEffect` dependency lists (the command palette does), and
 * a fresh function each render would thrash those.
 */
export function useTranslate(): TFunction {
  const locale = useLocaleStore((s) => s.locale);
  return useCallback((key, params) => translate(locale, key, params), [locale]);
}

/** Read the active locale without React — for the odd non-component caller. */
export function getLocale(): Locale {
  return useLocaleStore.getState().locale;
}
