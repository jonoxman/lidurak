import { beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, waitFor, within } from '@testing-library/preact';
import type { PlayerGameView } from '../types';

vi.mock('../api/client', () => ({
  getGameView: vi.fn(),
  getGameReplay: vi.fn(),
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
import appCss from '../app.css?raw';

/** The light-theme Back to lobby rules, from their selector up to the OS query. */
const backToLobbyLightCss = (() => {
  const marker = "html[data-theme='light'] .game-page .back-to-lobby";
  const start = appCss.indexOf(marker);
  if (start === -1) return '';
  const rest = appCss.slice(start);
  const end = rest.indexOf('@media');
  return end === -1 ? rest : rest.slice(0, end);
})();

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

// A multi-suit hand, so the sidebar sort mode visibly changes the order.
const sortableView: PlayerGameView = {
  ...view,
  myHand: [
    { suit: 'clubs', rank: 'ace' },
    { suit: 'hearts', rank: 'six' },
    { suit: 'spades', rank: 'king' },
  ],
};

const getGameView = client.getGameView as unknown as ReturnType<typeof vi.fn>;
const getGameReplay = client.getGameReplay as unknown as ReturnType<typeof vi.fn>;
const sendAction = client.sendAction as unknown as ReturnType<typeof vi.fn>;

describe('GamePage', () => {
  beforeEach(() => {
    getGameView.mockReset();
    getGameReplay.mockReset();
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

  it('titles the deck box, centres the assembly and puts the counter top-left', async () => {
    getGameView.mockResolvedValue({
      ...view,
      bottomTrumpCard: { suit: 'spades', rank: 'nine' },
    });

    const { container } = render(
      <GamePage gameId="game-1" playerId="p0" onSwitchPlayer={() => {}} />,
    );

    await waitFor(() => expect(screen.getByTestId('talon-count')).toBeTruthy());

    const deckBox = container.querySelector(
      '[data-zone="sidebar-right"] [data-zone="table-deck"]',
    ) as HTMLElement;
    expect(within(deckBox).getByText('Deck')).toBeTruthy();

    const assembly = within(deckBox).getByTestId('deck-assembly');
    expect(assembly.getAttribute('data-align')).toBe('center');
    expect(assembly.contains(within(deckBox).getByTestId('talon-deck'))).toBe(true);
    expect(assembly.contains(within(deckBox).getByTestId('trump-indicator'))).toBe(true);

    const count = within(deckBox).getByTestId('talon-count');
    expect(count.textContent).toBe('10');
    expect(count.getAttribute('data-position')).toBe('top-left');
  });

  it('renders the hand-sort box directly under the deck box, outside the arena', async () => {
    getGameView.mockResolvedValue(sortableView);

    const { container } = render(
      <GamePage gameId="game-1" playerId="p0" onSwitchPlayer={() => {}} />,
    );

    await waitFor(() => expect(screen.getByLabelText('Sort hand')).toBeTruthy());

    const right = container.querySelector('[data-zone="sidebar-right"]') as HTMLElement;
    const deckBox = right.querySelector('[data-zone="table-deck"]') as HTMLElement;
    const sortBox = right.querySelector('[data-zone="hand-sort-box"]') as HTMLElement;

    expect(sortBox).not.toBeNull();
    expect(sortBox.classList.contains('sidebar-box')).toBe(true);
    expect(sortBox.classList.contains('sidebar-sort-box')).toBe(true);
    // Immediately after the deck box, and never inside the felt arena.
    expect(deckBox.nextElementSibling).toBe(sortBox);
    expect(sortBox.querySelector('[data-testid="sort-bar"]')).not.toBeNull();
    expect(within(sortBox).getByRole('combobox', { name: 'Sort hand' })).toBeTruthy();
    expect(container.querySelector('[data-zone="table-arena"] [data-testid="sort-bar"]')).toBeNull();
    expect(
      container.querySelector('[data-zone="player-controls"] [data-testid="sort-bar"]'),
    ).toBeNull();

    const select = within(sortBox).getByRole('combobox') as HTMLSelectElement;
    expect(Array.from(select.options).map((option) => option.value)).toEqual([
      'suit',
      'pairs',
      'rank',
    ]);
    expect(Array.from(select.options).map((option) => option.textContent)).toEqual([
      'Suit',
      'Pairs',
      'Rank',
    ]);
    expect(select.value).toBe('suit');
  });

  it('reorders the active player\'s hand when the sidebar sort mode changes', async () => {
    getGameView.mockResolvedValue(sortableView);

    const { container } = render(
      <GamePage gameId="game-1" playerId="p0" onSwitchPlayer={() => {}} />,
    );

    await waitFor(() => expect(screen.getByLabelText('Sort hand')).toBeTruthy());

    const handOrder = (): string[] =>
      Array.from(
        (container.querySelector('[data-zone="player-hand"]') as HTMLElement).querySelectorAll(
          '.card-slot',
        ),
      ).map((slot) => `${slot.getAttribute('data-suit')}:${slot.getAttribute('data-rank')}`);

    expect(handOrder()).toEqual(['hearts:six', 'clubs:ace', 'spades:king']);

    fireEvent.change(screen.getByLabelText('Sort hand'), { target: { value: 'pairs' } });

    expect(handOrder()).toEqual(['hearts:six', 'spades:king', 'clubs:ace']);
    expect((screen.getByLabelText('Sort hand') as HTMLSelectElement).value).toBe('pairs');
  });

  it('centres opponent cards and shows a top-left counter instead of text', async () => {
    getGameView.mockResolvedValue({
      ...view,
      opponents: [
        { id: 'p1', name: 'Bob', cardCount: 6, hasPassed: false, finishRank: null },
        { id: 'p2', name: 'Carol', cardCount: 3, hasPassed: false, finishRank: null },
      ],
    });

    const { container } = render(
      <GamePage gameId="game-1" playerId="p0" onSwitchPlayer={() => {}} />,
    );

    await waitFor(() => expect(screen.getByTestId('opponent-card-count-p1')).toBeTruthy());

    const seats = Array.from(
      container.querySelectorAll('[data-testid="opponent"]'),
    ) as HTMLElement[];
    expect(seats).toHaveLength(2);

    const bobSeat = screen.getByTestId('seat-clock-p1').closest('.seat') as HTMLElement;
    const bobCount = screen.getByTestId('opponent-card-count-p1');
    expect(bobCount.textContent).toBe('6');
    expect(bobCount.getAttribute('data-position')).toBe('top-left');
    expect(bobSeat.querySelector('.opponent-hand .opponent-cards')).not.toBeNull();
    expect(bobSeat.querySelector('.opponent-count')).toBeNull();
    expect(bobSeat.textContent).not.toMatch(/6 cards/i);

    expect(screen.getByTestId('opponent-card-count-p2').textContent).toBe('3');
    expect(
      screen.getByTestId('seat-clock-p2').closest('.seat')!.textContent,
    ).not.toMatch(/cards/i);
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

  it('shows only contextual pass controls in the third column', async () => {
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
    // Feedback #9: the sort dropdown moved to its own right-sidebar box.
    expect(controls.querySelector('[data-testid="sort-bar"]')).toBeNull();
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

  it('keeps the dark-theme Back to lobby styling untouched', () => {
    const normalised = appCss.replace(/\s+/g, ' ');

    expect(normalised).toContain(
      '.game-page .back-to-lobby { padding: 8px 16px; font-size: 14px; }',
    );
    // No dark-theme background/border/text overrides were introduced.
    expect(normalised).not.toContain('[data-theme=\'dark\'] .game-page .back-to-lobby');
  });

  it('gives Back to lobby high-contrast slate styling in the light theme', () => {
    expect(backToLobbyLightCss).not.toBe('');
    expect(backToLobbyLightCss).toContain('background: #e2e8f0');
    expect(backToLobbyLightCss).toContain('border: 1px solid #64748b');
    expect(backToLobbyLightCss).toContain('color: #0f172a');
    expect(backToLobbyLightCss).toContain('font-weight: 600');
    // Hover stays distinct from the resting surface and border.
    expect(backToLobbyLightCss).toContain('background: #cbd5e1');
    expect(backToLobbyLightCss).toContain('border-color: #334155');
  });

  it('applies the same contrast for an OS light preference before the theme is set', () => {
    expect(appCss).toContain("html:not([data-theme]) .game-page .back-to-lobby");
  });

  it('renders the light-theme button with the same back-to-lobby hooks', async () => {
    getGameView.mockResolvedValue(view);
    document.documentElement.setAttribute('data-theme', 'light');

    try {
      render(<GamePage gameId="game-1" playerId="p0" onSwitchPlayer={() => {}} />);

      await waitFor(() => expect(screen.getByText('Pass')).toBeTruthy());
      const backToLobby = screen.getByRole('button', { name: 'Back to lobby' });

      expect(backToLobby.className).toContain('action-button');
      expect(backToLobby.className).toContain('back-to-lobby');
    } finally {
      document.documentElement.removeAttribute('data-theme');
    }
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

  it('renders the discard pile inside the DECK box, face-down with the last bout revealed', async () => {
    getGameView.mockResolvedValue({
      ...view,
      discardCount: 5,
      lastDiscardCards: [
        { suit: 'spades', rank: 'six' },
        { suit: 'hearts', rank: 'seven' },
      ],
    });

    const { container } = render(
      <GamePage gameId="game-1" playerId="p0" onSwitchPlayer={() => {}} />,
    );

    await waitFor(() => expect(screen.getByTestId('discard-pile')).toBeTruthy());

    const deckBox = container.querySelector('[data-zone="table-deck"]') as HTMLElement;
    expect(deckBox.contains(screen.getByTestId('discard-pile'))).toBe(true);
    expect(screen.getByTestId('discard-count').textContent).toBe('5');
    expect(screen.getByTestId('discard-count').getAttribute('data-position')).toBe('top-left');

    // The general pile is face-down; only the last discard is face-up.
    expect(screen.getByTestId('discard-face-down').querySelector('svg')).not.toBeNull();
    const revealed = screen.getByTestId('discard-last');
    expect(revealed.querySelectorAll('.card-slot')).toHaveLength(2);
    expect(revealed.textContent).not.toMatch(/\d+ cards?/i);
  });

  it('shows an empty discard pile before the first bout resolves', async () => {
    getGameView.mockResolvedValue(view);

    render(<GamePage gameId="game-1" playerId="p0" onSwitchPlayer={() => {}} />);

    await waitFor(() => expect(screen.getByTestId('discard-pile')).toBeTruthy());
    expect(screen.getByTestId('discard-empty').textContent).toBe('Empty');
    expect(screen.queryByTestId('discard-count')).toBeNull();
    expect(screen.queryByTestId('discard-last')).toBeNull();
  });

  it('shows the overall game clock separately from the turn clock', async () => {
    getGameView.mockResolvedValue({
      ...view,
      gameStartedAtMs: Date.now() - 65_000,
      gameEndedAtMs: null,
      turnDeadlineMs: 0,
    });

    render(<GamePage gameId="game-1" playerId="p0" onSwitchPlayer={() => {}} />);

    await waitFor(() => expect(screen.getByTestId('game-clock')).toBeTruthy());
    expect(screen.getByTestId('game-clock').textContent).toMatch(/^01:0[5-9]$/);
    expect(screen.getByTestId('game-clock').getAttribute('data-active')).toBe('true');
    // The 15-second turn clock is a separate panel: the viewer is the waited-on
    // defender, so it reads its rested value while the game clock counts up.
    expect(screen.getByTestId('turn-clock').textContent?.trim()).toBe('00:15');
    expect(screen.getByTestId('turn-clock').getAttribute('data-active')).toBe('true');
  });

  it('freezes the game clock at the recorded end time after game over', async () => {
    const startedAtMs = Date.now() - 300_000;
    getGameView.mockResolvedValue({
      ...view,
      myHand: [],
      tablePairs: [],
      boutPhase: 'GameOver',
      legalActions: [],
      finishOrder: ['p1', 'p0'],
      isDraw: false,
      gameStartedAtMs: startedAtMs,
      gameEndedAtMs: startedAtMs + 95_000,
    });

    render(<GamePage gameId="game-1" playerId="p0" onSwitchPlayer={() => {}} />);

    await waitFor(() => expect(screen.getByTestId('game-clock')).toBeTruthy());
    expect(screen.getByTestId('game-clock').textContent).toBe('01:35');
    expect(screen.getByTestId('game-clock').getAttribute('data-active')).toBe('false');
  });

  it('switches the point of view from the header POV menu', async () => {
    getGameView.mockResolvedValue({
      ...view,
      myName: 'Alice',
      opponents: [
        { id: 'p1', name: 'Bob', cardCount: 6, hasPassed: false, finishRank: null },
        { id: 'p2', name: 'Carol', cardCount: 4, hasPassed: false, finishRank: null },
      ],
    });
    const onSwitchPlayer = vi.fn();

    render(<GamePage gameId="game-1" playerId="p0" onSwitchPlayer={onSwitchPlayer} />);

    await waitFor(() => expect(screen.getByTestId('pov-menu')).toBeTruthy());
    const select = screen.getByTestId('pov-menu') as HTMLSelectElement;
    expect(select.value).toBe('p0');
    // Item 13: every seat, including the viewer's own, is labelled with its
    // real name instead of a "You" placeholder or a raw seat id.
    expect(Array.from(select.options).map((option) => option.textContent)).toEqual([
      'Alice',
      'Bob',
      'Carol',
    ]);
    expect(select.textContent).not.toContain('You');
    // The left-sidebar POV switcher uses the same real names.
    const tabs = screen.getAllByRole('tab');
    expect(tabs.map((tab) => tab.querySelector('.hotseat-name')?.textContent)).toEqual([
      'Alice',
      'Bob',
      'Carol',
    ]);
    expect(screen.getByRole('tablist').getAttribute('aria-label')).toBe('POV player switcher');
    // The header label and the left-sidebar heading both read POV.
    expect(screen.getAllByText('POV')).toHaveLength(2);

    fireEvent.change(select, { target: { value: 'p2' } });
    expect(onSwitchPlayer).toHaveBeenCalledWith('p2');
  });

  it('announces the result in a game-over banner and locks the table in review mode', async () => {
    getGameView.mockResolvedValue({
      ...view,
      myHand: [],
      tablePairs: [],
      boutPhase: 'GameOver',
      legalActions: [],
      finishOrder: ['p1', 'p0'],
      isDraw: false,
    });

    const { container } = render(
      <GamePage gameId="game-1" playerId="p0" onSwitchPlayer={() => {}} />,
    );

    await waitFor(() => expect(screen.getByTestId('game-over-banner')).toBeTruthy());
    const banner = screen.getByTestId('game-over-banner');
    expect(banner.textContent).toContain('Game over — Bob wins');
    expect(banner.textContent).toContain('Durak: you');
    // The banner sits above the three-column shell, never over the felt.
    expect(banner.nextElementSibling?.classList.contains('game-shell')).toBe(true);

    // Review mode: no commands, no drop surfaces, no turn glow, no drags.
    expect(container.querySelector('[data-zone="player-controls"]')).toBeNull();
    expect(screen.queryByText('Pass')).toBeNull();
    expect(screen.queryByText('Surrender')).toBeNull();
    expect(screen.queryByText('Throw In')).toBeNull();
    expect(container.querySelector('[data-drop-zone]')).toBeNull();
    expect(
      container.querySelector('[data-zone="table-arena"]')!.getAttribute('data-review-mode'),
    ).toBe('true');
    expect(screen.getByTestId('hand-turn-highlight').getAttribute('data-active')).toBe('false');
  });

  it('shows the countdown on the Pass button while the throw-in clock runs', async () => {
    getGameView.mockResolvedValue({
      ...view,
      tablePairs: [
        { attack: { suit: 'spades', rank: 'six' }, defense: { suit: 'spades', rank: 'seven' } },
      ],
      attackerIdx: 0,
      defenderIdx: 1,
      boutPhase: 'defense',
      legalActions: ['pass'],
      turnDeadlineMs: Date.now() + 12_000,
      turnSecondsRemaining: 12,
      turnPlayerId: 'p0',
    });

    render(<GamePage gameId="game-1" playerId="p0" onSwitchPlayer={() => {}} />);

    await waitFor(() => expect(screen.getByTestId('pass-countdown')).toBeTruthy());
    const countdown = screen.getByTestId('pass-countdown');
    expect(countdown.textContent).toMatch(/^(11|12)$/);
    expect(countdown.className).toBe('surrender-countdown');
    expect(countdown.closest('button')?.textContent).toContain('Pass');
  });

  it('puts a return-to-lobby button inside the game-over banner', async () => {
    getGameView.mockResolvedValue({
      ...view,
      myName: 'Alice',
      myHand: [],
      tablePairs: [],
      boutPhase: 'GameOver',
      legalActions: [],
      finishOrder: ['p1', 'p0'],
      isDraw: false,
    });
    const onLeaveGame = vi.fn();

    render(
      <GamePage
        gameId="game-1"
        playerId="p0"
        onSwitchPlayer={() => {}}
        onLeaveGame={onLeaveGame}
      />,
    );

    await waitFor(() => expect(screen.getByTestId('game-over-banner')).toBeTruthy());
    const banner = screen.getByTestId('game-over-banner');
    const button = screen.getByTestId('banner-lobby-button');

    expect(banner.contains(button)).toBe(true);
    expect(button.tagName).toBe('BUTTON');
    expect(button.textContent).toContain('Return to lobby');

    fireEvent.click(button);
    expect(onLeaveGame).toHaveBeenCalledTimes(1);

    // The header button shares the same handler.
    fireEvent.click(screen.getByRole('button', { name: 'Back to lobby' }));
    expect(onLeaveGame).toHaveBeenCalledTimes(2);
  });

  it('splits one clock panel into game and turn halves and idles the game clock before the first move', async () => {
    getGameView.mockResolvedValue({ ...view, gameStartedAtMs: null, gameEndedAtMs: null });

    render(<GamePage gameId="game-1" playerId="p0" onSwitchPlayer={() => {}} />);

    await waitFor(() => expect(screen.getByTestId('clock-panel')).toBeTruthy());
    const panel = screen.getByTestId('clock-panel');
    expect(panel.classList.contains('clock-split-panel')).toBe(true);
    expect(panel.getAttribute('aria-label')).toBe('Game and turn clocks');

    const gameHalf = panel.querySelector('.clock-half.game-clock-half') as HTMLElement;
    const turnHalf = panel.querySelector('.clock-half.turn-clock-half') as HTMLElement;
    expect(gameHalf).not.toBeNull();
    expect(turnHalf).not.toBeNull();
    expect(gameHalf.contains(screen.getByTestId('game-clock'))).toBe(true);
    expect(turnHalf.contains(screen.getByTestId('turn-clock'))).toBe(true);
    // The two halves are siblings inside the single panel, so CSS can divide
    // them with one horizontal divider.
    expect(gameHalf.nextElementSibling).toBe(turnHalf);
    expect(document.querySelectorAll('[data-testid="clock-panel"]')).toHaveLength(1);

    // Before the first move the overall clock is frozen at 00:00 and inactive.
    expect(screen.getByTestId('game-clock').textContent).toBe('00:00');
    expect(screen.getByTestId('game-clock').getAttribute('data-active')).toBe('false');
  });

  it('loads the replay after game over and steps through frames while freezing the game clock', async () => {
    const finishedView: PlayerGameView = {
      ...view,
      myHand: [],
      tablePairs: [],
      boutPhase: 'GameOver',
      legalActions: [],
      finishOrder: ['p1', 'p0'],
      isDraw: false,
      gameStartedAtMs: 1_000,
      gameEndedAtMs: 65_000,
    };
    const frameView = (
      myId: string,
      myHand: PlayerGameView['myHand'],
      tablePairs: PlayerGameView['tablePairs'],
      elapsedMs: number,
      finishOrder: string[] = ['p1', 'p0'],
    ): PlayerGameView => ({
      ...finishedView,
      myId,
      myName: myId === 'p0' ? 'Alice' : 'Bob',
      myHand,
      tablePairs,
      finishOrder,
      opponents: [
        myId === 'p0'
          ? { id: 'p1', name: 'Bob', cardCount: 2, hasPassed: false, finishRank: null }
          : { id: 'p0', name: 'Alice', cardCount: 1, hasPassed: false, finishRank: null },
      ],
      gameStartedAtMs: 0,
      gameEndedAtMs: elapsedMs,
    });
    const openingPairs = [{ attack: { suit: 'spades', rank: 'seven' }, defense: null }];
    const finalPairs = [
      { attack: { suit: 'spades', rank: 'king' }, defense: { suit: 'hearts', rank: 'ace' } },
    ];
    const frames = [
      {
        moveIndex: 1,
        playerId: 'p0',
        action: { type: 'initialAttack', playerId: 'p0' },
        elapsedMs: 0,
        views: {
          p0: frameView(
            'p0',
            [
              { suit: 'clubs', rank: 'two' },
              { suit: 'hearts', rank: 'three' },
            ],
            openingPairs,
            0,
            [],
          ),
          p1: frameView('p1', [], openingPairs, 0, []),
        },
      },
      {
        moveIndex: 2,
        playerId: 'p0',
        action: { type: 'initialAttack', playerId: 'p0' },
        elapsedMs: 65_000,
        views: {
          p0: frameView('p0', [{ suit: 'clubs', rank: 'two' }], finalPairs, 65_000),
          p1: frameView('p1', [], finalPairs, 65_000),
        },
      },
    ];

    getGameView.mockResolvedValue(finishedView);
    getGameReplay.mockResolvedValue({ gameId: 'game-1', moves: [], frames });

    const { container } = render(
      <GamePage gameId="game-1" playerId="p0" onSwitchPlayer={() => {}} />,
    );

    await waitFor(() => expect(getGameReplay).toHaveBeenCalledWith('game-1'));
    await waitFor(() => expect(screen.getByTestId('review-nav')).toBeTruthy());

    // The navigation controls sit at the bottom of the left sidebar, directly
    // under the How to Play panel.
    const left = container.querySelector('[data-zone="sidebar-left"]') as HTMLElement;
    const nav = within(left).getByTestId('review-nav');
    expect(nav.previousElementSibling?.textContent).toContain('How to Play');
    expect(within(nav).getByTestId('review-prev-button')).toBeTruthy();
    expect(within(nav).getByTestId('review-next-button')).toBeTruthy();

    const arena = container.querySelector('[data-zone="table-arena"]') as HTMLElement;
    const ranks = (): (string | null)[] =>
      Array.from(arena.querySelectorAll('.card-slot')).map((node) =>
        node.getAttribute('data-rank'),
      );

    // Review opens on the final move of the game.
    expect(screen.getByTestId('review-move-indicator').textContent).toBe('Move 2 / 2');
    expect(screen.getByTestId('game-clock').textContent).toBe('01:05');
    expect(screen.getByTestId('game-clock').getAttribute('data-active')).toBe('false');
    expect(ranks()).toContain('king');
    expect(ranks()).not.toContain('seven');
    expect((screen.getByTestId('review-next-button') as HTMLButtonElement).disabled).toBe(true);
    expect((screen.getByTestId('review-prev-button') as HTMLButtonElement).disabled).toBe(false);

    // The POV menu still lists real names while reviewing.
    const pov = screen.getByTestId('pov-menu') as HTMLSelectElement;
    expect(Array.from(pov.options).map((option) => option.textContent)).toEqual([
      'Alice',
      'Bob',
    ]);

    // Step one move back: the board, the counter and the clock all follow.
    fireEvent.click(screen.getByTestId('review-prev-button'));
    await waitFor(() =>
      expect(screen.getByTestId('review-move-indicator').textContent).toBe('Move 1 / 2'),
    );
    expect(screen.getByTestId('game-clock').textContent).toBe('00:00');
    expect(screen.getByTestId('game-clock').getAttribute('data-active')).toBe('false');
    expect(ranks()).toContain('seven');
    expect(ranks()).not.toContain('king');
    expect((screen.getByTestId('review-prev-button') as HTMLButtonElement).disabled).toBe(true);

    // The outcome banner and result summary stay bound to the finished match,
    // even though this intermediate frame's finishOrder is still empty.
    expect(screen.getByTestId('game-over-banner').textContent).toContain(
      'Game over — Bob wins',
    );
    expect(screen.getByTestId('game-over-banner').textContent).toContain('Durak: you');
    expect(screen.getByText('Bob wins')).toBeTruthy();
    expect(container.querySelectorAll('.finish-order li')).toHaveLength(2);

    // And forward again to the final position.
    fireEvent.click(screen.getByTestId('review-next-button'));
    await waitFor(() =>
      expect(screen.getByTestId('review-move-indicator').textContent).toBe('Move 2 / 2'),
    );
    expect(screen.getByTestId('game-clock').textContent).toBe('01:05');
    expect(ranks()).toContain('king');

    // Sorting stays available while stepping through the replay.
    expect(screen.getByLabelText('Sort hand')).toBeTruthy();
  });

  it('falls back to the live view in review mode when the replay request fails', async () => {
    getGameView.mockResolvedValue({
      ...view,
      myHand: [],
      tablePairs: [],
      boutPhase: 'GameOver',
      legalActions: [],
      finishOrder: ['p1', 'p0'],
      isDraw: false,
      gameStartedAtMs: 1_000,
      gameEndedAtMs: 35_000,
    });
    getGameReplay.mockRejectedValue(new Error('replay unavailable'));

    const { container } = render(
      <GamePage gameId="game-1" playerId="p0" onSwitchPlayer={() => {}} />,
    );

    await waitFor(() => expect(screen.getByTestId('review-nav')).toBeTruthy());
    // No frames loaded, so navigation is disabled and the recorded clock shows.
    expect(screen.getByTestId('review-move-indicator').textContent).toBe('Move 0 / 0');
    expect((screen.getByTestId('review-prev-button') as HTMLButtonElement).disabled).toBe(true);
    expect((screen.getByTestId('review-next-button') as HTMLButtonElement).disabled).toBe(true);
    expect(screen.getByTestId('game-clock').textContent).toBe('00:34');
    expect(container.querySelector('[data-zone="table-arena"]')).not.toBeNull();
  });
});
