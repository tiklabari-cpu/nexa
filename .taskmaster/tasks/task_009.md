# Task ID: 9

**Title:** 08.5.9 — Chat page (hosted link)

**Status:** done

**Dependencies:** 5 ✓

**Priority:** medium

**Description:** PRD KK3: site kurulumu olmadan da sohbet edilebilen paylasilabilir link. 'Get link' CTA'si kart gridinden gelir.

**Details:**

Musteri Chat API'si (apps/api/src/routes/customer.ts) ve widget zaten var — bu is yeni bir sohbet motoru degil, mevcut widget'i barindirilmis bir sayfada acmaktir. Trusted domains kontrolunun bu yolda nasil davranacagina karar ver (kendi barindirdigimiz sayfa allowlist'e tabi mi?) — karar PLAN.md C'ye yazilir.

PRD: FR-MOD-08.5.9 (KK3) · PLAN.md §3.7 · Dilim 13

[günlük 2026-07-24 14:48 UTC] plan+KARAR(PLAN.md §C): Chat page hosted link (08.5.9). KARAR - trusted domains: kendi barindirdigimiz chat page allowlist'e TABI DEGIL. GEREKCE: KK3 'site kurulumu olmadan sohbet' -> acik/paylasilabilir link; amaci herkesin org ile sohbet etmesi (customer token sadece musteri erisimi verir). Allowlist ucuncu-taraf SITELERDE gomulmeyi engeller (marka/UX), kimlik siniri degil (customer token dusuk yetki + allowlist zaten degistirilmis loader ile asilabilir). Kendi origin'imizden servis edilen sayfa tanim geregi yetkili. UYGULAMA: (1) migration auth_resolve_organization_license(org) SECURITY DEFINER (licenses RLS'li) -> org'un lisansini dogrudan cozer, GRANT nexa_app. (2) /customer/token: host === originHost(WIDGET_BASE_URL) (kendi origin) ise organization-license resolver (exempt), degilse auth_resolve_widget_origin. (3) widget: chat.html + chat-page modu (tam sayfa, launcher yok, host_origin=self, postToHost yok - iframe degil top-level). (4) web channels: Chat page karti -> Ready + Get link (URL WIDGET_BASE_URL/chat.html?organization_id=org). (5) test: integration (chat-page token exempt, trusted domain OLMADAN), E2E link->mesaj->inbox. RISK: Origin spoof ile customer token alinabilir ama bu zaten public chat link'in amaci (yetki yukselmesi yok).

[günlük 2026-07-24 15:06 UTC] bitti: Chat page hosted link (08.5.9). KARAR (PLAN.md §C'ye): kendi barindirdigimiz chat page trusted-domains allowlist'ine TABI DEGIL (public chat link, customer token dusuk yetki). UYGULAMA: (1) migration auth_resolve_organization_license(org) SECURITY DEFINER (licenses RLS) + GRANT nexa_app; migrate deploy uygulandi. (2) auth.ts /customer/token: host===originHost(WIDGET_BASE_URL) ise org-license resolver (exempt), degilse auth_resolve_widget_origin. Kanitlandi: chat page origin->200, evil.example->403. (3) widget: chat.html (yeni, tam sayfa) + readConfig pathname .endsWith('/chat.html')->chatPage; mount chat-page dalinda launcher/greeting/postToHost yok, panel tam ekran (.nx-page), host_origin=self; Escape korumasi. vite build input'a chat.html. (4) web channels: Chat page karti Ready+Get link (WIDGET_URL/chat.html?organization_id=org, kopyalar+gosterir). Testler: api 488 (customer-chat +4: exempt token, 3rd-party 403, sohbet baslar, cross-tenant lisans), web 39 (+1 chat-page ready/Get link), e2e 32 (+1: link->tam sayfa widget->mesaj->inbox) + channels'ta Chat page Ready/Get link. Widget 24 (loader butcesi saglam). Kanit: kanit/9-chat-page.png. Demo login OK.

**Test Strategy:**

Kabul: link ile acilan sayfada site kurulumu OLMADAN sohbet baslar ve agent inbox'ina duser. Playwright: link -> mesaj -> inbox'ta gorunur. Trusted domains karari PLAN.md §C'ye yazilmis olmali.
