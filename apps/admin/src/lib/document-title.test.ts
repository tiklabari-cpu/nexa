import { render } from '@testing-library/react';
import { createElement } from 'react';
import { describe, expect, it } from 'vitest';
import { BASE_TITLE, composeTitle, usePageTitle } from './document-title.js';

function Probe({ title }: { title: string | null }): null {
  usePageTitle(title);
  return null;
}

describe('document title', () => {
  it('prefixes every tab with [OPS], with and without a page name', () => {
    expect(composeTitle(null)).toBe(BASE_TITLE);
    expect(composeTitle('Audit')).toBe('[OPS] Audit · SiyahTuş');
    expect(BASE_TITLE.startsWith('[OPS] ')).toBe(true);
  });

  it('names the page while mounted and restores the bare title after', () => {
    const { unmount } = render(createElement(Probe, { title: 'Workspaces' }));
    expect(document.title).toBe('[OPS] Workspaces · SiyahTuş');
    unmount();
    expect(document.title).toBe(BASE_TITLE);
  });
});
