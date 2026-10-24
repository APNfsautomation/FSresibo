// Exact large-pool solver for Receipt Optimization (Issue #29).
//
// The existing engine (services/optimizationService.js) keeps every subset in a 32-bit mask and enumerates 2^ceil(n/2) subsets per half, so it is
// limited to 32 receipts and is left untouched: pools of up to 32 receipts are delegated to its findBest(), byte for byte. Larger pools use the exact,
// pseudo-polynomial dynamic programs below, which follow the same accounting rules for the single result Receipt Optimization shows:
//
//   Closest:        total in [T, T+5000]: lowest total, fewer receipts, lowest identity. None reachable: highest total <= T-1, fewer receipts, identity.
//   Fewest:         total in [T, T+5000]: fewer receipts, lowest total, identity. None reachable: M = highest total <= T-1, window [max(1,M-5000), M]:
//                   fewer receipts, highest total, identity.
//   Do Not Exceed:  highest total in [1, T], fewer receipts, lowest identity.
//
// "Lowest identity" means: of two sets with the same count, the one containing the smallest index of their symmetric difference wins.
// Empty sets never qualify, and a zero-amount receipt never improves any ranking, so it is never chosen.
//
// Every path is exact or it returns a status that says why it is not: the solver never approximates, never truncates the pool, and never labels an
// inconclusive run as optimal. Memory-heavy allocation happens only after planPoolOptimization() has accepted the size.
import { findBest, MAXIMUM_EXCESS_CENTS, optimizationStrategies } from './optimizationService.js';

export const ENGINE_RECEIPT_LIMIT = 32;
const MiB = 1024 * 1024;
// Provisional ceilings approved for testing (Issue #29): they bound work and predicted memory, they are not a latency or support guarantee.
export const poolBudget = Object.freeze({ maxCells: 1.5e9, maxBytes: 256 * MiB, maxRangeUnits: 2 ** 30, timeoutMs: 45000 });

const INF = 0x7FFF; // counts never exceed the number of receipts; INF + 1 still fits a Uint16 and never beats a finite count
const FIXED_OVERHEAD_BYTES = 8 * MiB; // worker, structured-clone input, result arrays and engine bookkeeping
const gcd = (a, b) => { while (b) [a, b] = [b, a % b]; return a; };
const ceilDiv = (a, b) => Math.floor((a + b - 1) / b);
const wordsFor = maxUnit => (maxUnit >>> 5) + 1;

// Same validation as the engine, applied to the WHOLE pool (before any receipt is dropped for being above the cap) except the 32-receipt limit.
function validatePool(receipts, targetCents) {
  if (!Array.isArray(receipts)) throw new TypeError('Receipts must be an array.');
  if (!Number.isSafeInteger(targetCents) || targetCents <= 0 || targetCents > Number.MAX_SAFE_INTEGER - MAXIMUM_EXCESS_CENTS) {
    throw new RangeError('Target and its PHP 50 allowance must be safe positive integer centavos.');
  }
  let aggregate = 0;
  for (const receipt of receipts) {
    if (!Number.isSafeInteger(receipt?.cents) || receipt.cents < 0) throw new RangeError('Receipt amounts must be safe nonnegative integer centavos.');
    if (receipt.cents > Number.MAX_SAFE_INTEGER - aggregate) throw new RangeError('Aggregate receipt amount exceeds safe integer centavos.');
    aggregate += receipt.cents;
  }
  return aggregate;
}
const normalizeStrategy = strategy => strategy === optimizationStrategies.fewest || strategy === optimizationStrategies.withoutExceeding ? strategy : optimizationStrategies.closest;

