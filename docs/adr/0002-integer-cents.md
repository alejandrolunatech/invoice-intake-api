# ADR 0002: Money as integer cents, amounts as strings at the edge

Status: accepted, October 2026

## Context

In JavaScript `0.1 + 0.2` is `0.30000000000000004`. An invoice check that compares floats will reject correct invoices or accept wrong ones by a cent.

## Decision

- The contract asks the model for amounts and quantities as plain strings such as `"1250.00"` and `"1.5"`.
- `domain/money.ts` parses them into integer cents and quantities into thousandths, multiplies and rounds with integer arithmetic (half away from zero), and formats them back.
- VAT is computed per rate on the summed net of that rate. Because some invoices round per line, a difference of up to one cent per line is tolerated.

## Consequences

- No float ever touches money in the checks. Amounts above about 90 trillion euros would lose precision; invoices don't get there.
- A model that writes `1.250,00` fails the `AMOUNTS_READABLE` check instead of being guessed at.
