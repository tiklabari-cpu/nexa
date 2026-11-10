/**
 * The two key shapes (tm 357 · HD-02): an upload's and an e-mailed file's.
 *
 * The point of the second shape is what it is *not*: an upload key. Every door
 * that takes an upload key — `GET /uploads/{key}`, the composer's
 * `attachment_keys`, a chat's `attachment_url` — asks `licenseOfKey`, so the
 * one property that keeps a sensitive e-mailed file behind the ticket's door
 * (role check, audit entry) is that `licenseOfKey` refuses it.
 */
import { describe, expect, it } from 'vitest';
import {
  buildInvoiceKey,
  buildKey,
  buildKnowledgeKey,
  buildMailKey,
  KnowledgeDownloadSigner,
  keyFromAttachmentUrl,
  licenseOfInvoiceKey,
  licenseOfKey,
  licenseOfKnowledgeKey,
  licenseOfMailKey,
  licenseOfStoredKey,
  mediaTypeOf,
  storedObjectPath,
  UPLOAD_PATH_PREFIX,
  UploadSigner,
} from './upload-url.js';

describe('upload and e-mailed-file keys', () => {
  it('builds an e-mailed-file key under its licence, with the extension of its type', () => {
    const key = buildMailKey(42n, 'application/pdf');
    expect(key).toMatch(/^42-m-[0-9a-f-]{36}\.pdf$/);
    expect(licenseOfMailKey(key)).toBe(42n);
    expect(licenseOfStoredKey(key)).toBe(42n);
  });

  it('is not an upload key, so no upload door serves or accepts it', () => {
    const key = buildMailKey(42n, 'image/png');
    expect(licenseOfKey(key)).toBeNull();
    expect(keyFromAttachmentUrl(`${UPLOAD_PATH_PREFIX}${key}`)).toBeNull();
  });

  it('keeps an upload key what it was — and not an e-mailed one', () => {
    const key = buildKey(42n, 'image/png');
    expect(licenseOfKey(key)).toBe(42n);
    expect(licenseOfMailKey(key)).toBeNull();
    expect(licenseOfStoredKey(key)).toBe(42n);
  });

  it('refuses anything that is neither', () => {
    for (const key of ['', '42', '42-m-', '../42-m-x.pdf', '42-m-not-a-uuid.pdf', 'x-m-1.pdf']) {
      expect(licenseOfStoredKey(key), key).toBeNull();
    }
  });
});

/**
 * The third shape (tm 313.1 · AI-18): a knowledge document. Like an e-mailed
 * file it is not an upload key, so `GET /uploads/{key}` never serves it; unlike
 * one it is uploaded, so the upload signer takes it.
 */
describe('knowledge document keys', () => {
  const PDF = 'application/pdf';
  const DOCX = 'application/vnd.openxmlformats-officedocument.wordprocessingml.document';

  it('builds a key under its licence with the extension of the vetted type', () => {
    const pdfKey = buildKnowledgeKey(42n, PDF);
    expect(pdfKey).toMatch(/^42-k-[0-9a-f-]{36}\.pdf$/);
    expect(buildKnowledgeKey(42n, DOCX)).toMatch(/^42-k-[0-9a-f-]{36}\.docx$/);
    expect(licenseOfKnowledgeKey(pdfKey)).toBe(42n);
    expect(licenseOfStoredKey(pdfKey)).toBe(42n);
  });

  it('is neither an upload key nor an e-mailed one, so no attachment door serves it', () => {
    const key = buildKnowledgeKey(42n, PDF);
    expect(licenseOfKey(key)).toBeNull();
    expect(licenseOfMailKey(key)).toBeNull();
    expect(keyFromAttachmentUrl(`${UPLOAD_PATH_PREFIX}${key}`)).toBeNull();
    expect(licenseOfKnowledgeKey(buildKey(42n, PDF))).toBeNull();
    expect(licenseOfKnowledgeKey(buildMailKey(42n, PDF))).toBeNull();
  });

  it('refuses any other extension and any malformed key', () => {
    const uuid = '0f0e0d0c-0b0a-4908-8706-050403020100';
    for (const key of [
      `42-k-${uuid}.docm`,
      `42-k-${uuid}`,
      `42-k-${uuid}.exe`,
      `../42-k-${uuid}.pdf`,
    ]) {
      expect(licenseOfKnowledgeKey(key), key).toBeNull();
    }
  });

  it('lays a document out under its own prefix and everything else where it was', () => {
    const doc = buildKnowledgeKey(42n, DOCX);
    expect(storedObjectPath(doc)).toBe(`42/knowledge/${doc}`);
    const upload = buildKey(42n, 'image/png');
    expect(storedObjectPath(upload)).toBe(`42/${upload}`);
    const mail = buildMailKey(42n, PDF);
    expect(storedObjectPath(mail)).toBe(`42/${mail}`);
    expect(storedObjectPath('../etc/passwd')).toBeNull();
  });

  it('is a key the upload signer grants, and an e-mailed file never is', () => {
    const signer = new UploadSigner('test-signing-key-test-signing-key');
    const expiresAt = Math.floor(Date.now() / 1000) + 60;
    const key = buildKnowledgeKey(42n, PDF);
    const grant = { key, contentType: PDF, sizeBytes: 10, expiresAt };
    expect(
      signer.verify(
        { ...grant, signature: signer.sign(grant) },
        { contentType: PDF, sizeBytes: 10 },
      ),
    ).toEqual({ ok: true, grant });

    const mail = { ...grant, key: buildMailKey(42n, PDF) };
    expect(
      signer.verify({ ...mail, signature: signer.sign(mail) }, { contentType: PDF, sizeBytes: 10 }),
    ).toEqual({ ok: false, reason: 'malformed' });
  });
});