// Everything the solver needs, derived without allocating anything proportional to the target.
function analyse(receipts, targetCents, rawStrategy, budget) {
  const strategy = normalizeStrategy(rawStrategy);
  validatePool(receipts, targetCents);
  const n = receipts.length;
  const plan = { path: 'engine', strategy, receipts: n, positives: 0, kept: 0, unit: 1, rangeUnits: 0, cells: 0, bytes: 0, withinBudget: true, reason: '' };
  if (n <= ENGINE_RECEIPT_LIMIT) return { plan };
  const positives = []; let total = 0;
  receipts.forEach((receipt, index) => { if (receipt.cents > 0) { positives.push(index); total += receipt.cents; } });
  plan.positives = positives.length;
  const done = (path, extra = {}) => { Object.assign(plan, { path }); return { plan, strategy, positives, total, ...extra }; };
  if (!positives.length) return done('none');
  // Exact fast paths. When the whole positive pool does not exceed the target, the full set is the unique best total (any other set is strictly
  // smaller, and a set summing to the same total must contain every positive receipt).
  if (total <= targetCents && strategy !== optimizationStrategies.fewest) return done('all-positive');
  if (strategy === optimizationStrategies.fewest) {
    if (total === targetCents) return done('all-positive');
    if (total < targetCents) { // M is the pool total: keep all but at most PHP 50 of receipts, as few kept as possible (complement problem)
      const limit = Math.min(MAXIMUM_EXCESS_CENTS, total - 1);
      const eligible = positives.filter(index => receipts[index].cents <= limit);
      let unit = 0; for (const index of eligible) unit = gcd(unit, receipts[index].cents);
      const rangeUnits = eligible.length ? Math.floor(limit / unit) : 0;
      Object.assign(plan, { kept: eligible.length, unit: unit || 1, rangeUnits, cells: eligible.length * rangeUnits });
      plan.bytes = Math.ceil(eligible.length * (wordsFor(rangeUnits) * 4 + 24) + rangeUnits * 4) + FIXED_OVERHEAD_BYTES;
      return done('complement', { eligible, limit, unit: unit || 1 });
    }
  }
  // General case: dense DP over centavo sums. Receipts above the cap can never take part in a qualifying total.
  const cap = strategy === optimizationStrategies.withoutExceeding ? targetCents : targetCents + MAXIMUM_EXCESS_CENTS;
  const kept = positives.filter(index => receipts[index].cents <= cap);
  let unit = 0, keptTotal = 0;
  for (const index of kept) { unit = gcd(unit, receipts[index].cents); keptTotal += receipts[index].cents; }
  const rangeUnits = Math.floor(Math.min(cap, keptTotal) / unit);
  const words = wordsFor(rangeUnits);
  const cells = kept.length * rangeUnits + kept.length * words; // count table plus the word-parallel reachability pass
  const bytes = Math.ceil((words * 4 + 2 * (rangeUnits + 1) + kept.length * (words * 4 + 24) + n * 16) * 1.1) + FIXED_OVERHEAD_BYTES;
  Object.assign(plan, { kept: kept.length, unit, rangeUnits, cells, bytes });
  if (kept.length >= INF) { plan.withinBudget = false; plan.reason = 'size'; } // counts are stored in 15 bits
  else if (rangeUnits > budget.maxRangeUnits) { plan.withinBudget = false; plan.reason = 'range'; }
  else if (cells > budget.maxCells) { plan.withinBudget = false; plan.reason = 'work'; }
  else if (bytes > budget.maxBytes) { plan.withinBudget = false; plan.reason = 'memory'; }
  return done('dp', { kept, unit, rangeUnits });
}

// Cheap, allocation-free preview of what solvePoolOptimization would do and cost. Throws the engine's validation errors for invalid input.
export function planPoolOptimization(receipts, targetCents, strategy = optimizationStrategies.closest, budget = poolBudget) {
  return { ...analyse(receipts, targetCents, strategy, budget).plan };
}

class Interrupt extends Error { constructor(status) { super(status); this.status = status; } }

// ---- reachability: bit u set when some subset of the kept receipts sums to u * unit --------------------------------------------------------------
function reachability(units, maxUnit, poll) {
  const words = wordsFor(maxUnit);
  const bits = new Uint32Array(words); bits[0] = 1;
  units.forEach((c, position) => {
    poll(position / units.length * 0.05);
    const wordShift = c >>> 5, bitShift = c & 31;
    if (wordShift >= words) return;
    if (bitShift === 0) { for (let w = words - 1; w >= wordShift; w--) bits[w] |= bits[w - wordShift]; }
    else {
      const inverse = 32 - bitShift;
      for (let w = words - 1; w > wordShift; w--) bits[w] |= (bits[w - wordShift] << bitShift) | (bits[w - wordShift - 1] >>> inverse);
      bits[wordShift] |= bits[0] << bitShift;
    }
  });
  return bits;
}
const reachable = (bits, u) => (bits[u >>> 5] >>> (u & 31)) & 1;
const firstReachable = (bits, from, to) => { for (let u = from; u <= to; u++) if (reachable(bits, u)) return u; return -1; };
const lastReachable = (bits, from, to) => { for (let u = to; u >= from; u--) if (reachable(bits, u)) return u; return -1; };

