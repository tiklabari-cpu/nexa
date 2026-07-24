/**
 * Widget document — runs inside the sandboxed iframe.
 *
 * Written against the DOM directly rather than with a framework: the whole
 * artifact has a 50 KB budget (NFR-P3) and React alone is three times that.
 *
 * Hard rule throughout: every piece of customer- or agent-authored text is set
 * with `textContent`. Never `innerHTML` — the eslint config bans it outright
 * rather than relying on anyone remembering (NFR-S6).
 */
import { WidgetApi, type WidgetEvent, type WidgetState } from './api.js';

const LAUNCHER_SIZE = 84;
const PANEL = { width: 380, height: 620 } as const;
const POLL_INTERVAL_MS = 4_000;

interface WidgetConfig {
  organizationId: string;
  apiBaseUrl: string;
  language: string;
  /** Origin of the embedding page, supplied by the loader. */
  hostOrigin: string | null;
}

interface State {
  open: boolean;
  connected: boolean;
  online: boolean;
  chatId: string | null;
  queuePosition: number | null;
  events: WidgetEvent[];
  /** Who the visitor is talking to, shown in the header (FR-MOD-11.3). */
  agent: { name: string; avatarUrl: string | null } | null;
  error: string | null;
  sending: boolean;
  /** A file the visitor picked and we uploaded, waiting to be sent. */
  pendingAttachment: { fileUrl: string; name: string } | null;
  uploading: boolean;
}

