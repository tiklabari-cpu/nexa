import type { Messages } from '../merge.js';

/** Shared text — the ADR-06 error taxonomy rendered for a human. See the English file. */
export const common: Messages = {
  'common.errors.account_exists': 'Bu e-posta adresine ait bir hesap zaten var.',
  'common.errors.authentication': 'Oturumunuzun süresi doldu — yeniden giriş yapın.',
  'common.errors.authorization': 'Bunu yapma yetkiniz yok.',
  'common.errors.brand_exists': 'Bu adda bir marka zaten var.',
  'common.errors.brand_not_found': 'Bu markayı bulamadık.',
  'common.errors.chat_anonymized': 'Bu sohbet anonimleştirildi ve artık açılamıyor.',
  'common.errors.chat_inactive': 'Bu sohbet artık etkin değil.',
  'common.errors.customer_banned': 'Bu ziyaretçi engellenmiş.',
  'common.errors.greeting_not_found': 'Bu karşılamayı bulamadık.',
  'common.errors.group_in_use':
    'Bu ekip hâlâ kullanımda — bir yönlendirme kuralı onu hedefliyor ya da açık sohbetleri var.',
  'common.errors.group_not_found': 'Bu ekibi bulamadık.',
  'common.errors.group_offline': 'Bu ekip şu anda çevrimdışı.',
  'common.errors.group_unavailable': 'Bu ekip şu anda bu sohbeti alamıyor.',
  'common.errors.groups_offline': 'Şu anda tüm ekipler çevrimdışı.',
  'common.errors.internal': 'Bizim tarafımızda bir şeyler ters gitti — yeniden deneyin.',
  'common.errors.license_expired': 'Aboneliğiniz sona erdi — devam etmek için yenileyin.',
  'common.errors.limit_reached': 'Paketinizin sınırına ulaştınız.',
  'common.errors.message_rejected': 'Bu mesaj reddedildi.',
  'common.errors.misdirected_request':
    'Bu istek yanlış yere gitti — sayfayı yenileyip tekrar deneyin.',
  'common.errors.network': 'Sunucuya ulaşılamadı — bağlantınızı kontrol edin.',
  'common.errors.not_allowed': 'Buna izin verilmiyor.',
  'common.errors.not_found': 'Bunu bulamadık.',
  'common.errors.pending_requests_limit_reached':
    'Zaten çok sayıda istek bekliyor — birazdan yeniden deneyin.',
  'common.errors.request_timeout': 'Bu işlem çok uzun sürdü — yeniden deneyin.',
  'common.errors.sandbox_exists': 'Bu çalışma alanında zaten bir kum havuzu var.',
  'common.errors.service_unavailable': 'Servis geçici olarak kullanılamıyor — birazdan deneyin.',
  'common.errors.takeover_conflict': 'Bu sohbeti önce bir başkası aldı.',
  'common.errors.ticket_exists': 'Bu sohbet için zaten bir talep var.',
  'common.errors.too_many_requests': 'Çok fazla deneme — biraz bekleyip yeniden deneyin.',
  'common.errors.two_factor_already_enabled':
    'İki adımlı doğrulama zaten açık — yeniden kurmadan önce kapatın.',
  'common.errors.two_factor_required': 'Devam etmek için iki adımlı doğrulama kodunuzu girin.',
  'common.errors.unknown': 'Bir şeyler ters gitti — yeniden deneyin.',
  'common.errors.unsupported_version': 'Bu sayfa güncel değil — yenileyip tekrar deneyin.',
  'common.errors.users_limit_reached': 'Paketinizde boş koltuk kalmadı.',
  'common.errors.validation': 'İşaretli alanları kontrol edip yeniden deneyin.',
  'common.errors.website_exists': 'Bu web sitesi zaten bağlı.',
  'common.errors.wrong_product_version': 'Bu sayfa güncel değil — yenileyip tekrar deneyin.',
  // The design-system primitives' own defaults (Banner.tsx, Panel.tsx).
  'common.actions.dismiss': 'Kapat',
  'common.actions.collapsePanel': 'Paneli daralt',
  // Tour.tsx's own chrome (FR-MOD-02.2.3).
  'common.actions.tourNext': 'İleri',
  'common.actions.tourBack': 'Geri',
  'common.actions.tourSkip': 'Atla',
  'common.actions.tourDone': 'Bitti',
  'common.actions.tourProgress': 'Adım {current} / {count}',
};
