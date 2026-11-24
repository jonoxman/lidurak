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
  formatTurnClock,
  multiplayerLegalActions,
  multiplayerOpponents,
  multiplayerThrowInCards,
  seatPlayerId,
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

const renderPage = (onNavigateLobby = vi.fn()) =>
  render(<MultiplayerGamePage gameId="room-1" onNavigateLobby={onNavigateLobby} />);

const setup = () => {
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
  leaveRoom.mockResolvedValue(undefined);
  Object.defineProperty(navigator, 'clipboard', {
    configurable: true,
    value: { writeText: vi.fn(async () => {}) },
  });
};

describe('MultiplayerGamePage lifecycle', () => {
  beforeEach(() => {
    setup();
    fetchGameView.mockResolvedValue(waitingView());
    joinRoom.mockResolvedValue({ gameId: 'room-1', seatIndex: 1, view: waitingView() });
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
    setup();
    fetchGameView.mockResolvedValue(waitingView());
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
    expect(screen.getByLabelText('six of hearts')).toBeTruthy();
    expect(screen.queryByTestId('waiting-room')).toBeNull();
  });

  it('leaves the room and returns to the lobby', async () => {
    const onExit = vi.fn();
    renderPage(onExit);
    await screen.findByTestId('waiting-room');

    fireEvent.click(screen.getByTestId('leave-room'));
    await waitFor(() => expect(leaveRoom).toHaveBeenCalledWith('room-1'));
    expect(onExit).toHaveBeenCalledTimes(1);
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
    setup();
    fetchGameView.mockResolvedValue(makeView());
  });

  it('renders the M1 game shell, GameTable, SortBar and split clock (no placeholder)', async () => {
    const { container } = renderPage();
    await screen.findByTestId('hand-sort-box');

    expect(container.querySelector('.game-shell')).not.toBeNull();
    expect(container.querySelector('[data-zone="sidebar-left"]')).not.toBeNull();
    expect(container.querySelector('[data-zone="table-arena"]')).not.toBeNull();
    expect(container.querySelector('[data-zone="sidebar-right"]')).not.toBeNull();
    expect(container.querySelector('[data-zone="table-arena"]')?.querySelector('.hand-slot')).not.toBeNull();
    expect(screen.queryByTestId('projected-table')).toBeNull();
    expect(container.querySelector('.mp-shell')).toBeNull();
    expect(container.querySelector('.mp-arena')).toBeNull();

    expect(screen.getByTestId('turn-clock').textContent).toBe('00:15');
    expect(screen.getByTestId('game-clock')).toBeTruthy();
    expect(screen.getByTestId('talon-count').textContent).toBe('20');
    expect(screen.getByTestId('players-panel')).toBeTruthy();
    expect(screen.getByTestId('player-cards-p1').textContent).toBe('6 cards');
    expect(screen.getByText('How to Play')).toBeTruthy();

    const hand = screen.getByLabelText('Your hand');
    expect(hand.querySelectorAll('.hand-card-wrapper')).toHaveLength(3);
    expect(screen.getByLabelText('six of hearts')).toBeTruthy();
    expect(screen.getAllByText('HAND SORTING').length).toBeGreaterThan(0);
  });

  it('sends an attack from the selected hand cards', async () => {
    renderPage();
    await screen.findByTestId('hand-sort-box');

    fireEvent.click(screen.getByLabelText('six of hearts'));
    fireEvent.click(screen.getByTestId('action-attack'));

    expect(sent).toEqual([
      { type: 'playAttack', cards: [CARD('hearts', 'six')] },
    ]);
  });

  it('covers an uncovered attack on double-click as the defender', async () => {
    fetchGameView.mockResolvedValue(
      makeView({
        viewerSeat: 0,
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

  it('passes and surrenders from the M1 ActionBar', async () => {
    fetchGameView.mockResolvedValue(
      makeView({
        viewerSeat: 0,
        defenderIdx: 0,
        attackerIdx: 1,
        phase: 'defense',
        tablePairs: [
          { attack: CARD('diamonds', 'eight'), defense: CARD('diamonds', 'nine') },
        ],
        hand: [CARD('diamonds', 'king')],
      }),
    );

    renderPage();
    await screen.findByTestId('hand-sort-box');

    fireEvent.click(screen.getByTestId('pass-button'));
    fireEvent.click(screen.getByTestId('surrender-button'));

    expect(sent).toEqual([{ type: 'passTurn' }, { type: 'declareSurrender' }]);
  });

  it('renders a zero-leak read-only spectator table', async () => {
    fetchGameView.mockResolvedValue(
      makeView({ viewerSeat: null, hand: [], phase: 'defense' }),
    );

    const { container } = renderPage();
    await screen.findByTestId('hand-sort-box');

    expect(screen.getByTestId('spectator-badge').textContent).toBe(
      'Spectator Mode (Read-Only)',
    );
    expect(screen.getByTestId('player-row-p1').textContent).toContain('Opponent');
    expect(container.querySelectorAll('.hand-card-wrapper')).toHaveLength(0);
    expect(screen.queryByTestId('action-bar')).toBeNull();
    expect(screen.queryByTestId('action-attack')).toBeNull();
    expect(container.querySelector('[data-zone="table-arena"]')).not.toBeNull();
  });

  it('shows the finished standings and Durak result', async () => {
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

    expect(screen.getByTestId('game-over-banner').textContent).toContain(
      'Opponent wins',
    );
    expect(screen.getByTestId('winner-result').textContent).toBe('Opponent wins');
    expect(screen.getByTestId('durak-result').textContent).toBe('Durak: Guest-AB12');
    expect(screen.getByTestId('durak-line').textContent).toBe(
      'Guest-AB12 is the Durak.',
    );
    expect(screen.getByTestId('turn-clock').textContent).toBe('00:15');
    expect(screen.queryByTestId('action-bar')).toBeNull();
  });
});

describe('multiplayer projection adapters', () => {
  it('orders opponents clockwise from the viewer seat', () => {
    const view = makeView({
      config: { playerCount: 3, allowRedirect: true, turnTimeoutSeconds: 15, isPublic: true },
      viewerSeat: 1,
      players: [
        { ...PLAYERS[0], seatIndex: 0 },
        { ...PLAYERS[0], id: 'me', name: 'Me', seatIndex: 1 },
        { ...PLAYERS[0], id: 'p2', name: 'Carol', seatIndex: 2 },
      ],
    });
    expect(multiplayerOpponents(view).map((player) => player.id)).toEqual([
      'p2',
      'guest-abcd1234',
    ]);
    expect(seatPlayerId(view, 2)).toBe('p2');
    expect(seatPlayerId(view, null)).toBeUndefined();
  });

  it('derives the legal action set for attack, defense and throw-in phases', () => {
    expect(multiplayerLegalActions(makeView())).toEqual(['attack']);

    const defense = makeView({
      phase: 'defense',
      defenderIdx: 0,
      attackerIdx: 1,
      tablePairs: [{ attack: CARD('diamonds', 'eight'), defense: null }],
      hand: [CARD('diamonds', 'eight')],
    });
    expect(multiplayerLegalActions(defense)).toEqual(['surrender', 'redirect', 'cover']);

    const throwIn = makeView({
      phase: 'defense',
      defenderIdx: 1,
      attackerIdx: 0,
      tablePairs: [{ attack: CARD('diamonds', 'eight'), defense: null }],
      hand: [CARD('clubs', 'eight'), CARD('hearts', 'three')],
    });
    expect(multiplayerLegalActions(throwIn)).toEqual(['throwIn']);
    expect(multiplayerThrowInCards(throwIn)).toEqual([CARD('clubs', 'eight')]);
  });

  it('formats the shared 00:XX turn clock', () => {
    expect(formatTurnClock(0)).toBe('00:00');
    expect(formatTurnClock(15)).toBe('00:15');
    expect(formatTurnClock(7)).toBe('00:07');
  });
});

describe('lobby.css M1 multiplayer invariants', () => {
  it('removes every placeholder-table selector', () => {
    expect(lobbyCss).not.toContain('.mp-shell');
    expect(lobbyCss).not.toContain('.mp-arena');
    expect(lobbyCss).not.toContain('.mp-hand');
    expect(lobbyCss).not.toContain('.mp-bouts-row');
    expect(lobbyCss).not.toContain('.mp-roster');
    expect(lobbyCss).not.toContain('.mp-body');
  });

  it('never uses freeform positioning', () => {
    expect(lobbyCss).not.toMatch(/position:\s*(absolute|fixed)/);
  });
});
