import { useEffect, useMemo, useRef, useState } from 'preact/hooks';
import { ActionBar } from '../components/ActionBar';
import {
  GameTable,
  TableDeck,
  cardKey,
  type OpponentSummary,
} from '../components/GameTable';
import { SortBar, type SortMode } from '../components/SortBar';
import { createGameSocket, type GameSocket } from '../api/gameSocket';
import { fetchGameView, joinRoom, leaveRoom } from '../api/lobbyClient';
import { getOrCreateSession } from '../api/sessionClient';
import { navigateToLobby } from '../router/useRoute';
import { soundEngine } from '../audio/SoundEngine';
import { getStoredSortMode } from '../state/settings';
import { isLegalCover } from './GamePage';
import type {
  Card as CardData,
  PlayerGameView,
  PublicPlayerSummary,
  RoomSeatView,
  SocketStatus,
  WsClientMessage,
} from '../types/multiplayer';
import '../styles/lobby.css';

type PagePhase = 'loading' | 'ready' | 'notFound' | 'error';

export interface MultiplayerGamePageProps {
  /** The live room id from `/g/:gameId`. */
  gameId: string;
  /** Router-owned navigation back to `/` (the app supplies it). */
  onNavigateLobby?: () => void;
}

/** `00:XX` turn-clock format. */
export function formatTurnClock(seconds: number): string {
  return `00:${String(Math.max(0, seconds)).padStart(2, '0')}`;
}

/** `mm:ss` overall game-clock format. */
export function formatGameClock(seconds: number): string {
  const total = Math.max(0, Math.floor(seconds));
  return `${String(Math.floor(total / 60)).padStart(2, '0')}:${String(total % 60).padStart(2, '0')}`;
}

/**
 * Seconds left on the turn clock: the deadline drives it while a match runs,
 * and the configured timeout is the resting value when no deadline is set.
 */
export function secondsLeft(view: PlayerGameView, nowMs: number): number {
  const timeout = view.config.turnTimeoutSeconds > 0 ? view.config.turnTimeoutSeconds : 15;
  const deadline = view.turnDeadlineEpochMs;
  if (deadline == null || deadline <= 0) return timeout;
  return Math.max(0, Math.min(timeout, Math.ceil((deadline - nowMs) / 1000)));
}

/** `52-card` for a four-player table, `36-card` otherwise. */
export function deckLabel(playerCount: number): string {
  return playerCount === 4 ? '52-card' : '36-card';
}

/** Live WebSocket status label shown in the room header. */
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

/** Lower-cased phase token (`initialAttack` -> `initialattack`). */
export function normalizePhase(phase: string | null | undefined): string {
  return (phase ?? '').replace(/[^a-z]/gi, '').toLowerCase();
}

/** The public player sitting at `seatIndex`, if any. */
export function playerAtSeat(
  view: PlayerGameView,
  seatIndex: number | null | undefined,
): PublicPlayerSummary | null {
  if (seatIndex == null) return null;
  return view.players.find((player) => player.seatIndex === seatIndex) ?? null;
}

/** The viewer's own player id (the session id for a spectator). */
export function multiplayerViewerId(view: PlayerGameView): string {
  return playerAtSeat(view, view.viewerSeat)?.id ?? view.viewerId;
}

/**
 * Opponents in clockwise order from the viewer, ready for `GameTable`'s single
 * opponent row. A spectator (`viewerSeat === null`) sees every seat, in seat
 * order, and no hand of their own.
 */
export function multiplayerOpponents(view: PlayerGameView): OpponentSummary[] {
  const count = Math.max(view.config.playerCount, view.players.length);
  const viewerSeat = view.viewerSeat;
  const ordered = [...view.players].sort((left, right) => {
    if (viewerSeat == null) return left.seatIndex - right.seatIndex;
    const leftOffset = (left.seatIndex - viewerSeat + count) % count;
    const rightOffset = (right.seatIndex - viewerSeat + count) % count;
    return leftOffset - rightOffset;
  });
  return ordered
    .filter((player) => viewerSeat == null || player.seatIndex !== viewerSeat)
    .map((player) => ({
      id: player.id,
      name: player.name,
      cardCount: player.cardCount,
      hasPassed: player.hasPassed,
      finishRank: player.finishRank,
    }));
}

/** Cards in the viewer's hand that share a rank with the current bout. */
export function tableRankCards(view: PlayerGameView): CardData[] {
  const ranks = new Set<string>();
  for (const pair of view.tablePairs) {
    ranks.add(pair.attack.rank.toLowerCase());
    if (pair.defense) ranks.add(pair.defense.rank.toLowerCase());
  }
  return view.hand.filter((card) => ranks.has(card.rank.toLowerCase()));
}

