/**
 * Custom panels in the Details pane (KN-05 · owner decision K29 · tm 379).
 *
 * Each panel the conversation shows (`GET /chats/{id}/panels` — the server
 * already applied the team rule) is one collapsible section with the
 * operator's page in a sandboxed frame. The page asks for the conversation by
 * posting `siyahtus:ready`; the console answers with a five-minute token
 * signed by the panel's secret (`panelBridge.ts` decides which messages
 * count). Nothing is drawn — no heading, no empty state — when the workspace
 * has no panel for this conversation.
 *
 * Every frame is keyed on conversation + panel, so moving to another
 * conversation tears the page down and the next `ready` gets the next
 * conversation's token: a page never holds one conversation's context while
 * the agent reads another.
 */
import { useQuery } from '@tanstack/react-query';
import { useEffect, useRef, useState, type ReactElement } from 'react';
import {
  CUSTOM_PANEL_HEIGHT_DEFAULT,
  CUSTOM_PANEL_SANDBOX,
  type CustomPanelTokenDelivery,
} from '@siyahtus/types';
import { PanelSection } from '../../components/ui/index.js';
import { useApiClient } from '../../lib/auth-store.js';
import { useTranslate } from '../../lib/i18n.js';
import { offerDraft } from './copilotDraft.js';
import {
  contextMessage,
  newPanelChannel,
  panelFrameSrc,
  panelLinkHref,
  readPanelMessage,
} from './panelBridge.js';

export interface ChatPanel {
  id: string;
  name: string;
  url: string;
  origin: string;
}

interface PanelToken {
  token: string;
  expires_at: string;
  delivery: CustomPanelTokenDelivery;
}

/** A token is reused while it has at least this long left; a page that says `ready` twice gets the same one. */
const TOKEN_REUSE_MARGIN_MS = 60_000;
/** One suggestion a second at most — each one moves the agent's focus to the composer. */
const INSERT_INTERVAL_MS = 1_000;

function isChatPanel(value: unknown): value is ChatPanel {
  if (typeof value !== 'object' || value === null) return false;
  const panel = value as Record<string, unknown>;
  return (
    typeof panel['id'] === 'string' &&
    typeof panel['name'] === 'string' &&
    typeof panel['origin'] === 'string' &&
    typeof panel['url'] === 'string' &&
    panel['url'].startsWith('https://')
  );
}

export function chatPanelsKey(chatId: string): readonly unknown[] {
  return ['chat-panels', chatId];
}

export function CustomPanelsSection({
  chatId,
  canInsert,
}: {
  chatId: string;
  /** Whether the composer takes a suggestion — false on a closed conversation. */
  canInsert: boolean;
}): ReactElement | null {
  const api = useApiClient();
  const panels = useQuery({
    queryKey: chatPanelsKey(chatId),
    queryFn: () => api.get<{ items: ChatPanel[] }>(`/chats/${chatId}/panels`),
    staleTime: 60_000,
  });
  // Only what is shaped like a panel and framed over https — a defensive read:
  // the server enforces both, and a frame is the one thing here worth refusing
  // to draw on a malformed answer.
  const items = (panels.data?.items ?? []).filter(isChatPanel);
  if (items.length === 0) return null;
  return (
    <>
      {items.map((panel) => (
        <PanelSection key={`${chatId}:${panel.id}`} title={panel.name}>
          <CustomPanelFrame chatId={chatId} panel={panel} canInsert={canInsert} />
        </PanelSection>
      ))}
    </>
  );
}

