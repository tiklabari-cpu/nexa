# Task ID: 383

**Title:** INVOICE-PDF-PROFILE [OPUS-HIGH] (Opus 5.5) Fatura profili + bilgi amaçlı fatura PDF'i (K24) + mock e-Fatura sağlayıcısı: ardışık boşluksuz numara, snapshot, ödeme yöntemi ve referansı faturada

**Status:** pending

**Dependencies:** 382 ⏱

**Priority:** medium

**Description:** Fatura yalnız CSV; fatura adresi/vergi numarası yok. K24: PDF "bilgi amaçlı" (yasal fatura iddiası yok), e-Fatura entegratörü mock arayüzle. Kaynak: BL-02.

**Details:**

KAYNAK: SiyahTus-Analiz 03-eklenebilecekler.md / 04-gerekceler-ve-sorular.md (Karar kaydı K1–K27 ve "Kararların maddelere etkisi" madde içi varsayılanların önüne geçer) / 05-uygulama-rehberi.md — maddeler: BL-02. Eşleme: SiyahTus-Analiz/07-gorev-plani.md.
TERİM EŞLEMESİ (K1=A): ekranda "Thread ID" = nexa Chat (kod/DB/API alanı chat_id, günlük kapsayıcı); ekranda "Chat ID" = nexa Thread (kod alanı thread_id, tek bağlantı). Kod adları değişmez; çeviri yalnız sunum katmanında.
SIRA (contract-first): OpenAPI (packages/contract) → pnpm contract:generate (@siyahtus/types) → Prisma migration (genişlet → taşı → daralt; CONCURRENTLY kendi dosyasında tek ifade) → API servis + birim test → RTM → web/widget/mobil → entegrasyon/E2E.
PROTOKOL: TASK-RUNNER-PROMPT.md (bootstrap → build → verify → fix → close); CONVENTIONS.md §1 (DoD), §2 (git), §3 (HANDOFF), §5, §6.3 (migration), §7 (test başlığında gereksinim etiketi); CLAUDE.md sınırları (production/DNS/TLS/gerçek secret/kart/ödeme YOK; dış servisler mock).
NOT: 05'teki dosya:satır referansları 2026-10-14 çalışma kopyasına göredir; başlamadan önce grep ile yeniden doğrula, kayma varsa HANDOFF'a yaz.
DALGA: Dalga 6 — widget, engage, helpdesk, raporlar, kanallar, faturalama, GV.

EFOR: high — karar önceden verilmiş, kalıp depoda var; xhigh gerekçesi yeterli değil (2026-10-14 gözden geçirme).
KOD: GET /billing/invoices (reports.ts:2196), CSV :2208-2235; invoice-close-sweep.ts; rapor PDF'i reports-export.ts (Türkçe karakter sorunu — kullanılmaz; AR-04 #338 notu).
prisma: billing_profiles (license_id PK, legal_name, adres, country ISO, tax_office, tax_id, vat_id, invoice_email) + RLS + CHECK (ülkeye göre vergi no biçimi); faturalara number (ihraççı başına benzersiz, yıl bazlı ardışık boşluksuz — 05 karar 2), issued_at, seller_snapshot/buyer_snapshot JSON, pdf_storage_key, payment_method, payment_reference (SWIFT referansı / TXID / Stripe ödeme ID — K16); satır kilitli sayaç tablosu.
contract/api: GET/PUT /billing/profile (yazma Kurucu, okuma Yönetici), GET /billing/invoices/{period}/pdf, credit_note (düzeltme yeni belge).
PDF (K24): kesim anında bir kez üretilir ve saklanır; üzerinde "Bilgi amaçlıdır" ibaresi; Türkçe karakter destekli gömülü font (yeni bağımlılık ise PLAN §0 gerekçesi); profil sonradan değişse de eski PDF aynı; profilsiz kesimde şirket adı + tamamlama bandı.
EInvoiceProvider arayüzü + MOCK uygulama (K24); gerçek TR e-Fatura/e-Arşiv entegratörü ve ülke kararı sonra (07 açık risk). Vergi metni faturalandıran şirketin ülkesine bağlı — ülke netleşmeden yalnız şablon alanı.
web: profil formu (doğrulamalı, GV-06), PDF indirme.

KABUL KRİTERLERİ:
- Profil kaydedilir; geçersiz vergi numarası açık hatayla reddedilir.
- Kapanan dönemin PDF'i ünvan, adres, vergi no, ardışık numara, ödeme yöntemi/referansı ve "bilgi amaçlıdır" ibaresiyle iner.
- Profil değişince eski PDF aynı.
- İki eşzamanlı kesim farklı ardışık numaralar alır.
- e-Fatura çağrısı mock sağlayıcıya gider; ağ çağrısı yok.

KULLANILAN VARSAYIMLAR:
- K24: bilgi amaçlı PDF + mock e-Fatura.
- Fatura kesen şirketin ülkesi açık (07 açık risk).

**Test Strategy:**

Eşzamanlı numara testi, değiştirilemezlik, PDF snapshot (Türkçe karakter), mock e-Fatura; `pnpm test:gate`. DoD: CONVENTIONS §1 kapısı exit 0 — `pnpm test:gate` (arka planda; log son satırları), db:check-drift, contract:generate temiz, audit:req-coverage, PLAN §K kanıtı + HANDOFF bloğu.