/** The hand cards that may legally be reflected onto the next defender. */
export function multiplayerRedirectCards(view: PlayerGameView): CardData[] {
  if (view.viewerSeat == null || view.defenderIdx !== view.viewerSeat) return [];
  if (!view.config.allowRedirect) return [];
  if (normalizePhase(view.phase) !== 'defense') return [];
  if (view.tablePairs.length === 0 || view.tablePairs.some((pair) => pair.defense)) return [];
  const candidates = tableRankCards(view);
  if (candidates.length === 0) return [];
  const count = Math.max(view.config.playerCount, view.players.length);
  const nextSeat = (view.defenderIdx + 1) % count;
  const next = playerAtSeat(view, nextSeat);
  if (!next) return [];
  if (view.tablePairs.length + candidates.length > 6) return [];
  if (next.cardCount < view.tablePairs.length + candidates.length) return [];
  return candidates;
}

/**
 * The server-equivalent legal-action list for the viewer, derived from the M2
 * projection (`phase`, seat indices, table and hand) because the multiplayer
 * view does not carry `legalActions`. `ActionBar` only renders `Pass` and
 * `Surrender`, and every command is re-validated by the authoritative server.
 */
export function multiplayerLegalActions(view: PlayerGameView): string[] {
  if (view.status !== 'InProgress' || view.viewerSeat == null) return [];
  const seat = view.viewerSeat;
  const phase = normalizePhase(view.phase);
  const isDefender = view.defenderIdx === seat;
  const isAttacker = view.attackerIdx === seat;
  const uncovered = view.tablePairs.filter((pair) => !pair.defense);
  const actions: string[] = [];

  if (phase === 'initialattack') {
    if (isAttacker && view.hand.length > 0) actions.push('attack');
    return actions;
  }
  if (phase !== 'defense' && phase !== 'surrenderthrowin') return actions;

  if (phase === 'defense' && isDefender) {
    if (uncovered.length > 0) {
      if (
        view.hand.some((card) =>
          uncovered.some((pair) => isLegalCover(pair.attack, card, view.trumpSuit ?? '')),
        )
      ) {
        actions.push('cover');
      }
      if (multiplayerRedirectCards(view).length > 0) actions.push('redirect');
      actions.push('surrender');
    }
    return actions;
  }

  if (
    view.tablePairs.length > 0 &&
    view.tablePairs.length < view.maxBoutAttacks &&
    tableRankCards(view).length > 0
  ) {
    actions.push('throwIn');
  }
  const viewer = playerAtSeat(view, seat);
  if (phase === 'surrenderthrowin') {
    actions.push('pass');
  } else if (uncovered.length === 0 && viewer?.hasPassed !== true) {
    actions.push('pass');
  }
  return actions;
}

/** Hand cards that are legal to play right now (half-raised by `GameTable`). */
export function multiplayerPlayableKeys(view: PlayerGameView): string[] {
  const legal = multiplayerLegalActions(view);
  if (legal.includes('attack')) return view.hand.map(cardKey);
  if (legal.includes('cover')) {
    const uncovered = view.tablePairs.filter((pair) => !pair.defense);
    return view.hand
      .filter((card) =>
        uncovered.some((pair) => isLegalCover(pair.attack, card, view.trumpSuit ?? '')),
      )
      .map(cardKey);
  }
  if (legal.includes('throwIn')) return tableRankCards(view).map(cardKey);
  if (legal.includes('redirect')) return multiplayerRedirectCards(view).map(cardKey);
  return [];
}

/** The seat a reflection would hand the defense to. */
export function multiplayerRedirectTarget(view: PlayerGameView): string | null {
  if (view.defenderIdx == null) return null;
  const count = Math.max(view.config.playerCount, view.players.length);
  for (let step = 1; step < count; step += 1) {
    const seat: number = (view.defenderIdx + step) % count;
    if (seat === view.defenderIdx) continue;
    const player = playerAtSeat(view, seat);
    if (player && player.cardCount > 0 && player.finishRank == null) return player.id;
  }
  return null;
}

/** Id of the player whose turn clock is running, if any. */
export function multiplayerClockPlayerId(view: PlayerGameView): string | undefined {
  const phase = normalizePhase(view.phase);
  if (phase === 'initialattack') return playerAtSeat(view, view.attackerIdx)?.id;
  if (phase === 'defense' || phase === 'surrenderthrowin') {
    return playerAtSeat(view, view.defenderIdx)?.id;
  }
  return undefined;
}

