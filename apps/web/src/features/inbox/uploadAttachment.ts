/**
 * Turn a picked file into an `attachment_url` an event can carry.
 *
 * Two steps, mirroring the server split (FR-MOD-08.9.4): `POST /uploads` asks
 * permission — this is where the licence's file-sharing rules refuse a type or
 * size — and only then does the signed `PUT` move the bytes. The returned
 * `file_url` is what belongs on the message's `attachment_url`.
 */
import type { ApiClient } from '../../lib/api-client.js';

export interface UploadedAttachment {
  fileUrl: string;
  contentType: string;
  name: string;
}

export async function uploadAttachment(api: ApiClient, file: File): Promise<UploadedAttachment> {
  const grant = await api.post<{ upload_url: string; file_url: string }>('/uploads', {
    filename: file.name,
    content_type: file.type,
    size_bytes: file.size,
  });

  // The PUT is authorised by the signature inside the URL, not the session, and
  // its body is raw bytes — so it bypasses the JSON client and goes to `fetch`
  // directly. The dev proxy sends `/api/...` to the API just the same.
  const response = await fetch(grant.upload_url, {
    method: 'PUT',
    headers: { 'Content-Type': file.type },
    body: file,
    credentials: 'same-origin',
  });
  if (!response.ok) {
    throw new Error(`Upload failed with status ${response.status}.`);
  }

  return { fileUrl: grant.file_url, contentType: file.type, name: file.name };
}
