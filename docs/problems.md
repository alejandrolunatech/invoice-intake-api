# Problem types

Every error response is `application/problem+json` ([RFC 9457](https://www.rfc-editor.org/rfc/rfc9457)). The `type` field is one of the links below, and clients can rely on it. The `detail` text is for people and may change.

## invalid-request

`400`. The body, a header, a path or a query parameter does not have the right shape. `detail` names the field.

## not-found

`404`. No invoice with that id, or no such route.

## if-match-required

`428`. Approving or rejecting needs an `If-Match` header with the `ETag` you read, so two reviewers can't overwrite each other.

## version-mismatch

`412`. The invoice changed after you read it. Read it again, then decide.

## illegal-transition

`409`. Only invoices in `NEEDS_REVIEW` can be approved or rejected.

## idempotency-key-reused

`422`. The `Idempotency-Key` was already used for a different invoice text. Use a new key for a new invoice.

## too-large

`413`. The body is larger than 100 kB.

## internal

`500`. Something unexpected went wrong. It is logged by error name, without the request body.
