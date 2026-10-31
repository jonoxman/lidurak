import { beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, waitFor } from '@testing-library/preact';

vi.mock('../api/client', () => ({
  createGame: vi.fn(),
}));

import * as client from '../api/client';
import { LobbyPage } from '../pages/LobbyPage';

const createGame = client.createGame as unknown as ReturnType<typeof vi.fn>;

const submitForm = () => {
  const form = screen.getByRole('button', { name: /Create Game|Creating/ }).closest('form');
  fireEvent.submit(form as HTMLFormElement);
};

describe('LobbyPage', () => {
  beforeEach(() => {
    createGame.mockReset();
  });

  it('renders a two-player form by default', () => {
    render(<LobbyPage />);

    expect(screen.getByLabelText('Players')).toBeTruthy();
    expect((screen.getByLabelText('Player 1') as HTMLInputElement).value).toBe('Alice');
    expect((screen.getByLabelText('Player 2') as HTMLInputElement).value).toBe('Bob');
    expect(screen.queryByLabelText('Player 3')).toBeNull();
    expect(screen.getByLabelText('Allow redirects')).toBeTruthy();
  });

  it('adds a name field per extra player when the count changes', async () => {
    render(<LobbyPage />);

    fireEvent.change(screen.getByLabelText('Players'), { target: { value: '4' } });

    await waitFor(() => expect(screen.getByLabelText('Player 4')).toBeTruthy());
    expect((screen.getByLabelText('Player 3') as HTMLInputElement).value).toBe('Carol');
  });

  it('creates a game with the chosen names and links every player view', async () => {
    createGame.mockResolvedValue({ gameId: 'game-1', players: ['p0', 'p1', 'p2'] });
    render(<LobbyPage />);

    fireEvent.change(screen.getByLabelText('Players'), { target: { value: '3' } });
    fireEvent.input(screen.getByLabelText('Player 1'), { target: { value: 'Zoe' } });
    fireEvent.change(screen.getByLabelText('Allow redirects'), { target: { checked: false } });
    submitForm();

    await waitFor(() =>
      expect(createGame).toHaveBeenCalledWith(3, ['Zoe', 'Bob', 'Carol'], false, false),
    );

    const alice = await screen.findByRole('link', { name: 'Zoe (p0)' });
    expect(alice.getAttribute('href')).toBe('#/g/game-1?player=p0');
    expect(screen.getByRole('link', { name: 'Bob (p1)' }).getAttribute('href')).toBe(
      '#/g/game-1?player=p1',
    );
    expect(screen.getByRole('link', { name: 'Carol (p2)' }).getAttribute('href')).toBe(
      '#/g/game-1?player=p2',
    );
  });

  it('offers chaos mode only for three or more players and sends it on create', async () => {
    createGame.mockResolvedValue({ gameId: 'game-1', players: ['p0', 'p1', 'p2'] });
    render(<LobbyPage />);

    expect(screen.queryByLabelText('Chaos mode (attack any player)')).toBeNull();

    fireEvent.change(screen.getByLabelText('Players'), { target: { value: '3' } });
    const chaos = await screen.findByLabelText('Chaos mode (attack any player)');
    expect((chaos as HTMLInputElement).checked).toBe(false);

    fireEvent.click(chaos);
    submitForm();

    await waitFor(() =>
      expect(createGame).toHaveBeenCalledWith(3, ['Alice', 'Bob', 'Carol'], true, true),
    );
  });

  it('drops chaos mode when the player count returns to two', async () => {
    createGame.mockResolvedValue({ gameId: 'game-1', players: ['p0', 'p1'] });
    render(<LobbyPage />);

    fireEvent.change(screen.getByLabelText('Players'), { target: { value: '4' } });
    fireEvent.click(await screen.findByLabelText('Chaos mode (attack any player)'));
    fireEvent.change(screen.getByLabelText('Players'), { target: { value: '2' } });

    expect(screen.queryByLabelText('Chaos mode (attack any player)')).toBeNull();
    submitForm();

    await waitFor(() =>
      expect(createGame).toHaveBeenCalledWith(2, ['Alice', 'Bob'], true, false),
    );
  });

  it('shows an error banner when game creation fails', async () => {
    createGame.mockRejectedValue(new Error('backend down'));
    render(<LobbyPage />);

    submitForm();

    const alert = await screen.findByRole('alert');
    expect(alert.textContent).toContain('backend down');
  });
});
