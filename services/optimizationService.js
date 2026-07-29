export function toCents(value) { const number = Number(String(value).replace(/[^0-9.]/g, '')); return Number.isFinite(number) ? Math.round(number * 100) : 0; }

function better(candidate, best, targetCents) { if (!best) return true; const gap = Math.abs(candidate.total-targetCents), bestGap = Math.abs(best.total-targetCents); return gap < bestGap || (gap === bestGap && candidate.total > best.total) || (gap === bestGap && candidate.total === best.total && candidate.items.length < best.items.length); }

export function findBest(receipts, targetCents) {
  if (receipts.length > 32) throw new Error('Please calculate up to 32 receipts at a time.');
  const split = Math.ceil(receipts.length / 2);
  const makeSums = (entries, offset) => {
    let sums = [{ total: 0, items: [] }];
    entries.forEach((entry, index) => { sums = sums.concat(sums.map(sum => ({ total: sum.total + entry.cents, items: sum.items.concat(offset + index) }))); });
    return sums;
  };
  const left = makeSums(receipts.slice(0, split), 0);
  const right = makeSums(receipts.slice(split), split).sort((a, b) => a.total - b.total);
  let best = null;
  for (const first of left) {
    const needed = targetCents - first.total;
    let low = 0, high = right.length;
    while (low < high) { const middle = (low + high) >> 1; if (right[middle].total < needed) low = middle + 1; else high = middle; }
    for (const index of [low - 1, low]) if (right[index]) {
      const second = right[index];
      const candidate = { total: first.total + second.total, items: first.items.concat(second.items) };
      if (candidate.items.length && better(candidate, best, targetCents)) best = candidate;
    }
  }
  return best;
}
