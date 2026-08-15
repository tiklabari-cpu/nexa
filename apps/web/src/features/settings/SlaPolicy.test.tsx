/**
 * SLA settings screen (FR-MOD-11.5 · 11.5-e): the server's saved targets land
 * in the form, an out-of-range target is rejected before it reaches the
 * network, blank means "no target" and saves as `null`, a plan without the
 * `sla` entitlement gets the upsell message rather than a raw 403, and a
 * read-only agent cannot touch it at all.
 */
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { SlaPolicy } from './SlaPolicy.js';
import { useAuth } from '../../lib/auth-store.js';

interface SlaPolicyView {
  first_response_minutes: number | null;
  resolution_minutes: number | null;
  business_hours_only: boolean;
  active: boolean;
  updated_at: string | null;
}

const DEFAULTS: SlaPolicyView = {
  first_response_minutes: null,
  resolution_minutes: null,
  business_hours_only: false,
  active: false,
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

function errorJson(status: number, message: string, details?: Record<string, unknown>): Response {
  return {
    ok: false,
    status,
    headers: { get: () => null },
    json: async () => ({
      error: {
        type: status === 403 ? 'not_allowed' : 'validation',
        message,
        details,
        request_id: 'req_test',
      },
    }),
  } as unknown as Response;
}

let putBodies: Array<Record<string, unknown>>;
let nextPutError: Response | null;

function stubFetch(current: typeof DEFAULTS): void {
  putBodies = [];
  nextPutError = null;
  vi.stubGlobal(
    'fetch',
    vi.fn(async (url: string, init?: RequestInit) => {
      const method = init?.method ?? 'GET';
      if (String(url).endsWith('/settings/sla')) {
        if (method === 'PUT') {
          if (nextPutError) return nextPutError;
          const body = JSON.parse(String(init?.body)) as Record<string, unknown>;
          putBodies.push(body);
          return okJson({
            ...current,
            ...body,
            updated_at: new Date().toISOString(),
            active: true,
          });
        }
        return okJson(current);
      }
      return okJson(current);
    }),
  );
}

function renderSlaPolicy(canEdit = true) {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={queryClient}>
      <MemoryRouter>
        <SlaPolicy canEdit={canEdit} />
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

beforeEach(() => {
  useAuth.setState({ status: 'signed-in', accessToken: 'test-token', agent: null });
  stubFetch(DEFAULTS);
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('SlaPolicy', () => {
  it('reads a never-configured workspace as blank fields and "Not active"', async () => {
    renderSlaPolicy();

    expect(await screen.findByText('Not active')).toBeInTheDocument();
    expect(screen.getByLabelText('First response target (minutes)')).toHaveValue(null);
    expect(screen.getByLabelText('Resolution target (minutes)')).toHaveValue(null);
    expect(screen.getByRole('checkbox', { name: /business hours/ })).not.toBeChecked();
  });

  it("loads the server's saved targets into the form", async () => {
    stubFetch({
      first_response_minutes: 30,
      resolution_minutes: 480,
      business_hours_only: true,
      active: true,
      updated_at: '2026-08-01T00:00:00.000Z',
    });
    renderSlaPolicy();

    expect(await screen.findByText('Active')).toBeInTheDocument();
    expect(screen.getByLabelText('First response target (minutes)')).toHaveValue(30);
    expect(screen.getByLabelText('Resolution target (minutes)')).toHaveValue(480);
    expect(screen.getByRole('checkbox', { name: /business hours/ })).toBeChecked();
  });

  it('keeps Save disabled until something is changed', async () => {
    renderSlaPolicy();
    const save = await screen.findByRole('button', { name: 'Save' });
    expect(save).toBeDisabled();
  });

  it('saves a valid target through PUT /settings/sla with the whole policy', async () => {
    renderSlaPolicy();
    const firstResponse = await screen.findByLabelText('First response target (minutes)');
    await userEvent.type(firstResponse, '30');
    const resolution = screen.getByLabelText('Resolution target (minutes)');
    await userEvent.type(resolution, '480');
    await userEvent.click(screen.getByRole('checkbox', { name: /business hours/ }));

    const save = screen.getByRole('button', { name: 'Save' });
    expect(save).toBeEnabled();
    await userEvent.click(save);

    await waitFor(() => expect(putBodies).toHaveLength(1));
    expect(putBodies[0]).toEqual({
      first_response_minutes: 30,
      resolution_minutes: 480,
      business_hours_only: true,
    });
  });

  it('saves a blank field as null, not zero', async () => {
    stubFetch({
      first_response_minutes: 30,
      resolution_minutes: null,
      business_hours_only: false,
      active: true,
      updated_at: null,
    });
    renderSlaPolicy();

    const firstResponse = await screen.findByLabelText('First response target (minutes)');
    await userEvent.clear(firstResponse);

    const save = screen.getByRole('button', { name: 'Save' });
    await userEvent.click(save);

    await waitFor(() => expect(putBodies).toHaveLength(1));
    expect(putBodies[0]).toMatchObject({ first_response_minutes: null });
  });

  it('rejects an out-of-range target with a field-under error and blocks saving', async () => {
    renderSlaPolicy();
    const firstResponse = await screen.findByLabelText('First response target (minutes)');
    await userEvent.type(firstResponse, '0');
    await userEvent.tab();

    expect(screen.getByRole('alert')).toHaveTextContent(/whole number of minutes/);
    expect(screen.getByRole('button', { name: 'Save' })).toBeDisabled();
    expect(putBodies).toHaveLength(0);
  });

  it('shows the Enterprise upsell message on a 403 naming the sla entitlement', async () => {
    renderSlaPolicy();
    const firstResponse = await screen.findByLabelText('First response target (minutes)');
    await userEvent.type(firstResponse, '30');

    nextPutError = errorJson(
      403,
      'SLA targets and breach reporting is not included in the growth plan.',
      {
        entitlement: 'sla',
        plan: 'growth',
      },
    );
    await userEvent.click(screen.getByRole('button', { name: 'Save' }));

    expect(await screen.findByRole('alert')).toHaveTextContent(/Enterprise feature/);
  });

  it('explains a downgrade: targets saved but not measured', async () => {
    stubFetch({
      first_response_minutes: 30,
      resolution_minutes: null,
      business_hours_only: false,
      active: false,
      updated_at: '2026-08-01T00:00:00.000Z',
    });
    renderSlaPolicy();

    expect(await screen.findByText('Not active')).toBeInTheDocument();
    expect(screen.getByText(/saved but not being measured/)).toBeInTheDocument();
  });

  it('is read-only when canEdit is false: inputs disabled, no Save button, PUT never called', async () => {
    renderSlaPolicy(false);

    expect(await screen.findByLabelText('First response target (minutes)')).toBeDisabled();
    expect(screen.getByLabelText('Resolution target (minutes)')).toBeDisabled();
    expect(screen.getByRole('checkbox', { name: /business hours/ })).toBeDisabled();
    expect(screen.queryByRole('button', { name: 'Save' })).not.toBeInTheDocument();
    expect(putBodies).toHaveLength(0);
  });
});
