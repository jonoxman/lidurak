import { describe, expect, it } from 'vitest';
import { render, screen, within } from '@testing-library/preact';
import {
  GameTable,
  assignSeats,
  clockwiseOffset,
  seatForOffset,
  type OpponentSummary,
  type TablePairData,
} from '../components/GameTable';
import type { CardData } from '../components/Card';

const hand: CardData[] = [
  { suit: 'spades', rank: 'six' },
  { suit: 'hearts', rank: 'ace' },
  { suit: 'clubs', rank: 'king' },
];

const opponents: OpponentSummary[] = [
  { id: 'p1', name: 'Bob', cardCount: 2, hasPassed: false, finishRank: null },
  { id: 'p2', name: 'Carol', cardCount: 4, hasPassed: true, finishRank: 1 },
];

const tablePairs: TablePairData[] = [
  { attack: { suit: 'spades', rank: 'six' }, defense: { suit: 'spades', rank: 'seven' } },
  { attack: { suit: 'clubs', rank: 'king' }, defense: null },
];

function renderTable() {
  return render(
    <GameTable
      myId="p0"
      myHand={hand}
      opponents={opponents}
      tablePairs={tablePairs}
      talonCount={24}
      bottomTrumpCard={{ suit: 'diamonds', rank: 'ace' }}
      trumpSuit="diamonds"
      attackerId="p1"
      defenderId="p0"
    />,
  );
}

const seatNames = (opponentList: OpponentSummary[]): string[] =>
  assignSeats(opponentList).map((seat) => seat.position);

describe('clockwise seating', () => {
  it('computes relative clockwise offsets from the viewer', () => {
    expect(clockwiseOffset(3, 1, 4)).toBe(2);
    expect(clockwiseOffset(0, 3, 4)).toBe(1);
    expect(clockwiseOffset(1, 1, 3)).toBe(0);
  });

  it('puts a lone opponent of a 2-player game top-center', () => {
    expect(seatNames([opponents[0]])).toEqual(['top-center']);
    expect(seatForOffset(1, 2)).toBe('top-center');
  });

  it('splits the 3-player opponents top-left and top-right', () => {
    expect(seatNames(opponents)).toEqual(['top-left', 'top-right']);
  });

  it('fills the 4-player row left to right', () => {
    const fourPlayers: OpponentSummary[] = [
      ...opponents,
      { id: 'p3', name: 'Dave', cardCount: 6, hasPassed: false, finishRank: null },
    ];
    expect(seatNames(fourPlayers)).toEqual(['top-left', 'top-center', 'top-right']);
  });
});

describe('GameTable', () => {
  it('renders the player hand with one card per hand card', () => {
    renderTable();

    const handArea = screen.getByLabelText('Your hand');
    expect(handArea.querySelectorAll('.card-slot')).toHaveLength(3);
    expect(handArea.querySelectorAll('svg.playing-card')).toHaveLength(3);
    expect(handArea.getAttribute('data-zone')).toBe('player-hand');
  });

  it('renders every table pair in the battle area', () => {
    renderTable();

    const battle = screen.getByLabelText('Battle');
    expect(battle.querySelectorAll('.table-pair')).toHaveLength(2);
    expect(battle.querySelectorAll('.table-pair .card-slot')).toHaveLength(3);
    expect(battle.querySelectorAll('.table-pair-defense')).toHaveLength(1);
  });

  it('renders an opponent seat per opponent with names and card counts', () => {
    renderTable();

    const areas = screen.getAllByTestId('opponent');
    expect(areas).toHaveLength(2);
    expect(within(areas[0]).getByText('Bob')).toBeTruthy();
    expect(areas[0].querySelector('.opponent-count')!.textContent).toBe('2 cards');
    expect(within(areas[1]).getByText('Carol')).toBeTruthy();
    expect(areas[1].querySelector('.opponent-count')!.textContent).toBe('4 cards');
  });

  it('seats opponents at their clockwise data-seat position', () => {
    renderTable();

    const areas = screen.getAllByTestId('opponent');
    expect(areas[0].getAttribute('data-seat')).toBe('top-left');
    expect(areas[1].getAttribute('data-seat')).toBe('top-right');
    expect(areas[0].getAttribute('data-offset')).toBe('1');
    expect(areas[1].getAttribute('data-offset')).toBe('2');
  });

  it('marks the current attacker and defender areas', () => {
    renderTable();

    const areas = screen.getAllByTestId('opponent');
    expect(areas[0].classList.contains('active-attacker')).toBe(true);
    expect(areas[1].classList.contains('active-attacker')).toBe(false);
  });

  it('shows WINNER and OUT badges for finished opponents', () => {
    renderTable();

    const areas = screen.getAllByTestId('opponent');
    expect(areas[1].querySelector('.opponent-rank')!.textContent).toBe('WINNER');
  });

  it('renders the talon deck and perpendicular trump card in the bottom-left deck zone', () => {
    const { container } = renderTable();

    const deck = container.querySelector('[data-zone="table-deck"]');
    expect(deck).not.toBeNull();
    expect(deck!.querySelector('[data-testid="talon-count"]')!.textContent).toBe('24');
    expect(deck!.querySelector('.bottom-trump')).not.toBeNull();
    expect(deck!.querySelector('.trump-badge .trump-symbol')!.textContent).toBe('♦');
    expect(deck!.querySelector('.trump-badge')!.classList.contains('red')).toBe(true);
    expect(screen.getByLabelText('Bottom trump card')).toBeTruthy();
  });

  it('places the hand beside the deck and the controls in the third column', () => {
    const { container } = render(
      <GameTable
        myId="p0"
        myHand={hand}
        opponents={opponents}
        tablePairs={[]}
        talonCount={0}
        trumpSuit="diamonds"
      >
        <button type="button">Pass</button>
      </GameTable>,
    );

    expect(container.querySelector('[data-zone="table-arena"]')).not.toBeNull();
    expect(container.querySelector('[data-zone="player-hand"]')).not.toBeNull();
    const controls = container.querySelector('[data-zone="player-controls"]');
    expect(controls).not.toBeNull();
    expect(within(controls as HTMLElement).getByText('Pass')).toBeTruthy();
  });

  it('hides the bottom trump card once the talon is empty', () => {
    const { container } = render(
      <GameTable
        myId="p0"
        myHand={hand}
        opponents={opponents}
        tablePairs={[]}
        talonCount={0}
        bottomTrumpCard={{ suit: 'diamonds', rank: 'ace' }}
        trumpSuit="diamonds"
      />,
    );

    expect(screen.getByTestId('talon-count').textContent).toBe('0');
    expect(container.querySelector('.bottom-trump')).toBeNull();
    expect(screen.getByLabelText('Battle').querySelectorAll('.table-pair')).toHaveLength(0);
  });

  it('renders no table text clutter', () => {
    const { container } = renderTable();

    const table = container.querySelector('[data-zone="table-arena"]') as HTMLElement;
    expect(table.textContent).not.toMatch(/Waiting for/i);
    expect(table.querySelector('.battle-empty')).toBeNull();
    expect(table.querySelector('.game-hint')).toBeNull();
  });
});
