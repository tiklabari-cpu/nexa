# HANDOFF — SiyahTuş

**Date:** güncel — bkz. Task log · **Branch:** `main` (Faz-0 + v1 + v2 planı burada) · **Remote:** https://github.com/tiklabari-cpu/nexa

> **Dal durumu (2026-08-01):** `main` uzun süre `e118695` (tm 21) noktasında takılı kalmıştı; Faz-0
> kapanışı, **tüm v1** ve v2 planlama turu yalnızca `docs/plan-expand-audit` üzerinde birikmişti
> (127 commit). Bu tur `main` **fast-forward** ile güncellendi (`--ff-only`, force yok, history
> rewrite yok, hiçbir commit kaybolmadı) ve push edildi. `main` ile `docs/plan-expand-audit` artık
> **birebir aynı**. Bundan sonra iş `main`'den dallanır — CONVENTIONS §2'nin `feat/<slug>` → `main`
> akışı yeniden geçerli. Eski `docs/plan-expand-audit` dalı tamamen merge edilmiş durumda; silinebilir.

---

> **Eski kayıtlar:** `docs/archive/handoff/` (`grep -rn 'tm <id>' docs/archive/handoff`) — canlı dosyada yalnız son 5 görev + açık görevler kalır (CONVENTIONS §3).

## Task log (newest-first)

## tm 397 — PLATFORM-OPS-TEST-FOREIGN-SUBSCRIBER: platform-operations entegrasyon testi açık dev yığınında artık kırmızı değil — done — 2026-11-04 UTC

