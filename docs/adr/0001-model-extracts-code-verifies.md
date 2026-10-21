# ADR 0001: The model extracts, code verifies

Status: accepted, October 2026

## Context

Supplier invoices arrive in every layout: labelled fields, Dutch tables, an email paragraph. A language model reads them far better than templates or regexes. It can also misread a digit, invent a plausible IBAN, or follow instructions hidden in the text. A wrong IBAN or total sends real money to the wrong place.

## Decision

- The model's reply is untrusted data. It must parse against one Zod contract (`extraction-contract.ts`), or the invoice goes to a person.
- Plain functions in `domain/verification.ts` then check every claim: KvK number format, VAT id checksum, IBAN checksum, allowed VAT rates, that lines, VAT and total add up in integer cents, dates and the payment term, and that every identifier the model returned literally appears in the source text.
- A use case adds the duplicate check: same supplier, same invoice number.
- `ACCEPTED` only when everything passes. Anything else is `NEEDS_REVIEW` with the failed check codes. When the model is unavailable, the invoice waits for a person: there is no rules fallback for reading invoices.

## Consequences

- The model can lower throughput, not move money on its own.
- Grounding catches invented identifiers, not every misreading: a model that copies the wrong IBAN from the same page still passes it. The eval set includes a page with two IBANs and a prompt injection that names a third, so that failure shows up in the numbers.
