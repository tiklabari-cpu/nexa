/**
 * The gallery's iGaming tab (tm 311.4 · AI-15): the server's twenty Turkish
 * procedures, a preview, the install step that maps topics onto teams, the
 * "Kiracının doldurması gerekenler" panel and the pack install. Browsing writes
 * nothing; the gallery of the static catalogue never reads `/ai-templates`.
 */
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type * as AuthStore from '../../lib/auth-store.js';
import { ApiClientError } from '../../lib/api-client.js';
import { resetLocale, setLocale } from '../../test/i18n.js';
import type {
  AiTemplateDetail,
  AiTemplateInstallResult,
  AiTemplateList,
  AiTemplatePackInstallResult,
} from './ai-templates.js';
import type { Skill } from './types.js';

const { api } = vi.hoisted(() => ({ api: { get: vi.fn(), post: vi.fn() } }));

vi.mock('../../lib/auth-store.js', async (importOriginal) => {
  const actual = await importOriginal<typeof AuthStore>();
  return { ...actual, useApiClient: () => api };
});

const { TemplateGallery } = await import('./TemplateGallery.js');
const { useAuth } = await import('../../lib/auth-store.js');

const LIST: AiTemplateList = {
  items: [
    {
      key: 'deposit_not_credited',
      name: 'Yatırım hesaba geçmedi',
      summary: 'Oyuncunun yatırımı bakiyesine yansımadığında.',
      version: 1,
      locked: false,
      topics: ['finance'],
      tenant_must_fill_count: 2,
      installed_version: null,
    },
    {
      key: 'self_exclusion',
      name: 'Kendini dışlama talebi',
      summary: 'Oyuncu hesabını kapatmak istediğinde.',
      version: 2,
      locked: true,
      topics: ['responsible_gambling'],
      tenant_must_fill_count: 0,
      installed_version: 1,
    },
    {
      key: 'kyc_documents',
      name: 'KYC belgeleri',
      summary: 'Belge doğrulama soruları.',
      version: 1,
      locked: false,
      topics: ['kyc_risk'],
      tenant_must_fill_count: 0,
      installed_version: 1,
    },
  ],
  packs: [
    {
      key: 'igaming_core',
      version: '0.1.0',
      template_keys: ['deposit_not_credited', 'self_exclusion', 'kyc_documents'],
      default_rules_count: 5,
      sample_rows_count: 14,
    },
  ],
};

const DETAIL: AiTemplateDetail = {
  ...LIST.items[0]!,
  when_to_use: 'Yatırım yaptım ama bakiyem değişmedi diyen oyuncular.',
  examples: ['Param yatmadı'],
  forbidden_phrases: [{ phrase: 'garanti ederim', why: 'Söz verilmez.' }],
  tenant_must_fill: [
    {
      kind: 'placeholder',
      label: 'Şikâyet süresi',
      key: 'sikayet_suresi',
      example: '24 saat',
    },
    {
      kind: 'table',
      label: 'Ödeme yöntemleri',
      table: 'payment_methods.deposit',
      columns: ['method'],
    },
  ],
  scenarios: [{ key: 's1', name: 'Eksik yöntem' }],
  card_example: 'Finans devri kartı',
};

const TEAMS = {
  items: [
    { id: 3, name: 'Finans' },
    { id: 4, name: 'Risk' },
  ],
};

function skill(): Skill {
  return {
    id: 'skill-9',
    ai_agent_id: 'agent-1',
    name: 'Yatırım hesaba geçmedi',
    kind: 'ai_agent',
    instruction: null,
    steps: [],
    active: false,
    runs_count: 0,
    updated_at: '2026-10-21T00:00:00.000Z',
    created_by_name: null,
    created_by_id: null,
  };
}

function installResult(overrides: Partial<AiTemplateInstallResult> = {}): AiTemplateInstallResult {
  return {
    created: true,
    skill: skill(),
    tenant_must_fill: DETAIL.tenant_must_fill,
    unfilled_placeholders: ['sikayet_suresi'],
    unmapped_topics: ['finance'],
    ...overrides,
  };
}

function setScopes(scopes: string[]): void {
  useAuth.setState({
    status: 'signed-in',
    accessToken: 'test-token',
    agent: {
      account_id: 'a-1',
      email: 'dana@acme.localhost',
      name: 'Dana Okonkwo',
      role: 'owner',
      organization_id: 'o-1',
      license_id: '1000003',
      scopes,
      routing_status: 'accepting_chats',
    },
  });
}

const FULL_SCOPES = ['agents-bot--all:rw', 'access_rules:rw', 'groups--all:rw'];

