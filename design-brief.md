# Nexa — Design Brief

> Referans ekranlar (`gorseller/`, `images/`) **ilham** kaynağıdır, kopyalanmaz.
> İki ürün (text.com + livechat.com) PRD §8.1'deki tek IA altında birleştirilir.
> Hedef: profesyonel, yoğun-bilgi taşıyabilen, WCAG 2.1 AA erişilebilir bir operatör arayüzü.

---

## 1. Tasarım İlkeleri

1. **Yoğunluk okunabilirlikten ödün vermez.** Ajan günde yüzlerce sohbet görür; satır yüksekliği kompakt, tipografi net.
2. **Durum asla yalnız renkle anlatılmaz** (NFR-A11Y2). Online/offline/queued → ikon + metin + renk.
3. **Sessiz kabuk, konuşan içerik.** Kabuk (rail/sidebar/topbar) nötr; renk yalnız durum, aksiyon ve veri için.
4. **Tek aksiyon rengi.** Birincil mavi yalnızca ana eylemde; her yerde mavi = hiçbir yerde mavi.
5. **Her boş durum bir sonraki adımı söyler.** "Boş dikdörtgen" yasak (rapor-1 iyileştirmesi).
6. **Klavye birinci sınıf.** Sürükle-bırak varsa klavye alternatifi zorunlu (NFR-A11Y4).

---

## 2. Renk Token'ları

Renkler OKLCH tabanlı üretildi; hem light hem dark için AA kontrast doğrulandı.
CSS değişkenleri `:root` (light) ve `.dark` altında tanımlanır; Tailwind bunları `hsl(var(--x))` yerine doğrudan `var(--x)` ile tüketir.

### 2.1 Semantik yüzeyler

| Token             | Light     | Dark      | Kullanım                            |
| ----------------- | --------- | --------- | ----------------------------------- |
| `--bg-canvas`     | `#F7F8FA` | `#0B1020` | Uygulama zemini                     |
| `--bg-surface`    | `#FFFFFF` | `#121829` | Kart / panel / liste                |
| `--bg-surface-2`  | `#F1F3F7` | `#1A2136` | İç içe yüzey, hover zemin           |
| `--bg-rail`       | `#111726` | `#080C18` | Sol ikon rayı (her iki temada koyu) |
| `--bg-inset`      | `#E9ECF2` | `#0E1424` | Input zemini, kod bloğu             |
| `--border`        | `#DDE1E9` | `#232C44` | Varsayılan kenarlık                 |
| `--border-strong` | `#C3C9D6` | `#313C58` | Vurgulu kenarlık, ayraç             |

### 2.2 Metin

| Token              | Light     | Dark      | Kontrast     |
| ------------------ | --------- | --------- | ------------ |
| `--text-primary`   | `#111726` | `#EDF0F6` | ≥ 13:1       |
| `--text-secondary` | `#4A5468` | `#A6B0C4` | ≥ 4.9:1 (AA) |
| `--text-tertiary`  | `#6B7488` | `#7C879E` | ≥ 4.5:1 (AA) |
| `--text-inverse`   | `#FFFFFF` | `#0B1020` | —            |

> `--text-tertiary` AA sınırında tutuldu — bilinçli: NFR-A11Y3 "ikincil gri metin AA kontrast".

### 2.3 Marka & aksiyon

| Token          | Değer     | Kullanım                                           |
| -------------- | --------- | -------------------------------------------------- |
| `--brand-500`  | `#2F6BFF` | Birincil aksiyon, aktif nav, giden mesaj balonu    |
| `--brand-600`  | `#1F52D8` | Hover                                              |
| `--brand-700`  | `#1740AC` | Active/pressed                                     |
| `--brand-100`  | `#E4ECFF` | Light tint zemin (badge, seçili satır)             |
| `--brand-950`  | `#0F1E42` | Dark tint zemin                                    |
| `--focus-ring` | `#7AA2FF` | Odak halkası — 2px, 2px offset, her temada görünür |

### 2.4 Durum (status)

| Token       | Değer                      | Anlam                                       | Eşlik eden ikon |
| ----------- | -------------------------- | ------------------------------------------- | --------------- |
| `--success` | `#12855A` / dark `#3DD68C` | accepting_chats, connected, solved          | ● dolu daire    |
| `--warning` | `#A66200` / dark `#F5B14C` | queued, trial bitiyor, not_accepting        | ◐ yarım daire   |
| `--danger`  | `#C42A2A` / dark `#FF6B6B` | error, suspended, banned, offline           | ○ boş daire     |
| `--info`    | `#0B6E99` / dark `#4FC3F7` | system message, bilgi banner                | ⓘ               |
| `--ai`      | `#7C3AED` / dark `#B392F7` | AI Agent / Copilot ayrımı                   | ✦               |
| `--note`    | `#B4740A` / dark `#FFCE73` | Internal note (amber zemin — FR-MOD-02.3.4) |

