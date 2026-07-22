# RAPOR v2-03 — text.com / LiveChat (Text, Inc.) TAM API & VERİ MODELİ REFERANSI

> **Amaç:** Bu doküman, `research/01-api-developer-platform.md`'deki API araştırmasının **daha derin, düzenli bir referans-kılavuz formatına** dönüştürülmüş ve doğrulanmış halidir. Hedef: bir geliştiricinin **yalnızca bu dokümanı okuyarak** klonun REST + WebSocket API'sini birebir kurabilmesi.
> **İşaretleme:** `[GÖZLEM]` = platform.text.com resmi dokümanından, GitHub SDK kaynak kodundan veya canlı uygulama gözleminden doğrulanmış · `[TAHMİN]` = dokümante edilmemiş, mühendislik çıkarımı.
> **Derleme tarihi:** 20 Temmuz 2026. Ana kaynak taban raporu: `/root/text_analysis/research/01-api-developer-platform.md`. Bu raporda ayrıca yeni doğrudan sorgular ile `platform.text.com/docs/authorization/scopes`, `.../v3.6/data-structures` ve `.../management/webhooks` sayfalarından ek alanlar çıkarılıp entegre edilmiştir.

---

## İÇİNDEKİLER

1. [Genel Konvansiyonlar](#1-genel-konvansiyonlar)
2. [Agent Chat API](#2-agent-chat-api)
3. [Customer Chat API](#3-customer-chat-api)
4. [Configuration (Management) API](#4-configuration-management-api)
5. [Reports API (v3 + legacy v2)](#5-reports-api-v3--legacy-v2)
6. [Billing/Monetization + Global/Customer Accounts + HelpDesk + ChatBot API](#6-billingmonetization--globalcustomer-accounts--helpdesk--chatbot-api)
7. [RTM / WebSocket API](#7-rtm--websocket-api)
8. [OAuth 2.1](#8-oauth-21)
9. [Webhooks](#9-webhooks)
10. [Veri Yapıları (Data Structures)](#10-veri-yapıları-data-structures)
11. [Klon için Önerilen REST+WS API Kontratı](#11-klon-için-önerilen-restws-api-kontratı)
12. [Kapsam Özeti & Bilinen Boşluklar](#12-kapsam-özeti--bilinen-boşluklar)

---

## 1. Genel Konvansiyonlar

### 1.1 Host'lar ve marka geçişi

`[GÖZLEM]` LiveChat Software, **Text, Inc.**'e dönüştü. Geliştirici portalı `developers.livechat.com` → **`platform.text.com`**'a 302-redirect ile taşındı. **API host'ları değişmedi** — hâlâ `livechatinc.com`/`livechat.com` altında.

| Bileşen | Host | Kaynak |
|---|---|---|
| Agent/Customer/Configuration/Reports Web+RTM API | `api.livechatinc.com` | https://platform.text.com/docs/messaging/agent-chat-api |
| OAuth / Accounts (agent + customer) | `accounts.livechat.com` (eski `accounts.livechatinc.com`) | https://platform.text.com/docs/authorization/oauth-authorization |
| Billing / Monetization | `billing.text.com` (eski `billing.livechatinc.com`) | https://platform.text.com/docs/monetization/billing-api |
| HelpDesk | `api.helpdesk.com` | https://api.helpdesk.com/docs |
| ChatBot | `api.chatbot.com` | https://www.chatbot.com/docs/ |
| Widget tracking script | `cdn.livechatinc.com/tracking.js` | https://platform.text.com/docs/extending-chat-widget/javascript-api |
| Docs kaynağı (MDX, açık) | `github.com/livechat/livechat-public-docs` | https://github.com/livechat/livechat-public-docs |

**Ürün ailesi (tek platform):** LiveChat, ChatBot, HelpDesk, KnowledgeBase, OpenWidget, birleşik "Text" AI-agent uygulaması. Şirket Varşova Borsası'nda işlem görüyor (ticker **TXT**, eski **LVC**). `[GÖZLEM]` https://en.wikipedia.org/wiki/Text_(company)

### 1.2 Sürümleme

`[GÖZLEM]` Base pattern: `https://api.livechatinc.com/v<version>/<type>/action/<action>` (`type` ∈ `agent|customer|configuration`); Reports: `/v<version>/reports/<category>/<action>`.

- **Güncel kararlı sürüm: `3.6`** (2025-08-07). Önceki `3.5` (2022-11-23). `3.7` geliştirici önizlemesi olarak var.
- Versiyon geçmişi (Agent Chat API changelog): v3.1 2019-09-17 · v3.2 2020-06-18 · v3.3 2021-03-30 · v3.4 2021-12-22 · v3.5 2022-11-23 · v3.6 2025-08-07.
- Kaynak: https://platform.text.com/docs/messaging/agent-chat-api/changelog , https://platform.text.com/docs/management/changelog

### 1.3 HTTP metodu & içerik tipi

`[GÖZLEM]` Web API eylemlerinin neredeyse tamamı **`POST`** + JSON body. İstisnalar (GET): `get_dynamic_configuration`, `get_configuration`, `get_localization` (customer), property-list okumaları. `upload_file` → `multipart/form-data`. Reports API'nin **tüm** endpoint'leri hem `POST` hem `GET` kabul eder.

### 1.4 Auth başlıkları

| Şema | Başlık | Kullanım |
|---|---|---|
| OAuth Bearer | `Authorization: Bearer <access_token>` | Agent/Customer/Config/Reports/Accounts/HelpDesk/ChatBot |
| Basic PAT | `Authorization: Basic <base64(account_id:PAT)>` | Agent Chat/Config/Reports/Accounts/HelpDesk — **Customer Chat API'de ÇALIŞMAZ** |

`[GÖZLEM]` https://platform.text.com/docs/authorization/personal-access-tokens

### 1.5 Web API vs RTM API farkı

`[GÖZLEM]` Dokümanlar iki taşımayı ayırır:
- **Web API** — durumsuz (stateless), XHR/HTTP üzerinden; durum değişiklikleri **webhook** ile bildirilir.
- **RTM API** — durumlu (stateful), kalıcı WebSocket; durum değişiklikleri **push** olayları ile bildirilir.

Aynı `action` isimleri her iki taşımada da çalışır (ör. `send_event`, `transfer_chat`). Kaynak: https://platform.text.com/docs/messaging/agent-chat-api/v3.6/rtm-reference

### 1.6 Bölge (region)

`[GÖZLEM]` İki veri merkezi: **`dal`** (Dallas, ABD) ve **`fra`** (Frankfurt, AB), `region` query param'ı / `X-Region` başlığı ile seçilir. Yanlış bölgeye istek atılırsa `misdirected_request` hatası döner; `data.region` doğru bölgeyi belirtir. Token formatı da bölge önekiyle gelir: `dal:test_<...>` / `fra:test_<...>`. Kaynak: https://platform.text.com/docs/extending-chat-widget/customer-sdk

### 1.7 Hata zarfı

`[GÖZLEM]` **Numaralı `code` YOK, `success:false` alanı hata objesinde YOK.** Zarf:
```json
{"error":{"type":"misdirected_request","message":"Wrong region","data":{"region":"dal"}}}
```
Kaynak: https://platform.text.com/docs/messaging/agent-chat-api/v3.6/rtm-reference

### 1.8 Tam hata `type` listesi

`[GÖZLEM]` Kaynak: https://platform.text.com/docs/messaging/customer-chat-api/v3.6/rtm-reference

| `type` | Anlamı |
|---|---|
| `authentication` | Token geçersiz/süresi dolmuş |
| `authorization` | Bu işleme izin yok |
| `chat_anonymized` | Sohbet anonimleştirilmiş |
| `chat_inactive` | Sohbet aktif değil |
| `customer_banned` | Müşteri yasaklı |
| `greeting_not_found` | Karşılama bulunamadı |
| `group_not_found` | Grup bulunamadı |
| `group_offline` | Grup çevrimdışı |
| `group_unavailable` | Grup kullanılamaz |
| `groups_offline` | Tüm gruplar çevrimdışı |
| `internal` | Sunucu içi hata |
| `license_expired` | Lisans süresi dolmuş |
| `limit_reached` | Genel limit aşıldı |
| `not_allowed` | İşlem yasak |
| `not_found` | Kaynak bulunamadı |
| `pending_requests_limit_reached` | RTM soket başına 10 bekleyen istek sınırı |
| `request_timeout` | 15 sn RTM istek zaman aşımı |
| `service_unavailable` | Servis kullanılamaz |
| `too_many_requests` | Rate limit → HTTP 429 |
| `unsupported_version` | Desteklenmeyen API sürümü |
| `users_limit_reached` | Lisans başına çevrimiçi müşteri limiti |
| `validation` | Hatalı format/eksik alan |
| `wrong_product_version` | Lisans hâlâ eski ürün versiyonunda |
| `misdirected_request` | Yanlış bölgeye istek |

**OAuth/identity hataları** (redirect query param'ları `accounts.livechat.com/ooops`'a):
- `oauth_exception` ∈ `invalid_request, unauthorized_client, access_denied, unsupported_response_type, invalid_scope, server_error, temporarily_unavailable, unsupported_grant_type, invalid_grant, invalid_client, missing_grant`
- `identity_exception` ∈ `invalid_request, unauthorized, server_error, access_denied, identity_lost, credentials_login_disabled`
- `exception_details` ∈ `client_id_not_found, redirect_uri_not_set, invalid_redirect_uri, too_many_redirects`

Kaynak: https://platform.text.com/docs/authorization/troubleshooting

**`[GÖZLEM/GAP]`** Hata `type` → HTTP status kod eşleme tablosu ayrı bir sayfada dokümante edilmemiş (denenen `.../v3.6/error-handling` URL'i 404 döndü); yalnızca `too_many_requests`→429 örtük biçimde doğrulanabiliyor. Diğer type'lar muhtemelen 400/401/403/404/409/500 aralığına düşüyor — `[TAHMİN]`.

---

## 2. Agent Chat API

`[GÖZLEM]` Amaç: temsilci/bot tarafındaki tüm sohbet operasyonları. Base: `https://api.livechatinc.com/v3.6/agent/action/<action>`. Kaynak: https://platform.text.com/docs/messaging/agent-chat-api . Aksiyon kataloğu **[SDK: `@livechat/lc-sdk-js` v6.2.1]**: https://github.com/livechat/lc-sdk-js

### 2.1 Chats

| Action | İstek payload alanları | Yanıt |
|---|---|---|
| `list_chats` | `filters?, sort_order?, limit?, page_id?` | `{chats_summary[], found_chats, next_page_id?}` |
| `list_threads` | `chat_id, sort_order?, limit?, page_id?, min_events_count?` | `{threads[], found_threads, next_page_id?}` |
| `get_chat` | `chat_id, thread_id?` | Tam `Chat` objesi |
| `list_archives` | `filters, page_id?` | Kapanmış sohbetler |
| `start_chat` | `chat?{users?,properties?,thread?{events?}}, active?, continuous?` | `{chat_id, thread_id}` |
| `resume_chat` | `chat{id}, active?, continuous?` | `{chat_id, thread_id}` |
| `deactivate_chat` | `id, ignore_requester_presence?` | `{}` |
| `follow_chat` | `id` | `{}` |
| `unfollow_chat` | `id` | `{}` |

### 2.2 Erişim / transfer

| Action | Payload | Yanıt |
|---|---|---|
| `transfer_chat` | `id, target:{type:"group"\|"agent", ids:[]}, ignore_requester_presence?, ignore_agents_availability?` | `{}` |
| `list_agents_for_transfer` | `chat_id?` | `[{agent_id, total_active_chats}]` |
| `add_user_to_chat` | `chat_id, user_id, user_type, visibility?, ignore_requester_presence?` | `{}` |
| `remove_user_from_chat` | `chat_id, user_id, user_type` | `{}` |

### 2.3 Events

| Action | Payload | Yanıt |
|---|---|---|
| `send_event` | `chat_id, event:{type, text?, visibility}, attach_to_last_thread?` | `{event_id}` |
| `send_event_preview` | `chat_id, recipient_id?, event:{...}` | `{}` |
| `upload_file` | multipart form (**yalnızca Web API**) | `{url}` |
| `send_rich_message_postback` | `chat_id, thread_id, event_id, postback:{id, toggled, value?}` | `{}` |
| `send_typing_indicator` | `chat_id, recipient_type?, visibility?, is_typing` | `{}` |
| `send_thinking_indicator` | `chat_id, thread_id, thinking:{state}` | `{}` |
| `mark_events_as_seen` | `chat_id, seen_up_to` | `{}` |
| `multicast` | `recipients:{scope, ids?}, content, type?` | `{}` |

### 2.4 Properties

| Action | Payload |
|---|---|
| `update_chat_properties` / `delete_chat_properties` | `id, properties` |
| `update_thread_properties` / `delete_thread_properties` | `chat_id, thread_id, properties` |
| `update_event_properties` / `delete_event_properties` | `chat_id, thread_id, event_id, properties` |

### 2.5 Etiket & özet

| Action | Payload |
|---|---|
| `tag_thread` | `chat_id, thread_id, tag` |
| `untag_thread` | `chat_id, thread_id, tag` |
| `request_thread_summary` | `chat_id, thread_id` |

### 2.6 Müşteriler

| Action | Payload | Yanıt |
|---|---|---|
| `get_customer` | `id` | Tam `Customer` objesi |
| `update_customer` | `id?, name?, email?, avatar?, session_fields?` | Güncellenmiş `Customer` |
| `ban_customer` | `id, days` | `{}` |
| `subscribe_customers` / `unsubscribe_customers` | (**yalnızca RTM**, izleme) | — |

### 2.7 Durum / oturum

| Action | Payload | Not |
|---|---|---|
| `login` | (**yalnızca RTM**, bkz §7.2) | — |
| `logout` | `{}` | — |
| `set_routing_status` | `status ∈ accepting_chats\|not_accepting_chats\|offline, agent_id?` | — |
| `set_away_status` | `away, agent_id?` | — |
| `list_routing_statuses` | `filters?` | Temsilci→durum listesi |
| `change_push_notifications` | `firebase_token, platform, ...` | — |
| `update_session` | (**yalnızca RTM**, canlı soket üzerinde bearer yenileme) | — |

### 2.8 Örnek JSON istek/yanıtlar

Kaynak: https://platform.text.com/docs/messaging/agent-chat-api/v3.6/rtm-reference

```json
// start_chat isteği → yanıtı
{"action":"start_chat","payload":{}}
{"action":"start_chat","type":"response","success":true,
 "payload":{"chat_id":"PJ0MRSHTDG","thread_id":"PGDGHT5G"}}

// send_event isteği → yanıtı
{"action":"send_event","payload":{"chat_id":"PW94SJTGW6",
  "event":{"type":"message","text":"hello world","visibility":"all"}}}
{"action":"send_event","type":"response","success":true,"payload":{"event_id":"K600PKZON8"}}

// transfer_chat
{"action":"transfer_chat","payload":{"id":"PJ0MRSHTDG","target":{"type":"group","ids":[19]}}}

// list_chats yanıtı
{"action":"list_chats","type":"response","success":true,
 "payload":{"next_page_id":"MTUxNzM5ODEzMTQ5Ng==","chats_summary":[{}],"found_chats":4}}
```

---

## 3. Customer Chat API

`[GÖZLEM]` Amaç: widget/özel istemci — sohbet başlatma/devam ettirme, event gönderme, karşılamalarla (greeting) etkileşim. Base: `https://api.livechatinc.com/v3.6/customer/action/<action>?organization_id=<uuid>` — **`organization_id` her istekte zorunlu query param**. Kaynak: https://platform.text.com/docs/messaging/customer-chat-api . PAT ile yetkilendirilemez — müşteri token'ı gerekir (§8.4).

### 3.1 Tam action listesi

Kaynak: https://platform.text.com/docs/messaging/customer-chat-api/rtm-reference

| Kategori | Action'lar |
|---|---|
| Chats | `login`, `list_chats`, `list_threads`, `get_chat`, `start_chat`, `resume_chat`, `deactivate_chat` |
| Events | `send_event`, `delete_event` (v3.6 eklendi), `send_rich_message_postback`, `send_sneak_peek`, `upload_file`, `mark_events_as_seen` |
| Properties | `update_chat_properties`/`delete_chat_properties`, `update_thread_properties`/`delete_thread_properties`, `update_event_properties`/`delete_event_properties` |
| Müşteri | `update_customer`, `update_customer_page`, `set_customer_session_fields`, `get_customer` |
| Durum/etkileşim | `list_group_statuses`, `get_form`, `get_predicted_agent` (3.7'de kaldırıldı), `request_welcome_message` (v3.6 eklendi), `accept_greeting`, `cancel_greeting`, `get_url_info` |
| Config (GET) | `get_dynamic_configuration`, `get_configuration`, `get_localization`, `request_email_verification` (hepsi v3.3'te eklendi) |

### 3.2 `recipients` vs `visibility` farkı

`[GÖZLEM]` Müşteri tarafı event'lerinde alan adı **`recipients`** (`"all"` gibi); Agent API'de aynı kavram **`visibility`** olarak adlandırılır. Ayrıca **v3.6, `list_chats` yanıtındaki `chats_summary` dizisini `chats_info` olarak yeniden adlandırdı.** Kaynak: https://platform.text.com/docs/messaging/customer-chat-api/changelog

```json
// send_event (customer)
{"action":"send_event","payload":{"chat_id":"PW94SJTGW6",
  "event":{"type":"message","text":"hello world","recipients":"all"}}}

// update_chat_properties (customer, namespace'li)
{"action":"update_chat_properties","payload":{"id":"Q1GZ3FNAT9",
  "properties":{"0805e283233042b37f460ed8fbf22160":{"string_property":"..."}}}}
```

### 3.3 Greeting/form/welcome akışları

`[GÖZLEM]`
- **Greeting (karşılama) akışı:** sunucu `incoming_greeting` push'ı gönderir → istemci `accept_greeting` veya `cancel_greeting` action'ı ile yanıtlar → sonuç push'ları `greeting_accepted`/`greeting_canceled` olarak yayınlanır (§7.4).
- **Form akışı:** `get_form` (`form_id` veya `group_id` ile prechat/postchat formunu çeker) → müşteri doldurur → `send_event` içinde `type:"filled_form"` event'i gönderilir; sunucu bunu Agent tarafında `filled_form` event'i olarak yayınlar.
- **Welcome message akışı (v3.6):** `request_welcome_message` action'ı ile tetiklenir → sunucu push olarak `incoming_welcome_message` gönderir (bir önceki sürümlerde otomatikti, v3.6 explicit istek modeline geçti).

---

## 4. Configuration (Management) API

`[GÖZLEM]` Amaç: temsilci, bot, grup, özel property, webhook, etiket, karşılama, otomatik-erişim yönlendirme provizyonu. Base: `https://api.livechatinc.com/v3.6/configuration/action/<action>`, tümü **POST**, `Content-Type: application/json`. Doküman örnek auth'u `Authorization: Basic <PAT>` kullanır. **Davranışsal not:** *"Bu API ile yapılan tüm konfigürasyonlar en fazla 2 dakika içinde sistemde etkin olur"* (eventually consistent). **Batch:** birden çok istek objesini `{"requests":[...]}` içine sarmak (v3.5'te eklendi). Kaynak: https://platform.text.com/docs/management/configuration-api

### 4.1 Tam metod kataloğu (kaynak bazlı)

| Kaynak | Action'lar |
|---|---|
| **Agents** | `create_agent`, `get_agent`, `list_agents`, `update_agent`, `delete_agent`, `suspend_agent`, `unsuspend_agent`, `request_agent_unsuspension`, `approve_agent` (v3.6'da `avatar`/`name` create/update'ten kaldırıldı — Global Accounts API'ye taşındı) |
| **Bots** | `create_bot` (→ `{id, secret}`), `get_bot`, `list_bots`, `update_bot`, `delete_bot`, `issue_bot_token`, `reset_bot_secret`, `create_bot_template`, `update_bot_template`, `delete_bot_template`, `list_bot_templates`, `reset_bot_template_secret` (v3.6: `X-Author-Id` bot auth kaldırıldı; bot'lar `type` aldı) |
| **Groups** | `create_group`, `get_group`, `list_groups`, `update_group`, `delete_group` |
| **Properties** | `register_property`, `unregister_property`, `publish_property`, `list_properties`, `update_license_properties`, `delete_license_properties`, `list_license_properties`, `update_group_properties`, `delete_group_properties`, `list_groups_properties` |
| **Webhooks** | `register_webhook`, `unregister_webhook`, `list_webhooks`, `list_webhook_names`, `enable_license_webhook`, `disable_license_webhook`, `get_license_webhooks_state` |
| **Auto access / routing** | `add_auto_access`, `list_auto_accesses`, `update_auto_access`, `delete_auto_access` |
| **Tags** | `create_tag`, `delete_tag`, `list_tags`, `update_tag` (v3.5'te eklendi) |
| **Greetings/etkileşim (v3.6 eklendi)** | `create_greeting`, `update_greeting`, `delete_greeting`, `list_greetings`, `get_greeting` |
| **Müşteri yasakları (v3.6 eklendi)** | `list_customer_bans`, `unban_customer` |
| **Diğer** | `list_channels`, `check_product_limits_for_plan`, `reactivate_email`, `update_company_details` |

### 4.2 Örnekler

```json
// create_agent isteği → yanıtı
{"id":"smith@example.com","name":"Agent Smith","role":"viceowner",
 "groups":[{"id":5,"priority":"first"},{"id":1,"priority":"normal"}],
 "work_scheduler":{"schedule":[{"day":"monday","start":"08:00","end":"12:30","enabled":true}],
   "timezone":"Europe/Warsaw"},
 "notifications":["new_visitor","new_goal","visitor_is_typing"],
 "email_subscriptions":["weekly_summary"]}
→ {"id":"smith@example.com"}

// create_bot isteği → yanıtı
{"name":"Bot Name"} → {"id":"5c9871d5372c824cbf22d860a707a578","secret":"641e2ae6d997d2009a3ac92a05f37fc3"}

// create_tag
{"name":"vip","group_ids":[0]} → {}

// register_webhook (bkz. §9)
{"url":"http://myservice.com/webhooks","description":"...","action":"incoming_chat",
 "secret_key":"laudla991lamda0pnoaa0","owner_client_id":"asXdesldiAJSq9padj","type":"license"}
```
Kaynak: https://platform.text.com/docs/management/configuration-api

---

## 5. Reports API (v3 + legacy v2)

`[GÖZLEM]` Amaç: sohbet/temsilci/etiket/müşteri üzerinde analitik agregasyonlar. Base: `https://api.livechatinc.com/v3.6/reports/<category>/<action>`. **Her endpoint hem `POST` hem `GET` kabul eder.** `reports_read` scope'u gerekir. Ortak gövde parametreleri: `distribution` (`hour|day|day-hours|month|year`), `timezone` (IANA), `filters.from`/`filters.to` (RFC3339), `filters.agents`, `filters.groups`, `filters.tags`, `filters.properties.<ns>.<name>`. Kaynak: https://platform.text.com/docs/data-reporting/reports-api

### 5.1 v3 endpoint kataloğu

| Path | Döndürdüğü |
|---|---|
| `/reports/chats/total_chats` | Sayım; `records.<date>.{total, continuous}` |
| `/reports/chats/ranking` | `records.<agent>.{total, good, bad, score}` |
| `/reports/chats/engagement` | `{started_by_customer_from_greeting, ...without_greeting, ...by_agent}` |
| `/reports/chats/duration` | `{count, agents_chatting_duration, duration}` |
| `/reports/chats/response_time` | `{count, response_time}` |
| `/reports/chats/first_response_time` | `{count, first_response_time}` |
| `/reports/chats/ratings` | `{chats, bad, good}` (sohbet anket raporu) |
| `/reports/chats/tags` | Etiket dağılımı |
| `/reports/chats/forms` | `form_id, count, group_id, fields[].answers[]` |
| `/reports/chats/greetings_conversion` | Karşılama başına `{accepted, canceled, displayed, goals}` |
| `/reports/chats/queued_visitors` | `{left_queue{count,min,max,avg}, queued{...}}` |
| `/reports/chats/queued_visitors_left` | Sayfalı (`page`) terk detayı |
| `/reports/chats/groups` | Grup başına sayım |
| `/reports/agents/availability` | `records.<date>.hours`, `total` |
| `/reports/agents/performance` | Temsilci başına metrikler + `summary` |
| `/reports/customers/unique_visitors` | `summary.{unique_visitors, page_views}` |
| `/reports/tags/chat_usage` | Etiket → sayım |

```json
// POST /reports/chats/total_chats
{"distribution":"day","timezone":"America/Phoenix",
 "filters":{"from":"2021-04-08T00:00:00-00:00","to":"2021-04-15T23:59:59-00:00",
   "agents":{"values":["agent@example.com"]},"groups":{"values":[0,42]}}}
// → {"name":"total-chats-report","total":369,
//    "records":{"2021-04-08":{"total":37,"continuous":15}, ...}}
```

### 5.2 Legacy Reports API v2

`[GÖZLEM]` Base `https://api.livechatinc.com/reports`, `X-API-Version: 2`, sadece GET, HTTP-Basic. `goals`, `greetings`, `agents_occupancy` ve **tüm ticket raporları** burada yaşıyor:
`/chats/{total_chats,engagement,not_replied_chats,ratings,ratings/ranking,queued_visitors,queued_visitors/waiting_times,chatting_time,first_response_time,response_time,goals,greetings,agents_occupancy}`, `/availability`, `/tickets/{new_tickets,first_response_time,solved_tickets,resolution_time,ticket_sources,ratings,ratings/ranking}`.

Kaynak: https://platform.text.com/docs/data-reporting/reports-api/v2.0

---

## 6. Billing/Monetization + Global/Customer Accounts + HelpDesk + ChatBot API

### 6.1 Billing / Monetization API

`[GÖZLEM]` Amaç: marketplace uygulama ücretlendirmesi & ödemeler. Base: `https://billing.text.com`. Fiyatlar **cent cinsinden tam sayı**; `<product>` path segmenti ürün hattı (`livechat`, `helpdesk`, …). Kaynak: https://platform.text.com/docs/monetization/billing-api

| Method | Path | Amaç |
|---|---|---|
| POST | `/v3/direct_charge/<product>` | Tek seferlik ücret oluştur |
| GET | `/v3/direct_charge/<product>/:ID` | Getir |
| GET | `/v3/direct_charge/<product>` | Listele (`page`, `status`, `recurrent_charge_id`; sayfa başına 20) |
| PUT | `/v3/direct_charge/<product>/:ID/activate` | Aktive et |
| POST | `/v3/recurrent_charge/<product>` | Abonelik oluştur |
| GET | `/v3/recurrent_charge/<product>/:ID` | Getir |
| PUT | `/v3/recurrent_charge/<product>/:ID/{accept,decline,activate,cancel}` | Yaşam döngüsü |
| GET | `/v2/ledger/livechat` | Muhasebe defteri listesi (20/sayfa) |
| GET | `/v2/ledger/livechat/balance` | Bakiye |

- **Direct-charge zorunlu alanlar:** `name`, `price`, `quantity`, `return_url`; opsiyonel `per_account`, `test`. Durumlar: `pending, accepted, declined, processed, failed, success`.
- **Recurrent-charge zorunlu alanlar:** `name`, `price`, `return_url`; opsiyonel `external_id`, `test`, `trial_days`, `months`, `per_account`. Durumlar: `pending, accepted, declined, active, past_due, frozen, cancelled`.
- **Ledger entry tipleri:** `collection, refund, withdrawal`.
- **Checkout linki:** `https://livechat.com/marketplace/checkout/charge/<checkout_id>/<charge_type>?icon=...&description=...`.
- **Scope'lar:** direct → `billing_manage`/`billing--all:rw`; recurrent → + `billing_admin`; ledger → `ledger_read`.

```json
// POST /v3/recurrent_charge/livechat yanıtı (kısaltılmış)
{"id":"1c286f7a-...","buyer_organization_id":"e0a0ba10-...","buyer_license_id":100006625,
 "name":"sub1","price":1900,"trial_days":0,"months":1,"per_account":true,"status":"pending",
 "confirmation_url":"http://localhost:8000?id=1c286f7a-...&type=recurrent_charge",
 "commission_percent":20,"next_charge_at":null,"created_at":"2017-11-29T10:57:26Z"}
```

### 6.2 Global Accounts API + Customer Accounts API

`[GÖZLEM]`
- **Global Accounts API** (eski adı LiveChat Accounts API): "Text ortamında Organizations ve Accounts'ı yönetir" — organizasyonlar, hesap üyelikleri, roller üzerinde programatik CRUD. Host `accounts.livechat.com`; PAT/Bearer ile `accounts--*`/`accounts.roles*`/`organization--my:rw` scope'ları taşınarak yetkilendirilir. Kaynak: https://platform.text.com/docs/authorization/global-accounts-api/
- **Customer Accounts API:** müşteri auth'unun yönetim karşılığı — `/v2/customer/token` ile basılan kimliklerin **iptal ve doğrulaması**. Kaynak: https://platform.text.com/docs/authorization/customer-accounts-api/
- **Doğrulanmış temel yollar:** agent/global token alt ağacı `/v2/token`, `/v2/info` (§8); müşteri alt ağacı `/v2/customer/token`, `/v2/customer/identity_transfer`. Eski "Get Organization ID" metodu lisans → org UUID çözer (Postman: https://www.postman.com/livechat-api/livechat-api/request/234t4fh/get-organization-id).
- **`[GAP]`** Her iki Accounts API'nin tam `METHOD /path` operasyon tabloları istemci-taraflı ReDoc SPA olarak sunuluyor (WebFetch yalnızca `%%REDOC_SSR%%` placeholder'ı döndürüyor); JS-çalıştıran bir tarayıcı veya ham OpenAPI JSON gerekiyor. Canlılığı 2026-07-20'de doğrulandı.

### 6.3 HelpDesk API (ticketing ürünü)

`[GÖZLEM]` Base: `https://api.helpdesk.com/v1`, sürüm **1.0.0**. Auth: PAT (Basic) veya OAuth2 Authorization Code. Cursor sayfalama (`pageSize`, `order`, `sortBy`). Kaynak: https://api.helpdesk.com/docs

- **Tickets:** `GET/POST /tickets`, `GET/PATCH/DELETE /tickets/{ticketID}`, `POST|DELETE /tickets/{id}/tags`, `POST|DELETE /tickets/{id}/followers`, `POST /tickets/{id}/merge` (+ unmerge için `DELETE`), `POST /tickets/{id}/rating`, `GET /tickets/{id}/message`, `PUT /tickets/{id}/silo`, `DELETE /tickets/{id}/attachments`
- **Agents:** `GET/POST /agents`, `PATCH /agents` (toplu), `GET/PATCH/DELETE /agents/{agentID}`
- **Teams:** `GET/POST /teams`, `PATCH /teams`, `GET/PATCH/DELETE /teams/{teamID}`
- **Webhooks:** `GET/POST /webhooks`, `GET/PATCH/DELETE /webhooks/{webhookID}`
- Ayrıca: licenses, templates, subscriptions, tags, email, automations, audit logs, reporting.

```json
// Ticket objesi
{"ID":"42e113f9-...","licenseID":13381337,"createdAt":"2020-04-30T22:02:08.901Z",
 "shortID":"IIPZGJ","status":"open","priority":-10,"subject":"Ticket subject",
 "teamIDs":["..."],"requester":{"email":"...","name":"..."},"tagIDs":["..."],
 "followers":["..."],"assignment":{"team":{"ID":"...","name":"..."},"agent":{"ID":"...","name":"..."}},
 "customFields":{"order-id":"1234"},"silo":"tickets"}
```

### 6.4 ChatBot API

`[GÖZLEM]` Base: `https://api.chatbot.com`. Auth: `Authorization: Bearer <ACCESS_TOKEN>` (`app.chatbot.com/settings/developers`'dan üretilir). Kaynak alanları: **Stories** (CRUD), **Training** (ifadeler + NLP model eğitimi), **User Entities**, **Users** (profil/segment), **Archives** (sohbet geçmişi), **Reports**, **Webhooks**, **Chat Widget API**, **Moments SDK**. Kaynak: https://www.chatbot.com/docs/

### 6.5 KnowledgeBase — genel REST API yok

`[GÖZLEM]` KnowledgeBase (yardım merkezi; knowledgebase.ai) dokümante edilmiş bir genel geliştirici API'si olarak **sunulmuyor** — `platform.text.com` API navigasyonunda görünmüyor ve `api.knowledgebase.*` dokümanı yok. Yalnızca marketplace uygulaması üzerinden entegre olur. Klon için "genel API yok" olarak ele alınmalı. Kaynak: https://www.livechat.com/marketplace/apps/knowledge-base/

---

## 7. RTM / WebSocket API

### 7.1 Taşıma, endpoint'ler, zarf

`[GÖZLEM]` Taşıma **WebSocket** (`wss://`). İki paralel endpoint:
- Agent: `wss://api.livechatinc.com/v3.6/agent/rtm/ws?organization_id=<org>&region=<region>`
- Customer: `wss://api.livechatinc.com/v3.6/customer/rtm/ws?organization_id=<org>`

`organization_id` **zorunlu query param**. URL kuruluşu **[SDK: `lib/src/internal/index.js`]** ile doğrulandı: `wss://${APIURL}/v${version}/${type}/rtm/ws?` + querystring.

**Bağlantı yaşam döngüsü** (kaynak: rtm-reference):
- **30 sn içinde `login` action'ı ile yetkilendirilmeli**, aksi halde soket kapatılır.
- Yetkilendirmeden sonra **her 15 sn'de bir ping** (`{"action":"ping","payload":{}}`), aksi halde ~30 sn boşta kalınca kapatılır. (JS SDK 10 sn'de ping atıyor.)
- **Soket başına en fazla 10 bekleyen (in-flight) istek** (`pending_requests_limit_reached`); istek başına 15 sn timeout.

**İstek zarfı:**
```json
{"version":"3.6","request_id":"<uuid>","action":"<action>","payload":{}}
```
**Yanıt/push zarfı** (`type` ∈ `response | push`):
```json
{"request_id":"<uuid>","action":"<action>","type":"response","success":true,"payload":{}}
```
SDK, `type:"response"` mesajlarını `request_id`/`success` ile, `type:"push"` mesajlarını `action` ile yönlendirir. **[SDK: `lib/src/internal/index.js`]**

### 7.2 Soket üzerinden `login`

**[SDK: `lib/src/agent/structures/structures.d.ts` `LoginRequest`]** alanları:
```ts
{ token: string;                 // "Bearer <access_token>"
  timezone?; reconnect?: boolean;
  push_notifications?: { platform; firebase_token? };
  application?: { name?; version? };
  away?: boolean;
  customer_monitoring_level?: "my"|"chatting"|"invited"|"online"|"highest_available";
  pushes?: { "3.6": Push[] } }   // sürüm bazlı event aboneliği
```
> Bazı özet raporlarda geçen `customer_push_level` alanı yanlıştır — v3.5/3.6'da gerçek alan adı **`customer_monitoring_level`**.

```json
// Agent login
{"action":"login","payload":{"token":"Bearer dal:test_...","customer_monitoring_level":"my",
 "pushes":{"3.6":["incoming_chat","incoming_event"]}}}
// → payload {license:{id, organization_id, plan, ...}, my_profile:{id, routing_status, permission, ...}, chats_summary}

// Customer login
{"action":"login","payload":{"token":"Bearer dal:test_1fgTbfXmgthj4cZSA",
 "pushes":{"3.6":["incoming_chat","incoming_multicast"]}}}
// → payload {customer:{...}, has_active_thread, chats:[{chat_id,has_unread_events}],
//            greeting:{...}, __priv_dynamic_config:{online_groups_ids, customer_groups}}
```
Kaynak: https://platform.text.com/docs/messaging/customer-chat-api/rtm-reference , **[SDK]**

### 7.3 Agent PUSH event kataloğu (sunucu → istemci)

`[GÖZLEM]` Kesin isimler **[SDK: `lib/src/agent/structures/pushes.d.ts`]**; payload'lar birebir https://platform.text.com/docs/messaging/agent-chat-api/rtm-pushes/ sayfasından:

| Kategori | Push event'ler |
|---|---|
| Chats | `incoming_chat`, `chat_deactivated`, `chat_deleted`, `thread_deleted`, `threads_deleted`, `chat_unfollowed`, `queue_positions_updated` |
| Erişim/transfer/kullanıcılar | `chat_access_updated`, `chat_transferred`, `user_added_to_chat`, `user_removed_from_chat` |
| Events | `incoming_event`, `event_updated`, `event_deleted`, `incoming_rich_message_postback` |
| Properties | `chat_properties_updated`, `chat_properties_deleted`, `thread_properties_updated`, `thread_properties_deleted`, `event_properties_updated`, `event_properties_deleted` |
| Etiket/özet | `thread_tagged`, `thread_untagged`, `thread_summary_set` |
| Göstergeler | `incoming_typing_indicator`, `incoming_sneak_peek`, `incoming_thinking_indicator`, `events_marked_as_seen`, `incoming_multicast` |
| Müşteriler/izleme | `incoming_customers`, `incoming_customer`, `customer_created`, `customer_visit_started`, `customer_visit_ended`, `customer_updated`, `customer_page_updated`, `customer_page_activated`, `customer_page_deactivated`, `customer_page_closed`, `customer_statistics_updated`, `customer_banned`, `customer_left`, `customer_transferred`, `subscribed_customers_totals_updated`, `ticket_created`, `ticket_deleted` |
| Temsilci/durum | `routing_status_set`, `agent_disconnected`, `agent_created`, `agent_updated`, `agent_approved`, `agent_suspended`, `agent_unsuspended`, `agent_deleted` |
| Config akışı (abone olunabilir) | `bot_created/updated/deleted`, `group_created/updated/deleted`, `groups_status_updated`, `auto_access_added/deleted/updated`, `license_properties_updated`, `group_properties_updated`, `incoming_error` |

```json
// incoming_chat
{"requester_id":"smith@example.com","chat":{"id":"PJ0MRSHTDG","users":[],"properties":{},"thread":{}},
 "transferred_from":{"group_ids":[1],"agent_ids":["agent@example.com"]}}
// incoming_event
{"chat_id":"PJ0MRSHTDG","thread_id":"K600PKZON8",
 "event":{"id":"Q20163UAHO_2","created_at":"2019-12-05T07:27:08.820000Z","visibility":"all",
   "type":"message","text":"Hello","author_id":"b7eff798-..."}}
// chat_transferred
{"chat_id":"PJ0MRSHTDG","thread_id":"K600PKZON8","requester_id":"jones@example.com","reason":"manual",
 "transferred_to":{"group_ids":[19],"agent_ids":["smith@example.com"]},
 "queue":{"position":42,"wait_time":1337,"queued_at":"2019-12-09T12:01:18.909000Z"}}
// incoming_typing_indicator
{"chat_id":"PJ0MRSHTDG","thread_id":"K600PKZON8",
 "typing_indicator":{"author_id":"smith@example.com","visibility":"all","timestamp":1574245378,"is_typing":true}}
// routing_status_set
{"agent_id":"smith@example.com","status":"accepting_chats"}
// agent_disconnected
{"reason":"misdirected_request","data":{"region":"fra"}}
```

### 7.4 Customer PUSH event kataloğu

`[GÖZLEM]` Kaynak: https://platform.text.com/docs/messaging/customer-chat-api/rtm-pushes . Set: `incoming_chat`, `chat_deactivated`, `incoming_event`, `event_updated`, `incoming_rich_message_postback`, `chat_properties_updated/deleted`, `thread_properties_updated/deleted`, `event_properties_updated/deleted`, `incoming_typing_indicator`, `events_marked_as_seen`, `customer_updated`, `incoming_greeting`, `greeting_accepted`, `greeting_canceled`, `chat_transferred`, `queue_position_updated`, `user_added_to_chat`, `user_removed_from_chat`, `incoming_multicast`, `incoming_welcome_message` (v3.6 eklendi), `incoming_event_preview`, `incoming_thinking_indicator`, `connection_error`. **v3.6'da kaldırıldı:** `customer_page_updated`. (Müşteri payload'ları agent'ın `visibility`'si yerine `recipients` kullanır.)

```json
// incoming_greeting (tam zarf)
{"action":"incoming_greeting","type":"push","payload":{"id":7,"unique_id":"Q10O0N5B5D",
 "displayed_first_time":true,"addon":"email","subtype":"announcement","is_exit_intent":false,
 "event":{},"agent":{"name":"Agent Smith","id":"b5657aff...","avatar":"...","job_title":"Support Agent","is_bot":false}}}
```

### 7.5 RTM sınırları özeti

`[GÖZLEM]` login ≤30 sn · ping 15 sn (SDK 10 sn) · max 10 bekleyen istek/soket (`pending_requests_limit_reached`) · istek timeout 15 sn (`request_timeout`) · lisans başına çevrimiçi müşteri limiti (`users_limit_reached`).

---

## 8. OAuth 2.1

`[GÖZLEM]` Platform tüm ürünlerde **OAuth 2.1** kullandığını belirtiyor. Kaynak: https://platform.text.com/docs/authorization

### 8.1 Endpoint'ler

| Amaç | Method | URL |
|---|---|---|
| Yetkilendirme (tarayıcı redirect) | GET | `https://accounts.livechat.com/` |
| Token değişimi & yenileme | POST | `https://accounts.livechat.com/v2/token` |
| Token doğrulama/bilgi | GET | `https://accounts.livechat.com/v2/info` |
| Token iptali | DELETE | `https://accounts.livechat.com/v2/token` |
| Müşteri token | POST | `https://accounts.livechat.com/v2/customer/token` |
| Müşteri kimlik transferi | POST | `https://accounts.livechatinc.com/v2/customer/identity_transfer` |

Kaynak: https://platform.text.com/docs/authorization/oauth-authorization

### 8.2 Dört akış (flow)

`[GÖZLEM]` **Sign in with LiveChat** (Accounts SDK), **Implicit Grant** (JS uygulamaları; `response_type=token`; secret yok; token URL fragment'ında), **Authorization Code Grant** (sunucu; `response_type=code`; `client_secret` gerektirir; refresh token verir), **PKCE** (code verifier 43–128 karakter, methodlar `plain`/`S256`; özel-şema redirect'leri mümkün kılar).

```
# Authorization Code — yetkilendirme
https://accounts.livechat.com/?response_type=code&client_id=9cbf3a96...&redirect_uri=https%3A%2F%2Fmy-application.com&state=...
# → https://my-application.com/?code=test_7W91a-...&state=...   (code tek kullanımlık, birkaç dakika geçerli)

# Token değişimi
POST https://accounts.livechat.com/v2/token
grant_type=authorization_code&code=dal:test_...&client_id=...&client_secret=test_d7MEp1YYo3&redirect_uri=...
```
```json
// Token yanıtı
{"access_token":"dal:test_YTJQ6GDVgQf8kQDPw","account_id":"b7eff798-...","expires_in":28800,
 "organization_id":"390e44e6-...","refresh_token":"test_gfalskca...","scope":"chats--all:ro,chats--all:rw",
 "token_type":"Bearer"}
```
**Implicit** token'ı fragment'ta döndürür: `#access_token=dal%3Atest_...&token_type=Bearer&expires_in=28800&state=...`.
**Refresh:** `POST /v2/token` gövde `grant_type=refresh_token&refresh_token=...&client_id=...&client_secret=...`.
**Sign in with LiveChat** = `@livechat/accounts-sdk@^2.0.0`; `new AccountsSDK({client_id, redirect_uri})`; methodlar `popup()`, `redirect()`, `authorizeURL()`, `verify()`, `authorizeData()`; **PKCE varsayılan olarak açık**. Kaynak: https://platform.text.com/docs/authorization/sign-in-with-livechat

### 8.3 Personal Access Token (PAT)

`[GÖZLEM]` "Text API'lerine erişimin en kolay yolu." Developer Console → Settings/Tools → Personal Access Tokens'da oluşturulur; **scope'lar oluşturma anında seçilir, sonradan değişmez**. Auth şeması **Basic** (Bearer değil): kimlik bilgisi `<account_id>:<PAT>` → `Authorization: Basic <base64>`. Agent Chat (Web), Configuration, Reports, Global Accounts, HelpDesk, CDP, Text API'lerinde çalışır — **ama Customer Chat API'de ÇALIŞMAZ**. Kaynak: https://platform.text.com/docs/authorization/personal-access-tokens

### 8.4 Agent vs Customer vs Bot token'ları

`[GÖZLEM]`
- **Token formatı:** `dal:test_<alfanumerik>` (`dal:` öneki literal; `:` URL-encode edilince `%3A`).
- **Agent token'ları** (Bearer veya Basic-PAT): Agent Chat, Configuration, Accounts, HelpDesk, Reports, Text API'lerinde geçerli. `organization_id` **token yanıtında/`/v2/info`'da döner**, her istekte gönderilmez.
- **Müşteri token'ları** — hepsi `POST https://accounts.livechat.com/v2/customer/token` üzerinden, varsayılan `expires_in` 28800 (8 sa):
  - **Cookie grant** (frontend): `grant_type=cookie`, `client_id`, `response_type=token`, `organization_id`, opsiyonel `redirect_uri`. `__lc_cid` + `__lc_cst` çerezlerini kurar (`Secure`, `HttpOnly`, `SameSite=None`, 2 yıllık, her çağrıda uzatılır → geri dönen ziyaretçi kimliği). Yanıt `entity_id` (müşteri ID) içerir.
  - **Agent-token grant** (backend impersonation, ör. Messenger/WhatsApp): `grant_type=agent_token` + `customers:own` scope'lu Bearer agent token; `entity_id` verilmezse yeni müşteri oluşturulur.
  - **Identity-token grant** (cihazlar arası, PKCE destekli): adım 1 `POST /v2/customer/identity_transfer` (`bearer_type`, `client_id`, `customer_id`, opsiyonel `code_challenge`) → `identity_transfer_token`; adım 2 `POST /v2/customer/token` gövde `grant_type=identity_token&code=<token>&code_verifier=...`.
- **Bot token'ları:** Configuration API `issue_bot_token`/`reset_bot_secret` ile basılır; bot scope'ları `agents-bot--{my,all}:{ro,rw}`. Programatik "müşteri bot'ları" agent-token grant + `customers:own` kullanır.

Kaynak: https://platform.text.com/docs/authorization/customer-authorization , https://platform.text.com/docs/authorization/agent-authorization

### 8.5 Scope'lar (~63 tane, tam liste)

`[GÖZLEM]` Konvansiyon: `resource--access:permission`, permission ∈ `ro` (read), `rw` (read/write), `rc` (read/create). Kaynak: https://platform.text.com/docs/authorization/scopes (doğrudan sayfa taramasıyla doğrulandı, 20 Temmuz 2026):

| Kategori | Scope'lar |
|---|---|
| **Account** | `accounts--my:ro`, `accounts--my:rw`, `accounts--all:ro`, `accounts--all:rw`, `accounts--all:rc` |
| **Role** | `accounts.roles--all:ro`, `accounts.roles.lc--all:rw` |
| **Session** | `sessions--my:ro`, `sessions--my:rw` |
| **Organization** | `organization--my:rw` |
| **Agent** | `agents--my:rw`, `agents--my:ro`, `agents--all:rw`, `agents--all:ro` |
| **Access rules** | `access_rules:ro`, `access_rules:rw` |
| **Bot** | `agents-bot--my:ro`, `agents-bot--my:rw`, `agents-bot--all:ro`, `agents-bot--all:rw` |
| **Canned responses** | `canned_responses--groups:ro`, `canned_responses--groups:rw`, `canned_responses--all:ro`, `canned_responses--all:rw` |
| **Group** | `groups--my:rw`, `groups--my:ro`, `groups--all:rw`, `groups--all:ro` |
| **Chat** | `chats--all:ro`, `chats--access:ro`, `chats--all:rw`, `chats--access:rw` |
| **Customer** | `customers.ban:rw`, `customers:own`, `customers:ro`, `customers:rw` |
| **Multicast** | `multicast:rw` |
| **Properties** | `properties.license.value--my:rw`, `properties.license.value--all:rw`, `properties.group.value--my:rw`, `properties.group.value--all:rw`, `properties.configuration:rw` |
| **Tag** | `tags--all:rw`, `tags--all:ro`, `tags--groups:rw`, `tags--groups:ro` |
| **Webhook** | `webhooks--my:ro`, `webhooks--my:rw`, `webhooks--all:ro`, `webhooks--all:rw`, `webhooks.state:ro`, `webhooks.state:rw`, `webhooks.configuration:rw` |
| **Reports/Billing (`--` desenine uymaz)** | `reports_read`, `billing_manage`, `billing_admin`, `billing--all:rw`, `ledger_read` |

Token yanıtlarında scope **virgülle ayrılmış string**; Accounts SDK üzerinde **JSON dizisi** olarak döner.

### 8.6 Oturum yönetimi & limitler

`[GÖZLEM]`
- **Süre:** `expires_in` varsayılan **28800 sn (8 sa)**; `/v2/info` *kalan* saniyeyi döndürür (azalır). Yalnızca Authorization Code refresh token verir.
- **Doğrulama:** `GET /v2/info` (Bearer) → `{access_token, account_id, client_id, expires_in, organization_id, scope, token_type}`.
- **İptal:** `DELETE /v2/token` (Bearer) → `{}`.
- **Limitler:** client/kullanıcı başına maks **25 access token** ve **25 refresh token** (en eski otomatik iptal edilir); **30 sn'de 3 redirect** (client/kullanıcı başına).
- **Redirect-URI kuralları:** şema/host büyük-küçük harf duyarlı tam eşleşme; kayıtlı yol, yetkilendirme yolunun bir alt dizesi olmalı; query string ve fragment yasak; path traversal reddedilir.

Kaynak: https://platform.text.com/docs/authorization/authorizing-api-calls/

### 8.7 Kimlikler & `license_id` → `organization_id` geçişi

`[GÖZLEM]`

| ID | Anlamı | Format |
|---|---|---|
| `client_id` | Uygulamanın genel ID'si | 32-hex, ör. `9cbf3a968289727cb3cdfe83ab1d9836` |
| `client_secret` | Uygulama secret'ı (Auth Code) | ör. `test_d7MEp1YYo3` |
| `account_id` | Global Account/temsilci kullanıcı ID'si; PAT kullanıcı adı | UUID |
| `organization_id` | Token/hesabın ait olduğu organizasyon | UUID |
| `entity_id` | **Müşteri** kimlik ID'si (Customer Chat API) | UUID |
| `license_id` | **Eski** numerik LiveChat lisans ID'si; `organization_id` ile değiştiriliyor | integer |

**Global Accounts modeli:** bir **Account** = tüm ürünlerde paylaşılan kullanıcı; birden çok **Organization**'a farklı rollerle üye olabilir (roller: `primary` owner/administrator/member; `secondary` ürün-bazlı; `custom` ör. `billing_editor`). Bir org = bir benzersiz ürün; org'un en az 1 hesabı olmalı. Lisans oluşturmak otomatik org oluşturur. **API düzeyindeki değişim:** webhook payload'ları v3.2'de (2020-06-18) `license_id` kazandı, sonra **v3.4'te (2021-12-22) `license_id` → `organization_id`** ile değiştirildi.

Kaynak: https://platform.text.com/docs/authorization/global-accounts/ , https://platform.text.com/docs/management/changelog

---

## 9. Webhooks

### 9.1 İki ayrı sistem

`[GÖZLEM]` Karıştırılmamalı:
1. **Configuration-API webhook'ları** — ince taneli chat/agent/bot/group event'leri (`register_webhook` ile kaydedilir; Console'daki "Chat webhooks" bu sistemdir). Kaynak: https://platform.text.com/docs/getting-started/app-guides/chat-webhooks/
2. **App/Console webhook'ları** — yalnızca uygulama yaşam döngüsü: `application_installed`, `application_uninstalled`, `payment_trialstarted`, `payment_activated`, `payment_collected`, `payment_cancelled` (zarf alanları `applicationID, applicationName, clientID, date, event, licenseID, organizationID, payload, userID`). Kaynak: https://platform.text.com/docs/getting-started/app-guides/app-webhooks

### 9.2 Kayıt modeli

`[GÖZLEM]` Model: **"Client ID başına kayıt, lisans başına etkinleştirme."** `type` ∈ `"license" | "bot"`. Kayıt gövdesi **[SDK: `lc-sdk-go` `configuration/structures.go`]**: `action`, `secret_key`, `url`, `type`, `additional_data[]?`, `description?`, `filters?` (döndürülen kayıtta `owner_client_id`). Kaynak: https://raw.githubusercontent.com/livechat/lc-sdk-go/master/configuration/structures.go

```json
// register_webhook
{"url":"http://myservice.com/webhooks","description":"...","action":"incoming_chat",
 "secret_key":"laudla991lamda0pnoaa0","owner_client_id":"asXdesldiAJSq9padj","type":"license"}
```
**Filtreler** [SDK]: `author_type`, `only_my_chats`, `chat_presence{user_ids{values[], exclude_values[]}, my_bots}`, `source_type[]`. `additional_data[]` ek payload alanları talep eder; `list_webhook_names` her `action`'ı izin verilen `additional_data`/`filters` ile döner.
**Durum yönetimi:** `enable_license_webhook`, `disable_license_webhook`, `get_license_webhooks_state` → `{"license_webhooks_enabled":<bool>}`.

### 9.3 Tam event kataloğu (~40 event)

`[GÖZLEM]` Doküman: *"chats, customers, bots, agents, tags gibi çeşitli kategorilerde neredeyse 40 event."* Kesin `action` string'leri hem **[SDK: `lc-sdk-go` `webhooks/structures.go`]** hem de `platform.text.com/docs/management/webhooks` sayfasının doğrudan taramasıyla (20 Temmuz 2026) çapraz doğrulandı:

| Kategori | Event'ler |
|---|---|
| **Chats** | `incoming_chat`, `chat_deactivated` |
| **Chat erişimi** | `chat_access_updated`, `chat_transferred` |
| **Chat kullanıcıları** | `user_added_to_chat`, `user_removed_from_chat` |
| **Events** | `incoming_event`, `event_updated`, `event_deleted` (v3.6), `incoming_rich_message_postback` |
| **Properties** | `chat_properties_updated`, `chat_properties_deleted`, `thread_properties_updated`, `thread_properties_deleted`, `event_properties_updated`, `event_properties_deleted` |
| **Thread etiketleri** | `thread_tagged`, `thread_untagged` |
| **Durum** | `routing_status_set` |
| **Müşteriler** | `customer_session_fields_updated` (`incoming_customer` **v3.6'da kaldırıldı**) |
| **Temsilciler** | `agent_created`, `agent_approved`, `agent_updated`, `agent_suspended`, `agent_unsuspended`, `agent_deleted` |
| **Bot'lar** | `bot_created`, `bot_updated`, `bot_deleted` |
| **Gruplar** | `group_created`, `group_updated`, `group_deleted` |
| **Etiketler** | `tag_created`, `tag_updated`, `tag_deleted` |
| **Otomatik erişim** | `auto_accesses_updated` (konsolide edilmiş tekil event; eski changelog kayıtlarında ayrık `auto_access_added/updated/deleted` de görülür — sürüme göre `list_webhook_names` ile doğrulayın) |
| **Diğer** | `events_marked_as_seen`, `thread_summary_set` (v3.6) |

### 9.4 Teslim zarfı, imza, retry

`[GÖZLEM]` **Standart teslim zarfı** (20 Temmuz 2026'da `platform.text.com/docs/management/webhooks`'tan doğrulandı — `requester` bloğu dahil edildi):
```json
{
  "webhook_id": "<webhook_id>",
  "secret_key": "<secret_key>",
  "action": "<action_name>",
  "organization_id": "390e44e6-f1e6-0368c-z6ddb-74g14508c2ex",
  "payload": { },
  "additional_data": {
    "chat_properties": {},
    "chat_presence_user_ids": []
  },
  "requester": {
    "user_id": "user@example.com",
    "account_id": "f09ba25b-8be8-4fcd-a2c8-0b1c567aec85",
    "client_id": "1b4237f476826986da63022a76c35bb1"
  }
}
```
(`requester` bloğu v3.6'da eklendi ve özellikle configuration webhook'larında değişikliği tetikleyen kullanıcıyı tanımlar.)

**İmza doğrulama:** **HMAC yok.** Doğrulama, teslim edilen `secret_key` alanının kayıt sırasında verilen değerle karşılaştırılmasıyla yapılır — *"Secret key'inizi her webhook'un payload'ına dahil edeceğiz…uygulamanız webhook'ların bizden geldiğini doğrulayabilir."* Kaynak: https://platform.text.com/docs/getting-started/app-guides/chat-webhooks/

**Teslim/retry:** tüketici HTTP **200** döndürmelidir. *"Timeout yaklaşık 10 saniye olarak ayarlanmıştır. Bu süre içinde HTTP 200 alınamazsa, ~1 dakika içinde webhook'u en fazla 3 kez tekrar göndeririz."* Kaynak: https://platform.text.com/docs/getting-started/livechat-apps/webhook-apps/

### 9.5 Güvenlik önerisi (klon için)

`[TAHMİN/ÖNERİ]` Orijinal sistem yalnızca statik `secret_key` karşılaştırması kullanıyor (replay koruması yok, HMAC yok). Klon için önerilir:
- **HMAC-SHA256 imza** (`X-Signature` başlığı, gövde + gizli anahtar üzerinden hesaplanır), sabit-zamanlı karşılaştırma.
- **Timestamp + nonce** ile replay saldırısı önleme (`X-Timestamp` başlığı, ±5 dk pencere).
- Webhook URL'lerinin yalnızca HTTPS olmasını zorunlu kılma; SSRF önleme (özel IP aralıklarına teslimi engelleme).
- Üstel geri çekilmeli (exponential backoff) retry kuyruğu (BullMQ/Sidekiq) + dead-letter queue.

---

## 10. Veri Yapıları (Data Structures)

Kaynak: https://platform.text.com/docs/messaging/agent-chat-api/v3.6/data-structures (20 Temmuz 2026'da doğrudan taranarak genişletildi) + **[SDK type defs]**.

### 10.1 Chat & Thread

**Chat**

| Alan | Tip |
|---|---|
| `id` | string |
| `threads` | Thread[] |
| `users` | User[] |
| `properties` | Properties |
| `access` | Access |
| `is_followed` | boolean |

`ChatsSummary` (list_chats yanıtında): `id`, `last_event_per_type?`, `users[]`, `last_thread_summary?`, `properties?`, `access?`, `is_followed`.

**Thread**

| Alan | Tip |
|---|---|
| `id` | string |
| `created_at` | string (RFC3339) |
| `active` | boolean |
| `user_ids` | string[] |
| `events` | Event[] |
| `properties` | Properties |
| `access` | Access |
| `tags` | string[] |
| `queue` | `{position, wait_time, queued_at?}` |
| `queues_duration` | number |
| `previous_thread_id` | string |
| `next_thread_id` | string |
| `customer_visit` | `{ip, user_agent, geolocation}` |
| `restricted_access` | string |
| `summary` | `{text, status, updated_at}` |

### 10.2 Event (ayrık birleşim / discriminated union, `type` alanına göre)

Temel alanlar: `id, custom_id?, created_at, type, author_id, visibility (agent) / recipients (customer), properties?, deleted?`.

| Alt tip | Ek alanlar |
|---|---|
| **message** | `text`, `postback?{id, thread_id, event_id, type?, value?, ecommerce?{product_id, option_id, quantity}}` |
| **system_message** | `text?`, `system_message_type` (ör. `"routing.assigned"`), `text_vars?` |
| **file** | `name, url, thumbnail_url?, thumbnail2x_url?, content_type, size?, width?, height?, alternative_text?` |
| **form** | `fields[]` (`{type, id, label, required?, options?}`) — form gösterimi (prechat/postchat) |
| **filled_form** | `form_id, form_type?` (`"prechat"`/`"postchat"`), `fields[]` (`{type, id, label, answer?|answers?}`) |
| **rich_message** | `template_id` (`"cards"`/`"quick_replies"`/`"sticker"`), `elements[]` |
| **custom** | `content?: object` |
| **system** | `source, subtype, details, version` |

### 10.3 Rich Message

| Yapı | Alanlar |
|---|---|
| **RichMessage** | `template_id`, `elements[]` |
| **Element** | `title?, subtitle?, image?, buttons?, ecommerce?` |
| **Button** | `text, postback_id, user_ids[], type, value, webview_height?, target?` |
| **Image** | `name, url, content_type, size, width, height, alternative_text` |
| **Ecommerce** (element) | `view_type, product_id, label?, options?, addons?` |

### 10.4 User (Agent / Customer / MyProfile)

**Temel alanlar:** `id, type, name?, present?, events_seen_up_to?`.

| Tür | Ek alanlar |
|---|---|
| **Agent** | `email, avatar, visibility` (müşteri tarafına gösterilen agent objesi ek olarak `job_title, is_bot` taşır) |
| **MyProfile** (login yanıtı) | `routing_status, permission` |
| **Customer** | `email, email_verified, avatar?, phone_number?, visit{started_at, ended_at, referrer, ip, user_agent, geolocation, last_pages[]}, session_fields[], statistics, agent_last_event_created_at?, customer_last_event_created_at?, created_at?, followed, online, group_ids?, tickets?, state?, carts[], omnichannel?, address?, customer_properties?, name_is_default, greeting_id?` |

**Cart / CartItem** (e-ticaret entegrasyonu): `store_uuid, store_platform, customer_signed_in, subtotal, total, subtotal_usd, total_usd, currency, items[{id, quantity, variant_id}], last_updated_at`.

**Customer Property (namespaced değer):** `value, last_updated_at, last_updated_agent_account_id, last_updated_agent_client_id`.

**Address:** `address, city, country, state, postal_code`.

### 10.5 Access, Properties, Statistics, Geolocation

- **Access** — `{group_ids?: number[], agent_ids?: string[]}`; **grup `0` = tüm temsilciler**.
- **Properties** — namespace'li KV: `{ "<namespace_hash>": { "<name>": <değer> } }`; bilinen namespace'ler `routing`, `source`, `supervising`, `rating{score,comment}`.
- **Statistics** — `chats_count, threads_count, visits_count, page_views_count, greetings_shown_count, greetings_accepted_count, greetings_converted_count, tickets_count, tickets_inbox_count, tickets_archive_count, tickets_spam_count, tickets_trash_count, orders_count, last_visit_started_at?`.
- **Geolocation** — `country?, country_code?, region?, city?, timezone?, longitude?, latitude?`.

### 10.6 Config-side objeler [SDK `configuration/structures.go`]

| Obje | Alanlar |
|---|---|
| **Agent** | `id, account_id?, last_logout?, role, avatar, job_title, mobile, max_chats_count, awaiting_approval, suspended, groups[], work_scheduler, notifications[], email_subscriptions[]`; roller: `owner, viceowner, administrator, normal` |
| **Group** | `id, name, language_code, agent_priorities{}, routing_status`; agent↔group `GroupConfig{id, priority ∈ first|normal|last}` |
| **WorkScheduler** | `{timezone, schedule[{enabled, day (monday…sunday), start, end}]}` |
| **PropertyConfig** | `name, owner_client_id?, type, access{agent[],customer[]}, description?, domain[]?, range{from,to}?, public_access[]?, default_value?` |
| **AutoAccess** | `id, access{groups[]}, conditions{url?, domain?, geolocation?}, description?, next_id?` |
| **Tag** | `name, group_ids[], created_at, author_id` |
| **CompanyDetails** | `invoice_name, company, street, postal_code, city, country, nip, state, province, phone, url, invoice_email, company_size, chat_purpose, audience, industry` |

**Ticket** (HelpDesk) — bkz. §6.3. **Charge** (Billing) — bkz. §6.1. **Report** şekilleri — bkz. §5.

---

## 11. Klon için Önerilen REST+WS API Kontratı

`[TAHMİN/ÖNERİ]` Aşağıdaki kontrat, orijinal platformun konvansiyonlarını (action-tabanlı POST, WS push, scope tabanlı auth) korurken modern REST semantiğine (kaynak-tabanlı yol + HTTP metodu) yaklaşır — iki yaklaşımdan hibrit.

### 11.1 Versiyonlama

- Path-tabanlı: `/api/v1/...` (breaking change'lerde `v2`'ye geçilir).
- Değişiklik günlüğü (`CHANGELOG.md`) + `Sunset`/`Deprecation` HTTP başlıkları ile 6 ay geriye dönük uyumluluk penceresi.

### 11.2 Hata formatı (orijinalden daha ayrıntılı, geriye uyumlu)

```json
{
  "error": {
    "type": "validation",
    "code": "VALIDATION_FAILED",
    "message": "chat_id is required",
    "field": "chat_id",
    "request_id": "8f14e45f-...",
    "data": {}
  }
}
```
- `type` — orijinaldeki gibi makine-okunur kategori (bkz. §1.8 listesi + klon-özel ekler).
- `code` — HTTP-durumdan bağımsız, istemci-tarafı switch-case için sabit string.
- `request_id` — trace/log korelasyonu için (orijinalde yok — iyileştirme).
- HTTP status eşlemesi: `validation/not_found→404 veya 400`, `authentication→401`, `authorization/not_allowed→403`, `too_many_requests→429` (ve **`Retry-After` başlığı** — orijinalde eksikti, klon bunu ekler), `internal/service_unavailable→500/503`.

### 11.3 Kaynak-tabanlı ana rotalar (örnek)

| Kaynak eylemi | Klon REST | Orijinal karşılığı |
|---|---|---|
| Sohbet başlat | `POST /api/v1/conversations` | `agent/action/start_chat` |
| Sohbet listele | `GET /api/v1/conversations?status=active&page=` | `agent/action/list_chats` |
| Mesaj gönder | `POST /api/v1/conversations/{id}/events` | `agent/action/send_event` |
| Sohbeti devret | `POST /api/v1/conversations/{id}/transfer` | `agent/action/transfer_chat` |
| Property güncelle | `PATCH /api/v1/conversations/{id}/properties` | `agent/action/update_chat_properties` |
| Webhook kaydet | `POST /api/v1/webhooks` | `configuration/action/register_webhook` |
| Rapor çek | `GET /api/v1/reports/chats/total?distribution=day&from=&to=` | `reports/chats/total_chats` |

Not: iç motor katmanı (WS gateway, event-sourcing) orijinaldeki `action` isimlerini **internal event tipi** olarak koruyabilir — dış REST yüzeyi kaynak-tabanlı, iç mesaj veriyolu action-tabanlı kalabilir (bkz. `/root/text_analysis/02-teknik-mimari.md` §2.11.2 örneği).

### 11.4 WebSocket kontratı

- Endpoint: `wss://api.clone.example.com/v1/rtm/ws?organization_id=<uuid>`.
- Zarf orijinalle birebir aynı tutulur (istemci SDK taşınabilirliği için): `{"request_id","action","payload"}` → yanıt `{"request_id","action","type":"response|push","success","payload"}`.
- `login` action'ı JWT bearer alır; sunucu 30 sn içinde login beklemez ise kapatır; 15 sn ping/pong; soket başına 10 pending istek sınırı — **orijinalle bilinçli olarak uyumlu**, üçüncü parti SDK'ların (varsa) yeniden kullanılabilmesi için.

### 11.5 Örnek OpenAPI parçası

```yaml
openapi: 3.1.0
info:
  title: Clone Chat Platform API
  version: 1.0.0
servers:
  - url: https://api.clone.example.com/v1
paths:
  /conversations/{id}/events:
    post:
      summary: Send a message/event to a conversation
      security: [{ bearerAuth: [] }]
      parameters:
        - name: id
          in: path
          required: true
          schema: { type: string }
      requestBody:
        required: true
        content:
          application/json:
            schema:
              type: object
              required: [type]
              properties:
                type: { type: string, enum: [message, file, rich_message, custom] }
                text: { type: string, maxLength: 10000 }
                visibility: { type: string, enum: [all, agents], default: all }
      responses:
        "200":
          description: Event created
          content:
            application/json:
              schema:
                type: object
                properties:
                  event_id: { type: string }
        "429":
          description: Rate limited
          headers:
            Retry-After: { schema: { type: integer } }
          content:
            application/json:
              schema: { $ref: "#/components/schemas/Error" }
components:
  securitySchemes:
    bearerAuth: { type: http, scheme: bearer, bearerFormat: JWT }
  schemas:
    Error:
      type: object
      properties:
        error:
          type: object
          properties:
            type: { type: string }
            code: { type: string }
            message: { type: string }
            request_id: { type: string }
```

### 11.6 Scope/RBAC modeli

`[TAHMİN/ÖNERİ]` Orijinalin `resource--access:permission` desenini koruyun (ör. `conversations--all:rw`, `reports:ro`) — geliştiricilerin zihinsel modelini basitleştirir ve marketplace-app ekosistemi kurulacaksa üçüncü parti geliştiriciler için tanıdık olur.

---

## 12. Kapsam Özeti & Bilinen Boşluklar

**Tam dokümante edilmiş, birebir endpoint/JSON ile:** Agent Chat API (Web + RTM), Customer Chat API (Web + RTM), Configuration API, Reports API (v3 + eski v2), Billing API, HelpDesk API, ChatBot API (alanlar), OAuth akışları + endpoint'ler + tam scope listesi (63 scope, doğrudan sayfa taramasıyla doğrulandı) + oturum yönetimi, PAT/agent/customer/bot token'ları, webhook kayıt/event/teslim/retry (doğrudan sayfa taramasıyla `requester` bloğu dahil genişletildi), rate limit'ler, hata taksonomisi, tüm temel veri-obje alan isimleri (Cart/Address/CustomerProperty dahil genişletildi).

**Boşluklar (denenip engellenenler):**
1. **Global Accounts API & Customer Accounts API tam endpoint tabloları** — sayfalar istemci-taraflı ReDoc SPA (`%%REDOC_SSR%%`); JS-çalıştıran tarayıcı veya ham OpenAPI JSON gerekiyor. Kavramlar, host ve `/v2/*` temel yollar doğrulandı.
2. **Sayısal REST rate limitleri & `Retry-After`** — hiçbir yerde yayınlanmamış; yalnızca niteliksel davranış + RTM eşzamanlılık limitleri dokümante.
3. **Hata `type` → HTTP-status eşleme tablosu** — ayrı `error-handling` sayfası 404 döndürdü; zarf ve tam `type` listesi RTM referansından kurtarıldı, HTTP kod eşlemesi `[TAHMİN]` olarak işaretlendi.
4. **Webhook başına `additional_data` değer string'leri** — yalnızca mekanizma/konteyner tipi doğrulandı (SDK'dan); kesin string'ler canlı `list_webhook_names` yanıtında yaşıyor.
5. **Mesaj kuyruğu / önbellek teknolojisi** (Kafka/Redis) — erişilebilir kaynaklarca doğrulanmamış.

---

*Bu doküman `/root/text_analysis/research/01-api-developer-platform.md`'nin genişletilmiş, düzenli referans-kılavuz versiyonudur. Mimari/klon-kod bağlamı için bkz. `/root/text_analysis/02-teknik-mimari.md`.*
