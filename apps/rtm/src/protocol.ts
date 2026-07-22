/**
 * RTM wire codec (ADR-15). The envelope is byte-compatible with the source
 * platform so third-party client SDKs stay portable.
 *
 *   in  : { version?, request_id, action, payload }
 *   out : { request_id, action, type: 'response', success, payload }
 *         { action, type: 'push', payload }
 */
import {
  RTM_ACTIONS,
  RTM_VERSION,
  type ErrorType,
  type RtmAction,
  type RtmPushAction,
} from '@nexa/types';

export interface DecodedRequest {
  version: string;
  request_id: string;
  action: RtmAction;
  payload: Record<string, unknown>;
}

export type DecodeResult =
  | { ok: true; value: DecodedRequest }
  | {
      ok: false;
      /** Echoed back so the client can settle the right pending promise. */
      requestId: string;
      action: RtmAction | 'unknown';
      error: { type: ErrorType; message: string };
    };

const MAX_REQUEST_ID_LENGTH = 64;

export function decodeRequest(raw: string): DecodeResult {
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return {
      ok: false,
      requestId: '-',
      action: 'unknown',
      error: { type: 'validation', message: 'Message is not valid JSON.' },
    };
  }

  if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) {
    return {
      ok: false,
      requestId: '-',
      action: 'unknown',
      error: { type: 'validation', message: 'Message must be a JSON object.' },
    };
  }

  const message = parsed as Record<string, unknown>;

  // Recovered before validating anything else: without echoing request_id the
  // client's promise for this call would hang until its own timeout.
  const requestId =
    typeof message['request_id'] === 'string' &&
    message['request_id'].length <= MAX_REQUEST_ID_LENGTH
      ? message['request_id']
      : '-';

  const action = message['action'];
  if (typeof action !== 'string' || !(RTM_ACTIONS as readonly string[]).includes(action)) {
    return {
      ok: false,
      requestId,
      action: 'unknown',
      error: { type: 'validation', message: `Unknown action: ${String(action)}` },
    };
  }

  const version = typeof message['version'] === 'string' ? message['version'] : RTM_VERSION;
  if (version !== RTM_VERSION) {
    return {
      ok: false,
      requestId,
      action: action as RtmAction,
      error: { type: 'unsupported_version', message: `Unsupported protocol version: ${version}` },
    };
  }

  if (requestId === '-') {
    return {
      ok: false,
      requestId,
      action: action as RtmAction,
      error: { type: 'validation', message: 'request_id is required.' },
    };
  }

  const payload = message['payload'];
  if (
    payload !== undefined &&
    (typeof payload !== 'object' || payload === null || Array.isArray(payload))
  ) {
    return {
      ok: false,
      requestId,
      action: action as RtmAction,
      error: { type: 'validation', message: 'payload must be an object.' },
    };
  }

  return {
    ok: true,
    value: {
      version,
      request_id: requestId,
      action: action as RtmAction,
      payload: (payload as Record<string, unknown> | undefined) ?? {},
    },
  };
}

export function encodeResponse(requestId: string, action: RtmAction, payload: unknown): string {
  return JSON.stringify({
    request_id: requestId,
    action,
    type: 'response',
    success: true,
    payload,
  });
}

export function encodeError(
  requestId: string,
  action: RtmAction | 'unknown',
  error: { type: ErrorType; message: string; details?: Record<string, unknown> },
): string {
  return JSON.stringify({
    request_id: requestId,
    action,
    type: 'response',
    success: false,
    payload: {
      error: {
        type: error.type,
        message: error.message,
        request_id: requestId,
        ...(error.details ? { details: error.details } : {}),
      },
    },
  });
}

export function encodePush(action: RtmPushAction, payload: unknown): string {
  return JSON.stringify({ action, type: 'push', payload });
}
