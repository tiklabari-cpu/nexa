/**
 * Widget document — runs inside the sandboxed iframe.
 *
 * Written against the DOM directly rather than with a framework: the whole
 * artifact has a 50 KB budget (NFR-P3) and React alone is three times that.
 *
 * Hard rule throughout: every piece of customer- or agent-authored text reaches
 * the DOM as `textContent` or a text node. Never `innerHTML` — the eslint config
 * bans it outright rather than relying on anyone remembering (NFR-S6). The one
 * place a message becomes more than a single text node is `appendRichText`
 * (`rich-text.ts`), which still builds elements rather than parsing markup.
 */
import {
  AI_BOT_ID,
  ASK_EMAIL_ANSWERED_SYSTEM_EVENT,
  ASK_EMAIL_SYSTEM_EVENT,
  DEFAULT_PRECHAT_CONFIG,
  PRECHAT_FIELD_KEYS,
  prechatAsksAnything,
  readEditedAt,
  RESOLUTION_PROMPT_PROPERTY,
  SENSITIVE_WARNING_SYSTEM_EVENT,
  type PrechatConfig,
  type PrechatFieldKey,
  type WidgetFormField,
} from '@siyahtus/types';
import {
  isReturningVisitor,
  WidgetApi,
  WidgetApiError,
  type ChallengeHandler,
  type MintedAppearance,
  type TrackSaleInput,
  type WidgetEvent,
  type WidgetState,
} from './api.js';
import { buildChallengeParts, drawChallenge, type ChallengeParts } from './challenge.js';
import { insertEmojiAtCaret, WIDGET_EMOJI_CATEGORIES } from './emoji.js';
import { appendRichText } from './rich-text.js';
import { WidgetSocket } from './socket.js';
import {
  browserLanguages,
  createTranslator,
  isRtlLocale,
  pickWidgetLocale,
  type WidgetLocale,
  type WidgetTranslate,
} from './i18n.js';

/**
 * Frame sizes. The loader pins the frame flush to the screen corner and every
 * visible part sits 28 px in from it (the reference design's offset), so on
 * the two screen-edge sides a shadow runs off the screen as it would without
 * an iframe. The two sides facing the page get room for the whole shadow to
 * fade out: an iframe clips what it draws, and a shadow cut short there showed
 * as a hard grey box around the card. Sizes, not logic: the stylesheet places
 * everything from the same corner.
 */
const LAUNCHER_SIZE = 124; // 28 + 60 px launcher + 36 for its hover shadow
// 28 + 400 + 60 wide; 102 (launcher + 14 px gap) + 660 + 40 tall.
const PANEL = { width: 488, height: 802 } as const;
/** Frame size while the proactive greeting card sits above the launcher. */
const GREETING = { width: 384, height: 320 } as const; // 320 px card over the launcher
const POLL_INTERVAL_MS = 4_000;
/**
 * How long a visitor is on the page before the greeting card offers itself
 * (owner, 2026-10-13). Until then only the launcher shows: a card the instant
 * the page opens reads as a pop-up, and it covers the page the visitor came
 * to read before they have read any of it.
 */
export const GREETING_DELAY_MS = 30_000;
/**
 * How long a reply that arrived while the panel was closed stays previewed
 * above the launcher (owner, 2026-10-13). Long enough to read two lines; the
 * unread badge carries the news after it goes.
 */
export const PREVIEW_MS = 15_000;
/**
 * The cadence while the panel is *closed* (FR-MOD-11.1).
 *
 * Four seconds buys liveness inside an open conversation — a reply that lands
 * while the visitor is watching. A closed panel is not watching anything: all
 * it owes the visitor is an unread badge and a proactive card, and neither is
 * worth 900 requests an hour from every tab a returning visitor leaves open.
 * Fifteen times fewer requests, at the cost of a badge that is at most half a
 * minute late — which is the right side of that trade for a nudge.
 */
const CLOSED_POLL_INTERVAL_MS = 30_000;
/**
 * The cadence while the RTM socket is live (FR-MOD-11.6).
 *
 * The socket carries messages, so the four-second poll has nothing left to do
 * for liveness and stops. It does not stop *entirely*, and that is a decision
 * rather than an oversight: three things the visitor sees arrive only on this
 * request and have no push behind them — a proactive campaign owed to them
 * (FR-MOD-03.3.2, delivered and stamped inside the poll itself by
 * `campaign-delivery.ts`), the agent's "…is typing" line (FR-MOD-02.9, a
 * short-lived Redis flag the poll reads back, addressed to agents on the bus and
 * never to the visitor), and `online` / `queue_position`. Cutting the request
 * off would trade a latency win on messages for three features that silently
 * stop working.
 *
 * So the socket demotes the poll to a heartbeat rather than replacing it. The
 * overlap costs nothing: every event is applied by id (`applyIncomingEvent`), so
 * a message arriving on both paths is rendered once.
 */
const SOCKET_POLL_INTERVAL_MS = 30_000;
/**
 * Failed polls in a row before the visitor is told the connection dropped
 * (tm 259.11 · UX audit O2). One is a blip — a request lost to a train tunnel
 * or a server restart — and saying so would make the line flicker; two is
 * eight seconds of nothing with the panel open, which is long enough that a
 * visitor waiting on a reply deserves to know why it is not coming.
 */
const LOST_AFTER_FAILED_POLLS = 2;
/**
 * The ceiling on the poll's back-off while the server cannot be reached.
 *
 * Each failure doubles the wait from the panel's own cadence (4 → 8 → 16 →
 * 30 s), so a widget left open on every tab of a site whose API is down does
 * not hammer it at four seconds — and stops doubling here, so recovery is never
 * more than half a minute behind. Coming back online does not wait for it at
 * all: the `online` event polls at once.
 */
const MAX_BACKOFF_MS = 30_000;
/** Per-session, so a dismissed greeting stays dismissed until the tab closes. */
const GREETING_DISMISSED_KEY = 'siyahtus.greeting_dismissed';
/**
 * Watermark for the unread badge (FR-MOD-11.1): the `created_at` of the newest
 * message *from the team* the visitor has actually had on screen. Anything
 * newer than it is unread.
 *
 * A watermark rather than a counter, and `localStorage` rather than the
 * `sessionStorage` the dismissal keys above use — both for the same reason.
 * The case the badge exists for is precisely the one where the visitor is not
 * around: they close the panel (or the tab) and the agent answers afterwards.
 * A counter kept in memory dies on the next reload; a session-scoped one dies
 * with the tab, which is exactly when the reply arrives. The watermark instead
 * is re-derived from the server's own transcript on every poll, so it survives
 * reloads, cannot drift, and self-corrects.
 */
const LAST_READ_KEY = 'siyahtus.last_read_at';
/**
 * Same pattern, one key per campaign (FR-MOD-03.3.2): the campaign's `id` is
 * stable per visitor, so dismissing *this* campaign must not swallow a
 * different one delivered later in the session — unlike the greeting, which
 * has only one message to ever dismiss.
 */
const CAMPAIGN_DISMISSED_KEY_PREFIX = 'siyahtus.campaign_dismissed.';

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
  /** The deployment's privacy policy, or null — only the server can say. */
  privacyPolicyUrl: string | null;
  /** Where "Powered by" links, or null for the words alone. Server-supplied. */
  poweredByUrl: string | null;
  /** The workspace's welcome message (owner, 2026-10-13). Server-supplied. */
  welcomeTitle: string | null;
  welcomeText: string | null;
}

const DEFAULT_APPEARANCE: Appearance = {
  primaryColor: '#2d67fa',
  // Light unless the workspace picks otherwise (owner, 2026-10-12). `auto`,
  // which follows the visitor's OS, is still a choice -- just not the default.
  theme: 'light',
  position: 'bottom-right',
  mobileFullscreen: true,
  poweredBy: true,
  privacyPolicyUrl: null,
  poweredByUrl: null,
  welcomeTitle: null,
  welcomeText: null,
};

/** A `#rrggbb` colour — the one shape allowed to reach the `--nx-brand` var. */
const COLOR_RE = /^#[0-9a-fA-F]{6}$/;

interface WidgetConfig {
  organizationId: string;
  apiBaseUrl: string;
  /**
   * A language the embedding page's snippet named, or null when it named none —
   * the common case, where the panel's setting and the visitor's browser decide
   * (WG-02).
   */
  language: string | null;
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
  /** Someone answers now — a person, or the AI (WG-09 `answered_by`). */
  online: boolean;
  /** The server's `can_start_chat` (WG-09); undefined from a server predating it. */
  canStartChat?: boolean;
  chatId: string | null;
  /**
   * The connection open in that chat (ID-02): the visitor's chat holds their
   * whole day, and coming back the same day opens a further connection under
   * the *same* chat id. What a closing prompt is about is therefore the chat
   * and its connection — see `sameConversation`. Null when none is open, or
   * not yet known (a chat adopted from a push before the next poll).
   */
  threadId: string | null;
  queuePosition: number | null;
  events: WidgetEvent[];
  /** Who the visitor is talking to, shown in the header (FR-MOD-11.3). */
  agent: { name: string; avatarUrl: string | null } | null;
  /** An agent is mid-reply — drives the "…is typing" line (FR-MOD-02.9). */
  agentTyping: boolean;
  /** The proactive card (greeting or campaign) is on screen (panel still closed). */
  greetingOpen: boolean;
  /**
   * Messages from the team that arrived while the panel was closed
   * (FR-MOD-11.1) — the number on the launcher badge. Derived on every poll
   * from `events` and the `LAST_READ_KEY` watermark, never incremented, so a
   * missed poll or a reload cannot make it drift from the transcript.
   */
  unread: number;
  /**
   * A campaign message owed to this visitor (FR-MOD-03.3.2), from the widget's
   * own poll — not a second card system, the same slot `greetingOpen` occupies.
   * Cleared once shown and either dismissed or acted on; never overwritten by a
   * later poll while one is already waiting to be seen (see `renderCard`).
   */
  campaign: { id: string; message: string } | null;
  /** The pre-chat form is showing instead of the composer. */
  prechat: boolean;
  /** Pre-chat details to attach to the first message the visitor sends. */
  pendingDetails: { name?: string; username?: string; email?: string } | null;
  /**
   * The brand's built-in pre-chat form (WG-01): whether it opens, and which of
   * the four fixed fields it shows and requires. Today's form until the mint
   * says otherwise.
   */
  prechatConfig: PrechatConfig;
  /** The workspace's configurable pre-chat form fields (FR-MOD-08.7.7). */
  preChatFields: WidgetFormField[];
  /** Pre-chat form answers (field id → value) riding the first message. */
  pendingCustomFields: Record<string, string> | null;
  /** The workspace's configurable post-chat form fields (FR-MOD-08.7.7). */
  postChatFields: WidgetFormField[];
  /**
   * The post-chat form (FR-MOD-08.7.7), raised for the chat named by `chatId`
   * once it ends — above the CSAT prompt, on the same screen. `submitted` flips
   * once the answers reach the contact, which swaps the inputs for a thank-you.
   * Null when the workspace configures no post-chat fields, or once a new
   * conversation starts.
   */
  postChat: { chatId: string; threadId: string | null; submitted: boolean } | null;
  postChatSubmitting: boolean;
  /** The last submit failed — the answers are still on screen to retry. */
  postChatError: boolean;
  /**
   * The workspace's offline form (FR-MOD-08.7.7): the `ticket` questions, about
   * the request the visitor is leaving, and the `prospect` ones, about the
   * person leaving it. Both empty for a workspace that has not built the form —
   * in which case no offline panel is ever shown and nothing about the widget
   * changes, which is what makes the surface opt-in.
   */
  ticketFields: WidgetFormField[];
  prospectFields: WidgetFormField[];
  /** The message went through — the form is swapped for a thank-you. */
  offlineSent: boolean;
  offlineSubmitting: boolean;
  /** The last submit failed — what the visitor typed is still on screen. */
  offlineError: boolean;
  error: string | null;
  sending: boolean;
  /** A file the visitor picked and we uploaded, waiting to be sent. */
  pendingAttachment: { fileUrl: string; name: string } | null;
  uploading: boolean;
  /**
   * The CSAT prompt (FR-MOD-07.8/11): `chatId` is whichever chat it targets —
   * the one that just closed, or the current one when opened early from the
   * header menu. `value` is null until the vote round-trips, which flips the
   * prompt to a "thanks" state; voting again still posts, and the server
   * writes it onto the connection's one rating. `commentOpen`: the visitor
   * asked to add a comment to a good vote (a bad one offers it at once);
   * `commented`: one was sent (WG-11).
   */
  rating: {
    chatId: string;
    threadId: string | null;
    value: 'good' | 'bad' | null;
    commentOpen?: boolean;
    commented?: boolean;
  } | null;
  ratingSubmitting: boolean;
  /**
   * The visitor's chat has ended — by their own "End chat" (FR-MOD-11.4-b) or
   * by `refresh` noticing an agent archive / idle-timeout sweep — and they have
   * not yet started a new one. Swaps the composer for a "chat ended" banner;
   * "Start a new chat" only clears this, it does not call anything itself.
   */
  closed: boolean;
  /**
   * Who has the open connection (tm 308 · AI-29): "Talk to an agent" shows
   * while it is `ai` — the workspace may reword it, never hide it. Null with
   * no open connection, or from a server predating it.
   */
  owner: 'ai' | 'human' | 'queue' | null;
  /** The button's words, as the server resolved them; null: no button. */
  humanButtonLabel: string | null;
  /** A press is on its way: the button says "Connecting you to an agent…" and waits. */
  humanRequesting: boolean;
  /**
   * The AI message whose "is it solved?" the visitor answered (tm 320.1 ·
   * AI-25-S2): its Yes / No stay away until something newer is written.
   */
  resolutionAnswered: string | null;
  /**
   * The licence's file-sharing switch (FR-MOD-08.9.4), from the last token
   * mint. Starts `true` — the attach button's own default state, so nothing
   * changes before the first connect — and only ever narrows once the server
   * has answered.
   */
  fileSharingEnabled: boolean;
}

/**
 * Whether a closing prompt (CSAT, post-chat form) belongs to the conversation
 * now on screen (ID-02). Since the visitor's chat is their whole day, the same
 * chat id comes back for a same-day return with a new connection under it, so
 * the chat alone no longer tells "this conversation" from "the one before".
 * A connection not yet known on either side (`null`) is not a difference: the
 * chat decides, as it did before the day model.
 */
function sameConversation(
  prompt: { chatId: string; threadId: string | null },
  current: { chatId: string | null; threadId: string | null },
): boolean {
  if (prompt.chatId !== current.chatId) return false;
  return (
    prompt.threadId === null || current.threadId === null || prompt.threadId === current.threadId
  );
}

/**
 * Draws the widget into `#siyahtus-widget-root` and starts it. Returns the function that stops
 * it again: the poll, the socket, every timer and the `window`/`document` listeners. The widget's
 * own elements keep theirs, which leave with the DOM. A page loads the widget once and never
 * calls it; tests do, after each one (2026-10-25) — a widget left polling from an earlier test
 * re-armed its timer on the next test's fake clock and showed up as 8–16 extra polls.
 */