### 2.5 Sohbet balonları

| Token                    | Light                          | Dark             |
| ------------------------ | ------------------------------ | ---------------- |
| `--bubble-agent-bg`      | `--brand-500`                  | `--brand-500`    |
| `--bubble-agent-text`    | `#FFFFFF`                      | `#FFFFFF`        |
| `--bubble-customer-bg`   | `#EFF1F5`                      | `#1E2740`        |
| `--bubble-customer-text` | `--text-primary`               | `--text-primary` |
| `--bubble-note-bg`       | `#FFF6E5`                      | `#2E2210`        |
| `--bubble-system-bg`     | transparent + `--border` çizgi | aynı             |
| `--bubble-ai-bg`         | `#F3EDFF`                      | `#241A3D`        |

---

## 3. Tipografi

**Aile:** `Inter var` (UI) → fallback `-apple-system, "Segoe UI", system-ui, sans-serif`
**Mono:** `"JetBrains Mono", ui-monospace, SFMono-Regular, monospace` (Chat ID, API token, kod)

| Token         | Boyut / satır | Ağırlık | Kullanım                                        |
| ------------- | ------------- | ------- | ----------------------------------------------- |
| `--text-2xs`  | 11 / 16       | 500     | Zaman damgası, meta, sayaç rozeti               |
| `--text-xs`   | 12 / 18       | 500     | Tablo başlığı, etiket, yardım metni             |
| `--text-sm`   | 13 / 20       | 400     | **Gövde varsayılanı** — liste, transcript, form |
| `--text-base` | 15 / 24       | 400     | Uzun okuma, boş durum açıklaması                |
| `--text-lg`   | 17 / 26       | 600     | Panel başlığı                                   |
| `--text-xl`   | 20 / 28       | 600     | Sayfa başlığı                                   |
| `--text-2xl`  | 26 / 34       | 700     | KPI rakamı, modal başlığı                       |
| `--text-3xl`  | 34 / 42       | 700     | Rapor büyük metrik                              |

**Kurallar:** Sayısal veri (KPI, sayaç, süre) `font-variant-numeric: tabular-nums`. Başlıklarda `letter-spacing: -0.01em`. Gövde metni asla 400'ün altında ağırlık almaz.

---

## 4. Spacing & Layout

**Ölçek (4px tabanlı):** `0 · 1=4 · 2=8 · 3=12 · 4=16 · 5=20 · 6=24 · 8=32 · 10=40 · 12=48 · 16=64`

### Kabuk ölçüleri

| Bölge                    | Genişlik / yükseklik                               |
| ------------------------ | -------------------------------------------------- |
| Icon rail                | `56px` sabit                                       |
| Module sidebar           | `240px` (daraltılabilir → `0`)                     |
| Chat list (orta-sol)     | `320px` min, `380px` varsayılan, resize edilebilir |
| Transcript               | `1fr` (esner)                                      |
| Details / Copilot paneli | `320px` (kapatılabilir)                            |
| TopBar                   | `48px`                                             |
| Composer min             | `88px`, max `40vh`                                 |
| Liste satırı (chat)      | `64px`                                             |
| Tablo satırı             | `44px`                                             |

**Breakpoint'ler:** `sm 640 · md 768 · lg 1024 · xl 1280 · 2xl 1536`

- `< lg`: Details paneli overlay'e döner
- `< md`: 3-pane → tek pane + geri navigasyonu (liste ↔ transcript)

---

## 5. Radius, Shadow, Motion

| Token           | Değer                                |
| --------------- | ------------------------------------ |
| `--radius-sm`   | `4px` — badge, tag, input            |
| `--radius-md`   | `8px` — buton, kart, liste satırı    |
| `--radius-lg`   | `12px` — panel, modal, sohbet balonu |
| `--radius-full` | `9999px` — avatar, pill, toggle      |

| Token            | Değer                                                      |
| ---------------- | ---------------------------------------------------------- |
| `--shadow-xs`    | `0 1px 2px rgb(16 24 40 / .06)`                            |
| `--shadow-sm`    | `0 2px 6px rgb(16 24 40 / .08)` — dropdown                 |
| `--shadow-md`    | `0 8px 24px rgb(16 24 40 / .12)` — popover, modal          |
| `--shadow-focus` | `0 0 0 2px var(--bg-surface), 0 0 0 4px var(--focus-ring)` |

> Dark temada shadow yerine `--border-strong` kenarlık ağır basar (gölge koyu zeminde görünmez).

