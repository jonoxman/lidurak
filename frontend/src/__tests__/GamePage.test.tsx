import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/preact';
import type { PlayerGameView } from '../types';

vi.mock('../api/client', () => ({
  getGameView: vi.fn(),
  getGameReplay: vi.fn(),
  sendAction: vi.fn(),
  createGame: vi.fn(),
  createPresetGame: vi.fn(),
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
import {
  getSettings,
  resetSettings,
  setHighlightIntensity,
  setHighlightPreset,
  setSettings,
} from '../state/settings';
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

/** A frozen projection for replay-frame fixtures of a finished match. */
const finishedFrameView = (
  myId: string,
  overrides: Partial<PlayerGameView> = {},
): PlayerGameView => ({
  ...view,
  myId,
  myName: myId === 'p0' ? 'Alice' : 'Bob',
  myHand: [],
  tablePairs: [],
  boutPhase: 'GameOver',
  legalActions: [],
  finishOrder: ['p1', 'p0'],
  isDraw: false,
  opponents:
    myId === 'p0'
      ? [{ id: 'p1', name: 'Bob', cardCount: 0, hasPassed: false, finishRank: 1 }]
      : [{ id: 'p0', name: 'Alice', cardCount: 1, hasPassed: false, finishRank: 2 }],
  gameStartedAtMs: 0,
  gameEndedAtMs: 4000,
  ...overrides,
});

const getGameView = client.getGameView as unknown as ReturnType<typeof vi.fn>;
const getGameReplay = client.getGameReplay as unknown as ReturnType<typeof vi.fn>;
const sendAction = client.sendAction as unknown as ReturnType<typeof vi.fn>;
const createGameMock = client.createGame as unknown as ReturnType<typeof vi.fn>;
const createPresetGameMock = client.createPresetGame as unknown as ReturnType<typeof vi.fn>;

describe('GamePage', () => {
  beforeEach(() => {
    getGameView.mockReset();
    getGameReplay.mockReset();
    sendAction.mockReset();
    createGameMock.mockReset();
    createPresetGameMock.mockReset();
    wsState.onUpdate = null;
    wsState.presence = [];
    Object.values(audio).forEach((spy) => spy.mockClear());
  });

  it('loads the view and sends actions through REST when the socket is closed', async () => {
    getGameView.mockResolvedValue(view);
    sendAction.mockResolvedValue(view);

    render(<GamePage gameId="game-1" playerId="p0" onSwitchPlayer={() => {}} />);

    await waitFor(() => expect(screen.getByTestId('pass-button')).toBeTruthy());
    // ITEM-14b: the opening seat is always sent as the requester too.
    expect(getGameView).toHaveBeenCalledWith('game-1', 'p0', 'p0');

    fireEvent.click(screen.getByTestId('pass-button'));

    await waitFor(() =>
      expect(sendAction).toHaveBeenCalledWith('game-1', {
        type: 'passTurn',
        playerId: 'p0',
      }),
    );
  });

  it('T-90-feedback-2: wires 100x140 cards, the tight hand contour and a visible dragged card', async () => {
    getGameView.mockResolvedValue(sortableView);
    const { container } = render(
      <GamePage gameId="game-1" playerId="p0" onSwitchPlayer={() => {}} />,
    );

    await waitFor(() => expect(container.querySelector('.hand-cards')).not.toBeNull());

    const zone = container.querySelector('[data-zone="player-hand"]') as HTMLElement;
    const box = screen.getByTestId('hand-turn-highlight') as HTMLElement;
    const card = zone.querySelector('.card-slot') as HTMLElement;

    // ITEM-1b: the live card carries the 100x140 footprint inline.
    expect(card.getAttribute('data-card-width')).toBe('100');
    expect(card.getAttribute('data-card-height')).toBe('140');
    expect(card.style.width).toBe('var(--card-w, 100px)');
    expect(card.style.height).toBe('var(--card-h, 140px)');

    // ITEM-4: the live hand reports its clamped overlap geometry.
    expect(Number(box.getAttribute('data-overlap-ratio'))).toBeGreaterThanOrEqual(0.2);
    expect(Number(box.getAttribute('data-overlap-ratio'))).toBeLessThanOrEqual(0.8);
    expect(Number(box.getAttribute('data-hand-width'))).toBeGreaterThanOrEqual(100);

    // ITEM-2: the contour is anchored to the hand and shares its width.
    const contour = screen.getByTestId('hand-highlight-contour');
    expect(contour.getAttribute('data-non-rectangular')).toBe('false');
    expect(Number(contour.getAttribute('data-contour-width'))).toBe(
      Number(box.getAttribute('data-hand-width')),
    );

    // ITEM-3: neither the hand column nor the arena clips a dragged card.
    expect(cssRule(tableCss, "[data-zone='player-hand']")).toContain('overflow: visible');
    expect(cssRule(tableCss, "[data-zone='table-arena']")).toContain('overflow: visible');

    const svg = zone.querySelector('.card-slot svg') as unknown as SVGElement;
    const wrapper = svg.closest('.hand-card-wrapper') as HTMLElement;
    expect(container.querySelector('[data-zone="table-arena"]')?.getAttribute('data-review-mode')).toBe(
      'false',
    );
    expect(wrapper.getAttribute('data-draggable')).toBe('true');

    // Let Preact flush the GameTable effects that attach the document drag
    // listeners (the table mounts after the async view resolves).
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 150));
    });
    fireEvent.mouseDown(svg, { button: 0, clientX: 10, clientY: 20 });
    fireEvent.mouseMove(document, { clientX: 70, clientY: 50 });

    expect(wrapper.isConnected).toBe(true);
    expect(wrapper.getAttribute('data-dragging')).toBe('true');
    expect(wrapper.style.transform).toBe('translate3d(60px, 30px, 0)');
    expect(wrapper.style.opacity === '' || wrapper.style.opacity === '1').toBe(true);
    expect(wrapper.querySelector('.card-slot')).not.toBeNull();
    fireEvent.mouseUp(document, { clientX: 70, clientY: 50 });
  });

  it('renders the three-column shell zones', async () => {
    getGameView.mockResolvedValue(view);

    const { container } = render(
      <GamePage gameId="game-1" playerId="p0" onSwitchPlayer={() => {}} />,
    );

    await waitFor(() => expect(screen.getByTestId('pass-button')).toBeTruthy());

    const left = container.querySelector('[data-zone="sidebar-left"]');
    const arena = container.querySelector('[data-zone="table-arena"]');
    const right = container.querySelector('[data-zone="sidebar-right"]');
    expect(left).not.toBeNull();
    expect(arena).not.toBeNull();
    expect(right).not.toBeNull();

    // How to Play lives in the left sidebar, not above the table. ITEM-14a: the
    // PLAYERS panel is the very first block of that column.
    expect(within(left as HTMLElement).getByText('How to Play')).toBeTruthy();
    expect(within(left as HTMLElement).getByTestId('players-panel')).toBeTruthy();
    expect((left as HTMLElement).firstElementChild?.getAttribute('data-testid')).toBe(
      'players-panel',
    );
    expect(screen.getByTestId('turn-clock').textContent?.trim()).toBe('00:15');
    // The deck, trump and TRUMP badge sit in the right sidebar under the clock,
    // never on the felt.
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

  it('renders the HAND SORTING box directly below the table, outside the right column', async () => {
    getGameView.mockResolvedValue(sortableView);

    const { container } = render(
      <GamePage gameId="game-1" playerId="p0" onSwitchPlayer={() => {}} />,
    );

    await waitFor(() => expect(screen.getByLabelText('Sort hand')).toBeTruthy());

    const right = container.querySelector('[data-zone="sidebar-right"]') as HTMLElement;
    const arena = container.querySelector('[data-zone="table-arena"]') as HTMLElement;
    const sortBox = container.querySelector('[data-zone="hand-sort-box"]') as HTMLElement;

    // ITEM-ADD-7: the crowded right column no longer holds the sort control.
    expect(sortBox).not.toBeNull();
    expect(right.querySelector('[data-zone="hand-sort-box"]')).toBeNull();
    expect(right.querySelector('[data-testid="sort-bar"]')).toBeNull();
    expect(arena.querySelector('[data-testid="sort-bar"]')).toBeNull();
    expect(
      container.querySelector('[data-zone="player-controls"] [data-testid="sort-bar"]'),
    ).toBeNull();

    // It is the next block after the felt table inside the same centre column.
    expect(sortBox.previousElementSibling).toBe(arena);
    expect(sortBox.parentElement).toBe(arena.parentElement);
    expect(sortBox.parentElement?.classList.contains('table-column')).toBe(true);
    expect(sortBox.classList.contains('hand-sort-box')).toBe(true);
    expect(appCss).toMatch(/\.table-column\s*{[^}]*flex-direction:\s*column/);

    // Both the panel title and the widget label read HAND SORTING.
    expect(within(sortBox).getByRole('heading', { name: 'HAND SORTING' })).toBeTruthy();
    expect(sortBox.querySelector('.sort-label')?.textContent).toBe('HAND SORTING');
    expect(sortBox.querySelector('[data-testid="sort-bar"]')).not.toBeNull();

    const select = within(sortBox).getByRole('combobox') as HTMLSelectElement;
    expect(Array.from(select.options).map((option) => option.value)).toEqual([
      'suit',
      'pairs',
      'rank',
      'custom',
    ]);
    expect(Array.from(select.options).map((option) => option.textContent)).toEqual([
      'Suit',
      'Pairs',
      'Rank',
      'Custom',
    ]);
    // ITEM-5: new users open on Rank, not Suit.
    expect(select.value).toBe('rank');
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

  it('ITEM-14a/14b: switches the POV by clicking a PLAYERS row', async () => {
    getGameView.mockResolvedValue(view);
    const onSwitchPlayer = vi.fn();

    render(
      <GamePage gameId="game-1" playerId="p0" onSwitchPlayer={onSwitchPlayer} />,
    );

    await waitFor(() => expect(screen.getByTestId('players-panel')).toBeTruthy());
    // The standalone POV switchers (tabs or header menu) are gone.
    expect(document.querySelector('.hotseat-tabs, .pov-tab')).toBeNull();
    expect(screen.queryByTestId('pov-menu')).toBeNull();

    const bob = screen.getByTestId('player-row-p1');
    expect(bob.getAttribute('data-pov-clickable')).toBe('true');
    fireEvent.click(bob);
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

    await waitFor(() => expect(screen.getByTestId('surrender-button')).toBeTruthy());

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
    expect(screen.queryByTestId('pass-button')).toBeNull();

    const result = container.querySelector('[data-zone="sidebar-right"] .game-result');
    expect(result).not.toBeNull();
  });

  it('renders no instructional text clutter inside the table', async () => {
    getGameView.mockResolvedValue(view);

    const { container } = render(
      <GamePage gameId="game-1" playerId="p0" onSwitchPlayer={() => {}} />,
    );

    await waitFor(() => expect(screen.getByTestId('pass-button')).toBeTruthy());

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

    await waitFor(() => expect(screen.getByTestId('pass-button')).toBeTruthy());

    const controls = container.querySelector('[data-zone="player-controls"]') as HTMLElement;
    // Feedback #9: the sort dropdown moved to its own right-sidebar box.
    expect(controls.querySelector('[data-testid="sort-bar"]')).toBeNull();
    expect(within(controls).getByTestId('pass-button')).toBeTruthy();
    expect(screen.queryByText('Redirect')).toBeNull();
    expect(within(controls).queryByTestId('surrender-button')).toBeNull();

    // The hand stays calm because the viewer is not the one being waited on.
    expect(
      container.querySelector('[data-zone="player-hand"]')!.classList.contains('turn-pulse'),
    ).toBe(false);
  });

  it('pulses the uncovered attacks and the red defender hand while defending', async () => {
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

    await waitFor(() => expect(screen.getByTestId('surrender-button')).toBeTruthy());

    const controls = container.querySelector('[data-zone="player-controls"]') as HTMLElement;
    expect(within(controls).queryByTestId('pass-button')).toBeNull();
    expect(screen.queryByText('Redirect')).toBeNull();
    expect(container.querySelector('.table-pair.turn-pulse .card-slot')).not.toBeNull();
    expect(container.querySelector('[data-zone="player-hand"]')!.textContent).not.toMatch(
      /Your turn|Waiting for/i,
    );
    // T-90-2 ITEM-PREV-4: the defending seat still has to decide, so the hand
    // carries the crimson defender glow (distinct from the amber attacker one).
    const handZone = container.querySelector('[data-zone="player-hand"]')!;
    expect(handZone.getAttribute('data-highlighted')).toBe('true');
    expect(handZone.getAttribute('data-highlight-variant')).toBe('defender');
    expect(handZone.getAttribute('data-surrendering')).toBe('false');
    expect(
      screen.getByTestId('hand-turn-highlight').getAttribute('data-highlight-variant'),
    ).toBe('defender');
  });

  it('T-90-2 ITEM-PREV-4: keeps Bob’s red glow until he surrenders, then drops it', async () => {
    const bobDefense: PlayerGameView = {
      ...view,
      myId: 'p1',
      myName: 'Bob',
      myHand: [
        { suit: 'hearts', rank: 'six' },
        { suit: 'diamonds', rank: 'nine' },
      ],
      opponents: [
        { id: 'p0', name: 'Alice', cardCount: 6, hasPassed: false, finishRank: null },
        { id: 'p2', name: 'Carol', cardCount: 4, hasPassed: false, finishRank: null },
      ],
      tablePairs: [
        { attack: { suit: 'clubs', rank: 'six' }, defense: { suit: 'clubs', rank: 'nine' } },
        { attack: { suit: 'spades', rank: 'seven' }, defense: null },
      ],
      trumpSuit: 'clubs',
      attackerIdx: 0,
      defenderIdx: 1,
      boutPhase: 'Defense',
      legalActions: ['surrender'],
      defenderDefenseless: true,
    };
    getGameView.mockResolvedValue(bobDefense);

    const first = render(
      <GamePage gameId="game-1" playerId="p1" onSwitchPlayer={() => {}} />,
    );

    await waitFor(() => expect(screen.getByTestId('surrender-button')).toBeTruthy());
    const zone = first.container.querySelector('[data-zone="player-hand"]') as HTMLElement;
    const handBox = screen.getByTestId('hand-turn-highlight') as HTMLElement;
    for (const node of [zone, handBox]) {
      // The countdown is still running: no decision yet, so the red glow shows.
      expect(node.getAttribute('data-highlighted')).toBe('true');
      expect(node.getAttribute('data-highlight-variant')).toBe('defender');
      expect(node.getAttribute('data-surrendering')).toBe('false');
      expect(node.classList.contains('defender-turn')).toBe(true);
      expect(node.classList.contains('attacker-turn')).toBe(false);
      expect(node.classList.contains('throw-in-turn')).toBe(false);
    }
    // `turn-pulse` lives on the wrapper, the glow class on the tight card box.
    expect(zone.classList.contains('turn-pulse')).toBe(true);
    expect(zone.getAttribute('data-defenseless')).toBe('true');
    expect(first.container.querySelectorAll('.table-pair.turn-pulse')).toHaveLength(1);

    // Pressing Surrender removes the red glow immediately, before any new view.
    sendAction.mockResolvedValue({
      ...bobDefense,
      boutPhase: 'SurrenderThrowIn',
      legalActions: [],
      defenderDefenseless: false,
    });
    fireEvent.click(screen.getByTestId('surrender-button'));
    for (const node of [zone, handBox]) {
      expect(node.getAttribute('data-highlighted')).toBe('false');
      expect(node.getAttribute('data-highlight-variant')).toBe('none');
      expect(node.getAttribute('data-surrendering')).toBe('true');
      expect(node.classList.contains('defender-turn')).toBe(false);
    }
    expect(zone.classList.contains('turn-pulse')).toBe(false);
    expect(first.container.querySelectorAll('.table-pair.turn-pulse')).toHaveLength(0);
    first.unmount();

    // Bob has surrendered: his own seat is the defender of the throw-in round.
    getGameView.mockResolvedValue({
      ...bobDefense,
      boutPhase: 'SurrenderThrowIn',
      legalActions: [],
      defenderDefenseless: false,
    });
    const second = render(
      <GamePage gameId="game-1" playerId="p1" onSwitchPlayer={() => {}} />,
    );

    await waitFor(() =>
      expect(
        second.container.querySelector('[data-zone="player-hand"]'),
      ).not.toBeNull(),
    );
    const surrenderedZone = second.container.querySelector(
      '[data-zone="player-hand"]',
    ) as HTMLElement;
    expect(surrenderedZone.getAttribute('data-surrendering')).toBe('true');
    expect(surrenderedZone.getAttribute('data-highlighted')).toBe('false');
    expect(surrenderedZone.getAttribute('data-highlight-variant')).toBe('none');
    const surrenderedBox = screen.getByTestId('hand-turn-highlight') as HTMLElement;
    expect(surrenderedBox.getAttribute('data-highlighted')).toBe('false');
    expect(surrenderedBox.getAttribute('data-highlight-variant')).toBe('none');
    expect(surrenderedBox.classList.contains('defender-turn')).toBe(false);
    expect(second.container.querySelectorAll('.table-pair.turn-pulse')).toHaveLength(0);
    second.unmount();
  });

  it('T-90 ITEM-PREV-4: still highlights Alice when she may throw in after the surrender', async () => {
    getGameView.mockResolvedValue({
      ...view,
      myId: 'p0',
      myName: 'Alice',
      myHand: [{ suit: 'hearts', rank: 'seven' }],
      opponents: [
        { id: 'p1', name: 'Bob', cardCount: 7, hasPassed: false, finishRank: null },
        { id: 'p2', name: 'Carol', cardCount: 4, hasPassed: true, finishRank: null },
      ],
      tablePairs: [
        { attack: { suit: 'clubs', rank: 'six' }, defense: { suit: 'clubs', rank: 'nine' } },
        { attack: { suit: 'spades', rank: 'seven' }, defense: null },
      ],
      trumpSuit: 'clubs',
      attackerIdx: 0,
      defenderIdx: 1,
      boutPhase: 'SurrenderThrowIn',
      legalActions: ['throwIn', 'pass'],
      defenderDefenseless: false,
      // T-90: the backend projection now owns the throw-in gate (and glow).
      canThrowIn: true,
    });

    const { container } = render(
      <GamePage gameId="game-1" playerId="p0" onSwitchPlayer={() => {}} />,
    );

    await waitFor(() =>
      expect(
        screen.getByTestId('hand-turn-highlight').getAttribute('data-highlighted'),
      ).toBe('true'),
    );
    const zone = container.querySelector('[data-zone="player-hand"]') as HTMLElement;
    expect(zone.getAttribute('data-surrendering')).toBe('false');
    expect(screen.getByTestId('hand-turn-highlight').classList.contains('throw-in-turn')).toBe(
      true,
    );
  });

  it('marks the connection live once the socket delivers a view', async () => {
    getGameView.mockResolvedValue(view);

    render(<GamePage gameId="game-1" playerId="p0" onSwitchPlayer={() => {}} />);

    await waitFor(() => expect(screen.getByText('Connecting…')).toBeTruthy());
    await waitFor(() => expect(wsState.onUpdate).not.toBeNull());

    wsState.onUpdate?.({ ...view, legalActions: ['surrender'] });

    await waitFor(() => expect(screen.getByText('Connected')).toBeTruthy());
    expect(screen.getByTestId('surrender-button')).toBeTruthy();
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

    await waitFor(() => expect(screen.getByTestId('pass-button')).toBeTruthy());
    fireEvent.click(screen.getByTestId('pass-button'));

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
    await waitFor(() => expect(screen.getByTestId('pass-button')).toBeTruthy());

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

    await waitFor(() => expect(screen.getByTestId('pass-button')).toBeTruthy());
    fireEvent.click(screen.getByTestId('pass-button'));

    await waitFor(() => expect(screen.getByTestId('surrender-button')).toBeTruthy());
    expect(screen.queryByTestId('pass-button')).toBeNull();
  });

  it('renders Back to lobby as a styled action button', async () => {
    getGameView.mockResolvedValue(view);

    render(<GamePage gameId="game-1" playerId="p0" onSwitchPlayer={() => {}} />);

    await waitFor(() => expect(screen.getByTestId('pass-button')).toBeTruthy());
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

      await waitFor(() => expect(screen.getByTestId('pass-button')).toBeTruthy());
      const backToLobby = screen.getByRole('button', { name: 'Back to lobby' });

      expect(backToLobby.className).toContain('action-button');
      expect(backToLobby.className).toContain('back-to-lobby');
    } finally {
      document.documentElement.removeAttribute('data-theme');
    }
  });

  it('keeps the players list in fixed seat order', async () => {
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

    await waitFor(() => expect(screen.getByTestId('players-list')).toBeTruthy());

    const badges = Array.from(
      container.querySelectorAll('.status-badge'),
    ) as HTMLElement[];
    // The active player (the viewed seat p0) stays in its seat slot instead of
    // jumping to the top of the list.
    expect(badges[0].classList.contains('mine')).toBe(true);
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

    await waitFor(() => expect(screen.getByTestId('surrender-button')).toBeTruthy());

    const lifted = Array.from(
      container.querySelectorAll('.card-slot.legal-playable'),
    ) as HTMLElement[];
    expect(lifted).toHaveLength(1);
    expect(lifted[0].getAttribute('data-rank')).toBe('ace');
  });

  it('renders a clickable Surrender button with a 3-second countdown and no instant dispatch', async () => {
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
    getGameReplay.mockResolvedValue({ gameId: 'game-1', moves: [], frames: [] });

    render(<GamePage gameId="game-1" playerId="p0" onSwitchPlayer={() => {}} />);

    // T-90 ITEM-PREV-4a: the Surrender button is on screen, enabled and
    // clickable as soon as the defenseless defense loads.
    await waitFor(() => expect(screen.getByTestId('surrender-button')).toBeTruthy());
    expect(screen.getByTestId('surrender-button')).toBeTruthy();
    expect(screen.getByTestId('surrender-button').hasAttribute('disabled')).toBe(false);
    await waitFor(() =>
      expect(screen.getByTestId('surrender-countdown').getAttribute('data-countdown')).toBe('3'),
    );
    // ...and nothing is dispatched during the grace window.
    await new Promise((resolve) => setTimeout(resolve, 350));
    expect(sendAction).not.toHaveBeenCalled();
  });

  it('sends exactly one surrender when the defender clicks the button', async () => {
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
    getGameReplay.mockResolvedValue({ gameId: 'game-1', moves: [], frames: [] });
    sendAction.mockResolvedValue({
      ...hopelessView,
      boutPhase: 'surrenderThrowIn',
      legalActions: [],
    });

    render(<GamePage gameId="game-1" playerId="p0" onSwitchPlayer={() => {}} />);

    await waitFor(() => expect(screen.getByTestId('surrender-button')).toBeTruthy());
    fireEvent.click(screen.getByTestId('surrender-button'));

    await waitFor(() => expect(sendAction).toHaveBeenCalledTimes(1));
    // No cloud of duplicate surrenders arrives after the click.
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

  it('renders every discarded card in one overlapping row without a counter', async () => {
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
    const pile = screen.getByTestId('discard-pile');
    expect(deckBox.contains(pile)).toBe(true);

    // Feedback #7a: the number-of-discards counter is gone.
    expect(screen.queryByTestId('discard-count')).toBeNull();
    expect(pile.querySelector('.deck-count-badge')).toBeNull();

    // Feedback #7b / T-90-3 ITEM-PB-7: the earlier discards are ONE stationary
    // face-down stack (no per-card offset); only the visible face-up cards of
    // the last bout use the responsive overlap row.
    const stack = screen.getByTestId('discard-facedown-stack');
    const row = screen.getByTestId('discard-visible-row');
    const faceDownSlots = Array.from(stack.querySelectorAll('.discard-slot')) as HTMLElement[];
    const visibleSlots = Array.from(row.querySelectorAll('.discard-slot')) as HTMLElement[];
    expect(faceDownSlots).toHaveLength(3);
    expect(visibleSlots).toHaveLength(2);
    for (const slot of faceDownSlots) expect(slot.style.marginLeft).toBe('');
    expect(visibleSlots[0].style.marginLeft).toBe('0px');
    for (const slot of visibleSlots.slice(1)) {
      expect(parseFloat(slot.style.marginLeft)).toBeLessThan(0);
    }

    // The earlier discards are face-down; only the last bout is face-up.
    expect(pile.querySelectorAll('.discard-slot[data-face="down"]')).toHaveLength(3);
    expect(pile.querySelectorAll('.discard-slot[data-face="up"] .card-slot')).toHaveLength(2);
  });

  it('shows an empty discard pile before the first bout resolves', async () => {
    getGameView.mockResolvedValue(view);

    render(<GamePage gameId="game-1" playerId="p0" onSwitchPlayer={() => {}} />);

    await waitFor(() => expect(screen.getByTestId('discard-pile')).toBeTruthy());
    expect(screen.getByTestId('discard-empty').textContent).toBe('Empty');
    expect(screen.queryByTestId('discard-stack')).toBeNull();
    expect(screen.queryByTestId('discard-count')).toBeNull();
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

  it('ITEM-14a: switches the point of view from the PLAYERS list', async () => {
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

    await waitFor(() => expect(screen.getByTestId('players-panel')).toBeTruthy());
    // Item 13: every seat is labelled with its real name, and only the active
    // user carries the trailing " (You)" suffix.
    const rows = screen.getAllByTestId(/^player-row-/);
    expect(
      rows.map((row) => row.querySelector('.status-name')?.textContent?.trim()),
    ).toEqual(['Alice (You)', 'Bob', 'Carol']);
    // There is no separate POV element in the header or the left column.
    expect(screen.queryByTestId('pov-menu')).toBeNull();
    expect(document.querySelector('.hotseat-tabs, .pov-tab')).toBeNull();

    fireEvent.click(screen.getByTestId('player-row-p2'));
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
    expect(screen.queryByTestId('pass-button')).toBeNull();
    expect(screen.queryByTestId('surrender-button')).toBeNull();
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
      // A legal throw-in keeps the client 1-second auto-pass disarmed, so the
      // badge shows the server's own throw-in clock instead of `1`.
      legalActions: ['pass', 'throwIn'],
      turnDeadlineMs: Date.now() + 12_000,
      turnSecondsRemaining: 12,
      turnPlayerId: 'p0',
    });

    render(<GamePage gameId="game-1" playerId="p0" onSwitchPlayer={() => {}} />);

    await waitFor(() => expect(screen.getByTestId('pass-countdown')).toBeTruthy());
    const countdown = screen.getByTestId('pass-countdown');
    expect(countdown.getAttribute('data-countdown')).toMatch(/^(11|12)$/);
    expect(countdown.className).toBe('surrender-countdown');
    // ITEM-7: the button is icon-only, so the action is carried by its label
    // and the painted number never leaks into textContent.
    expect(countdown.closest('button')?.textContent).toBe('');
    expect(countdown.closest('button')?.getAttribute('aria-label')).toBe('Pass — done throwing in');
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

    // The PLAYERS list keeps the real names while reviewing, with the active
    // user's " (You)" suffix.
    const rows = screen.getAllByTestId(/^player-row-/);
    expect(
      rows.map((row) => row.querySelector('.status-name')?.textContent?.trim()),
    ).toEqual(['Alice (You)', 'Bob']);

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

  it('pops the game-over banner up from a live update and keeps it in review mode', async () => {
    getGameView.mockResolvedValue(view);
    // The live room is still reachable; the recorded match is empty here so the
    // test starts on the in-progress table.
    getGameReplay.mockResolvedValue({ gameId: 'game-1', moves: [], frames: [] });

    render(<GamePage gameId="game-1" playerId="p0" onSwitchPlayer={() => {}} />);

    await waitFor(() => expect(screen.getByTestId('pass-button')).toBeTruthy());
    expect(screen.queryByTestId('game-over-banner')).toBeNull();

    // ITEM-9: the moment the authoritative view finishes, the banner appears.
    act(() => {
      wsState.onUpdate?.({
        ...view,
        myHand: [],
        tablePairs: [],
        boutPhase: 'GameOver',
        legalActions: [],
        finishOrder: ['p1', 'p0'],
        isDraw: false,
      });
    });

    await waitFor(() => expect(screen.getByTestId('game-over-banner')).toBeTruthy());
    expect(screen.getByTestId('game-over-banner').textContent).toContain('Game over — Bob wins');
    // And it stays on screen once review mode opens.
    await waitFor(() => expect(screen.getByTestId('review-nav')).toBeTruthy());
    expect(screen.getByTestId('game-over-banner')).toBeTruthy();
    expect(screen.getByTestId('game-over-banner').textContent).toContain('Durak: you');
    expect((screen.getByTestId('review-next-button') as HTMLButtonElement).disabled).toBe(true);
  });

  it('loads a finished game from its replay when the live view cannot be fetched', async () => {
    getGameView.mockRejectedValue(new Error('game room is gone'));
    getGameReplay.mockResolvedValue({
      gameId: 'game-1',
      moves: [],
      frames: [
        {
          moveIndex: 1,
          playerId: 'p0',
          action: { type: 'initialAttack', playerId: 'p0' },
          elapsedMs: 0,
          views: {
            p0: finishedFrameView('p0', {
              boutPhase: 'defense',
              myHand: [{ suit: 'hearts', rank: 'six' }],
              tablePairs: [{ attack: { suit: 'spades', rank: 'seven' }, defense: null }],
            }),
            p1: finishedFrameView('p1', { boutPhase: 'defense' }),
          },
        },
        {
          moveIndex: 2,
          playerId: 'p0',
          action: { type: 'passTurn', playerId: 'p0' },
          elapsedMs: 4000,
          views: { p0: finishedFrameView('p0'), p1: finishedFrameView('p1') },
        },
      ],
    });

    const { container } = render(
      <GamePage gameId="game-1" playerId="p0" onSwitchPlayer={() => {}} />,
    );

    // ITEM-12: the replay hydrates the finished match, so the page never hangs
    // on the loading line for a game whose live room is gone.
    await waitFor(() => expect(screen.queryByText(/Loading game/)).toBeNull());
    expect(container.querySelector('[data-zone="table-arena"]')).not.toBeNull();
    expect(screen.getByTestId('game-over-banner').textContent).toContain('Game over — Bob wins');
    expect(screen.getByTestId('review-nav')).toBeTruthy();
    expect(screen.getByTestId('review-move-indicator').textContent).toBe('Move 2 / 2');
    expect((screen.getByTestId('review-next-button') as HTMLButtonElement).disabled).toBe(true);
  });

  it('appends (You) to the active user in the PLAYERS list', async () => {
    getGameView.mockResolvedValue({
      ...view,
      myName: 'Alice',
      opponents: [
        { id: 'p1', name: 'Bob', cardCount: 6, hasPassed: false, finishRank: null },
        { id: 'p2', name: 'Carol', cardCount: 4, hasPassed: false, finishRank: null },
      ],
    });

    const { rerender } = render(
      <GamePage gameId="game-1" playerId="p0" onSwitchPlayer={() => {}} />,
    );

    await waitFor(() => expect(screen.getByTestId('players-list')).toBeTruthy());

    const listNames = (): (string | undefined)[] =>
      Array.from(
        document.querySelectorAll('[data-testid="players-list"] .status-name'),
      ).map((node) => node.textContent?.trim());

    // ITEM-13: only the active user (p0) gets the suffix.
    expect(listNames()).toEqual(['Alice (You)', 'Bob', 'Carol']);

    // Switching POV moves the suffix onto the newly active seat.
    rerender(<GamePage gameId="game-1" playerId="p1" onSwitchPlayer={() => {}} />);
    await waitFor(() => expect(screen.getByTestId('players-list')).toBeTruthy());

    expect(listNames()).toEqual(['Alice', 'Bob (You)', 'Carol']);
  });

  it('steps through replay frames with ArrowLeft and ArrowRight, clamped at the ends', async () => {
    const frames = [
      {
        moveIndex: 1,
        playerId: 'p0',
        action: { type: 'initialAttack', playerId: 'p0' },
        elapsedMs: 0,
        views: {
          p0: finishedFrameView('p0', {
            boutPhase: 'defense',
            tablePairs: [{ attack: { suit: 'spades', rank: 'seven' }, defense: null }],
          }),
          p1: finishedFrameView('p1', { boutPhase: 'defense' }),
        },
      },
      {
        moveIndex: 2,
        playerId: 'p1',
        action: { type: 'coverCard', playerId: 'p1' },
        elapsedMs: 2000,
        views: {
          p0: finishedFrameView('p0', {
            boutPhase: 'defense',
            tablePairs: [
              {
                attack: { suit: 'spades', rank: 'seven' },
                defense: { suit: 'hearts', rank: 'eight' },
              },
            ],
          }),
          p1: finishedFrameView('p1', { boutPhase: 'defense' }),
        },
      },
      {
        moveIndex: 3,
        playerId: 'p0',
        action: { type: 'passTurn', playerId: 'p0' },
        elapsedMs: 4000,
        views: { p0: finishedFrameView('p0'), p1: finishedFrameView('p1') },
      },
    ];

    getGameView.mockResolvedValue(
      finishedFrameView('p0', { gameStartedAtMs: 1000, gameEndedAtMs: 5000 }),
    );
    getGameReplay.mockResolvedValue({ gameId: 'game-1', moves: [], frames });

    render(<GamePage gameId="game-1" playerId="p0" onSwitchPlayer={() => {}} />);

    const indicator = () => screen.getByTestId('review-move-indicator').textContent;

    await waitFor(() => expect(indicator()).toBe('Move 3 / 3'));
    // Flush the passive effect that registers the window listener before
    // dispatching keys (Preact flushes effects on the next frame/timer).
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 80));
    });

    // ITEM-FOLLOWUP-1: ArrowLeft steps back, and the game-over banner stays.
    fireEvent.keyDown(document.body, { key: 'ArrowLeft' });
    await waitFor(() => expect(indicator()).toBe('Move 2 / 3'));
    expect(screen.getByTestId('game-over-banner')).toBeTruthy();

    // Clamps at the first frame instead of running past it.
    fireEvent.keyDown(document.body, { key: 'ArrowLeft' });
    fireEvent.keyDown(document.body, { key: 'ArrowLeft' });
    await waitFor(() => expect(indicator()).toBe('Move 1 / 3'));
    expect(screen.getByTestId('game-over-banner').textContent).toContain('Durak: you');

    // ArrowRight steps forward and clamps at the last frame.
    fireEvent.keyDown(document.body, { key: 'ArrowRight' });
    await waitFor(() => expect(indicator()).toBe('Move 2 / 3'));
    fireEvent.keyDown(document.body, { key: 'ArrowRight' });
    fireEvent.keyDown(document.body, { key: 'ArrowRight' });
    await waitFor(() => expect(indicator()).toBe('Move 3 / 3'));
    expect(screen.getByTestId('game-over-banner').textContent).toContain(
      'Game over — Bob wins',
    );

    // Modified keys and text fields never hijack the arrow keys.
    fireEvent.keyDown(document.body, { key: 'ArrowLeft', ctrlKey: true });
    fireEvent.keyDown(document.body, { key: 'ArrowLeft', altKey: true });
    fireEvent.keyDown(document.body, { key: 'ArrowLeft', metaKey: true });
    fireEvent.keyDown(screen.getByLabelText('Sort hand'), { key: 'ArrowLeft' });
    expect(indicator()).toBe('Move 3 / 3');

    // The buttons and the arrows share the same clamped index.
    fireEvent.click(screen.getByTestId('review-prev-button'));
    await waitFor(() => expect(indicator()).toBe('Move 2 / 3'));
    expect(screen.getByTestId('game-over-banner')).toBeTruthy();
  });

  it('starts a rematch with the same seats, names, rules and bots', async () => {
    getGameView.mockResolvedValue({
      ...finishedFrameView('p0'),
      playerTypes: ['human', 'basicBot'],
      allowRedirect: false,
      chaosMode: false,
      transparentMode: true,
      devMode: false,
      durak: 'p0',
    });
    getGameReplay.mockResolvedValue({ gameId: 'game-1', moves: [], frames: [] });
    createGameMock.mockResolvedValue({ gameId: 'game-2', players: ['p0', 'p1'] });
    const onNavigateGame = vi.fn();

    render(
      <GamePage
        gameId="game-1"
        playerId="p0"
        onSwitchPlayer={() => {}}
        onNavigateGame={onNavigateGame}
      />,
    );

    const rematchButton = await screen.findByTestId('banner-rematch-button');
    expect(rematchButton.textContent).toBe('Rematch');
    expect(rematchButton.closest('[data-testid="game-over-banner"]')).not.toBeNull();

    fireEvent.click(rematchButton);

    await waitFor(() =>
      expect(createGameMock).toHaveBeenCalledWith(
        2,
        ['Alice', 'Bob'],
        false,
        false,
        ['human', 'basicBot'],
        true,
        false,
      ),
    );
    // The new match opens on the same seat the viewer was inspecting.
    await waitFor(() => expect(onNavigateGame).toHaveBeenCalledWith('game-2', 'p0'));
    // The finished match and its review state are dropped for the new table.
    expect(screen.queryByTestId('review-nav')).toBeNull();
  });

  it('keeps the review frame when the POV menu switches players', async () => {
    const frames = [
      {
        moveIndex: 1,
        playerId: 'p0',
        action: { type: 'initialAttack', playerId: 'p0' },
        elapsedMs: 0,
        views: {
          p0: finishedFrameView('p0', {
            boutPhase: 'defense',
            myHand: [{ suit: 'hearts', rank: 'six' }],
            tablePairs: [{ attack: { suit: 'spades', rank: 'seven' }, defense: null }],
          }),
          p1: finishedFrameView('p1', { boutPhase: 'defense' }),
        },
      },
      {
        moveIndex: 2,
        playerId: 'p1',
        action: { type: 'coverCard', playerId: 'p1' },
        elapsedMs: 2000,
        views: {
          p0: finishedFrameView('p0', {
            boutPhase: 'defense',
            tablePairs: [
              {
                attack: { suit: 'spades', rank: 'seven' },
                defense: { suit: 'hearts', rank: 'eight' },
              },
            ],
          }),
          p1: finishedFrameView('p1', { boutPhase: 'defense' }),
        },
      },
      {
        moveIndex: 3,
        playerId: 'p0',
        action: { type: 'passTurn', playerId: 'p0' },
        elapsedMs: 4000,
        views: { p0: finishedFrameView('p0'), p1: finishedFrameView('p1') },
      },
    ];
    getGameView.mockImplementation(async (_gameId: string, viewer: string) =>
      finishedFrameView(viewer === 'p1' ? 'p1' : 'p0', {
        gameStartedAtMs: 1000,
        gameEndedAtMs: 5000,
      }),
    );
    getGameReplay.mockResolvedValue({ gameId: 'game-1', moves: [], frames });

    const { rerender } = render(
      <GamePage gameId="game-1" playerId="p0" onSwitchPlayer={() => {}} />,
    );

    const indicator = () => screen.getByTestId('review-move-indicator').textContent;
    await waitFor(() => expect(indicator()).toBe('Move 3 / 3'));

    fireEvent.click(screen.getByTestId('review-prev-button'));
    await waitFor(() => expect(indicator()).toBe('Move 2 / 3'));
    fireEvent.click(screen.getByTestId('review-prev-button'));
    await waitFor(() => expect(indicator()).toBe('Move 1 / 3'));
    const replayCalls = getGameReplay.mock.calls.length;

    // ITEM-PB-12a: switching POV must not jump back to the final move.
    rerender(<GamePage gameId="game-1" playerId="p1" onSwitchPlayer={() => {}} />);
    // ITEM-14b: the fetch carries the original seat as the authorised requester.
    await waitFor(() => expect(getGameView).toHaveBeenCalledWith('game-1', 'p1', 'p0'));
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 60));
    });

    expect(indicator()).toBe('Move 1 / 3');
    expect(getGameReplay.mock.calls.length).toBe(replayCalls);
    expect(screen.getByTestId('game-over-banner')).toBeTruthy();
  });

  it('replays each move sound while stepping through the review', async () => {
    const frames = [
      {
        moveIndex: 1,
        playerId: 'p0',
        action: { type: 'initialAttack', playerId: 'p0' },
        elapsedMs: 0,
        views: {
          p0: finishedFrameView('p0', {
            boutPhase: 'defense',
            talonCount: 10,
            tablePairs: [{ attack: { suit: 'spades', rank: 'seven' }, defense: null }],
          }),
          p1: finishedFrameView('p1', { boutPhase: 'defense' }),
        },
      },
      {
        moveIndex: 2,
        playerId: 'p1',
        action: { type: 'coverCard', playerId: 'p1' },
        elapsedMs: 1000,
        views: {
          p0: finishedFrameView('p0', {
            boutPhase: 'defense',
            talonCount: 10,
            tablePairs: [
              {
                attack: { suit: 'spades', rank: 'seven' },
                defense: { suit: 'hearts', rank: 'eight' },
              },
            ],
          }),
          p1: finishedFrameView('p1', { boutPhase: 'defense' }),
        },
      },
      {
        moveIndex: 3,
        playerId: 'p0',
        action: { type: 'passTurn', playerId: 'p0' },
        elapsedMs: 2000,
        views: {
          p0: finishedFrameView('p0', {
            boutPhase: 'defense',
            talonCount: 6,
            discardCount: 2,
            tablePairs: [],
          }),
          p1: finishedFrameView('p1', { boutPhase: 'defense' }),
        },
      },
      {
        moveIndex: 4,
        playerId: 'p1',
        action: { type: 'passTurn', playerId: 'p1' },
        elapsedMs: 3000,
        views: { p0: finishedFrameView('p0'), p1: finishedFrameView('p1') },
      },
    ];
    getGameView.mockResolvedValue(finishedFrameView('p0'));
    getGameReplay.mockResolvedValue({ gameId: 'game-1', moves: [], frames });

    render(<GamePage gameId="game-1" playerId="p0" onSwitchPlayer={() => {}} />);

    const indicator = () => screen.getByTestId('review-move-indicator').textContent;
    await waitFor(() => expect(indicator()).toBe('Move 4 / 4'));

    // Bout resolution that draws from the talon, then a cover, then the opener.
    fireEvent.click(screen.getByTestId('review-prev-button'));
    await waitFor(() => expect(indicator()).toBe('Move 3 / 4'));
    expect(audio.playTalonDraw).toHaveBeenLastCalledWith(4);

    fireEvent.click(screen.getByTestId('review-prev-button'));
    await waitFor(() => expect(indicator()).toBe('Move 2 / 4'));
    expect(audio.playDefendCard).toHaveBeenCalledTimes(1);

    fireEvent.click(screen.getByTestId('review-prev-button'));
    await waitFor(() => expect(indicator()).toBe('Move 1 / 4'));
    expect(audio.playAttackCard).toHaveBeenLastCalledWith(1);

    // Stepping forward replays the same sounds, ending on the game-over chime.
    fireEvent.click(screen.getByTestId('review-next-button'));
    await waitFor(() => expect(indicator()).toBe('Move 2 / 4'));
    expect(audio.playDefendCard).toHaveBeenCalledTimes(2);

    fireEvent.click(screen.getByTestId('review-next-button'));
    await waitFor(() => expect(audio.playTalonDraw).toHaveBeenCalledTimes(2));

    fireEvent.click(screen.getByTestId('review-next-button'));
    await waitFor(() => expect(indicator()).toBe('Move 4 / 4'));
    expect(audio.playGameOver).toHaveBeenCalledTimes(1);
  });

  it('never renders a non-move as its own replay step', async () => {
    const tablePairs = [{ attack: { suit: 'spades', rank: 'seven' }, defense: null }];
    const frames = [
      {
        moveIndex: 1,
        playerId: 'p0',
        action: { type: 'initialAttack', playerId: 'p0' },
        elapsedMs: 0,
        views: {
          p0: finishedFrameView('p0', { boutPhase: 'defense', talonCount: 10, tablePairs }),
          p1: finishedFrameView('p1', { boutPhase: 'defense' }),
        },
      },
      // A pass that changed nothing: no table, discard, talon or phase diff.
      {
        moveIndex: 2,
        playerId: 'p1',
        action: { type: 'passTurn', playerId: 'p1' },
        elapsedMs: 1000,
        views: {
          p0: finishedFrameView('p0', { boutPhase: 'defense', talonCount: 10, tablePairs }),
          p1: finishedFrameView('p1', { boutPhase: 'defense' }),
        },
      },
      {
        moveIndex: 3,
        playerId: 'p0',
        action: { type: 'passTurn', playerId: 'p0' },
        elapsedMs: 2000,
        views: { p0: finishedFrameView('p0'), p1: finishedFrameView('p1') },
      },
    ];
    getGameView.mockResolvedValue(finishedFrameView('p0'));
    getGameReplay.mockResolvedValue({ gameId: 'game-1', moves: [], frames });

    render(<GamePage gameId="game-1" playerId="p0" onSwitchPlayer={() => {}} />);

    const indicator = () => screen.getByTestId('review-move-indicator').textContent;
    // Three recorded frames, two visible steps.
    await waitFor(() => expect(indicator()).toBe('Move 2 / 2'));
    fireEvent.click(screen.getByTestId('review-prev-button'));
    await waitFor(() => expect(indicator()).toBe('Move 1 / 2'));
    expect((screen.getByTestId('review-prev-button') as HTMLButtonElement).disabled).toBe(true);
  });

  it('glows the attacking and defending rows softly and never outlines the names', async () => {
    getGameView.mockResolvedValue({
      ...view,
      opponents: [
        { id: 'p1', name: 'Bob', cardCount: 6, hasPassed: false, finishRank: null },
        { id: 'p2', name: 'Carol', cardCount: 4, hasPassed: false, finishRank: null },
      ],
      attackerIdx: 1,
      defenderIdx: 2,
      boutPhase: 'defense',
      legalActions: ['pass'],
    });

    const { container } = render(
      <GamePage gameId="game-1" playerId="p0" onSwitchPlayer={() => {}} />,
    );

    await waitFor(() => expect(screen.getByTestId('players-list')).toBeTruthy());

    const rows = Array.from(
      container.querySelectorAll('[data-testid="players-list"] .status-badge'),
    ) as HTMLElement[];
    expect(rows.map((row) => row.getAttribute('data-role'))).toEqual([
      'none',
      'attacker',
      'defender',
    ]);
    // ITEM-ADD-2a: the name inside the box is never given role styling, and no
    // rule outlines it by role any more.
    expect(
      rows.every((row) => row.querySelector('.status-name')?.getAttribute('data-role') === null),
    ).toBe(true);
    expect(appCss).toMatch(/\.status-badge \.status-name\s*{[^}]*border:\s*none/);
    expect(appCss).toMatch(/\.status-badge \.status-name\s*{[^}]*outline:\s*none/);
    expect(appCss).toMatch(/\.status-badge \.status-name\s*{[^}]*box-shadow:\s*none/);
    expect(appCss).not.toMatch(/\.status-badge\[data-role='(attacker|defender)'\] \.status-name\s*{/);

    // ITEM-ADD-2b: the role rows carry a soft, diffused glow instead of the old
    // sharp 2px outline.
    expect(appCss).toMatch(/\.status-badge\[data-role='attacker'\]\s*{[^}]*outline:\s*none/);
    expect(appCss).toMatch(
      /\.status-badge\[data-role='attacker'\]\s*{[^}]*box-shadow:[^}]*var\(--role-attacker-glow\)/,
    );
    expect(appCss).toMatch(
      /\.status-badge\[data-role='attacker'\]\s*{[^}]*inset 0 0 calc\(8px \* var\(--highlight-intensity-scale, 1\)\) var\(--role-attacker-bg\)/,
    );
    expect(appCss).toMatch(
      /\.status-badge\[data-role='attacker'\]\s*{[^}]*border: 1px solid var\(--role-attacker-border\)/,
    );
    expect(appCss).toMatch(/\.status-badge\[data-role='defender'\]\s*{[^}]*outline:\s*none/);
    expect(appCss).toMatch(
      /\.status-badge\[data-role='defender'\]\s*{[^}]*box-shadow:[^}]*var\(--role-defender-glow\)/,
    );
    expect(appCss).toMatch(
      /\.status-badge\[data-role='defender'\]\s*{[^}]*inset 0 0 calc\(8px \* var\(--highlight-intensity-scale, 1\)\) var\(--role-defender-bg\)/,
    );
    expect(appCss).toMatch(
      /\.status-badge\[data-role='defender'\]\s*{[^}]*border: 1px solid var\(--role-defender-border\)/,
    );
    expect(appCss).not.toMatch(/outline:\s*2px solid #2dc653/);
    expect(appCss).not.toMatch(/outline:\s*2px solid #f59e0b/);
    expect(appCss).not.toMatch(/\.status-badge[^{]*{[^}]*outline:\s*2px solid/);
    // T-90-3 ITEM-1b: the light theme keeps the softer shape but now uses a
    // dark, high-alpha border plus a stronger multi-layer halo.
    expect(appCss).toMatch(
      /html\[data-theme='light'\] \.status-badge\[data-role='attacker'\]\s*{[^}]*border-color: var\(--role-attacker-border\)/,
    );
    expect(appCss).toMatch(
      /html\[data-theme='light'\] \.status-badge\[data-role='attacker'\]\s*{[^}]*0 0 calc\(10px \* var\(--highlight-intensity-scale, 1\)\)/,
    );
    expect(appCss).toMatch(
      /html\[data-theme='light'\] \.status-badge\[data-role='attacker'\]\s*{[^}]*inset 0 0 calc\(8px \* var\(--highlight-intensity-scale, 1\)\) var\(--role-attacker-bg\)/,
    );
    expect(appCss).toMatch(
      /html\[data-theme='light'\] \.status-badge\[data-role='defender'\]\s*{[^}]*border-color: var\(--role-defender-border\)/,
    );
    expect(appCss).toMatch(
      /html\[data-theme='light'\] \.status-badge\[data-role='defender'\]\s*{[^}]*0 0 calc\(10px \* var\(--highlight-intensity-scale, 1\)\)/,
    );
    expect(appCss).toMatch(
      /html\[data-theme='light'\] \.status-badge\[data-role='defender'\]\s*{[^}]*inset 0 0 calc\(8px \* var\(--highlight-intensity-scale, 1\)\) var\(--role-defender-bg\)/,
    );

    // ITEM-ADD-8a: every row has a name track, a centred count track and a
    // dedicated status track, so a tag never moves the count.
    for (const row of rows) {
      expect(row.querySelector('.status-player')).not.toBeNull();
      expect(row.querySelector('.status-cards')).not.toBeNull();
      expect(row.querySelector('.status-state-slot')).not.toBeNull();
    }
    expect(screen.getByTestId('player-cards-p1').textContent).toBe('6 cards');
    expect(appCss).toMatch(
      /\.status-badge\s*{[^}]*grid-template-columns:\s*minmax\(0, 1fr\) auto minmax\(0, 1fr\)/,
    );
    expect(appCss).toMatch(/\.status-cards\s*{[^}]*justify-self:\s*center/);
  });

  it('T-90-3: darkens the sidebar, clock, POV and hand-sorting glows in light mode', async () => {
    getGameView.mockResolvedValue(view);

    const { container } = render(
      <GamePage gameId="game-1" playerId="p0" onSwitchPlayer={() => {}} />,
    );

    await waitFor(() => expect(screen.getByTestId('clock-panel')).toBeTruthy());

    // The live markup exposes the running half and the low-time flag, so the
    // light-theme rules can target exactly the emphasised clock.
    const gameHalf = container.querySelector('.clock-half.game-clock-half') as HTMLElement;
    const turnHalf = container.querySelector('.clock-half.turn-clock-half') as HTMLElement;
    expect(gameHalf.getAttribute('data-active')).toBe(
      screen.getByTestId('game-clock').getAttribute('data-active'),
    );
    expect(turnHalf.getAttribute('data-active')).toBe(
      screen.getByTestId('turn-clock').getAttribute('data-active'),
    );
    expect(screen.getByTestId('turn-clock').getAttribute('data-low-time')).toMatch(
      /^(true|false)$/,
    );

    // Right sidebar: stronger attacker / defender rows, presence dot and clock.
    expect(
      cssRule(appCss, "html[data-theme='light'] .clock-half[data-active='true']"),
    ).toContain('box-shadow: none');
    expect(
      cssRule(appCss, "html[data-theme='light'] .clock-half.clock-low"),
    ).toContain('var(--clock-urgent-glow)');
    expect(
      cssRule(appCss, "html[data-theme='light'] .turn-clock[data-low-time='true']"),
    ).toContain('var(--clock-urgent-accent)');
    expect(
      cssRule(tableCss, "[data-theme='light'] .presence-dot.present"),
    ).toContain('rgba(21, 128, 61, 0.7)');

    // Left sidebar: QA buttons and replay controls stay blue; the PLAYERS
    // rows use the new high-contrast status tag palette instead of a POV tab.
    expect(cssRule(appCss, ":root[data-theme='light'] .status-tag.passed-tag")).toContain(
      'background: #cbd5e1',
    );
    expect(cssRule(appCss, ":root[data-theme='light'] .status-tag.passed-tag")).toContain(
      'border: none',
    );
    expect(
      cssRule(appCss, "html[data-theme='light'] .qa-scenario-button:hover"),
    ).toContain('var(--ui-select-glow)');
    expect(
      cssRule(appCss, "html[data-theme='light'] .review-nav-button:hover"),
    ).toContain('var(--ui-select-glow)');

    // HAND SORTING: the selected mode and its hover/focus glow.
    expect(cssRule(tableCss, ":root[data-theme='light'] .sort-select")).toContain(
      'var(--ui-select-glow)',
    );
    expect(cssRule(tableCss, ":root[data-theme='light'] .sort-select:hover")).toContain(
      'var(--ui-select-glow)',
    );

    // Dark mode uses the same blue chrome and emerald attacker family, and the
    // active user's row never gets a green outline (ITEM-2).
    expect(cssRule(appCss, '.status-badge.mine')).toContain(
      'border-color: var(--app-border)',
    );
    expect(cssRule(appCss, ".status-badge[data-role='attacker']")).toContain(
      'var(--role-attacker-glow)',
    );
    expect(cssRule(tableCss, ".sort-select")).toContain('var(--ui-select-border)');
  });

  it('labels the last player out as DURAK once the match is over', async () => {
    getGameView.mockResolvedValue({
      ...view,
      myHand: [],
      tablePairs: [],
      boutPhase: 'GameOver',
      legalActions: [],
      finishOrder: ['p1'],
      winners: ['p1'],
      durak: null,
      isDraw: false,
      opponents: [
        { id: 'p1', name: 'Bob', cardCount: 0, hasPassed: false, finishRank: 1 },
      ],
    });
    getGameReplay.mockResolvedValue({ gameId: 'game-1', moves: [], frames: [] });

    const { container } = render(
      <GamePage gameId="game-1" playerId="p0" onSwitchPlayer={() => {}} />,
    );

    const durakTag = await screen.findByTestId('player-durak-tag-p0');
    expect(durakTag.textContent).toBe('DURAK');
    expect(durakTag.classList.contains('durak-tag')).toBe(true);
    expect(durakTag.closest('.status-state-slot')).not.toBeNull();
    expect(screen.queryByTestId('player-durak-tag-p1')).toBeNull();
    expect(
      within(screen.getByTestId('players-list')).getByText('WINNER'),
    ).toBeTruthy();

    // No role outline survives the final frame.
    const rows = Array.from(
      container.querySelectorAll('[data-testid="players-list"] .status-badge'),
    ) as HTMLElement[];
    expect(rows.every((row) => row.getAttribute('data-role') === 'none')).toBe(true);
  });

  it('locks every control when the inspected seat is a bot', async () => {
    getGameView.mockResolvedValue({
      ...view,
      isBot: true,
      playerTypes: ['randomBot', 'human'],
      myHand: [{ suit: 'clubs', rank: 'six' }],
      tablePairs: [],
      attackerIdx: 0,
      defenderIdx: 1,
      boutPhase: 'initialAttack',
      legalActions: ['attack', 'pass', 'surrender'],
    });

    const { container } = render(
      <GamePage gameId="game-1" playerId="p0" onSwitchPlayer={() => {}} />,
    );

    await waitFor(() => expect(screen.getByTestId('players-list')).toBeTruthy());

    // ITEM-ADD-9: no attack, throw-in, surrender or pass is offered, and the
    // table reports its locked state.
    expect(container.querySelector('[data-zone="player-controls"]')).toBeNull();
    expect(screen.queryByText('Attack')).toBeNull();
    expect(screen.queryByTestId('pass-button')).toBeNull();
    expect(screen.queryByTestId('surrender-button')).toBeNull();
    expect(
      container.querySelector('[data-zone="table-arena"]')?.getAttribute('data-bot-locked'),
    ).toBe('true');

    fireEvent.click(screen.getByLabelText('six of clubs'));
    fireEvent.doubleClick(screen.getByLabelText('six of clubs'));
    await new Promise((resolve) => setTimeout(resolve, 30));
    expect(sendAction).not.toHaveBeenCalled();
  });

  it("labels the active user's own row from their own status fields", async () => {
    getGameView.mockResolvedValue({
      ...view,
      myHand: [],
      myHasPassed: false,
      myFinishRank: 2,
      tablePairs: [],
      boutPhase: 'defense',
      legalActions: [],
      finishOrder: ['p1', 'p0'],
    });
    getGameReplay.mockResolvedValue({ gameId: 'game-1', moves: [], frames: [] });

    render(<GamePage gameId="game-1" playerId="p0" onSwitchPlayer={() => {}} />);

    const list = await screen.findByTestId('players-list');
    const row = list.querySelector('[data-player-id="p0"]') as HTMLElement;
    // ITEM-ADD-8a: the viewer's row is labelled exactly like the opponents'.
    expect(within(row).getByText('OUT')).toBeTruthy();
    expect(within(row).getByTestId('player-cards-p0').textContent).toBe('0 cards');
    expect(within(row).getByTestId('player-status-tag-p0').textContent).toBe('OUT');
  });

  it("shows PASSED on the active user's row from their own pass flag", async () => {
    getGameView.mockResolvedValue({
      ...view,
      myHasPassed: true,
      myFinishRank: null,
      boutPhase: 'surrenderThrowIn',
      legalActions: ['pass'],
    });
    getGameReplay.mockResolvedValue({ gameId: 'game-1', moves: [], frames: [] });

    render(<GamePage gameId="game-1" playerId="p0" onSwitchPlayer={() => {}} />);

    const list = await screen.findByTestId('players-list');
    const row = list.querySelector('[data-player-id="p0"]') as HTMLElement;
    expect(within(row).getByText('PASSED')).toBeTruthy();
    expect(within(row).getByTestId('player-status-tag-p0').getAttribute('data-status')).toBe(
      'PASSED',
    );
  });

  it('shows WINNER on the active user row when they finished first', async () => {
    getGameView.mockResolvedValue({
      ...view,
      myHand: [],
      myHasPassed: false,
      myFinishRank: 1,
      tablePairs: [],
      boutPhase: 'defense',
      legalActions: [],
      finishOrder: ['p0'],
      winners: ['p0'],
      opponents: [{ id: 'p1', name: 'Bob', cardCount: 4, hasPassed: false, finishRank: null }],
    });
    getGameReplay.mockResolvedValue({ gameId: 'game-1', moves: [], frames: [] });

    render(<GamePage gameId="game-1" playerId="p0" onSwitchPlayer={() => {}} />);

    const tag = await screen.findByTestId('player-status-tag-p0');
    expect(tag.textContent).toBe('WINNER');
    expect(tag.getAttribute('data-status')).toBe('WINNER');
    // Bob still holds 4 cards, so his row carries no finished label at all.
    expect(screen.queryByTestId('player-status-tag-p1')).toBeNull();
  });

  it("falls back to the winners list when the active user's rank is missing", async () => {
    getGameView.mockResolvedValue({
      ...view,
      myHand: [],
      myHasPassed: false,
      myFinishRank: undefined,
      tablePairs: [],
      boutPhase: 'defense',
      legalActions: [],
      finishOrder: ['p1', 'p0'],
      winners: ['p1', 'p0'],
      opponents: [{ id: 'p1', name: 'Bob', cardCount: 0, hasPassed: false, finishRank: 1 }],
    });
    getGameReplay.mockResolvedValue({ gameId: 'game-1', moves: [], frames: [] });

    render(<GamePage gameId="game-1" playerId="p0" onSwitchPlayer={() => {}} />);

    const tag = await screen.findByTestId('player-status-tag-p0');
    expect(tag.textContent).toBe('OUT');
    // The opponent keeps their own WINNER label from `finishRank`.
    expect(screen.getByTestId('player-status-tag-p1').textContent).toBe('WINNER');
  });

  it('never labels a seat that still holds cards as WINNER or OUT', async () => {
    getGameView.mockResolvedValue({
      ...view,
      myHand: [{ suit: 'clubs', rank: 'two' }],
      myHasPassed: false,
      myFinishRank: 2,
      tablePairs: [],
      boutPhase: 'defense',
      legalActions: [],
      finishOrder: ['p2', 'p0'],
      winners: ['p2', 'p0'],
      opponents: [
        { id: 'p1', name: 'Bob', cardCount: 3, hasPassed: false, finishRank: 2 },
        { id: 'p2', name: 'Carol', cardCount: 0, hasPassed: false, finishRank: 1 },
      ],
    });
    getGameReplay.mockResolvedValue({ gameId: 'game-1', moves: [], frames: [] });

    render(<GamePage gameId="game-1" playerId="p0" onSwitchPlayer={() => {}} />);

    const list = await screen.findByTestId('players-list');
    // ITEM-ADD-8b: Bob's stale rank 2 is ignored because he still holds 3 cards.
    const bobRow = list.querySelector('[data-player-id="p1"]') as HTMLElement;
    expect(bobRow.textContent).toContain('3 cards');
    expect(bobRow.textContent).not.toMatch(/WINNER|OUT/);
    expect(screen.queryByTestId('player-status-tag-p1')).toBeNull();
    // The viewer holds a card too, so their own stale rank cannot mark them OUT.
    const ownRow = list.querySelector('[data-player-id="p0"]') as HTMLElement;
    expect(ownRow.textContent).not.toMatch(/WINNER|OUT/);
    expect(screen.queryByTestId('player-status-tag-p0')).toBeNull();
    // Carol is genuinely finished: 0 cards and rank 1.
    expect(screen.getByTestId('player-status-tag-p2').textContent).toBe('WINNER');
  });

  it('opens a QA scenario preset from the left sidebar in one click', async () => {
    getGameView.mockResolvedValue(view);
    getGameReplay.mockResolvedValue({ gameId: 'game-1', moves: [], frames: [] });
    createPresetGameMock.mockResolvedValue({
      gameId: 'preset-1',
      players: ['p0', 'p1'],
      playerTypes: ['human', 'human'],
      defaultPlayerId: 'p1',
    });
    const onNavigateGame = vi.fn();

    render(
      <GamePage
        gameId="game-1"
        playerId="p0"
        onSwitchPlayer={() => {}}
        onNavigateGame={onNavigateGame}
      />,
    );

    const panel = await screen.findByTestId('qa-scenarios');
    expect(panel.closest('[data-zone="sidebar-left"]')).not.toBeNull();
    for (const label of [
      '3P Redirect (Bob POV)',
      '4P Chaos Targets',
      'Surrender Half-Off',
      'Defenseless Auto-Surrender',
      'Discard & Endgame Durak',
    ]) {
      expect(within(panel).getByRole('button', { name: label })).toBeTruthy();
    }

    fireEvent.click(within(panel).getByRole('button', { name: '3P Redirect (Bob POV)' }));

    await waitFor(() => expect(createPresetGameMock).toHaveBeenCalledWith('3p-redirect-bob'));
    await waitFor(() => expect(onNavigateGame).toHaveBeenCalledWith('preset-1', 'p1'));
  });

  it('T-90-feedback-3: a light-mode QA preset paints the paler highlights live', async () => {
    setSettings({ theme: 'light' });
    const lightDefense: PlayerGameView = {
      ...view,
      myHand: [
        { suit: 'hearts', rank: 'six' },
        { suit: 'diamonds', rank: 'nine' },
      ],
      opponents: [{ id: 'p1', name: 'Bob', cardCount: 5, hasPassed: false, finishRank: null }],
      tablePairs: [{ attack: { suit: 'clubs', rank: 'six' }, defense: null }],
      trumpSuit: 'clubs',
      boutPhase: 'defense',
      attackerIdx: 1,
      defenderIdx: 0,
      legalActions: ['surrender'],
    };
    getGameView.mockResolvedValue(lightDefense);
    getGameReplay.mockResolvedValue({ gameId: 'game-1', moves: [], frames: [] });
    createPresetGameMock.mockResolvedValue({
      gameId: 'preset-3',
      players: ['p0', 'p1'],
      playerTypes: ['human', 'human'],
      defaultPlayerId: 'p0',
    });
    const onNavigateGame = vi.fn();

    render(
      <GamePage
        gameId="game-1"
        playerId="p0"
        onSwitchPlayer={() => {}}
        onNavigateGame={onNavigateGame}
      />,
    );

    const panel = await screen.findByTestId('qa-scenarios');
    expect(panel.closest('[data-zone="sidebar-left"]')).not.toBeNull();
    fireEvent.click(within(panel).getByRole('button', { name: 'Surrender Half-Off' }));
    await waitFor(() => expect(createPresetGameMock).toHaveBeenCalledWith('surrender-half-off'));
    await waitFor(() => expect(onNavigateGame).toHaveBeenCalledWith('preset-3', 'p0'));

    // The document tokens resolved from the paler Light palette...
    const root = document.documentElement;
    expect(root.getAttribute('data-theme')).toBe('light');
    expect(root.style.getPropertyValue('--ui-select-accent')).toBe('#5b87f5');
    expect(root.style.getPropertyValue('--role-attacker-accent')).toBe('#46a76f');
    expect(root.style.getPropertyValue('--role-defender-accent')).toBe('#dc6868');
    expect(root.style.getPropertyValue('--trump-accent')).toBe('#d4943a');
    expect(root.style.getPropertyValue('--redirect-accent')).toBe('#a375e6');
    expect(root.style.getPropertyValue('--clock-urgent-accent')).toBe('#e27c43');
    expect(root.style.getPropertyValue('--role-defender-glow')).toBe(
      'rgba(220, 104, 104, 0.34)',
    );

    // ...and the live defending hand / uncovered attack consume them.
    const box = screen.getByTestId('hand-turn-highlight') as HTMLElement;
    expect(box.getAttribute('data-highlighted')).toBe('true');
    expect(box.getAttribute('data-highlight-variant')).toBe('defender');
    expect(document.querySelector('.table-card-uncovered')).not.toBeNull();
  });

  it('T-90 ITEM-PREV-4a: the Defenseless Auto-Surrender preset shows one tight hand outline', async () => {
    const bobDefense: PlayerGameView = {
      ...view,
      myId: 'p1',
      myName: 'Bob',
      myHand: [
        { suit: 'hearts', rank: 'six' },
        { suit: 'diamonds', rank: 'nine' },
      ],
      opponents: [
        { id: 'p0', name: 'Alice', cardCount: 6, hasPassed: false, finishRank: null },
        { id: 'p2', name: 'Carol', cardCount: 4, hasPassed: true, finishRank: null },
      ],
      tablePairs: [
        { attack: { suit: 'clubs', rank: 'six' }, defense: { suit: 'clubs', rank: 'nine' } },
        { attack: { suit: 'spades', rank: 'jack' }, defense: null },
      ],
      trumpSuit: 'clubs',
      boutPhase: 'Defense',
      attackerIdx: 0,
      defenderIdx: 1,
      legalActions: ['surrender'],
      defenderDefenseless: true,
    };
    getGameView.mockResolvedValue(bobDefense);
    getGameReplay.mockResolvedValue({ gameId: 'game-1', moves: [], frames: [] });
    createPresetGameMock.mockResolvedValue({
      gameId: 'preset-2',
      players: ['p0', 'p1', 'p2'],
      playerTypes: ['human', 'human', 'human'],
      defaultPlayerId: 'p1',
    });
    const onNavigateGame = vi.fn();

    render(
      <GamePage
        gameId="game-1"
        playerId="p1"
        onSwitchPlayer={() => {}}
        onNavigateGame={onNavigateGame}
      />,
    );

    // One click on the left-sidebar preset jumps straight to Bob's hand.
    const panel = await screen.findByTestId('qa-scenarios');
    fireEvent.click(within(panel).getByRole('button', { name: 'Defenseless Auto-Surrender' }));
    await waitFor(() => expect(createPresetGameMock).toHaveBeenCalledWith('defenseless-surrender'));
    await waitFor(() => expect(onNavigateGame).toHaveBeenCalledWith('preset-2', 'p1'));

    const zone = document.querySelector('[data-zone="player-hand"]') as HTMLElement;
    const box = screen.getByTestId('hand-turn-highlight') as HTMLElement;
    // The preset lands on Bob's countdown: the tight box glows crimson...
    expect(box.classList.contains('hand-cards')).toBe(true);
    expect(box.parentElement).toBe(zone);
    expect(box.getAttribute('data-highlighted')).toBe('true');
    expect(box.getAttribute('data-highlight-variant')).toBe('defender');
    expect(box.classList.contains('defender-turn')).toBe(true);
    expect(zone.getAttribute('data-defenseless')).toBe('true');
    // The wrapper is the documented `.player-hand-zone` alias and the stylesheet
    // names it — plus `.hand-scroll-viewport` — in the neutral resets.
    expect(zone.classList.contains('player-hand-zone')).toBe(true);
    expect(tableCss).toContain('.hand-scroll-viewport');
    expect(tableCss).toContain(".player-hand-zone[data-highlighted='true']");

    // ...and it is the ONLY highlight container: no second, wider wrapper outline.
    // The wrapper's own `turn-pulse` / `defender-turn` state classes are inert
    // because every glow rule also requires `.hand-cards`.
    expect(zone.classList.contains('hand-cards')).toBe(false);
    expect(zone.querySelectorAll('.hand-cards')).toHaveLength(1);
    const glowing = Array.from(
      zone.querySelectorAll('.hand-cards, .attacker-turn, .defender-turn, .throw-in-turn'),
    );
    expect(glowing).toHaveLength(1);
    expect(glowing[0]).toBe(box);

    // The stylesheet pins the outer column neutral in both themes and scopes
    // every visual glow to `.hand-cards`.
    const outerReset = cssRule(tableCss, "[data-zone='player-hand'],");
    for (const declaration of [
      'border: none',
      'outline: none',
      'box-shadow: none',
      'background: transparent',
      'animation: none',
    ]) {
      expect(outerReset).toContain(declaration);
    }
    expect(
      cssRule(tableCss, ":root[data-theme='light'] [data-zone='player-hand'],"),
    ).toContain('box-shadow: none');
    expect(
      cssRule(
        tableCss,
        ".hand-cards[data-highlighted='true'][data-highlight-variant='defender']",
      ),
    ).toContain('defenderHandPulse');
  });
});

