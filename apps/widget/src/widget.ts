/**
 * Widget document — runs inside the sandboxed iframe.
 *
 * Slice 1 establishes the host↔frame handshake and the launcher affordance.
 * The transcript, composer, pre-chat form and Customer Chat API wiring land in
 * slice 6.
 *
 * Hard rule for everything added here: customer- and agent-authored text is set
 * via `textContent`, never `innerHTML` (NFR-S6).
 */

const LAUNCHER_SIZE = 84;
const PANEL = { width: 380, height: 620 } as const;

interface WidgetState {
  open: boolean;
}

export function mount(doc: Document = document, win: Window = window): void {
  const root = doc.getElementById('nexa-widget-root');
  if (!root) return;

  const state: WidgetState = { open: false };

  const launcher = doc.createElement('button');
  launcher.type = 'button';
  launcher.id = 'nexa-launcher';
  launcher.setAttribute('aria-expanded', 'false');
  launcher.setAttribute('aria-label', 'Open chat');
  launcher.textContent = 'Chat';
  Object.assign(launcher.style, {
    position: 'fixed',
    right: '10px',
    bottom: '10px',
    width: '64px',
    height: '64px',
    borderRadius: '9999px',
    border: '0',
    background: '#2f6bff',
    color: '#ffffff',
    fontFamily: 'Inter, -apple-system, system-ui, sans-serif',
    fontSize: '13px',
    fontWeight: '600',
    cursor: 'pointer',
    boxShadow: '0 8px 24px rgb(16 24 40 / 0.24)',
  } as Record<string, string>);

  const panel = doc.createElement('section');
  panel.id = 'nexa-panel';
  panel.hidden = true;
  panel.setAttribute('aria-label', 'Chat');

  root.append(panel, launcher);

  const setOpen = (open: boolean): void => {
    state.open = open;
    panel.hidden = !open;
    launcher.setAttribute('aria-expanded', String(open));
    launcher.setAttribute('aria-label', open ? 'Close chat' : 'Open chat');
    // The frame is only as large as it needs to be — a full-size transparent
    // iframe would swallow clicks on the host page while the widget is closed.
    postToHost(win, {
      type: 'nexa:resize',
      width: open ? PANEL.width : LAUNCHER_SIZE,
      height: open ? PANEL.height : LAUNCHER_SIZE,
    });
    postToHost(win, { type: open ? 'nexa:open' : 'nexa:close' });
  };

  launcher.addEventListener('click', () => setOpen(!state.open));

  doc.addEventListener('keydown', (event) => {
    if (event.key === 'Escape' && state.open) {
      setOpen(false);
      launcher.focus();
    }
  });

  win.addEventListener('message', (event: MessageEvent) => {
    // The host page is cross-origin and untrusted; accept only the two commands
    // it is allowed to issue, and ignore everything else without replying.
    const data = event.data as { type?: unknown };
    if (data?.type === 'nexa:host-open') setOpen(true);
    if (data?.type === 'nexa:host-close') setOpen(false);
  });

  postToHost(win, { type: 'nexa:ready' });
}

function postToHost(win: Window, message: Record<string, unknown>): void {
  // `'*'` is unavoidable here: the sandboxed frame has an opaque origin and does
  // not know the embedding page's origin. Safe because these messages carry no
  // conversation content — only presentation hints the loader re-validates.
  win.parent?.postMessage(message, '*');
}

if (typeof document !== 'undefined' && document.getElementById('nexa-widget-root')) {
  mount();
}
