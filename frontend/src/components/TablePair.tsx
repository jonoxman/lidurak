import { Card, type CardData } from './Card';

export interface TablePairProps {
  attack: CardData;
  defense?: CardData | null;
  trumpSuit?: string;
  /** Rhythm nudge for the defending client only. */
  pulse?: boolean;
  onAttackClick?: () => void;
}

/** One attack on the table, with the defending card overlapping it if played. */
export function TablePair({
  attack,
  defense,
  trumpSuit = '',
  pulse = false,
  onAttackClick,
}: TablePairProps) {
  const isTrump = (card: CardData): boolean =>
    trumpSuit.length > 0 && card.suit.toLowerCase() === trumpSuit.toLowerCase();

  return (
    <div class={`table-pair${pulse ? ' turn-pulse' : ''}`}>
      <div class="table-pair-attack">
        <Card
          suit={attack.suit}
          rank={attack.rank}
          trump={isTrump(attack)}
          onClick={onAttackClick}
        />
      </div>
      {defense ? (
        <div class="table-pair-defense">
          <Card suit={defense.suit} rank={defense.rank} trump={isTrump(defense)} />
        </div>
      ) : null}
    </div>
  );
}
