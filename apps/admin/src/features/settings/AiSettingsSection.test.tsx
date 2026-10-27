/**
 * Settings › AI against a fake platform API (tm 389.17 · FR-ADMIN-17/19). The server's rules —
 * sealing, the region and pilot checks, the hot swap, the meter — have their own suite
 * (`platform-ai-settings.test.ts`); here: the key field is write-only and masked, what each save
 * sends, what the form holds back, the re-embedding warning, the two actions, and what each role
 * may touch.
 */
import type { PlatformRole } from '@siyahtus/types';
import { screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { FakePlatform } from '../../test/fake-platform.js';
import { installFakePlatform, renderApp, resetSession } from '../../test/render-app.js';

afterEach(async () => {
  vi.restoreAllMocks();
  await resetSession();
});

beforeEach(() => {
  globalThis.sessionStorage.clear();
});

const user = () => userEvent.setup();
const KEY = 'sk-test-only-typed-into-the-panel-9Xq2';

const STORED_LLM = {
  provider: 'openai',
  base_url: 'https://eu.api.openai.com/v1',
  model: 'gpt-test',
  model_fast: null,
  region: 'eu',
  timeout_ms: null,
  max_output_tokens: null,
  api_key_last4: 'Ab12',
};

async function open(
  options: {
    role?: PlatformRole;
    ai?: (fake: FakePlatform) => void;
  } = {},
): Promise<FakePlatform> {
  const fake = installFakePlatform({ role: options.role ?? 'superadmin' });
  options.ai?.(fake);
  renderApp('/settings');
  await user().type(await screen.findByLabelText('Email'), 'ops@example.com');
  await user().type(screen.getByLabelText('Password'), 'correct horse battery staple');
  await user().click(screen.getByRole('button', { name: 'Continue' }));
  await user().type(await screen.findByLabelText('Authenticator code'), '123456');
  await user().click(screen.getByRole('button', { name: 'Verify' }));
  await screen.findByRole('heading', { name: 'Settings' });
  return fake;
}

const aiForm = () => screen.findByRole('form', { name: 'AI providers' });

function sent(fake: FakePlatform, method: string, path: string): unknown[] {
  return fake.requests
    .filter((request) => request.method === method && request.path === path)
    .map((request) => request.body);
}

async function confirm(reason: string, code = true): Promise<void> {
  const dialog = await screen.findByRole('dialog');
  await user().type(within(dialog).getByLabelText('Reason'), reason);
  if (code) await user().type(within(dialog).getByLabelText('Authenticator code'), '123456');
  await user().click(within(dialog).getByRole('button', { name: 'Confirm' }));
}

describe('Settings › AI — the model and its key', () => {
  it('starts on the environment, saves an OpenAI model with a pasted key, and shows only its last four characters after', async () => {
    const fake = await open();
    const form = await aiForm();
    const model = within(form).getByRole('group', { name: 'Model' });
    expect(within(model).getByText('From the environment')).toBeVisible();
    await user().selectOptions(within(model).getByLabelText('Provider'), 'openai');
    await user().type(within(model).getByLabelText('Base URL'), 'https://eu.api.openai.com/v1');
    await user().type(within(model).getByLabelText('Model name'), 'gpt-test');
    await user().selectOptions(within(model).getByLabelText('Region'), 'eu');
    const key = within(model).getByLabelText('API key');
    expect(key).toHaveAttribute('type', 'password');
    expect(key).toHaveAttribute('autocomplete', 'off');
    await user().type(key, KEY);
    await user().click(within(form).getByRole('button', { name: 'Save AI settings' }));
    await confirm('Moving to the EU model');

    await vi.waitFor(() =>
      expect(sent(fake, 'PUT', '/settings/ai')).toEqual([
        {
          reason: 'Moving to the EU model',
          llm: {
            provider: 'openai',
            base_url: 'https://eu.api.openai.com/v1',
            model: 'gpt-test',
            model_fast: null,
            region: 'eu',
            timeout_ms: null,
            max_output_tokens: null,
            api_key: KEY,
          },
          embedding: null,
          caps: null,
          prices: null,
        },
      ]),
    );
    expect(fake.calls('/auth/totp/reverify')).toHaveLength(1);
    const after = within(await aiForm()).getByRole('group', { name: 'Model' });
    expect(await within(after).findByText(`•••• ${KEY.slice(-4)}`)).toBeVisible();
    expect(within(after).getByText('Set here')).toBeVisible();
    expect(within(after).queryByLabelText('API key')).toBeNull();
    expect(document.body.textContent).not.toContain(KEY);
    expect(screen.queryByDisplayValue(KEY)).toBeNull();
  });

  it('keeps a stored key unless it is changed, and removes it only when asked', async () => {
    const fake = await open({
      ai: (f) => {
        f.settingsState.ai.llm = { ...STORED_LLM };
        f.settingsState.ai['source'] = { llm: 'db', embedding: 'env' };
      },
    });
    const model = within(await aiForm()).getByRole('group', { name: 'Model' });
    expect(within(model).getByText('•••• Ab12')).toBeVisible();

    // A change elsewhere: no `api_key` in the body.
    await user().type(within(model).getByLabelText('Fast model'), 'gpt-test-mini');
    await user().click(screen.getByRole('button', { name: 'Save AI settings' }));
    await confirm('Faster classification');
    await vi.waitFor(() => expect(sent(fake, 'PUT', '/settings/ai')).toHaveLength(1));
    const first = sent(fake, 'PUT', '/settings/ai')[0] as { llm: Record<string, unknown> };
    expect(first.llm['model_fast']).toBe('gpt-test-mini');
    expect(first.llm).not.toHaveProperty('api_key');

    // Change: an empty write-only field; Cancel goes back to the mask.
    const again = within(await aiForm()).getByRole('group', { name: 'Model' });
    await user().click(within(again).getByRole('button', { name: 'Change key' }));
    expect(within(again).getByLabelText('API key')).toHaveValue('');
    await user().click(within(again).getByRole('button', { name: 'Cancel' }));
    await user().click(within(again).getByRole('button', { name: 'Remove key' }));
    expect(within(again).getByText('The stored key is removed when you save.')).toBeVisible();
    await user().click(screen.getByRole('button', { name: 'Save AI settings' }));
    await confirm('Key revoked at the provider');
    await vi.waitFor(() => expect(sent(fake, 'PUT', '/settings/ai')).toHaveLength(2));
    expect(
      (sent(fake, 'PUT', '/settings/ai')[1] as { llm: Record<string, unknown> }).llm,
    ).toMatchObject({
      api_key: null,
    });
  });

  it('holds the save back while a remote model lacks its region, a key is too short, or the caps are half filled', async () => {
    await open();
    const form = await aiForm();
    const save = within(form).getByRole('button', { name: 'Save AI settings' });
    expect(save).toBeDisabled();
    const model = within(form).getByRole('group', { name: 'Model' });
    await user().selectOptions(within(model).getByLabelText('Provider'), 'openai');
    await user().type(within(model).getByLabelText('Base URL'), 'https://eu.api.openai.com/v1');
    await user().type(within(model).getByLabelText('Model name'), 'gpt-test');
    expect(
      within(model).getByText('A remote provider needs a base URL, a model name and a region.'),
    ).toHaveAttribute('role', 'alert');
    expect(save).toBeDisabled();
    await user().selectOptions(within(model).getByLabelText('Region'), 'eu');
    await user().type(within(model).getByLabelText('API key'), 'short');
    expect(within(model).getByText('A key is at least 8 characters long.')).toBeVisible();
    expect(save).toBeDisabled();
    await user().type(within(model).getByLabelText('API key'), '-but-now-long-enough');
    expect(save).toBeEnabled();
    await user().type(within(form).getByLabelText('Model, per workspace'), '1000');
    expect(
      within(form).getByText('Fill in all four caps with whole numbers, or none.'),
    ).toBeVisible();
    expect(save).toBeDisabled();
  });
});

describe('Settings › AI — the embedding model', () => {
  it('shows the fixed width, warns before an embedding change, and asks for a re-embedding after it', async () => {
    const fake = await open();
    const form = await aiForm();
    const embedding = within(form).getByRole('group', { name: 'Embedding model' });
    await user().selectOptions(within(embedding).getByLabelText('Provider'), 'openai');
    expect(within(embedding).getByText('Vector width: 1536, fixed by the database.')).toBeVisible();
    expect(within(embedding).getByText(/the knowledge base has to be re-embedded/)).toHaveAttribute(
      'role',
      'alert',
    );
    await user().type(within(embedding).getByLabelText('Base URL'), 'https://eu.api.openai.com/v1');
    await user().type(within(embedding).getByLabelText('Model name'), 'text-embedding-3-small');
    await user().selectOptions(within(embedding).getByLabelText('Region'), 'eu');
    await user().type(within(embedding).getByLabelText('API key'), KEY);
    await user().click(within(form).getByRole('button', { name: 'Save AI settings' }));
    await confirm('New embedding model');
    await vi.waitFor(() =>
      expect(sent(fake, 'PUT', '/settings/ai')[0]).toMatchObject({
        embedding: { provider: 'openai', dimensions: 1536, api_key: KEY },
      }),
    );
    expect(
      await screen.findByText('The embedding model changed: re-embed the knowledge base below.'),
    ).toBeVisible();
  });
});

describe('Settings › AI — the connection test and re-embedding', () => {
  it('tests the model with a reason and shows the result, or the failure’s kind', async () => {
    const fake = await open();
    await aiForm();
    await user().click(screen.getByRole('button', { name: 'Test the model' }));
    await confirm('Checking the key', false);
    expect(
      await screen.findByText('Model: answered in 42 ms (mock, From the environment).'),
    ).toBeVisible();
    expect(sent(fake, 'POST', '/settings/ai/test-connection')).toEqual([
      { reason: 'Checking the key', target: 'llm' },
    ]);

    fake.settingsState.aiTest = { ok: false, error: 'auth' };
    await user().click(screen.getByRole('button', { name: 'Test the embedding provider' }));
    await confirm('Checking again', false);
    expect(await screen.findByText('Embeddings: no answer (auth).')).toBeVisible();
  });

  it('starts a re-embedding, shows it running, and says so when one is already running', async () => {
    const fake = await open();
    await aiForm();
    expect(screen.getByText('No re-embedding recorded.')).toBeVisible();
    await user().click(screen.getByRole('button', { name: 'Re-embed the knowledge base' }));
    await confirm('Moved to the new model', false);
    expect(await screen.findByText(/^Running\. Sources moved: 0/)).toBeVisible();
    expect(screen.getByRole('button', { name: 'Re-embed the knowledge base' })).toBeDisabled();
    expect(sent(fake, 'POST', '/settings/ai/reembed')).toEqual([
      { reason: 'Moved to the new model' },
    ]);
  });
});

describe('Settings › AI — who may', () => {
  it('shows a reader every field disabled, and no save, test or re-embed', async () => {
    await open({ role: 'readonly' });
    const form = await aiForm();
    expect(within(form).getByRole('group', { name: 'Model' })).toBeDisabled();
    expect(screen.queryByRole('button', { name: 'Save AI settings' })).toBeNull();
    expect(screen.queryByRole('button', { name: 'Test the model' })).toBeNull();
    expect(screen.queryByRole('button', { name: 'Re-embed the knowledge base' })).toBeNull();
  });
});
