/**
 * Widget customization (FR-MOD-11.7): the live preview reflects the draft, the
 * hex field is validated before it can be saved, and a save only fires on a real
 * change. These pin the "tema uygular" behaviour on the panel side.
 */
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { WidgetCustomization } from './WidgetCustomization.js';
import { useAuth, useBrandStore } from '../../lib/auth-store.js';
import { renderWithLocale, resetLocale } from '../../test/i18n.js';

const DEFAULTS = {
  primary_color: '#2d67fa',
  position: 'bottom-right',
  theme: 'auto',
  mobile_fullscreen: true,
  powered_by: true,
  updated_at: null,
};

function okJson(body: unknown): Response {
  return {
    ok: true,
    status: 200,
    headers: { get: () => null },
    json: async () => body,
  } as unknown as Response;
}

let putBodies: Array<Record<string, unknown>>;

function stubFetch(): void {
  putBodies = [];
  vi.stubGlobal(
    'fetch',
    vi.fn(async (url: string, init?: RequestInit) => {
      const method = init?.method ?? 'GET';
      if (String(url).endsWith('/settings/widget') && method === 'PUT') {
        const body = JSON.parse(String(init?.body)) as Record<string, unknown>;
        putBodies.push(body);
        return okJson({ ...DEFAULTS, ...body, updated_at: new Date().toISOString() });
      }
      return okJson(DEFAULTS);
    }),
  );
}

function renderWidget() {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={queryClient}>
      <WidgetCustomization canEdit />
    </QueryClientProvider>,
  );
}

