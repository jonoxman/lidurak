import { Card, type CardData } from './Card';

export interface TablePairProps {
  attack: CardData;
  defense?: CardData | null;
  trumpSuit?: string;
  /** Rhythm nudge for the defending client only. */
  pulse?: boolean;
  /**
   * T-90 ITEM-PREV-4a/4b: the uncovered attack prompt is allowed. Only the
   * bout's defender, in `Defense`, before surrendering, in live play sets this.
   * Any other viewer/phase renders the attack card without the crimson glow.
   */
  highlightUncovered?: boolean;
  /** Magnetic-snap highlight while a dragged card hovers this slot. */
  snap?: boolean;
  /** Stable id of this pair as a drop zone (`cover:<index>`). */
  dropZone?: string;
  /**
   * ITEM-NEW-2b: inline single-row spacing, negative once the pairs have to
   * overlap so every card keeps its left rank/suit strip visible.
   */
  marginLeft?: string;
  /** T-90 ITEM-2: exact card footprint this pair reserves (`100` x `140`). */
  cardWidth?: number;
  cardHeight?: number;
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
  highlightUncovered,
  snap = false,
  dropZone,
  marginLeft,
  cardWidth = 100,
  cardHeight = 140,
  onAttackClick,
  onDragOverCard,
  onDragLeaveCard,
  onDropCard,
}: TablePairProps) {
  const isTrump = (card: CardData): boolean =>
    trumpSuit.length > 0 && card.suit.toLowerCase() === trumpSuit.toLowerCase();

  // T-90 ITEM-PREV-4a/4b: the crimson prompt may only appear on an uncovered
  // card when the caller explicitly allows it. `pulse` stays a legacy alias.
  const uncoveredHighlighted = defense == null && (highlightUncovered ?? pulse);
  const classes = ['table-pair'];
  if (uncoveredHighlighted) classes.push('turn-pulse', 'table-card-uncovered');
  if (snap) classes.push('snap-active');

  // Item 8: an attack card sits flush with the top of an exact card-sized box,
  // so the reflection outline can share the same top and bottom edges.
  return (
    <div
      class={classes.join(' ')}
      data-card-align="top"
      // T-90 ITEM-2: the pair reserves exactly one card; the outline next to it
      // reports the same 100x140 footprint.
      data-card-width={cardWidth}
      data-card-height={cardHeight}
      data-uncovered-highlighted={uncoveredHighlighted ? 'true' : 'false'}
      style={marginLeft ? { marginLeft } : undefined}
    >
      <div
        class="table-pair-attack table-card-attack table-card-base"
        data-card-align="top"
        data-uncovered-highlighted={uncoveredHighlighted ? 'true' : 'false'}
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
        <div class="table-pair-defense table-card-cover" data-card-align="overlap">
          <Card suit={defense.suit} rank={defense.rank} trump={isTrump(defense)} />
        </div>
      ) : null}
    </div>
  );
}
