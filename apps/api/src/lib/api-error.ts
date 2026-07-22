/**
 * The single way to signal a failure to a client (ADR-06).
 *
 * The HTTP status is always derived from `type` via ERROR_STATUS rather than
 * passed in, so a route cannot accidentally return `not_found` with a 403 (or
 * any other combination that would leak whether a resource exists).
 */
import { ERROR_STATUS, type ApiErrorBody, type ErrorType } from '@nexa/types';

export class ApiError extends Error {
  readonly type: ErrorType;
  readonly status: number;
  readonly details?: Record<string, unknown>;
  /** Extra response headers, e.g. `Retry-After` on 429. */
  readonly headers?: Record<string, string>;

  constructor(
    type: ErrorType,
    message: string,
    options: {
      details?: Record<string, unknown>;
      headers?: Record<string, string>;
      cause?: unknown;
    } = {},
  ) {
    super(message, options.cause !== undefined ? { cause: options.cause } : undefined);
    this.name = 'ApiError';
    this.type = type;
    this.status = ERROR_STATUS[type];
    this.details = options.details;
    this.headers = options.headers;
  }

  toBody(requestId: string): ApiErrorBody {
    return {
      error: {
        type: this.type,
        message: this.message,
        request_id: requestId,
        ...(this.details ? { details: this.details } : {}),
      },
    };
  }

  // --- Named constructors for the cases routes reach for constantly ---------

  static validation(message: string, details?: Record<string, unknown>): ApiError {
    return new ApiError('validation', message, details ? { details } : {});
  }

  static authentication(message = 'Invalid or expired credentials.'): ApiError {
    return new ApiError('authentication', message);
  }

  static authorization(message = 'Insufficient permissions for this operation.'): ApiError {
    return new ApiError('authorization', message);
  }

  /**
   * Use for anything the caller may not see — including resources that exist in
   * a different tenant. Never return `authorization` for those: a 403 confirms
   * the ID is real and turns short IDs into an enumeration oracle (NFR-S5).
   */
  static notFound(message = 'Resource not found.'): ApiError {
    return new ApiError('not_found', message);
  }

  static chatInactive(message = 'Chat is not active.'): ApiError {
    return new ApiError('chat_inactive', message);
  }

  static tooManyRequests(retryAfterSeconds: number, message = 'Rate limit exceeded.'): ApiError {
    return new ApiError('too_many_requests', message, {
      headers: { 'Retry-After': String(Math.max(1, Math.ceil(retryAfterSeconds))) },
    });
  }

  static internal(message = 'Internal server error.', cause?: unknown): ApiError {
    return new ApiError('internal', message, cause !== undefined ? { cause } : {});
  }
}

export function isApiError(value: unknown): value is ApiError {
  return value instanceof ApiError;
}
