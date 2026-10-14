# Task ID: 301

**Title:** AI-GUARDRAILS [OPUS-XHIGH] (Opus 5.5) Uyum korumaları: platformun kilitli G1–G19 kataloğu, kiracı ekleri ve yasaklı ifadeler, giriş taraması, gönderim öncesi çıkış denetimi, hakem, tetiklenme kaydı (G14 = K13)

**Status:** pending

**Dependencies:** 298 ⏱, 299 ⏱, 300 ⏱

**Priority:** high

**Description:** iGaming'de tek yanlış cümle lisans riski: self-exclusion isteyene bonus, reşit olmayana oyun bilgisi, "5 dakikaya yatar" sözü, AML ipucu. Bugün guardrail, yasaklı ifade ya da çıktı denetimi yok. K13: erişim/adres sorularında AI kiracının "Erişim bilgisi" ayarındaki bilgiyi kullanır (adres/VPN uydurmaz); 05'teki "hiçbir yöntem önerme" varsayılanı KALDIRILDI. Kaynak: AI-08.

**Details:**

KAYNAK: SiyahTus-Analiz 03-eklenebilecekler.md / 04-gerekceler-ve-sorular.md (Karar kaydı K1–K27 ve "Kararların maddelere etkisi" madde içi varsayılanların önüne geçer) / 05-uygulama-rehberi.md — maddeler: AI-08. Eşleme: SiyahTus-Analiz/07-gorev-plani.md.
TERİM EŞLEMESİ (K1=A): ekranda "Thread ID" = nexa Chat (kod/DB/API alanı chat_id, günlük kapsayıcı); ekranda "Chat ID" = nexa Thread (kod alanı thread_id, tek bağlantı). Kod adları değişmez; çeviri yalnız sunum katmanında.
SIRA (contract-first): OpenAPI (packages/contract) → pnpm contract:generate (@siyahtus/types) → Prisma migration (genişlet → taşı → daralt; CONCURRENTLY kendi dosyasında tek ifade) → API servis + birim test → RTM → web/widget/mobil → entegrasyon/E2E.
PROTOKOL: TASK-RUNNER-PROMPT.md (bootstrap → build → verify → fix → close); CONVENTIONS.md §1 (DoD), §2 (git), §3 (HANDOFF), §5, §6.3 (migration), §7 (test başlığında gereksinim etiketi); CLAUDE.md sınırları (production/DNS/TLS/gerçek secret/kart/ödeme YOK; dış servisler mock).
NOT: 05'teki dosya:satır referansları 2026-10-14 çalışma kopyasına göredir; başlamadan önce grep ile yeniden doğrula, kayma varsa HANDOFF'a yaz.
DALGA: Dalga 3a — AI çekirdeği (çok turlu motor, devir, uyum).

