# Task ID: 310

**Title:** KB-STRUCTURED-TABLES [OPUS-HIGH] Yapılandırılmış bilgi tabloları: Ödeme Yöntemleri, Bonuslar, KYC Belgeleri, Limitler ve Kurallar + Erişim bilgisi ayarı (K13); facts.ts kesin hesaplar, eskime uyarısı

**Status:** pending

**Dependencies:** 296 ⏱, 309 ⏱

**Priority:** high

**Description:** "Param yatmadı" akışının kalbi işlem saatini yöntemin beklenen süresiyle karşılaştırmak; serbest metin makalede AI hesap yapamaz. K13: erişim/adres soruları için kiracıya "Erişim bilgisi" ayarı — (a) KB kaynağı/tablo satırı, (b) o an çekilen dinamik kaynak (URL/JSON, kısa önbellek, çekilemezse son bilinen değer, yoksa devir), (c) sabit yönlendirme linki; değişiklik AI-21 geçmişine; hukuki sorumluluk kiracıda (panelde belirtilir). Kaynak: AI-13.

**Details:**

KAYNAK: SiyahTus-Analiz 03-eklenebilecekler.md / 04-gerekceler-ve-sorular.md (Karar kaydı K1–K27 ve "Kararların maddelere etkisi" madde içi varsayılanların önüne geçer) / 05-uygulama-rehberi.md — maddeler: AI-13. Eşleme: SiyahTus-Analiz/07-gorev-plani.md.
TERİM EŞLEMESİ (K1=A): ekranda "Thread ID" = nexa Chat (kod/DB/API alanı chat_id, günlük kapsayıcı); ekranda "Chat ID" = nexa Thread (kod alanı thread_id, tek bağlantı). Kod adları değişmez; çeviri yalnız sunum katmanında.
SIRA (contract-first): OpenAPI (packages/contract) → pnpm contract:generate (@siyahtus/types) → Prisma migration (genişlet → taşı → daralt; CONCURRENTLY kendi dosyasında tek ifade) → API servis + birim test → RTM → web/widget/mobil → entegrasyon/E2E.
PROTOKOL: TASK-RUNNER-PROMPT.md (bootstrap → build → verify → fix → close); CONVENTIONS.md §1 (DoD), §2 (git), §3 (HANDOFF), §5, §6.3 (migration), §7 (test başlığında gereksinim etiketi); CLAUDE.md sınırları (production/DNS/TLS/gerçek secret/kart/ödeme YOK; dış servisler mock).
NOT: 05'teki dosya:satır referansları 2026-10-14 çalışma kopyasına göredir; başlamadan önce grep ile yeniden doğrula, kayma varsa HANDOFF'a yaz.
DALGA: Dalga 3b — bilgi deposu ve bilgi kalitesi.

