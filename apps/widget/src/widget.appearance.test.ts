/**
 * Widget customization (FR-MOD-11.7): the widget applies the appearance the
 * loader forwards, at mount, before any network call — so the launcher is
 * on-brand from the first paint. The KK is "tema uygular"; these pin it.
 *
 * The colour, forced scheme, corner and footer are all set on the real DOM
 * (`:root` style + attribute, a root class, the footer element), which is the
 * exact mechanism the CSS keys off, so asserting them is asserting the look.
 */
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { mount } from './widget.js';

function setUrl(search: string): void {
  window.history.replaceState({}, '', `/widget.html${search}`);
}

function mountWith(search: string): HTMLElement {
  setUrl(search);
  const root = document.createElement('div');
  root.id = 'nexa-widget-root';
  document.body.append(root);
  mount(document, window);
  return root;
}

const brandVar = (): string => document.documentElement.style.getPropertyValue('--nx-brand').trim();

beforeEach(() => {
  document.head.replaceChildren();
  document.body.replaceChildren();
  document.documentElement.removeAttribute('data-nx-theme');
  document.documentElement.style.removeProperty('--nx-brand');
});

afterEach(() => {
  window.history.replaceState({}, '', '/');
});

describe('widget appearance', () => {
  it('applies the shipped defaults when the snippet customised nothing', () => {
    const root = mountWith('?organization_id=org-1');

    expect(brandVar()).toBe('#2f6bff');
    // `auto` leaves no override, so the prefers-color-scheme media query governs.
    expect(document.documentElement.hasAttribute('data-nx-theme')).toBe(false);
    // Default corner is bottom-right, so no left mirror.
    expect(root.classList.contains('nx-left')).toBe(false);
    // Full screen on mobile is on by default.
    expect(root.classList.contains('nx-mobile-full')).toBe(true);
    // The "Powered by" footer shows by default (FR-MOD-11.5).
    const powered = root.querySelector('.nx-powered') as HTMLElement;
    expect(powered).not.toBeNull();
    expect(powered.hidden).toBe(false);
    expect(powered.textContent).toContain('Powered by Nexa');
  });

  it('applies a brand colour from the loader query params', () => {
    mountWith('?organization_id=org-1&color=%23e11d48');
    expect(brandVar()).toBe('#e11d48');
  });

  it('ignores a colour that is not a hex, falling back to the default', () => {
    mountWith('?organization_id=org-1&color=red');
    expect(brandVar()).toBe('#2f6bff');
  });

  it.each([
    ['light', 'light'],
    ['dark', 'dark'],
  ])('forces the %s colour scheme', (theme, expected) => {
    mountWith(`?organization_id=org-1&theme=${theme}`);
    expect(document.documentElement.getAttribute('data-nx-theme')).toBe(expected);
  });

  it('treats an unknown theme as auto', () => {
    mountWith('?organization_id=org-1&theme=solarized');
    expect(document.documentElement.hasAttribute('data-nx-theme')).toBe(false);
  });

  it('mirrors the launcher to the left corner', () => {
    const root = mountWith('?organization_id=org-1&position=bottom-left');
    expect(root.classList.contains('nx-left')).toBe(true);
  });

  it('drops mobile fullscreen when the snippet turned it off', () => {
    const root = mountWith('?organization_id=org-1&mobile_full=0');
    expect(root.classList.contains('nx-mobile-full')).toBe(false);
  });

  it('removes the "Powered by" footer when the snippet turned it off', () => {
    const root = mountWith('?organization_id=org-1&powered_by=0');
    const powered = root.querySelector('.nx-powered') as HTMLElement;
    expect(powered.hidden).toBe(true);
  });
});
