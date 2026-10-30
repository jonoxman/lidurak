import { Card, type CardData } from './Card';

export interface TablePairProps {
  attack: CardData;
  defense?: CardData | null;
}

/** One attack on the table, with the defending card overlapping it if played. */
export function TablePair({ attack, defense }: TablePairProps) {
  return (
    <div class="table-pair">
      <div class="table-pair-attack">
        <Card suit={attack.suit} rank={attack.rank} />
      </div>
      {defense ? (
        <div class="table-pair-defense">
          <Card suit={defense.suit} rank={defense.rank} />
        </div>
      ) : null}
    </div>
  );
}
