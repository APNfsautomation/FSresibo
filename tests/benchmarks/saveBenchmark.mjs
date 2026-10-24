// Save benchmark (Issue #24). Not part of the test suite (the suite only runs tests/*.test.mjs).
// Usage: node tests/benchmarks/saveBenchmark.mjs [latencyMs ...]   (default: 0 5)
// It drives the real Receipt Encoding UI against an in-memory service and reports, for each scenario, the service calls Save makes and how long Save takes.
// The simulated latency is a fixed delay per write, a stand-in for one network round trip; it is NOT a measurement of the live Supabase service.
import { receiptFixture } from '../helpers/receiptUiFixture.mjs';

const saved = n => Array.from({ length: n }, (_, i) => ({ dbId: `r${String(i + 1).padStart(3, '0')}`, amount: i + 1, store: `Store ${String(i + 1).padStart(3, '0')}`, receiptDate: '2026-08-01' }));
const scenarios = [
  { name: '75 saved, 1 edited', build: async f => { await f.type(f.rows()[73], 'amount', '9999'); }, size: 75 },
  { name: '100 saved, 1 edited', build: async f => { await f.type(f.rows()[98], 'amount', '9999'); }, size: 100 },
  { name: '400 saved, only #399 edited', build: async f => { await f.type(f.rows()[398], 'amount', '9999'); }, size: 400 },
  { name: '400 saved, none edited', build: async () => {}, size: 400 },
  { name: '400 new receipts', size: 0, build: async f => { for (let i = 1; i <= 400; i += 1) { await f.click(f.elements.floatingAdd); const row = f.rows().at(-1); await f.type(row, 'store', `New ${i}`); await f.type(row, 'amount', String(i)); } } }
];

const run = async (scenario, latencyMs) => {
  const f = await receiptFixture({ loaded: saved(scenario.size), latencyMs });
  await scenario.build(f);
  const started = performance.now();
  await f.elements.saveDraft.emit('click');
  const elapsed = performance.now() - started;
  return { updates: f.calls.update.length, creates: f.calls.create.length, ms: Math.round(elapsed), progress: f.elements.saveProgressText?.textContent || '(none)', feedback: f.elements.encodingFeedback.textContent };
};

const latencies = process.argv.slice(2).map(Number).filter(Number.isFinite);
if (!latencies.length) latencies.push(0, 5);
console.log(`| Scenario | Latency/write | Updates | Creates | Save time (ms) | Progress shown |`);
console.log(`| --- | --- | --- | --- | --- | --- |`);
for (const scenario of scenarios) for (const latency of latencies) {
  const result = await run(scenario, latency);
  console.log(`| ${scenario.name} | ${latency} ms | ${result.updates} | ${result.creates} | ${result.ms} | ${result.progress} |`);
}
