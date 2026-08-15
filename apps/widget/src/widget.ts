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
import type { PreChatFormField, WidgetAppearance } from '@nexa/types';
import { WidgetApi, type TrackSaleInput, type WidgetEvent, type WidgetState } from './api.js';
import { createTranslator, type WidgetTranslate } from './i18n.js';

const LAUNCHER_SIZE = 84;
const PANEL = { width: 380, height: 620 } as const;
/** Frame size while the proactive greeting card sits above the launcher. */
const GREETING = { width: 340, height: 250 } as const;
const POLL_INTERVAL_MS = 4_000;
/** Per-session, so a dismissed greeting stays dismissed until the tab closes. */
const GREETING_DISMISSED_KEY = 'nexa.greeting_dismissed';

/**
 * The widget's appearance (FR-MOD-11.7), in the widget's own camelCase. The
 * loader forwards whatever the snippet set; everything else falls back to the
 * shipped look here, which the CSS defaults and the API defaults both mirror.
 */
interface Appearance {
  primaryColor: string;
  theme: 'auto' | 'light' | 'dark';
  position: 'bottom-right' | 'bottom-left';
  mobileFullscreen: boolean;
  poweredBy: boolean;
}

const DEFAULT_APPEARANCE: Appearance = {
  primaryColor: '#2d67fa',
  theme: 'auto',
  position: 'bottom-right',
  mobileFullscreen: true,
  poweredBy: true,
};

/** A `#rrggbb` colour — the one shape allowed to reach the `--nx-brand` var. */
const COLOR_RE = /^#[0-9a-fA-F]{6}$/;

interface WidgetConfig {
  organizationId: string;
  apiBaseUrl: string;
  language: string;
  /** Origin of the embedding page, supplied by the loader. */
  hostOrigin: string | null;
  /**
   * The hosted Chat page (FR-MOD-08.5.9): the widget is the whole page, not a
   * launcher in someone else's, and it is served from our own origin — so it
   * has no launcher, no host to message, and authorises against itself.
   */
  chatPage: boolean;
  /** Appearance baked into the snippet and forwarded by the loader. */
  appearance: Appearance;
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
  /** An agent is mid-reply — drives the "…is typing" line (FR-MOD-02.9). */
  agentTyping: boolean;
  /** The proactive greeting card is on screen (panel still closed). */
  greetingOpen: boolean;
  /** The pre-chat form is showing instead of the composer. */
  prechat: boolean;
  /** Pre-chat details to attach to the first message the visitor sends. */
  pendingDetails: { name?: string; email?: string } | null;
  /** The workspace's configurable pre-chat form fields (FR-MOD-08.7.7). */
  preChatFields: PreChatFormField[];
  /** Pre-chat form answers (field id → value) riding the first message. */
  pendingCustomFields: Record<string, string> | null;
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
  // The visitor's locale is fixed for the page load — the embedding site chose it
  // via `data-language` and the loader forwarded it. Bind one translator now and
  // thread it through every string the widget writes to the DOM (I18N1).
  const t = createTranslator(config.language);
  const api = new WidgetApi(config.apiBaseUrl, config.organizationId, config.hostOrigin);

  const state: State = {
    open: false,
    connected: false,
    online: false,
    chatId: null,
    queuePosition: null,
    events: [],
    agent: null,
    agentTyping: false,
    greetingOpen: false,
    prechat: false,
    pendingDetails: null,
    preChatFields: [],
    pendingCustomFields: null,
    error: null,
    sending: false,
    pendingAttachment: null,
    uploading: false,
  };

  const ui = buildUi(doc, t);
  // Non-null past the guard above; aliased so the appearance closure keeps that
  // narrowing (TypeScript drops it for the captured `root` inside a function).
  const rootEl = root;
  rootEl.append(ui.panel, ui.greeting, ui.launcher);

  // --- Appearance (FR-MOD-11.7) --------------------------------------------

  // Applied from the snippet at mount so the launcher is on-brand before the
  // first open, then re-applied from the token response — the server being the
  // source of truth corrects a stale snippet and is all the hosted Chat page has.
  let appearance = config.appearance;

