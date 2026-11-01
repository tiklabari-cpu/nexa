/**
 * Settings → Integrations entry (FR-MOD-08.8.1). The one property that matters is
 * that the entry is a door into the apps marketplace: it links to the MOD-09.1
 * route, so an admin can always find the third-party directory from Settings —
 * the Apps route is not on the module rail, so this link is how it is reached.
 */
import { fireEvent, render, screen, within } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { IGAMING_PLATFORMS } from '@siyahtus/types';
import { afterEach, describe, expect, it, vi } from 'vitest';
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

describe('Settings → Integrations → iGaming platforms (KN-06 F1, K15)', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    resetLocale();
  });

  function renderEntry(): void {
    render(
      <MemoryRouter>
        <Integrations />
      </MemoryRouter>,
    );
  }

  it('shows one card per catalogue platform with a "Coming soon" badge', () => {
    renderEntry();

    const region = screen.getByRole('region', { name: 'iGaming platforms' });
    expect(IGAMING_PLATFORMS.length).toBeGreaterThanOrEqual(1);
    for (const platform of IGAMING_PLATFORMS) {
      const card = within(region).getByTestId(`igaming-platform-${platform.vendor}`);
      expect(within(card).getByRole('heading', { name: platform.name })).toBeInTheDocument();
      expect(within(card).getByText('Coming soon')).toBeInTheDocument();
    }
  });

  it('announces the Connect button as unavailable, with the reason attached', () => {
    renderEntry();

    for (const platform of IGAMING_PLATFORMS) {
      const card = screen.getByTestId(`igaming-platform-${platform.vendor}`);
      const button = within(card).getByRole('button', { name: 'Connect' });
      expect(button).toBeDisabled();
      expect(button).toHaveAttribute('aria-disabled', 'true');
      expect(button).toHaveAccessibleDescription(
        `Connecting ${platform.name} is not available yet. It is coming in a later release.`,
      );
      expect(button.closest('span[title]')).toHaveAttribute(
        'title',
        expect.stringContaining(platform.name),
      );
    }
  });

  it('sends no request when Connect is clicked', () => {
    const fetchSpy = vi.fn();
    vi.stubGlobal('fetch', fetchSpy);
    const xhrSpy = vi.fn();
    vi.stubGlobal('XMLHttpRequest', xhrSpy);
    renderEntry();

    for (const button of screen.getAllByRole('button', { name: 'Connect' })) {
      fireEvent.click(button);
    }

    expect(fetchSpy).not.toHaveBeenCalled();
    expect(xhrSpy).not.toHaveBeenCalled();
  });

  it('paints the section in Turkish', () => {
    renderWithLocale(
      <MemoryRouter>
        <Integrations />
      </MemoryRouter>,
      'tr',
    );

    const region = screen.getByRole('region', { name: 'iGaming platformları' });
    expect(within(region).getAllByText('Yakında')).toHaveLength(IGAMING_PLATFORMS.length);
    const [first] = within(region).getAllByRole('button', { name: 'Bağla' });
    expect(first).toBeDisabled();
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
