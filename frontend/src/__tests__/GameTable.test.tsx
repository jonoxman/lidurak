import { describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, within } from '@testing-library/preact';
import {
  GameTable,
  attackTargetIds,
  cardKey,
  defenderDoubleClickAction,
  initialAttackDoubleClickAction,
  nextPlayerWithCards,
  redirectOnlyAction,
  seatIndexOf,
  DECK_CARD_HEIGHT,
  DECK_CARD_WIDTH,
  DISCARD_FALLBACK_WIDTH,
  HAND_BOX_PADDING,
  HAND_CARD_WIDTH,
  HAND_MIN_OVERLAP,
  OPPONENT_MIN_OVERLAP,
  SEAT_BOX,
  TableDeck,
  assignSeats,
  clockwiseOffset,
  handLayout,
  handMargins,
  opponentOverlap,
  rowWidth,
  seatForOffset,
  canonicalSeatOrder,
  MIN_VISIBLE_STRIP_PX,
  BOUT_CARD_WIDTH,
  BOUT_MIN_VISIBLE_LEFT,
  sortHand,
  type OpponentSummary,
  type TablePairData,
} from '../components/GameTable';
import { ActionBar } from '../components/ActionBar';
import { DEFAULT_SETTINGS, setSettings } from '../state/settings';
import type { CardData } from '../components/Card';
import tableCss from '../styles/table.css?raw';

/** Declarations of the first rule whose selector text contains `selector`. */
function cssRule(css: string, selector: string): string {
  const start = css.indexOf(selector);
  if (start === -1) return '';
  const open = css.indexOf('{', start);
  const close = css.indexOf('}', open);
  return open === -1 || close === -1 ? '' : css.slice(open + 1, close);
}

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
      trumpSuit="diamonds"
      attackerId="p1"
      defenderId="p0"
    />,
  );
}

const seatNames = (opponentList: OpponentSummary[]): string[] =>
  assignSeats(opponentList).map((seat) => seat.position);

const seatPositions = (
  viewerId: string,
  opponentList: OpponentSummary[],
): Record<string, string> =>
  Object.fromEntries(
    assignSeats(opponentList, viewerId).map((seat) => [seat.opponent.id, seat.position]),
  );