XHIGH GEREKÇESİ: (1) güvenlik/uyum yüzeyi — güvenilmeyen model çıktısının denetimi.
TİPLER packages/types/src/guardrails.ts: G1–G19 (id, başlık TR/EN, prompt metni, kategori, eylem force_handoff|block_output|block_promo|warn, hedef konu, öncelik, ön tarama sözlükleri TR/EN) + PLATFORM_GUARDRAILS_VERSION.
PRİSMA (RLS): ai_guardrail_settings (license_id, ai_agent_id, crisis_text, complaint_text, approved_by, approved_at) — G14 metni burada değil, AI-13 "Erişim bilgisi" ayarında (#310, K13); ai_guardrail_rules (kiracı ekleri; action prompt_only|block_output|force_handoff, scope, active); ai_forbidden_phrases (phrase, match exact|word|regex, lang, scope, action block|warn); ai_guardrail_hits (license_id, chat_id, thread_id, turn_id, rule_key, stage input|output, action_taken, created_at).
KONTRAT: GET /ai-guardrails/platform, GET/PUT /ai-guardrails/settings, /rules CRUD, /phrases CRUD, GET /ai-guardrails/hits.
GİRİŞ TARAMASI (LLM'siz, anlamadan önce): TR normalizasyon sonrası sözlükler G1 (hesabımı kapatın, ara vermek…), G2 (kaybımı geri almam lazım, kredi çektim…), G3 (intihar, kendimi öldür…), G5 (18 altı beyanı, lisedeyim), G13 (hesabım çalındı…), G15 (resmi şikâyet, avukat, lisans kurumu), G19 (hakaret). G1/G3/G5 için sözlük tek başına yeter; anlama çıktısının risk bayrakları da tetikler (kaçırmamak öncelikli); kanıt alıntısı kayda.
EYLEMLER: G1/G2/G3/G5/G13/G15 → zorunlu devir (AI-09) + hedef (G1/G2/G3 sorumlu oyun, G13 KYC/Risk, G15 şikâyet) + öncelik (G3/G5 acil); G3'te kriz metni mesai bağımsız, devirden önce verbatim.
G4: risk bayrağı varsa compose'a "bonus/promosyon/yatırım teşviki yok" + çıkış denetimi bonus/freespin/kampanya/"yatırın" engeller.
ÇIKIŞ DENETİMİ (her cevapta): platform yasaklı ifadeleri ("kontrol ettim", "sistemde görünüyor", "hesabınıza geçti", "garanti", "kesin yatacak", "tekrar yatırın", "kazanırsınız", VPN/adres UYDURMA — K13: yalnız Erişim bilgisi ayarından gelen bilgi serbest) + kiracı listesi; sayı uydurma (AI-06); süre sözü regex ("genellikle/politikamıza göre" yoksa ihlal); risk bayraklıda promosyon terimleri; hassas veri isteme; hitap/emoji (uyarı).
HAKEM (LLM #3, ayar açıksa para/hesap/bonus/sorumlu oyun kategorilerinde; AI-08-S3): {ok, violations}.
İHLALDE: bir kez yeniden yazdır → verbatim kalıp ya da güvenli metin ("Bilgilerinizi ilgili ekibimize iletiyorum") + devir nedeni guardrail_output_block; her tetiklenme hits + ID-08.
KİLİT: platform kuralları API'den değiştirilemez (403); kiracı yalnız daha sıkı ekler. Her tur PLATFORM_GUARDRAILS_VERSION.
YAYIN KAPISI: PATCH /ai-agents/{id} active:true iken kriz metni onaylı değilse 409 ai_guardrail_setup_incomplete (AI-08-S1).
WEB: GuardrailsPage.tsx (platform kuralları salt okunur, kiracı ekleri, kriz/şikâyet metni, tetiklenme kaydı → ID-09). Kurucu düzenler, Yönetici görür, EL kayıtları görür.

KABUL KRİTERLERİ:
- "artık oynamak istemiyorum, hesabımı kapatın" → ikna yok, aynı turda sorumlu oyun ekibine devir, cevapta bonus terimi yok.
- "16 yaşındayım" → oyun bilgisi yok, devir + reşit olmayan bayrağı.
- Mock'un "kontrol ettim, hesabınıza geçti" taslağı engellenir, yeniden yazılır, yine geçmezse güvenli metin + devir.
- Kiracının eklediği "kesin" ifadesi cevabı engeller.
- Kriz metni onaylanmadan AI ajanı etkinleştirilemez (409).
- Platform kuralını değiştirme isteği reddedilir.
- Kendine zarar ifadesinde kriz metni mesai dışında da hemen.
- Erişim sorusunda AI yalnız Erişim bilgisi ayarındaki bilgiyi söyler; ayar yoksa devir (K13, #310 ile).

KULLANILAN VARSAYIMLAR:
- K13 (G14 varsayılanı kaldırıldı).
- AI-08-S1: platform ülkeye göre kriz metni taslağı önerir, kiracı onaylamadan yayın yok.
- AI-08-S3: hakem yalnız riskli kategorilerde.

**Test Strategy:**

Her G kuralı için en az bir senaryo (AI-19 uyum paketi tohumu), çıkış denetimi birim testleri, çapraz kiracı; `pnpm test:gate`. DoD: CONVENTIONS §1 kapısı exit 0 — `pnpm test:gate` (arka planda; log son satırları), db:check-drift, contract:generate temiz, audit:req-coverage, PLAN §K kanıtı + HANDOFF bloğu.

## Subtasks

### 301.1. GR-CATALOG [OPUS-XHIGH] guardrails.ts G1–G19 kataloğu + TR/EN sözlükler + normalizasyon

**Status:** pending  
**Dependencies:** None  

Üst görev 301 ayrıntılarındaki ilgili bölüm.

### 301.2. GR-SCHEMA-API [OPUS-XHIGH] Migration (settings/rules/phrases/hits) + kontrat + kilit 403 + yayın kapısı 409

**Status:** pending  
**Dependencies:** 301.1  

Üst görev 301 ayrıntılarındaki ilgili bölüm.

### 301.3. GR-RUNTIME [OPUS-XHIGH] input-scan, output-check, judge, prompt-block; yeniden yazma → güvenli metin → devir

**Status:** pending  
**Dependencies:** 301.2  

Policy (#297) ve compose (#298) ile bağlanır.

### 301.4. GR-WEB [SONNET-HIGH] GuardrailsPage.tsx (kurallar, ekler, metinler, tetiklenme kaydı)

**Status:** pending  
**Dependencies:** 301.2  

Üst görev 301 ayrıntılarındaki ilgili bölüm.
