import { useEffect, useRef, useState } from 'preact/hooks';
import { Card as PlayingCard } from '../components/Card';
import { CardBack } from '../components/CardBack';
import { createGameSocket, type GameSocket } from '../api/gameSocket';
import { fetchGameView, joinRoom, leaveRoom } from '../api/lobbyClient';
import { getOrCreateSession } from '../api/sessionClient';
import { navigateToLobby } from '../router/useRoute';
import type {
  Card as CardData,
  PlayerGameView,
  PublicPlayerSummary,
  RoomSeatView,
  SocketStatus,
  WsClientMessage,
} from '../types/multiplayer';
import '../styles/lobby.css';

/** Seat positions of the arena's Row 1, left to right. */
const SEAT_POSITIONS = ['top-left', 'top-center', 'top-right'] as const;

const SUIT_SYMBOLS: Record<string, string> = {
  spades: '♠',
  hearts: '♥',
  diamonds: '♦',
  clubs: '♣',
};

const RANK_LABELS: Record<string, string> = {
  two: '2',
  three: '3',
  four: '4',
  five: '5',
  six: '6',
  seven: '7',
  eight: '8',
  nine: '9',
  ten: '10',
  jack: 'J',
  queen: 'Q',
  king: 'K',
  ace: 'A',
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

/** Live WebSocket status label shown in the room header and sidebar. */
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

/** Screen-reader label for one card. */
export function cardLabel(card: CardData): string {
  const rank = RANK_LABELS[card.rank.toLowerCase()] ?? card.rank;
  return `${rank} of ${card.suit}`;
}

const suitSymbol = (suit: string): string => SUIT_SYMBOLS[suit.toLowerCase()] ?? suit;

/**
 * The live M2 room (`/g/:gameId`).
 *
 * The HttpOnly guest cookie is established (and the first projection fetched)
 * before the WebSocket opens, so a first-time visitor on a shared invite URL
 * never races the session. The table itself only ever renders `view.hand` for
 * the viewer: opponent hands arrive as counts, and a spectator (`viewerSeat:
 * null`, `hand: []`) gets a read-only, zero-leak view.
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
  const [selection, setSelection] = useState<number[]>([]);
  const [targetIdx, setTargetIdx] = useState<number | null>(null);
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
    setSelection([]);
    setTargetIdx(null);
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
          setSelection([]);
          setTargetIdx(null);
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
    setSelection([]);
    setTargetIdx(null);
  };

  const seated = view != null && view.viewerSeat !== null;
  const viewerSeat = view?.viewerSeat ?? null;
  const selectedCards: CardData[] = view
    ? selection.map((index) => view.hand[index]).filter((card): card is CardData => Boolean(card))
    : [];
  const isDefender =
    view != null && viewerSeat != null && view.defenderIdx === viewerSeat;
  const isAttacker =
    view != null && viewerSeat != null && view.attackerIdx === viewerSeat;
  const canAct = view?.status === 'InProgress' && seated;

  const toggleCard = (index: number) => {
    setSelection((current) =>
      current.includes(index)
        ? current.filter((entry) => entry !== index)
        : [...current, index],
    );
  };

  /** Initial attack or throw-in, depending on whether the table is empty. */
  const play = () => {
    if (!view || !canAct || isDefender || selectedCards.length === 0) return;
    send(
      view.tablePairs.length === 0
        ? { type: 'playAttack', cards: selectedCards }
        : { type: 'throwInCards', cards: selectedCards },
    );
  };

  /** Covers the selected uncovered attack with the single selected card. */
  const cover = () => {
    if (!view || !canAct || !isDefender) return;
    if (targetIdx == null || selectedCards.length !== 1) return;
    if (view.tablePairs[targetIdx]?.defense) return;
    send({ type: 'coverCard', attackIndex: targetIdx, defenseCard: selectedCards[0] });
  };

  /** Reflects the selected cards to the next defender. */
  const redirect = () => {
    if (!view || !canAct || !isDefender || selectedCards.length === 0) return;
    send({ type: 'redirectAttack', cards: selectedCards });
  };

  const pass = () => {
    if (!canAct) return;
    send({ type: 'passTurn' });
  };

  const take = () => {
    if (!canAct) return;
    send({ type: 'declareSurrender' });
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

  const playerName = (id: string): string =>
    view?.players.find((player) => player.id === id)?.name ?? id;

  return (
    <section
      class="page multiplayer-page"
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
          <ProjectedTable
            view={view}
            socketStatus={socketStatus}
            now={now}
            selection={selection}
            selectedCards={selectedCards}
            targetIdx={targetIdx}
            canAct={canAct}
            isAttacker={isAttacker}
            isDefender={isDefender}
            rejection={rejection}
            onToggleCard={toggleCard}
            onSelectTarget={setTargetIdx}
            onPlay={play}
            onCover={cover}
            onRedirect={redirect}
            onPass={pass}
            onTake={take}
            onBack={goLobby}
            playerName={playerName}
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

interface ProjectedTableProps {
  view: PlayerGameView;
  socketStatus: SocketStatus;
  now: number;
  selection: number[];
  selectedCards: CardData[];
  targetIdx: number | null;
  canAct: boolean;
  isAttacker: boolean;
  isDefender: boolean;
  rejection: string | null;
  onToggleCard: (index: number) => void;
  onSelectTarget: (index: number | null) => void;
  onPlay: () => void;
  onCover: () => void;
  onRedirect: () => void;
  onPass: () => void;
  onTake: () => void;
  onBack: () => void;
  playerName: (id: string) => string;
}

/** State B: the live projected match and the zero-leak spectator view. */
function ProjectedTable({
  view,
  socketStatus,
  now,
  selection,
  selectedCards,
  targetIdx,
  canAct,
  isAttacker,
  isDefender,
  rejection,
  onToggleCard,
  onSelectTarget,
  onPlay,
  onCover,
  onRedirect,
  onPass,
  onTake,
  onBack,
  playerName,
}: ProjectedTableProps) {
  const seated = view.viewerSeat !== null;
  const viewersSeat = view.viewerSeat;
  const opponents = view.players.filter((player) => player.seatIndex !== viewersSeat);
  const clockSeconds = view.status === 'Finished' ? 0 : secondsLeft(view, now);

  const roleOf = (seatIndex: number): 'attacker' | 'defender' | 'idle' => {
    if (view.attackerIdx === seatIndex) return 'attacker';
    if (view.defenderIdx === seatIndex) return 'defender';
    return 'idle';
  };

  return (
    <div class="mp-shell" data-testid="projected-table">
      <aside class="mp-sidebar" data-zone="sidebar-left" aria-label="Match info">
        <div class="mp-sidebar-section">
          <h1 class="mp-room-title">Room {view.gameId}</h1>
          <div class="mp-badges">
            <span class={`mp-badge ${view.config.allowRedirect ? 'on' : 'off'}`}>
              Redirect {view.config.allowRedirect ? 'ON' : 'OFF'}
            </span>
            <span
              class="mp-connection"
              data-status={socketStatus}
              data-testid="game-connection"
            >
              <span class="mp-dot" aria-hidden="true" />
              {connectionLabel(socketStatus)}
            </span>
          </div>
          {view.viewerSeat === null ? (
            <span class="mp-badge spectator" data-testid="spectator-badge">
              Spectator Mode (Read-Only)
            </span>
          ) : null}
        </div>

        <div class="mp-sidebar-section">
          <span class="mp-block-label">Players</span>
          <ul class="mp-roster" aria-label="Players">
            {view.players.map((player: PublicPlayerSummary) => (
              <li class="mp-roster-row" key={player.id} data-testid={`roster-${player.id}`}>
                <span class="mp-roster-name">
                  {player.name}
                  {player.seatIndex === viewersSeat ? ' (You)' : ''}
                </span>
                <span class="mp-roster-cards">{player.cardCount}</span>
                <span
                  class={`mp-dot ${player.isConnected ? 'on' : 'off'}`}
                  aria-label={player.isConnected ? 'Connected' : 'Disconnected'}
                />
                {player.finishRank != null ? (
                  <span class="mp-badge">#{player.finishRank}</span>
                ) : null}
              </li>
            ))}
          </ul>
        </div>

        {rejection ? (
          <p class="m2-status-text" role="status" data-testid="action-rejected">
            {rejection}
          </p>
        ) : null}

        <button type="button" class="m2-button secondary" data-testid="back-to-lobby" onClick={onBack}>
          Back to Lobby
        </button>
      </aside>

      <section class="mp-arena" data-zone="table-arena" aria-label="Table">
        <div class="mp-seats-row" data-row="seats">
          {opponents.map((player, index) => {
            const role = roleOf(player.seatIndex);
            return (
              <article
                class="mp-seat"
                key={player.id}
                data-seat={SEAT_POSITIONS[index] ?? 'top-right'}
                data-role={role}
                data-testid={`opponent-${player.id}`}
              >
                <span class="mp-seat-name">{player.name}</span>
                <span class="mp-seat-cards">{player.cardCount} cards</span>
                <div class="mp-seat-backs" aria-hidden="true">
                  {Array.from({ length: Math.min(player.cardCount, 3) }, (_, backIndex) => (
                    <CardBack key={backIndex} size="mini" />
                  ))}
                </div>
                <div class="mp-seat-flags">
                  <span class={`mp-dot ${player.isConnected ? 'on' : 'off'}`} aria-hidden="true" />
                  {player.hasPassed ? <span class="mp-flag">Passed</span> : null}
                  {player.finishRank != null ? (
                    <span class="mp-flag">#{player.finishRank}</span>
                  ) : null}
                  {role !== 'idle' ? (
                    <span class={`mp-flag ${role}`}>
                      {role === 'attacker' ? 'Attacker' : 'Defender'}
                    </span>
                  ) : null}
                </div>
              </article>
            );
          })}
        </div>

        <div class="mp-bouts-row" data-row="bouts" data-testid="bouts">
          {view.tablePairs.length === 0 ? (
            <div class="mp-bouts-empty" data-testid="bouts-empty" aria-hidden="true" />
          ) : (
            view.tablePairs.map((pair, index) => (
              <div
                class="mp-pair"
                key={`${pair.attack.suit}-${pair.attack.rank}-${index}`}
                data-covered={pair.defense ? 'true' : 'false'}
                data-targeted={targetIdx === index ? 'true' : 'false'}
              >
                <button
                  type="button"
                  class="mp-card-button"
                  data-testid={`attack-card-${index}`}
                  aria-label={`Attack ${cardLabel(pair.attack)}`}
                  disabled={!isDefender || Boolean(pair.defense) || view.status !== 'InProgress'}
                  onClick={() => onSelectTarget(targetIdx === index ? null : index)}
                >
                  <PlayingCard suit={pair.attack.suit} rank={pair.attack.rank} width={72} height={100} />
                </button>
                {pair.defense ? (
                  <PlayingCard suit={pair.defense.suit} rank={pair.defense.rank} width={72} height={100} />
                ) : (
                  <span class="mp-pair-slot" aria-hidden="true" />
                )}
              </div>
            ))
          )}
        </div>

        <div class="mp-bottom-row" data-row="bottom">
          <div class="mp-deck" data-zone="table-deck">
            <span class="mp-block-label">Talon</span>
            <span class="mp-deck-count" data-testid="talon-count">
              {view.talonCount}
            </span>
            {view.trumpSuit ? (
              <span class="mp-trump" data-testid="trump-suit">
                Trump {suitSymbol(view.trumpSuit)}
              </span>
            ) : null}
            {view.bottomTrumpCard ? (
              <PlayingCard
                suit={view.bottomTrumpCard.suit}
                rank={view.bottomTrumpCard.rank}
                width={48}
                height={68}
                trump
              />
            ) : null}
          </div>

          <div class="mp-hand" data-zone="player-hand" data-testid="player-hand">
            {seated ? (
              view.hand.map((card, index) => {
                const isSelected = selection.includes(index);
                return (
                  <button
                    type="button"
                    key={`${card.suit}-${card.rank}-${index}`}
                    class={`mp-hand-card${isSelected ? ' selected' : ''}`}
                    data-testid={`hand-card-${index}`}
                    aria-label={cardLabel(card)}
                    aria-pressed={isSelected}
                    disabled={!canAct}
                    onClick={() => onToggleCard(index)}
                  >
                    <PlayingCard
                      suit={card.suit}
                      rank={card.rank}
                      width={64}
                      height={90}
                      selected={isSelected}
                      playable={canAct}
                    />
                  </button>
                );
              })
            ) : (
              <div
                class="mp-spectator-hand"
                data-testid="spectator-hand"
                aria-label="No cards in spectator mode"
              />
            )}
          </div>

          <div class="mp-actions" data-zone="player-actions">
            {seated ? (
              <>
                {isAttacker && !isDefender ? (
                  <button
                    type="button"
                    class="m2-button primary"
                    data-testid="action-play"
                    disabled={!canAct || selectedCards.length === 0}
                    onClick={onPlay}
                  >
                    Play
                  </button>
                ) : null}
                {isDefender ? (
                  <button
                    type="button"
                    class="m2-button primary"
                    data-testid="action-cover"
                    disabled={!canAct || selectedCards.length !== 1 || targetIdx == null}
                    onClick={onCover}
                  >
                    Cover
                  </button>
                ) : null}
                {isDefender && view.config.allowRedirect ? (
                  <button
                    type="button"
                    class="m2-button secondary"
                    data-testid="action-redirect"
                    disabled={!canAct || selectedCards.length === 0}
                    onClick={onRedirect}
                  >
                    Redirect
                  </button>
                ) : null}
                <button
                  type="button"
                  class="m2-button secondary"
                  data-testid="action-pass"
                  disabled={!canAct}
                  onClick={onPass}
                >
                  Pass
                </button>
                <button
                  type="button"
                  class="mp-button-danger"
                  data-testid="action-take"
                  disabled={!canAct}
                  onClick={onTake}
                >
                  Take
                </button>
              </>
            ) : null}
          </div>
        </div>
      </section>

      <aside class="mp-sidebar" data-zone="sidebar-right" aria-label="Turn clock and results">
        <span class="mp-block-label">Turn clock</span>
        <span
          class="mp-clock"
          data-testid="turn-clock"
          data-low-time={clockSeconds <= 5 ? 'true' : 'false'}
        >
          {formatTurnClock(clockSeconds)}
        </span>

        {view.status === 'Finished' ? (
          <div class="mp-results" data-testid="game-results">
            <span class="mp-block-label">Result</span>
            {view.isDraw ? (
              <p class="mp-result-line">Draw</p>
            ) : view.finishOrder.length > 0 ? (
              <p class="mp-result-line">{playerName(view.finishOrder[0])} wins</p>
            ) : null}
            <p class="mp-result-line" data-testid="durak-result">
              {view.durakId ? `Durak: ${playerName(view.durakId)}` : 'No durak'}
            </p>
            <ol class="mp-standings">
              {view.finishOrder.map((id, index) => (
                <li key={id}>
                  {index + 1}. {playerName(id)}
                </li>
              ))}
            </ol>
          </div>
        ) : (
          <span class="mp-badge">Discard {view.discardCount}</span>
        )}
      </aside>
    </div>
  );
}