describe('knowledge download links', () => {
  const secret = 'test-signing-key-test-signing-key';
  const signer = new KnowledgeDownloadSigner(secret);
  const key = buildKnowledgeKey(7n, 'application/pdf');
  const now = 1_800_000_000;
  const grant = { key, filename: 'Bonus şartları.pdf', expiresAt: now + 300 };

  it('honours its own link until it expires', () => {
    const signature = signer.sign(grant);
    expect(signer.verify({ ...grant, signature }, now)).toEqual(grant);
    expect(signer.verify({ ...grant, signature }, now + 300)).toBeNull();
  });

  it('refuses a link whose key, filename or expiry was changed', () => {
    const signature = signer.sign(grant);
    const other = buildKnowledgeKey(7n, 'application/pdf');
    expect(signer.verify({ ...grant, key: other, signature }, now)).toBeNull();
    expect(signer.verify({ ...grant, filename: 'x.pdf', signature }, now)).toBeNull();
    expect(signer.verify({ ...grant, expiresAt: now + 9999, signature }, now)).toBeNull();
    expect(signer.verify({ ...grant, signature: `${signature}x` }, now)).toBeNull();
  });

  it('never accepts an upload signature, or a link for anything but a knowledge document', () => {
    const upload = new UploadSigner(secret);
    const asUpload = upload.sign({
      key,
      contentType: grant.filename,
      sizeBytes: grant.expiresAt,
      expiresAt: grant.expiresAt,
    });
    expect(signer.verify({ ...grant, signature: asUpload }, now)).toBeNull();

    const attachment = { ...grant, key: buildKey(7n, 'application/pdf') };
    expect(signer.verify({ ...attachment, signature: signer.sign(attachment) }, now)).toBeNull();
  });
});

describe('invoice PDF keys (tm 383 · BL-02)', () => {
  it('lives under its licence in its own prefix, and no upload or mail door takes it', () => {
    const key = buildInvoiceKey(42n);
    expect(key).toMatch(/^42-i-[0-9a-f-]{36}\.pdf$/);
    expect(licenseOfInvoiceKey(key)).toBe(42n);
    expect(licenseOfStoredKey(key)).toBe(42n);
    expect(storedObjectPath(key)).toBe(`42/invoices/${key}`);
    expect(licenseOfKey(key)).toBeNull();
    expect(licenseOfMailKey(key)).toBeNull();
    expect(keyFromAttachmentUrl(`${UPLOAD_PATH_PREFIX}${key}`)).toBeNull();
  });

  it('refuses another extension and a path in front', () => {
    const key = buildInvoiceKey(42n);
    expect(licenseOfInvoiceKey(key.replace('.pdf', '.csv'))).toBeNull();
    expect(licenseOfInvoiceKey(`../${key}`)).toBeNull();
  });
});

describe('the type a PUT carries (tm 446 · audit F42)', () => {
  it('reads the media type from a Content-Type header, parameters and case aside', () => {
    expect(mediaTypeOf('image/png')).toBe('image/png');
    expect(mediaTypeOf(' Text/Plain ; charset=UTF-8')).toBe('text/plain');
    expect(mediaTypeOf(['application/pdf', 'text/html'])).toBe('application/pdf');
    expect(mediaTypeOf(undefined)).toBe('');
    expect(mediaTypeOf('')).toBe('');
  });

  it('refuses a genuine, live grant whose request names another type, and only past the signature', () => {
    const signer = new UploadSigner('test-signing-key-test-signing-key');
    const grant = {
      key: buildKey(42n, 'application/pdf'),
      contentType: 'application/pdf',
      sizeBytes: 10,
      expiresAt: Math.floor(Date.now() / 1000) + 60,
    };
    const signed = { ...grant, signature: signer.sign(grant) };

    expect(signer.verify(signed, { contentType: 'application/pdf', sizeBytes: 10 })).toEqual({
      ok: true,
      grant,
    });
    expect(signer.verify(signed, { contentType: 'APPLICATION/PDF', sizeBytes: 10 })).toMatchObject({
      ok: true,
    });
    for (const header of ['application/x-msdownload', 'text/html', '']) {
      expect(signer.verify(signed, { contentType: header, sizeBytes: 10 }), header).toEqual({
        ok: false,
        reason: 'content_type_mismatch',
      });
    }
    // A forged signature says `bad_signature` whatever the header is: the
    // mismatch is only ever reported to the holder of a real grant.
    expect(
      signer.verify({ ...signed, signature: 'AAAA' }, { contentType: 'text/html', sizeBytes: 10 }),
    ).toEqual({ ok: false, reason: 'bad_signature' });
  });
});
