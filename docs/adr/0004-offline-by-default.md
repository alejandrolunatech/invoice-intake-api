# ADR 0004: Offline by default

Status: accepted, October 2026

## Context

Anyone who clones the repo, and every CI run, should be able to build, test and run the API without a key, without cost, and with the same result every time.

## Decision

- The default extractor is `ScriptedExtractor`, a deterministic stand-in that reads only the labelled layout and is named and documented as not a model.
- `EXTRACTOR=openai` switches to `OpenAiCompatibleExtractor`, which works with OpenRouter or any OpenAI-compatible API. The key comes only from the environment, through 1Password references in `op.env`.
- The OpenAI adapter's tests run the real SDK against a local fake server. The live eval runs only with `EVAL_LIVE=1`.

## Consequences

- CI proves the code paths and the harness, not model quality. Real-model results are run by hand and committed with their date, model and settings.