export function mount(doc: Document = document, win: Window = window): void {
  const root = doc.getElementById('nexa-widget-root');
  if (!root) return;

  const config = readConfig(win);
  const api = new WidgetApi(config.apiBaseUrl, config.organizationId, config.hostOrigin);

  const state: State = {
    open: false,
    connected: false,
    online: false,
    chatId: null,
    queuePosition: null,
    events: [],
    agent: null,
    error: null,
    sending: false,
    pendingAttachment: null,
    uploading: false,
  };

  const ui = buildUi(doc);
  root.append(ui.panel, ui.launcher);

  // --- Rendering -----------------------------------------------------------

  let renderedCount = 0;
  // attachment_url → object URL. `refresh` rebuilds the transcript every few
  // seconds; without this each rebuild would re-fetch every image's bytes and
  // flash it blank while the new blob loads. Keyed by the stable url, so a
  // re-render reuses the blob it already has.
  const attachmentCache = new Map<string, string>();

  function renderEvents(): void {
    // Append only what is new: rebuilding the list would lose scroll position
    // and restart CSS animations on messages already on screen.
    for (const event of state.events.slice(renderedCount)) {
      ui.transcript.append(renderBubble(doc, event, api, attachmentCache));
    }
    renderedCount = state.events.length;
    ui.transcript.scrollTop = ui.transcript.scrollHeight;
  }

  /**
   * The header names who the visitor is talking to (FR-MOD-11.3): the AI persona
   * or, once a person takes over, that agent. An avatar when there is one, the
   * initial otherwise — `textContent` throughout so a name can never be markup.
   */
  function renderHeader(): void {
    const agent = state.agent;
    ui.title.textContent = agent?.name ?? 'Chat with us';
    ui.avatar.replaceChildren();
    ui.avatar.hidden = agent === null;
    if (!agent) return;

    if (agent.avatarUrl) {
      const img = doc.createElement('img');
      img.className = 'nx-avatar-img';
      img.alt = '';
      img.src = agent.avatarUrl;
      ui.avatar.append(img);
    } else {
      ui.avatar.textContent = initial(agent.name);
    }
  }

  function renderStatus(): void {
    if (state.error) {
      ui.status.textContent = state.error;
      ui.status.dataset['tone'] = 'error';
      return;
    }
    if (state.queuePosition !== null && state.queuePosition > 0) {
      ui.status.textContent = `You are number ${state.queuePosition} in the queue`;
      ui.status.dataset['tone'] = 'wait';
      return;
    }
    if (!state.online) {
      // Honest rather than encouraging: nobody is there, and pretending
      // otherwise turns a short wait into an abandoned conversation.
      ui.status.textContent = 'No one is available right now — leave a message and we will reply.';
      ui.status.dataset['tone'] = 'wait';
      return;
    }
    ui.status.textContent = '';
    ui.status.dataset['tone'] = 'ok';
  }

  function setOpen(open: boolean): void {
    state.open = open;
    ui.panel.hidden = !open;
    // The launcher sits in the same corner as the panel's composer. Left
    // visible it covers the Send button and swallows the click — the panel
    // looks fine and simply will not send. The panel's own × is the close
    // affordance once it is open.
    ui.launcher.hidden = open;
    ui.launcher.setAttribute('aria-expanded', String(open));
    ui.launcher.setAttribute('aria-label', open ? 'Close chat' : 'Open chat');

    // The frame is only as large as it needs to be: a full-size transparent
    // iframe would swallow clicks on the host page while the widget is closed.
    postToHost(win, {
      type: 'nexa:resize',
      width: open ? PANEL.width : LAUNCHER_SIZE,
      height: open ? PANEL.height : LAUNCHER_SIZE,
    });
    postToHost(win, { type: open ? 'nexa:open' : 'nexa:close' });

    if (open) {
      ui.input.focus();
      void connect();
    }
  }

  // --- Data ----------------------------------------------------------------

  async function connect(): Promise<void> {
    if (state.connected) return;
    try {
      const snapshot = await api.connect();
      state.connected = true;
      state.online = snapshot.online;
      state.chatId = snapshot.chat?.id ?? null;
      state.queuePosition = snapshot.chat?.queue_position ?? null;
      state.events = snapshot.events;
      state.agent = toAgent(snapshot.agent);
      state.error = null;
      renderEvents();
      renderStatus();
      renderHeader();
      startPolling();
    } catch (error) {
      state.error = 'Chat is unavailable right now. Please try again shortly.';
      renderStatus();
      // The real reason goes nowhere near the visitor.
      console.warn('nexa widget: connect failed', error);
    }
  }

  async function onPickFile(): Promise<void> {
    const file = ui.file.files?.[0];
    ui.file.value = ''; // allow re-picking the same file
    if (!file || state.uploading) return;

    // Uploading needs a token; opening the panel already started `connect`, but
    // a fast click can beat it, so make sure of it first.
    if (!api.authenticated) await connect();

    state.uploading = true;
    ui.attach.disabled = true;
    try {
      const fileUrl = await api.upload(file);
      state.pendingAttachment = { fileUrl, name: file.name };
      state.error = null;
      renderChip();
    } catch (error) {
      // The licence's file-sharing rules live on the server; a refusal (wrong
      // type, too large) surfaces here rather than being guessed at.
      state.error = 'That file could not be attached.';
      renderStatus();
      console.warn('nexa widget: upload failed', error);
    } finally {
      state.uploading = false;
      ui.attach.disabled = false;
    }
  }

  function renderChip(): void {
    const chip = state.pendingAttachment;
    ui.chip.replaceChildren();
    ui.chip.hidden = chip === null;
    if (!chip) return;

    const name = doc.createElement('span');
    name.className = 'nx-chip-name';
    name.textContent = chip.name;
    const remove = doc.createElement('button');
    remove.type = 'button';
    remove.className = 'nx-chip-x';
    remove.setAttribute('aria-label', 'Remove attachment');
    remove.textContent = '×';
    remove.addEventListener('click', () => {
      state.pendingAttachment = null;
      renderChip();
    });
    ui.chip.append(name, remove);
  }

  async function send(): Promise<void> {
    const text = ui.input.value.trim();
    const attachment = state.pendingAttachment;
    if ((!text && !attachment) || state.sending) return;

    state.sending = true;
    ui.send.disabled = true;
    ui.input.value = '';

    // Optimistic: the message appears immediately, because a visitor who sees
    // nothing happen presses enter again.
    const optimistic: WidgetEvent = {
      id: `pending-${Date.now()}`,
      text: text || null,
      author_type: 'customer',
      created_at: new Date().toISOString(),
      type: 'message',
      attachment_url: attachment?.fileUrl ?? null,
    };
    state.events.push(optimistic);
    renderEvents();
    state.pendingAttachment = null;
    renderChip();

    try {
      const result = await api.send(text, {
        url: hostPageUrl(win),
        ...(attachment ? { attachment_url: attachment.fileUrl } : {}),
      });
      state.chatId = result.chat_id;
      state.error = null;
      await refresh();
    } catch (error) {
      state.error = 'Message not sent. Check your connection and try again.';
      // Put the text and attachment back so neither is lost.
      ui.input.value = text;
      state.pendingAttachment = attachment;
      renderChip();
      state.events = state.events.filter((e) => e.id !== optimistic.id);
      renderedCount = 0;
      ui.transcript.replaceChildren();
      renderEvents();
      renderStatus();
      console.warn('nexa widget: send failed', error);
    } finally {
      state.sending = false;
      ui.send.disabled = false;
      ui.input.focus();
    }
  }

  async function refresh(): Promise<void> {
    if (!state.connected) return;
    try {
      const snapshot = await api.state();
      state.online = snapshot.online;
      state.chatId = snapshot.chat?.id ?? null;
      state.queuePosition = snapshot.chat?.queue_position ?? null;

      // Replace wholesale: the server's view is authoritative and includes the
      // real ids for anything sent optimistically.
      state.events = snapshot.events;
      state.agent = toAgent(snapshot.agent);
      renderedCount = 0;
      ui.transcript.replaceChildren();
      renderEvents();
      renderStatus();
      renderHeader();
    } catch (error) {
      console.warn('nexa widget: refresh failed', error);
    }
  }

  /**
   * Polling rather than a socket, deliberately.
   *
   * The RTM gateway exists and the widget could use it, but a customer-side
   * socket is one more thing to keep alive across sleeping laptops and flaky
   * mobile networks for a conversation that lasts minutes. Four-second polling
   * is indistinguishable to the visitor and cannot silently die.
   */
  let pollTimer: ReturnType<typeof setInterval> | null = null;

  function startPolling(): void {
    if (pollTimer !== null) return;
    pollTimer = setInterval(() => {
      if (state.open && !doc.hidden) void refresh();
    }, POLL_INTERVAL_MS);
  }

  // --- Wiring --------------------------------------------------------------

  ui.launcher.addEventListener('click', () => setOpen(!state.open));
  ui.close.addEventListener('click', () => {
    setOpen(false);
    ui.launcher.focus();
  });
  ui.form.addEventListener('submit', (event) => {
    event.preventDefault();
    void send();
  });
  ui.attach.addEventListener('click', () => ui.file.click());
  ui.file.addEventListener('change', () => void onPickFile());
  ui.input.addEventListener('keydown', (event) => {
    // Enter sends, Shift+Enter breaks the line — the convention every chat uses.
    if (event.key === 'Enter' && !event.shiftKey) {
      event.preventDefault();
      void send();
    }
  });

  doc.addEventListener('keydown', (event) => {
    if (event.key === 'Escape' && state.open) {
      setOpen(false);
      ui.launcher.focus();
    }
  });

  win.addEventListener('message', (event: MessageEvent) => {
    // The host page is cross-origin and untrusted: accept only the two commands
    // it may issue, and ignore anything else without replying.
    const data = event.data as { type?: unknown };
    if (data?.type === 'nexa:host-open') setOpen(true);
    if (data?.type === 'nexa:host-close') setOpen(false);
  });

  postToHost(win, { type: 'nexa:ready' });
}

