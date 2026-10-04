# Task ID: 248

**Title:** V8-WIDGET-EDIT [OPUS-XHIGH] widget.spec.ts:590 kararsiz: event_updated push'u ziyaretcinin transcript'ine ulasmiyor ve sync onu ASLA telafi etmiyor

**Status:** done

**Dependencies:** None

**Priority:** medium

**Description:** Edit-after-send (FR-MOD-02.3.7) duzeltmesi ziyaretcinin ekranina 20 sn icinde varmiyor. Kaybolan bir event_updated KALICI: widget sync'i yalnizca imlecten YENI olaylari ceker, dolayisiyla ziyaretci geri alinan cumleyi okumaya devam eder. Iki dosyayla (settings+widget) 4 dakikada yeniden uretiliyor.

**Details:**

OLCUM (tm 247, 2026-09-12). Imza: apps/e2e/tests/widget.spec.ts:646 -- ziyaretcinin transcript'i "It ships on Tuesday <stamp>" okumaya devam ediyor, duzeltilmis "It ships on Thursday <stamp>" 20 sn icinde HIC gelmiyor, .nx-edited sayaci 0'da kaliyor. "Tuesday" balonu gelmis durumda, yani socket o an calisiyordu (incoming_event ulasti) -- kaybolan yalnizca event_updated.

UCUZ YENIDEN URETIM (20 dk yerine 4 dk, bu turda olculdu): cd apps/e2e && npx playwright test tests/settings.spec.ts tests/widget.spec.ts -> 47 gecti / 1 dustu, tam olarak ayni satir ve ayni imza. Yani kirmizi TAM SUIT gerektirmiyor. HANDOFF'un tm 246 turundaki "izole kosuda 21/21" notu bugunun davranisi degil. Ayni gun olculen uc nokta: tam kosu 1 KIRMIZI, tam kosu 2 YESIL, iki dosyayla KIRMIZI -- yani ~%50 kararsiz, tam suit sirasi sart degil.

NEDEN KENDINI ONARMIYOR (bu turun katkisi; kod okunarak bulundu, olculmedi): apps/widget/src/socket.ts 305-313 event_updated icin BILEREK noteEvent cagirmiyor ve yorum gerekcesini yaziyor -- imlec "gorulen en yeni olay"dir, bir duzeltme ondan cok daha eski bir mesaja inebilir, imleci onun uzerine ilerletmek sonraki sync'in aradaki her seyi atlamasina yol acar. Sonucu: reconnect sonrasi sync yalnizca imlecten YENI olaylari ceker, dolayisiyla KACIRILAN BIR DUZELTME HICBIR ZAMAN TELAFI EDILMEZ -- ziyaretci geri alinan cumleyi okumaya devam eder. Bu bir URUN KUSURU adayidir (PRD FR-MOD-02.3.7'nin kabul kriteri "ziyaretcinin okudugu mesaj degisir"), yalnizca test kirilganligi degil.

YAYIN TARAFI SAGLAM GORUNUYOR: apps/api/src/services/chat/chat-service.ts 733-744 islem SONRASI publish ediyor ve recipients degeri "agents" olmadiginda audience'a musteriyi de katiyor (#audienceFor). Yani supheli yayin degil, TESLIM (apps/rtm musteri fan-out'u) ya da abonelik zamanlamasi.

YAPILACAK IS: (1) Kirmiziyi yukaridaki iki dosyali komutla yeniden uret ve KAYBIN NEREDE oldugunu OLC -- api publish -> redis -> rtm -> ws frame zincirinin hangi halkasinda dusuyor. Tahminle duzeltme. tm 247'nin probe yontemi emsal: page.on("websocket") + ws.on("framereceived") ile frame zaman cizelgesi, page.on("response") ile HTTP zaman cizelgesi, ikisi tek listede. (2) Kok neden teslimse duzelt. (3) AYRICA sync'in duzeltmelere kor olmasina karar ver: ya musteri sync'i son N olayi yeniden okuyarak duzeltmeleri de kapsar (imleci ilerletmeden), ya da bu bilincli sinir PLAN'a kayitli bir karar olarak yazilir -- bugun ne biri ne oteki var, yalnizca socket.ts'in kendi yorumu var. (4) Kanit: widget.spec.ts ardisik iki TAM suit kosusunda yesil.

TUZAKLAR: 1) pnpm --filter @siyahtus/e2e test -- <dosya> FILTRELEMIYOR, -- passthrough yutulup tam suit kosuyor; cd apps/e2e && npx playwright test tests/widget.spec.ts kullan. 2) Kok .env elle alinmali: set -a && . ./.env && set +a, yoksa RTM 60 sn sonra "DATABASE_URL: Required" ile duser. 3) Iki pencere ayni anda e2e kosamaz (sabit portlar 4000/4001/5173/5174). 4) docker compose down -v KULLANMA. 5) kanit PNG churn'unu (kendi disindakileri) git checkout ile geri al.

**Test Strategy:**

No test strategy provided.
