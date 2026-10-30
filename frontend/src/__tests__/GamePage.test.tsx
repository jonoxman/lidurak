import { beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, waitFor } from '@testing-library/preact';
import type { PlayerGameView } from '../types';

vi.mock('../api/client', () => ({
  getGameView: vi.fn(),
  sendAction: vi.fn(),
}));

const wsState = vi.hoisted(() => ({ onUpdate: null as ((view: unknown) => void) | null }));

vi.mock('../api/websocket', () => ({
  GameWebSocket: class {
    constructor(_gameId: string, _playerId: string, onUpdate: (view: unknown) => void) {
      wsState.onUpdate = onUpdate;
    }
    connect(): void {}
    disconnect(): void {}
    isOpen(): boolean {
      return false;
    }
    sendAction(): void {}
  },
}));

import * as client from '../api/client';
import { GamePage } from '../pages/GamePage';

const view: PlayerGameView = {
  myId: 'p0',
  myHand: [{ suit: 'spades', rank: 'six' }],
  opponents: [{ id: 'p1', name: 'Bob', cardCount: 6, hasPassed: false, finishRank: null }],
  tablePairs: [],
  talonCount: 10,
  bottomTrumpCard: null,
  trumpSuit: 'spades',
  attackerIdx: 1,
  defenderIdx: 0,
  boutPhase: 'defense',
  legalActions: ['pass'],
  finishOrder: [],
  isDraw: false,
  maxBoutAttacks: 6,
};

const getGameView = client.getGameView as unknown as ReturnType<typeof vi.fn>;
const sendAction = client.sendAction as unknown as ReturnType<typeof vi.fn>;

describe('GamePage', () => {
  beforeEach(() => {
    getGameView.mockReset();
    sendAction.mockReset();
    wsState.onUpdate = null;
  });

  it('loads the view and sends actions through REST when the socket is closed', async () => {
    getGameView.mockResolvedValue(view);
    sendAction.mockResolvedValue(view);

    render(<GamePage gameId="game-1" playerId="p0" onSwitchPlayer={() => {}} />);

    await waitFor(() => expect(screen.getByText('Pass')).toBeTruthy());
    expect(getGameView).toHaveBeenCalledWith('game-1', 'p0');

    fireEvent.click(screen.getByText('Pass'));

    await waitFor(() =>
      expect(sendAction).toHaveBeenCalledWith('game-1', {
        type: 'passTurn',
        playerId: 'p0',
      }),
    );
  });

  it('selects a hand card, then covers an uncovered table attack with it', async () => {
    const defenseView: PlayerGameView = {
      ...view,
      myHand: [{ suit: 'hearts', rank: 'ace' }],
      tablePairs: [{ attack: { suit: 'spades', rank: 'six' }, defense: null }],
      attackerIdx: 1,
      defenderIdx: 0,
      boutPhase: 'defense',
      legalActions: ['cover', 'surrender'],
    };
    getGameView.mockResolvedValue(defenseView);
    sendAction.mockResolvedValue(defenseView);

    const { container } = render(
      <GamePage gameId="game-1" playerId="p0" onSwitchPlayer={() => {}} />,
    );

    await waitFor(() => expect(screen.getByText('Surrender')).toBeTruthy());

    fireEvent.click(screen.getByLabelText('ace of hearts'));
    expect(
      container.querySelector('[data-suit="hearts"]')?.getAttribute('data-selected'),
    ).toBe('true');

    fireEvent.click(screen.getByLabelText('six of spades'));

    await waitFor(() =>
      expect(sendAction).toHaveBeenCalledWith('game-1', {
        type: 'coverCard',
        playerId: 'p0',
        attackIndex: 0,
        defenseCard: { suit: 'hearts', rank: 'ace' },
      }),
    );
  });

  it('shows the winner and the Durak when the bout phase is GameOver', async () => {
    const gameOverView: PlayerGameView = {
      ...view,
      myHand: [],
      tablePairs: [],
      boutPhase: 'GameOver',
      legalActions: [],
      finishOrder: ['p1', 'p0'],
      isDraw: false,
    };
    getGameView.mockResolvedValue(gameOverView);

    render(<GamePage gameId="game-1" playerId="p0" onSwitchPlayer={() => {}} />);

    await waitFor(() => expect(screen.getByText('Bob wins')).toBeTruthy());
    expect(screen.getByText('You are the Durak.')).toBeTruthy();
    expect(screen.queryByText('Pass')).toBeNull();
  });

  it('marks the connection live once the socket delivers a view', async () => {
    getGameView.mockResolvedValue(view);

    render(<GamePage gameId="game-1" playerId="p0" onSwitchPlayer={() => {}} />);

    await waitFor(() => expect(screen.getByText('Connecting…')).toBeTruthy());
    await waitFor(() => expect(wsState.onUpdate).not.toBeNull());

    wsState.onUpdate?.({ ...view, legalActions: ['surrender'] });

    await waitFor(() => expect(screen.getByText('Connected')).toBeTruthy());
    expect(screen.getByText('Surrender')).toBeTruthy();
  });

  it('applies the view returned by the REST fallback', async () => {
    getGameView.mockResolvedValue(view);
    sendAction.mockResolvedValue({ ...view, legalActions: ['surrender'] });

    render(<GamePage gameId="game-1" playerId="p0" onSwitchPlayer={() => {}} />);

    await waitFor(() => expect(screen.getByText('Pass')).toBeTruthy());
    fireEvent.click(screen.getByText('Pass'));

    await waitFor(() => expect(screen.getByText('Surrender')).toBeTruthy());
    expect(screen.queryByText('Pass')).toBeNull();
  });
});