// ---------------------------------------------------------------------------

interface Ui {
  launcher: HTMLButtonElement;
  panel: HTMLElement;
  transcript: HTMLElement;
  status: HTMLElement;
  chip: HTMLElement;
  form: HTMLFormElement;
  input: HTMLTextAreaElement;
  attach: HTMLButtonElement;
  file: HTMLInputElement;
  send: HTMLButtonElement;
  close: HTMLButtonElement;
  avatar: HTMLElement;
  title: HTMLElement;
}

function buildUi(doc: Document): Ui {
  const style = doc.createElement('style');
  // Inline so the widget is one request and cannot be left half-styled if a
  // stylesheet fails to load.
  style.textContent = WIDGET_CSS;
  doc.head.append(style);

  const launcher = doc.createElement('button');
  launcher.type = 'button';
  launcher.className = 'nx-launcher';
  launcher.setAttribute('aria-expanded', 'false');
  launcher.setAttribute('aria-label', 'Open chat');
  launcher.textContent = 'Chat';

  const panel = doc.createElement('section');
  panel.className = 'nx-panel';
  panel.hidden = true;
  panel.setAttribute('aria-label', 'Customer support chat');

  const header = doc.createElement('header');
  header.className = 'nx-header';
  const identity = doc.createElement('div');
  identity.className = 'nx-identity';
  const avatar = doc.createElement('span');
  avatar.className = 'nx-avatar';
  avatar.setAttribute('aria-hidden', 'true');
  avatar.hidden = true;
  const title = doc.createElement('h1');
  title.className = 'nx-title';
  title.textContent = 'Chat with us';
  identity.append(avatar, title);
  const close = doc.createElement('button');
  close.type = 'button';
  close.className = 'nx-close';
  close.setAttribute('aria-label', 'Close chat');
  close.textContent = '×';
  header.append(identity, close);

  const transcript = doc.createElement('div');
  transcript.className = 'nx-transcript';
  // Announced politely so a screen reader user hears replies without losing
  // their place (design-brief §7).
  transcript.setAttribute('role', 'log');
  transcript.setAttribute('aria-live', 'polite');
  transcript.setAttribute('aria-label', 'Conversation');

  const status = doc.createElement('p');
  status.className = 'nx-status';
  status.setAttribute('role', 'status');

  // Shows the picked file before it is sent; hidden until there is one.
  const chip = doc.createElement('div');
  chip.className = 'nx-chip';
  chip.hidden = true;

  const form = doc.createElement('form');
  form.className = 'nx-form';

  const attach = doc.createElement('button');
  attach.type = 'button';
  attach.className = 'nx-attach';
  attach.setAttribute('aria-label', 'Attach a file');
  // A paperclip glyph rather than an SVG, to stay inside the 50 KB budget.
  attach.textContent = '📎';

  const file = doc.createElement('input');
  file.type = 'file';
  file.className = 'nx-file';
  file.accept = 'image/*,application/pdf';
  file.hidden = true;
  file.setAttribute('aria-hidden', 'true');
  file.tabIndex = -1;

  const input = doc.createElement('textarea');
  input.className = 'nx-input';
  input.rows = 2;
  input.placeholder = 'Type your message…';
  input.setAttribute('aria-label', 'Message');
  input.maxLength = 10_000;

  const send = doc.createElement('button');
  send.type = 'submit';
  send.className = 'nx-send';
  send.textContent = 'Send';

  form.append(attach, file, input, send);
  panel.append(header, transcript, status, chip, form);

  return {
    launcher,
    panel,
    transcript,
    status,
    chip,
    form,
    input,
    attach,
    file,
    send,
    close,
    avatar,
    title,
  };
}