function renderGallery(props: { igamingFirst?: boolean; onOpenSkill?: (s: Skill) => void } = {}) {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={queryClient}>
      <TemplateGallery
        open
        onClose={() => {}}
        onUse={() => {}}
        pendingId={null}
        aiAgentId="agent-1"
        onOpenSkill={props.onOpenSkill ?? (() => {})}
        igamingFirst={props.igamingFirst ?? true}
      />
    </QueryClientProvider>,
  );
}

beforeEach(() => {
  resetLocale();
  api.get.mockReset();
  api.post.mockReset();
  api.get.mockImplementation((path: string) => {
    if (path.startsWith('/ai-templates/')) return Promise.resolve(DETAIL);
    if (path.startsWith('/ai-templates')) return Promise.resolve(LIST);
    if (path === '/groups') return Promise.resolve(TEAMS);
    return Promise.reject(new Error(`unexpected ${path}`));
  });
  setScopes(FULL_SCOPES);
});

afterEach(() => resetLocale());

describe('TemplateGallery — iGaming category (AI-15)', () => {
  it('leads with iGaming and opens on it for a gaming/gambling workspace', async () => {
    renderGallery({ igamingFirst: true });
    const tabs = screen.getAllByRole('tab');
    expect(tabs[0]).toHaveTextContent('iGaming');
    expect(tabs[0]).toHaveAttribute('aria-selected', 'true');
    expect(await screen.findByText('Yatırım hesaba geçmedi')).toBeInTheDocument();
  });

  it('puts iGaming last and reads nothing from /ai-templates for any other sector', async () => {
    renderGallery({ igamingFirst: false });
    const tabs = screen.getAllByRole('tab');
    expect(tabs[0]).toHaveTextContent('All');
    expect(tabs[tabs.length - 1]).toHaveTextContent('iGaming');
    expect(api.get).not.toHaveBeenCalled();
  });

  it('shows installed, newer-version and locked marks per template', async () => {
    renderGallery();
    const locked = (await screen.findByText('Kendini dışlama talebi')).closest('li')!;
    expect(within(locked).getByText('Locked')).toBeInTheDocument();
    expect(within(locked).getByText('New version available')).toBeInTheDocument();
    const installed = screen.getByText('KYC belgeleri').closest('li')!;
    expect(within(installed).getByText('Installed')).toBeInTheDocument();
    const fresh = screen.getByText('Yatırım hesaba geçmedi').closest('li')!;
    expect(within(fresh).queryByText('Installed')).not.toBeInTheDocument();
    expect(within(fresh).getByText('2 items for the workspace to fill in')).toBeInTheDocument();
  });

  it('previews a template without writing anything', async () => {
    const user = userEvent.setup();
    renderGallery();
    await user.click(
      await screen.findByRole('button', { name: /Preview the Yatırım hesaba geçmedi/ }),
    );

    expect(await screen.findByText(DETAIL.when_to_use)).toBeInTheDocument();
    expect(screen.getByText('garanti ederim')).toBeInTheDocument();
    expect(screen.getByText('Eksik yöntem')).toBeInTheDocument();
    expect(screen.getByText('Finans devri kartı')).toBeInTheDocument();
    expect(
      screen.getByRole('region', { name: 'What the workspace must fill in' }),
    ).toBeInTheDocument();
    expect(api.post).not.toHaveBeenCalled();
  });

  it('installs with the chosen team mapping and shows what still blocks publishing', async () => {
    const user = userEvent.setup();
    api.post.mockResolvedValue(installResult());
    renderGallery();
    await user.click(
      await screen.findByRole('button', { name: /Install the Yatırım hesaba geçmedi/ }),
    );

    await user.selectOptions(await screen.findByLabelText('Finance'), 'Finans');
    await user.click(screen.getByRole('button', { name: 'Install as a draft' }));

    await waitFor(() => {
      expect(api.post).toHaveBeenCalledWith('/ai-templates/deposit_not_credited/install', {
        ai_agent_id: 'agent-1',
        route_mapping: { finance: 3 },
      });
    });
    expect(await screen.findByText('The draft is installed.')).toBeInTheDocument();
    expect(screen.getByText('{sikayet_suresi}')).toBeInTheDocument();
    expect(
      screen.getByRole('region', { name: 'What the workspace must fill in' }),
    ).toBeInTheDocument();
    expect(screen.getByText('What stops publishing')).toBeInTheDocument();
  });

  it('says so, and offers the draft, when the agent already had a copy', async () => {
    const user = userEvent.setup();
    const onOpenSkill = vi.fn();
    api.post.mockResolvedValue(
      installResult({ created: false, unfilled_placeholders: [], unmapped_topics: [] }),
    );
    renderGallery({ onOpenSkill });
    await user.click(
      await screen.findByRole('button', { name: /Install the Yatırım hesaba geçmedi/ }),
    );
    await user.click(await screen.findByRole('button', { name: 'Install as a draft' }));

    expect(
      await screen.findByText(
        'This agent already has a copy of this template; no new copy was written.',
      ),
    ).toBeInTheDocument();
    expect(screen.getByText('Nothing stops publishing.')).toBeInTheDocument();
    // No team chosen → the body carries no mapping at all.
    expect(api.post).toHaveBeenCalledWith('/ai-templates/deposit_not_credited/install', {
      ai_agent_id: 'agent-1',
    });
    await user.click(screen.getByRole('button', { name: 'Open the draft' }));
    expect(onOpenSkill).toHaveBeenCalledWith(expect.objectContaining({ id: 'skill-9' }));
  });

  it('words a refused mapping instead of showing the server text', async () => {
    const user = userEvent.setup();
    api.post.mockRejectedValue(
      new ApiClientError({
        type: 'validation',
        status: 400,
        message: 'Unknown team 99',
        requestId: 'r-1',
        details: { reason: 'handoff_route_unknown_team' },
      }),
    );
    renderGallery();
    await user.click(
      await screen.findByRole('button', { name: /Install the Yatırım hesaba geçmedi/ }),
    );
    await user.click(await screen.findByRole('button', { name: 'Install as a draft' }));

    expect(await screen.findByRole('alert')).toHaveTextContent('The chosen team was not found.');
  });

  it('offers no team mapping without the access rules permission, and sends none', async () => {
    const user = userEvent.setup();
    setScopes(['agents-bot--all:rw']);
    api.post.mockResolvedValue(installResult());
    renderGallery();
    await user.click(
      await screen.findByRole('button', { name: /Install the Yatırım hesaba geçmedi/ }),
    );

    expect(screen.queryByLabelText('Finance')).not.toBeInTheDocument();
    expect(
      screen.getByText(/Mapping topics needs the access rules permission/),
    ).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Install as a draft' }));
    await waitFor(() => expect(api.post).toHaveBeenCalled());
    expect(api.post.mock.calls[0]![1]).toEqual({ ai_agent_id: 'agent-1' });
  });

  it('cannot install without the permission to manage the AI agent', async () => {
    const user = userEvent.setup();
    setScopes([]);
    renderGallery();
    await user.click(
      await screen.findByRole('button', { name: /Install the Yatırım hesaba geçmedi/ }),
    );
    expect(screen.getByRole('button', { name: 'Install as a draft' })).toBeDisabled();
  });

  it('installs the pack, creating teams only when asked', async () => {
    const user = userEvent.setup();
    const packResult: AiTemplatePackInstallResult = {
      pack: 'igaming_core',
      version: '0.1.0',
      templates: [
        {
          template_key: 'deposit_not_credited',
          skill_id: 's-1',
          created: true,
          tenant_must_fill: [],
          unfilled_placeholders: ['sikayet_suresi'],
          unmapped_topics: [],
        },
        {
          template_key: 'kyc_documents',
          skill_id: 's-2',
          created: false,
          tenant_must_fill: [],
          unfilled_placeholders: [],
          unmapped_topics: [],
        },
      ],
      rules: { created: [{}, {}], existing: 3 },
      sample_rows: { created: 14, skipped: 1 },
      groups_created: [{ id: 9, name: 'Sorumlu Oyun', topic_role: 'responsible_gambling' }],
      persona_style: { address_form: 'siz', emoji: 'none', max_questions_per_message: 2 },
      unmapped_topics: [],
    };
    api.post.mockResolvedValue(packResult);
    renderGallery();
    await user.click(await screen.findByRole('button', { name: 'Install the pack…' }));
    await user.click(screen.getByRole('checkbox', { name: /Create teams for topics/ }));
    await user.click(screen.getByRole('button', { name: 'Install the pack' }));

    await waitFor(() => {
      expect(api.post).toHaveBeenCalledWith('/ai-templates/packs/igaming_core/install', {
        ai_agent_id: 'agent-1',
        create_groups: true,
      });
    });
    expect(await screen.findByText('The pack is installed.')).toBeInTheDocument();
    expect(
      screen.getByText(/1 templates newly installed, 1 were already installed/),
    ).toBeInTheDocument();
    expect(screen.getByText(/14 example rows written, 1 skipped/)).toBeInTheDocument();
    expect(screen.getByText('Teams created: Sorumlu Oyun.')).toBeInTheDocument();
    expect(screen.getByText('{sikayet_suresi}')).toBeInTheDocument();
  });

  it('reads in Turkish for a Turkish console', async () => {
    setLocale('tr');
    renderGallery();
    const row = (await screen.findByText('Yatırım hesaba geçmedi')).closest('li')!;
    expect(within(row).getByRole('button', { name: /şablonunu kur/ })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Paketi kur…' })).toBeInTheDocument();
  });
});
