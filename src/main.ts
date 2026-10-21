import pg from 'pg';
import { pino } from 'pino';
import { InMemoryExtractionLog, InMemoryInvoices } from './adapters/db/memory.js';
import { migrate } from './adapters/db/migrate.js';
import { PostgresExtractionLog, PostgresInvoices } from './adapters/db/postgres.js';
import { createApp } from './adapters/http/app.js';
import { OpenAiCompatibleExtractor } from './adapters/llm/openai-compatible.js';
import { ScriptedExtractor } from './adapters/llm/scripted.js';
import { IntakeService } from './application/intake-service.js';
import { loadConfig } from './config.js';

/** The one place that picks adapters. Without DATABASE_URL the API keeps everything in memory. */
const config = loadConfig();
const logger = pino({ level: config.LOG_LEVEL, redact: ['text', 'sourceText', 'req.body', 'apiKey'] });

const pool = config.DATABASE_URL ? new pg.Pool({ connectionString: config.DATABASE_URL }) : undefined;
if (pool) {
  const applied = await migrate(pool);
  logger.info({ applied }, 'database ready');
}

const extractor = config.EXTRACTOR === 'openai'
  ? new OpenAiCompatibleExtractor({ baseURL: config.LLM_BASE_URL, apiKey: config.LLM_API_KEY ?? '', model: config.EXTRACTION_MODEL })
  : new ScriptedExtractor();

const intake = new IntakeService({
  extractor,
  invoices: pool ? new PostgresInvoices(pool) : new InMemoryInvoices(),
  extractionLog: pool ? new PostgresExtractionLog(pool) : new InMemoryExtractionLog(),
  now: () => new Date(),
});

const server = createApp(intake, logger).listen(config.PORT, () => {
  logger.info({ port: config.PORT, extractor: config.EXTRACTOR, storage: pool ? 'postgres' : 'memory' }, 'listening');
});

for (const signal of ['SIGINT', 'SIGTERM'] as const) {
  process.on(signal, () => {
    server.close(() => void pool?.end());
  });
}
