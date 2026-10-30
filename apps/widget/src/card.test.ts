/** The card chunk's own guards (EN-02 · tm 353), without a widget around it. */
import { describe, expect, it, onTestFinished, vi } from 'vitest';
import { cardElement, cardText } from './card.js';

const host = () => ({
  locale: 'tr',
  api: { post: vi.fn(async () => undefined), fetchAttachment: vi.fn(async () => new Blob()) },
  press: vi.fn(),
});

describe('cardElement', () => {
  it('never turns a non-https address into a link, whatever reached it', () => {
    const element = cardElement(
      document,
      {
        body: 'x',
        buttons: [
          {
            label: 'Bad',
            style: 'default',
            action: { type: 'open_url', url: 'javascript:alert(1)' },
          },
          {
            label: 'Good',
            style: 'default',
            action: { type: 'open_url', url: 'https://ok.test/' },
          },
        ],
      },
      {},
      host(),
    );
    const links = element.querySelectorAll('a');
    expect([...links].map((a) => a.textContent)).toEqual(['Good']);
  });

  it('fetches an uploaded image with the visitor token, and counts nothing for a card in a conversation', async () => {
    // jsdom has no object URLs; one for this test only.
    Object.defineProperty(URL, 'createObjectURL', {
      value: () => 'blob:card-image',
      configurable: true,
    });
    onTestFinished(() => {
      delete (URL as { createObjectURL?: unknown }).createObjectURL;
    });
    const h = host();
    const element = cardElement(
      document,
      {
        body: 'x',
        image: { url: '/api/v1/uploads/7-a.png', alt: 'Coins' },
        buttons: [{ label: 'Copy', style: 'default', action: { type: 'copy_coupon', code: 'C1' } }],
      },
      { event_id: 'th_1' },
      h,
    );
    expect(h.api.fetchAttachment).toHaveBeenCalledWith('/api/v1/uploads/7-a.png');
    await vi.waitFor(() => expect(element.querySelector('img')!.src).toBe('blob:card-image'));
    element.querySelector<HTMLButtonElement>('button')!.click();
    expect(h.api.post).not.toHaveBeenCalled();
  });

  it('a message button hands the label and the button to the widget', () => {
    const h = host();
    const element = cardElement(
      document,
      {
        body: 'x',
        buttons: [{ label: 'Papara', style: 'default', action: { type: 'send_message' } }],
      },
      { event_id: 'th_2' },
      h,
    );
    element.querySelector<HTMLButtonElement>('button')!.click();
    expect(h.press).toHaveBeenCalledWith('Papara', { event_id: 'th_2', button: 0 });
  });

  it('speaks the widget languages, English for anything else', () => {
    expect(cardText('tr').copied).toBe('Kod kopyalandı: ');
    expect(cardText('xx')).toEqual(cardText('en'));
  });
});
