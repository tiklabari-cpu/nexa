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
import { WidgetApi, type WidgetEvent } from './api.js';

const LAUNCHER_SIZE = 84;
const PANEL = { width: 380, height: 620 } as const;
const POLL_INTERVAL_MS = 4_000;

interface WidgetConfig {
  organizationId: string;
  apiBaseUrl: string;
  language: string;
}

interface State {
  open: boolean;
  connected: boolean;
  online: boolean;
  chatId: string | null;
  queuePosition: number | null;
  events: WidgetEvent[];
  error: string | null;
  sending: boolean;
}

export function mount(doc: Document = document, win: Window = window): void {
  const root = doc.getElementById('nexa-widget-root');
  if (!root) return;

  const config = readConfig(win);
  const api = new WidgetApi(config.apiBaseUrl, config.organizationId);

  const state: State = {
    open: false,
    connected: false,
    online: false,
    chatId: null,
    queuePosition: null,
    events: [],
    error: null,
    sending: false,
  };

  const ui = buildUi(doc);
  root.append(ui.panel, ui.launcher);

  // --- Rendering -----------------------------------------------------------

  let renderedCount = 0;

  function renderEvents(): void {
    // Append only what is new: rebuilding the list would lose scroll position
    // and restart CSS animations on messages already on screen.
    for (const event of state.events.slice(renderedCount)) {
      ui.transcript.append(renderBubble(doc, event));
    }
    renderedCount = state.events.length;
    ui.transcript.scrollTop = ui.transcript.scrollHeight;
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
      state.error = null;
      renderEvents();
      renderStatus();
      startPolling();
    } catch (error) {
      state.error = 'Chat is unavailable right now. Please try again shortly.';
      renderStatus();
      // The real reason goes nowhere near the visitor.
      console.warn('nexa widget: connect failed', error);
    }
  }

  async function send(): Promise<void> {
    const text = ui.input.value.trim();
    if (!text || state.sending) return;

    state.sending = true;
    ui.send.disabled = true;
    ui.input.value = '';

    // Optimistic: the message appears immediately, because a visitor who sees
    // nothing happen presses enter again.
    const optimistic: WidgetEvent = {
      id: `pending-${Date.now()}`,
      text,
      author_type: 'customer',
      created_at: new Date().toISOString(),
      type: 'message',
    };
    state.events.push(optimistic);
    renderEvents();

    try {
      const result = await api.send(text, { url: hostPageUrl(win) });
      state.chatId = result.chat_id;
      state.error = null;
      await refresh();
    } catch (error) {
      state.error = 'Message not sent. Check your connection and try again.';
      // Put the text back so it is not lost.
      ui.input.value = text;
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
      renderedCount = 0;
      ui.transcript.replaceChildren();
      renderEvents();
      renderStatus();
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
  form: HTMLFormElement;
  input: HTMLTextAreaElement;
  send: HTMLButtonElement;
  close: HTMLButtonElement;
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
  const title = doc.createElement('h1');
  title.className = 'nx-title';
  title.textContent = 'Chat with us';
  const close = doc.createElement('button');
  close.type = 'button';
  close.className = 'nx-close';
  close.setAttribute('aria-label', 'Close chat');
  close.textContent = '×';
  header.append(title, close);

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

  const form = doc.createElement('form');
  form.className = 'nx-form';

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

  form.append(input, send);
  panel.append(header, transcript, status, form);

  return { launcher, panel, transcript, status, form, input, send, close };
}

function renderBubble(doc: Document, event: WidgetEvent): HTMLElement {
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
  bubble.textContent = event.text ?? '';

  const time = doc.createElement('time');
  time.className = 'nx-time';
  time.dateTime = event.created_at;
  time.textContent = formatTime(event.created_at);

  row.append(bubble, time);
  return row;
}

function formatTime(iso: string): string {
  const date = new Date(iso);
  return Number.isNaN(date.getTime())
    ? ''
    : date.toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' });
}

function readConfig(win: Window): WidgetConfig {
  const params = new URLSearchParams(win.location.search);
  return {
    organizationId: params.get('organization_id') ?? '',
    // Same origin as the widget document by default; overridable for local dev.
    apiBaseUrl: params.get('api') ?? 'http://localhost:4000/api/v1',
    language: params.get('language') ?? 'en',
  };
}

/** The page the widget is embedded in, when the host shared it. */
function hostPageUrl(win: Window): string | undefined {
  const referrer = win.document.referrer;
  return referrer || undefined;
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
:focus-visible { outline: 2px solid var(--nx-brand); outline-offset: 2px; }
@media (prefers-reduced-motion: reduce) { * { transition: none !important; animation: none !important; } }
`;

if (typeof document !== 'undefined' && document.getElementById('nexa-widget-root')) {
  mount();
}
