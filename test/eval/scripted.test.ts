import { readFile } from 'node:fs/promises';
import { describe, expect, it } from 'vitest';
import { ScriptedExtractor } from '../../src/adapters/llm/scripted.js';
import { acceptedWrongly, loadCases, report, runEval, writeReport } from './harness.js';

/** Runs the eval harness on the scripted stand-in in CI. It proves the harness, not a model. */
describe('eval harness on the scripted stand-in (not a model)', () => {
  it('runs every case, accepts nothing wrongly, and writes a report', async () => {
    const cases = await loadCases();
    const run = await runEval(new ScriptedExtractor(), cases);

    expect(cases).toHaveLength(30);
    expect(acceptedWrongly(run)).toEqual([]);
    const file = await writeReport('eval-scripted.md', report(run, 'scripted-stand-in',
      'NOT A MODEL. The deterministic stand-in reads only the labelled layout. Real-model results are in docs/evals/.'));
    expect(await readFile(file, 'utf8')).toContain('| inv-01 | labelled | clean | ACCEPTED | ACCEPTED | yes |');
  });
});
