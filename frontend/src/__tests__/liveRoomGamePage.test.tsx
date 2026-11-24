/**
 * T-95-audit-gap: the History-API live room (`/g/:gameId`) renders the full
 * Milestone 1 gameplay interface — the same three-column shell, hand, table and
 * results — for every room state, and wires every action to a typed socket
 * frame. The lightweight placeholder page is gone.
 */
import { fireEvent, render, screen, waitFor } from '@testing-library/preact';
import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../api/sessionClient', () => ({
  getOrCreateSession: vi.fn(async () => ({
    playerId: 'guest-1',
    displayName: 'Guest',
    isGuest: true,
  })),
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
import { GamePage } from '../pages/GamePage';
import type {
  Card,
  PlayerGameView,
  RoomSeatView,
  WsClientMessage,
} from '../types/multiplayer';

const fetchGameView = lobbyApi.fetchGameView as unknown as ReturnType<typeof vi.fn>;
const joinRoom = lobbyApi.joinRoom as unknown as ReturnType<typeof vi.fn>;
const leaveRoom = lobbyApi.leaveRoom as unknown as ReturnType<typeof vi.fn>;
const createGameSocket = gameSocketApi.createGameSocket as unknown as ReturnType<typeof vi.fn>;

const CARD = (suit: string, rank: string): Card => ({ suit, rank });

const PLAYERS = [
  {
    id: 'guest-1',
    name: 'Guest',
    rating: null,
    cardCount: 2,
    isConnected: true,
    hasPassed: false,
    finishRank: null,
    seatIndex: 0,
  },
  {
    id: 'opp-1',
    name: 'Opponent',
    rating: null,
    cardCount: 3,
    isConnected: true,
    hasPassed: false,
    finishRank: null,
    seatIndex: 1,
  },
];

const SEAT = (
  seatIndex: number,
  playerId: string | null,
  name: string | null,
): RoomSeatView => ({
  seatIndex,
  playerId,
  displayName: name,
  isConnected: playerId !== null,
});

let sent: WsClientMessage[] = [];

const makeView = (overrides: Partial<PlayerGameView> = {}): PlayerGameView => ({
  gameId: 'room-1',
  status: 'InProgress',
  config: {
    playerCount: 2,
    allowRedirect: true,
    turnTimeoutSeconds: 15,
    isPublic: true,
  },
  viewerId: 'guest-1',
  viewerSeat: 0,
  hand: [CARD('hearts', 'six'), CARD('spades', 'nine')],
  players: PLAYERS,
  seats: [SEAT(0, 'guest-1', 'Guest'), SEAT(1, 'opp-1', 'Opponent')],
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
  legalActions: ['attack'],
  throwInCards: [],
  throwInCapacity: 0,
  canThrowIn: false,
  myHasPassed: false,
  myFinishRank: null,
  winners: [],
  promptedPlayerIds: [],
  eligibleTargetIds: [],
  redirectTargetId: null,
  turnPlayerId: 'guest-1',
  turnSecondsRemaining: 15,
  lastDiscardCards: [],
  gameStartedAtMs: null,
  gameEndedAtMs: null,
  myName: 'Guest',
  ...overrides,
});

const waitingView = (overrides: Partial<PlayerGameView> = {}): PlayerGameView =>
  makeView({
    status: 'WaitingForPlayers',
    hand: [],
    players: PLAYERS.slice(0, 1),
    tablePairs: [],
    talonCount: 0,
    trumpSuit: null,
    phase: null,
    attackerIdx: null,
    defenderIdx: null,
    legalActions: [],
    turnDeadlineEpochMs: null,
    seats: [SEAT(0, 'guest-1', 'Guest'), SEAT(1, null, null)],
    viewerSeat: 0,
    ...overrides,
  });

const renderGame = (onLeaveGame = vi.fn()) =>
  render(
    <GamePage
      gameId="room-1"
      playerId="p0"
      multiplayer
      onSwitchPlayer={() => {}}
      onLeaveGame={onLeaveGame}
    />,
  );

/** The three M1 shell columns, asserted on every state. */
function expectThreeColumnShell(): void {
  expect(document.querySelector('[data-zone="sidebar-left"]')).not.toBeNull();
  expect(document.querySelector('[data-zone="table-arena"]')).not.toBeNull();
  expect(document.querySelector('[data-zone="sidebar-right"]')).not.toBeNull();
}

