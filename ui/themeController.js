export const themePreferences = Object.freeze(['system', 'light', 'dark']);
export const themeStorageKey = 'fsresibo:theme-preference';

const validPreference = value => themePreferences.includes(value) ? value : 'system';

// `select` (one control) and `selects` (several, e.g. the sign-in screen and the sidebar) are kept in sync with one stored preference.
export function createThemeController({ select, selects = [], root = document.documentElement, storage = localStorage, media = matchMedia('(prefers-color-scheme: dark)') }) {
  let preference = 'system';
  const controls = [select, ...selects].filter(Boolean);

  const resolve = value => validPreference(value) === 'system' ? (media.matches ? 'dark' : 'light') : validPreference(value);
  const apply = value => {
    preference = validPreference(value);
    const resolved = resolve(preference);
    root.dataset.theme = resolved;
    root.dataset.themePreference = preference;
    root.style.colorScheme = resolved;
    controls.forEach(control => { control.value = preference; });
    return resolved;
  };
  const save = value => {
    try { storage.setItem(themeStorageKey, value); } catch { /* Theme preference remains available for this page. */ }
  };
  const restore = () => {
    let stored = 'system';
    try { stored = storage.getItem(themeStorageKey) || 'system'; } catch { /* Storage is optional. */ }
    return apply(stored);
  };

  controls.forEach(control => control.addEventListener('change', () => {
    apply(control.value);
    save(preference);
  }));
  media?.addEventListener?.('change', () => {
    if (preference === 'system') apply('system');
  });

  return { apply, restore, getPreference: () => preference, getResolvedTheme: () => resolve(preference) };
}
