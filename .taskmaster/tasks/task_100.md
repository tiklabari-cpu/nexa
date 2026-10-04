# Task ID: 100

**Title:** fix(settings): duplicate DOM id breaks Channels section aria-labelledby, causing ambiguous "Reply" label match

**Status:** done

**Dependencies:** None

**Priority:** medium

**Description:** Bulundu: tm 67.7 (MCP Settings ekranı) doğrulaması sırasında, önceden var olan ve tm 67.7 ile ilgisiz bir e2e testi (`apps/e2e/tests/settings.spec.ts:448` "composer shortcuts › a reply saved in Settings reaches a customer through #") ısrarla kırmızı çıktı. MCP değişikliği çıkarılıp yeniden reprodüklendi — aynı hata McpConnection kodu YOKKEN de oluşuyor, yani bu tm 67.7'nin sebep olduğu bir regresyon DEĞİL, öteden beri var olan bir a11y/DOM hatası.

**Details:**

KÖK NEDEN: `apps/web/src/components/Page.tsx` `Section` bileşeni, `title` prop'undan bir `headingId` türetiyor (`section-${slugify(title)}`) ve bunu iç `<h2>`'ye `id` olarak, dış `<section>`'a da `aria-labelledby` olarak veriyor. `apps/web/src/features/settings/Channels.tsx` `ChannelsGrid` bileşeni `<Section id="section-channels" title="Channels" ...>` çağırıyor — hem çağıranın verdiği `id="section-channels"` (anchor linkler için) HEM de title="Channels" değerinden türeyen `headingId` ("section-channels") AYNI STRING'e denk geliyor. Sonuç: DOM'da iki farklı eleman (`<section id="section-channels">` ve `<h2 id="section-channels">`) AYNI id'yi taşıyor (geçersiz HTML). Tarayıcı `aria-labelledby="section-channels"` çözümlemesini DOM'daki ilk eşleşen id'ye (section'ın kendisi) yapıyor gibi görünüyor — kendine referans veren (circular) bir aria-labelledby. Bu durumda browser'ın accessible-name hesaplama algoritması section'ın TÜM alt-ağacının görünür metnini isim olarak kullanıyor (başlık + açıklama + her kanal kartının metni dahil, "SMS" kartının açıklaması olan "Reply to text messages over Twilio." dahil). Playwright'ın `getByLabel('Reply')` alt-dize eşlemesi bu yüzden hem gerçek `#new-reply` input'unu HEM DE bu section'ı eşleştiriyor → strict-mode violation.

REPRO: `pnpm --filter @siyahtus/e2e test -- --grep "a reply saved in Settings reaches a customer through #"` (temiz seed sonrası) → `strict mode violation: getByLabel('Reply') resolved to 2 elements: 1) <section id="section-channels" ...> aka getByRole('region', { name: 'Channels Everywhere your' }) 2) <input id="new-reply" .../> aka getByRole('textbox', { name: 'Reply' })`.

ÖNERİLEN DÜZELTME: `Section` bileşeninde başlıktan türeyen `headingId`'nin çağıranın verdiği anchor `id` ile ÇAKIŞMAYACAK bir isim uzayı kullanması (ör. `${id ?? slug}-heading` gibi her zaman `-heading` sonekli, veya headingId hesaplamasını tamamen `id` prop'undan türetmek — iki ayrı isim üretme). Fix sonrası regresyon kapısı: mevcut `settings.spec.ts:448` testi (şu an kırmızı) yeşile dönmeli; ayrıca genel olarak `Section` kullanılan tüm ekranlarda başka bir id çakışması olmadığı grep ile doğrulanmalı (`grep -rn 'id="section-' apps/web/src` + her `Section` çağrısının `title` sluğu ile karşılaştırması).

KAPSAM DIŞI (bu görevin DEĞİL): tm 67.7 (Settings → MCP ekranı) — o görev bu hatayı bulmuş ama düzeltmemiştir (CONVENTIONS §5 kapsam disiplini). Bu görev SADECE bu a11y/DOM-id hatasını düzeltir.

BAĞLAM: PLAN.md'de bu satır için ayrı bir PRD/FR-MOD kodu yok — bu bir kalite/a11y bug'ı, yeni bir gereksinim değil. tm 67.7'nin HANDOFF notunda da kayıtlı.

**Test Strategy:**

e2e regresyon: `apps/e2e/tests/settings.spec.ts:448` ("composer shortcuts › a reply saved in Settings reaches a customer through #") temiz seed sonrası yeşil. unit/a11y: Section bileşeninin ürettiği section ve heading elementlerinin FARKLI id'lere sahip olduğu bir test (ör. Channels.test.ts veya Page.test.tsx'e eklenir). regresyon: `pnpm -w test` + `pnpm --filter @siyahtus/e2e test -- settings.spec.ts` tam yeşil (başka Section kullanan ekranda yeni çakışma yok).
