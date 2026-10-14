# Task ID: 317

**Title:** AI-UNRESOLVED-QUESTIONS [OPUS-HIGH] Çözülemeyen sorular ve bilgi boşluğu raporu: yakalama, maskeli saklama, embedding kümeleme, LLM başlık, ani artış bildirimi, "bilgi ekle / örnek cümle ekle / yok say"

**Status:** pending

**Dependencies:** 288 ⏱, 297 ⏱, 298 ⏱, 303 ⏱

**Priority:** high

**Description:** Pilotun ilk haftalarında AI'ı iyileştirmenin en hızlı yolu "en çok sorulan ve cevaplanamayan 10 konu". Bugün hiçbir skill uymazsa motor kayıt yazmadan dönüyor (skill-engine.ts:295; #record :673 çağrılmıyor), desteklenmeyen dil ve bilgi bulunamadı da iz bırakmıyor. Kaynak: AI-22.

**Details:**

KAYNAK: SiyahTus-Analiz 03-eklenebilecekler.md / 04-gerekceler-ve-sorular.md (Karar kaydı K1–K27 ve "Kararların maddelere etkisi" madde içi varsayılanların önüne geçer) / 05-uygulama-rehberi.md — maddeler: AI-22. Eşleme: SiyahTus-Analiz/07-gorev-plani.md.
TERİM EŞLEMESİ (K1=A): ekranda "Thread ID" = nexa Chat (kod/DB/API alanı chat_id, günlük kapsayıcı); ekranda "Chat ID" = nexa Thread (kod alanı thread_id, tek bağlantı). Kod adları değişmez; çeviri yalnız sunum katmanında.
SIRA (contract-first): OpenAPI (packages/contract) → pnpm contract:generate (@siyahtus/types) → Prisma migration (genişlet → taşı → daralt; CONCURRENTLY kendi dosyasında tek ifade) → API servis + birim test → RTM → web/widget/mobil → entegrasyon/E2E.
PROTOKOL: TASK-RUNNER-PROMPT.md (bootstrap → build → verify → fix → close); CONVENTIONS.md §1 (DoD), §2 (git), §3 (HANDOFF), §5, §6.3 (migration), §7 (test başlığında gereksinim etiketi); CLAUDE.md sınırları (production/DNS/TLS/gerçek secret/kart/ödeme YOK; dış servisler mock).
NOT: 05'teki dosya:satır referansları 2026-10-14 çalışma kopyasına göredir; başlamadan önce grep ile yeniden doğrula, kayma varsa HANDOFF'a yaz.
DALGA: Dalga 3c — AI yönetişimi ve ölçüm.

