import { act, renderHook } from '@testing-library/preact';
import { beforeEach, describe, expect, it } from 'vitest';
import {
  gamePath,
  navigate,
  navigateToGame,
  navigateToLobby,
  normalizeUrl,
  parseRoute,
  useRoute,
} from './useRoute';

describe('parseRoute', () => {
  it('resolves the root path to the lobby', () => {
    expect(parseRoute('/')).toEqual({ kind: 'lobby' });
    expect(parseRoute('')).toEqual({ kind: 'lobby' });
  });

  it('resolves /g/:gameId to a game route', () => {
    expect(parseRoute('/g/abc123')).toEqual({ kind: 'game', gameId: 'abc123' });
    expect(parseRoute('/g/game-1/')).toEqual({ kind: 'game', gameId: 'game-1' });
  });

  it('URL-decodes and trims the game id', () => {
    expect(parseRoute('/g/room%2Fone')).toEqual({ kind: 'game', gameId: 'room/one' });
    expect(parseRoute('/g/%20abc%20')).toEqual({ kind: 'game', gameId: 'abc' });
    expect(parseRoute('/g/%E0%A4%A')).toEqual({ kind: 'lobby' });
  });

  it('keeps a player query as a local seat', () => {
    expect(parseRoute('/g/room-1?player=p0')).toEqual({
      kind: 'game',
      gameId: 'room-1',
      playerId: 'p0',
    });
    expect(parseRoute('/g/room-1?player=%20p2%20')).toEqual({
      kind: 'game',
      gameId: 'room-1',
      playerId: 'p2',
    });
    // A blank seat is not a local table.
    expect(parseRoute('/g/room-1?player=')).toEqual({ kind: 'game', gameId: 'room-1' });
    expect(parseRoute('/g/room-1?player=%20')).toEqual({ kind: 'game', gameId: 'room-1' });
  });

  it('ignores hashes entirely', () => {
    expect(parseRoute('/g/room-1#replay')).toEqual({ kind: 'game', gameId: 'room-1' });
    // A hash is never a route: the legacy `#/g/...` is rewritten to a path by
    // `normalizeUrl`, while parseRoute alone only sees the `/` pathname.
    expect(parseRoute('/#/g/room-1?player=p1')).toEqual({ kind: 'lobby' });
  });

  it('falls back to the lobby for blank ids and unknown paths', () => {
    expect(parseRoute('/g/')).toEqual({ kind: 'lobby' });
    expect(parseRoute('/g/%20')).toEqual({ kind: 'lobby' });
    expect(parseRoute('/unknown')).toEqual({ kind: 'lobby' });
    expect(parseRoute('/g/one/two')).toEqual({ kind: 'lobby' });
  });
});

