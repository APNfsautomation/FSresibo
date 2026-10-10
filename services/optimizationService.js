export const optimizationStrategies = Object.freeze({ closest: 'closest', fewest: 'fewest', withoutExceeding: 'without-exceeding' });
export const MAXIMUM_EXCESS_CENTS = 5000;
export const maximumOptimizationExcessCents = MAXIMUM_EXCESS_CENTS;

// Preserve receipt input compatibility; strict Quick parsing is a separate boundary.
export function toCents(value) { const number = Number(String(value).replace(/[^0-9.]/g, '')); return Number.isFinite(number) ? Math.round(number * 100) : 0; }
export function fewestReceiptsToleranceCents() { return MAXIMUM_EXCESS_CENTS; }

function validateInputs(receipts, targetCents, limit) {
  if (!Array.isArray(receipts)) throw new TypeError('Receipts must be an array.');
  if (receipts.length > 32) throw new Error('Please calculate up to 32 receipts at a time.');
  if (!Number.isInteger(limit) || limit < 1 || limit > 3) throw new RangeError('Request between one and three matches.');
  if (!Number.isSafeInteger(targetCents) || targetCents <= 0 || targetCents > Number.MAX_SAFE_INTEGER - MAXIMUM_EXCESS_CENTS) {
    throw new RangeError('Target and its PHP 50 allowance must be safe positive integer centavos.');
  }
  let aggregate = 0;
  for (const receipt of receipts) {
    // Zero-valued legacy entries are harmless; only positive totals qualify.
    if (!Number.isSafeInteger(receipt?.cents) || receipt.cents < 0) throw new RangeError('Receipt amounts must be safe nonnegative integer centavos.');
    if (receipt.cents > Number.MAX_SAFE_INTEGER - aggregate) throw new RangeError('Aggregate receipt amount exceeds safe integer centavos.');
    aggregate += receipt.cents;
  }
  return aggregate;
}

// Equal-count sets: the set containing the first differing input index wins.
// This compares sorted index vectors without allocating arrays, including bit 31.
function compareIdentity(first, second) {
  const difference = (first ^ second) >>> 0;
  if (!difference) return 0;
  const lowestDifferentBit = difference & -difference;
  return (first & lowestDifferentBit) !== 0 ? -1 : 1;
}

function makeSums(entries) {
  const sums = new Array(2 ** entries.length);
  sums[0] = { total: 0, count: 0, mask: 0 };
  for (let mask = 1; mask < sums.length; mask++) {
    const bit = mask & -mask;
    const prior = sums[mask ^ bit];
    const index = 31 - Math.clz32(bit);
    // Nonnegative input and aggregate validation bound every intermediate sum.
    sums[mask] = { total: prior.total + entries[index].cents, count: prior.count + 1, mask };
  }
  return sums;
}

function bound(entries, value, direction, afterEqual = false) {
  let low = 0, high = entries.length;
  while (low < high) {
    const middle = (low + high) >>> 1;
    const order = direction * (entries[middle].total - value);
    if (order < 0 || (afterEqual && order === 0)) low = middle + 1;
    else high = middle;
  }
  return low;
}

const compareCandidate = direction => (first, second) => direction * (first.total - second.total) || first.count - second.count || compareIdentity(first.mask, second.mask);
const byCount = (entries, size) => {
  const groups = Array.from({ length: size + 1 }, () => ({ entries: [], minimum: Infinity, maximum: -Infinity }));
  for (const entry of entries) {
    const group = groups[entry.count];
    group.entries.push(entry);
    group.minimum = Math.min(group.minimum, entry.total);
    group.maximum = Math.max(group.maximum, entry.total);
  }
  return groups;
};

function siftDown(heap, index, compare) {
  const entry = heap[index];
  while (index * 2 + 1 < heap.length) {
    let child = index * 2 + 1;
    if (child + 1 < heap.length && compare(heap[child + 1], heap[child]) < 0) child++;
    if (compare(entry, heap[child]) <= 0) break;
    heap[index] = heap[child];
    index = child;
  }
  heap[index] = entry;
}

function candidate(first, entries, index, end, split) {
  const second = entries[index];
  return { first, entries, index, end, total: first.total + second.total, count: first.count + second.count, mask: (first.mask | (second.mask << split)) >>> 0 };
}