export function CustomPanelFrame({
  chatId,
  panel,
  canInsert,
}: {
  chatId: string;
  panel: ChatPanel;
  canInsert: boolean;
}): ReactElement {
  const t = useTranslate();
  const api = useApiClient();
  const frameRef = useRef<HTMLIFrameElement>(null);
  // One nonce per mounted frame — the parent keys this component on chat + panel.
  const [channel] = useState(newPanelChannel);
  const [height, setHeight] = useState(CUSTOM_PANEL_HEIGHT_DEFAULT);
  const [contextFailed, setContextFailed] = useState(false);
  const [suggested, setSuggested] = useState(false);
  const [linkFailed, setLinkFailed] = useState(false);
  const tokenRef = useRef<PanelToken | null>(null);
  const lastInsertRef = useRef(0);
  // Read in the listener without re-subscribing it on every render.
  const canInsertRef = useRef(canInsert);
  canInsertRef.current = canInsert;

  const mint = (delivery: CustomPanelTokenDelivery): Promise<PanelToken> =>
    api.post<PanelToken>(`/chats/${chatId}/panels/${panel.id}/context-token`, { delivery });

  useEffect(() => {
    let alive = true;
    const onMessage = (event: MessageEvent): void => {
      const frameWindow = frameRef.current?.contentWindow ?? null;
      const message = readPanelMessage(event, {
        window: frameWindow,
        origin: panel.origin,
        channel,
      });
      if (!message || !frameWindow) return;
      if (message.type === 'resize') {
        setHeight(message.height);
        return;
      }
      if (message.type === 'insert_text') {
        const now = Date.now();
        if (!canInsertRef.current || now - lastInsertRef.current < INSERT_INTERVAL_MS) return;
        lastInsertRef.current = now;
        offerDraft(chatId, message.text);
        setSuggested(true);
        return;
      }
      // `ready`: the cached token while it has a minute left, a fresh one otherwise.
      const cached = tokenRef.current;
      const reply = (token: PanelToken): void => {
        // `'*'`: the frame's origin is opaque (sandbox without allow-same-origin);
        // the target is this frame's own window, answering its own `ready`.
        frameWindow.postMessage(contextMessage(channel, token.token, token.expires_at), '*');
      };
      if (cached && Date.parse(cached.expires_at) - Date.now() > TOKEN_REUSE_MARGIN_MS) {
        reply(cached);
        return;
      }
      void mint('frame').then(
        (token) => {
          if (!alive) return;
          tokenRef.current = token;
          setContextFailed(false);
          reply(token);
        },
        () => {
          if (alive) setContextFailed(true);
        },
      );
    };
    window.addEventListener('message', onMessage);
    return () => {
      alive = false;
      window.removeEventListener('message', onMessage);
    };
  }, [chatId, panel.id, panel.origin, channel]);

  // For a back-office that refuses to be framed. The tab is opened at once —
  // inside the click, so no pop-up blocker stops it — and pointed at the
  // address once the `link` token arrives; `opener` is cut first, so the page
  // cannot reach back into the console.
  const openInNewTab = (): void => {
    setLinkFailed(false);
    const tab = window.open('', '_blank');
    if (tab) tab.opener = null;
    mint('link').then(
      (token) => {
        const href = panelLinkHref(panel.url, token.token);
        if (tab) tab.location.href = href;
        else window.open(href, '_blank', 'noopener,noreferrer');
      },
      () => {
        tab?.close();
        setLinkFailed(true);
      },
    );
  };

  return (
    <div className="flex flex-col gap-2" data-testid={`custom-panel-${panel.id}`}>
      <div className="flex items-center gap-2 text-2xs text-content-tertiary">
        {/* Where the frame points, so an agent can tell a look-alike address (KN-05 risk note). */}
        <span className="min-w-0 flex-1 truncate" title={panel.origin}>
          {t('inbox.details.customPanels.opens', { origin: panel.origin })}
        </span>
        <button
          type="button"
          onClick={openInNewTab}
          className="shrink-0 text-content-brand underline underline-offset-2"
        >
          {t('inbox.details.customPanels.openInNewTab')}
        </button>
      </div>
      <iframe
        ref={frameRef}
        src={panelFrameSrc(panel.url, channel)}
        title={t('inbox.details.customPanels.frameTitle', { name: panel.name })}
        sandbox={CUSTOM_PANEL_SANDBOX}
        referrerPolicy="no-referrer"
        allow=""
        style={{ height }}
        className="w-full rounded-sm border border-border bg-surface"
      />
      {contextFailed && (
        <p role="alert" className="text-2xs text-danger">
          {t('inbox.details.customPanels.contextError')}
        </p>
      )}
      {linkFailed && (
        <p role="alert" className="text-2xs text-danger">
          {t('inbox.details.customPanels.linkError')}
        </p>
      )}
      {suggested && (
        <p role="status" className="text-2xs text-content-secondary">
          {t('inbox.details.customPanels.suggested')}
        </p>
      )}
    </div>
  );
}
