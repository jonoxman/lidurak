import { useEffect, useRef, useState } from 'preact/hooks';
import { ActionBar } from '../components/ActionBar';
import { GameTable, cardKey } from '../components/GameTable';
import { getGameView, sendAction as sendActionRest } from '../api/client';
import { GameWebSocket } from '../api/websocket';
import {
  buildCoverCard,
  buildDeclareSurrender,
  buildInitialAttack,
  buildPassTurn,
  buildThrowInCards,
  hasLegalAction,
  isGameOverPhase,
  isInitialAttackPhase,
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

export interface GamePageProps {
  gameId: string;
  playerId: string;
  onSwitchPlayer: (playerId: string) => void;
}

export function GamePage({ gameId, playerId, onSwitchPlayer }: GamePageProps) {
  const [view, setView] = useState<PlayerGameView | null>(null);
  // Hand indices are kept together with the view they were picked against, so
  // a new authoritative view invalidates the selection without an effect that
  // could race a click.
  const [selection, setSelection] = useState<{
    view: PlayerGameView;
    indices: Set<number>;
  } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [live, setLive] = useState(false);
  const socketRef = useRef<GameWebSocket | null>(null);

  useEffect(() => {
    let active = true;
    setView(null);
    setLive(false);
    setSelection(null);
    setError(null);

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
        if (active) setError(reason instanceof Error ? reason.message : String(reason));
      });

    return () => {
      active = false;
      socket.disconnect();
      if (socketRef.current === socket) socketRef.current = null;
    };
  }, [gameId, playerId]);

  if (!view) {
    return (
      <div class="page game-page">
        <header class="game-header">
          <span class="game-id">Game {gameId}</span>
          <a href="#/">Back to lobby</a>
        </header>
        {error ? (
          <p class="error-banner" role="alert">
            {error}
          </p>
        ) : (
          <p class="loading">Loading game {gameId}…</p>
        )}
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

  const isAttackerTurn =
    isInitialAttackPhase(view.boutPhase) && hasLegalAction(view.legalActions, 'attack');
  // The attacker's hand pulses while they owe a play: the opening attack or a
  // throw-in during the defense.
  const awaitingAttack = isAttackerTurn || hasLegalAction(view.legalActions, 'throwIn');
  // Covering or surrendering can only be offered to the defender, and only
  // while uncovered attacks sit on the table.
  const defending =
    hasLegalAction(view.legalActions, 'cover') ||
    hasLegalAction(view.legalActions, 'surrender');
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

  const dispatch = (action: GameAction) => {
    setError(null);
    const socket = socketRef.current;
    if (socket != null && socket.isOpen()) {
      socket.sendAction(action);
      clearSelection();
      return;
    }
    sendActionRest(gameId, action)
      .then((result) => {
        if ('error' in result) {
          setError(result.error);
        } else {
          setView(result);
          clearSelection();
        }
      })
      .catch((reason: unknown) =>
        setError(reason instanceof Error ? reason.message : String(reason)),
      );
  };

  const toggleCard = (card: GameCard) => {
    // Durak cards are unique, so suit + rank identifies the selected hand card.
    const index = view.myHand.findIndex(
      (handCard) => handCard.suit === card.suit && handCard.rank === card.rank,
    );
    if (index < 0) return;
    setError(null);
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
    if (selectedCards.length !== 1) {
      setError('Select exactly one card, then click an uncovered attack card.');
      return;
    }
    dispatch(buildCoverCard(playerId, attackIndex, selectedCards[0]));
  };

  const handleActionBar = (action: { type: string }) => {
    switch (action.type) {
      case 'passTurn':
        dispatch(buildPassTurn(playerId));
        break;
      case 'declareSurrender':
        dispatch(buildDeclareSurrender(playerId));
        break;
      default:
        break;
    }
  };

  const playerOptions = [view.myId, ...view.opponents.map((opponent) => opponent.id)];

  const winnerId = view.finishOrder[0];
  const durakId = view.finishOrder[view.finishOrder.length - 1];
  const gameOver = isGameOverPhase(view.boutPhase);

  return (
    <div class="page game-page">
      <header class="game-header">
        <div class="game-meta">
          <span class="game-id">Game {gameId}</span>
          <span class={`connection ${live ? 'live' : 'pending'}`}>
            {live ? 'Connected' : 'Connecting…'}
          </span>
        </div>
        <a href="#/">Back to lobby</a>
      </header>

      {error ? (
        <p class="error-banner" role="alert">
          {error}
        </p>
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
          talonCount={view.talonCount}
          bottomTrumpCard={view.bottomTrumpCard}
          trumpSuit={view.trumpSuit}
          awaitingAttack={awaitingAttack}
          defending={defending}
          selectedKeys={selectedKeys}
          onCardClick={toggleCard}
          onTableCardClick={
            hasLegalAction(view.legalActions, 'cover') ? coverAttack : undefined
          }
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
              <ActionBar legalActions={view.legalActions} onAction={handleActionBar} />
            </div>
          )}
        </GameTable>

        <aside class="game-sidebar sidebar-right" data-zone="sidebar-right">
          <section class="panel turn-clock-panel" aria-label="Turn clock">
            <h2>Turn</h2>
            <span class="turn-clock" data-testid="turn-clock">
              00:15
            </span>
          </section>

          <section class="panel" aria-label="Player status">
            <h2>Players</h2>
            <ul class="status-badges">
              <li class="status-badge mine">
                <span class="status-name">{nameFor(view.myId)}</span>
                <span class="status-count">{view.myHand.length} cards</span>
              </li>
              {view.opponents.map((opponent) => (
                <li key={opponent.id} class="status-badge">
                  <span class="status-name">{opponent.name}</span>
                  <span class="status-count">{opponent.cardCount} cards</span>
                  {opponent.finishRank != null ? (
                    <span class="status-rank">
                      {opponent.finishRank === 1 ? 'WINNER' : 'OUT'}
                    </span>
                  ) : null}
                </li>
              ))}
            </ul>
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
