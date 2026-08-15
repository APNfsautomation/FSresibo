export const themePreferences = Object.freeze(['system', 'light', 'dark']);
export const themeStorageKey = 'fsresibo:theme-preference';

const validPreference = value => themePreferences.includes(value) ? value : 'system';

export function createThemeController({ select, root = document.documentElement, storage = localStorage, media = matchMedia('(prefers-color-scheme: dark)') }) {
  let preference = 'system';

  const resolve = value => validPreference(value) === 'system' ? (media.matches ? 'dark' : 'light') : validPreference(value);
  const apply = value => {
    preference = validPreference(value);
    const resolved = resolve(preference);
    root.dataset.theme = resolved;
    root.dataset.themePreference = preference;
    root.style.colorScheme = resolved;
    if (select) select.value = preference;
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

  select?.addEventListener('change', () => {
    apply(select.value);
    save(preference);
  });
  media?.addEventListener?.('change', () => {
    if (preference === 'system') apply('system');
  });

  return { apply, restore, getPreference: () => preference, getResolvedTheme: () => resolve(preference) };
}
