import { describe, expect, it } from 'vitest';
import { parseTranscriptPage, transcriptFileUrl, transcriptPrintAddress } from './transcript.js';

const PAGE = `<!doctype html>
<html lang="tr">
<head><meta charset="utf-8"><title>Sohbet dökümü</title><style>main.transcript { color: #111; }</style></head>
<body>
<main class="transcript">
<h1>Sohbet dökümü — İç kopya (dahili notlar dahil)</h1>
<dl><dt>Çalışma alanı</dt><dd>Şans &amp; Oyun</dd><dt>Oyuncu</dt><dd>ayse_k77</dd></dl>
<section><h2>20 Ekim 2026 Salı</h2><ol>
<li class="line customer"><span class="time">10:15</span><span class="who">Ayşe</span><p class="text">Çekim ğşıİ &lt;b&gt;bekliyor&lt;/b&gt;<br>(dosya: dekont.pdf)</p></li>
<li class="line note"><span class="time">10:16</span><span class="who">Ada · dahili not</span><p class="text">KYC</p></li>
</ol></section>
<p class="zone">Saatler Europe/Istanbul saatine göredir.</p>
</main>
</body>
</html>`;

describe('the transcript print page (AR-04 · tm 338)', () => {
  it('reads the header, the days and the lines out of the page as text', () => {
    const page = parseTranscriptPage(PAGE)!;
    expect(page.lang).toBe('tr');
    expect(page.title).toBe('Sohbet dökümü — İç kopya (dahili notlar dahil)');
    expect(page.style).toContain('main.transcript');
    expect(page.rows).toEqual([
      ['Çalışma alanı', 'Şans & Oyun'],
      ['Oyuncu', 'ayse_k77'],
    ]);
    expect(page.days).toEqual([
      {
        heading: '20 Ekim 2026 Salı',
        lines: [
          {
            role: 'customer',
            time: '10:15',
            who: 'Ayşe',
            // What was typed stays text: the escaped tag is not markup here either.
            text: ['Çekim ğşıİ <b>bekliyor</b>', '(dosya: dekont.pdf)'],
          },
          { role: 'note', time: '10:16', who: 'Ada · dahili not', text: ['KYC'] },
        ],
      },
    ]);
    expect(page.empty).toBeNull();
    expect(page.zone).toBe('Saatler Europe/Istanbul saatine göredir.');
  });

  it('refuses a page that is not a transcript', () => {
    expect(parseTranscriptPage('<html><body><p>Error</p></body></html>')).toBeNull();
  });

  it('builds the download and print addresses', () => {
    expect(transcriptFileUrl('DAY1', 'CONN1', 'html', 'internal')).toBe(
      '/chats/DAY1/threads/CONN1/transcript?format=html&audience=internal',
    );
    expect(transcriptPrintAddress('DAY1', 'CONN1', 'customer')).toBe(
      '/app/archive/DAY1/print?thread=CONN1&copy=customer',
    );
  });
});
