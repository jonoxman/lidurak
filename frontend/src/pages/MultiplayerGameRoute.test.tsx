import { fireEvent, render, screen } from '@testing-library/preact';
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
import { MultiplayerGameRoute, toEngineView, toWsMessage } from './MultiplayerGameRoute';
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
    id: 'guest-alice',
    name: 'Alice',
    rating: null,
    cardCount: 3,
    isConnected: true,
    hasPassed: false,
    finishRank: null,
    seatIndex: 0,
  },
  {
    id: 'guest-bob',
    name: 'Bob',
    rating: null,
    cardCount: 3,
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

const makeView = (overrides: Partial<PlayerGameView> = {}): PlayerGameView => ({
  gameId: 'room-1',
  status: 'InProgress',
  config: {
    playerCount: 2,
    allowRedirect: true,
    turnTimeoutSeconds: 15,
    isPublic: true,
  },
  viewerId: 'guest-alice',
  viewerSeat: 0,
  hand: [CARD('hearts', 'six'), CARD('spades', 'ace'), CARD('clubs', 'nine')],
  players: PLAYERS,
  seats: [SEAT(0, 'guest-alice', 'Alice'), SEAT(1, 'guest-bob', 'Bob')],
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
  defenderDefenseless: false,
  promptedPlayerIds: [],
  eligibleTargetIds: [],
  redirectTargetId: null,
  lastDiscardCards: [],
  turnPlayerId: null,
  turnSecondsRemaining: 15,
  ...overrides,
});

const waitingView = (overrides: Partial<PlayerGameView> = {}): PlayerGameView =>
  makeView({
    status: 'WaitingForPlayers',
    hand: [],
    players: [],
    seats: [SEAT(0, 'guest-alice', 'Alice'), SEAT(1, null, null)],
    tablePairs: [],
    talonCount: 0,
    trumpSuit: null,
    phase: null,
    attackerIdx: null,
    defenderIdx: null,
    turnDeadlineEpochMs: null,
    legalActions: [],
    ...overrides,
  });

let sent: WsClientMessage[] = [];
let socketHandlers: import('../api/gameSocket').GameSocketHandlers | null = null;

const installSocket = () => {
  createGameSocket.mockImplementation(
    (_gameId: string, handlers: import('../api/gameSocket').GameSocketHandlers) => {
      socketHandlers = handlers;
      return {
        status: 'connected' as const,
        sendAction: (message: WsClientMessage) => sent.push(message),
        dispose: vi.fn(),
      };
    },
  );
};

const renderRoute = () => render(<MultiplayerGameRoute gameId="room-1" />);

describe('MultiplayerGameRoute: shared Milestone 1 shell', () => {
  beforeEach(() => {
    vi.resetAllMocks();
    sent = [];
    socketHandlers = null;
    installSocket();
    getOrCreateSession.mockResolvedValue({
      playerId: 'guest-alice',
      displayName: 'Alice',
      isGuest: true,
    });
    joinRoom.mockResolvedValue({ gameId: 'room-1', seatIndex: 1, view: waitingView() });
    leaveRoom.mockResolvedValue(undefined);
    Object.defineProperty(navigator, 'clipboard', {
      configurable: true,
      value: { writeText: vi.fn(async () => {}) },
    });
  });

  it('renders the full 3-column M1 gameplay shell for a waiting room', async () => {
    // An unseated visitor sees the invite link plus the Join CTA.
    fetchGameView.mockResolvedValue(waitingView({ viewerSeat: null }));

    renderRoute();

    expect(await screen.findByTestId('multiplayer-room-panel')).toBeTruthy();
    expect(document.querySelector('[data-zone="sidebar-left"]')).toBeTruthy();
    expect(document.querySelector('[data-zone="table-arena"]')).toBeTruthy();
    expect(document.querySelector('[data-zone="sidebar-right"]')).toBeTruthy();
    // Invite link, occupied/open seats and the join CTA live in the sidebar.
    expect(screen.getByTestId('invite-url').textContent).toContain('/g/room-1');
    expect(screen.getByTestId('waiting-seat-1').textContent).toContain('Open seat');
    expect(screen.getByTestId('waiting-seat-count').textContent).toContain('1 / 2');
    expect(screen.getByTestId('copy-invite')).toBeTruthy();
    expect(screen.getByTestId('join-seat')).toBeTruthy();
    // No placeholder gameplay surface survives.
    expect(screen.queryByTestId('projected-table')).toBeNull();
  });

  it('calls POST /api/games/:gameId/join from the waiting-room CTA', async () => {
    fetchGameView.mockResolvedValue(waitingView({ viewerSeat: null }));

    renderRoute();

    fireEvent.click(await screen.findByTestId('join-seat'));
    await vi.waitFor(() => expect(joinRoom).toHaveBeenCalledWith('room-1'));
  });

  it('sends a multiplayer WebSocket frame for a contextual Pass action', async () => {
    fetchGameView.mockResolvedValue(
      makeView({
        phase: 'defense',
        attackerIdx: 1,
        defenderIdx: 0,
        tablePairs: [{ attack: CARD('clubs', 'nine'), defense: null }],
        legalActions: ['pass'],
      }),
    );

    renderRoute();

    fireEvent.click(await screen.findByTestId('pass-button'));
    expect(sent).toContainEqual({ type: 'passTurn' });
  });

  it('renders a zero-leak read-only spectator view with no hand or controls', async () => {
    fetchGameView.mockResolvedValue(
      makeView({ viewerId: 'spectator-1', viewerSeat: null, hand: [], legalActions: [] }),
    );

    renderRoute();

    expect(await screen.findByTestId('spectator-badge')).toBeTruthy();
    expect(document.querySelector('[data-zone="table-arena"]')).toBeTruthy();
    expect(document.querySelectorAll('.hand-card-wrapper')).toHaveLength(0);
    expect(screen.queryByTestId('pass-button')).toBeNull();
    expect(screen.queryByTestId('surrender-button')).toBeNull();
    // Opponent card identities never arrive, so none can be painted.
    expect(screen.queryByText('hearts')).toBeNull();
  });

  it('shows the finished result in the M1 layout', async () => {
    fetchGameView.mockResolvedValue(
      makeView({
        status: 'Finished',
        phase: 'gameOver',
        finishOrder: ['guest-bob', 'guest-alice'],
        legalActions: [],
        hand: [],
      }),
    );

    renderRoute();

    expect(await screen.findByTestId('game-over-banner')).toBeTruthy();
    expect(document.querySelector('[data-zone="table-arena"]')).toBeTruthy();
  });

  it('renders a not-found state for a missing room', async () => {
    fetchGameView.mockRejectedValue(Object.assign(new Error('not found'), { status: 404 }));

    renderRoute();

    expect(await screen.findByTestId('game-not-found')).toBeTruthy();
    expect(createGameSocket).not.toHaveBeenCalled();
  });
});

describe('MultiplayerGameRoute: view and action adapters', () => {
  it('maps seats, roles and the own hand into the M1 view without opponent cards', () => {
    const view = makeView({
      tablePairs: [{ attack: CARD('clubs', 'nine'), defense: null }],
      eligibleTargetIds: ['guest-bob'],
      redirectTargetId: null,
      turnPlayerId: 'guest-bob',
    });
    const engine = toEngineView(view);

    expect(engine.myId).toBe('p0');
    expect(engine.myHand).toEqual(view.hand);
    expect(engine.opponents.map((opponent) => opponent.id)).toEqual(['p1']);
    expect(engine.opponents[0].cardCount).toBe(3);
    // No opponent hand field exists in the shared opponent summary.
    expect('cards' in engine.opponents[0]).toBe(false);
    expect(engine.attackerIdx).toBe(0);
    expect(engine.defenderIdx).toBe(1);
    expect(engine.eligibleTargetIds).toEqual(['p1']);
    expect(engine.turnPlayerId).toBe('p1');
    expect(engine.legalActions).toEqual(['attack']);
  });

  it('maps every M1 player interaction onto its multiplayer frame', () => {
    expect(toWsMessage({ type: 'initialAttack', playerId: 'p0', cards: [CARD('six', 'hearts')] })).toEqual(
      { type: 'playAttack', cards: [CARD('six', 'hearts')] },
    );
    expect(
      toWsMessage({
        type: 'coverCard',
        playerId: 'p0',
        attackIndex: 1,
        defenseCard: CARD('ace', 'spades'),
      }),
    ).toEqual({
      type: 'coverCard',
      attackIndex: 1,
      defenseCard: CARD('ace', 'spades'),
    });
    expect(
      toWsMessage({ type: 'redirectAttack', playerId: 'p0', cards: [CARD('six', 'hearts')] }),
    ).toEqual({ type: 'redirectAttack', cards: [CARD('six', 'hearts')] });
    expect(
      toWsMessage({ type: 'throwInCards', playerId: 'p0', cards: [CARD('six', 'hearts')] }),
    ).toEqual({ type: 'throwInCards', cards: [CARD('six', 'hearts')] });
    expect(toWsMessage({ type: 'declareSurrender', playerId: 'p0' })).toEqual({
      type: 'declareSurrender',
    });
    expect(toWsMessage({ type: 'passTurn', playerId: 'p0' })).toEqual({ type: 'passTurn' });
    expect(toWsMessage({ type: 'unknownAction', playerId: 'p0' })).toBeNull();
  });

  it('keeps a spectator hand empty and its controls idle', () => {
    const engine = toEngineView(
      makeView({
        viewerId: 'spectator-1',
        viewerSeat: null,
        hand: [],
        legalActions: ['attack'],
        canThrowIn: true,
        throwInCards: [CARD('six', 'hearts')],
        throwInCapacity: 2,
      }),
    );
    expect(engine.myHand).toEqual([]);
    expect(engine.legalActions).toEqual([]);
    expect(engine.canThrowIn).toBe(false);
    expect(engine.throwInCards).toEqual([]);
    expect(engine.opponents).toHaveLength(2);
  });
});