export function mount(doc: Document = document, win: Window = window): () => void {
  const root = doc.getElementById('siyahtus-widget-root');
  if (!root) return () => {};

  // What the returned teardown undoes, beyond the timers it clears by name.
  const listening = new AbortController();
  const { signal } = listening;
  let stopped = false;

  const config = readConfig(win);
  // The language is chosen in order (WG-02, `pickWidgetLocale`): the snippet's
  // `data-language`, the panel's setting, the visitor's browser, the panel's
  // fallback. The panel's half arrives with the token mint, so the first draw
  // uses what is known now — snippet, then browser, then English — and the mint
  // redraws once if it names another language (`adoptMintedLanguage`). `t` is a
  // stable wrapper over whichever translator is current, so every string the
  // widget writes to the DOM follows the swap (I18N1).
  const browser = browserLanguages(win.navigator);
  let locale: WidgetLocale = pickWidgetLocale({ snippet: config.language, browser });
  let translate = createTranslator(locale);
  const t: WidgetTranslate = (key, params) => translate(key, params);
  // Send held after a 429 (`pauseSending`); declared up here because
  // `renderClosed` reads it and runs long before the first send.
  let sendPaused = false;
  let sendPauseTimer: ReturnType<typeof setTimeout> | undefined;
  // NFR-I18N1: direction follows the locale. Set on the document element so the
  // whole panel — laid out with logical CSS (`inset-inline-*`, flexbox
  // `flex-start`/`flex-end`), not `left`/`right` — mirrors correctly for Arabic
  // instead of staying pinned to its LTR corner.
  function applyDocumentLocale(): void {
    doc.documentElement.lang = locale;
    doc.documentElement.dir = isRtlLocale(locale) ? 'rtl' : 'ltr';
  }
  applyDocumentLocale();
  const api = new WidgetApi(config.apiBaseUrl, config.organizationId, config.hostOrigin);

  // --- Human check (tm 339.3 · GV-01) ----------------------------------------
  // At most one at a time: a second request behind the same check waits on it.
  let pendingChallenge: {
    details: Parameters<ChallengeHandler>[0];
    failed: boolean;
    settle: (token: string | null) => void;
  } | null = null;
  let stopChallenge: (() => void) | null = null;

  /** Draw the pending check into the current shell, or put the conversation back. */
  function renderChallenge(): void {
    stopChallenge?.();
    stopChallenge = null;
    const pending = pendingChallenge;
    if (pending) {
      stopChallenge = drawChallenge({ doc, win, t, locale }, ui.challenge, pending);
    }
    renderPanelBody();
    if (pending && state.open) ui.challenge.title.focus();
  }

  const askHuman: ChallengeHandler = (details) => {
    // A second ask while one is up (a poll re-minting behind a send) shares the
    // visitor's answer instead of stacking a second box.
    if (pendingChallenge) {
      return new Promise((resolve) => {
        const first = pendingChallenge!.settle;
        pendingChallenge!.settle = (token) => {
          first(token);
          resolve(token);
        };
      });
    }
    return new Promise((resolve) => {
      const failed = details.reason === 'challenge_failed';
      pendingChallenge = {
        details,
        failed,
        settle: (token) => {
          pendingChallenge = null;
          resolve(token);
          renderChallenge();
        },
      };
      // Drawn even while the panel is closed (a background mint): the visitor
      // meets it when they open the panel, never as a panel that opens itself.
      renderChallenge();
    });
  };
  api.onChallenge(askHuman);

  const state: State = {
    open: false,
    connected: false,
    online: false,
    chatId: null,
    threadId: null,
    queuePosition: null,
    events: [],
    agent: null,
    agentTyping: false,
    greetingOpen: false,
    unread: 0,
    campaign: null,
    prechat: false,
    pendingDetails: null,
    prechatConfig: DEFAULT_PRECHAT_CONFIG,
    preChatFields: [],
    pendingCustomFields: null,
    postChatFields: [],
    postChat: null,
    postChatSubmitting: false,
    postChatError: false,
    ticketFields: [],
    prospectFields: [],
    offlineSent: false,
    offlineSubmitting: false,
    offlineError: false,
    error: null,
    sending: false,
    pendingAttachment: null,
    uploading: false,
    rating: null,
    ratingSubmitting: false,
    closed: false,
    owner: null,
    humanButtonLabel: null,
    humanRequesting: false,
    resolutionAnswered: null,
    fileSharingEnabled: true,
  };

  /**
   * The unread watermark (FR-MOD-11.1), read once here and written back
   * whenever the visitor has the transcript on screen. Null on a first-ever
   * visit — and then everything from the team counts as unread, which is the
   * safe direction: a badge for a reply they had already seen costs one glance,
   * a missing badge costs the reply.
   */
  let lastRead = lastReadAt(win);

  /**
   * The reply preview (owner, 2026-10-13). `previewSeen` is every team message
   * the widget has already accounted for — filled from the transcript the first
   * time one loads — so the replies a returning visitor was already told about
   * (that is what the badge is for) do not pop a card on every page they open.
   * Only a reply that lands while they are on this page is previewed.
   */
  let previewSeen: Set<string> | null = null;
  let previewEvent: WidgetEvent | null = null;
  let previewTimer: ReturnType<typeof setTimeout> | null = null;

  // `let`: the one language swap after the mint builds a fresh set of elements
  // (`rebuildUi`), and every handler reads `ui` when it runs, not when it was set.
  let ui = buildUi(doc, t);
  // Non-null past the guard above; aliased so the appearance closure keeps that
  // narrowing (TypeScript drops it for the captured `root` inside a function).
  const rootEl = root;
  rootEl.append(ui.panel, ui.greeting, ui.preview, ui.launcher);

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
    renderFooter(doc, ui, appearance, t);
    renderWelcome(doc, ui, appearance, t);
  }

  applyAppearance();

  // --- Language (WG-02) ----------------------------------------------------

  /**
   * What the shell around the panel looks like for this kind of page: the hosted
   * Chat page is all conversation (no launcher, no close, always open), anywhere
   * else the panel follows `state.open`. Separate from `setOpen` so a rebuilt
   * set of elements can be put back the way the old one was.
   */
  function applyShell(): void {
    if (config.chatPage) {
      ui.launcher.hidden = true;
      ui.close.hidden = true;
      ui.panel.hidden = false;
    } else {
      ui.panel.hidden = !state.open;
    }
  }

  /**
   * The mint named the panel's language: if that changes what the visitor reads,
   * switch to it. Nothing happens in the common case — a browser language we
   * ship and the panel on `auto` was already the first draw — and a snippet's
   * explicit language is never overridden, so the chain stays that of
   * `pickWidgetLocale`. A given mint can only move the widget once.
   */
  function adoptMintedLanguage(panel: string, fallback: string): void {
    const next = pickWidgetLocale({ snippet: config.language, panel, fallback, browser });
    if (next === locale) return;
    locale = next;
    translate = createTranslator(next);
    applyDocumentLocale();
    rebuildUi();
  }

  /**
   * Draw the widget's elements again in the new language. The strings of the
   * static shell are written when it is built, so a swap means a new shell; what
   * the visitor already typed is carried over, and the mint that called this
   * goes on to fill in the transcript, the forms and the header from state.
   */
  function rebuildUi(): void {
    const old = ui;
    const carried = [
      'input',
      'prechatName',
      'prechatUsername',
      'prechatEmail',
      'prechatMessage',
      'offlineSubject',
      'offlineName',
      'offlineEmail',
    ] as const;
    const typed = carried.map((key) => old[key].value);
    const focusInside = old.panel.contains(doc.activeElement);

    old.style.remove();
    old.panel.remove();
    old.greeting.remove();
    old.preview.remove();
    old.launcher.remove();

    ui = buildUi(doc, t);
    rootEl.append(ui.panel, ui.greeting, ui.preview, ui.launcher);
    wireUi();
    applyShell();
    carried.forEach((key, index) => {
      ui[key].value = typed[index] ?? '';
    });
    // The new transcript starts empty; `renderEvents` appends only what it has
    // not drawn yet.
    renderedCount = 0;
    applyAppearance();
    renderConnection();
    renderHumanButton();
    if (pendingChallenge) renderChallenge();
    resize();
    if (state.open && focusInside) (state.prechat ? firstPrechatInput() : ui.input).focus();
  }

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
      ui.transcript.append(renderBubble(doc, event, api, attachmentCache, t, locale));
      // The player's answer to the e-mail card, here or from another tab: the
      // card above it stops asking.
      if (event.properties?.['system_event'] === ASK_EMAIL_ANSWERED_SYSTEM_EVENT) {
        for (const card of ui.transcript.querySelectorAll<HTMLElement>('.nx-askemail')) {
          settleAskEmailCard(doc, card, t);
        }
      }
    }
    renderedCount = state.events.length;
    ui.transcript.scrollTop = ui.transcript.scrollHeight;
    renderResolution();
  }

  /**
   * Rebuild the transcript from scratch.
   *
   * `renderEvents` only appends, which is right for the common case and wrong
   * whenever `state.events` changed anywhere but at its end — a poll replacing
   * it wholesale, a failed send retracting its bubble, or a socket push
   * replacing an optimistic bubble with the real message.
   */
  function rerenderTranscript(): void {
    renderedCount = 0;
    ui.transcript.replaceChildren(ui.welcome);
    renderEvents();
  }

  /**
   * The header names who the visitor is talking to (FR-MOD-11.3): the AI persona
   * or, once a person takes over, that agent. An avatar when there is one, the
   * initial otherwise — `textContent` throughout so a name can never be markup.
   */
  function renderHeader(): void {
    // The "Rate this chat" menu (FR-MOD-07.8-b) only makes sense once a
    // conversation exists — before the first message, and again once one
    // closes, the automatic rating prompt (see `refresh`) is the only way in.
    ui.menuWrap.hidden = state.chatId === null;
    const agent = state.agent;
    ui.title.textContent = agent?.name ?? t('title.default');
    ui.avatar.replaceChildren();
    ui.avatar.hidden = agent === null;
    // Nobody named yet: the team, drawn as the reference's overlapping trio.
    ui.team.hidden = agent !== null;
    if (!agent) return;
    ui.avatar.dataset['tone'] = avatarTone(agent.name);

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
    // Presentation only: the launcher's status dot and offline grey key off
    // this. Empty until a mint has said whether anyone is available — a
    // first-time visitor is not dialled before they open the panel, and a
    // guessed green dot would promise someone who may not be there.
    rootEl.dataset['presence'] = state.connected ? (state.online ? 'online' : 'offline') : '';
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

  /** The poll's word on who has the connection (tm 308 · AI-29). */
  function noteOwner(snapshot: WidgetState): void {
    state.owner = snapshot.owner ?? null;
    state.humanButtonLabel = snapshot.human_button_label ?? null;
  }

  /**
   * "Talk to an agent" (tm 308 · AI-29 §2, §5): shown while the AI has the
   * open connection — a person assigned or the queue hides it — and while a
   * press is on its way, when it says so and waits. A real `<button>`, so
   * the keyboard reaches it and a screen reader names it by its words.
   */
  function renderHumanButton(): void {
    const label = state.humanButtonLabel;
    ui.humanButton.hidden =
      state.closed || !state.chatId || !label || !(state.humanRequesting || state.owner === 'ai');
    ui.humanButton.disabled = state.humanRequesting;
    ui.humanButton.textContent = state.humanRequesting ? t('human.connecting') : (label ?? '');
    renderResolution();
  }

  /**
   * "Is it solved?" (tm 320.1 · AI-25-S2): Yes / No under the AI's newest
   * message when it asked or said so (`resolution_prompt`), while the AI has
   * the open connection. Anything written after it — the visitor's words, the
   * AI's thanks, a hand-over — takes them away, and so does an answer given.
   * Real `<button>`s in a named group, like the rating's.
   */
  function renderResolution(): void {
    const newest = newestMessage(state.events);
    const prompt =
      newest?.author_type === 'bot' ? newest.properties?.[RESOLUTION_PROMPT_PROPERTY] : undefined;
    ui.resolution.hidden =
      state.closed ||
      !state.chatId ||
      state.owner !== 'ai' ||
      (prompt !== 'asked' && prompt !== 'resolved') ||
      newest?.id === state.resolutionAnswered;
  }

  /**
   * The answer (`POST /customer/chat/resolution`): yes is thanked, no hands
   * the connection to a person — both reach the transcript with the next
   * poll or push. A failed press brings the buttons back.
   */
  async function answerResolution(answer: 'yes' | 'no'): Promise<void> {
    const newest = newestMessage(state.events);
    if (!newest || state.resolutionAnswered === newest.id) return;
    state.resolutionAnswered = newest.id;
    renderResolution();
    try {
      const result = await api.answerResolution(answer);
      state.owner = result.owner;
      state.error = null;
    } catch {
      state.resolutionAnswered = null;
      state.error = t('error.connect');
    }
    renderHumanButton();
    renderStatus();
  }

  /**
   * The press: the AI hands the connection to a person (`POST
   * /customer/chat/request-human`). The answer's owner hides the button; the
   * hand-over's words reach the transcript with the next poll or push.
   */
  async function requestHuman(): Promise<void> {
    if (state.humanRequesting) return;
    state.humanRequesting = true;
    renderHumanButton();
    try {
      const result = await api.requestHuman();
      state.owner = result.owner;
      state.error = null;
    } catch {
      state.error = t('error.connect');
    } finally {
      state.humanRequesting = false;
    }
    renderHumanButton();
    renderStatus();
  }

  // --- Composer emoji picker (FR-MOD-11.4) ----------------------------------

  /** Closed by default and on every outside click / Escape — same shape as the menu below. */
  let emojiOpen = false;

  function renderEmojiPicker(): void {
    ui.emojiPanel.hidden = !emojiOpen;
    ui.emojiButton.setAttribute('aria-expanded', String(emojiOpen));
  }

  /**
   * Inserted at the caret, no trailing space, same as the canned-reply
   * shortcut's non-space cousin (`insertEmojiAtCaret`, not `applyShortcut`).
   *
   * The explicit length guard is the reason this is not a one-line
   * `ui.input.value = …`: `maxLength` only stops a *typed or pasted*
   * keystroke — it does not stop this function's own `.value =` assignment —
   * so without it a picker click past the limit would silently grow the
   * composer beyond what the server's `z.string().max(10_000)` (customer.ts)
   * accepts, and the visitor would only find out on send.
   */
  function insertEmoji(glyph: string): void {
    const caret = ui.input.selectionStart;
    const result = insertEmojiAtCaret(ui.input.value, caret, glyph);
    if (result.text.length > ui.input.maxLength) return;
    ui.input.value = result.text;
    ui.input.focus();
    ui.input.setSelectionRange(result.caret, result.caret);
  }

  // --- Rating (FR-MOD-07.8-b / 08.7.7 / 11.4) -------------------------------

  /** The header's "⋮" dropdown, closed by default and on every outside click. */
  let menuOpen = false;

  function renderMenu(): void {
    ui.menu.hidden = !menuOpen;
    ui.menuButton.setAttribute('aria-expanded', String(menuOpen));
    renderSupportNumber();
  }

  /**
   * The player's own number (ID-05): the Chat ID of the connection the agent
   * has open, read from the same snapshot that tells the panel — never worked
   * out here. Absent until a connection exists. Read from `state` each time the
   * menu is drawn, so a new connection the same day shows its own number.
   */
  function renderSupportNumber(): void {
    const id = state.threadId;
    ui.menuSupport.hidden = id === null;
    ui.menuCopy.hidden = id === null;
    ui.menuSupportId.textContent = id ?? '';
    // A fresh number is not "Copied" yet.
    if (supportCopiedTimer === null) ui.menuCopy.textContent = t('support.copy');
  }

  /** The "Copied" confirmation's timer; null while the item shows its own name. */
  let supportCopiedTimer: ReturnType<typeof setTimeout> | null = null;

  /**
   * Copies only the number. The iframe needs `allow="clipboard-write"` from the
   * loader to write to the clipboard from a cross-origin frame; where it is
   * missing, or the browser refuses, the number is selected instead so a
   * long-press or Ctrl+C finishes the job.
   */
  async function copySupportNumber(): Promise<void> {
    const id = state.threadId;
    if (!id) return;
    const confirm = (): void => {
      ui.menuCopy.textContent = t('support.copied');
      if (supportCopiedTimer !== null) clearTimeout(supportCopiedTimer);
      supportCopiedTimer = setTimeout(() => {
        supportCopiedTimer = null;
        renderSupportNumber();
      }, 1_500);
    };
    try {
      await win.navigator.clipboard.writeText(id);
      confirm();
    } catch {
      const selection = win.getSelection();
      if (!selection) return;
      const range = doc.createRange();
      range.selectNodeContents(ui.menuSupportId);
      selection.removeAllRanges();
      selection.addRange(range);
    }
  }

  /**
   * Not voted: the prompt + both buttons. Voted: a "thanks" line instead of the
   * prompt, buttons left enabled — the visitor can change their mind and it
   * simply posts again (the server writes it onto the same rating). After a
   * vote, an optional comment (WG-11): open at once after a bad one, behind
   * "Add a comment" after a good one, and gone once sent.
   */
  function renderRating(): void {
    const rating = state.rating;
    ui.rating.hidden = rating === null;
    if (!rating) return;
    const voted = rating.value !== null;
    ui.ratingPrompt.hidden = voted;
    ui.ratingThanks.hidden = !voted;
    ui.ratingGood.setAttribute('aria-pressed', String(rating.value === 'good'));
    ui.ratingBad.setAttribute('aria-pressed', String(rating.value === 'bad'));
    ui.ratingGood.disabled = state.ratingSubmitting;
    ui.ratingBad.disabled = state.ratingSubmitting;
    const open = voted && !rating.commented && (rating.value === 'bad' || !!rating.commentOpen);
    ui.ratingComment.hidden = !open;
    ui.ratingComment.classList.toggle('nx-rating-comment-bad', rating.value === 'bad');
    ui.ratingCommentAdd.hidden = !voted || !!rating.commented || open;
    ui.ratingCommentSend.disabled = state.ratingSubmitting;
    ui.ratingThanks.textContent = t(rating.commented ? 'rating.commentThanks' : 'rating.thanks');
  }

  async function sendRatingComment(): Promise<void> {
    const target = state.rating;
    const comment = ui.ratingCommentInput.value.trim();
    if (!target?.value || !comment || state.ratingSubmitting) return;
    state.ratingSubmitting = true;
    renderRating();
    try {
      await api.rate(target.value, { threadId: target.threadId, comment });
      state.rating = { ...target, commented: true };
      ui.ratingCommentInput.value = '';
    } catch (error) {
      // As a vote: the form stays, with the visitor's words, to send again.
      console.warn('siyahtus widget: rating comment failed', error);
    } finally {
      state.ratingSubmitting = false;
      renderRating();
    }
  }

  async function vote(value: 'good' | 'bad'): Promise<void> {
    const target = state.rating;
    if (!target || state.ratingSubmitting) return;
    state.ratingSubmitting = true;
    renderRating();
    try {
      await api.rate(value, { threadId: target.threadId });
      state.rating = { ...target, value };
    } catch (error) {
      // Fire-and-forget from the visitor's perspective, like `typing`/`trackSale`
      // above — a dropped vote is not worth surfacing as a chat-blocking error,
      // and the buttons staying live below means they can just try again.
      console.warn('siyahtus widget: rate failed', error);
    } finally {
      state.ratingSubmitting = false;
      renderRating();
    }
  }

  // --- Post-chat form (FR-MOD-08.7.7) --------------------------------------

  /**
   * The workspace's post-chat questions, shown once the conversation ends and
   * above the CSAT prompt — one screen, form first: the questions are what the
   * workspace asked for, and a visitor who votes and closes the panel would
   * never see them if the order were reversed.
   *
   * Nothing to show when the workspace configures no post-chat fields; the
   * closing experience is then exactly 134.1's, unchanged.
   */
  function renderPostChat(): void {
    const postChat = state.postChat;
    ui.postchat.hidden = postChat === null;
    if (!postChat) return;
    const done = postChat.submitted;
    ui.postchatIntro.hidden = done;
    ui.postchatFields.hidden = done;
    ui.postchatSubmit.hidden = done;
    ui.postchatThanks.hidden = !done;
    ui.postchatSubmit.disabled = state.postChatSubmitting;
    ui.postchatError.hidden = !state.postChatError;
  }

  /** Rebuilt whenever the mint reports the fields — `replaceChildren` inside. */
  function renderPostChatFields(): void {
    renderFormFields(doc, ui.postchatFields, state.postChatFields);
  }

  async function submitPostChat(): Promise<void> {
    const postChat = state.postChat;
    if (!postChat || postChat.submitted || state.postChatSubmitting) return;

    // A required question must be answered; an empty optional one is left out
    // rather than sent blank. Types are validated authoritatively server-side,
    // by the same rule the CRM and the pre-chat answers go through.
    const answers = readFormAnswers(ui.postchatFields);
    if (!answers) return; // a required field was empty and now has focus

    state.postChatSubmitting = true;
    state.postChatError = false;
    renderPostChat();
    try {
      await api.submitPostChatForm(answers);
      // Re-read: a new conversation may have started mid-request, in which case
      // `refresh` has already cleared the form and there is nothing to thank.
      if (state.postChat === postChat) state.postChat = { ...postChat, submitted: true };
    } catch (error) {
      // Surfaced, unlike the rating (`vote` above swallows a failure): the
      // visitor typed answers, and silently dropping them would leave them
      // believing the workspace has details it never received.
      state.postChatError = true;
      console.warn('siyahtus widget: post-chat form failed', error);
    } finally {
      state.postChatSubmitting = false;
      renderPostChat();
    }
  }

  // --- End chat (FR-MOD-11.4-b) ---------------------------------------------

  /** The "End chat" confirmation, closed by default. */
  let endConfirmOpen = false;

  /** Shown as a `role=dialog`, focused on open — cancelling sends nothing. */
  function renderEndConfirm(): void {
    ui.endConfirm.hidden = !endConfirmOpen;
    if (endConfirmOpen) ui.endConfirmCancel.focus();
  }

  /**
   * The composer swapped for a "chat ended" banner, whenever `state.closed` is
   * set — by `endChat` below or by `refresh` noticing the chat is gone. "Start
   * a new chat" only clears the flag; the next message the visitor sends opens
   * a fresh chat through the same path any first message would (`send` below
   * never checks for an existing chat id) — there is no second way in.
   */
  function renderClosed(): void {
    ui.closedBanner.hidden = !state.closed;
    ui.input.disabled = state.closed;
    renderSendButton();
    ui.attach.disabled = state.closed || state.uploading;
    // Hidden rather than merely disabled when the licence has attachments
    // switched off entirely (FR-MOD-08.9.4) — showing it only to refuse a
    // pick a moment later is a worse conversation than not offering it.
    ui.attach.hidden = !state.fileSharingEnabled;
    ui.emojiButton.disabled = state.closed;
  }

  /**
   * Shared by `refresh`'s poll-based detection and `endChat`'s explicit
   * request: raise 134.1's CSAT prompt for the conversation that just ended. A
   * rating already open for that same conversation — voted early from the
   * header menu — is left alone rather than reset (07.8-b's rule, unchanged
   * here). "Conversation" is the chat and its connection (`sameConversation`).
   */
  function noteChatClosed(previousChatId: string, previousThreadId: string | null): void {
    state.closed = true;
    const ended = { chatId: previousChatId, threadId: previousThreadId };
    if (!state.rating || !sameConversation(state.rating, ended)) {
      state.rating = { ...ended, value: null };
    }
    // The post-chat form (FR-MOD-08.7.7) rides the same trigger, so it appears
    // however the conversation ended — the visitor's own "End chat", an agent
    // archiving it, or the idle sweep. Only when the workspace asks something;
    // an already-open form for this conversation is left as it is rather than
    // reset, which would wipe answers a visitor is midway through typing.
    if (
      state.postChatFields.length > 0 &&
      (!state.postChat || !sameConversation(state.postChat, ended))
    ) {
      state.postChat = { ...ended, submitted: false };
      state.postChatError = false;
    }
  }

  async function endChat(): Promise<void> {
    const chatId = state.chatId;
    if (!chatId) return;
    try {
      await api.close();
      const threadId = state.threadId;
      state.chatId = null;
      state.threadId = null;
      state.queuePosition = null;
      noteChatClosed(chatId, threadId);
      renderHeader();
      renderStatus();
      renderPostChat();
      renderRating();
      renderClosed();
    } catch (error) {
      // Unlike `rate`/`typing`, a failed close is worth surfacing: the visitor
      // asked for something to happen and nothing did.
      state.error = t('error.close');
      renderStatus();
      console.warn('siyahtus widget: close failed', error);
    }
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
      : state.greetingOpen || previewEvent !== null
        ? GREETING
        : { width: LAUNCHER_SIZE, height: LAUNCHER_SIZE };
    postToHost(win, {
      type: 'siyahtus:resize',
      width: size.width,
      height: size.height,
      // So the loader can keep the frame in the corner the launcher started in
      // when the language (and so the direction) is only settled after the mint.
      rtl: isRtlLocale(locale),
    });
  }

  /**
   * The launcher's whole visible state: shown or superseded by the panel, its
   * accessible name, and the unread badge (FR-MOD-11.1).
   *
   * The count is on the button's own `aria-label` rather than left to the
   * badge to announce — a screen-reader user hearing "Open chat" has no way to
   * know two replies are waiting behind it. The badge itself is `aria-hidden`
   * so the number is announced once, not twice.
   */
  function renderLauncher(): void {
    // The launcher stays while the panel is open (owner, 2026-10-13): the panel
    // sits above it, clear of the composer, and the launcher turns into its ×.
    ui.launcher.setAttribute('aria-expanded', String(state.open));
    const unread = state.unread;
    ui.launcher.setAttribute(
      'aria-label',
      state.open
        ? t('launcher.close')
        : unread > 0
          ? t('launcher.unread', { n: unread })
          : t('launcher.open'),
    );
    // Not rendered at zero: an empty badge is a permanent dot that means
    // nothing, and it would sit on the launcher of every visitor who has
    // never been answered.
    ui.badge.hidden = unread === 0;
    // Two digits is all the 64 px launcher has room for; past that the exact
    // number stops being the point.
    ui.badge.textContent = unread === 0 ? '' : unread > 9 ? '9+' : String(unread);
    // The KK's "badge/animation on a new greeting": a proactive card owns the
    // attention pulse too, since it has no number to show. Reduced-motion is
    // honoured globally by the stylesheet's last rule.
    ui.launcher.classList.toggle('nx-attention', !state.open && (unread > 0 || state.greetingOpen));
  }

  /**
   * Re-derive the unread count from the transcript, then repaint the launcher.
   *
   * With the panel open there is nothing unread by definition — the newest
   * team message is on screen, so it becomes the watermark. With the panel
   * closed the count is whatever arrived past that watermark. Called after
   * every poll and on every open/close.
   */
  function syncUnread(): void {
    const team = state.events.filter(isTeamMessage);
    if (state.open) {
      const newest = newestTeamMessageAt(state.events);
      if (newest && (lastRead === null || newest > lastRead)) {
        lastRead = newest;
        rememberLastReadAt(win, newest);
      }
      state.unread = 0;
    } else {
      const unread = team.filter((event) => lastRead === null || event.created_at > lastRead);
      state.unread = unread.length;
      // A reply that arrived since the last look, and that this page has not
      // already shown, gets the preview card; the badge above has already
      // counted it either way.
      const seen = previewSeen;
      const fresh = seen ? unread.filter((event) => !seen.has(event.id)) : [];
      const newest = fresh[fresh.length - 1];
      if (newest) showPreview(newest);
    }
    if (state.connected) {
      previewSeen ??= new Set();
      for (const event of team) previewSeen.add(event.id);
    }
    renderLauncher();
  }

  /** Show `event` in the preview card for `PREVIEW_MS`, replacing any shown. */
  function showPreview(event: WidgetEvent): void {
    previewEvent = event;
    const agent = state.agent;
    ui.previewName.textContent = agent?.name ?? t('title.default');
    ui.previewAvatar.replaceChildren();
    ui.previewAvatar.dataset['tone'] = avatarTone(agent?.name ?? t('title.default'));
    if (agent?.avatarUrl) {
      const img = doc.createElement('img');
      img.className = 'nx-avatar-img';
      img.alt = '';
      img.src = agent.avatarUrl;
      ui.previewAvatar.append(img);
    } else {
      ui.previewAvatar.textContent = initial(agent?.name ?? t('title.default'));
    }
    // The team's formatting, as the transcript would show it — never markup.
    ui.previewMsg.replaceChildren();
    if (event.text) appendRichText(doc, ui.previewMsg, event.text);
    else ui.previewMsg.textContent = t('preview.attachment');
    ui.preview.hidden = false;
    // The preview borrows the proactive card's slot and frame while it shows.
    renderCard();
    resize();
    if (previewTimer) clearTimeout(previewTimer);
    previewTimer = setTimeout(hidePreview, PREVIEW_MS);
  }

  /** Tuck the preview away; the greeting, if one is due, takes its slot back. */
  function hidePreview(): void {
    if (previewTimer) clearTimeout(previewTimer);
    previewTimer = null;
    if (previewEvent === null) return;
    previewEvent = null;
    ui.preview.hidden = true;
    renderCard();
    resize();
  }

  function setOpen(open: boolean): void {
    state.open = open;
    ui.panel.hidden = !open;
    // The conversation itself is on screen now; its preview has done its job.
    if (open) hidePreview();

    // Opening supersedes the proactive card, but does not count as dismissing it.
    if (open && state.greetingOpen) {
      state.greetingOpen = false;
      ui.greeting.hidden = true;
    }
    // A campaign card the visitor opened into needs no dismissal record: the
    // send is already stamped delivered server-side (at-most-once), so the
    // same campaign can never be offered again regardless of what the widget
    // remembers locally.
    if (open) state.campaign = null;

    // Opening marks the transcript read and drops the badge; closing starts
    // counting again from the message that was last on screen.
    syncUnread();
    resize();
    postToHost(win, { type: open ? 'siyahtus:open' : 'siyahtus:close' });

    if (open) {
      // Everybody introduces themselves before a first conversation, however
      // they opened the panel — the launcher as much as the greeting's "Let's
      // chat". Not once the pre-chat details are given or a conversation
      // exists — and not for a returning visitor whose mint is still out: they
      // may well have a conversation, and the form flashing up before their
      // transcript replaces it is worse than the mint raising it a moment late.
      if (needsPrechat() && (state.connected || !returningVisitor())) state.prechat = true;
      renderPanelBody();
      (state.prechat ? firstPrechatInput() : ui.input).focus();
      // First open: this mints, fetches and starts the poll. Every open after
      // that it returns immediately — so the panel would otherwise sit on
      // whatever the last slow poll left until the next one, up to half a
      // minute of staleness the visitor is now watching.
      if (state.connected) void refresh();
      void connect();
    }
    // The two cadences are far enough apart (4 s vs 30 s) that waiting out the
    // pending timer would be visible either way: a stale panel on open, or one
    // last needless request on close.
    repollAtOpenState();
  }

  // --- Proactive card: greeting or campaign, one slot (FR-MOD-03.3.2) ------

  /** Which content — if any — currently owns the one proactive-card slot. */
  let shownCardKind: 'campaign' | 'greeting' | null = null;

  /**
   * Campaign vs greeting is a genuine "second card system" only if it grows a
   * second slot, a second dismissal mechanism, a second resize rule. It does
   * not: both live in `ui.greeting`/`GREETING`, both dismiss through the same
   * per-session storage pattern (`campaignDismissed`/`greetingDismissed`) —
   * only the message and the dismissal key differ.
   *
   * Decision (tm 176.3): a campaign wins when both are pending. It is
   * addressed to *this* visitor by something they did; the greeting is the
   * same line for everyone. Showing both, or the generic one first, would
   * bury the targeted message behind a nudge it was built to be better than.
   */
  /** False until the visitor has been on the page for `GREETING_DELAY_MS`. */
  let greetingDue = false;

  function activeCard(): { kind: 'campaign' | 'greeting'; message: string } | null {
    if (state.campaign && !campaignDismissed(win, state.campaign.id)) {
      return { kind: 'campaign', message: state.campaign.message };
    }
    if (greetingDue && !greetingDismissed(win)) {
      return { kind: 'greeting', message: t('greeting.msg') };
    }
    return null;
  }

  /**
   * Re-decide what the proactive-card slot shows, called after every poll and
   * every dismissal. Campaign copy is the workspace's own text — `textContent`
   * only, same rule the transcript follows, so a workspace that types
   * `<script>` into a campaign message gets a literal, inert string on a
   * visitor's page rather than a stored XSS payload (NFR-S6).
   */
  function renderCard(): void {
    const card = activeCard();
    if (state.open || previewEvent !== null || !card) {
      if (state.greetingOpen) {
        state.greetingOpen = false;
        ui.greeting.hidden = true;
        resize();
      }
      shownCardKind = null;
      renderLauncher();
      return;
    }
    shownCardKind = card.kind;
    ui.greeting.dataset['kind'] = card.kind;
    ui.greetMsg.textContent = card.message;
    if (!state.greetingOpen) {
      state.greetingOpen = true;
      ui.greeting.hidden = false;
      resize();
    }
    // A card just took the slot — the launcher's attention cue follows it.
    renderLauncher();
  }

  function dismissCard(): void {
    if (shownCardKind === 'campaign' && state.campaign) {
      rememberCampaignDismissed(win, state.campaign.id);
      state.campaign = null;
    }
    // A visitor who waves away a targeted campaign is not owed the generic
    // nudge behind it either — that would read as a downgrade, not a second
    // chance. Marking the greeting dismissed too keeps this a single "no
    // thanks" for the rest of the session, whichever content they saw.
    rememberGreetingDismissed(win);
    shownCardKind = null;
    state.greetingOpen = false;
    ui.greeting.hidden = true;
    // The card is gone; so is the attention cue that pointed at it. An unread
    // reply still keeps the launcher lit — those are different claims.
    renderLauncher();
    if (!state.open) resize();
  }

  /**
   * Is the offline form what this visitor should be looking at?
   *
   * Every condition is a reason the *live* composer would be the wrong offer:
   * the server says no chat is offered — the workspace's `agents_only` mode
   * with neither an AI nor a person to answer (WG-09), the same rule the
   * endpoint applies to a message left here — and the visitor is not already
   * in a conversation. A chat that just closed keeps
   * its own screen: the CSAT prompt and the post-chat form are already there,
   * and a third panel underneath them would bury both.
   */
  function offlineFormOpen(): boolean {
    return (
      state.connected &&
      !(
        state.canStartChat ??
        (state.online || state.ticketFields.length + state.prospectFields.length === 0)
      ) &&
      state.chatId === null &&
      !state.closed
    );
  }

  /**
   * Who answers, and whether a chat is offered at all (WG-09): the server
   * decides from the workspace's availability mode, an AI that would answer
   * and who accepts chats. A server predating it sends neither, and the
   * widget keeps its old rule (nobody online and a form built).
   */
  function applyAvailability(snapshot: WidgetState): void {
    state.online = snapshot.answered_by ? snapshot.answered_by !== 'none' : snapshot.online;
    state.canStartChat = snapshot.can_start_chat;
  }

  /**
   * Swap the panel body between the pre-chat form, the offline form and the
   * conversation.
   *
   * One function owns which of the three is on screen, and with it whether the
   * composer is. Split across three renderers they would each set
   * `ui.form.hidden` and the last one to run would win — which is a bug that
   * only shows up in whichever order a future caller happens to pick.
   */
  function renderPanelBody(): void {
    // The offline form outranks the pre-chat one: nobody is there to take the
    // conversation the pre-chat form would open, and the offline form asks for
    // the same details on its own.
    const offline = offlineFormOpen();
    const showPrechat = state.prechat && !offline;
    // The human check takes the whole panel while it is up: the conversation,
    // the forms and the composer all wait behind it (tm 339.3).
    const challenging = pendingChallenge !== null;
    ui.challenge.root.hidden = !challenging;
    ui.prechat.hidden = !showPrechat || challenging;
    // Form and thank-you are the two halves of one panel: exactly one is on
    // screen while the offline form is open, neither when it is not.
    ui.offline.hidden = !offline || state.offlineSent || challenging;
    ui.offlineThanks.hidden = !offline || !state.offlineSent || challenging;
    ui.offlineSubmit.disabled = state.offlineSubmitting;
    ui.offlineError.hidden = !state.offlineError;
    ui.transcript.hidden = showPrechat || challenging;
    ui.status.hidden = showPrechat || challenging;
    // The composer stands down while either form is up: during the pre-chat
    // form because the conversation has not started, and during the offline one
    // because there is nobody to receive a live message — offering both would
    // give the visitor two doors, one of which nobody is behind.
    ui.form.hidden = showPrechat || offline || challenging;
    ui.chip.hidden = showPrechat || offline || challenging || state.pendingAttachment === null;
  }

  /** Rebuilt whenever the mint reports the fields — `replaceChildren` inside. */
  function renderOfflineFields(): void {
    renderFormFields(doc, ui.offlineTicketFields, state.ticketFields);
    renderFormFields(doc, ui.offlineProspectFields, state.prospectFields);
  }

  /**
   * Leave the message (FR-MOD-08.7.7): the visitor's words open a ticket, the
   * `ticket` answers land on it and the `prospect` answers on the contact — one
   * request, because the server writes all three in one transaction.
   */
  async function submitOffline(): Promise<void> {
    if (state.offlineSubmitting || state.offlineSent) return;

    const subject = ui.offlineSubject.value.trim();
    if (!subject) {
      ui.offlineSubject.focus();
      return;
    }
    const email = ui.offlineEmail.value.trim();
    if (!email) {
      // Required here as on the pre-chat form, and for a reason of its own the
      // endpoint gives: this message can only be answered somewhere else.
      ui.offlineEmail.focus();
      return;
    }
    // A required question must be answered; an empty optional one is left out
    // rather than sent blank. Types are validated authoritatively server-side.
    const ticketAnswers = readFormAnswers(ui.offlineTicketFields);
    if (!ticketAnswers) return; // a required field was empty and now has focus
    const prospectAnswers = readFormAnswers(ui.offlineProspectFields);
    if (!prospectAnswers) return;

    state.offlineSubmitting = true;
    state.offlineError = false;
    renderPanelBody();
    try {
      const name = ui.offlineName.value.trim();
      await api.leaveTicket({
        subject,
        email,
        ...(name ? { name } : {}),
        ...(Object.keys(ticketAnswers).length > 0 ? { ticket_fields: ticketAnswers } : {}),
        ...(Object.keys(prospectAnswers).length > 0 ? { prospect_fields: prospectAnswers } : {}),
      });
      state.offlineSent = true;
    } catch (error) {
      // Surfaced rather than swallowed, like the post-chat form and unlike the
      // rating: the visitor wrote a message, and letting them believe it was
      // received when it was not is the one outcome this screen must not
      // produce.
      state.offlineError = true;
      console.warn('siyahtus widget: leaving a message failed', error);
    } finally {
      state.offlineSubmitting = false;
      renderPanelBody();
    }
  }

  /**
   * Build the workspace's configurable pre-chat fields (FR-MOD-08.7.7) into the
   * form. Rebuilt whenever the mint reports them; the shared builder's
   * `replaceChildren` keeps it idempotent so a re-connect does not stack
   * duplicates.
   */
  function renderPreChatFields(): void {
    renderFormFields(doc, ui.prechatFields, state.preChatFields);
  }

  /** The four built-in inputs, by the key the brand's form names them with. */
  function prechatInputs(): Record<PrechatFieldKey, HTMLInputElement | HTMLTextAreaElement> {
    return {
      name: ui.prechatName,
      username: ui.prechatUsername,
      email: ui.prechatEmail,
      message: ui.prechatMessage,
    };
  }

  /**
   * Lay the brand's form (WG-01) over the built-in fields: a hidden one leaves
   * the form, and only a required one carries `required` and its star. Called
   * at every mint, so a change saved in the panel reaches the next visitor.
   */
  function applyPrechatConfig(): void {
    const inputs = prechatInputs();
    for (const key of PRECHAT_FIELD_KEYS) {
      const rule = state.prechatConfig.fields[key];
      const input = inputs[key];
      const row = input.closest<HTMLElement>('.nx-field');
      if (row) row.hidden = !rule.visible;
      input.required = rule.required;
      const star = row?.querySelector<HTMLElement>('.nx-field-required');
      if (star) star.hidden = !rule.required;
    }
  }

  /** Does this brand's form ask the visitor anything at all? */
  function prechatActive(): boolean {
    return prechatAsksAnything(state.prechatConfig, state.preChatFields.length);
  }

  /** Where the keyboard lands when the form opens: its first visible field. */
  function firstPrechatInput(): HTMLElement {
    const inputs = prechatInputs();
    const key = PRECHAT_FIELD_KEYS.find((k) => state.prechatConfig.fields[k].visible);
    return key
      ? inputs[key]
      : (ui.prechatFields.querySelector<HTMLElement>('input, textarea, select') ??
          ui.prechatSubmit);
  }

  /**
   * No conversation yet, no pre-chat details given, and a form that asks
   * something — the form is due. A brand that switched it off (WG-01) goes
   * straight to the composer.
   */
  function needsPrechat(): boolean {
    return (
      state.chatId === null &&
      state.events.length === 0 &&
      state.pendingDetails === null &&
      prechatActive()
    );
  }

  function submitPrechat(): void {
    // The brand decides which fixed fields are asked and which must be
    // answered (WG-01; today's default is all four, owner 2026-10-14).
    // Checked here as well as by `required`, because a scripted submit skips
    // the browser's own check; the first empty-but-required or malformed one
    // takes focus and nothing is sent. Hidden fields are not read at all.
    const inputs = prechatInputs();
    const asked = PRECHAT_FIELD_KEYS.filter((key) => state.prechatConfig.fields[key].visible);
    for (const key of asked) {
      const field = inputs[key];
      field.value = field.value.trim();
      const missing = !field.value && state.prechatConfig.fields[key].required;
      if (missing || (field.value && !field.checkValidity())) {
        field.reportValidity();
        field.focus();
        return;
      }
    }

    // The configurable fields (FR-MOD-08.7.7). A required one must be answered
    // before the chat can start; types are validated authoritatively server-side
    // when the answers ride the first message.
    const custom = readFormAnswers(ui.prechatFields);
    if (!custom) return; // a required field was empty and now has focus

    // Only what was asked and answered: an optional field left empty is not
    // sent blank, and the object itself — even empty — marks the form done.
    const details: NonNullable<State['pendingDetails']> = {};
    for (const key of ['name', 'username', 'email'] as const) {
      if (asked.includes(key) && inputs[key].value) details[key] = inputs[key].value;
    }
    state.pendingDetails = details;
    state.pendingCustomFields = Object.keys(custom).length > 0 ? custom : null;
    state.prechat = false;
    renderPanelBody();
    // "Your message" is the conversation's opening line: it goes out through
    // the composer's own path, so the details ride it and a failed send leaves
    // it in the composer to retry rather than losing it. Without one — hidden,
    // or optional and left empty — the composer opens and the visitor's first
    // line there opens the conversation, details riding it the same way.
    const message = asked.includes('message') ? ui.prechatMessage.value : '';
    ui.prechatMessage.value = '';
    if (!message) {
      ui.input.focus();
      return;
    }
    ui.input.value = message;
    void send();
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
  /** Set once `siyahtus('logout')` arrives; see `logout`. */
  let loggingOut = false;

  /**
   * Whether this browser has talked to this workspace before (FR-MOD-11.1) —
   * the id `WidgetApi#connect` stores, per organization, on a successful mint.
   *
   * Read at mount to decide whether to connect without being asked. A
   * first-ever visitor is left alone: they have no conversation, so nothing can
   * be unread, and minting for them would create a customer record for every
   * page view of every site running the snippet. A returning one is connected
   * straight away, because otherwise the badge cannot exist — nothing polls
   * until the panel is opened, and by then the visitor has already found the
   * reply themselves.
   */
  function returningVisitor(): boolean {
    return isReturningVisitor(config.organizationId);
  }

  async function connect(): Promise<void> {
    // Signing out: whatever asks now is speaking for nobody until the fresh
    // document the loader opens next.
    if (state.connected || loggingOut) return;
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
        // Before the appearance is applied: a language change rebuilds the
        // elements, and the footer and welcome text are drawn into the new ones.
        adoptMintedLanguage(api.appearance.language, api.appearance.fallback_language);
        appearance = appearanceFromApi(api.appearance);
        applyAppearance();
      }
      // …and the pre-chat form (FR-MOD-08.7.7). Rendered here rather than at build
      // time because it is per-workspace and only known once the token is minted;
      // an empty list leaves the fixed pre-chat form untouched.
      state.preChatFields = api.preChatForm;
      renderPreChatFields();
      // …and the brand's built-in form (WG-01): which fixed fields it asks,
      // and whether it opens at all.
      state.prechatConfig = api.prechat;
      applyPrechatConfig();
      // …and the post-chat form, held until a conversation ends (FR-MOD-08.7.7).
      state.postChatFields = api.postChatForm;
      renderPostChatFields();
      // …and the two offline forms, held until a poll says nobody is available.
      // Both empty for a workspace that has not built them, which is exactly
      // how the panel stays invisible for everyone else.
      state.ticketFields = api.ticketForm;
      state.prospectFields = api.prospectForm;
      renderOfflineFields();
      state.connected = true;
      applyAvailability(snapshot);
      state.chatId = snapshot.chat?.id ?? null;
      state.threadId = snapshot.chat?.thread_id ?? null;
      state.queuePosition = snapshot.chat?.queue_position ?? null;
      state.events = snapshot.events;
      pendingBubbleIds = [];
      noteTranscriptCursor();
      state.agent = toAgent(snapshot.agent);
      state.agentTyping = snapshot.agent_typing ?? false;
      noteOwner(snapshot);
      state.fileSharingEnabled = api.fileSharingEnabled;
      // Never overwrite a campaign already waiting to be seen — the server
      // will not offer this one again either way (at-most-once), so there is
      // nothing to gain by replacing it and a card mid-read with a new one.
      if (snapshot.campaign && !state.campaign) {
        state.campaign = { id: snapshot.campaign.id, message: snapshot.campaign.message };
      }
      state.error = null;
      // A returning visitor already in a conversation skips the pre-chat form;
      // one without raises it now, if the panel opened before the mint did. A
      // brand whose form asks nothing (WG-01) takes down the default one the
      // panel may have raised while the mint was out.
      if (snapshot.events.length > 0 || !prechatActive()) {
        state.prechat = false;
      } else if (state.open && needsPrechat()) {
        state.prechat = true;
      }
      // Unconditional, unlike the line above: this mint is also the first time
      // the widget knows whether anybody is available, which is what decides
      // between the composer and the offline form.
      renderPanelBody();
      renderEvents();
      renderStatus();
      renderHeader();
      renderTyping();
      renderHumanButton();
      renderPostChat();
      renderRating();
      renderClosed();
      renderCard();
      syncUnread();
      startPolling();
      // After the poll, never instead of it (FR-MOD-11.6): the socket is an
      // optimisation over a path that has to work on its own, and the mint that
      // just returned is what carries both the gateway's address and the
      // credential it logs in with.
      openSocket();
    } catch (error) {
      // A check the visitor turned away is not an outage. A workspace the
      // platform suspended (tm 389.2) is not one a retry will fix either, and
      // says so rather than "try again shortly".
      state.error = t(
        error instanceof WidgetApiError && error.type === 'challenge_required'
          ? 'error.challenge'
          : error instanceof WidgetApiError &&
              error.type === 'not_allowed' &&
              error.details?.reason === 'workspace_suspended'
            ? 'error.suspended'
            : 'error.connect',
      );
      renderStatus();
      // The real reason goes nowhere near the visitor.
      console.warn('siyahtus widget: connect failed', error);
    }
  }

  /**
   * `siyahtus('logout')` (ID-03 · K4 · tm 287.3), relayed here from the loader:
   * the host page signed its own user out, so this browser stops being them.
   *
   * The poll and the socket stop first — nothing may keep talking as the old
   * customer while the browser forgets them. Then every stored identity goes
   * (`WidgetApi#forget`: the localStorage copies here, the `HttpOnly` cookies
   * through the API) and the unread watermark with them, since it belonged to
   * that visitor's conversation. The transcript, the forms and the token are
   * still in this document's memory, so this document does not carry on:
   * `siyahtus:logged-out` tells the loader, which answers the host page's
   * promise and opens a fresh one — a reset no field can be forgotten from.
   * The next visitor starts as a first-time one, and a mint happens only when
   * they open the panel.
   */
  async function logout(): Promise<void> {
    if (loggingOut) return;
    loggingOut = true;
    // A mint already out lands first — it starts the poll and the socket, so
    // stopping them before it would not stop them.
    await connecting;
    if (pollTimer !== null) clearTimeout(pollTimer);
    pollTimer = null;
    polling = false;
    socket?.close();
    socket = null;
    state.connected = false;
    await api.forget();
    forgetLastReadAt(win);
    postToHost(win, { type: 'siyahtus:logged-out' });
  }

  /**
   * `siyahtus('trackSale', …)` (FR-MOD-13.5), relayed here from the loader. The
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
      console.warn('siyahtus widget: trackSale failed', error);
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
      state.error = uploadRefusal(error, t, locale);
      renderStatus();
      console.warn('siyahtus widget: upload failed', error);
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

  /**
   * Ids of optimistic bubbles currently standing in `state.events`, oldest
   * first.
   *
   * Needed since the socket (FR-MOD-11.6): the server echoes the visitor's own
   * message back to them as an `incoming_event`, and with a live socket that
   * echo can beat the HTTP response that `send` reconciles against. Without a
   * record of which bubbles are placeholders, the visitor briefly sees their
   * message twice. Kept in step with `state.events` — anything that replaces
   * the transcript wholesale empties this too.
   */
  let pendingBubbleIds: string[] = [];

  async function send(): Promise<void> {
    const text = ui.input.value.trim();
    const attachment = state.pendingAttachment;
    // `connectionLost` too: Enter reaches here without the disabled button.
    if ((!text && !attachment) || state.sending || sendPaused || connectionLost) return;

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
    pendingBubbleIds.push(optimistic.id);
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
        // The language on screen, for the visitor's transcript e-mail (WG-02).
        // Every message carries it; the server only keeps the one that opens a chat.
        locale,
        ...(details ?? {}),
        ...(customFields ? { custom_fields: customFields } : {}),
      });
      state.chatId = result.chat_id;
      state.pendingDetails = null;
      state.pendingCustomFields = null;
      state.error = null;
      await refresh();
    } catch (error) {
      // A workspace whose trial is over refuses every write, the visitor's included
      // (402 `license_expired`, tm 257.15). "Check your connection" would send them
      // hunting for a fault that is not theirs; say the conversation is closed to
      // new messages instead, whatever the deployment.
      // The other refusals are the server answering, so "check your connection"
      // is wrong for them too (tm 259.10): a message the spam filter or a ban
      // turned away needs different words, a 429 needs the visitor to wait.
      state.error = t(sendRefusalKey(error));
      if (error instanceof WidgetApiError && error.status === 429) {
        pauseSending(error.retryAfter);
      }
      // Put the text and attachment back so neither is lost.
      ui.input.value = text;
      state.pendingAttachment = attachment;
      renderChip();
      state.events = state.events.filter((e) => e.id !== optimistic.id);
      pendingBubbleIds = pendingBubbleIds.filter((id) => id !== optimistic.id);
      rerenderTranscript();
      renderStatus();
      console.warn('siyahtus widget: send failed', error);
    } finally {
      state.sending = false;
      renderSendButton();
      ui.input.focus();
    }
  }

  /**
   * Hold Send for the seconds a 429 asked for. The text stays in the box; when
   * the wait is over the "too fast" line goes too, so it does not outlive the
   * reason for it.
   */
  function pauseSending(retryAfter: number | undefined): void {
    sendPaused = true;
    clearTimeout(sendPauseTimer);
    sendPauseTimer = setTimeout(
      () => {
        sendPaused = false;
        renderSendButton();
        if (state.error === t('error.rateLimited')) {
          state.error = null;
          renderStatus();
        }
      },
      Math.min(retryAfter ?? DEFAULT_PAUSE_SECONDS, MAX_PAUSE_SECONDS) * 1000,
    );
  }

  async function refresh(): Promise<void> {
    if (!state.connected) return;
    // The request alone, so that only *it* failing counts against the
    // connection — a rendering fault below is ours, not the network's.
    let snapshot: Awaited<ReturnType<typeof api.state>>;
    try {
      snapshot = await api.state();
    } catch (error) {
      notePollFailed(error);
      console.warn('siyahtus widget: refresh failed', error);
      return;
    }
    if (stopped) return;
    notePollAnswered();
    try {
      const previousChatId = state.chatId;
      const previousThreadId = state.threadId;
      applyAvailability(snapshot);
      state.chatId = snapshot.chat?.id ?? null;
      state.threadId = snapshot.chat?.thread_id ?? null;
      state.queuePosition = snapshot.chat?.queue_position ?? null;

      // The widget holds no socket (see `startPolling` below), so this poll is
      // the only signal that a conversation just ended — agent archive or the
      // idle-timeout sweep alike, same as the visitor's own "End chat"
      // (`endChat` above uses `noteChatClosed` directly instead of waiting for
      // this poll to notice). One left over for an older conversation — or the
      // moment a fresh one starts, a same-day return under the same chat id
      // included (ID-02) — is cleared, since lingering over the new composer
      // would be confusing.
      if (previousChatId && !state.chatId) {
        noteChatClosed(previousChatId, previousThreadId);
      } else if (state.chatId) {
        state.closed = false;
        if (state.rating && !sameConversation(state.rating, state)) {
          state.rating = null;
        }
        // A new conversation is underway — the previous one's questions no
        // longer belong on screen, answered or not.
        if (state.postChat && !sameConversation(state.postChat, state)) {
          state.postChat = null;
          state.postChatError = false;
        }
      }

      // Replace wholesale: the server's view is authoritative and includes the
      // real ids for anything sent optimistically. This is also the whole of
      // catching up after a dropped connection (tm 259.11): the snapshot is the
      // transcript, not a page after a cursor, so whatever arrived while the
      // visitor was cut off is in it — and nothing already on screen can be
      // drawn a second time, because nothing is appended. (The transcript as
      // `GET /customer/chat` serves it: the thread's first 100 events.)
      state.events = snapshot.events;
      pendingBubbleIds = [];
      // Where the socket resumes from if it has to reconnect (FR-MOD-11.6). Set
      // from the poll as well as from pushes, because the two take turns: a
      // socket that comes up after this poll must not replay what is already on
      // screen.
      noteTranscriptCursor();
      state.agent = toAgent(snapshot.agent);
      state.agentTyping = snapshot.agent_typing ?? false;
      noteOwner(snapshot);
      // Same rule as `mint`: a campaign already waiting to be seen is not
      // replaced by whatever the next poll offers.
      if (snapshot.campaign && !state.campaign) {
        state.campaign = { id: snapshot.campaign.id, message: snapshot.campaign.message };
      }
      rerenderTranscript();
      renderStatus();
      renderHeader();
      renderTyping();
      renderHumanButton();
      renderPostChat();
      renderRating();
      renderClosed();
      // Availability is a poll-to-poll fact, so the choice between the composer
      // and the offline form is re-made on every one of them: an agent coming
      // online puts the composer back, and going offline offers the form.
      renderPanelBody();
      renderCard();
      // Last, so it counts against the transcript this poll just installed.
      syncUnread();
    } catch (error) {
      console.warn('siyahtus widget: refresh failed', error);
    }
  }

  // --- Connection state (tm 259.11 · UX audit O2) ---------------------------

  /**
   * Whether the visitor is told the connection dropped.
   *
   * Before this, a failed poll went to `console.warn` and nowhere else: the
   * agent's replies stopped arriving, Send stayed live, and the visitor had no
   * way to tell a dead line from an agent who had gone quiet. Two signals now
   * raise the line under the header — the browser's own `offline` event, which
   * is immediate, and `LOST_AFTER_FAILED_POLLS` polls failing in a row, which is
   * what a server outage or a captive portal looks like (the browser still
   * thinks it is online). A poll the server answers clears both.
   *
   * Send is held while the line shows, rather than queued. A queue would have
   * to replay the message after the connection returns, and `api.send` mints a
   * fresh idempotency key per call — a message whose request reached the server
   * before the response was lost would then post twice. Holding Send leaves the
   * text in the box and the decision with the visitor, who may well want to
   * reword it after reading what arrived in the meantime.
   */
  let failedPolls = 0;
  let browserOffline = false;
  let connectionLost = false;

  function notePollFailed(error: unknown): void {
    // A 4xx is the server answering. A refusal is not a dropped line, and
    // "reconnecting" would promise a recovery that is never coming.
    if (error instanceof WidgetApiError && error.status !== undefined && error.status < 500) {
      notePollAnswered();
      return;
    }
    failedPolls += 1;
    renderConnection();
    // The next poll was armed before this one failed, so without a re-arm the
    // back-off (`pollDelay`) would run one step behind.
    repollAtOpenState();
  }

  function notePollAnswered(): void {
    // An answer beats `navigator.onLine` — the request got through.
    if (failedPolls === 0 && !browserOffline) return;
    failedPolls = 0;
    browserOffline = false;
    renderConnection();
    repollAtOpenState();
  }

  function renderConnection(): void {
    connectionLost = browserOffline || failedPolls >= LOST_AFTER_FAILED_POLLS;
    ui.connection.hidden = !connectionLost;
    // Written and cleared rather than only shown and hidden, so a screen reader
    // announces the change through the live region.
    ui.connection.textContent = connectionLost ? t('connection.lost') : '';
    renderSendButton();
  }

  function renderSendButton(): void {
    ui.send.disabled = state.closed || state.sending || sendPaused || connectionLost;
  }

  // --- Realtime (FR-MOD-11.6) ----------------------------------------------

  /**
   * The socket, once the server has told us where the gateway is.
   *
   * Null on a deployment that publishes no `rtm_url`, which is a supported
   * state: the widget then behaves exactly as it did before this existed.
   */
  let socket: WidgetSocket | null = null;
  /** Drives the poll's cadence — see `SOCKET_POLL_INTERVAL_MS`. */
  let socketLive = false;

  /** Hand the socket the newest real event id, so a reconnect resumes from it. */
  function noteTranscriptCursor(): void {
    const chatId = state.chatId;
    if (!socket || !chatId) return;
    for (let i = state.events.length - 1; i >= 0; i -= 1) {
      const event = state.events[i];
      if (event) {
        socket.noteEvent(chatId, event.id);
        return;
      }
    }
  }

  /**
   * One event from the gateway — a live push, or a replay after a gap.
   *
   * Idempotent by id, which is what makes running a socket and a poll at the
   * same time safe. The window is not hypothetical: the poll fires on its own
   * schedule, a reconnect replays from a cursor that may predate what the poll
   * already fetched, and the visitor's own message comes back to them over both
   * paths. All three land here, and none of them can render twice.
   */
  function applyIncomingEvent(chatId: string, event: WidgetEvent): void {
    // Any chat the gateway addresses to this socket belongs to this visitor —
    // the fan-out matches on the customer id inside their signed token and
    // nothing else. So an unknown chat id while we hold none is this visitor's
    // conversation, adopted here because the send that started it may not have
    // returned yet. A *different* id while we hold one is an older conversation
    // of theirs, and its messages do not belong in this transcript.
    if (!state.chatId) {
      // …unless the conversation just ended. `closed` with no chat id is
      // precisely the state `endChat` leaves behind, and an event still in
      // flight when the visitor pressed "End chat" would otherwise resurrect
      // the conversation they closed.
      if (state.closed) return;
      state.chatId = chatId;
    } else if (state.chatId !== chatId) {
      return;
    }

    if (state.events.some((e) => e.id === event.id)) return;

    // The visitor's own message, coming back from the server while the
    // optimistic bubble that stands for it is still on screen. Swap rather than
    // append: two identical bubbles read as a double send.
    const placeholder = event.author_type === 'customer' ? pendingBubbleIds.shift() : undefined;
    if (placeholder) {
      state.events = state.events.filter((e) => e.id !== placeholder);
      state.events.push(event);
      rerenderTranscript();
    } else {
      state.events.push(event);
      renderEvents();
    }

    // A reply that lands with the panel shut is exactly what the badge is for
    // (FR-MOD-11.1) — and now it can land without a poll having fetched it.
    syncUnread();

    // The AI spoke while the last poll named someone else (tm 308 · AI-29): with
    // a socket the next poll is half a minute off, so ask now who has the
    // connection — the server's word, not a guess from the author — and
    // "Talk to an agent" appears with the reply rather than after it.
    if (isAiMessage(event) && state.owner !== 'ai' && !state.humanRequesting) void refresh();
  }

  /**
   * An event already on screen has been corrected by the agent who sent it
   * (FR-MOD-02.3.7).
   *
   * Replace by id, never append: the correction carries the same event, so a
   * fallback to `applyIncomingEvent` would either be dropped by its
   * already-seen guard (leaving the old wording) or, worse, print the message
   * twice. An id the transcript does not hold is still never adopted — the
   * visitor cannot be shown a message they never received on the grounds that
   * somebody edited it — but it is no longer *dropped*, which is a different
   * thing and was the defect (tm 248).
   *
   * A correction for an unknown id means this transcript is behind, and the
   * window is real rather than theoretical: the snapshot that carries the
   * original is in flight for the length of one request, and a correction
   * landing inside it used to be discarded with nothing left to re-deliver it.
   * A push is not replayed, and the socket's `sync` is structurally blind to
   * edits (an edit mints no `event_sequence` — `apps/rtm/src/sync.ts`), so the
   * only thing left was the 30-second heartbeat poll. Asking the server for the
   * transcript answers the question the push raised without trusting the push's
   * contents: if the event really does belong here it arrives corrected, and if
   * it does not, the refetch shows exactly what it showed before.
   */
  function applyEventUpdated(chatId: string, event: WidgetEvent): void {
    if (state.chatId !== chatId) return;
    const index = state.events.findIndex((e) => e.id === event.id);
    if (index === -1) {
      void refresh();
      return;
    }
    state.events[index] = event;
    // A full rebuild rather than an append: `renderEvents` only ever adds to
    // the end, and this changed something in the middle.
    rerenderTranscript();
  }

  /** The conversation ended — the socket learned it before the next poll would. */
  function applyChatClosed(chatId: string): void {
    if (state.chatId !== chatId) return;
    const threadId = state.threadId;
    state.chatId = null;
    state.threadId = null;
    state.queuePosition = null;
    noteChatClosed(chatId, threadId);
    renderHeader();
    renderStatus();
    renderPostChat();
    renderRating();
    renderClosed();
  }

  function openSocket(): void {
    if (socket || stopped) return;
    const url = api.rtmUrl;
    // No gateway published, or no organization to open one for. Both leave the
    // widget on the polling path it has always had rather than failing.
    if (!url || !config.organizationId) return;

    socket = new WidgetSocket({
      url,
      organizationId: config.organizationId,
      getToken: () => api.token,
      onEvent: applyIncomingEvent,
      onEventUpdated: applyEventUpdated,
      onChatClosed: applyChatClosed,
      // Truncated replay or a conversation gained while away: the poll owns the
      // full transcript, so ask it rather than reconstructing one here.
      onResync: () => void refresh(),
      onStatusChange: (live) => {
        socketLive = live;
        // Move to the other cadence now rather than at the end of the current
        // interval — a socket that just died must not leave the visitor waiting
        // out a 30-second heartbeat before the fast poll resumes.
        repollAtOpenState();
      },
    });
    noteTranscriptCursor();
    socket.connect();
  }

  /**
   * Polling, still — but no longer as the only way a message arrives.
   *
   * A socket (FR-MOD-11.6) carries messages when it can. It often cannot: a
   * corporate proxy that drops WebSocket upgrades, a Content-Security-Policy on
   * the embedding site, a browser tab suspended on a sleeping laptop. So the
   * poll never goes away — it is the floor, and the socket is the optimisation
   * on top of it. `SOCKET_POLL_INTERVAL_MS` explains why it drops to a
   * heartbeat rather than stopping.
   *
   * Kept running while the panel is closed, not just while it is open
   * (FR-MOD-03.3.2): a campaign owed to this visitor is delivered on this same
   * poll (`campaign-delivery.ts`), and the whole point of the proactive card
   * is that it can appear without the visitor having opened anything. Since
   * FR-MOD-11.1 the closed poll carries the unread badge too — but at
   * `CLOSED_POLL_INTERVAL_MS`, not the open panel's four seconds. Still gated
   * on tab visibility — a backgrounded tab gains nothing from polling and only
   * adds load.
   *
   * A self-rescheduling timeout rather than an interval, because the cadence
   * changes with the panel and with the socket: `setInterval` would hold
   * whichever period it was created with for the life of the widget.
   */
  let pollTimer: ReturnType<typeof setTimeout> | null = null;
  let polling = false;
  /** The delay the pending timer was armed with — see `repollAtOpenState`. */
  let armedDelay: number | null = null;

  function startPolling(): void {
    if (polling || stopped) return;
    polling = true;
    schedulePoll();
  }

  function schedulePoll(): void {
    if (pollTimer !== null) clearTimeout(pollTimer);
    // A poll that was in flight when the widget was taken down must not re-arm it.
    if (stopped) return;
    const delay = pollDelay();
    armedDelay = delay;
    pollTimer = setTimeout(() => {
      pollTimer = null;
      armedDelay = null;
      if (!doc.hidden) void refresh();
      schedulePoll();
    }, delay);
  }

  /**
   * How long until the next poll.
   *
   * The four-second cadence exists for one thing only — noticing a reply inside
   * an open conversation. A live socket does that in milliseconds, so with one
   * up the poll falls back to the same heartbeat a closed panel uses, and the
   * requests it saves are the overwhelming majority of them.
   *
   * Failed polls stretch it (tm 259.11): the first failure retries at the
   * usual cadence, each one after doubles it, up to `MAX_BACKOFF_MS`.
   */
  function pollDelay(): number {
    const cadence = !state.open
      ? CLOSED_POLL_INTERVAL_MS
      : socketLive
        ? SOCKET_POLL_INTERVAL_MS
        : POLL_INTERVAL_MS;
    if (failedPolls === 0) return cadence;
    return Math.min(cadence * 2 ** (failedPolls - 1), MAX_BACKOFF_MS);
  }

  /**
   * The cadence may have changed — the panel opened or closed, or the socket
   * came up or went down. Move to the new one now rather than at the end of an
   * interval that no longer applies.
   *
   * Only when it *has* changed, though. Rescheduling restarts the countdown, so
   * a caller that fires repeatedly without changing the answer pushes the next
   * poll further away every time — and since FR-MOD-11.6 there are two callers,
   * one of them a socket that can come and go on a flaky network. The two
   * cadences it toggles between while the panel is shut are the same 30 s, so
   * without this guard a socket reconnecting every twenty seconds would starve
   * the poll that carries the proactive card and the unread badge indefinitely.
   */
  function repollAtOpenState(): void {
    if (polling && pollDelay() !== armedDelay) schedulePoll();
  }

  // --- Wiring --------------------------------------------------------------

  // The browser knows a connection dropped before any poll can (tm 259.11).
  win.addEventListener(
    'offline',
    () => {
      browserOffline = true;
      renderConnection();
    },
    { signal },
  );
  // …and when it is back. Catch up now rather than at the end of a back-off
  // that may have grown to half a minute; the line under the header clears
  // with the first answer (`notePollAnswered`), or here already if only the
  // event had raised it. A hidden tab still waits, as it does for every poll.
  win.addEventListener(
    'online',
    () => {
      browserOffline = false;
      renderConnection();
      if (state.connected) {
        if (!doc.hidden) void refresh();
      } else if (state.open) {
        // The mint itself failed while offline (`error.connect`): retry it.
        void connect();
      }
    },
    { signal },
  );

  // The listeners on the widget's own elements, in one function so a rebuilt
  // set of elements (`rebuildUi`) gets exactly the ones the first set had. The
  // `doc`/`win` listeners around it are set once and read `ui` live.
  function wireUi(): void {
    ui.launcher.addEventListener('click', () => setOpen(!state.open));
    ui.close.addEventListener('click', () => {
      setOpen(false);
      ui.launcher.focus();
    });
    // "Let's chat": open into the pre-chat form (unless a conversation resumes).
    ui.greetChat.addEventListener('click', () => {
      if (prechatActive()) state.prechat = true;
      setOpen(true);
    });
    // "Just browsing": tuck the card away for the rest of the session.
    ui.greetBrowse.addEventListener('click', () => dismissCard());
    // The preview opens the conversation exactly as the launcher does; its × only
    // tucks the card away and leaves the unread badge where it is.
    ui.previewBody.addEventListener('click', () => setOpen(true));
    ui.previewClose.addEventListener('click', () => hidePreview());
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
    ui.emojiButton.addEventListener('click', () => {
      emojiOpen = !emojiOpen;
      renderEmojiPicker();
    });
    // Delegated: the panel holds 24 static glyph buttons built once in `buildUi`.
    ui.emojiPanel.addEventListener('click', (event) => {
      const glyph = (event.target as HTMLElement).closest<HTMLButtonElement>('.nx-emoji-item')
        ?.dataset.emoji;
      if (!glyph) return;
      insertEmoji(glyph);
      emojiOpen = false;
      renderEmojiPicker();
    });
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

    // Header "⋮" menu → "Rate this chat" (FR-MOD-07.8-b): an optional early vote
    // on a conversation that is still open, alongside the automatic prompt
    // `refresh` raises once one closes.
    ui.menuButton.addEventListener('click', () => {
      menuOpen = !menuOpen;
      renderMenu();
    });
    // Stays open after copying: the confirmation is the item's own label.
    ui.menuCopy.addEventListener('click', () => {
      void copySupportNumber();
    });
    ui.humanButton.addEventListener('click', () => {
      void requestHuman();
    });
    ui.resolutionYes.addEventListener('click', () => {
      void answerResolution('yes');
    });
    ui.resolutionNo.addEventListener('click', () => {
      void answerResolution('no');
    });
    ui.menuRate.addEventListener('click', () => {
      menuOpen = false;
      renderMenu();
      if (!state.chatId) return;
      // Reopen for the current conversation without discarding an existing
      // vote for it.
      state.rating =
        state.rating && sameConversation(state.rating, state)
          ? state.rating
          : { chatId: state.chatId, threadId: state.threadId, value: null };
      renderRating();
    });
    ui.postchat.addEventListener('submit', (event) => {
      event.preventDefault();
      void submitPostChat();
    });
    ui.offline.addEventListener('submit', (event) => {
      event.preventDefault();
      void submitOffline();
    });
    ui.ratingGood.addEventListener('click', () => void vote('good'));
    ui.ratingBad.addEventListener('click', () => void vote('bad'));
    ui.ratingDismiss.addEventListener('click', () => {
      state.rating = null;
      renderRating();
    });
    ui.ratingCommentAdd.addEventListener('click', () => {
      if (!state.rating) return;
      state.rating = { ...state.rating, commentOpen: true };
      renderRating();
      ui.ratingCommentInput.focus();
    });
    ui.ratingComment.addEventListener('submit', (event) => {
      event.preventDefault();
      void sendRatingComment();
    });

    // Header "⋮" menu → "End chat" (FR-MOD-11.4-b): menu → confirm → request.
    // Cancelling closes the dialog without sending anything.
    ui.menuEnd.addEventListener('click', () => {
      menuOpen = false;
      renderMenu();
      if (!state.chatId) return;
      endConfirmOpen = true;
      renderEndConfirm();
    });
    ui.endConfirmCancel.addEventListener('click', () => {
      endConfirmOpen = false;
      renderEndConfirm();
      ui.menuButton.focus();
    });
    ui.endConfirmConfirm.addEventListener('click', () => {
      endConfirmOpen = false;
      renderEndConfirm();
      void endChat();
    });
    ui.closedRestart.addEventListener('click', () => {
      state.closed = false;
      renderClosed();
      ui.input.focus();
    });
  }
  wireUi();

  doc.addEventListener(
    'click',
    (event) => {
      if (menuOpen && !ui.menuWrap.contains(event.target as Node)) {
        menuOpen = false;
        renderMenu();
      }
      if (emojiOpen && !ui.emojiWrap.contains(event.target as Node)) {
        emojiOpen = false;
        renderEmojiPicker();
      }
    },
    { signal },
  );

  doc.addEventListener(
    'keydown',
    (event) => {
      if (event.key === 'Escape' && endConfirmOpen) {
        endConfirmOpen = false;
        renderEndConfirm();
        ui.menuButton.focus();
        return;
      }
      if (event.key === 'Escape' && menuOpen) {
        menuOpen = false;
        renderMenu();
        ui.menuButton.focus();
        return;
      }
      if (event.key === 'Escape' && emojiOpen) {
        emojiOpen = false;
        renderEmojiPicker();
        ui.emojiButton.focus();
        return;
      }
      // On the Chat page there is nothing to close to, so Escape must not blank it.
      if (event.key === 'Escape' && state.open && !config.chatPage) {
        setOpen(false);
        ui.launcher.focus();
      }
    },
    { signal },
  );

  win.addEventListener(
    'message',
    (event: MessageEvent) => {
      // The host page is cross-origin and untrusted: accept only the known
      // commands it may issue, and ignore anything else without replying.
      const data = event.data as { type?: unknown; command?: unknown; payload?: unknown };
      if (data?.type === 'siyahtus:host-open') setOpen(true);
      if (data?.type === 'siyahtus:host-close') setOpen(false);
      if (data?.type === 'siyahtus:command' && data.command === 'trackSale')
        void trackSale(data.payload);
      // Only from the page the widget is embedded in: another frame on that page
      // can reach this one too, and must not sign its visitor out.
      if (
        data?.type === 'siyahtus:command' &&
        data.command === 'logout' &&
        event.source === win.parent &&
        !config.chatPage
      ) {
        void logout();
      }
    },
    { signal },
  );

  let greetingTimer: number | undefined;
  if (config.chatPage) {
    // The whole page is the conversation: no launcher, no host to message, open
    // from the start.
    root.classList.add('nx-page');
    applyShell();
    state.open = true;
    renderPanelBody();
    ui.input.focus();
    void connect();
  } else {
    postToHost(win, { type: 'siyahtus:ready', rtl: isRtlLocale(locale) });
    // The proactive nudge, once the visitor has been here a while. A campaign
    // is not held back by this: it is addressed to this visitor and arrives
    // with a poll, which `renderCard` picks up whenever it lands.
    greetingTimer = win.setTimeout(() => {
      greetingDue = true;
      renderCard();
    }, GREETING_DELAY_MS);
    // A visitor who has a conversation here connects without being asked, so
    // the closed panel can find out an agent answered (FR-MOD-11.1). Before
    // this, the first poll of a page load waited for the panel to be opened —
    // which is the one moment an unread badge is of no use any more.
    if (returningVisitor()) void connect();
  }

  return () => {
    stopped = true;
    listening.abort();
    for (const timer of [
      pollTimer,
      previewTimer,
      sendPauseTimer,
      typingThrottle,
      typingStop,
      supportCopiedTimer,
    ]) {
      if (timer != null) clearTimeout(timer);
    }
    win.clearTimeout(greetingTimer);
    pollTimer = null;
    polling = false;
    socket?.close();
    socket = null;
  };
}

