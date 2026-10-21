import { describe, expect, it } from 'vitest';
import { ScriptedExtractor } from '../../src/adapters/llm/scripted.js';
import { extractionContract } from '../../src/application/extraction-contract.js';
import { ExtractorUnavailableError } from '../../src/application/ports.js';
import { SOURCE, invoice } from '../support/invoices.js';

describe('ScriptedExtractor (not a model)', () => {
  it('reads the simple labelled format into the contract', async () => {
    const { reply, usage } = await new ScriptedExtractor().extract(SOURCE);

    expect(extractionContract.parse(reply)).toEqual(invoice());
    expect(usage.model).toBe('scripted-stand-in');
  });

  it('can play an outage for demos', async () => {
    await expect(new ScriptedExtractor().extract(`${SOURCE}#outage`)).rejects.toThrow(ExtractorUnavailableError);
  });
});
