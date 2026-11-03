import { beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen, waitFor } from '@testing-library/preact';

vi.mock('../api/client', () => ({
  checkServerHealth: vi.fn(async () => true),
  createGame: vi.fn(),
  getGameView: vi.fn(),
  sendAction: vi.fn(),
}));

import * as client from '../api/client';
import { App, parseRoute } from '../app';

const checkServerHealth = client.checkServerHealth as unknown as ReturnType<typeof vi.fn>;

describe('App', () => {
  beforeEach(() => {
    checkServerHealth.mockResolvedValue(true);
  });

  it('does not repeat the Lidurak title below the header bar', async () => {
    render(<App />);

    await screen.findByRole('button', { name: 'Create Game' });

    expect(document.querySelector('.app-title')).toBeNull();
    expect(screen.queryByRole('heading', { level: 1 })).toBeNull();
  });

  it('shows the local lobby by default', async () => {
    render(<App />);
    expect(await screen.findByRole('button', { name: 'Create Game' })).toBeTruthy();
  });

  it('mounts the universal site header above the lobby', async () => {
    render(<App />);

    const header = screen.getByRole('banner');
    expect(header.getAttribute('data-zone')).toBe('site-header');
    expect(screen.getByRole('link', { name: 'LIDURAK' }).getAttribute('href')).toBe('#/');
    expect(screen.getByRole('button', { name: 'Account menu' })).toBeTruthy();
    await screen.findByRole('button', { name: 'Create Game' });
  });

  it('waits on the loading view instead of the lobby until the backend is ready', async () => {
    checkServerHealth.mockResolvedValue(false);
    render(<App />);

    const loading = await screen.findByTestId('server-loading');
    expect(loading.getAttribute('role')).toBe('status');
    expect(loading.textContent).toContain('Starting game server, please wait');
    expect(screen.queryByRole('button', { name: 'Create Game' })).toBeNull();

    checkServerHealth.mockResolvedValue(true);
    await waitFor(
      () => expect(screen.getByRole('button', { name: 'Create Game' })).toBeTruthy(),
      { timeout: 3000 },
    );
  });
});

describe('parseRoute', () => {
  it('routes a game hash with a player query parameter', () => {
    expect(parseRoute('#/g/game-1?player=p2')).toEqual({
      name: 'game',
      gameId: 'game-1',
      playerId: 'p2',
    });
  });

  it('routes an 8-character alphanumeric game id', () => {
    expect(parseRoute('#/g/aB3dE9fZ?player=p1')).toEqual({
      name: 'game',
      gameId: 'aB3dE9fZ',
      playerId: 'p1',
    });
  });

  it('decodes the game id and defaults the player id', () => {
    expect(parseRoute('#/g/game%2F1')).toEqual({
      name: 'game',
      gameId: 'game/1',
      playerId: 'p0',
    });
  });

  it('falls back to the lobby for other hashes', () => {
    expect(parseRoute('')).toEqual({ name: 'lobby' });
    expect(parseRoute('#/')).toEqual({ name: 'lobby' });
    expect(parseRoute('#/g/')).toEqual({ name: 'lobby' });
  });

  it('rejects a game id that is empty once decoded', () => {
    expect(parseRoute('#/g/%20')).toEqual({ name: 'lobby' });
    expect(parseRoute('#/g/%20%20')).toEqual({ name: 'lobby' });
    expect(parseRoute('#/g/%E0%A4%A')).toEqual({ name: 'lobby' });
  });

  it('defaults a blank player query parameter', () => {
    expect(parseRoute('#/g/game-1?player=')).toEqual({
      name: 'game',
      gameId: 'game-1',
      playerId: 'p0',
    });
  });

  it('routes the /replay alias of a game and defaults the player', () => {
    expect(parseRoute('#/g/game-1/replay')).toEqual({
      name: 'game',
      gameId: 'game-1',
      playerId: 'p0',
    });
    expect(parseRoute('#/g/game-1/replay?player=p2')).toEqual({
      name: 'game',
      gameId: 'game-1',
      playerId: 'p2',
    });
  });

  it('defaults a whitespace-only player query parameter', () => {
    expect(parseRoute('#/g/game-1?player=%20')).toEqual({
      name: 'game',
      gameId: 'game-1',
      playerId: 'p0',
    });
  });
});
