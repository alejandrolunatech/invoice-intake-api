create table invoices (
    id               uuid         primary key,
    idempotency_key  varchar(100) not null unique,
    fingerprint      varchar(64)  not null,
    status           varchar(20)  not null,
    source_text      text         not null,
    extracted        jsonb,
    checks           jsonb        not null,
    note             varchar(500),
    supplier_kvk     varchar(20),
    invoice_number   varchar(60),
    received_at      timestamptz  not null,
    version          integer      not null
);

create index invoices_review_queue on invoices (received_at) where status = 'NEEDS_REVIEW';
create index invoices_supplier_number on invoices (supplier_kvk, invoice_number) where status <> 'REJECTED';
-- At most one accepted or approved copy of an invoice, even when two copies arrive at the same moment.
create unique index invoices_one_paid_copy on invoices (supplier_kvk, invoice_number)
    where status in ('ACCEPTED', 'APPROVED');

-- One row per model call: what it cost and how it ended. Never the invoice text or the reply.
create table extraction_calls (
    id             bigint generated always as identity primary key,
    called_at      timestamptz  not null,
    invoice_id     uuid         not null,
    model          varchar(100),
    input_tokens   integer      not null,
    output_tokens  integer      not null,
    latency_ms     integer      not null,
    outcome        varchar(30)  not null
);
