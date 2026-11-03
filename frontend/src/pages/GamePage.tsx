import { useEffect, useRef, useState } from 'preact/hooks';
import { ActionBar } from '../components/ActionBar';
import { GameTable, TableDeck, cardKey, defenderDoubleClickAction } from '../components/GameTable';
import { SortBar, type SortMode } from '../components/SortBar';
import {
  createGame,
  createPresetGame,
  getGameReplay,
  getGameView,
  sendAction as sendActionRest,
} from '../api/client';
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
  type GameReplay,
  type PlayerGameView,
  type PlayerType,
  type ReplayFrame,
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

/**
 * ITEM-13: the active user is labelled `Name (You)` in the POV switchers and
 * the PLAYERS list; every other seat keeps its plain name.
 */
export function formatPlayerDisplayName(
  seatId: string,
  baseName: string,
  activePlayerId: string,
): string {
  if (seatId !== activePlayerId) return baseName;
  if (baseName.endsWith(' (You)')) return baseName;
  return `${baseName} (You)`;
}

/** The viewed seat's frozen projection from one replay frame (first seat if absent). */
export function replayFrameView(
  frame: ReplayFrame | null | undefined,
  playerId: string,
): PlayerGameView | null {
  if (!frame) return null;
  return frame.views[playerId] ?? Object.values(frame.views)[0] ?? null;
}

/** Any seat's projection from a frame; public fields are identical for all. */
const anyFrameView = (frame: ReplayFrame | null | undefined): PlayerGameView | null =>
  frame ? (Object.values(frame.views)[0] ?? null) : null;

/**
 * ITEM-PB-12c: everything a reviewer can actually see on the table. Two frames
 * share a signature when the bout, the discard pile, the talon and the phase are
 * unchanged, so a non-resolving `PassTurn` produces no visible step.
 */
function replayTableSignature(frame: ReplayFrame | null | undefined): string | null {
  const frameView = anyFrameView(frame);
  if (!frameView) return null;
  return JSON.stringify([
    frameView.tablePairs.map((pair) => [
      pair.attack.suit.toLowerCase(),
      pair.attack.rank.toLowerCase(),
      pair.defense?.suit.toLowerCase() ?? null,
      pair.defense?.rank.toLowerCase() ?? null,
    ]),
    frameView.discardCount ?? 0,
    frameView.talonCount,
    normalizeToken(frameView.boutPhase),
  ]);
}

/** True when `frame` is a pass that changed nothing on the table. */
export function isNonMoveFrame(
  previous: ReplayFrame | null | undefined,
  frame: ReplayFrame | null | undefined,
): boolean {
  if (!previous || !frame) return false;
  if (normalizeToken(frame.action?.type ?? '') !== 'passturn') return false;
  const before = replayTableSignature(previous);
  const after = replayTableSignature(frame);
  if (before == null || after == null) return false;
  return before === after;
}

/**
 * ITEM-PB-12c: the frames a reviewer may step through, with non-moves removed
 * so every step in `Move X / Y` is a visible change on the table.
 */
export function visibleReplayFrames(replay: GameReplay | null | undefined): ReplayFrame[] {
  const frames = replay?.frames ?? [];
  return frames.filter((frame, index) => !isNonMoveFrame(frames[index - 1], frame));
}

/** One sound effect to fire while stepping through a replay. */
export interface ReplayStepSound {
  event: 'cardPlay' | 'cardCover' | 'redirect' | 'surrender' | 'cardDraw' | 'gameOver';
  count: number;
}

/**
 * ITEM-PB-12b: the sound a frame should make, derived from its recorded action
 * and the position it lands on (never from local clicks).
 */
export function replayFrameSound(
  frames: ReplayFrame[],
  targetIdx: number,
): ReplayStepSound | null {
  if (frames.length === 0) return null;
  const index = Math.min(Math.max(targetIdx, 0), frames.length - 1);
  const frameView = anyFrameView(frames[index]);
  if (!frameView) return null;
  if (isGameOverPhase(frameView.boutPhase)) return { event: 'gameOver', count: 1 };
  const previous = index > 0 ? anyFrameView(frames[index - 1]) : null;
  switch (normalizeToken(frames[index].action?.type ?? '')) {
    case 'initialattack':
    case 'throwincards': {
      const added = Math.max(1, frameView.tablePairs.length - (previous?.tablePairs.length ?? 0));
      // A reflection moves the attacker, which is the visible cue for the arrow.
      if (previous != null && frameView.attackerIdx !== previous.attackerIdx) {
        return { event: 'redirect', count: 1 };
      }
      return { event: 'cardPlay', count: added };
    }
    case 'covercard':
      return { event: 'cardCover', count: 1 };
    case 'redirectattack':
      return { event: 'redirect', count: 1 };
    case 'declaresurrender': {
      const tableCards = (previous ?? frameView).tablePairs.reduce(
        (total, pair) => total + 1 + (pair.defense ? 1 : 0),
        0,
      );
      return { event: 'surrender', count: Math.max(1, tableCards) };
    }
    case 'passturn': {
      // Ending a bout draws from the talon; otherwise the cards just moved.
      const drawn = previous ? Math.max(0, previous.talonCount - frameView.talonCount) : 0;
      return drawn > 0
        ? { event: 'cardDraw', count: drawn }
        : { event: 'cardPlay', count: 1 };
    }
    default:
      return { event: 'cardPlay', count: 1 };
  }
}