// ---- minimum-count table with one decision bit per (receipt, sum) -------------------------------------------------------------------------------
// Receipts are processed from the LAST index to the first. decisions[p] bit s means "an optimal set for sum s from receipts p.. may include p, and
// including it is preferred" (ties favour inclusion, because the set that contains the smaller index wins). Rebuilding from receipt 0 upward and taking
// whenever the bit is set yields the lexicographically smallest optimal set.
function countTable(units, maxUnit, poll) {
  const words = wordsFor(maxUnit);
  const counts = new Uint16Array(maxUnit + 1).fill(INF); counts[0] = 0;
  const decisions = new Uint32Array(units.length * words);
  for (let p = units.length - 1; p >= 0; p--) {
    poll(0.05 + 0.95 * (units.length - 1 - p) / units.length);
    const c = units[p], base = p * words;
    for (let s = maxUnit; s >= c; s--) {
      const viaReceipt = counts[s - c] + 1, current = counts[s];
      if (viaReceipt <= current) { decisions[base + (s >>> 5)] |= 1 << (s & 31); if (viaReceipt < current) counts[s] = viaReceipt; }
    }
  }
  return { counts, decisions, words };
}
function rebuild(table, units, indices, targetUnit, unit) {
  const items = []; let remaining = targetUnit;
  for (let p = 0; p < units.length && remaining > 0; p++) {
    if ((table.decisions[p * table.words + (remaining >>> 5)] >>> (remaining & 31)) & 1) { items.push(indices[p]); remaining -= units[p]; }
  }
  if (remaining !== 0) throw new Error('Internal error: the selection could not be rebuilt.');
  return { total: targetUnit * unit, items };
}

// ---- complement problem: Fewest when the whole pool is below the target ------------------------------------------------------------------------
// Keep every positive receipt except an omitted set of total <= min(5000, P-1). Fewest kept == most omitted, then the smallest omitted total (highest kept
// total), then the lexicographically smallest KEPT set, which means preferring NOT to omit the smaller index (an omit bit is set only when omitting is
// strictly better). The table is at most 5000 centavos wide.
function solveComplement(receipts, positives, eligible, limit, unit, total, poll) {
  if (!eligible.length || limit <= 0) return { total, items: positives.slice() };
  const units = eligible.map(index => receipts[index].cents / unit), limitUnits = Math.floor(limit / unit), words = wordsFor(limitUnits);
  const best = new Int32Array(limitUnits + 1).fill(-1); best[0] = 0;
  const omit = new Uint32Array(units.length * words);
  for (let p = units.length - 1; p >= 0; p--) {
    poll(0.95 * (units.length - 1 - p) / units.length);
    const c = units[p], base = p * words;
    for (let s = limitUnits; s >= c; s--) {
      const previous = best[s - c];
      if (previous >= 0 && previous + 1 > best[s]) { omit[base + (s >>> 5)] |= 1 << (s & 31); best[s] = previous + 1; }
    }
  }
  let chosen = 0;
  for (let s = 1; s <= limitUnits; s++) if (best[s] > best[chosen]) chosen = s;
  const omitted = new Set(); let remaining = chosen;
  for (let p = 0; p < units.length && remaining > 0; p++) {
    if ((omit[p * words + (remaining >>> 5)] >>> (remaining & 31)) & 1) { omitted.add(eligible[p]); remaining -= units[p]; }
  }
  if (remaining !== 0) throw new Error('Internal error: the omitted set could not be rebuilt.');
  return { total: total - chosen * unit, items: positives.filter(index => !omitted.has(index)) };
}

