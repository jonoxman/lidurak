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
import appCss from '../app.css?raw';
import tableCss from '../styles/table.css?raw';

/** Declarations of the first rule whose selector text contains `selector`. */
function cssRule(css: string, selector: string): string {
  const start = css.indexOf(selector);
  if (start === -1) return '';
  const open = css.indexOf('{', start);
  const close = css.indexOf('}', open);
  return open === -1 || close === -1 ? '' : css.slice(open + 1, close);
}

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

  it('T-90-3: darkens the lobby selection and Create Game glows in light mode', async () => {
    render(<App />);

    const create = await screen.findByRole('button', { name: 'Create Game' });
    expect(create.classList.contains('green')).toBe(true);

    // The player-count control is the lobby's active player selector.
    const playerCount = document.querySelector('.lobby-form .field select');
    expect(playerCount).not.toBeNull();

    expect(
      cssRule(appCss, "html[data-theme='light'] .lobby-form .field select:focus-visible"),
    ).toContain('rgba(21, 128, 61, 0.55)');
    expect(
      cssRule(appCss, "html[data-theme='light'] .lobby-form .action-button.green"),
    ).toContain('rgba(21, 128, 61, 0.6)');
    expect(
      cssRule(appCss, "html[data-theme='light'] .lobby-form .action-button.green:hover"),
    ).toContain('rgba(21, 128, 61, 0.75)');

    // Dark mode keeps the flat accent surface with no glow.
    expect(cssRule(tableCss, '.action-button.green')).toContain('background: var(--durak-accent)');
    expect(cssRule(tableCss, '.action-button.green')).not.toContain('box-shadow');
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
