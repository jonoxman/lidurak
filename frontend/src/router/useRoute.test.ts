import { act, renderHook } from '@testing-library/preact';
import { beforeEach, describe, expect, it } from 'vitest';
import { navigate, parseRoute, useRoute } from './useRoute';

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

  it('ignores query strings and hashes', () => {
    expect(parseRoute('/g/room-1?player=p0')).toEqual({ kind: 'game', gameId: 'room-1' });
    expect(parseRoute('/g/room-1#replay')).toEqual({ kind: 'game', gameId: 'room-1' });
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
    window.history.replaceState({}, '', '/');
  });

  it('starts on the lobby and exposes navigate', () => {
    const { result } = renderHook(() => useRoute());

    expect(result.current.route).toEqual({ kind: 'lobby' });
    expect(typeof result.current.navigate).toBe('function');
  });

  it('navigates with the History API and updates the mounted hook without a reload', () => {
    const { result } = renderHook(() => useRoute());

    act(() => navigate('/g/room-1'));

    expect(window.location.pathname).toBe('/g/room-1');
    expect(result.current.route).toEqual({ kind: 'game', gameId: 'room-1' });
  });

  it('notifies every mounted hook synchronously', () => {
    const first = renderHook(() => useRoute());
    const second = renderHook(() => useRoute());

    act(() => navigate('/g/shared'));

    expect(first.result.current.route).toEqual({ kind: 'game', gameId: 'shared' });
    expect(second.result.current.route).toEqual({ kind: 'game', gameId: 'shared' });
  });

  it('follows browser back/forward navigation (popstate)', () => {
    const { result } = renderHook(() => useRoute());

    act(() => {
      window.history.pushState({}, '', '/g/back');
      window.dispatchEvent(new PopStateEvent('popstate'));
    });

    expect(result.current.route).toEqual({ kind: 'game', gameId: 'back' });
  });

  it('stops listening once unmounted', () => {
    const { result, unmount } = renderHook(() => useRoute());
    unmount();

    act(() => navigate('/g/after-unmount'));

    expect(result.current.route).toEqual({ kind: 'lobby' });
  });
});
