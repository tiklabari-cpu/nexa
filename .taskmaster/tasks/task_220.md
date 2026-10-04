# Task ID: 220

**Title:** V8-TRAFFIC-RTM [OPUS-MAX] Traffic panosu RTM akisina baglansin — 8 sn polling yerine (FR-MOD-03.1.1)

**Status:** done

**Dependencies:** None

**Priority:** medium

**Description:** Kabul kriteri 'RTM traffic akisi; Browsing->Chatting->Invited canli' diyor. Pano WebSocket tutmuyor, 8 saniyede bir ilk sayfayi yeniden okuyor. Yedi sekmenin yedisi de yerinde; eksik olan yalniz canlilik.

**Details:**

PENCERE PROTOKOLU: `TASK-RUNNER-PROMPT.md` (bootstrap -> build -> dogrulama -> kapanis).
DoD kapisi `CONVENTIONS.md` §1; git akisi §2; handoff bicimi §4. Sinirlar `CLAUDE.md`.
Bu gorev PLAN.md §6D (FAZ 8 — Kalan Gereksinim Borclari, §D149) kaleminin Task Master karsiligidir.
DIKKAT: PLAN.md ~2,3 MB — BASTAN SONA OKUMA. Hedef satiri `grep -n` ile bul, cevresindeki ~30
satiri oku. Kanit metni tablo hucresinde DEGIL, `## K. Kanit Gecmisi` altindaki `#### K<kod>`
blogundadir (CONVENTIONS §1.2) — ve gecerli olan blogun SON maddesidir, ortadaki `◐` glifleri
tarihcedir.
KAYITLI KARAR ARAMASI (§D149un dersi): damgayi degistirmeden once `grep -n "D1[0-9][0-9] (" PLAN.md`
ile ilgili kodu ara ve `git log --oneline --since=2026-08-30` ile denetimden SONRA is yapilmis mi bak.
NUMARALANDIRMA: bu faz **8**dir — `Faz-7` §7Cnindir (tm 175-184). Onek `V8-`, `V7-` KULLANMA.

(a) GEREKCE + KANIT:
PRD `:526`: "Real-time sekmeleri — All/Chatting/Supervised/Queued/Waiting for reply/Invited/Browsing;
canli ziyaretci durumu" · KK: "RTM TRAFFIC AKISI; Browsing->Chatting->Invited CANLI".
Sekmeler TAM: `apps/web/src/features/traffic/traffic-tabs.ts:23-30` `TRAFFIC_TABS` =
all/chatting/supervised/queued/waiting/invited/browsing (yedi).
Canlilik EKSIK: `TrafficPage.tsx:68` `const TRAFFIC_REFRESH_MS = 8_000;` · `:339`
`const timer = setInterval(() => void refreshHead(), TRAFFIC_REFRESH_MS);` · `:331`
`queryClient.setQueryData<TrafficCache>(key, (cache) => mergeTrafficHead(cache, fresh))`.
Dosyanin kendi basligi (`:14-20`) bunu itiraf ediyor: "there is no RTM push to reconcile against a
loaded page here, just the poll".
`#### K03.1.1` (PLAN.md ~7515) denetim maddesi ayni. PLAN satiri 305, `Should (MVP temel)`.

(b) DOKUNULACAK DOSYALAR:
- `apps/rtm/` — mevcut RTM sunucusu; ADR-15 zarfi (`{version, request_id, action, payload}`).
- `apps/api/src/services/` — ziyaretci durum degisiminin yayinlandigi yer (visit yazma yolu +
  chat durum gecisleri). Yayin POST-COMMIT olmali.
- `apps/web/src/features/traffic/TrafficPage.tsx` — `mergeTrafficHead` (`:125`) push yolunu da
  kabul eder; `setInterval` YEDEK olarak KALIR.
- Emsal: `apps/mobile/src/rtm/client.ts` (13.7-f) — ADR-15 zarfini yeniden kullandi, IKINCI BIR
  RTM PROTOKOLU ACMADI. Ayni disiplin.

(c) CONTRACT-FIRST SIRA: RTM olay sozlugu (ADR-15 zarfi icinde yeni `action`) -> sunucu yayini +
integration -> istemci abonelik + `mergeTrafficHead` push dali + unit -> e2e.

(d) BILINEN TUZAKLAR:
- POLLING KALDIRILMAZ. Baglanti koparsa pano sessizce bayatlamamali; push yoksa 8 sn'lik yedek
  devreye girer. "Push geldi" ile "poll geldi" ayni cache birlestiricisinden gecmeli.
- `mergeTrafficHead`in siniri SAYFA BASINADIR (`:346` yorumu): push tek satir gunceller, sayfa
  sinirlarini bozmamali. `usePagedQuery` zinciri korunur (NFR-P5).
- Sekme rozetleri sunucunun `total`ina bagli (tm 179.4): push bir satirin durumunu degistirince
  rozet de tutarli kalmali — yoksa "yuklenen pencere gercek toplam sanilir" kusuru geri gelir.
- Cok-pod: RTM yayini Redis uzerinden fan-out olmali (tek pod'a hapsolmus bir olay digerine
  ulasmaz). NFR-P1 butcesi (p99 < 500 ms) ve tm 161'in olcumu referanstir.
- Tenant izolasyonu: bir lisansin ziyaretci olayi baska lisansin panosuna ASLA dusmemeli
  (cross-tenant negatif ZORUNLU).

(e) KAPSAM SINIRI: yeni RTM protokolu/kanali ACILMAZ · sekme sozlugu (`traffic-tabs.ts`) DEGISMEZ ·
satir aksiyonlari DEGISMEZ (gozetimi birakma tm 213'un isi) · 13.2 "ziyaretci 360 panel" (v2)
kapsam DISI.
(f) KAPANIS: DoD kapisi yesil -> commit + push (Conventional Commit; PLAN.md satir damgasi
`◐ → ✅` + `#### K<kod>` bloguna kanit maddesi + HANDOFF.md girisi AYNI commite girer) ->
Task Master `done`. Calisma alanini kirli BIRAKMA.

**Test Strategy:**

Tam DoD kapisi exit 0 · `audit:req-coverage` exit 0 ve `FR-MOD-03.1.1` site sayisi ARTMIS. Integration: (1) ziyaretci durum gecisi (browsing->chatting, chatting->invited) POST-COMMIT bir RTM olayi YAYINLIYOR; (2) olay yalniz ilgili lisansin abonelerine gidiyor — CROSS-TENANT NEGATIF ZORUNLU; (3) cok-pod fan-out'u Redis uzerinden calisiyor (iki-pod testi emsali, tm 162). Birim (`apps/web`): push olayi `mergeTrafficHead` uzerinden TEK satiri guncelliyor, sayfa sinirlari bozulmuyor · rozet/`total` tutarli kaliyor · baglanti koptugunda 8 sn'lik poll yedegi hala calisiyor (REGRESYON: polling KALDIRILMADI). e2e: ziyaretci durumu YENIDEN YUKLEME OLMADAN degisiyor (kanit PNG). Ayrica `apps/rtm` suiti yesil ve NFR-P1 butcesi icin tm 161'in k6 senaryosu YENIDEN KOSULMAZ — sahibi/tarihi handoff'ta anilir (§D143/3 kurali).
