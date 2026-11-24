/**
 * T-95-audit-gap: the multiplayer controller/adapter used by the Milestone 1
 * `GamePage`.
 *
 * The M2 backend speaks its own strictly filtered protocol (`durak.protocol`
 * `PlayerGameView`); the M1 table renders the local/bot projection
 * (`types.PlayerGameView`). This module is the single translation layer between
 * them, plus the REST hydration + `gameSocket` subscription the live route
 * needs. Nothing here reads cards the server did not project for this viewer.
 */
import { useCallback, useEffect, useMemo, useRef, useState } from 'preact/hooks';
import { createGameSocket, type GameSocket } from '../api/gameSocket';
import { fetchGameView, joinRoom, leaveRoom } from '../api/lobbyClient';
import { getOrCreateSession } from '../api/sessionClient';
import type {
  Card,
  GameAction,
  PlayerGameView as TableGameView,
  PublicPlayerSummary as TablePlayerSummary,
} from '../types';
import type {
  PlayerGameView as RoomGameView,
  SocketStatus,
  WsClientMessage,
} from '../types/multiplayer';

/** Lifecycle of the live room on the client. */
export type MultiplayerPhase = 'idle' | 'loading' | 'ready' | 'notFound' | 'error';

/** M1 seat id for a room seat index (`p0`, `p1`, …). */
export function seatIdOf(viewerSeat: number): string {
  return `p${viewerSeat}`;
}

/**
 * Maps one room seat id (`p3`) back to a player id, so the M1 table speaks the
 * same fixed seat ids the table already uses for the local/bot routes.
 */
function seatIndexById(view: RoomGameView): Map<string, number> {
  const seats = new Map<string, number>();
  view.players.forEach((player) => seats.set(player.id, player.seatIndex));
  return seats;
}

/** Maps a room player id list to the M1 `p<seat>` ids (unknowns pass through). */
function toSeatIds(ids: readonly string[] | undefined, view: RoomGameView): string[] {
  if (!ids) return [];
  const seats = seatIndexById(view);
  return ids.map((id) => {
    const seatIndex = seats.get(id);
    return seatIndex == null ? id : seatIdOf(seatIndex);
  });
}

/** Maps one room player id to the M1 seat id, when the seat is known. */
function toSeatId(id: string | null | undefined, view: RoomGameView): string | null {
  if (id == null) return null;
  const seatIndex = seatIndexById(view).get(id);
  return seatIndex == null ? id : seatIdOf(seatIndex);
}

/** The viewer's own seat index, or `-1` for a spectator. */
export function viewerSeatOf(view: RoomGameView): number {
  return view.viewerSeat ?? -1;
}

/**
 * Projects a live room view into the M1 table view.
 *
 * Seat ids are re-stamped as `p<seatIndex>` (the M1 convention), so every
 * existing table helper (`viewerSeatIndex`, `seatIdFor`, `seatOrderedPlayerIds`)
 * works unchanged. Only `hand` — the viewer's own cards — is ever copied from
 * the wire; opponents stay public summaries and a spectator gets an empty hand.
 */
export function toMilestoneOneView(view: RoomGameView): TableGameView {
  const viewerSeat = viewerSeatOf(view);
  const myPlayer =
    viewerSeat < 0 ? null : (view.players.find((player) => player.seatIndex === viewerSeat) ?? null);
  const opponents: TablePlayerSummary[] = view.players
    .filter((player) => player.seatIndex !== viewerSeat)
    .sort((left, right) => left.seatIndex - right.seatIndex)
    .map((player) => ({
      id: seatIdOf(player.seatIndex),
      name: player.name,
      cardCount: player.cardCount,
      hasPassed: player.hasPassed,
      finishRank: player.finishRank,
      isPresent: player.isConnected,
    }));

  const gameOver = view.status === 'Finished';
  return {
    myId: viewerSeat < 0 ? 'spectator' : seatIdOf(viewerSeat),
    myName: myPlayer?.name ?? 'Spectator',
    mySeatIdx: viewerSeat,
    myHand: viewerSeat < 0 ? [] : view.hand,
    opponents,
    tablePairs: view.tablePairs,
    talonCount: view.talonCount,
    bottomTrumpCard: view.bottomTrumpCard,
    trumpSuit: view.trumpSuit ?? '',
    attackerIdx: view.attackerIdx ?? 0,
    defenderIdx: view.defenderIdx ?? 0,
    boutPhase: gameOver ? 'gameOver' : (view.phase ?? 'waitingForPlayers'),
    legalActions: view.legalActions ?? [],
    finishOrder: toSeatIds(view.finishOrder, view),
    isDraw: view.isDraw,
    maxBoutAttacks: view.maxBoutAttacks,
    defenderDefenseless: view.defenderDefenseless ?? false,
    throwInCards: view.throwInCards ?? [],
    throwInCapacity: view.throwInCapacity ?? 0,
    canThrowIn: view.canThrowIn ?? false,
    allowRedirect: view.config.allowRedirect,
    eligibleTargetIds: toSeatIds(view.eligibleTargetIds, view),
    redirectTargetId: toSeatId(view.redirectTargetId, view),
    turnDeadlineMs: view.turnDeadlineEpochMs ?? 0,
    turnSecondsRemaining: view.turnSecondsRemaining ?? 0,
    turnPlayerId: toSeatId(view.turnPlayerId, view) ?? undefined,
    discardCount: view.discardCount,
    lastDiscardCards: view.lastDiscardCards ?? [],
    gameStartedAtMs: view.gameStartedAtMs ?? null,
    gameEndedAtMs: view.gameEndedAtMs ?? null,
    myHasPassed: view.myHasPassed ?? false,
    myFinishRank: view.myFinishRank ?? myPlayer?.finishRank ?? null,
    winners: toSeatIds(view.winners, view),
    durak: toSeatId(view.durakId, view),
    promptedPlayerIds: toSeatIds(view.promptedPlayerIds, view),
    isBot: false,
    playerTypes: [],
    chaosMode: false,
    transparentMode: false,
    devMode: false,
  };
}

