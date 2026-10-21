/** The expected failures of the use cases. The HTTP adapter maps each one to a problem type. */
export class NotFoundError extends Error {
  override readonly name = 'NotFoundError';
}

export class IdempotencyKeyReusedError extends Error {
  override readonly name = 'IdempotencyKeyReusedError';
}

export class VersionMismatchError extends Error {
  override readonly name = 'VersionMismatchError';
}

export class IllegalTransitionError extends Error {
  override readonly name = 'IllegalTransitionError';
}