/** Plays the sound of one replay frame on the shared sound engine. */
export function playReplayFrameSound(frames: ReplayFrame[], targetIdx: number): void {
  const sound = replayFrameSound(frames, targetIdx);
  if (!sound) return;
  switch (sound.event) {
    case 'cardCover':
      soundEngine.playDefendCard();
      return;
    case 'redirect':
      soundEngine.playRedirect();
      return;
    case 'surrender':
      soundEngine.playSurrender(sound.count);
      return;
    case 'cardDraw':
      soundEngine.playTalonDraw(sound.count);
      return;
    case 'gameOver':
      soundEngine.playGameOver();
      return;
    default:
      soundEngine.playAttackCard(sound.count);
  }
}

/** One-click scripted positions offered in the lobby and the game sidebar. */
export const QA_SCENARIOS: { id: string; label: string }[] = [
  { id: '3p-redirect-bob', label: '3P Redirect (Bob POV)' },
  { id: 'chaos-4p', label: '4P Chaos Targets' },
  { id: 'surrender-half-off', label: 'Surrender Half-Off' },
  { id: 'defenseless-surrender', label: 'Defenseless Auto-Surrender' },
  { id: 'discard-and-endgame', label: 'Discard & Endgame Durak' },
];

/**
 * ITEM-9 / ITEM-12: a match is finished when the authoritative view, the frame
 * on screen, or the last recorded frame says so — so a finished game opened
 * from its URL still shows the banner and the review controls.
 */
export function isFinishedMatch(
  view: PlayerGameView | null,
  displayedView: PlayerGameView | null,
  replay: GameReplay | null,
  playerId: string,
): boolean {
  if (view != null && isGameOverPhase(view.boutPhase)) return true;
  if (displayedView != null && isGameOverPhase(displayedView.boutPhase)) return true;
  const frames = replay?.frames ?? [];
  if (frames.length === 0) return false;
  const lastView = replayFrameView(frames[frames.length - 1], playerId);
  return lastView != null && isGameOverPhase(lastView.boutPhase);
}

/** Seconds left on the 15-second clock, clamped to `0..15`. */
export function clockSeconds(view: PlayerGameView, nowMs: number): number {
  const deadline = view.turnDeadlineMs ?? 0;
  if (deadline > 0) {
    return Math.max(0, Math.min(15, Math.ceil((deadline - nowMs) / 1000)));
  }
  return Math.max(0, Math.min(15, view.turnSecondsRemaining ?? 15));
}

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

/** T-90 ITEM-PREV-4a: grace before the client surrenders a lost defense. */
export const CLIENT_AUTO_SURRENDER_DELAY_MS = 3000;

/** T-90 ITEM-PREV-4b: grace before the client passes a thrower with no cards. */
export const CLIENT_AUTO_PASS_DELAY_MS = 1000;

/**
 * T-90 ITEM-PREV-4a: the viewed human is defending in `PHASE_DEFENSE` with no
 * legal answer at all (the server offers `surrender` but neither `cover` nor
 * `redirect`, or flags the defender as defenseless outright), so the client may
 * surrender on their behalf once the 3-second grace has elapsed.
 */
export function isClientAutoSurrenderState(view: PlayerGameView): boolean {
  if (normalizeToken(view.boutPhase) !== 'defense') return false;
  if (!hasLegalAction(view.legalActions, 'surrender')) return false;
  if (view.defenderDefenseless === true) return true;
  return (
    !hasLegalAction(view.legalActions, 'cover') &&
    !hasLegalAction(view.legalActions, 'redirect')
  );
}

/**
 * T-90 ITEM-PREV-4b: the viewed human is a thrower who cannot add a card — in
 * `SurrenderThrowIn`, or in a `Defense` whose table is fully covered — while
 * `pass` is legal and they have not passed yet.
 */
export function isClientAutoPassState(view: PlayerGameView): boolean {
  if (!hasLegalAction(view.legalActions, 'pass')) return false;
  if (hasLegalAction(view.legalActions, 'throwIn')) return false;
  if (view.myHasPassed) return false;
  const phase = normalizeToken(view.boutPhase);
  if (phase === 'surrenderthrowin') return true;
  return (
    phase === 'defense' &&
    view.tablePairs.length > 0 &&
    view.tablePairs.every((pair) => pair.defense != null)
  );
}

const isSurrenderPhase = (phase: string): boolean =>
  normalizeToken(phase) === 'surrenderthrowin';

export interface GamePageProps {
  gameId: string;
  playerId: string;
  onSwitchPlayer: (playerId: string) => void;
  /** Opens another match (rematch or QA preset); the router owns the URL. */
  onNavigateGame?: (gameId: string, playerId?: string) => void;
  /** Leaves the table; defaults to the root URL when the router owns it. */
  onLeaveGame?: () => void;
}

