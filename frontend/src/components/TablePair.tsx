import type { JSX } from 'preact';
import { Card, type CardData } from './Card';
import type { CoveredPairsEdge } from '../utils/tableLayout';

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
  /**
   * ITEM-1b: this pair is already covered, so it lives in the edge-pinned
   * covered stack (Wave 2 renders the stack itself) instead of the active row.
   */
  isCollapsedCovered?: boolean;
  /** Which vertical felt edge the covered stack is pinned to. */
  coveredEdge?: CoveredPairsEdge;
  /** Extra inline presentation style, merged last (e.g. the covered margin). */
  style?: JSX.CSSProperties;
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
  isCollapsedCovered = false,
  coveredEdge,
  style,
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
  const isCovered = defense != null;
  const classes = ['table-pair'];
  if (uncoveredHighlighted) classes.push('turn-pulse', 'table-card-uncovered');
  if (snap) classes.push('snap-active');
  if (isCollapsedCovered) classes.push('table-pair-covered-collapsed');

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
      // ITEM-1b: QA and Wave 2 can tell covered pairs and their edge apart
      // deterministically, without inspecting class names.
      data-covered={isCovered ? 'true' : 'false'}
      data-covered-edge={coveredEdge}
      data-collapsed-covered={isCollapsedCovered ? 'true' : 'false'}
      // T-90: size the pair from the shared card tokens (no measured px).
      style={{
        '--pair-card-w': 'var(--card-w, 100px)',
        '--pair-card-h': 'var(--card-h, 140px)',
        ...(marginLeft ? { marginLeft } : {}),
        ...style,
      }}
    >
      <div
        class="table-pair-attack table-card-attack table-card-base"
        data-card-align="top"
        // T-90-feedback-20261122 ITEM-2: the attack card is never shrunk inside
        // the pair — it keeps the full canonical card footprint.
        data-card-size="full"
        data-card-width={cardWidth}
        data-card-height={cardHeight}
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
        <div
          class="table-pair-defense table-card-cover"
          data-card-align="overlap"
          // T-90-feedback-20261122 ITEM-2: the staggered defence card is the
          // same full-size card as the attack it covers.
          data-card-size="full"
          data-card-width={cardWidth}
          data-card-height={cardHeight}
        >
          <Card
            suit={defense.suit}
            rank={defense.rank}
            trump={isTrump(defense)}
          />
        </div>
      ) : null}
    </div>
  );
}
