# Task ID: 350

**Title:** PROMO-SUPPRESSION [OPUS-XHIGH] Risk bayraklı oyuncuya kampanya/bonus gösterilmemesi: isPromoSuppressed tek fonksiyon, fail-closed teslim kapısı, kilitli bayraklar, gerekçeli bayrak kaldırma

**Status:** pending

**Dependencies:** 302 ⏱

**Priority:** high

**Description:** Kampanya teslimi yalnız açık sohbet, ban ve deneme süresine bakıyor; kendini dışlamış ya da sorumlu oyun bayraklı oyuncuya bonus kampanyası gösterilebilir — lisans/uyum ihlali. Kaynak: EN-01.

**Details:**

KAYNAK: SiyahTus-Analiz 03-eklenebilecekler.md / 04-gerekceler-ve-sorular.md (Karar kaydı K1–K27 ve "Kararların maddelere etkisi" madde içi varsayılanların önüne geçer) / 05-uygulama-rehberi.md — maddeler: EN-01. Eşleme: SiyahTus-Analiz/07-gorev-plani.md.
TERİM EŞLEMESİ (K1=A): ekranda "Thread ID" = nexa Chat (kod/DB/API alanı chat_id, günlük kapsayıcı); ekranda "Chat ID" = nexa Thread (kod alanı thread_id, tek bağlantı). Kod adları değişmez; çeviri yalnız sunum katmanında.
SIRA (contract-first): OpenAPI (packages/contract) → pnpm contract:generate (@siyahtus/types) → Prisma migration (genişlet → taşı → daralt; CONCURRENTLY kendi dosyasında tek ifade) → API servis + birim test → RTM → web/widget/mobil → entegrasyon/E2E.
PROTOKOL: TASK-RUNNER-PROMPT.md (bootstrap → build → verify → fix → close); CONVENTIONS.md §1 (DoD), §2 (git), §3 (HANDOFF), §5, §6.3 (migration), §7 (test başlığında gereksinim etiketi); CLAUDE.md sınırları (production/DNS/TLS/gerçek secret/kart/ödeme YOK; dış servisler mock).
NOT: 05'teki dosya:satır referansları 2026-10-14 çalışma kopyasına göredir; başlamadan önce grep ile yeniden doğrula, kayma varsa HANDOFF'a yaz.
DALGA: Dalga 6 — widget, engage, helpdesk, raporlar, kanallar, faturalama, GV.

XHIGH GEREKÇESİ: (1) uyum kapısı (sorumlu oyun), fail-closed.
KOD: campaign-delivery.ts:151-200 deliverPendingCampaign (customer.ts:579-588), campaign-trigger.ts:153-200 fireCampaignsAtVisitor, campaign-service (invited), Campaign schema:1335, CampaignSend :1378.
types: isPromoSuppressed(activeFlags, policy), LOCKED_PROMO_FLAGS = ['responsible_gambling','underage_suspected','self_exclusion']; bayrak sözlüğü AI-27 (#302) ile ortak tek liste.
prisma: customer_risk_flags (oyuncu düzeyi; AI-27 #302 şemasıyla birlikte — orada yoksa burada: license_id, customer_id, kind, source ai|agent|import, raised_at/by, cleared_at/by, clear_reason + kısmi indeks + RLS); campaign_sends.suppressed_at, suppressed_reason; uyum ayarları promo_block_fraud DEFAULT true, promo_block_complaint DEFAULT false.
api: deliverPendingCampaign son kapı (bayrak yalnız "teslim edilebilir gönderim var" dalında okunur — yaygın yol sıfır maliyet); bastırılırsa suppressed_at, null; fireCampaignsAtVisitor ve aktivasyon bayraklıyı hedeflemez; AI-27 bayrak koyunca bekleyen gönderimler aynı işlemde bastırılır; POST /customers/{id}/risk-flags/{flagId}/clear gerekçe zorunlu, rol kontrollü (Sorumlu Oyun Ekip Lideri + Yönetici), audit; kilitli türler politika ucunda 400.
KURALLAR: FAIL-CLOSED (bayrak okunamazsa gösterilmez); bastırılan gönderim bayrak kalksa da sonradan gösterilmez; kapsam customer_id, ID-03 bağlantılarında birleşim; şirket geneli tüm markalar. Aynı fonksiyon AI-08 (bonus önermeme), EN-02 kart (#353), KN-01 şablon (#380), IN-07 öneri (#364) tarafından çağrılır.
web: CampaignsPage "Risk nedeniyle gösterilmedi: N", CustomerDetailPanel/Inbox "Promosyon engelli" rozeti + kaldırma diyaloğu, uyum ayarı (GV-06 yüksek riskli kalıbı #323).

KABUL KRİTERLERİ:
- self_exclusion bayraklı oyuncu eşleşen kampanyayı hiçbir poll'da almaz; gönderim suppressed_at ile işaretli.
- Bayraktan önce yazılmış bekleyen gönderim de teslim edilmez.
- responsible_gambling engelini kapatma 400.
- Gerekçesiz kaldırma reddedilir, yetkisiz rol 403, başarılı kaldırma audit'te.
- Bayrak tablosu okunamazsa (simüle) teslim yok.
- Kampanya kartında bastırılan sayısı doğru.

KULLANILAN VARSAYIMLAR:
- 05 EN-01 karar 1 (kaldırma yetkisi), karar 3 (şirket geneli kapsam).
- Tanınmayan ziyaretçi bayrak taşımaz — koruma K4 kimlik kalitesi kadar (07 açık risk).

**Test Strategy:**

types birim (kilitli türler), entegrasyon (önceden yazılmış gönderim, kiracılar arası, okuma hatası), e2e campaigns.spec.ts; `pnpm test:gate`. DoD: CONVENTIONS §1 kapısı exit 0 — `pnpm test:gate` (arka planda; log son satırları), db:check-drift, contract:generate temiz, audit:req-coverage, PLAN §K kanıtı + HANDOFF bloğu.
