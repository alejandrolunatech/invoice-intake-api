import { describe, expect, it } from 'vitest';
import { OpenAiCompatibleExtractor } from '../../src/adapters/llm/openai-compatible.js';
import { loadCases, report, runEval, writeReport } from './harness.js';

/**
 * The real-model run: 30 calls. Off unless EVAL_LIVE=1, and the key comes only from the
 * environment: op run --env-file=op.env -- npm run eval:live
 */
describe.skipIf(process.env.EVAL_LIVE !== '1')('eval on a real model', () => {
  it('runs the cases and writes a report', async () => {
    const apiKey = process.env.LLM_API_KEY;
    expect(apiKey, 'LLM_API_KEY must be set').toBeTruthy();
    const model = process.env.EXTRACTION_MODEL ?? 'anthropic/claude-haiku-5.5';
    const extractor = new OpenAiCompatibleExtractor({
      baseURL: process.env.LLM_BASE_URL ?? 'https://openrouter.ai/api/v1', apiKey: apiKey ?? '', model,
    });

    const run = await runEval(extractor, await loadCases());

    const file = await writeReport(`eval-${model.replace('/', '_')}-${new Date().toISOString().slice(0, 10)}.md`,
      report(run, model, 'Real model through an OpenAI-compatible API, temperature 0, one run, synthetic invoices.'));
    console.log(`Report written to ${file}`);
    expect(run.results).toHaveLength(30);
  });
});