/** The six rules shown in the left `How to Play` panel. */
const HOW_TO_PLAY = [
  'Defend every attacking card. A higher card of the same suit beats it, and any trump beats a non-trump.',
  'Cover all attacks, then pass to end the bout; defended cards go to the discard pile.',
  'Throw in extra attacks that match a rank already on the table.',
  'Surrender to take every table card into your hand and skip your next attack.',
  'Redirect before any card is covered to hand the defense to the next player.',
  'The last player holding cards is the Durak.',
];

/**
 * The live M2 room (`/g/:gameId`).
 *
 * The HttpOnly guest cookie is established (and the first projection fetched)
 * before the WebSocket opens, so a first-time visitor on a shared invite URL
 * never races the session. A live match renders the Milestone 1 gameplay shell
 * (`GameTable`, `TableDeck`, `SortBar`, `ActionBar`); the table only ever
 * renders `view.hand` for the viewer, and a spectator (`viewerSeat: null`,
 * `hand: []`) gets a read-only, zero-leak table.
 */
export function MultiplayerGamePage({
  gameId,
  onNavigateLobby,
}: MultiplayerGamePageProps) {
  const [phase, setPhase] = useState<PagePhase>('loading');
  const [view, setView] = useState<PlayerGameView | null>(null);
  const [socketStatus, setSocketStatus] = useState<SocketStatus>('connecting');
  const [rejection, setRejection] = useState<string | null>(null);
  const [now, setNow] = useState(() => Date.now());
  const [copied, setCopied] = useState(false);
  const [joining, setJoining] = useState(false);
  const [joinError, setJoinError] = useState<string | null>(null);
  const socketRef = useRef<GameSocket | null>(null);
  const copiedTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const goLobby = onNavigateLobby ?? navigateToLobby;

  // Session bootstrap → initial projection → socket, in that order.
  useEffect(() => {
    let disposed = false;

    setPhase('loading');
    setView(null);
    setRejection(null);
    setSocketStatus('connecting');

    const boot = async () => {
      // `GET /api/session` mints the HttpOnly `lidurak_session` cookie, which
      // must exist before the WebSocket handshake identifies this visitor.
      try {
        await getOrCreateSession();
      } catch {
        // The view request also carries (and refreshes) the session cookie.
      }

      let initial: PlayerGameView;
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
          if (disposed) return;
          setView(next);
          setRejection(null);
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

  // The digital turn clock ticks while a match is running.
  useEffect(() => {
    if (view?.status !== 'InProgress') return;
    setNow(Date.now());
    const timer = setInterval(() => setNow(Date.now()), 250);
    return () => clearInterval(timer);
  }, [view?.status, view?.turnDeadlineEpochMs]);

  // A copied-link confirmation never outlives the page.
  useEffect(
    () => () => {
      if (copiedTimerRef.current !== null) clearTimeout(copiedTimerRef.current);
    },
    [],
  );

  const send = (message: WsClientMessage) => {
    socketRef.current?.sendAction(message);
  };

  const inviteUrl = view ? `${window.location.origin}/g/${view.gameId}` : '';

  const copyInvite = async () => {
    try {
      await navigator.clipboard?.writeText(inviteUrl);
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

  const leave = async () => {
    try {
      await leaveRoom(gameId);
    } catch {
      // A room that already vanished still sends the user home.
    }
    goLobby();
  };

  const live = phase === 'ready' && view != null && view.status !== 'WaitingForPlayers';

  return (
    <section
      class={`page ${live ? 'game-page' : 'multiplayer-page'}`}
      data-testid="multiplayer-game"
      aria-label="Multiplayer game"
    >
      {phase === 'loading' ? (
        <div class="mp-state" data-testid="multiplayer-loading" role="status">
          <span class="lobby-loading-spinner" aria-hidden="true" />
          <p>Loading room {gameId}…</p>
        </div>
      ) : null}

      {phase === 'notFound' ? (
        <div class="mp-state" data-testid="game-not-found" role="alert">
          <h1>Room not found</h1>
          <p>Game {gameId} does not exist or is no longer available.</p>
          <button type="button" class="m2-button primary" onClick={goLobby}>
            Back to Lobby
          </button>
        </div>
      ) : null}

      {phase === 'error' ? (
        <div class="mp-state" data-testid="game-load-error" role="alert">
          <h1>Could not load the room</h1>
          <p>Game {gameId} could not be opened right now.</p>
          <button type="button" class="m2-button primary" onClick={goLobby}>
            Back to Lobby
          </button>
        </div>
      ) : null}

      {phase === 'ready' && view ? (
        view.status === 'WaitingForPlayers' ? (
          <WaitingRoom
            view={view}
            socketStatus={socketStatus}
            inviteUrl={inviteUrl}
            copied={copied}
            joining={joining}
            joinError={joinError}
            onCopy={() => void copyInvite()}
            onJoin={() => void joinSeat()}
            onLeave={() => void leave()}
            onBack={goLobby}
          />
        ) : (
          <LiveMatch
            view={view}
            socketStatus={socketStatus}
            now={now}
            rejection={rejection}
            onSend={send}
            onBack={goLobby}
          />
        )
      ) : null}
    </section>
  );
}

interface WaitingRoomProps {
  view: PlayerGameView;
  socketStatus: SocketStatus;
  inviteUrl: string;
  copied: boolean;
  joining: boolean;
  joinError: string | null;
  onCopy: () => void;
  onJoin: () => void;
  onLeave: () => void;
  onBack: () => void;
}

/** State A: a shareable invite room that has not been dealt yet. */
function WaitingRoom({
  view,
  socketStatus,
  inviteUrl,
  copied,
  joining,
  joinError,
  onCopy,
  onJoin,
  onLeave,
  onBack,
}: WaitingRoomProps) {
  const seats = [...view.seats].sort((left, right) => left.seatIndex - right.seatIndex);
  const filled = seats.filter((seat) => seat.playerId !== null).length;
  const openSeat = filled < view.config.playerCount;
  const viewerSeated = view.viewerSeat !== null;

  return (
    <div class="mp-waiting" data-testid="waiting-room">
      <header class="mp-room-header">
        <div class="mp-room-heading">
          <h1 class="mp-room-title">Room {view.gameId}</h1>
          <div class="mp-badges">
            <span class="mp-badge" data-testid="waiting-seat-count">
              {filled} / {view.config.playerCount}
            </span>
            <span class="mp-badge">{deckLabel(view.config.playerCount)} deck</span>
            <span class="mp-badge">{view.config.turnTimeoutSeconds}s</span>
            <span
              class={`mp-badge ${view.config.allowRedirect ? 'on' : 'off'}`}
              data-testid="waiting-redirect"
            >
              Redirect {view.config.allowRedirect ? 'ON' : 'OFF'}
            </span>
            <span class="mp-badge">{view.config.isPublic ? 'Public' : 'Private'}</span>
            <span
              class="mp-connection"
              data-status={socketStatus}
              data-testid="game-connection"
            >
              <span class="mp-dot" aria-hidden="true" />
              {connectionLabel(socketStatus)}
            </span>
          </div>
        </div>
        <button type="button" class="m2-button secondary" data-testid="back-to-lobby" onClick={onBack}>
          Back to Lobby
        </button>
      </header>

      <div class="mp-invite">
        <span class="mp-block-label">Shareable invite link</span>
        <code class="mp-invite-url" data-testid="invite-url">
          {inviteUrl}
        </code>
        <button type="button" class="m2-button primary" data-testid="copy-invite" onClick={onCopy}>
          {copied ? 'Copied!' : 'Copy Invite Link'}
        </button>
      </div>

      <ul class="mp-seat-list" aria-label="Seats">
        {seats.map((seat: RoomSeatView) => (
          <li class="mp-seat-row" key={seat.seatIndex} data-testid={`waiting-seat-${seat.seatIndex}`}>
            <span class="mp-seat-number">Seat {seat.seatIndex + 1}</span>
            <span class="mp-seat-name">{seat.displayName ?? 'Open seat'}</span>
            <span
              class={`mp-dot ${seat.isConnected ? 'on' : 'off'}`}
              data-testid={`seat-presence-${seat.seatIndex}`}
              aria-label={seat.isConnected ? 'Connected' : 'Disconnected'}
            />
          </li>
        ))}
      </ul>

      <div class="mp-waiting-actions">
        {!viewerSeated && openSeat ? (
          <button
            type="button"
            class="m2-button primary"
            data-testid="join-seat"
            disabled={joining}
            onClick={onJoin}
          >
            {joining ? 'Joining…' : 'Join Seat'}
          </button>
        ) : null}
        {viewerSeated ? (
          <button
            type="button"
            class="m2-button secondary"
            data-testid="leave-room"
            onClick={onLeave}
          >
            Leave Room
          </button>
        ) : null}
      </div>

      {joinError ? (
        <p class="m2-status-text" role="status">
          {joinError}
        </p>
      ) : null}
    </div>
  );
}

interface LiveMatchProps {
  view: PlayerGameView;
  socketStatus: SocketStatus;
  now: number;
  rejection: string | null;
  onSend: (message: WsClientMessage) => void;
  onBack: () => void;
}

/**
 * State B: the live projected match rendered through the Milestone 1 gameplay
 * interface. Every command still travels over the room's `GameSocket`.
 */
function LiveMatch({ view, socketStatus, now, rejection, onSend, onBack }: LiveMatchProps) {
  const [sortMode, setSortMode] = useState<SortMode>(() => getStoredSortMode());
  // ITEM-6b-style own card sequence, kept for this match only.
  const [customHandOrder, setCustomHandOrder] = useState<string[]>([]);
  // Selection belongs to the projection it was picked against, so a new
  // authoritative view can never submit stale indices.
  const [selection, setSelection] = useState<{ view: PlayerGameView; keys: string[] }>({
    view,
    keys: [],
  });
  const previousViewRef = useRef<PlayerGameView | null>(null);
  const [matchStartMs] = useState(() => Date.now());
  const [finishedAtMs, setFinishedAtMs] = useState<number | null>(null);

  const viewerSeat = view.viewerSeat;
  const spectator = viewerSeat === null;
  const readOnly = spectator || view.status === 'Finished';
  const legalActions = multiplayerLegalActions(view);
  const phase = normalizePhase(view.phase);

  // Sound effects follow the authoritative state diffs, never local clicks.
  useEffect(() => {
    const previous = previousViewRef.current;
    previousViewRef.current = view;
    if (!previous) return;

    if (previous.status !== 'Finished' && view.status === 'Finished') {
      soundEngine.playGameOver();
      return;
    }
    if (
      normalizePhase(view.phase) === 'surrenderthrowin' &&
      normalizePhase(previous.phase) !== 'surrenderthrowin'
    ) {
      const tableCards = previous.tablePairs.reduce(
        (total, pair) => total + 1 + (pair.defense ? 1 : 0),
        0,
      );
      soundEngine.playSurrender(Math.max(1, tableCards));
      return;
    }
    const addedAttacks = view.tablePairs.length - previous.tablePairs.length;
    if (addedAttacks > 0) {
      if (view.attackerIdx !== previous.attackerIdx) soundEngine.playRedirect();
      else soundEngine.playAttackCard(addedAttacks);
    }
    const coveredBefore = previous.tablePairs.filter((pair) => pair.defense).length;
    const coveredNow = view.tablePairs.filter((pair) => pair.defense).length;
    if (coveredNow > coveredBefore) soundEngine.playDefendCard();
    if (view.talonCount < previous.talonCount && view.hand.length > previous.hand.length) {
      soundEngine.playTalonDraw(view.hand.length - previous.hand.length);
    }
  }, [view]);

  useEffect(() => {
    if (view.status === 'Finished' && finishedAtMs == null) setFinishedAtMs(Date.now());
  }, [view.status, finishedAtMs]);

  // ITEM-6b: the custom sequence drops every played card, keeps the surviving
  // order and appends each newly drawn card at the end.
  const orderedHand = useMemo(() => {
    if (sortMode !== 'custom') return view.hand;
    const remaining = [...view.hand];
    const ordered: CardData[] = [];
    for (const key of customHandOrder) {
      const index = remaining.findIndex((card) => cardKey(card) === key);
      if (index >= 0) ordered.push(...remaining.splice(index, 1));
    }
    return [...ordered, ...remaining];
  }, [view.hand, sortMode, customHandOrder]);

  const selectedKeys = selection.view === view ? selection.keys : [];
  const selectedCards = orderedHand.filter((card) => selectedKeys.includes(cardKey(card)));

  const setKeys = (keys: string[]) => setSelection({ view, keys });

  const toggleCard = (card: CardData) => {
    const key = cardKey(card);
    setKeys(
      selectedKeys.includes(key)
        ? selectedKeys.filter((entry) => entry !== key)
        : [...selectedKeys, key],
    );
  };

  /** The clicked card plus every pooled card of its rank (opening attack). */
  const sameRankGroup = (card: CardData): CardData[] => {
    const pool = selectedCards.some((entry) => cardKey(entry) === cardKey(card))
      ? selectedCards
      : [...selectedCards, card];
    const chosen: CardData[] = [card];
    for (const candidate of pool) {
      if (candidate.rank !== card.rank) continue;
      if (chosen.some((entry) => cardKey(entry) === cardKey(candidate))) continue;
      chosen.push(candidate);
    }
    return chosen.slice(0, Math.max(1, view.maxBoutAttacks));
  };

  /** The clicked card plus every pooled legal throw-in card. */
  const throwInGroup = (card: CardData): CardData[] => {
    const legalRankCards = tableRankCards(view);
    const isLegal = (candidate: CardData) =>
      legalRankCards.some((legal) => cardKey(legal) === cardKey(candidate));
    const pool = selectedCards.some((entry) => cardKey(entry) === cardKey(card))
      ? selectedCards
      : [...selectedCards, card];
    const chosen: CardData[] = [card];
    for (const candidate of pool) {
      if (!isLegal(candidate)) continue;
      if (chosen.some((entry) => cardKey(entry) === cardKey(candidate))) continue;
      chosen.push(candidate);
    }
    return chosen.slice(0, Math.max(1, view.maxBoutAttacks - view.tablePairs.length));
  };

  /** The clicked card plus every pooled table-rank card (reflection). */
  const redirectGroup = (card: CardData): CardData[] => {
    const legalKeys = new Set(multiplayerRedirectCards(view).map(cardKey));
    const pool = selectedCards.some((entry) => cardKey(entry) === cardKey(card))
      ? selectedCards
      : [...selectedCards, card];
    const chosen: CardData[] = [card];
    for (const candidate of pool) {
      if (!legalKeys.has(cardKey(candidate))) continue;
      if (chosen.some((entry) => cardKey(entry) === cardKey(candidate))) continue;
      chosen.push(candidate);
    }
    return chosen.slice(0, 6);
  };

  const submitAttack = (card: CardData) => {
    setKeys([]);
    onSend({ type: 'playAttack', cards: sameRankGroup(card) });
  };
  const submitThrowIn = (card: CardData) => {
    setKeys([]);
    onSend({ type: 'throwInCards', cards: throwInGroup(card) });
  };
  const submitCover = (card: CardData, attackIndex: number) => {
    setKeys([]);
    onSend({ type: 'coverCard', attackIndex, defenseCard: card });
  };
  const submitRedirect = (card: CardData) => {
    setKeys([]);
    onSend({ type: 'redirectAttack', cards: redirectGroup(card) });
  };

  const handleCardDoubleClick = (card: CardData) => {
    const actions = multiplayerLegalActions(view);
    if (actions.includes('cover')) {
      const targets = view.tablePairs.reduce<number[]>((indices, pair, index) => {
        if (!pair.defense && isLegalCover(pair.attack, card, view.trumpSuit ?? '')) {
          indices.push(index);
        }
        return indices;
      }, []);
      if (targets.length === 1) {
        submitCover(card, targets[0]);
        return;
      }
    }
    if (
      actions.includes('redirect') &&
      multiplayerRedirectCards(view).some((entry) => cardKey(entry) === cardKey(card))
    ) {
      submitRedirect(card);
      return;
    }
    if (actions.includes('attack')) {
      submitAttack(card);
      return;
    }
    if (
      actions.includes('throwIn') &&
      tableRankCards(view).some((entry) => cardKey(entry) === cardKey(card))
    ) {
      submitThrowIn(card);
    }
  };

  const handleTableCardClick = (attackIndex: number) => {
    if (!legalActions.includes('cover')) return;
    if (selectedCards.length !== 1) return;
    const pair = view.tablePairs[attackIndex];
    if (!pair || pair.defense) return;
    if (!isLegalCover(pair.attack, selectedCards[0], view.trumpSuit ?? '')) return;
    submitCover(selectedCards[0], attackIndex);
  };

  const handleActionBar = (action: { type: string }) => {
    if (action.type === 'passTurn') {
      onSend({ type: 'passTurn' });
      return;
    }
    if (action.type === 'declareSurrender') {
      onSend({ type: 'declareSurrender' });
    }
  };

  const reorderHand = (cards: CardData[]) => {
    setCustomHandOrder(cards.map(cardKey));
    setSortMode('custom');
  };

  const attackerId = playerAtSeat(view, view.attackerIdx)?.id;
  const defenderId = playerAtSeat(view, view.defenderIdx)?.id;
  const clockPlayerId = multiplayerClockPlayerId(view);
  const timedSeconds = view.status === 'Finished' ? 0 : secondsLeft(view, now);
  const viewerOnClock = clockPlayerId != null && clockPlayerId === multiplayerViewerId(view);
  const turnLowTime = viewerOnClock && timedSeconds > 0 && timedSeconds <= 5;
  const gameSeconds = Math.max(0, Math.round(((finishedAtMs ?? now) - matchStartMs) / 1000));

  const playersInSeatOrder = [...view.players].sort(
    (left, right) => left.seatIndex - right.seatIndex,
  );
  const roleFor = (player: PublicPlayerSummary): 'attacker' | 'defender' | 'none' => {
    if (view.status === 'Finished') return 'none';
    if (player.seatIndex === view.attackerIdx) return 'attacker';
    if (player.seatIndex === view.defenderIdx) return 'defender';
    return 'none';
  };

  const winnerId = view.finishOrder[0];
  const nameFor = (id: string): string =>
    view.players.find((player) => player.id === id)?.name ?? id;
  const gameIsDraw = view.isDraw;
  const durakName = view.durakId ? nameFor(view.durakId) : null;

  return (
    <>
      <header class="game-header">
        <div class="game-meta">
          <span class="game-id">Room {view.gameId}</span>
          <span
            class={`connection ${socketStatus === 'connected' ? 'live' : 'pending'}`}
            data-status={socketStatus}
            data-testid="game-connection"
          >
            {connectionLabel(socketStatus)}
          </span>
          {spectator ? (
            <span class="mp-badge spectator" data-testid="spectator-badge">
              Spectator Mode (Read-Only)
            </span>
          ) : null}
        </div>
        <button
          type="button"
          class="action-button back-to-lobby"
          data-testid="back-to-lobby"
          onClick={onBack}
        >
          Back to lobby
        </button>
      </header>

      {view.status === 'Finished' ? (
        <div class="game-over-banner" data-testid="game-over-banner" role="status">
          <strong class="game-over-title">
            {gameIsDraw
              ? 'Game over — Draw'
              : winnerId
                ? `Game over — ${nameFor(winnerId)} wins`
                : 'Game over'}
          </strong>
          {!gameIsDraw && durakName ? (
            <span class="game-over-durak">Durak: {durakName}</span>
          ) : null}
        </div>
      ) : null}

      <div class="game-shell">
        <aside class="game-sidebar sidebar-left" data-zone="sidebar-left">
          <section class="panel players-panel" data-testid="players-panel" aria-label="Player status">
            <h2>Players</h2>
            <ul class="status-badges players-list" data-testid="players-list">
              {playersInSeatOrder.map((player) => {
                const mine = player.seatIndex === viewerSeat;
                const role = roleFor(player);
                return (
                  <li
                    class={`status-badge${mine ? ' mine me' : ''}`}
                    key={player.id}
                    data-testid={`roster-${player.id}`}
                    data-role={role}
                  >
                    <span class="status-player">
                      <span
                        class={`presence-dot${player.isConnected ? ' present' : ''}`}
                        data-testid={`presence-dot-${player.id}`}
                        data-present={player.isConnected ? 'true' : 'false'}
                        role="img"
                        aria-label={player.isConnected ? 'Present' : 'Away'}
                      />
                      <span class="status-name">
                        {player.name}
                        {mine ? ' (You)' : ''}
                      </span>
                    </span>
                    <span class="status-cards" data-testid={`player-cards-${player.id}`}>
                      {player.cardCount} cards
                    </span>
                    <span class="status-state-slot">
                      {player.finishRank != null ? (
                        <span class="status-tag-slot" data-status="OUT">
                          <span class="status-tag status-rank status-out">
                            {player.finishRank === 1 ? 'WINNER' : 'OUT'}
                          </span>
                        </span>
                      ) : player.hasPassed ? (
                        <span class="status-tag-slot" data-status="PASSED">
                          <span class="status-tag passed-tag status-out">PASSED</span>
                        </span>
                      ) : null}
                    </span>
                  </li>
                );
              })}
            </ul>
          </section>

          <section class="panel" aria-label="How to Play">
            <h2>How to Play</h2>
            <ul class="how-to-play">
              {HOW_TO_PLAY.map((line) => (
                <li key={line}>{line}</li>
              ))}
            </ul>
          </section>

          {rejection ? (
            <p class="m2-status-text" role="status" data-testid="action-rejected">
              {rejection}
            </p>
          ) : null}
        </aside>

        <div class="table-column" data-testid="multiplayer-table">
          <GameTable
            myId={multiplayerViewerId(view)}
            myHand={orderedHand}
            opponents={multiplayerOpponents(view)}
            tablePairs={view.tablePairs}
            trumpSuit={view.trumpSuit ?? ''}
            boutPhase={view.phase ?? ''}
            redirectTargetId={multiplayerRedirectTarget(view)}
            attackerId={attackerId}
            defenderId={defenderId}
            awaitingAttack={!readOnly && legalActions.includes('attack')}
            defending={
              !readOnly &&
              phase === 'defense' &&
              view.defenderIdx === viewerSeat &&
              view.tablePairs.some((pair) => !pair.defense)
            }
            highlightUncovered={
              !readOnly &&
              phase === 'defense' &&
              view.defenderIdx === viewerSeat &&
              view.tablePairs.some((pair) => !pair.defense)
            }
            isSurrenderingDefender={
              !readOnly && phase === 'surrenderthrowin' && view.defenderIdx === viewerSeat
            }
            canRedirect={!readOnly && legalActions.includes('redirect')}
            canThrowIn={!readOnly && legalActions.includes('throwIn')}
            throwInCards={tableRankCards(view)}
            throwInCapacity={Math.max(0, view.maxBoutAttacks - view.tablePairs.length)}
            myHasPassed={playerAtSeat(view, viewerSeat)?.hasPassed === true}
            isReviewMode={readOnly}
            isBot={false}
            turnPlayerId={clockPlayerId}
            turnSecondsRemaining={timedSeconds}
            sortMode={sortMode}
            selectedKeys={selectedKeys}
            playableKeys={multiplayerPlayableKeys(view)}
            onCardClick={readOnly ? undefined : toggleCard}
            onCardDoubleClick={readOnly ? undefined : handleCardDoubleClick}
            onTableCardClick={
              !readOnly && legalActions.includes('cover') ? handleTableCardClick : undefined
            }
            onAttackDrop={
              readOnly
                ? undefined
                : (card) => {
                    if (legalActions.includes('attack')) submitAttack(card);
                  }
            }
            onCoverDrop={
              !readOnly && legalActions.includes('cover')
                ? (card, attackIndex) => submitCover(card, attackIndex)
                : undefined
            }
            onThrowInDrop={
              readOnly
                ? undefined
                : (card) => {
                    if (
                      legalActions.includes('throwIn') &&
                      tableRankCards(view).some((entry) => cardKey(entry) === cardKey(card))
                    ) {
                      submitThrowIn(card);
                    }
                  }
            }
            onRedirectDrop={
              !readOnly && legalActions.includes('redirect')
                ? (card) => submitRedirect(card)
                : undefined
            }
            onReorderHand={readOnly ? undefined : reorderHand}
          >
            {readOnly ? null : (
              <div class="game-buttons">
                <ActionBar legalActions={legalActions} onAction={handleActionBar} />
              </div>
            )}
          </GameTable>

          <section
            class="panel sidebar-box sidebar-sort-box hand-sort-box"
            data-zone="hand-sort-box"
            data-testid="hand-sort-box"
            aria-label="Hand sorting"
          >
            <h2>HAND SORTING</h2>
            <SortBar mode={sortMode} onModeChange={setSortMode} />
          </section>
        </div>

        <aside class="game-sidebar sidebar-right" data-zone="sidebar-right">
          <section
            class="panel clock-split-panel"
            data-testid="clock-panel"
            aria-label="Game and turn clocks"
          >
            <div class="clock-half split-clock-half game-clock-half" data-testid="game-clock-half">
              <h2>Game</h2>
              <span class="game-clock split-clock-value" data-testid="game-clock">
                {formatGameClock(gameSeconds)}
              </span>
            </div>
            <div
              class={`clock-half split-clock-half turn-clock-half${turnLowTime ? ' clock-low' : ''}`}
              data-testid="turn-clock-half"
              data-active={viewerOnClock ? 'true' : 'false'}
              data-low-time={turnLowTime ? 'true' : 'false'}
            >
              <h2>Turn</h2>
              <span
                class={`turn-clock split-clock-value${viewerOnClock ? ' active' : ''}`}
                data-testid="turn-clock"
                data-active={viewerOnClock ? 'true' : 'false'}
                data-low-time={turnLowTime ? 'true' : 'false'}
              >
                {formatTurnClock(timedSeconds)}
              </span>
            </div>
          </section>

          <TableDeck
            talonCount={view.talonCount}
            bottomTrumpCard={view.bottomTrumpCard}
            trumpSuit={view.trumpSuit ?? ''}
            discardCount={view.discardCount}
          />

          {view.status === 'Finished' ? (
            <section class="panel game-result" data-testid="game-results" aria-label="Game over">
              <h2>
                {gameIsDraw ? 'Draw' : winnerId ? `${nameFor(winnerId)} wins` : 'Game over'}
              </h2>
              <p class="durak-line" data-testid="durak-result">
                {durakName ? `Durak: ${durakName}` : 'No durak'}
              </p>
              <ol class="finish-order">
                {view.finishOrder.map((id) => (
                  <li key={id}>{nameFor(id)}</li>
                ))}
              </ol>
            </section>
          ) : null}
        </aside>
      </div>
    </>
  );
}
