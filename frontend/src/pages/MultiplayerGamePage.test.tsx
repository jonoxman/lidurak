import { act, fireEvent, render, screen, waitFor } from '@testing-library/preact';
import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../api/sessionClient', () => ({
  getOrCreateSession: vi.fn(),
}));

vi.mock('../api/lobbyClient', () => ({
  fetchGameView: vi.fn(),
  joinRoom: vi.fn(),
  leaveRoom: vi.fn(),
}));

vi.mock('../api/gameSocket', () => ({
  createGameSocket: vi.fn(),
}));

import * as gameSocketApi from '../api/gameSocket';
import * as lobbyApi from '../api/lobbyClient';
import * as sessionApi from '../api/sessionClient';
import {
  MultiplayerGamePage,
  multiplayerLegalActions,
  multiplayerOpponents,
} from './MultiplayerGamePage';
import lobbyCss from '../styles/lobby.css?raw';
import type {
  Card,
  PlayerGameView,
  RoomSeatView,
  WsClientMessage,
} from '../types/multiplayer';

const getOrCreateSession =
  sessionApi.getOrCreateSession as unknown as ReturnType<typeof vi.fn>;
const fetchGameView = lobbyApi.fetchGameView as unknown as ReturnType<typeof vi.fn>;
const joinRoom = lobbyApi.joinRoom as unknown as ReturnType<typeof vi.fn>;
const leaveRoom = lobbyApi.leaveRoom as unknown as ReturnType<typeof vi.fn>;
const createGameSocket =
  gameSocketApi.createGameSocket as unknown as ReturnType<typeof vi.fn>;

const CARD = (suit: string, rank: string): Card => ({ suit, rank });

const PLAYERS = [
  {
    id: 'guest-abcd1234',
    name: 'Guest-AB12',
    rating: null,
    cardCount: 6,
    isConnected: true,
    hasPassed: false,
    finishRank: null,
    seatIndex: 0,
  },
  {
    id: 'p1',
    name: 'Opponent',
    rating: null,
    cardCount: 6,
    isConnected: true,
    hasPassed: false,
    finishRank: null,
    seatIndex: 1,
  },
];

const SEAT = (seatIndex: number, playerId: string | null, name: string | null): RoomSeatView => ({
  seatIndex,
  playerId,
  displayName: name,
  isConnected: playerId !== null,
});

/** A complete `PlayerGameView`, overridden per scenario. */
const makeView = (overrides: Partial<PlayerGameView> = {}): PlayerGameView => ({
  gameId: 'room-1',
  status: 'InProgress',
  config: {
    playerCount: 2,
    allowRedirect: true,
    turnTimeoutSeconds: 15,
    isPublic: true,
  },
  viewerId: 'guest-abcd1234',
  viewerSeat: 0,
  hand: [CARD('hearts', 'six'), CARD('spades', 'ace'), CARD('clubs', 'nine')],
  players: PLAYERS,
  seats: [SEAT(0, 'guest-abcd1234', 'Guest-AB12'), SEAT(1, 'p1', 'Opponent')],
  tablePairs: [],
  talonCount: 20,
  bottomTrumpCard: null,
  trumpSuit: 'spades',
  discardCount: 0,
  phase: 'initialAttack',
  attackerIdx: 0,
  defenderIdx: 1,
  maxBoutAttacks: 6,
  finishOrder: [],
  isDraw: false,
  durakId: null,
  turnDeadlineEpochMs: null,
  ...overrides,
});

const waitingView = (overrides: Partial<PlayerGameView> = {}): PlayerGameView =>
  makeView({
    status: 'WaitingForPlayers',
    hand: [],
    players: [],
    tablePairs: [],
    talonCount: 0,
    trumpSuit: null,
    phase: null,
    attackerIdx: null,
    defenderIdx: null,
    turnDeadlineEpochMs: null,
    seats: [SEAT(0, 'guest-abcd1234', 'Guest-AB12'), SEAT(1, null, null)],
    ...overrides,
  });

let handlers: import('../api/gameSocket').GameSocketHandlers | null = null;
let sent: WsClientMessage[] = [];
let dispose: ReturnType<typeof vi.fn>;
let order: string[] = [];

