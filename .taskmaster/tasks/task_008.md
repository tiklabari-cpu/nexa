# Task ID: 8

**Title:** 08.5.1 — All channels kart gridi

**Status:** done

**Dependencies:** 5 ✓

**Priority:** medium

**Description:** PRD: ikon + ad + durum + aciklama + CTA. Durumlar Connected / Ready / Not connected / Coming soon. CTA'lar Manage / Connect / Get link / Get notified.

**Details:**

Kart durumlari uydurulmaz: Website karti 08.5.2-a'nin websites.status'undan, Chat page 08.5.9'dan beslenir. Henuz olmayan kanallar 'Coming soon' + Get notified. apps/web/src/features/settings.

PRD: FR-MOD-08.5.1 · PLAN.md §3.7 · Dilim 13

[günlük 2026-07-24 14:26 UTC] plan: All channels kart gridi (08.5.1). apps/web/src/features/settings/Channels.tsx: pure channelsFor(websites)->Channel[] (test edilebilir) + ChannelsGrid (useQuery /websites -> channelsFor). Website karti CANLI (tm6 verisi): >=1 connected->Connected/Manage; site var 0 connected->Ready/Manage; site yok->Not connected/Connect. Diger kanallar (Chat page[tm9], Email[tm10], Messenger/WhatsApp/SMS/Instagram/Telegram) -> Coming soon/Get notified (task detayi: henuz olmayan kanallar coming soon). Boylece dort durum da veriyle gosterilir. Get link CTA'si Ready icin Chat page'e (tm9) ait; Website Ready->Manage. StatusDot tonlari: connected=success, ready=info, not_connected=warning, coming_soon=neutral. Website Manage/Connect -> #section-website-widgets'e kayar. Get notified -> lokal 'We will let you know'. SettingsPage EN USTE. Unit test channels.test.ts: dort durum->CTA eslesmesi + Website data-driven ([]=not_connected, [pending]=ready, [connected]=connected) + coming_soon=Get notified (sabit yazilirsa kirilir). E2E settings.spec.ts: grid render, Website=Connected (seed), coming-soon karti Get notified. kanit/8-*.png.

[günlük 2026-07-24 14:32 UTC] bitti: All channels kart gridi (08.5.1). Channels.tsx: pure channelsFor(websites)->Channel[] (unit-test edilebilir) + ChannelsGrid (useQuery /websites). Website karti CANLI: connected>0->Connected/Manage, site var 0 connected->Ready/Manage, site yok->Not connected/Connect (#section-website-widgets'e link). Diger 7 kanal (Chat page, Email, Messenger, WhatsApp, SMS, Instagram, Telegram) -> Coming soon/Get notified (lokal 'we'll let you know'). Icon+ad+durum(StatusDot)+aciklama+CTA. SettingsPage EN USTE. Testler: web 38 (channels.test.ts +5: dort durum->CTA, Website data-driven [], [pending]=ready, [connected]=connected, coming_soon=Get notified — sabit yazilirsa kirilir), e2e 31 (+1 channels: grid render + Website=Connected seed + WhatsApp Coming soon/Get notified + tiklayinca ack). E2E'de gecici bir hata oldu (web->api tum sorgular Could-not-load; PAT ile endpoint'ler 200, re-run yesil — cold-start hiccup). Kanit: kanit/8-channels-grid.png. Yalniz apps/web + e2e degisti; sunucu/kontrat degismedi. Get link CTA'si Ready icin Chat page'e (tm9) ait.

**Test Strategy:**

Kabul: dort durum (Connected/Ready/Not connected/Coming soon) ve dogru CTA eslesmesi. Website kartinin durumu gorev 6'nin verisinden gelir — sabit deger yazilirsa test kirilmali. Coming soon kartlari Get notified gosterir.
