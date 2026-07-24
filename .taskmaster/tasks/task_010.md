# Task ID: 10

**Title:** 08.5.3 — Email kanali (forwarding -> ticket)

**Status:** done

**Dependencies:** 7 ✓

**Priority:** medium

**Description:** Ticketing cekirdegi Dilim 11'de teslim edildi (apps/api/src/routes/tickets.ts). Bu is gelen e-postayi o cekirdege baglar.

**Details:**

Kanal yuzeyi kart gridinden yonetilir. Gonderen e-postasi mevcut bir customer'a eslesirse yeni kayit acilmaz. Spam/dogrulama: SecuritySettings.spamFilterEnabled zaten semada var — kullan.

PRD: FR-MOD-08.5.3 · PLAN.md §3.7 · Dilim 13

[günlük 2026-07-24 15:22 UTC] plan: gelen e-posta -> ticket. Yeni public webhook POST /channels/email/inbound. Adres semasi <orgId>@INBOUND_EMAIL_DOMAIN; tm9'daki auth_resolve_organization_license SECURITY DEFINER ile org->lisans cozulur (yeni migration YOK). withTenant icinde: (1) SecuritySettings.spamFilterEnabled + saglayici spam verdikti -> spam ise ticket yok; (2) customer organizationId+email(citext) ile eslenir, varsa YENI KAYIT ACILMAZ, yoksa olusturulur; (3) ticket sistem-seviyesi insert (principal yok) TicketService uzerinden allocateTicketId ile. Ticket cekirdegi govde alani tutmuyor -> e-posta konusu ticket.subject olur, govde persist edilmez (thread modeli kapsamda degil). Kanal yuzeyi: Channels.tsx email comingSoon -> ready, ChatPageLink benzeri EmailForwardingAddress (adres = orgId@VITE_INBOUND_EMAIL_DOMAIN). Sozlesme-once: openapi'ye public inbound ucu eklenir. Testler: dogru lisans, cross-tenant, mevcut-customer->tek kayit, spam-drop(negatif), spam-ama-filtre-kapali(kontrol), unknown recipient 404. E2E: email karti Ready + adres + kanit/10-email-channel.png.

[günlük 2026-07-24 15:30 UTC] API tarafi bitti + yesil: 15 entegrasyon testi (dogru lisans, cross-tenant, mevcut-customer citext eslesme->tek kayit, tekrar-gonderen->1 customer/2 ticket, cross-tenant customer izolasyonu, spam-drop varsayilan filtre-acik NEGATIF, filtre-kapali kontrol, unknown recipient 404, non-uuid 404, bozuk gonderen 400, webhook secret 401/200). contract-parity + route-config yesil (public uc dogru belgelendi). Sozlesme: paths/channels.yaml emailInbound eklendi, generate calisti. varsayim: govde persist edilmiyor (ticket cekirdegi govde alani tutmuyor); varsayim: INBOUND_EMAIL_SECRET opsiyonel (set ise zorunlu, dev/test'te acik) — saglayici kenar-kimligi dagitim isi (SMTP mock A4 gibi). varsayim: iptal edilmis lisans -> 404 (adres artik mail kabul etmiyor). Sonraki: web Email karti coming_soon->ready + yonlendirme adresi, channels.test.ts, E2E kanit.

[günlük 2026-07-24 15:37 UTC] BITTI. Kabul: (1) gelen e-posta->ticket dogru lisansa (test yesil), (2) mevcut customer->ikinci kayit ACILMAZ (citext + cross-tenant izolasyon, test yesil), (3) NEGATIF spamFilterEnabled acikken spam ticket uretmez (test yesil). Tam API paketi 503/503 yesil; web birim 40/40; E2E email karti Ready+adres, kanit apps/e2e/kanit/10-email-channel.png. Demo seed geri yuklendi, owner@acme.localhost girisi OK. Contract-first: paths/channels.yaml + openapi generate. Kapsam disi commit edilmedi (.DS_Store, MASTER-PROMPT.md, autorun dosyalari).

**Test Strategy:**

Kabul: gelen e-posta ticket'a donusur ve dogru lisansa duser. Mevcut customer eslesirse IKINCI KAYIT ACILMAZ — bunu dogrulayan test zorunlu. Negatif: spamFilterEnabled acikken spam gonderim ticket uretmez.
