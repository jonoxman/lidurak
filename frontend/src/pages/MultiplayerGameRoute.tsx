import { useEffect, useRef, useState } from 'preact/hooks';
import { GamePage } from './GamePage';
import { createGameSocket, type GameSocket } from '../api/gameSocket';
import { fetchGameView, joinRoom, leaveRoom } from '../api/lobbyClient';
import { getOrCreateSession } from '../api/sessionClient';
import { navigateToLobby } from '../router/useRoute';
import type {
  Card,
  PlayerGameView as MultiplayerView,
  RoomSeatView,
  SocketStatus,
  WsClientMessage,
} from '../types/multiplayer';
import type {
  Card as EngineCard,
  GameAction,
  PlayerGameView as EngineView,
} from '../types';

type PagePhase = 'loading' | 'ready' | 'notFound' | 'error';

/** The M1 table addresses seats as `p<seatIndex>`, exactly like the local game. */
export function seatPlayerId(seatIndex: number): string {
  return `p${seatIndex}`;
}

/** A seat of the live room, whether occupied or still open. */
interface RoomSeat {
  seatIndex: number;
  playerId: string | null;
  name: string;
  cardCount: number;
  hasPassed: boolean;
  finishRank: number | null;
  isConnected: boolean;
}

/**
 * Every seat of the room in seat order. Public summaries supply the card
 * counts; an open seat has none. No hand is ever read here.
 */
export function roomSeats(view: MultiplayerView): RoomSeat[] {
  const summaries = new Map(view.players.map((player) => [player.seatIndex, player]));
  const rows: RoomSeat[] = view.seats.map((seat: RoomSeatView) => {
    const summary = summaries.get(seat.seatIndex);
    return {
      seatIndex: seat.seatIndex,
      playerId: seat.playerId,
      name:
        seat.displayName ??
        summary?.name ??
        (seat.playerId ? `Seat ${seat.seatIndex + 1}` : 'Open seat'),
      cardCount: summary?.cardCount ?? 0,
      hasPassed: summary?.hasPassed ?? false,
      finishRank: summary?.finishRank ?? null,
      isConnected: seat.isConnected,
    };
  });
  // Defensive: a projection that omits `seats` still renders the players it has.
  const seen = new Set(rows.map((seat) => seat.seatIndex));
  for (const player of view.players) {
    if (seen.has(player.seatIndex)) continue;
    rows.push({
      seatIndex: player.seatIndex,
      playerId: player.id,
      name: player.name,
      cardCount: player.cardCount,
      hasPassed: player.hasPassed,
      finishRank: player.finishRank,
      isConnected: player.isConnected,
    });
  }
  return rows.sort((left, right) => left.seatIndex - right.seatIndex);
}

/**
 * Bridges one strictly projected multiplayer view into the M1 `PlayerGameView`
 * shape the shared `GamePage` / `GameTable` consume.
 *
 * Only public fields travel: the viewer's own `hand`, public card counts and
 * public table/talon data. Real player ids are mapped to the table's canonical
 * `p<seat>` ids so seats, roles and outlines line up; the server derives the
 * acting seat from the session, never from the id in the frame.
 */
