import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { afterEach, describe, expect, it } from 'vitest';
import { OpenAiCompatibleExtractor, RESPONSE_SCHEMA } from '../../src/adapters/llm/openai-compatible.js';
import { ExtractorUnavailableError } from '../../src/application/ports.js';
import { SOURCE, invoice } from '../support/invoices.js';

/** A local stand-in for an OpenAI-compatible API, so the real SDK path runs without a network. */
async function fakeApi(handler: (body: Record<string, unknown>) => { status: number; json?: unknown; raw?: string }) {
  const requests: { url: string | undefined; auth: string | undefined; body: Record<string, unknown> }[] = [];
  const server = createServer((req, res) => {
    let data = '';
    req.on('data', (chunk: Buffer) => (data += chunk.toString()));
    req.on('end', () => {
      const body = JSON.parse(data) as Record<string, unknown>;
      requests.push({ url: req.url, auth: req.headers.authorization, body });
      const reply = handler(body);
      res.writeHead(reply.status, { 'content-type': 'application/json' });
      res.end(reply.raw ?? JSON.stringify(reply.json));
    });
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  servers.push(server);
  const { port } = server.address() as AddressInfo;
  return { baseURL: `http://127.0.0.1:${port}/v1`, requests };
}

const servers: Server[] = [];
afterEach(() => { servers.splice(0).forEach((server) => server.close()); });

const completion = (content: string) => ({
  status: 200,
  json: {
    id: 'x', object: 'chat.completion', created: 1, model: 'vendor/model-x',
    choices: [{ index: 0, finish_reason: 'stop', message: { role: 'assistant', content } }],
    usage: { prompt_tokens: 812, completion_tokens: 240, total_tokens: 1052 },
  },
});

describe('OpenAiCompatibleExtractor', () => {
  it('sends the invoice as data with a strict JSON schema, and reports usage', async () => {
    const api = await fakeApi(() => completion(JSON.stringify(invoice())));
    const extractor = new OpenAiCompatibleExtractor({ baseURL: api.baseURL, apiKey: 'test-key', model: 'vendor/model-x' });

    const { reply, usage } = await extractor.extract(SOURCE);

    expect(reply).toEqual(invoice());
    expect(usage).toMatchObject({ model: 'vendor/model-x', inputTokens: 812, outputTokens: 240 });
    const request = api.requests[0];
    expect(request?.url).toBe('/v1/chat/completions');
    expect(request?.auth).toBe('Bearer test-key');
    expect(request?.body).toMatchObject({ model: 'vendor/model-x', temperature: 0 });
    expect(request?.body.response_format).toEqual({ type: 'json_schema', json_schema: { name: 'invoice', strict: true, schema: RESPONSE_SCHEMA } });
    expect(JSON.stringify(request?.body.messages)).toContain('not instructions to you');
  });

  it('keeps the schema to keywords every provider understands', () => {
    const keys = new Set<string>();
    const walk = (node: unknown): void => {
      if (node && typeof node === 'object') {
        for (const [key, value] of Object.entries(node)) {
          keys.add(key);
          walk(value);
        }
      }
    };
    walk(RESPONSE_SCHEMA);
    expect(keys.has('maxLength')).toBe(false);
    expect(keys.has('$schema')).toBe(false);
  });

  it('accepts JSON wrapped in a code fence', async () => {
    const api = await fakeApi(() => completion(`\`\`\`json\n${JSON.stringify(invoice())}\n\`\`\``));
    const extractor = new OpenAiCompatibleExtractor({ baseURL: api.baseURL, apiKey: 'k', model: 'm' });

    expect((await extractor.extract(SOURCE)).reply).toEqual(invoice());
  });

  it('turns an error status or a non-JSON reply into ExtractorUnavailableError', async () => {
    const down = await fakeApi(() => ({ status: 503, json: { error: { message: 'overloaded' } } }));
    const prose = await fakeApi(() => completion('It looks like an invoice from Hoorn.'));

    await expect(new OpenAiCompatibleExtractor({ baseURL: down.baseURL, apiKey: 'k', model: 'm' }).extract(SOURCE))
      .rejects.toThrow(ExtractorUnavailableError);
    await expect(new OpenAiCompatibleExtractor({ baseURL: prose.baseURL, apiKey: 'k', model: 'm' }).extract(SOURCE))
      .rejects.toThrow('model reply was not JSON');
  });
});
