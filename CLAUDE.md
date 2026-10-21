# Working in this repo

A portfolio repo: an invoice intake API in TypeScript where a language model extracts the fields and code verifies them. Read `README.md` first, then the ADRs in `docs/adr/`.

- Code is written fresh for this repo. Never copy code, names, rules or data from an employer, a client, or any paid task platform. Suppliers, identifiers and invoices are made up; identifiers in tests are generated to pass checksums.
- Keep the layers: `src/domain` is plain TypeScript, `src/application` reaches the outside only through `ports.ts`, adapters don't know each other. ESLint enforces this (`eslint.config.js`).
- Money is integer cents, never a float. Amounts from the model are strings until `domain/money.ts` parses them.
- Tests never call a network or a real model. The default extractor is the scripted stand-in. The live eval runs only with `EVAL_LIVE=1`, and only when the owner asks, because it spends his money.
- Never write a model result that was not produced by a real run. Eval rows in `docs/evals/README.md` carry the date, model and settings.
- Secrets: only `op://` references in `op.env`. No key in any file, test, log or commit. Logs carry error names, never invoice text or request bodies.
- Migrations in `src/adapters/db/migrations/` are append-only once merged: add the next number, never edit one.
- Run `npm run check` (typecheck, lint, all tests; needs Docker) before every push.
- Claude works on a feature branch and opens a pull request. Never push to `main`, never merge.
- `docs/LEARNING-NOTES.md` is the owner's own writing. Don't fill it in.