describe('T-95-audit-gap: /g/:gameId renders the M1 game shell', () => {
  beforeEach(() => {
    vi.resetAllMocks();
    sent = [];
    createGameSocket.mockImplementation(
      (_gameId: string, handlers: { onView?: (view: PlayerGameView) => void }) => {
        void handlers;
        return {
          status: 'connected' as const,
          sendAction: (message: WsClientMessage) => sent.push(message),
          dispose: vi.fn(),
        };
      },
    );
    leaveRoom.mockResolvedValue(undefined);
  });

  it('renders an in-progress room on the felt table and sends an attack over the socket', async () => {
    fetchGameView.mockResolvedValue(makeView());
    renderGame();

    await screen.findByTestId('players-panel');
    expectThreeColumnShell();
    expect(document.querySelector('[data-zone="player-hand"]')).not.toBeNull();
    expect(document.querySelectorAll('.hand-card-wrapper')).toHaveLength(2);
    expect(createGameSocket).toHaveBeenCalledWith('room-1', expect.anything());

    // The M1 hand click selects, and the M1 Attack button dispatches one typed
    // frame — the server derives the acting seat from the session.
    fireEvent.click(screen.getByLabelText('six of hearts'));
    fireEvent.click(await screen.findByRole('button', { name: 'Attack' }));

    await waitFor(() =>
      expect(sent).toContainEqual({
        type: 'playAttack',
        cards: [{ suit: 'hearts', rank: 'six' }],
      }),
    );
  });

  it('keeps a waiting room inside the shell and joins an open seat', async () => {
    fetchGameView.mockResolvedValue(waitingView({ viewerSeat: null, viewerId: 'visitor' }));
    joinRoom.mockResolvedValue({
      gameId: 'room-1',
      seatIndex: 1,
      view: makeView({
        viewerSeat: 1,
        viewerId: 'guest-1',
        myName: 'Guest',
        phase: 'defense',
        legalActions: [],
      }),
    });
    renderGame();

    await screen.findByTestId('waiting-room');
    expectThreeColumnShell();
    expect(screen.getByTestId('waiting-seat-count').textContent).toContain('1 / 2');
    expect(screen.getByTestId('invite-url').textContent).toContain('/g/room-1');

    fireEvent.click(screen.getByTestId('join-seat'));
    await waitFor(() => expect(joinRoom).toHaveBeenCalledWith('room-1'));
    await waitFor(() =>
      expect(document.querySelectorAll('.hand-card-wrapper')).toHaveLength(2),
    );
  });

  it('offers Leave Room to a seated waiting-room player', async () => {
    fetchGameView.mockResolvedValue(waitingView());
    const onLeave = vi.fn();
    renderGame(onLeave);

    await screen.findByTestId('waiting-room');
    fireEvent.click(screen.getByTestId('leave-room'));

    await waitFor(() => expect(leaveRoom).toHaveBeenCalledWith('room-1'));
    await waitFor(() => expect(onLeave).toHaveBeenCalled());
  });

  it('shows the M1 winner and Durak results for a finished room', async () => {
    fetchGameView.mockResolvedValue(
      makeView({
        status: 'Finished',
        phase: 'gameOver',
        hand: [],
        finishOrder: ['opp-1'],
        winners: ['opp-1'],
        durakId: 'guest-1',
        turnDeadlineEpochMs: null,
        legalActions: [],
      }),
    );
    const onLeave = vi.fn();
    renderGame(onLeave);

    expect(await screen.findByTestId('game-over-banner')).toBeTruthy();
    expectThreeColumnShell();
    expect(screen.getByTestId('game-over-banner').textContent).toContain('Opponent wins');
    expect(screen.getByTestId('game-over-banner').textContent).toContain('Durak: you');

    fireEvent.click(screen.getByTestId('banner-lobby-button'));
    expect(onLeave).toHaveBeenCalledTimes(1);
  });

  it('renders a spectator read-only with every visible seat and an empty hand', async () => {
    fetchGameView.mockResolvedValue(
      makeView({ viewerSeat: null, viewerId: 'visitor', hand: [], legalActions: [] }),
    );
    renderGame();

    await screen.findByTestId('players-panel');
    expectThreeColumnShell();
    expect(document.querySelectorAll('.hand-card-wrapper')).toHaveLength(0);
    expect(screen.queryByRole('button', { name: 'Attack' })).toBeNull();
    expect(screen.queryByRole('button', { name: 'Pass' })).toBeNull();
    expect(screen.queryByRole('button', { name: 'Surrender' })).toBeNull();
    // Both seats stay visible, and none is labelled as the viewer's own seat.
    expect(screen.getByTestId('player-row-p0')).toBeTruthy();
    expect(screen.getByTestId('player-row-p1')).toBeTruthy();
    expect(screen.getByTestId('player-row-p0').textContent).not.toContain('(You)');
  });

  it('shows a not-found panel when the room no longer exists', async () => {
    fetchGameView.mockRejectedValue(Object.assign(new Error('gone'), { status: 404 }));
    renderGame();

    expect(await screen.findByTestId('game-not-found')).toBeTruthy();
    expect(createGameSocket).not.toHaveBeenCalled();
  });
});
