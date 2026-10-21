# ADR 0003: Plain SQL with node-postgres, and an in-memory store

Status: accepted, October 2026

## Context

The data model is two tables. An ORM would add a dependency and hide the queries that matter here: the unique idempotency key and the optimistic-locking update.

## Decision

- `PostgresInvoices` uses parameterised SQL through `pg`. Extracted fields and check results are `jsonb`; the supplier's KvK number and invoice number are also columns, indexed for the duplicate check.
- Migrations are numbered SQL files applied once each by a short runner, inside a transaction, under an advisory lock.
- `InMemoryInvoices` implements the same port, for unit tests and for trying the API without a database.
- Reviews update with `where id = $1 and version = $2`, so a stale review changes nothing and becomes a `412`.

## Consequences

- Every query is visible in one file. Changes to the schema are hand-written SQL.
- The in-memory store must behave like the real one; the integration tests run the same flow on PostgreSQL to keep them honest.
