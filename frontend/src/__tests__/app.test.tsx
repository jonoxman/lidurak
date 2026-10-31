import { describe, expect, it } from 'vitest';
import { render, screen } from '@testing-library/preact';
import { App, parseRoute } from '../app';

describe('App', () => {
  it('renders the Lidurak heading', () => {
    render(<App />);
    expect(screen.getByRole('heading', { level: 1 }).textContent).toBe('Lidurak');
  });

  it('shows the local lobby by default', () => {
    render(<App />);
    expect(screen.getByRole('button', { name: 'Create Game' })).toBeTruthy();
  });

  it('mounts the universal site header above the lobby', () => {
    render(<App />);

    const header = screen.getByRole('banner');
    expect(header.getAttribute('data-zone')).toBe('site-header');
    expect(screen.getByRole('link', { name: 'LIDURAK' }).getAttribute('href')).toBe('#/');
    expect(screen.getByRole('button', { name: 'Account menu' })).toBeTruthy();
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
});
