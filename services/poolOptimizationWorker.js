// Module Web Worker for the exact large-pool solver (Issue #29). It holds no state and no data beyond the amounts it is sent.
// Cancellation is Worker.terminate() from the page, which stops the loop at once; the solver also enforces its own timeout.
import { solvePoolOptimization } from './poolOptimizationService.js';

const PROGRESS_INTERVAL_MS = 100;

self.onmessage = ({ data }) => {
  if (data?.type !== 'start') return;
  const { id, cents, target, strategy, budget, timeoutMs } = data;
  try {
    let lastReport = 0;
    const receipts = Array.from(cents, value => ({ cents: value }));
    const outcome = solvePoolOptimization(receipts, target, strategy, {
      budget, timeoutMs,
      onProgress: fraction => {
        const now = Date.now();
        if (now - lastReport >= PROGRESS_INTERVAL_MS) { lastReport = now; self.postMessage({ type: 'progress', id, fraction }); }
      }
    });
    self.postMessage({ type: 'done', id, outcome });
  } catch (error) {
    self.postMessage({ type: 'error', id, message: String(error?.message || error) });
  }
};