const installSocket = () => {
  createGameSocket.mockImplementation(
    (_gameId: string, socketHandlers: import('../api/gameSocket').GameSocketHandlers) => {
      order.push('socket');
      handlers = socketHandlers;
      return {
        status: 'connected' as const,
        sendAction: (message: WsClientMessage) => sent.push(message),
        dispose,
      };
    },
  );
};

const renderPage = (onNavigateLobby = vi.fn()) => {
  const rendered = render(
    <MultiplayerGamePage gameId="room-1" onNavigateLobby={onNavigateLobby} />,
  );
  return { ...rendered, onNavigateLobby };
};

const handWrappers = (): HTMLElement[] =>
  Array.from(document.querySelectorAll('.hand-card-wrapper')) as HTMLElement[];

const arena = (): HTMLElement | null =>
  document.querySelector('[data-zone="table-arena"]') as HTMLElement | null;

describe('MultiplayerGamePage lifecycle', () => {
  beforeEach(() => {
    vi.resetAllMocks();
    handlers = null;
    sent = [];
    order = [];
    dispose = vi.fn();
    installSocket();

    getOrCreateSession.mockResolvedValue({
      playerId: 'guest-abcd1234',
      displayName: 'Guest-AB12',
      isGuest: true,
    });
    fetchGameView.mockResolvedValue(waitingView());
    joinRoom.mockResolvedValue({ gameId: 'room-1', seatIndex: 1, view: waitingView() });
    leaveRoom.mockResolvedValue(undefined);

    Object.defineProperty(navigator, 'clipboard', {
      configurable: true,
      value: { writeText: vi.fn(async () => {}) },
    });
  });

  it('establishes the session and initial view before opening the socket', async () => {
    getOrCreateSession.mockImplementation(async () => {
      order.push('session');
      return { playerId: 'guest-abcd1234', displayName: 'Guest-AB12', isGuest: true };
    });
    fetchGameView.mockImplementation(async () => {
      order.push('view');
      return waitingView();
    });

    renderPage();
    await screen.findByTestId('waiting-room');

    expect(order).toEqual(['session', 'view', 'socket']);
    expect(fetchGameView).toHaveBeenCalledWith('room-1');
    expect(createGameSocket).toHaveBeenCalledTimes(1);
    expect(createGameSocket.mock.calls[0][0]).toBe('room-1');
  });

  it('renders a not-found state with a Back to Lobby action on a 404', async () => {
    fetchGameView.mockRejectedValue(
      Object.assign(new Error('not found'), { status: 404 }),
    );
    const onExit = vi.fn();
    renderPage(onExit);

    expect(await screen.findByTestId('game-not-found')).toBeTruthy();
    expect(screen.getByText(/Room not found/)).toBeTruthy();
    expect(createGameSocket).not.toHaveBeenCalled();

    fireEvent.click(screen.getByRole('button', { name: 'Back to Lobby' }));
    expect(onExit).toHaveBeenCalledTimes(1);
  });
});