// ---------------------------------------------------------------------------

/**
 * Build one input per configurable form field into `host` (FR-MOD-08.7.7).
 *
 * Shared by both placements because they render identically — a pre-chat and a
 * post-chat question differ only in *when* they are asked. `replaceChildren`
 * makes it idempotent, so a re-connect replaces the rows instead of stacking
 * duplicates. Each input carries its definition id and type in `dataset`, which
 * is how `readFormAnswers` gets the answers back out without a parallel model.
 */
function renderFormFields(doc: Document, host: HTMLElement, fields: WidgetFormField[]): void {
  host.replaceChildren();
  for (const field of fields) {
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
      host.append(wrap);
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
    host.append(labelledField(doc, input, field.label, field.required));
  }
}

/** Distinct ids for `labelledField`'s label↔input pairing across every form. */
let fieldSequence = 0;

/**
 * An input with a visible label above it — the field row every widget form
 * shares. A placeholder alone vanishes the moment the visitor starts typing, so
 * which box is which was only ever on screen while every box was empty.
 *
 * Presentation only: the input keeps its own `aria-label`, which still wins
 * as its accessible name, and the required star is `aria-hidden` because
 * `required` already says it to assistive technology.
 */
function labelledField(
  doc: Document,
  input: HTMLInputElement | HTMLTextAreaElement,
  text: string,
  required: boolean,
): HTMLElement {
  fieldSequence += 1;
  input.id ||= `nx-field-${fieldSequence}`;
  const row = doc.createElement('div');
  row.className = 'nx-field';
  const label = doc.createElement('label');
  label.className = 'nx-field-label';
  label.htmlFor = input.id;
  label.textContent = text;
  if (required) {
    const star = doc.createElement('span');
    star.className = 'nx-field-required';
    star.setAttribute('aria-hidden', 'true');
    star.textContent = '*';
    label.append(star);
  }
  row.append(label, input);
  return row;
}

