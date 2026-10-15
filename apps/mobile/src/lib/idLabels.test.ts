import { ID_GLOSSARY, ID_KINDS } from '@siyahtus/types';
import { idHint, idLabel } from './idLabels';

describe('idLabels (ID-01)', () => {
  it('labels every identifier kind with the glossary screen name and a hint', () => {
    for (const kind of ID_KINDS) {
      expect(idLabel(kind)).toBe(ID_GLOSSARY[kind].screenName);
      expect(idHint(kind).length).toBeGreaterThan(0);
    }
  });

  it('names the day container Thread ID and the connection Chat ID, with the owner hints', () => {
    expect(idLabel('day_thread')).toBe('Thread ID');
    expect(idHint('day_thread')).toBe('Üyenin bugünkü konuşma grubu');
    expect(idLabel('connection')).toBe('Chat ID');
    expect(idHint('connection')).toBe('Bu bağlantı');
  });
});