PRİSMA (RLS): ai_unresolved_items (ai_agent_id, brand_id?, chat_id, thread_id, event_id, text_masked, context_masked, language, reason no_procedure_match|no_knowledge|low_confidence|said_dont_know|unsupported_language|not_understood_handoff|player_abandoned|asked_human_after_ai|agent_flagged, intent_guess?, config_version_id?, embedding vector(1536)?, embedding_space, cluster_id?, created_at) — 05'teki day_thread_key YERİNE chat_id (K1=A); ai_unresolved_clusters (label, label_source llm|lexical, centroid, embedding_space, item_count, count_7d, handoff_count, abandon_count, first_seen, last_seen, status open|ignored|resolved, ignore_reason, linked_change_id?, resolved_at?, post_fix_count). İndeksler (license_id, created_at), (cluster_id).
YAKALAMA: runTurn sonucuna unresolved {reason, text}; canlı adaptör yanıttan sonra bloklamadan yazar. Terk: deactivate/deactivateByTimeout kancası (son mesaj AI'dan, devir/onay yoksa player_abandoned). Zorunlu uyum devirleri (G1–G5, G13, G15) YAZILMAZ.
METİN: tetikleyen + bir önceki oyuncu mesajı AI-26 ile maskeli; <3 karakter/tek kelime/emoji elenir.
EMBEDDING: aramadaki sorgu embedding'i yeniden kullanılır; ulaşmadıysa toplu embed (kota); mock uzayında topics.ts sözcüksel yöntem.
KÜMELEME (15 dk işi + gece birleştirme): aynı lisans/ajan/uzay en yakın merkez, kosinüs ≥ τ (~0.8, fixture ile) → ata + koşan ortalama; değilse yeni; uzay değişirse yeniden kurulur. Küme küçük → kesin kosinüs, HNSW gerekmez.
BAŞLIK: açılışta ya da %50 büyümede fast model 5–10 maskeli örnekten ≤8 kelime TR başlık + önerilen eylem; LLM kapalıysa topics.ts etiketi.
SIRALAMA: son 7 gün; devir oranı, terk oranı, "yeni" rozeti (48 saat).
ÇÖZÜM TAKİBİ: AI-21 değişikliğine/sürüme bağlanınca resolved; sonrası "düzeltmeden sonra: N", eşik aşılırsa yeniden aç + bildirim.
ALARM (AI-22-S2): 60 dk'da 20 (kiracı ayarı) → EL ve Yönetici uygulama içi bildirim; aynı küme 6 saatte bir.
SAKLAMA (S1): maskeli metin ≤90 gün ve sohbet saklama süresine uyar; başlık ve sayılar süresiz; erasure chat_id ile siler.
API routes/ai-unresolved.ts: GET /ai/unresolved/clusters (sıralama, tarih/marka/neden/dil), GET …/{id}, POST …/{id}/ignore|resolve|merge, POST …/{id}/suggest-knowledge (AI-23), POST …/{id}/add-examples (AI-03 giriş cümlelerine taslak).
TİPLER: UNRESOLVED_REASONS (AI-25 ile tek tanım), eşikler; notifications.ts yeni tür.
WEB: Playbook › Analiz › Çözülemeyen sorular: Unresolved.tsx, ClusterDetail.tsx (örnekler her zaman görünür).

KABUL KRİTERLERİ:
- Hiçbir prosedüre uymayan mesaj en geç 15 dk içinde no_procedure_match ile listede.
- Gerçek embedding'le aynı anlamdaki 30 cümle tek kümede (fixture).
- Kart/OTP içeren mesaj kayıtta maskeli.
- Yok sayılan kümeye benzerler sayılır ama öne çıkmaz.
- Oyuncu silme talebinde kayıtları silinir.
- Eşik aşımında tam bir bildirim.
- Self-exclusion mesajları listede yok.

KULLANILAN VARSAYIMLAR:
- AI-22-S1/S2.
- K1=A: day_thread_key yerine chat_id.

**Test Strategy:**

Yakalama noktaları, maskeleme, kümeleme (mock sözcüksel, fixture vektörler), silme, alarm tekrarı, RLS; `pnpm test:gate`. DoD: CONVENTIONS §1 kapısı exit 0 — `pnpm test:gate` (arka planda; log son satırları), db:check-drift, contract:generate temiz, audit:req-coverage, PLAN §K kanıtı + HANDOFF bloğu.

## Subtasks

### 317.1. UNR-CAPTURE [OPUS-HIGH] Tablolar + runTurn unresolved kararı + terk kancası + maskeli saklama + erasure

**Status:** pending  
**Dependencies:** None  

Üst görev 317 ayrıntılarındaki ilgili bölüm.

### 317.2. UNR-CLUSTER [OPUS-HIGH] Kümeleme işi + gece birleştirme + başlık + alarm

**Status:** pending  
**Dependencies:** 317.1  

Üst görev 317 ayrıntılarındaki ilgili bölüm.

### 317.3. UNR-API-WEB [SONNET-HIGH] Uçlar (ignore/resolve/merge/suggest/add-examples) + Unresolved/ClusterDetail ekranları

**Status:** pending  
**Dependencies:** 317.2  

Üst görev 317 ayrıntılarındaki ilgili bölüm.
