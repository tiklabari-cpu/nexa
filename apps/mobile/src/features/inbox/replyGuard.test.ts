import { deviceLocale, replyGuardCopy } from './replyGuard';

describe('reply guard copy (tm 475.5)', () => {
  it('says it in Turkish and in English', () => {
    expect(replyGuardCopy('tr').notMine).toBe(
      'Bu sohbet artık sizde değil; yanıtlamak için konsoldan üstüne alın.',
    );
    expect(replyGuardCopy('en').notMine).toBe(
      'This chat is no longer yours; take it from the console to reply.',
    );
    expect(replyGuardCopy('tr').notSent).toBe('Gönderilmedi — bu sohbet artık sizde değil.');
    expect(replyGuardCopy('en').notSent).toBe('Not sent — this chat is no longer yours.');
  });

  it('follows the device language', () => {
    const spy = jest.spyOn(Intl, 'DateTimeFormat');
    try {
      spy.mockReturnValue({
        resolvedOptions: () => ({ locale: 'tr-TR' }),
      } as unknown as Intl.DateTimeFormat);
      expect(deviceLocale()).toBe('tr');
      spy.mockReturnValue({
        resolvedOptions: () => ({ locale: 'de-DE' }),
      } as unknown as Intl.DateTimeFormat);
      expect(deviceLocale()).toBe('en');
    } finally {
      spy.mockRestore();
    }
  });
});
