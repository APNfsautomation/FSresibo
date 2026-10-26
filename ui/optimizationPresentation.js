// Presentation-only defaults for the Receipt Optimization workspace. Nothing here reads or changes receipts, selection or results.
export const tallWindowQuery = '(min-height: 880px)';

// On short windows the "Receipts to pull" breakdown starts collapsed so the receipt browser stays within reach.
// It is a native <details>, so users can always expand it; a later calculation never re-collapses it.
export function collapseKeptReceiptsOnShortWindows(keptReceipts, matchMedia = globalThis.matchMedia) {
  const details = keptReceipts?.closest?.('details');
  if (!details || typeof matchMedia !== 'function' || matchMedia(tallWindowQuery).matches) return false;
  details.open = false;
  return true;
}
