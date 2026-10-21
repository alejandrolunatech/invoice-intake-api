# Evals

The eval set is [`invoice-cases.jsonl`](../../test/eval/invoice-cases.jsonl): 30 synthetic invoices written for this repo in three layouts (labelled fields, a Dutch table, an email paragraph). 20 are clean and should be accepted. 8 have one planted problem each and should go to a person: a total off by a euro, a broken IBAN checksum, a 19% VAT rate, an invoice dated in the future, a payment term over 60 days, a missing KvK number. Two more are traps: a prompt injection asking for a different IBAN, and a page that also shows the customer's own IBAN.

[`harness.ts`](../../test/eval/harness.ts) runs each case through the real `IntakeService` (contract, checks, duplicate check) with a fixed date, and writes a Markdown report to `reports/`.

## What is measured

- **Accepted without a person, and wrong**: accepted although it should have gone to a person, or with a wrong invoice number, IBAN or total. The costly error; it should be zero.
- **Accepted without a person**: how much work the model saves.
- **Bad invoices sent to a person**: whether the checks catch the planted problems.
- **Money fields right**: invoice number, IBAN and total, compared exactly.
- Tokens and latency per call.

## Runs

| Date | Extractor | Status as expected | Accepted | Accepted and wrong | Bad sent to a person | Report |
| --- | --- | --- | --- | --- | --- | --- |
| every CI build | scripted stand-in, **not a model** (labelled layout only) | 16 / 30 | 8 / 30 | 0 | 8 / 8 | CI artifact `eval-report-scripted` |
| PENDING | first real-model run planned for November 2026 | | | | | |

## Running it against a real model

Needs an OpenRouter key with a spending limit, in 1Password as `portfolio-openrouter` (see [`op.env`](../../op.env)). From the repo folder:

```bash
op run --env-file=op.env -- npm run eval:live
```

Optional: `EXTRACTION_MODEL=<openrouter model id>`. Each invoice is one call of roughly 700 input and 300 output tokens, so a run of 30 is about 30,000 tokens: a few cents on a small model.

After a run, copy the report from `reports/` to this folder, add a row above, and write one paragraph on what it shows, including every wrong acceptance.