| Motion                   | Süre / easing                          |
| ------------------------ | -------------------------------------- |
| Hover / renk             | `120ms ease-out`                       |
| Panel aç/kapa            | `200ms cubic-bezier(.2,.8,.2,1)`       |
| Modal giriş              | `180ms ease-out` + `scale(.98→1)`      |
| Yeni mesaj girişi        | `160ms ease-out` + `translateY(4px→0)` |
| `prefers-reduced-motion` | Tüm süreler `0ms`, yalnız opacity      |

---

## 6. Bileşen Envanteri

### 6.1 Primitifler (shadcn/ui tabanı — Radix)

`Button` (primary/secondary/ghost/danger · sm/md/lg · icon-only) · `Input` · `Textarea` · `Select` · `Combobox` · `Checkbox` · `Radio` · `Switch` · `Slider` · `Tooltip` · `Popover` · `DropdownMenu` · `Dialog` · `Sheet` (sağ panel) · `Tabs` · `Accordion` · `Badge` · `Avatar` (+ `AvatarGroup` presence halkalı) · `Separator` · `ScrollArea` · `Skeleton` · `Toast` · `Progress` · `Command` (⌘K)

### 6.2 Uygulama bileşenleri

| Bileşen               | Notlar                                                                                               |
| --------------------- | ---------------------------------------------------------------------------------------------------- |
| `AppShell`            | IconRail + ModuleSidebar + Outlet + RightPanel; panel durumu persist                                 |
| `IconRail`            | 56px; aktif göstergesi sol 2px bar + dolu ikon; trial rozeti altta                                   |
| `ModuleSidebar`       | Katlanır gruplar + canlı sayaç rozetleri                                                             |
| `TopBar`              | ⌘K arama · presence avatar grubu · trial pill · davet · hesap menüsü                                 |
| `ChatListItem`        | 64px; avatar+presence · isim · son mesaj önizleme · zaman · unread nokta · typing "…"                |
| `VirtualList`         | 10k+ satır 60fps (NFR-P4)                                                                            |
| `Transcript`          | Reverse infinite scroll · gün ayracı · skeleton · "yeni mesaj" atlama düğmesi                        |
| `MessageBubble`       | agent / customer / bot(AI) / system / internal-note varyantları; teslim durumu ✓/✓✓                  |
| `Composer`            | Reply ↔ Internal note (amber zemin) · `#` canned · emoji · attach · Enter gönder / Shift+Enter satır |
| `DetailsPanel`        | Katlanır bölümler: Chat info · Tags · Visited pages · Visit info · Assignee                          |
| `StatusDot`           | renk + ikon + `aria-label` (asla yalnız renk)                                                        |
| `EmptyState`          | ikon + başlık + tek cümle + birincil CTA                                                             |
| `ErrorState`          | neden + tekrar dene + destek linki                                                                   |
| `KpiCard`             | rakam (tabular-nums) + delta + sparkline + düşük-baz uyarısı                                         |
| `DataTable`           | sıralanabilir başlık · sticky header · satır seçimi · boş/yükleniyor durumu                          |
| `TagInput`            | çoklu etiket + otomatik tamamlama                                                                    |
| `RoutingStatusSwitch` | accepting / not accepting / offline                                                                  |

### 6.3 Widget (müşteri tarafı — ayrı bundle)

`WidgetLauncher` (balon + unread rozet) · `WidgetWindow` · `WidgetHeader` (persona: ad, avatar, "typing…") · `WidgetTranscript` · `WidgetComposer` · `PreChatForm` · `OfflineNotice` · `RatingPrompt` (good/bad)

**Widget kısıtları:** < 50KB gzip (NFR-P3) · cross-origin iframe · ana sayfa CSS'ini etkilemez · tüm kullanıcı içeriği escape edilir (asla `innerHTML`).

---

## 7. Erişilebilirlik Checklist (her ekran için)

- [ ] Tüm etkileşim klavyeyle erişilebilir; tab sırası mantıklı
- [ ] `:focus-visible` halkası her temada görünür (`--shadow-focus`)
- [ ] İkon-only butonlarda `aria-label`
- [ ] Durum renkle + metin/ikonla birlikte
- [ ] Liste/nav'da `role`, `aria-current`
- [ ] Transcript `role="log"` + `aria-live="polite"` (yeni mesaj duyurusu)
- [ ] Modal focus trap + `Esc` kapatma + açılış öncesi odak geri dönüşü
- [ ] Dokunma hedefi ≥ 24×24 CSS px (2.5.8)
- [ ] `prefers-reduced-motion` desteklenir
- [ ] Kontrast: gövde ≥ 4.5:1, büyük metin ≥ 3:1, UI kenarlık ≥ 3:1

---

## 8. Uygulama

Token'lar `packages/ui/src/tokens.css` içinde CSS custom property olarak yaşar; `tailwind.config.ts` bunları semantik isimlerle (`bg-surface`, `text-secondary`, `border-strong`) haritalar. Ham hex değeri bileşen kodunda **kullanılmaz** — yalnız token.
