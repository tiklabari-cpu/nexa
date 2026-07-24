# Task ID: 5

**Title:** 02.3.5 + 11.4 — Attach (agent composer + widget composer)

**Status:** done

**Dependencies:** 2 ✓, 3 ✓

**Priority:** high

**Description:** Iki composer'da da attach eksik. PLAN.md 3.2'ye gore F5'te '#' canned secicisi geldi ama attach gelmedi; 11.4 ayni sekilde kismi. chats.ts:89 zaten 'metin YA DA attachment' invariant'ini uyguluyor — sunucu tarafi hazir, istemci tarafi yok.

**Details:**

apps/web/src/features/inbox (agent) + apps/widget/src/widget.ts (musteri). Ikisi de gorev 2'nin ucunu kullanir, gorev 3'un kurallarina tabidir. Istemci tarafi tur/boyut kontrolu YALNIZ kullanici deneyimi icindir; reddin gercek yeri sunucudur. E2E: apps/e2e/tests/widget.spec.ts'e ek akis.

PRD: FR-MOD-02.3.5 + FR-MOD-11.4 · PLAN.md §3.2 / §3.9 · Dilim 13

[günlük 2026-07-24 11:49 UTC] plan: Attach iki composer. KESIF: 'sunucu tarafi hazir' YALNIZ agent yolu (chats.ts assertAttachment + text-veya-ek invariant). Musteri yolu (customer.ts) attachment_url KABUL ETMIYOR (startSchema text zorunlu). Yani sunucu isi da var. Adimlar: (1) assertAttachment'i paylasilan module cikar (services/storage/attachment.ts), chats.ts + customer.ts ayni implementasyonu kullansin (drift onle). (2) customer.ts startSchema: attachment_url opsiyonel(max2048), text opsiyonel, text-VEYA-ek zorla, assertUploadedAttachment ile dogrula, sendEvent/start'a attachmentUrl gecir, ai.handle YALNIZ text varsa. (3) kontrat customer-chat.yaml events body: attachment_url ekle, required gevset; generate. (4) agent: Composer.tsx gizli file input + attach butonu + upload helper (ApiClient POST /uploads + fetch PUT bytes) + ek varsa metinsiz gonderime izin; useInbox useSendMessage attachment_url gecir + optimistic. (5) Transcript.tsx: image/* inline <img>, digeri indirme linki. (6) widget api.ts upload(file)+send attachment_url+WidgetEvent.attachment_url; widget.ts attach butonu+renderBubble ek+CSS (50KB butcesine dikkat). (7) E2E widget.spec.ts: musteri ek gonderir->gorunur, agent ek gonderir->musteri gorur; kanit/5-*.png. Client tur/boyut kontrolu UX-only, red sunucuda.

[günlük 2026-07-24 12:45 UTC] bitti: Attach iki composer + uctan uca. SUNUCU: assertUploadedAttachment paylasilan module (services/storage/attachment.ts); chats.ts + customer.ts ayni sinir. customer.ts startSchema attachment_url + text opsiyonel + text-VEYA-ek refine + ai.handle yalniz text varsa. Kontrat customer-chat.yaml attachment_url, generate, parity yesil. AGENT: Composer.tsx paperclip + gizli file input + uploadAttachment(POST /uploads + fetch PUT) + ek-varsa metinsiz gonderim; useSendMessage attachment_url; Attachment.tsx ApiClient.getBlob ile authed blob -> image inline / dosya linki. WIDGET: api.ts upload()+fetchAttachment()+send attachment_url+WidgetEvent.attachment_url; widget.ts paperclip+chip+renderAttachment+attachmentCache (4sn refresh re-fetch israfini onler). TESTLER: api 476 (customer-chat +5: ek metinsiz, ek+metin, bos=400, sahte url=400, cross-tenant=400), web 33, widget 24, types 26, e2e attachments 2 (cift yon, gercek cross-origin). BUG bulundu+cozuldu: (1) premature screenshot -> naturalWidth>0 assert; (2) useApiClient her render yeni instance -> useEffect thrash -> revoked objectURL -> apiRef+dep[path]. KANIT: kanit/5-widget-musteri-ek.png, 5-inbox-agent-gorur.png, 5-widget-agent-ek.png (hepsi gercek render dogrulandi). Fixture: apps/e2e/fixtures/sample.png (200x120). Demo seed geri, login OK.

**Test Strategy:**

Kabul: iki composer'da da dosya eklenir, gonderilir, karsi tarafta gorunur. Regresyon: metinsiz+eksiz gonderim engellenir (chats.ts:89 invariant'i). Playwright: apps/e2e/tests/widget.spec.ts'e musteri akisi + inbox'a agent akisi.
