// Keyboard behavior for a WAI-ARIA tablist: Arrow Left/Right wrap, Home/End jump, roving tabindex (only the selected tab is in the Tab order).
export const tablistKeys = Object.freeze(['ArrowLeft', 'ArrowRight', 'Home', 'End']);

export function nextTabIndex(key, currentIndex, count) {
  if (!count || currentIndex < 0 || currentIndex >= count) return -1;
  if (key === 'Home') return 0;
  if (key === 'End') return count - 1;
  if (key === 'ArrowRight') return (currentIndex + 1) % count;
  if (key === 'ArrowLeft') return (currentIndex - 1 + count) % count;
  return -1;
}

export function syncRovingTabIndex(tabs, selectedIndex) {
  tabs.forEach((tab, index) => { tab.tabIndex = index === selectedIndex ? 0 : -1; });
}

// `activate(index)` performs the same action as clicking that tab. Focus follows the activated tab.
export function installTablistKeyboard({ tabs, activate }) {
  tabs.forEach((tab, index) => tab.addEventListener('keydown', event => {
    if (event.ctrlKey || event.altKey || event.metaKey) return;
    const target = nextTabIndex(event.key, index, tabs.length);
    if (target < 0) return;
    event.preventDefault();
    if (target !== index && activate(target) === false) return;
    tabs[target].focus?.({ preventScroll: true });
  }));
}