describe('useRoute', () => {
  beforeEach(() => {
    window.history.replaceState(null, '', '/');
  });

  it('starts on the lobby and exposes navigate', () => {
    const { result } = renderHook(() => useRoute());

    expect(result.current.route).toEqual({ kind: 'lobby' });
    expect(typeof result.current.navigate).toBe('function');
  });

  it('navigates to a game with a clean path and no hash', () => {
    const { result } = renderHook(() => useRoute());

    act(() => navigateToGame('room-1'));

    expect(window.location.pathname).toBe('/g/room-1');
    expect(window.location.search).toBe('');
    expect(window.location.hash).toBe('');
    expect(result.current.route).toEqual({ kind: 'game', gameId: 'room-1' });
  });

  it('encodes the game id and keeps a local seat in the query (gamePath)', () => {
    expect(gamePath('room/one')).toBe('/g/room%2Fone');
    expect(gamePath('room/one', 'p 1')).toBe('/g/room%2Fone?player=p%201');

    act(() => navigateToGame('room/one', 'p1'));

    expect(window.location.pathname).toBe('/g/room%2Fone');
    expect(window.location.search).toBe('?player=p1');
    expect(window.location.hash).toBe('');
  });

  it('returns from /g/test-room to exact / with no search and no hash', () => {
    window.history.replaceState(null, '', '/g/test-room');
    const { result } = renderHook(() => useRoute());
    expect(result.current.route).toEqual({ kind: 'game', gameId: 'test-room' });

    act(() => navigateToLobby());

    expect(window.location.pathname).toBe('/');
    expect(window.location.search).toBe('');
    expect(window.location.hash).toBe('');
    expect(result.current.route).toEqual({ kind: 'lobby' });
  });

  it('cleans a legacy #/ suffix in place when already on the homepage', () => {
    window.history.replaceState(null, '', '/#/');
    const { result } = renderHook(() => useRoute());

    // The initial read already normalized the hash away.
    expect(window.location.pathname).toBe('/');
    expect(window.location.hash).toBe('');

    act(() => navigateToLobby());

    expect(window.location.pathname).toBe('/');
    expect(window.location.search).toBe('');
    expect(window.location.hash).toBe('');
    expect(result.current.route).toEqual({ kind: 'lobby' });
  });

  it('strips a legacy #/ hash from a directly loaded game URL', () => {
    window.history.replaceState(null, '', '/g/test-room#/');

    const { result } = renderHook(() => useRoute());

    expect(window.location.pathname).toBe('/g/test-room');
    expect(window.location.search).toBe('');
    expect(window.location.hash).toBe('');
    expect(result.current.route).toEqual({ kind: 'game', gameId: 'test-room' });
  });

  it('rewrites a legacy #/g/:gameId?player= bookmark to a clean path', () => {
    window.history.replaceState(null, '', '/#/g/local-1?player=p1');

    const { result } = renderHook(() => useRoute());

    expect(window.location.pathname).toBe('/g/local-1');
    expect(window.location.search).toBe('?player=p1');
    expect(window.location.hash).toBe('');
    expect(result.current.route).toEqual({
      kind: 'game',
      gameId: 'local-1',
      playerId: 'p1',
    });
  });

  it('normalizes a bare # loaded on the lobby', () => {
    window.history.replaceState(null, '', '/#');

    renderHook(() => useRoute());

    expect(window.location.pathname).toBe('/');
    expect(window.location.hash).toBe('');
  });

  it('never introduces a hash when navigating back and forth', () => {
    const { result } = renderHook(() => useRoute());

    act(() => navigateToGame('room-1'));
    expect(window.location.hash).toBe('');

    act(() => navigateToLobby());
    expect(window.location.pathname).toBe('/');
    expect(window.location.hash).toBe('');

    act(() => navigateToGame('room-2'));
    expect(window.location.pathname).toBe('/g/room-2');
    expect(window.location.hash).toBe('');

    // A stale hash on an unrelated helper call is cleaned too.
    act(() => navigate('/'));
    expect(window.location.hash).toBe('');
    expect(result.current.route).toEqual({ kind: 'lobby' });
  });

  it('follows browser back/forward navigation (popstate) between / and /g/:gameId', () => {
    const { result } = renderHook(() => useRoute());

    act(() => {
      window.history.pushState(null, '', '/g/back');
      window.dispatchEvent(new PopStateEvent('popstate'));
    });

    expect(result.current.route).toEqual({ kind: 'game', gameId: 'back' });
    expect(window.location.hash).toBe('');

    act(() => {
      window.history.pushState(null, '', '/');
      window.dispatchEvent(new PopStateEvent('popstate'));
    });

    expect(result.current.route).toEqual({ kind: 'lobby' });
    expect(window.location.pathname).toBe('/');
    expect(window.location.hash).toBe('');
  });

  it('notifies every mounted hook synchronously', () => {
    const first = renderHook(() => useRoute());
    const second = renderHook(() => useRoute());

    act(() => navigate('/g/shared'));

    expect(first.result.current.route).toEqual({ kind: 'game', gameId: 'shared' });
    expect(second.result.current.route).toEqual({ kind: 'game', gameId: 'shared' });
  });

  it('stops listening once unmounted', () => {
    const { result, unmount } = renderHook(() => useRoute());
    unmount();

    act(() => navigate('/g/after-unmount'));

    expect(result.current.route).toEqual({ kind: 'lobby' });
  });

  it('leaves a non-legacy hash-free URL untouched', () => {
    window.history.replaceState(null, '', '/g/room-1?player=p1');
    normalizeUrl();

    expect(window.location.pathname).toBe('/g/room-1');
    expect(window.location.search).toBe('?player=p1');
    expect(window.location.hash).toBe('');
  });
});
