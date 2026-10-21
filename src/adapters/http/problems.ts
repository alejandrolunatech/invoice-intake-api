import type { ErrorRequestHandler } from 'express';
import type { Logger } from 'pino';
import { ZodError } from 'zod';
import { IdempotencyKeyReusedError, IllegalTransitionError, NotFoundError, VersionMismatchError } from '../../application/errors.js';

const TYPES = 'https://github.com/alejandrolunatech/invoice-intake-api/blob/main/docs/problems.md#';

/** An RFC 9457 problem the API sends on purpose, with a stable type. */
export class Problem extends Error {
  override readonly name = 'Problem';

  constructor(readonly status: number, readonly type: string, readonly title: string, detail: string) {
    super(detail);
  }
}

function fromError(error: unknown): Problem {
  if (error instanceof Problem) {
    return error;
  }
  if (error instanceof ZodError) {
    const where = error.issues.map((issue) => `${issue.path.join('.') || 'body'}: ${issue.message}`).join('; ');
    return new Problem(400, 'invalid-request', 'Invalid request', where);
  }
  if (error instanceof NotFoundError) {
    return new Problem(404, 'not-found', 'Not found', error.message);
  }
  if (error instanceof IdempotencyKeyReusedError) {
    return new Problem(422, 'idempotency-key-reused', 'Idempotency key reused', error.message);
  }
  if (error instanceof VersionMismatchError) {
    return new Problem(412, 'version-mismatch', 'Changed since you read it', error.message);
  }
  if (error instanceof IllegalTransitionError) {
    return new Problem(409, 'illegal-transition', 'Not allowed in this status', error.message);
  }
  if (typeof error === 'object' && error !== null && 'type' in error && error.type === 'entity.parse.failed') {
    return new Problem(400, 'invalid-request', 'Invalid request', 'the body is not valid JSON');
  }
  if (typeof error === 'object' && error !== null && 'type' in error && error.type === 'entity.too.large') {
    return new Problem(413, 'too-large', 'Request too large', 'the body is larger than 100 kB');
  }
  return new Problem(500, 'internal', 'Internal error', 'something went wrong; it has been logged');
}

/** Every error leaves as application/problem+json. Only unexpected errors are logged, by name. */
export function problemHandler(logger: Logger): ErrorRequestHandler {
  return (error: unknown, req, res, _next) => {
    const problem = fromError(error);
    if (problem.status >= 500) {
      logger.error({ err: { name: error instanceof Error ? error.name : 'unknown' }, route: req.path }, 'unexpected error');
    }
    res.status(problem.status).type('application/problem+json').json({
      type: TYPES + problem.type, title: problem.title, status: problem.status, detail: problem.message, instance: req.originalUrl,
    });
  };
}
