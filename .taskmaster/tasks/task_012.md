# Task ID: 12

**Title:** 11.2 — Greeting card + quick replies

**Status:** done

**Dependencies:** 11 ✓

**Priority:** high

**Description:** PRD: proaktif karsilama karti; 'Lets chat' -> pre-chat form, 'Just browsing' -> karsilamayi erteler.

**Details:**

KAPSAM UYARISI: Campaigns builder (03.3.2) ve Forms builder (08.7.7) Should/v1 — greeting bunlara BAGLANMAZ. Sabit minimum pre-chat form yeterli. apps/widget/src/widget.ts. Erteleme durumu oturum boyunca hatirlanmali (tekrar tekrar acilmasin).

PRD: FR-MOD-11.2 · PLAN.md §3.9 · Dilim 13

[günlük 2026-07-24 13:38 UTC] plan: Greeting card + quick replies (11.2). Yer: apps/widget/src/widget.ts. KAPSAM: campaigns(03.3.2)/forms-builder(08.7.7) BAGIMLILIGI YOK; sabit minimum pre-chat form. (1) Greeting karti (mesaj + 'Lets chat'/'Just browsing'), mount'ta gorunur (dismiss edilmemisse). 3. resize durumu: GREETING dims (panel kapali+kart acik). (2) 'Lets chat' -> karti gizle, panel ac, konusma yoksa pre-chat form goster (name gerekli, email ops.). (3) 'Just browsing' -> karti gizle + sessionStorage 'nexa.greeting_dismissed' -> ayni oturumda tekrar ACILMAZ (regresyon). (4) pre-chat submit -> name/email state.pendingDetails'e, form gizlen, composer goster; ilk api.send'de name/email gecir. (5) launcher click karti gizler (dismiss ETMEZ). connect'te mevcut event varsa prechat=false. CSS: .nx-greeting, .nx-prechat. E2E widget.spec.ts: kart gorunur; Lets chat -> prechat form; Just browsing -> kart gider + reload'da gelmez. kanit/12-*.png. Widget app 50KB butcesi loader'a ait degil (widget.ts serbest).

[günlük 2026-07-24 13:50 UTC] bitti: Greeting card + quick replies (11.2). widget.ts: proaktif greeting karti (mesaj + 'Lets chat'/'Just browsing'), mount'ta gorunur (dismiss edilmemisse). 3. resize durumu GREETING(340x250). 'Lets chat' -> panel + pre-chat form (name gerekli, email ops.), submit -> pendingDetails, ilk api.send'de name/email gecer. 'Just browsing' -> kart gizlen + sessionStorage (nexa.greeting_dismissed) -> reload'da tekrar gelmez. connect'te mevcut event varsa prechat=false (donen ziyaretci formu atlar). KAPSAM: campaigns/forms-builder bagimliligi YOK, sabit minimum form. BUG: .nx-greeting/.nx-prechat display:flex, UA [hidden]{display:none}'i yener -> hidden gizlemiyor -> global [hidden]{display:none!important} reset eklendi (panel/chip/prechat dahil tum hidden'lar duzeldi). E2E 'mounts iframe' testi guncellendi (greeting karti frame'i buyutuyor -> Just browsing ile dismiss sonrasi launcher boyutu). Testler: widget 24, e2e 30 (2 yeni greeting), full e2e regresyon yok. Kanit: kanit/12-greeting-card.png, 12-prechat-form.png. Demo login OK. Sadece widget.ts + widget.spec.ts degisti; sunucu/kontrat degismedi.

**Test Strategy:**

Kabul: karsilama karti gorunur; 'Lets chat' pre-chat formu acar; 'Just browsing' karti kapatir VE ayni oturumda tekrar acilmaz (regresyon testi). KAPSAM TESTI: campaigns (03.3.2) / forms builder (08.7.7) bagimliligi YOK.
