# Task ID: 146

**Title:** SEC-2 [OPUS-MAX] Rütbe düşürme yetkiyi geri almıyor: `scopes` grant anında donuyor ve refresh rotasyonuyla süresiz taşınıyor — `minimumRole`'ü olmayan admin-scope rotaları eski admin'e açık kalıyor

**Status:** done

**Dependencies:** 142 ✓

**Priority:** high

**Description:** tm 142 (M-SEC) salt-okuma denetiminin ikinci HIGH bulgusu. `token-service.ts` `role`'ü her istekte üyelikten TAZE okuyor (yorumu da bunu vaat ediyor: "revoking someone's admin rights must take effect on their existing tokens immediately") ama `scopes`'u token satırından okuyor; `oauth-service.ts#refresh` de eski scope'ları yeni token'a aynen kopyalıyor. Sonuç: `PUT /agents/{agentId}/role` ile admin'den agent'a düşürülen biri, `minimumRole`/`exactRole` taşımayan — yani yalnız scope ile korunan — admin rotalarına erişmeye devam ediyor. Bunların arasında IP allow-list'i ve 2FA zorunluluğunu KAPATAN uç var.

**Details:**

BULGU (koda karşı okundu, tm 142). Üç parça birleşince delik oluşuyor:

1. `apps/api/src/services/auth/token-service.ts:160-175` — `principal.role` üyelikten taze okunuyor
   (doğru), `scopes: row.scopes` ise `api_tokens` satırından geliyor (mint anındaki değer).
2. `apps/api/src/services/auth/oauth-service.ts:421-431` — `refresh()` `scopes: record.scopes` diyerek
   eski scope kümesini yeni token'a taşıyor; rolden yeniden türetme yok. Refresh ailesi 30 gün
   (`REFRESH_TOKEN_TTL` varsayılanı 2_592_000), her rotasyon süreyi yeniliyor → istemci refresh ettiği
   sürece **süresiz**.
3. `apps/api/src/routes/agents.ts:412-497` — rol değişikliği üyeliği güncelliyor ve denetim satırı
   yazıyor, ama o kişinin canlı token'larını iptal etmiyor.

ETKİ — yalnız SCOPE ile korunan (config'inde `minimumRole`/`exactRole` YOK, handler'da da rol kontrolü
yok) admin rotaları, düşürülmüş admin'in oturumuna açık kalıyor:
- `PATCH /settings/security` — `routes/settings.ts:1393` (`access_rules:rw`). Gövde
  `ip_allowlist_enforced` ve `require_two_factor` kabul ediyor (`:401-421`): **IP allow-list zorlaması ve
  2FA zorunluluğu kapatılabiliyor.**
- `POST /settings/ip-allowlist` `:700` · `DELETE /settings/ip-allowlist/:entryId` `:771`
- `POST /settings/trusted-domains` `:596` · `DELETE …/:domainId` `:650` (widget token mint'inin güven
  sınırı — saldırganın sitesine güvenilir alan eklemek demek)
- `POST /partner/apps` `routes/partner-apps.ts:139` · `POST …/rotate-secret` `:266`
- `/brands` yazmaları `routes/brands.ts:134,177,206` · `/settings/sla` `:1579` · `/settings/routing-rules`
  `:2059` · `/settings/widget` `:1902` · `/settings/chat-timeout` `:1830` · `/settings/custom-fields`
  `routes/custom-fields.ts:68,87,105` · `/customers/{id}/ban` `routes/customers.ts:166` ·
  `/reports/scheduled-exports` `routes/scheduled-reports.ts:110,150,219` · `/billing/subscription`
  `routes/reports.ts:1769`

KARŞI-ÖRNEK (deponun kendi doğru deseni, kopyalanacak olan): `POST /invitations`
(`routes/account-lifecycle.ts:314`) scope'a EK OLARAK `roleAtLeast(principal.role, 'admin')` çağırıyor;
`PUT /agents/{id}/role` ve `/agents/{id}/suspension` de öyle. Yani "her iki kapı" kuralı repoda var,
yalnız tutarlı uygulanmamış.

SÜRE: erişim token'ı tek başına ≤ 1 saat (`ACCESS_TOKEN_TTL` tavanı 3600); refresh ailesi ile süresiz.
PAT'lar için de aynı: admin iken basılmış PAT düşürmeden sonra da admin scope'unu taşıyor.

KABUL (üçünden en az ikisi, birlikte tercih edilir):
1. **Scope'lar her istekte rolle kesişir.** `token-service.ts` `oauth`/`pat` çözümlemesinde etkin scope =
   `row.scopes ∩ defaultScopesForRole(freshRole)`. Tek satırda hem demote hem promote doğru davranır ve
   token iptaline gerek kalmaz. (`defaultScopesForRole` `routes/auth.ts:913`; import yönü çevrilmeli —
   liste `services/auth/principal.ts`'e taşınabilir.)
2. **Refresh scope'u rolden yeniden türetir.** `oauth-service.ts#refresh` `record.scopes`'u taze rolle
   kesiştirir, böylece 30 günlük aile eski yetkiyi taşımaz.
3. **Rol değişikliği o üyeliğin canlı `oauth` token'larını iptal eder.** `routes/agents.ts` rol
   güncellemesiyle aynı transaction'da; PAT'lara dokunmaz (adlandırılmış kimlik bilgisi — ayrı karar),
   ama PAT'lar (1) sayesinde zaten daraltılmış olur.

Ek olarak: yukarıda listelenen rotalara `minimumRole: 'admin'` eklemek TEK BAŞINA yeterli DEĞİL (scope
donması promote/demote'un her iki yönünde de yanlış cevap verir) ama savunma derinliği olarak istenir —
`/settings/security`, `/settings/ip-allowlist`, `/settings/trusted-domains` en azından almalı.

KABUL TESTİ (entegrasyon, düzeltmeden önce kırmızı olmalı): admin oturum açar → token alır → owner onu
`agent`'a düşürür → AYNI token ile `PATCH /settings/security {ip_allowlist_enforced:false}` → **403**
(bugün 200) · aynı token `POST /auth/token` ile refresh edilir → yeni token da 403 · promote yönü:
agent → admin yapılan birinin ESKİ token'ı admin rotasına erişemez (scope kesişimi genişletmez).

**Test Strategy:**

- `apps/api/test/integration/` altında yeni/genişletilmiş süit: demote-sonrası aynı erişim token'ı ile `PATCH /settings/security`, `POST /settings/ip-allowlist`, `POST /settings/trusted-domains` → 403; refresh sonrası da 403; suspend edilmiş üyelik zaten 401 (regresyon kontrolü).
- Promote yönü: eski token genişlemez (scope kesişimi tavan olarak davranır).
- `token-service`/`oauth-service` unit testleri: scope kesişiminin rol değişimiyle hareket ettiği.
- Tam DoD kapısı (CONVENTIONS §1): typecheck · lint · format:check · test · test:integration · build · ilgili e2e (console admin ekranları regresyonsuz).