export function toEngineView(view: MultiplayerView): EngineView {
  const seats = roomSeats(view);
  const occupied = seats.filter((seat) => seat.playerId !== null);
  const viewerSeat = view.viewerSeat;
  const mySeat = viewerSeat == null ? undefined : seats.find((seat) => seat.seatIndex === viewerSeat);
  const summary = (seatIndex: number | null | undefined) =>
    seatIndex == null ? undefined : view.players.find((player) => player.seatIndex === seatIndex);
  const seatIdOfPlayer = (playerId: string | null | undefined): string | null => {
    if (playerId == null) return null;
    const player = view.players.find((candidate) => candidate.id === playerId);
    return player ? seatPlayerId(player.seatIndex) : null;
  };
  const seatIdsOf = (ids: string[] | undefined): string[] =>
    (ids ?? [])
      .map((id) => seatIdOfPlayer(id))
      .filter((id): id is string => id !== null);

  const opponents = occupied
    .filter((seat) => seat.seatIndex !== viewerSeat)
    .map((seat) => ({
      id: seatPlayerId(seat.seatIndex),
      name: seat.name,
      cardCount: seat.cardCount,
      hasPassed: seat.hasPassed,
      finishRank: seat.finishRank,
      isPresent: seat.isConnected,
    }));

  const waiting = view.status === 'WaitingForPlayers';
  const inProgress = view.status === 'InProgress';
  const mySummary = summary(viewerSeat);

  return {
    myId: viewerSeat == null ? view.viewerId : seatPlayerId(viewerSeat),
    myName: mySeat?.name ?? mySummary?.name ?? (viewerSeat == null ? 'Spectator' : ''),
    myHand: viewerSeat == null ? [] : view.hand,
    opponents,
    tablePairs: view.tablePairs.map((pair) => ({
      attack: pair.attack,
      defense: pair.defense ?? null,
    })),
    talonCount: view.talonCount,
    bottomTrumpCard: view.bottomTrumpCard,
    trumpSuit: view.trumpSuit ?? '',
    attackerIdx: view.attackerIdx ?? -1,
    defenderIdx: view.defenderIdx ?? -1,
    boutPhase: view.phase ?? (waiting ? 'waitingForPlayers' : 'gameOver'),
    // Only a live, seated seat may act; spectators and waiting rooms stay idle.
    legalActions: inProgress && viewerSeat != null ? (view.legalActions ?? []) : [],
    finishOrder: view.finishOrder,
    isDraw: view.isDraw,
    maxBoutAttacks: view.maxBoutAttacks,
    defenderDefenseless: view.defenderDefenseless ?? false,
    throwInCards: inProgress && viewerSeat != null ? (view.throwInCards ?? []) : [],
    throwInCapacity: inProgress && viewerSeat != null ? (view.throwInCapacity ?? 0) : 0,
    canThrowIn: inProgress && viewerSeat != null && (view.canThrowIn ?? false),
    allowRedirect: view.config.allowRedirect,
    eligibleTargetIds: seatIdsOf(view.eligibleTargetIds),
    redirectTargetId: seatIdOfPlayer(view.redirectTargetId ?? null),
    turnDeadlineMs: view.turnDeadlineEpochMs ?? 0,
    turnSecondsRemaining:
      view.turnSecondsRemaining ??
      (view.config.turnTimeoutSeconds > 0 ? view.config.turnTimeoutSeconds : 15),
    turnPlayerId: seatIdOfPlayer(view.turnPlayerId ?? null) ?? undefined,
    presentPlayers: occupied
      .filter((seat) => seat.isConnected)
      .map((seat) => seatPlayerId(seat.seatIndex)),
    discardCount: view.discardCount,
    lastDiscardCards: view.lastDiscardCards ?? [],
    myHasPassed: mySummary?.hasPassed ?? false,
    myFinishRank: mySummary?.finishRank ?? null,
    winners: view.finishOrder,
    durak: view.durakId,
    isBot: false,
    playerTypes: [],
    chaosMode: false,
    transparentMode: false,
    devMode: false,
    // The M2 room owns the room lifecycle, so the shared table never offers a
    // mid-game POV switch or a local rematch.
    gameStartedAtMs: null,
    gameEndedAtMs: null,
  } as EngineView;
}

/** Maps one M1 engine action onto the multiplayer WebSocket frame it becomes. */
export function toWsMessage(action: GameAction): WsClientMessage | null {
  switch (action.type) {
    case 'initialAttack':
      return { type: 'playAttack', cards: (action.cards as EngineCard[]) ?? [] };
    case 'coverCard':
      return {
        type: 'coverCard',
        attackIndex: Number(action.attackIndex),
        defenseCard: action.defenseCard as Card,
      };
    case 'redirectAttack':
      return { type: 'redirectAttack', cards: (action.cards as EngineCard[]) ?? [] };
    case 'throwInCards':
      return { type: 'throwInCards', cards: (action.cards as EngineCard[]) ?? [] };
    case 'declareSurrender':
      return { type: 'declareSurrender' };
    case 'passTurn':
      return { type: 'passTurn' };
    default:
      return null;
  }
}

/** Human-readable socket state for the room panel. */
export function connectionLabel(status: SocketStatus): string {
  switch (status) {
    case 'connected':
      return 'Live';
    case 'reconnecting':
      return 'Reconnecting';
    case 'connecting':
      return 'Connecting';
    default:
      return 'Offline';
  }
}

