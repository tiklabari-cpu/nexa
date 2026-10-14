# Task ID: 387

**Title:** AI-MULTILINGUAL [OPUS-HIGH] AI çok dilli yanıt: dil algılama AI-05 çıktısında, iki ardışık güvenli mesajla dil değişimi, sadık çeviri + sayı koruma kontrolü, izinli olmayan dilde şablon + devir + AI-22 kaydı; persona dillerine RU/AZ (widget dili DEĞİL — K25)

**Status:** pending

**Dependencies:** 297 ⏱, 301 ⏱

**Priority:** low

**Description:** Desteklenmeyen dilde AI sessizce atlıyor (skill-engine.ts:269-280 declined → skipped; yanıt yok, devir yok). Rusça/Azerice yazan oyuncu cevapsız kalıyor. Kaynak: AI-30.

**Details:**

KAYNAK: SiyahTus-Analiz 03-eklenebilecekler.md / 04-gerekceler-ve-sorular.md (Karar kaydı K1–K27 ve "Kararların maddelere etkisi" madde içi varsayılanların önüne geçer) / 05-uygulama-rehberi.md — maddeler: AI-30. Eşleme: SiyahTus-Analiz/07-gorev-plani.md.
TERİM EŞLEMESİ (K1=A): ekranda "Thread ID" = nexa Chat (kod/DB/API alanı chat_id, günlük kapsayıcı); ekranda "Chat ID" = nexa Thread (kod alanı thread_id, tek bağlantı). Kod adları değişmez; çeviri yalnız sunum katmanında.
SIRA (contract-first): OpenAPI (packages/contract) → pnpm contract:generate (@siyahtus/types) → Prisma migration (genişlet → taşı → daralt; CONCURRENTLY kendi dosyasında tek ifade) → API servis + birim test → RTM → web/widget/mobil → entegrasyon/E2E.
PROTOKOL: TASK-RUNNER-PROMPT.md (bootstrap → build → verify → fix → close); CONVENTIONS.md §1 (DoD), §2 (git), §3 (HANDOFF), §5, §6.3 (migration), §7 (test başlığında gereksinim etiketi); CLAUDE.md sınırları (production/DNS/TLS/gerçek secret/kart/ödeme YOK; dış servisler mock).
NOT: 05'teki dosya:satır referansları 2026-10-14 çalışma kopyasına göredir; başlamadan önce grep ile yeniden doğrula, kayma varsa HANDOFF'a yaz.
DALGA: Dalga 6 — widget, engage, helpdesk, raporlar, kanallar, faturalama, GV.

K25 (sahip kararı): widget arayüz dilleri 8 dilde kalır, RU/AZ widget locale dosyası EKLENMEZ (05 AI-30 "Widget: WG-02 ile ru ve az locale" satırı UYGULANMAZ). AI yine RU/AZ cevap verebilir: PERSONA_LANGUAGES += 'ru', 'az' (S2).
KOD: persona.ts:56 PERSONA_LANGUAGES, :472-506 detectLanguage, :532-546 personaLanguageVerdict; skill-engine.ts:269-280; answer-prompt.ts:70-72; ProfileForm.tsx; Expertise schema:739.
types: PERSONA_LANGUAGES += ru, az; detectLanguage durak kelimeleri genişler; persona defaultLanguage (tr), translateFromKnowledge: Record<lang, boolean>, disclaimerOnTranslation.
motor: dil AI-05 sınıflandırma JSON çıktısına {language, confidence} (#297; ayrı çağrı yok); mock modda detectLanguage; conversation_language (AI-01 durumu); güven <0,7 ya da <3 kelime → mevcut dil korunur; değişim iki ardışık güvenli mesajla; başlangıçta marka/widget dili, yoksa defaultLanguage.
DESTEK KARARI: izinli + bilgi o dilde → doğrudan; izinli + bilgi yalnız TR + translateFromKnowledge açık → sadık çeviri (+ not); izinli değil → şablon (algılanan dilde, yoksa EN) + AI-09 devri reason unsupported_language + AI-22 kaydı (sessiz skipped kalkar).
KORUMA: ödeme/bonus/KYC yanıtlarında çeviri çıktısının sayı/para birimi/süre kümesi kaynakla eşit değilse yanıt gönderilmez, devir. AI-08 (#301) yasaklı ifadeler ve çıktı denetimi hedef dilde (dil başına sözlük ya da fast modelle anlamsal denetim). Devir kartı (AI-10) player_language + Türkçe özet. AU-01 dile göre ekip (Expertise) opsiyonel.
prompt: hedef dil + "sayıları, para birimlerini, limitleri, süreleri ve yöntem adlarını aynen koru; bilgide olmayanı ekleme" (LLM ADR §6 — tools/response_format yok).
web: ProfileForm dil ayarları; AI-25 dil filtresi. AZ/TR yakınlığı: "TR / AZ ortak" davranışı kabul.

KABUL KRİTERLERİ:
- Rusça yazana Rusça yanıt; "ok" dili değiştirmez.
- TR bilgiden çevrilen RU yanıtta "100 TL" ve "30 dakika" aynen; sayı değişirse gönderilmez ve devredilir.
- İzinli olmayan dilde şablon + devir; AI-22'de unsupported_language.
- Yasaklı ifadenin RU/EN karşılığı yakalanır.
- Devir kartında dil + Türkçe özet.
- Widget dil listesi 8 dilde kalır (RU/AZ locale yok).

KULLANILAN VARSAYIMLAR:
- K25: widget RU/AZ yok; AI persona listesinde RU/AZ var.
- AI-30-S1: kiracı dil bazında çeviriyi kapatabilir.
- P2 → low.

**Test Strategy:**

Dil yapışkanlığı, RU→RU (mock), desteklenmeyen dilde devir + kayıt, sayı koruma fikstürü, yasaklı ifade RU; `pnpm test:gate`. DoD: CONVENTIONS §1 kapısı exit 0 — `pnpm test:gate` (arka planda; log son satırları), db:check-drift, contract:generate temiz, audit:req-coverage, PLAN §K kanıtı + HANDOFF bloğu.
