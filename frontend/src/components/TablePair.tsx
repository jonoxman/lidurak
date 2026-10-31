import { Card, type CardData } from './Card';

export interface TablePairProps {
  attack: CardData;
  defense?: CardData | null;
  trumpSuit?: string;
  /** Rhythm nudge for the defending client only. */
  pulse?: boolean;
  /** Magnetic-snap highlight while a dragged card hovers this slot. */
  snap?: boolean;
  /** Stable id of this pair as a drop zone (`cover:<index>`). */
  dropZone?: string;
  onAttackClick?: () => void;
  onDragOverCard?: (event: DragEvent) => void;
  onDragLeaveCard?: () => void;
  onDropCard?: (event: DragEvent) => void;
}

/** One attack on the table, with the defending card overlapping it if played. */
export function TablePair({
  attack,
  defense,
  trumpSuit = '',
  pulse = false,
  snap = false,
  dropZone,
  onAttackClick,
  onDragOverCard,
  onDragLeaveCard,
  onDropCard,
}: TablePairProps) {
  const isTrump = (card: CardData): boolean =>
    trumpSuit.length > 0 && card.suit.toLowerCase() === trumpSuit.toLowerCase();

  const classes = ['table-pair'];
  if (pulse) classes.push('turn-pulse');
  if (snap) classes.push('snap-active');

  return (
    <div class={classes.join(' ')}>
      <div
        class="table-pair-attack"
        data-drop-zone={dropZone}
        onDragOver={onDragOverCard}
        onDragLeave={onDragLeaveCard}
        onDrop={onDropCard}
      >
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
