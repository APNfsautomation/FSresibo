// Page-side runner for the exact large-pool solver (Issue #29). It never rejects: every run ends in exactly one outcome object.
//   { status: 'exact', path, result }            exact answer (result null: nothing qualifies)
//   { status: 'over-budget', plan }                refused by the preflight before any worker or large allocation
//   { status: 'unavailable', plan }                no Worker on this device and the pool is too large to compute on the page thread safely
//   { status: 'cancelled' } | { status: 'timeout' } | { status: 'error', message }
// Work above the engine's own cheap paths runs in a module Worker, so the page stays responsive; cancelling terminates the Worker.
import { planPoolOptimization, poolBudget, solvePoolOptimization } from '../services/poolOptimizationService.js';

// Work the page thread may do itself when no Worker can be created (about 0.2 s of dynamic programming).
export const mainThreadFallbackCells = 5e7;
// Planned work the page thread may always do directly (a few milliseconds): the engine, the fast paths and small complement tables. Anything more goes to the Worker.
export const directSolveCells = 2e6;

// new URL(..., import.meta.url) resolves next to this module, so the Worker is found under any base path (GitHub Pages serves /FSresibo/).
const defaultCreateWorker = () => typeof Worker === 'undefined' ? null : new Worker(new URL('../services/poolOptimizationWorker.js', import.meta.url), { type: 'module' });

export function createPoolOptimizerClient({
  createWorker = defaultCreateWorker, solve = solvePoolOptimization, plan = planPoolOptimization, budget = poolBudget,
  timeoutMs = poolBudget.timeoutMs, watchdogGraceMs = 3000, setTimer = setTimeout, clearTimer = clearTimeout
} = {}) {
  let sequence = 0;
  return {
    // cents: amounts in the order of the receipts the caller keeps; the outcome's item indexes refer to this array.
    run({ cents, target, strategy, onProgress }) {
      const id = ++sequence;
      let finished = false, worker = null, watchdog = null, fallbackTimer = null, finish;
      const promise = new Promise(resolve => {
        finish = outcome => {
          if (finished) return;
          finished = true;
          clearTimer(watchdog); clearTimer(fallbackTimer);
          if (worker) { try { worker.terminate(); } catch { /* already gone */ } worker = null; }
          resolve(outcome);
        };
      });
      const receipts = cents.map(value => ({ cents: value }));
      let preview;
      try { preview = plan(receipts, target, strategy, budget); } catch (error) { finish({ status: 'error', message: String(error?.message || error) }); return { promise, cancel: () => finish({ status: 'cancelled' }) }; }
      const cancel = () => finish({ status: 'cancelled' });
      // Every search path is judged by the same preflight, before a Worker is created or anything large is allocated.
      if (!preview.withinBudget) { finish({ status: 'over-budget', plan: preview }); return { promise, cancel }; }
      if (preview.path !== 'dp' && preview.cells <= directSolveCells) { // engine, nothing-qualifies, all-positive and small complement problems cost almost nothing
        try { finish(solve(receipts, target, strategy, { budget, timeoutMs })); } catch (error) { finish({ status: 'error', message: String(error?.message || error) }); }
        return { promise, cancel };
      }
      try { worker = createWorker(); } catch { worker = null; }
      if (!worker) {
        if (preview.cells > mainThreadFallbackCells) { finish({ status: 'unavailable', plan: preview }); return { promise, cancel }; }
        fallbackTimer = setTimer(() => {
          if (finished) return;
          try { finish(solve(receipts, target, strategy, { budget, timeoutMs, shouldCancel: () => finished })); } catch (error) { finish({ status: 'error', message: String(error?.message || error) }); }
        }, 0);
        return { promise, cancel };
      }
      worker.onmessage = ({ data }) => {
        if (finished || data?.id !== id) return;
        if (data.type === 'progress') onProgress?.(data.fraction);
        else if (data.type === 'done') finish(data.outcome);
        else if (data.type === 'error') finish({ status: 'error', message: data.message });
      };
      worker.onerror = event => { event?.preventDefault?.(); finish({ status: 'error', message: 'The calculation could not run on this device.' }); };
      worker.onmessageerror = () => finish({ status: 'error', message: 'The calculation result could not be read.' });
      watchdog = setTimer(() => finish({ status: 'timeout' }), timeoutMs + watchdogGraceMs);
      try { worker.postMessage({ type: 'start', id, cents: Float64Array.from(cents), target, strategy, budget, timeoutMs }); } catch (error) { finish({ status: 'error', message: String(error?.message || error) }); }
      return { promise, cancel };
    }
  };
}
