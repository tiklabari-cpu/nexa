/**
 * Terminal error handling: every failure leaves the process as the ADR-06
 * envelope, with a request_id that matches the log line.
 *
 * Unrecognised errors are deliberately flattened to a generic `internal`
 * message. Stack traces, SQL fragments and driver messages go to the log, never
 * to the client.
 */
import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import fp from 'fastify-plugin';
import { ZodError } from 'zod';
import { ApiError, isApiError } from '../lib/api-error.js';

function zodToApiError(error: ZodError): ApiError {
  const fields = error.issues.map((issue) => ({
    field: issue.path.join('.') || '(root)',
    message: issue.message,
  }));
  const first = fields[0];
  return ApiError.validation(
    first ? `${first.field}: ${first.message}` : 'Request failed validation.',
    { fields },
  );
}

function normalise(error: unknown): ApiError {
  if (isApiError(error)) return error;
  if (error instanceof ZodError) return zodToApiError(error);

  // Fastify's own errors (schema validation, body parsing, 404s).
  const fastifyError = error as {
    statusCode?: number;
    code?: string;
    message?: string;
    validation?: unknown;
  };
  if (fastifyError.validation) {
    return ApiError.validation(fastifyError.message ?? 'Request failed validation.');
  }
  // A body over `bodyLimit` was answering 500 with a generic envelope, which
  // reads as "we broke" when the caller is the one who has to change something.
  // Found while pinning the 1 MiB limit down for uploads (FR-MOD-08.9.4).
  if (fastifyError.code === 'FST_ERR_CTP_BODY_TOO_LARGE') {
    return ApiError.validation('Request body is larger than this endpoint accepts.');
  }
  // Every other body the content-type parser refuses — malformed JSON, an empty
  // JSON body, a media type nothing parses, a body shorter than its
  // Content-Length — is the caller's to fix too. Matched by prefix and by
  // Fastify's own 4xx, not by a list: a malformed JSON body was missing from
  // the list and answered 500 with an error-level line (tm 256.6). The parser's
  // 500s (a parser registered twice, …) are ours and stay `internal`.
  if (
    fastifyError.code?.startsWith('FST_ERR_CTP_') &&
    fastifyError.statusCode !== undefined &&
    fastifyError.statusCode >= 400 &&
    fastifyError.statusCode < 500
  ) {
    return ApiError.validation(fastifyError.message ?? 'Invalid request body.');
  }
  if (fastifyError.statusCode === 404) return ApiError.notFound('Route not found.');
  if (fastifyError.statusCode === 401) return ApiError.authentication();
  if (fastifyError.statusCode === 403) return ApiError.authorization();

  return ApiError.internal('Internal server error.', error);
}

async function errorHandlerPlugin(app: FastifyInstance): Promise<void> {
  app.setErrorHandler((error, request: FastifyRequest, reply: FastifyReply) => {
    const apiError = normalise(error);

    const logPayload = {
      err: error,
      request_id: request.id,
      error_type: apiError.type,
      method: request.method,
      url: request.url,
    };
    if (apiError.status >= 500) {
      request.log.error(logPayload, apiError.message);
    } else {
      request.log.warn(logPayload, apiError.message);
    }

    if (apiError.headers) reply.headers(apiError.headers);
    return reply.status(apiError.status).send(apiError.toBody(request.id));
  });

  app.setNotFoundHandler((request, reply) => {
    const error = ApiError.notFound('Route not found.');
    return reply.status(error.status).send(error.toBody(request.id));
  });
}

export default fp(errorHandlerPlugin, { name: 'error-handler' });
