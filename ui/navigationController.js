import { installTablistKeyboard, syncRovingTabIndex } from './tablistKeyboard.js';

export const receiptRoutes = Object.freeze({
  encoding: 'receipts/encoding',
  optimization: 'receipts/optimization'
});

export const routeRegistry = Object.freeze({
  [receiptRoutes.encoding]: Object.freeze({ module: 'receipts', workspace: 'encoding', available: true }),
  [receiptRoutes.optimization]: Object.freeze({ module: 'receipts', workspace: 'optimization', available: true }),
  'monthly-filing': Object.freeze({ module: 'monthly-filing', available: true }),
  'quick-optimizer': Object.freeze({ module: 'quick-optimizer', available: true }),
  'store-directory': Object.freeze({ module: 'store-directory', available: false })
});

const authFragmentKeys = new Set(['auth', 'access_token', 'refresh_token', 'type', 'error', 'error_code', 'error_description']);

export function isAuthenticationCallbackLocation(locationLike = globalThis.location) {
  const url = new URL(locationLike.href);
  const search = new URLSearchParams(url.search);
  const fragment = new URLSearchParams(url.hash.replace(/^#/, ''));
  return [...search.keys(), ...fragment.keys()].some(key => authFragmentKeys.has(key));
}

export function routeFromHash(hash = '') {
  const candidate = String(hash).replace(/^#/, '').replace(/^\/+|\/+$/g, '').toLowerCase();
  if (!candidate || candidate === receiptRoutes.encoding) return { route: receiptRoutes.encoding, normalized: candidate !== receiptRoutes.encoding };
  if (routeRegistry[candidate]?.available) return { route: candidate, normalized: false };
  return { route: receiptRoutes.encoding, normalized: true };
}

export function createNavigationController({ window = globalThis.window, document = globalThis.document, elements, onRoute }) {
  let started = false;
  let activeRoute = receiptRoutes.encoding;
  let receiptWorkspace = 'encoding';
  const isMobile = () => window.matchMedia?.('(max-width: 980px)').matches ?? false;
  const moduleNavigation = { receipts: elements.receiptsNav, 'monthly-filing': elements.monthlyNav, 'quick-optimizer': elements.quickNav };
  const moduleDefaultRoutes = Object.entries(routeRegistry).filter(([, metadata]) => metadata.available)
    .reduce((routes, [route, metadata]) => { routes[metadata.module] ??= route; return routes; }, {});

  const setDrawer = (open, { restoreFocus = false } = {}) => {
    const visible = isMobile() ? open : true;
    elements.drawer.hidden = !visible;
    elements.drawerBackdrop.hidden = !isMobile() || !open;
    elements.drawer.setAttribute('aria-hidden', String(!visible));
    elements.menuButton.setAttribute('aria-expanded', String(isMobile() && open));
    if (!open && restoreFocus && isMobile()) elements.menuButton.focus();
  };

  const renderRoute = route => {
    activeRoute = route;
    const metadata = routeRegistry[route];
    if (metadata.module === 'receipts') receiptWorkspace = metadata.workspace;
    const optimization = receiptWorkspace === 'optimization';
    Object.entries(moduleNavigation).forEach(([module, item]) => item.setAttribute('aria-current', module === metadata.module ? 'page' : 'false'));
    elements.encodingTab.setAttribute('aria-selected', String(!optimization));
    elements.optimizationTab.setAttribute('aria-selected', String(optimization));
    syncRovingTabIndex([elements.encodingTab, elements.optimizationTab], optimization ? 1 : 0);
    onRoute(metadata.workspace ?? metadata.module, metadata);
  };

  const replaceRoute = route => {
    const url = new URL(window.location.href);
    url.hash = route;
    window.history.replaceState({}, document.title, url);
  };

  const applyLocation = fallbackRoute => {
    if (isAuthenticationCallbackLocation(window.location)) return false;
    const hasHash = Boolean(window.location.hash);
    const resolved = routeFromHash(window.location.hash);
    const route = !hasHash && fallbackRoute === receiptRoutes.optimization ? receiptRoutes.optimization : resolved.route;
    if (!hasHash || resolved.normalized) replaceRoute(route);
    renderRoute(route);
    return true;
  };

  const navigate = route => {
    const resolved = routeFromHash(`#${route}`);
    if (resolved.route === activeRoute) return;
    window.location.hash = resolved.route;
  };

  const start = ({ fallbackRoute } = {}) => {
    if (!started) {
      started = true;
      elements.menuButton.addEventListener('click', () => setDrawer(elements.drawer.hidden));
      elements.drawerBackdrop.addEventListener('click', () => setDrawer(false, { restoreFocus: true }));
      Object.entries(moduleNavigation).forEach(([module, item]) => item.addEventListener('click', () => {
        navigate(moduleDefaultRoutes[module]);
        setDrawer(false, { restoreFocus: true });
      }));
      elements.encodingTab.addEventListener('click', () => navigate(receiptRoutes.encoding));
      elements.optimizationTab.addEventListener('click', () => navigate(receiptRoutes.optimization));
      installTablistKeyboard({ tabs: [elements.encodingTab, elements.optimizationTab], activate: index => navigate(index === 0 ? receiptRoutes.encoding : receiptRoutes.optimization) });
      window.addEventListener('hashchange', () => applyLocation());
      document.addEventListener('keydown', event => { if (event.key === 'Escape' && !elements.drawer.hidden) setDrawer(false, { restoreFocus: true }); });
      window.addEventListener('resize', () => setDrawer(false));
    }
    setDrawer(false);
    return applyLocation(fallbackRoute);
  };

  return { start, navigate, setDrawer, get activeRoute() { return activeRoute; } };
}