// Each row fixes a left subset. Its right list is monotonic under the FINAL
// comparator: total direction, count, then identity. Count-stratified searches
// also fix combined count. Heap merging therefore emits the exact global K.
// Every full set has one left/right pair, so no identity deduplication is needed.
// At n=32 each half contains at most 65,536 compact records. Row seeding uses
// binary bounds; extraction advances only K row heads, never the full product.
function mergeRows(pairs, minimum, maximum, direction, limit, split) {
  if (minimum > maximum) return [];
  const heap = [];
  for (const [left, right] of pairs) {
    if (!right.length) continue;
    const rightMinimum = right[direction === 1 ? 0 : right.length - 1].total;
    const rightMaximum = right[direction === 1 ? right.length - 1 : 0].total;
    for (const first of left) {
      if (first.total + rightMinimum > maximum || first.total + rightMaximum < minimum) continue;
      const start = bound(right, (direction === 1 ? minimum : maximum) - first.total, direction);
      const end = bound(right, (direction === 1 ? maximum : minimum) - first.total, direction, true);
      if (start < end) heap.push(candidate(first, right, start, end, split));
    }
  }
  const compare = compareCandidate(direction);
  for (let index = (heap.length >>> 1) - 1; index >= 0; index--) siftDown(heap, index, compare);
  const results = [];
  while (heap.length && results.length < limit) {
    const best = heap[0];
    results.push(best);
    if (best.index + 1 < best.end) heap[0] = candidate(best.first, best.entries, best.index + 1, best.end, split);
    else {
      const last = heap.pop();
      if (heap.length) heap[0] = last;
    }
    if (heap.length) siftDown(heap, 0, compare);
  }
  return results;
}

function findByCount(leftGroups, rightGroups, minimum, maximum, direction, limit, split) {
  const results = [];
  for (let count = 1; count <= leftGroups.length + rightGroups.length - 2 && results.length < limit; count++) {
    const pairs = [];
    for (let leftCount = 0; leftCount < leftGroups.length; leftCount++) {
      const rightCount = count - leftCount;
      if (rightCount < 0 || rightCount >= rightGroups.length) continue;
      const first = leftGroups[leftCount], second = rightGroups[rightCount];
      // Whole count strata outside the range cannot contribute any result.
      if (!first.entries.length || !second.entries.length || first.maximum + second.maximum < minimum || first.minimum + second.minimum > maximum) continue;
      pairs.push([first.entries, second.entries]);
    }
    results.push(...mergeRows(pairs, minimum, maximum, direction, limit - results.length, split));
  }
  return results;
}

export function findBestMatches(receipts, targetCents, strategy = optimizationStrategies.closest, limit = 3) {
  const aggregate = validateInputs(receipts, targetCents, limit);
  if (!receipts.length) return [];
  const split = Math.ceil(receipts.length / 2);
  const left = makeSums(receipts.slice(0, split));
  const right = makeSums(receipts.slice(split));
  const rightView = direction => [...right].sort((first, second) => direction * (first.total - second.total) || first.count - second.count || compareIdentity(first.mask, second.mask));
  let ranked;
  if (strategy === optimizationStrategies.withoutExceeding) {
    ranked = mergeRows([[left, rightView(-1)]], 1, targetCents, -1, limit, split);
  } else {
    const ascending = rightView(1);
    const fewest = strategy === optimizationStrategies.fewest;
    const leftGroups = fewest && byCount(left, split);
    ranked = aggregate < targetCents ? [] : fewest
      ? findByCount(leftGroups, byCount(ascending, receipts.length - split), targetCents, targetCents + MAXIMUM_EXCESS_CENTS, 1, limit, split)
      : mergeRows([[left, ascending]], targetCents, targetCents + MAXIMUM_EXCESS_CENTS, 1, limit, split);
    if (ranked.length < limit) {
      const descending = rightView(-1);
      if (fewest) {
        // M is global closest-under, independent of encounter order.
        const closestUnder = mergeRows([[left, descending]], 1, targetCents - 1, -1, 1, split)[0];
        if (closestUnder) ranked.push(...findByCount(leftGroups, byCount(descending, receipts.length - split), Math.max(1, closestUnder.total - MAXIMUM_EXCESS_CENTS), closestUnder.total, -1, limit - ranked.length, split));
      } else ranked.push(...mergeRows([[left, descending]], 1, targetCents - 1, -1, limit - ranked.length, split));
    }
  }
  return ranked.map(({ total, mask }) => {
    const items = [];
    for (let index = 0; index < receipts.length; index++) if ((mask >>> index) & 1) items.push(index);
    return { total, items };
  });
}

export function findBest(receipts, targetCents, strategy = optimizationStrategies.closest) {
  return findBestMatches(receipts, targetCents, strategy, 1)[0] ?? null;
}
