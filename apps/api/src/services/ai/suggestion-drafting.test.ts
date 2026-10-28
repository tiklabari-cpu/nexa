import { describe, expect, it } from 'vitest';
import type { SuggestionExcerptMessage } from '@siyahtus/types';
import {
  buildSuggestionDraftPrompt,
  draftSourceOf,
  generaliseSpecifics,
  lexicalDraft,
  readSuggestionDraftReply,
  SUGGESTION_DRAFT_MARKER,
} from './suggestion-drafting.js';

const ANSWER =
  'Merhaba Ali Veli, ali123 hesabınıza 2.500 TL çekim 14.10.2026 tarihinde PPR-20261014-482913 numarasıyla gönderildi. Papara çekimleri artık 7/24 değil, hafta içi 09:00–18:00 arası işleniyor; ayrıntı https://example.test/papara-123456 sayfasında.';

const message = (
  author: SuggestionExcerptMessage['author_type'],
  text: string,
  marked = false,
): SuggestionExcerptMessage => ({
  event_id: `T${Math.random()}`,
  author_type: author,
  is_ai: author === 'bot',
  text,
  created_at: new Date(0).toISOString(),
  marked,
});

describe('the suggestion generaliser (AI-23 §2 · tm 318.1)', () => {
  it('takes the player’s username, amount, date and reference out and keeps the policy', () => {
    const { text, removed } = generaliseSpecifics(ANSWER, {
      names: ['Ali Veli'],
      usernames: ['ali123'],
      emails: ['ali@example.test'],
    });
    expect(text).not.toContain('ali123');
    expect(text).not.toContain('2.500');
    expect(text).not.toContain('14.10.2026');
    expect(text).not.toContain('PPR-20261014-482913');
    expect(text).not.toMatch(/\bAli\b|\bVeli\b/u);
    expect(text).toContain('Papara çekimleri artık 7/24 değil');
    expect(text).toContain('09:00–18:00');
    // A link is knowledge: its digits are not a reference.
    expect(text).toContain('https://example.test/papara-123456');
    expect(removed).toEqual(['name', 'username', 'amount', 'date', 'reference']);
  });

  it('finds a username and an amount it was not told about', () => {
    const { text, removed } = generaliseSpecifics(
      'mehmet_88 için ₺1500 ve 250,50 USDT iade edildi.',
    );
    expect(text).toBe('[kullanıcı adı] için [tutar] ve [tutar] iade edildi.');
    expect(removed).toEqual(['username', 'amount']);
  });

  it('leaves policy words alone: networks in capitals, dashed words, bare small numbers', () => {
    const text = 'USDT yalnız TRC20 ağında; e-posta ile 3 iş günü içinde, en az 100 adet.';
    expect(generaliseSpecifics(text)).toEqual({ text, removed: [] });
  });

  it('takes an e-mail, a phone and a long digit run', () => {
    const { text, removed } = generaliseSpecifics(
      'ali.veli@mail.test adresine ve 0532 123 45 67 numarasına 98765432 kodlu işlem.',
    );
    expect(text).toBe('[e-posta] adresine ve [telefon] numarasına [işlem no] kodlu işlem.');
    expect(removed).toEqual(['email', 'phone', 'reference']);
  });

  it('stays linear on a long hostile text', () => {
    const hostile = `${'a1-'.repeat(50_000)}${'ali123 '.repeat(20_000)}${'9'.repeat(100_000)}`;
    const started = performance.now();
    generaliseSpecifics(hostile, { names: ['Ali Veli'], usernames: ['ali123'] });
    expect(performance.now() - started).toBeLessThan(2000);
  });
});

describe('the lexical draft and the model’s reply (AI-23 §2)', () => {
  it('drafts a knowledge snippet without the specifics, masked, titled from its first words', () => {
    const draft = lexicalDraft(`${ANSWER} Kart: 4111 1111 1111 1111`, 'promote_agent_answer', {
      usernames: ['ali123'],
    });
    expect(draft?.draftedBy).toBe('lexical');
    expect(draft?.change.target).toBe('knowledge_snippet');
    expect(draft?.change.body).not.toContain('ali123');
    expect(draft?.change.body).not.toContain('2.500 TL');
    expect(draft?.change.body).not.toContain('4111 1111 1111 1111');
    expect(draft?.change.title.split(' ').length).toBeLessThanOrEqual(10);
    expect(lexicalDraft('   ', 'promote_agent_answer', {})).toBeNull();
  });

  it('generalises the model’s reply again: a model that kept a username does not get it in', () => {
    const draft = readSuggestionDraftReply(
      {
        title: 'Papara çekim saatleri',
        body: 'ali123 gibi oyunculara: Papara çekimleri 2.500 TL üstünde hafta içi işlenir.',
        applies_to_intent: 'papara çekim',
        removed_specifics: ['name', 'bogus'],
      },
      { usernames: ['ali123'] },
    );
    expect(draft?.draftedBy).toBe('llm');
    expect(draft?.change.body).toBe(
      '[kullanıcı adı] gibi oyunculara: Papara çekimleri [tutar] üstünde hafta içi işlenir.',
    );
    expect(draft?.removed).toEqual(['name', 'username', 'amount']);
    expect(readSuggestionDraftReply({ title: 'x' }, {})).toBeNull();
    expect(readSuggestionDraftReply({ title: ' ', body: 'y' }, {})).toBeNull();
  });

  it('puts the agent’s words on one JSON line after the marker', () => {
    const prompt = buildSuggestionDraftPrompt('Papara 7/24 değil.', 'missing_info');
    const lines = prompt.system.split('\n');
    expect(lines[lines.length - 2]).toBe(SUGGESTION_DRAFT_MARKER);
    expect(JSON.parse(lines[lines.length - 1]!)).toBe('Papara 7/24 değil.');
  });
});

describe('what a drafted suggestion is written from', () => {
  const excerpt = [
    message('customer', 'Papara ile çekim yapabilir miyim?'),
    message('bot', 'Evet, 7/24.', true),
    message('agent', 'Papara artık 7/24 değil.'),
    message('agent', 'Hafta içi işleniyor.'),
  ];

  it('an offered answer: the marked agent message, else every agent message', () => {
    const marked = [message('agent', 'Önce bu.'), message('agent', 'Bu işaretli.', true)];
    expect(draftSourceOf('promote_agent_answer', marked, null)).toBe('Bu işaretli.');
    expect(draftSourceOf('promote_agent_answer', excerpt, null)).toBe(
      'Papara artık 7/24 değil.\nHafta içi işleniyor.',
    );
  });

  it('a "lacked this" mark: the agent messages after the marked one, then the note', () => {
    expect(draftSourceOf('missing_info', excerpt, 'Kaynak: finans ekibi.')).toBe(
      'Papara artık 7/24 değil.\nHafta içi işleniyor.\nKaynak: finans ekibi.',
    );
    expect(draftSourceOf('missing_info', [message('bot', 'x', true)], null)).toBe('');
  });
});