describe('MultiplayerGamePage waiting room', () => {
  beforeEach(() => {
    vi.resetAllMocks();
    handlers = null;
    sent = [];
    order = [];
    dispose = vi.fn();
    installSocket();
    getOrCreateSession.mockResolvedValue({
      playerId: 'guest-abcd1234',
      displayName: 'Guest-AB12',
      isGuest: true,
    });
    fetchGameView.mockResolvedValue(waitingView());
    leaveRoom.mockResolvedValue(undefined);
    Object.defineProperty(navigator, 'clipboard', {
      configurable: true,
      value: { writeText: vi.fn(async () => {}) },
    });
  });

  it('renders the room header, seats, invite URL and copy feedback', async () => {
    renderPage();
    await screen.findByTestId('waiting-room');

    expect(screen.getByText('Room room-1')).toBeTruthy();
    expect(screen.getByTestId('waiting-seat-count').textContent).toBe('1 / 2');
    expect(screen.getByText('36-card deck')).toBeTruthy();
    expect(screen.getByText('15s')).toBeTruthy();
    expect(screen.getByTestId('waiting-redirect').textContent).toBe('Redirect ON');
    expect(screen.getByText('Public')).toBeTruthy();

    const seat0 = screen.getByTestId('waiting-seat-0');
    const seat1 = screen.getByTestId('waiting-seat-1');
    expect(seat0.textContent).toContain('Guest-AB12');
    expect(seat1.textContent).toContain('Open seat');

    expect(screen.getByTestId('invite-url').textContent).toBe(
      `${window.location.origin}/g/room-1`,
    );

    fireEvent.click(screen.getByTestId('copy-invite'));
    await waitFor(() =>
      expect(navigator.clipboard.writeText).toHaveBeenCalledWith(
        `${window.location.origin}/g/room-1`,
      ),
    );
    expect((await screen.findByTestId('copy-invite')).textContent).toBe('Copied!');
  });

  it('joins an open seat and swaps to the M1 gameplay table', async () => {
    fetchGameView.mockResolvedValue(waitingView({ viewerSeat: null }));
    joinRoom.mockResolvedValue({
      gameId: 'room-1',
      seatIndex: 1,
      view: makeView({ viewerSeat: 1 }),
    });

    renderPage();
    await screen.findByTestId('waiting-room');

    fireEvent.click(screen.getByTestId('join-seat'));
    await waitFor(() => expect(joinRoom).toHaveBeenCalledWith('room-1'));

    expect(await screen.findByTestId('hand-sort-box')).toBeTruthy();
    expect(arena()).not.toBeNull();
    expect(handWrappers()).toHaveLength(3);
  });

  it('leaves the room and returns to the lobby', async () => {
    const { onNavigateLobby } = renderPage();
    await screen.findByTestId('waiting-room');

    fireEvent.click(screen.getByTestId('leave-room'));
    await waitFor(() => expect(leaveRoom).toHaveBeenCalledWith('room-1'));
    expect(onNavigateLobby).toHaveBeenCalledTimes(1);
  });

  it('updates the room from incoming socket gameViewUpdate frames', async () => {
    renderPage();
    await screen.findByTestId('waiting-room');

    expect(screen.getByTestId('waiting-seat-1').textContent).toContain('Open seat');

    act(() => {
      handlers?.onView?.(
        waitingView({
          seats: [SEAT(0, 'guest-abcd1234', 'Guest-AB12'), SEAT(1, 'p1', 'Opponent')],
        }),
      );
    });

    await waitFor(() =>
      expect(screen.getByTestId('waiting-seat-1').textContent).toContain('Opponent'),
    );
  });
});

