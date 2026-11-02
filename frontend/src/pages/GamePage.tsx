import { useEffect, useRef, useState } from 'preact/hooks';
import { ActionBar } from '../components/ActionBar';
import { GameTable, TableDeck, cardKey, defenderDoubleClickAction } from '../components/GameTable';
import { SortBar, type SortMode } from '../components/SortBar';
import { getGameView, sendAction as sendActionRest } from '../api/client';
import { GameWebSocket } from '../api/websocket';
import { soundEngine } from '../audio/SoundEngine';
import {
  buildCoverCard,
  buildDeclareSurrender,
  buildInitialAttack,
  buildPassTurn,
  buildRedirectAttack,
  buildThrowInCards,
  hasLegalAction,
  isGameOverPhase,
  isInitialAttackPhase,
  normalizeToken,
  type Card as GameCard,
  type GameAction,
  type PlayerGameView,
} from '../types';

const EMPTY_SELECTION: Set<number> = new Set();

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

const rankValue = (rank: string): number => RANK_VALUES[rank.toLowerCase()] ?? 0;

/** True when `defense` legally covers `attack` under the durak rules. */
export function isLegalCover(attack: GameCard, defense: GameCard, trumpSuit: string): boolean {
  const attackSuit = attack.suit.toLowerCase();
  const defenseSuit = defense.suit.toLowerCase();
  const trump = trumpSuit.toLowerCase();
  return (
    (defenseSuit === attackSuit && rankValue(defense.rank) > rankValue(attack.rank)) ||
    (defenseSuit === trump && attackSuit !== trump)
  );
}

/**
 * The viewer's seat index. Opponents arrive in seat order without the viewer,
 * so the missing `p<index>` is the viewer's own seat.
 */
export function viewerSeatIndex(view: PlayerGameView): number {
  const opponentIds = new Set(view.opponents.map((opponent) => opponent.id));
  for (let index = 0; index <= view.opponents.length; index += 1) {
    if (!opponentIds.has(`p${index}`)) return index;
  }
  return 0;
}

export function formatClock(seconds: number): string {
  return `00:${String(seconds).padStart(2, '0')}`;
}

/**
 * Overall game clock: `mm:ss` since the first move, frozen at the recorded end
 * time once the game is over, and `00:00` before the first move.
 */
export function formatGameClock(
  startedAtMs: number | null | undefined,
  endedAtMs: number | null | undefined,
  nowMs: number,
): string {
  if (startedAtMs == null) return '00:00';
  const elapsedSeconds = Math.max(0, Math.round(((endedAtMs ?? nowMs) - startedAtMs) / 1000));
  const minutes = Math.floor(elapsedSeconds / 60);
  const seconds = elapsedSeconds % 60;
  return `${String(minutes).padStart(2, '0')}:${String(seconds).padStart(2, '0')}`;
}

/** Numeric part of a `p<seat>` id, used to keep every list in fixed seat order. */
export function seatNumber(id: string): number {
  const match = /^p(\d+)$/.exec(id);
  return match ? Number(match[1]) : Number.MAX_SAFE_INTEGER;
}

/**
 * Every player id in fixed seat order (`p0`, `p1`, ...). No list ever moves the
 * active player to the top.
 */
export function seatOrderedPlayerIds(view: PlayerGameView): string[] {
  const ids = [view.myId, ...view.opponents.map((opponent) => opponent.id)];
  return [...ids].sort((left, right) => seatNumber(left) - seatNumber(right));
}

/** Seconds left on the 15-second clock, clamped to `0..15`. */
export function clockSeconds(view: PlayerGameView, nowMs: number): number {
  const deadline = view.turnDeadlineMs ?? 0;
  if (deadline > 0) {
    return Math.max(0, Math.min(15, Math.ceil((deadline - nowMs) / 1000)));
  }
  return Math.max(0, Math.min(15, view.turnSecondsRemaining ?? 15));
}

/** Default grace period before a defenceless defender surrenders. */
export const AUTO_SURRENDER_MS = 3000;

/** A seat counts as present while focused and active within this window. */
export const PRESENCE_IDLE_MS = 30_000;

/** `p<seat>` id of the player sitting at `seatIdx`. */
export function seatIdFor(view: PlayerGameView, seatIdx: number): string | undefined {
  const viewerIndex = viewerSeatIndex(view);
  if (seatIdx === viewerIndex) return view.myId;
  return view.opponents[seatIdx < viewerIndex ? seatIdx : seatIdx - 1]?.id;
}

