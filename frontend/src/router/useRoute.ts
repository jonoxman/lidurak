/**
 * Minimal History-API router for the two M2 screens.
 *
 * `/` (and anything unrecognized) is the lobby; `/g/:gameId` is the live game
 * table. `navigate` pushes a new entry and notifies every mounted `useRoute`
 * immediately, so the SPA never reloads and never waits for `popstate`.
 */
import { useEffect, useState } from 'preact/hooks';

/** Event dispatched on the window after every programmatic navigation. */
export const ROUTE_CHANGE_EVENT = 'lidurak:route-change';

export type Route = { kind: 'lobby' } | { kind: 'game'; gameId: string };

/**
 * Resolves a pathname to a route. Query strings and hashes are ignored, the
 * game id is URL-decoded and trimmed, and a blank or malformed id falls back
 * to the lobby rather than opening a broken table.
 */
export function parseRoute(pathname: string): Route {
  const path = pathname.split(/[?#]/, 1)[0].trim();
  const match = /^\/g\/([^/]+)\/?$/.exec(path);
  if (!match) return { kind: 'lobby' };

  let gameId: string;
  try {
    gameId = decodeURIComponent(match[1]).trim();
  } catch {
    // A malformed escape sequence is not a usable game id.
    return { kind: 'lobby' };
  }
  return gameId.length > 0 ? { kind: 'game', gameId } : { kind: 'lobby' };
}

function readRoute(): Route {
  if (typeof window === 'undefined') return { kind: 'lobby' };
  return parseRoute(window.location.pathname);
}

/**
 * Pushes `path` with the History API and notifies mounted route hooks, without
 * reloading the page.
 */
export function navigate(path: string): void {
  if (typeof window === 'undefined') return;
  window.history.pushState({}, '', path);
  window.dispatchEvent(new Event(ROUTE_CHANGE_EVENT));
}

/** Current SPA route plus the navigation helper. */
export function useRoute(): { route: Route; navigate: typeof navigate } {
  const [route, setRoute] = useState<Route>(readRoute);

  useEffect(() => {
    const sync = () => setRoute(readRoute());
    window.addEventListener('popstate', sync);
    window.addEventListener(ROUTE_CHANGE_EVENT, sync);
    return () => {
      window.removeEventListener('popstate', sync);
      window.removeEventListener(ROUTE_CHANGE_EVENT, sync);
    };
  }, []);

  return { route, navigate };
}
