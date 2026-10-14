# Task ID: 313

**Title:** DOCUMENT-SOURCES [OPUS-XHIGH] (Opus 5.5) PDF/DOCX bilgi kaynağı: izole işçi süreçte ayrıştırma, 20 MB / 300 sayfa / 1M karakter, sayfa numaralı parçalar, orijinal dosya saklama

**Status:** pending

**Dependencies:** 312 ⏱

**Priority:** medium

**Description:** Operatörler şartları ve prosedürleri PDF/Word verir; bugün yalnız .txt/.md/.csv ve 2 MiB (knowledge-file.ts:31,:45). PDF/DOCX bilerek reddedilmiş (knowledge-file-parse.ts:42-46, ayrıştırıcı CVE geçmişi) — çözüm reddetmek değil izole işçi. Kaynak: AI-18.

**Details:**

KAYNAK: SiyahTus-Analiz 03-eklenebilecekler.md / 04-gerekceler-ve-sorular.md (Karar kaydı K1–K27 ve "Kararların maddelere etkisi" madde içi varsayılanların önüne geçer) / 05-uygulama-rehberi.md — maddeler: AI-18. Eşleme: SiyahTus-Analiz/07-gorev-plani.md.
TERİM EŞLEMESİ (K1=A): ekranda "Thread ID" = nexa Chat (kod/DB/API alanı chat_id, günlük kapsayıcı); ekranda "Chat ID" = nexa Thread (kod alanı thread_id, tek bağlantı). Kod adları değişmez; çeviri yalnız sunum katmanında.
SIRA (contract-first): OpenAPI (packages/contract) → pnpm contract:generate (@siyahtus/types) → Prisma migration (genişlet → taşı → daralt; CONCURRENTLY kendi dosyasında tek ifade) → API servis + birim test → RTM → web/widget/mobil → entegrasyon/E2E.
PROTOKOL: TASK-RUNNER-PROMPT.md (bootstrap → build → verify → fix → close); CONVENTIONS.md §1 (DoD), §2 (git), §3 (HANDOFF), §5, §6.3 (migration), §7 (test başlığında gereksinim etiketi); CLAUDE.md sınırları (production/DNS/TLS/gerçek secret/kart/ödeme YOK; dış servisler mock).
NOT: 05'teki dosya:satır referansları 2026-10-14 çalışma kopyasına göredir; başlamadan önce grep ile yeniden doğrula, kayma varsa HANDOFF'a yaz.
DALGA: Dalga 3b — bilgi deposu ve bilgi kalitesi.

XHIGH GEREKÇESİ: (1) güvenilmeyen dosya ayrıştırma.
TİPLER: KNOWLEDGE_DOCUMENT_MIME_TYPES (PDF, DOCX), sınırlar 20 MB, 300 sayfa, 1.000.000 karakter (AI-18-S1); mevcut metin yolu değişmez.
KONTRAT: POST /knowledge-sources/document {ai_agent_id, upload_id, name?, brand_id?} → 201 processing + job_id (AI-17 GET /knowledge-jobs/{id}); GET /knowledge-sources/{id}/file kısa ömürlü imzalı indirme; hata kodları unsupported_type, file_too_large, encrypted, no_text_layer, too_many_pages, parse_timeout, virus_detected.
PRİSMA: knowledge_sources file_key, file_mime, file_size, file_sha256, page_count; knowledge_chunks page_from, page_to, heading; knowledge_jobs.kind='document'.
API: /uploads purpose knowledge_document (herkese açık ek URL'sinden SERVİS EDİLMEZ, ayrı önek licenses/{id}/knowledge/{uuid}); virüs taraması (tarayıcı yoksa ret); tür sihirli baytlarla (%PDF-, word/document.xml içeren ZIP; .docm ret); aynı ajan altında aynı sha256 → 409.
İŞÇİ services/ai/document-parse/: worker.ts ayrı süreç (≈256 MB, 30 sn, sır geçirilmez, işe özel geçici dizin); pdf.ts (şifreli ret, sayfa başına <50 karakter ortalama → no_text_layer, %60+ sayfada tekrar eden üst/alt bilgi silinir, script ve dış kaynak kapalı); docx.ts (ZIP sınırları ≤2.000 girdi, açılmış ≤100 MB, oran ≤100; Heading/liste/tablo "| a | b |"; görsel atlanır, makro çalışmaz); normalize.ts. document-ingest.ts iş dalı; parçalama ~600 karakter başlık sınırlarına saygılı; kotaya tabi (waiting_budget).
BİTİŞ: ready, AI-21 kaydı, bildirim; AI çalışma kaydında sayfa numarası (AI-10/24 kanıtı). SİLME: parçalar cascade, nesne commit sonrası (başarısızsa öksüz temizleme).
OCR YOK (S1): görüntü PDF "metin bulunamadı, taranmış belge olabilir". Orijinal saklanır (S2), kaynak silinince silinir.
WEB: Dosyalar sekmesi .pdf .docx .txt .md .csv, sürükle-bırak, iki aşamalı ilerleme, Türkçe hatalar, "Orijinali indir", sayfa sayısı, "Yeniden işle".

KABUL KRİTERLERİ:
- 15 MB, 120 sayfalık metin PDF'i ready; parçalarda sayfa no.
- Şifreli PDF encrypted, görüntü PDF no_text_layer; Türkçe mesaj, KB'ye yazım yok.
- Tablolu DOCX satırları "| … |".
- Uzantısı değiştirilmiş çalıştırılabilir ya da .docm unsupported_type; EICAR reddedilir.
- 30 sn / 256 MB aşan ayrıştırma parse_timeout, API süreci etkilenmez.
- Belgeye herkese açık ek URL'sinden erişilemez.
- Kaynak silinince nesne silinir.

KULLANILAN VARSAYIMLAR:
- AI-18-S1/S2.
- Ayrıştırıcı bağımlılığı kodlayıcı seçer (lisans + CVE kontrolü).

**Test Strategy:**

Fixture dosyaları (tablolu PDF, başlıklı DOCX, şifreli, görüntü, sıkıştırma bombası, JS içeren PDF, EICAR), worker zaman aşımı/bellek, entegrasyon, e2e mock embedding; `pnpm test:gate`. DoD: CONVENTIONS §1 kapısı exit 0 — `pnpm test:gate` (arka planda; log son satırları), db:check-drift, contract:generate temiz, audit:req-coverage, PLAN §K kanıtı + HANDOFF bloğu.

## Subtasks

### 313.1. DOC-UPLOAD-SCHEMA [OPUS-XHIGH] Kontrat + migration + /uploads knowledge_document (özel önek, virüs, sihirli bayt, sha256 409)

**Status:** pending  
**Dependencies:** None  

Üst görev 313 ayrıntılarındaki ilgili bölüm.

### 313.2. DOC-WORKER [OPUS-XHIGH] İzole işçi + pdf/docx/normalize + sınırlar + parse_timeout

**Status:** pending  
**Dependencies:** 313.1  

Üst görev 313 ayrıntılarındaki ilgili bölüm.

### 313.3. DOC-INGEST-WEB [SONNET-HIGH] document-ingest iş dalı + sayfa numaralı parçalar + silme + Dosyalar sekmesi

**Status:** pending  
**Dependencies:** 313.2  

Üst görev 313 ayrıntılarındaki ilgili bölüm.
