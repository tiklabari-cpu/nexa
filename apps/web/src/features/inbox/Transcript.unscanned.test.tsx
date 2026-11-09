/**
 * The "Not checked for viruses" label (tm 433 · F21 · NY-51).
 *
 * The deployment's virus scanner is the mock — it refuses only the EICAR test
 * file and passes everything else without looking — so the server stamps every
 * attachment event `properties.scanned: false`. Without the label an agent
 * would open a customer's file believing it had been scanned. The pilot has the
 * same mock (no ClamAV, owner S12), so the label is not tied to any mode: it is
 * the server's word on the event, nothing else. A client cannot set the key —
 * the server strips it.
 */
import { render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { renderWithLocale, resetLocale } from '../../test/i18n.js';
import { Transcript } from './Transcript.js';
import type { ChatEvent } from './types.js';

// The file itself is fetched with the session's credentials; held pending here
// so the test reads the label, not a download.
vi.mock('../../lib/auth-store.js', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../lib/auth-store.js')>()),
  useApiClient: () => ({ getBlob: () => new Promise<Blob>(() => {}) }),
}));

function event(overrides: Partial<ChatEvent> = {}): ChatEvent {
  return {
    id: 'TJ1H8CFKRV_1',
    chat_id: 'TJ1H8CFKRV',
    thread_id: 'thread-1',
    type: 'file',
    text: null,
    author_id: 'cust-1',
    author_type: 'customer',
    recipients: 'all',
    attachment_url: '/api/v1/uploads/l1-abc/invoice.pdf',
    properties: { scanned: false },
    created_at: '2026-11-09T10:00:00.000Z',
    ...overrides,
  };
}

function transcript(events: ChatEvent[]) {
  return <Transcript chatId="TJ1H8CFKRV" events={events} loading={false} currentAgentId="a-1" />;
}

describe('Transcript — attachment not scanned for viruses', () => {
  afterEach(() => {
    resetLocale();
  });

  it('labels an attachment the server says was not scanned, with a hint for the agent', () => {
    render(transcript([event()]));
    const label = screen.getByTestId('attachment-unscanned');
    expect(label).toHaveTextContent('Not checked for viruses');
    expect(label).toHaveAttribute(
      'title',
      'This file was not checked for viruses. Open it only if you trust the sender.',
    );
  });

  it('labels an image and an agent’s own file the same way', () => {
    render(
      transcript([
        event({ id: 'TJ1H8CFKRV_1', attachment_url: '/api/v1/uploads/l1-a/photo.png' }),
        event({ id: 'TJ1H8CFKRV_2', author_type: 'agent', author_id: 'a-1' }),
      ]),
    );
    expect(screen.getAllByTestId('attachment-unscanned')).toHaveLength(2);
  });

  it('shows no label when the server says the file was scanned, or says nothing', () => {
    render(
      transcript([
        event({ id: 'TJ1H8CFKRV_1', properties: { scanned: true } }),
        event({ id: 'TJ1H8CFKRV_2', properties: {} }),
        event({ id: 'TJ1H8CFKRV_3', properties: { scanned: 'no' } }),
      ]),
    );
    expect(screen.queryByTestId('attachment-unscanned')).not.toBeInTheDocument();
  });

  it('labels nothing on a message without a file', () => {
    render(
      transcript([
        event({
          type: 'message',
          text: 'hello',
          attachment_url: null,
          properties: { scanned: false },
        }),
      ]),
    );
    expect(screen.queryByTestId('attachment-unscanned')).not.toBeInTheDocument();
  });

  it('reads in Turkish when that is the active locale', () => {
    renderWithLocale(transcript([event()]), 'tr');
    expect(screen.getByTestId('attachment-unscanned')).toHaveTextContent(
      'Virüs taraması yapılmadı',
    );
  });
});