/** Id of the player whose turn clock is running (older views omit it). */
export function turnPlayerIdFor(view: PlayerGameView): string {
  if (view.turnPlayerId) return view.turnPlayerId;
  const seatIdx = isInitialAttackPhase(view.boutPhase) ? view.attackerIdx : view.defenderIdx;
  return seatIdFor(view, seatIdx) ?? view.myId;
}

/**
 * True when the viewer is the defender, faces at least one uncovered attack and
 * has no legal answer (no cover for any of them, no redirect).
 */
export function isDefenselessDefender(view: PlayerGameView): boolean {
  if (view.defenderIdx !== viewerSeatIndex(view)) return false;
  if (isGameOverPhase(view.boutPhase)) return false;
  const uncovered = view.tablePairs
    .filter((pair) => !pair.defense)
    .map((pair) => pair.attack);
  if (uncovered.length === 0) return false;
  if (!hasLegalAction(view.legalActions, 'surrender')) return false;
  if (hasLegalAction(view.legalActions, 'redirect')) return false;
  return !view.myHand.some((card) =>
    uncovered.some((attack) => isLegalCover(attack, card, view.trumpSuit)),
  );
}

const isSurrenderPhase = (phase: string): boolean =>
  normalizeToken(phase) === 'surrenderthrowin';

export interface GamePageProps {
  gameId: string;
  playerId: string;
  onSwitchPlayer: (playerId: string) => void;
  /** Grace period before a defenceless defender surrenders automatically. */
  autoSurrenderMs?: number;
}