function renderBubble(
  doc: Document,
  event: WidgetEvent,
  api: WidgetApi,
  cache: Map<string, string>,
): HTMLElement {
  const row = doc.createElement('div');
  row.className = `nx-row nx-row--${event.author_type}`;

  if (event.type === 'system_message') {
    const notice = doc.createElement('p');
    notice.className = 'nx-system';
    notice.textContent = event.text ?? '';
    row.append(notice);
    return row;
  }

  const bubble = doc.createElement('div');
  bubble.className = 'nx-bubble';
  // textContent, never innerHTML — this is the one place agent- and
  // customer-authored text meets the DOM.
  if (event.text) bubble.textContent = event.text;
  if (event.attachment_url) bubble.append(renderAttachment(doc, api, event.attachment_url, cache));

  const time = doc.createElement('time');
  time.className = 'nx-time';
  time.dateTime = event.created_at;
  time.textContent = formatTime(event.created_at);

  row.append(bubble, time);
  return row;
}

const IMAGE_URL = /\.(png|jpe?g|gif|webp)$/i;

/**
 * An attachment inside a bubble.
 *
 * The bytes are behind the customer token, so they are fetched with it and
 * shown from an object URL — a bare `<img src>` could not send the header.
 * Images preview inline; anything else becomes a download link, since rendering
 * an arbitrary type inside our own document is a needless risk.
 */
