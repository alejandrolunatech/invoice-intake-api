import { pino } from 'pino';
import request from 'supertest';
import { describe, expect, it } from 'vitest';
import { InMemoryExtractionLog, InMemoryInvoices } from '../../src/adapters/db/memory.js';
import { createApp } from '../../src/adapters/http/app.js';
import { ScriptedExtractor } from '../../src/adapters/llm/scripted.js';
import { IntakeService } from '../../src/application/intake-service.js';
import { SOURCE } from '../support/invoices.js';

function app() {
  const intake = new IntakeService({
    extractor: new ScriptedExtractor(), invoices: new InMemoryInvoices(), extractionLog: new InMemoryExtractionLog(),
    now: () => new Date('2026-10-21T09:00:00Z'),
  });
  return createApp(intake, pino({ level: 'silent' }));
}

const submit = (server: ReturnType<typeof app>, text: string, key = 'key-00000001') =>
  request(server).post('/api/invoices').set('Idempotency-Key', key).send({ text });

describe('HTTP API', () => {
  it('accepts a clean invoice with a Location and an ETag', async () => {
    const response = await submit(app(), SOURCE);

    expect(response.status).toBe(201);
    expect(response.headers.location).toBe(`/api/invoices/${response.body.id}`);
    expect(response.headers.etag).toBe('"1"');
    expect(response.body).toMatchObject({ status: 'ACCEPTED', failedChecks: [], invoice: { invoiceNumber: '2026-0042' } });
    expect(response.body).not.toHaveProperty('sourceText');
  });

  it('requires a well-formed Idempotency-Key', async () => {
    const server = app();
    const missing = await request(server).post('/api/invoices').send({ text: SOURCE });
    const short = await submit(server, SOURCE, 'short');

    expect(missing.status).toBe(400);
    expect(missing.headers['content-type']).toContain('application/problem+json');
    expect(short.body.type).toMatch(/#invalid-request$/);
  });

  it('describes an invalid body as a problem', async () => {
    const response = await submit(app(), 'too short');

    expect(response.status).toBe(400);
    expect(response.body).toMatchObject({ status: 400, title: 'Invalid request' });
    expect(response.body.detail).toContain('text');
  });

  it('refuses malformed JSON and unknown routes as problems', async () => {
    const server = app();
    const broken = await request(server).post('/api/invoices').set('Idempotency-Key', 'key-00000001')
      .set('Content-Type', 'application/json').send('{"text":');
    const unknown = await request(server).get('/api/nothing');

    expect(broken.status).toBe(400);
    expect(unknown.status).toBe(404);
    expect(unknown.body.type).toMatch(/#not-found$/);
  });

  it('reviews need If-Match, and a stale one is refused', async () => {
    const server = app();
    const created = await submit(server, SOURCE.replace(/KvK: \d+\n/, ''));
    const url = `/api/invoices/${created.body.id}`;
    expect(created.body.status).toBe('NEEDS_REVIEW');

    expect((await request(server).post(`${url}/approval`).send({})).status).toBe(428);
    expect((await request(server).post(`${url}/approval`).set('If-Match', '"9"').send({})).status).toBe(412);
    const approved = await request(server).post(`${url}/approval`).set('If-Match', '"1"').send({ note: 'KvK checked by phone' });
    expect(approved.status).toBe(200);
    expect(approved.headers.etag).toBe('"2"');
    const again = await request(server).post(`${url}/rejection`).set('If-Match', '"2"').send({ reason: 'duplicate' });
    expect(again.status).toBe(409);
    expect(again.body.type).toMatch(/#illegal-transition$/);
  });

  it('shows the review queue and finds one invoice', async () => {
    const server = app();
    const created = await submit(server, SOURCE.replace('Total: 260.15', 'Total: 261.15'));

    const queue = await request(server).get('/api/invoices/review-queue?limit=5');
    const one = await request(server).get(`/api/invoices/${created.body.id}`);

    expect(queue.body.invoices).toHaveLength(1);
    expect(one.body.failedChecks).toEqual(['GROSS_ADDS_UP']);
    expect((await request(server).get('/api/invoices/review-queue?limit=500')).status).toBe(400);
    expect((await request(server).get('/api/invoices/not-a-uuid')).status).toBe(400);
  });

  it('refuses the same key with another invoice', async () => {
    const server = app();
    await submit(server, SOURCE);

    const response = await submit(server, `${SOURCE}\nnote`);

    expect(response.status).toBe(422);
    expect(response.body.type).toMatch(/#idempotency-key-reused$/);
  });
});
