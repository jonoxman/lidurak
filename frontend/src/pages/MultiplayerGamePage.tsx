import { useEffect, useMemo, useRef, useState } from 'preact/hooks';
import { GameTable, TableDeck, cardKey, type OpponentSummary } from '../components/GameTable';
import { SortBar, type SortMode } from '../components/SortBar';
import { ActionBar } from '../components/ActionBar';
import { createGameSocket, type GameSocket } from '../api/gameSocket';
import { fetchGameView, joinRoom, leaveRoom } from '../api/lobbyClient';
import { getOrCreateSession } from '../api/sessionClient';
import { navigateToLobby } from '../router/useRoute';
import { soundEngine } from '../audio/SoundEngine';
import { getStoredSortMode } from '../state/settings';
import { normalizeToken } from '../types';
import type {
  Card as CardData,
  PlayerGameView,
  PublicPlayerSummary,
  RoomSeatView,
  SocketStatus,
  WsClientMessage,
} from '../types/multiplayer';
import '../styles/lobby.css';

const HOW_TO_PLAY = [
  'Defend every attacking card. A higher card of the same suit beats it, and any trump beats a non-trump.',
  'Cover all attacks, then pass to end the bout; defended cards go to the discard pile.',
  'Throw in extra attacks that match a rank already on the table.',
  'Surrender to take every table card into your hand and skip your next attack.',
  'Redirect before any card is covered to hand the defense to the next player.',
  'The last player holding cards is the Durak.',
];

const RANK_VALUES: Record<string, number> = {
  two: 2,
  three: 3,
  four: 4,
  five: 5,
  six: 6,
  seven: 7,
  eight: 8,
  nine: 9,
  ten: 10,
  jack: 11,
  queen: 12,
  king: 13,
  ace: 14,
};

const SUIT_ORDER: Record<string, number> = {
  spades: 0,
  hearts: 1,
  diamonds: 2,
  clubs: 3,
};

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

/** Live WebSocket status label shown in the header. */
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

/** Player id sitting at a seat index (`null` when the seat is empty). */
export function seatPlayerId(view: PlayerGameView, seatIndex: number | null): string | undefined {
  if (seatIndex == null) return undefined;
  return view.players.find((player) => player.seatIndex === seatIndex)?.id;
}

/**
 * The viewer's opponents, ordered clockwise from their own seat. `GameTable`
 * turns the array order into the single opponent row, so a spectator falls
 * back to absolute seat order (there is no "you" to rotate around).
 */
export function multiplayerOpponents(view: PlayerGameView): OpponentSummary[] {
  const others = view.players.filter((player) => player.seatIndex !== view.viewerSeat);
  const seat = view.viewerSeat;
  const ordered =
    seat == null
      ? [...others].sort((left, right) => left.seatIndex - right.seatIndex)
      : [...others].sort((left, right) => {
          const distance = (player: PublicPlayerSummary): number =>
            (player.seatIndex - seat + view.config.playerCount) % view.config.playerCount;
          return distance(left) - distance(right);
        });
  return ordered.map((player) => ({
    id: player.id,
    name: player.name,
    cardCount: player.cardCount,
    hasPassed: player.hasPassed,
    finishRank: player.finishRank,
  }));
}

/** Rank names currently on the table (attack and defense cards). */
function tableRanks(view: PlayerGameView): Set<string> {
  const ranks = new Set<string>();
  view.tablePairs.forEach((pair) => {
    ranks.add(pair.attack.rank.toLowerCase());
    if (pair.defense) ranks.add(pair.defense.rank.toLowerCase());
  });
  return ranks;
}

/** Remaining cards this seat may still add to the bout. */
export function multiplayerThrowInCapacity(view: PlayerGameView): number {
  const remaining = Math.max(0, view.maxBoutAttacks - view.tablePairs.length);
  const phase = normalizeToken(view.phase ?? '');
  if (phase !== 'defense') return remaining;
  const uncovered = view.tablePairs.filter((pair) => !pair.defense).length;
  const defenderCount =
    view.players.find((player) => player.seatIndex === view.defenderIdx)?.cardCount ?? 0;
  return Math.max(0, Math.min(remaining, defenderCount - uncovered));
}

