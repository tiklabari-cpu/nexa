import { beforeEach, describe, expect, it } from 'vitest';
import { boot, type NexaWidgetConfig } from './loader.js';

type TestWindow = Window & {
  __nexa?: NexaWidgetConfig & { open?: () => void; destroy?: () => void };
};

function setup(config?: Partial<NexaWidgetConfig>): TestWindow {
  document.body.replaceChildren();
  const win = window as TestWindow;
  if (config) {
    win.__nexa = { organizationId: 'org-1', widgetOrigin: 'https://widget.test', ...config };
  } else {
    delete win.__nexa;
  }
  return win;
}

const frame = () => document.getElementById('nexa-widget-frame') as HTMLIFrameElement | null;

describe('widget loader', () => {
  beforeEach(() => {
    setup();
  });

  it('does nothing when the host page never configured it', () => {
    const win = setup();
    expect(boot(win)).toBeNull();
    expect(frame()).toBeNull();
  });

  it('does nothing without an organization id', () => {
    const win = setup({ organizationId: '' });
    expect(boot(win)).toBeNull();
    expect(frame()).toBeNull();
  });

  it('creates a sandboxed iframe pointed at the widget origin', () => {
    const win = setup({});
    boot(win);

    const el = frame();
    expect(el).not.toBeNull();
    expect(el!.src).toContain('https://widget.test/widget.html');
    expect(el!.src).toContain('organization_id=org-1');

    const sandbox = el!.getAttribute('sandbox') ?? '';
    expect(sandbox).toContain('allow-scripts');
    // `allow-same-origin` gives the frame its own origin back — not the host's,
    // which stays protected by the differing origin asserted below. Without it
    // the document is opaque-origin: no storage, and every request carries
    // `Origin: null`, which the API refuses. The widget could not authenticate.
    expect(sandbox).toContain('allow-same-origin');
  });

  it('passes the host page origin through to the widget', () => {
    // The token request is made from inside the frame, whose own origin is
    // Nexa's and therefore identical for every customer. Only code running on
    // the host page knows which site this actually is.
    boot(setup({}));
    const src = new URL(frame()!.src);
    expect(src.searchParams.get('host_origin')).toBe(window.location.origin);
  });

  it('refuses to boot a same-origin widget', () => {
    // Same-origin is precisely the configuration in which the iframe stops
    // being an isolation boundary: with `allow-scripts allow-same-origin` the
    // frame could reach into the embedder and strip its own sandbox.
    const win = setup({ widgetOrigin: window.location.origin });
    expect(boot(win)).toBeNull();
    expect(frame()).toBeNull();
  });

  it('gives the iframe an accessible name', () => {
    boot(setup({}));
    expect(frame()!.getAttribute('aria-label')).toBe('Customer support chat');
    expect(frame()!.title).toBe('Chat');
  });

  it('refuses a plaintext widget origin', () => {
    const win = setup({ widgetOrigin: 'http://widget.test' });
    expect(boot(win)).toBeNull();
    expect(frame()).toBeNull();
  });

  it('allows http on localhost so local development works', () => {
    const win = setup({ widgetOrigin: 'http://localhost:5174' });
    boot(win);
    expect(frame()!.src).toContain('http://localhost:5174/widget.html');
  });

  it('refuses a malformed widget origin', () => {
    const win = setup({ widgetOrigin: 'not a url' });
    expect(boot(win)).toBeNull();
    expect(frame()).toBeNull();
  });

  it('boots only once even if the snippet is pasted twice', () => {
    const win = setup({});
    boot(win);
    expect(boot(win)).toBeNull();
    expect(document.querySelectorAll('#nexa-widget-frame')).toHaveLength(1);
  });

  it('honours bottom-left placement', () => {
    boot(setup({ position: 'bottom-left' }));
    expect(frame()!.style.left).toBe('16px');
    expect(frame()!.style.right).toBe('');
  });

  it('exposes open/close/destroy on the host global', () => {
    const win = setup({});
    boot(win);
    expect(typeof win.__nexa!.open).toBe('function');
    expect(typeof win.__nexa!.destroy).toBe('function');
  });

  it('removes the frame and its listener on destroy', () => {
    const win = setup({});
    const destroy = boot(win)!;
    destroy();
    expect(frame()).toBeNull();
    expect(win.__nexa!.open).toBeUndefined();
  });
});

describe('loader message boundary', () => {
  beforeEach(() => setup());

  function dispatch(payload: unknown, origin: string, source: unknown): void {
    const event = new MessageEvent('message', { data: payload, origin });
    // jsdom leaves `source` read-only on the constructor path.
    Object.defineProperty(event, 'source', { value: source });
    window.dispatchEvent(event);
  }

  it('resizes on a well-formed message from the frame', () => {
    boot(setup({}));
    const el = frame()!;
    dispatch(
      { type: 'nexa:resize', width: 380, height: 620 },
      'https://widget.test',
      el.contentWindow,
    );
    expect(el.style.height).toBe('620px');
    expect(el.style.width).toBe('380px');
  });

  it('ignores messages from any other origin', () => {
    boot(setup({}));
    const el = frame()!;
    const before = el.style.height;
    dispatch({ type: 'nexa:resize', height: 9999 }, 'https://evil.test', el.contentWindow);
    expect(el.style.height).toBe(before);
  });

  it('ignores messages from a different window on the right origin', () => {
    boot(setup({}));
    const el = frame()!;
    const before = el.style.height;
    dispatch({ type: 'nexa:resize', height: 500 }, 'https://widget.test', {} as Window);
    expect(el.style.height).toBe(before);
  });

  it('ignores unknown message types', () => {
    boot(setup({}));
    const el = frame()!;
    const before = el.style.height;
    dispatch({ type: 'nexa:take-over-page' }, 'https://widget.test', el.contentWindow);
    expect(el.style.height).toBe(before);
  });

  it('clamps hostile resize values instead of letting the frame cover the page', () => {
    boot(setup({}));
    const el = frame()!;
    dispatch(
      { type: 'nexa:resize', width: 999_999, height: 999_999 },
      'https://widget.test',
      el.contentWindow,
    );
    expect(el.style.height).toBe('720px');
    expect(el.style.width).toBe('420px');
  });

  it('ignores non-numeric dimensions', () => {
    boot(setup({}));
    const el = frame()!;
    const before = el.style.height;
    dispatch(
      { type: 'nexa:resize', height: 'tall', width: Number.NaN },
      'https://widget.test',
      el.contentWindow,
    );
    expect(el.style.height).toBe(before);
  });

  it('survives a non-object payload', () => {
    boot(setup({}));
    const el = frame()!;
    expect(() => dispatch('hello', 'https://widget.test', el.contentWindow)).not.toThrow();
    expect(() => dispatch(null, 'https://widget.test', el.contentWindow)).not.toThrow();
  });
});
