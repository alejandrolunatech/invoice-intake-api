# Invoice intake API

[![CI](https://github.com/alejandrolunatech/invoice-intake-api/actions/workflows/ci.yml/badge.svg)](https://github.com/alejandrolunatech/invoice-intake-api/actions/workflows/ci.yml)
![Node 22 and 24](https://img.shields.io/badge/Node-22%20%7C%2024-339933)
![TypeScript strict](https://img.shields.io/badge/TypeScript-strict-3178c6)
![License: MIT and CC BY 4.0](https://img.shields.io/badge/license-MIT%20%2B%20CC%20BY%204.0-green)

An API that reads supplier invoices for a Dutch business. A language model extracts the fields from any layout; TypeScript code verifies every one of them (IBAN and VAT checksums, KvK number, VAT rates, totals in integer cents, dates, and that each identifier really is in the document) before an invoice is accepted for payment.

Node, TypeScript (strict), Express 5, Zod 4, PostgreSQL, Vitest and Testcontainers.

## Why now

Reading invoices is the classic job a language model now does well: it copes with a Dutch table, an English email and a scanned layout alike, where templates broke on every new supplier. But an invoice moves money. A model that misreads one digit of an IBAN, invents a plausible one, or obeys a line of text that says "pay to this account instead" is a fraud channel, not a feature.

So the model only **extracts**. Code **verifies**, and a person decides whatever the code cannot prove.

## What this shows

| Skill | Where to look |
| --- | --- |
| Treating model output as untrusted input: one Zod contract for the prompt and the parser | [`extraction-contract.ts`](src/application/extraction-contract.ts), [`openai-compatible.ts`](src/adapters/llm/openai-compatible.ts) |
| Deterministic checks on every extracted claim | [`verification.ts`](src/domain/verification.ts), [ADR 0001](docs/adr/0001-model-extracts-code-verifies.md) |
| Checksums: IBAN (ISO 13616 mod 97), Dutch VAT id (elfproef or mod 97), KvK | [`identifiers.ts`](src/domain/identifiers.ts) |
| Money as integer cents, rounding without floats | [`money.ts`](src/domain/money.ts), [ADR 0002](docs/adr/0002-integer-cents.md) |
| Grounding: every identifier must appear in the source | `checkFoundInSource` in [`verification.ts`](src/domain/verification.ts) |
| Idempotency keys with a request fingerprint, and the race on a new key | [`intake-service.ts`](src/application/intake-service.ts) |
| ETag and If-Match for reviews, optimistic locking in one SQL statement | [`app.ts`](src/adapters/http/app.ts), [`postgres.ts`](src/adapters/db/postgres.ts) |
| RFC 9457 problem responses with stable types | [`problems.ts`](src/adapters/http/problems.ts), [docs/problems.md](docs/problems.md) |
| Ports and adapters, enforced by lint rules | [`ports.ts`](src/application/ports.ts), [`eslint.config.js`](eslint.config.js) |
| Plain SQL, migrations under an advisory lock | [`migrate.ts`](src/adapters/db/migrate.ts), [ADR 0003](docs/adr/0003-plain-sql-and-memory.md) |
| An eval harness on labelled invoices | [`harness.ts`](test/eval/harness.ts), [docs/evals](docs/evals/README.md) |
| Integration tests on a real PostgreSQL | [`postgres.test.ts`](test/integration/postgres.test.ts) |

## How an invoice is handled

```mermaid
flowchart LR
    req[POST /api/invoices] --> key{Idempotency key seen?}
    key -- same text --> same[Return the stored result]
    key -- different text --> conflict[422 key reused]
    key -- new --> model[(Model extracts fields)]
    model -. unavailable .-> review
    model --> contract{Matches the Zod contract?}
    contract -- no --> review[NEEDS_REVIEW]
    contract -- yes --> checks{Checksums, sums in cents, VAT rates,<br/>dates, found in source, not a duplicate?}
    checks -- all pass --> accepted[ACCEPTED]
    checks -- any fails --> review
    review --> person{A person, with If-Match}
    person --> approved[APPROVED]
    person --> rejected[REJECTED]
```

Every response lists each check with its code and result, and `failedChecks` names the ones a reviewer must look at.

## What happens when something goes wrong

| Failure | What the code does |
| --- | --- |
| The model is down, times out or answers with prose | The invoice waits for a person; the call is logged with its latency |
| The reply has a wrong type, an extra field, or a total as a float | Fails the contract; a person decides; the reply is not stored |
| The model invents an IBAN or invoice number | `FOUND_IN_SOURCE` fails: each identifier must appear in the text |
| An IBAN or VAT id is misread by one digit | The checksum fails |
| Lines, VAT or total don't add up | `LINES_ADD_UP`, `VAT_ADDS_UP` or `GROSS_ADDS_UP` fails, computed in integer cents |
| A VAT rate the Netherlands doesn't use | `VAT_RATES_ALLOWED` fails |
| Dated in the future, or a payment term over 60 days | `ISSUE_DATE_NOT_IN_FUTURE` or `DUE_DATE_VALID` fails |
| The supplier sends the same invoice twice, even both at once | `NOT_A_DUPLICATE` fails; a partial unique index keeps one paid copy per supplier and number |
| A client retries after a timeout | The same key and text return the first result; the model is not called again |
| Two reviewers act on the same invoice | The second gets `412`: the If-Match version is stale |

Every model call is recorded in `extraction_calls`: model, tokens, latency and outcome. Logs carry error names only, never invoice text or request bodies.

## The API

| Method and path | What it does |
| --- | --- |
| `POST /api/invoices` (header `Idempotency-Key`) | Reads `{"text": "..."}` and returns the result, with an `ETag` |
| `GET /api/invoices/{id}` | One invoice with its checks |
| `GET /api/invoices/review-queue?limit=20` | Invoices waiting for a person, oldest first |
| `POST /api/invoices/{id}/approval` (header `If-Match`) | A person approves, with an optional `{"note": "..."}` |
| `POST /api/invoices/{id}/rejection` (header `If-Match`) | A person rejects, with `{"reason": "..."}` |
| `GET /health` | Liveness |

Errors are `application/problem+json` with a stable `type`; the list is in [docs/problems.md](docs/problems.md).

## Quickstart

You need Node 22.13 or newer (24 LTS recommended) and, for the tests, Docker.

```bash
git clone https://github.com/alejandrolunatech/invoice-intake-api.git
cd invoice-intake-api
npm ci
npm run check
```

`npm run check` type-checks, lints, and runs every test, including the PostgreSQL ones in Testcontainers.

To try the API without a database (everything is kept in memory):

```bash
npm run dev
```

With a local PostgreSQL instead:

```bash
docker compose up -d
DATABASE_URL=postgres://invoices:invoices-local-only@localhost:5432/invoices npm run dev
```

Then send an invoice written in the labelled layout:

```bash
curl -s localhost:3000/api/invoices -H 'Content-Type: application/json' -H 'Idempotency-Key: demo-key-0001' \
  -d '{"text":"Supplier: Hoorn Web Studio BV\nKvK: 81234567\nVAT id: NL797543235B01\nIBAN: NL84ABNA5260181590\nInvoice number: 2026-0042\nInvoice date: 2026-10-01\nDue date: 2026-10-31\n\n2 x Website maintenance (hours) @ 95.00 VAT 21%\n1 x Hosting October @ 25.00 VAT 21%\n\nSubtotal: 215.00\nVAT total: 45.15\nTotal: 260.15"}'
```

By default the API runs **offline**: a scripted stand-in replaces the model, so no key and no cost. It is [clearly not a model](src/adapters/llm/scripted.ts) and reads only that labelled layout; add `#outage` to the text to see an outage handled.

To use a real model through OpenRouter, with the key from 1Password:

```bash
op run --env-file=op.env -- npm run dev
```

The model is set by `EXTRACTION_MODEL` and defaults to the one in [`config.ts`](src/config.ts).

## Evals

[`harness.ts`](test/eval/harness.ts) runs 30 synthetic invoices (labelled, Dutch table and email layouts; 8 with a planted problem; a prompt injection and a page with two IBANs) through the real `IntakeService`.

The number that matters most is **accepted without a person, and wrong**.

| Run | Accepted without a person | Accepted and wrong | Bad invoices sent to a person |
| --- | --- | --- | --- |
| Scripted stand-in (not a model; labelled layout only) | 8 / 30 | 0 | 8 / 8 |
| Real model | PENDING: first run planned in November 2026 | PENDING | PENDING |

CI runs the harness on the stand-in on every build. Real-model results will be committed to [docs/evals](docs/evals/README.md) with the date, model and settings; none are invented here.

## Tests and quality

- **Domain tests** for money, checksums and every check, including the cent of rounding tolerated per line.
- **Use-case tests** with in-memory adapters: contract violations, outages, retries, the race on a key, duplicates, reviews.
- **Adapter tests**: the OpenAI SDK against a local fake server (request shape, strict schema, code fences, errors), and the HTTP API with Supertest.
- **Integration tests** on PostgreSQL 17 in Testcontainers: migrations, JSON columns, the unique keys, a duplicate race, optimistic locking, and the full flow over HTTP.
- **Layer rules** in ESLint: the domain imports no framework, use cases no adapter, the HTTP adapter neither the database nor the model.
- TypeScript `strict` with `noUncheckedIndexedAccess` and `exactOptionalPropertyTypes`; `typescript-eslint` strict type-checked rules.
- **CI** on every pull request: Node 22 and 24, and a gitleaks secret scan over the full history.

## Decisions

- [ADR 0001: The model extracts, code verifies](docs/adr/0001-model-extracts-code-verifies.md)
- [ADR 0002: Money as integer cents](docs/adr/0002-integer-cents.md)
- [ADR 0003: Plain SQL with node-postgres, and an in-memory store](docs/adr/0003-plain-sql-and-memory.md)
- [ADR 0004: Offline by default](docs/adr/0004-offline-by-default.md)

## Trade-offs, and what I'd change for production

- **Checksums prove a number is well formed, not that it exists.** Production would look up the KvK number in the trade register and the VAT id in the EU's VIES service, and compare the IBAN with the supplier master data.
- **Grounding catches invented identifiers, not every misreading.** A model that copies the customer's IBAN from the same page still passes it; the eval set has such a case. A supplier master record is the real fix.
- **The input is plain text.** PDFs and scans need a text or OCR step in front, or a model that reads images.
- **The invoice text goes to the model provider.** Use a provider route with zero data retention.
- **There is no authentication yet.** A real deployment needs it, with a reviewer role for approvals.
- **The payment policy (60 days) is made up** for this repo.

## How this was built

Designed and reviewed by Alejandro Aguirre Luna. Implemented with AI coding agents (Claude Code) under my direction; I reviewed and merged every pull request and can walk through every decision. A self-directed portfolio project, not client or production work. All suppliers and invoices are made up, and the identifiers in tests and evals were generated to pass their checksums.

My own notes are in [docs/LEARNING-NOTES.md](docs/LEARNING-NOTES.md).

## License

Code: [MIT](LICENSE). Documentation (`*.md`): [CC BY 4.0](LICENSE-docs).