/** True when `defense` legally covers `attack` under the durak rules. */
export function isLegalCover(
  attack: CardData,
  defense: CardData,
  trumpSuit: string | null,
): boolean {
  const attackSuit = attack.suit.toLowerCase();
  const defenseSuit = defense.suit.toLowerCase();
  const trump = (trumpSuit ?? '').toLowerCase();
  return (
    (defenseSuit === attackSuit &&
      (RANK_VALUES[defense.rank.toLowerCase()] ?? 0) >
        (RANK_VALUES[attack.rank.toLowerCase()] ?? 0)) ||
    (defenseSuit === trump && attackSuit !== trump)
  );
}

/**
 * Legal actions for the viewer, derived from the strict M2 projection. The
 * names match `ActionBar` / `hasLegalAction` (`attack`, `cover`, `redirect`,
 * `throwIn`, `pass`, `surrender`).
 */
export function multiplayerLegalActions(view: PlayerGameView): string[] {
  if (view.status !== 'InProgress' || view.viewerSeat == null) return [];
  const phase = normalizeToken(view.phase ?? '');
  const seat = view.viewerSeat;
  const isDefender = view.defenderIdx === seat;
  const isAttacker = view.attackerIdx === seat;
  const me = view.players.find((player) => player.seatIndex === seat);
  const actions: string[] = [];
  const ranks = tableRanks(view);
  const uncovered = view.tablePairs.filter((pair) => !pair.defense);
  const matchingCards = view.hand.filter((card) => ranks.has(card.rank.toLowerCase()));

  if (phase === 'initialattack' && isAttacker && view.tablePairs.length === 0) {
    actions.push('attack');
  }

  if (phase === 'defense' && isDefender) {
    actions.push('surrender');
    if (view.config.allowRedirect && uncovered.length === view.tablePairs.length) {
      if (matchingCards.length > 0) actions.push('redirect');
    }
    if (uncovered.length > 0) actions.push('cover');
  }

  const throwInPhase = phase === 'defense' || phase === 'surrenderthrowin';
  const canThrowIn =
    throwInPhase &&
    view.tablePairs.length > 0 &&
    !isDefender &&
    me?.hasPassed !== true &&
    me?.finishRank == null &&
    matchingCards.length > 0 &&
    multiplayerThrowInCapacity(view) >= 1;
  if (canThrowIn) actions.push('throwIn');

  const allCovered =
    view.tablePairs.length > 0 && view.tablePairs.every((pair) => pair.defense);
  const canPass =
    me?.hasPassed !== true &&
    (phase === 'surrenderthrowin' || (phase === 'defense' && allCovered)) &&
    !actions.includes('throwIn');
  if (canPass) actions.push('pass');

  return actions;
}

/** The server-projected cards this seat may throw in right now. */
export function multiplayerThrowInCards(view: PlayerGameView): CardData[] {
  if (!multiplayerLegalActions(view).includes('throwIn')) return [];
  const ranks = tableRanks(view);
  return view.hand
    .filter((card) => ranks.has(card.rank.toLowerCase()))
    .slice(0, multiplayerThrowInCapacity(view));
}

/** Cards that may legitimately lift off the hand right now. */
export function multiplayerPlayableCards(view: PlayerGameView): CardData[] {
  const actions = multiplayerLegalActions(view);
  if (actions.includes('attack')) return view.hand;
  if (actions.includes('cover')) {
    const uncovered = view.tablePairs.filter((pair) => !pair.defense).map((pair) => pair.attack);
    return view.hand.filter((card) =>
      uncovered.some((attack) => isLegalCover(attack, card, view.trumpSuit)),
    );
  }
  if (actions.includes('redirect')) {
    const ranks = tableRanks(view);
    return view.hand.filter((card) => ranks.has(card.rank.toLowerCase()));
  }
  if (actions.includes('throwIn')) return multiplayerThrowInCards(view);
  // Covering is legal but nothing can beat the uncovered cards; leave the hand
  // at rest rather than lifting a card that cannot be played.
  return [];
}

function sortHand(
  hand: CardData[],
  mode: SortMode,
  customOrder: string[],
): CardData[] {
  const rank = (card: CardData): number => RANK_VALUES[card.rank.toLowerCase()] ?? 0;
  const suit = (card: CardData): number => SUIT_ORDER[card.suit.toLowerCase()] ?? 9;
  if (mode === 'custom') {
    const remaining = [...hand];
    const ordered: CardData[] = [];
    for (const key of customOrder) {
      const index = remaining.findIndex((card) => cardKey(card) === key);
      if (index >= 0) ordered.push(...remaining.splice(index, 1));
    }
    return [...ordered, ...remaining];
  }
  const sorted = [...hand];
  if (mode === 'suit') {
    sorted.sort((left, right) => suit(left) - suit(right) || rank(left) - rank(right));
  } else if (mode === 'pairs') {
    sorted.sort((left, right) => rank(left) - rank(right) || suit(left) - suit(right));
  } else {
    sorted.sort((left, right) => rank(left) - rank(right) || suit(left) - suit(right));
  }
  return sorted;
}

