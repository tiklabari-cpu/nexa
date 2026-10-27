import { describe, expect, it } from 'vitest';
import {
  aiDisclosureSentence,
  aiOpening,
  customerChatOwner,
  hasAiDisclosure,
  humanButtonText,
  turkishGenitive,
  withAiOpening,
} from './ai-disclosure.js';

describe('the AI disclosure (tm 308 · AI-29 · G16)', () => {
  it('takes the Turkish genitive by vowel harmony, after a vowel and after a consonant', () => {
    expect(turkishGenitive('SiyahTuş')).toBe("'un");
    expect(turkishGenitive('Bilyoner')).toBe("'in");
    expect(turkishGenitive('Bahis')).toBe("'in");
    expect(turkishGenitive('Kumarhane')).toBe("'nin");
    expect(turkishGenitive('Kasa')).toBe("'nın");
    expect(turkishGenitive('Oyun')).toBe("'un");
    expect(turkishGenitive('Tombala Kulübü')).toBe("'nün");
    expect(turkishGenitive('Gol')).toBe("'un");
    expect(turkishGenitive('Kör')).toBe("'ün");
    // Turkish case: a dotless capital I is ı, a dotted one i.
    expect(turkishGenitive('ILIK')).toBe("'ın");
    expect(turkishGenitive('İZMİR')).toBe("'in");
    expect(turkishGenitive('BTK')).toBe("'nin");
  });

  it('names the assistant and the brand in the reply language (FR-MOD-11.3)', () => {
    expect(aiDisclosureSentence({ name: 'Asena', brand: 'Kasa', language: 'tr' })).toBe(
      "Asena, Kasa'nın yapay zekâ asistanıyım.",
    );
    expect(aiDisclosureSentence({ name: 'Asena', brand: 'Kasa', language: null })).toBe(
      "Asena, Kasa'nın yapay zekâ asistanıyım.",
    );
    expect(aiDisclosureSentence({ name: 'Ava', brand: 'Betway', language: 'en' })).toBe(
      'I am Ava, Betway’s AI assistant.',
    );
    expect(aiDisclosureSentence({ name: 'Ava', brand: 'Spins', language: 'en' })).toBe(
      'I am Ava, Spins’ AI assistant.',
    );
    expect(aiDisclosureSentence({ name: 'Ava', brand: 'Kasa', language: 'de' })).toBe(
      'Ich bin Ava, der KI-Assistent von Kasa.',
    );
    expect(aiDisclosureSentence({ name: 'Ava', brand: 'Kasa', language: 'fr' })).toContain('IA');
    expect(aiDisclosureSentence({ name: 'Ava', brand: 'Kasa', language: 'es' })).toContain('IA');
  });

  it('puts the sentence in front of a workspace opening that leaves it out (FR-MOD-11.3)', () => {
    const sentence = "Asena, Kasa'nın yapay zekâ asistanıyım.";
    expect(aiOpening(sentence, null)).toBe(sentence);
    expect(aiOpening(sentence, '   ')).toBe(sentence);
    expect(aiOpening(sentence, 'Hoş geldiniz!')).toBe(`${sentence} Hoş geldiniz!`);
    // Written into the opening already — case, spacing, quote and full stop aside.
    const own = 'Merhaba! asena,  KASA’nın yapay zekâ asistanıyım — nasıl yardımcı olabilirim?';
    expect(hasAiDisclosure(own, sentence)).toBe(true);
    expect(aiOpening(sentence, own)).toBe(own);
    // A brand said otherwise than spelt: the workspace writes its own ending.
    const betway = aiDisclosureSentence({ name: 'Ava', brand: 'Betway', language: 'tr' });
    expect(betway).toBe("Ava, Betway'ın yapay zekâ asistanıyım.");
    expect(hasAiDisclosure("Ava, Betway'in yapay zekâ asistanıyım.", betway)).toBe(true);
    expect(hasAiDisclosure('Ava, Betway yapay zekâ asistanı.', betway)).toBe(false);
  });

  it('opens the reply once', () => {
    const opening = "Asena, Kasa'nın yapay zekâ asistanıyım.";
    const once = withAiOpening('Para çekme 24 saat sürer.', opening);
    expect(once).toBe(`${opening}\n\nPara çekme 24 saat sürer.`);
    expect(withAiOpening(once, opening)).toBe(once);
  });
});

describe('the button’s words (AI-29-S1)', () => {
  it('are the workspace’s, else the default in the conversation’s language, else English', () => {
    expect(humanButtonText('Canlı destek', 'en')).toBe('Canlı destek');
    expect(humanButtonText(null, 'tr')).toBe('Temsilciyle görüş');
    expect(humanButtonText(null, 'ar')).toBe('تحدث إلى موظف');
    expect(humanButtonText(null, null)).toBe('Talk to an agent');
    expect(humanButtonText(null, 'xx')).toBe('Talk to an agent');
  });
});

describe('who has the connection (AI-29 §2)', () => {
  const thread = { assigneeId: null, queuePosition: null, aiMode: null, aiAgentActive: true };

  it('the AI while it answers, then a person assigned, then the queue', () => {
    // `parallel`: assigned on open, and the AI answers until the agent writes.
    expect(customerChatOwner({ ...thread, assigneeId: 'a', aiMode: 'ai' })).toBe('ai');
    expect(customerChatOwner({ ...thread, assigneeId: 'a', aiMode: 'human' })).toBe('human');
    expect(customerChatOwner({ ...thread, assigneeId: 'a' })).toBe('human');
    expect(customerChatOwner({ ...thread, queuePosition: 2, aiMode: 'human' })).toBe('queue');
    expect(customerChatOwner({ ...thread, aiMode: 'ai' })).toBe('ai');
    expect(customerChatOwner(thread)).toBe('ai');
  });

  it('a connection the AI never joined is not its own when no agent is on', () => {
    expect(customerChatOwner({ ...thread, aiAgentActive: false })).toBe('queue');
    expect(customerChatOwner({ ...thread, aiMode: 'ai', aiAgentActive: false })).toBe('ai');
  });

  it('a connection handed over or held back waits for a person', () => {
    expect(customerChatOwner({ ...thread, aiMode: 'human' })).toBe('queue');
    expect(customerChatOwner({ ...thread, aiMode: 'paused' })).toBe('queue');
  });
});