- **Yapıldı (doğrudan `main`; kontrat/migration YOK, üretim davranışı aynı):** "run now" kanal adı enjekte edilebilir oldu, varsayılan hâlâ `PLATFORM_JOB_CHANNEL`: `OpsChannel` seçeneği `channel`, `PlatformOperations` seçeneği `jobChannel`, `buildPlatformServer` seçeneği `opsJobChannel` (route'a `now` gibi geçer). `platform-operations.test.ts` kendine `siyahtus:platform:ops:jobs:test:<uuid>` kanalı verir. Sebep: Redis pub/sub db index'ini yok sayar; açık dev API gerçek kanala abone olduğundan `publish` 1 döner, test `no_listener` yerine `queued` alıyordu.
- **Doğrulama:** dosya tek başına 32/32 — dev API yokken VE gerçek kanala yabancı abone (`redis-cli subscribe`, NUMSUB=1) bağlıyken; düzeltme olmadan aynı yabancı abone ile (b) `no_listener` testi kırmızı (`queued` geldi). `ops-channel.test.ts` +1 (özel kanal; paylaşılan kanal mesajı yok sayılır). `pnpm test:gate build statik birim entegrasyon` yeşil (14 dk entegrasyon dahil). Tam e2e: 562 geçti, 1 kırmızı `ai-multilingual.spec:28` (Rusça — bot bilgi kaynağından teslimat cevabı verdi; sıra bağımlılığı sınıfı, tm 396 gibi; bu görevle ilgisiz) + flaky `ai-agent:76`; `--shards=1 ai-multilingual` tek başına iki kez GREEN (CONVENTIONS §1.1).
- **Varsayımlar:** `platform-audit.test.ts` `no_listener` beklemiyor (yalnız `ok()`), dokunulmadı. Gerçek dev API'yi başlatmadan aynı etki yabancı abone ile taklit edildi.
- **Sonraki pencere:** başka bir entegrasyon testi Redis pub/sub kanalına dayanıyorsa aynı kalıp: kanal adı seçeneği + testte uuid'li kanal.

## tm 400 — KNOWLEDGE-EMPTY-STATE-NO-AI-AGENT: yeni çalışma alanında Bilgi sekmesi artık "önce AI ajanı ekleyin" der — done — 2026-11-04 UTC

- **Yapıldı (dal `fix/knowledge-empty-state-no-ai-agent`; kontrat/migration/api YOK):** `PlaybookPage.tsx` `KnowledgePanel` yeni `noAgent` (ajan listesi geldi ve ajan yok) + `onOpenGeneral` alır; `noAgent` iken `EmptyState` "Önce bir AI ajanı ekleyin" + (`agents-bot--all:rw` varsa) Genel sekmesine giden düğme, yoksa yalnız "yöneticiye başvurun" açıklaması. Liste boşken ikinci "Nothing indexed" boş durumu çizilmez. En+tr 4 anahtar (`playbook.knowledge.noAgent*`), iç kod yok.
- **Doğrulama:** `PlaybookPage.knowledgeNoAgent.test.tsx` 3 (ajansız: açıklama + düğme Genel sekmesindeki "Add an AI agent" kartını açar; salt-okur: düğme yok; ajan varken mevcut form + "Nothing indexed" aynı); `PlaybookPage.test.tsx` yük-hatası testi ajan listesine bir ajan eklendi (ajansız kurulum artık başka boş durum çizer). Playbook+locale birim 71 dosya yeşil, typecheck + eslint temiz. Kapı: build/statik/birim/entegrasyon yeşil; tam e2e 563 geçti, 1 kırmızı (`ai-multilingual.spec:28`, tek başına iki kez yeşil — yük). Entegrasyon üç koşuda sırayla farklı tek dosya kırdı (`ai-testing-judge-regression`, `knowledge-job-runner`/`ai-jobs`, `knowledge-tables-stale`; hepsi tek başına yeşil), dördüncüde tamamen yeşil.
- **Varsayımlar:** düğme `<a>` değil `<button>` (sekme durumu sayfa içi `setView`; inline-link tuzağı yok); renkler `CreateAiAgentCard` gönder düğmesiyle aynı (`bg-brand-500 text-white`), koyu tema için yeni renk eklenmedi. axe açık/koyu: ajansız çalışma alanı e2e fikstürü olmadığı için birimde yalnız yapı (jsdom kontrast ölçmez).
- **Sonraki pencere:** Davranış/Uyum Korumaları/Sürümler/Test/Çözülemeyenler sekmeleri ajansız zaten `aiAgent ? … : …` ile ayrı boş durum çiziyor; ajana bağlı yeni bir sekme eklenirse aynı `noAgent` kalıbı.

## tm 399 — WIDGET-QUEUE-NOTICE-AFTER-REPLY: ajan yanıt verince ziyaretçinin "sırada N" bildirimi hemen kalkar — done — 2026-11-04 UTC

- **Yapıldı (dal `fix/widget-queue-notice-after-reply`; kontrat/migration/api YOK):** `apps/widget/src/widget.ts` `applyIncomingEvent`: yazarı `agent` olan ilk olay gelirken `queuePosition` doluysa konum + bekleme tahmini silinir, `renderStatus()` çağrılır ve sahibi/ajanı güncellemek için `refresh()` çalışır. Sebep: soketli widget'ta kuyruk bilgisini yalnız yoklama tazeliyordu (30 sn heartbeat); yanıt 107 ms'de geliyor, satır yarım dakika kalıyordu. AI ve ziyaretçi olayları satıra dokunmaz.
- **Doğrulama:** `widget.socket.test.ts` +2 (kuyrukta satır görünür → ajan yanıtı sonrası boş; düzeltme geri alınınca kırmızı — mutantla doğrulandı; ziyaretçi olayı satırı değiştirmez); widget birim 57 dosya / 537 yeşil, typecheck + eslint temiz; bundle-size.test.ts yeşil (tavan değişmedi).
- **Varsayımlar:** RTM'de ayrı "atandı" push'u yok → ilk ajan mesajı tetikleyici. Atama sistem satırı (`system_message`) yazarı `agent` değilse tetiklemez; ajan sessizce atanıp yazmazsa satır bir sonraki yoklamaya kadar kalır (sunucu zaten o yoklamada null döner).
- **Sonraki pencere:** widget bütçe payı ~1.9 KB'tan bu değişiklik kadar (birkaç on bayt) azaldı; ölçüm için `bundle-size.test.ts`.

## tm 398 — CHAT-ARCHIVED-SYSTEM-TEXT-I18N: sunucunun "Chat archived" sistem satırı Türkçe panelde Türkçe — done — 2026-11-04 UTC

- **Yapıldı (dal `fix/chat-archived-i18n`; kontrat/migration/api YOK, sunucu metni aynı):** yeni `features/inbox/systemEventText.ts` `eventText(event, t)`: `system_event: chat_deactivated` olan sistem satırı için katalog cümlesi (`inbox.systemEvent.chatDeactivated[.dayRollover|.timeout]`, en+tr); bilinmeyen olay ve kişi mesajı saklı metinde kalır. Kullanıldığı iki yer: gelen kutusu liste önizlemesi (`InboxPage.tsx`) ve transkript sistem satırı (`Transcript.tsx`).
- **Doğrulama:** `systemEventText.test.ts` 4, `InboxPage.systemEvent.test.tsx` 2 (tr "Sohbet arşivlendi", en "Chat archived"), `Transcript.card.test.tsx` +2; locale-copy yeşil; web typecheck + eslint temiz. Kapı: build/statik/birim/entegrasyon yeşil; tam e2e 560 geçti, 1 kırmızı (`widget.spec:1151` ek yükleme çipi, 30 sn zaman aşımı — gate yükü) + 3 flaky; ilgisiz kırmızılar tek başına yeşil: `widget` dosyası 2×33/33, `ai-multilingual` 1/1, rtm `telemetry` 2×6/6 (ilk kapıda graceful-drain zamanlama kırmızısı).
- **Varsayımlar:** `day_rollover` ve `timeout` kapanışları aynı sınıf olduğu için aynı yolla çevrildi. Mobil (`apps/mobile`) kapsam dışı kaldı: uygulamada hiç i18n katmanı yok, tüm metinler zaten sabit İngilizce (`ChatListScreen.previewOf`, `Transcript.tsx`). Widget (ziyaretçi tarafı) ve transkript e-postası kapsam dışı.
- **Sonraki pencere:** sunucunun yazdığı diğer sistem satırları (ör. `chat_transferred` metni) hâlâ ham `event.text` basar; yeni bir `system_event` panelde görünecekse `systemEventText.ts`'e eklenir.

## tm 396 — E2E-ORDER-ISOLATION: üç e2e spec'inin sıra bağımlılığı kalktı (ai-mode, inbox-waiting, manual-assignment) — done — 2026-11-04 UTC

- **Yapıldı (dal yok, doğrudan `main`; yalnız test dosyaları; ürün/kontrat/migration YOK):** `ai-metrics.spec` ve `ai-mode.spec` kendi bilgi kaynağını `finally`'de `DELETE /knowledge-sources/:id` ile siler (ai-metrics'in "Standard X delivery takes 3 to 5 working days" kaynağı sonradan koşan ai-mode'un cevabını çalıyordu; soru/pasaj metni DEĞİŞMEDİ — AI_QUESTION tuzağı); `inbox-waiting.spec` ve `manual-assignment.spec` başta `freeARoutingSlot` (fixtures'taki mevcut yardımcı) ile owner'a yer açar (6 sohbetlik limit önceki spec'lerce doluyordu).
- **Doğrulama:** `pnpm test:e2e --shards=1 ai-metrics ai-mode` GREEN (2/2); tam `pnpm test:e2e` 562 geçti / 0 kırmızı (2 flaky retry ile geçti: `ai-agent:76` — 13 haneli marker kart numarası gibi maskelendi, `rule-bot:57` — bot cevabı 20 sn'de gelmedi; ikisi de dokunulmamış, ama koşucu `fixtures.ts` değiştiği için RED dedi → yardımcı fixtures'a konmadı, iki spec'te satır içi); sonra `pnpm test:gate --e2e` (build/statik/birim/entegrasyon/e2e) hepsi OK, e2e 29m44s. İlk kapı 00:xx UTC'de `customer-context` + `ai-unresolved-report` entegrasyonunda kırmızıydı (memory: integration-reds-between-00-and-01-utc), 01:00 sonrası yeşil.
- **Varsayımlar:** "tam e2e iki kez yeşil" = tam e2e run #1 (0 failed, flaky yardımcı-değişimi kuralıyla RED) + kapıdaki tam e2e (OK, flaky yok). PNG churn (`apps/e2e/kanit`) geri alındı.
- **Sonraki pencere:** başka bir spec bilgi kaynağı bırakıp teslimat sorusu soruyorsa aynı sınıf tekrar edebilir; owner limiti kullanan yeni spec `freeARoutingSlot` çağırmalı. Düzeltme `customer-context`/`ai-unresolved-report` için (sabit öğlen tohumu) hâlâ ayrı görev bekliyor.
