/**
 * Settings → Audit log entry (08.9.7-i). The door only exists for a caller who
 * can actually open what it leads to: hidden without `audit_log--all:ro`, so a
 * teammate who cannot read the trail is never shown a link that would only 403.
 * The real gate stays server-side (route scope + `minimumRole: admin`) — this
 * hiding is a courtesy, proven separately in `AuditLogPage.test.tsx`'s "no
 * fetch without scope" case.
 */
import { render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { describe, expect, it, vi } from 'vitest';
import type * as AuthStore from '../../lib/auth-store.js';

let currentScopes: string[] = [];

vi.mock('../../lib/auth-store.js', async (importOriginal) => {
  const actual = await importOriginal<typeof AuthStore>();
  return {
    ...actual,
    useAuth: (selector: (state: { agent: { scopes: string[] } }) => unknown) =>
      selector({ agent: { scopes: currentScopes } }),
  };
});

const { AuditLog } = await import('./SettingsPage.js');

describe('Settings → Audit log entry', () => {
  it('links to the audit log screen for a caller with audit_log--all:ro', () => {
    currentScopes = ['audit_log--all:ro'];
    render(
      <MemoryRouter>
        <AuditLog />
      </MemoryRouter>,
    );

    const link = screen.getByRole('link', { name: 'Open audit log' });
    expect(link).toHaveAttribute('href', '/app/settings/audit-log');
  });

  it('renders nothing for a caller without audit_log--all:ro', () => {
    currentScopes = [];
    const { container } = render(
      <MemoryRouter>
        <AuditLog />
      </MemoryRouter>,
    );

    expect(container).toBeEmptyDOMElement();
  });
});
