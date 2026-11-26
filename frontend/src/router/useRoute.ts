/**
 * Minimal History-API router for the lobby and the game table.
 *
 * `/` is the lobby and `/g/:gameId` is a live table. A `?player=:seat` query
 * marks a local hotseat/bot table (the same match opened on a given seat); the
 * live rooms never use it. `navigate` pushes a new entry and notifies every
 * mounted `useRoute` immediately, so the SPA never reloads and never waits for
 * `popstate`. No navigation helper ever writes `#/` or `#` to the URL.
 */
import { useEffect, useState } from 'preact/hooks';

/** Event dispatched on the window after every programmatic navigation. */
export const ROUTE_CHANGE_EVENT = 'lidurak:route-change';

export type Route =
  | { kind: 'lobby' }
  | { kind: 'game'; gameId: string; playerId?: string };

/**
 * Resolves a URL (pathname plus optional search, hash ignored) to a route. The
 * game id is URL-decoded and trimmed, a blank id falls back to the lobby, and a
 * `player` query is only kept when it names a seat.
 */
export function parseRoute(url: string): Route {
  // A hash is never part of the route; `#/g/:gameId` is only a legacy link.
  const withoutHash = url.split('#', 1)[0];
  const [rawPath, query = ''] = withoutHash.split('?');
  const path = rawPath.trim();
  const match = /^\/g\/([^/]+)\/?$/.exec(path);
  if (!match) return { kind: 'lobby' };

  let gameId: string;
  try {
    gameId = decodeURIComponent(match[1]).trim();
  } catch {
    // A malformed escape sequence is not a usable game id.
    return { kind: 'lobby' };
  }
  if (gameId.length === 0) return { kind: 'lobby' };

  const playerId = (new URLSearchParams(query).get('player') ?? '').trim();
  return playerId.length > 0
    ? { kind: 'game', gameId, playerId }
    : { kind: 'game', gameId };
}

/**
 * Clean path of the legacy hash route still carried by old bookmarks:
 * `#/g/:gameId?player=:seat` becomes `/g/:gameId?player=:seat`.
 */
function legacyHashPath(hash: string): string | null {
  const raw = hash.replace(/^#/, '');
  const [rawPath, query = ''] = raw.split('?');
  const match = /^\/g\/([^/]+?)(?:\/replay)?\/?$/.exec(rawPath);
  if (!match) return null;
  return `/g/${match[1]}${query.length > 0 ? `?${query}` : ''}`;
}

/**
 * Strips any `#`, `#/` or legacy `#/g/:gameId` suffix from the address bar with
 * a `replaceState`, so a directly loaded legacy URL never keeps its hash.
 */
export function normalizeUrl(): void {
  if (typeof window === 'undefined') return;
  const { pathname, search, hash } = window.location;
  if (!hash) return;
  const clean = legacyHashPath(hash) ?? `${pathname}${search}`;
  window.history.replaceState(null, '', clean.length > 0 ? clean : '/');
}

function readRoute(): Route {
  if (typeof window === 'undefined') return { kind: 'lobby' };
  normalizeUrl();
  return parseRoute(`${window.location.pathname}${window.location.search}`);
}

/**
 * Pushes `path` with the History API and notifies mounted route hooks, without
 * reloading the page. Navigating to the homepage always lands on exactly `/`:
 * leftover search or hash is removed with a `replaceState`, and an already
 * exact `/` never grows the history stack.
 */
export function navigate(path: string): void {
  if (typeof window === 'undefined') return;
  const url = new URL(path, window.location.href);
  const target = `${url.pathname}${url.search}`;
  const atHome =
    window.location.pathname === '/' && window.location.search === '';

  if (target === '/' && atHome) {
    // Already on the homepage: only a legacy hash can be left to clean.
    if (window.location.hash !== '') window.history.replaceState(null, '', '/');
  } else {
    window.history.pushState(null, '', target);
  }

  window.dispatchEvent(new Event(ROUTE_CHANGE_EVENT));
}

/** Canonical SPA path of a game (`/g/:gameId`, plus `?player=` for a local seat). */
export function gamePath(gameId: string, playerId?: string): string {
  const base = `/g/${encodeURIComponent(gameId)}`;
  return playerId ? `${base}?player=${encodeURIComponent(playerId)}` : base;
}

/** Opens the game `/g/:gameId` (optionally on a local seat) through the History API. */
export function navigateToGame(gameId: string, playerId?: string): void {
  navigate(gamePath(gameId, playerId));
}

/** Returns to the lobby through the History API, landing on exact `/`. */
export function navigateToLobby(): void {
  navigate('/');
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