// solvePoolOptimization(receipts, targetCents, strategy, options) -> one of
//   { status: 'exact', path, result: { total, items } | null }   exact answer (null: no qualifying combination); items are ascending input indices
//   { status: 'over-budget', plan }                                refused before allocating anything large; no recommendation
//   { status: 'cancelled' } | { status: 'timeout' }                stopped; no recommendation
// options: budget, onProgress(fraction 0..1), shouldCancel(), timeoutMs, now()
export function solvePoolOptimization(receipts, targetCents, strategy = optimizationStrategies.closest, options = {}) {
  const budget = { ...poolBudget, ...options.budget };
  const now = options.now ?? (() => performance.now());
  const deadline = Number.isFinite(options.timeoutMs ?? budget.timeoutMs) ? now() + (options.timeoutMs ?? budget.timeoutMs) : Infinity;
  const poll = fraction => {
    if (options.shouldCancel?.()) throw new Interrupt('cancelled');
    if (now() > deadline) throw new Interrupt('timeout');
    options.onProgress?.(Math.min(1, fraction));
  };
  const analysis = analyse(receipts, targetCents, strategy, budget);
  const { plan } = analysis;
  try {
    poll(0);
    if (plan.path === 'engine') return { status: 'exact', path: plan.path, result: findBest(receipts, targetCents, plan.strategy) };
    if (plan.path === 'none') return { status: 'exact', path: plan.path, result: null };
    if (plan.path === 'all-positive') return { status: 'exact', path: plan.path, result: { total: analysis.total, items: analysis.positives.slice() } };
    if (plan.path === 'complement') {
      if (plan.bytes > budget.maxBytes) return { status: 'over-budget', plan: { ...plan, withinBudget: false, reason: 'memory' } };
      return { status: 'exact', path: plan.path, result: solveComplement(receipts, analysis.positives, analysis.eligible, analysis.limit, analysis.unit, analysis.total, poll) };
    }
    if (!plan.withinBudget) return { status: 'over-budget', plan };
    const result = solveDynamic(receipts, targetCents, plan.strategy, analysis, poll);
    return { status: 'exact', path: plan.path, result };
  } catch (error) {
    if (error instanceof Interrupt) return { status: error.status };
    if (error instanceof RangeError && /allocation|array buffer|invalid (typed )?array length/i.test(error.message)) return { status: 'over-budget', plan: { ...plan, withinBudget: false, reason: 'allocation' } };
    throw error;
  }
}

function solveDynamic(receipts, targetCents, strategy, analysis, poll) {
  const { kept: indices, unit, rangeUnits: maxUnit } = analysis;
  const units = indices.map(index => receipts[index].cents / unit);
  if (!units.length) return null;
  const reach = reachability(units, maxUnit, poll);
  const exactTotal = unitTotal => { const table = countTable(units, unitTotal, poll); return rebuild(table, units, indices, unitTotal, unit); };
  const windowByCount = (low, high, preferLowTotal) => {
    const table = countTable(units, high, poll); let chosen = -1;
    for (let u = low; u <= high; u++) {
      if (table.counts[u] >= INF) continue;
      if (chosen < 0 || table.counts[u] < table.counts[chosen] || (table.counts[u] === table.counts[chosen] && !preferLowTotal)) chosen = u;
    }
    return chosen < 0 ? null : rebuild(table, units, indices, chosen, unit);
  };
  const T = targetCents;
  if (strategy === optimizationStrategies.withoutExceeding) {
    const u = lastReachable(reach, 1, Math.min(maxUnit, Math.floor(T / unit)));
    return u < 0 ? null : exactTotal(u);
  }
  const preferredLow = ceilDiv(T, unit), preferredHigh = Math.min(maxUnit, Math.floor((T + MAXIMUM_EXCESS_CENTS) / unit));
  if (preferredLow <= preferredHigh) {
    if (strategy === optimizationStrategies.fewest) { if (firstReachable(reach, preferredLow, preferredHigh) >= 0) return windowByCount(preferredLow, preferredHigh, true); }
    else { const u = firstReachable(reach, preferredLow, preferredHigh); if (u >= 0) return exactTotal(u); }
  }
  const underHigh = Math.min(maxUnit, Math.floor((T - 1) / unit));
  const closestUnder = underHigh >= 1 ? lastReachable(reach, 1, underHigh) : -1;
  if (closestUnder < 0) return null;
  if (strategy === optimizationStrategies.fewest) return windowByCount(ceilDiv(Math.max(1, closestUnder * unit - MAXIMUM_EXCESS_CENTS), unit), closestUnder, false);
  return exactTotal(closestUnder);
}
