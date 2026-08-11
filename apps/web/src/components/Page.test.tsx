/**
 * `Section` gives its heading an id in a namespace that can never alias the
 * caller's anchor `id` (tm 100). Channels and Website widgets both pass
 * `id="section-<title-slug>"` — the exact string the heading id used to derive
 * to — which made `<section aria-labelledby>` point at itself. A self-referential
 * `aria-labelledby` makes the accessible name the whole subtree, so the section
 * answered to `getByLabel('Reply')` (from the SMS card's "Reply to text messages
 * over Twilio.") and collided with the real reply input. These tests fail if the
 * two ids are ever allowed to coincide again.
 */
import { render } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { Section } from './Page.js';

describe('Section', () => {
  it('gives the heading a different id than the caller-supplied anchor id', () => {
    // The real Channels case: anchor id equals the title slug.
    const { container } = render(
      <Section
        id="section-channels"
        title="Channels"
        description="Everywhere your customers can reach you."
      >
        <p>Reply to text messages over Twilio.</p>
      </Section>,
    );

    const section = container.querySelector('section')!;
    const heading = container.querySelector('h2')!;

    expect(section.id).toBe('section-channels');
    expect(heading.id).not.toBe(section.id);
    // aria-labelledby must resolve to the heading, not the section itself.
    expect(section.getAttribute('aria-labelledby')).toBe(heading.id);
    expect(heading.id).toBe('section-channels-heading');
  });

  it('labels the section by its heading alone, not the whole subtree', () => {
    const { container } = render(
      <Section id="section-channels" title="Channels">
        <p>Reply to text messages over Twilio.</p>
      </Section>,
    );

    const section = container.querySelector('section')!;
    const labelledBy = section.getAttribute('aria-labelledby')!;
    const label = container.querySelector(`#${CSS.escape(labelledBy)}`);
    // The referenced element is the heading, whose text is only the title —
    // the "Reply ..." card copy is not part of the accessible name.
    expect(label?.tagName).toBe('H2');
    expect(label?.textContent).toBe('Channels');
  });

  it('still derives a heading id from the title when no anchor id is given', () => {
    const { container } = render(<Section title="Right now">child</Section>);
    const section = container.querySelector('section')!;
    const heading = container.querySelector('h2')!;

    expect(section.hasAttribute('id')).toBe(false);
    expect(heading.id).toBe('section-right-now-heading');
    expect(section.getAttribute('aria-labelledby')).toBe(heading.id);
  });
});