describe('MultiplayerGamePage M1 gameplay interface', () => {
  beforeEach(() => {
    vi.resetAllMocks();
    handlers = null;
    sent = [];
    order = [];
    dispose = vi.fn();
    installSocket();
    getOrCreateSession.mockResolvedValue({
      playerId: 'guest-abcd1234',
      displayName: 'Guest-AB12',
      isGuest: true,
    });
    fetchGameView.mockResolvedValue(makeView());
  });

  it('renders the GameTable, TableDeck, SortBar, ActionBar shell and no placeholder table', async () => {
    const { container } = renderPage();
    await screen.findByTestId('hand-sort-box');

    // Lichess 3-column M1 shell.
    expect(container.querySelector('.game-shell')).not.toBeNull();
    expect(container.querySelectorAll('[data-zone="sidebar-left"]')).toHaveLength(1);
    expect(container.querySelectorAll('[data-zone="sidebar-right"]')).toHaveLength(1);
    expect(container.querySelector('.table-column')).not.toBeNull();
    expect(container.querySelector('[data-zone="player-hand"] .hand-cards')).not.toBeNull();
    expect(arena()).not.toBeNull();
    expect(screen.getByTestId('clock-panel')).toBeTruthy();
    expect(screen.getByTestId('game-clock')).toBeTruthy();
    expect(screen.getByTestId('turn-clock')).toBeTruthy();
    expect(screen.getByTestId('sort-bar')).toBeTruthy();
    expect(screen.getByTestId('talon-count').textContent).toBe('20');

    // The placeholder projected table is gone for good.
    expect(container.querySelector('.mp-shell')).toBeNull();
    expect(container.querySelector('.mp-arena')).toBeNull();
    expect(screen.queryByTestId('projected-table')).toBeNull();
    expect(screen.queryByTestId('action-play')).toBeNull();

    // Only the viewer's hand is rendered; opponents are counts.
    expect(handWrappers()).toHaveLength(3);
    expect(screen.getByLabelText('six of hearts')).toBeTruthy();
    const opponents = screen.getAllByTestId('opponent');
    expect(opponents).toHaveLength(1);
    expect(opponents[0].textContent).toContain('Opponent');

    // SortBar drives the display order.
    const select = screen.getByTestId('sort-select') as HTMLSelectElement;
    expect(select.getAttribute('data-sort-mode')).toBe('rank');
    fireEvent.change(select, { target: { value: 'suit' } });
    expect(select.getAttribute('data-sort-mode')).toBe('suit');
  });

  it('double-clicks a hand card into a playAttack over the GameSocket', async () => {
    renderPage();
    await screen.findByTestId('hand-sort-box');

    fireEvent.dblClick(screen.getByLabelText('six of hearts'));
    expect(sent).toEqual([{ type: 'playAttack', cards: [CARD('hearts', 'six')] }]);
  });

  it('covers with a double-clicked card as the defender', async () => {
    fetchGameView.mockResolvedValue(
      makeView({
        defenderIdx: 0,
        attackerIdx: 1,
        phase: 'defense',
        tablePairs: [{ attack: CARD('diamonds', 'eight'), defense: null }],
        hand: [CARD('diamonds', 'king')],
      }),
    );

    renderPage();
    await screen.findByTestId('hand-sort-box');

    fireEvent.dblClick(screen.getByLabelText('king of diamonds'));
    expect(sent).toEqual([
      {
        type: 'coverCard',
        attackIndex: 0,
        defenseCard: CARD('diamonds', 'king'),
      },
    ]);
  });

  it('redirects a same-rank card when covering it is impossible', async () => {
    fetchGameView.mockResolvedValue(
      makeView({
        defenderIdx: 0,
        attackerIdx: 1,
        phase: 'defense',
        tablePairs: [{ attack: CARD('diamonds', 'eight'), defense: null }],
        hand: [CARD('clubs', 'eight')],
      }),
    );

    renderPage();
    await screen.findByTestId('hand-sort-box');

    expect(screen.getByTestId('redirect-outline')).toBeTruthy();
    fireEvent.dblClick(screen.getByLabelText('eight of clubs'));
    expect(sent).toEqual([
      { type: 'redirectAttack', cards: [CARD('clubs', 'eight')] },
    ]);
  });

  it('renders ActionBar Pass / Surrender from the projected phase', async () => {
    fetchGameView.mockResolvedValue(
      makeView({
        defenderIdx: 1,
        attackerIdx: 0,
        phase: 'defense',
        tablePairs: [
          {
            attack: CARD('diamonds', 'eight'),
            defense: CARD('diamonds', 'king'),
          },
        ],
      }),
    );

    const { unmount } = renderPage();
    await screen.findByTestId('hand-sort-box');
    expect(screen.getByTestId('pass-button')).toBeTruthy();
    expect(screen.queryByTestId('surrender-button')).toBeNull();
    fireEvent.click(screen.getByTestId('pass-button'));
    expect(sent).toEqual([{ type: 'passTurn' }]);
    unmount();

    fetchGameView.mockResolvedValue(
      makeView({
        defenderIdx: 0,
        attackerIdx: 1,
        phase: 'defense',
        tablePairs: [{ attack: CARD('diamonds', 'eight'), defense: null }],
        hand: [CARD('hearts', 'six')],
      }),
    );
    renderPage();
    await screen.findByTestId('hand-sort-box');
    expect(screen.getByTestId('surrender-button')).toBeTruthy();
    fireEvent.click(screen.getByTestId('surrender-button'));
    expect(sent[sent.length - 1]).toEqual({ type: 'declareSurrender' });
  });

  it('renders a zero-leak read-only spectator table with no hand or controls', async () => {
    fetchGameView.mockResolvedValue(
      makeView({ viewerSeat: null, hand: [], phase: 'defense' }),
    );

    const { container } = renderPage();
    await screen.findByTestId('hand-sort-box');

    expect(screen.getByTestId('spectator-badge').textContent).toBe(
      'Spectator Mode (Read-Only)',
    );
    expect(handWrappers()).toHaveLength(0);
    expect(arena()?.getAttribute('data-review-mode')).toBe('true');
    expect(screen.queryByTestId('action-bar')).toBeNull();
    expect(screen.queryByTestId('pass-button')).toBeNull();
    expect(screen.queryByTestId('surrender-button')).toBeNull();
    expect(container.querySelector('[data-zone="player-hand"]')).not.toBeNull();

    // Both seats are public names and counts only.
    expect(screen.getByTestId('roster-p1').textContent).toContain('Opponent');
    expect(screen.getByTestId('roster-guest-abcd1234').textContent).toContain(
      'Guest-AB12',
    );
  });

  it('shows the split 00:XX clock, talon and finished standings read-only', async () => {
    fetchGameView.mockResolvedValue(
      makeView({
        status: 'Finished',
        phase: 'gameOver',
        finishOrder: ['p1', 'guest-abcd1234'],
        durakId: 'guest-abcd1234',
        turnDeadlineEpochMs: Date.now() + 9000,
      }),
    );

    renderPage();
    await screen.findByTestId('hand-sort-box');

    expect(screen.getByTestId('turn-clock').textContent).toBe('00:00');
    expect(screen.getByTestId('talon-count').textContent).toBe('20');
    expect(screen.getByTestId('game-results').textContent).toContain('Opponent wins');
    expect(screen.getByTestId('durak-result').textContent).toBe(
      'Durak: Guest-AB12',
    );
    expect(screen.getByTestId('game-over-banner')).toBeTruthy();
    expect(arena()?.getAttribute('data-review-mode')).toBe('true');
    expect(screen.queryByTestId('pass-button')).toBeNull();
    expect(screen.queryByTestId('surrender-button')).toBeNull();
  });
});

