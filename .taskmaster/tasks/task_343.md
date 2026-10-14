# Task ID: 343

**Title:** FORM-FIELD-TYPES-TOPIC [OPUS-HIGH] (Opus 5.5) Form alan tipleri (select, multiselect, topic) + düzenleme/sıralama + konu seçimiyle ekip kuyruğuna yönlendirme

**Status:** pending

**Dependencies:** 305 ⏱

**Priority:** medium

**Description:** Özel alan tipleri yalnız text/number/boolean/date; formlar düzenlenemiyor; oyuncunun seçtiği konu yönlendirmeye girmiyor ("Para çekme" → Finans). Kaynak: WG-04.

**Details:**

KAYNAK: SiyahTus-Analiz 03-eklenebilecekler.md / 04-gerekceler-ve-sorular.md (Karar kaydı K1–K27 ve "Kararların maddelere etkisi" madde içi varsayılanların önüne geçer) / 05-uygulama-rehberi.md — maddeler: WG-04. Eşleme: SiyahTus-Analiz/07-gorev-plani.md.
TERİM EŞLEMESİ (K1=A): ekranda "Thread ID" = nexa Chat (kod/DB/API alanı chat_id, günlük kapsayıcı); ekranda "Chat ID" = nexa Thread (kod alanı thread_id, tek bağlantı). Kod adları değişmez; çeviri yalnız sunum katmanında.
SIRA (contract-first): OpenAPI (packages/contract) → pnpm contract:generate (@siyahtus/types) → Prisma migration (genişlet → taşı → daralt; CONCURRENTLY kendi dosyasında tek ifade) → API servis + birim test → RTM → web/widget/mobil → entegrasyon/E2E.
PROTOKOL: TASK-RUNNER-PROMPT.md (bootstrap → build → verify → fix → close); CONVENTIONS.md §1 (DoD), §2 (git), §3 (HANDOFF), §5, §6.3 (migration), §7 (test başlığında gereksinim etiketi); CLAUDE.md sınırları (production/DNS/TLS/gerçek secret/kart/ödeme YOK; dış servisler mock).
NOT: 05'teki dosya:satır referansları 2026-10-14 çalışma kopyasına göredir; başlamadan önce grep ile yeniden doğrula, kayma varsa HANDOFF'a yaz.
DALGA: Dalga 6 — widget, engage, helpdesk, raporlar, kanallar, faturalama, GV.

KOD: types/custom-fields.ts:82 CUSTOM_FIELD_TYPES, :176 checkCustomFieldValue; schema:1036-1065 (options/position yok); widget.ts:2039 renderFormFields; ChatFormsSettings.tsx (ekle/sil); routing-service.ts:26-33 requestedGroupId, #selectGroup :261-276; customer.ts:840 (yalnız URL).
types/contract: select, multiselect, topic; options [{value, label, target_group_id?}], position; custom-fields.yaml (PATCH dahil).
prisma: custom_field_definitions.options JSONB NULL, position INT DEFAULT 0 + CHECK (seçenekli tipte options dolu, ≤50 seçenek, etiket ≤80); tip CHECK genişler.
api: routes/custom-fields.ts oluştur/düzenle/sırala; checkCustomFieldValue seçenek listede mi (değilse 400); customer.ts ilk mesajda topic cevabı → RoutingContext.requestedGroupId (AU-01 #305 kuyruk çözümü).
KURALLAR: topic form başına ≤1, yalnız pre_chat; cevap kontak alanına + yönlendirme bağlamına; silinmiş ekibe bağlı seçenek → kurallara düşer; oyuncu etiketi ile kuyruk adı ayrı; AI açıkken konu seçimi İLK ekip kararını verir, AI devrinde AI-12 hedefi önceliklidir (#307 ile çakışma kuralı); topic oyuncu beyanıdır, AI-05 tespitinden ayrı raporlanır (RP-01 #368).
widget: seçim listesi/açılır/çoklu (ARIA, klavye). web: düzenleme + ok tuşlu sıralama (SkillEditor kalıbı) + seçenek editörü + ekip seçici; GV-06 kalıbı.

KABUL KRİTERLERİ:
- Açılır liste tipi soru eklenir, düzenlenir, sıralanır; widget'ta doğru sıra ve tipte.
- Listede olmayan değer 400.
- "Para çekme" seçen oyuncunun sohbeti Finans ekibine/kuyruğuna girer.
- Silinmiş ekibe bağlı seçenek sohbeti düşürmez.

KULLANILAN VARSAYIMLAR:
- AI-12 hedefi devirde önceliklidir.

**Test Strategy:**

types/custom-fields.test.ts, widget.prechat.test.ts, routing.test.ts (konu → ekip); `pnpm test:gate`. DoD: CONVENTIONS §1 kapısı exit 0 — `pnpm test:gate` (arka planda; log son satırları), db:check-drift, contract:generate temiz, audit:req-coverage, PLAN §K kanıtı + HANDOFF bloğu.
