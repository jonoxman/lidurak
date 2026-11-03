import { describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, within } from '@testing-library/preact';
import {
  GameTable,
  defenderDoubleClickAction,
  redirectOnlyAction,
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
  sortHand,
  type OpponentSummary,
  type TablePairData,
} from '../components/GameTable';
import { ActionBar } from '../components/ActionBar';
import { DEFAULT_SETTINGS, setSettings } from '../state/settings';
import type { CardData } from '../components/Card';
import tableCss from '../styles/table.css?raw';

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
    expect(arena.style.getPropertyValue('--table-filter')).toBe(
      'brightness(1.4) contrast(1.1) hue-rotate(40deg)',
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

  it('marks the attacked defender hand differently from the attacker hand', () => {
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

    const cards = container.querySelector('.hand-cards') as HTMLElement;
    expect(cards.classList.contains('defender-turn')).toBe(true);
    expect(cards.classList.contains('attacker-turn')).toBe(false);

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
    expect(rule).toContain('border-radius: calc(var(--card-radius, 8px) + 4px)');
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

  it('ITEM-7b: draws every discard in one non-wrapping overlapping row', () => {
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
    const row = screen.getByTestId('discard-stack');
    expect(pile.contains(row)).toBe(true);
    expect(pile.getAttribute('aria-label')).toBe('Discard pile');

    const slots = Array.from(row.querySelectorAll('.discard-slot')) as HTMLElement[];
    expect(slots).toHaveLength(9);
    expect(slots[0].style.marginLeft).toBe('0px');
    for (const slot of slots.slice(1)) {
      expect(parseFloat(slot.style.marginLeft)).toBeLessThan(0);
      expect(slot.style.transform).toBe('');
    }

    // The row uses the hand geometry verbatim, card for card.
    const layout = handLayout(9, DISCARD_FALLBACK_WIDTH, 0.5, DECK_CARD_WIDTH);
    expect(Number(row.getAttribute('data-overlap'))).toBe(layout.overlap);
    expect(Number(row.getAttribute('data-hidden-left'))).toBe(layout.hiddenLeft);
    expect(Number(row.getAttribute('data-hidden-right'))).toBe(layout.hiddenRight);
    expect(Number(row.getAttribute('data-available-width'))).toBe(DISCARD_FALLBACK_WIDTH);
    expect(Number(row.getAttribute('data-card-width'))).toBe(DECK_CARD_WIDTH);

    // The box holds 8 deck-sized cards; the ninth stacks behind at full
    // overlap and is marked hidden, exactly like an overflowing hand.
    expect(layout.hiddenLeft + layout.hiddenRight).toBe(1);
    expect(row.querySelectorAll('.discard-slot[data-hidden="true"]')).toHaveLength(1);
    expect(rowWidth(layout, DECK_CARD_WIDTH)).toBeLessThanOrEqual(DISCARD_FALLBACK_WIDTH);

    const rule = cssRule('.discard-stack');
    expect(rule).toContain('flex-wrap: nowrap');
    expect(rule).toContain('overflow: hidden');
    expect(rule).toContain('max-width: 100%');
    expect(rule).toContain('min-width: 0');
    expect(rule).toContain('box-sizing: border-box');
    expect(cssRule('.table-discard')).toContain('overflow: hidden');

    // Earlier bouts face-down, the last bout face-up, all in the same row.
    expect(row.querySelectorAll('.discard-slot[data-face="down"]')).toHaveLength(7);
    expect(row.querySelectorAll('.discard-slot[data-face="up"]')).toHaveLength(2);
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

    const row = screen.getByTestId('discard-stack');
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
    expect(groupRule).toContain('align-items: flex-start');
    expect(groupRule).toContain('--bout-card-width: 80px');
    expect(groupRule).toContain('--bout-card-height: 114px');
    expect(groupRule).toContain('--bout-card-offset: 15px');

    const pairRule = cssRule('.table-pair');
    expect(pairRule).toContain('grid-template-rows: var(--bout-card-height, 114px)');
    expect(pairRule).toContain('align-content: start');
    expect(pairRule).toContain('padding: 0 20px var(--bout-card-offset, 15px) 0');
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