function renderAttachment(
  doc: Document,
  api: WidgetApi,
  url: string,
  cache: Map<string, string>,
): HTMLElement {
  const name = url.split('/').pop() ?? 'attachment';

  // Fetch the bytes once and remember the object URL, so a re-render sets the
  // src synchronously rather than fetching and flashing blank again.
  const objectUrl = (): Promise<string> => {
    const cached = cache.get(url);
    if (cached) return Promise.resolve(cached);
    return api.fetchAttachment(url).then((blob) => {
      const created = URL.createObjectURL(blob);
      cache.set(url, created);
      return created;
    });
  };

  if (IMAGE_URL.test(url)) {
    const img = doc.createElement('img');
    img.className = 'nx-attachment-img';
    img.alt = 'Attachment';
    const cached = cache.get(url);
    if (cached) {
      img.src = cached;
    } else {
      void objectUrl()
        .then((src) => {
          img.src = src;
        })
        .catch(() => {
          img.replaceWith(fileLink(doc, name, null));
        });
    }
    return img;
  }

  const link = fileLink(doc, name, null);
  void objectUrl()
    .then((src) => {
      link.href = src;
      link.setAttribute('download', name);
    })
    .catch(() => {
      /* leave the link inert; the visitor can retry by reopening */
    });
  return link;
}

function fileLink(doc: Document, name: string, href: string | null): HTMLAnchorElement {
  const link = doc.createElement('a');
  link.className = 'nx-attachment-file';
  link.textContent = `📎 ${name}`;
  if (href) link.href = href;
  return link;
}

function formatTime(iso: string): string {
  const date = new Date(iso);
  return Number.isNaN(date.getTime())
    ? ''
    : date.toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' });
}

/** Map the API's snake_case identity to the widget's shape. */
function toAgent(agent: WidgetState['agent']): { name: string; avatarUrl: string | null } | null {
  return agent ? { name: agent.name, avatarUrl: agent.avatar_url } : null;
}

/** First letter of a name, for an avatar with no image. */
function initial(name: string): string {
  return (name.trim()[0] ?? '?').toUpperCase();
}

function readConfig(win: Window): WidgetConfig {
  const params = new URLSearchParams(win.location.search);
  return {
    organizationId: params.get('organization_id') ?? '',
    // Same origin as the widget document by default; overridable for local dev.
    apiBaseUrl: params.get('api') ?? 'http://localhost:4000/api/v1',
    language: params.get('language') ?? 'en',
    // Falls back to the referrer, which is the embedding page when the loader
    // created this frame. Null when the widget document is opened directly.
    hostOrigin: params.get('host_origin') ?? referrerOrigin(win),
  };
}

/**
 * The page the widget is embedded in.
 *
 * `host_url` comes from the loader, which is the only code that can see it: a
 * cross-origin frame's `document.referrer` is trimmed to the origin by the
 * default referrer policy, so falling back to it yields the site rather than
 * the page. Kept as a fallback anyway — better the site than nothing.
 */
function hostPageUrl(win: Window): string | undefined {
  const fromLoader = new URLSearchParams(win.location.search).get('host_url');
  return fromLoader || win.document.referrer || undefined;
}

/** Origin part of the referrer, for when the loader did not pass one through. */
function referrerOrigin(win: Window): string | null {
  try {
    return win.document.referrer ? new URL(win.document.referrer).origin : null;
  } catch {
    return null;
  }
}

function postToHost(win: Window, message: Record<string, unknown>): void {
  // `'*'` is unavoidable: the sandboxed frame has an opaque origin and does not
  // know the embedding page's. Safe because these carry no conversation content
  // — only presentation hints the loader re-validates.
  win.parent?.postMessage(message, '*');
}