PRİSMA (hepsi RLS, brand_ids boşsa tüm markalar, owner_id, reviewed_at, review_interval_days, source manual|integration (F2), oluşturan/güncelleyen):
- kb_payment_methods: name, aliases, direction deposit|withdrawal, currency, min_amount, max_amount, expected_minutes, delay_threshold_minutes, working_hours jsonb (haftalık pencereler + tz + banka tatili), requires_site_request, reference_instructions, reference_format (sabit biçim listesi — serbest regex yok, ReDoS), receipt_required, third_party_allowed, networks, common_errors [{code,title,customer_text,agent_hint}], customer_notes, active.
- kb_bonuses: name, aliases, type, min_deposit, wagering_multiplier, wagering_base bonus|bonus_plus_deposit, contributing [{category,percent}], min_odds, max_bet, max_cashout, validity_days, claim_method auto|live_support|code, promo_code, excluded_method_ids, active_from, active_to, terms_text.
- kb_kyc_documents: doc_type, acceptance_criteria, when_required, review_hours, upload_path_text, chat_upload_allowed.
- kb_rules: key, category limits|account|betting|withdrawal|other, title, value_text, numeric_value, unit, description.
- K13 ai_access_info (license_id, brand_id null, source_type kb_row|dynamic_url|fixed_link, kb_source_id?, url, cache_seconds, last_value, last_fetched_at, fixed_text) + RLS; dinamik çekim lib/ssrf.ts resolvePublicHttpTarget + pinnedConnection + safe-fetch ile, kısa zaman aşımı; çekilemezse last_value, o da yoksa devir; G14 kuralı (#301) yalnız buradan gelen bilgiyi söyletir.
types/knowledge-tables.ts: satır tipleri, doğrulayıcılar (min≤max, delay≥expected, çalışma saatleri, marka+yön içinde benzersiz takma ad), renderRowText (TR).
KONTRAT: /knowledge-tables/{payment-methods|bonuses|kyc-documents|rules} CRUD + /import (CSV) + /export + POST …/{id}/review; /ai-access-info GET/PUT.
SERVİS: services/knowledge-tables/ (CRUD, metne çevirme, yeniden indeksleme: satır → type table_row, source_table, source_row_id kaynak #309); conversation/facts.ts (yontem slotu → satır, elapsed_minutes, is_delayed, within_working_hours, next_window, amount_in_range — saat dilimi #285); AI-03 fact koşulları ve AI-06 kesin cevap yolu bağlanır. Çevrim: yalnız genel örnek hesap, "kalan çevriminiz" asla.
Marka önceliği: markaya özel satır "tüm markalar" satırını yener.
ESKİME (AI-13-S2): ödeme 14, bonus 30 (+active_to), KYC/kurallar 90 gün; günlük tarama → panel rozeti + Kurucu/Yönetici bildirimi; AI kullanmaya devam eder ("eskimişi kullanma" ayarı varsayılan kapalı).
CSV: mevcut toplu içe aktarma UX'i (BulkImportForm deseni).
WEB: features/playbook/tables/ dört sekme + Erişim bilgisi kartı ("Bu bilgi kiracı tarafından girilir" notu).

KABUL KRİTERLERİ:
- Papara (beklenen 30, eşik 60): 95 dk işlem "eşik aşıldı" dalı, 20 dk bekleme kalıbı.
- "Papara ile en az ne kadar yatırabilirim?" → satır değeri birebir.
- B markası sohbeti A'ya özel satırı görmez.
- Süresi dolan satır işaretlenir, bildirim gider.
- Geçersiz satırlı CSV'de geçerliler alınır, hatalar satır bazında.
- Mesai dışı EFT için within_working_hours=false ve "sonraki işlem penceresi" kalıbı.
- Erişim sorusu: dinamik kaynak çekilemezse son bilinen değer, o da yoksa devir; sabit link seçiliyse yalnız link (K13).
- Erişim bilgisi değişikliği geçmişe yazılır (#315 sonrası).

KULLANILAN VARSAYIMLAR:
- K13.
- AI-13-S1: 4 sabit tablo, esnek tablo sonra.
- AI-13-S2 eskime süreleri; S3 marka başına satır + "tüm markalar".

**Test Strategy:**

Birim (doğrulayıcı, facts, saat dilimi), entegrasyon (marka süzgeci, CSV, yeniden indeksleme, SSRF negatif, önbellek/son değer), e2e (satır ekle → AI cevabında kullan); `pnpm test:gate`. DoD: CONVENTIONS §1 kapısı exit 0 — `pnpm test:gate` (arka planda; log son satırları), db:check-drift, contract:generate temiz, audit:req-coverage, PLAN §K kanıtı + HANDOFF bloğu.

## Subtasks

### 310.1. KBT-SCHEMA-TYPES [OPUS-HIGH] Dört tablo + ai_access_info migration'ları + knowledge-tables.ts tipleri/doğrulayıcıları + kontrat

**Status:** pending  
**Dependencies:** None  

Üst görev 310 ayrıntılarındaki ilgili bölüm.

### 310.2. KBT-CRUD-INDEX [OPUS-HIGH] CRUD/import/export/review servisleri + renderRowText + table_row kaynak indeksleme

**Status:** pending  
**Dependencies:** 310.1  

Üst görev 310 ayrıntılarındaki ilgili bölüm.

### 310.3. KBT-FACTS [OPUS-HIGH] facts.ts + AI-03 fact koşulları + AI-06 kesin cevap yolu

**Status:** pending  
**Dependencies:** 310.2  

Üst görev 310 ayrıntılarındaki ilgili bölüm.

### 310.4. KBT-ACCESS-INFO [OPUS-XHIGH] K13 Erişim bilgisi çözücüsü: KB satırı / dinamik URL (SSRF korumalı, önbellek, son değer) / sabit link; G14 bağlantısı

**Status:** pending  
**Dependencies:** 310.1  

XHIGH GEREKÇESİ: (1) SSRF'e açık dış istek.

### 310.5. KBT-STALE-WEB [SONNET-HIGH] Eskime taraması + bildirim + dört sekmeli tablo ekranı + Erişim bilgisi kartı

**Status:** pending  
**Dependencies:** 310.2, 310.4  

Üst görev 310 ayrıntılarındaki ilgili bölüm.
