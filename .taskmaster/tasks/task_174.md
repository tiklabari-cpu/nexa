# Task ID: 174

**Title:** M-SEC-e2 [OPUS-MAX] TRUST_PROXY_HOPS'un dayandığı topoloji varsayımını hiçbir manifest zorlamıyor: api Service'ine doğrudan ulaşan her iş yükü X-Forwarded-For'u uyduruyor → IP allow-list · IP ban · anon rate-limit baypas

**Status:** done

**Dependencies:** 164 ✓

**Priority:** high

**Description:** tm 167 (M-SEC-e) HIGH bulgu 2. `server.ts:165-186` başlık seviyesinde doğru savunmayı kuruyor (`trustProxy: env.TRUST_PROXY_HOPS`, tam N hop) ama savunma "önümde gerçekten N proxy var" varsayımına dayanıyor. Chart bu varsayımı hiçbir yerde zorlamıyor: `templates/service.yaml:20` api'yi normal bir ClusterIP olarak açıyor, chart'ta NetworkPolicy YOK, `values.yaml:288` `TRUST_PROXY_HOPS: "1"`. Küme ağına erişen herhangi bir pod `<release>-api:4000`e DOĞRUDAN gidip `X-Forwarded-For`u kendisi yazar; proxy-addr sağdan 1 hop atlayıp saldırganın yazdığı değeri `request.ip` yapar. M-SEC-d'nin teşhisinin aynısı: kural doğru yazılmış, dayandığı varsayım başka bir yüzeyde geçerli değil.

**Details:**

SALDIRI ZİNCİRİ (tm 167'de okunarak kuruldu):
1. `infra/helm/siyahtus/templates/service.yaml:14-27` — dört app'in dördü de `type: ClusterIP`, selector dışında hiçbir erişim kısıtı yok. api Service'i `<release>-api:4000` olarak küme içindeki HER pod'a açık.
2. `infra/helm/siyahtus/values.yaml:288` — `TRUST_PROXY_HOPS: "1"`, ConfigMap üzerinden api pod'una gidiyor. Doğru değer: chart'ın kendi topolojisinde web nginx (`apps/web/nginx.conf:139`, `$proxy_add_x_forwarded_for`) bir hop ekliyor.
3. `apps/api/src/server.ts:187` — `trustProxy: env.TRUST_PROXY_HOPS`. proxy-addr N hop'u SAĞDAN sayar; `request.ip`, XFF zincirinde sağdan N'inci girdidir (dosyanın kendi yorumu: "proxy-addr returns the entry `hops` places from the right").
4. Saldırgan pod → `curl -H 'X-Forwarded-For: 203.0.113.9' http://<release>-api:4000/...`. Zincirde tek girdi var, o da saldırganın yazdığı. 1 hop güvenildiği için soket eşi (saldırgan pod) atlanır ve `request.ip` = **203.0.113.9**.
5. `request.ip` üç güvenlik kararını besliyor (server.ts'in kendi listesi): agent IP allow-list (FR-MOD-08.9.6, `plugins/auth.ts:340`), müşteri IP ban (`routes/auth.ts:1546` `isIpBanned`), anonim rate-limit kovası (`plugins/rate-limit.ts`). Üçü de baypas edilir. `test/integration/ip-allowlist.test.ts:315` tam bu saldırıyı HTTP seviyesinde kapatıyor olduğunu doğruluyor — ama yalnız "önümde bir proxy var" ise.

NE YAPILACAK:
1) **NetworkPolicy ekle** (`infra/helm/siyahtus/templates/networkpolicy.yaml`, `.Values.networkPolicy.enabled`, varsayılan açık): api'nin `Ingress`i yalnız `app.kubernetes.io/name: web` etiketli pod'lardan (+ probe'lar için kubelet'i engellemeyen bir yol — `namespaceSelector`/`ipBlock` kararını gerekçesiyle yaz) kabul etsin. rtm'in WebSocket'i tarayıcıdan geldiği için ONUN yolu farklı: rtm önünde bir ingress/LB varsayılıyorsa `TRUST_PROXY_HOPS` muhabbeti rtm için de geçerli mi diye kontrol et (rtm `trustProxy` KULLANMIYOR — `apps/rtm/src/server.ts`de proxy-addr yok; bu ayrımı yaz, uydurma).
2) **Topoloji ile değeri aynı yerde tut.** `values.yaml`in `TRUST_PROXY_HOPS` satırı bugün çıplak bir "1"; chart'ın kendi zincirinin (ingress? → web nginx → api) kaç hop olduğunu ve NetworkPolicy'nin bu sayıyı NEDEN zorunlu kıldığını oraya yaz. `values.production.example.yaml:79-81`in `# TRUST_PROXY_HOPS: "2"` yorumu doğru yönde ama yorumda kalmış.
3) **Ölç, varsayma.** Bu bulgu okunarak kuruldu, koşulmadı. Düzeltmeden ÖNCE `apps/api/test/integration/trust-proxy.test.ts`in yanına "hiç proxy yokken tek girdili XFF `request.ip`i belirliyor" testini yaz ve KIRMIZI gördüğünü kanıtla; sonra NetworkPolicy'nin bunu ağ seviyesinde kestiğini `helm template` çıktısıyla göster (küme yok, `kubeconform` — tm 164.1 emsali).

KAPSAM DIŞI: chart'a Ingress eklemek (CLAUDE.md: deploy/DNS/TLS yok). NetworkPolicy bir manifesttir, uygulanmaz.

**Test Strategy:**

- ÖNCE NEGATİF (kırmızı görülmeli): `trust-proxy.test.ts`e "TRUST_PROXY_HOPS=1 + istemcinin yazdığı tek XFF girdisi → `request.ip` istemcinin değeri" testi; allow-list'e karşı koşulduğunda 403 yerine 200 dönmesi bulgunun kanıtıdır.
- `helm template` render'ında NetworkPolicy kaynağı mevcut; `kubeconform -strict` valid; kaynak sayısı 20 → 21 (varsayılan values).
- `networkPolicy.enabled: false` ile render'da kaynak YOK (tm 164.4'ün Sprig `default` tuzağı: `| default true` KULLANMA, values.yaml gerçek varsayılanı versin).
- `helm lint` exit 0. `kubectl apply --dry-run=client` bu makinede kullanılamaz (tm 164.1–165.1, dört kez doğrulandı).
- Tam DoD kapısı: typecheck · lint · format:check · test (§1.3 parçalı) · build.
