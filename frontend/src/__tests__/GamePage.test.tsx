import { beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, waitFor, within } from '@testing-library/preact';
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

  it('renders the three-column shell zones', async () => {
    getGameView.mockResolvedValue(view);

    const { container } = render(
      <GamePage gameId="game-1" playerId="p0" onSwitchPlayer={() => {}} />,
    );

    await waitFor(() => expect(screen.getByText('Pass')).toBeTruthy());

    const left = container.querySelector('[data-zone="sidebar-left"]');
    const arena = container.querySelector('[data-zone="table-arena"]');
    const right = container.querySelector('[data-zone="sidebar-right"]');
    expect(left).not.toBeNull();
    expect(arena).not.toBeNull();
    expect(right).not.toBeNull();

    // How to Play lives in the left sidebar, not above the table.
    expect(within(left as HTMLElement).getByText('How to Play')).toBeTruthy();
    expect(within(left as HTMLElement).getByRole('tablist')).toBeTruthy();
    expect(screen.getByTestId('turn-clock').textContent?.trim()).toBe('00:15');
    expect(container.querySelector('[data-zone="table-deck"]')).not.toBeNull();
  });

  it('switches the hotseat player from the left sidebar tabs', async () => {
    getGameView.mockResolvedValue(view);
    const onSwitchPlayer = vi.fn();

    render(
      <GamePage gameId="game-1" playerId="p0" onSwitchPlayer={onSwitchPlayer} />,
    );

    await waitFor(() => expect(screen.getByRole('tablist')).toBeTruthy());
    const tabs = screen.getAllByRole('tab');
    expect(tabs).toHaveLength(2);

    fireEvent.click(screen.getByRole('tab', { name: /Bob/ }));
    expect(onSwitchPlayer).toHaveBeenCalledWith('p1');
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

  it('shows the winner and the Durak in the right sidebar when the bout phase is GameOver', async () => {
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

    const { container } = render(
      <GamePage gameId="game-1" playerId="p0" onSwitchPlayer={() => {}} />,
    );

    await waitFor(() => expect(screen.getByText('Bob wins')).toBeTruthy());
    expect(screen.getByText('You are the Durak.')).toBeTruthy();
    expect(screen.queryByText('Pass')).toBeNull();

    const result = container.querySelector('[data-zone="sidebar-right"] .game-result');
    expect(result).not.toBeNull();
  });

  it('renders no instructional text clutter inside the table', async () => {
    getGameView.mockResolvedValue(view);

    const { container } = render(
      <GamePage gameId="game-1" playerId="p0" onSwitchPlayer={() => {}} />,
    );

    await waitFor(() => expect(screen.getByText('Pass')).toBeTruthy());

    const arena = container.querySelector('[data-zone="table-arena"]') as HTMLElement;
    expect(arena.textContent).not.toMatch(/Waiting for/i);
    expect(arena.textContent).not.toMatch(/Your turn/i);
    expect(container.querySelector('.game-hint')).toBeNull();
  });

  it('shows only contextual pass controls and the sort bar in the third column', async () => {
    getGameView.mockResolvedValue({
      ...view,
      attackerIdx: 0,
      defenderIdx: 1,
      legalActions: ['pass', 'redirect'],
    });

    const { container } = render(
      <GamePage gameId="game-1" playerId="p0" onSwitchPlayer={() => {}} />,
    );

    await waitFor(() => expect(screen.getByText('Pass')).toBeTruthy());

    const controls = container.querySelector('[data-zone="player-controls"]') as HTMLElement;
    expect(controls.querySelector('[data-testid="sort-bar"]')).not.toBeNull();
    expect(within(controls).getByRole('button', { name: 'Pass' })).toBeTruthy();
    expect(screen.queryByText('Redirect')).toBeNull();
    expect(within(controls).queryByRole('button', { name: 'Surrender' })).toBeNull();

    // The hand stays calm because the viewer is not the one being waited on.
    expect(
      container.querySelector('[data-zone="player-hand"]')!.classList.contains('turn-pulse'),
    ).toBe(false);
  });

  it('pulses the defender hand and never the table banners while defending', async () => {
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

    const { container } = render(
      <GamePage gameId="game-1" playerId="p0" onSwitchPlayer={() => {}} />,
    );

    await waitFor(() => expect(screen.getByText('Surrender')).toBeTruthy());

    const controls = container.querySelector('[data-zone="player-controls"]') as HTMLElement;
    expect(within(controls).queryByRole('button', { name: 'Pass' })).toBeNull();
    expect(screen.queryByText('Redirect')).toBeNull();
    expect(container.querySelector('.table-pair.turn-pulse .card-slot')).not.toBeNull();
    expect(container.querySelector('[data-zone="player-hand"]')!.textContent).not.toMatch(
      /Your turn|Waiting for/i,
    );
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