beforeEach(() => {
  useAuth.setState({ status: 'signed-in', accessToken: 'test-token', agent: null });
  // Every test starts license-wide unless it opts into a brand — the
  // regression guard for "no behaviour change when no brand is selected".
  useBrandStore.setState({ brandId: null });
  stubFetch();
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('WidgetCustomization', () => {
  it('renders a live preview with the "Powered by" footer shown by default', async () => {
    renderWidget();
    const preview = await screen.findByTestId('widget-preview');
    expect(preview).toHaveTextContent('Powered by SiyahTuş');
  });

  it('keeps Save disabled until something is changed', async () => {
    renderWidget();
    const save = await screen.findByRole('button', { name: 'Save' });
    expect(save).toBeDisabled();
  });

  it('flags an invalid hex colour and blocks saving', async () => {
    renderWidget();
    const hex = await screen.findByLabelText('Brand colour hex');
    await userEvent.clear(hex);
    await userEvent.type(hex, 'notacolour');

    expect(screen.getByRole('alert')).toHaveTextContent(/hex colour/);
    expect(screen.getByRole('button', { name: 'Save' })).toBeDisabled();
  });

  it('saves a valid change through PUT /settings/widget', async () => {
    renderWidget();
    const hex = await screen.findByLabelText('Brand colour hex');
    await userEvent.clear(hex);
    await userEvent.type(hex, '#123456');

    const save = screen.getByRole('button', { name: 'Save' });
    expect(save).toBeEnabled();
    await userEvent.click(save);

    await waitFor(() => expect(putBodies).toHaveLength(1));
    expect(putBodies[0]).toEqual({ primary_color: '#123456' });
  });

  it('saves a welcome message — title and text — through PUT /settings/widget', async () => {
    renderWidget();
    const title = await screen.findByRole('textbox', { name: 'Title' });
    const text = screen.getByRole('textbox', { name: 'Message' });
    // Both boxes say how the message is used; the text box also says how to link.
    expect(text).toHaveAccessibleDescription(/first message[\s\S]*\[label\]\(https:\/\/address\)/);

    await userEvent.type(title, 'Welcome to Acme!');
    await userEvent.type(text, 'Our stores are listed here.');
    await userEvent.click(screen.getByRole('button', { name: 'Save' }));

    await waitFor(() => expect(putBodies).toHaveLength(1));
    expect(putBodies[0]).toEqual({
      welcome_title: 'Welcome to Acme!',
      welcome_text: 'Our stores are listed here.',
    });
  });

  it('picks the widget language and its fallback, saving both (WG-02)', async () => {
    renderWidget();
    const language = await screen.findByRole('combobox', { name: 'Widget language' });
    const fallback = screen.getByRole('combobox', { name: 'Fallback language' });

    // Automatic is the starting point; the eight languages follow in their own names.
    expect(language).toHaveValue('auto');
    expect(within(language).getAllByRole('option')).toHaveLength(9);
    expect(within(language).getByRole('option', { name: 'Türkçe' })).toBeInTheDocument();
    expect(fallback).toHaveValue('tr');

    await userEvent.selectOptions(fallback, 'de');
    await userEvent.selectOptions(language, 'en');
    // A pinned language makes the fallback moot: it is shown, not editable.
    expect(fallback).toBeDisabled();

    await userEvent.click(screen.getByRole('button', { name: 'Save' }));
    await waitFor(() => expect(putBodies).toHaveLength(1));
    expect(putBodies[0]).toEqual({ language: 'en', fallback_language: 'de' });
  });

  it('chooses when visitors can start a chat, saying what each choice does (WG-09)', async () => {
    renderWidget();
    const group = await screen.findByRole('group', { name: 'Availability' });
    // The label carries its "what happens" list, so the radio's name starts with it.
    const always = within(group).getByRole('radio', { name: /^Always/ });
    const agentsOnly = within(group).getByRole('radio', {
      name: /^Only when agents are accepting chats/,
    });
    // A row never saved reads `always`.
    expect(always).toBeChecked();
    expect(
      within(group).getByText(
        'With nobody available, the chat waits unassigned until an agent takes it.',
      ),
    ).toBeInTheDocument();
    expect(
      within(group).getByText(/the widget shows a leave-a-message form instead/),
    ).toBeInTheDocument();

    await userEvent.click(agentsOnly);
    expect(agentsOnly).toBeChecked();
    await userEvent.click(screen.getByRole('button', { name: 'Save' }));
    await waitFor(() => expect(putBodies).toHaveLength(1));
    expect(putBodies[0]).toEqual({ availability_mode: 'agents_only' });
  });

  it('lets the admin hide the chat bubble, names the risk of never and saves the mode (WG-10)', async () => {
    renderWidget();
    const group = await screen.findByRole('group', { name: 'Chat bubble' });
    expect(within(group).getByRole('radio', { name: 'Always visible' })).toBeChecked();
    // Visible: nothing to wire, and no risk to name.
    expect(screen.queryByTestId('launcher-own-button')).toBeNull();
    expect(screen.queryByTestId('launcher-never-risk')).toBeNull();

    await userEvent.click(
      within(group).getByRole('radio', { name: 'Hidden until your site opens it' }),
    );
    expect(screen.getByTestId('launcher-own-button')).toHaveTextContent("siyahtus('open')");
    expect(screen.queryByTestId('launcher-never-risk')).toBeNull();

    await userEvent.click(within(group).getByRole('radio', { name: 'Never visible' }));
    expect(screen.getByTestId('launcher-never-risk')).toHaveTextContent(
      /cannot open a chat at all/,
    );
    // The preview drops the bubble while the site opens the panel itself.
    expect(within(screen.getByTestId('widget-preview')).queryByText('💬')).toBeNull();

    await userEvent.click(screen.getByRole('button', { name: 'Save' }));
    await waitFor(() => expect(putBodies).toHaveLength(1));
    expect(putBodies[0]).toEqual({ launcher_visibility: 'never' });
  });

  it('saves the brand-logo switch and shows a logo mark in the preview (WG-10)', async () => {
    renderWidget();
    const toggle = await screen.findByRole('checkbox', { name: /Show the brand logo/ });
    expect(toggle).not.toBeChecked();
    expect(screen.queryByTestId('preview-logo')).toBeNull();

    await userEvent.click(toggle);
    expect(screen.getByTestId('preview-logo')).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: 'Save' }));
    await waitFor(() => expect(putBodies).toHaveLength(1));
    expect(putBodies[0]).toEqual({ show_logo: true });
  });

  it('says a language in the install snippet beats the panel setting (WG-02)', async () => {
    renderWidget();
    expect(await screen.findByText(/install snippet \(data-language\) overrides/)).toBeVisible();
  });

  it('does not submit the form when Enter is pressed in the language picker (WG-02)', async () => {
    renderWidget();
    const language = await screen.findByRole('combobox', { name: 'Widget language' });
    await userEvent.selectOptions(language, 'ar');
    language.focus();
    await userEvent.keyboard('{Enter}');

    expect(putBodies).toHaveLength(0);
  });

  it('reflects a toggled setting in the preview', async () => {
    renderWidget();
    const toggle = await screen.findByRole('checkbox', { name: /Powered by SiyahTuş/ });
    await userEvent.click(toggle);

    const preview = within(screen.getByTestId('widget-preview'));
    // Turning the footer off removes it from the miniature.
    expect(preview.queryByText('Powered by SiyahTuş')).toBeNull();
  });

  it('titles the section plainly when no brand is selected', async () => {
    renderWidget();
    expect(await screen.findByRole('heading', { name: 'Widget appearance' })).toBeInTheDocument();
  });

  // The plan gate refuses with `not_allowed`, whose ADR-06 sentence is the
  // deliberately vague "That is not allowed here." — correct for the taxonomy
  // and wrong for this screen, where the refusal is the upsell. Between I18N-j
  // and I18N-l it was exactly that sentence, and only `entitlements.spec.ts`
  // noticed; this pins it a layer down.
  it('names the tier when the plan refuses the badge, not the generic refusal', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async (url: string, init?: RequestInit) => {
        if (String(url).endsWith('/settings/widget') && (init?.method ?? 'GET') === 'PUT') {
          return {
            ok: false,
            status: 403,
            headers: { get: () => null },
            json: async () => ({
              error: {
                type: 'not_allowed',
                message:
                  'Removing SiyahTuş branding from the widget is not included in the growth plan.',
                request_id: 'req-test',
                details: { entitlement: 'white_label', plan: 'growth' },
              },
            }),
          } as unknown as Response;
        }
        return okJson(DEFAULTS);
      }),
    );

    renderWidget();
    await userEvent.click(await screen.findByRole('checkbox', { name: /Powered by SiyahTuş/ }));
    await userEvent.click(screen.getByRole('button', { name: 'Save' }));

    const alert = await screen.findByRole('alert');
    expect(alert).toHaveTextContent(/Removing the SiyahTuş badge is an Enterprise feature/);
    expect(alert).not.toHaveTextContent('That is not allowed here.');
    // And the server's own English prose still never reaches the screen.
    expect(alert).not.toHaveTextContent(/growth plan/);
  });
});

