# Task ID: 35

**Title:** 08.5 — Omnichannel adaptörleri (MOCK)

**Status:** done

**Dependencies:** None

**Priority:** medium

**Description:** channels tablosu 0 tüketicili; MVP kanalları Website+email kullanıyor. PRD 08.5.4-.6 (v1, Must).

**Details:**

PARENT. 08.5 Omnichannel adaptörleri (MOCK). channels tablosu 0 tüketicili (§8); MVP kanalları
Website+email kullanıyor. adapter-a ortak arayüzü kurar, sonra 3 kanal. Bağlam: PLAN §4.4.4.

**Test Strategy:**

Subtask bazlı; kanal subtask'ları adapter-a'ya bağımlı.

## Subtasks

### 35.1. 08.5-adapter-a — Ortak kanal adaptör arayüzü + channels

**Status:** done  
**Dependencies:** None  

ChannelAdapter (inbound→chat, outbound→gönder); channels tablo tüketicisi. PRD 08.5.4-.6.

**Details:**

08.5-adapter-a Ortak kanal adaptör arayüzü + channels tablo tüketicisi. [XHIGH] PRD 08.5.4-.6.
KAPSAM: ChannelAdapter arayüzü (inbound→chat, outbound→gönder); channels tablosuna kayıt; mock provider iskeleti.
KK payı (birebir, ortak): "mesaj → inbox chat" / "mesaj → chat". BAĞLAM: PLAN §4.4.4.

### 35.2. 08.5.4-a — Messenger (OAuth MOCK)

**Status:** done  
**Dependencies:** 35.1  

Mock OAuth + inbound→chat + outbound. PRD 08.5.4.

**Details:**

08.5.4-a Messenger (Facebook OAuth MOCK). [XHIGH] PRD 08.5.4 (Must).
KAPSAM: mock OAuth + inbound webhook → chat + outbound gönder.
KK (birebir): "OAuth; mesaj → inbox chat". KAPSAM DIŞI: gerçek sağlayıcı imzası (§9). Bağımlılık: 35.1.

### 35.3. 08.5.5-a — Twilio SMS (MOCK)

**Status:** done  
**Dependencies:** 35.1  

Mock kimlik/numara + SMS gönder-al. PRD 08.5.5.

**Details:**

08.5.5-a Twilio SMS (MOCK). [XHIGH] PRD 08.5.5 (Must).
KAPSAM: mock kimlik/numara + inbound → chat + SMS gönder.
KK (birebir): "Twilio kimlik/numara; SMS gönder-al". Bağımlılık: 35.1.

### 35.4. 08.5.6-a — WhatsApp (MOCK)

**Status:** done  
**Dependencies:** 35.1  

Mock bağlama + mesaj→chat. PRD 08.5.6.

**Details:**

08.5.6-a WhatsApp (Business MOCK). [XHIGH] PRD 08.5.6 (Must).
KAPSAM: mock bağlama + inbound → chat + gönder.
KK (birebir): "WhatsApp bağlama; mesaj → chat". Bağımlılık: 35.1.