/**
 * The live M2 room (`/g/:gameId`).
 *
 * The HttpOnly guest cookie is established (and the first projection fetched)
 * before the WebSocket opens, so a first-time visitor on a shared invite URL
 * never races the session. A dealt match renders the ORIGINAL Milestone 1
 * gameplay shell: `[data-zone="sidebar-left"]`, the felt `GameTable` with drag
 * and double-click actions, and `[data-zone="sidebar-right"]` with the split
 * clock, talon and results. The table only ever renders `view.hand` for the
 * viewer: opponent hands arrive as counts, and a spectator (`viewerSeat: null`,
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
  const [selection, setSelection] = useState<{ hand: CardData[]; indices: number[] } | null>(null);
  const [copied, setCopied] = useState(false);
  const [joining, setJoining] = useState(false);
  const [joinError, setJoinError] = useState<string | null>(null);
  const [sortMode, setSortMode] = useState<SortMode>(() => {
    const stored = getStoredSortMode();
    return stored === 'custom' ? 'rank' : stored;
  });
  const [customHandOrder, setCustomHandOrder] = useState<string[]>([]);
  const socketRef = useRef<GameSocket | null>(null);
  const copiedTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const previousViewRef = useRef<PlayerGameView | null>(null);

  const goLobby = onNavigateLobby ?? navigateToLobby;

  // Session bootstrap → initial projection → socket, in that order.
  useEffect(() => {
    let disposed = false;

    setPhase('loading');
    setView(null);
    setSelection(null);
    setRejection(null);
    setSocketStatus('connecting');
    setCustomHandOrder([]);
    setSortMode((current) => (current === 'custom' ? getStoredSortMode() : current));
    previousViewRef.current = null;

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
          setSelection(null);
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

  // The turn clock ticks while a dealt match is running.
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

  // Sound effects follow the authoritative projection diff, never local clicks.
  useEffect(() => {
    if (view == null) return;
    const previous = previousViewRef.current;
    previousViewRef.current = view;
    if (previous == null) return;
    if (previous.status !== 'Finished' && view.status === 'Finished') {
      soundEngine.playGameOver();
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

  const sortedHand = useMemo(
    () => (view ? sortHand(view.hand, sortMode, customHandOrder) : []),
    [view, sortMode, customHandOrder],
  );

  const send = (message: WsClientMessage) => {
    socketRef.current?.sendAction(message);
    setSelection(null);
  };

  const viewerSeat = view?.viewerSeat ?? null;
  const seated = view != null && viewerSeat !== null;
  const reviewMode = view == null || view.status !== 'InProgress' || !seated;

  const selectedIndices = selection && selection.hand === sortedHand ? selection.indices : [];
  const selectedCards = selectedIndices
    .map((index) => sortedHand[index])
    .filter((card): card is CardData => card != null);

  const toggleCard = (card: CardData) => {
    const index = sortedHand.findIndex(
      (candidate) => candidate.suit === card.suit && candidate.rank === card.rank,
    );
    if (index < 0) return;
    const current = new Set(selectedIndices);
    if (current.has(index)) current.delete(index);
    else current.add(index);
    setSelection({ hand: sortedHand, indices: [...current].sort((left, right) => left - right) });
  };

  const sameRankGroup = (card: CardData, pool: CardData[] = selectedCards): CardData[] => {
    const chosen: CardData[] = [card];
    pool.forEach((candidate) => {
      if (candidate.rank !== card.rank) return;
      if (chosen.some((entry) => cardKey(entry) === cardKey(candidate))) return;
      chosen.push(candidate);
    });
    return chosen.slice(0, Math.max(1, view?.maxBoutAttacks ?? 1));
  };

  const throwInGroup = (card: CardData): CardData[] => {
    const legal = multiplayerThrowInCards(view as PlayerGameView);
    const legalKeys = new Set(legal.map(cardKey));
    const chosen: CardData[] = [card];
    selectedCards.forEach((candidate) => {
      if (!legalKeys.has(cardKey(candidate))) return;
      if (chosen.some((entry) => cardKey(entry) === cardKey(candidate))) return;
      chosen.push(candidate);
    });
    return chosen.slice(0, Math.max(1, multiplayerThrowInCapacity(view as PlayerGameView)));
  };

  const legalActions = view ? multiplayerLegalActions(view) : [];
  const canAct = seated && view?.status === 'InProgress';
  const isDefender = view != null && viewerSeat != null && view.defenderIdx === viewerSeat;
  const canThrowIn = canAct && legalActions.includes('throwIn');
  const canRedirect = canAct && legalActions.includes('redirect');
  const canCover = canAct && legalActions.includes('cover');
  const throwInCards = view ? multiplayerThrowInCards(view) : [];
  const throwInCapacity = view ? multiplayerThrowInCapacity(view) : 0;
  const playableCards = view && !reviewMode ? multiplayerPlayableCards(view) : [];

  const playCard = (card: CardData) => {
    if (!canAct || view == null) return;
    if (legalActions.includes('attack')) {
      send({ type: 'playAttack', cards: sameRankGroup(card) });
      return;
    }
    if (canThrowIn) {
      const cards = throwInGroup(card);
      send({ type: 'throwInCards', cards });
      return;
    }
    if (isDefender) {
      const coverable = view.tablePairs.reduce<number[]>((indices, pair, index) => {
        if (!pair.defense && isLegalCover(pair.attack, card, view.trumpSuit)) indices.push(index);
        return indices;
      }, []);
      if (canCover && coverable.length > 0) {
        send({ type: 'coverCard', attackIndex: coverable[0], defenseCard: card });
        return;
      }
      if (canRedirect && tableRanks(view).has(card.rank.toLowerCase())) {
        send({ type: 'redirectAttack', cards: sameRankGroup(card) });
      }
    }
  };

  const coverAttack = (attackIndex: number) => {
    if (!canCover || selectedCards.length !== 1) return;
    send({ type: 'coverCard', attackIndex, defenseCard: selectedCards[0] });
  };

  const playAttackDrop = (card: CardData) => {
    if (!canAct || !legalActions.includes('attack')) return;
    send({ type: 'playAttack', cards: sameRankGroup(card) });
  };

  const playCoverDrop = (card: CardData, attackIndex: number) => {
    if (!canCover) return;
    send({ type: 'coverCard', attackIndex, defenseCard: card });
  };

  const playThrowInDrop = (card: CardData) => {
    if (!canThrowIn) return;
    send({ type: 'throwInCards', cards: throwInGroup(card) });
  };

  const playRedirectDrop = (card: CardData) => {
    if (!canRedirect) return;
    send({ type: 'redirectAttack', cards: sameRankGroup(card) });
  };

  const reorderHand = (cards: CardData[]) => {
    setCustomHandOrder(cards.map(cardKey));
    setSortMode('custom');
  };

  const handleActionBar = (action: { type: string }) => {
    switch (action.type) {
      case 'passTurn':
        if (!canAct) return;
        send({ type: 'passTurn' });
        break;
      case 'declareSurrender':
        if (!canAct) return;
        send({ type: 'declareSurrender' });
        break;
      case 'redirect':
        if (!canRedirect || selectedCards.length === 0) return;
        send({ type: 'redirectAttack', cards: sameRankGroup(selectedCards[0]) });
        break;
      default:
        break;
    }
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

  const nameFor = (id: string): string =>
    view?.players.find((player) => player.id === id)?.name ?? id;

  if (phase === 'loading') {
    return (
      <section
        class="page multiplayer-page"
        data-testid="multiplayer-game"
        aria-label="Multiplayer game"
      >
        <div class="mp-state" data-testid="multiplayer-loading" role="status">
          <span class="lobby-loading-spinner" aria-hidden="true" />
          <p>Loading room {gameId}…</p>
        </div>
      </section>
    );
  }

  if (phase === 'notFound' || phase === 'error' || view == null) {
    const notFound = phase === 'notFound';
    return (
      <section
        class="page multiplayer-page"
        data-testid="multiplayer-game"
        aria-label="Multiplayer game"
      >
        <div
          class="mp-state"
          data-testid={notFound ? 'game-not-found' : 'game-load-error'}
          role="alert"
        >
          <h1>{notFound ? 'Room not found' : 'Could not load the room'}</h1>
          <p>
            {notFound
              ? `Game ${gameId} does not exist or is no longer available.`
              : `Game ${gameId} could not be opened right now.`}
          </p>
          <button type="button" class="m2-button primary" onClick={goLobby}>
            Back to Lobby
          </button>
        </div>
      </section>
    );
  }

  if (view.status === 'WaitingForPlayers') {
    return (
      <section
        class="page multiplayer-page"
        data-testid="multiplayer-game"
        aria-label="Multiplayer game"
      >
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
      </section>
    );
  }

  const phaseToken = normalizeToken(view.phase ?? '');
  const turnSeat =
    phaseToken === 'initialattack' ? view.attackerIdx : view.defenderIdx;
  const turnPlayerId = seatPlayerId(view, turnSeat) ?? view.viewerId;
  const viewerOnClock = turnPlayerId === view.viewerId;
  const seconds = secondsLeft(view, now);
  const displaySeconds = viewerOnClock && view.status === 'InProgress' ? seconds : 15;
  const turnLowTime = viewerOnClock && displaySeconds <= 5 && displaySeconds > 0;
  const attackerId = seatPlayerId(view, view.attackerIdx);
  const defenderId = seatPlayerId(view, view.defenderIdx);
  const viewerIsDefender = viewerSeat != null && view.defenderIdx === viewerSeat;
  const surrenderingDefender = view.status !== 'InProgress' || phaseToken === 'surrenderthrowin';
  const highlightUncovered =
    !reviewMode && viewerIsDefender && phaseToken === 'defense' &&
    view.tablePairs.some((pair) => !pair.defense);
  const gameOver = view.status === 'Finished';
  const winnerId = view.finishOrder[0];
  const winnerName = winnerId ? nameFor(winnerId) : null;
  const durakName = view.durakId ? nameFor(view.durakId) : null;
  const playersInSeatOrder = [...view.players].sort(
    (left, right) => left.seatIndex - right.seatIndex,
  );

  return (
    <section
      class="page game-page"
      data-testid="multiplayer-game"
      aria-label="Multiplayer game"
    >
      <header class="game-header">
        <div class="game-meta">
          <span class="game-id">Game {view.gameId}</span>
          <span
            class={`connection ${socketStatus === 'connected' ? 'live' : 'pending'}`}
            data-status={socketStatus}
            data-testid="game-connection"
          >
            {connectionLabel(socketStatus)}
          </span>
          {viewerSeat === null ? (
            <span class="mp-badge spectator" data-testid="spectator-badge">
              Spectator Mode (Read-Only)
            </span>
          ) : null}
        </div>
        <button
          type="button"
          class="action-button back-to-lobby"
          data-testid="back-to-lobby"
          onClick={goLobby}
        >
          Back to lobby
        </button>
      </header>

      {gameOver ? (
        <div class="game-over-banner" data-testid="game-over-banner" role="status">
          <strong class="game-over-title">
            {view.isDraw
              ? 'Game over — Draw'
              : winnerName
                ? `Game over — ${winnerName} wins`
                : 'Game over'}
          </strong>
          {!view.isDraw && durakName ? (
            <span class="game-over-durak" data-testid="durak-result">
              Durak: {durakName}
            </span>
          ) : null}
        </div>
      ) : null}

      <div class="game-shell">
        <aside class="game-sidebar sidebar-left" data-zone="sidebar-left">
          <section class="panel players-panel" data-testid="players-panel" aria-label="Player status">
            <h2>Players</h2>
            <ul class="status-badges players-list" data-testid="players-list">
              {playersInSeatOrder.map((player) => {
                const mine = player.id === view.viewerId;
                const statusTag =
                  player.cardCount === 0 && player.finishRank != null
                    ? player.finishRank === 1
                      ? 'WINNER'
                      : 'OUT'
                    : player.hasPassed
                      ? 'PASSED'
                      : null;
                return (
                  <li
                    key={player.id}
                    class={`status-badge${mine ? ' mine me' : ''}`}
                    data-testid={`player-row-${player.id}`}
                    data-player-id={player.id}
                    data-role={
                      player.id === attackerId
                        ? 'attacker'
                        : player.id === defenderId
                          ? 'defender'
                          : 'none'
                    }
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
                        {mine ? `${player.name} (You)` : player.name}
                      </span>
                    </span>
                    <span class="status-cards" data-testid={`player-cards-${player.id}`}>
                      {player.cardCount} cards
                    </span>
                    <span class="status-state-slot">
                      {statusTag ? (
                        <span class="status-tag-slot" data-status={statusTag}>
                          <span
                            class={`status-tag status-out${
                              statusTag === 'WINNER' ? ' winner-tag' : ''
                            }${statusTag === 'PASSED' ? ' passed-tag' : ''}`}
                            data-status={statusTag}
                          >
                            {statusTag}
                          </span>
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

        <div class="table-column">
          <GameTable
            myId={view.viewerId}
            myHand={sortedHand}
            opponents={multiplayerOpponents(view)}
            tablePairs={view.tablePairs}
            trumpSuit={view.trumpSuit ?? ''}
            boutPhase={view.phase ?? undefined}
            attackerId={attackerId}
            defenderId={defenderId}
            awaitingAttack={canAct && legalActions.includes('attack')}
            defending={canAct && viewerIsDefender && view.tablePairs.some((pair) => !pair.defense)}
            highlightUncovered={highlightUncovered}
            isSurrenderingDefender={surrenderingDefender}
            canRedirect={canRedirect}
            canThrowIn={canThrowIn}
            throwInCards={throwInCards}
            throwInCapacity={throwInCapacity}
            myHasPassed={
              view.players.find((player) => player.seatIndex === viewerSeat)?.hasPassed === true
            }
            isReviewMode={reviewMode}
            turnPlayerId={turnPlayerId}
            turnSecondsRemaining={displaySeconds}
            sortMode={sortMode}
            selectedKeys={reviewMode ? [] : selectedCards.map(cardKey)}
            playableKeys={playableCards.map(cardKey)}
            onCardClick={reviewMode ? undefined : toggleCard}
            onCardDoubleClick={reviewMode ? undefined : playCard}
            onTableCardClick={canCover ? coverAttack : undefined}
            onAttackDrop={reviewMode ? undefined : playAttackDrop}
            onCoverDrop={canCover ? playCoverDrop : undefined}
            onThrowInDrop={reviewMode ? undefined : playThrowInDrop}
            onRedirectDrop={reviewMode ? undefined : playRedirectDrop}
            onReorderHand={reviewMode ? undefined : reorderHand}
          >
            {reviewMode || legalActions.length === 0 ? null : (
              <div class="game-buttons">
                {legalActions.includes('attack') ? (
                  <button
                    type="button"
                    class="action-button green"
                    data-testid="action-attack"
                    disabled={selectedCards.length === 0}
                    onClick={() => send({ type: 'playAttack', cards: selectedCards })}
                  >
                    Attack
                  </button>
                ) : null}
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
            <div
              class="clock-half split-clock-half game-clock-half"
              data-testid="game-clock-half"
              data-active="false"
              data-highlighted="false"
            >
              <h2>Game</h2>
              <span class="game-clock split-clock-value" data-testid="game-clock">
                00:00
              </span>
            </div>
            <div
              class={`clock-half split-clock-half turn-clock-half${turnLowTime ? ' clock-low' : ''}`}
              data-testid="turn-clock-half"
              data-active={viewerOnClock ? 'true' : 'false'}
              data-highlighted={turnLowTime ? 'true' : 'false'}
              data-low-time={turnLowTime ? 'true' : 'false'}
            >
              <h2>Turn</h2>
              <span
                class={`turn-clock split-clock-value${viewerOnClock ? ' active' : ''}${
                  turnLowTime ? ' clock-low' : ''
                }`}
                data-testid="turn-clock"
                data-active={viewerOnClock ? 'true' : 'false'}
                data-highlighted={turnLowTime ? 'true' : 'false'}
                data-low-time={turnLowTime ? 'true' : 'false'}
              >
                {formatTurnClock(displaySeconds)}
              </span>
            </div>
          </section>

          <TableDeck
            talonCount={view.talonCount}
            bottomTrumpCard={view.bottomTrumpCard}
            trumpSuit={view.trumpSuit ?? ''}
            discardCount={view.discardCount ?? 0}
            lastDiscardCards={[]}
          />

          {gameOver ? (
            <section class="panel game-result" aria-label="Game over">
              <h2 data-testid="winner-result">
                {view.isDraw
                  ? 'Draw'
                  : winnerName
                    ? `${winnerName} wins`
                    : 'Game over'}
              </h2>
              {!view.isDraw && durakName ? (
                <p class="durak-line" data-testid="durak-line">
                  {durakName} is the Durak.
                </p>
              ) : null}
              <ol class="finish-order">
                {view.finishOrder.map((id) => (
                  <li key={id}>{nameFor(id)}</li>
                ))}
              </ol>
            </section>
          ) : null}
        </aside>
      </div>
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
