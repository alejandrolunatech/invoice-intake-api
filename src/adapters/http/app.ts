import express, { type Request } from 'express';
import type { Logger } from 'pino';
import { z } from 'zod';
import type { IntakeService } from '../../application/intake-service.js';
import type { InvoiceRecord } from '../../application/ports.js';
import { Problem, problemHandler } from './problems.js';

const submitBody = z.strictObject({ text: z.string().trim().min(20).max(50_000) });
const rejectBody = z.strictObject({ reason: z.string().trim().min(3).max(500) });
const approveBody = z.strictObject({ note: z.string().trim().max(500).optional() });
const idempotencyKey = z.string().regex(/^[A-Za-z0-9_-]{8,100}$/, 'must be 8 to 100 letters, digits, - or _');
const queueQuery = z.object({ limit: z.coerce.number().int().min(1).max(100).default(20) });

/** The JSON a client sees. The source text stays out of it; the review page can fetch it later. */
function view(record: InvoiceRecord) {
  return {
    id: record.id, status: record.status, note: record.note, receivedAt: record.receivedAt, version: record.version,
    invoice: record.extracted, checks: record.checks,
    failedChecks: record.checks.filter((check) => !check.passed).map((check) => check.code),
  };
}

const etag = (record: InvoiceRecord) => `"${record.version}"`;

/** Reviews must say which version they saw, with If-Match, so two reviewers can't overwrite each other. */
function expectedVersion(req: Request): number {
  const header = req.get('If-Match');
  if (header === undefined) {
    throw new Problem(428, 'if-match-required', 'If-Match required', 'send the ETag you read in an If-Match header');
  }
  const match = /^"(\d+)"$/.exec(header.trim());
  if (!match) {
    throw new Problem(400, 'invalid-request', 'Invalid request', 'If-Match must be an ETag such as "1"');
  }
  return Number(match[1]);
}

export function createApp(intake: IntakeService, logger: Logger) {
  const app = express();
  app.disable('x-powered-by');
  app.use(express.json({ limit: '100kb' }));
  app.use((req, res, next) => {
    const started = performance.now();
    res.on('finish', () => {
      logger.info({ method: req.method, route: req.route ? String((req.route as { path: unknown }).path) : req.path,
        status: res.statusCode, ms: Math.round(performance.now() - started) }, 'request');
    });
    next();
  });

  app.get('/health', (_req, res) => {
    res.json({ status: 'UP' });
  });

  app.post('/api/invoices', async (req, res) => {
    const key = idempotencyKey.safeParse(req.get('Idempotency-Key'));
    if (!key.success) {
      throw new Problem(400, 'invalid-request', 'Invalid request', 'Idempotency-Key header: must be 8 to 100 letters, digits, - or _');
    }
    const { text } = submitBody.parse(req.body);
    const record = await intake.submit(text, key.data);
    res.status(201).location(`/api/invoices/${record.id}`).set('ETag', etag(record)).json(view(record));
  });

  app.get('/api/invoices/review-queue', async (req, res) => {
    const { limit } = queueQuery.parse(req.query);
    res.json({ invoices: (await intake.reviewQueue(limit)).map(view) });
  });

  app.get('/api/invoices/:id', async (req, res) => {
    const record = await intake.get(z.uuid().parse(req.params.id));
    res.set('ETag', etag(record)).json(view(record));
  });

  app.post('/api/invoices/:id/approval', async (req, res) => {
    const id = z.uuid().parse(req.params.id);
    const version = expectedVersion(req);
    const { note } = approveBody.parse(req.body ?? {});
    const record = await intake.approve(id, version, note ?? null);
    res.set('ETag', etag(record)).json(view(record));
  });

  app.post('/api/invoices/:id/rejection', async (req, res) => {
    const id = z.uuid().parse(req.params.id);
    const version = expectedVersion(req);
    const { reason } = rejectBody.parse(req.body);
    const record = await intake.reject(id, version, reason);
    res.set('ETag', etag(record)).json(view(record));
  });

  app.use((req, _res, next) => {
    next(new Problem(404, 'not-found', 'Not found', `no route for ${req.method} ${req.path}`));
  });
  app.use(problemHandler(logger));
  return app;
}
