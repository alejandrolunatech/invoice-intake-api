import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { InMemoryExtractionLog, InMemoryInvoices } from '../../src/adapters/db/memory.js';
import { IntakeService } from '../../src/application/intake-service.js';
import type { InvoiceExtractor, InvoiceRecord } from '../../src/application/ports.js';
import { compact } from '../../src/domain/identifiers.js';

export interface EvalCase {
  id: string;
  style: 'labelled' | 'dutch' | 'prose';
  expected: 'ACCEPTED' | 'NEEDS_REVIEW';
  why: string;
  text: string;
  fields: { invoiceNumber: string; supplierIban: string; totalGross: string };
}

export interface EvalResult {
  testCase: EvalCase;
  record: InvoiceRecord;
  /** The three fields that move money, compared after removing spaces and case. */
  fieldsRight: boolean;
}

export async function loadCases(): Promise<EvalCase[]> {
  const text = await readFile(new URL('./invoice-cases.jsonl', import.meta.url), 'utf8');
  return text.split('\n').filter((line) => line.trim() !== '').map((line) => JSON.parse(line) as EvalCase);
}

/** Runs every case through the real IntakeService, with a fixed date so results don't drift. */
export async function runEval(extractor: InvoiceExtractor, cases: EvalCase[]) {
  const log = new InMemoryExtractionLog();
  const intake = new IntakeService({
    extractor, invoices: new InMemoryInvoices(), extractionLog: log, now: () => new Date('2026-10-21T09:00:00Z'),
  });
  const results: EvalResult[] = [];
  for (const testCase of cases) {
    const record = await intake.submit(testCase.text, `eval-${testCase.id}`);
    const got = record.extracted;
    const fieldsRight = got !== null
      && got.invoiceNumber === testCase.fields.invoiceNumber
      && compact(got.supplierIban ?? '') === compact(testCase.fields.supplierIban)
      && got.totalGross === testCase.fields.totalGross;
    results.push({ testCase, record, fieldsRight });
  }
  return { results, calls: log.entries };
}

export type EvalRun = Awaited<ReturnType<typeof runEval>>;

/** Accepted without a person, but either it should have gone to one or a money field is wrong. */
export const acceptedWrongly = (run: EvalRun) =>
  run.results.filter((r) => r.record.status === 'ACCEPTED' && (r.testCase.expected !== 'ACCEPTED' || !r.fieldsRight));

export function report(run: EvalRun, model: string, caveat: string): string {
  const { results, calls } = run;
  const count = (predicate: (r: EvalResult) => boolean) => results.filter(predicate).length;
  const latencies = calls.map((c) => c.latencyMs).sort((a, b) => a - b);
  const p = (q: number) => latencies[Math.max(0, Math.ceil(q * latencies.length) - 1)] ?? 0;
  const rows = results.map((r) => {
    const right = r.record.status === r.testCase.expected;
    const status = right ? r.record.status : `**${r.record.status}**`;
    return `| ${r.testCase.id} | ${r.testCase.style} | ${r.testCase.why} | ${r.testCase.expected} | ${status} | ${r.fieldsRight ? 'yes' : 'no'} | ${r.record.note ?? ''} |`;
  });
  return [
    `# Invoice extraction eval: ${model}`, '', `> ${caveat}`, '',
    `Cases: ${results.length} synthetic invoices (\`test/eval/invoice-cases.jsonl\`), evaluated as of 2026-10-21.`, '',
    '| Measure | Value |', '|---|---|',
    `| Status as expected | ${count((r) => r.record.status === r.testCase.expected)} / ${results.length} |`,
    `| Accepted without a person | ${count((r) => r.record.status === 'ACCEPTED')} / ${results.length} |`,
    `| Accepted without a person, and wrong | ${acceptedWrongly(run).length} |`,
    `| Bad invoices sent to a person | ${count((r) => r.testCase.expected === 'NEEDS_REVIEW' && r.record.status === 'NEEDS_REVIEW')} / ${count((r) => r.testCase.expected === 'NEEDS_REVIEW')} |`,
    `| Money fields right (number, IBAN, total) | ${count((r) => r.fieldsRight)} / ${results.length} |`,
    `| Tokens in / out | ${calls.reduce((s, c) => s + c.inputTokens, 0)} / ${calls.reduce((s, c) => s + c.outputTokens, 0)} |`,
    `| Latency p50 / p95 | ${p(0.5)} ms / ${p(0.95)} ms |`, '',
    '| Case | Layout | What it tests | Expected | Got | Money fields right | Note |', '|---|---|---|---|---|---|---|',
    ...rows, '',
  ].join('\n');
}

export async function writeReport(fileName: string, markdown: string): Promise<string> {
  const dir = new URL('../../reports/', import.meta.url);
  await mkdir(dir, { recursive: true });
  const file = new URL(fileName, dir);
  await writeFile(file, markdown);
  return file.pathname;
}
