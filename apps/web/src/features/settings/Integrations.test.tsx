/**
 * Settings → Integrations entry (FR-MOD-08.8.1). The one property that matters is
 * that the entry is a door into the apps marketplace: it links to the MOD-09.1
 * route, so an admin can always find the third-party directory from Settings —
 * the Apps route is not on the module rail, so this link is how it is reached.
 */
import { render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, describe, expect, it } from 'vitest';
import { renderWithLocale, resetLocale } from '../../test/i18n.js';

// Imported from the settings module; the entry uses no data client, so — unlike
// the other settings forms — it needs no mocked API, only a router for the link.
const { Integrations } = await import('./SettingsPage.js');

describe('Settings → Integrations entry', () => {
  it('links to the apps marketplace (MOD-09.1)', () => {
    render(
      <MemoryRouter>
        <Integrations />
      </MemoryRouter>,
    );

    const link = screen.getByRole('link', { name: 'Open marketplace' });
    expect(link).toHaveAttribute('href', '/app/apps');
  });
});

describe('Integrations localisation (NFR-I18N2)', () => {
  afterEach(() => {
    resetLocale();
  });

  it('paints the section in Turkish when that is the active locale', () => {
    renderWithLocale(
      <MemoryRouter>
        <Integrations />
      </MemoryRouter>,
      'tr',
    );

    expect(screen.getByRole('region', { name: 'Entegrasyonlar' })).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Mağazayı aç' })).toHaveAttribute('href', '/app/apps');
  });
});