/**
 * Maps one M1 game action onto the typed multiplayer frame. The server derives
 * the acting seat from the authenticated session, so `playerId` is dropped.
 */
export function toWireAction(action: GameAction): WsClientMessage | null {
  switch (action.type) {
    case 'initialAttack':
      return { type: 'playAttack', cards: (action.cards as Card[]) ?? [] };
    case 'coverCard':
      return {
        type: 'coverCard',
        attackIndex: action.attackIndex as number,
        defenseCard: action.defenseCard as Card,
      };
    case 'redirectAttack':
      return { type: 'redirectAttack', cards: (action.cards as Card[]) ?? [] };
    case 'throwInCards':
      return { type: 'throwInCards', cards: (action.cards as Card[]) ?? [] };
    case 'declareSurrender':
      return { type: 'declareSurrender' };
    case 'passTurn':
      return { type: 'passTurn' };
    default:
      return null;
  }
}

export interface MultiplayerGameController {
  /** Load lifecycle of the REST hydration. */
  phase: MultiplayerPhase;
  /** The raw room projection (seats, settings and status live here). */
  room: RoomGameView | null;
  /** The M1 table projection derived from `room`. */
  view: TableGameView | null;
  /** Live socket status, for the header/sidebar connection badge. */
  socketStatus: SocketStatus;
  /** True once the socket has delivered at least one frame. */
  live: boolean;
  /** Last action rejection message, if the server refused a move. */
  rejection: string | null;
  joining: boolean;
  joinError: string | null;
  /** Takes an open seat in a waiting room. */
  join: () => Promise<void>;
  /** Vacates the caller's seat in a waiting room. */
  leave: () => Promise<void>;
  /** Dispatches one M1 game action as a typed WebSocket frame. */
  dispatch: (action: GameAction) => void;
}

/**
 * Hydrates and subscribes one live room.
 *
 * The guest cookie is established (and the first projection fetched) before the
 * WebSocket opens, so a first-time visitor on a shared invite link never races
 * the session. `gameId === null` (the local/bot routes) keeps the controller
 * completely inert.
 */
export function useMultiplayerGame(gameId: string | null): MultiplayerGameController {
  const [phase, setPhase] = useState<MultiplayerPhase>(gameId ? 'loading' : 'idle');
  const [room, setRoom] = useState<RoomGameView | null>(null);
  const [socketStatus, setSocketStatus] = useState<SocketStatus>('connecting');
  const [live, setLive] = useState(false);
  const [rejection, setRejection] = useState<string | null>(null);
  const [joining, setJoining] = useState(false);
  const [joinError, setJoinError] = useState<string | null>(null);
  const socketRef = useRef<GameSocket | null>(null);

  useEffect(() => {
    if (gameId === null) {
      setPhase('idle');
      setRoom(null);
      return undefined;
    }

    let disposed = false;
    setPhase('loading');
    setRoom(null);
    setRejection(null);
    setLive(false);
    setSocketStatus('connecting');

    const boot = async () => {
      // The HttpOnly session cookie must exist before the WebSocket handshake
      // identifies this visitor.
      try {
        await getOrCreateSession();
      } catch {
        // The view request also carries (and refreshes) the session cookie.
      }

      let initial: RoomGameView;
      try {
        initial = await fetchGameView(gameId);
      } catch (reason) {
        if (disposed) return;
        const status = (reason as { status?: unknown } | null)?.status;
        setPhase(status === 404 ? 'notFound' : 'error');
        return;
      }
      if (disposed) return;

      setRoom(initial);
      setPhase('ready');

      const socket = createGameSocket(gameId, {
        onView: (next) => {
          if (disposed) return;
          setLive(true);
          setRoom(next);
        },
        onActionRejected: (_code, message) => {
          // Rejections are surfaced by the table's own state, never a banner.
          if (!disposed) setRejection(message);
        },
        onStatusChange: (status) => {
          if (!disposed) setSocketStatus(status);
        },
      });
      socketRef.current = socket;
    };

    void boot();

    return () => {
      disposed = true;
      socketRef.current?.dispose();
      socketRef.current = null;
    };
  }, [gameId]);

  const join = useCallback(async () => {
    if (gameId === null || joining) return;
    setJoining(true);
    setJoinError(null);
    try {
      const joined = await joinRoom(gameId);
      setRoom(joined.view);
    } catch (reason) {
      setJoinError(reason instanceof Error ? reason.message : String(reason));
    } finally {
      setJoining(false);
    }
  }, [gameId, joining]);

  const leave = useCallback(async () => {
    if (gameId === null) return;
    try {
      await leaveRoom(gameId);
    } catch {
      // A room that already vanished still lets the user go home.
    }
    setRoom(null);
    setPhase('idle');
  }, [gameId]);

  const dispatch = useCallback((action: GameAction) => {
    const message = toWireAction(action);
    if (message === null) return;
    socketRef.current?.sendAction(message);
    setRejection(null);
  }, []);

  // The mapped table view must keep a stable identity across renders: the
  // `GamePage` selection, hover and drag state are keyed to the view object it
  // was picked against, so a fresh projection on every render would drop every
  // click.
  const view = useMemo(() => (room ? toMilestoneOneView(room) : null), [room]);

  return {
    phase,
    room,
    view,
    socketStatus,
    live,
    rejection,
    joining,
    joinError,
    join,
    leave,
    dispatch,
  };
}
