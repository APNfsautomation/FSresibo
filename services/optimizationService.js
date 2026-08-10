export const optimizationStrategies = Object.freeze({ closest: 'closest', fewest: 'fewest', withoutExceeding: 'without-exceeding' });
export const fewestReceiptsToleranceBasisPoints = 200;

export function toCents(value) { const number = Number(String(value).replace(/[^0-9.]/g, '')); return Number.isFinite(number) ? Math.round(number * 100) : 0; }

export function fewestReceiptsToleranceCents(targetCents) {
  return Math.floor((targetCents * fewestReceiptsToleranceBasisPoints + 5000) / 10000);
}

const gap = (candidate, targetCents) => Math.abs(candidate.total - targetCents);
const betterClosest = (candidate, best, targetCents) => !best || gap(candidate, targetCents) < gap(best, targetCents) || (gap(candidate, targetCents) === gap(best, targetCents) && candidate.total > best.total) || (gap(candidate, targetCents) === gap(best, targetCents) && candidate.total === best.total && candidate.items.length < best.items.length);
const betterFewest = (candidate, best, targetCents) => !best || candidate.items.length < best.items.length || (candidate.items.length === best.items.length && gap(candidate, targetCents) < gap(best, targetCents)) || (candidate.items.length === best.items.length && gap(candidate, targetCents) === gap(best, targetCents) && candidate.total > best.total);
const betterWithoutExceeding = (candidate, best, targetCents) => !best || gap(candidate, targetCents) < gap(best, targetCents) || (gap(candidate, targetCents) === gap(best, targetCents) && candidate.items.length < best.items.length);
const lowerBound = (entries, value, start = 0, end = entries.length) => {
  let low = start, high = end;
  while (low < high) { const middle = (low + high) >> 1; if (entries[middle].total < value) low = middle + 1; else high = middle; }
  return low;
};
const makeSums = (entries, offset) => {
  let sums = [{ total: 0, items: [] }];
  entries.forEach((entry, index) => { sums = sums.concat(sums.map(sum => ({ total: sum.total + entry.cents, items: sum.items.concat(offset + index) }))); });
  return sums;
};
const combine = (first, second) => ({ total: first.total + second.total, items: first.items.concat(second.items) });

function findClosest(left, right, targetCents) {
  let best = null;
  for (const first of left) {
    const needed = targetCents - first.total;
    const low = lowerBound(right, needed);
    for (const index of [low - 1, low]) if (right[index]) {
      const candidate = combine(first, right[index]);
      if (candidate.items.length && betterClosest(candidate, best, targetCents)) best = candidate;
    }
  }
  return best;
}

function findWithoutExceeding(left, right, targetCents) {
  const rightForTies = [...right].sort((first, second) => first.total - second.total || first.items.length - second.items.length);
  let best = null;
  for (const first of left) {
    const needed = targetCents - first.total;
    const index = lowerBound(rightForTies, needed + 1) - 1;
    if (index < 0) continue;
    const candidate = combine(first, rightForTies[index]);
    if (candidate.items.length && candidate.total <= targetCents && betterWithoutExceeding(candidate, best, targetCents)) best = candidate;
  }
  return best;
}

function nearestInRange(entries, minimum, maximum, needed) {
  const firstIndex = lowerBound(entries, minimum);
  const endIndex = lowerBound(entries, maximum + 1);
  if (firstIndex === endIndex) return null;
  const nearIndex = lowerBound(entries, needed, firstIndex, endIndex);
  const candidates = [entries[nearIndex - 1], entries[nearIndex]].filter(candidate => candidate && candidate.total >= minimum && candidate.total <= maximum);
  return candidates.reduce((best, candidate) => !best || Math.abs(candidate.total - needed) < Math.abs(best.total - needed) || (Math.abs(candidate.total - needed) === Math.abs(best.total - needed) && candidate.total > best.total) ? candidate : best, null);
}

function findFewest(left, right, targetCents) {
  const globallyClosest = findClosest(left, right, targetCents);
  if (!globallyClosest) return null;
  const allowedDifference = gap(globallyClosest, targetCents) + fewestReceiptsToleranceCents(targetCents);
  const rightByCount = Array.from({ length: Math.max(...right.map(entry => entry.items.length)) + 1 }, () => []);
  right.forEach(entry => rightByCount[entry.items.length].push(entry));
  rightByCount.forEach(entries => entries.sort((first, second) => first.total - second.total));
  let best = null;
  for (const first of left) {
    const minimum = targetCents - allowedDifference - first.total;
    const maximum = targetCents + allowedDifference - first.total;
    for (const entries of rightByCount) {
      const second = nearestInRange(entries, minimum, maximum, targetCents - first.total);
      const candidate = second && combine(first, second);
      if (candidate?.items.length && betterFewest(candidate, best, targetCents)) best = candidate;
      if (candidate?.items.length) break;
    }
  }
  return best;
}

export function findBest(receipts, targetCents, strategy = optimizationStrategies.closest) {
  if (receipts.length > 32) throw new Error('Please calculate up to 32 receipts at a time.');
  const split = Math.ceil(receipts.length / 2);
  const left = makeSums(receipts.slice(0, split), 0);
  const right = makeSums(receipts.slice(split), split).sort((first, second) => first.total - second.total);
  if (strategy === optimizationStrategies.withoutExceeding) return findWithoutExceeding(left, right, targetCents);
  if (strategy === optimizationStrategies.fewest) return findFewest(left, right, targetCents);
  return findClosest(left, right, targetCents);
}
