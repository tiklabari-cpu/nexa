import type { Messages } from '../merge.js';

/**
 * Shared text — the ADR-06 error taxonomy rendered for a human, and the design-system
 * primitives' own words (tm 389.6). `common.errors.<type>` covers every member of
 * `ERROR_TYPES` plus the client-only `network` and `unknown`; `i18n-coverage.test.ts`
 * fails if the taxonomy grows a type this file has not answered for.
 */
export const common: Messages = {
  'common.actions.collapsePanel': 'Paneli daralt',
  'common.actions.dismiss': 'Kapat',
  'common.errors.account_exists': 'Bu e-posta adresine ait bir hesap zaten var.',
  'common.errors.ai_agent_exists': 'Bu çalışma alanının zaten bir AI ajanı var.',
  'common.errors.ai_guardrail_setup_incomplete':
    'Kriz metni yazılıp çalışma alanı sahibi tarafından onaylanmadan AI ajanı yayına alınamaz.',
  'common.errors.ai_mode_transition_refused': 'Bu sohbeti AI yanıtlamıyor.',
  'common.errors.ai_return_blocked':
    "Bu sohbet işaretli ve bir kişide kalmalı; AI'a geri verilemez.",
  'common.errors.ai_test_run_in_progress':
    'Bu AI ajanının bir test koşusu hâlâ sürüyor — bitmesini bekleyin.',
  'common.errors.authentication': 'Oturumunuzun süresi doldu — yeniden giriş yapın.',
  'common.errors.authorization': 'Bunu yapma yetkiniz yok.',
  'common.errors.brand_exists': 'Bu adda bir marka zaten var.',
  'common.errors.brand_not_found': 'Bu markayı bulamadık.',
  'common.errors.challenge_required': 'Devam etmek için insan olduğunuzu doğrulayın.',
  'common.errors.chat_anonymized': 'Bu sohbet anonimleştirildi ve artık açılamıyor.',
  'common.errors.chat_inactive': 'Bu sohbet artık etkin değil.',
  'common.errors.customer_banned': 'Bu ziyaretçi engellenmiş.',
  'common.errors.fallback_rule_exists':
    'Bu çalışma alanının zaten bir yedek yönlendirme kuralı var — onu düzenleyin.',
  'common.errors.greeting_not_found': 'Bu karşılamayı bulamadık.',
  'common.errors.group_expertise_missing':
    'Bu ekip temsilcide olmayan yetenekler istiyor — önce yetenekleri temsilciye ekleyin.',
  'common.errors.group_in_use':
    'Bu ekip hâlâ kullanımda — bir yönlendirme kuralı onu hedefliyor ya da açık sohbetleri var.',
  'common.errors.group_not_found': 'Bu ekibi bulamadık.',
  'common.errors.group_offline': 'Bu ekip şu anda çevrimdışı.',
  'common.errors.group_protected':
    'Sorumlu oyun ekibi silinemez, konusu kaldırılamaz ve eğitim yeteneği boş bırakılamaz — yalnızca adını değiştirebilirsiniz.',
  'common.errors.group_topic_role_taken':
    'Bu konuya zaten başka bir ekip bakıyor — önce oradan kaldırın.',
  'common.errors.group_unavailable': 'Bu ekip şu anda bu sohbeti alamıyor.',
  'common.errors.groups_offline': 'Şu anda tüm ekipler çevrimdışı.',
  'common.errors.impersonation_forbidden_path': 'Destek oturumu bu işlemi bir üye adına yapamaz.',
  'common.errors.impersonation_read_only':
    'Bu salt okunur bir destek oturumu — buradan hiçbir şey değiştirilemez.',
  'common.errors.internal': 'Bizim tarafımızda bir şeyler ters gitti — yeniden deneyin.',
  'common.errors.knowledge_job_in_progress':
    'Bu kaynak zaten taranıyor — bitmesini bekleyin ya da taramayı durdurun.',
  'common.errors.license_expired': 'Aboneliğiniz sona erdi — devam etmek için yenileyin.',
  'common.errors.limit_reached': 'Paketinizin sınırına ulaştınız.',
  'common.errors.maintenance': 'Hizmet bakımda. Lütfen daha sonra yeniden deneyin.',
  'common.errors.message_rejected': 'Bu mesaj reddedildi.',
  'common.errors.misdirected_request':
    'Bu istek yanlış yere gitti — sayfayı yenileyip tekrar deneyin.',
  'common.errors.network': 'Sunucuya ulaşılamadı — bağlantınızı kontrol edin.',
  'common.errors.not_allowed': 'Buna izin verilmiyor.',
  'common.errors.not_found': 'Bunu bulamadık.',
  'common.errors.pending_requests_limit_reached':
    'Zaten çok sayıda istek bekliyor — birazdan yeniden deneyin.',
  'common.errors.platform_account_state': 'Hesabın şu anki durumu buna izin vermiyor.',
  'common.errors.platform_last_superadmin':
    'Bu değişiklik platformu etkin bir süper yöneticisiz bırakır.',
  'common.errors.platform_operation_running': 'Bu işlem zaten çalışıyor — bitince yeniden deneyin.',
  'common.errors.platform_reason_required':
    'Bu işlemin gerekçesini yazın (3–500 karakter) — denetim kaydına girer.',
  'common.errors.platform_recent_totp_required':
    'Bu işlemi onaylamak için doğrulama uygulamanızdan yeni bir kod girin.',
  'common.errors.platform_totp_required': 'Önce doğrulama uygulamanızdaki kodla girişi tamamlayın.',
  'common.errors.platform_workspace_state': 'Çalışma alanının şu anki durumu buna izin vermiyor.',
  'common.errors.request_timeout': 'Bu işlem çok uzun sürdü — yeniden deneyin.',
  'common.errors.sandbox_exists': 'Bu çalışma alanında zaten bir kum havuzu var.',
  'common.errors.service_unavailable': 'Servis geçici olarak kullanılamıyor — birazdan deneyin.',
  'common.errors.takeover_conflict': 'Bu sohbeti önce bir başkası aldı.',
  'common.errors.template_locked':
    'Bu prosedür kilitli bir şablondan kuruldu — kapatılamaz ve silinemez; yalnızca metinlerini ve ekibini değiştirebilirsiniz.',
  'common.errors.ticket_exists': 'Bu sohbet için zaten bir talep var.',
  'common.errors.ticket_merged': 'Bu talep başka bir talebe birleştirildi — o talebe yazın.',
  'common.errors.ticket_no_recipient':
    'Bu oyuncu e-posta adresi bırakmadı, bu yüzden yanıt gönderilemez — yine de iç not ekleyebilirsiniz.',
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
  'common.loadError.retry': 'Yeniden dene',
  'ui.confirm.cancel': 'Vazgeç',
  'ui.confirm.delete': 'Sil',
  'ui.confirm.pending': 'Bekleyin…',
  'ui.form.cardLast4': 'Son 4 haneyi girin — tam olarak 4 rakam.',
  'ui.form.domain': 'Geçerli bir alan adı girin, örneğin magaza.example.',
  'ui.form.email': 'Geçerli bir e-posta adresi girin.',
  'ui.form.emailListEmpty': 'En az bir e-posta adresi girin.',
  'ui.form.emailListInvalid': 'Geçerli bir adres değil: {addresses}',
  'ui.form.maxLength': 'En fazla {count} karakter girin.',
  'ui.form.minLength': 'En az {count} karakter girin.',
  'ui.form.phone': 'Geçerli bir telefon numarası girin, örneğin +905551234567.',
  'ui.form.required': 'Bu alan zorunludur.',
  'ui.form.submitFailed': 'Bir şeyler ters gitti. Lütfen tekrar deneyin.',
  'ui.save.clean': 'Tüm değişiklikler kaydedildi',
  'ui.save.discard': 'Vazgeç',
  'ui.save.failed': 'Değişiklikleriniz kaydedilemedi. Hâlâ burada — yeniden deneyin.',
  'ui.save.leaveMessage':
    'Bu bölümde kaydedilmemiş değişiklikler var. Ayrılıp bunları atmak istiyor musunuz?',
  'ui.save.save': 'Kaydet',
  'ui.save.saving': 'Kaydediliyor…',
  'ui.save.unsaved': 'Kaydedilmemiş değişiklikler',
  'ui.highRisk.after': 'Sonra',
  'ui.highRisk.before': 'Önce',
  'ui.highRisk.changes': 'Değişiklikler',
  'ui.highRisk.confirm': 'Onayla ve kaydet',
  'ui.highRisk.description':
    'Bu ayar tüm platformu etkiler. Aşağıdaki değişikliği kontrol edin ve nedenini yazın — gerekçe platform denetim kaydına yazılır.',
  'ui.highRisk.empty': '(boş)',
  'ui.highRisk.reason': 'Gerekçe',
  'ui.highRisk.reasonHint': 'Zorunlu. Denetim kaydına yazılır.',
  'ui.highRisk.reasonRequired': 'Bu değişiklik için bir gerekçe girin.',
  'ui.highRisk.title': 'Bu değişikliği onaylayın',
};