  function applyAppearance(): void {
    const el = doc.documentElement;
    if (COLOR_RE.test(appearance.primaryColor)) {
      // Inline on `:root` beats the stylesheet's default and cascades to the
      // launcher, header and send button alike.
      el.style.setProperty('--nx-brand', appearance.primaryColor);
    }
    // Force the colour scheme, or clear the override to follow the visitor's OS.
    if (appearance.theme === 'auto') el.removeAttribute('data-nx-theme');
    else el.setAttribute('data-nx-theme', appearance.theme);
    // The loader positions the iframe; these mirror the launcher and greeting
    // inside it, and let the panel fill a full-screen mobile frame.
    rootEl.classList.toggle('nx-left', appearance.position === 'bottom-left');
    rootEl.classList.toggle('nx-mobile-full', appearance.mobileFullscreen);
    ui.poweredBy.hidden = !appearance.poweredBy;
  }

  applyAppearance();

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
      ui.transcript.append(renderBubble(doc, event, api, attachmentCache, t));
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
    ui.title.textContent = agent?.name ?? t('title.default');
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
      ui.status.textContent = t('status.queue', { n: state.queuePosition });
      ui.status.dataset['tone'] = 'wait';
      return;
    }
    if (!state.online) {
      // Honest rather than encouraging: nobody is there, and pretending
      // otherwise turns a short wait into an abandoned conversation.
      ui.status.textContent = t('status.offline');
      ui.status.dataset['tone'] = 'wait';
      return;
    }
    ui.status.textContent = '';
    ui.status.dataset['tone'] = 'ok';
  }

  /**
   * "…is typing" while an agent composes a reply (FR-MOD-02.9). The state comes
   * from the poll — the widget holds no socket — so it is at most a poll interval
   * behind, which is imperceptible for a courtesy indicator. Named when we know
   * who the agent is, generic otherwise.
   */
  function renderTyping(): void {
    ui.typing.hidden = !state.agentTyping;
    if (!state.agentTyping) {
      ui.typing.textContent = '';
      return;
    }
    ui.typing.textContent = state.agent
      ? t('typing.named', { name: state.agent.name })
      : t('typing.generic');
  }

  // --- Outbound typing (sneak-peek) ----------------------------------------

  // The visitor's own typing, sent to the agent (FR-MOD-11.8). Throttled on the
  // leading edge so a burst of keystrokes is one request, with a trailing "stop"
  // so the agent's preview clears if the visitor walks away mid-sentence.
  let typingThrottle: ReturnType<typeof setTimeout> | null = null;
  let typingStop: ReturnType<typeof setTimeout> | null = null;
  let typingSent = false;

  function notifyTyping(): void {
    if (!state.connected || !state.chatId) return;
    const text = ui.input.value.trim();
    if (!text) {
      stopTyping();
      return;
    }
    if (!typingThrottle) {
      typingSent = true;
      void api.typing(true, text).catch(() => undefined);
      typingThrottle = setTimeout(() => {
        typingThrottle = null;
      }, 800);
    }
    if (typingStop) clearTimeout(typingStop);
    typingStop = setTimeout(stopTyping, 4_000);
  }

  function stopTyping(): void {
    if (typingThrottle) {
      clearTimeout(typingThrottle);
      typingThrottle = null;
    }
    if (typingStop) {
      clearTimeout(typingStop);
      typingStop = null;
    }
    // Only retract if we actually announced typing — no spurious "stop" on send
    // when the visitor never triggered one.
    if (typingSent) {
      typingSent = false;
      void api.typing(false).catch(() => undefined);
    }
  }

  /**
   * The frame is only as large as it needs to be — a full-size transparent
   * iframe would swallow clicks on the host page. Three sizes: the open panel,
   * the greeting card above a closed launcher, or just the launcher.
   */
  function resize(): void {
    const size = state.open
      ? PANEL
      : state.greetingOpen
        ? GREETING
        : { width: LAUNCHER_SIZE, height: LAUNCHER_SIZE };
    postToHost(win, { type: 'nexa:resize', width: size.width, height: size.height });
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
    ui.launcher.setAttribute('aria-label', t(open ? 'launcher.close' : 'launcher.open'));

    // Opening supersedes the proactive card, but does not count as dismissing it.
    if (open && state.greetingOpen) {
      state.greetingOpen = false;
      ui.greeting.hidden = true;
    }

    resize();
    postToHost(win, { type: open ? 'nexa:open' : 'nexa:close' });

    if (open) {
      renderPrechat();
      (state.prechat ? ui.prechatName : ui.input).focus();
      void connect();
    }
  }

  // --- Greeting card + pre-chat --------------------------------------------

  /** Show the proactive card unless the visitor already waved it away. */
  function showGreeting(): void {
    if (state.open || greetingDismissed(win)) return;
    state.greetingOpen = true;
    ui.greeting.hidden = false;
    resize();
  }

  function dismissGreeting(): void {
    state.greetingOpen = false;
    ui.greeting.hidden = true;
    rememberGreetingDismissed(win);
    if (!state.open) resize();
  }

  /** Swap the panel body between the pre-chat form and the conversation. */
  function renderPrechat(): void {
    const showForm = state.prechat;
    ui.prechat.hidden = !showForm;
    ui.transcript.hidden = showForm;
    ui.status.hidden = showForm;
    ui.form.hidden = showForm;
    ui.chip.hidden = showForm || state.pendingAttachment === null;
  }

  /**
   * Build the workspace's configurable pre-chat fields (FR-MOD-08.7.7) into the
   * form. Rebuilt whenever the mint reports them; `replaceChildren` keeps it
   * idempotent so a re-connect does not stack duplicates. Each input carries its
   * definition id and type so `submitPrechat` can read the answers back.
   */
  function renderPreChatFields(): void {
    ui.prechatFields.replaceChildren();
    for (const field of state.preChatFields) {
      const marked = field.required ? `${field.label} *` : field.label;

      if (field.type === 'boolean') {
        const wrap = doc.createElement('label');
        wrap.className = 'nx-prechat-check';
        const box = doc.createElement('input');
        box.type = 'checkbox';
        box.dataset.defId = field.definition_id;
        box.dataset.fieldType = field.type;
        box.setAttribute('aria-label', field.label);
        const span = doc.createElement('span');
        span.textContent = marked;
        wrap.append(box, span);
        ui.prechatFields.append(wrap);
        continue;
      }

      const input = doc.createElement('input');
      input.className = 'nx-prechat-input';
      input.type = field.type === 'number' ? 'number' : field.type === 'date' ? 'date' : 'text';
      input.placeholder = marked;
      input.setAttribute('aria-label', field.label);
      input.dataset.defId = field.definition_id;
      input.dataset.fieldType = field.type;
      if (field.required) input.required = true;
      if (field.type === 'text') input.maxLength = 5000;
      ui.prechatFields.append(input);
    }
  }

  function submitPrechat(): void {
    const name = ui.prechatName.value.trim();
    if (!name) return;

    // The configurable fields (FR-MOD-08.7.7). A required one must be answered
    // before the chat can start; types are validated authoritatively server-side
    // when the answers ride the first message. An empty optional field is left
    // out rather than sent blank.
    const custom: Record<string, string> = {};
    const inputs = ui.prechatFields.querySelectorAll<HTMLInputElement>('input[data-def-id]');
    for (const el of inputs) {
      const id = el.dataset.defId ?? '';
      if (!id) continue;
      if (el.dataset.fieldType === 'boolean') {
        custom[id] = el.checked ? 'true' : 'false';
        continue;
      }
      const value = el.value.trim();
      if (!value) {
        if (el.required) {
          el.focus();
          return;
        }
        continue;
      }
      custom[id] = value;
    }

    const email = ui.prechatEmail.value.trim();
    state.pendingDetails = { name, ...(email ? { email } : {}) };
    state.pendingCustomFields = Object.keys(custom).length > 0 ? custom : null;
    state.prechat = false;
    renderPrechat();
    ui.input.focus();
  }

  // --- Data ----------------------------------------------------------------

  /**
   * The mint in flight, so a second caller joins it instead of starting its own.
   *
   * Opening the panel fires `connect`, and a fast Send or file pick fires
   * another before the first has resolved — `state.connected` is still false, so
   * the plain guard above does not catch it. Two mints would be two identities
   * on a first-ever visit: neither request carries a stored customer id, so the
   * server creates a customer for each, and whichever token lands second speaks
   * for a conversation the visitor cannot see.
   */
  let connecting: Promise<void> | null = null;

  async function connect(): Promise<void> {
    if (state.connected) return;
    connecting ??= mint().finally(() => {
      connecting = null;
    });
    return connecting;
  }

  async function mint(): Promise<void> {
    try {
      const snapshot = await api.connect();
      // The token mint carried the workspace's appearance; the server wins over
      // whatever the snippet baked, so a colour changed after install still takes.
      if (api.appearance) {
        appearance = appearanceFromApi(api.appearance);
        applyAppearance();
      }
      // …and the pre-chat form (FR-MOD-08.7.7). Rendered here rather than at build
      // time because it is per-workspace and only known once the token is minted;
      // an empty list leaves the fixed name/email form untouched.
      state.preChatFields = api.preChatForm;
      renderPreChatFields();
      state.connected = true;
      state.online = snapshot.online;
      state.chatId = snapshot.chat?.id ?? null;
      state.queuePosition = snapshot.chat?.queue_position ?? null;
      state.events = snapshot.events;
      state.agent = toAgent(snapshot.agent);
      state.agentTyping = snapshot.agent_typing ?? false;
      state.error = null;
      // A returning visitor already in a conversation skips the pre-chat form.
      if (snapshot.events.length > 0) {
        state.prechat = false;
        renderPrechat();
      }
      renderEvents();
      renderStatus();
      renderHeader();
      renderTyping();
      startPolling();
    } catch (error) {
      state.error = t('error.connect');
      renderStatus();
      // The real reason goes nowhere near the visitor.
      console.warn('nexa widget: connect failed', error);
    }
  }

  /**
   * `nexa('trackSale', …)` (FR-MOD-13.5), relayed here from the loader. The
   * host page is untrusted, so the payload is reshaped rather than trusted —
   * an unrecognised shape is dropped rather than sent on. The visitor may
   * never have opened the panel (a checkout confirmation page fires this on
   * its own), so a token is minted here if there is not one yet, reusing the
   * same returning-visitor identity the panel would. Silent on failure by
   * contract (13.5-g KK): the host page must never see this feature break it.
   */
  async function trackSale(payload: unknown): Promise<void> {
    const sale = asTrackSaleInput(payload);
    if (!sale) return;
    if (!api.authenticated) await connect();
    if (!api.authenticated) return; // connect already logged its own failure
    try {
      await api.trackSale(sale);
    } catch (error) {
      console.warn('nexa widget: trackSale failed', error);
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
      state.error = t('error.upload');
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
    remove.setAttribute('aria-label', t('attach.remove'));
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
    // The draft is on its way — retract the sneak-peek so the agent's preview
    // does not linger behind the real message.
    stopTyping();

    // Sending needs a token. Opening the panel already started `connect`, but
    // the composer is on screen from the first frame — nothing makes the visitor
    // wait for the mint, so a fast typist beats it and `api.send` throws "not
    // connected". Same guard `onPickFile` carries, and it belongs here first:
    // losing a message is worse than losing an upload. Awaited *before* the
    // optimistic bubble, because a successful connect replaces `state.events`
    // wholesale and would drop a bubble pushed ahead of it.
    if (!api.authenticated) await connect();

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

    // Pre-chat name/email and form answers ride along with the first message.
    // Captured before the await so a failed send can put them back.
    const details = state.pendingDetails;
    const customFields = state.pendingCustomFields;
    const referrer = hostReferrer(win);
    try {
      const result = await api.send(text, {
        url: hostPageUrl(win),
        // Sent on every message, not just the first: the server only keeps it
        // when it opens a new visit, and the widget cannot know which message
        // that is (a visit expires after 30 minutes of quiet).
        ...(referrer ? { referrer } : {}),
        ...(attachment ? { attachment_url: attachment.fileUrl } : {}),
        ...(details ?? {}),
        ...(customFields ? { custom_fields: customFields } : {}),
      });
      state.chatId = result.chat_id;
      state.pendingDetails = null;
      state.pendingCustomFields = null;
      state.error = null;
      await refresh();
    } catch (error) {
      state.error = t('error.send');
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
      state.agentTyping = snapshot.agent_typing ?? false;
      renderedCount = 0;
      ui.transcript.replaceChildren();
      renderEvents();
      renderStatus();
      renderHeader();
      renderTyping();
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
  // "Let's chat": open into the pre-chat form (unless a conversation resumes).
  ui.greetChat.addEventListener('click', () => {
    state.prechat = true;
    setOpen(true);
  });
  // "Just browsing": tuck the card away for the rest of the session.
  ui.greetBrowse.addEventListener('click', () => dismissGreeting());
  ui.prechat.addEventListener('submit', (event) => {
    event.preventDefault();
    submitPrechat();
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
  // Live typing preview: tell the agent as the visitor types (FR-MOD-11.8).
  ui.input.addEventListener('input', () => notifyTyping());
  // Leaving the field ends the draft-in-progress the agent was previewing.
  ui.input.addEventListener('blur', () => stopTyping());

  doc.addEventListener('keydown', (event) => {
    // On the Chat page there is nothing to close to, so Escape must not blank it.
    if (event.key === 'Escape' && state.open && !config.chatPage) {
      setOpen(false);
      ui.launcher.focus();
    }
  });

  win.addEventListener('message', (event: MessageEvent) => {
    // The host page is cross-origin and untrusted: accept only the known
    // commands it may issue, and ignore anything else without replying.
    const data = event.data as { type?: unknown; command?: unknown; payload?: unknown };
    if (data?.type === 'nexa:host-open') setOpen(true);
    if (data?.type === 'nexa:host-close') setOpen(false);
    if (data?.type === 'nexa:command' && data.command === 'trackSale') void trackSale(data.payload);
  });

  if (config.chatPage) {
    // The whole page is the conversation: no launcher, no host to message, open
    // from the start.
    root.classList.add('nx-page');
    ui.launcher.hidden = true;
    ui.close.hidden = true;
    ui.panel.hidden = false;
    state.open = true;
    renderPrechat();
    ui.input.focus();
    void connect();
  } else {
    postToHost(win, { type: 'nexa:ready' });
    // The proactive nudge, once the host has wired up its message channel.
    showGreeting();
  }
}

// ---------------------------------------------------------------------------

interface Ui {
  launcher: HTMLButtonElement;
  panel: HTMLElement;
  transcript: HTMLElement;
  typing: HTMLElement;
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
  greeting: HTMLElement;
  greetChat: HTMLButtonElement;
  greetBrowse: HTMLButtonElement;
  prechat: HTMLFormElement;
  prechatName: HTMLInputElement;
  prechatEmail: HTMLInputElement;
  /** Holds the workspace's configurable pre-chat fields (FR-MOD-08.7.7). */
  prechatFields: HTMLDivElement;
  prechatSubmit: HTMLButtonElement;
  poweredBy: HTMLElement;
}

function buildUi(doc: Document, t: WidgetTranslate): Ui {
  const style = doc.createElement('style');
  // Inline so the widget is one request and cannot be left half-styled if a
  // stylesheet fails to load.
  style.textContent = WIDGET_CSS;
  doc.head.append(style);

  const launcher = doc.createElement('button');
  launcher.type = 'button';
  launcher.className = 'nx-launcher';
  launcher.setAttribute('aria-expanded', 'false');
  launcher.setAttribute('aria-label', t('launcher.open'));
  launcher.textContent = t('launcher.text');

  const panel = doc.createElement('section');
  panel.className = 'nx-panel';
  panel.hidden = true;
  panel.setAttribute('aria-label', t('panel.label'));

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
  title.textContent = t('title.default');
  identity.append(avatar, title);
  const close = doc.createElement('button');
  close.type = 'button';
  close.className = 'nx-close';
  close.setAttribute('aria-label', t('launcher.close'));
  close.textContent = '×';
  header.append(identity, close);

  const transcript = doc.createElement('div');
  transcript.className = 'nx-transcript';
  // Announced politely so a screen reader user hears replies without losing
  // their place (design-brief §7).
  transcript.setAttribute('role', 'log');
  transcript.setAttribute('aria-live', 'polite');
  transcript.setAttribute('aria-label', t('transcript.label'));

  // "…is typing" line. Announced politely so a screen-reader visitor hears it
  // without having their reading of a reply interrupted.
  const typing = doc.createElement('p');
  typing.className = 'nx-typing';
  typing.hidden = true;
  typing.setAttribute('role', 'status');
  typing.setAttribute('aria-live', 'polite');

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
  attach.setAttribute('aria-label', t('attach.label'));
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
  input.placeholder = t('input.placeholder');
  input.setAttribute('aria-label', t('input.label'));
  input.maxLength = 10_000;

  const send = doc.createElement('button');
  send.type = 'submit';
  send.className = 'nx-send';
  send.textContent = t('send');

  form.append(attach, file, input, send);

  // Pre-chat form — a fixed, minimal one on purpose (FR-MOD-11.2): the visual
  // form builder is a separate v1 feature this must not depend on.
  const prechat = doc.createElement('form');
  prechat.className = 'nx-prechat';
  prechat.hidden = true;
  const prechatIntro = doc.createElement('p');
  prechatIntro.className = 'nx-prechat-intro';
  prechatIntro.textContent = t('prechat.intro');
  const prechatName = doc.createElement('input');
  prechatName.className = 'nx-prechat-input';
  prechatName.type = 'text';
  prechatName.placeholder = t('prechat.name');
  prechatName.setAttribute('aria-label', t('prechat.name'));
  prechatName.required = true;
  prechatName.maxLength = 120;
  const prechatEmail = doc.createElement('input');
  prechatEmail.className = 'nx-prechat-input';
  prechatEmail.type = 'email';
  prechatEmail.placeholder = t('prechat.email');
  prechatEmail.setAttribute('aria-label', t('prechat.emailLabel'));
  prechatEmail.maxLength = 320;
  // The workspace's configurable fields (FR-MOD-08.7.7) are appended here after
  // the token mint reports them — empty (and so invisible) when none are set, so
  // the fixed name/email form above is unchanged for a workspace that has no
  // form builder configured.
  const prechatFields = doc.createElement('div');
  prechatFields.className = 'nx-prechat-fields';
  const prechatSubmit = doc.createElement('button');
  prechatSubmit.type = 'submit';
  prechatSubmit.className = 'nx-prechat-submit';
  prechatSubmit.textContent = t('prechat.submit');
  prechat.append(prechatIntro, prechatName, prechatEmail, prechatFields, prechatSubmit);

  // "Powered by Nexa" (FR-MOD-11.5): shown by default, hidden when a workspace
  // removes it. A link, opened in a new tab so it never navigates the panel away
  // from a live conversation.
  const poweredBy = doc.createElement('p');
  poweredBy.className = 'nx-powered';
  const poweredLink = doc.createElement('a');
  poweredLink.className = 'nx-powered-link';
  poweredLink.href = 'https://nexa.example';
  poweredLink.target = '_blank';
  poweredLink.rel = 'noopener noreferrer';
  poweredLink.textContent = t('poweredBy');
  poweredBy.append(poweredLink);

  panel.append(header, transcript, typing, status, prechat, chip, form, poweredBy);

  // Greeting card — the proactive nudge that sits above a closed launcher.
  const greeting = doc.createElement('div');
  greeting.className = 'nx-greeting';
  greeting.hidden = true;
  greeting.setAttribute('role', 'dialog');
  greeting.setAttribute('aria-label', t('greeting.label'));
  const greetMsg = doc.createElement('p');
  greetMsg.className = 'nx-greet-msg';
  greetMsg.textContent = t('greeting.msg');
  const greetActions = doc.createElement('div');
  greetActions.className = 'nx-greet-actions';
  const greetChat = doc.createElement('button');
  greetChat.type = 'button';
  greetChat.className = 'nx-greet-chat';
  greetChat.textContent = t('greeting.chat');
  const greetBrowse = doc.createElement('button');
  greetBrowse.type = 'button';
  greetBrowse.className = 'nx-greet-browse';
  greetBrowse.textContent = t('greeting.browse');
  greetActions.append(greetChat, greetBrowse);
  greeting.append(greetMsg, greetActions);

  return {
    launcher,
    panel,
    transcript,
    typing,
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
    greeting,
    greetChat,
    greetBrowse,
    prechat,
    prechatName,
    prechatEmail,
    prechatFields,
    prechatSubmit,
    poweredBy,
  };
}

function renderBubble(
  doc: Document,
  event: WidgetEvent,
  api: WidgetApi,
  cache: Map<string, string>,
  t: WidgetTranslate,
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
  if (event.attachment_url)
    bubble.append(renderAttachment(doc, api, event.attachment_url, cache, t));

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
  t: WidgetTranslate,
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
    img.alt = t('attachment.alt');
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

/**
 * Narrow an untrusted `nexa('trackSale', …)` payload to the shape the API
 * accepts. The server is the final authority (13.5-c) — this only stops an
 * obviously wrong call (missing field, wrong type) from going out at all.
 */
function asTrackSaleInput(payload: unknown): TrackSaleInput | null {
  if (!payload || typeof payload !== 'object') return null;
  const { external_order_id, amount_cents, currency } = payload as Record<string, unknown>;
  if (typeof external_order_id !== 'string' || external_order_id.length === 0) return null;
  if (typeof amount_cents !== 'number' || !Number.isFinite(amount_cents)) return null;
  if (typeof currency !== 'string' || currency.length !== 3) return null;
  return { external_order_id, amount_cents, currency };
}

/** Map the API's snake_case identity to the widget's shape. */
function toAgent(agent: WidgetState['agent']): { name: string; avatarUrl: string | null } | null {
  return agent ? { name: agent.name, avatarUrl: agent.avatar_url } : null;
}

/** First letter of a name, for an avatar with no image. */
function initial(name: string): string {
  return (name.trim()[0] ?? '?').toUpperCase();
}

/**
 * Session storage, guarded like the localStorage helpers: Safari private mode
 * and blocked site data both throw. A greeting that cannot remember it was
 * dismissed simply reappears next load — annoying, not broken.
 */
function greetingDismissed(win: Window): boolean {
  try {
    return win.sessionStorage.getItem(GREETING_DISMISSED_KEY) === '1';
  } catch {
    return false;
  }
}

function rememberGreetingDismissed(win: Window): void {
  try {
    win.sessionStorage.setItem(GREETING_DISMISSED_KEY, '1');
  } catch {
    // Ignored — the card just shows again next time.
  }
}

function readConfig(win: Window): WidgetConfig {
  const params = new URLSearchParams(win.location.search);
  // The hosted page is served at `/chat.html`; the query flag is an override for
  // dev and tests opening the widget document directly.
  const chatPage = win.location.pathname.endsWith('/chat.html') || params.get('chat_page') === '1';
  return {
    organizationId: params.get('organization_id') ?? '',
    // Same origin as the widget document by default; overridable for local dev.
    apiBaseUrl: params.get('api') ?? 'http://localhost:4000/api/v1',
    language: params.get('language') ?? 'en',
    // On the Chat page the widget is served from our own origin and speaks for
    // it; elsewhere the loader passes the embedding page's origin, falling back
    // to the referrer when the widget document is opened directly.
    hostOrigin: chatPage ? win.location.origin : (params.get('host_origin') ?? referrerOrigin(win)),
    chatPage,
    appearance: readAppearance(params),
  };
}

/**
 * Appearance from the loader's query params, each field defaulting to the
 * shipped look. A booleans-as-`0` convention keeps the URL short: the flags are
 * only present when the snippet turned them off.
 *
 * `powered_by` is deliberately NOT read here (FR-MOD-11.5 / entitlement
 * `white_label`): the visitor's browser controls this URL, so honouring it
 * would let anyone strip the footer by editing the embed snippet, with no
 * server check at all. The footer defaults on and only `appearanceFromApi`
 * — the authenticated token mint, gated by `11.5-b`'s entitlement — can turn
 * it off.
 */
function readAppearance(params: URLSearchParams): Appearance {
  const color = params.get('color');
  const theme = params.get('theme');
  const position = params.get('position');
  return {
    primaryColor:
      color && COLOR_RE.test(color) ? color.toLowerCase() : DEFAULT_APPEARANCE.primaryColor,
    theme: theme === 'light' || theme === 'dark' ? theme : 'auto',
    position: position === 'bottom-left' ? 'bottom-left' : 'bottom-right',
    mobileFullscreen: params.get('mobile_full') !== '0',
    poweredBy: DEFAULT_APPEARANCE.poweredBy,
  };
}

/** The widget's camelCase appearance from the API's snake_case token payload. */
function appearanceFromApi(a: WidgetAppearance): Appearance {
  return {
    primaryColor: COLOR_RE.test(a.primary_color)
      ? a.primary_color.toLowerCase()
      : DEFAULT_APPEARANCE.primaryColor,
    theme: a.theme,
    position: a.position,
    mobileFullscreen: a.mobile_fullscreen,
    poweredBy: a.powered_by,
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

/**
 * Where the visitor was before the host page (FR-MOD-13.2) — the loader's
 * reading, already trimmed to origin + path.
 *
 * No fallback to `document.referrer`, unlike `hostPageUrl` above: in here that
 * is the embedding page itself, so falling back would record every visitor as
 * having come from the site they are already on. Absent is the honest answer,
 * and `came_from` stays null.
 */
function hostReferrer(win: Window): string | undefined {
  return new URLSearchParams(win.location.search).get('host_referrer') || undefined;
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
/* The elements below carry their own display, which would otherwise beat the
   UA [hidden] rule and leave a "hidden" card or panel on screen. */
[hidden] { display: none !important; }
:root {
  --nx-brand: #2d67fa;
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
/* Forced colour scheme (FR-MOD-11.7). The attribute selector outweighs the
   prefers-color-scheme block, so a workspace choice wins over the visitor's OS
   in both directions. */
:root[data-nx-theme="light"] {
  --nx-surface: #ffffff; --nx-text: #111726; --nx-muted: #4a5468;
  --nx-border: #dde1e9; --nx-customer: #eff1f5; color-scheme: light;
}
:root[data-nx-theme="dark"] {
  --nx-surface: #121829; --nx-text: #edf0f6; --nx-muted: #a6b0c4;
  --nx-border: #232c44; --nx-customer: #1e2740; color-scheme: dark;
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
/* Hosted Chat page: the panel is the whole viewport, no floating card. */
.nx-page .nx-panel { inset: 0; border: 0; border-radius: 0; box-shadow: none; }
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
.nx-typing { margin: 0; padding: 0 14px 6px; font-size: 12px; font-style: italic; color: var(--nx-muted); }
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
.nx-greeting {
  position: fixed; right: 10px; bottom: 82px; width: 300px;
  background: var(--nx-surface); color: var(--nx-text);
  border: 1px solid var(--nx-border); border-radius: var(--nx-radius);
  box-shadow: 0 8px 24px rgb(16 24 40 / .18);
  padding: 14px; display: flex; flex-direction: column; gap: 10px;
}
.nx-greet-msg { margin: 0; font-size: 14px; line-height: 1.4; }
.nx-greet-actions { display: flex; gap: 8px; }
.nx-greet-chat {
  flex: 1; border: 0; border-radius: 8px; padding: 8px 10px;
  background: var(--nx-brand); color: #fff; font: inherit; font-weight: 600; cursor: pointer;
}
.nx-greet-browse {
  flex: 1; border: 1px solid var(--nx-border); border-radius: 8px; padding: 8px 10px;
  background: transparent; color: var(--nx-muted); font: inherit; cursor: pointer;
}
.nx-prechat {
  flex: 1; display: flex; flex-direction: column; gap: 10px;
  padding: 16px; overflow-y: auto;
}
.nx-prechat-intro { margin: 0 0 2px; font-size: 14px; color: var(--nx-muted); }
.nx-prechat-input {
  font: inherit; color: inherit; padding: 9px 11px; border-radius: 8px;
  border: 1px solid var(--nx-border); background: transparent;
}
/* Configurable pre-chat fields (FR-MOD-08.7.7). Collapsed when empty so a
   workspace with no form builder configured sees the fixed form unchanged. */
.nx-prechat-fields { display: flex; flex-direction: column; gap: 10px; }
.nx-prechat-fields:empty { display: none; }
.nx-prechat-check { display: flex; align-items: center; gap: 8px; font-size: 14px; color: var(--nx-muted); }
.nx-prechat-submit {
  border: 0; border-radius: 8px; padding: 9px 12px;
  background: var(--nx-brand); color: #fff; font: inherit; font-weight: 600; cursor: pointer;
}
.nx-powered { margin: 0; padding: 6px 12px 10px; text-align: center; font-size: 11px; color: var(--nx-muted); }
.nx-powered-link { color: inherit; text-decoration: none; }
.nx-powered-link:hover { text-decoration: underline; }
/* Left-corner placement (FR-MOD-11.7): mirror the launcher and greeting to the
   edge the loader anchored the iframe to. */
.nx-left .nx-launcher { left: 10px; right: auto; }
.nx-left .nx-greeting { left: 10px; right: auto; }
/* Mobile fullscreen: on a phone the loader gives the frame the whole viewport,
   so the panel drops its floating-card inset and fills it edge-to-edge. */
@media (max-width: 480px) {
  .nx-mobile-full .nx-panel { inset: 0; border: 0; border-radius: 0; }
}
:focus-visible { outline: 2px solid var(--nx-brand); outline-offset: 2px; }
@media (prefers-reduced-motion: reduce) { * { transition: none !important; animation: none !important; } }
`;

if (typeof document !== 'undefined' && document.getElementById('nexa-widget-root')) {
  mount();
}
