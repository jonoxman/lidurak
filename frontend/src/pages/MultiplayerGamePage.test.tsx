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
import { MultiplayerGamePage } from './MultiplayerGamePage';
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

  it('joins an open seat and swaps to the returned projection', async () => {
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

    expect(await screen.findByTestId('projected-table')).toBeTruthy();
    expect(screen.getAllByTestId(/^hand-card-/).length).toBe(3);
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

describe('MultiplayerGamePage projected table', () => {
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

  it("renders only the viewer's hand and sends typed attack/pass/take messages", async () => {
    renderPage();
    await screen.findByTestId('projected-table');

    const handCards = screen.getAllByTestId(/^hand-card-/);
    expect(handCards).toHaveLength(3);
    expect(screen.getByLabelText('6 of hearts')).toBeTruthy();
    // Opponent hands are counts only — never card faces.
    const opponent = screen.getByTestId('opponent-p1');
    expect(opponent.textContent).toContain('6 cards');
    expect(opponent.querySelector('.mp-seat-backs')).not.toBeNull();

    fireEvent.click(handCards[0]);
    fireEvent.click(screen.getByTestId('action-play'));
    expect(sent).toEqual([
      { type: 'playAttack', cards: [CARD('hearts', 'six')] },
    ]);

    fireEvent.click(screen.getByTestId('action-pass'));
    expect(sent[1]).toEqual({ type: 'passTurn' });

    fireEvent.click(screen.getByTestId('action-take'));
    expect(sent[2]).toEqual({ type: 'declareSurrender' });
  });

  it('covers or redirects with the selected card as the defender', async () => {
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
    await screen.findByTestId('projected-table');

    fireEvent.click(screen.getByTestId('attack-card-0'));
    fireEvent.click(screen.getByTestId('hand-card-0'));
    fireEvent.click(screen.getByTestId('action-cover'));

    expect(sent[0]).toEqual({
      type: 'coverCard',
      attackIndex: 0,
      defenseCard: CARD('diamonds', 'king'),
    });

    fireEvent.click(screen.getByTestId('hand-card-0'));
    fireEvent.click(screen.getByTestId('action-redirect'));
    expect(sent[1]).toEqual({
      type: 'redirectAttack',
      cards: [CARD('diamonds', 'king')],
    });
  });

  it('renders a zero-leak read-only spectator table', async () => {
    fetchGameView.mockResolvedValue(
      makeView({ viewerSeat: null, hand: [], phase: 'defense' }),
    );

    renderPage();
    await screen.findByTestId('projected-table');

    expect(screen.getByTestId('spectator-badge').textContent).toBe(
      'Spectator Mode (Read-Only)',
    );
    expect(screen.queryAllByTestId(/^hand-card-/)).toHaveLength(0);
    expect(screen.getByTestId('spectator-hand')).toBeTruthy();
    expect(screen.queryByTestId('action-pass')).toBeNull();
    expect(screen.queryByTestId('action-take')).toBeNull();
    expect(screen.queryByTestId('action-play')).toBeNull();
    expect(screen.queryByTestId('action-cover')).toBeNull();
    expect(screen.queryByTestId('action-redirect')).toBeNull();

    // Public roster only: both seats are visible as names and counts.
    expect(screen.getByTestId('roster-p1').textContent).toContain('Opponent');
  });

  it('shows the 00:XX clock, talon and finished standings', async () => {
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
    await screen.findByTestId('projected-table');

    expect(screen.getByTestId('turn-clock').textContent).toBe('00:00');
    expect(screen.getByTestId('talon-count').textContent).toBe('20');
    expect(screen.getByTestId('game-results').textContent).toContain('Opponent wins');
    expect(screen.getByTestId('durak-result').textContent).toBe(
      'Durak: Guest-AB12',
    );
    expect(screen.getByTestId('action-pass')).toHaveProperty('disabled', true);
  });
});