/** One sentinel for this file's DoD claim of being translated (I18N-j, tm 133.10). */
describe('WidgetCustomization localisation (NFR-I18N2)', () => {
  afterEach(() => {
    resetLocale();
  });

  it('paints Widget appearance in Turkish when that is the active locale', async () => {
    const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    renderWithLocale(
      <QueryClientProvider client={queryClient}>
        <WidgetCustomization canEdit />
      </QueryClientProvider>,
      'tr',
    );

    expect(await screen.findByRole('heading', { name: 'Widget görünümü' })).toBeInTheDocument();
  });
});

/**
 * Brand scoping (MULTIBRAND-g, PRD §5.3-Marka): the cache key and the section
 * heading both follow the selected brand, so switching brands shows that
 * brand's appearance rather than the one left over from before.
 */
describe('WidgetCustomization brand scoping', () => {
  const BRAND_A = { id: 'brand-a', name: 'Acme Support', is_default: true };
  const BRAND_B = { id: 'brand-b', name: 'Beta Line', is_default: false };
  const WIDGET_BY_BRAND: Record<string, typeof DEFAULTS> = {
    [BRAND_A.id]: { ...DEFAULTS, primary_color: '#111111' },
    [BRAND_B.id]: { ...DEFAULTS, primary_color: '#222222' },
  };

  function stubBrandAwareFetch(): void {
    vi.stubGlobal(
      'fetch',
      vi.fn(async (url: string, init?: RequestInit) => {
        const method = init?.method ?? 'GET';
        const brand = new Headers(init?.headers).get('X-SiyahTus-Brand');
        if (String(url).endsWith('/brands')) return okJson({ items: [BRAND_A, BRAND_B] });
        if (String(url).endsWith('/settings/widget')) {
          const current = (brand && WIDGET_BY_BRAND[brand]) || DEFAULTS;
          if (method === 'PUT') {
            const body = JSON.parse(String(init?.body)) as Record<string, unknown>;
            return okJson({ ...current, ...body, updated_at: new Date().toISOString() });
          }
          return okJson(current);
        }
        return okJson(DEFAULTS);
      }),
    );
  }

  beforeEach(() => {
    useAuth.setState({ status: 'signed-in', accessToken: 'test-token', agent: null });
    useBrandStore.setState({ brandId: BRAND_A.id });
    stubBrandAwareFetch();
  });

  it("renders the selected brand's appearance and names it in the heading", async () => {
    renderWidget();
    expect(await screen.findByLabelText('Brand colour hex')).toHaveValue('#111111');
    expect(screen.getByRole('heading', { name: /Widget appearance/ })).toHaveTextContent(
      'Acme Support',
    );
  });

  it("switching brands fetches the new brand's appearance and drops the previous one", async () => {
    renderWidget();
    await waitFor(() => expect(screen.getByLabelText('Brand colour hex')).toHaveValue('#111111'));

    act(() => useBrandStore.getState().setBrandId(BRAND_B.id));

    await waitFor(() => expect(screen.getByLabelText('Brand colour hex')).toHaveValue('#222222'));
    expect(screen.queryByDisplayValue('#111111')).toBeNull();
    expect(screen.getByRole('heading', { name: /Widget appearance/ })).toHaveTextContent(
      'Beta Line',
    );
  });
});