export function GamePage({
  gameId,
  playerId,
  onSwitchPlayer,
  onNavigateGame,
  onLeaveGame,
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
  const [selfPresent, setSelfPresent] = useState(true);
  // Hand order is display-only state shared between the sidebar dropdown and
  // the table's hand.
  const [sortMode, setSortMode] = useState<SortMode>('suit');
  // Item 12: the recorded match and the frame the review controls are showing.
  const [replay, setReplay] = useState<GameReplay | null>(null);
  const [replayFrameIdx, setReplayFrameIdx] = useState(0);
  // ITEM-PB-9: rematch / QA preset progress and the failure line, if any.
  const [rematchPending, setRematchPending] = useState(false);
  const [presetPending, setPresetPending] = useState(false);
  const [presetError, setPresetError] = useState<string | null>(null);
  // T-90 ITEM-PREV-4a: seconds left on the client-side auto-surrender badge
  // (`3 -> 2 -> 1`), or null while no defenseless defense is armed.
  const [surrenderSeconds, setSurrenderSeconds] = useState<number | null>(null);
  // T-90 ITEM-PREV-4b: true while the 1-second client auto-pass is armed.
  const [autoPassPending, setAutoPassPending] = useState(false);
  const autoSurrenderTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const autoSurrenderTickRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const autoSurrenderFiredKeyRef = useRef<string | null>(null);
  const autoPassTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const autoPassFiredKeyRef = useRef<string | null>(null);
  // The timers fire outside render, so they dispatch through the latest
  // `dispatch` closure (which owns the socket/REST choice).
  const dispatchRef = useRef<(action: GameAction) => void>(() => {});
  // Item 13: names remembered from every live view and replay frame.
  const knownNamesRef = useRef<Record<string, string>>({});
  // Game id whose replay was already fetched on mount, so the finished-game
  // effect does not refetch and jump a reviewer back to the final frame.
  const replayLoadedGameRef = useRef<string | null>(null);
  const lastActivityRef = useRef(Date.now());
  // The match whose view is mounted, so a POV switch is never mistaken for a
  // new game (ITEM-PB-12a).
  const viewGameRef = useRef<string | null>(null);
  // Latest inspected seat, read by the once-per-match replay fetch.
  const playerIdRef = useRef(playerId);
  playerIdRef.current = playerId;
  // Latest loaded replay, for the REST-view fallback of a finished match.
  const replayRef = useRef<GameReplay | null>(null);
  const setLoadedReplay = (loaded: GameReplay | null) => {
    replayRef.current = loaded;
    setReplay(loaded);
  };

  useEffect(() => {
    let active = true;
    // ITEM-PB-12a: only a new match resets the table and the review position —
    // switching the inspected seat keeps the frame the reviewer is on.
    if (viewGameRef.current !== gameId) {
      viewGameRef.current = gameId;
      setView(null);
      setSelection(null);
      setLoadedReplay(null);
      setReplayFrameIdx(0);
      replayLoadedGameRef.current = null;
    }
    // A different seat is a different projection: never diff sounds across it.
    previousViewRef.current = null;
    setLive(false);

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
        // A finished game survives only in its replay, so fall back to it
        // rather than leaving the page stuck on the loading state.
        const loadedFrames = replayRef.current?.frames ?? [];
        const fallback = replayFrameView(loadedFrames[loadedFrames.length - 1], playerId);
        if (active && fallback != null) setView((current) => current ?? fallback);
      });

    return () => {
      active = false;
      socket.disconnect();
      if (socketRef.current === socket) socketRef.current = null;
    };
  }, [gameId, playerId]);

  // ITEM-PB-12a: the recorded match belongs to the game, never to the inspected
  // seat, so it is fetched once per match. Opening a finished game's URL (or a
  // live room that is gone) still hydrates the table and the review controls.
  useEffect(() => {
    let active = true;
    const loadReplay = async () => {
      try {
        const loaded = await getGameReplay(gameId);
        if (!active || loaded.frames.length === 0) return;
        const finalView = replayFrameView(
          loaded.frames[loaded.frames.length - 1],
          playerIdRef.current,
        );
        // A running match keeps its live view; review mode only ever needs a
        // finished recording.
        if (finalView == null || !isGameOverPhase(finalView.boutPhase)) return;
        setLoadedReplay(loaded);
        setView((current) => current ?? finalView);
        setReplayFrameIdx(Math.max(0, visibleReplayFrames(loaded).length - 1));
        replayLoadedGameRef.current = gameId;
      } catch (reason: unknown) {
        if (active) console.warn('Could not load the game replay', reason);
      }
    };
    void loadReplay();
    return () => {
      active = false;
    };
  }, [gameId]);

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

  const gameOverPhase = view != null && isGameOverPhase(view.boutPhase);

  // Item 12: a finished match loads its recorded replay so the review controls
  // can step through it. A missing or failing endpoint leaves the live view in
  // place instead of breaking the page.
  useEffect(() => {
    if (!gameOverPhase) {
      setLoadedReplay(null);
      setReplayFrameIdx(0);
      return;
    }
    // The mount fetch already hydrated this finished match; refetching here
    // would jump a reviewer back to the final frame.
    if (replayLoadedGameRef.current === gameId) return;
    let active = true;
    try {
      if (typeof getGameReplay !== 'function') return;
      const request = getGameReplay(gameId);
      if (request == null || typeof request.then !== 'function') return;
      request
        .then((loaded) => {
          if (!active) return;
          setLoadedReplay(loaded);
          setReplayFrameIdx(Math.max(0, visibleReplayFrames(loaded).length - 1));
          replayLoadedGameRef.current = gameId;
        })
        .catch((reason: unknown) => {
          if (active) console.warn('Could not load the game replay', reason);
        });
    } catch (reason: unknown) {
      console.warn('Could not load the game replay', reason);
    }
    return () => {
      active = false;
    };
  }, [gameId, gameOverPhase]);

  // Item 13: remember every real name seen in a live view or a replay frame so
  // the POV menu can label each seat even when the current frame omits it.
  useEffect(() => {
    const remember = (name: string | undefined, id: string) => {
      if (typeof name === 'string' && name.length > 0) knownNamesRef.current[id] = name;
    };
    if (view) {
      remember(view.myName, view.myId);
      view.opponents.forEach((opponent) => remember(opponent.name, opponent.id));
    }
    if (replay) {
      replay.frames.forEach((frame) => {
        Object.values(frame.views).forEach((frameView) => {
          remember(frameView.myName, frameView.myId);
          frameView.opponents.forEach((opponent) => remember(opponent.name, opponent.id));
        });
      });
    }
  }, [view, replay]);

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

  // ITEM-ADD-9: a bot seat accepts no user input, even from a human inspecting
  // it through the POV menu.
  const isBotViewer = Boolean(
    view != null &&
      (view.isBot ||
        (view.playerTypes?.[viewerSeatIndex(view)] != null &&
          view.playerTypes[viewerSeatIndex(view)] !== 'human')),
  );

  // ITEM-9: the match is finished when the live view, the frame on screen or
  // the last recorded frame says so.
  // ITEM-PB-12c: the defensive filter guarantees every step in `Move X / Y` is
  // a visible change on the table, whatever the recording contains.
  const replayFrames = visibleReplayFrames(replay);
  const activeFrame =
    replayFrames.length > 0
      ? replayFrames[Math.min(Math.max(replayFrameIdx, 0), replayFrames.length - 1)]
      : null;
  const activeFrameView = replayFrameView(activeFrame, playerId);
  const gameOver =
    view != null && isFinishedMatch(view, activeFrameView, replay, playerId);
  const reviewMode = gameOver;

  // T-90 ITEM-PREV-4a / ITEM-PREV-4b: the position key behind each client-side
  // delay. It only changes when the position does, so an unrelated socket push
  // never restarts a grace timer and a fired key never fires twice.
  const tableKey = (tablePairs: PlayerGameView['tablePairs']): string =>
    tablePairs
      .map((pair) => `${cardKey(pair.attack)}/${pair.defense ? cardKey(pair.defense) : '-'}`)
      .join(',');

  const autoSurrenderKey =
    view != null && !isBotViewer && !reviewMode && isClientAutoSurrenderState(view)
      ? [
          view.myId,
          normalizeToken(view.boutPhase),
          view.attackerIdx,
          view.defenderIdx,
          tableKey(view.tablePairs),
          view.myHand.map(cardKey).join(','),
        ].join('|')
      : null;

  const autoPassKey =
    view != null && !isBotViewer && !reviewMode && isClientAutoPassState(view)
      ? [
          view.myId,
          normalizeToken(view.boutPhase),
          view.attackerIdx,
          view.defenderIdx,
          tableKey(view.tablePairs),
        ].join('|')
      : null;

  // T-90 ITEM-PREV-4a: keep the Surrender button on screen and clickable for the
  // full 3 seconds, count the badge down and dispatch once the grace elapses.
  useEffect(() => {
    if (autoSurrenderKey == null) {
      setSurrenderSeconds(null);
      autoSurrenderFiredKeyRef.current = null;
      return;
    }
    if (autoSurrenderFiredKeyRef.current === autoSurrenderKey) return;
    setSurrenderSeconds(CLIENT_AUTO_SURRENDER_DELAY_MS / 1000);
    const tick = setInterval(() => {
      setSurrenderSeconds((current) =>
        current != null && current > 1 ? current - 1 : current,
      );
    }, 1000);
    const timer = setTimeout(() => {
      autoSurrenderFiredKeyRef.current = autoSurrenderKey;
      setSurrenderSeconds(null);
      dispatchRef.current(buildDeclareSurrender(playerId));
    }, CLIENT_AUTO_SURRENDER_DELAY_MS);
    autoSurrenderTickRef.current = tick;
    autoSurrenderTimerRef.current = timer;
    return () => {
      clearInterval(tick);
      clearTimeout(timer);
      autoSurrenderTickRef.current = null;
      autoSurrenderTimerRef.current = null;
    };
  }, [autoSurrenderKey, playerId]);

  // T-90 ITEM-PREV-4b: wait a full second before passing for a thrower who has
  // no legal throw-in card, so the Pass button stays readable and clickable.
  useEffect(() => {
    if (autoPassKey == null) {
      autoPassFiredKeyRef.current = null;
      setAutoPassPending(false);
      return;
    }
    if (autoPassFiredKeyRef.current === autoPassKey) {
      setAutoPassPending(false);
      return;
    }
    setAutoPassPending(true);
    const timer = setTimeout(() => {
      autoPassFiredKeyRef.current = autoPassKey;
      setAutoPassPending(false);
      dispatchRef.current(buildPassTurn(playerId));
    }, CLIENT_AUTO_PASS_DELAY_MS);
    autoPassTimerRef.current = timer;
    return () => {
      clearTimeout(timer);
      autoPassTimerRef.current = null;
    };
  }, [autoPassKey, playerId]);

  // ITEM-PB-12b: stepping to another frame replays that move's sound, so a
  // reviewer hears the match as it happened.
  const stepReplay = (delta: number) => {
    const last = Math.max(0, replayFrames.length - 1);
    const next = Math.min(Math.max(replayFrameIdx + delta, 0), last);
    if (next === replayFrameIdx) return;
    playReplayFrameSound(replayFrames, next);
    setReplayFrameIdx(next);
  };

  // ITEM-FOLLOWUP-1: while reviewing, the left/right arrows step through the
  // recorded frames, clamped to the first and last move.
  useEffect(() => {
    if (!reviewMode || replayFrames.length === 0) return;
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.ctrlKey || event.altKey || event.metaKey) return;
      const target = event.target as HTMLElement | null;
      const tagName = target?.tagName?.toLowerCase();
      if (
        tagName === 'input' ||
        tagName === 'select' ||
        tagName === 'textarea' ||
        target?.isContentEditable === true
      ) {
        return;
      }
      if (event.key === 'ArrowLeft') {
        event.preventDefault();
        stepReplay(-1);
      } else if (event.key === 'ArrowRight') {
        event.preventDefault();
        stepReplay(1);
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [reviewMode, replay, replayFrameIdx]);

  if (!view) {
    return (
      <div class="page game-page">
        <header class="game-header">
          <span class="game-id">Game {gameId}</span>
          <button
            type="button"
            class="action-button back-to-lobby"
            onClick={() => (onLeaveGame ? onLeaveGame() : window.location.assign('/'))}
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
    // ITEM-ADD-9: never play a card, surrender or pass on a bot's behalf.
    if (isBotViewer) {
      console.warn('Ignored action: the inspected seat is a bot');
      return;
    }
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

  // The client timers dispatch through this render's `dispatch`, so they follow
  // the same bot lock, socket/REST fallback and selection clearing as a click.
  dispatchRef.current = dispatch;

  /** T-90: a manual `Surrender` always wins over the 3-second client timer. */
  const cancelAutoSurrender = () => {
    autoSurrenderFiredKeyRef.current = autoSurrenderKey;
    if (autoSurrenderTimerRef.current != null) {
      clearTimeout(autoSurrenderTimerRef.current);
      autoSurrenderTimerRef.current = null;
    }
    if (autoSurrenderTickRef.current != null) {
      clearInterval(autoSurrenderTickRef.current);
      autoSurrenderTickRef.current = null;
    }
    setSurrenderSeconds(null);
  };

  /** T-90: a manual `Pass` always wins over the 1-second client timer. */
  const cancelAutoPass = () => {
    autoPassFiredKeyRef.current = autoPassKey;
    if (autoPassTimerRef.current != null) {
      clearTimeout(autoPassTimerRef.current);
      autoPassTimerRef.current = null;
    }
    setAutoPassPending(false);
  };

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
        cancelAutoPass();
        dispatch(buildPassTurn(playerId));
        break;
      case 'declareSurrender':
        cancelAutoSurrender();
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

  // Item 12: a finished game is reviewed read-only against the selected replay
  // frame; a live match always renders the authoritative view.
  const displayedView = reviewMode && activeFrame ? activeFrameView ?? view : view;
  // T-90 ITEM-PREV-4: the surrendering / defenceless defender never gets a glow
  // around their hand — the highlight prompts a card move, and this seat has
  // none. The state comes from the projection (the surrender phase, the
  // server's `defenderDefenseless` flag or a `surrender`-only legal-action set),
  // so it also covers the 3-second client auto-surrender countdown.
  const viewerIsDefender = displayedView.defenderIdx === viewerSeatIndex(displayedView);
  const surrenderingDefender =
    !reviewMode &&
    viewerIsDefender &&
    (isSurrenderPhase(displayedView.boutPhase) || isClientAutoSurrenderState(displayedView));
  const defenderDefenseless =
    !reviewMode &&
    viewerIsDefender &&
    (displayedView.defenderDefenseless === true ||
      (hasLegalAction(displayedView.legalActions, 'surrender') &&
        !hasLegalAction(displayedView.legalActions, 'cover') &&
        !hasLegalAction(displayedView.legalActions, 'redirect')));
  // ITEM-9: the banner's winner, Durak and finish order always come from the
  // final finished state — the live view while it is over, otherwise the last
  // recorded frame — never from an intermediate replay frame.
  const resultView = isGameOverPhase(view.boutPhase)
    ? view
    : replayFrameView(replayFrames[replayFrames.length - 1], playerId) ?? view;

  // Item 13: every seat resolves to a real name (opponent summary, the
  // viewer's own `myName`, the displayed replay frame, a name remembered from
  // a live/replay view, or a synchronous scan of the loaded replay frames),
  // never a "You" placeholder or a raw seat id when a name is known. The
  // replay scan matters on the first render after the replay resolves, before
  // the name-cache effect has run.
  const nameFor = (id: string): string => {
    const opponent =
      view.opponents.find((candidate) => candidate.id === id) ??
      displayedView.opponents.find((candidate) => candidate.id === id);
    if (opponent) return opponent.name;
    if (view.myId === id && view.myName) return view.myName;
    if (displayedView.myId === id && displayedView.myName) return displayedView.myName;
    const remembered = knownNamesRef.current[id];
    if (remembered) return remembered;
    for (const frame of replay?.frames ?? []) {
      for (const frameView of Object.values(frame.views)) {
        if (frameView.myId === id && frameView.myName) return frameView.myName;
        const frameOpponent = frameView.opponents.find((candidate) => candidate.id === id);
        if (frameOpponent) return frameOpponent.name;
      }
    }
    return id;
  };

  // Fixed seat order: neither the POV switcher nor the players list reorders
  // the active player.
  const playerOptions = seatOrderedPlayerIds(displayedView);
  const playersInSeatOrder = playerOptions.map((id) => {
    const opponent = displayedView.opponents.find((candidate) => candidate.id === id);
    const mine = id === displayedView.myId;
    const cardCount = mine ? displayedView.myHand.length : opponent?.cardCount ?? 0;
    // ITEM-ADD-8a: the active user's own row is labelled from their own status
    // fields, exactly like every opponent row, so WINNER, OUT and PASSED show
    // up for the viewer too. An empty hand falls back to the seat's position in
    // `winners` when the payload omits `myFinishRank`.
    const winnerIdx = displayedView.winners?.indexOf(id) ?? -1;
    const projectedRank = mine
      ? (displayedView.myFinishRank ?? (winnerIdx >= 0 ? winnerIdx + 1 : null))
      : (opponent?.finishRank ?? null);
    return {
      id,
      name: nameFor(id),
      cardCount,
      // ITEM-ADD-8b: a seat that still holds cards has not finished, whatever
      // stale rank the projection carries.
      finishRank:
        !mine && cardCount > 0
          ? null
          : mine && displayedView.myHand.length > 0
            ? null
            : projectedRank,
      hasPassed: mine
        ? displayedView.myHasPassed ?? false
        : opponent?.hasPassed ?? false,
      mine,
    };
  });

  // Item 12: the match outcome always comes from the finished game, never an
  // intermediate replay frame. Early frames have an empty or one-entry
  // `finishOrder`, so binding these to `displayedView` would erase the winner
  // or label the only finished player as both winner and Durak.
  const winnerId = resultView.finishOrder[0];
  // ITEM-ADD-8b: the last player out always earns the DURAK label, even when
  // the backend names it only through `finishOrder`/`winners`.
  const winnersList = resultView.winners ?? [];
  // The sole seat that never made it into `winners` is the Durak; a lone
  // `finishOrder` entry is only a winner, so it never names the last place.
  const durakFromWinners =
    gameOver && winnersList.length > 0
      ? (playersInSeatOrder.find((player) => !winnersList.includes(player.id))?.id ?? null)
      : null;
  const durakFromFinishOrder =
    resultView.finishOrder.length >= 2
      ? resultView.finishOrder[resultView.finishOrder.length - 1]
      : null;
  const durakId = resultView.isDraw
    ? null
    : (resultView.durak ?? durakFromWinners ?? durakFromFinishOrder ?? null);
  const gameIsDraw = resultView.isDraw;
  // ITEM-ADD-2: the attacking and defending seats are outlined in the PLAYERS
  // list until the match is over.
  const attackerSeatId = seatIdFor(displayedView, displayedView.attackerIdx);
  const defenderSeatId = seatIdFor(displayedView, displayedView.defenderIdx);
  const roleForSeat = (id: string): 'attacker' | 'defender' | 'none' => {
    if (isGameOverPhase(displayedView.boutPhase)) return 'none';
    if (id === attackerSeatId) return 'attacker';
    if (id === defenderSeatId) return 'defender';
    return 'none';
  };

  // The replay clock is frozen at the frame's elapsed time (`00:00` on the
  // opening move); live play uses the recorded start/end timestamps.
  const gameClock =
    reviewMode && activeFrame
      ? formatGameClock(0, activeFrame.elapsedMs, 0)
      : formatGameClock(displayedView.gameStartedAtMs, displayedView.gameEndedAtMs, now);
  const gameClockActive =
    !reviewMode &&
    displayedView.gameStartedAtMs != null &&
    displayedView.gameEndedAtMs == null;

  // During review the turn clock rests at 00:15 instead of a live countdown.
  const displayViewerOnClock = !reviewMode && viewerOnClock;
  const displaySeconds = displayViewerOnClock ? seconds : 15;
  const clockClasses = ['turn-clock', displayViewerOnClock ? ' active' : ''];

  const leaveGame = () => {
    if (onLeaveGame) {
      onLeaveGame();
      return;
    }
    window.location.assign('/');
  };

  // The router owns the URL when it hands us `onNavigateGame`; otherwise the
  // hash route is enough (the app listens for `hashchange`).
  const navigateToGame = (nextGameId: string, nextPlayerId?: string) => {
    if (onNavigateGame) {
      onNavigateGame(nextGameId, nextPlayerId);
      return;
    }
    const seat = nextPlayerId ?? playerId;
    window.location.hash = `#/g/${nextGameId}?player=${encodeURIComponent(seat)}`;
  };

  // ITEM-PB-9: Rematch restarts the same table — same seats, same names, same
  // rules and the same human/bot split as the match on screen.
  const rematch = () => {
    if (rematchPending) return;
    const playerTypes = playersInSeatOrder.map((player): PlayerType => {
      const seatType = displayedView.playerTypes?.[seatNumber(player.id)];
      if (seatType && seatType.length > 0) return seatType as PlayerType;
      if (player.id === displayedView.myId && displayedView.isBot) return 'randomBot';
      return 'human';
    });
    setRematchPending(true);
    createGame(
      playersInSeatOrder.length,
      playersInSeatOrder.map((player) => player.name),
      displayedView.allowRedirect ?? true,
      displayedView.chaosMode ?? false,
      playerTypes,
    )
      .then((created) => {
        // Reset the finished match and its review state so the new match opens
        // on a fresh table instead of the old replay.
        setLoadedReplay(null);
        setReplayFrameIdx(0);
        replayLoadedGameRef.current = null;
        viewGameRef.current = null;
        setSelection(null);
        setView(null);
        const target = created.players.includes(playerId)
          ? playerId
          : (created.players[0] ?? playerId);
        navigateToGame(created.gameId, target);
      })
      .catch((reason: unknown) => {
        console.warn('Could not start the rematch', reason);
      })
      .finally(() => setRematchPending(false));
  };

  // QA presets: one click drops the reviewer into a scripted position.
  const startPreset = (presetId: string) => {
    if (presetPending) return;
    setPresetPending(true);
    setPresetError(null);
    createPresetGame(presetId)
      .then((created) => {
        navigateToGame(created.gameId, created.defaultPlayerId);
      })
      .catch((reason: unknown) => {
        console.warn('Could not start the QA preset', reason);
        setPresetError(reason instanceof Error ? reason.message : String(reason));
      })
      .finally(() => setPresetPending(false));
  };
  // Req 14 / T-90 ITEM-PREV-4b: the Pass button counts down while the viewer's
  // throw-in clock runs, and reads `1` while the client auto-pass is armed (the
  // client timer is always the smaller of the two).
  const serverPassCountdown =
    viewerOnClock && hasLegalAction(view.legalActions, 'pass') ? Math.max(1, seconds) : null;
  const passCountdownSeconds = autoPassPending ? 1 : serverPassCountdown;

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
                  {formatPlayerDisplayName(player.id, player.name, playerId)}
                </option>
              ))}
            </select>
          </label>
        </div>
        <button type="button" class="action-button back-to-lobby" onClick={leaveGame}>
            Back to lobby
          </button>
        </header>

      {/* Req 12: the finished match announces its result above the shell. */}
      {gameOver ? (
        <div class="game-over-banner" data-testid="game-over-banner" role="status">
          <strong class="game-over-title">
            {gameIsDraw
              ? 'Game over — Draw'
              : winnerId
                ? `Game over — ${nameFor(winnerId)} wins`
                : 'Game over'}
          </strong>
          {!gameIsDraw && durakId ? (
            <span class="game-over-durak">
              {durakId === view.myId ? 'Durak: you' : `Durak: ${nameFor(durakId)}`}
            </span>
          ) : null}
          {/* Item 9 / ITEM-PB-9: play again with the same seats, or leave. */}
          <button
            type="button"
            class="action-button green banner-rematch-button"
            data-testid="banner-rematch-button"
            disabled={rematchPending}
            onClick={rematch}
          >
            {rematchPending ? 'Starting…' : 'Rematch'}
          </button>
          <button
            type="button"
            class="action-button banner-lobby-button"
            data-testid="banner-lobby-button"
            onClick={leaveGame}
          >
            Return to lobby
          </button>
        </div>
      ) : null}

      <div class="game-shell">
        <aside class="game-sidebar sidebar-left" data-zone="sidebar-left">
          <section class="panel">
            <h2>POV</h2>
            <div class="hotseat-tabs" role="tablist" aria-label="POV player switcher">
              {playerOptions.map((id) => (
                <button
                  key={id}
                  type="button"
                  role="tab"
                  aria-selected={id === playerId}
                  class={`hotseat-tab${id === playerId ? ' active' : ''}`}
                  onClick={() => onSwitchPlayer(id)}
                >
                  <span class="hotseat-name">
                    {formatPlayerDisplayName(id, nameFor(id), playerId)}
                  </span>
                  <span class="hotseat-id">{id}</span>
                </button>
              ))}
            </div>
          </section>

          {/* QA presets: jump straight into a scripted position in one click. */}
          <section
            class="panel qa-scenarios-panel"
            data-testid="qa-scenarios"
            aria-label="QA Scenarios"
          >
            <h2>⚡ QA Scenarios</h2>
            <div class="qa-scenario-buttons">
              {QA_SCENARIOS.map((scenario) => (
                <button
                  key={scenario.id}
                  type="button"
                  class="qa-scenario-button"
                  data-preset={scenario.id}
                  disabled={presetPending}
                  onClick={() => startPreset(scenario.id)}
                >
                  {scenario.label}
                </button>
              ))}
            </div>
            {presetError ? (
              <p class="qa-scenario-error" role="alert">
                {presetError}
              </p>
            ) : null}
          </section>

          <section class="panel" aria-label="How to Play">
            <h2>How to Play</h2>
            <ul class="how-to-play">
              {HOW_TO_PLAY.map((line) => (
                <li key={line}>{line}</li>
              ))}
            </ul>
          </section>

          {/* Item 12: move navigation sits at the bottom of the left sidebar. */}
          {reviewMode ? (
            <section
              class="panel review-nav-panel"
              data-testid="review-nav"
              aria-label="Replay navigation"
            >
              <h2>Replay</h2>
              <div class="review-nav-controls">
                <button
                  type="button"
                  class="review-nav-button"
                  data-testid="review-prev-button"
                  aria-label="Previous move"
                  disabled={!activeFrame || replayFrameIdx <= 0}
                  onClick={() => stepReplay(-1)}
                >
                  ‹
                </button>
                <span class="review-move-indicator" data-testid="review-move-indicator">
                  {replayFrames.length > 0
                    ? `Move ${
                        Math.min(replayFrameIdx, replayFrames.length - 1) + 1
                      } / ${replayFrames.length}`
                    : 'Move 0 / 0'}
                </span>
                <button
                  type="button"
                  class="review-nav-button"
                  data-testid="review-next-button"
                  aria-label="Next move"
                  disabled={!activeFrame || replayFrameIdx >= replayFrames.length - 1}
                  onClick={() => stepReplay(1)}
                >
                  ›
                </button>
              </div>
            </section>
          ) : null}
        </aside>

        <div class="table-column">
        <GameTable
          myId={displayedView.myId}
          myHand={displayedView.myHand}
          opponents={displayedView.opponents}
          tablePairs={displayedView.tablePairs}
          trumpSuit={displayedView.trumpSuit}
          boutPhase={displayedView.boutPhase}
          redirectTargetId={displayedView.redirectTargetId ?? null}
          attackerId={attackerSeatId}
          defenderId={defenderSeatId}
          chaosMode={displayedView.chaosMode ?? false}
          awaitingAttack={
            !reviewMode &&
            isInitialAttackPhase(displayedView.boutPhase) &&
            hasLegalAction(displayedView.legalActions, 'attack')
          }
          defending={
            !reviewMode &&
            !surrenderingDefender &&
            viewerIsDefender &&
            displayedView.tablePairs.some((pair) => !pair.defense)
          }
          isSurrenderingDefender={surrenderingDefender}
          defenderDefenseless={defenderDefenseless}
          canRedirect={!reviewMode && hasLegalAction(displayedView.legalActions, 'redirect')}
          canThrowIn={!reviewMode && hasLegalAction(displayedView.legalActions, 'throwIn')}
          isReviewMode={reviewMode}
          isBot={isBotViewer}
          turnPlayerId={turnPlayerIdFor(displayedView)}
          turnSecondsRemaining={clockSeconds(displayedView, now)}
          sortMode={sortMode}
          selectedKeys={reviewMode ? [] : selectedKeys}
          playableKeys={reviewMode ? [] : playableKeys}
          onCardClick={reviewMode ? undefined : toggleCard}
          onCardDoubleClick={reviewMode ? undefined : playCard}
          onTableCardClick={
            !reviewMode && hasLegalAction(view.legalActions, 'cover') ? coverAttack : undefined
          }
          onAttackDrop={reviewMode ? undefined : playAttackDrop}
          onCoverDrop={reviewMode ? undefined : playCoverDrop}
          onThrowInDrop={reviewMode ? undefined : playThrowInDrop}
          onRedirectDrop={reviewMode ? undefined : playRedirectDrop}
        >
          {gameOver || isBotViewer ? null : (
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
                surrenderSeconds={surrenderSeconds}
                passCountdownSeconds={passCountdownSeconds}
                isBotSeat={isBotViewer}
              />
            </div>
          )}
        </GameTable>

          {/* ITEM-ADD-7: HAND SORTING moved out of the crowded right column to
              sit directly below the felt table. */}
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
          {/* Item 10: one clock panel split into a Game half and a Turn half. */}
          <section
            class="panel clock-split-panel"
            data-testid="clock-panel"
            aria-label="Game and turn clocks"
          >
            <div class="clock-half game-clock-half">
              <h2>Game</h2>
              <span
                class="game-clock"
                data-testid="game-clock"
                data-active={gameClockActive ? 'true' : 'false'}
              >
                {gameClock}
              </span>
            </div>
            <div class="clock-half turn-clock-half">
              <h2>Turn</h2>
              <span
                class={clockClasses.join(' ')}
                data-testid="turn-clock"
                data-active={displayViewerOnClock ? 'true' : 'false'}
              >
                {formatClock(displaySeconds)}
              </span>
            </div>
          </section>

          <section class="panel" aria-label="Player status">
            <h2>Players</h2>
            <ul class="status-badges players-list" data-testid="players-list">
              {playersInSeatOrder.map((player) => {
                const present =
                  player.id === displayedView.myId
                    ? selfPresent
                    : displayedView.presentPlayers
                      ? displayedView.presentPlayers.includes(player.id)
                      : (displayedView.opponents.find((opponent) => opponent.id === player.id)
                          ?.isPresent ?? false);
                const role = roleForSeat(player.id);
                const isDurak = gameOver && durakId === player.id;
                // ITEM-ADD-8b: WINNER / OUT only ever label a seat with an empty
                // hand. A seat still holding cards shows PASSED (or nothing).
                const statusTag: 'DURAK' | 'WINNER' | 'OUT' | 'PASSED' | null = isDurak
                  ? 'DURAK'
                  : player.cardCount === 0 && player.finishRank != null
                    ? player.finishRank === 1
                      ? 'WINNER'
                      : 'OUT'
                    : player.hasPassed
                      ? 'PASSED'
                      : null;
                return (
                <li
                  key={player.id}
                  class={`status-badge${player.mine ? ' mine' : ''}`}
                  data-player-id={player.id}
                  data-role={role}
                >
                  <span class="status-player">
                    <span
                      class={`presence-dot${present ? ' present' : ''}`}
                      data-testid={`presence-dot-${player.id}`}
                      data-present={present ? 'true' : 'false'}
                      role="img"
                      aria-label={present ? 'Present' : 'Away'}
                    />
                    <span class="status-name">
                      {formatPlayerDisplayName(player.id, player.name, playerId)}
                    </span>
                  </span>
                  {/* ITEM-ADD-8a: the card count owns the centre track, so it
                      never shifts when a status tag appears or disappears. */}
                  <span class="status-cards" data-testid={`player-cards-${player.id}`}>
                    {player.cardCount} cards
                  </span>
                  <span class="status-state-slot">
                    {statusTag ? (
                      <span
                        class="status-tag-slot"
                        data-testid={`player-status-tag-${player.id}`}
                        data-status={statusTag}
                      >
                        {statusTag === 'DURAK' ? (
                          <span
                            class="status-tag durak-tag"
                            data-testid={`player-durak-tag-${player.id}`}
                          >
                            DURAK
                          </span>
                        ) : statusTag === 'PASSED' ? (
                          <span class="status-tag passed-tag">PASSED</span>
                        ) : (
                          <span class="status-rank">{statusTag}</span>
                        )}
                      </span>
                    ) : null}
                  </span>
                </li>
                );
              })}
            </ul>
          </section>

          <TableDeck
            talonCount={displayedView.talonCount}
            bottomTrumpCard={displayedView.bottomTrumpCard}
            trumpSuit={displayedView.trumpSuit}
            discardCount={displayedView.discardCount ?? 0}
            lastDiscardCards={displayedView.lastDiscardCards ?? []}
          />

          {gameOver ? (
            <section class="panel game-result" aria-label="Game over">
              <h2>
                {gameIsDraw
                  ? 'Draw'
                  : winnerId
                    ? `${nameFor(winnerId)} wins`
                    : 'Game over'}
              </h2>
              {!gameIsDraw && durakId ? (
                <p class="durak-line">
                  {durakId === view.myId
                    ? 'You are the Durak.'
                    : `${nameFor(durakId)} is the Durak.`}
                </p>
              ) : null}
              <ol class="finish-order">
                {resultView.finishOrder.map((id) => (
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
