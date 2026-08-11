/**
 * Widget internationalisation (I18N1).
 *
 * The widget cannot afford the panel's React-bound i18n store: it renders to the
 * DOM by hand under a 50 KB budget (NFR-P3), and its locale is fixed for the
 * life of a page load — the embedding site chooses it via `data-language` and it
 * never changes underneath the visitor. So this is the smallest thing that
 * works: two flat string tables and a translator bound once at mount.
 *
 * The fallback chain matches the panel — active locale → English → the key — so
 * a gap in the Turkish table shows English rather than a raw key, and a typo'd
 * key is visible rather than fatal.
 */
export type WidgetLocale = 'en' | 'tr';

export type WidgetTranslate = (key: string, params?: Record<string, string | number>) => string;

const MESSAGES: Record<WidgetLocale, Record<string, string>> = {
  en: {
    'title.default': 'Chat with us',
    'launcher.text': 'Chat',
    'launcher.open': 'Open chat',
    'launcher.close': 'Close chat',
    'panel.label': 'Customer support chat',
    'transcript.label': 'Conversation',
    'status.queue': 'You are number {n} in the queue',
    'status.offline': 'No one is available right now — leave a message and we will reply.',
    'error.connect': 'Chat is unavailable right now. Please try again shortly.',
    'error.upload': 'That file could not be attached.',
    'error.send': 'Message not sent. Check your connection and try again.',
    'attach.label': 'Attach a file',
    'attach.remove': 'Remove attachment',
    'input.placeholder': 'Type your message…',
    'input.label': 'Message',
    send: 'Send',
    'prechat.intro': 'Tell us who you are and we will get started.',
    'prechat.name': 'Your name',
    'prechat.email': 'Email (optional)',
    'prechat.emailLabel': 'Email',
    'prechat.submit': 'Start chat',
    'greeting.label': 'Chat with us',
    'greeting.msg': 'Hi there 👋 Have a question? We are happy to help.',
    'greeting.chat': "Let's chat",
    'greeting.browse': 'Just browsing',
    'attachment.alt': 'Attachment',
    'typing.named': '{name} is typing…',
    'typing.generic': 'Typing…',
    poweredBy: 'Powered by Nexa',
  },
  tr: {
    'title.default': 'Bizimle sohbet edin',
    'launcher.text': 'Sohbet',
    'launcher.open': 'Sohbeti aç',
    'launcher.close': 'Sohbeti kapat',
    'panel.label': 'Müşteri destek sohbeti',
    'transcript.label': 'Konuşma',
    'status.queue': 'Sırada {n}. sıradasınız',
    'status.offline': 'Şu anda kimse müsait değil — mesaj bırakın, size döneceğiz.',
    'error.connect': 'Sohbet şu anda kullanılamıyor. Lütfen birazdan tekrar deneyin.',
    'error.upload': 'Bu dosya eklenemedi.',
    'error.send': 'Mesaj gönderilemedi. Bağlantınızı kontrol edip tekrar deneyin.',
    'attach.label': 'Dosya ekle',
    'attach.remove': 'Eki kaldır',
    'input.placeholder': 'Mesajınızı yazın…',
    'input.label': 'Mesaj',
    send: 'Gönder',
    'prechat.intro': 'Kim olduğunuzu söyleyin, başlayalım.',
    'prechat.name': 'Adınız',
    'prechat.email': 'E-posta (isteğe bağlı)',
    'prechat.emailLabel': 'E-posta',
    'prechat.submit': 'Sohbeti başlat',
    'greeting.label': 'Bizimle sohbet edin',
    'greeting.msg': 'Merhaba 👋 Bir sorunuz mu var? Yardımcı olmaktan mutluluk duyarız.',
    'greeting.chat': 'Sohbet edelim',
    'greeting.browse': 'Sadece bakıyorum',
    'attachment.alt': 'Ek',
    'typing.named': '{name} yazıyor…',
    'typing.generic': 'Yazıyor…',
    poweredBy: 'Nexa ile güçlendirilmiştir',
  },
};

/** BCP-47 tag → a supported locale, defaulting to English. */
export function resolveWidgetLocale(language: string | null | undefined): WidgetLocale {
  return (language ?? '').toLowerCase().startsWith('tr') ? 'tr' : 'en';
}

function interpolate(template: string, params?: Record<string, string | number>): string {
  if (!params) return template;
  return template.replace(/\{(\w+)\}/g, (whole, name: string) =>
    name in params ? String(params[name]) : whole,
  );
}

/** A translator bound to `language` for the life of the widget. */
export function createTranslator(language: string | null | undefined): WidgetTranslate {
  const locale = resolveWidgetLocale(language);
  return (key, params) => {
    const template = MESSAGES[locale][key] ?? MESSAGES.en[key] ?? key;
    return interpolate(template, params);
  };
}
