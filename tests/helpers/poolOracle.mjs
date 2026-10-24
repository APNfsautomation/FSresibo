// Independent exact oracle for the pool-optimization rules (Issue #29). It shares no code with the solver under test and uses a different method:
// a FORWARD dynamic program over input order that stores, for every reachable total, the best explicit index vector (fewest receipts, then the
// lexicographically smallest indices). The solver works backwards over bit tables and rebuilds identities from decision bits.
// Only suitable for small totals (tens of thousands of centavos), which is what the tests use.
const lexLess = (a, b) => { for (let i = 0; i < Math.min(a.length, b.length); i++) if (a[i] !== b[i]) return a[i] < b[i]; return a.length < b.length; };
const better = (a, b) => !b || a.length < b.length || (a.length === b.length && lexLess(a, b));

export function buildOracle(amounts) {
  const best = new Map([[0, []]]);
  amounts.forEach((cents, index) => {
    if (cents <= 0) return;
    const additions = [];
    for (const [total, set] of best) additions.push([total + cents, [...set, index]]);
    for (const [total, set] of additions) if (better(set, best.get(total))) best.set(total, set);
  });
  const totals = [...best.keys()].filter(total => total > 0).sort((a, b) => a - b);
  return { best, totals };
}

export function oracleBest({ best, totals }, target, strategy) {
  const inRange = (low, high) => totals.filter(total => total >= low && total <= high);
  const pick = (candidates, compare) => {
    let chosen = null;
    for (const total of candidates) { const entry = { total, set: best.get(total) }; if (!chosen || compare(entry, chosen) < 0) chosen = entry; }
    return chosen && { total: chosen.total, items: chosen.set };
  };
  if (strategy === 'without-exceeding') return pick(inRange(1, target), (a, b) => b.total - a.total);
  const preferred = inRange(target, target + 5000);
  if (preferred.length) return pick(preferred, strategy === 'fewest' ? (a, b) => a.set.length - b.set.length || a.total - b.total : (a, b) => a.total - b.total);
  const under = inRange(1, target - 1);
  if (!under.length) return null;
  const closestUnder = under[under.length - 1];
  return strategy === 'fewest'
    ? pick(inRange(Math.max(1, closestUnder - 5000), closestUnder), (a, b) => a.set.length - b.set.length || b.total - a.total)
    : pick([closestUnder], () => 0);
}