describe('MultiplayerGamePage projection helpers', () => {
  it('orders opponents clockwise from the viewer seat', () => {
    const three = makeView({
      config: { ...makeView().config, playerCount: 3 },
      viewerSeat: 1,
      players: [
        { ...PLAYERS[0], seatIndex: 0 },
        { ...PLAYERS[0], id: 'p1', name: 'Me', seatIndex: 1 },
        { ...PLAYERS[1], id: 'p2', name: 'Next', seatIndex: 2 },
      ],
    });
    expect(multiplayerOpponents(three).map((opponent) => opponent.id)).toEqual([
      'p2',
      'guest-abcd1234',
    ]);

    // A spectator sees every seat in seat order.
    expect(
      multiplayerOpponents({ ...three, viewerSeat: null }).map((player) => player.id),
    ).toEqual(['guest-abcd1234', 'p1', 'p2']);
  });

  it('derives only the contextual pass / surrender commands', () => {
    expect(multiplayerLegalActions(makeView())).toEqual(['attack']);
    expect(
      multiplayerLegalActions(
        makeView({
          attackerIdx: 0,
          defenderIdx: 1,
          phase: 'defense',
          tablePairs: [{ attack: CARD('diamonds', 'eight'), defense: CARD('diamonds', 'king') }],
        }),
      ),
    ).toEqual(['pass']);
    expect(
      multiplayerLegalActions(
        makeView({
          attackerIdx: 1,
          defenderIdx: 0,
          phase: 'defense',
          tablePairs: [{ attack: CARD('diamonds', 'eight'), defense: null }],
          hand: [CARD('hearts', 'six')],
        }),
      ),
    ).toEqual(['surrender']);
    expect(multiplayerLegalActions(makeView({ viewerSeat: null, status: 'Finished' }))).toEqual(
      [],
    );
  });
});

describe('lobby.css multiplayer invariants', () => {
  it('no longer ships the placeholder projected-table markup or rules', () => {
    for (const selector of [
      '.mp-shell',
      '.mp-arena',
      '.mp-actions',
      '.mp-bouts-row',
      '.mp-hand[',
      '.mp-deck[',
      '.mp-seat {',
    ]) {
      expect(lobbyCss, selector).not.toContain(selector);
    }
  });

  it('never uses freeform positioning', () => {
    expect(lobbyCss).not.toMatch(/position:\s*(absolute|fixed)/);
  });
});
