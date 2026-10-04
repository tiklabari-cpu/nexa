# Task ID: 183

**Title:** M-CHOBS — Kanal mesaj gozlemlenebilirligi — G1`in biraktigi borc

**Status:** done

**Dependencies:** None

**Priority:** low

**Description:** Omnichannel cift yonlu oldu (tm G1, `channel_messages` a outbound yaziliyor) ama tabloyu okuyan bir uc yok. Bu yuzden e2e teslimati gozlemleyemiyor ve bir operator "bu mesaj gercekten gitti mi" sorusunu konsoldan cevaplayamiyor.

**Details:**

Denetim `prd-uyum-denetimi.md` §3 D1 · `HANDOFF.md` G1 girişi ("Kalan borç") · `services/channels/channel-service.ts` (`record`) ve `ChannelMessage` modeli.

G1 turunda `channels.spec.ts` ve `telegram.spec.ts`'ten elle atılan `POST /channels/:type/messages` adımı kaldırıldı (artık çift gönderim olurdu). Bu iş kalemi o adımın **dürüst yerine koymasıdır**: teslimatı gerçekten gözlemleyen bir okuma yolu.

**Test Strategy:**

Yön/sohbet/zaman filtreleri; keyset sayfalama; cross-tenant izolasyon; scope reddi; sorgunun mevcut indekslere oturduğu EXPLAIN ile ölçülür (`reports-billing.test.ts` deseni). e2e: ajanın konsoldan yazdığı cevabın gerçekten gönderildiği bu uçla doğrulanır.

## Subtasks

### 183.1. M-CHOBS-a [OPUS-XHIGH] GET /channels/:type/messages — yeni yetkili uç, müşteri içeriği taşır

**Status:** done  
**Dependencies:** None  

Yön (inbound/outbound), sohbet ve zaman aralığı filtreleri; keyset sayfalama (mevcut `page_id` deseni). Mesaj metni müşteri içeriği: scope'u dar tut (`channels--all:ro`), cross-tenant izolasyonu test et. `ChannelMessage` indeksleri `(license_id, channel_type, created_at)` ve `(license_id, chat_id)` var — sorguyu bunlara oturt, yeni indeks açmadan önce ölç.

**Details:**

Bağımlılık: yok. Dilim V7-3. Pencere protokolü: `TASK-RUNNER-PROMPT.md` (bootstrap → resume → build → doğrulama → kapanış); DoD kapısı `CONVENTIONS.md` §1. Etiket = model × efor, PLAN §5.1.1.