/**
 * The answers currently typed into a field host, keyed by definition id — or
 * `null` when a required field is empty, in which case it is focused first so
 * the visitor is taken to what is missing.
 *
 * An empty optional field is left out rather than sent blank: the server reads
 * a blank as "clear this field", and a visitor who skipped a question did not
 * ask to erase an answer they gave earlier. A checkbox always has an answer.
 */
function readFormAnswers(host: HTMLElement): Record<string, string> | null {
  const answers: Record<string, string> = {};
  for (const el of host.querySelectorAll<HTMLInputElement>('input[data-def-id]')) {
    const id = el.dataset.defId ?? '';
    if (!id) continue;
    if (el.dataset.fieldType === 'boolean') {
      answers[id] = el.checked ? 'true' : 'false';
      continue;
    }
    const value = el.value.trim();
    if (!value) {
      if (el.required) {
        el.focus();
        return null;
      }
      continue;
    }
    answers[id] = value;
  }
  return answers;
}

interface Ui {
  /** The injected stylesheet — removed with the rest when the elements are rebuilt. */
  style: HTMLStyleElement;
  launcher: HTMLButtonElement;
  /** Unread count on the launcher (FR-MOD-11.1); hidden at zero. */
  badge: HTMLElement;
  panel: HTMLElement;
  transcript: HTMLElement;
  welcome: HTMLElement;
  welcomeBubble: HTMLElement;
  prechatIntro: HTMLElement;
  typing: HTMLElement;
  /** "Talk to an agent" while the AI answers (tm 308 · AI-29). */
  humanButton: HTMLButtonElement;
  /** "Is it solved?" Yes / No under the AI's prompt (tm 320.1 · AI-25-S2). */
  resolution: HTMLElement;
  resolutionYes: HTMLButtonElement;
  resolutionNo: HTMLButtonElement;
  status: HTMLElement;
  /** "Connection lost, reconnecting…" under the header (tm 259.11); hidden while connected. */
  connection: HTMLElement;
  chip: HTMLElement;
  form: HTMLFormElement;
  input: HTMLTextAreaElement;
  attach: HTMLButtonElement;
  file: HTMLInputElement;
  /** Composer emoji picker (FR-MOD-11.4): trigger + panel, closed by default. */
  emojiWrap: HTMLElement;
  emojiButton: HTMLButtonElement;
  emojiPanel: HTMLElement;
  send: HTMLButtonElement;
  close: HTMLButtonElement;
  avatar: HTMLElement;
  /** Stand-in for the avatar until an agent or persona is named. */
  team: HTMLElement;
  title: HTMLElement;
  /** Header "⋮" dropdown (FR-MOD-07.8-b): early "Rate this chat" access. */
  menuWrap: HTMLElement;
  menuButton: HTMLButtonElement;
  menu: HTMLElement;
  menuRate: HTMLButtonElement;
  /** Header "⋮" → the player's own number (ID-05): the Chat ID, named and copyable. */
  menuSupport: HTMLElement;
  menuSupportId: HTMLElement;
  menuCopy: HTMLButtonElement;
  /** Header "⋮" → "End chat" (FR-MOD-11.4-b). */
  menuEnd: HTMLButtonElement;
  /** The "End chat" confirmation dialog — `role=dialog`, focused on open. */
  endConfirm: HTMLElement;
  endConfirmCancel: HTMLButtonElement;
  endConfirmConfirm: HTMLButtonElement;
  /** Shown instead of an active composer once the chat has ended. */
  closedBanner: HTMLElement;
  closedRestart: HTMLButtonElement;
  /** The post-chat form (FR-MOD-08.7.7) — above the CSAT prompt once a chat ends. */
  postchat: HTMLFormElement;
  postchatIntro: HTMLElement;
  postchatFields: HTMLDivElement;
  postchatSubmit: HTMLButtonElement;
  postchatThanks: HTMLElement;
  postchatError: HTMLElement;
  /**
   * The offline form (FR-MOD-08.7.7) — shown instead of the composer when
   * nobody is available and the workspace has built one. Two field hosts, one
   * per placement, because the two go to different places: `ticket` answers to
   * the ticket the message opens, `prospect` answers to the contact.
   */
  offline: HTMLFormElement;
  offlineSubject: HTMLInputElement;
  offlineName: HTMLInputElement;
  offlineEmail: HTMLInputElement;
  offlineTicketFields: HTMLDivElement;
  offlineProspectFields: HTMLDivElement;
  offlineSubmit: HTMLButtonElement;
  offlineThanks: HTMLElement;
  offlineError: HTMLElement;
  /** The CSAT prompt itself — shown automatically on close, or from the menu. */
  rating: HTMLElement;
  ratingPrompt: HTMLElement;
  ratingGood: HTMLButtonElement;
  ratingBad: HTMLButtonElement;
  ratingThanks: HTMLElement;
  ratingDismiss: HTMLButtonElement;
  /** The optional comment after a vote (WG-11), and the link that opens it after a good one. */
  ratingComment: HTMLFormElement;
  ratingCommentInput: HTMLTextAreaElement;
  ratingCommentSend: HTMLButtonElement;
  ratingCommentAdd: HTMLButtonElement;
  greeting: HTMLElement;
  greetMsg: HTMLElement;
  preview: HTMLElement;
  previewAvatar: HTMLElement;
  previewBody: HTMLButtonElement;
  previewName: HTMLElement;
  previewMsg: HTMLElement;
  previewClose: HTMLButtonElement;
  greetChat: HTMLButtonElement;
  greetBrowse: HTMLButtonElement;
  prechat: HTMLFormElement;
  /** The human check, drawn in place of the conversation only while the API asks for one (tm 339.3). */
  challenge: ChallengeParts;
  prechatName: HTMLInputElement;
  prechatUsername: HTMLInputElement;
  prechatEmail: HTMLInputElement;
  prechatMessage: HTMLTextAreaElement;
  /** Holds the workspace's configurable pre-chat fields (FR-MOD-08.7.7). */
  prechatFields: HTMLDivElement;
  prechatSubmit: HTMLButtonElement;
  /** The footer line; holds the brand mark and the privacy link. */
  poweredBy: HTMLElement;
  poweredBrand: HTMLElement;
  poweredSeparator: HTMLElement;
  privacyLink: HTMLAnchorElement;
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