export interface MultiplayerGameRouteProps {
  /** The live room id from `/g/:gameId`. */
  gameId: string;
  /** Router-owned navigation back to `/` (defaults to the SPA lobby). */
  onNavigateLobby?: () => void;
}

/**
 * Thin multiplayer adapter for `/g/:gameId`.
 *
 * It establishes the session, fetches the strictly projected room view, opens
 * `/ws/games/:gameId`, and feeds the shared Milestone 1 `GamePage` with an
 * M1-shaped view plus one action sink. Waiting rooms, live matches, finished
 * tables and zero-leak spectator views all render through the same M1 shell.
 */
export function MultiplayerGameRoute({
  gameId,
  onNavigateLobby,
}: MultiplayerGameRouteProps) {
  const [phase, setPhase] = useState<PagePhase>('loading');
  const [view, setView] = useState<MultiplayerView | null>(null);
  const [socketStatus, setSocketStatus] = useState<SocketStatus>('connecting');
  const [rejection, setRejection] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const [joining, setJoining] = useState(false);
  const [joinError, setJoinError] = useState<string | null>(null);
  const socketRef = useRef<GameSocket | null>(null);
  const copiedTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const goLobby = onNavigateLobby ?? navigateToLobby;

  useEffect(() => {
    let disposed = false;
    setPhase('loading');
    setView(null);
    setRejection(null);
    setSocketStatus('connecting');

    const boot = async () => {
      // The HttpOnly guest cookie must exist before the WebSocket handshake,
      // so a first-time visitor on a shared invite URL never races the session.
      try {
        await getOrCreateSession();
      } catch {
        // The view request also carries (and refreshes) the session cookie.
      }

      let initial: MultiplayerView;
      try {
        initial = await fetchGameView(gameId);
      } catch (reason) {
        if (disposed) return;
        const status = (reason as { status?: unknown } | null)?.status;
        setPhase(status === 404 ? 'notFound' : 'error');
        return;
      }
      if (disposed) return;

      setView(initial);
      setPhase('ready');
      socketRef.current = createGameSocket(gameId, {
        onView: (next) => {
          if (!disposed) setView(next);
        },
        onActionRejected: (_code, message) => {
          if (!disposed) setRejection(message);
        },
        onStatusChange: (status) => {
          if (!disposed) setSocketStatus(status);
        },
      });
    };

    void boot();

    return () => {
      disposed = true;
      const socket = socketRef.current;
      socketRef.current = null;
      socket?.dispose();
    };
  }, [gameId]);

  useEffect(
    () => () => {
      if (copiedTimerRef.current !== null) clearTimeout(copiedTimerRef.current);
    },
    [],
  );

  const send = (action: GameAction) => {
    const message = toWsMessage(action);
    if (!message) return;
    socketRef.current?.sendAction(message);
  };

  const copyInvite = async (url: string) => {
    try {
      await navigator.clipboard?.writeText(url);
      setCopied(true);
      if (copiedTimerRef.current !== null) clearTimeout(copiedTimerRef.current);
      copiedTimerRef.current = setTimeout(() => setCopied(false), 1500);
    } catch {
      setCopied(false);
    }
  };

  const joinSeat = async () => {
    if (joining) return;
    setJoining(true);
    setJoinError(null);
    try {
      const joined = await joinRoom(gameId);
      setView(joined.view);
    } catch (reason) {
      setJoinError(reason instanceof Error ? reason.message : String(reason));
    } finally {
      setJoining(false);
    }
  };

  const leaveRoomAndGo = async () => {
    try {
      await leaveRoom(gameId);
    } catch {
      // A running (or vanished) room cannot be left, but the user still exits.
    }
    goLobby();
  };

  if (phase !== 'ready' || view == null) {
    return (
      <section class="page game-page" data-testid="multiplayer-game" aria-label="Multiplayer room">
        {phase === 'loading' ? (
          <p class="loading" data-testid="multiplayer-loading" role="status">
            Loading room {gameId}…
          </p>
        ) : phase === 'notFound' ? (
          <div class="panel" data-testid="game-not-found" role="alert">
            <h2>Room not found</h2>
            <p>Game {gameId} does not exist or is no longer available.</p>
            <button type="button" class="action-button" onClick={goLobby}>
              Back to Lobby
            </button>
          </div>
        ) : phase === 'error' ? (
          <div class="panel" data-testid="game-load-error" role="alert">
            <h2>Could not load the room</h2>
            <p>Game {gameId} could not be opened right now.</p>
            <button type="button" class="action-button" onClick={goLobby}>
              Back to Lobby
            </button>
          </div>
        ) : null}
      </section>
    );
  }

  const engineView = toEngineView(view);
  const seats = roomSeats(view);
  const filled = seats.filter((seat) => seat.playerId !== null).length;
  const openSeat = filled < view.config.playerCount;
  const waiting = view.status === 'WaitingForPlayers';
  const seated = view.viewerSeat !== null;
  const inviteUrl =
    typeof window === 'undefined'
      ? `/g/${view.gameId}`
      : `${window.location.origin}/g/${view.gameId}`;

  return (
    <GamePage
      gameId={gameId}
      playerId={engineView.myId}
      externalMode
      externalView={engineView}
      externalLive={socketStatus === 'connected'}
      onExternalAction={send}
      onSwitchPlayer={() => {}}
      onLeaveGame={() => {
        if (seated && waiting) {
          void leaveRoomAndGo();
        } else {
          goLobby();
        }
      }}
      headerPanel={
        <section
          class="panel multiplayer-room-panel"
          data-testid="multiplayer-room-panel"
          aria-label="Room"
        >
          <h2>Room {view.gameId}</h2>
          <div class="multiplayer-room-badges">
            <span class="status-badge" data-testid="waiting-seat-count">
              {filled} / {view.config.playerCount}
            </span>
            <span class="status-badge">
              {view.config.turnTimeoutSeconds}s · Redirect{' '}
              {view.config.allowRedirect ? 'ON' : 'OFF'}
            </span>
            <span
              class="status-badge multiplayer-connection"
              data-status={socketStatus}
              data-testid="game-connection"
            >
              {connectionLabel(socketStatus)}
            </span>
          </div>

          {view.viewerSeat === null ? (
            <span class="status-badge" data-testid="spectator-badge">
              Spectator Mode (Read-Only)
            </span>
          ) : null}

          {waiting ? (
            <>
              <span class="multiplayer-room-label">Shareable invite link</span>
              <code class="multiplayer-invite-url" data-testid="invite-url">
                {inviteUrl}
              </code>
              <button
                type="button"
                class="action-button"
                data-testid="copy-invite"
                onClick={() => void copyInvite(inviteUrl)}
              >
                {copied ? 'Copied!' : 'Copy Invite Link'}
              </button>
              <ul class="multiplayer-seat-list" aria-label="Seats">
                {seats.map((seat) => (
                  <li
                    class="status-badge"
                    key={seat.seatIndex}
                    data-testid={`waiting-seat-${seat.seatIndex}`}
                  >
                    <span>Seat {seat.seatIndex + 1}</span>
                    <span>{seat.playerId ? seat.name : 'Open seat'}</span>
                    <span
                      class="multiplayer-presence"
                      data-present={seat.isConnected ? 'true' : 'false'}
                      data-testid={`seat-presence-${seat.seatIndex}`}
                      aria-label={seat.isConnected ? 'Connected' : 'Disconnected'}
                    />
                  </li>
                ))}
              </ul>
            </>
          ) : null}

          {waiting && !seated && openSeat ? (
            <button
              type="button"
              class="action-button green"
              data-testid="join-seat"
              disabled={joining}
              onClick={() => void joinSeat()}
            >
              {joining ? 'Joining…' : 'Join'}
            </button>
          ) : null}
          {waiting && seated ? (
            <button
              type="button"
              class="action-button"
              data-testid="leave-room"
              onClick={() => void leaveRoomAndGo()}
            >
              Leave
            </button>
          ) : null}

          {joinError ? (
            <p class="multiplayer-room-label" role="status">
              {joinError}
            </p>
          ) : null}
          {rejection ? (
            <p
              class="multiplayer-room-label"
              role="status"
              data-testid="action-rejected"
            >
              {rejection}
            </p>
          ) : null}
        </section>
      }
    />
  );
}
