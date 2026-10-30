import type { ComponentChildren } from 'preact';
import { Card, isRedSuit, suitSymbol, type CardData } from './Card';
import { CardBack } from './CardBack';
import { TablePair } from './TablePair';
import '../styles/table.css';

export interface OpponentSummary {
  id: string;
  name: string;
  cardCount: number;
  hasPassed: boolean;
  finishRank?: number | null;
}

export interface TablePairData {
  attack: CardData;
  defense?: CardData | null;
}

export interface GameTableProps {
  myId: string;
  myHand: CardData[];
  opponents: OpponentSummary[];
  tablePairs: TablePairData[];
  talonCount: number;
  bottomTrumpCard?: CardData | null;
  trumpSuit: string;
  attackerId?: string;
  defenderId?: string;
  selectedKeys?: string[];
  onCardClick?: (card: CardData) => void;
  children?: ComponentChildren;
}

const SUIT_ORDER: Record<string, number> = {
  spades: 0,
  hearts: 1,
  diamonds: 2,
  clubs: 3,
};

const RANK_ORDER: Record<string, number> = {
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

export const cardKey = (card: CardData): string =>
  `${card.suit.toLowerCase()}:${card.rank.toLowerCase()}`;

const sortHand = (hand: CardData[]): CardData[] =>
  [...hand].sort((left, right) => {
    const suitDiff =
      (SUIT_ORDER[left.suit.toLowerCase()] ?? 9) -
      (SUIT_ORDER[right.suit.toLowerCase()] ?? 9);
    if (suitDiff !== 0) return suitDiff;
    return (
      (RANK_ORDER[left.rank.toLowerCase()] ?? 0) -
      (RANK_ORDER[right.rank.toLowerCase()] ?? 0)
    );
  });

/**
 * The responsive game table: opponents and talon on top, the battle area in the
 * middle, the viewer's sorted hand at the bottom, and an action slot below it.
 */
export function GameTable({
  myId,
  myHand,
  opponents,
  tablePairs,
  talonCount,
  bottomTrumpCard,
  trumpSuit,
  attackerId,
  defenderId,
  selectedKeys = [],
  onCardClick,
  children,
}: GameTableProps) {
  const hand = sortHand(myHand);

  return (
    <div class="game-table" data-my-id={myId}>
      <header class="table-top">
        <section class="opponents" aria-label="Opponents">
          {opponents.map((opponent) => {
            const classes = ['opponent'];
            if (opponent.id === attackerId) classes.push('active-attacker');
            if (opponent.id === defenderId) classes.push('active-defender');
            return (
              <div key={opponent.id} class={classes.join(' ')} data-testid="opponent">
                <span class="opponent-name">{opponent.name}</span>
                <div class="opponent-cards" aria-label={`${opponent.name}'s cards`}>
                  {Array.from({ length: opponent.cardCount }, (_, index) => (
                    <CardBack key={index} />
                  ))}
                </div>
                <span class="opponent-count">{opponent.cardCount} cards</span>
                {opponent.finishRank != null ? (
                  <span class="opponent-rank">Finished #{opponent.finishRank}</span>
                ) : null}
                {opponent.hasPassed ? <span class="opponent-passed">Passed</span> : null}
              </div>
            );
          })}
        </section>

        <aside class="table-status" aria-label="Talon">
          <div class="talon-stack">
            <CardBack class="talon-back talon-back-second" />
            <CardBack class="talon-back" />
            <span class="talon-count" data-testid="talon-count">
              {talonCount}
            </span>
          </div>
          {talonCount > 0 && bottomTrumpCard ? (
            <div class="bottom-trump" aria-label="Bottom trump card">
              <div class="bottom-trump-card">
                <Card suit={bottomTrumpCard.suit} rank={bottomTrumpCard.rank} />
              </div>
            </div>
          ) : null}
          <div
            class={`trump-badge ${isRedSuit(trumpSuit) ? 'red' : 'black'}`}
            data-suit={trumpSuit.toLowerCase()}
          >
            <span>Trump</span>
            <span class="trump-symbol">{suitSymbol(trumpSuit)}</span>
          </div>
        </aside>
      </header>

      <section class="battle" aria-label="Battle">
        {tablePairs.length === 0 ? (
          <p class="battle-empty">Waiting for the first attack…</p>
        ) : (
          tablePairs.map((pair, index) => (
            <TablePair key={index} attack={pair.attack} defense={pair.defense} />
          ))
        )}
      </section>

      <section class="hand" aria-label="Your hand">
        {hand.map((card, index) => (
          <Card
            key={`${cardKey(card)}-${index}`}
            suit={card.suit}
            rank={card.rank}
            selected={selectedKeys.includes(cardKey(card))}
            onClick={onCardClick ? () => onCardClick(card) : undefined}
          />
        ))}
      </section>

      <footer class="actions-slot" aria-label="Actions">
        {children}
      </footer>
    </div>
  );
}
