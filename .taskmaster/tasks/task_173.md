# Task ID: 173

**Title:** M-SEC-e1 [OPUS-XHIGH] Yedek CronJob'ı imza anahtarlarının tamamını taşıyor: AUDIT_CHAIN_SECRET, PII dökümüyle AYNI (root koşan) pod'da — denetim zincirinin kurucu varsayımı kırılıyor

**Status:** done

**Dependencies:** 165 ✓

**Priority:** high

**Description:** tm 167 (M-SEC-e) HIGH bulgu 1. `infra/helm/siyahtus/templates/backup-cronjob.yaml:51-57` yedek pod'una `envFrom: secretRef` ile 8 anahtarın TAMAMINI veriyor, oysa `pg_dump`ın tek ihtiyacı `DATABASE_URL`. Aynı pod `templates/backup-pvc.yaml`in PVC'sine her kiracının PII dökümünü yazıyor ve (ÖLÇÜLDÜ) uid 0 ile koşuyor. Bu, `apps/api/src/config/env.ts`in AUDIT_CHAIN_SECRET için yazdığı kurucu varsayımı — "veritabanını elinde tutan bu anahtarı elinde tutmaz" — tek manifestte iptal ediyor. Denetler değil, DÜZELTİR (tm 167 denetimdi).

**Details:**

NE YAPILACAK (ürün kodu değil, chart):

1) **Yedek pod'unun secret yüzeyini `DATABASE_URL`e daralt.** `templates/backup-cronjob.yaml`in `envFrom: - secretRef: {name: <release>-secrets}` satırını `env: - name: DATABASE_URL / valueFrom: secretKeyRef: {name: <release>-secrets, key: DATABASE_URL}` ile değiştir. Bugün pod'a giden ve HİÇ kullanılmayanlar: `JWT_SIGNING_KEY` · `WEBHOOK_HMAC_SEED` · `CUSTOMER_TOKEN_SECRET` · `UPLOAD_SIGNING_KEY` · `AUDIT_CHAIN_SECRET` · `DATABASE_APP_URL` · `REDIS_URL`.

2) **`securityContext` ekle.** ÖLÇÜLDÜ (tm 167): `postgres:17-alpine` imajında `USER` yok (`Config.User` boş) ve CronJob `command:` ile ENTRYPOINT'i değiştirdiği için konteyner **uid=0(root)** koşuyor (`docker run --rm --entrypoint /bin/sh postgres:17-alpine -c 'id'` → `uid=0(root)`). Alpine postgres imajının kendi `postgres` kullanıcısı uid 70. Pod'a: `runAsNonRoot: true`, `runAsUser: 70`, `fsGroup: 70` (PVC yazılabilir kalsın); konteynere: `allowPrivilegeEscalation: false`, `capabilities: {drop: [ALL]}`, `seccompProfile: {type: RuntimeDefault}`. `automountServiceAccountToken: false` — bu pod hiçbir k8s API çağrısı yapmıyor.

3) **`pg_dump "$DATABASE_URL"` argv'de parolayı taşıyor** — pod içindeki herhangi bir süreç `/proc/*/cmdline`den okur. `PGPASSWORD`/`.pgpass` ya da `--dbname="$DATABASE_URL"` yerine env-only bir yol tercih edilebilir; kararı gerekçesiyle yaz.

4) **PVC'nin PII taşıdığını manifest içinde SÖYLE.** `templates/backup-pvc.yaml` bugün "durable landing spot" diyor; içeriğinin her kiracının kişisel verisi olduğunu, dolayısıyla `storageClassName`in at-rest şifreli bir sınıf olması gerektiğini values.yaml'da adı geçen bir alan olarak aç (`backup.storageClassName`, varsayılan boş = kümenin varsayılanı) + README "Backups"a bir cümle.

GEREKÇE (tm 167'nin bulgusu, kısaltmadan):
`apps/api/src/config/env.ts` AUDIT_CHAIN_SECRET için şunu yazıyor: "The one secret in this list that must survive a database restore: it is held here precisely so that whoever holds the database does not hold it, which is what makes a hash chain evidence of tampering rather than a checksum against corruption." `infra/helm/siyahtus/values.production.example.yaml` aynı şeyi tekrar ediyor: "deliberately never stored in the database, so a database compromise alone cannot recompute a chain that hides a deleted row." Yedek CronJob'ı tam olarak bunu iptal ediyor: dökümü ÜRETEN süreç, o dökümü doğrulayan zincirin kök anahtarını da taşıyor. Yedek pod'unu (ya da PVC'yi + pod spec'ini okuyabilen bir aktörü) ele geçiren biri hem veriyi hem de silinmiş bir satırı gizleyen tutarlı bir zinciri yeniden hesaplayacak anahtarı alır — NFR-C6'nın kanıt değeri sıfırlanır. Chart bu garantiyi BİR dosyada ilan edip BAŞKA bir dosyada bozuyor.

KAPSAM DIŞI: `templates/secret.yaml`nin anahtar listesini genelleştirmek (`INBOUND_EMAIL_SECRET`/`DATABASE_REPLICA_URL` slotu) — o ayrı borç, 164.4'te kayıtlı.

DOĞRULAMA: `helm template` + `helm lint` + `kubeconform -strict` (Windows'ta konteyner-mount PowerShell'den — tm 164.1 emsali) · render edilmiş CronJob'da `AUDIT_CHAIN_SECRET` grep ile BULUNMAMALI · kaynak sayısı 165.1'in 20'siyle aynı kalmalı.

**Test Strategy:**

- `helm template siyahtus infra/helm/siyahtus` çıktısında CronJob bloğu: `grep -c AUDIT_CHAIN_SECRET` → **0** (bugün 0 değil çünkü envFrom tüm Secret'ı yüklüyor; render'da görünmediği için grep yerine `envFrom` satırının kendisi kanıt: `secretRef` kalkmış, `secretKeyRef: key: DATABASE_URL` gelmiş olmalı).
- `securityContext` alanları render'da mevcut: `runAsNonRoot: true` · `runAsUser: 70` · `allowPrivilegeEscalation: false` · `drop: [ALL]` · `automountServiceAccountToken: false`.
- `helm lint` exit 0 · `kubeconform -strict` tüm kaynaklar valid · kaynak sayısı 20 (varsayılan values) / 19 (production overlay, `secrets.enabled: false`).
- `kubectl apply --dry-run=client` bu makinede KULLANILAMAZ (tm 164.1–165.1'de dört kez bağımsız doğrulandı); `kubeconform` bu deponun çevrimdışı eşdeğeri.
- Kod kapısı FULL TURBO cache-hit beklenir (sıfır TS/JS dosyası değişir) — kusur değil, değişmezliğin kanıtı.