export function GamePage({
  gameId,
  playerId,
  onSwitchPlayer,
  autoSurrenderMs = AUTO_SURRENDER_MS,
}: GamePageProps) {
  const [view, setView] = useState<PlayerGameView | null>(null);
  // Hand indices are kept together with the view they were picked against, so
  // a new authoritative view invalidates the selection without an effect that
  // could race a click.
  const [selection, setSelection] = useState<{
    view: PlayerGameView;
    indices: Set<number>;
  } | null>(null);
  const [live, setLive] = useState(false);
  const [now, setNow] = useState(() => Date.now());
  const socketRef = useRef<GameWebSocket | null>(null);
  const previousViewRef = useRef<PlayerGameView | null>(null);
  const tickedSecondRef = useRef(0);
  // Latest dispatch function, so timers can send without re-subscribing.
  const dispatchRef = useRef<(action: GameAction) => void>(() => {});
  const [autoSurrenderRemaining, setAutoSurrenderRemaining] = useState<number | null>(null);
  const [selfPresent, setSelfPresent] = useState(true);
  // Hand order is display-only state shared between the sidebar dropdown and
  // the table's hand.
  const [sortMode, setSortMode] = useState<SortMode>('suit');
  const lastActivityRef = useRef(Date.now());

  useEffect(() => {
    let active = true;
    setView(null);
    setLive(false);
    setSelection(null);
    previousViewRef.current = null;

    const socket = new GameWebSocket(gameId, playerId, (next) => {
      if (!active) return;
      setLive(true);
      setView(next);
    });
    socketRef.current = socket;
    socket.connect();

    // The socket sends the current state on connect; this REST read covers the
    // window before it opens and keeps the table usable if WebSockets are down.
    getGameView(gameId, playerId)
      .then((initial) => {
        if (active) setView((current) => current ?? initial);
      })
      .catch((reason: unknown) => {
        console.warn('Could not load the game view', reason);
      });

    return () => {
      active = false;
      socket.disconnect();
      if (socketRef.current === socket) socketRef.current = null;
    };
  }, [gameId, playerId]);

  // Browsers only unlock audio from a user gesture; do it once per page.
  useEffect(() => {
    soundEngine.installUnlockListeners();
    return () => soundEngine.removeUnlockListeners();
  }, []);

  // Presence: green while this window is focused and the mouse/keyboard moved
  // within the last 30 seconds, grey otherwise. The 1s tick notices inactivity.
  useEffect(() => {
    const markActive = () => {
      lastActivityRef.current = Date.now();
    };
    const evaluate = () => {
      const focused =
        typeof document === 'undefined' || typeof document.hasFocus !== 'function'
          ? true
          : document.hasFocus();
      setSelfPresent(focused && Date.now() - lastActivityRef.current < PRESENCE_IDLE_MS);
    };
    window.addEventListener('mousemove', markActive, { passive: true });
    window.addEventListener('keydown', markActive);
    window.addEventListener('mousedown', markActive);
    window.addEventListener('focus', markActive);
    window.addEventListener('blur', evaluate);
    document.addEventListener('visibilitychange', evaluate);
    const timer = setInterval(evaluate, 1000);
    evaluate();
    return () => {
      window.removeEventListener('mousemove', markActive);
      window.removeEventListener('keydown', markActive);
      window.removeEventListener('mousedown', markActive);
      window.removeEventListener('focus', markActive);
      window.removeEventListener('blur', evaluate);
      document.removeEventListener('visibilitychange', evaluate);
      clearInterval(timer);
    };
  }, []);

  useEffect(() => {
    const socket = socketRef.current;
    if (socket != null && typeof socket.sendPresence === 'function') {
      socket.sendPresence(selfPresent);
    }
  }, [selfPresent, playerId]);

  // Sound effects follow the authoritative state diffs, never local clicks.
  useEffect(() => {
    if (!view) return;
    const previous = previousViewRef.current;
    previousViewRef.current = view;
    if (!previous) return;

    if (!isGameOverPhase(previous.boutPhase) && isGameOverPhase(view.boutPhase)) {
      soundEngine.playGameOver();
      return;
    }

    if (isSurrenderPhase(view.boutPhase) && !isSurrenderPhase(previous.boutPhase)) {
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

    // Only the player whose hand grew hears the talon brush.
    if (
      view.talonCount < previous.talonCount &&
      view.myHand.length > previous.myHand.length
    ) {
      soundEngine.playTalonDraw(view.myHand.length - previous.myHand.length);
    }
  }, [view]);

  const deadlineMs = view?.turnDeadlineMs ?? 0;
  const gameStartedAtMs = view?.gameStartedAtMs ?? null;
  const gameEndedAtMs = view?.gameEndedAtMs ?? null;

  useEffect(() => {
    if (deadlineMs <= 0) return;
    setNow(Date.now());
    const timer = setInterval(() => setNow(Date.now()), 250);
    return () => clearInterval(timer);
  }, [deadlineMs]);

  // The overall game clock keeps ticking while a match is running, even between
  // bouts where no turn deadline is set. It stops once the end time is recorded.
  useEffect(() => {
    if (gameStartedAtMs == null || gameEndedAtMs != null) return;
    setNow(Date.now());
    const timer = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(timer);
  }, [gameStartedAtMs, gameEndedAtMs]);

  useEffect(() => {
    tickedSecondRef.current = 0;
  }, [deadlineMs]);

  const seconds = view ? clockSeconds(view, now) : 15;
  const timedPlayerId = view ? turnPlayerIdFor(view) : undefined;
  // Feedback #8: only the player being waited on sees the clock tick; every
  // other seat keeps a frozen 00:15 display.
  const viewerOnClock = view != null && timedPlayerId === view.myId;
  const displayedSeconds = viewerOnClock ? seconds : 15;

  // A subtle tick on each of the final five seconds, only for the player whose
  // own clock is the one running.
  useEffect(() => {
    if (!view || deadlineMs <= 0) return;
    if (timedPlayerId !== view.myId) return;
    if (seconds < 1 || seconds > 5) return;
    if (tickedSecondRef.current === seconds) return;
    tickedSecondRef.current = seconds;
    soundEngine.playClockTick(seconds);
  }, [seconds, deadlineMs, timedPlayerId, view]);

  // Item 18: a defender who cannot answer surrenders after a short grace
  // period, leaving enough time to click Surrender first.
  const defenseless = view ? isDefenselessDefender(view) : false;
  const uncoveredCount = view
    ? view.tablePairs.filter((pair) => !pair.defense).length
    : 0;

  useEffect(() => {
    if (!defenseless) {
      setAutoSurrenderRemaining(null);
      return;
    }
    const gracePeriod = Math.max(1, autoSurrenderMs);
    setAutoSurrenderRemaining(Math.max(1, Math.ceil(gracePeriod / 1000)));
    const surrenderAt = setTimeout(() => {
      dispatchRef.current(buildDeclareSurrender(playerId));
    }, gracePeriod);
    const ticker = setInterval(() => {
      setAutoSurrenderRemaining((remaining) =>
        remaining == null ? null : Math.max(0, remaining - 1),
      );
    }, 1000);
    return () => {
      clearTimeout(surrenderAt);
      clearInterval(ticker);
    };
  }, [defenseless, uncoveredCount, autoSurrenderMs, playerId]);

  if (!view) {
    return (
      <div class="page game-page">
        <header class="game-header">
          <span class="game-id">Game {gameId}</span>
          <button
            type="button"
            class="action-button back-to-lobby"
            onClick={() => {
              window.location.hash = '/';
            }}
          >
            Back to lobby
          </button>
        </header>
        <p class="loading">Loading game {gameId}…</p>
      </div>
    );
  }

  const selected = selection?.view === view ? selection.indices : EMPTY_SELECTION;
  const selectIndices = (indices: Set<number>) => setSelection({ view, indices });
  const clearSelection = () => setSelection(null);

  const nameFor = (id: string): string => {
    if (id === view.myId) return 'You';
    return view.opponents.find((opponent) => opponent.id === id)?.name ?? id;
  };

  const selectedCards: GameCard[] = [...selected]
    .sort((left, right) => left - right)
    .map((index) => view.myHand[index])
    .filter((card): card is GameCard => card !== undefined);
  const selectedKeys = selectedCards.map(cardKey);

  const tableRanks = new Set<string>();
  view.tablePairs.forEach((pair) => {
    tableRanks.add(pair.attack.rank.toLowerCase());
    if (pair.defense) tableRanks.add(pair.defense.rank.toLowerCase());
  });

  const viewerIndex = viewerSeatIndex(view);
  const isDefender = view.defenderIdx === viewerIndex;

  // Opponents arrive in seat order without the viewer, so a seat index maps
  // onto its player id by skipping the viewer's own seat.
  const playerIdForSeat = (seatIdx: number): string | undefined => seatIdFor(view, seatIdx);

  const isAttackerTurn =
    isInitialAttackPhase(view.boutPhase) && hasLegalAction(view.legalActions, 'attack');
  const canAttack =
    isAttackerTurn &&
    selectedCards.length > 0 &&
    selectedCards.length <= view.maxBoutAttacks &&
    selectedCards.every((card) => card.rank === selectedCards[0].rank);
  const canThrowIn =
    hasLegalAction(view.legalActions, 'throwIn') &&
    selectedCards.length > 0 &&
    view.tablePairs.length + selectedCards.length <= view.maxBoutAttacks &&
    selectedCards.every((card) => tableRanks.has(card.rank.toLowerCase()));

  // Item 12: every hand card the player could legally play right now lifts up.
  const uncoveredAttacks = view.tablePairs
    .filter((pair) => !pair.defense)
    .map((pair) => pair.attack);
  const playableKeys = (() => {
    if (isAttackerTurn) return view.myHand.map(cardKey);
    if (isDefender && hasLegalAction(view.legalActions, 'cover')) {
      return view.myHand
        .filter((card) =>
          uncoveredAttacks.some((attack) => isLegalCover(attack, card, view.trumpSuit)),
        )
        .map(cardKey);
    }
    if (isDefender && hasLegalAction(view.legalActions, 'redirect')) {
      return view.myHand
        .filter((card) => tableRanks.has(card.rank.toLowerCase()))
        .map(cardKey);
    }
    if (hasLegalAction(view.legalActions, 'throwIn')) {
      return view.myHand
        .filter((card) => tableRanks.has(card.rank.toLowerCase()))
        .map(cardKey);
    }
    return [];
  })();

  const dispatch = (action: GameAction) => {
    const socket = socketRef.current;
    if (socket != null && socket.isOpen()) {
      socket.sendAction(action);
      clearSelection();
      return;
    }
    sendActionRest(gameId, action)
      .then((result) => {
        if ('error' in result) {
          // Invalid actions are rejected silently; no banner ever covers the table.
          console.warn(`Action rejected: ${result.error}`);
        } else {
          setView(result);
          clearSelection();
        }
      })
      .catch((reason: unknown) => {
        console.warn('Action failed', reason);
      });
  };

  // Timers must always send through the dispatch of the latest render.
  dispatchRef.current = dispatch;

  const toggleCard = (card: GameCard) => {
    // Durak cards are unique, so suit + rank identifies the selected hand card.
    const index = view.myHand.findIndex(
      (handCard) => handCard.suit === card.suit && handCard.rank === card.rank,
    );
    if (index < 0) return;
    const next = new Set(selected);
    if (next.has(index)) next.delete(index);
    else next.add(index);
    selectIndices(next);
  };

  const attack = () => {
    if (canAttack) dispatch(buildInitialAttack(playerId, selectedCards));
  };

  const throwIn = () => {
    if (canThrowIn) dispatch(buildThrowInCards(playerId, selectedCards));
  };

  const coverAttack = (attackIndex: number) => {
    if (!hasLegalAction(view.legalActions, 'cover')) return;
    if (selectedCards.length !== 1) return;
    dispatch(buildCoverCard(playerId, attackIndex, selectedCards[0]));
  };

  /**
   * Double-click plays a card only when there is exactly one legal way to play
   * it; ambiguous cards are left alone.
   */
  const playCard = (card: GameCard) => {
    if (isAttackerTurn) {
      if (view.chaosMode) {
        const legalTargets = view.opponents.filter(
          (opponent) => opponent.finishRank == null && opponent.cardCount > 0,
        );
        if (legalTargets.length !== 1) return;
        dispatch(buildInitialAttack(playerId, [card], legalTargets[0].id));
      } else {
        dispatch(buildInitialAttack(playerId, [card]));
      }
      return;
    }

    if (
      !isDefender &&
      hasLegalAction(view.legalActions, 'throwIn') &&
      tableRanks.has(card.rank.toLowerCase())
    ) {
      dispatch(buildThrowInCards(playerId, [card]));
      return;
    }

    if (isDefender) {
      const beatable = view.tablePairs.reduce<number[]>((indices, pair, index) => {
        if (!pair.defense && isLegalCover(pair.attack, card, view.trumpSuit)) {
          indices.push(index);
        }
        return indices;
      }, []);
      // Item 8: cover, redirect or abstain — a card that could do both is
      // ambiguous, so the resolver refuses to guess.
      const defenderAction = defenderDoubleClickAction(card, {
        playerId,
        coverableAttackIndices: beatable,
        canCover: hasLegalAction(view.legalActions, 'cover'),
        canRedirect: hasLegalAction(view.legalActions, 'redirect'),
        canThrowIn: hasLegalAction(view.legalActions, 'throwIn'),
        matchesTableRank: tableRanks.has(card.rank.toLowerCase()),
      });
      if (defenderAction) dispatch(defenderAction);
    }
  };

  const handleActionBar = (action: { type: string }) => {
    switch (action.type) {
      case 'passTurn':
        dispatch(buildPassTurn(playerId));
        break;
      case 'declareSurrender':
        dispatch(buildDeclareSurrender(playerId));
        break;
      case 'redirect':
        if (!hasLegalAction(view.legalActions, 'redirect') || selectedCards.length === 0) {
          console.warn('Ignored redirect: no matching cards selected');
          return;
        }
        dispatch(buildRedirectAttack(playerId, selectedCards));
        break;
      default:
        break;
    }
  };

  const playAttackDrop = (card: GameCard, targetDefender?: string) => {
    if (!isAttackerTurn) {
      console.warn('Ignored attack drop: it is not this player’s attack');
      return;
    }
    dispatch(buildInitialAttack(playerId, [card], view.chaosMode ? targetDefender : undefined));
  };

  const playCoverDrop = (card: GameCard, attackIndex: number) => {
    if (!hasLegalAction(view.legalActions, 'cover')) {
      console.warn('Ignored cover drop: covering is not legal');
      return;
    }
    dispatch(buildCoverCard(playerId, attackIndex, card));
  };

  const playThrowInDrop = (card: GameCard) => {
    if (!hasLegalAction(view.legalActions, 'throwIn')) {
      console.warn('Ignored throw-in drop: throwing in is not legal');
      return;
    }
    dispatch(buildThrowInCards(playerId, [card]));
  };

  const playRedirectDrop = (card: GameCard) => {
    if (!hasLegalAction(view.legalActions, 'redirect')) {
      console.warn('Ignored redirect drop: redirection is not legal');
      return;
    }
    dispatch(buildRedirectAttack(playerId, [card]));
  };

  // Fixed seat order: the hotseat switcher never reorders the active player.
  const playerOptions = seatOrderedPlayerIds(view);
  const playersInSeatOrder = playerOptions.map((id) => {
    const opponent = view.opponents.find((candidate) => candidate.id === id);
    const mine = id === view.myId;
    return {
      id,
      name: mine ? nameFor(id) : opponent?.name ?? id,
      cardCount: mine ? view.myHand.length : opponent?.cardCount ?? 0,
      finishRank: opponent?.finishRank ?? null,
      mine,
    };
  });

  const winnerId = view.finishOrder[0];
  const durakId = view.finishOrder[view.finishOrder.length - 1];
  const gameOver = isGameOverPhase(view.boutPhase);

  // Req 12: a finished game is reviewed read-only. GameTable drops the command
  // controls, drop outlines, drags and double-click calls, while sorting stays.
  const reviewMode = gameOver;
  const gameClock = formatGameClock(view.gameStartedAtMs, view.gameEndedAtMs, now);
  // The table view never carries the viewer's own name, so the POV menu falls
  // back to the seat id instead of inventing a "You" entry.
  const povLabel = (id: string): string =>
    view.opponents.find((opponent) => opponent.id === id)?.name ?? id;
  // Req 14: the Pass button counts down while the viewer's throw-in clock runs.
  const passCountdownSeconds =
    viewerOnClock && hasLegalAction(view.legalActions, 'pass') ? Math.max(1, seconds) : null;

  return (
    <div class="page game-page">
      <header class="game-header">
        <div class="game-meta">
          <span class="game-id">Game {gameId}</span>
          <span class={`connection ${live ? 'live' : 'pending'}`}>
            {live ? 'Connected' : 'Connecting…'}
          </span>
          {/* Req 13: the header POV menu switches the inspected seat by name. */}
          <label class="pov-menu">
            <span class="pov-label">POV</span>
            <select
              class="pov-select"
              data-testid="pov-menu"
              aria-label="View as player"
              value={playerId}
              onChange={(event) => {
                const next = (event.currentTarget as HTMLSelectElement).value;
                if (next !== playerId) onSwitchPlayer(next);
              }}
            >
              {playersInSeatOrder.map((player) => (
                <option key={player.id} value={player.id}>
                  {povLabel(player.id)}
                </option>
              ))}
            </select>
          </label>
        </div>
        <button
          type="button"
          class="action-button back-to-lobby"
          onClick={() => {
            window.location.hash = '/';
          }}
        >
          Back to lobby
        </button>
      </header>

      {/* Req 12: the finished match announces its result above the shell. */}
      {gameOver ? (
        <div class="game-over-banner" data-testid="game-over-banner" role="status">
          <strong class="game-over-title">
            {view.isDraw
              ? 'Game over — Draw'
              : winnerId
                ? `Game over — ${nameFor(winnerId)} wins`
                : 'Game over'}
          </strong>
          {!view.isDraw && durakId ? (
            <span class="game-over-durak">
              {durakId === view.myId ? 'Durak: you' : `Durak: ${nameFor(durakId)}`}
            </span>
          ) : null}
        </div>
      ) : null}

      <div class="game-shell">
        <aside class="game-sidebar sidebar-left" data-zone="sidebar-left">
          <section class="panel">
            <h2>Hotseat</h2>
            <div class="hotseat-tabs" role="tablist" aria-label="Hotseat player switcher">
              {playerOptions.map((id) => (
                <button
                  key={id}
                  type="button"
                  role="tab"
                  aria-selected={id === playerId}
                  class={`hotseat-tab${id === playerId ? ' active' : ''}`}
                  onClick={() => onSwitchPlayer(id)}
                >
                  <span class="hotseat-name">{nameFor(id)}</span>
                  <span class="hotseat-id">{id}</span>
                </button>
              ))}
            </div>
          </section>

          <section class="panel" aria-label="How to Play">
            <h2>How to Play</h2>
            <ul class="how-to-play">
              {HOW_TO_PLAY.map((line) => (
                <li key={line}>{line}</li>
              ))}
            </ul>
          </section>
        </aside>

        <GameTable
          myId={view.myId}
          myHand={view.myHand}
          opponents={view.opponents}
          tablePairs={view.tablePairs}
          trumpSuit={view.trumpSuit}
          attackerId={playerIdForSeat(view.attackerIdx)}
          defenderId={playerIdForSeat(view.defenderIdx)}
          chaosMode={view.chaosMode ?? false}
          awaitingAttack={isAttackerTurn}
          defending={isDefender && view.tablePairs.some((pair) => !pair.defense)}
          canRedirect={hasLegalAction(view.legalActions, 'redirect')}
          canThrowIn={hasLegalAction(view.legalActions, 'throwIn')}
          isReviewMode={reviewMode}
          turnPlayerId={timedPlayerId}
          turnSecondsRemaining={seconds}
          sortMode={sortMode}
          selectedKeys={selectedKeys}
          playableKeys={playableKeys}
          onCardClick={toggleCard}
          onCardDoubleClick={playCard}
          onTableCardClick={hasLegalAction(view.legalActions, 'cover') ? coverAttack : undefined}
          onAttackDrop={playAttackDrop}
          onCoverDrop={playCoverDrop}
          onThrowInDrop={playThrowInDrop}
          onRedirectDrop={playRedirectDrop}
        >
          {gameOver ? null : (
            <div class="game-buttons">
              {isAttackerTurn ? (
                <button
                  type="button"
                  class="action-button green"
                  disabled={!canAttack}
                  onClick={attack}
                >
                  Attack
                </button>
              ) : null}
              {hasLegalAction(view.legalActions, 'throwIn') ? (
                <button
                  type="button"
                  class="action-button green"
                  disabled={!canThrowIn}
                  onClick={throwIn}
                >
                  Throw In
                </button>
              ) : null}
              <ActionBar
                legalActions={view.legalActions}
                onAction={handleActionBar}
                surrenderSeconds={autoSurrenderRemaining}
                passCountdownSeconds={passCountdownSeconds}
              />
            </div>
          )}
        </GameTable>

        <aside class="game-sidebar sidebar-right" data-zone="sidebar-right">
          {/* Req 7: the overall game clock is separate from the 15-second turn
              clock, and freezes at the recorded end time. */}
          <section class="panel game-clock-panel" aria-label="Game clock">
            <h2>Game</h2>
            <span
              class="game-clock"
              data-testid="game-clock"
              data-active={gameEndedAtMs == null ? 'true' : 'false'}
            >
              {gameClock}
            </span>
          </section>

          <section class="panel turn-clock-panel" aria-label="Turn clock">
            <h2>Turn</h2>
            <span
              class={`turn-clock${viewerOnClock ? ' active' : ''}`}
              data-testid="turn-clock"
              data-active={viewerOnClock ? 'true' : 'false'}
            >
              {formatClock(displayedSeconds)}
            </span>
          </section>

          <section class="panel" aria-label="Player status">
            <h2>Players</h2>
            <ul class="status-badges">
              {playersInSeatOrder.map((player) => {
                const present =
                  player.id === view.myId
                    ? selfPresent
                    : view.presentPlayers
                      ? view.presentPlayers.includes(player.id)
                      : (view.opponents.find((opponent) => opponent.id === player.id)?.isPresent ??
                        false);
                return (
                <li
                  key={player.id}
                  class={`status-badge${player.mine ? ' mine' : ''}`}
                  data-player-id={player.id}
                >
                  <span class="status-player">
                    <span
                      class={`presence-dot${present ? ' present' : ''}`}
                      data-testid={`presence-dot-${player.id}`}
                      data-present={present ? 'true' : 'false'}
                      role="img"
                      aria-label={present ? 'Present' : 'Away'}
                    />
                    <span class="status-name">{player.name}</span>
                  </span>
                  <span class="status-count">{player.cardCount} cards</span>
                  {player.finishRank != null ? (
                    <span class="status-rank">
                      {player.finishRank === 1 ? 'WINNER' : 'OUT'}
                    </span>
                  ) : null}
                </li>
                );
              })}
            </ul>
          </section>

          <TableDeck
            talonCount={view.talonCount}
            bottomTrumpCard={view.bottomTrumpCard}
            trumpSuit={view.trumpSuit}
            discardCount={view.discardCount ?? 0}
            lastDiscardCards={view.lastDiscardCards ?? []}
          />

          <section
            class="panel sidebar-box sidebar-sort-box"
            data-zone="hand-sort-box"
            data-testid="hand-sort-box"
            aria-label="Hand sorting"
          >
            <h2>Sort</h2>
            <SortBar mode={sortMode} onModeChange={setSortMode} />
          </section>

          {gameOver ? (
            <section class="panel game-result" aria-label="Game over">
              <h2>
                {view.isDraw
                  ? 'Draw'
                  : winnerId
                    ? `${nameFor(winnerId)} wins`
                    : 'Game over'}
              </h2>
              {!view.isDraw && durakId ? (
                <p class="durak-line">
                  {durakId === view.myId
                    ? 'You are the Durak.'
                    : `${nameFor(durakId)} is the Durak.`}
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
    </div>
  );
}