  // Unread badge (FR-MOD-11.1). `aria-hidden` because the launcher's own
  // aria-label already carries the count in words — the number on its own
  // ("2") announced next to "Open chat" says nothing.
  const badge = doc.createElement('span');
  badge.className = 'nx-badge';
  badge.setAttribute('aria-hidden', 'true');
  badge.hidden = true;
  launcher.append(badge);

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
  const team = doc.createElement('span');
  team.className = 'nx-team';
  team.setAttribute('aria-hidden', 'true');
  for (const tone of ['0', '1', '2']) {
    const person = doc.createElement('span');
    person.dataset['tone'] = tone;
    team.append(person);
  }
  identity.append(avatar, team, title);

  // "⋮" menu (FR-MOD-07.8-b / 11.4-b): "Rate this chat" and "End chat". Hidden
  // until a conversation exists — `renderHeader` toggles it.
  const menuWrap = doc.createElement('div');
  menuWrap.className = 'nx-menu-wrap';
  menuWrap.hidden = true;
  const menuButton = doc.createElement('button');
  menuButton.type = 'button';
  menuButton.className = 'nx-menu-btn';
  menuButton.setAttribute('aria-haspopup', 'true');
  menuButton.setAttribute('aria-expanded', 'false');
  menuButton.setAttribute('aria-label', t('rating.menuLabel'));
  menuButton.textContent = '⋮';
  const menu = doc.createElement('div');
  menu.className = 'nx-menu';
  menu.hidden = true;
  menu.setAttribute('role', 'menu');
  const menuRate = doc.createElement('button');
  menuRate.type = 'button';
  menuRate.className = 'nx-menu-rate';
  menuRate.setAttribute('role', 'menuitem');
  menuRate.textContent = t('rating.menuItem');
  // "Your support number" (ID-05 · ID-05-S1: the player sees the Chat ID only).
  // It is the number of the connection the agent has open — the one the panel
  // calls Chat ID — so what the player reads out is what the team searches for.
  const menuSupport = doc.createElement('div');
  menuSupport.className = 'nx-menu-support';
  menuSupport.setAttribute('role', 'none');
  menuSupport.hidden = true;
  const menuSupportLabel = doc.createElement('span');
  menuSupportLabel.className = 'nx-menu-support-label';
  menuSupportLabel.textContent = t('support.label');
  const menuSupportId = doc.createElement('span');
  menuSupportId.className = 'nx-menu-support-id';
  menuSupport.append(menuSupportLabel, menuSupportId);
  const menuCopy = doc.createElement('button');
  menuCopy.type = 'button';
  menuCopy.className = 'nx-menu-copy';
  menuCopy.setAttribute('role', 'menuitem');
  menuCopy.hidden = true;
  menuCopy.textContent = t('support.copy');
  const menuEnd = doc.createElement('button');
  menuEnd.type = 'button';
  menuEnd.className = 'nx-menu-end';
  menuEnd.setAttribute('role', 'menuitem');
  menuEnd.textContent = t('chat.end.menuItem');
  menu.append(menuSupport, menuCopy, menuRate, menuEnd);
  menuWrap.append(menuButton, menu);

  // "End chat" confirmation (FR-MOD-11.4-b): a modal card over the panel,
  // focused on open. Cancelling closes it without sending a request.
  const endConfirm = doc.createElement('div');
  endConfirm.className = 'nx-end-confirm';
  endConfirm.hidden = true;
  endConfirm.setAttribute('role', 'dialog');
  endConfirm.setAttribute('aria-modal', 'true');
  endConfirm.setAttribute('aria-label', t('chat.end.confirmLabel'));
  const endConfirmMsg = doc.createElement('p');
  endConfirmMsg.className = 'nx-end-confirm-msg';
  endConfirmMsg.textContent = t('chat.end.confirmMessage');
  const endConfirmActions = doc.createElement('div');
  endConfirmActions.className = 'nx-end-confirm-actions';
  const endConfirmCancel = doc.createElement('button');
  endConfirmCancel.type = 'button';
  endConfirmCancel.className = 'nx-end-confirm-cancel';
  endConfirmCancel.textContent = t('chat.end.cancelButton');
  const endConfirmConfirm = doc.createElement('button');
  endConfirmConfirm.type = 'button';
  endConfirmConfirm.className = 'nx-end-confirm-confirm';
  endConfirmConfirm.textContent = t('chat.end.confirmButton');
  endConfirmActions.append(endConfirmCancel, endConfirmConfirm);
  endConfirm.append(endConfirmMsg, endConfirmActions);

  const close = doc.createElement('button');
  close.type = 'button';
  close.className = 'nx-close';
  close.setAttribute('aria-label', t('launcher.close'));
  close.textContent = '×';
  header.append(identity, menuWrap, close);

  const transcript = doc.createElement('div');
  transcript.className = 'nx-transcript';
  // Announced politely so a screen reader user hears replies without losing
  // their place (design-brief §7).
  transcript.setAttribute('role', 'log');
  transcript.setAttribute('aria-live', 'polite');
  transcript.setAttribute('aria-label', t('transcript.label'));
  // The workspace's welcome message, as the team's first bubble at the top of
  // the conversation (owner, 2026-10-13). Hidden when none is set. Kept as the
  // transcript's first child across rebuilds — see `rerenderTranscript`.
  const welcome = doc.createElement('div');
  welcome.className = 'nx-welcome';
  welcome.hidden = true;
  const welcomeBubble = doc.createElement('div');
  welcomeBubble.className = 'nx-welcome-bubble';
  welcome.append(welcomeBubble);
  transcript.append(welcome);

  // "…is typing" line. Announced politely so a screen-reader visitor hears it
  // without having their reading of a reply interrupted.
  const typing = doc.createElement('p');
  typing.className = 'nx-typing';
  typing.hidden = true;
  typing.setAttribute('role', 'status');
  typing.setAttribute('aria-live', 'polite');

  // "Talk to an agent" (tm 308 · AI-29): above the composer, the whole width,
  // so it never overflows a narrow panel. Hidden until a poll says the AI has
  // the connection.
  const humanButton = doc.createElement('button');
  humanButton.type = 'button';
  humanButton.className = 'nx-human';
  humanButton.hidden = true;

  // "Is it solved?" (tm 320.1 · AI-25-S2): the AI's own message asks it; the
  // two answers sit right under the transcript, named as a group for a screen
  // reader. Hidden until the AI's newest message carries the prompt.
  const resolution = doc.createElement('div');
  resolution.className = 'nx-resolution';
  resolution.setAttribute('role', 'group');
  resolution.setAttribute('aria-label', t('resolution.group'));
  resolution.hidden = true;
  const resolutionYes = doc.createElement('button');
  resolutionYes.type = 'button';
  resolutionYes.className = 'nx-resolution-yes';
  resolutionYes.textContent = t('resolution.yes');
  const resolutionNo = doc.createElement('button');
  resolutionNo.type = 'button';
  resolutionNo.className = 'nx-resolution-no';
  resolutionNo.textContent = t('resolution.no');
  resolution.append(resolutionYes, resolutionNo);

  const status = doc.createElement('p');
  status.className = 'nx-status';
  status.setAttribute('role', 'status');

  // "Connection lost, reconnecting…" (tm 259.11) — under the header rather than
  // beside `status`, because it explains everything below it: why no reply is
  // arriving and why Send is held. Its own element, since `status` already
  // speaks for the queue, the offline team and a refused message.
  const connection = doc.createElement('p');
  connection.className = 'nx-connection';
  connection.hidden = true;
  connection.setAttribute('role', 'status');

  // Post-chat form (FR-MOD-08.7.7): the workspace's questions, asked once the
  // conversation ends. Hidden until `renderPostChat` has something to show —
  // which is never, for a workspace that configures no post-chat fields.
  const postchat = doc.createElement('form');
  postchat.className = 'nx-postchat';
  postchat.hidden = true;
  postchat.setAttribute('aria-label', t('postchat.label'));
  const postchatIntro = doc.createElement('p');
  postchatIntro.className = 'nx-postchat-intro';
  postchatIntro.textContent = t('postchat.intro');
  const postchatFields = doc.createElement('div');
  postchatFields.className = 'nx-prechat-fields';
  const postchatSubmit = doc.createElement('button');
  postchatSubmit.type = 'submit';
  postchatSubmit.className = 'nx-postchat-submit';
  postchatSubmit.textContent = t('postchat.submit');
  const postchatThanks = doc.createElement('p');
  postchatThanks.className = 'nx-postchat-thanks';
  postchatThanks.hidden = true;
  postchatThanks.setAttribute('role', 'status');
  postchatThanks.textContent = t('postchat.thanks');
  // Announced as an alert: the answers are still on screen and the visitor has
  // to press the button again for them to go anywhere.
  const postchatError = doc.createElement('p');
  postchatError.className = 'nx-postchat-error';
  postchatError.hidden = true;
  postchatError.setAttribute('role', 'alert');
  postchatError.textContent = t('postchat.error');
  postchat.append(postchatIntro, postchatFields, postchatSubmit, postchatThanks, postchatError);

  // The offline form (FR-MOD-08.7.7): shown instead of the composer when nobody
  // is available, so the visitor leaves a message that opens a ticket rather
  // than typing into a conversation nobody is in. Hidden until `renderPanelBody`
  // has something to show — which is never, for a workspace that has built
  // neither the `ticket` nor the `prospect` form.
  const offline = doc.createElement('form');
  offline.className = 'nx-offline';
  offline.hidden = true;
  offline.setAttribute('aria-label', t('offline.label'));
  const offlineIntro = doc.createElement('p');
  offlineIntro.className = 'nx-offline-intro';
  offlineIntro.textContent = t('offline.intro');
  // What the visitor needs, in their own words. A single line rather than a
  // textarea because it becomes the ticket's subject, and a box that invites a
  // paragraph the product then truncates would be a promise it cannot keep.
  const offlineSubject = doc.createElement('input');
  offlineSubject.className = 'nx-prechat-input';
  offlineSubject.type = 'text';
  offlineSubject.placeholder = t('offline.subject');
  offlineSubject.setAttribute('aria-label', t('offline.subject'));
  offlineSubject.required = true;
  offlineSubject.maxLength = 200;
  const offlineName = doc.createElement('input');
  offlineName.className = 'nx-prechat-input';
  offlineName.type = 'text';
  offlineName.placeholder = t('offline.name');
  offlineName.setAttribute('aria-label', t('offline.name'));
  offlineName.maxLength = 120;
  // Required — as on the pre-chat form, but for its own reason: this message is
  // answered by e-mail or not at all.
  const offlineEmail = doc.createElement('input');
  offlineEmail.className = 'nx-prechat-input';
  offlineEmail.type = 'email';
  offlineEmail.placeholder = t('offline.email');
  offlineEmail.setAttribute('aria-label', t('offline.emailLabel'));
  offlineEmail.required = true;
  offlineEmail.maxLength = 320;
  // The workspace's own questions, appended after the mint reports them. Two
  // hosts, not one: `readFormAnswers` reads each back separately so an answer
  // about the person can never be sent as an answer about the request.
  const offlineProspectFields = doc.createElement('div');
  offlineProspectFields.className = 'nx-prechat-fields';
  const offlineTicketFields = doc.createElement('div');
  offlineTicketFields.className = 'nx-prechat-fields';
  const offlineSubmit = doc.createElement('button');
  offlineSubmit.type = 'submit';
  offlineSubmit.className = 'nx-offline-submit';
  offlineSubmit.textContent = t('offline.submit');
  const offlineError = doc.createElement('p');
  offlineError.className = 'nx-postchat-error';
  offlineError.hidden = true;
  offlineError.setAttribute('role', 'alert');
  offlineError.textContent = t('offline.error');
  offline.append(
    offlineIntro,
    labelledField(doc, offlineSubject, t('offline.subject'), true),
    labelledField(doc, offlineName, t('offline.name'), false),
    labelledField(doc, offlineEmail, t('offline.emailLabel'), true),
    offlineProspectFields,
    offlineTicketFields,
    offlineSubmit,
    offlineError,
  );
  // Its own element rather than a state of the form, so the answers are gone
  // from the DOM once they are safely stored.
  const offlineThanks = doc.createElement('p');
  offlineThanks.className = 'nx-offline-thanks';
  offlineThanks.hidden = true;
  offlineThanks.setAttribute('role', 'status');
  offlineThanks.textContent = t('offline.thanks');

  // CSAT prompt (FR-MOD-07.8-b). One group, `role=group` + a named label so a
  // screen-reader visitor hears what the two buttons below belong to; hidden
  // until `renderRating` has something to show.
  const rating = doc.createElement('div');
  rating.className = 'nx-rating';
  rating.hidden = true;
  rating.setAttribute('role', 'group');
  rating.setAttribute('aria-label', t('rating.group'));
  const ratingPrompt = doc.createElement('p');
  ratingPrompt.className = 'nx-rating-prompt';
  ratingPrompt.textContent = t('rating.prompt');
  const ratingThanks = doc.createElement('p');
  ratingThanks.className = 'nx-rating-thanks';
  ratingThanks.hidden = true;
  ratingThanks.setAttribute('role', 'status');
  ratingThanks.textContent = t('rating.thanks');
  const ratingActions = doc.createElement('div');
  ratingActions.className = 'nx-rating-actions';
  const ratingGood = doc.createElement('button');
  ratingGood.type = 'button';
  ratingGood.className = 'nx-rating-good';
  ratingGood.setAttribute('aria-pressed', 'false');
  // Text-labeled, not emoji-only — the glyph is decoration (NFR-a11y).
  ratingGood.textContent = `👍 ${t('rating.good')}`;
  const ratingBad = doc.createElement('button');
  ratingBad.type = 'button';
  ratingBad.className = 'nx-rating-bad';
  ratingBad.setAttribute('aria-pressed', 'false');
  ratingBad.textContent = `👎 ${t('rating.bad')}`;
  ratingActions.append(ratingGood, ratingBad);
  const ratingDismiss = doc.createElement('button');
  ratingDismiss.type = 'button';
  ratingDismiss.className = 'nx-rating-dismiss';
  ratingDismiss.textContent = t('rating.dismiss');
  // The comment (WG-11): a labelled box, plain text, as long as the API takes.
  const ratingComment = doc.createElement('form');
  ratingComment.className = 'nx-rating-comment';
  ratingComment.hidden = true;
  ratingComment.noValidate = true;
  const ratingCommentLabel = doc.createElement('label');
  ratingCommentLabel.className = 'nx-field-label';
  ratingCommentLabel.htmlFor = 'nx-rating-comment-input';
  ratingCommentLabel.textContent = t('rating.commentLabel');
  const ratingCommentInput = doc.createElement('textarea');
  ratingCommentInput.id = 'nx-rating-comment-input';
  ratingCommentInput.className = 'nx-prechat-input nx-prechat-message';
  ratingCommentInput.maxLength = 1000;
  ratingCommentInput.rows = 3;
  const ratingCommentSend = doc.createElement('button');
  ratingCommentSend.type = 'submit';
  ratingCommentSend.className = 'nx-postchat-submit';
  ratingCommentSend.textContent = t('rating.commentSend');
  ratingComment.append(ratingCommentLabel, ratingCommentInput, ratingCommentSend);
  const ratingCommentAdd = doc.createElement('button');
  ratingCommentAdd.type = 'button';
  ratingCommentAdd.className = 'nx-rating-add';
  ratingCommentAdd.hidden = true;
  ratingCommentAdd.textContent = t('rating.commentAdd');
  rating.append(
    ratingPrompt,
    ratingThanks,
    ratingActions,
    ratingComment,
    ratingCommentAdd,
    ratingDismiss,
  );

  // "Chat ended" banner (FR-MOD-11.4-b): shown instead of an active composer
  // once `state.closed` is set; "Start a new chat" just clears it.
  const closedBanner = doc.createElement('div');
  closedBanner.className = 'nx-closed';
  closedBanner.hidden = true;
  const closedMsg = doc.createElement('p');
  closedMsg.className = 'nx-closed-msg';
  closedMsg.textContent = t('chat.end.closedMessage');
  const closedRestart = doc.createElement('button');
  closedRestart.type = 'button';
  closedRestart.className = 'nx-closed-restart';
  closedRestart.textContent = t('chat.end.startNew');
  closedBanner.append(closedMsg, closedRestart);

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

  // Emoji picker (FR-MOD-11.4): a categorised popup, same shape as the header
  // "⋮" menu — a trigger + an absolutely-positioned panel, opened upward
  // (`bottom: 100%` in the stylesheet below) since the composer sits at the
  // bottom of the panel and a downward panel would open off the visible card.
  const emojiWrap = doc.createElement('div');
  emojiWrap.className = 'nx-emoji-wrap';
  const emojiButton = doc.createElement('button');
  emojiButton.type = 'button';
  emojiButton.className = 'nx-emoji-btn';
  emojiButton.setAttribute('aria-haspopup', 'true');
  emojiButton.setAttribute('aria-expanded', 'false');
  emojiButton.setAttribute('aria-label', t('emoji.trigger'));
  // A glyph rather than an SVG, same call as the paperclip button beside it.
  emojiButton.textContent = '🙂';
  const emojiPanel = doc.createElement('div');
  emojiPanel.className = 'nx-emoji-panel';
  emojiPanel.hidden = true;
  for (const category of WIDGET_EMOJI_CATEGORIES) {
    const heading = doc.createElement('p');
    heading.className = 'nx-emoji-heading';
    heading.id = `nx-emoji-${category.id}`;
    heading.textContent = t(`emoji.category.${category.id}`);
    const group = doc.createElement('div');
    group.className = 'nx-emoji-group';
    group.setAttribute('role', 'group');
    group.setAttribute('aria-labelledby', heading.id);
    for (const glyph of category.items) {
      const item = doc.createElement('button');
      item.type = 'button';
      item.className = 'nx-emoji-item';
      item.textContent = glyph;
      // Read back in `mount` via delegation on `emojiPanel` — `buildUi` only
      // builds DOM, it does not close over `mount`'s `insertEmoji`/`emojiOpen`.
      item.dataset.emoji = glyph;
      group.append(item);
    }
    emojiPanel.append(heading, group);
  }
  emojiWrap.append(emojiButton, emojiPanel);

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

  // One rounded field holding the composer's controls — a wrapper for layout
  // only; every control, and the order a keyboard reaches them, is unchanged.
  const composerField = doc.createElement('div');
  composerField.className = 'nx-composer-field';
  composerField.append(attach, file, emojiWrap, input, send);
  form.append(composerField);

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
  prechatName.autocomplete = 'name';
  prechatName.placeholder = t('prechat.name');
  prechatName.setAttribute('aria-label', t('prechat.name'));
  prechatName.required = true;
  prechatName.maxLength = 120;
  const prechatUsername = doc.createElement('input');
  prechatUsername.className = 'nx-prechat-input';
  prechatUsername.type = 'text';
  prechatUsername.autocomplete = 'username';
  prechatUsername.placeholder = t('prechat.username');
  prechatUsername.setAttribute('aria-label', t('prechat.username'));
  prechatUsername.required = true;
  prechatUsername.maxLength = 120;
  const prechatEmail = doc.createElement('input');
  prechatEmail.className = 'nx-prechat-input';
  prechatEmail.type = 'email';
  prechatEmail.autocomplete = 'email';
  prechatEmail.placeholder = t('prechat.email');
  prechatEmail.setAttribute('aria-label', t('prechat.emailLabel'));
  prechatEmail.required = true;
  prechatEmail.maxLength = 320;
  // The opening message — sent as the conversation's first line on submit.
  const prechatMessage = doc.createElement('textarea');
  prechatMessage.className = 'nx-prechat-input nx-prechat-message';
  prechatMessage.rows = 3;
  prechatMessage.placeholder = t('prechat.message');
  prechatMessage.setAttribute('aria-label', t('prechat.message'));
  prechatMessage.required = true;
  prechatMessage.maxLength = 10_000;
  // The workspace's configurable fields (FR-MOD-08.7.7) are appended here after
  // the token mint reports them — empty (and so invisible) when none are set, so
  // the fixed fields around them are unchanged for a workspace that has no
  // form builder configured.
  const prechatFields = doc.createElement('div');
  prechatFields.className = 'nx-prechat-fields';
  const prechatSubmit = doc.createElement('button');
  prechatSubmit.type = 'submit';
  prechatSubmit.className = 'nx-prechat-submit';
  prechatSubmit.textContent = t('prechat.submit');
  // The intro reads as the team's first message and the fields sit in a card
  // under it, on the team's side of the conversation. Layout wrappers only.
  const prechatCard = doc.createElement('div');
  prechatCard.className = 'nx-prechat-card';
  const prechatHint = doc.createElement('p');
  prechatHint.className = 'nx-prechat-hint';
  prechatHint.textContent = t('prechat.hint');
  prechatCard.append(
    prechatHint,
    labelledField(doc, prechatName, t('prechat.name'), true),
    labelledField(doc, prechatUsername, t('prechat.username'), true),
    labelledField(doc, prechatEmail, t('prechat.emailLabel'), true),
    prechatFields,
    labelledField(doc, prechatMessage, t('prechat.message'), true),
    prechatSubmit,
  );
  prechat.append(prechatIntro, prechatCard);

  // The human check (tm 339.3): hidden until the API answers `challenge_required`.
  const challenge = buildChallengeParts(doc, t);

  // "Powered by SiyahTuş" (FR-MOD-11.5): shown by default, hidden when a workspace
  // removes it. A link, opened in a new tab so it never navigates the panel away
  // from a live conversation.
  //
  // The words are always there; whether they are a link, and where it goes, is
  // the server's to say (`renderFooter`). Next to them sits the deployment's
  // privacy policy, which stays even when a white-label workspace has removed
  // the brand — it is a notice to the visitor, not branding.
  const poweredBy = doc.createElement('p');
  poweredBy.className = 'nx-powered';
  const poweredBrand = doc.createElement('span');
  poweredBrand.className = 'nx-powered-brand';
  const poweredSeparator = doc.createElement('span');
  poweredSeparator.className = 'nx-powered-sep';
  poweredSeparator.setAttribute('aria-hidden', 'true');
  poweredSeparator.textContent = ' · ';
  const privacyLink = doc.createElement('a');
  privacyLink.className = 'nx-powered-link nx-privacy-link';
  privacyLink.target = '_blank';
  privacyLink.rel = 'noopener noreferrer';
  privacyLink.textContent = t('privacy');
  poweredBy.append(poweredBrand, poweredSeparator, privacyLink);