const player = (id: string, name: string): OpponentSummary => ({
  id,
  name,
  cardCount: 5,
  hasPassed: false,
  finishRank: null,
});

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

  it('ITEM-ADD-1a: keeps the 3-player row clockwise from every point of view', () => {
    const alice = player('p0', 'Alice');
    const bob = player('p1', 'Bob');
    const carol = player('p2', 'Carol');

    expect(canonicalSeatOrder([bob, carol], 'p0')).toEqual(['p0', 'p1', 'p2']);
    expect(seatPositions('p0', [bob, carol])).toEqual({
      p1: 'top-left',
      p2: 'top-right',
    });
    expect(seatPositions('p1', [alice, carol])).toEqual({
      p2: 'top-left',
      p0: 'top-right',
    });
    expect(seatPositions('p2', [alice, bob])).toEqual({
      p0: 'top-left',
      p1: 'top-right',
    });
  });

  it('ITEM-ADD-1a: keeps the 4-player row clockwise from every point of view', () => {
    const everyone: OpponentSummary[] = [
      player('p0', 'Alice'),
      player('p1', 'Bob'),
      player('p2', 'Carol'),
      player('p3', 'Dave'),
    ];
    const seatsFor = (viewer: string): Record<string, string> =>
      seatPositions(
        viewer,
        everyone.filter((entry) => entry.id !== viewer),
      );

    expect(seatsFor('p0')).toEqual({ p1: 'top-left', p2: 'top-center', p3: 'top-right' });
    expect(seatsFor('p1')).toEqual({ p2: 'top-left', p3: 'top-center', p0: 'top-right' });
    expect(seatsFor('p2')).toEqual({ p3: 'top-left', p0: 'top-center', p1: 'top-right' });
    expect(seatsFor('p3')).toEqual({ p0: 'top-left', p1: 'top-center', p2: 'top-right' });
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

  it('renders an opponent seat per opponent with a top-left counter oval', () => {
    renderTable();

    const areas = screen.getAllByTestId('opponent');
    expect(areas).toHaveLength(2);
    expect(within(areas[0]).getByText('Bob')).toBeTruthy();
    expect(within(areas[1]).getByText('Carol')).toBeTruthy();

    // The count is an oval on the hand's top-left corner, not an `N cards` line.
    const bobCount = screen.getByTestId('opponent-card-count-p1');
    expect(bobCount.textContent).toBe('2');
    expect(bobCount.getAttribute('data-position')).toBe('top-left');
    expect(bobCount.classList.contains('deck-count-badge')).toBe(true);
    expect(screen.getByTestId('opponent-card-count-p2').textContent).toBe('4');

    for (const area of areas) {
      expect(area.querySelector('.opponent-count')).toBeNull();
      expect(area.textContent).not.toMatch(/\d+ cards?/i);
      // The cards sit centred in the box.
      expect(area.querySelector('.opponent-hand .opponent-cards')).not.toBeNull();
    }
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

  it('renders the talon deck, horizontal trump and TRUMP badge in one stack', () => {
    const { container } = render(
      <TableDeck
        talonCount={24}
        bottomTrumpCard={{ suit: 'diamonds', rank: 'ace' }}
        trumpSuit="diamonds"
      />,
    );

    const deckZone = container.querySelector('[data-zone="table-deck"]') as HTMLElement;
    expect(deckZone).not.toBeNull();
    expect(within(deckZone).getByText('Deck')).toBeTruthy();
    expect(within(deckZone).getByTestId('deck-assembly').getAttribute('data-align')).toBe(
      'center',
    );

    const count = screen.getByTestId('talon-count');
    expect(count.textContent).toBe('24');
    expect(count.getAttribute('data-position')).toBe('top-left');
    expect(container.querySelector('.table-trump')).not.toBeNull();
    expect(container.querySelector('.trump-badge .trump-symbol')!.textContent).toBe('♦');
    expect(container.querySelector('.trump-badge')!.classList.contains('red')).toBe(true);
    expect(screen.getByLabelText('Bottom trump card')).toBeTruthy();
  });

  it('places the hand beside the deck and the controls in the third column', () => {
    const { container } = render(
      <GameTable
        myId="p0"
        myHand={hand}
        opponents={opponents}
        tablePairs={[]}
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
      <TableDeck
        talonCount={0}
        bottomTrumpCard={{ suit: 'diamonds', rank: 'ace' }}
        trumpSuit="diamonds"
      />,
    );

    expect(screen.getByTestId('talon-count').textContent).toBe('0');
    expect(container.querySelector('.table-trump')).toBeNull();
  });

  it('renders no table text clutter', () => {
    const { container } = renderTable();

    const table = container.querySelector('[data-zone="table-arena"]') as HTMLElement;
    expect(table.textContent).not.toMatch(/Waiting for/i);
    expect(table.querySelector('.battle-empty')).toBeNull();
    expect(table.querySelector('.game-hint')).toBeNull();
  });
});

const sortableHand: CardData[] = [
  { suit: 'clubs', rank: 'ace' },
  { suit: 'hearts', rank: 'six' },
  { suit: 'spades', rank: 'king' },
  { suit: 'hearts', rank: 'king' },
];

const handOrder = (): string[] =>
  Array.from(screen.getByLabelText('Your hand').querySelectorAll('.card-slot')).map(
    (slot) => `${slot.getAttribute('data-suit')}:${slot.getAttribute('data-rank')}`,
  );

function renderSortableTable(props: Partial<Parameters<typeof GameTable>[0]> = {}) {
  return render(
    <GameTable
      myId="p0"
      myHand={sortableHand}
      opponents={[opponents[0]]}
      tablePairs={[]}
      trumpSuit="spades"
      {...props}
    />,
  );
}

describe('hand sorting', () => {
  it('sorts by suit by default, with the trump suit rightmost', () => {
    renderSortableTable();

    expect(handOrder()).toEqual([
      'hearts:six',
      'hearts:king',
      'clubs:ace',
      'spades:king',
    ]);
  });

  it('keeps the sort dropdown out of the felt arena', () => {
    const { container } = renderSortableTable();

    // Feedback #9: the dropdown moved into the right sidebar.
    expect(container.querySelector('[data-testid="sort-bar"]')).toBeNull();
    expect(screen.queryByLabelText('Sort hand')).toBeNull();
  });

  it('renders matching ranks together when the shared sort mode is `pairs`', () => {
    renderSortableTable({ sortMode: 'pairs' });

    expect(handOrder()).toEqual([
      'hearts:six',
      'spades:king',
      'hearts:king',
      'clubs:ace',
    ]);
  });

  it('ranks every trump above non-trumps when the shared sort mode is `rank`', () => {
    renderSortableTable({ sortMode: 'rank' });

    expect(handOrder()).toEqual([
      'hearts:six',
      'hearts:king',
      'clubs:ace',
      'spades:king',
    ]);
  });

  it('does not mutate the source hand while sorting', () => {
    const original: CardData[] = [
      { suit: 'spades', rank: 'king' },
      { suit: 'hearts', rank: 'six' },
    ];

    const sorted = sortHand(original, 'rank', 'spades');

    expect(sorted).toEqual([
      { suit: 'hearts', rank: 'six' },
      { suit: 'spades', rank: 'king' },
    ]);
    expect(original[0]).toEqual({ suit: 'spades', rank: 'king' });
  });
});

describe('trump highlighting', () => {
  it('gives trump cards the golden glow and corner badge', () => {
    renderSortableTable();

    const hand = screen.getByLabelText('Your hand');
    const trumps = Array.from(hand.querySelectorAll('.card-slot.trump'));
    expect(trumps).toHaveLength(1);
    expect(trumps[0].getAttribute('data-suit')).toBe('spades');
    expect(trumps[0].getAttribute('data-trump')).toBe('true');
    expect(trumps[0].querySelector('[data-testid="trump-marker"]')).not.toBeNull();
    expect(hand.querySelectorAll('[data-testid="trump-marker"]')).toHaveLength(1);
  });

  it('highlights trump cards on the table too', () => {
    const { container } = render(
      <GameTable
        myId="p0"
        myHand={[]}
        opponents={[opponents[0]]}
        tablePairs={[
          { attack: { suit: 'spades', rank: 'nine' }, defense: { suit: 'hearts', rank: 'ten' } },
        ]}
        trumpSuit="spades"
      />,
    );

    const battle = container.querySelector('.bout-area') as HTMLElement;
    expect(battle.querySelectorAll('.card-slot.trump')).toHaveLength(1);
  });
});

describe('turn nudges', () => {
  it('pulses only the uncovered attacks for the defending viewer', () => {
    const { container } = render(
      <GameTable
        myId="p0"
        myHand={hand}
        opponents={[opponents[0]]}
        tablePairs={tablePairs}
        trumpSuit="diamonds"
        attackerId="p1"
        defenderId="p0"
        boutPhase="Defense"
        defending
      />,
    );

    const pairs = Array.from(container.querySelectorAll('.table-pair'));
    expect(pairs).toHaveLength(2);
    expect(pairs[0].classList.contains('turn-pulse')).toBe(false);
    expect(pairs[1].classList.contains('turn-pulse')).toBe(true);
  });

  it('never pulses the table for a non-defending viewer', () => {
    const { container } = render(
      <GameTable
        myId="p1"
        myHand={hand}
        opponents={[opponents[1]]}
        tablePairs={tablePairs}
        trumpSuit="diamonds"
        attackerId="p1"
        defenderId="p0"
        defending={false}
      />,
    );

    expect(container.querySelectorAll('.table-pair.turn-pulse')).toHaveLength(0);
  });

  it('pulses the hand of the attacker who owes a play', () => {
    const { container } = renderSortableTable({ awaitingAttack: true });

    expect(
      container.querySelector('[data-zone="player-hand"]')!.classList.contains('turn-pulse'),
    ).toBe(true);
  });

  it('leaves the hand calm when nobody is waiting on the viewer', () => {
    const { container } = renderSortableTable();

    expect(
      container.querySelector('[data-zone="player-hand"]')!.classList.contains('turn-pulse'),
    ).toBe(false);
  });
});

const activeOpponents: OpponentSummary[] = [
  { id: 'p1', name: 'Bob', cardCount: 4, hasPassed: false, finishRank: null },
  { id: 'p2', name: 'Carol', cardCount: 4, hasPassed: false, finishRank: null },
];

const uncoveredPair: TablePairData[] = [
  { attack: { suit: 'spades', rank: 'six' }, defense: null },
];

describe('bout outlines and anchoring', () => {
  it('renders one target outline for the clockwise defender in standard mode', () => {
    render(
      <GameTable
        myId="p0"
        myHand={hand}
        opponents={activeOpponents}
        tablePairs={[]}
        trumpSuit="diamonds"
        defenderId="p1"
        awaitingAttack
      />,
    );

    expect(screen.getByTestId('target-outline-p1')).toBeTruthy();
    expect(screen.queryByTestId('target-outline-p2')).toBeNull();
  });

  it('renders a target outline for every legal opponent in chaos mode', () => {
    render(
      <GameTable
        myId="p0"
        myHand={hand}
        opponents={activeOpponents}
        tablePairs={[]}
        trumpSuit="diamonds"
        defenderId="p1"
        chaosMode
        awaitingAttack
      />,
    );

    expect(screen.getByTestId('target-outline-p1')).toBeTruthy();
    expect(screen.getByTestId('target-outline-p2')).toBeTruthy();
  });

  it('removes the target outlines once the first card of the bout is played', () => {
    render(
      <GameTable
        myId="p0"
        myHand={hand}
        opponents={activeOpponents}
        tablePairs={uncoveredPair}
        trumpSuit="diamonds"
        defenderId="p1"
        awaitingAttack
      />,
    );

    expect(screen.queryByTestId('target-outline-p1')).toBeNull();
    expect(screen.queryByTestId('target-outline-p2')).toBeNull();
  });

  it('anchors the active bout in front of the defending player', () => {
    const { container } = render(
      <GameTable
        myId="p0"
        myHand={hand}
        opponents={activeOpponents}
        tablePairs={uncoveredPair}
        trumpSuit="diamonds"
        defenderId="p1"
      />,
    );

    expect(
      container.querySelector('.bout-area')!.getAttribute('data-anchor'),
    ).toBe('top-left');
  });

  it('anchors the bout at the bottom when the viewer is defending', () => {
    const { container } = render(
      <GameTable
        myId="p0"
        myHand={hand}
        opponents={activeOpponents}
        tablePairs={uncoveredPair}
        trumpSuit="diamonds"
        defenderId="p0"
        defending
      />,
    );

    expect(
      container.querySelector('.bout-area')!.getAttribute('data-anchor'),
    ).toBe('bottom');
  });

  it('renders a card-shaped redirect outline with an arrow toward the next seat', () => {
    render(
      <GameTable
        myId="p0"
        myHand={hand}
        opponents={activeOpponents}
        tablePairs={uncoveredPair}
        trumpSuit="diamonds"
        defenderId="p1"
        canRedirect
      />,
    );

    const outline = screen.getByTestId('redirect-outline');
    expect(outline.getAttribute('data-direction')).toBe('top-right');
    expect(outline.querySelector('svg')).not.toBeNull();
    expect(outline.textContent).not.toMatch(/PEREVODZHU/i);
  });

  it('renders a shuffle icon for chaos-mode redirects', () => {
    render(
      <GameTable
        myId="p0"
        myHand={hand}
        opponents={activeOpponents}
        tablePairs={uncoveredPair}
        trumpSuit="diamonds"
        defenderId="p1"
        chaosMode
        canRedirect
      />,
    );

    const outline = screen.getByTestId('redirect-outline');
    expect(outline.getAttribute('data-direction')).toBe('shuffle');
    expect(outline.querySelector('svg')!.getAttribute('data-icon')).toBe('shuffle');
  });

  it('hides the redirect outline when redirection is not legal', () => {
    render(
      <GameTable
        myId="p0"
        myHand={hand}
        opponents={activeOpponents}
        tablePairs={uncoveredPair}
        trumpSuit="diamonds"
        defenderId="p1"
      />,
    );

    expect(screen.queryByTestId('redirect-outline')).toBeNull();
  });
});

describe('playable lift and drag cursor', () => {
  it('lifts only the hand cards that are legal to play', () => {
    const { container } = renderSortableTable({ playableKeys: ['hearts:six', 'clubs:ace'] });

    const lifted = Array.from(container.querySelectorAll('.card-slot.legal-playable')).map(
      (slot) => `${slot.getAttribute('data-suit')}:${slot.getAttribute('data-rank')}`,
    );
    expect(lifted.sort()).toEqual(['clubs:ace', 'hearts:six']);
    expect(container.querySelectorAll('.card-slot[data-playable="true"]')).toHaveLength(2);
    expect(container.querySelectorAll('.card-slot[data-playable="false"]')).toHaveLength(2);
  });

  it('keeps the pointer cursor on the arena for the whole drag gesture', () => {
    const { container } = renderSortableTable({ onAttackDrop: () => {} });
    const arena = container.querySelector('[data-zone="table-arena"]') as HTMLElement;

    expect(arena.classList.contains('dragging')).toBe(false);

    fireEvent.dragStart(screen.getByLabelText('six of hearts'), {
      dataTransfer: { setData: vi.fn(), effectAllowed: 'none' },
    });
    expect(arena.classList.contains('dragging')).toBe(true);
    expect(arena.getAttribute('data-dragging')).toBe('true');

    fireEvent.dragEnd(screen.getByLabelText('six of hearts'));
    expect(arena.classList.contains('dragging')).toBe(false);
  });
});

describe('drag-snap and double-click', () => {
  it('reports a double-clicked hand card', () => {
    const onCardDoubleClick = vi.fn();
    renderSortableTable({ onCardDoubleClick });

    fireEvent.dblClick(screen.getByLabelText('six of hearts'));

    expect(onCardDoubleClick).toHaveBeenCalledWith({ suit: 'hearts', rank: 'six' });
  });

  it('drops a dragged card onto a chaos attack target', () => {
    const onAttackDrop = vi.fn();
    render(
      <GameTable
        myId="p0"
        myHand={hand}
        opponents={activeOpponents}
        tablePairs={[]}
        trumpSuit="diamonds"
        defenderId="p1"
        chaosMode
        awaitingAttack
        onAttackDrop={onAttackDrop}
      />,
    );

    fireEvent.dragStart(screen.getByLabelText('six of spades'), {
      dataTransfer: { setData: vi.fn() },
    });
    fireEvent.drop(screen.getByTestId('target-outline-p2'), {
      dataTransfer: { getData: () => '' },
    });

    expect(onAttackDrop).toHaveBeenCalledWith({ suit: 'spades', rank: 'six' }, 'p2');
  });

  it('drops a dragged card onto an uncovered attack to cover it', () => {
    const onCoverDrop = vi.fn();
    const { container } = render(
      <GameTable
        myId="p0"
        myHand={hand}
        opponents={activeOpponents}
        tablePairs={uncoveredPair}
        trumpSuit="diamonds"
        defenderId="p0"
        defending
        onCoverDrop={onCoverDrop}
      />,
    );
    const zone = container.querySelector('[data-drop-zone="cover:0"]') as HTMLElement;

    fireEvent.dragStart(screen.getByLabelText('king of clubs'), {
      dataTransfer: { setData: vi.fn() },
    });
    fireEvent.drop(zone, { dataTransfer: { getData: () => '' } });

    expect(onCoverDrop).toHaveBeenCalledWith({ suit: 'clubs', rank: 'king' }, 0);
  });

  it('highlights the nearest drop slot while a card hovers it', () => {
    render(
      <GameTable
        myId="p0"
        myHand={hand}
        opponents={activeOpponents}
        tablePairs={[]}
        trumpSuit="diamonds"
        defenderId="p1"
        chaosMode
        awaitingAttack
        onAttackDrop={() => {}}
      />,
    );
    const outline = screen.getByTestId('target-outline-p1');

    fireEvent.dragOver(outline, { dataTransfer: { getData: () => '' } });

    expect(outline.classList.contains('snap-active')).toBe(true);
  });
});

describe('minimalist controls', () => {
  it('keeps only the contextual buttons in the third column', () => {
    const { container } = renderSortableTable({
      children: (
        <div class="action-bar">
          <button type="button" class="action-button red">
            Surrender
          </button>
        </div>
      ),
    });

    const controls = container.querySelector('[data-zone="player-controls"]') as HTMLElement;
    // The sort dropdown lives in the sidebar box, not beside the hand.
    expect(controls.querySelector('[data-testid="sort-bar"]')).toBeNull();
    expect(within(controls).queryByRole('combobox', { name: 'Sort hand' })).toBeNull();
    // The three separate sort buttons are gone.
    expect(within(controls).queryByRole('button', { name: 'Suit' })).toBeNull();
    expect(within(controls).queryByRole('button', { name: 'Pairs' })).toBeNull();
    expect(within(controls).queryByRole('button', { name: 'Rank' })).toBeNull();
    expect(within(controls).getByRole('button', { name: 'Surrender' })).toBeTruthy();
    expect(within(controls).queryByRole('button', { name: 'Redirect' })).toBeNull();
  });
});

describe('single-row hand overlap', () => {
  const bigHand: CardData[] = Array.from({ length: 36 }, (_, index) => ({
    suit: ['spades', 'hearts', 'diamonds', 'clubs'][index % 4],
    rank: 'six',
  }));

  it('keeps a hand that fits at the default 8px overlap', () => {
    const layout = handLayout(4, 720);

    expect(layout.hiddenLeft + layout.hiddenRight).toBe(0);
    expect(layout.overlap).toBe(HAND_MIN_OVERLAP);
    expect(handMargins(layout, 4)[1]).toBe(-HAND_MIN_OVERLAP);
  });

  it('tightens the overlap before hiding any cards', () => {
    const layout = handLayout(12, 500);

    expect(layout.hiddenLeft + layout.hiddenRight).toBe(0);
    expect(layout.overlap).toBeGreaterThan(HAND_MIN_OVERLAP);
    // The top-left rank/suit index stays visible at the maximum overlap.
    expect(HAND_CARD_WIDTH - layout.overlap).toBeGreaterThanOrEqual(22);
  });

  it('slides the hidden stack from right to left as the cursor moves', () => {
    const centered = handLayout(36, 300);
    const hidden = centered.hiddenLeft + centered.hiddenRight;
    expect(hidden).toBeGreaterThan(0);

    const atLeft = handLayout(36, 300, 0);
    expect(atLeft.hiddenLeft).toBe(0);
    expect(atLeft.hiddenRight).toBe(hidden);

    const atRight = handLayout(36, 300, 1);
    expect(atRight.hiddenLeft).toBe(hidden);
    expect(atRight.hiddenRight).toBe(0);

    // Hidden cards are stacked at 100% overlap on the ends.
    expect(handMargins(atRight, 36)[1]).toBe(-HAND_CARD_WIDTH);
  });

  it('renders every overflow card in one row with hidden stacks marked', () => {
    const { container } = render(
      <GameTable
        myId="p0"
        myHand={bigHand}
        opponents={[opponents[0]]}
        tablePairs={[]}
        trumpSuit="spades"
      />,
    );

    const row = container.querySelector('.hand-cards') as HTMLElement;
    expect(row.querySelectorAll('.hand-slot')).toHaveLength(36);
    expect(row.querySelectorAll('.card-slot')).toHaveLength(36);
    const hiddenLeft = Number(row.getAttribute('data-hidden-left'));
    const hiddenRight = Number(row.getAttribute('data-hidden-right'));
    expect(hiddenLeft + hiddenRight).toBeGreaterThan(0);
    expect(row.querySelectorAll('.hand-slot[data-hidden="true"]')).toHaveLength(
      hiddenLeft + hiddenRight,
    );
    expect(Number(row.getAttribute('data-overlap'))).toBeGreaterThan(HAND_MIN_OVERLAP);
  });

  it('overlaps opponent card backs inside a fixed box without cursor input', () => {
    const { container } = render(
      <GameTable
        myId="p0"
        myHand={hand}
        opponents={[{ id: 'p1', name: 'Bob', cardCount: 12, hasPassed: false, finishRank: null }]}
        tablePairs={[]}
        trumpSuit="spades"
      />,
    );

    const cards = Array.from(container.querySelectorAll('.opponent-card')) as HTMLElement[];
    expect(cards).toHaveLength(12);
    expect(cards[0].style.marginLeft).toBe('0px');
    for (const card of cards.slice(1)) {
      expect(card.style.marginLeft).toBe(`-${opponentOverlap(12)}px`);
    }
    expect(opponentOverlap(12)).toBeGreaterThanOrEqual(OPPONENT_MIN_OVERLAP);
    expect(container.querySelector('[data-zone="table-arena"]')).not.toBeNull();
  });
});

describe('felt texture and filters', () => {
  it('paints the arena with the active texture and live filter settings', () => {
    setSettings({
      tableTexture: 'burgundy-velvet',
      tableFilters: { brightness: 1.4, contrast: 1.1, hue: 40 },
    });
    const { container } = renderSortableTable();

    const arena = container.querySelector('[data-zone="table-arena"]') as HTMLElement;
    expect(arena.getAttribute('data-texture')).toBe('burgundy-velvet');
    // The dark-theme calibration (×1.10) rides on top of the slider value.
    expect(arena.style.getPropertyValue('--table-filter')).toBe(
      'brightness(1.54) contrast(1.1) hue-rotate(40deg)',
    );

    setSettings(DEFAULT_SETTINGS);
  });
});

describe('seat boxes, clocks and the deck stack', () => {
  const seatedOpponents: OpponentSummary[] = [
    { id: 'p1', name: 'Bob', cardCount: 3, hasPassed: false, finishRank: null },
    { id: 'p2', name: 'Carol', cardCount: 5, hasPassed: false, finishRank: null },
  ];

  it('stacks the vertical deck and the horizontal trump in one grid cell', () => {
    const { container } = render(
      <TableDeck
        talonCount={12}
        bottomTrumpCard={{ suit: 'diamonds', rank: 'six' }}
        trumpSuit="diamonds"
      />,
    );

    const deckZone = container.querySelector('[data-zone="table-deck"]') as HTMLElement;
    expect(deckZone.querySelector('.deck-title')!.textContent).toBe('Deck');
    expect(within(deckZone).getByTestId('talon-count').getAttribute('data-position')).toBe(
      'top-left',
    );

    const stack = within(deckZone).getByTestId('talon-deck');
    expect(stack.getAttribute('data-layout')).toBe('horizontal-trump');
    expect(stack.querySelector('.talon-stack')).not.toBeNull();
    // Deck, trump and badge share one centred assembly.
    expect(within(deckZone).getByTestId('deck-assembly').contains(stack)).toBe(true);

    // The trump is rotated a quarter turn and shares the deck's grid cell.
    const trump = stack.querySelector('.table-trump') as HTMLElement;
    expect(trump).not.toBeNull();
    expect(trump.querySelector('[data-rotated="true"]')).not.toBeNull();
    expect(trump.parentElement).toBe(stack);

    // The TRUMP badge follows the deck, so flex order keeps it clear of both.
    const badge = within(deckZone).getByTestId('trump-indicator');
    expect(badge.textContent).toContain('Trump');
    expect(badge.textContent).toContain('♦');
    expect(stack.compareDocumentPosition(badge) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  });

  it('gives every opponent box identical dimensions with a clock above it', () => {
    const { container } = render(
      <GameTable
        myId="p0"
        myHand={hand}
        opponents={seatedOpponents}
        tablePairs={[]}
        trumpSuit="diamonds"
      />,
    );

    const seats = Array.from(
      container.querySelectorAll('[data-testid="opponent"]'),
    ) as HTMLElement[];
    expect(seats).toHaveLength(2);

    const sizes = seats.map(
      (seat) => `${seat.style.getPropertyValue('--seat-width')}x${seat.style.getPropertyValue('--seat-height')}`,
    );
    expect(new Set(sizes).size).toBe(1);
    expect(sizes[0]).toBe(`${SEAT_BOX.width}pxx${SEAT_BOX.height}px`);

    for (const seat of seats) {
      const clock = seat.querySelector('.seat-clock') as HTMLElement;
      expect(clock).not.toBeNull();
      expect(clock.nextElementSibling?.classList.contains('seat-box')).toBe(true);
    }
  });

  it('ticks only the clock of the player being waited on', () => {
    render(
      <GameTable
        myId="p0"
        myHand={hand}
        opponents={seatedOpponents}
        tablePairs={[]}
        trumpSuit="diamonds"
        attackerId="p1"
        defenderId="p2"
        turnPlayerId="p1"
        turnSecondsRemaining={7}
      />,
    );

    expect(screen.getByTestId('seat-clock-p1').textContent).toBe('00:07');
    expect(screen.getByTestId('seat-clock-p1').getAttribute('data-active')).toBe('true');
    expect(screen.getByTestId('seat-clock-p2').textContent).toBe('00:15');
    expect(screen.getByTestId('seat-clock-p2').getAttribute('data-active')).toBe('false');
    // The viewer is not the one being waited on, so their own clock is idle.
    expect(screen.getByTestId('hand-clock').textContent).toBe('00:15');
    expect(screen.getByTestId('hand-clock').getAttribute('data-active')).toBe('false');
  });

  it('clamps the clock of the waiting player and puts it above the tight hand box', () => {
    const handSize = hand.length;
    const { container } = render(
      <GameTable
        myId="p0"
        myHand={hand}
        opponents={seatedOpponents}
        tablePairs={[]}
        trumpSuit="diamonds"
        attackerId="p0"
        defenderId="p1"
        awaitingAttack
        turnPlayerId="p0"
        turnSecondsRemaining={42}
      />,
    );

    expect(screen.getByTestId('hand-clock').textContent).toBe('00:15');
    expect(screen.getByTestId('hand-clock').getAttribute('data-active')).toBe('true');

    const handZone = container.querySelector('[data-zone="player-hand"]') as HTMLElement;
    expect(handZone.firstElementChild?.classList.contains('hand-clock')).toBe(true);

    // The pulse sits on the card container, which hugs the three cards.
    const cards = handZone.querySelector('.hand-cards') as HTMLElement;
    expect(cards.classList.contains('attacker-turn')).toBe(true);
    expect(cards.querySelectorAll('.card-slot')).toHaveLength(handSize);
  });

  it('keeps the defending viewer hand calm while the attack cards pulse', () => {
    const { container, unmount } = render(
      <GameTable
        myId="p0"
        myHand={hand}
        opponents={seatedOpponents}
        tablePairs={uncoveredPair}
        trumpSuit="diamonds"
        attackerId="p1"
        defenderId="p0"
        defending
        turnPlayerId="p0"
      />,
    );

    // T-90-2 ITEM-PREV-4: a defender who still has to decide keeps the crimson
    // hand glow, alongside the uncovered cards pulsing on the felt.
    const cards = container.querySelector('.hand-cards') as HTMLElement;
    expect(cards.classList.contains('defender-turn')).toBe(true);
    expect(cards.classList.contains('attacker-turn')).toBe(false);
    expect(cards.getAttribute('data-highlighted')).toBe('true');
    expect(cards.getAttribute('data-highlight-variant')).toBe('defender');

    const attackerSeat = screen
      .getByTestId('seat-clock-p1')
      .closest('.seat') as HTMLElement;
    expect(attackerSeat.classList.contains('active-attacker')).toBe(true);
    expect(attackerSeat.classList.contains('active-defender')).toBe(false);
    unmount();

    // A defender outside the viewer's seat gets the crimson class instead.
    render(
      <GameTable
        myId="p0"
        myHand={hand}
        opponents={seatedOpponents}
        tablePairs={uncoveredPair}
        trumpSuit="diamonds"
        attackerId="p1"
        defenderId="p2"
        turnPlayerId="p2"
      />,
    );

    const defenderSeat = screen
      .getByTestId('seat-clock-p2')
      .closest('.seat') as HTMLElement;
    expect(defenderSeat.classList.contains('active-defender')).toBe(true);
    expect(defenderSeat.classList.contains('active-attacker')).toBe(false);
  });
});

describe('hand highlight geometry, redirect double-click and review mode', () => {
  const cssBlock = (selector: string): string => {
    const start = tableCss.indexOf(`\n${selector} {`);
    expect(start).toBeGreaterThan(-1);
    const end = tableCss.indexOf('}', start);
    return tableCss.slice(start, end);
  };

  it('anchors the highlight from slot margins: first 0, the rest negative', () => {
    renderSortableTable({ awaitingAttack: true });

    const highlight = screen.getByTestId('hand-turn-highlight') as HTMLElement;
    const slots = Array.from(highlight.children) as HTMLElement[];
    expect(slots).toHaveLength(sortableHand.length);

    expect(slots[0].style.marginLeft).toBe('0px');
    for (const slot of slots.slice(1)) {
      expect(parseFloat(slot.style.marginLeft)).toBeLessThan(0);
    }
    // The box model aligns the container; no guessed transform is involved.
    for (const slot of slots) expect(slot.style.transform).toBe('');

    const highlightRule = cssBlock('.hand-cards');
    expect(highlightRule).toContain('display: inline-flex');
    expect(highlightRule).toContain('width: fit-content');
    expect(highlightRule).toContain('box-sizing: border-box');

    const slotRule = cssBlock('.hand-slot');
    expect(slotRule).toContain('width: var(--hand-card-width');
    expect(slotRule).toContain('height: var(--hand-card-height');
    expect(slotRule).toContain('flex: 0 0 auto');
  });

  it('stacks surplus cards with negative margins instead of transforms', () => {
    const ranks = ['six', 'seven', 'eight', 'nine', 'ten', 'jack', 'queen', 'king', 'ace'];
    const suits = ['spades', 'hearts', 'clubs', 'diamonds'];
    const bigHand: CardData[] = Array.from({ length: 40 }, (_, index) => ({
      suit: suits[index % suits.length],
      rank: ranks[index % ranks.length],
    }));

    renderSortableTable({ myHand: bigHand });

    const highlight = screen.getByTestId('hand-turn-highlight') as HTMLElement;
    const slots = Array.from(highlight.children) as HTMLElement[];
    expect(slots).toHaveLength(bigHand.length);
    expect(highlight.querySelectorAll('.hand-slot[data-hidden="true"]').length).toBeGreaterThan(0);
    expect(slots[0].style.marginLeft).toBe('0px');
    for (const slot of slots) expect(slot.style.transform).toBe('');
    // The hidden surplus stack overlaps fully, still through margin-left only.
    expect(slots.some((slot) => slot.style.marginLeft === `-${HAND_CARD_WIDTH}px`)).toBe(true);
  });

  it('plays the redirect when it is the only legal move for the card', () => {
    const card: CardData = { suit: 'clubs', rank: 'king' };

    expect(
      redirectOnlyAction(card, {
        playerId: 'p0',
        canRedirect: true,
        canCover: false,
        canThrowIn: false,
        isAttacker: false,
        isDefender: true,
        matchesTableRank: true,
      }),
    ).toEqual({ type: 'redirectAttack', playerId: 'p0', cards: [card] });
  });

  it('never auto-plays a card that could cover, throw in or attack instead', () => {
    const card: CardData = { suit: 'clubs', rank: 'king' };
    const onlyRedirect = {
      playerId: 'p0',
      canRedirect: true,
      canCover: false,
      canThrowIn: false,
      isAttacker: false,
      isDefender: true,
      matchesTableRank: true,
    };

    expect(redirectOnlyAction(card, { ...onlyRedirect, canCover: true })).toBeNull();
    expect(redirectOnlyAction(card, { ...onlyRedirect, canThrowIn: true })).toBeNull();
    expect(redirectOnlyAction(card, { ...onlyRedirect, isAttacker: true })).toBeNull();
    expect(redirectOnlyAction(card, { ...onlyRedirect, canRedirect: false })).toBeNull();
    expect(redirectOnlyAction(card, { ...onlyRedirect, matchesTableRank: false })).toBeNull();
  });

  it('never covers when the same card could also be redirected', () => {
    // A trump matching a non-trump attack's rank: both cover and redirect are
    // legal, so a double-click has to abstain.
    const trumpSix: CardData = { suit: 'hearts', rank: 'six' };
    const ambiguous = {
      playerId: 'p0',
      coverableAttackIndices: [0],
      canCover: true,
      canRedirect: true,
      canThrowIn: false,
      matchesTableRank: true,
    };

    expect(defenderDoubleClickAction(trumpSix, ambiguous)).toBeNull();
    // Two cover targets plus a redirect is equally ambiguous.
    expect(
      defenderDoubleClickAction(trumpSix, {
        ...ambiguous,
        coverableAttackIndices: [0, 1],
      }),
    ).toBeNull();
  });

  it('covers when covering is the only legal move for the card', () => {
    const cover: CardData = { suit: 'spades', rank: 'seven' };

    expect(
      defenderDoubleClickAction(cover, {
        playerId: 'p0',
        coverableAttackIndices: [0],
        canCover: true,
        canRedirect: true,
        canThrowIn: false,
        // The card is not on the table's ranks, so it cannot reflect.
        matchesTableRank: false,
      }),
    ).toEqual({ type: 'coverCard', playerId: 'p0', attackIndex: 0, defenseCard: cover });

    expect(
      defenderDoubleClickAction(cover, {
        playerId: 'p0',
        coverableAttackIndices: [],
        canCover: false,
        canRedirect: false,
        canThrowIn: false,
        matchesTableRank: false,
      }),
    ).toBeNull();
  });

  it('redirects through the defender resolver when no cover is available', () => {
    const card: CardData = { suit: 'clubs', rank: 'king' };

    expect(
      defenderDoubleClickAction(card, {
        playerId: 'p0',
        coverableAttackIndices: [],
        canCover: true,
        canRedirect: true,
        canThrowIn: false,
        matchesTableRank: true,
      }),
    ).toEqual({ type: 'redirectAttack', playerId: 'p0', cards: [card] });
  });

  it('shows the pass countdown in the same badge as the surrender countdown', () => {
    render(
      <ActionBar
        legalActions={['pass', 'surrender']}
        onAction={() => {}}
        passCountdownSeconds={12}
        surrenderSeconds={3}
      />,
    );

    const pass = screen.getByTestId('pass-countdown');
    expect(pass.className).toBe(screen.getByTestId('surrender-countdown').className);
    expect(pass.textContent).toBe('12');
    expect(pass.closest('button')?.textContent).toContain('Pass');
    expect(screen.getByTestId('surrender-countdown').textContent).toBe('3');
  });

  it('leaves the pass button bare without a countdown', () => {
    render(
      <ActionBar legalActions={['pass']} onAction={() => {}} passCountdownSeconds={0} />,
    );

    expect(screen.queryByTestId('pass-countdown')).toBeNull();
    expect(screen.getByText('Pass')).toBeTruthy();
  });

  it('hides every command control and drop surface in review mode', () => {
    const { container, unmount } = render(
      <GameTable
        myId="p0"
        myHand={hand}
        opponents={activeOpponents}
        tablePairs={uncoveredPair}
        trumpSuit="diamonds"
        defenderId="p0"
        awaitingAttack
        defending
        canRedirect
        canThrowIn
        isReviewMode
        onAttackDrop={() => {}}
        onCoverDrop={() => {}}
        onThrowInDrop={() => {}}
        onRedirectDrop={() => {}}
      >
        <button type="button">Throw In</button>
        <ActionBar legalActions={['pass', 'surrender']} onAction={() => {}} />
      </GameTable>,
    );

    expect(container.querySelector('[data-zone="player-controls"]')).toBeNull();
    expect(screen.queryByText('Throw In')).toBeNull();
    expect(screen.queryByText('Pass')).toBeNull();
    expect(screen.queryByText('Surrender')).toBeNull();
    expect(screen.queryByTestId('redirect-outline')).toBeNull();
    expect(container.querySelector('[data-drop-zone]')).toBeNull();
    expect(container.querySelectorAll('[draggable="true"]')).toHaveLength(0);

    const highlight = screen.getByTestId('hand-turn-highlight');
    expect(highlight.getAttribute('data-active')).toBe('false');
    expect(highlight.className).toContain('hand-cards');
    expect(highlight.className).not.toContain('attacker-turn');
    expect(highlight.className).not.toContain('defender-turn');
    expect(
      container.querySelector('[data-zone="table-arena"]')!.getAttribute('data-review-mode'),
    ).toBe('true');
    unmount();

    // No opening target outlines either.
    render(
      <GameTable
        myId="p0"
        myHand={hand}
        opponents={activeOpponents}
        tablePairs={[]}
        trumpSuit="diamonds"
        defenderId="p1"
        awaitingAttack
        isReviewMode
        onAttackDrop={() => {}}
      />,
    );
    expect(screen.queryByTestId('target-outline-p1')).toBeNull();
  });

  it('keeps hand sorting working in review mode', () => {
    renderSortableTable({ isReviewMode: true, sortMode: 'pairs' });

    expect(handOrder()).toEqual(['hearts:six', 'spades:king', 'hearts:king', 'clubs:ace']);
  });

  it('shows the real player names instead of a POV placeholder', () => {
    const { container } = renderSortableTable({ isReviewMode: true });

    expect(within(screen.getAllByTestId('opponent')[0]).getByText('Bob')).toBeTruthy();
    expect(container.textContent).not.toContain('You');
  });
});

describe('fixed play area, tight hand highlight and surrender shift', () => {
  const makePairs = (count: number): TablePairData[] =>
    Array.from({ length: count }, () => ({
      attack: { suit: 'spades', rank: 'six' },
      defense: null,
    }));

  const fourPlayers: OpponentSummary[] = [
    ...activeOpponents,
    { id: 'p3', name: 'Dave', cardCount: 6, hasPassed: false, finishRank: null },
  ];

  it('keeps the tinted play-area box at one fixed table-relative size', () => {
    const snapshots = [0, 1, 6].map((count) => {
      const { unmount } = render(
        <GameTable
          myId="p0"
          myHand={hand}
          opponents={activeOpponents}
          tablePairs={makePairs(count)}
          trumpSuit="diamonds"
          defenderId="p1"
        />,
      );

      const box = screen.getByTestId('play-area-box') as HTMLElement;
      const snapshot = {
        className: box.className,
        fixedSize: box.getAttribute('data-fixed-size'),
        inlineWidth: box.style.width,
        inlineHeight: box.style.height,
      };
      expect(box.querySelectorAll('.table-pair')).toHaveLength(count);
      unmount();
      return snapshot;
    });

    // Same class, same marker and no inline sizing at any card count.
    expect(new Set(snapshots.map((snapshot) => JSON.stringify(snapshot))).size).toBe(1);
    expect(snapshots[0].fixedSize).toBe('true');
    expect(snapshots[0].inlineWidth).toBe('');
    expect(snapshots[0].inlineHeight).toBe('');
  });

  it('wraps every hand card directly inside the turn-highlight box', () => {
    render(
      <GameTable
        myId="p0"
        myHand={hand}
        opponents={activeOpponents}
        tablePairs={[]}
        trumpSuit="diamonds"
        defenderId="p1"
        awaitingAttack
      />,
    );

    const highlight = screen.getByTestId('hand-turn-highlight') as HTMLElement;
    expect(highlight.classList.contains('hand-cards')).toBe(true);
    expect(highlight.getAttribute('data-active')).toBe('true');

    const slots = Array.from(highlight.children) as HTMLElement[];
    expect(slots).toHaveLength(hand.length);
    for (const slot of slots) {
      expect(slot.classList.contains('hand-slot')).toBe(true);
      expect(slot.parentElement).toBe(highlight);
    }

    const cards = Array.from(highlight.querySelectorAll('.card-slot'));
    expect(cards).toHaveLength(hand.length);
    for (const card of cards) expect(highlight.contains(card)).toBe(true);
  });

  it('leaves the hand highlight inactive when nobody waits on the viewer', () => {
    render(
      <GameTable
        myId="p0"
        myHand={hand}
        opponents={activeOpponents}
        tablePairs={tablePairs}
        trumpSuit="diamonds"
        defenderId="p1"
      />,
    );

    expect(screen.getByTestId('hand-turn-highlight').getAttribute('data-active')).toBe('false');
  });

  it('slides the cards in play toward the surrendering defender seat', () => {
    const cases: Array<{
      opponents: OpponentSummary[];
      defenderId: string;
      target: string;
    }> = [
      { opponents: [activeOpponents[0]], defenderId: 'p0', target: 'bottom' },
      { opponents: [activeOpponents[0]], defenderId: 'p1', target: 'top-center' },
      { opponents: activeOpponents, defenderId: 'p1', target: 'top-left' },
      { opponents: activeOpponents, defenderId: 'p2', target: 'top-right' },
      { opponents: fourPlayers, defenderId: 'p2', target: 'top-center' },
    ];

    for (const scenario of cases) {
      const { unmount } = render(
        <GameTable
          myId="p0"
          myHand={hand}
          opponents={scenario.opponents}
          tablePairs={tablePairs}
          trumpSuit="diamonds"
          defenderId={scenario.defenderId}
          boutPhase="Surrendered"
        />,
      );

      const group = screen.getByTestId('table-pairs-group');
      expect(group.getAttribute('data-surrendered')).toBe('true');
      expect(group.getAttribute('data-surrender-target')).toBe(scenario.target);
      expect(group.querySelectorAll('.table-pair')).toHaveLength(tablePairs.length);
      unmount();
    }
  });

  it('does not shift the cards in play before a surrender', () => {
    render(
      <GameTable
        myId="p0"
        myHand={hand}
        opponents={activeOpponents}
        tablePairs={tablePairs}
        trumpSuit="diamonds"
        defenderId="p1"
        boutPhase="Defense"
      />,
    );

    const group = screen.getByTestId('table-pairs-group');
    expect(group.getAttribute('data-surrendered')).toBe('false');
    expect(group.getAttribute('data-surrender-target')).toBeNull();
  });
});

describe('feedback 7: tight glow, discard pile and reflection alignment', () => {
  const cssRule = (selector: string): string => {
    const start = tableCss.indexOf(`\n${selector} {`);
    expect(start).toBeGreaterThan(-1);
    const end = tableCss.indexOf('}', start);
    return tableCss.slice(start, end);
  };

  const twentyDiscards: CardData[] = Array.from({ length: 20 }, () => ({
    suit: 'spades',
    rank: 'six',
  }));

  // --- ITEM-3a: the glowing box hugs the rendered cards ---

  it('ITEM-3a: sizes the highlight from the outer hand wrapper with tight symmetric padding', () => {
    renderSortableTable({ awaitingAttack: true });

    const handZone = document.querySelector('[data-zone="player-hand"]') as HTMLElement;
    const highlight = screen.getByTestId('hand-turn-highlight') as HTMLElement;
    expect(highlight.parentElement).toBe(handZone);

    const rule = cssRule('.hand-cards');
    expect(rule).toContain('display: inline-flex');
    expect(rule).toContain('flex: 0 0 auto');
    expect(rule).toContain('width: fit-content');
    expect(rule).toContain('max-width: 100%');
    expect(rule).toContain('align-items: center');
    expect(rule).toContain('justify-content: center');
    expect(rule).toContain(`padding: ${HAND_BOX_PADDING}px;`);
    expect(rule).toContain('border-radius: calc(var(--app-roundness, 8px) + 4px)');
    expect(rule).toContain('box-sizing: border-box');

    // Slots carry no wrapper spacing of their own; the only gap is the negative
    // overlap margin written inline, so the box ends on the last card's edge.
    const slotRule = cssRule('.hand-slot');
    expect(slotRule).toContain('box-sizing: border-box');
    expect(slotRule).toContain('margin: 0');
    expect(slotRule).not.toMatch(/padding:\s*[1-9]/);
    // A bordered trump card paints inside its box, so it can never poke out.
    expect(cssRule('.card-slot')).toContain('box-sizing: border-box');

    const slots = Array.from(highlight.children) as HTMLElement[];
    expect(slots).toHaveLength(sortableHand.length);
    for (const slot of slots) {
      expect(slot.style.marginTop).toBe('');
      expect(slot.style.marginBottom).toBe('');
      expect(slot.style.marginRight).toBe('');
      expect(slot.style.padding).toBe('');
    }
    expect(slots[0].style.marginLeft).toBe('0px');
  });

  // --- ITEM-3b: glowing for every player able to throw in ---

  it('ITEM-3b: glows for a seat that can only throw in after the opening attack', () => {
    const { container } = render(
      <GameTable
        myId="p0"
        myHand={hand}
        opponents={activeOpponents}
        tablePairs={uncoveredPair}
        trumpSuit="diamonds"
        attackerId="p1"
        defenderId="p2"
        canThrowIn
      />,
    );

    const highlight = screen.getByTestId('hand-turn-highlight');
    expect(highlight.getAttribute('data-active')).toBe('true');
    expect(highlight.classList.contains('throw-in-turn')).toBe(true);
    expect(highlight.classList.contains('attacker-turn')).toBe(false);
    expect(
      container.querySelector('[data-zone="player-hand"]')!.getAttribute('data-turn-action'),
    ).toBe('throw-in');
    expect(
      container.querySelector('[data-zone="player-hand"]')!.classList.contains('turn-pulse'),
    ).toBe(true);
  });

  it('ITEM-3b: keeps glowing while every attack on the table is already covered', () => {
    render(
      <GameTable
        myId="p0"
        myHand={hand}
        opponents={activeOpponents}
        tablePairs={tablePairs}
        trumpSuit="diamonds"
        attackerId="p1"
        defenderId="p2"
        boutPhase="Defense"
        canThrowIn
      />,
    );

    // All attacks in `tablePairs` except one are covered, and the glow stays.
    const highlight = screen.getByTestId('hand-turn-highlight');
    expect(highlight.getAttribute('data-active')).toBe('true');
    expect(highlight.getAttribute('data-turn-action')).toBe('throw-in');
  });

  it('ITEM-3b: closes the glow again once no throw-in is legal', () => {
    renderSortableTable({ canThrowIn: false });

    expect(screen.getByTestId('hand-turn-highlight').getAttribute('data-active')).toBe('false');
    expect(
      document.querySelector('[data-zone="player-hand"]')!.getAttribute('data-turn-action'),
    ).toBe('none');
  });

  it('ITEM-3b: never glows for a thrower while the review is frozen', () => {
    renderSortableTable({ canThrowIn: true, isReviewMode: true });

    const highlight = screen.getByTestId('hand-turn-highlight');
    expect(highlight.getAttribute('data-active')).toBe('false');
    expect(highlight.classList.contains('throw-in-turn')).toBe(false);
  });

  // --- ITEM-7a: no discard counter ---

  it('ITEM-7a: renders no counter badge for the discarded cards', () => {
    const { container } = render(
      <TableDeck
        talonCount={10}
        bottomTrumpCard={{ suit: 'hearts', rank: 'king' }}
        trumpSuit="hearts"
        discardCount={8}
        lastDiscardCards={[{ suit: 'clubs', rank: 'seven' }]}
      />,
    );

    expect(screen.queryByTestId('discard-count')).toBeNull();
    const pile = screen.getByTestId('discard-pile');
    expect(pile.querySelector('.deck-count-badge')).toBeNull();
    expect(pile.querySelector('.discard-count')).toBeNull();
    expect(tableCss).not.toContain('.discard-count');

    // Only the talon keeps its count oval.
    expect(container.querySelectorAll('.deck-count-badge')).toHaveLength(1);
    expect(within(pile).getByText('Discard')).toBeTruthy();
  });

  // --- ITEM-7b: hand overlap geometry so the pile always fits ---

  it('ITEM-7b: keeps earlier discards in one stack and overlaps only the face-up row', () => {
    render(
      <TableDeck
        talonCount={6}
        bottomTrumpCard={{ suit: 'hearts', rank: 'king' }}
        trumpSuit="hearts"
        discardCount={9}
        lastDiscardCards={[
          { suit: 'clubs', rank: 'seven' },
          { suit: 'diamonds', rank: 'ace' },
        ]}
      />,
    );

    const pile = screen.getByTestId('discard-pile');
    const stack = screen.getByTestId('discard-stack');
    const facedown = screen.getByTestId('discard-facedown-stack');
    const row = screen.getByTestId('discard-visible-row');
    expect(pile.contains(stack)).toBe(true);
    expect(stack.contains(facedown)).toBe(true);
    expect(stack.contains(row)).toBe(true);
    expect(pile.getAttribute('aria-label')).toBe('Discard pile');

    // ITEM-PB-7: the seven earlier discards are one stationary stack.
    const faceDownSlots = Array.from(facedown.querySelectorAll('.discard-slot')) as HTMLElement[];
    expect(faceDownSlots).toHaveLength(7);
    expect(facedown.getAttribute('data-count')).toBe('7');
    for (const slot of faceDownSlots) {
      expect(slot.getAttribute('data-face')).toBe('down');
      // No per-card offset and no lift animation on the face-down stack.
      expect(slot.style.marginLeft).toBe('');
      expect(slot.style.transform).toBe('');
    }

    // ITEM-PREV-7a/7b: the row overlaps the stationary stack with the maximum
    // allowed margin (only the 22px peek strip stays visible) and spreads the
    // revealed cards over the rest of the pile width.
    const visibleAvailable = DISCARD_FALLBACK_WIDTH - MIN_VISIBLE_STRIP_PX;
    const layout = handLayout(2, visibleAvailable, 0.5, DECK_CARD_WIDTH);
    const slots = Array.from(row.querySelectorAll('.discard-slot')) as HTMLElement[];
    expect(slots).toHaveLength(2);
    expect(row.querySelectorAll('.discard-slot[data-face="up"]')).toHaveLength(2);
    expect(row.getAttribute('data-overlaps-facedown')).toBe('true');
    expect(Number(row.getAttribute('data-facedown-overlap-px'))).toBe(
      DECK_CARD_WIDTH - MIN_VISIBLE_STRIP_PX,
    );
    expect(row.style.marginLeft).toBe(`-${DECK_CARD_WIDTH - MIN_VISIBLE_STRIP_PX}px`);
    expect(row.getAttribute('data-interactive-overflow')).toBe('false');
    expect(Number(row.getAttribute('data-overlap'))).toBe(layout.overlap);
    expect(Number(row.getAttribute('data-hidden-left'))).toBe(layout.hiddenLeft);
    expect(Number(row.getAttribute('data-hidden-right'))).toBe(layout.hiddenRight);
    expect(Number(row.getAttribute('data-available-width'))).toBe(visibleAvailable);
    expect(Number(row.getAttribute('data-card-width'))).toBe(DECK_CARD_WIDTH);
    expect(slots[0].style.marginLeft).toBe('0px');
    for (const slot of slots.slice(1)) {
      expect(parseFloat(slot.style.marginLeft)).toBeLessThan(0);
      expect(slot.style.transform).toBe('');
    }
    expect(rowWidth(layout, DECK_CARD_WIDTH)).toBeLessThanOrEqual(visibleAvailable);

    const rule = cssRule('.discard-stack');
    expect(rule).toContain('flex-wrap: nowrap');
    expect(rule).toContain('overflow: hidden');
    expect(rule).toContain('max-width: 100%');
    expect(rule).toContain('min-width: 0');
    expect(rule).toContain('box-sizing: border-box');
    expect(cssRule('.table-discard')).toContain('overflow: hidden');
  });

  it('ITEM-PREV-7a: overlaps only when a face-down stack is present', () => {
    setSettings({ roundness: DEFAULT_SETTINGS.roundness });
    const { unmount } = render(
      <TableDeck
        talonCount={6}
        bottomTrumpCard={null}
        trumpSuit="spades"
        discardCount={3}
        lastDiscardCards={[
          { suit: 'clubs', rank: 'seven' },
          { suit: 'diamonds', rank: 'ace' },
          { suit: 'hearts', rank: 'king' },
        ]}
      />,
    );

    const row = screen.getByTestId('discard-visible-row');
    // No face-down stack: the row uses the whole pile width and never overlaps.
    expect(row.getAttribute('data-overlaps-facedown')).toBe('false');
    expect(Number(row.getAttribute('data-facedown-overlap-px'))).toBe(0);
    expect(row.style.marginLeft).toBe('');
    expect(Number(row.getAttribute('data-available-width'))).toBe(DISCARD_FALLBACK_WIDTH);
    // Three deck-sized cards fit comfortably, so no cursor animation.
    expect(row.getAttribute('data-interactive-overflow')).toBe('false');
    expect(screen.queryByTestId('discard-facedown-stack')).toBeNull();
    unmount();

    // A deep face-up pile that cannot fit even at maximum overlap still marks
    // itself interactive, so the cursor can slide the hidden cards.
    render(
      <TableDeck
        talonCount={0}
        bottomTrumpCard={null}
        trumpSuit="spades"
        discardCount={20}
        lastDiscardCards={twentyDiscards}
      />,
    );
    expect(screen.getByTestId('discard-visible-row').getAttribute('data-interactive-overflow')).toBe(
      'true',
    );
  });

  it('ITEM-7b: never lets the discard row exceed the available pile width', () => {
    for (const count of [1, 2, 6, 18, 36, 52]) {
      for (const available of [160, DISCARD_FALLBACK_WIDTH, 720]) {
        const layout = handLayout(count, available, 0.5, DECK_CARD_WIDTH);
        expect(rowWidth(layout, DECK_CARD_WIDTH)).toBeLessThanOrEqual(
          Math.max(available, DECK_CARD_WIDTH),
        );
      }
    }
  });

  it('ITEM-7b: slides the discarded overflow stack with the cursor like a hand', () => {
    render(
      <TableDeck
        talonCount={6}
        bottomTrumpCard={null}
        trumpSuit="spades"
        discardCount={twentyDiscards.length}
        lastDiscardCards={twentyDiscards}
      />,
    );

    const row = screen.getByTestId('discard-visible-row');
    const hiddenTotal =
      Number(row.getAttribute('data-hidden-left')) + Number(row.getAttribute('data-hidden-right'));
    expect(hiddenTotal).toBeGreaterThan(0);
    expect(row.querySelectorAll('.discard-slot[data-hidden="true"]')).toHaveLength(hiddenTotal);

    row.getBoundingClientRect = () =>
      ({
        left: 100,
        right: 300,
        width: 200,
        top: 0,
        bottom: DECK_CARD_HEIGHT,
        height: DECK_CARD_HEIGHT,
        x: 100,
        y: 0,
        toJSON: () => ({}),
      }) as DOMRect;

    fireEvent.mouseMove(row, { clientX: 100 });
    expect(Number(row.getAttribute('data-hidden-left'))).toBe(0);
    expect(Number(row.getAttribute('data-hidden-right'))).toBe(hiddenTotal);

    fireEvent.mouseMove(row, { clientX: 300 });
    expect(Number(row.getAttribute('data-hidden-left'))).toBe(hiddenTotal);
    expect(Number(row.getAttribute('data-hidden-right'))).toBe(0);

    fireEvent.mouseLeave(row);
    expect(Number(row.getAttribute('data-cursor-fraction'))).toBe(0.5);
  });

  // --- ITEM-7c: discard cards match the talon deck size ---

  it('ITEM-7c: sizes discarded cards exactly like the talon deck cards', () => {
    render(
      <TableDeck
        talonCount={8}
        bottomTrumpCard={{ suit: 'hearts', rank: 'king' }}
        trumpSuit="hearts"
        discardCount={4}
      />,
    );

    // One shared source of truth for the deck card size.
    expect(tableCss).toContain('--deck-card-width: 80px');
    expect(tableCss).toContain('--deck-card-height: 114px');
    expect(cssRule('.talon-back')).toContain('width: var(--deck-card-width, 80px)');
    expect(cssRule('.talon-back')).toContain('height: var(--deck-card-height, 114px)');

    const slotRule = cssRule('.discard-slot');
    expect(slotRule).toContain('width: var(--deck-card-width, 80px)');
    expect(slotRule).toContain('height: var(--deck-card-height, 114px)');
    const fillStart = tableCss.indexOf('.discard-slot .card-slot,');
    expect(fillStart).toBeGreaterThan(-1);
    expect(tableCss.slice(fillStart, tableCss.indexOf('}', fillStart))).toContain('width: 100%');

    // The old shrunken 40x57 discard override is gone.
    expect(tableCss).not.toContain('.discard-card');
    expect(tableCss).not.toContain('grid-template-columns: 40px');

    const pile = screen.getByTestId('discard-pile');
    expect(pile.querySelectorAll('.discard-slot')).toHaveLength(4);
    expect(pile.querySelectorAll('.discard-slot .discard-back')).toHaveLength(4);
    expect(Number(screen.getByTestId('discard-stack').getAttribute('data-card-width'))).toBe(
      DECK_CARD_WIDTH,
    );
    expect(DECK_CARD_HEIGHT).toBe(114);
  });

  // --- ITEM-8: the reflection outline lines up with the cards in play ---

  it('ITEM-8: keeps the reflection outline in the card row, aligned top and bottom', () => {
    render(
      <GameTable
        myId="p0"
        myHand={hand}
        opponents={activeOpponents}
        tablePairs={uncoveredPair}
        trumpSuit="diamonds"
        defenderId="p1"
        canRedirect
      />,
    );

    const group = screen.getByTestId('table-pairs-group');
    const outline = screen.getByTestId('redirect-outline');
    expect(group.contains(outline)).toBe(true);
    expect(outline.getAttribute('data-align')).toBe('card');

    const groupRule = cssRule('.table-pairs-group');
    expect(groupRule).toContain('flex-wrap: nowrap');
    expect(groupRule).toContain('align-items: flex-start');
    expect(groupRule).toContain('--bout-card-width: 80px');
    expect(groupRule).toContain('--bout-card-height: 114px');
    expect(groupRule).toContain('--bout-card-offset: 15px');

    const pairRule = cssRule('.table-pair');
    expect(pairRule).toContain('grid-template-rows: var(--bout-card-height, 114px)');
    expect(pairRule).toContain('align-content: start');
    expect(pairRule).toContain('padding: 0 0 var(--bout-card-offset, 15px) 0');
    expect(pairRule).toContain('box-sizing: border-box');

    const outlineRule = cssRule('.redirect-outline');
    expect(outlineRule).toContain('height: var(--bout-card-height, 114px)');
    expect(outlineRule).toContain('width: var(--bout-card-width, 80px)');
    expect(outlineRule).toContain('align-self: flex-start');
    expect(outlineRule).toContain('box-sizing: border-box');
    expect(outlineRule).toContain('margin: 0 0 var(--bout-card-offset, 15px) 0');
    expect(outlineRule).not.toContain('margin-left');

    // Every pair opts into the same top-aligned, exact card-sized box.
    const pairs = Array.from(document.querySelectorAll('.table-pair'));
    expect(pairs).toHaveLength(1);
    for (const pair of pairs) {
      expect(pair.getAttribute('data-card-align')).toBe('top');
      const attack = pair.querySelector('.table-pair-attack') as HTMLElement;
      expect(attack.getAttribute('data-card-align')).toBe('top');
    }
  });

  it('ITEM-8: hides the reflection outline in review mode after the alignment fix', () => {
    render(
      <GameTable
        myId="p0"
        myHand={hand}
        opponents={activeOpponents}
        tablePairs={uncoveredPair}
        trumpSuit="diamonds"
        defenderId="p1"
        canRedirect
        isReviewMode
      />,
    );

    expect(screen.queryByTestId('redirect-outline')).toBeNull();
  });
});

describe('T-90-3: outline lift, discard stack, chaos targets, deflect arrow and bot lock', () => {
  const cssRule = (selector: string): string => {
    const start = tableCss.indexOf(`\n${selector} {`);
    expect(start).toBeGreaterThan(-1);
    const end = tableCss.indexOf('}', start);
    return tableCss.slice(start, end);
  };

  const threeWayOpponents: OpponentSummary[] = [
    { id: 'p0', name: 'Alice', cardCount: 5, hasPassed: false, finishRank: null },
    { id: 'p2', name: 'Carol', cardCount: 5, hasPassed: false, finishRank: null },
  ];

  // --- ITEM-PB-3: all-legal hand outline ---

  it('ITEM-PB-3: reports all-legal only when every hand card can be played', () => {
    const allLegal = sortableHand.map(cardKey);
    const { unmount } = renderSortableTable({ awaitingAttack: true, playableKeys: allLegal });
    expect(screen.getByTestId('hand-turn-highlight').getAttribute('data-all-legal')).toBe('true');
    unmount();

    renderSortableTable({ awaitingAttack: true, playableKeys: allLegal.slice(0, 3) });
    expect(screen.getByTestId('hand-turn-highlight').getAttribute('data-all-legal')).toBe('false');
  });

  it('ITEM-PB-3: stays at the baseline when a card is not legal or the hand is empty', () => {
    const allLegal = sortableHand.map(cardKey);
    // The flag tracks legality only; the stylesheet also requires an active
    // glow before the box moves, so an idle hand stays at the baseline.
    const { unmount } = renderSortableTable({ playableKeys: allLegal });
    const idle = screen.getByTestId('hand-turn-highlight');
    expect(idle.getAttribute('data-all-legal')).toBe('true');
    expect(idle.getAttribute('data-active')).toBe('false');
    unmount();

    renderSortableTable({ awaitingAttack: true, playableKeys: allLegal.slice(0, 3) });
    expect(screen.getByTestId('hand-turn-highlight').getAttribute('data-all-legal')).toBe('false');
  });

  it('ITEM-PB-3: never reports all-legal for an empty hand', () => {
    renderSortableTable({ myHand: [], awaitingAttack: true, playableKeys: [] });

    const highlight = screen.getByTestId('hand-turn-highlight');
    expect(highlight.getAttribute('data-all-legal')).toBe('false');
    expect(highlight.getAttribute('data-active')).toBe('true');
  });

  it('ITEM-PB-3: translates the outline box and keeps the slots inside it', () => {
    const rule = cssRule(".hand-cards[data-all-legal='true'][data-active='true']");
    expect(rule).toContain('transform: translateY(-8px)');

    const slotRule = cssRule(
      ".hand-cards[data-all-legal='true'][data-active='true'] .card-slot.legal-playable",
    );
    expect(slotRule).toContain('transform: none');

    renderSortableTable({ awaitingAttack: true, playableKeys: sortableHand.map(cardKey) });
    const highlight = screen.getByTestId('hand-turn-highlight') as HTMLElement;
    for (const slot of Array.from(highlight.children) as HTMLElement[]) {
      expect(slot.style.transform).toBe('');
    }
  });

  // --- ITEM-PB-7: face-down discard stack ---

  it('ITEM-PB-7: stacks every face-down discard in one inert card footprint', () => {
    render(
      <TableDeck talonCount={6} bottomTrumpCard={null} trumpSuit="spades" discardCount={18} />,
    );

    const stack = screen.getByTestId('discard-facedown-stack') as HTMLElement;
    expect(screen.queryByTestId('discard-visible-row')).toBeNull();
    expect(stack.querySelectorAll('.discard-slot')).toHaveLength(18);
    expect(stack.getAttribute('data-count')).toBe('18');

    // No cursor handler at all, and no per-card offset: a single stationary pile.
    expect(stack.onmousemove).toBeNull();
    for (const slot of Array.from(stack.querySelectorAll('.discard-slot')) as HTMLElement[]) {
      expect(slot.style.marginLeft).toBe('');
      expect(slot.style.transform).toBe('');
    }

    const stackRule = cssRule('.discard-facedown-stack');
    expect(stackRule).toContain('display: grid');
    expect(stackRule).toContain('pointer-events: none');
    const cardRule = cssRule('.discard-facedown-stack .discard-slot');
    expect(cardRule).toContain('grid-area: 1 / 1');
    expect(cardRule).toContain('transition: none');

    // The cursor never moves anything on hover.
    const before = stack.innerHTML;
    fireEvent.mouseMove(stack, { clientX: 120 });
    fireEvent.mouseOver(stack.querySelector('.discard-slot') as HTMLElement);
    expect(stack.innerHTML).toBe(before);
    expect(screen.queryByTestId('discard-visible-row')).toBeNull();
  });

  // --- ITEM-CHAOS-1: multi-target outlines and double-click safety ---

  it('ITEM-CHAOS-1: resolves targets from the server projection first', () => {
    expect(
      attackTargetIds({
        myId: 'p0',
        opponents: activeOpponents,
        defenderId: 'p1',
        chaosMode: true,
        eligibleTargetIds: ['p2'],
      }),
    ).toEqual(['p2']);
    expect(
      attackTargetIds({ myId: 'p0', opponents: activeOpponents, defenderId: 'p1' }),
    ).toEqual(['p1']);
    expect(
      attackTargetIds({
        myId: 'p0',
        opponents: [
          ...activeOpponents,
          { id: 'p3', name: 'Dave', cardCount: 0, hasPassed: true, finishRank: 2 },
        ],
        chaosMode: true,
      }),
    ).toEqual(['p1', 'p2']);
  });

  it('ITEM-CHAOS-1: renders an outline anchored at every eligible target seat', () => {
    render(
      <GameTable
        myId="p0"
        myHand={hand}
        opponents={activeOpponents}
        tablePairs={[]}
        trumpSuit="diamonds"
        defenderId="p1"
        chaosMode
        eligibleTargetIds={['p1', 'p2']}
        awaitingAttack
      />,
    );

    expect(screen.getByTestId('target-outline-p1').getAttribute('data-anchor-seat')).toBe(
      'top-left',
    );
    expect(screen.getByTestId('target-outline-p2').getAttribute('data-anchor-seat')).toBe(
      'top-right',
    );
  });

  it('ITEM-CHAOS-1: only auto-plays via double-click when exactly one target exists', () => {
    const card: CardData = { suit: 'spades', rank: 'six' };

    expect(initialAttackDoubleClickAction(card, 'p0', ['p1'])).toEqual({
      type: 'initialAttack',
      playerId: 'p0',
      cards: [card],
      targetPlayerId: 'p1',
    });
    expect(initialAttackDoubleClickAction(card, 'p0', ['p1', 'p2'])).toBeNull();
    expect(initialAttackDoubleClickAction(card, 'p0', [])).toBeNull();

    const onCardDoubleClick = vi.fn();
    const { unmount } = render(
      <GameTable
        myId="p0"
        myHand={hand}
        opponents={activeOpponents}
        tablePairs={[]}
        trumpSuit="diamonds"
        defenderId="p1"
        chaosMode
        awaitingAttack
        onCardDoubleClick={onCardDoubleClick}
      />,
    );
    fireEvent.dblClick(screen.getByLabelText('six of spades'));
    expect(onCardDoubleClick).not.toHaveBeenCalled();
    unmount();

    render(
      <GameTable
        myId="p0"
        myHand={hand}
        opponents={[activeOpponents[0]]}
        tablePairs={[]}
        trumpSuit="diamonds"
        defenderId="p1"
        chaosMode
        awaitingAttack
        onCardDoubleClick={onCardDoubleClick}
      />,
    );
    fireEvent.dblClick(screen.getByLabelText('six of spades'));
    expect(onCardDoubleClick).toHaveBeenCalledTimes(1);
  });

  // --- ITEM-ADD-1: 3-player deflect arrow ---

  it('ITEM-ADD-1: seats Carol top-left from Bob’s POV and points the arrow there', () => {
    const bobHand: CardData[] = [
      { suit: 'hearts', rank: 'six' },
      { suit: 'hearts', rank: 'nine' },
      { suit: 'hearts', rank: 'ten' },
    ];
    render(
      <GameTable
        myId="p1"
        myHand={bobHand}
        opponents={threeWayOpponents}
        tablePairs={uncoveredPair}
        trumpSuit="spades"
        attackerId="p0"
        defenderId="p1"
        canRedirect
      />,
    );

    // ITEM-ADD-1a: from Bob's POV, Carol is the next player clockwise
    // (top-left) and Alice sits across the table to the right.
    const seats = Object.fromEntries(
      screen.getAllByTestId('opponent').map((seat) => [
        seat.querySelector('.opponent-name')!.textContent,
        seat.getAttribute('data-seat'),
      ]),
    );
    expect(seats).toEqual({ Alice: 'top-right', Carol: 'top-left' });

    // ITEM-ADD-1b: the deflect arrow follows the very same mapping.
    const outline = screen.getByTestId('redirect-outline');
    expect(outline.getAttribute('data-target-seat')).toBe('top-left');
    expect(outline.getAttribute('data-target-player')).toBe('p2');
    expect(outline.getAttribute('data-direction')).toBe('top-left');
  });

  it('ITEM-ADD-1a: seats Alice top-left from Carol’s POV and keeps Bob top-right', () => {
    const carolHand: CardData[] = [
      { suit: 'clubs', rank: 'six' },
      { suit: 'clubs', rank: 'nine' },
    ];
    render(
      <GameTable
        myId="p2"
        myHand={carolHand}
        opponents={[player('p0', 'Alice'), player('p1', 'Bob')]}
        tablePairs={uncoveredPair}
        trumpSuit="spades"
        attackerId="p0"
        defenderId="p2"
      />,
    );

    const seats = Object.fromEntries(
      screen.getAllByTestId('opponent').map((seat) => [
        seat.querySelector('.opponent-name')!.textContent,
        seat.getAttribute('data-seat'),
      ]),
    );
    expect(seats).toEqual({ Alice: 'top-left', Bob: 'top-right' });
  });

  it('ITEM-ADD-1: follows the server’s redirectTargetId and the viewer’s own seat', () => {
    expect(seatIndexOf('p2')).toBe(2);
    expect(seatIndexOf('bob')).toBeNull();
    expect(
      nextPlayerWithCards('p1', [
        { id: 'p0', cardCount: 6 },
        { id: 'p1', cardCount: 6 },
        { id: 'p2', cardCount: 6 },
      ]),
    ).toBe('p2');
    expect(
      nextPlayerWithCards('p1', [
        { id: 'p0', cardCount: 3 },
        { id: 'p1', cardCount: 6 },
        { id: 'p2', cardCount: 0, finished: true },
      ]),
    ).toBe('p0');

    const wrapped = render(
      <GameTable
        myId="p0"
        myHand={hand}
        opponents={threeWayOpponents}
        tablePairs={uncoveredPair}
        trumpSuit="spades"
        attackerId="p1"
        defenderId="p1"
        canRedirect
      />,
    );
    // Without a server hint the viewer's own seat still resolves to `bottom`
    // for a redirect that comes back around the table.
    expect(screen.getByTestId('redirect-outline').getAttribute('data-target-player')).toBe('p0');
    expect(screen.getByTestId('redirect-outline').getAttribute('data-target-seat')).toBe('bottom');
    wrapped.unmount();

    render(
      <GameTable
        myId="p0"
        myHand={hand}
        opponents={threeWayOpponents}
        tablePairs={uncoveredPair}
        trumpSuit="spades"
        attackerId="p1"
        defenderId="p1"
        canRedirect
        redirectTargetId="p2"
      />,
    );
    expect(screen.getByTestId('redirect-outline').getAttribute('data-target-player')).toBe('p2');
    expect(screen.getByTestId('redirect-outline').getAttribute('data-target-seat')).toBe(
      'top-right',
    );
  });

  // --- ITEM-ADD-3: statically centred play area ---

  it('ITEM-ADD-3: never moves or resizes the shaded play area itself', () => {
    const rule = cssRule('.battlefield-tinted-box');
    expect(rule).toContain('justify-self: center');
    expect(rule).toContain('align-self: center');
    expect(rule).toContain('transform: none');
    expect(rule).toContain('overflow: visible');
    expect(rule).toContain('padding: 12px');
    expect(rule).toContain('width: 88%');
    expect(rule).toContain('height: var(--battlefield-height');

    // The old "shade follows the defender" rules are gone.
    expect(tableCss).not.toContain(".bout-area[data-anchor='top-left']");
    expect(tableCss).not.toContain(".bout-area[data-anchor='top-right']");

    render(
      <GameTable
        myId="p0"
        myHand={hand}
        opponents={activeOpponents}
        tablePairs={uncoveredPair}
        trumpSuit="diamonds"
        defenderId="p1"
      />,
    );

    const box = screen.getByTestId('play-area-box');
    expect(box.style.width).toBe('');
    expect(box.style.height).toBe('');
    expect(box.style.transform).toBe('');
    expect(screen.getByTestId('table-pairs-group').getAttribute('data-anchor-seat')).toBe(
      'top-left',
    );
  });

  it('ITEM-ADD-3: anchors the bout in the bottom-centre when the viewer defends', () => {
    render(
      <GameTable
        myId="p0"
        myHand={hand}
        opponents={activeOpponents}
        tablePairs={uncoveredPair}
        trumpSuit="diamonds"
        defenderId="p0"
        defending
      />,
    );

    expect(screen.getByTestId('table-pairs-group').getAttribute('data-anchor-seat')).toBe(
      'bottom',
    );
    expect(cssRule(".battlefield-tinted-box > [data-anchor-seat='bottom']")).toContain(
      'align-self: end',
    );
  });

  // --- ITEM-ADD-4: half on / half off surrender ---

  it('ITEM-ADD-4: straddles the shaded edge toward the surrendering seat', () => {
    // The three top seats share one grouped rule, so search for the selector
    // itself instead of requiring it to open a rule block.
    const topSelector = ".table-pairs-group[data-surrendered='true'][data-surrender-target='top-center']";
    const topStart = tableCss.indexOf(topSelector);
    expect(topStart).toBeGreaterThan(-1);
    expect(tableCss.slice(topStart, tableCss.indexOf('}', topStart))).toContain(
      'transform: translateY(calc(-50% - 12px))',
    );
    expect(
      cssRule(".table-pairs-group[data-surrendered='true'][data-surrender-target='bottom']"),
    ).toContain('transform: translateY(calc(50% + 12px))');

    render(
      <GameTable
        myId="p0"
        myHand={hand}
        opponents={activeOpponents}
        tablePairs={tablePairs}
        trumpSuit="diamonds"
        defenderId="p0"
        boutPhase="SurrenderThrowIn"
      />,
    );

    const group = screen.getByTestId('table-pairs-group');
    expect(group.getAttribute('data-surrendered')).toBe('true');
    expect(group.getAttribute('data-surrender-target')).toBe('bottom');
    // The cards stay put while more throw-ins land on the pile.
    expect(group.querySelectorAll('.table-pair')).toHaveLength(tablePairs.length);
  });

  it('ITEM-ADD-4b: normalises the surrender phase before straddling', () => {
    for (const phase of ['SurrenderThrowIn', 'surrender_throw_in', 'SURRENDER_THROW_IN']) {
      const { unmount } = render(
        <GameTable
          myId="p0"
          myHand={hand}
          opponents={activeOpponents}
          tablePairs={tablePairs}
          trumpSuit="diamonds"
          defenderId="p1"
          boutPhase={phase}
        />,
      );
      const group = screen.getByTestId('table-pairs-group');
      expect(group.getAttribute('data-surrendered')).toBe('true');
      expect(group.getAttribute('data-surrender-target')).toBe('top-left');
      // The play area keeps `overflow: visible` so the half-off cards show.
      expect(cssRule('.battlefield-tinted-box')).toContain('overflow: visible');
      unmount();
    }
  });

  // --- ITEM-ADD-6: fixed table rows ---

  it('ITEM-ADD-6: reserves every row independently of the card counts', () => {
    const arenaRule = cssRule("[data-zone='table-arena']");
    expect(arenaRule).toContain('grid-template-rows: var(--seat-row-height)');
    expect(arenaRule).toContain('--hand-row-height');
    expect(cssRule('.opponent-hand')).toContain('min-height: 44px');
    expect(cssRule("[data-zone='player-hand']")).toContain('min-height: var(--hand-row-height');

    const empty = render(
      <GameTable
        myId="p0"
        myHand={[]}
        opponents={[{ id: 'p1', name: 'Bob', cardCount: 0, hasPassed: false, finishRank: null }]}
        tablePairs={[]}
        trumpSuit="diamonds"
      />,
    );
    const emptySeat = screen.getByTestId('opponent');
    const emptySnapshot = {
      seat: emptySeat.getAttribute('data-seat'),
      seatHeight: (emptySeat as HTMLElement).style.getPropertyValue('--seat-height'),
      handZone: Boolean(document.querySelector('[data-zone="player-hand"]')),
    };
    empty.unmount();

    render(
      <GameTable
        myId="p0"
        myHand={hand}
        opponents={[{ id: 'p1', name: 'Bob', cardCount: 6, hasPassed: false, finishRank: null }]}
        tablePairs={[]}
        trumpSuit="diamonds"
      />,
    );
    const fullSeat = screen.getByTestId('opponent');
    expect({
      seat: fullSeat.getAttribute('data-seat'),
      seatHeight: (fullSeat as HTMLElement).style.getPropertyValue('--seat-height'),
      handZone: Boolean(document.querySelector('[data-zone="player-hand"]')),
    }).toEqual(emptySnapshot);
  });

  // --- ITEM-ADD-9: bot seat input lock ---

  it('ITEM-ADD-9: locks every move surface for a bot seat', () => {
    const onAttackDrop = vi.fn();
    const { container } = render(
      <GameTable
        myId="p0"
        myHand={hand}
        opponents={activeOpponents}
        tablePairs={[]}
        trumpSuit="diamonds"
        defenderId="p1"
        chaosMode
        awaitingAttack
        defending
        canRedirect
        canThrowIn
        isBot
        playableKeys={hand.map(cardKey)}
        onAttackDrop={onAttackDrop}
        onCoverDrop={() => {}}
        onThrowInDrop={() => {}}
        onRedirectDrop={() => {}}
      >
        <ActionBar legalActions={['pass', 'surrender']} onAction={() => {}} />
      </GameTable>,
    );

    const arena = container.querySelector('[data-zone="table-arena"]') as HTMLElement;
    expect(arena.getAttribute('data-bot-locked')).toBe('true');
    expect(arena.getAttribute('data-review-mode')).toBe('false');
    expect(screen.queryByTestId('target-outline-p1')).toBeNull();
    expect(screen.queryByTestId('target-outline-p2')).toBeNull();
    expect(screen.queryByTestId('redirect-outline')).toBeNull();
    expect(container.querySelector('[data-drop-zone]')).toBeNull();
    expect(container.querySelectorAll('[draggable="true"]')).toHaveLength(0);
    expect(container.querySelector('[data-zone="player-controls"]')).toBeNull();
    expect(screen.queryByText('Pass')).toBeNull();
    expect(screen.queryByText('Surrender')).toBeNull();

    const highlight = screen.getByTestId('hand-turn-highlight');
    expect(highlight.getAttribute('data-active')).toBe('false');
    expect(highlight.getAttribute('data-all-legal')).toBe('false');
    expect(container.querySelectorAll('.card-slot[data-playable="true"]')).toHaveLength(0);
  });

  it('ITEM-ADD-9: hides Surrender and Pass in ActionBar for a bot seat', () => {
    render(
      <ActionBar legalActions={['pass', 'surrender']} onAction={() => {}} isBotSeat />,
    );

    expect(screen.queryByText('Pass')).toBeNull();
    expect(screen.queryByText('Surrender')).toBeNull();
  });
});

describe('T-90-3 ITEM-NEW: compact single-row play area and roundness', () => {
  const cssRule = (selector: string): string => {
    const start = tableCss.indexOf(`\n${selector} {`);
    expect(start).toBeGreaterThan(-1);
    const end = tableCss.indexOf('}', start);
    return tableCss.slice(start, end);
  };

  it('ITEM-NEW-2a/2b: keeps six pairs plus the reflection outline in one compact row', () => {
    const sixPairs: TablePairData[] = Array.from({ length: 6 }, () => ({
      attack: { suit: 'spades', rank: 'six' },
      defense: null,
    }));
    render(
      <GameTable
        myId="p0"
        myHand={hand}
        opponents={activeOpponents}
        tablePairs={sixPairs}
        trumpSuit="diamonds"
        defenderId="p1"
        canRedirect
      />,
    );

    const group = screen.getByTestId('table-pairs-group');
    expect(group.getAttribute('data-single-row')).toBe('true');
    expect(group.getAttribute('data-min-visible-left')).toBe(String(BOUT_MIN_VISIBLE_LEFT));
    expect(cssRule('.table-pairs-group')).toContain('flex-wrap: nowrap');

    // The whole bout is anchored at the defender's edge of the play area.
    expect(group.getAttribute('data-anchor-seat')).toBe('top-left');

    const pairs = Array.from(group.querySelectorAll('.table-pair')) as HTMLElement[];
    expect(pairs).toHaveLength(6);
    expect(pairs[0].style.marginLeft).toBe('');
    for (const pair of pairs.slice(1)) {
      const margin = parseFloat(pair.style.marginLeft);
      // Overlapped for compaction, but never over the rank/suit strip.
      expect(margin).toBeLessThan(0);
      expect(margin).toBeGreaterThanOrEqual(-(BOUT_CARD_WIDTH - BOUT_MIN_VISIBLE_LEFT));
    }

    // The reflection outline takes its own slot in the same compact row.
    const outline = screen.getByTestId('redirect-outline') as HTMLElement;
    expect(outline.style.marginLeft).toBe(pairs[pairs.length - 1].style.marginLeft);
    expect(Number(group.getAttribute('data-overlap'))).toBeLessThanOrEqual(
      BOUT_CARD_WIDTH - BOUT_MIN_VISIBLE_LEFT,
    );
  });

  it('ITEM-NEW-1a: binds --app-roundness to every table element', () => {
    expect(cssRule("[data-zone='table-arena']")).toContain(
      'border-radius: calc(var(--app-roundness, 8px) * 1.5)',
    );
    expect(cssRule('.battlefield-tinted-box')).toContain(
      'border-radius: calc(var(--app-roundness, 8px) * 1.5)',
    );
    expect(cssRule('.seat-box')).toContain('border-radius: var(--app-roundness, 8px)');
    expect(cssRule('.target-outline')).toContain('border-radius: var(--app-roundness, 8px)');
    expect(cssRule('.redirect-outline')).toContain('border-radius: var(--app-roundness, 8px)');
    expect(cssRule('.card-slot')).toContain('border-radius: var(--app-roundness, 8px)');
    expect(cssRule('.playing-card')).toContain('border-radius: var(--app-roundness, 8px)');
    expect(cssRule('.playing-card.card-face')).toContain(
      'border-radius: var(--app-roundness, 8px)',
    );
    expect(cssRule('.playing-card.card-back')).toContain(
      'border-radius: var(--app-roundness, 8px)',
    );
    expect(cssRule('.hand-cards')).toContain(
      'border-radius: calc(var(--app-roundness, 8px) + 4px)',
    );
    expect(cssRule('.action-button')).toContain('border-radius: var(--app-roundness, 8px)');
    expect(tableCss).toContain('.playing-card text {');
    // ITEM-NEW-3: the CSS rule overrides the SVG presentation attribute, so it
    // must carry the same ornate serif stack as `CARD_SERIF_FONT_FAMILY`.
    expect(tableCss).toContain("'Cinzel', 'Playfair Display', Georgia, 'Times New Roman'");
  });

  it('ITEM-NEW-1b: rounds the reflection SVG plate with the slider', () => {
    setSettings({ roundness: 16 });
    const { unmount } = render(
      <GameTable
        myId="p0"
        myHand={hand}
        opponents={activeOpponents}
        tablePairs={uncoveredPair}
        trumpSuit="diamonds"
        defenderId="p1"
        canRedirect
      />,
    );

    const plate = screen.getByTestId('redirect-outline').querySelector('rect');
    expect(plate).not.toBeNull();
    expect(Number(plate!.getAttribute('rx'))).toBe(14);
    unmount();
    setSettings({ roundness: DEFAULT_SETTINGS.roundness });
  });
});

describe('T-90-2 ITEM-PREV-4: defender hand glow before the surrender decision', () => {
  const handZoneOf = (container: Element): HTMLElement =>
    container.querySelector('[data-zone="player-hand"]') as HTMLElement;

  it('leaves the hand unhighlighted during SurrenderThrowIn', () => {
    const { container } = render(
      <GameTable
        myId="p0"
        myHand={hand}
        opponents={activeOpponents}
        tablePairs={uncoveredPair}
        trumpSuit="clubs"
        attackerId="p1"
        defenderId="p0"
        boutPhase="SurrenderThrowIn"
        defending
        isSurrenderingDefender
        turnPlayerId="p0"
      />,
    );

    const zone = handZoneOf(container);
    const handBox = screen.getByTestId('hand-turn-highlight') as HTMLElement;
    for (const node of [zone, handBox]) {
      expect(node.getAttribute('data-highlighted')).toBe('false');
      expect(node.getAttribute('data-surrendering')).toBe('true');
      expect(node.classList.contains('turn-pulse')).toBe(false);
      expect(node.classList.contains('attacker-turn')).toBe(false);
      expect(node.classList.contains('throw-in-turn')).toBe(false);
      expect(node.classList.contains('defender-turn')).toBe(false);
    }
    expect(handBox.getAttribute('data-active')).toBe('false');
    // The felt stops prompting a defender who already gave up the bout.
    expect(container.querySelectorAll('.table-pair.turn-pulse')).toHaveLength(0);
    // The crimson rules exist, but this surrendered hand never matches them.
    expect(tableCss).toContain('.hand-cards.defender-turn');
    expect(tableCss).toContain('defenderHandPulse');
    for (const node of [zone, handBox]) {
      expect(node.getAttribute('data-highlight-variant')).toBe('none');
    }
  });

  it('keeps the red glow on a defenceless defender while the surrender countdown runs', () => {
    const { container } = render(
      <GameTable
        myId="p0"
        myHand={hand}
        opponents={activeOpponents}
        tablePairs={uncoveredPair}
        trumpSuit="clubs"
        attackerId="p1"
        defenderId="p0"
        boutPhase="Defense"
        defending
        defenderDefenseless
        turnPlayerId="p0"
      />,
    );

    const zone = handZoneOf(container);
    const handBox = screen.getByTestId('hand-turn-highlight') as HTMLElement;
    expect(zone.getAttribute('data-defenseless')).toBe('true');
    expect(handBox.getAttribute('data-defenseless')).toBe('true');
    // The decision to surrender has not been executed yet, so the hand glows.
    for (const node of [zone, handBox]) {
      expect(node.getAttribute('data-highlighted')).toBe('true');
      expect(node.getAttribute('data-highlight-variant')).toBe('defender');
      expect(node.getAttribute('data-surrendering')).toBe('false');
      expect(node.classList.contains('defender-turn')).toBe(true);
      expect(node.classList.contains('attacker-turn')).toBe(false);
      expect(node.classList.contains('throw-in-turn')).toBe(false);
    }
    expect(handBox.getAttribute('data-active')).toBe('true');
    // The felt keeps prompting the seat that still owes a decision.
    expect(container.querySelectorAll('.table-pair.turn-pulse')).toHaveLength(1);
  });

  it('keeps the felt prompt and the card lift for a defender who can still answer', () => {
    const { container } = render(
      <GameTable
        myId="p0"
        myHand={hand}
        opponents={activeOpponents}
        tablePairs={uncoveredPair}
        trumpSuit="clubs"
        attackerId="p1"
        defenderId="p0"
        boutPhase="Defense"
        defending
        canRedirect
        playableKeys={[cardKey(hand[0])]}
      />,
    );

    expect(container.querySelectorAll('.table-pair.turn-pulse')).toHaveLength(1);
    expect(container.querySelector('.card-slot.legal-playable')).not.toBeNull();
    // The prompt is on the felt, the legal cards lift, and the hand glows red.
    expect(handZoneOf(container).getAttribute('data-highlighted')).toBe('true');
    expect(handZoneOf(container).getAttribute('data-highlight-variant')).toBe('defender');
    expect(
      screen.getByTestId('hand-turn-highlight').getAttribute('data-highlight-variant'),
    ).toBe('defender');
  });

  it('still highlights an opening attacker and an eligible thrower', () => {
    const first = render(
      <GameTable
        myId="p0"
        myHand={hand}
        opponents={activeOpponents}
        tablePairs={[]}
        trumpSuit="clubs"
        defenderId="p1"
        boutPhase="InitialAttack"
        awaitingAttack
      />,
    );

    let handBox = screen.getByTestId('hand-turn-highlight') as HTMLElement;
    expect(handBox.getAttribute('data-highlighted')).toBe('true');
    expect(handBox.getAttribute('data-highlight-variant')).toBe('attacker');
    expect(handBox.getAttribute('data-active')).toBe('true');
    expect(handBox.classList.contains('attacker-turn')).toBe(true);
    expect(
      first.container.querySelector('[data-zone="player-hand"]')!.getAttribute('data-highlighted'),
    ).toBe('true');
    first.unmount();

    const second = render(
      <GameTable
        myId="p0"
        myHand={hand}
        opponents={activeOpponents}
        tablePairs={uncoveredPair}
        trumpSuit="clubs"
        attackerId="p1"
        defenderId="p2"
        boutPhase="SurrenderThrowIn"
        canThrowIn
      />,
    );

    handBox = screen.getByTestId('hand-turn-highlight') as HTMLElement;
    expect(handBox.getAttribute('data-highlighted')).toBe('true');
    expect(handBox.getAttribute('data-highlight-variant')).toBe('throw-in');
    expect(handBox.classList.contains('throw-in-turn')).toBe(true);
    expect(
      second.container
        .querySelector('[data-zone="player-hand"]')!
        .getAttribute('data-surrendering'),
    ).toBe('false');
    second.unmount();
  });

  it('T-90 ITEM-1c: marks uncovered attacking cards with the Defender hook', () => {
    const { container } = render(
      <GameTable
        myId="p0"
        myHand={hand}
        opponents={activeOpponents}
        tablePairs={uncoveredPair}
        trumpSuit="clubs"
        attackerId="p1"
        defenderId="p0"
        boutPhase="Defense"
        defending
        turnPlayerId="p0"
      />,
    );

    // Every uncovered attack carries both the legacy pulse class and the
    // dedicated `table-card-uncovered` hook used by the crimson rules.
    expect(container.querySelectorAll('.table-card-uncovered')).toHaveLength(
      uncoveredPair.length,
    );
    expect(container.querySelectorAll('.turn-pulse.table-card-uncovered')).toHaveLength(
      uncoveredPair.length,
    );
  });

  it('T-90 ITEM-PREV-4b: shows the uncovered prompt only to the defender', () => {
    const defender = render(
      <GameTable
        myId="p0"
        myHand={hand}
        opponents={activeOpponents}
        tablePairs={uncoveredPair}
        trumpSuit="clubs"
        attackerId="p1"
        defenderId="p0"
        boutPhase="Defense"
        defending
        turnPlayerId="p0"
      />,
    );

    const pair = defender.container.querySelector('.table-pair') as HTMLElement;
    const attack = defender.container.querySelector('.table-pair-attack') as HTMLElement;
    expect(pair.classList.contains('table-card-uncovered')).toBe(true);
    expect(pair.getAttribute('data-uncovered-highlighted')).toBe('true');
    expect(attack.getAttribute('data-uncovered-highlighted')).toBe('true');
    defender.unmount();

    // The initial attacker (p0) sees the same uncovered card with no prompt.
    const attacker = render(
      <GameTable
        myId="p0"
        myHand={hand}
        opponents={activeOpponents}
        tablePairs={uncoveredPair}
        trumpSuit="clubs"
        attackerId="p0"
        defenderId="p1"
        boutPhase="Defense"
        turnPlayerId="p1"
      />,
    );
    expect(attacker.container.querySelectorAll('.table-card-uncovered')).toHaveLength(0);
    expect(
      attacker.container.querySelector('.table-pair')!.getAttribute('data-uncovered-highlighted'),
    ).toBe('false');
    attacker.unmount();

    // A non-defending third seat (spectator POV) also sees no prompt.
    const spectator = render(
      <GameTable
        myId="p2"
        myHand={hand}
        opponents={[
          { id: 'p0', name: 'Alice', cardCount: 4, hasPassed: false, finishRank: null },
          { id: 'p1', name: 'Bob', cardCount: 4, hasPassed: false, finishRank: null },
        ]}
        tablePairs={uncoveredPair}
        trumpSuit="clubs"
        attackerId="p0"
        defenderId="p1"
        boutPhase="Defense"
        turnPlayerId="p1"
      />,
    );
    expect(spectator.container.querySelectorAll('.table-card-uncovered')).toHaveLength(0);
    expect(
      spectator.container.querySelector('.table-pair')!.getAttribute('data-uncovered-highlighted'),
    ).toBe('false');
  });

  it('T-90 ITEM-PREV-4a: clears the uncovered prompt once surrender is decided', () => {
    const baseProps = {
      myId: 'p0',
      myHand: hand,
      opponents: activeOpponents,
      tablePairs: uncoveredPair,
      trumpSuit: 'clubs',
      attackerId: 'p1',
      defenderId: 'p0',
    };

    // The Surrender click is already in flight (the new projection has not
    // landed yet): the felt stops prompting immediately.
    const clicked = render(
      <GameTable {...baseProps} boutPhase="Defense" defending surrenderTriggered />,
    );
    expect(clicked.container.querySelectorAll('.table-card-uncovered')).toHaveLength(0);
    expect(
      clicked.container.querySelector('.table-pair')!.getAttribute('data-uncovered-highlighted'),
    ).toBe('false');
    clicked.unmount();

    // The server has moved the bout into `SurrenderThrowIn`.
    const phase = render(
      <GameTable {...baseProps} boutPhase="SurrenderThrowIn" defending />,
    );
    expect(phase.container.querySelectorAll('.table-card-uncovered')).toHaveLength(0);
    expect(
      phase.container.querySelector('.table-pair')!.getAttribute('data-uncovered-highlighted'),
    ).toBe('false');
    phase.unmount();

    // The handed-down flag names the surrendered defender outright.
    const handedDown = render(
      <GameTable {...baseProps} boutPhase="Defense" isSurrenderingDefender />,
    );
    expect(handedDown.container.querySelectorAll('.table-card-uncovered')).toHaveLength(0);
    expect(
      handedDown.container.querySelector('.table-pair')!.getAttribute('data-uncovered-highlighted'),
    ).toBe('false');
    handedDown.unmount();

    // Once the new bout starts in `Defense`, the defender is prompted again.
    const fresh = render(<GameTable {...baseProps} boutPhase="Defense" defending />);
    expect(fresh.container.querySelectorAll('.table-card-uncovered')).toHaveLength(1);
  });

  it('T-90-2: drops the red glow the moment Surrender is pressed', () => {
    const { container } = render(
      <GameTable
        myId="p0"
        myHand={hand}
        opponents={activeOpponents}
        tablePairs={uncoveredPair}
        trumpSuit="clubs"
        attackerId="p1"
        defenderId="p0"
        boutPhase="Defense"
        defending
        defenderDefenseless
        surrenderTriggered
        turnPlayerId="p0"
      />,
    );

    const zone = handZoneOf(container);
    const handBox = screen.getByTestId('hand-turn-highlight') as HTMLElement;
    for (const node of [zone, handBox]) {
      expect(node.getAttribute('data-highlighted')).toBe('false');
      expect(node.getAttribute('data-highlight-variant')).toBe('none');
      expect(node.getAttribute('data-surrendering')).toBe('true');
      expect(node.classList.contains('defender-turn')).toBe(false);
      expect(node.classList.contains('turn-pulse')).toBe(false);
    }
    expect(handBox.getAttribute('data-active')).toBe('false');
    // The surrender is already in flight, so the felt stops prompting too.
    expect(container.querySelectorAll('.table-pair.turn-pulse')).toHaveLength(0);
  });

  it('T-90-2: defines the crimson defender glow and clears it after the surrender', () => {
    expect(tableCss).toContain('.hand-cards.defender-turn');
    expect(tableCss).toContain('@keyframes defenderHandPulse');
    expect(tableCss).toContain("[data-highlight-variant='defender']");
    expect(tableCss).toContain("[data-surrendering='true']");
    expect(tableCss).toContain("[data-highlighted='false']");
    expect(tableCss).toMatch(/\[data-surrendering='true'\][\s\S]*?box-shadow:\s*none/);
  });

  describe('T-90-3 light-mode emphasis glows', () => {
    it('darkens the attack / throw-in hand prompt only in the light theme', () => {
      const attack = cssRule(tableCss, ":root[data-theme='light'] .hand-cards.attacker-turn");
      expect(attack).toContain('border: 1px solid var(--role-attacker-border)');
      expect(attack).toContain('lightAttackerHandPulse');
      // Throw-ins share the exact same darker prompt.
      expect(cssRule(tableCss, ":root[data-theme='light'] .hand-cards.throw-in-turn")).toBe(
        attack,
      );
      // The light pulse uses the emerald Attacker family in both layers.
      expect(tableCss).toMatch(
        /@keyframes lightAttackerHandPulse\s*{[\s\S]*?50%\s*{[\s\S]*?0 0 14px 3px var\(--role-attacker-glow\)[\s\S]*?inset 0 0 8px var\(--role-attacker-bg\)/,
      );
      // Dark mode keeps its original amber attacker pulse untouched.
      expect(tableCss).toMatch(
        /@keyframes attackerPulse\s*{[\s\S]*?box-shadow: 0 0 12px 3px var\(--attacker-glow\)/,
      );
      expect(tableCss).toMatch(
        /@keyframes throwInPulse\s*{[\s\S]*?box-shadow: 0 0 12px 3px var\(--attacker-glow\)/,
      );
    });

    it('darkens the pre-surrender defender hand glow in the light theme', () => {
      const defender = cssRule(
        tableCss,
        ":root[data-theme='light'] .hand-cards.defender-turn",
      );
      expect(defender).toContain('border: 1px solid var(--role-defender-border)');
      expect(defender).toContain('lightDefenderHandPulse');
      expect(tableCss).toMatch(
        /@keyframes lightDefenderHandPulse\s*{[\s\S]*?0 0 16px 4px var\(--role-defender-glow\)[\s\S]*?inset 0 0 8px var\(--role-defender-bg\)/,
      );
      // Dark mode keeps its crimson keyframe with the softer spread.
      expect(tableCss).toMatch(
        /@keyframes defenderHandPulse\s*{[\s\S]*?box-shadow: 0 0 12px 3px var\(--defender-hand-glow\)/,
      );
    });

    it('darkens trump cards and uncovered attacking cards in the light theme', () => {
      const trump = cssRule(tableCss, ":root[data-theme='light'] .card-slot.trump");
      expect(trump).toContain('border-color: var(--trump-accent)');
      expect(trump).toContain('box-shadow: 0 0 10px 2px var(--trump-glow)');
      // The base (dark) trump glow uses the same gold family.
      expect(tableCss).toMatch(
        /\n\.card-slot\.trump\s*{[^}]*border: 1px solid var\(--trump-accent\);[^}]*box-shadow: 0 0 10px var\(--trump-glow\)/,
      );

      const uncovered = cssRule(
        tableCss,
        ":root[data-theme='light'] .table-pair.turn-pulse .card-slot",
      );
      expect(uncovered).toContain('lightUncoveredPulse');
      expect(tableCss).toMatch(
        /@keyframes lightUncoveredPulse\s*{[\s\S]*?0 0 14px 4px var\(--role-defender-glow\)/,
      );
      // The dark uncovered pulse is the crimson Defender family too.
      expect(tableCss).toMatch(
        /@keyframes turnPulse\s*{[\s\S]*?box-shadow: 0 0 12px 3px var\(--role-defender-glow\)/,
      );
    });

    it('darkens target outlines, the redirect outline and the table buttons', () => {
      expect(cssRule(tableCss, ":root[data-theme='light'] .target-outline,")).toContain(
        'border-color: var(--role-attacker-border)',
      );
      expect(
        cssRule(tableCss, ":root[data-theme='light'] .target-outline.snap-active,"),
      ).toContain('0 0 16px 4px var(--role-attacker-glow)');
      expect(cssRule(tableCss, ":root[data-theme='light'] .redirect-outline,")).toContain(
        'border-color: var(--redirect-border)',
      );
      expect(
        cssRule(tableCss, ":root[data-theme='light'] .redirect-outline.snap-active,"),
      ).toContain('0 0 16px 4px var(--redirect-glow)');

      // Surrender (Defender crimson) and Pass (Attacker emerald) buttons.
      expect(cssRule(tableCss, ":root[data-theme='light'] .action-button.red")).toContain(
        'var(--role-defender-glow)',
      );
      expect(cssRule(tableCss, ":root[data-theme='light'] .action-button.green")).toContain(
        'var(--role-attacker-glow)',
      );
      expect(cssRule(tableCss, ":root[data-theme='light'] .action-button.amber")).toContain(
        'var(--trump-glow)',
      );
      // Dark action buttons stay flat (only the hover filter applies).
      expect(tableCss).not.toMatch(/\n\.action-button\.(red|green|amber)\s*{[^}]*box-shadow/);
    });
  });
});

/**
 * T-90-feedback-20261103_172808-1 ITEM-PREV-4a / ITEM-PREV-4b: the hand shows
 * exactly ONE highlight outline — the tight `.hand-cards` box that wraps the
 * rendered cards with a symmetric 4px margin. The outer
 * `[data-zone="player-hand"]` column still carries `data-highlighted` /
 * `data-highlight-variant` for testability, but it must never paint a second,
 * vertically wider border, outline or glow.
 */
describe('T-90 ITEM-PREV-4a/4b: single tight hand highlight outline', () => {
  const handZoneOf = (container: Element): HTMLElement =>
    container.querySelector('[data-zone="player-hand"]') as HTMLElement;

  const VISUAL_PROPERTIES = new Set([
    'border',
    'border-top',
    'border-right',
    'border-bottom',
    'border-left',
    'border-color',
    'border-width',
    'border-style',
    'outline',
    'outline-color',
    'outline-width',
    'outline-style',
    'outline-offset',
    'box-shadow',
    'background',
    'background-color',
    'background-image',
    'animation',
    'animation-name',
    'animation-duration',
    'animation-timing-function',
    'animation-iteration-count',
    'animation-direction',
    'animation-fill-mode',
    'animation-play-state',
    'animation-delay',
  ]);

  /** Parse `prop: value` declarations out of a rule body. */
  const declarationsOf = (body: string): Array<{ property: string; value: string }> =>
    body
      .split(';')
      .map((declaration) => declaration.trim())
      .filter((declaration) => declaration.length > 0)
      .map((declaration) => {
        const [property, ...rest] = declaration.split(':');
        return { property: property.trim().toLowerCase(), value: rest.join(':').trim() };
      });

  /**
   * Every `selector { … }` rule block in table.css, comments removed. Parsing
   * brace pairs keeps the @media-nested mobile/light overrides too, so the
   * audit covers Dark mode, Light mode and every breakpoint.
   */
  const ruleBlocks = (): Array<{
    selector: string;
    declarations: Array<{ property: string; value: string }>;
  }> => {
    const source = tableCss.replace(/\/\*[\s\S]*?\*\//g, '');
    return Array.from(source.matchAll(/([^{}]*)\{([^{}]*)\}/g)).map((match) => ({
      selector: match[1].trim(),
      declarations: declarationsOf(match[2]),
    }));
  };

  /** Rule blocks that target the outer hand column. */
  const outerHandZoneRules = (): ReturnType<typeof ruleBlocks> =>
    ruleBlocks().filter((rule) => rule.selector.includes('player-hand'));

  const baseRule = (selector: string): string => {
    const start = tableCss.indexOf(`\n${selector} {`);
    expect(start).toBeGreaterThan(-1);
    return tableCss.slice(start, tableCss.indexOf('}', start));
  };

  it('pins the outer hand column to a neutral box in Dark and Light mode', () => {
    const rules = outerHandZoneRules();
    expect(rules.length).toBeGreaterThan(1);

    const visual = rules.flatMap((rule) =>
      rule.declarations.filter((declaration) => VISUAL_PROPERTIES.has(declaration.property)),
    );
    // Layout-only rules (grid placement, reserved card height) may target the
    // wrapper, but every visual property must be an explicit neutral reset.
    expect(visual.length).toBeGreaterThan(0);
    for (const declaration of visual) {
      expect(declaration.value).toMatch(/^(none|transparent)$/);
    }

    // The exact five-property reset exists once for Dark and once for Light.
    const resets = rules.filter((rule) => {
      const properties = rule.declarations.map((declaration) => declaration.property);
      return ['border', 'outline', 'box-shadow', 'background', 'animation'].every((property) =>
        properties.includes(property),
      );
    });
    expect(resets).toHaveLength(2);
    for (const reset of resets) {
      const byProperty = Object.fromEntries(
        reset.declarations.map((declaration) => [declaration.property, declaration.value]),
      );
      expect(byProperty).toMatchObject({
        border: 'none',
        outline: 'none',
        'box-shadow': 'none',
        background: 'transparent',
        animation: 'none',
      });
    }
    expect(resets.some((reset) => reset.selector.includes("data-theme='light'"))).toBe(true);
    expect(resets.some((reset) => !reset.selector.includes("data-theme='light'"))).toBe(true);

    // Every rule that paints a hand glow targets `.hand-cards` — never the
    // wrapper — so the wrapper's data attributes can never add a second outline.
    const glowRules = ruleBlocks().filter((rule) =>
      [
        'defenderHandPulse',
        'attackerPulse',
        'throwInPulse',
        'lightDefenderHandPulse',
        'lightAttackerHandPulse',
      ].some((keyframe) =>
        rule.declarations.some((declaration) => declaration.value.includes(keyframe)),
      ),
    );
    expect(glowRules.length).toBeGreaterThan(0);
    for (const rule of glowRules) {
      for (const selector of rule.selector.split(',')) {
        expect(selector).toContain('.hand-cards');
        expect(selector).not.toContain('player-hand');
      }
    }
  });

  it('names every outer hand wrapper in the Dark and Light neutral resets', () => {
    const resets = ruleBlocks().filter((rule) => {
      const properties = rule.declarations.map((declaration) => declaration.property);
      return ['border', 'outline', 'box-shadow', 'background', 'animation'].every((property) =>
        properties.includes(property),
      );
    });
    expect(resets).toHaveLength(2);

    const darkReset = resets.find((rule) => !rule.selector.includes("data-theme='light'"))!;
    const lightReset = resets.find((rule) => rule.selector.includes("data-theme='light'"))!;
    // The ticket names these wrappers verbatim: the outer column (both its
    // `[data-zone="player-hand"]` and `.player-hand-zone` spellings, plain and
    // highlighted) and the intermediate `.hand-scroll-viewport`. All of them
    // are explicitly neutralised in both themes.
    for (const reset of [darkReset, lightReset]) {
      for (const wrapper of [
        "[data-zone='player-hand']",
        "[data-zone='player-hand'][data-highlighted='true']",
        '.player-hand-zone',
        ".player-hand-zone[data-highlighted='true']",
        '.hand-scroll-viewport',
      ]) {
        expect(reset.selector).toContain(wrapper);
      }
    }

    // No rule targeting any outer wrapper (or the scroll viewport) paints a
    // border / outline / shadow / background / animation unless it is one of
    // those two neutral resets. `.hand-cards` rules are excluded here because
    // that tight box is the one element allowed to draw the highlight.
    const wrappers = ['player-hand', 'player-hand-zone', 'hand-scroll-viewport'];
    const wrapperRules = ruleBlocks().filter(
      (rule) =>
        wrappers.some((wrapper) => rule.selector.includes(wrapper)) &&
        !rule.selector.includes('.hand-cards'),
    );
    expect(wrapperRules.length).toBeGreaterThan(0);
    for (const rule of wrapperRules) {
      for (const declaration of rule.declarations) {
        if (!VISUAL_PROPERTIES.has(declaration.property)) continue;
        expect(declaration.value).toMatch(/^(none|transparent)$/);
      }
    }
  });

  it('keeps the tight .hand-cards box hugging the cards without lift headroom', () => {
    const rule = baseRule('.hand-cards');
    expect(rule).toContain('display: inline-flex');
    expect(rule).toContain('width: fit-content');
    expect(rule).toContain('align-self: center');
    expect(rule).toContain('height: fit-content');
    expect(rule).toContain(`padding: ${HAND_BOX_PADDING}px;`);
    // No asymmetric top/bottom padding and no reserved height: the outline hugs
    // the top, bottom, left and right edges of the cards symmetrically.
    expect(rule).not.toMatch(/padding-(top|bottom)/);
    expect(rule).not.toMatch(/min-height/);
    expect(rule).not.toMatch(/padding:\s*[^;]*\s[1-9][0-9]*px\s+[1-9][0-9]*px\s*;/);
  });

  it('glows only the tight box for a defenceless defender during the countdown', () => {
    const { container } = render(
      <GameTable
        myId="p0"
        myHand={hand}
        opponents={activeOpponents}
        tablePairs={uncoveredPair}
        trumpSuit="clubs"
        attackerId="p1"
        defenderId="p0"
        boutPhase="Defense"
        defending
        defenderDefenseless
        turnPlayerId="p0"
      />,
    );

    const zone = handZoneOf(container);
    const box = screen.getByTestId('hand-turn-highlight') as HTMLElement;
    // Previous-4 is preserved: the decision has not been made yet, so the hand
    // still glows crimson while the 3 → 2 → 1 countdown runs.
    expect(box.classList.contains('hand-cards')).toBe(true);
    expect(box.parentElement).toBe(zone);
    expect(box.getAttribute('data-highlighted')).toBe('true');
    expect(box.getAttribute('data-highlight-variant')).toBe('defender');
    expect(box.classList.contains('defender-turn')).toBe(true);
    expect(zone.getAttribute('data-highlighted')).toBe('true');
    expect(zone.getAttribute('data-highlight-variant')).toBe('defender');

    // Exactly one visual highlight container wraps the cards: the tight box.
    // The wrapper's own `turn-pulse` / `defender-turn` state classes are inert
    // because every glow rule also requires `.hand-cards`.
    expect(zone.classList.contains('hand-cards')).toBe(false);
    expect(zone.querySelectorAll('.hand-cards')).toHaveLength(1);
    const glowing = Array.from(
      zone.querySelectorAll('.hand-cards, .attacker-turn, .defender-turn, .throw-in-turn'),
    );
    expect(glowing).toHaveLength(1);
    expect(glowing[0]).toBe(box);

    // Both themes style the glow on `.hand-cards` only.
    expect(
      cssRule(
        tableCss,
        ".hand-cards[data-highlighted='true'][data-highlight-variant='defender']",
      ),
    ).toContain('defenderHandPulse');
    expect(
      cssRule(
        tableCss,
        ":root[data-theme='light'] .hand-cards[data-highlighted='true'][data-highlight-variant='defender']",
      ),
    ).toContain('lightDefenderHandPulse');
  });

  it('glows only the tight box for the opening attacker and an eligible thrower', () => {
    const attacker = render(
      <GameTable
        myId="p0"
        myHand={hand}
        opponents={activeOpponents}
        tablePairs={[]}
        trumpSuit="clubs"
        defenderId="p1"
        boutPhase="InitialAttack"
        awaitingAttack
      />,
    );

    let zone = handZoneOf(attacker.container);
    let box = screen.getByTestId('hand-turn-highlight') as HTMLElement;
    expect(box.classList.contains('hand-cards')).toBe(true);
    expect(box.parentElement).toBe(zone);
    expect(box.getAttribute('data-highlight-variant')).toBe('attacker');
    expect(box.classList.contains('attacker-turn')).toBe(true);
    expect(zone.querySelectorAll('.hand-cards')).toHaveLength(1);
    expect(
      zone.querySelectorAll('.hand-cards, .attacker-turn, .defender-turn, .throw-in-turn'),
    ).toHaveLength(1);
    attacker.unmount();

    const thrower = render(
      <GameTable
        myId="p0"
        myHand={hand}
        opponents={activeOpponents}
        tablePairs={uncoveredPair}
        trumpSuit="clubs"
        attackerId="p1"
        defenderId="p2"
        boutPhase="Defense"
        canThrowIn
      />,
    );

    zone = handZoneOf(thrower.container);
    box = screen.getByTestId('hand-turn-highlight') as HTMLElement;
    expect(box.getAttribute('data-highlight-variant')).toBe('throw-in');
    expect(box.classList.contains('throw-in-turn')).toBe(true);
    expect(zone.querySelectorAll('.hand-cards')).toHaveLength(1);
    expect(
      zone.querySelectorAll('.hand-cards, .attacker-turn, .defender-turn, .throw-in-turn'),
    ).toHaveLength(1);

    // The attacker / throw-in glows are scoped to `.hand-cards` in both themes.
    for (const variant of ['attacker', 'throw-in']) {
      expect(
        cssRule(tableCss, `.hand-cards[data-highlighted='true'][data-highlight-variant='${variant}']`),
      ).not.toBe('');
      expect(
        cssRule(
          tableCss,
          `:root[data-theme='light'] .hand-cards[data-highlighted='true'][data-highlight-variant='${variant}']`,
        ),
      ).toContain('lightAttackerHandPulse');
    }
  });

  it('drops the glow after Surrender and leaves a single neutral wrapper', () => {
    const { container } = render(
      <GameTable
        myId="p0"
        myHand={hand}
        opponents={activeOpponents}
        tablePairs={uncoveredPair}
        trumpSuit="clubs"
        attackerId="p1"
        defenderId="p0"
        boutPhase="Defense"
        defending
        defenderDefenseless
        surrenderTriggered
        turnPlayerId="p0"
      />,
    );

    const zone = handZoneOf(container);
    const box = screen.getByTestId('hand-turn-highlight') as HTMLElement;
    for (const node of [zone, box]) {
      expect(node.getAttribute('data-highlighted')).toBe('false');
      expect(node.getAttribute('data-highlight-variant')).toBe('none');
      expect(node.getAttribute('data-surrendering')).toBe('true');
    }
    expect(box.classList.contains('defender-turn')).toBe(false);
    expect(box.classList.contains('attacker-turn')).toBe(false);
    expect(box.classList.contains('throw-in-turn')).toBe(false);
    // The wrapper is neutral in this state as well, so no second outline appears.
    expect(zone.querySelectorAll('.hand-cards, .attacker-turn, .defender-turn, .throw-in-turn')).toHaveLength(
      1,
    );
  });
});

/**
 * T-90 ITEM-1c: every gameplay feature owns a distinct family on the felt —
 * emerald for attack targets, violet for the `Perevod` reflection, gold for
 * trump indicators and crimson for uncovered attacks.
 */
describe('T-90 ITEM-1c: distinct gameplay feature colours', () => {
  it('paints attack target outlines emerald and the reflection outline violet', () => {
    const { container } = render(
      <GameTable
        myId="p0"
        myHand={hand}
        opponents={activeOpponents}
        tablePairs={uncoveredPair}
        trumpSuit="diamonds"
        defenderId="p1"
        canRedirect
      />,
    );

    // Violet reflection outline + its directional arrow, never the attack green.
    const outline = screen.getByTestId('redirect-outline');
    expect(outline.classList.contains('redirect-outline')).toBe(true);
    const arrow = outline.querySelector('svg') as SVGElement;
    expect(arrow.outerHTML).toContain('var(--redirect-accent');
    expect(arrow.outerHTML).not.toContain('var(--role-attacker-accent');
    expect(cssRule(tableCss, '.redirect-outline')).toContain('var(--redirect-border)');
    expect(cssRule(tableCss, '.redirect-outline')).toContain('var(--redirect-bg)');
    expect(tableCss).not.toMatch(/\n\.redirect-outline\s*{[^}]*var\(--role-attacker/);

    // The uncovered attack card on the felt pulses crimson.
    expect(container.querySelectorAll('.redirect-outline')).toHaveLength(1);
    expect(tableCss).toMatch(
      /:root\[data-theme='light'\] \.table-card-uncovered \.card-slot/,
    );
    expect(tableCss).toMatch(/@keyframes lightUncoveredPulse\s*{[\s\S]*?var\(--role-defender-glow\)/);
    expect(tableCss).toMatch(
      /:root:not\(\[data-theme='light'\]\) \.table-card-uncovered \.card-slot\s*{[^}]*turnPulse/,
    );
  });

  it('uses the emerald family for a legal attack target outline', () => {
    render(
      <GameTable
        myId="p0"
        myHand={hand}
        opponents={activeOpponents}
        tablePairs={[]}
        trumpSuit="diamonds"
        defenderId="p1"
        awaitingAttack
      />,
    );

    const target = screen.getByTestId('target-outline-p1');
    expect(target.classList.contains('target-outline')).toBe(true);
    expect(tableCss).toMatch(
      /\n\.target-outline\s*{[^}]*border: 2px dashed var\(--role-attacker-border\)[^}]*var\(--role-attacker-glow\)/,
    );
    expect(tableCss).not.toMatch(/\n\.target-outline\s*{[^}]*var\(--redirect-/);
  });

  it('marks a face-up trump card with the gold trump-card class', () => {
    const { container } = render(
      <GameTable
        myId="p0"
        myHand={[{ suit: 'diamonds', rank: 'seven' }]}
        opponents={opponents}
        tablePairs={[]}
        trumpSuit="diamonds"
        attackerId="p1"
        defenderId="p0"
      />,
    );

    const face = container.querySelector('.card-slot.trump .playing-card') as HTMLElement;
    expect(face).not.toBeNull();
    expect(face.classList.contains('trump-card')).toBe(true);
    expect(face.getAttribute('data-card-face')).not.toBeNull();

    expect(cssRule(tableCss, '.playing-card.trump-card')).toContain('var(--trump-border)');
    expect(cssRule(tableCss, '.card-slot.trump')).toContain('border: 1px solid var(--trump-accent)');
    expect(cssRule(tableCss, '.trump-badge')).toContain('var(--trump-accent)');
  });

  it('tags Pass and Surrender with their role classes and families', () => {
    render(<ActionBar legalActions={['pass', 'surrender']} onAction={() => {}} />);

    const pass = screen.getByTestId('pass-button');
    const surrender = screen.getByTestId('surrender-button');
    expect(pass.classList.contains('action-btn-pass')).toBe(true);
    expect(surrender.classList.contains('action-btn-surrender')).toBe(true);
    expect(pass.classList.contains('action-button')).toBe(true);
    expect(surrender.classList.contains('action-button')).toBe(true);

    expect(cssRule(tableCss, '.action-btn-pass')).toContain('var(--role-attacker-accent)');
    expect(cssRule(tableCss, '.action-btn-surrender')).toContain('var(--role-defender-accent)');
    expect(cssRule(tableCss, '.action-btn-pass')).not.toMatch(/#f59e0b|#ef4444/);
    expect(cssRule(tableCss, '.action-btn-surrender')).not.toMatch(/#f59e0b|#22c55e/);
  });

  it('defines all six non-overlapping families with the ticket values', () => {
    const dark = cssRule(tableCss, ':root');
    const light = cssRule(tableCss, ":root[data-theme='light']");
    for (const [rule, accent, bg] of [
      [dark, '--role-attacker-accent: #22c55e', '--role-attacker-bg: rgba(34, 197, 94, 0.14)'],
      [dark, '--role-defender-accent: #ef4444', '--role-defender-bg: rgba(239, 68, 68, 0.15)'],
      [dark, '--trump-accent: #f59e0b', '--trump-bg: rgba(245, 158, 11, 0.14)'],
      [dark, '--redirect-accent: #a855f7', '--redirect-bg: rgba(168, 85, 247, 0.14)'],
      [dark, '--clock-active-accent: #22d3ee', '--clock-active-bg: rgba(6, 182, 212, 0.12)'],
      [light, '--role-attacker-accent: #15803d', '--role-attacker-bg: rgba(21, 128, 61, 0.18)'],
      [light, '--role-defender-accent: #b91c1c', '--role-defender-bg: rgba(185, 28, 28, 0.18)'],
      [light, '--trump-accent: #b45309', '--trump-bg: rgba(180, 83, 9, 0.16)'],
      [light, '--redirect-accent: #7e22ce', '--redirect-bg: rgba(126, 34, 206, 0.15)'],
      [light, '--clock-active-accent: #0e7490', '--clock-active-bg: rgba(14, 116, 144, 0.14)'],
    ] as const) {
      expect(rule).toContain(accent);
      expect(rule).toContain(bg);
    }
    expect(dark).toContain('--clock-urgent-accent: #ea580c');
    expect(light).toContain('--clock-urgent-accent: #c2410c');
    expect(dark).toContain('--trump-glow: rgba(245, 158, 11, 0.42)');
    expect(dark).toContain('--clock-active-glow: rgba(6, 182, 212, 0.38)');
    expect(light).toContain('--redirect-border: rgba(126, 34, 206, 0.92)');
  });
});