const WIDGET_CSS = `
:root {
  --nx-brand: #2f6bff;
  --nx-surface: #ffffff;
  --nx-text: #111726;
  --nx-muted: #4a5468;
  --nx-border: #dde1e9;
  --nx-customer: #eff1f5;
  --nx-radius: 12px;
  color-scheme: light;
}
@media (prefers-color-scheme: dark) {
  :root {
    --nx-surface: #121829;
    --nx-text: #edf0f6;
    --nx-muted: #a6b0c4;
    --nx-border: #232c44;
    --nx-customer: #1e2740;
    color-scheme: dark;
  }
}
* { box-sizing: border-box; }
body {
  margin: 0;
  font-family: Inter, -apple-system, "Segoe UI", system-ui, sans-serif;
  font-size: 13px;
  color: var(--nx-text);
}
.nx-launcher {
  position: fixed; right: 10px; bottom: 10px;
  width: 64px; height: 64px; border: 0; border-radius: 9999px;
  background: var(--nx-brand); color: #fff;
  font: inherit; font-weight: 600; cursor: pointer;
  box-shadow: 0 8px 24px rgb(16 24 40 / .24);
}
.nx-panel {
  position: fixed; inset: 8px;
  display: flex; flex-direction: column;
  background: var(--nx-surface);
  border: 1px solid var(--nx-border);
  border-radius: var(--nx-radius);
  overflow: hidden;
  box-shadow: 0 12px 32px rgb(16 24 40 / .18);
}
.nx-header {
  display: flex; align-items: center; justify-content: space-between;
  padding: 12px 14px; background: var(--nx-brand); color: #fff;
}
.nx-title { margin: 0; font-size: 15px; font-weight: 600; }
.nx-identity { display: flex; align-items: center; gap: 10px; min-width: 0; }
.nx-avatar {
  flex: none; width: 28px; height: 28px; border-radius: 50%;
  display: inline-flex; align-items: center; justify-content: center;
  background: rgba(255, 255, 255, .22); color: #fff;
  font-size: 13px; font-weight: 600; overflow: hidden;
}
.nx-avatar-img { width: 100%; height: 100%; object-fit: cover; }
.nx-close {
  border: 0; background: transparent; color: #fff;
  font-size: 22px; line-height: 1; cursor: pointer; padding: 0 4px;
}
.nx-transcript {
  flex: 1; overflow-y: auto; padding: 14px;
  display: flex; flex-direction: column; gap: 10px;
}
.nx-row { display: flex; flex-direction: column; max-width: 82%; }
.nx-row--customer { align-self: flex-end; align-items: flex-end; }
.nx-row--agent, .nx-row--bot { align-self: flex-start; }
.nx-row--system { align-self: center; max-width: 100%; }
.nx-bubble {
  padding: 8px 11px; border-radius: var(--nx-radius);
  background: var(--nx-customer); white-space: pre-wrap; word-break: break-word;
}
.nx-row--customer .nx-bubble { background: var(--nx-brand); color: #fff; }
.nx-system { margin: 0; font-size: 11px; color: var(--nx-muted); text-align: center; }
.nx-time { font-size: 11px; color: var(--nx-muted); margin-top: 2px; }
.nx-status { margin: 0; padding: 0 14px 8px; font-size: 12px; color: var(--nx-muted); }
.nx-status[data-tone="error"] { color: #c42a2a; }
.nx-form { display: flex; gap: 8px; padding: 10px 12px 12px; border-top: 1px solid var(--nx-border); }
.nx-input {
  flex: 1; resize: none; font: inherit; color: inherit;
  padding: 8px 10px; border-radius: 8px;
  border: 1px solid var(--nx-border); background: transparent;
}
.nx-send {
  border: 0; border-radius: 8px; padding: 0 14px;
  background: var(--nx-brand); color: #fff; font: inherit; font-weight: 600; cursor: pointer;
}
.nx-send:disabled { opacity: .6; cursor: default; }
.nx-attach {
  border: 1px solid var(--nx-border); border-radius: 8px; background: transparent;
  width: 38px; font-size: 16px; line-height: 1; cursor: pointer; color: inherit;
}
.nx-attach:disabled { opacity: .6; cursor: default; }
.nx-chip {
  display: flex; align-items: center; gap: 8px;
  margin: 0 12px 8px; padding: 6px 10px;
  border: 1px solid var(--nx-border); border-radius: 8px; font-size: 12px;
}
.nx-chip-name { flex: 1; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.nx-chip-x { border: 0; background: transparent; font-size: 16px; line-height: 1; cursor: pointer; color: var(--nx-muted); }
.nx-attachment-img { display: block; max-width: 100%; max-height: 220px; border-radius: 8px; margin-top: 4px; }
.nx-attachment-file { display: inline-block; margin-top: 4px; color: inherit; text-decoration: underline; word-break: break-all; }
.nx-row--customer .nx-attachment-file { color: #fff; }
:focus-visible { outline: 2px solid var(--nx-brand); outline-offset: 2px; }
@media (prefers-reduced-motion: reduce) { * { transition: none !important; animation: none !important; } }
`;

if (typeof document !== 'undefined' && document.getElementById('nexa-widget-root')) {
  mount();
}