  panel.append(
    header,
    connection,
    endConfirm,
    transcript,
    typing,
    resolution,
    humanButton,
    status,
    // Form before rating: the workspace's own questions come first, so a
    // visitor who votes and closes the panel has still been asked them.
    postchat,
    rating,
    closedBanner,
    prechat,
    challenge.root,
    // Where the composer would be, because it is what the composer is replaced
    // by: nobody is available, so the message goes to a queue rather than to a
    // conversation.
    offline,
    offlineThanks,
    chip,
    form,
    poweredBy,
  );

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

  // Reply preview (owner, 2026-10-13): a reply that lands while the panel is
  // closed shows here for `PREVIEW_MS` — who answered and the first lines of
  // what they said. A status region, so a screen reader hears it arrive; the
  // body is one button, so the whole card opens the conversation, and the ×
  // beside it only tucks the card away (the unread badge stays).
  const preview = doc.createElement('div');
  preview.className = 'nx-preview';
  preview.hidden = true;
  preview.setAttribute('role', 'status');
  const previewAvatar = doc.createElement('span');
  previewAvatar.className = 'nx-preview-avatar';
  previewAvatar.setAttribute('aria-hidden', 'true');
  const previewBody = doc.createElement('button');
  previewBody.type = 'button';
  previewBody.className = 'nx-preview-body';
  const previewName = doc.createElement('span');
  previewName.className = 'nx-preview-name';
  const previewMsg = doc.createElement('span');
  previewMsg.className = 'nx-preview-msg';
  previewBody.append(previewName, previewMsg);
  const previewClose = doc.createElement('button');
  previewClose.type = 'button';
  previewClose.className = 'nx-preview-close';
  previewClose.setAttribute('aria-label', t('preview.dismiss'));
  previewClose.textContent = '×';
  preview.append(previewAvatar, previewBody, previewClose);

  return {
    style,
    launcher,
    badge,
    panel,
    transcript,
    welcome,
    welcomeBubble,
    prechatIntro,
    typing,
    humanButton,
    resolution,
    resolutionYes,
    resolutionNo,
    status,
    connection,
    chip,
    form,
    input,
    attach,
    file,
    emojiWrap,
    emojiButton,
    emojiPanel,
    send,
    close,
    avatar,
    team,
    title,
    menuWrap,
    menuButton,
    menu,
    menuRate,
    menuSupport,
    menuSupportId,
    menuCopy,
    menuEnd,
    endConfirm,
    endConfirmCancel,
    endConfirmConfirm,
    closedBanner,
    closedRestart,
    postchat,
    postchatIntro,
    postchatFields,
    postchatSubmit,
    postchatThanks,
    postchatError,
    offline,
    offlineSubject,
    offlineName,
    offlineEmail,
    offlineTicketFields,
    offlineProspectFields,
    offlineSubmit,
    offlineThanks,
    offlineError,
    rating,
    ratingPrompt,
    ratingGood,
    ratingBad,
    ratingThanks,
    ratingDismiss,
    ratingComment,
    ratingCommentInput,
    ratingCommentSend,
    ratingCommentAdd,
    greeting,
    greetMsg,
    preview,
    previewAvatar,
    previewBody,
    previewName,
    previewMsg,
    previewClose,
    greetChat,
    greetBrowse,
    prechat,
    prechatName,
    prechatUsername,
    prechatEmail,
    prechatMessage,
    prechatFields,
    prechatSubmit,
    challenge,
    poweredBy,
    poweredBrand,
    poweredSeparator,
    privacyLink,
  };
}

/**
 * The footer line (FR-MOD-11.5): "Powered by SiyahTuş" — a link only when the
 * server sent an address, plain words otherwise (the public pilot has none) —
 * and the deployment's privacy policy when it publishes one. The two are
 * independent: a white-label workspace hides the brand and keeps the privacy
 * link, and with neither there is no line at all.
 */
/**
 * The workspace's welcome message (owner, 2026-10-13), in the two places a
 * visitor meets the team first: the pre-chat form's opening bubble, and the top
 * of the conversation for a visitor who goes straight to the composer. With
 * none set, the pre-chat bubble keeps the widget's own line and the transcript
 * shows nothing extra.
 */
function renderWelcome(doc: Document, ui: Ui, appearance: Appearance, t: WidgetTranslate): void {
  const { welcomeTitle: title, welcomeText: text } = appearance;
  const has = title !== null || text !== null;
  for (const host of [ui.prechatIntro, ui.welcomeBubble]) {
    host.replaceChildren();
    if (!has) continue;
    if (title !== null) {
      const strong = doc.createElement('strong');
      strong.className = 'nx-welcome-title';
      strong.textContent = title;
      host.append(strong);
    }
    if (text !== null) {
      const body = doc.createElement('span');
      body.className = 'nx-welcome-text';
      appendWelcomeText(doc, body, text);
      host.append(body);
    }
  }
  if (!has) ui.prechatIntro.textContent = t('prechat.intro');
  ui.welcome.hidden = !has;
}

/** `[label](https://…)` — the one link form the welcome message accepts. */
const WELCOME_LINK = /\[([^\]\n]{1,80})\]\(([^)\s]{1,2048})\)/g;

/**
 * Welcome text as nodes: the composer's bold/italic subset, plus links.
 *
 * The workspace wrote this, but it reaches a stranger's browser, so it gets
 * the transcript's rule — elements and text nodes, never markup. A link target
 * must be an absolute http(s) URL (`webUrl`); anything else (`javascript:`,
 * a relative path) is left on screen as the literal text it was typed as.
 */
function appendWelcomeText(doc: Document, target: HTMLElement, text: string): void {
  let last = 0;
  for (const match of text.matchAll(WELCOME_LINK)) {
    const [whole, label, url] = match as unknown as [string, string, string];
    const start = match.index ?? 0;
    const href = webUrl(url);
    if (href === null) continue;
    if (start > last) appendRichText(doc, target, text.slice(last, start));
    const link = doc.createElement('a');
    link.className = 'nx-welcome-link';
    link.href = href;
    link.target = '_blank';
    link.rel = 'noopener noreferrer';
    link.textContent = label;
    target.append(link);
    last = start + whole.length;
  }
  if (last < text.length) appendRichText(doc, target, text.slice(last));
}

function renderFooter(doc: Document, ui: Ui, appearance: Appearance, t: WidgetTranslate): void {
  const showBrand = appearance.poweredBy;
  const showPrivacy = appearance.privacyPolicyUrl !== null;

  ui.poweredBrand.hidden = !showBrand;
  if (showBrand) {
    let mark: HTMLElement;
    if (appearance.poweredByUrl === null) {
      mark = doc.createElement('span');
      mark.className = 'nx-powered-text';
    } else {
      const link = doc.createElement('a');
      link.className = 'nx-powered-link';
      link.href = appearance.poweredByUrl;
      link.target = '_blank';
      link.rel = 'noopener noreferrer';
      mark = link;
    }
    mark.textContent = t('poweredBy');
    ui.poweredBrand.replaceChildren(mark);
  } else {
    ui.poweredBrand.replaceChildren();
  }

  ui.privacyLink.hidden = !showPrivacy;
  if (appearance.privacyPolicyUrl !== null) ui.privacyLink.href = appearance.privacyPolicyUrl;
  else ui.privacyLink.removeAttribute('href');

  ui.poweredSeparator.hidden = !(showBrand && showPrivacy);
  ui.poweredBy.hidden = !(showBrand || showPrivacy);
}

/**
 * Whether the LLM AI Agent wrote this message. `bot` alone is not enough: rule
 * bots and API bot tokens are `bot` too, and a visitor told "AI" about a
 * scripted menu is told something untrue. Only the AI Agent's own id counts; a
 * message an agent sent after improving it with the Copilot is `agent`.
 */
/** The newest message on the connection, whoever wrote it — a system line is not one. */
function newestMessage(events: readonly WidgetEvent[]): WidgetEvent | null {
  for (let i = events.length - 1; i >= 0; i -= 1) {
    const event = events[i];
    if (event?.type === 'message') return event;
  }
  return null;
}

function isAiMessage(event: WidgetEvent): boolean {
  return event.author_type === 'bot' && event.author_id === AI_BOT_ID;
}

/**
 * The inline "leave your e-mail" card (WG-08 · tm 342): the sentence the server
 * wrote in the player's language, an e-mail box and a send button. Sending
 * stores the address on the contact (`POST /customer/chat/email`); the card
 * then reads as sent, and the server's `ask_email_answered` line follows.
 */
function renderAskEmailCard(
  doc: Document,
  event: WidgetEvent,
  api: WidgetApi,
  t: WidgetTranslate,
): HTMLElement {
  const card = doc.createElement('form');
  card.className = 'nx-askemail';
  card.noValidate = true;
  const text = doc.createElement('p');
  text.className = 'nx-askemail-text';
  text.textContent = event.text ?? '';
  const input = doc.createElement('input');
  input.type = 'email';
  input.className = 'nx-prechat-input';
  input.autocomplete = 'email';
  input.maxLength = 254;
  input.required = true;
  input.placeholder = t('askEmail.label');
  input.setAttribute('aria-label', t('askEmail.label'));
  const send = doc.createElement('button');
  send.type = 'submit';
  send.className = 'nx-askemail-send';
  send.textContent = t('send');
  const note = doc.createElement('p');
  note.className = 'nx-askemail-note';
  note.setAttribute('role', 'alert');
  note.hidden = true;
  card.append(text, input, send, note);

  card.addEventListener('submit', (submitted) => {
    submitted.preventDefault();
    if (!input.value.trim() || !input.checkValidity()) {
      note.textContent = t('askEmail.invalid');
      note.hidden = false;
      input.setAttribute('aria-invalid', 'true');
      return;
    }
    send.disabled = true;
    note.hidden = true;
    api.submitContactEmail(input.value.trim()).then(
      () => settleAskEmailCard(doc, card, t),
      () => {
        send.disabled = false;
        note.textContent = t('askEmail.failed');
        note.hidden = false;
      },
    );
  });
  return card;
}

/** The card after the answer: the sentence stays, the box gives way to "Sent". */
function settleAskEmailCard(doc: Document, card: HTMLElement, t: WidgetTranslate): void {
  if (card.dataset['answered']) return;
  card.dataset['answered'] = 'true';
  const done = doc.createElement('p');
  done.className = 'nx-askemail-done';
  done.textContent = t('askEmail.sent');
  card.replaceChildren(card.querySelector('.nx-askemail-text') ?? '', done);
}

