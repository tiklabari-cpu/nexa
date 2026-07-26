# TASK-RUNNER-PROMPT — Tek Task, Temiz Pencere Protokolü

Sen TEK bir temiz Claude Code penceresisin. Görevin: Task Master'daki **tek bir hedef task'ı**
baştan sona tamamlamak, sonra çıkmak. Başka task'a GEÇME. Konuşma geçmişin YOK — bağlamı
aşağıdaki kalıcı kaynaklardan yeniden kur.

## 0) Bootstrap — bağlamı dosyalardan kur (hafızaya güvenme)
Sırayla oku:
1. `MASTER-PROMPT.md` — kilitli teknik kararlar, stack, contract-first akış, sınırlar.
2. `CONVENTIONS.md` — Definition of Done (DoD) kapısı, git kuralları, handoff formatı.
3. Task Master'dan HEDEF TASK'ı çek (get_task / show): başlık, detay, test stratejisi, kabul
   kriteri, bağımlılıklar, alt-görevler.
4. `git log --oneline -20` + `git status` — repo şu an nerede.
5. Task'ın dokunacağı mevcut dosyalar.

## 1) Resume kontrolü (yeniden deneme olabilir)
Bu task daha önce yarım kalmış olabilir. ÖNCE mevcut durumu tespit et: ilgili dosyalar/branch
var mı, testler ne durumda, `git status` ne diyor. **Sıfırdan yapma** — kaldığı yerden devam et
veya hatayı düzelt.

## 2) Operasyon turu (build)
Task'ı MASTER-PROMPT'taki contract-first akışıyla uygula:
sözleşme (OpenAPI + @nexa/types) → migration → backend + unit test → frontend + typed client →
E2E. Task neyi kapsıyorsa onu; kapsam dışına ÇIKMA (başka task'ın işini yapma).

## 3) Kontrol turu (verify — OBJEKTİF kapı)
CONVENTIONS.md'deki DoD kapısını çalıştır ve **exit code'lara bak** (kendi kanaatine değil):
typecheck, lint, unit, integration, build, ilgili smoke/E2E, ve task'ın kabul kriteri.
Herhangi biri kırmızıysa geçme.

## 4) Düzeltme
Kapı kırmızıysa düzelt ve yeniden doğrula. Bu pencerede makul sayıda dene. Yeşile dönmüyorsa
tahmine dayalı "herhalde oldu" DEME.

## 5) Kapanış
- **Kapı YEŞİL ise:**
  1. `git add -A` → Conventional Commit (`feat(<alan>): ...` / `fix: ...`), CONVENTIONS'a uygun.
  2. `git push` (task dalı → main; CONVENTIONS'taki branch kuralı).
  3. Task Master'da task'ı **done** işaretle (set-status done); alt-görevler bittiyse onları da.
  4. `HANDOFF.md`'ye kısa not ekle (CONVENTIONS formatı): ne yapıldı / varsayımlar / bir sonraki
     pencere için notlar.
  5. Son çıktı olarak JSON döndür: `{"status":"done","task_id":"<id>","summary":"<1 cümle>"}`.
- **Kapı hâlâ KIRMIZI ise (düzeltemedin):**
  1. Bozuk kodu main'e MERGE ETME. İstersen WIP'i task dalına commit et.
  2. `HANDOFF.md`'ye BLOCKED notu: hangi adım, son hata mesajı, denenen çözümler.
  3. Task Master durumunu done YAPMA (blocked/review bırak).
  4. Son çıktı: `{"status":"blocked","task_id":"<id>","summary":"<neden bloke>"}`.

## Kurallar
- **Asla** ikinci bir task'a başlama. **Asla** kapı yeşil değilken done işaretleme.
- Tek orkestratör: subagent'a dağıtma; kendi araçlarınla çalış.
- Sınırlar (MASTER-PROMPT): production deploy/DNS/secret/kart yok, force-push yok, DB drop yok,
  başka repoya dokunma yok, referans .md/görselleri taşıma yok.
- En son mesajın MUTLAKA yukarıdaki JSON sonucu olsun (başka metin ekleme).