/**
 * T-90 ITEM-PREV-4a / ITEM-PREV-4b: the client-side auto-surrender (3 s) and
 * auto-pass (1 s) delays, measured with fake timers.
 */
describe('GamePage client auto-surrender and auto-pass delays', () => {
  const flush = async () => {
    await act(async () => {
      await Promise.resolve();
      await Promise.resolve();
      await Promise.resolve();
    });
  };

  const renderGame = async (initialView: PlayerGameView) => {
    getGameView.mockResolvedValue(initialView);
    getGameReplay.mockResolvedValue({ gameId: 'game-1', moves: [], frames: [] });
    render(<GamePage gameId="game-1" playerId="p0" onSwitchPlayer={() => {}} />);
    await flush();
    await flush();
  };

  // A human defender facing an uncovered attack with no cover and no redirect.
  const defenselessView: PlayerGameView = {
    ...view,
    myHand: [{ suit: 'clubs', rank: 'two' }],
    tablePairs: [{ attack: { suit: 'spades', rank: 'six' }, defense: null }],
    attackerIdx: 1,
    defenderIdx: 0,
    boutPhase: 'defense',
    legalActions: ['surrender'],
    defenderDefenseless: true,
  };

  // A human thrower in the surrender throw-in with no matching card to throw.
  const autoPassView: PlayerGameView = {
    ...view,
    myHand: [{ suit: 'clubs', rank: 'two' }],
    tablePairs: [
      { attack: { suit: 'spades', rank: 'six' }, defense: { suit: 'hearts', rank: 'seven' } },
    ],
    attackerIdx: 0,
    defenderIdx: 1,
    boutPhase: 'surrenderThrowIn',
    legalActions: ['pass'],
    myHasPassed: false,
  };

  beforeEach(() => {
    getGameView.mockReset();
    getGameReplay.mockReset();
    sendAction.mockReset();
    createGameMock.mockReset();
    createPresetGameMock.mockReset();
    wsState.onUpdate = null;
    wsState.presence = [];
    Object.values(audio).forEach((spy) => spy.mockClear());
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('keeps Surrender clickable for 3 seconds and only then dispatches DeclareSurrender', async () => {
    sendAction.mockResolvedValue({
      ...defenselessView,
      boutPhase: 'surrenderThrowIn',
      legalActions: [],
    });

    await renderGame(defenselessView);

    // The button is on screen, enabled and counting down from 3 immediately.
    expect(screen.getByTestId('surrender-button').hasAttribute('disabled')).toBe(false);
    expect(screen.getByTestId('surrender-countdown').getAttribute('data-countdown')).toBe('3');
    expect(screen.getByTestId('surrender-countdown').textContent).toBe('');
    // T-90-2 ITEM-PREV-4: the red defender glow is still on during the grace.
    expect(
      screen.getByTestId('hand-turn-highlight').getAttribute('data-highlight-variant'),
    ).toBe('defender');

    act(() => {
      vi.advanceTimersByTime(0);
    });
    expect(sendAction).not.toHaveBeenCalled();

    act(() => {
      vi.advanceTimersByTime(1000);
    });
    expect(sendAction).not.toHaveBeenCalled();
    expect(screen.getByTestId('surrender-countdown').getAttribute('data-countdown')).toBe('2');

    act(() => {
      vi.advanceTimersByTime(1999);
    });
    expect(sendAction).not.toHaveBeenCalled();
    expect(screen.getByTestId('surrender-countdown').getAttribute('data-countdown')).toBe('1');

    act(() => {
      vi.advanceTimersByTime(1);
    });
    expect(sendAction).toHaveBeenCalledTimes(1);
    expect(sendAction).toHaveBeenCalledWith('game-1', {
      type: 'declareSurrender',
      playerId: 'p0',
    });
    // “Presses itself”: the glow is gone as soon as the countdown fires.
    const autoBox = screen.getByTestId('hand-turn-highlight') as HTMLElement;
    expect(autoBox.getAttribute('data-highlighted')).toBe('false');
    expect(autoBox.getAttribute('data-highlight-variant')).toBe('none');
    expect(autoBox.getAttribute('data-surrendering')).toBe('true');
  });

  it('dispatches exactly one surrender when the defender clicks inside the grace window', async () => {
    sendAction.mockResolvedValue({
      ...defenselessView,
      boutPhase: 'surrenderThrowIn',
      legalActions: [],
    });

    await renderGame(defenselessView);

    act(() => {
      vi.advanceTimersByTime(500);
    });
    fireEvent.click(screen.getByTestId('surrender-button'));

    expect(sendAction).toHaveBeenCalledTimes(1);
    expect(sendAction).toHaveBeenCalledWith('game-1', {
      type: 'declareSurrender',
      playerId: 'p0',
    });

    // The armed 3-second timer was cancelled, so no duplicate ever arrives.
    act(() => {
      vi.advanceTimersByTime(5000);
    });
    expect(sendAction).toHaveBeenCalledTimes(1);
  });

  it('never auto-surrenders a defender who still has a legal cover', async () => {
    const coverView: PlayerGameView = {
      ...defenselessView,
      myHand: [{ suit: 'spades', rank: 'nine' }],
      legalActions: ['cover', 'surrender'],
      defenderDefenseless: false,
    };

    await renderGame(coverView);

    expect(screen.getByTestId('surrender-button').hasAttribute('disabled')).toBe(false);
    expect(screen.queryByTestId('surrender-countdown')).toBeNull();

    act(() => {
      vi.advanceTimersByTime(5000);
    });
    expect(sendAction).not.toHaveBeenCalled();
  });

  it('waits a full second before auto-passing a thrower with no legal throw-in', async () => {
    sendAction.mockResolvedValue({ ...autoPassView, myHasPassed: true });

    await renderGame(autoPassView);

    expect(screen.getByTestId('pass-button')).toBeTruthy();
    expect(screen.getByTestId('pass-countdown').getAttribute('data-countdown')).toBe('1');

    act(() => {
      vi.advanceTimersByTime(0);
    });
    expect(sendAction).not.toHaveBeenCalled();

    act(() => {
      vi.advanceTimersByTime(900);
    });
    expect(sendAction).not.toHaveBeenCalled();

    act(() => {
      vi.advanceTimersByTime(100);
    });
    expect(sendAction).toHaveBeenCalledTimes(1);
    expect(sendAction).toHaveBeenCalledWith('game-1', {
      type: 'passTurn',
      playerId: 'p0',
    });
  });

  it('dispatches exactly one PassTurn when the thrower clicks Pass inside the grace window', async () => {
    sendAction.mockResolvedValue({ ...autoPassView, myHasPassed: true });

    await renderGame(autoPassView);

    act(() => {
      vi.advanceTimersByTime(400);
    });
    fireEvent.click(screen.getByTestId('pass-button'));

    expect(sendAction).toHaveBeenCalledTimes(1);
    expect(sendAction).toHaveBeenCalledWith('game-1', {
      type: 'passTurn',
      playerId: 'p0',
    });

    act(() => {
      vi.advanceTimersByTime(2000);
    });
    expect(sendAction).toHaveBeenCalledTimes(1);
  });

  /**
   * T-90 ITEM-PREV-4a/4b & ITEM-QA-1: the crimson uncovered-card prompt belongs
   * only to the defender and disappears on surrender, while both clock halves
   * stay quiet until the Turn clock reaches its final five seconds.
   */
  it('T-90: shows the uncovered prompt only to the defender and clears it on surrender', async () => {
    const bobDefense: PlayerGameView = {
      ...view,
      myId: 'p1',
      myName: 'Bob',
      myHand: [
        { suit: 'hearts', rank: 'six' },
        { suit: 'diamonds', rank: 'nine' },
      ],
      opponents: [
        { id: 'p0', name: 'Alice', cardCount: 6, hasPassed: false, finishRank: null },
        { id: 'p2', name: 'Carol', cardCount: 4, hasPassed: false, finishRank: null },
      ],
      tablePairs: [
        { attack: { suit: 'clubs', rank: 'six' }, defense: { suit: 'clubs', rank: 'nine' } },
        { attack: { suit: 'spades', rank: 'seven' }, defense: null },
      ],
      trumpSuit: 'clubs',
      attackerIdx: 0,
      defenderIdx: 1,
      boutPhase: 'Defense',
      legalActions: ['cover', 'surrender'],
      defenderDefenseless: false,
      gameStartedAtMs: 1_000,
      turnDeadlineMs: Date.now() + 12_000,
    };
    getGameView.mockResolvedValue(bobDefense);
    getGameReplay.mockResolvedValue({ gameId: 'game-1', moves: [], frames: [] });
    sendAction.mockResolvedValue({
      ...bobDefense,
      boutPhase: 'SurrenderThrowIn',
      legalActions: [],
    });

    const bob = render(
      <GamePage gameId="game-1" playerId="p1" onSwitchPlayer={() => {}} />,
    );
    await waitFor(() => expect(screen.getByTestId('surrender-button')).toBeTruthy());

    // Bob is the defender: the uncovered 7♠ pulses, and neither clock is lit.
    expect(bob.container.querySelectorAll('.table-card-uncovered')).toHaveLength(1);
    const bobPair = bob.container.querySelector('.table-card-uncovered') as HTMLElement;
    expect(bobPair.getAttribute('data-uncovered-highlighted')).toBe('true');
    expect(screen.getByTestId('game-clock-half').getAttribute('data-highlighted')).toBe('false');
    expect(screen.getByTestId('turn-clock-half').getAttribute('data-highlighted')).toBe('false');
    expect(screen.getByTestId('turn-clock-half').getAttribute('data-low-time')).toBe('false');
    const gameHalfCss = cssRule(appCss, ".split-clock-half[data-active='true']");
    expect(gameHalfCss).toContain('background: transparent');
    expect(gameHalfCss).toContain('box-shadow: none');

    // The decision to surrender clears the prompt before the server replies.
    fireEvent.click(screen.getByTestId('surrender-button'));
    expect(bob.container.querySelectorAll('.table-card-uncovered')).toHaveLength(0);
    expect(
      bob.container.querySelector('.table-pair')!.getAttribute('data-uncovered-highlighted'),
    ).toBe('false');
    bob.unmount();

    // Alice (p0) is the attacker, not the defender: no crimson prompt at all.
    getGameView.mockResolvedValue({
      ...bobDefense,
      myId: 'p0',
      myName: 'Alice',
      myHand: [{ suit: 'hearts', rank: 'seven' }],
      opponents: [
        { id: 'p1', name: 'Bob', cardCount: 4, hasPassed: false, finishRank: null },
        { id: 'p2', name: 'Carol', cardCount: 4, hasPassed: false, finishRank: null },
      ],
      legalActions: ['throwIn', 'pass'],
    });
    const alice = render(
      <GamePage gameId="game-1" playerId="p0" onSwitchPlayer={() => {}} />,
    );
    await waitFor(() => expect(screen.getByTestId('clock-panel')).toBeTruthy());
    expect(alice.container.querySelectorAll('.table-card-uncovered')).toHaveLength(0);
    expect(
      alice.container.querySelector('.table-pair')!.getAttribute('data-uncovered-highlighted'),
    ).toBe('false');
    alice.unmount();

    // Final five seconds: only the Turn half lights up with the urgent aura.
    getGameView.mockResolvedValue({
      ...bobDefense,
      turnDeadlineMs: Date.now() + 4_000,
    });
    const low = render(
      <GamePage gameId="game-1" playerId="p1" onSwitchPlayer={() => {}} />,
    );
    await waitFor(() =>
      expect(screen.getByTestId('turn-clock-half').getAttribute('data-low-time')).toBe('true'),
    );
    expect(screen.getByTestId('turn-clock-half').getAttribute('data-highlighted')).toBe('true');
    expect(screen.getByTestId('turn-clock-half').classList.contains('clock-low')).toBe(true);
    expect(screen.getByTestId('turn-clock').getAttribute('data-low-time')).toBe('true');
    expect(screen.getByTestId('game-clock-half').getAttribute('data-highlighted')).toBe('false');
    expect(Number(screen.getByTestId('turn-clock').textContent?.slice(-2))).toBeLessThanOrEqual(5);
    expect(cssRule(appCss, '.split-clock-half.clock-low')).toContain(
      'var(--clock-urgent-glow)',
    );
    low.unmount();
  });

  /**
   * T-90 ITEM-1b/1c: the live game chrome (POV tabs, HAND SORTING) is cobalt,
   * the running clock is cyan-teal, and each gameplay role keeps its own
   * family, so no unrelated feature can share a colour.
   */
  it('T-90: keeps chrome cobalt, the clock cyan and each role in its own family', async () => {
    getGameView.mockResolvedValue(view);

    const { container } = render(
      <GamePage gameId="game-1" playerId="p0" onSwitchPlayer={() => {}} />,
    );

    await waitFor(() => expect(screen.getByTestId('clock-panel')).toBeTruthy());

    // ITEM-14: the PLAYERS rows are the only POV switcher, and the viewed seat
    // is the one carrying the ` (You)` suffix.
    const rows = Array.from(container.querySelectorAll('.status-badge')) as HTMLElement[];
    expect(rows.length).toBeGreaterThan(0);
    const activeRow = container.querySelector('.status-badge.mine') as HTMLElement;
    expect(activeRow).not.toBeNull();
    expect(activeRow.textContent).toContain('(You)');
    expect(activeRow.getAttribute('data-pov-clickable')).toBe('true');

    // Both clock halves expose the ticket's `.split-clock-half` hook.
    expect(container.querySelectorAll('.split-clock-half')).toHaveLength(2);

    // HAND SORTING: the live selector is the active sort control.
    const sort = screen.getByTestId('sort-select') as HTMLSelectElement;
    expect(sort.tagName.toLowerCase()).toBe('select');
    expect(sort.classList.contains('sort-select')).toBe(true);
    expect(sort.getAttribute('data-sort-mode')).toMatch(/^(suit|pairs|rank|custom)$/);

    // Cobalt chrome, cyan clock, emerald attacker, crimson defender.
    expect(cssRule(appCss, ".status-badge[data-pov-clickable='true']")).toContain(
      'cursor: pointer',
    );
    expect(cssRule(appCss, ".split-clock-half[data-active='true']")).toContain(
      'background: transparent',
    );
    expect(cssRule(appCss, ".split-clock-half[data-active='true']")).toContain(
      'box-shadow: none',
    );
    expect(cssRule(tableCss, '.split-clock-half.clock-low')).toContain(
      'var(--clock-urgent-border)',
    );
    expect(cssRule(tableCss, '.sort-btn.active')).toContain('var(--ui-select-accent)');
    expect(cssRule(appCss, ".status-badge[data-role='attacker']")).toContain(
      'var(--role-attacker-border)',
    );
    expect(cssRule(appCss, ".status-badge[data-role='defender']")).toContain(
      'var(--role-defender-border)',
    );
    // The two clock halves are the only elements reading the clock family.
    expect(cssRule(appCss, ".turn-clock[data-low-time='true']")).toContain(
      'var(--clock-urgent-accent)',
    );
  });
});

/**
 * T-90-feedback-2 ITEM-NEW-1b / ITEM-NEW-1d: the Theme ▸ Highlights preset and
 * Intensity controls retheme the live GameTable in real time — no reload and no
 * closing of the dropdown — because the settings store repaints `<html>`.
 */
describe('T-90-feedback-2 live table highlight presets and intensity', () => {
  beforeEach(() => {
    resetSettings();
    window.localStorage.clear();
    getGameView.mockReset();
    getGameReplay.mockReset();
    sendAction.mockReset();
    createGameMock.mockReset();
    createPresetGameMock.mockReset();
    wsState.onUpdate = null;
    wsState.presence = [];
  });

  afterEach(() => {
    resetSettings();
    window.localStorage.clear();
  });

  it('retunes the mounted table tokens when preset and intensity change', async () => {
    getGameView.mockResolvedValue(view);
    getGameReplay.mockResolvedValue({ gameId: 'game-1', moves: [], frames: [] });

    const { container } = render(
      <GamePage gameId="game-1" playerId="p0" onSwitchPlayer={() => {}} />,
    );
    await waitFor(() => expect(screen.getByTestId('clock-panel')).toBeTruthy());

    const root = document.documentElement;
    // Defaults are the Classic scheme at 100%.
    expect(getSettings().highlightPreset).toBe('classic');
    expect(root.dataset.highlightPreset).toBe('classic');
    expect(root.style.getPropertyValue('--highlight-intensity')).toBe('1');
    expect(root.style.getPropertyValue('--role-attacker-accent')).toBe('#22c55e');

    // Selecting Cool, then raising the Intensity slider, repaints the arena.
    setHighlightPreset('cool');
    setHighlightIntensity(175);

    expect(root.dataset.highlightPreset).toBe('cool');
    expect(root.dataset.highlightIntensity).toBe('175');
    expect(root.style.getPropertyValue('--highlight-intensity')).toBe('1.75');
    expect(root.style.getPropertyValue('--ui-select-accent')).toBe('#06b6d4');
    expect(root.style.getPropertyValue('--role-attacker-accent')).toBe('#10b981');
    expect(root.style.getPropertyValue('--role-defender-accent')).toBe('#e11d48');
    expect(root.style.getPropertyValue('--trump-accent')).toBe('#38bdf8');
    expect(root.style.getPropertyValue('--redirect-accent')).toBe('#8b5cf6');
    expect(root.style.getPropertyValue('--clock-urgent-accent')).toBe('#f97316');
    expect(root.style.getPropertyValue('--role-attacker-pulse-outer')).not.toBe('');

    // The live table is still mounted and consumes the very same tokens.
    expect(container.querySelector('[data-zone="table-arena"]')).not.toBeNull();
    expect(screen.getByTestId('hand-turn-highlight')).toBeTruthy();
    expect(tableCss).toContain("var(--role-defender-glow)");
    expect(tableCss).toContain(".hand-cards[data-highlighted='true'][data-highlight-variant='defender']");
    // Outlines and the urgent clock scale their aura with the same factor.
    expect(tableCss).toContain('calc(10px * var(--highlight-intensity, 1))');
    expect(appCss).toContain('calc(12px * var(--highlight-intensity, 1))');

    // Lowering the intensity softens the same palette; the preset is unchanged.
    setHighlightIntensity(20);
    expect(root.style.getPropertyValue('--highlight-intensity')).toBe('0.2');
    expect(root.style.getPropertyValue('--role-defender-accent')).toBe('#e11d48');
  });
});

/**
 * T-90-feedback-4: the Light Theme Header QA preset repaints the live game in
 * place, so both page backgrounds and the inverse header gradient are one
 * click away from the lobby or the left sidebar.
 */
describe('T-90-feedback-4 Light theme QA preset', () => {
  beforeEach(() => {
    resetSettings();
    window.localStorage.clear();
  });

  afterEach(() => {
    resetSettings();
    window.localStorage.clear();
  });

  it('applies the light theme in one click without creating a room', async () => {
    createPresetGameMock.mockClear();
    getGameView.mockResolvedValue(view);
    getGameReplay.mockResolvedValue({ gameId: 'game-1', moves: [], frames: [] });

    render(<GamePage gameId="game-1" playerId="p0" onSwitchPlayer={() => {}} />);

    const panel = await screen.findByTestId('qa-scenarios');
    const button = within(panel).getByRole('button', { name: 'Light Theme Header' });
    expect(button.getAttribute('data-preset')).toBe('light-theme-gradient');

    fireEvent.click(button);

    expect(document.documentElement.getAttribute('data-theme')).toBe('light');
    expect(getSettings().theme).toBe('light');
    expect(createPresetGameMock).not.toHaveBeenCalled();
  });
});

describe('T-90-4: Transparent Mode, POV gating and custom hand order', () => {
  it('ITEM-10b: starts the Transparent Mode QA preset in one click', async () => {
    getGameView.mockResolvedValue(view);
    getGameReplay.mockResolvedValue({ gameId: 'game-1', moves: [], frames: [] });
    createPresetGameMock.mockResolvedValue({
      gameId: 'game-2',
      players: ['p0', 'p1', 'p2'],
      playerTypes: ['human', 'human', 'human'],
      defaultPlayerId: 'p0',
    });
    const onNavigateGame = vi.fn();

    render(
      <GamePage
        gameId="game-1"
        playerId="p0"
        onSwitchPlayer={() => {}}
        onNavigateGame={onNavigateGame}
      />,
    );

    const button = await screen.findByTestId('preset-btn-transparent-mode');
    expect(button.getAttribute('data-preset')).toBe('transparent-mode');
    expect(button.textContent).toBe('Transparent Mode');

    fireEvent.click(button);
    await waitFor(() => expect(createPresetGameMock).toHaveBeenCalledWith('transparent-mode'));
    await waitFor(() => expect(onNavigateGame).toHaveBeenCalledWith('game-2', 'p0'));
  });

  it('ITEM-14b: locks POV rows without Dev Mode, then unlocks them after game over', async () => {
    getGameView.mockResolvedValue({ ...view, devMode: false });
    getGameReplay.mockResolvedValue({ gameId: 'game-1', moves: [], frames: [] });
    const onSwitchPlayer = vi.fn();

    render(<GamePage gameId="game-1" playerId="p0" onSwitchPlayer={onSwitchPlayer} />);

    await waitFor(() => expect(screen.getByTestId('player-row-p1')).toBeTruthy());
    const lockedRow = screen.getByTestId('player-row-p1');
    expect(lockedRow.getAttribute('data-pov-clickable')).toBe('false');
    expect(lockedRow.getAttribute('aria-disabled')).toBe('true');
    fireEvent.click(lockedRow);
    expect(onSwitchPlayer).not.toHaveBeenCalled();

    // A finished game unlocks the rows for review even with Dev Mode off.
    act(() => wsState.onUpdate?.(finishedFrameView('p0', { devMode: false })));
    await waitFor(() => expect(screen.getByTestId('game-over-banner')).toBeTruthy());
    const reviewRow = screen.getByTestId('player-row-p1');
    expect(reviewRow.getAttribute('data-pov-clickable')).toBe('true');
    fireEvent.click(reviewRow);
    expect(onSwitchPlayer).toHaveBeenCalledWith('p1');
  });

  it('ITEM-5/6: drag reordering switches HAND SORTING to Custom and preserves the order', async () => {
    getGameView.mockResolvedValue(sortableView);
    getGameReplay.mockResolvedValue({ gameId: 'game-1', moves: [], frames: [] });

    const { container } = render(
      <GamePage gameId="game-1" playerId="p0" onSwitchPlayer={() => {}} />,
    );

    await waitFor(() => expect(screen.getByTestId('sort-select')).toBeTruthy());
    // ITEM-5: the dropdown defaults to Rank for a new user.
    expect((screen.getByTestId('sort-select') as HTMLSelectElement).value).toBe('rank');

    const handOrder = (): string[] =>
      Array.from(
        (container.querySelector('[data-zone="player-hand"]') as HTMLElement).querySelectorAll(
          '.card-slot',
        ),
      ).map((slot) => `${slot.getAttribute('data-suit')}:${slot.getAttribute('data-rank')}`);
    expect(handOrder()).toEqual(['hearts:six', 'clubs:ace', 'spades:king']);

    const handBox = screen.getByTestId('hand-turn-highlight');
    vi.spyOn(handBox, 'getBoundingClientRect').mockReturnValue({
      left: 0,
      top: 0,
      right: 300,
      bottom: 140,
      width: 300,
      height: 140,
      x: 0,
      y: 0,
      toJSON: () => ({}),
    } as DOMRect);

    fireEvent.dragStart(screen.getByLabelText('six of hearts'), {
      dataTransfer: { setData: vi.fn() },
    });
    fireEvent(
      handBox,
      new MouseEvent('dragover', { bubbles: true, cancelable: true, clientX: 300 }),
    );
    fireEvent(handBox, new MouseEvent('drop', { bubbles: true, cancelable: true, clientX: 300 }));

    await waitFor(() =>
      expect((screen.getByTestId('sort-select') as HTMLSelectElement).value).toBe('custom'),
    );
    expect(handOrder()).toEqual(['clubs:ace', 'spades:king', 'hearts:six']);

    // A later projection keeps the custom order, drops played cards and appends
    // every newly drawn card at the end.
    act(() =>
      wsState.onUpdate?.({
        ...sortableView,
        myHand: [
          { suit: 'clubs', rank: 'ace' },
          { suit: 'hearts', rank: 'six' },
          { suit: 'diamonds', rank: 'two' },
        ],
      }),
    );
    await waitFor(() => expect(handOrder()).toEqual(['clubs:ace', 'hearts:six', 'diamonds:two']));
  });
});

/**
 * T-90-2: the Wave-1 human QA feedback — replay heading, uniform status labels
 * and the brighter Dark-mode face-down card outline.
 */
describe('T-90-2 theme, controls and status labels', () => {
  it('ITEM-16: titles the replay panel REPLAY CONTROLS', async () => {
    getGameView.mockResolvedValue(finishedFrameView('p0'));
    getGameReplay.mockResolvedValue({ gameId: 'game-1', moves: [], frames: [] });

    render(<GamePage gameId="game-1" playerId="p0" onSwitchPlayer={() => {}} />);

    const nav = await screen.findByTestId('review-nav');
    expect(within(nav).getByRole('heading', { name: 'REPLAY CONTROLS' })).toBeTruthy();
    expect(within(nav).queryByRole('heading', { name: 'Replay' })).toBeNull();
  });

  it('ITEM-3: shares one borderless WINNER / OUT / PASSED label and borders only DURAK', async () => {
    // A live seat that passed wears the same uniform label as WINNER / OUT.
    getGameView.mockResolvedValue({ ...view, myHasPassed: true });
    getGameReplay.mockResolvedValue({ gameId: 'game-1', moves: [], frames: [] });
    const live = render(<GamePage gameId="game-1" playerId="p0" onSwitchPlayer={() => {}} />);

    const passedSlot = await screen.findByTestId('player-status-tag-p0');
    expect(passedSlot.textContent).toBe('PASSED');
    const passedTag = passedSlot.querySelector('.status-tag')!;
    expect(passedTag.classList.contains('status-out')).toBe(true);
    expect(passedTag.getAttribute('data-status')).toBe('PASSED');
    live.unmount();

    // A finished match shows WINNER and DURAK: only DURAK is bordered.
    getGameView.mockResolvedValue(finishedFrameView('p0'));
    const finished = render(<GamePage gameId="game-1" playerId="p0" onSwitchPlayer={() => {}} />);

    const winnerSlot = await screen.findByTestId('player-status-tag-p1');
    expect(winnerSlot.textContent).toBe('WINNER');
    expect(winnerSlot.querySelector('.status-tag')!.classList.contains('status-out')).toBe(true);
    const durakSlot = screen.getByTestId('player-status-tag-p0');
    expect(durakSlot.textContent).toBe('DURAK');
    expect(durakSlot.querySelector('.status-tag')!.classList.contains('status-durak')).toBe(true);
    finished.unmount();

    // Light mode: WINNER / OUT / PASSED share one darker, borderless palette.
    const lightOut = cssRule(appCss, ":root[data-theme='light'] .status-tag.winner-tag");
    expect(lightOut).toContain('background: #cbd5e1');
    expect(lightOut).toContain('color: #1e293b');
    expect(lightOut).toContain('border: none');
    expect(lightOut).toContain('font-weight: 700');
    // The one rule lists all three, so they can never diverge in colour again.
    expect(appCss).toMatch(
      /:root\[data-theme='light'\] \.status-tag\.out-tag,[\s\S]*?:root\[data-theme='light'\] \.status-tag\.passed-tag/,
    );
    // DURAK is the only label in Light mode with a visible border.
    const lightDurak = cssRule(appCss, ":root[data-theme='light'] .status-tag.durak-tag");
    expect(lightDurak).toContain('border: 1px solid #dc2626');
    expect(lightDurak).toContain('color: #991b1b');
    // Dark mode keeps the same uniform, borderless trio.
    const darkOut = cssRule(appCss, '.status-tag.passed-tag');
    expect(darkOut).toContain('border: none');
    expect(cssRule(appCss, '.status-tag.durak-tag')).toContain('border: 1px solid #b45309');
  });

  it('ITEM-17: brightens the Dark-mode face-down card outline only', () => {
    expect(tableCss).toMatch(
      /:root\[data-theme='dark'\] \.playing-card\.card-back\s*{[^}]*border: 1px solid rgba\(203, 213, 225, 0\.65\)/,
    );
    // Light mode keeps its own crisp outline and no extra dark-theme border.
    expect(tableCss).not.toMatch(
      /:root\[data-theme='light'\] \.playing-card\.card-back\s*{[^}]*rgba\(203, 213, 225/,
    );
  });
});

/**
 * T-90-feedback-20261105_221105-3: ITEM-1a throw-in outline visibility, ITEM-5
 * multi-card click-select + double-click throw-in (no "Throw In" button) and
 * ITEM-6/7 icon-only Surrender / Pass controls, all wired through GamePage.
 */
describe('T-90-feedback-20261105_221105-3: throw-in gate, multi-card throw-in and action icons', () => {
  beforeEach(() => {
    getGameView.mockReset();
    getGameReplay.mockReset();
    sendAction.mockReset();
    createPresetGameMock.mockReset();
    wsState.onUpdate = null;
    getGameReplay.mockResolvedValue({ gameId: 'game-1', moves: [], frames: [] });
    window.location.hash = '';
  });

  const throwInView: PlayerGameView = {
    ...view,
    myId: 'p0',
    myName: 'Alice',
    myHand: [
      { suit: 'hearts', rank: 'seven' },
      { suit: 'clubs', rank: 'seven' },
      { suit: 'diamonds', rank: 'nine' },
    ],
    opponents: [{ id: 'p1', name: 'Bob', cardCount: 6, hasPassed: false, finishRank: null }],
    tablePairs: [{ attack: { suit: 'spades', rank: 'seven' }, defense: null }],
    trumpSuit: 'clubs',
    attackerIdx: 0,
    defenderIdx: 1,
    boutPhase: 'Defense',
    legalActions: ['throwIn', 'pass'],
    maxBoutAttacks: 6,
    // T-90: the outline is now gated by the backend projection.
    canThrowIn: true,
    throwInCards: [
      { suit: 'hearts', rank: 'seven' },
      { suit: 'clubs', rank: 'seven' },
    ],
    throwInCapacity: 5,
  };

  const renderGame = (override: PlayerGameView, playerId = 'p0') => {
    getGameView.mockResolvedValue(override);
    return render(
      <GamePage gameId="game-1" playerId={playerId} onSwitchPlayer={() => {}} />,
    );
  };

  const handCard = (label: string): HTMLElement =>
    screen.getByLabelText(label).closest('.card-slot') as HTMLElement;

  it('ITEM-1a: shows the throw-in outline to a player who can legally throw in', async () => {
    renderGame(throwInView);

    const outline = await screen.findByTestId('throw-in-outline');
    expect(outline.getAttribute('data-drop-zone')).toBe('throw-in');
    expect(outline.getAttribute('data-throw-in-enabled')).toBe('true');
    expect(screen.queryByTestId('surrender-throw-in-anchor')).toBeNull();
  });

  it('ITEM-1a: keeps the detached surrender anchor while the throw-in is still legal', async () => {
    renderGame({ ...throwInView, boutPhase: 'SurrenderThrowIn' });

    const anchor = await screen.findByTestId('surrender-throw-in-anchor');
    expect(within(anchor).getByTestId('throw-in-outline')).toBeTruthy();
  });

  it('ITEM-1a: hides the outline from the defending player', async () => {
    renderGame(
      {
        ...throwInView,
        myId: 'p1',
        myName: 'Bob',
        myHand: [{ suit: 'clubs', rank: 'seven' }],
        opponents: [
          { id: 'p0', name: 'Alice', cardCount: 6, hasPassed: false, finishRank: null },
        ],
        attackerIdx: 0,
        defenderIdx: 1,
        legalActions: ['cover', 'surrender', 'throwIn'],
        canThrowIn: false,
      },
      'p1',
    );

    await screen.findByTestId('surrender-button');
    expect(screen.queryByTestId('throw-in-outline')).toBeNull();
    expect(screen.queryByTestId('throw-in-slot')).toBeNull();
  });

  it('ITEM-1a: hides the outline when no hand card matches a rank on the table', async () => {
    renderGame({
      ...throwInView,
      myHand: [{ suit: 'hearts', rank: 'ace' }],
      legalActions: ['throwIn', 'pass'],
      canThrowIn: false,
      throwInCards: [],
    });

    await screen.findByTestId('hand-turn-highlight');
    expect(screen.queryByTestId('throw-in-outline')).toBeNull();
  });

  it('ITEM-1a: hides the outline and the surrender anchor after this player passed', async () => {
    renderGame({
      ...throwInView,
      myHand: [{ suit: 'clubs', rank: 'seven' }],
      boutPhase: 'SurrenderThrowIn',
      legalActions: ['pass'],
      myHasPassed: true,
      canThrowIn: false,
    });

    await screen.findByTestId('hand-turn-highlight');
    expect(screen.queryByTestId('throw-in-outline')).toBeNull();
    // T-90: the anchor survives only as an empty, invisible, handler-free
    // spacer so the half-off taken cards do not jump.
    const spacer = screen.queryByTestId('surrender-throw-in-anchor');
    if (spacer) {
      expect(spacer.getAttribute('data-outline-hidden')).toBe('true');
      expect(spacer.children).toHaveLength(0);
    }
  });

  it('ITEM-5: selects legal cards and throws them all in with one double-click', async () => {
    renderGame(throwInView);
    sendAction.mockResolvedValue(throwInView);

    await screen.findByTestId('throw-in-outline');
    // The old dedicated button is gone for good.
    expect(screen.queryByText('Throw In')).toBeNull();
    expect(screen.queryByRole('button', { name: 'Throw In' })).toBeNull();

    fireEvent.click(handCard('seven of hearts'));
    fireEvent.click(handCard('seven of clubs'));

    await waitFor(() =>
      expect(
        document.querySelectorAll('.hand-card-wrapper[data-selected="true"]'),
      ).toHaveLength(2),
    );
    // Real double-click order: the first click (detail 1) toggles the card off,
    // the second click (detail 2) is ignored, and the pre-click snapshot keeps
    // it in the group so `dblClick` still deploys both sevens.
    fireEvent.click(handCard('seven of clubs'), { detail: 1 });
    await waitFor(() =>
      expect(
        document.querySelectorAll('.hand-card-wrapper[data-selected="true"]'),
      ).toHaveLength(1),
    );
    fireEvent.click(handCard('seven of clubs'), { detail: 2 });
    expect(
      document.querySelectorAll('.hand-card-wrapper[data-selected="true"]'),
    ).toHaveLength(1);

    fireEvent.dblClick(handCard('seven of clubs'));

    await waitFor(() => expect(sendAction).toHaveBeenCalledTimes(1));
    const action = sendAction.mock.calls[0][1] as {
      type: string;
      playerId: string;
      cards: { suit: string; rank: string }[];
    };
    expect(action.type).toBe('throwInCards');
    expect(action.playerId).toBe('p0');
    expect(action.cards).toHaveLength(2);
    expect(action.cards.map((card) => `${card.rank}:${card.suit}`).sort()).toEqual([
      'seven:clubs',
      'seven:hearts',
    ]);
  });

  it('ITEM-5: reflects every selected same-rank card with one double-click', async () => {
    renderGame({
      ...throwInView,
      myHand: [
        { suit: 'hearts', rank: 'seven' },
        { suit: 'clubs', rank: 'seven' },
        { suit: 'diamonds', rank: 'nine' },
      ],
      opponents: [{ id: 'p1', name: 'Bob', cardCount: 6, hasPassed: false, finishRank: null }],
      attackerIdx: 1,
      defenderIdx: 0,
      legalActions: ['redirect', 'surrender', 'pass'],
    });
    sendAction.mockResolvedValue(throwInView);

    await screen.findByTestId('hand-turn-highlight');
    fireEvent.click(handCard('seven of hearts'));
    fireEvent.click(handCard('seven of clubs'));
    await waitFor(() =>
      expect(
        document.querySelectorAll('.hand-card-wrapper[data-selected="true"]'),
      ).toHaveLength(2),
    );

    // Real double-click order on an already-selected card: the first click
    // toggles it off, and the pre-click snapshot keeps it in the group.
    fireEvent.click(handCard('seven of hearts'), { detail: 1 });
    await waitFor(() =>
      expect(
        document.querySelectorAll('.hand-card-wrapper[data-selected="true"]'),
      ).toHaveLength(1),
    );
    fireEvent.click(handCard('seven of hearts'), { detail: 2 });
    fireEvent.dblClick(handCard('seven of hearts'));

    await waitFor(() => expect(sendAction).toHaveBeenCalledTimes(1));
    const action = sendAction.mock.calls[0][1] as {
      type: string;
      cards: { suit: string; rank: string }[];
    };
    expect(action.type).toBe('redirectAttack');
    expect(action.cards).toHaveLength(2);
    expect(action.cards.map((card) => `${card.rank}:${card.suit}`).sort()).toEqual([
      'seven:clubs',
      'seven:hearts',
    ]);
  });

  it('ITEM-6/7: renders compact icon-only Surrender and Pass buttons in the table corner', async () => {
    renderGame({
      ...throwInView,
      // `cover` disarms the client auto-surrender and `throwIn` the auto-pass,
      // so both buttons render with no countdown text.
      legalActions: ['pass', 'surrender', 'cover', 'throwIn'],
      turnPlayerId: 'p1',
    });

    const surrender = await screen.findByTestId('surrender-button');
    const pass = screen.getByTestId('pass-button');
    for (const [button, label, iconId, iconName] of [
      [surrender, 'Surrender — take the cards', 'surrender-icon', 'surrender-hands-cards'],
      [pass, 'Pass — done throwing in', 'pass-icon', 'pass-wave-cards'],
    ] as const) {
      expect(button.tagName).toBe('BUTTON');
      expect(button.textContent).toBe('');
      expect(button.getAttribute('aria-label')).toBe(label);
      expect(button.getAttribute('title')).toBe(label);
      expect(button.classList.contains('action-icon-btn')).toBe(true);
      expect(within(button).getByTestId(iconId).getAttribute('data-icon')).toBe(iconName);
    }

    const surrenderIcon = within(surrender).getByTestId('surrender-icon');
    expect(surrenderIcon.querySelector('[data-icon-part="cards"]')).not.toBeNull();
    expect(surrenderIcon.querySelector('[data-icon-part="arrow-down"]')).not.toBeNull();
    expect(surrenderIcon.querySelector('[data-icon-part="raised-hands"]')).not.toBeNull();
    const passIcon = within(pass).getByTestId('pass-icon');
    expect(passIcon.querySelector('[data-icon-part="cards"]')).not.toBeNull();
    expect(passIcon.querySelector('[data-icon-part="pass-hand"]')).not.toBeNull();
    expect(passIcon.querySelector('[data-icon-part="arrow-pass"]')).not.toBeNull();

    // There is no "Throw In" button even while the server lists throw-ins.
    expect(screen.queryByRole('button', { name: /throw in/i })).toBeNull();

    // Both stay in the bottom-right controls column of the felt table.
    const controls = surrender.closest('[data-zone="player-controls"]');
    expect(controls).not.toBeNull();
    expect(controls?.contains(pass)).toBe(true);
    expect(surrender.closest('[data-zone="table-arena"]')).not.toBeNull();
  });

  it('QA: offers the full-hand-pickup preset beside surrender-half-off in the left sidebar', async () => {
    createPresetGameMock.mockResolvedValue({ gameId: 'preset-f', defaultPlayerId: 'p0' });
    renderGame(view);

    const panel = await screen.findByTestId('qa-scenarios');
    expect(panel.closest('[data-zone="sidebar-left"]')).not.toBeNull();
    expect(within(panel).getByTestId('preset-btn-surrender-half-off')).toBeTruthy();
    const pickup = within(panel).getByTestId('preset-btn-full-hand-pickup');
    expect(pickup.textContent).toBe('Full Hand Pickup (30 Cards)');

    fireEvent.click(pickup);
    await waitFor(() => expect(createPresetGameMock).toHaveBeenCalledWith('full-hand-pickup'));
  });
});

/**
 * T-90-feedback-20261105_221105-3 (review round 2): the throw-in gate must not
 * trust an empty server `legalActions` list and must never point at a
 * bot-locked seat a human cannot act for.
 */
describe('T-90-feedback-20261105_221105-3 round 2: throw-in gate precision', () => {
  beforeEach(() => {
    getGameView.mockReset();
    getGameReplay.mockReset();
    sendAction.mockReset();
    createPresetGameMock.mockReset();
    wsState.onUpdate = null;
    getGameReplay.mockResolvedValue({ gameId: 'game-1', moves: [], frames: [] });
  });

  const baseView: PlayerGameView = {
    ...view,
    myId: 'p0',
    myName: 'Alice',
    myHand: [
      { suit: 'hearts', rank: 'seven' },
      { suit: 'clubs', rank: 'seven' },
    ],
    opponents: [{ id: 'p1', name: 'Bob', cardCount: 6, hasPassed: false, finishRank: null }],
    tablePairs: [{ attack: { suit: 'spades', rank: 'seven' }, defense: null }],
    trumpSuit: 'clubs',
    attackerIdx: 0,
    defenderIdx: 1,
    boutPhase: 'Defense',
    legalActions: ['throwIn', 'pass'],
    maxBoutAttacks: 6,
  };

  it('ITEM-1a: draws no outline on a bot-locked seat, even with a matching card', async () => {
    getGameView.mockResolvedValue({ ...baseView, isBot: true });
    render(<GamePage gameId="game-1" playerId="p0" onSwitchPlayer={() => {}} />);

    await screen.findByTestId('hand-turn-highlight');
    expect(
      document.querySelector('[data-zone="table-arena"]')?.getAttribute('data-bot-locked'),
    ).toBe('true');
    expect(screen.queryByTestId('throw-in-outline')).toBeNull();
    expect(screen.queryByTestId('throw-in-slot')).toBeNull();
    expect(screen.queryByTestId('surrender-throw-in-anchor')).toBeNull();
  });

  it('ITEM-1a: an empty server legalActions list forbids the outline', async () => {
    getGameView.mockResolvedValue({ ...baseView, legalActions: [] });
    render(<GamePage gameId="game-1" playerId="p0" onSwitchPlayer={() => {}} />);

    await screen.findByTestId('hand-turn-highlight');
    // A matching rank in hand is not enough: the server listed no legal action.
    expect(screen.queryByTestId('throw-in-outline')).toBeNull();
    expect(screen.queryByTestId('throw-in-slot')).toBeNull();
    expect(
      screen.getByTestId('hand-turn-highlight').getAttribute('data-highlighted'),
    ).toBe('false');
  });

  it('ITEM-1a: still shows the outline when the server lists the throw-in', async () => {
    getGameView.mockResolvedValue({ ...baseView, canThrowIn: true });
    render(<GamePage gameId="game-1" playerId="p0" onSwitchPlayer={() => {}} />);

    const outline = await screen.findByTestId('throw-in-outline');
    expect(outline.getAttribute('data-throw-in-enabled')).toBe('true');
  });
});

describe('T-90-feedback-20261106_111512-3: backend canThrowIn gate and new presets', () => {
  beforeEach(() => {
    getGameView.mockReset();
    getGameReplay.mockReset();
    createPresetGameMock.mockReset();
    wsState.onUpdate = null;
    getGameReplay.mockResolvedValue({ gameId: 'game-1', moves: [], frames: [] });
    window.location.hash = '';
  });

  const t90View: PlayerGameView = {
    ...view,
    myId: 'p0',
    myName: 'Alice',
    myHand: [
      { suit: 'hearts', rank: 'seven' },
      { suit: 'clubs', rank: 'nine' },
    ],
    opponents: [{ id: 'p1', name: 'Bob', cardCount: 6, hasPassed: false, finishRank: null }],
    tablePairs: [{ attack: { suit: 'spades', rank: 'seven' }, defense: null }],
    trumpSuit: 'clubs',
    attackerIdx: 0,
    defenderIdx: 1,
    boutPhase: 'Defense',
    legalActions: ['throwIn', 'pass'],
    maxBoutAttacks: 6,
  };

  const renderT90 = (override: PlayerGameView) => {
    getGameView.mockResolvedValue(override);
    return render(<GamePage gameId="game-1" playerId="p0" onSwitchPlayer={() => {}} />);
  };

  it('renders the outline from the backend canThrowIn projection', async () => {
    renderT90({ ...t90View, canThrowIn: true });
    expect(await screen.findByTestId('throw-in-outline')).toBeTruthy();
  });

  it('hides the outline when the backend projects canThrowIn false', async () => {
    renderT90({ ...t90View, canThrowIn: false });
    await screen.findByTestId('hand-turn-highlight');
    expect(screen.queryByTestId('throw-in-outline')).toBeNull();
    expect(document.querySelector('[data-drop-zone="throw-in"]')).toBeNull();
  });

  it('lists and launches the four new presets from the left sidebar', async () => {
    renderT90({ ...t90View, canThrowIn: false });
    const panel = await screen.findByTestId('qa-scenarios');

    for (const id of [
      'throw-in-visibility-4p',
      'throw-in-capacity-cap',
      'huge-hand-36',
      'huge-hand-52',
    ]) {
      expect(within(panel).getByTestId(`preset-btn-${id}`)).toBeTruthy();
    }

    createPresetGameMock.mockResolvedValue({ gameId: 'preset-t90', defaultPlayerId: 'p0' });
    fireEvent.click(within(panel).getByTestId('preset-btn-huge-hand-52'));
    await waitFor(() => expect(createPresetGameMock).toHaveBeenCalledWith('huge-hand-52'));
  });
});
