import { beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, waitFor, within } from '@testing-library/preact';
import type { PlayerGameView } from '../types';

vi.mock('../api/client', () => ({
  getGameView: vi.fn(),
  sendAction: vi.fn(),
}));

const wsState = vi.hoisted(() => ({
  onUpdate: null as ((view: unknown) => void) | null,
  presence: [] as boolean[],
}));

const audio = vi.hoisted(() => ({
  playAttackCard: vi.fn(),
  playDefendCard: vi.fn(),
  playRedirect: vi.fn(),
  playSurrender: vi.fn(),
  playTalonDraw: vi.fn(),
  playClockTick: vi.fn(),
  playGameOver: vi.fn(),
  installUnlockListeners: vi.fn(),
  removeUnlockListeners: vi.fn(),
}));

vi.mock('../audio/SoundEngine', () => ({
  soundEngine: audio,
  SoundEngine: class {},
  default: audio,
}));

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
    sendPresence(isPresent: boolean): void {
      wsState.presence.push(isPresent);
    }
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
    wsState.presence = [];
    Object.values(audio).forEach((spy) => spy.mockClear());
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
    // The deck, trump and TRUMP badge sit in the right sidebar under the clock
    // and PLAYERS list, never on the felt.
    expect(
      (right as HTMLElement).querySelector('[data-zone="table-deck"]'),
    ).not.toBeNull();
    expect(within(right as HTMLElement).getByTestId('talon-count').textContent).toBe('10');
    expect(within(right as HTMLElement).getByTestId('trump-indicator')).toBeTruthy();
    expect(within(arena as HTMLElement).queryByTestId('talon-count')).toBeNull();
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

  it('counts the clock down from the turn deadline and ticks in the last five seconds', async () => {
    getGameView.mockResolvedValue({
      ...view,
      turnDeadlineMs: Date.now() + 4_000,
      turnSecondsRemaining: 4,
    });

    render(<GamePage gameId="game-1" playerId="p0" onSwitchPlayer={() => {}} />);

    await waitFor(() =>
      expect(screen.getByTestId('turn-clock').textContent?.trim()).toBe('00:04'),
    );
    await waitFor(() => expect(audio.playClockTick).toHaveBeenCalled());
  });

  it('shows 00:00 without ticking once the deadline has passed', async () => {
    getGameView.mockResolvedValue({
      ...view,
      turnDeadlineMs: Date.now() - 5_000,
      turnSecondsRemaining: 0,
    });

    render(<GamePage gameId="game-1" playerId="p0" onSwitchPlayer={() => {}} />);

    await waitFor(() =>
      expect(screen.getByTestId('turn-clock').textContent?.trim()).toBe('00:00'),
    );
    expect(audio.playClockTick).not.toHaveBeenCalled();
  });

  it('never renders an invalid action banner and warns instead', async () => {
    getGameView.mockResolvedValue(view);
    sendAction.mockResolvedValue({ error: 'Moving is not legal right now' });
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});

    render(<GamePage gameId="game-1" playerId="p0" onSwitchPlayer={() => {}} />);

    await waitFor(() => expect(screen.getByText('Pass')).toBeTruthy());
    fireEvent.click(screen.getByText('Pass'));

    await waitFor(() =>
      expect(warn).toHaveBeenCalledWith(expect.stringContaining('Action rejected')),
    );
    expect(screen.queryByRole('alert')).toBeNull();
    expect(screen.queryByText(/Moving is not legal/)).toBeNull();
    warn.mockRestore();
  });

  it('double-click plays a card when there is only one legal attack target', async () => {
    const attackView: PlayerGameView = {
      ...view,
      myHand: [{ suit: 'spades', rank: 'six' }],
      tablePairs: [],
      boutPhase: 'initialAttack',
      attackerIdx: 0,
      defenderIdx: 1,
      legalActions: ['attack'],
    };
    getGameView.mockResolvedValue(attackView);
    sendAction.mockResolvedValue(attackView);

    render(<GamePage gameId="game-1" playerId="p0" onSwitchPlayer={() => {}} />);

    await waitFor(() => expect(screen.getByText('Attack')).toBeTruthy());
    fireEvent.dblClick(screen.getByLabelText('six of spades'));

    await waitFor(() =>
      expect(sendAction).toHaveBeenCalledWith('game-1', {
        type: 'initialAttack',
        playerId: 'p0',
        cards: [{ suit: 'spades', rank: 'six' }],
      }),
    );
  });

  it('ignores a double-click when the chaos attack target is ambiguous', async () => {
    const chaosView: PlayerGameView = {
      ...view,
      chaosMode: true,
      myHand: [{ suit: 'spades', rank: 'six' }],
      opponents: [
        { id: 'p1', name: 'Bob', cardCount: 6, hasPassed: false, finishRank: null },
        { id: 'p2', name: 'Carol', cardCount: 6, hasPassed: false, finishRank: null },
      ],
      tablePairs: [],
      boutPhase: 'initialAttack',
      attackerIdx: 0,
      defenderIdx: 1,
      legalActions: ['attack'],
    };
    getGameView.mockResolvedValue(chaosView);

    render(<GamePage gameId="game-1" playerId="p0" onSwitchPlayer={() => {}} />);

    await waitFor(() => expect(screen.getByText('Attack')).toBeTruthy());
    fireEvent.dblClick(screen.getByLabelText('six of spades'));

    expect(sendAction).not.toHaveBeenCalled();
  });

  it('plays attack, defense and game-over sounds from state changes', async () => {
    getGameView.mockResolvedValue(view);

    render(<GamePage gameId="game-1" playerId="p0" onSwitchPlayer={() => {}} />);

    await waitFor(() => expect(wsState.onUpdate).not.toBeNull());
    await waitFor(() => expect(screen.getByText('Pass')).toBeTruthy());

    wsState.onUpdate?.({
      ...view,
      tablePairs: [{ attack: { suit: 'spades', rank: 'six' }, defense: null }],
      legalActions: ['cover', 'surrender'],
    });
    await waitFor(() => expect(audio.playAttackCard).toHaveBeenCalledWith(1));

    wsState.onUpdate?.({
      ...view,
      tablePairs: [
        { attack: { suit: 'spades', rank: 'six' }, defense: { suit: 'spades', rank: 'seven' } },
      ],
      legalActions: ['surrender'],
    });
    await waitFor(() => expect(audio.playDefendCard).toHaveBeenCalled());

    wsState.onUpdate?.({ ...view, boutPhase: 'GameOver', legalActions: [] });
    await waitFor(() => expect(audio.playGameOver).toHaveBeenCalled());
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

  it('renders Back to lobby as a styled action button', async () => {
    getGameView.mockResolvedValue(view);

    render(<GamePage gameId="game-1" playerId="p0" onSwitchPlayer={() => {}} />);

    await waitFor(() => expect(screen.getByText('Pass')).toBeTruthy());
    const backToLobby = screen.getByRole('button', { name: 'Back to lobby' });

    expect(backToLobby.tagName).toBe('BUTTON');
    expect(backToLobby.className).toContain('action-button');
    expect(backToLobby.className).toContain('back-to-lobby');
    expect(screen.queryByRole('link', { name: 'Back to lobby' })).toBeNull();
  });

  it('keeps hotseat tabs and the players list in fixed seat order', async () => {
    const threePlayerView: PlayerGameView = {
      ...view,
      opponents: [
        { id: 'p2', name: 'Carol', cardCount: 4, hasPassed: false, finishRank: null },
        { id: 'p1', name: 'Bob', cardCount: 6, hasPassed: false, finishRank: null },
      ],
    };
    getGameView.mockResolvedValue(threePlayerView);

    const { container } = render(
      <GamePage gameId="game-1" playerId="p1" onSwitchPlayer={() => {}} />,
    );

    await waitFor(() => expect(screen.getByRole('tablist')).toBeTruthy());
    const tabs = screen.getAllByRole('tab');
    expect(tabs.map((tab) => tab.querySelector('.hotseat-id')?.textContent)).toEqual([
      'p0',
      'p1',
      'p2',
    ]);
    // The active player stays in its seat slot instead of jumping to the top.
    expect(tabs[1].getAttribute('aria-selected')).toBe('true');

    const badges = Array.from(
      container.querySelectorAll('.status-badge'),
    ) as HTMLElement[];
    expect(badges.map((badge) => badge.getAttribute('data-player-id'))).toEqual([
      'p0',
      'p1',
      'p2',
    ]);
  });

  it('shows a clock above every seat and ticks only the player being waited on', async () => {
    getGameView.mockResolvedValue({
      ...view,
      opponents: [
        { id: 'p2', name: 'Carol', cardCount: 4, hasPassed: false, finishRank: null },
        { id: 'p1', name: 'Bob', cardCount: 6, hasPassed: false, finishRank: null },
      ],
      attackerIdx: 2,
      defenderIdx: 0,
      boutPhase: 'defense',
      turnPlayerId: 'p1',
      turnSecondsRemaining: 9,
      legalActions: ['pass'],
    });

    const { container } = render(
      <GamePage gameId="game-1" playerId="p0" onSwitchPlayer={() => {}} />,
    );

    await waitFor(() => expect(screen.getByTestId('seat-clock-p1')).toBeTruthy());
    expect(screen.getByTestId('seat-clock-p1').textContent).toBe('00:09');
    expect(screen.getByTestId('seat-clock-p1').getAttribute('data-active')).toBe('true');
    expect(screen.getByTestId('seat-clock-p2').getAttribute('data-active')).toBe('false');

    const seats = Array.from(
      container.querySelectorAll('[data-testid="opponent"]'),
    ) as HTMLElement[];
    for (const seat of seats) {
      expect(seat.querySelector('.seat-clock')?.nextElementSibling).toBe(
        seat.querySelector('.seat-box'),
      );
    }

    // The viewer's own clock sits directly above their hand.
    const handClock = screen.getByTestId('hand-clock');
    expect(handClock.getAttribute('data-active')).toBe('false');
    expect(handClock.nextElementSibling?.classList.contains('hand-cards')).toBe(true);
  });

  it('binds amber to the attacker and crimson to the defender', async () => {
    getGameView.mockResolvedValue({
      ...view,
      opponents: [
        { id: 'p1', name: 'Bob', cardCount: 6, hasPassed: false, finishRank: null },
        { id: 'p2', name: 'Carol', cardCount: 6, hasPassed: false, finishRank: null },
      ],
      tablePairs: [{ attack: { suit: 'spades', rank: 'six' }, defense: null }],
      attackerIdx: 1,
      defenderIdx: 2,
      boutPhase: 'defense',
      legalActions: ['pass'],
    });

    const { container } = render(
      <GamePage gameId="game-1" playerId="p0" onSwitchPlayer={() => {}} />,
    );

    await waitFor(() => expect(screen.getByTestId('seat-clock-p1')).toBeTruthy());
    const attackerSeat = screen
      .getByTestId('seat-clock-p1')
      .closest('.seat') as HTMLElement;
    const defenderSeat = screen
      .getByTestId('seat-clock-p2')
      .closest('.seat') as HTMLElement;

    expect(attackerSeat.classList.contains('active-attacker')).toBe(true);
    expect(defenderSeat.classList.contains('active-defender')).toBe(true);
    expect(attackerSeat.classList.contains('active-defender')).toBe(false);
    expect(defenderSeat.classList.contains('active-attacker')).toBe(false);
    expect(container.querySelector('.seat-box')).not.toBeNull();
  });

  it('lifts only the hand cards that can legally answer the attack', async () => {
    getGameView.mockResolvedValue({
      ...view,
      myHand: [
        { suit: 'spades', rank: 'ace' },
        { suit: 'hearts', rank: 'two' },
      ],
      tablePairs: [{ attack: { suit: 'spades', rank: 'six' }, defense: null }],
      attackerIdx: 1,
      defenderIdx: 0,
      boutPhase: 'defense',
      legalActions: ['cover', 'surrender'],
    });

    const { container } = render(
      <GamePage gameId="game-1" playerId="p0" onSwitchPlayer={() => {}} />,
    );

    await waitFor(() => expect(screen.getByText('Surrender')).toBeTruthy());

    const lifted = Array.from(
      container.querySelectorAll('.card-slot.legal-playable'),
    ) as HTMLElement[];
    expect(lifted).toHaveLength(1);
    expect(lifted[0].getAttribute('data-rank')).toBe('ace');
  });

  it('auto-surrenders after the grace period when the defender cannot answer', async () => {
    const hopelessView: PlayerGameView = {
      ...view,
      myHand: [{ suit: 'clubs', rank: 'two' }],
      tablePairs: [{ attack: { suit: 'spades', rank: 'six' }, defense: null }],
      attackerIdx: 1,
      defenderIdx: 0,
      boutPhase: 'defense',
      legalActions: ['surrender'],
    };
    getGameView.mockResolvedValue(hopelessView);
    sendAction.mockResolvedValue({
      ...hopelessView,
      boutPhase: 'surrenderThrowIn',
      legalActions: [],
    });

    render(
      <GamePage
        gameId="game-1"
        playerId="p0"
        onSwitchPlayer={() => {}}
        autoSurrenderMs={40}
      />,
    );

    await waitFor(() =>
      expect(sendAction).toHaveBeenCalledWith(
        'game-1',
        expect.objectContaining({ type: 'declareSurrender', playerId: 'p0' }),
      ),
    );
  });

  it('shows the 3-second countdown on the Surrender button', async () => {
    getGameView.mockResolvedValue({
      ...view,
      myHand: [{ suit: 'clubs', rank: 'two' }],
      tablePairs: [{ attack: { suit: 'spades', rank: 'six' }, defense: null }],
      attackerIdx: 1,
      defenderIdx: 0,
      boutPhase: 'defense',
      legalActions: ['surrender'],
    });

    render(<GamePage gameId="game-1" playerId="p0" onSwitchPlayer={() => {}} />);

    await waitFor(() => expect(screen.getByTestId('surrender-countdown')).toBeTruthy());
    expect(screen.getByTestId('surrender-countdown').textContent).toBe('3');
    expect(screen.queryByTestId('auto-surrender-sent')).toBeNull();
  });

  it('does not auto-surrender while a legal cover exists', async () => {
    getGameView.mockResolvedValue({
      ...view,
      myHand: [{ suit: 'spades', rank: 'ace' }],
      tablePairs: [{ attack: { suit: 'spades', rank: 'six' }, defense: null }],
      attackerIdx: 1,
      defenderIdx: 0,
      boutPhase: 'defense',
      legalActions: ['cover', 'surrender'],
    });

    render(
      <GamePage
        gameId="game-1"
        playerId="p0"
        onSwitchPlayer={() => {}}
        autoSurrenderMs={60}
      />,
    );

    await waitFor(() => expect(screen.getByText('Surrender')).toBeTruthy());
    expect(screen.queryByTestId('surrender-countdown')).toBeNull();

    await new Promise((resolve) => setTimeout(resolve, 160));
    expect(sendAction).not.toHaveBeenCalled();
  });

  it('lets the defender surrender manually before the countdown ends', async () => {
    const hopelessView: PlayerGameView = {
      ...view,
      myHand: [{ suit: 'clubs', rank: 'two' }],
      tablePairs: [{ attack: { suit: 'spades', rank: 'six' }, defense: null }],
      attackerIdx: 1,
      defenderIdx: 0,
      boutPhase: 'defense',
      legalActions: ['surrender'],
    };
    getGameView.mockResolvedValue(hopelessView);
    sendAction.mockResolvedValue({
      ...hopelessView,
      boutPhase: 'surrenderThrowIn',
      legalActions: [],
    });

    render(
      <GamePage
        gameId="game-1"
        playerId="p0"
        onSwitchPlayer={() => {}}
        autoSurrenderMs={300}
      />,
    );

    await waitFor(() => expect(screen.getByText('Surrender')).toBeTruthy());
    fireEvent.click(screen.getByRole('button', { name: /Surrender/ }));

    await waitFor(() => expect(sendAction).toHaveBeenCalledTimes(1));
    await new Promise((resolve) => setTimeout(resolve, 320));
    expect(sendAction).toHaveBeenCalledTimes(1);
    expect(sendAction).toHaveBeenCalledWith(
      'game-1',
      expect.objectContaining({ type: 'declareSurrender', playerId: 'p0' }),
    );
  });

  it('freezes the clock at 00:15 for the player who is not being waited on', async () => {
    getGameView.mockResolvedValue({
      ...view,
      turnDeadlineMs: Date.now() + 4_000,
      turnSecondsRemaining: 4,
      turnPlayerId: 'p1',
    });

    render(<GamePage gameId="game-1" playerId="p0" onSwitchPlayer={() => {}} />);

    await waitFor(() =>
      expect(screen.getByTestId('turn-clock').textContent?.trim()).toBe('00:15'),
    );
    expect(screen.getByTestId('turn-clock').getAttribute('data-active')).toBe('false');

    // It stays frozen instead of counting down while another player is timed.
    await new Promise((resolve) => setTimeout(resolve, 300));
    expect(screen.getByTestId('turn-clock').textContent?.trim()).toBe('00:15');
    expect(audio.playClockTick).not.toHaveBeenCalled();
  });

  it('counts down and marks the clock active for the player being waited on', async () => {
    getGameView.mockResolvedValue({
      ...view,
      turnDeadlineMs: Date.now() + 4_000,
      turnSecondsRemaining: 4,
      turnPlayerId: 'p0',
    });

    render(<GamePage gameId="game-1" playerId="p0" onSwitchPlayer={() => {}} />);

    await waitFor(() =>
      expect(screen.getByTestId('turn-clock').textContent?.trim()).toBe('00:04'),
    );
    expect(screen.getByTestId('turn-clock').getAttribute('data-active')).toBe('true');
  });

  it('passes the remaining seconds to the tick sound', async () => {
    getGameView.mockResolvedValue({
      ...view,
      turnDeadlineMs: Date.now() + 4_000,
      turnSecondsRemaining: 4,
      turnPlayerId: 'p0',
    });

    render(<GamePage gameId="game-1" playerId="p0" onSwitchPlayer={() => {}} />);

    await waitFor(() => expect(audio.playClockTick).toHaveBeenCalledWith(4));
  });

  it('shows a green presence dot only while the window is focused and active', async () => {
    getGameView.mockResolvedValue(view);
    const focus = vi.spyOn(document, 'hasFocus').mockReturnValue(true);

    render(<GamePage gameId="game-1" playerId="p0" onSwitchPlayer={() => {}} />);

    await waitFor(() => expect(screen.getByTestId('presence-dot-p0')).toBeTruthy());
    expect(screen.getByTestId('presence-dot-p0').getAttribute('data-present')).toBe('true');
    // Opponents without presence data read as away.
    expect(screen.getByTestId('presence-dot-p1').getAttribute('data-present')).toBe('false');
    expect(wsState.presence).toContain(true);

    focus.mockReturnValue(false);
    window.dispatchEvent(new Event('blur'));

    await waitFor(() =>
      expect(screen.getByTestId('presence-dot-p0').getAttribute('data-present')).toBe('false'),
    );
    await waitFor(() => expect(wsState.presence).toContain(false));
    focus.mockRestore();
  });

  it('uses the server presentPlayers list for opponent dots', async () => {
    getGameView.mockResolvedValue({ ...view, presentPlayers: ['p1'] });

    render(<GamePage gameId="game-1" playerId="p0" onSwitchPlayer={() => {}} />);

    await waitFor(() =>
      expect(screen.getByTestId('presence-dot-p1').getAttribute('data-present')).toBe('true'),
    );
    expect(screen.getByTestId('presence-dot-p1').classList.contains('present')).toBe(true);
  });
});
