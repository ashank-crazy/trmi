export type Route = { view: 'home' } | { view: 'room'; code: string };

export function currentRoute(): Route {
  const match = /^\/room\/([A-Za-z]{4})$/.exec(window.location.pathname);
  if (match) return { view: 'room', code: match[1].toUpperCase() };
  return { view: 'home' };
}

export function navigate(path: string): void {
  window.history.pushState(null, '', path);
  window.dispatchEvent(new PopStateEvent('popstate'));
}