function renderBubble(
  doc: Document,
  event: WidgetEvent,
  api: WidgetApi,
  cache: Map<string, string>,
  t: WidgetTranslate,
  locale: WidgetLocale,
): HTMLElement {
  const row = doc.createElement('div');
  row.className = `nx-row nx-row--${event.author_type}`;

  if (event.type === 'system_message') {
    // The server asks for an e-mail (WG-08 · tm 342): a card with a box, not a pill.
    if (event.properties?.['system_event'] === ASK_EMAIL_SYSTEM_EVENT) {
      row.append(renderAskEmailCard(doc, event, api, t));
      return row;
    }
    const notice = doc.createElement('p');
    // The sensitive-data warning (tm 300.2 · AI-26 §4) is a sentence the
    // visitor has to read, not a "Chat transferred" pill: it is set as a
    // note, in the text colour.
    notice.className =
      event.properties?.['system_event'] === SENSITIVE_WARNING_SYSTEM_EVENT
        ? 'nx-system nx-system--warning'
        : 'nx-system';
    notice.textContent = event.text ?? '';
    row.append(notice);
    return row;
  }

  const bubble = doc.createElement('div');
  bubble.className = 'nx-bubble';
  // Elements and text nodes, never innerHTML — this is the one place agent-
  // and customer-authored text meets the DOM (NFR-S6).
  //
  // The team's side goes through the composer's markdown subset, the same one
  // the agent console renders, so `**important**` reaches the visitor emphasised
  // rather than starred (FR-MOD-11.4, tm 235). A customer's own text never
  // does: their literal asterisks read back exactly as they typed them, which
  // is the rule `Transcript.tsx` already carries on the console side
  // (`#### K02.3.5`). `bot` is whatever answers for the team without a person
  // (the AI Agent, but also a rule bot's script and an API bot's text), so it
  // formats like an agent; `system_message` returned above and never gets here.
  if (event.text) {
    if (event.author_type === 'customer') bubble.textContent = event.text;
    else appendRichText(doc, bubble, event.text);
  }
  if (event.attachment_url)
    bubble.append(renderAttachment(doc, api, event.attachment_url, cache, t));

  const time = doc.createElement('time');
  time.className = 'nx-time';
  time.dateTime = event.created_at;
  time.textContent = formatTime(event.created_at, locale);

  // The AI mark (FR-MOD-11.3) sits beside the time, outside the bubble, so what
  // the visitor copies and what a screen reader reads out of the message is
  // still just the message. Its accessible name says what "AI" means.
  if (isAiMessage(event)) {
    const meta = doc.createElement('div');
    meta.className = 'nx-meta';
    const mark = doc.createElement('span');
    mark.className = 'nx-ai-label';
    mark.setAttribute('role', 'img');
    mark.setAttribute('aria-label', t('message.aiLabel'));
    mark.textContent = t('message.ai');
    meta.append(time, mark);
    row.append(bubble, meta);
  } else {
    row.append(bubble, time);
  }

  // The honest half of an in-place correction (FR-MOD-02.3.7): the visitor
  // cannot see what the message used to say, so they are at least told it
  // changed. Appended after the timestamp rather than folded into it, so the
  // `<time>` element keeps holding a time and nothing else.
  if (readEditedAt(event.properties) !== null) {
    const edited = doc.createElement('span');
    edited.className = 'nx-edited';
    edited.textContent = t('message.edited');
    row.append(edited);
  }

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

/** Clock time in the widget's language, not the browser's (tm 259.10). */
function formatTime(iso: string, locale: WidgetLocale): string {
  const date = new Date(iso);
  return Number.isNaN(date.getTime())
    ? ''
    : date.toLocaleTimeString(locale, { hour: 'numeric', minute: '2-digit' });
}

/** Seconds Send stays held after a 429 that named no `Retry-After`, and the ceiling on one that did. */
const DEFAULT_PAUSE_SECONDS = 5;
const MAX_PAUSE_SECONDS = 60;

/**
 * 403 types that mean "this message / this visitor was turned away". The text is
 * deliberately one generic sentence: the server names no rule so the spam filter
 * cannot be probed (`customer.ts`), and a banned visitor is not told they are.
 */
const REFUSED_403 = new Set([
  'message_rejected',
  'customer_banned',
  'not_allowed',
  'authorization',
]);

/** Which sentence a failed send gets. A dead network (no `WidgetApiError`) keeps the connection one. */
function sendRefusalKey(error: unknown): string {
  if (!(error instanceof WidgetApiError)) return 'error.send';
  if (error.status === 402 && error.type === 'license_expired') return 'error.readOnly';
  if (error.status === 403 && error.type === 'challenge_required') return 'error.challenge';
  if (error.status === 403 && error.type && REFUSED_403.has(error.type)) return 'error.rejected';
  if (error.status === 429) return 'error.rateLimited';
  return 'error.send';
}

/** "10 MB" / "512 KB" — units are the same in every catalog, the digits follow the locale. */
function formatBytes(bytes: number, locale: WidgetLocale): string {
  const mb = bytes / 1_048_576;
  const unit = mb >= 1 ? 'MB' : 'KB';
  const value = mb >= 1 ? mb : Math.max(1, Math.round(bytes / 1024));
  return `${new Intl.NumberFormat(locale, { maximumFractionDigits: 1 }).format(value)} ${unit}`;
}

/**
 * Why an upload was refused. The grant endpoint answers 400 `validation` with the
 * licence's limit in `details` (`uploads.ts`); a 413/415 from the byte PUT or a
 * proxy in front of it means the same two things. Anything else stays generic.
 */
function uploadRefusal(error: unknown, t: WidgetTranslate, locale: WidgetLocale): string {
  if (error instanceof WidgetApiError) {
    const max = error.details?.max_file_size_bytes;
    if (typeof max === 'number' && max > 0) {
      return t('error.uploadTooLargeMax', { max: formatBytes(max, locale) });
    }
    if (error.status === 413) return t('error.uploadTooLarge');
    if (error.details?.allowed_file_types !== undefined || error.status === 415) {
      return t('error.uploadType');
    }
  }
  return t('error.upload');
}

/**
 * Narrow an untrusted `siyahtus('trackSale', …)` payload to the shape the API
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
/**
 * One of the stylesheet's five avatar tints, picked from the name so the same
 * person always gets the same colour — the header and the preview card agree.
 */
function avatarTone(name: string): string {
  let hash = 0;
  for (const char of name) hash = (hash * 31 + char.codePointAt(0)!) >>> 0;
  return String(hash % 5);
}

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

/**
 * The unread watermark (FR-MOD-11.1) — `localStorage`, not the session storage
 * above, because the reply the badge is for usually lands after the tab is
 * gone. Same guard: blocked site data throws, and a widget that cannot
 * remember simply re-badges a message the visitor already read.
 */
function lastReadAt(win: Window): string | null {
  try {
    return win.localStorage.getItem(LAST_READ_KEY);
  } catch {
    return null;
  }
}

function rememberLastReadAt(win: Window, isoDate: string): void {
  try {
    win.localStorage.setItem(LAST_READ_KEY, isoDate);
  } catch {
    // Ignored — the badge just counts from further back next load.
  }
}

/** Drops the watermark on sign-out (tm 287.3): it was the old visitor's. */
function forgetLastReadAt(win: Window): void {
  try {
    win.localStorage.removeItem(LAST_READ_KEY);
  } catch {
    // Ignored — storage that cannot be written holds no watermark either.
  }
}

/**
 * Whether an event is a message *from the team* — the only kind that can be
 * unread. The visitor's own messages are not news to them, and a
 * `system_message` ("Chat transferred") is a notice, not something waiting for
 * an answer: badging it would send a visitor to an empty reply.
 */
function isTeamMessage(event: WidgetEvent): boolean {
  return (
    event.type !== 'system_message' &&
    (event.author_type === 'agent' || event.author_type === 'bot')
  );
}

/** `created_at` of the newest team message in a transcript, or null if none. */
function newestTeamMessageAt(events: WidgetEvent[]): string | null {
  let newest: string | null = null;
  for (const event of events) {
    if (!isTeamMessage(event)) continue;
    if (newest === null || event.created_at > newest) newest = event.created_at;
  }
  return newest;
}

/** Same pattern as `greetingDismissed`, keyed per campaign id. */
function campaignDismissed(win: Window, campaignId: string): boolean {
  try {
    return win.sessionStorage.getItem(CAMPAIGN_DISMISSED_KEY_PREFIX + campaignId) === '1';
  } catch {
    return false;
  }
}

function rememberCampaignDismissed(win: Window, campaignId: string): void {
  try {
    win.sessionStorage.setItem(CAMPAIGN_DISMISSED_KEY_PREFIX + campaignId, '1');
  } catch {
    // Ignored — the card just shows again next time.
  }
}

function defaultApiBaseUrl(): string {
  const baked = import.meta.env['VITE_API_BASE_URL'] as string | undefined;
  return baked && baked !== '' ? baked : 'http://localhost:4000/api/v1';
}

function readConfig(win: Window): WidgetConfig {
  const params = new URLSearchParams(win.location.search);
  // The hosted page is served at `/chat.html`; the query flag is an override for
  // dev and tests opening the widget document directly.
  const chatPage = win.location.pathname.endsWith('/chat.html') || params.get('chat_page') === '1';
  return {
    organizationId: params.get('organization_id') ?? '',
    // Baked in at build time (`VITE_API_BASE_URL`, apps/widget/Dockerfile): the
    // loader forwards no address, and the api is on another origin, so a
    // deployment has nothing else to tell the widget where it is (tm 255.15).
    // The fallback is the demo stack's published api port; `?api=` overrides
    // either for local dev.
    apiBaseUrl: params.get('api') ?? defaultApiBaseUrl(),
    language: params.get('language') || null,
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
    theme:
      theme === 'light' || theme === 'dark' || theme === 'auto' ? theme : DEFAULT_APPEARANCE.theme,
    position: position === 'bottom-left' ? 'bottom-left' : 'bottom-right',
    mobileFullscreen: params.get('mobile_full') !== '0',
    poweredBy: DEFAULT_APPEARANCE.poweredBy,
    // Links are the server's to give, like `powered_by`: a URL param could
    // point the footer anywhere.
    privacyPolicyUrl: DEFAULT_APPEARANCE.privacyPolicyUrl,
    poweredByUrl: DEFAULT_APPEARANCE.poweredByUrl,
    // The welcome message is never in the snippet: the server sends it.
    welcomeTitle: DEFAULT_APPEARANCE.welcomeTitle,
    welcomeText: DEFAULT_APPEARANCE.welcomeText,
  };
}

/** The widget's camelCase appearance from the API's snake_case token payload. */
function appearanceFromApi(a: MintedAppearance): Appearance {
  return {
    primaryColor: COLOR_RE.test(a.primary_color)
      ? a.primary_color.toLowerCase()
      : DEFAULT_APPEARANCE.primaryColor,
    theme: a.theme,
    position: a.position,
    mobileFullscreen: a.mobile_fullscreen,
    poweredBy: a.powered_by,
    privacyPolicyUrl: webUrl(a.privacy_policy_url),
    poweredByUrl: webUrl(a.powered_by_url),
    welcomeTitle: welcomeString(a.welcome_title),
    welcomeText: welcomeString(a.welcome_text),
  };
}

/** A welcome field off the wire: a non-empty string, else null (an older API sends none). */
function welcomeString(value: unknown): string | null {
  return typeof value === 'string' && value.trim() !== '' ? value.trim() : null;
}

/**
 * A link target the footer may use: an absolute http(s) URL, else null. The
 * address comes off the wire and ends up in an `href`, so a `javascript:` or
 * `data:` value must not survive being read.
 */
function webUrl(value: unknown): string | null {
  if (typeof value !== 'string' || value === '') return null;
  try {
    const url = new URL(value);
    return url.protocol === 'https:' || url.protocol === 'http:' ? url.href : null;
  } catch {
    return null;
  }
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
/* The 2026-10 restyle, after the design reference "canli-destek-widget_3".
   Two groups of colour, deliberately kept apart:
   A — the workspace's own (Settings -> Widget): --nx-brand and what derives
       from it. Never touched by the theme.
   B — the theme (light / dark / auto): surfaces, text, fields, shadows. Never
       touched by the workspace.
   Geometry: the loader pins the frame flush to the screen corner and every
   visible part sits --nx-pad (28 px) in from it. The frame's two page-facing
   sides leave room for the whole shadow (see the frame sizes in the script),
   so no shadow is ever cut off into a hard edge. */
:root {
  /* --- A. Brand (FR-MOD-11.7). --nx-brand is overwritten inline from the
     workspace's colour; everything below follows it. */
  --nx-brand: #2d67fa;
  --nx-on-brand: #ffffff;
  /* The reference lets the start button and the visitor's bubble take their
     own colours; this product has one brand colour, so both follow it. */
  --nx-cta: var(--nx-brand);
  --nx-bubble-own: var(--nx-brand);
  --nx-online: #22c55e;
  --nx-offline: #9ca3af;
  --nx-badge: #dc2626;
  --nx-pad: 28px;
  /* Launcher + the reference's 14 px gap: where the cards and the panel start. */
  --nx-above: calc(var(--nx-pad) + 74px);
  --nx-radius: 20px;
  --nx-icon-chat: url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 24 24' fill='none' stroke='%23000' stroke-width='2' stroke-linecap='round' stroke-linejoin='round'%3E%3Cpath d='M21 11.5a8.38 8.38 0 0 1-.9 3.8 8.5 8.5 0 0 1-7.6 4.7 8.38 8.38 0 0 1-3.8-.9L3 21l1.9-5.7a8.38 8.38 0 0 1-.9-3.8 8.5 8.5 0 0 1 4.7-7.6 8.38 8.38 0 0 1 3.8-.9h.5a8.48 8.48 0 0 1 8 8v.5z'/%3E%3C/svg%3E");
  --nx-icon-down: url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 24 24' fill='none' stroke='%23000' stroke-width='2.5' stroke-linecap='round' stroke-linejoin='round'%3E%3Cpath d='m6 9 6 6 6-6'/%3E%3C/svg%3E");
  --nx-icon-more: url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 24 24'%3E%3Ccircle cx='12' cy='5' r='2'/%3E%3Ccircle cx='12' cy='12' r='2'/%3E%3Ccircle cx='12' cy='19' r='2'/%3E%3C/svg%3E");
  --nx-icon-clip: url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 24 24' fill='none' stroke='%23000' stroke-width='2' stroke-linecap='round' stroke-linejoin='round'%3E%3Cpath d='m21.44 11.05-9.19 9.19a6 6 0 0 1-8.49-8.49l9.19-9.19a4 4 0 0 1 5.66 5.66l-9.2 9.19a2 2 0 0 1-2.83-2.83l8.49-8.48'/%3E%3C/svg%3E");
  --nx-icon-smile: url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 24 24' fill='none' stroke='%23000' stroke-width='2' stroke-linecap='round' stroke-linejoin='round'%3E%3Ccircle cx='12' cy='12' r='10'/%3E%3Cpath d='M8 14s1.5 2 4 2 4-2 4-2M9 9h.01M15 9h.01'/%3E%3C/svg%3E");
  --nx-icon-send: url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 24 24' fill='none' stroke='%23000' stroke-width='2' stroke-linecap='round' stroke-linejoin='round'%3E%3Cpath d='M22 2 11 13M22 2l-7 20-4-9-9-4 20-7z'/%3E%3C/svg%3E");
  --nx-icon-x: url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 24 24' fill='none' stroke='%23000' stroke-width='2.5' stroke-linecap='round'%3E%3Cpath d='M18 6 6 18M6 6l12 12'/%3E%3C/svg%3E");
  --nx-icon-user: url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 24 24' fill='none' stroke='%23000' stroke-width='2.2' stroke-linecap='round' stroke-linejoin='round'%3E%3Ccircle cx='12' cy='8' r='4'/%3E%3Cpath d='M4 21a8 8 0 0 1 16 0'/%3E%3C/svg%3E");

  /* --- B. Theme: light (the default). */
  --nx-surface: #ffffff;
  --nx-surface-2: #f8f9fb;
  --nx-field: #f3f4f6;
  --nx-field-border: #e5e7eb;
  --nx-bubble: #eaecf0;
  --nx-pill: #e9ebef;
  --nx-border: #e5e7eb;
  --nx-title: #111827;
  --nx-text: #1f2937;
  --nx-muted: #4b5563;
  --nx-ring: #ffffff;
  --nx-avatar-bg: #c7d2fe;
  --nx-avatar-text: #312e81;
  --nx-typing: #6b7280;
  --nx-launcher-offline: #374151;
  --nx-danger: #b91c1c;
  /* Brand as text on a surface: a little darker than the fill, so a link in
     the team's grey bubble still clears AA (the default brand itself is 4.01:1
     there). */
  --nx-link: color-mix(in srgb, var(--nx-brand) 80%, #000);
  --nx-shadow-launcher: 0 12px 28px rgba(17, 24, 39, .22), 0 2px 6px rgba(17, 24, 39, .10);
  --nx-shadow-launcher-hover: 0 18px 36px rgba(17, 24, 39, .28), 0 3px 8px rgba(17, 24, 39, .12);
  --nx-shadow-card: 0 8px 24px rgba(17, 24, 39, .12), 0 1px 2px rgba(17, 24, 39, .06);
  --nx-shadow-panel: 0 24px 60px rgba(17, 24, 39, .22), 0 2px 8px rgba(17, 24, 39, .10);
  --nx-shadow-soft: 0 1px 2px rgba(17, 24, 39, .06);
  --nx-scheme: light;
  /* Always light here, deliberately — see body below. */
  color-scheme: normal;
}
/* The dark ramp, written once and applied twice: for "auto" when the visitor's
   OS asks for it, and for a workspace that forces dark. */
@media (prefers-color-scheme: dark) {
  :root:not([data-nx-theme="light"]) {
    --nx-surface: #1b1f2a; --nx-surface-2: #141822; --nx-field: #262b38; --nx-field-border: #3a4055;
    --nx-bubble: #2a3040; --nx-pill: #262b38; --nx-border: #2e3444;
    --nx-title: #f3f4f6; --nx-text: #e5e7eb; --nx-muted: #a3a9b8; --nx-ring: #141822;
    --nx-avatar-bg: #3730a3; --nx-avatar-text: #e0e7ff; --nx-typing: #a3a9b8;
    --nx-launcher-offline: #4b5563; --nx-danger: #f87171;
    /* The brand is often too dark to read on a dark surface; a light tint of
       it is, whatever colour the workspace picked. */
    --nx-link: color-mix(in srgb, var(--nx-brand) 42%, #fff);
    --nx-shadow-launcher: 0 12px 28px rgba(0, 0, 0, .45), 0 2px 6px rgba(0, 0, 0, .30);
    --nx-shadow-launcher-hover: 0 18px 36px rgba(0, 0, 0, .55), 0 3px 8px rgba(0, 0, 0, .35);
    --nx-shadow-card: 0 8px 24px rgba(0, 0, 0, .45), 0 1px 2px rgba(0, 0, 0, .30);
    --nx-shadow-panel: 0 24px 60px rgba(0, 0, 0, .55), 0 2px 8px rgba(0, 0, 0, .35);
    --nx-shadow-soft: 0 1px 2px rgba(0, 0, 0, .3);
    --nx-scheme: dark;
  }
}
/* Forced colour scheme (FR-MOD-11.7). A workspace choice wins over the
   visitor's OS in both directions. */
:root[data-nx-theme="dark"] {
  --nx-surface: #1b1f2a; --nx-surface-2: #141822; --nx-field: #262b38; --nx-field-border: #3a4055;
  --nx-bubble: #2a3040; --nx-pill: #262b38; --nx-border: #2e3444;
  --nx-title: #f3f4f6; --nx-text: #e5e7eb; --nx-muted: #a3a9b8; --nx-ring: #141822;
  --nx-avatar-bg: #3730a3; --nx-avatar-text: #e0e7ff; --nx-typing: #a3a9b8;
  --nx-launcher-offline: #4b5563; --nx-danger: #f87171;
  --nx-link: color-mix(in srgb, var(--nx-brand) 42%, #fff);
  --nx-shadow-launcher: 0 12px 28px rgba(0, 0, 0, .45), 0 2px 6px rgba(0, 0, 0, .30);
  --nx-shadow-launcher-hover: 0 18px 36px rgba(0, 0, 0, .55), 0 3px 8px rgba(0, 0, 0, .35);
  --nx-shadow-card: 0 8px 24px rgba(0, 0, 0, .45), 0 1px 2px rgba(0, 0, 0, .30);
  --nx-shadow-panel: 0 24px 60px rgba(0, 0, 0, .55), 0 2px 8px rgba(0, 0, 0, .35);
  --nx-shadow-soft: 0 1px 2px rgba(0, 0, 0, .3);
  --nx-scheme: dark;
}
* { box-sizing: border-box; }
/* The scheme goes on body, never on :root. A browser paints an *opaque* canvas
   behind a frame whose root scheme differs from the embedding page's, so a dark
   :root put a black box around the launcher on every light site a dark-mode
   visitor opened. :root stays "normal" and widget.html's meta pins that to
   light; chat.html, a top-level page, keeps "light dark" for its own canvas. */
/* Manrope, the design reference's face, served from the widget's own origin
   (the frame's CSP is font-src 'self'). Two subsets cut from
   @fontsource-variable/manrope 5.3 with fontTools — weight axis pinned to
   500–700, "kern liga calt" only:
     latin  U+0020-007E, U+00A0-00FF, dashes, quotes, bullet, ellipsis, €, ™
     tr     U+011E-011F, U+0130-0131, U+015E-015F  (ğ Ğ İ ı ş Ş)
   A browser fetches the second only when a page has one of those letters, and
   anything outside both (Arabic, a Polish ł) falls through to the system face.
   ≈22 KB together; NFR-P3's budget was raised to 60 KB for it (2026-10-13).
   "swap": the widget paints at once in the fallback and re-renders when the
   face lands, so the font never holds up the launcher. */
@font-face {
  font-family: "Manrope";
  src: url("/fonts/manrope-latin.woff2") format("woff2");
  font-weight: 500 700; font-style: normal; font-display: swap;
  unicode-range: U+0020-007E, U+00A0-00FF, U+2013-2014, U+2018-201D, U+2022, U+2026, U+20AC, U+2122;
}
@font-face {
  font-family: "Manrope";
  src: url("/fonts/manrope-tr.woff2") format("woff2");
  font-weight: 500 700; font-style: normal; font-display: swap;
  unicode-range: U+011E-011F, U+0130-0131, U+015E-015F;
}
body {
  margin: 0;
  color-scheme: var(--nx-scheme);
  font-family: Manrope, -apple-system, BlinkMacSystemFont, "Segoe UI Variable Text", "Segoe UI", system-ui, sans-serif;
  font-size: 14px;
  font-weight: 500;
  line-height: 1.4;
  color: var(--nx-text);
  -webkit-font-smoothing: antialiased;
}
button { -webkit-tap-highlight-color: transparent; }
/* An icon drawn from one of the masks above, in the element's text colour.
   Its button is a centred flex box at font-size 0: the button's own words stay
   in the DOM as its accessible name but take no room (a grid would give them
   a row of their own and push the icon off centre). */
.nx-launcher::before, .nx-close::before, .nx-menu-btn::before, .nx-attach::before,
.nx-emoji-btn::before, .nx-send::before, .nx-prechat-submit::after {
  content: ""; display: block; flex: none; background: currentColor;
  -webkit-mask: center / contain no-repeat; mask: center / contain no-repeat;
}
@keyframes nx-pop {
  from { opacity: 0; transform: translateY(8px) scale(.98); }
  to { opacity: 1; transform: none; }
}

/* ===== Closed: the launcher ============================================== */
.nx-launcher {
  /* Logical, not right/bottom (NFR-I18N1): mirrors to the visual left under
     dir="rtl" instead of staying pinned to the physical right for Arabic. */
  position: fixed; inset-inline-end: var(--nx-pad); inset-block-end: var(--nx-pad);
  width: 60px; height: 60px; padding: 0; border: 0; border-radius: 50%;
  display: flex; align-items: center; justify-content: center;
  background: var(--nx-brand); color: var(--nx-on-brand); cursor: pointer;
  /* The label stays in the DOM (and in aria-label); the icon is what shows. */
  font: inherit; font-size: 0; font-weight: 600;
  box-shadow: var(--nx-shadow-launcher);
  transition: transform .18s ease, box-shadow .18s ease, background-color .18s ease;
}
.nx-launcher::before {
  width: 28px; height: 28px;
  -webkit-mask-image: var(--nx-icon-chat); mask-image: var(--nx-icon-chat);
}
.nx-launcher:hover { transform: scale(1.06); box-shadow: var(--nx-shadow-launcher-hover); }
/* Open: the launcher stays under the panel and becomes its close button. */
.nx-launcher[aria-expanded="true"]::before {
  width: 24px; height: 24px;
  -webkit-mask-image: var(--nx-icon-x); mask-image: var(--nx-icon-x);
}
.nx-launcher[aria-expanded="true"]::after { display: none; }
.nx-launcher:focus-visible { outline: 3px solid var(--nx-brand); outline-offset: 3px; }
/* Status dot: only once a mint has said whether anyone is there — see
   renderStatus. Offline also greys the launcher itself. */
[data-presence="online"] .nx-launcher::after,
[data-presence="offline"] .nx-launcher::after {
  content: ""; position: absolute; inset-inline-end: 2px; inset-block-end: 2px;
  width: 14px; height: 14px; border-radius: 50%;
  background: var(--nx-online); border: 2.5px solid var(--nx-ring);
}
[data-presence="offline"] .nx-launcher { background: var(--nx-launcher-offline); }
[data-presence="offline"] .nx-launcher::after { background: var(--nx-offline); }
/* Unread badge (FR-MOD-11.1). Logical inset like everything else here, so it
   rides to the launcher's other shoulder under dir="rtl" (NFR-I18N1). */
.nx-badge {
  position: absolute; inset-block-start: -4px; inset-inline-end: -4px;
  min-width: 22px; height: 22px; padding: 0 6px;
  display: inline-flex; align-items: center; justify-content: center;
  border-radius: 11px; border: 2.5px solid var(--nx-ring);
  background: var(--nx-badge); color: #fff;
  font-size: 11px; font-weight: 700; line-height: 1;
}
/* The KK's "badge/animation": a ring that breathes, on the launcher's own
   shadow so nothing shifts in layout. The reduced-motion rule at the end of
   this sheet turns it off for anyone who asked for that. */
.nx-launcher.nx-attention { animation: nx-attention 2s ease-in-out infinite; }
@keyframes nx-attention {
  0%, 100% { box-shadow: var(--nx-shadow-launcher), 0 0 0 0 color-mix(in srgb, var(--nx-brand) 50%, transparent); }
  50% { box-shadow: var(--nx-shadow-launcher), 0 0 0 10px color-mix(in srgb, var(--nx-brand) 0%, transparent); }
}

/* ===== Closed: the greeting / campaign card ============================== */
.nx-greeting {
  /* Logical, same reasoning as .nx-launcher above (NFR-I18N1). 14 px above the
     60 px launcher. */
  position: fixed; inset-inline-end: var(--nx-pad); inset-block-end: var(--nx-above);
  width: 320px;
  background: var(--nx-surface); color: var(--nx-text);
  /* The corner nearest the launcher is the sharp one. */
  border-radius: 18px; border-end-end-radius: 4px;
  box-shadow: var(--nx-shadow-card);
  padding: 12px; display: grid; grid-template-columns: 36px 1fr; gap: 10px 12px;
  transform-origin: 100% 100%;
  animation: nx-pop .22s ease-out both;
  /* The frame is sized to GREETING regardless of which content fills it
     (03.3.2 reuses the one card slot for a campaign message, up to 2000
     chars, not just the short fixed greeting) — scroll rather than overflow
     the iframe's fixed bounds. */
  max-height: 186px; overflow-y: auto;
}
/* The team's avatar, drawn: a tinted circle with a person mark over it. */
.nx-greeting::before {
  content: ""; grid-row: 1; width: 36px; height: 36px; margin-top: 2px;
  border-radius: 50%; background: var(--nx-avatar-bg);
}
.nx-greeting::after {
  content: ""; position: absolute; inset-inline-start: 21px; top: 23px;
  width: 18px; height: 18px; background: var(--nx-avatar-text);
  -webkit-mask: var(--nx-icon-user) center / contain no-repeat;
  mask: var(--nx-icon-user) center / contain no-repeat;
}
/* A campaign is addressed to this visitor specifically; a thin brand-colour
   edge is the one visual difference from the generic greeting it shares a
   slot with. */
.nx-greeting[data-kind="campaign"] { border-inline-start: 3px solid var(--nx-brand); }
.nx-greet-msg { grid-column: 2; margin: 3px 0 0; font-size: 13px; line-height: 18px; font-weight: 500; color: var(--nx-text); }
/* Full width under the avatar row, so two labels fit side by side. */
.nx-greet-actions { grid-column: 1 / -1; display: flex; flex-wrap: wrap; gap: 8px; }
.nx-greet-actions > button {
  flex: 1 1 auto; min-height: 44px; padding: 0 12px; border-radius: 12px;
  font: inherit; font-size: 13px; font-weight: 700; white-space: nowrap; cursor: pointer;
}
.nx-greet-chat { border: 0; background: var(--nx-cta); color: var(--nx-on-brand); }
.nx-greet-chat:hover { filter: brightness(1.07); }
.nx-greet-browse { border: 0; background: var(--nx-field); color: var(--nx-muted); }
.nx-greet-browse:hover { color: var(--nx-text); }

/* ===== Closed: the reply preview ========================================= */
/* The design reference's teaser, as the reply that just landed: avatar with a
   presence dot, who answered, the first lines of it, and a round ×. Same slot
   and frame as the greeting card (it takes the slot while it shows). */
.nx-preview {
  position: fixed; inset-inline-end: var(--nx-pad); inset-block-end: var(--nx-above);
  display: flex; align-items: flex-start; gap: 12px; max-width: 320px;
  padding: 12px; padding-inline-end: 6px;
  background: var(--nx-surface); color: var(--nx-text);
  border-radius: 18px; border-end-end-radius: 4px;
  box-shadow: var(--nx-shadow-card);
  transform-origin: 100% 100%;
  animation: nx-pop .22s ease-out both;
}
.nx-preview-avatar {
  position: relative; flex: none; width: 36px; height: 36px; margin-top: 2px;
  display: flex; align-items: center; justify-content: center; border-radius: 50%;
  background: var(--nx-avatar-bg); color: var(--nx-avatar-text);
  font-size: 14px; font-weight: 700;
}
.nx-preview-avatar .nx-avatar-img { border-radius: 50%; }
[data-presence="online"] .nx-preview-avatar::after,
[data-presence="offline"] .nx-preview-avatar::after {
  content: ""; position: absolute; inset-inline-end: -1px; inset-block-end: -1px;
  width: 11px; height: 11px; border-radius: 50%;
  background: var(--nx-online); border: 2px solid var(--nx-surface);
}
[data-presence="offline"] .nx-preview-avatar::after { background: var(--nx-offline); }
.nx-preview-body {
  flex: 1 1 auto; min-width: 0; display: flex; flex-direction: column; align-items: flex-start; gap: 2px;
  padding: 3px 0 0; border: 0; border-radius: 8px; background: transparent;
  color: inherit; font: inherit; text-align: start; cursor: pointer;
}
.nx-preview-body:focus-visible { outline-offset: 4px; }
.nx-preview-name { font-size: 13px; font-weight: 700; color: var(--nx-title); }
.nx-preview-msg {
  font-size: 13px; line-height: 18px; font-weight: 500; color: var(--nx-text);
  display: -webkit-box; -webkit-box-orient: vertical; -webkit-line-clamp: 3; overflow: hidden;
  overflow-wrap: anywhere;
}
/* A 44 px target with the reference's 24 px round chip drawn inside it. */
.nx-preview-close {
  position: relative; flex: none; width: 44px; height: 44px; margin: -10px -4px -10px -6px;
  padding: 0; border: 0; border-radius: 50%; background: transparent;
  color: var(--nx-muted); font-size: 0; cursor: pointer;
}
.nx-preview-close::before {
  content: ""; position: absolute; inset: 10px; border-radius: 50%; background: var(--nx-field);
}
.nx-preview-close::after {
  content: ""; position: absolute; inset: 16px; background: currentColor;
  -webkit-mask: var(--nx-icon-x) center / contain no-repeat; mask: var(--nx-icon-x) center / contain no-repeat;
}
.nx-preview-close:hover { color: var(--nx-text); }
.nx-preview-close:focus-visible { outline-offset: -8px; }
.nx-left .nx-preview {
  inset-inline-start: var(--nx-pad); inset-inline-end: auto; transform-origin: 0 100%;
  border-end-end-radius: 18px; border-end-start-radius: 4px;
}

/* ===== Open: the panel and its header ==================================== */
.nx-panel {
  /* Anchored to the corner above the launcher; the top and page-facing side
     give the 60 px shadow its room (PANEL in the script). */
  position: fixed;
  inset-inline-end: var(--nx-pad); inset-block-end: var(--nx-above);
  inset-inline-start: 60px; inset-block-start: 40px;
  display: flex; flex-direction: column;
  background: var(--nx-surface-2); color: var(--nx-text);
  border-radius: var(--nx-radius); overflow: hidden;
  box-shadow: var(--nx-shadow-panel);
  transform-origin: 100% 100%;
  animation: nx-pop .18s ease-out both;
}
.nx-left .nx-panel {
  transform-origin: 0 100%;
  inset-inline-start: var(--nx-pad); inset-inline-end: 60px;
}
/* Hosted Chat page: the panel is the whole viewport, no floating card. */
.nx-page .nx-panel { inset: 0; border-radius: 0; box-shadow: none; animation: none; }
.nx-header {
  flex: none; display: flex; align-items: center; gap: 12px;
  padding: 18px 12px 18px 20px;
  background: var(--nx-brand); color: var(--nx-on-brand);
}
.nx-identity { flex: 1; display: flex; align-items: center; gap: 12px; min-width: 0; }
/* Avatars after the reference's header trio: a soft tint per person (picked
   from the name, so the header and the preview card agree), a white ring that
   lifts it off the brand colour, and a presence dot once one is known. */
.nx-avatar {
  position: relative; flex: none; width: 38px; height: 38px; border-radius: 50%;
  display: inline-flex; align-items: center; justify-content: center;
  border: 2px solid #ffffff; box-shadow: 0 2px 6px rgba(17, 24, 39, .18);
  font-size: 15px; font-weight: 700; letter-spacing: -.01em;
}
.nx-avatar-img { width: 100%; height: 100%; object-fit: cover; border-radius: 50%; }
[data-presence="online"] .nx-avatar::after,
[data-presence="offline"] .nx-avatar::after {
  content: ""; position: absolute; inset-inline-end: -3px; inset-block-end: -3px;
  width: 12px; height: 12px; border-radius: 50%;
  background: var(--nx-online); border: 2px solid var(--nx-brand);
}
[data-presence="offline"] .nx-avatar::after { background: var(--nx-offline); }
:where(.nx-avatar, .nx-team > span), [data-tone="0"] { background: #ffffff; color: #312e81; }
[data-tone="1"] { background: #fde1d3; color: #7c2d12; }
[data-tone="2"] { background: #d1fae5; color: #065f46; }
[data-tone="3"] { background: #e0e7ff; color: #3730a3; }
[data-tone="4"] { background: #fef3c7; color: #92400e; }
/* On the white card a white tint would vanish; the card's own tint instead. */
.nx-preview-avatar[data-tone="0"] { background: var(--nx-avatar-bg); color: var(--nx-avatar-text); }
.nx-team { flex: none; display: flex; align-items: center; }
.nx-team[hidden] { display: none; }
.nx-team > span {
  position: relative; width: 38px; height: 38px; border-radius: 50%;
  border: 2px solid #ffffff; box-shadow: 0 2px 6px rgba(17, 24, 39, .18);
}
.nx-team > span + span { margin-inline-start: -10px; }
.nx-team > span::before {
  content: ""; position: absolute; inset: 8px; background: currentColor;
  -webkit-mask: var(--nx-icon-user) center / contain no-repeat;
  mask: var(--nx-icon-user) center / contain no-repeat;
}
.nx-title {
  margin: 0; font-size: 18px; line-height: 24px; font-weight: 700;
  overflow: hidden; text-overflow: ellipsis; white-space: nowrap;
}
.nx-close, .nx-menu-btn {
  flex: none; width: 44px; height: 44px; padding: 0; border: 0; border-radius: 50%;
  display: inline-flex; align-items: center; justify-content: center;
  background: transparent; color: var(--nx-on-brand); cursor: pointer;
  font-size: 0; transition: background-color .15s;
}
.nx-close::before { width: 22px; height: 22px; -webkit-mask-image: var(--nx-icon-down); mask-image: var(--nx-icon-down); }
.nx-menu-btn::before { width: 20px; height: 20px; -webkit-mask-image: var(--nx-icon-more); mask-image: var(--nx-icon-more); }
.nx-close:hover, .nx-menu-btn:hover, .nx-menu-btn[aria-expanded="true"] { background: rgba(255, 255, 255, .14); }
.nx-menu-wrap { position: relative; }
.nx-menu {
  position: absolute; inset-inline-end: 0; top: 100%; margin-top: 6px;
  min-width: 200px; padding: 6px; z-index: 1;
  background: var(--nx-surface); color: var(--nx-text);
  border: 1px solid var(--nx-border); border-radius: 14px;
  box-shadow: var(--nx-shadow-card);
  animation: nx-pop .14s ease-out both;
}
.nx-menu-support {
  display: flex; flex-direction: column; gap: 2px; padding: 8px 12px 4px;
}
.nx-menu-support-label { font-size: 12px; color: var(--nx-muted); }
.nx-menu-support-id {
  font-family: ui-monospace, SFMono-Regular, Menlo, Consolas, monospace;
  font-size: 15px; letter-spacing: normal; user-select: all; -webkit-user-select: all;
}
.nx-menu-rate, .nx-menu-copy, .nx-menu-end {
  display: block; width: 100%; min-height: 44px; text-align: start;
  border: 0; border-radius: 10px; background: transparent; color: inherit;
  font: inherit; font-size: 14px; padding: 0 12px; cursor: pointer;
}
.nx-menu-end { color: var(--nx-danger); }
.nx-menu-rate:hover, .nx-menu-copy:hover, .nx-menu-end:hover { background: var(--nx-field); }
.nx-end-confirm {
  position: absolute; inset: 90px 16px auto; z-index: 2;
  background: var(--nx-surface); color: var(--nx-text);
  border-radius: 16px; box-shadow: var(--nx-shadow-panel);
  padding: 18px; display: flex; flex-direction: column; gap: 14px; text-align: center;
  animation: nx-pop .16s ease-out both;
}
.nx-end-confirm-msg { margin: 0; font-size: 14px; font-weight: 600; color: var(--nx-title); }
.nx-end-confirm-actions { display: flex; gap: 8px; }
.nx-end-confirm-cancel, .nx-end-confirm-confirm {
  flex: 1; min-height: 44px; border-radius: 12px; padding: 0 12px;
  font: inherit; font-size: 14px; font-weight: 700; cursor: pointer;
}
.nx-end-confirm-cancel { border: 0; background: var(--nx-field); color: var(--nx-text); }
.nx-end-confirm-confirm { border: 0; background: var(--nx-brand); color: var(--nx-on-brand); }
/* A fixed light band in both colour schemes: it has to read as a warning
   whatever the host's theme, and dark text on it keeps AA contrast. */
.nx-connection {
  flex: none; margin: 0; padding: 8px 16px; font-size: 12px; font-weight: 600; text-align: center;
  background: #fff4e5; color: #6b3a00; border-bottom: 1px solid #f0c27b;
}

/* ===== Shared: a message from the team, and the field rows =============== */
/* The reference's agent bubble: light fill, the corner nearest the team's
   side is the sharp one. Used by messages, the pre-chat intro and the offline
   form's intro and thank-you. */
.nx-row--agent .nx-bubble, .nx-row--bot .nx-bubble, .nx-welcome-bubble,
.nx-prechat-intro, .nx-offline-intro, .nx-offline-thanks {
  background: var(--nx-bubble); color: var(--nx-text);
  border-radius: 16px; border-end-start-radius: 4px;
  padding: 10px 14px; font-size: 14px; line-height: 20px; font-weight: 500;
}
.nx-field { display: flex; flex-direction: column; gap: 4px; }
.nx-field-label { font-size: 12px; font-weight: 600; color: var(--nx-muted); padding: 0 2px; }
.nx-field-required { color: var(--nx-danger); margin-inline-start: 2px; }
.nx-prechat-input, .nx-input {
  font: inherit; font-size: 14px; font-weight: 500; color: var(--nx-text);
}
.nx-prechat-input {
  width: 100%; height: 40px; padding: 0 12px;
  border-radius: 10px; border: 1px solid var(--nx-field-border); background: var(--nx-field);
  outline: none;
}
.nx-prechat-input:focus { border-color: var(--nx-brand); box-shadow: 0 0 0 2px var(--nx-brand); }
/* "Your message": a few lines tall, growing only downwards. */
.nx-prechat-message {
  display: block; height: auto; min-height: 76px; max-height: 160px;
  padding: 10px 12px; resize: vertical; line-height: 1.4;
}
/* The label above says what the box is for; the placeholder (kept, for the
   rare field rendered without a row) would only repeat it. */
.nx-field .nx-prechat-input::placeholder { color: transparent; }
.nx-prechat-input::placeholder { color: var(--nx-muted); opacity: .8; }
.nx-prechat-fields { display: flex; flex-direction: column; gap: 10px; }
/* Collapsed when empty so a workspace with no form builder configured sees the
   fixed form unchanged (FR-MOD-08.7.7). */
.nx-prechat-fields:empty { display: none; }
.nx-prechat-check {
  display: flex; align-items: center; gap: 10px; min-height: 44px;
  font-size: 13px; font-weight: 600; color: var(--nx-text);
}
.nx-prechat-check input { accent-color: var(--nx-brand); width: 18px; height: 18px; margin: 0; }
/* The full-width call to action of every form. */
.nx-prechat-submit, .nx-offline-submit, .nx-postchat-submit,.nx-human {
  min-height: 44px; width: 100%; padding: 0 16px; border: 0; border-radius: 12px;
  display: flex; align-items: center; justify-content: center; gap: 8px;
  background: var(--nx-cta); color: var(--nx-on-brand);
  font: inherit; font-size: 14px; font-weight: 700; cursor: pointer;
}
.nx-prechat-submit::after { width: 16px; height: 16px; -webkit-mask-image: var(--nx-icon-send); mask-image: var(--nx-icon-send); }
.nx-prechat-submit:hover, .nx-offline-submit:hover, .nx-postchat-submit:hover, .nx-human:hover { filter: brightness(1.07); }
.nx-offline-submit:disabled, .nx-postchat-submit:disabled, .nx-human:disabled { opacity: .5; cursor: default; filter: none; }

/* ===== The human check (tm 339.3) ======================================== */
/* Takes the panel's body while the API wants a check; the provider's control
   sits in a card on the team's side, like the pre-chat form. */
.nx-challenge {
  flex: 1 1 auto; min-height: 0; overflow-y: auto;
  display: flex; flex-direction: column; align-items: flex-start; gap: 10px;
  padding: 18px 16px 16px; background: var(--nx-surface-2);
}
.nx-challenge[hidden] { display: none; }
.nx-challenge-title { margin: 0; font-size: 15px; font-weight: 700; color: var(--nx-title); outline: none; }
.nx-challenge-intro { margin: 0; font-size: 14px; line-height: 20px; color: var(--nx-text); }
.nx-challenge-box {
  width: 100%; min-height: 72px; display: flex; flex-direction: column; justify-content: center; gap: 8px;
  padding: 12px; background: var(--nx-surface); border: 1px solid var(--nx-field-border); border-radius: 12px;
}
.nx-challenge-mock { display: flex; align-items: center; gap: 10px; min-height: 44px; font-size: 14px; font-weight: 600; color: var(--nx-text); cursor: pointer; }
.nx-challenge-mock input { accent-color: var(--nx-brand); width: 22px; height: 22px; margin: 0; }
.nx-challenge-loading, .nx-challenge-provider { font-size: 12px; color: var(--nx-muted); }
.nx-challenge-provider { margin: 0; }
.nx-challenge-notice { margin: 0; font-size: 13px; font-weight: 600; color: var(--nx-danger); }
.nx-challenge-actions { display: flex; flex-wrap: wrap; gap: 8px; }
.nx-challenge-retry, .nx-challenge-cancel {
  min-height: 44px; padding: 0 16px; border-radius: 12px; font: inherit; font-size: 14px; font-weight: 700; cursor: pointer;
}
.nx-challenge-retry { border: 0; background: var(--nx-cta); color: var(--nx-on-brand); }
.nx-challenge-cancel { border: 1px solid var(--nx-field-border); background: transparent; color: var(--nx-text); }
.nx-challenge-retry:focus-visible, .nx-challenge-cancel:focus-visible, .nx-challenge-mock input:focus-visible {
  outline: 2px solid var(--nx-brand); outline-offset: 2px;
}

/* ===== Open, first: the pre-chat form ==================================== */
/* Lives in the conversation's own well, as the team's first message with a
   form card under it on the team's side. */
.nx-prechat {
  flex: 1 1 auto; min-height: 0; overflow-y: auto;
  display: flex; flex-direction: column; align-items: flex-start; gap: 10px;
  padding: 18px 16px 16px; background: var(--nx-surface-2);
}
.nx-prechat > :first-child { margin-top: auto; }
.nx-prechat-intro { margin: 0; max-width: 86%; }
/* The workspace's welcome message: a bold first line over the text, and
   links in the brand's text colour, underlined as the reference has them. */
.nx-welcome { align-self: flex-start; max-width: 86%; }
.nx-welcome-bubble { overflow-wrap: anywhere; white-space: pre-wrap; }
.nx-welcome-title { display: block; margin-bottom: 2px; font-weight: 700; color: var(--nx-title); }
.nx-welcome-link { color: var(--nx-link); font-weight: 600; text-decoration: underline; text-underline-offset: 2px; }
.nx-prechat-card {
  width: 88%; display: flex; flex-direction: column; gap: 10px; padding: 12px;
  background: var(--nx-surface); border-radius: 16px; border-end-start-radius: 4px;
  box-shadow: var(--nx-shadow-soft);
}
.nx-prechat-submit { margin-top: 2px; }
.nx-prechat-hint { margin: 0; padding: 0 2px; font-size: 12px; font-weight: 600; color: var(--nx-muted); }

/* ===== Open, nobody available: the offline form ========================== */
.nx-offline {
  flex: 1 1 auto; min-height: 0; overflow-y: auto;
  display: flex; flex-direction: column; gap: 10px;
  padding: 18px 16px 16px; background: var(--nx-surface-2);
}
.nx-offline > :first-child { margin-top: auto; }
.nx-offline-intro { margin: 0 0 4px; align-self: flex-start; max-width: 86%; }
.nx-offline-thanks { margin: auto 16px 16px; align-self: flex-start; max-width: 80%; }

/* ===== Open: the conversation ============================================= */
.nx-transcript {
  flex: 1 1 auto; min-height: 0; overflow-y: auto;
  padding: 18px 16px 14px; background: var(--nx-surface-2);
  display: flex; flex-direction: column; gap: 10px;
  scrollbar-width: thin; scrollbar-color: var(--nx-field-border) transparent;
}
/* Messages sit at the bottom of the well, as in a messenger. The first child is
   the welcome row, hidden when the workspace has none — then the next one
   takes the margin. */
.nx-transcript > :first-child:not([hidden]),
.nx-transcript > [hidden]:first-child + * { margin-top: auto; }
.nx-row { display: flex; flex-direction: column; gap: 4px; max-width: 86%; }
.nx-row--customer { align-self: flex-end; align-items: flex-end; }
.nx-row--agent, .nx-row--bot { align-self: flex-start; align-items: flex-start; }
.nx-row--system { align-self: center; max-width: 100%; }
.nx-bubble { overflow-wrap: anywhere; white-space: pre-wrap; }
.nx-row--customer .nx-bubble {
  background: var(--nx-bubble-own); color: var(--nx-on-brand);
  border-radius: 16px; border-end-end-radius: 4px;
  padding: 10px 14px; font-size: 14px; line-height: 20px; font-weight: 500;
}
/* The reference's "Today" pill — here the look of every system notice. */
.nx-system {
  margin: 0; padding: 5px 12px; border-radius: 999px; background: var(--nx-pill);
  font-size: 12px; font-weight: 600; color: var(--nx-muted); text-align: center;
}
.nx-askemail {
  display: flex; flex-direction: column; gap: 8px; width: 100%; padding: 12px;
  border-radius: 12px; border: 1px solid var(--nx-border); background: var(--nx-surface);
}
.nx-askemail-text, .nx-askemail-note, .nx-askemail-done { margin: 0; font-size: 13px; line-height: 18px; }
.nx-askemail-text { font-weight: 500; color: var(--nx-text); }
.nx-askemail-note { color: var(--nx-danger); }
.nx-askemail-done { font-weight: 600; color: var(--nx-muted); }
.nx-askemail-send {
  min-height: 40px; border: 0; border-radius: 12px; padding: 0 16px;
  background: var(--nx-cta); color: var(--nx-on-brand); font: inherit; font-size: 13px; font-weight: 600; cursor: pointer;
}
.nx-askemail-send:disabled { opacity: .6; cursor: default; }
.nx-system--warning {
  border-radius: 12px; border: 1px solid var(--nx-border); color: var(--nx-text);
  font-weight: 500; text-align: start; line-height: 18px;
}
.nx-time { font-size: 12px; font-weight: 500; color: var(--nx-muted); }
.nx-meta { display: flex; align-items: center; gap: 6px; }
/* The AI mark: small, outlined, same muted colour as the time so it informs
   without competing with the reply. */
.nx-ai-label {
  font-size: 10px; font-weight: 700; line-height: 1; letter-spacing: .02em;
  color: var(--nx-muted); border: 1px solid currentColor; border-radius: 999px; padding: 2px 6px;
}
/* The "edited" marker sits under the timestamp and reads like one: same size
   and colour, italic so the two are not mistaken for a single line. */
.nx-edited { font-size: 12px; font-style: italic; color: var(--nx-muted); }
.nx-attachment-img { display: block; max-width: 100%; max-height: 220px; border-radius: 12px; margin-top: 4px; }
.nx-attachment-file { display: inline-block; margin-top: 4px; color: inherit; text-decoration: underline; overflow-wrap: anywhere; }
.nx-row--customer .nx-attachment-file { color: var(--nx-on-brand); }
.nx-bubble a { color: var(--nx-link); font-weight: 600; text-underline-offset: 2px; }
.nx-row--customer .nx-bubble a { color: inherit; }
/* "…is typing": the reference's three-dot bubble, with the words beside it so
   who is typing is still said. */
.nx-typing {
  flex: none; display: flex; align-items: center; gap: 8px;
  margin: 0; padding: 0 16px 10px; background: var(--nx-surface-2);
  font-size: 12px; font-weight: 500; color: var(--nx-muted);
}
.nx-human{width:auto;margin:4px 12px 0}
.nx-resolution { flex: none; display: flex; gap: 8px; margin: 4px 16px 0; }
.nx-resolution-yes, .nx-resolution-no {
  flex: 1; min-height: 44px; padding: 0 10px; border-radius: 12px;
  border: 1px solid var(--nx-field-border); background: var(--nx-field); color: var(--nx-text);
  font: inherit; font-size: 13px; font-weight: 600; cursor: pointer;
  transition: border-color .15s, background-color .15s;
}
.nx-resolution-yes:hover, .nx-resolution-no:hover { border-color: var(--nx-brand); }
.nx-typing::before {
  content: ""; flex: none; width: 52px; height: 34px;
  border-radius: 16px; border-end-start-radius: 4px;
  background:
    radial-gradient(circle 3.5px, var(--nx-typing) 98%, transparent) 14px 50% / 8px 8px no-repeat,
    radial-gradient(circle 3.5px, var(--nx-typing) 98%, transparent) 26px 50% / 8px 8px no-repeat,
    radial-gradient(circle 3.5px, var(--nx-typing) 98%, transparent) 38px 50% / 8px 8px no-repeat,
    var(--nx-bubble);
  animation: nx-blink 1.2s infinite;
}
@keyframes nx-blink { 0%, 80%, 100% { opacity: .55; } 40% { opacity: 1; } }
.nx-status { flex: none; margin: 0; padding: 0 16px 10px; background: var(--nx-surface-2); font-size: 12px; color: var(--nx-muted); }
.nx-status[data-tone="error"] { color: var(--nx-danger); }

/* ===== Cards inside the conversation: post-chat, rating, chat ended ====== */
.nx-postchat, .nx-rating, .nx-closed {
  flex: none; margin: 0 16px 10px; padding: 12px;
  background: var(--nx-surface); color: var(--nx-text);
  border-radius: 16px; box-shadow: var(--nx-shadow-soft);
}
.nx-postchat, .nx-rating { display: flex; flex-direction: column; gap: 10px; }
.nx-postchat-intro, .nx-postchat-thanks, .nx-rating-prompt, .nx-rating-thanks {
  margin: 0; font-size: 14px; font-weight: 600; color: var(--nx-title);
}
.nx-postchat-error { margin: 0; font-size: 12px; font-weight: 600; color: var(--nx-danger); }
.nx-rating-actions { display: flex; gap: 8px; }
.nx-rating-good, .nx-rating-bad {
  flex: 1; min-height: 44px; padding: 0 10px; border-radius: 12px;
  border: 1px solid var(--nx-field-border); background: var(--nx-field); color: var(--nx-text);
  font: inherit; font-size: 13px; font-weight: 600; cursor: pointer;
  transition: border-color .15s, background-color .15s;
}
.nx-rating-good:hover, .nx-rating-bad:hover { border-color: var(--nx-brand); }
.nx-rating-good[aria-pressed="true"], .nx-rating-bad[aria-pressed="true"] {
  border-color: var(--nx-brand); box-shadow: 0 0 0 1px var(--nx-brand);
}
.nx-rating-good:disabled, .nx-rating-bad:disabled { opacity: .6; cursor: default; }
.nx-rating-comment { display: flex; flex-direction: column; gap: 6px; }
.nx-rating-comment-bad .nx-field-label { color: var(--nx-title); font-size: 13px; }
.nx-rating-dismiss, .nx-rating-add {
  align-self: center; min-height: 44px; padding: 0 12px; border: 0; background: transparent;
  color: var(--nx-muted); font: inherit; font-size: 12px; text-decoration: underline; cursor: pointer;
}
.nx-closed { display: flex; align-items: center; justify-content: space-between; gap: 10px; font-size: 13px; color: var(--nx-muted); }
.nx-closed-msg { margin: 0; }
.nx-closed-restart {
  flex: none; min-height: 44px; padding: 0 16px; border: 0; border-radius: 999px;
  background: var(--nx-brand); color: var(--nx-on-brand);
  font: inherit; font-size: 13px; font-weight: 700; cursor: pointer;
}

/* ===== The composer ======================================================= */
.nx-chip {
  flex: none; display: flex; align-items: center; gap: 8px;
  margin: 0; padding: 10px 16px 0; background: var(--nx-surface);
  border-top: 1px solid var(--nx-border); font-size: 12px; font-weight: 600;
}
.nx-chip + .nx-form { border-top: 0; }
.nx-chip-name { flex: 1; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.nx-chip-x {
  width: 44px; height: 44px; margin: -12px -12px -12px 0; border: 0; border-radius: 50%;
  background: transparent; font-size: 18px; line-height: 1; cursor: pointer; color: var(--nx-muted);
}
.nx-form { flex: none; padding: 12px 14px 4px; background: var(--nx-surface); border-top: 1px solid var(--nx-border); }
.nx-composer-field {
  display: flex; align-items: center; gap: 2px;
  padding: 4px; padding-inline-start: 6px; border-radius: 999px; background: var(--nx-field);
}
.nx-composer-field:focus-within { box-shadow: 0 0 0 2px var(--nx-brand); }
.nx-attach, .nx-emoji-btn {
  flex: none; width: 44px; height: 44px; padding: 0; border: 0; border-radius: 50%;
  display: flex; align-items: center; justify-content: center;
  background: transparent; color: var(--nx-muted); font-size: 0; cursor: pointer;
}
.nx-attach::before { width: 20px; height: 20px; -webkit-mask-image: var(--nx-icon-clip); mask-image: var(--nx-icon-clip); }
.nx-emoji-btn::before { width: 20px; height: 20px; -webkit-mask-image: var(--nx-icon-smile); mask-image: var(--nx-icon-smile); }
.nx-attach:hover, .nx-emoji-btn:hover, .nx-emoji-btn[aria-expanded="true"] { background: var(--nx-bubble); color: var(--nx-text); }
.nx-attach:disabled, .nx-emoji-btn:disabled { opacity: .5; cursor: default; }
.nx-input {
  flex: 1 1 auto; min-width: 0; height: 44px; padding: 12px 6px;
  border: 0; background: transparent; resize: none; outline: none;
  line-height: 20px; overflow-y: auto;
}
.nx-input::placeholder { color: var(--nx-muted); opacity: 1; }
/* Icon-only on screen; "Send" stays its text, and so its accessible name. */
.nx-send {
  flex: none; width: 44px; height: 44px; padding: 0; border: 0; border-radius: 50%;
  display: flex; align-items: center; justify-content: center;
  background: var(--nx-brand); color: var(--nx-on-brand); font-size: 0; cursor: pointer;
}
.nx-send::before { width: 19px; height: 19px; -webkit-mask-image: var(--nx-icon-send); mask-image: var(--nx-icon-send); }
[dir="rtl"] .nx-send::before, [dir="rtl"] .nx-prechat-submit::after { transform: scaleX(-1); }
.nx-send:hover { filter: brightness(1.08); }
.nx-send:disabled { opacity: .5; cursor: default; filter: none; }
.nx-emoji-wrap { position: relative; }
.nx-emoji-panel {
  position: absolute; inset-inline-start: 0; bottom: 100%; margin-bottom: 12px;
  width: 248px; max-height: 220px; overflow-y: auto; z-index: 1;
  padding: 10px; display: flex; flex-direction: column; gap: 8px;
  background: var(--nx-surface); color: var(--nx-text);
  border: 1px solid var(--nx-border); border-radius: 16px;
  box-shadow: var(--nx-shadow-card);
  animation: nx-pop .14s ease-out both;
}
.nx-emoji-heading {
  margin: 0 0 2px; font-size: 11px; font-weight: 700; text-transform: uppercase;
  letter-spacing: .04em; color: var(--nx-muted);
}
.nx-emoji-group { display: flex; flex-wrap: wrap; gap: 2px; }
.nx-emoji-item {
  border: 0; background: transparent; border-radius: 8px; padding: 0;
  width: 32px; height: 32px; font-size: 18px; line-height: 1; cursor: pointer;
}
.nx-emoji-item:hover { background: var(--nx-field); }

/* ===== Footer ============================================================= */
.nx-powered {
  flex: none; margin: 0; padding: 4px 14px 10px; background: var(--nx-surface);
  text-align: center; font-size: 11px; font-weight: 500; color: var(--nx-muted);
}
/* The brand text in the footer, in the brand's text colour. */
.nx-powered-text, .nx-powered-brand .nx-powered-link { color: var(--nx-link); font-weight: 700; }
.nx-powered-link { color: inherit; text-decoration: none; }
.nx-powered-link:hover { text-decoration: underline; }
/* The composer above already draws the separating line; with no composer on
   screen (a form, or the chat ended), the footer draws it. */
.nx-prechat:not([hidden]) ~ .nx-powered, .nx-offline:not([hidden]) ~ .nx-powered,
.nx-offline-thanks:not([hidden]) ~ .nx-powered, .nx-form[hidden] ~ .nx-powered {
  border-top: 1px solid var(--nx-border);
}

/* ===== Placement and modes ================================================ */
/* Left-corner placement (FR-MOD-11.7): mirror the launcher and greeting to the
   edge the loader anchored the iframe to. Logical here too, so a workspace's
   explicit corner choice and the visitor's reading direction compose instead
   of one silently overriding the other. The card's sharp corner follows. */
.nx-left .nx-launcher { inset-inline-start: var(--nx-pad); inset-inline-end: auto; }
.nx-left .nx-greeting {
  inset-inline-start: var(--nx-pad); inset-inline-end: auto; transform-origin: 0 100%;
  border-end-end-radius: 18px; border-end-start-radius: 4px;
}
/* Mobile fullscreen: on a phone the loader gives the frame the whole viewport,
   so the panel drops its floating-card inset and fills it edge-to-edge. Width
   alone cannot tell the two apart from in here — the desktop frame is 440 px
   wide, under the same 480 — so it is gated on a touch pointer as well;
   width-only, every desktop visitor got a square, edge-to-edge panel too. */
@media (max-width: 480px) and (pointer: coarse) {
  .nx-mobile-full .nx-panel { inset: 0; border-radius: 0; }
  /* Edge-to-edge the panel covers the launcher's corner; its own × closes. */
  .nx-mobile-full .nx-launcher[aria-expanded="true"] { display: none; }
}
:focus-visible { outline: 2px solid var(--nx-brand); outline-offset: 2px; }
/* On the brand-filled header a brand ring would be invisible. */
.nx-header :focus-visible { outline-color: #ffffff; }
/* The text box shows focus through the field's ring; the buttons beside it
   keep their own. */
.nx-input:focus-visible { outline: none; }
@media (prefers-reduced-motion: reduce) { * { transition: none !important; animation: none !important; } }
`;

if (typeof document !== 'undefined' && document.getElementById('siyahtus-widget-root')) {
  mount();
}
