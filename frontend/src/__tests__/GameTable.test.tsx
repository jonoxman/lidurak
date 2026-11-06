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
  HAND_CARD_HEIGHT,
  HAND_CONTOUR_PADDING,
  HAND_FALLBACK_WIDTH,
  HAND_CARD_WIDTH,
  HAND_MAX_OVERLAP,
  HAND_MAX_OVERLAP_RATIO,
  HAND_MIN_OVERLAP,
  HAND_MIN_OVERLAP_RATIO,
  HAND_MIN_VISIBLE_LEFT,
  HAND_RAISED_OFFSET,
  MOBILE_BREAKPOINT_PX,
  MOBILE_CARD_HEIGHT,
  MOBILE_CARD_WIDTH,
  cardSizeForViewport,
  clampBoutCardSize,
  LOW_DETAIL_CARD_WIDTH,
  OPPONENT_CARD_WIDTH,
  OPPONENT_MIN_OVERLAP,
  SEAT_BOX,
  TableDeck,
  assignSeats,
  clockwiseOffset,
  discardLayout,
  handLayout,
  handMargins,
  opponentOverlap,
  rowWidth,
  seatForOffset,
  canonicalSeatOrder,
  MIN_VISIBLE_CARD_LEFT_PX,
  MIN_VISIBLE_STRIP_PX,
  BOUT_CARD_HEIGHT,
  BOUT_CARD_WIDTH,
  BOUT_MIN_VISIBLE_LEFT,
  CARD_HEIGHT,
  CARD_WIDTH,
  sortHand,
  type OpponentSummary,
  type TablePairData,
} from '../components/GameTable';
import { ActionBar } from '../components/ActionBar';
import { DEFAULT_SETTINGS, setSettings } from '../state/settings';
import type { CardData } from '../components/Card';
import tableCss from '../styles/table.css?raw';
import appCss from '../app.css?raw';

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
  it('gives trump cards the gilded border and no corner badge', () => {
    renderSortableTable();

    const hand = screen.getByLabelText('Your hand');
    const trumps = Array.from(hand.querySelectorAll('.card-slot.trump'));
    expect(trumps).toHaveLength(1);
    expect(trumps[0].getAttribute('data-suit')).toBe('spades');
    expect(trumps[0].getAttribute('data-trump')).toBe('true');
    // T-90-2 ITEM-12: only the gilded border marks a trump; the corner badges
    // (circles + extra suit symbols) are gone from every card.
    expect(trumps[0].querySelector('.playing-card')!.classList.contains('trump-card')).toBe(true);
    expect(hand.querySelectorAll('[data-testid="trump-marker"]')).toHaveLength(0);
    expect(hand.querySelectorAll('[data-testid="trump-badge-top-right"]')).toHaveLength(0);
    expect(hand.querySelectorAll('[data-testid="trump-badge-bottom-left"]')).toHaveLength(0);
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

  it('keeps a hand that fits at the 20% minimum overlap', () => {
    const layout = handLayout(4, 720);

    expect(layout.hiddenLeft + layout.hiddenRight).toBe(0);
    expect(layout.overlapRatio).toBeCloseTo(HAND_MIN_OVERLAP_RATIO, 5);
    expect(layout.overlap).toBe(HAND_MIN_OVERLAP);
    expect(handMargins(layout, 4)[1]).toBe(-HAND_MIN_OVERLAP);
  });

  it('clamps the overlap into the 20%-80% band on a normal hand', () => {
    const layout = handLayout(12, 500);

    expect(layout.hiddenLeft + layout.hiddenRight).toBe(0);
    expect(layout.overlapRatio).toBeGreaterThanOrEqual(HAND_MIN_OVERLAP_RATIO - 1e-9);
    expect(layout.overlapRatio).toBeLessThanOrEqual(HAND_MAX_OVERLAP_RATIO + 1e-9);
    // The top-left rank/suit index stays visible at the maximum overlap.
    expect(HAND_CARD_WIDTH - layout.overlap).toBeGreaterThanOrEqual(20);
    expect(layout.totalWidth).toBeLessThanOrEqual(500 + 1e-9);
  });

  it('keeps a picked-up full deck on screen at the 15px readable strip', () => {
    const layout = handLayout(36, 300);

    // Every card stays in the row: nothing is hidden or stacked.
    expect(layout.hiddenLeft + layout.hiddenRight).toBe(0);
    expect(layout.visibleCount).toBe(36);
    expect(layout.stride).toBeGreaterThanOrEqual(HAND_MIN_VISIBLE_LEFT - 1e-9);
    // The row is scaled so it can never leave the hand column.
    expect(layout.totalWidth * layout.scale).toBeLessThanOrEqual(300 + 1e-9);
  });

  it('renders every picked-up card in one row without hiding any', () => {
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
    expect(row.querySelectorAll('.hand-slot[data-hidden="true"]')).toHaveLength(0);
    expect(Number(row.getAttribute('data-overlap'))).toBeGreaterThanOrEqual(HAND_MIN_OVERLAP);
    expect(Number(row.getAttribute('data-hand-width'))).toBeLessThanOrEqual(720);
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
    const slots = Array.from(
      highlight.querySelectorAll('.hand-card-wrapper'),
    ) as HTMLElement[];
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

  it('keeps every card of a 40-card hand in one compact, visible row', () => {
    const ranks = ['six', 'seven', 'eight', 'nine', 'ten', 'jack', 'queen', 'king', 'ace'];
    const suits = ['spades', 'hearts', 'clubs', 'diamonds'];
    const bigHand: CardData[] = Array.from({ length: 40 }, (_, index) => ({
      suit: suits[index % suits.length],
      rank: ranks[index % ranks.length],
    }));

    renderSortableTable({ myHand: bigHand });

    const highlight = screen.getByTestId('hand-turn-highlight') as HTMLElement;
    const slots = Array.from(
      highlight.querySelectorAll('.hand-card-wrapper'),
    ) as HTMLElement[];
    expect(slots).toHaveLength(bigHand.length);
    expect(highlight.querySelectorAll('.hand-slot[data-hidden="true"]')).toHaveLength(0);
    expect(slots[0].style.marginLeft).toBe('0px');
    for (const slot of slots) expect(slot.style.transform).toBe('');
    // Every neighbour overlaps by at least the 20px left strip.
    for (const slot of slots.slice(1)) {
      expect(-parseFloat(slot.style.marginLeft)).toBeGreaterThanOrEqual(HAND_MIN_OVERLAP);
    }
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
    // ITEM-6/7 (review round 1): the number lives in `data-countdown` and is
    // painted by CSS, so the icon button never carries visible text.
    expect(pass.getAttribute('data-countdown')).toBe('12');
    expect(pass.textContent).toBe('');
    expect(pass.closest('button')?.textContent).toBe('');
    expect(pass.closest('button')?.getAttribute('aria-label')).toBe('Pass');
    expect(pass.closest('button')?.querySelector('[data-testid="pass-icon"]')).not.toBeNull();
    const surrenderBadge = screen.getByTestId('surrender-countdown');
    expect(surrenderBadge.getAttribute('data-countdown')).toBe('3');
    expect(surrenderBadge.textContent).toBe('');
    expect(surrenderBadge.closest('button')?.textContent).toBe('');
    expect(tableCss).toContain('content: attr(data-countdown)');
  });

  it('leaves the pass button bare without a countdown', () => {
    render(
      <ActionBar legalActions={['pass']} onAction={() => {}} passCountdownSeconds={0} />,
    );

    expect(screen.queryByTestId('pass-countdown')).toBeNull();
    expect(screen.getByRole('button', { name: 'Pass' })).toBeTruthy();
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
    expect(screen.queryByRole('button', { name: 'Pass' })).toBeNull();
    expect(screen.queryByRole('button', { name: 'Surrender' })).toBeNull();
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

    const slots = Array.from(
      highlight.querySelectorAll('.hand-card-wrapper'),
    ) as HTMLElement[];
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
    expect(rule).toContain('padding: 0;');
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

    const slots = Array.from(
      highlight.querySelectorAll('.hand-card-wrapper'),
    ) as HTMLElement[];
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
    const layout = discardLayout(2, visibleAvailable, 0.5, DECK_CARD_WIDTH);
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
        const layout = discardLayout(count, available, 0.5, DECK_CARD_WIDTH);
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
    expect(groupRule).toContain('--bout-card-width: 100px');
    expect(groupRule).toContain('--bout-card-height: 140px');
    expect(groupRule).toContain('--bout-card-offset: 18px');

    const pairRule = cssRule('.table-pair');
    expect(pairRule).toContain('grid-template-rows: var(--bout-card-height, 140px)');
    expect(pairRule).toContain('align-content: start');
    expect(pairRule).toContain('padding: 0 0 var(--bout-card-offset, 18px) 0');
    expect(pairRule).toContain('box-sizing: border-box');

    const outlineRule = cssRule('.redirect-outline');
    expect(outlineRule).toContain('height: var(--bout-card-height, 140px)');
    expect(outlineRule).toContain('width: var(--bout-card-width, 100px)');
    expect(outlineRule).toContain('align-self: flex-start');
    expect(outlineRule).toContain('box-sizing: border-box');
    expect(outlineRule).toContain('margin: 0 0 var(--bout-card-offset, 18px) 0');
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

  it('ITEM-PB-3/ITEM-2: the contour wraps the raised cards without lifting the box', () => {
    // T-90-feedback-2 ITEM-2 supersedes the old translate-the-whole-box rule.
    expect(tableCss).not.toMatch(
      /\.hand-cards\[data-all-legal='true'\]\[data-active='true'\]\s*{[^}]*transform: translateY/,
    );

    renderSortableTable({ awaitingAttack: true, playableKeys: sortableHand.map(cardKey) });
    const highlight = screen.getByTestId('hand-turn-highlight') as HTMLElement;
    const contour = screen.getByTestId('hand-highlight-contour');
    // All three cards are raised, so the contour still hugs the same row width.
    expect(contour.getAttribute('data-non-rectangular')).toBe('false');
    expect(Number(contour.getAttribute('data-contour-width'))).toBe(
      Number(highlight.getAttribute('data-hand-width')),
    );
    for (const slot of Array.from(
      highlight.querySelectorAll('.hand-card-wrapper'),
    ) as HTMLElement[]) {
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
    expect(screen.queryByRole('button', { name: 'Pass' })).toBeNull();
    expect(screen.queryByRole('button', { name: 'Surrender' })).toBeNull();

    const highlight = screen.getByTestId('hand-turn-highlight');
    expect(highlight.getAttribute('data-active')).toBe('false');
    expect(highlight.getAttribute('data-all-legal')).toBe('false');
    expect(container.querySelectorAll('.card-slot[data-playable="true"]')).toHaveLength(0);
  });

  it('ITEM-ADD-9: hides Surrender and Pass in ActionBar for a bot seat', () => {
    render(
      <ActionBar legalActions={['pass', 'surrender']} onAction={() => {}} isBotSeat />,
    );

    expect(screen.queryByRole('button', { name: 'Pass' })).toBeNull();
    expect(screen.queryByRole('button', { name: 'Surrender' })).toBeNull();
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
    // ITEM-13: the plate radius scales with the 100px-wide card.
    expect(Number(plate!.getAttribute('rx'))).toBe(11);
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
        /@keyframes lightAttackerHandPulse\s*{[\s\S]*?50%\s*{[\s\S]*?0 0 10px 2px var\(--role-attacker-glow\)[\s\S]*?inset 0 0 7px var\(--role-attacker-bg\)/,
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
        /@keyframes lightDefenderHandPulse\s*{[\s\S]*?0 0 11px 3px var\(--role-defender-glow\)[\s\S]*?inset 0 0 7px var\(--role-defender-bg\)/
      );
      // Dark mode keeps its crimson keyframe with the softer spread.
      expect(tableCss).toMatch(
        /@keyframes defenderHandPulse\s*{[\s\S]*?box-shadow: 0 0 12px 3px var\(--defender-hand-glow\)/,
      );
    });

    it('darkens trump cards and uncovered attacking cards in the light theme', () => {
      // ITEM-12a: trump cards keep their gold badge/border but no glowing aura.
      const trump = cssRule(tableCss, ":root[data-theme='light'] .card-slot.trump");
      expect(trump).toContain('border-color: var(--trump-accent)');
      expect(trump).toContain('box-shadow: none');
      expect(tableCss).toMatch(
        /\n\.card-slot\.trump\s*{[^}]*border: 1px solid var\(--trump-accent\);[^}]*box-shadow: none/,
      );

      const uncovered = cssRule(
        tableCss,
        ":root[data-theme='light'] .table-pair.turn-pulse .card-slot",
      );
      expect(uncovered).toContain('lightUncoveredPulse');
      expect(tableCss).toMatch(
        /@keyframes lightUncoveredPulse\s*{[\s\S]*?0 0 10px 3px var\(--role-defender-glow\)/
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
    expect(rule).toContain('padding: 0;');
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

    expect(cssRule(tableCss, '.playing-card.trump-card')).toContain(
      'var(--trump-border, #f59e0b)',
    );
    expect(cssRule(tableCss, '.card-slot.trump')).toContain('border: 1px solid var(--trump-accent)');
    expect(cssRule(tableCss, '.trump-badge')).toContain('var(--trump-accent)');
  });

  it('tags Pass and Surrender with their role classes and families', () => {
    render(<ActionBar legalActions={['pass', 'surrender']} onAction={() => {}} />);

    const pass = screen.getByTestId('pass-btn');
    const surrender = screen.getByTestId('surrender-btn');
    expect(pass.classList.contains('action-btn-pass')).toBe(true);
    expect(surrender.classList.contains('action-btn-surrender')).toBe(true);
    expect(pass.classList.contains('action-button')).toBe(true);
    expect(surrender.classList.contains('action-button')).toBe(true);

    expect(cssRule(tableCss, '.action-btn-pass')).toContain('var(--role-attacker-accent)');
    expect(cssRule(tableCss, '.action-btn-surrender')).toContain('var(--role-defender-accent)');
    expect(cssRule(tableCss, '.action-btn-pass')).not.toMatch(/#f59e0b|#ef4444/);
    expect(cssRule(tableCss, '.action-btn-surrender')).not.toMatch(/#f59e0b|#22c55e/);
  });

  /** T-90-feedback-20261105_221105-3 ITEM-6/7: no word on the button, only a
   *  theme-matched glyph that still names itself for assistive tech. */
  it('ITEM-6/7: renders icon-only Surrender and Pass buttons with no visible text', () => {
    render(<ActionBar legalActions={['pass', 'surrender']} onAction={() => {}} />);

    const surrender = screen.getByTestId('surrender-btn');
    const pass = screen.getByTestId('pass-btn');
    for (const [button, label, iconId] of [
      [surrender, 'Surrender', 'surrender-icon'],
      [pass, 'Pass', 'pass-icon'],
    ] as const) {
      expect(button.tagName).toBe('BUTTON');
      expect(button.textContent).toBe('');
      expect(button.getAttribute('aria-label')).toBe(label);
      expect(button.getAttribute('title')).toBe(label);
      expect(button.classList.contains('action-icon-btn')).toBe(true);
      expect(within(button).getByTestId(iconId)).toBeTruthy();
    }

    const surrenderIcon = within(surrender).getByTestId('surrender-icon');
    expect(surrenderIcon.querySelector('[data-icon-part="cards"]')).not.toBeNull();
    expect(surrenderIcon.querySelector('[data-icon-part="arrow-down"]')).not.toBeNull();
    expect(surrenderIcon.querySelector('[data-icon-part="raised-hands"]')).not.toBeNull();
    const passIcon = within(pass).getByTestId('pass-icon');
    expect(passIcon.querySelector('[data-icon-part="cards"]')).not.toBeNull();
    expect(passIcon.querySelector('[data-icon-part="pass-hand"]')).not.toBeNull();
    expect(passIcon.querySelector('[data-icon-part="arrow-pass"]')).not.toBeNull();

    expect(tableCss).toMatch(
      /\.action-button\.action-icon-btn \{[^}]*width: 44px;[^}]*height: 44px;/,
    );
    expect(tableCss).toMatch(
      /@media \(max-width: 900px\) \{[\s\S]*?\.action-button\.action-icon-btn[^{]*\{[^}]*width: 36px;[^}]*height: 36px;/,
    );
    expect(tableCss).toMatch(/background: var\(--bg-elevated, rgba\(24, 34, 29, 0\.85\)\)/);
    expect(tableCss).toMatch(/border: 1px solid var\(--border-subtle, rgba\(255, 255, 255, 0\.18\)\)/);
    expect(tableCss).toMatch(/border-radius: var\(--ui-radius, 10px\)/);
    expect(tableCss).toMatch(/backdrop-filter: blur\(6px\)/);
    // ITEM-6/7 (review round 2): the digit must not inherit the button's
    // `font-size: 0; line-height: 0`, or the countdown is drawn at 0px.
    expect(tableCss).toMatch(
      /\.action-button\.action-icon-btn \.surrender-countdown \{[^}]*font-size: 11px;[^}]*line-height: 1;/,
    );
    // The hand glyphs are outlined palms with fingers and a thumb, not comb
    // strokes: two palms + fingers + thumb per raised hand, one waving hand.
    expect(surrenderIcon.querySelectorAll('[data-icon-part="raised-hands"] path')).toHaveLength(6);
    expect(passIcon.querySelectorAll('[data-icon-part="pass-hand"] path')).toHaveLength(3);
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
      [light, '--role-attacker-accent: #46a76f', '--role-attacker-bg: rgba(70, 167, 111, 0.1)'],
      [light, '--role-defender-accent: #dc6868', '--role-defender-bg: rgba(220, 104, 104, 0.11)'],
      [light, '--trump-accent: #d4943a', '--trump-bg: rgba(212, 148, 58, 0.1)'],
      [light, '--redirect-accent: #a375e6', '--redirect-bg: rgba(163, 117, 230, 0.1)'],
      [light, '--clock-active-accent: #0e7490', '--clock-active-bg: rgba(14, 116, 144, 0.14)'],
    ] as const) {
      expect(rule).toContain(accent);
      expect(rule).toContain(bg);
    }
    expect(dark).toContain('--clock-urgent-accent: #ea580c');
    expect(light).toContain('--clock-urgent-accent: #e27c43');
    expect(dark).toContain('--trump-glow: rgba(245, 158, 11, 0.42)');
    expect(dark).toContain('--clock-active-glow: rgba(6, 182, 212, 0.38)');
    expect(light).toContain('--redirect-border: rgba(163, 117, 230, 0.62)');
  });
});

describe('T-90-4: larger cards, aura containment, throw-in slot, hand reorder and Transparent Mode', () => {
  const fourPlayerOpponents: OpponentSummary[] = [
    { id: 'p1', name: 'Bob', cardCount: 2, hasPassed: false, finishRank: null },
    { id: 'p2', name: 'Carol', cardCount: 4, hasPassed: false, finishRank: null },
    { id: 'p3', name: 'Dave', cardCount: 6, hasPassed: false, finishRank: null },
  ];

  it('ITEM-13: uses 100x140 cards in the hand and in the play area', () => {
    expect(CARD_WIDTH).toBe(100);
    expect(CARD_HEIGHT).toBe(140);
    expect(HAND_CARD_WIDTH).toBe(CARD_WIDTH);
    expect(HAND_CARD_HEIGHT).toBe(CARD_HEIGHT);
    expect(BOUT_CARD_WIDTH).toBe(CARD_WIDTH);
    expect(BOUT_CARD_HEIGHT).toBe(CARD_HEIGHT);
    expect(cssRule(tableCss, '.hand-slot')).toContain('var(--hand-card-width, 100px)');
    expect(cssRule(tableCss, '.hand-slot')).toContain('var(--hand-card-height, 140px)');
    expect(tableCss).toMatch(
      /\.hand-card-wrapper\s*{[^}]*width: var\(--hand-card-width, 100px\);[^}]*height: var\(--hand-card-height, 140px\);/,
    );
    expect(MIN_VISIBLE_CARD_LEFT_PX).toBe(22);
    expect(tableCss).toMatch(/\.target-outline\s*{[^}]*width: 100px;[^}]*height: 140px;/);
    expect(tableCss).toMatch(
      /\.table-card-base,\s*\.table-card-cover,\s*\.drag-ghost\s*{[^}]*width: var\(--bout-card-width, 100px\);[^}]*height: var\(--bout-card-height, 140px\);/,
    );
  });

  it('ITEM-13: marks the attack and cover cards as base/cover card boxes', () => {
    const { container } = renderTable();
    expect(
      container.querySelector('.table-pair-attack')?.classList.contains('table-card-base'),
    ).toBe(true);
    expect(
      container.querySelector('.table-pair-defense')?.classList.contains('table-card-cover'),
    ).toBe(true);
  });

  it('ITEM-1: keeps the full aura inside the felt in 4-player mode', () => {
    const { container } = render(
      <GameTable
        myId="p0"
        myHand={hand}
        opponents={fourPlayerOpponents}
        tablePairs={[]}
        trumpSuit="diamonds"
        attackerId="p0"
        defenderId="p1"
      />,
    );

    const arena = container.querySelector('[data-zone="table-arena"]') as HTMLElement;
    expect(arena.getAttribute('data-aura-contained')).toBe('true');
    expect(container.querySelectorAll('.opponent-seat')).toHaveLength(3);

    // T-90-2 ITEM-1a: every seat carries its bout role, and the seat box paints
    // an aura whose radii scale with the Glow slider.
    const seats = Array.from(container.querySelectorAll('.opponent-seat')) as HTMLElement[];
    const defenderSeat = screen
      .getByTestId('seat-clock-p1')
      .closest('.opponent-seat') as HTMLElement;
    expect(defenderSeat.getAttribute('data-role')).toBe('defender');
    expect(seats.filter((seat) => seat.getAttribute('data-role') !== 'none')).toHaveLength(1);
    expect(cssRule(tableCss, ".opponent-seat[data-role='attacker'] .seat-box")).toContain(
      'var(--highlight-intensity-scale, 1)',
    );
    expect(cssRule(tableCss, ".opponent-seat[data-role='attacker'] .seat-box")).toContain(
      'var(--role-attacker-glow)',
    );
    expect(cssRule(tableCss, ".opponent-seat[data-role='defender'] .seat-box")).toContain(
      'var(--role-defender-border)',
    );

    const arenaRule = cssRule(tableCss, "[data-zone='table-arena']");
    expect(arenaRule).toContain('padding: 24px 28px 28px 28px');
    expect(cssRule(tableCss, '.battlefield-tinted-box')).toContain('clamp(240px, 30vh, 320px)');
    expect(
      cssRule(tableCss, "[data-zone='table-arena'][data-aura-contained='true'] .opponent-seat"),
    ).toContain('margin-inline: 4px');
  });

  it('ITEM-8: renders the dedicated throw-in outline as the only throw-in drop zone', () => {
    const onThrowInDrop = vi.fn();
    const { container } = render(
      <GameTable
        myId="p0"
        myHand={hand}
        opponents={[fourPlayerOpponents[0]]}
        tablePairs={[{ attack: { suit: 'spades', rank: 'six' }, defense: null }]}
        trumpSuit="diamonds"
        attackerId="p1"
        defenderId="p1"
        canThrowIn
        onThrowInDrop={onThrowInDrop}
      />,
    );

    const outline = screen.getByTestId('throw-in-outline');
    expect(outline.classList.contains('target-outline')).toBe(true);
    expect(outline.getAttribute('data-drop-zone')).toBe('throw-in');
    expect(outline.closest('.table-pairs-group')).not.toBeNull();
    // The generic "drop anywhere on the battlefield" fallback is gone.
    expect(container.querySelector('.bout-area')?.hasAttribute('data-drop-zone')).toBe(false);

    fireEvent.dragStart(screen.getByLabelText('king of clubs'), {
      dataTransfer: { setData: vi.fn() },
    });
    fireEvent.drop(outline, { dataTransfer: { getData: () => '' } });
    expect(onThrowInDrop).toHaveBeenCalledWith({ suit: 'clubs', rank: 'king' });
  });

  it('ITEM-1a/ITEM-8: hides the throw-in outline without any legal throw-in card', () => {
    const pending = render(
      <GameTable
        myId="p0"
        myHand={hand}
        opponents={[fourPlayerOpponents[0]]}
        tablePairs={[{ attack: { suit: 'spades', rank: 'six' }, defense: null }]}
        trumpSuit="diamonds"
        attackerId="p1"
        defenderId="p1"
      />,
    );

    // T-90-feedback-20261105_221105-3 ITEM-1a: no legal throw-in, no outline.
    expect(screen.queryByTestId('throw-in-outline')).toBeNull();
    expect(screen.queryByTestId('throw-in-slot')).toBeNull();
    pending.unmount();

    // The moment the seat can legally play into it, the outline is back.
    render(
      <GameTable
        myId="p0"
        myHand={hand}
        opponents={[fourPlayerOpponents[0]]}
        tablePairs={[{ attack: { suit: 'spades', rank: 'six' }, defense: null }]}
        trumpSuit="diamonds"
        attackerId="p1"
        defenderId="p1"
        canThrowIn
        throwInVisible
      />,
    );

    const outline = screen.getByTestId('throw-in-outline');
    expect(outline.getAttribute('data-throw-in-enabled')).toBe('true');
    expect(outline.getAttribute('data-drop-zone')).toBe('throw-in');
  });

  it('ITEM-6a: parts the hand and reports the reordered sequence', () => {
    const onReorderHand = vi.fn();
    render(
      <GameTable
        myId="p0"
        myHand={hand}
        opponents={[fourPlayerOpponents[0]]}
        tablePairs={[]}
        trumpSuit="diamonds"
        defenderId="p1"
        onReorderHand={onReorderHand}
      />,
    );

    const handBox = screen.getByTestId('hand-turn-highlight');
    vi.spyOn(handBox, 'getBoundingClientRect').mockReturnValue({
      left: 0,
      top: 0,
      right: 300,
      bottom: 140,
      width: 300,
      height: 140,
      x: 0,
      y: 0,
      toJSON: () => ({}),
    } as DOMRect);

    fireEvent.dragStart(screen.getByLabelText('six of spades'), {
      dataTransfer: { setData: vi.fn() },
    });
    // The whole page carries the link pointer for the duration of the drag.
    expect(document.body.getAttribute('data-dragging')).toBe('true');

    fireEvent(
      handBox,
      new MouseEvent('dragover', { bubbles: true, cancelable: true, clientX: 300 }),
    );
    expect(handBox.getAttribute('data-reorder-target-index')).toBe('2');
    const wrappers = Array.from(
      handBox.querySelectorAll('.hand-card-wrapper'),
    ) as HTMLElement[];
    // T-90-2 ITEM-6: the original slot collapses first, so the remaining cards
    // close the gap as if the card had been removed from the hand entirely.
    expect(handBox.getAttribute('data-gap-closed')).toBe('true');
    expect(wrappers[0].getAttribute('data-collapsed')).toBe('true');
    expect(wrappers[0].style.marginLeft).toBe('0px');
    // The dragged card itself stays under the cursor; every other card left of
    // the insertion slot parts to the left.
    expect(wrappers.map((node) => node.getAttribute('data-part-direction'))).toEqual([
      null,
      'left',
      'left',
    ]);

    fireEvent.drop(handBox, { clientX: 300, dataTransfer: { getData: () => '' } });
    expect(onReorderHand).toHaveBeenCalledWith([
      { suit: 'clubs', rank: 'king' },
      { suit: 'hearts', rank: 'ace' },
      { suit: 'spades', rank: 'six' },
    ]);
  });

  it('ITEM-6a/7: pointer drag reorders any hand card even when it is not the turn', () => {
    const onReorderHand = vi.fn();
    render(
      <GameTable
        myId="p0"
        myHand={hand}
        opponents={[fourPlayerOpponents[0]]}
        tablePairs={[]}
        trumpSuit="diamonds"
        defenderId="p1"
        onReorderHand={onReorderHand}
      />,
    );

    const handBox = screen.getByTestId('hand-turn-highlight');
    vi.spyOn(handBox, 'getBoundingClientRect').mockReturnValue({
      left: 0,
      top: 0,
      right: 300,
      bottom: 140,
      width: 300,
      height: 140,
      x: 0,
      y: 0,
      toJSON: () => ({}),
    } as DOMRect);

    // No awaitingAttack/playableKeys here: the hand is not playable, yet a
    // plain mouse drag must still part the row and reorder on release.
    fireEvent.mouseDown(screen.getByLabelText('six of spades'), {
      button: 0,
      clientX: 10,
      clientY: 20,
    });
    fireEvent.mouseMove(document, { clientX: 120, clientY: 22 });
    expect(document.body.getAttribute('data-dragging')).toBe('true');
    // Insertion slot 1: card 1 is left of the slot, card 2 is right of it.
    expect(handBox.getAttribute('data-reorder-target-index')).toBe('1');
    expect(
      Array.from(handBox.querySelectorAll('.hand-card-wrapper')).map((node) =>
        node.getAttribute('data-part-direction'),
      ),
    ).toEqual([null, 'left', 'right']);

    fireEvent.mouseMove(document, { clientX: 300, clientY: 22 });
    expect(handBox.getAttribute('data-reorder-target-index')).toBe('2');
    expect(
      Array.from(handBox.querySelectorAll('.hand-card-wrapper')).map((node) =>
        node.getAttribute('data-part-direction'),
      ),
    ).toEqual([null, 'left', 'left']);

    fireEvent.mouseUp(document, { clientX: 300, clientY: 22 });
    expect(onReorderHand).toHaveBeenCalledWith([
      { suit: 'clubs', rank: 'king' },
      { suit: 'hearts', rank: 'ace' },
      { suit: 'spades', rank: 'six' },
    ]);
    expect(document.body.hasAttribute('data-dragging')).toBe(false);
  });

  it('ITEM-10b: renders low-detail opponent cards with symmetrical trump badges', () => {
    render(
      <GameTable
        myId="p0"
        myHand={hand}
        opponents={[
          {
            id: 'p1',
            name: 'Bob',
            cardCount: 3,
            hasPassed: false,
            finishRank: null,
            cards: [
              { suit: 'diamonds', rank: 'ace' },
              { suit: 'spades', rank: 'king' },
              { suit: 'hearts', rank: 'ten' },
            ],
          },
        ]}
        tablePairs={[]}
        trumpSuit="diamonds"
        defenderId="p1"
        transparentMode
      />,
    );

    const cards = screen.getAllByTestId('opponent-low-detail-card');
    expect(cards).toHaveLength(3);
    expect(cards.every((card) => card.classList.contains('opponent-low-detail-card'))).toBe(true);
    expect(screen.getAllByTestId('low-detail-rank').map((node) => node.textContent)).toEqual([
      'A',
      'K',
      '10',
    ]);
    expect(screen.getAllByTestId('low-detail-suit')).toHaveLength(3);
    // T-90-2 ITEM-10: the trump Ace carries only the gilded border — no corner
    // highlight icons — while the off-suit cards stay plain.
    expect(screen.queryAllByTestId('low-detail-trump-top-right')).toHaveLength(0);
    expect(screen.queryAllByTestId('low-detail-trump-bottom-left')).toHaveLength(0);
    const trumps = cards.filter((card) => card.getAttribute('data-trump') === 'true');
    expect(trumps).toHaveLength(1);
    expect(trumps[0].classList.contains('trump-card')).toBe(true);
    expect(trumps[0].classList.contains('low-detail-trump')).toBe(true);
    expect(cssRule(tableCss, '.opponent-low-detail-card.trump-card')).toContain(
      'var(--trump-border, #f59e0b)',
    );
    expect(cssRule(tableCss, '.opponent-low-detail-card.trump-card')).toContain(
      'box-shadow: none',
    );
    expect(screen.getByTestId('opponent-card-count-p1').textContent).toBe('3');
    // Face-down backs are gone while the hand is revealed.
    expect(document.querySelectorAll('.opponent-card')).toHaveLength(0);
  });
});

/**
 * T-90 feedback batch `20261104_195410-2`: items #6, #7, #8, #13a/b/c and #15.
 * These cover the live wiring, not just the helper functions.
 */
describe('T-90-feedback-20261104_195410-2: drag animation, pointer cursor, throw-in outline, overlap and glows', () => {
  const bobSeat: OpponentSummary[] = [
    { id: 'p1', name: 'Bob', cardCount: 6, hasPassed: false, finishRank: null },
  ];

  const fakeRect = (width: number): DOMRect =>
    ({
      left: 0,
      top: 0,
      right: width,
      bottom: 140,
      width,
      height: 140,
      x: 0,
      y: 0,
      toJSON: () => ({}),
    }) as DOMRect;

  const renderDragHand = (onReorderHand = vi.fn()) => {
    const view = render(
      <GameTable
        myId="p0"
        myHand={hand}
        opponents={bobSeat}
        tablePairs={[]}
        trumpSuit="diamonds"
        defenderId="p1"
        onReorderHand={onReorderHand}
      />,
    );
    const box = screen.getByTestId('hand-turn-highlight') as HTMLElement;
    vi.spyOn(box, 'getBoundingClientRect').mockReturnValue(fakeRect(300));
    return { ...view, box, onReorderHand };
  };

  it('ITEM-6: closes the original gap first and reports "none" once the pointer leaves the hand', () => {
    const { box } = renderDragHand();

    fireEvent.mouseDown(screen.getByLabelText('six of spades'), {
      button: 0,
      clientX: 10,
      clientY: 20,
    });
    fireEvent.mouseMove(document, { clientX: 120, clientY: 22 });
    // Stage 1: the dragged card's own slot is gone and the row is compacted.
    expect(box.getAttribute('data-gap-closed')).toBe('true');
    expect(box.getAttribute('data-reorder-target-index')).toBe('1');

    // Stage 2: parted at the insertion slot.
    expect(
      Array.from(box.querySelectorAll('.hand-card-wrapper')).map((node) =>
        node.getAttribute('data-part-direction'),
      ),
    ).toEqual([null, 'left', 'right']);

    // Off the hand and onto the felt: still closed, with no insertion gap.
    fireEvent.mouseMove(document, { clientX: 400, clientY: 900 });
    expect(box.getAttribute('data-reorder-target-index')).toBeNull();
    const wrappers = Array.from(box.querySelectorAll('.hand-card-wrapper')) as HTMLElement[];
    expect(wrappers[0].getAttribute('data-collapsed')).toBe('true');
    expect(wrappers.slice(1).map((node) => node.getAttribute('data-part-direction'))).toEqual([
      'none',
      'none',
    ]);
    fireEvent.mouseUp(document, { clientX: 400, clientY: 900 });
    expect(box.getAttribute('data-gap-closed')).toBe('false');
  });

  it('ITEM-7: keeps data-dragging on html+body and never starts a native drag', () => {
    const { box } = renderDragHand();
    const labeled = screen.getByLabelText('six of spades');
    const slot = labeled.closest('.card-slot') as HTMLElement;
    const wrapper = labeled.closest('.hand-card-wrapper') as HTMLElement;

    // `fireEvent` returns false when the handler called `preventDefault()`.
    expect(fireEvent.dragStart(slot, { dataTransfer: { setData: vi.fn() } })).toBe(false);
    expect(document.documentElement.getAttribute('data-dragging')).toBe('true');
    expect(document.body.getAttribute('data-dragging')).toBe('true');
    expect(box.closest('[data-zone="table-arena"]')?.getAttribute('data-dragging')).toBe('true');

    // No element of the hand card can be grabbed by the native HTML5 drag.
    expect(wrapper.draggable).toBe(false);
    expect(slot.draggable).toBe(false);
    expect(fireEvent.dragStart(labeled)).toBe(false);

    // Both stylesheets force the pointer finger on every card node and during
    // the whole gesture (hand, table, battlefield, opponent boxes, sidebars).
    for (const css of [tableCss, appCss]) {
      expect(css).toContain('.hand-card-wrapper *');
      expect(css).toContain("[data-zone='player-hand'] .playing-card *");
      expect(css).toMatch(
        /\.hand-card-wrapper,\s*\.hand-card-wrapper \*,[\s\S]*?cursor: pointer !important;/,
      );
      expect(css).toMatch(/html\[data-dragging='true'\],[\s\S]*?cursor: pointer !important;/);
      expect(css).toMatch(/body\[data-dragging='true'\],[\s\S]*?cursor: pointer !important;/);
    }

    fireEvent.dragEnd(slot, { dataTransfer: { setData: vi.fn() } });
    expect(document.body.hasAttribute('data-dragging')).toBe(false);
    expect(document.documentElement.hasAttribute('data-dragging')).toBe(false);
  });

  it('ITEM-7/8: releasing a pointer drag over the throw-in outline plays the card', () => {
    const onThrowInDrop = vi.fn();
    const view = render(
      <GameTable
        myId="p0"
        myHand={hand}
        opponents={bobSeat}
        tablePairs={[{ attack: { suit: 'spades', rank: 'six' }, defense: null }]}
        trumpSuit="diamonds"
        attackerId="p1"
        defenderId="p1"
        canThrowIn
        throwInVisible
        onThrowInDrop={onThrowInDrop}
      />,
    );
    const box = screen.getByTestId('hand-turn-highlight') as HTMLElement;
    vi.spyOn(box, 'getBoundingClientRect').mockReturnValue(fakeRect(300));
    const outline = screen.getByTestId('throw-in-outline');
    const original = (document as unknown as { elementFromPoint?: unknown }).elementFromPoint;
    (document as unknown as { elementFromPoint: unknown }).elementFromPoint = vi.fn(() => outline);

    try {
      fireEvent.mouseDown(within(box).getByLabelText('six of spades'), {
        button: 0,
        clientX: 10,
        clientY: 20,
      });
      fireEvent.mouseMove(document, { clientX: 400, clientY: 900 });
      expect(box.getAttribute('data-reorder-target-index')).toBeNull();
      fireEvent.mouseUp(document, { clientX: 400, clientY: 900 });
      expect(onThrowInDrop).toHaveBeenCalledWith({ suit: 'spades', rank: 'six' });
    } finally {
      (document as unknown as { elementFromPoint: unknown }).elementFromPoint = original;
      view.unmount();
    }
  });

  it('ITEM-1a: shows the throw-in outline only while a throw-in is legal, never at GameOver', () => {
    const pairs: TablePairData[] = [{ attack: { suit: 'spades', rank: 'six' }, defense: null }];
    const props = {
      myId: 'p0',
      myHand: hand,
      opponents: bobSeat,
      tablePairs: pairs,
      trumpSuit: 'diamonds',
      attackerId: 'p1',
      defenderId: 'p0',
    } as const;

    // The viewer is the defender and nobody flagged a legal throw-in: the
    // outline and its slot are gone entirely.
    const view = render(<GameTable {...props} boutPhase="Defense" />);
    expect(screen.queryByTestId('throw-in-outline')).toBeNull();
    expect(screen.queryByTestId('throw-in-slot')).toBeNull();

    view.rerender(<GameTable {...props} boutPhase="Defense" canThrowIn throwInVisible />);
    const outline = screen.getByTestId('throw-in-outline');
    expect(outline.getAttribute('data-throw-in-enabled')).toBe('true');
    expect(outline.getAttribute('data-drop-zone')).toBe('throw-in');

    view.rerender(
      <GameTable {...props} boutPhase="GameOver" canThrowIn throwInVisible />,
    );
    expect(screen.queryByTestId('throw-in-outline')).toBeNull();
  });

  it('ITEM-13a/13b/ITEM-4: the hand box wraps the row at 20%-80% overlap', () => {
    renderTable();
    const box = screen.getByTestId('hand-turn-highlight') as HTMLElement;

    expect(HAND_MIN_OVERLAP_RATIO).toBe(0.2);
    expect(HAND_MAX_OVERLAP_RATIO).toBe(0.8);
    expect(HAND_MIN_OVERLAP).toBe(Math.round(HAND_CARD_WIDTH * 0.2));
    expect(box.getAttribute('data-min-overlap-ratio')).toBe('0.2');
    const ratio = Number(box.getAttribute('data-overlap-ratio'));
    expect(ratio).toBeGreaterThanOrEqual(HAND_MIN_OVERLAP_RATIO);
    expect(ratio).toBeLessThanOrEqual(HAND_MAX_OVERLAP_RATIO);
    expect(Number(box.getAttribute('data-overlap-px'))).toBeGreaterThanOrEqual(
      HAND_MIN_OVERLAP,
    );
    expect(Number(box.getAttribute('data-stride-px'))).toBeGreaterThan(0);

    const wrappers = Array.from(box.querySelectorAll('.hand-card-wrapper')) as HTMLElement[];
    expect(wrappers).toHaveLength(3);
    for (const wrapper of wrappers.slice(1)) {
      expect(parseFloat(wrapper.style.marginLeft)).toBeLessThanOrEqual(-HAND_MIN_OVERLAP);
    }

    const boxRule = (tableCss.match(/\.hand-cards\s*{[^}]*}/) ?? [''])[0];
    expect(boxRule).toContain('display: inline-flex');
    expect(boxRule).toContain('padding: 0');
    expect(boxRule).toContain('overflow: visible');
    expect(boxRule).not.toMatch(/height:\s*(112|120)px/);
    expect(tableCss).toMatch(
      /\.hand-card-wrapper\s*{[^}]*width: var\(--hand-card-width, 100px\);[^}]*height: var\(--hand-card-height, 140px\);[^}]*flex: 0 0 var\(--hand-card-width, 100px\);/,
    );

    // The box width is exactly `100 + (visibleCount - 1) * stride`.
    const layout = handLayout(3, 720, 0.5, HAND_CARD_WIDTH);
    expect(layout.overlap).toBe(HAND_MIN_OVERLAP);
    expect(rowWidth(layout, HAND_CARD_WIDTH)).toBe(
      HAND_CARD_WIDTH + (layout.visibleCount - 1) * (HAND_CARD_WIDTH - layout.overlap),
    );
  });

  it('ITEM-13c: opponent mini-cards overlap by at least 10% of their own width', () => {
    const { container } = render(
      <GameTable
        myId="p0"
        myHand={hand}
        opponents={bobSeat}
        tablePairs={[]}
        trumpSuit="diamonds"
        defenderId="p1"
      />,
    );
    const backs = Array.from(container.querySelectorAll('.opponent-card')) as HTMLElement[];
    expect(backs).toHaveLength(6);
    for (const back of backs.slice(1)) {
      expect(parseFloat(back.style.marginLeft)).toBeLessThanOrEqual(
        -Math.round(OPPONENT_CARD_WIDTH * 0.1),
      );
    }
    const row = container.querySelector('.opponent-cards') as HTMLElement;
    expect(row.getAttribute('data-min-overlap-ratio')).toBe('0.10');
    expect(Number(row.getAttribute('data-overlap'))).toBeGreaterThanOrEqual(
      Math.round(OPPONENT_CARD_WIDTH * 0.1),
    );

    const revealed = render(
      <GameTable
        myId="p0"
        myHand={hand}
        opponents={[
          {
            ...bobSeat[0],
            cardCount: 3,
            cards: [
              { suit: 'diamonds', rank: 'ace' },
              { suit: 'spades', rank: 'king' },
              { suit: 'hearts', rank: 'ten' },
            ],
          },
        ]}
        tablePairs={[]}
        trumpSuit="diamonds"
        defenderId="p1"
        transparentMode
      />,
    );
    const miniCards = screen.getAllByTestId('opponent-low-detail-card');
    expect(miniCards).toHaveLength(3);
    for (const card of miniCards.slice(1)) {
      expect(parseFloat(card.style.marginLeft)).toBeLessThanOrEqual(
        -Math.round(LOW_DETAIL_CARD_WIDTH * 0.1),
      );
    }
    for (const card of miniCards.slice(1)) {
      const overlap = Math.abs(parseFloat(card.style.marginLeft));
      expect(overlap).toBeGreaterThanOrEqual(LOW_DETAIL_CARD_WIDTH * 0.1);
    }
    revealed.unmount();
  });

  const keyframeBody = (css: string, name: string): string => {
    const start = css.indexOf(`@keyframes ${name}`);
    if (start < 0) return '';
    const open = css.indexOf('{', start);
    let depth = 0;
    for (let index = open; index < css.length; index += 1) {
      if (css[index] === '{') depth += 1;
      else if (css[index] === '}') {
        depth -= 1;
        if (depth === 0) return css.slice(open + 1, index);
      }
    }
    return '';
  };

  it('ITEM-15: every glow pulse interpolates matched shadow layers with no box-shadow transition', () => {
    const glowKeyframes = [
      'turnPulse',
      'throwInPulse',
      'attackerPulse',
      'defenderHandPulse',
      'lightAttackerHandPulse',
      'lightDefenderHandPulse',
      'lightUncoveredPulse',
    ];
    for (const name of glowKeyframes) {
      const body = keyframeBody(tableCss, name);
      expect(body, name).not.toBe('');
      const declarations = body.match(/box-shadow:[^;]+;/g) ?? [];
      expect(declarations, name).toHaveLength(2);
      // `0%, 100%` and `50%` must list the same number of shadow layers, with
      // `inset` layers in the same positions, or the browser snaps discretely.
      const layerCounts = declarations.map((declaration) => declaration.split(',').length);
      expect(layerCounts[0], name).toBe(layerCounts[1]);
      const insetCounts = declarations.map(
        (declaration) => (declaration.match(/inset/g) ?? []).length,
      );
      expect(insetCounts[0], name).toBe(insetCounts[1]);
    }

    // Entry lives on the wrapper; the pulsing slot only transitions border colour.
    expect(tableCss).toContain('@keyframes pairEnter');
    expect(tableCss).toMatch(/\.table-pair\s*{[^}]*animation: pairEnter/);
    expect(tableCss).toMatch(
      /\.table-card-uncovered \.card-slot[^{]*{[^}]*transition: border-color 150ms ease;/,
    );
    expect(tableCss).not.toMatch(/\.table-card-uncovered[^{]*{[^}]*transition: all/);
    expect(tableCss).not.toMatch(/\.hand-cards[^{]*{[^}]*transition: box-shadow/);
  });

  it('ITEM-15: clock ticks and projection refreshes never remount the glowing nodes', () => {
    const pairs: TablePairData[] = [
      { attack: { suit: 'spades', rank: 'six' }, defense: null },
      { attack: { suit: 'spades', rank: 'seven' }, defense: null },
    ];
    const props = {
      myId: 'p0',
      myHand: hand,
      opponents: bobSeat,
      tablePairs: pairs,
      trumpSuit: 'diamonds',
      attackerId: 'p1',
      defenderId: 'p0',
      boutPhase: 'Defense',
      defending: true,
      turnPlayerId: 'p0',
    } as const;

    const view = render(<GameTable {...props} turnSecondsRemaining={15} />);
    const firstGlow = view.container.querySelector('.table-card-uncovered') as HTMLElement;
    const handBox = view.container.querySelector('.hand-cards') as HTMLElement;
    const seat = view.container.querySelector('.opponent-seat') as HTMLElement;
    const badge = view.container.querySelector('.status-badge');
    expect(firstGlow).not.toBeNull();

    view.rerender(<GameTable {...props} turnSecondsRemaining={9} />);
    expect(view.container.querySelectorAll('.table-card-uncovered')).toHaveLength(2);
    expect(view.container.querySelector('.table-card-uncovered')).toBe(firstGlow);
    expect(view.container.querySelector('.hand-cards')).toBe(handBox);
    expect(view.container.querySelector('.opponent-seat')).toBe(seat);
    expect(view.container.querySelector('.status-badge')).toBe(badge);
  });
});

describe('T-90-feedback-20261105_183601-1: surrender throw-in outline placement and card size', () => {
  const makeOpponents = (count: number): OpponentSummary[] =>
    [
      { id: 'p1', name: 'Bob', cardCount: 5, hasPassed: false, finishRank: null },
      { id: 'p2', name: 'Carol', cardCount: 5, hasPassed: false, finishRank: null },
      { id: 'p3', name: 'Dave', cardCount: 5, hasPassed: false, finishRank: null },
    ].slice(0, count);

  const surrenderPairs: TablePairData[] = [
    { attack: { suit: 'spades', rank: 'king' }, defense: { suit: 'hearts', rank: 'ace' } },
    { attack: { suit: 'clubs', rank: 'king' }, defense: null },
  ];

  const rule = (selector: string): string => cssRule(tableCss, selector);

  it('ITEM-1b: places the outline above the taken cards when the active user surrenders', () => {
    render(
      <GameTable
        myId="p0"
        myHand={hand}
        opponents={makeOpponents(1)}
        tablePairs={surrenderPairs}
        trumpSuit="diamonds"
        attackerId="p1"
        defenderId="p0"
        boutPhase="SurrenderThrowIn"
        canThrowIn
      />,
    );

    const outline = screen.getByTestId('throw-in-outline');
    expect(outline.getAttribute('data-surrender-outline-position')).toBe('above');
    expect(outline.getAttribute('data-on-table')).toBe('true');
    // Never a descendant of the half-off `translateY(calc(50% + 12px))` row.
    expect(outline.closest('.table-pairs-group')).toBeNull();
    expect(outline.closest('[data-testid="play-area-box"]')).not.toBeNull();
    expect(screen.getByTestId('table-pairs-group').getAttribute('data-surrender-target')).toBe(
      'bottom',
    );

    const anchor = screen.getByTestId('surrender-throw-in-anchor');
    expect(anchor.getAttribute('data-placement')).toBe('above');
    expect(anchor.getAttribute('data-surrender-seat')).toBe('bottom');
    expect(anchor.getAttribute('data-on-table')).toBe('true');
    expect(anchor.contains(outline)).toBe(true);

    // The anchor hugs the top edge while the cards slide half-off the bottom.
    expect(rule(".surrender-throw-in-anchor[data-placement='above']")).toContain(
      'align-self: start',
    );
    expect(
      rule(".table-pairs-group[data-surrendered='true'][data-surrender-target='bottom']"),
    ).toContain('transform: translateY(calc(50% + 12px))');
  });

  it('ITEM-1a: places the outline below the taken cards for every top-row opponent', () => {
    const cases: Array<{ opponents: OpponentSummary[]; defenderId: string; seat: string }> = [
      { opponents: makeOpponents(1), defenderId: 'p1', seat: 'top-center' },
      { opponents: makeOpponents(2), defenderId: 'p1', seat: 'top-left' },
      { opponents: makeOpponents(2), defenderId: 'p2', seat: 'top-right' },
      { opponents: makeOpponents(3), defenderId: 'p2', seat: 'top-center' },
      { opponents: makeOpponents(3), defenderId: 'p3', seat: 'top-right' },
    ];

    for (const scenario of cases) {
      const view = render(
        <GameTable
          myId="p0"
          myHand={hand}
          opponents={scenario.opponents}
          tablePairs={surrenderPairs}
          trumpSuit="diamonds"
          attackerId="p1"
          defenderId={scenario.defenderId}
          boutPhase="Surrender throw in"
          canThrowIn
        />,
      );

      const outline = screen.getByTestId('throw-in-outline');
      expect(outline.getAttribute('data-surrender-outline-position')).toBe('below');
      expect(outline.getAttribute('data-on-table')).toBe('true');
      expect(outline.closest('.table-pairs-group')).toBeNull();
      expect(outline.closest('[data-testid="play-area-box"]')).not.toBeNull();

      const group = screen.getByTestId('table-pairs-group');
      expect(group.getAttribute('data-surrendered')).toBe('true');
      expect(group.getAttribute('data-surrender-target')).toBe(scenario.seat);

      const anchor = screen.getByTestId('surrender-throw-in-anchor');
      expect(anchor.getAttribute('data-placement')).toBe('below');
      expect(anchor.getAttribute('data-surrender-seat')).toBe(scenario.seat);
      // The anchor stays on the bottom edge of the tinted box, under the seat.
      expect(rule('.surrender-throw-in-anchor')).toContain('align-self: end');
      expect(rule(".surrender-throw-in-anchor[data-surrender-seat='top-left']")).toContain(
        'justify-self: start',
      );
      expect(rule(".surrender-throw-in-anchor[data-surrender-seat='top-right']")).toContain(
        'justify-self: end',
      );
      view.unmount();
    }
  });

  it('ITEM-1b: keeps the outline inline during a normal bout', () => {
    render(
      <GameTable
        myId="p0"
        myHand={hand}
        opponents={makeOpponents(1)}
        tablePairs={surrenderPairs}
        trumpSuit="diamonds"
        attackerId="p1"
        defenderId="p0"
        boutPhase="Defending"
        canThrowIn
      />,
    );

    const outline = screen.getByTestId('throw-in-outline');
    expect(outline.getAttribute('data-surrender-outline-position')).toBe('inline');
    expect(outline.getAttribute('data-on-table')).toBe('true');
    expect(outline.getAttribute('data-drop-zone')).toBe('throw-in');
    expect(outline.closest('.table-pairs-group')).not.toBeNull();
    expect(screen.queryByTestId('surrender-throw-in-anchor')).toBeNull();

    const slot = screen.getByTestId('throw-in-slot');
    expect(slot.classList.contains('throw-in-slot')).toBe(true);
    expect(slot.getAttribute('data-surrender-outline-position')).toBe('inline');
    expect(slot.children[0]).toBe(outline);
  });

  it('ITEM-2: keeps the exact 100x140 card size in every phase', () => {
    // `.throw-in-outline` is also named in the pointer-cursor rule list, so pick
    // the sizing block itself.
    const sizeRule =
      (tableCss.match(/\.throw-in-outline \{[^}]*\}/g) ?? []).find((block) =>
        block.includes('min-width: 100px'),
      ) ?? '';
    expect(sizeRule).not.toBe('');
    expect(sizeRule).toContain('flex: 0 0 100px');
    expect(sizeRule).toContain('width: 100px');
    expect(sizeRule).toContain('height: 140px');
    expect(sizeRule).toContain('min-width: 100px');
    expect(sizeRule).toContain('max-width: 100px');
    expect(sizeRule).toContain('min-height: 140px');
    expect(sizeRule).toContain('max-height: 140px');
    expect(sizeRule).toContain('box-sizing: border-box');
    expect(sizeRule).toContain('margin: 0');
    expect(tableCss).toMatch(/@media \(max-width: 900px\) \{[^}]*\.throw-in-outline \{[^}]*width: 48px;/);

    const ranks = ['six', 'seven', 'eight', 'nine', 'ten'];
    for (const count of [1, 2, 3, 4, 5]) {
      const pairs: TablePairData[] = Array.from({ length: count }, (_, index) => ({
        attack: { suit: 'spades', rank: ranks[index] },
        // Mix covered and uncovered pairs; the `.table-pair` cover reserve must
        // never stretch the outline.
        defense: index % 2 === 0 ? null : { suit: 'hearts', rank: 'ace' },
      }));
      const view = render(
        <GameTable
          myId="p0"
          myHand={hand}
          opponents={makeOpponents(1)}
          tablePairs={pairs}
          trumpSuit="diamonds"
          attackerId="p1"
          defenderId="p0"
          boutPhase="Defending"
          canThrowIn
        />,
      );

      const outline = screen.getByTestId('throw-in-outline');
      expect(outline.getAttribute('data-card-width')).toBe(String(CARD_WIDTH));
      expect(outline.getAttribute('data-card-height')).toBe(String(CARD_HEIGHT));
      expect(CARD_WIDTH).toBe(100);
      expect(CARD_HEIGHT).toBe(140);
      expect(outline.parentElement?.classList.contains('throw-in-slot')).toBe(true);
      expect(document.querySelector('.table-pair')?.getAttribute('data-card-width')).toBe('100');
      view.unmount();
    }

    // The same exact footprint survives a surrender in both placements.
    for (const scenario of [
      { defenderId: 'p0', placement: 'above' },
      { defenderId: 'p1', placement: 'below' },
    ]) {
      const view = render(
        <GameTable
          myId="p0"
          myHand={hand}
          opponents={makeOpponents(1)}
          tablePairs={surrenderPairs}
          trumpSuit="diamonds"
          attackerId="p1"
          defenderId={scenario.defenderId}
          boutPhase="SurrenderThrowIn"
          canThrowIn
        />,
      );
      const outline = screen.getByTestId('throw-in-outline');
      expect(outline.getAttribute('data-surrender-outline-position')).toBe(scenario.placement);
      expect(outline.getAttribute('data-card-width')).toBe('100');
      expect(outline.getAttribute('data-card-height')).toBe('140');
      expect(outline.parentElement?.classList.contains('surrender-throw-in-anchor')).toBe(true);
      view.unmount();
    }
  });

  it('ITEM-1b: a drop on the detached outline still dispatches ThrowInCards', () => {
    const onThrowInDrop = vi.fn();
    for (const scenario of [
      { defenderId: 'p0', placement: 'above' },
      { defenderId: 'p1', placement: 'below' },
    ]) {
      const view = render(
        <GameTable
          myId="p0"
          myHand={hand}
          opponents={makeOpponents(1)}
          tablePairs={surrenderPairs}
          trumpSuit="diamonds"
          attackerId="p1"
          defenderId={scenario.defenderId}
          boutPhase="SurrenderThrowIn"
          canThrowIn
          onThrowInDrop={onThrowInDrop}
        />,
      );

      const outline = screen.getByTestId('throw-in-outline');
      expect(outline.getAttribute('data-surrender-outline-position')).toBe(scenario.placement);
      expect(outline.getAttribute('data-drop-zone')).toBe('throw-in');
      fireEvent.dragStart(
        within(screen.getByTestId('hand-turn-highlight')).getByLabelText('king of clubs'),
        { dataTransfer: { setData: vi.fn() } },
      );
      fireEvent.drop(outline, { dataTransfer: { getData: () => '' } });
      expect(onThrowInDrop).toHaveBeenLastCalledWith({ suit: 'clubs', rank: 'king' });
      onThrowInDrop.mockClear();
      view.unmount();
    }
  });
});

/**
 * T-90-feedback-20261105_221105-2: card-size parity with the outlines, the
 * 20%-80% hand overlap, the tight non-rectangular hand contour and the
 * always-visible dragged card.
 */
describe('T-90-feedback-20261105_221105-2: card size, hand overlap, contour and drag visibility', () => {
  const bob: OpponentSummary = {
    id: 'p1',
    name: 'Bob',
    cardCount: 6,
    hasPassed: false,
    finishRank: null,
  };

  const cssRule = (selector: string): string => {
    const start = tableCss.indexOf(`\n${selector} {`);
    if (start < 0) return '';
    const end = tableCss.indexOf('}', start);
    return tableCss.slice(start, end);
  };

  const fakeRect = (width: number): DOMRect =>
    ({
      left: 0,
      top: 0,
      right: width,
      bottom: 140,
      width,
      height: 140,
      x: 0,
      y: 0,
      toJSON: () => ({}),
    }) as DOMRect;

  it('ITEM-1b: renders 100x140 cards matching the throw-in and redirect outlines', () => {
    render(
      <GameTable
        myId="p0"
        myHand={hand}
        opponents={[bob]}
        tablePairs={[{ attack: { suit: 'spades', rank: 'six' }, defense: null }]}
        trumpSuit="diamonds"
        attackerId="p1"
        defenderId="p0"
        canRedirect
        canThrowIn
        throwInVisible
      />,
    );

    const handCard = document.querySelector(
      '[data-zone="player-hand"] .card-slot',
    ) as HTMLElement;
    const tableCard = document.querySelector(
      '.table-pair-attack .card-slot',
    ) as HTMLElement;
    for (const card of [handCard, tableCard]) {
      expect(card.getAttribute('data-card-width')).toBe('100');
      expect(card.getAttribute('data-card-height')).toBe('140');
    }

    const throwIn = screen.getByTestId('throw-in-outline');
    const redirect = screen.getByTestId('redirect-outline');
    expect(throwIn.getAttribute('data-card-width')).toBe('100');
    expect(throwIn.getAttribute('data-card-height')).toBe('140');
    expect(redirect.getAttribute('data-card-width')).toBe('100');
    expect(redirect.getAttribute('data-card-height')).toBe('140');

    expect(cssRule('.card-slot')).toContain('width: var(--card-width, 100px)');
    expect(cssRule('.card-slot')).toContain('height: var(--card-height, 140px)');
    expect(cssRule('.card-slot')).toContain('min-width: var(--card-width, 100px)');
    expect(cssRule('.card-slot')).toContain('min-height: var(--card-height, 140px)');
    expect(cssRule('.card-slot')).not.toMatch(/width:\s*(80|70)px/);
    expect(cssRule('.hand-card-wrapper')).toContain('width: var(--hand-card-width, 100px)');
    expect(tableCss).toMatch(
      /@media \(max-width: 900px\)[\s\S]*?\.card-slot\s*{[^}]*--card-width: 48px;[^}]*--card-height: 68px;/,
    );
  });

  it('ITEM-4: stays inside the 20%-80% overlap band and never overflows', () => {
    for (const count of [2, 3, 6, 12, 18, 30]) {
      const layout = handLayout(count, 720);
      expect(layout.overlapRatio).toBeGreaterThanOrEqual(HAND_MIN_OVERLAP_RATIO - 1e-9);
      expect(layout.overlapRatio).toBeLessThanOrEqual(HAND_MAX_OVERLAP_RATIO + 1e-9);
      expect(layout.totalWidth).toBeLessThanOrEqual(720 + 1e-9);
      expect(layout.hiddenLeft + layout.hiddenRight).toBe(0);
    }

    // A picked-up full deck compresses to the readable strip and is scaled to
    // fit, so no card ever leaves the hand column or covers the UI.
    for (const count of [30, 36, 52]) {
      const layout = handLayout(count, 640);
      expect(layout.totalWidth * layout.scale).toBeLessThanOrEqual(640 + 1e-9);
      expect(layout.hiddenLeft + layout.hiddenRight).toBe(0);
      expect(layout.stride).toBeGreaterThan(0);
    }

    // A very wide column never parts the cards past the 20% overlap.
    expect(handLayout(4, 2000).overlapRatio).toBeCloseTo(HAND_MIN_OVERLAP_RATIO, 5);

    render(
      <GameTable
        myId="p0"
        myHand={hand}
        opponents={[bob]}
        tablePairs={[]}
        trumpSuit="diamonds"
        defenderId="p1"
      />,
    );
    const box = screen.getByTestId('hand-turn-highlight') as HTMLElement;
    expect(Number(box.getAttribute('data-overlap-ratio'))).toBeCloseTo(
      handLayout(3, 720).overlapRatio,
      5,
    );
    expect(Number(box.getAttribute('data-overlap-px'))).toBeCloseTo(
      handLayout(3, 720).overlap,
      5,
    );
    expect(Number(box.getAttribute('data-stride-px'))).toBe(
      HAND_CARD_WIDTH - HAND_MIN_OVERLAP,
    );
    expect(Number(box.getAttribute('data-hand-width'))).toBe(
      HAND_CARD_WIDTH + 2 * (HAND_CARD_WIDTH - HAND_MIN_OVERLAP),
    );
  });

  it('ITEM-2: wraps the hand tightly and distorts over raised cards', () => {
    const { unmount } = render(
      <GameTable
        myId="p0"
        myHand={hand}
        opponents={[bob]}
        tablePairs={[]}
        trumpSuit="diamonds"
        defenderId="p1"
        awaitingAttack
        playableKeys={[cardKey(hand[1])]}
      />,
    );

    const box = screen.getByTestId('hand-turn-highlight') as HTMLElement;
    const contour = screen.getByTestId('hand-highlight-contour');
    const path = screen.getByTestId('hand-highlight-path');
    const layout = handLayout(3, 720);

    expect(contour.getAttribute('data-non-rectangular')).toBe('true');
    expect(Number(contour.getAttribute('data-contour-width'))).toBe(
      Number(box.getAttribute('data-hand-width')),
    );
    expect(Number(contour.getAttribute('data-contour-width'))).toBe(
      HAND_CARD_WIDTH + 2 * layout.stride,
    );

    // The raised middle card steps the outline up and back down tightly.
    const d = path.getAttribute('d') ?? '';
    const verticals = Array.from(d.match(/V -?\d+(?:\.\d+)?/g) ?? []).map((command) =>
      Number(command.slice(1)),
    );
    expect(new Set(verticals).size).toBeGreaterThan(1);
    // 4px of tight padding above the -14px raised card.
    expect(parseFloat(contour.style.top)).toBe(HAND_RAISED_OFFSET - 4);

    unmount();

    render(
      <GameTable
        myId="p0"
        myHand={hand}
        opponents={[bob]}
        tablePairs={[]}
        trumpSuit="diamonds"
        defenderId="p1"
      />,
    );
    expect(screen.getByTestId('hand-highlight-contour').getAttribute('data-non-rectangular')).toBe(
      'false',
    );
  });

  it('ITEM-3: keeps a clicked-and-dragged card fully visible at 100x140', () => {
    render(
      <GameTable
        myId="p0"
        myHand={hand}
        opponents={[bob]}
        tablePairs={[]}
        trumpSuit="diamonds"
        defenderId="p1"
        onReorderHand={vi.fn()}
      />,
    );

    const box = screen.getByTestId('hand-turn-highlight') as HTMLElement;
    vi.spyOn(box, 'getBoundingClientRect').mockReturnValue(fakeRect(300));
    const labeled = screen.getByLabelText('six of spades');
    const wrapper = labeled.closest('.hand-card-wrapper') as HTMLElement;

    fireEvent.mouseDown(labeled, { button: 0, clientX: 10, clientY: 20 });
    fireEvent.mouseMove(document, { clientX: 130, clientY: 60 });

    expect(wrapper.isConnected).toBe(true);
    expect(wrapper.getAttribute('data-dragging')).toBe('true');
    expect(wrapper.getAttribute('data-collapsed')).toBe('true');
    expect(wrapper.style.opacity === '' || wrapper.style.opacity === '1').toBe(true);
    expect(wrapper.style.visibility).not.toBe('hidden');
    expect(wrapper.style.display).not.toBe('none');
    expect(wrapper.style.transform).toBe('translate3d(120px, 40px, 0)');

    const card = wrapper.querySelector('.card-slot') as HTMLElement;
    expect(card).not.toBeNull();
    expect(card.getAttribute('data-card-width')).toBe('100');
    expect(card.getAttribute('data-card-height')).toBe('140');

    const collapsedRule = cssRule(".hand-card-wrapper[data-collapsed='true']");
    expect(collapsedRule).not.toMatch(/opacity:\s*0/);
    expect(collapsedRule).not.toMatch(/visibility:\s*hidden/);
    expect(collapsedRule).not.toMatch(/display:\s*none/);
    expect(collapsedRule).toContain('overflow: visible');
    expect(cssRule('.hand-card-wrapper')).toContain('overflow: visible');

    fireEvent.mouseUp(document, { clientX: 130, clientY: 60 });
    expect(wrapper.getAttribute('data-collapsed')).toBe('false');
  });

  it('ITEM-1b: exposes the responsive 100x140 / 48x68 constants and slot rules', () => {
    expect(cardSizeForViewport(1920)).toEqual({ width: CARD_WIDTH, height: CARD_HEIGHT });
    expect(cardSizeForViewport(MOBILE_BREAKPOINT_PX)).toEqual({
      width: MOBILE_CARD_WIDTH,
      height: MOBILE_CARD_HEIGHT,
    });
    expect(cardSizeForViewport(MOBILE_BREAKPOINT_PX + 1)).toEqual({
      width: CARD_WIDTH,
      height: CARD_HEIGHT,
    });

    // The play-area aliases and the hand slot never shrink below the desktop
    // card, and both switch to 48x68 below 900px.
    expect(tableCss).toMatch(
      /\.bout-card,\s*\.bout-pair\s*{[^}]*min-width: 100px;[^}]*min-height: 140px;/,
    );
    expect(cssRule('.hand-card-wrapper')).toContain('min-width: var(--hand-card-width, 100px)');
    expect(cssRule('.hand-card-wrapper')).toContain(
      'min-height: var(--hand-card-height, 140px)',
    );
    expect(tableCss).toMatch(
      /@media \(max-width: 900px\)[\s\S]*?--hand-card-width: 48px;[\s\S]*?--hand-card-height: 68px;/,
    );
    expect(tableCss).toMatch(
      /@media \(max-width: 900px\)[\s\S]*?\.hand-card-wrapper,\s*\.bout-card,\s*\.bout-pair\s*{[^}]*min-width: 48px;[^}]*min-height: 68px;/,
    );
  });

  it('ITEM-4: fits a 52-card hand by scaling the row from its left edge', () => {
    const ranks = ['six', 'seven', 'eight', 'nine', 'ten', 'jack', 'queen', 'king', 'ace'];
    const suits = ['spades', 'hearts', 'clubs', 'diamonds'];
    const fullDeck: CardData[] = Array.from({ length: 52 }, (_, index) => ({
      suit: suits[index % suits.length],
      rank: ranks[index % ranks.length],
    }));

    render(
      <GameTable
        myId="p0"
        myHand={fullDeck}
        opponents={[bob]}
        tablePairs={[]}
        trumpSuit="diamonds"
        defenderId="p1"
      />,
    );

    const box = screen.getByTestId('hand-turn-highlight') as HTMLElement;
    // The hand reserves the contour's 4px padding on both sides.
    const layout = handLayout(
      fullDeck.length,
      HAND_FALLBACK_WIDTH - HAND_CONTOUR_PADDING * 2,
    );
    expect(layout.scale).toBeLessThan(1);
    expect(Number(box.getAttribute('data-fit-scale'))).toBeCloseTo(layout.scale, 2);

    // The rendered box is exactly the scaled natural row, and the children are
    // laid out from the left edge before the same transform shrinks them into
    // that box, so the cards, the box and the contour share one origin.
    expect(Number(box.getAttribute('data-rendered-hand-width'))).toBe(
      Math.round(layout.totalWidth * layout.scale),
    );
    expect(box.style.width).toBe(
      `${Math.round(layout.totalWidth * layout.scale)}px`,
    );
    expect(box.style.justifyContent).toBe('flex-start');
    expect(box.style.transformOrigin).toBe('left center');
    expect(box.style.transform).toBe(`scale(${layout.scale})`);

    // `data-hand-width` and `data-contour-width` are in the SAME unscaled row
    // coordinate space as the contour path; the scaled width is separate.
    const contour = screen.getByTestId('hand-highlight-contour');
    expect(Number(contour.getAttribute('data-contour-width'))).toBe(
      Number(box.getAttribute('data-hand-width')),
    );
    expect(Number(contour.getAttribute('data-contour-width'))).toBe(
      Math.round(layout.totalWidth),
    );
    expect(Number(contour.getAttribute('data-contour-rendered-width'))).toBe(
      Math.round(layout.totalWidth * layout.scale),
    );

    const cards = Array.from(box.querySelectorAll('.hand-card-wrapper')) as HTMLElement[];
    expect(cards).toHaveLength(fullDeck.length);
    expect(cards[fullDeck.length - 1].getAttribute('data-card-x')).toBe(
      String(Math.round((fullDeck.length - 1) * layout.stride)),
    );
    // ITEM-4g: every slot reports its vertical offset.
    for (const card of cards) expect(card.getAttribute('data-card-y')).toBe('0');

    // ITEM-3c: under a fit scale the dragged card counter-scales and divides
    // the pointer delta, so it tracks the cursor at its full 100x140 size.
    fireEvent.mouseDown(within(cards[0]).getByLabelText('six of spades'), {
      button: 0,
      clientX: 10,
      clientY: 20,
    });
    fireEvent.mouseMove(document, { clientX: 70, clientY: 50 });
    // Once the drag starts the row switches to the compacted N-1 layout, so the
    // counter-scale uses that layout's scale.
    const dragLayout = handLayout(
      fullDeck.length - 1,
      HAND_FALLBACK_WIDTH - HAND_CONTOUR_PADDING * 2,
    );
    expect(cards[0].style.transform).toBe(
      `translate3d(${60 / dragLayout.scale}px, ${30 / dragLayout.scale}px, 0) scale(${
        1 / dragLayout.scale
      })`,
    );
    expect(cards[0].style.transformOrigin).toBe('left top');
    expect(cards[0].style.zIndex).toBe('1000');
    fireEvent.mouseUp(document, { clientX: 70, clientY: 50 });
  });

  it('ITEM-2: rebuilds the contour from the compacted row while a card is dragged', () => {
    render(
      <GameTable
        myId="p0"
        myHand={hand}
        opponents={[bob]}
        tablePairs={[]}
        trumpSuit="diamonds"
        defenderId="p1"
        onReorderHand={vi.fn()}
      />,
    );

    const box = screen.getByTestId('hand-turn-highlight') as HTMLElement;
    vi.spyOn(box, 'getBoundingClientRect').mockReturnValue(fakeRect(300));
    expect(Number(box.getAttribute('data-hand-width'))).toBe(260);

    fireEvent.mouseDown(screen.getByLabelText('six of spades'), {
      button: 0,
      clientX: 10,
      clientY: 20,
    });
    fireEvent.mouseMove(document, { clientX: 400, clientY: 900 });

    // The dragged card floats under the pointer, so the hand (and the contour)
    // wrap the compacted N-1 row of 100 + 80 = 180px.
    expect(box.getAttribute('data-gap-closed')).toBe('true');
    expect(Number(box.getAttribute('data-hand-width'))).toBe(180);
    const contour = screen.getByTestId('hand-highlight-contour');
    const path = screen.getByTestId('hand-highlight-path');
    expect(Number(contour.getAttribute('data-contour-width'))).toBe(180);
    const xs = Array.from((path.getAttribute('d') ?? '').match(/[MH] (-?\d+(?:\.\d+)?)/g) ?? []).map(
      (pair) => Number(pair.slice(1)),
    );
    // The path is in the contour's own coordinate space (2 * 4px padding), and
    // its right edge equals the SVG width.
    expect(Math.max(...xs)).toBe(Number(contour.getAttribute('width')));
    expect(Number(contour.getAttribute('width'))).toBe(180 + 8);

    fireEvent.mouseUp(document, { clientX: 400, clientY: 900 });
    expect(Number(screen.getByTestId('hand-turn-highlight').getAttribute('data-hand-width'))).toBe(
      260,
    );
  });

  it('ITEM-3: never clips the hand column or the arena and lets the drag pass through', () => {
    expect(cssRule("[data-zone='player-hand']")).toContain('overflow: visible');
    expect(cssRule("[data-zone='table-arena']")).toContain('overflow: visible');
    expect(tableCss).toMatch(
      /\.hand-card-wrapper\[data-dragging='true'\] \.card-slot,[\s\S]*?pointer-events: none;/,
    );
    expect(tableCss).toMatch(
      /\.hand-card-wrapper\[data-dragging='true'\]\s*{[^}]*opacity: 1;/,
    );
    const dragged = cssRule(".hand-card-wrapper[data-dragging='true']");
    expect(dragged).toContain('visibility: visible');
    expect(dragged).toContain('z-index: 1000');
  });
  it('ITEM-4: compresses a mobile full deck with a card-scaled readable strip', () => {
    const layout = handLayout(36, 300, 0.5, MOBILE_CARD_WIDTH);
    // 20% of 48px is 9.6px, so the desktop 15px floor must not widen the row.
    expect(layout.stride).toBeCloseTo((300 - MOBILE_CARD_WIDTH) / 35, 5);
    expect(layout.stride).toBeLessThan(HAND_MIN_VISIBLE_LEFT);
    expect(layout.totalWidth * layout.scale).toBeLessThanOrEqual(300 + 1e-9);
    expect(layout.hiddenLeft + layout.hiddenRight).toBe(0);
  });

  it('ITEM-1b: clamps a measured bout slot to the standard card box', () => {
    // A pair box reserves the defender overhang + drop offset, so measuring it
    // would inflate the cards. Clamping also stops a measure -> render loop.
    expect(clampBoutCardSize(320, 480)).toEqual({ width: 100, height: 140 });
    expect(clampBoutCardSize(MOBILE_CARD_WIDTH, MOBILE_CARD_HEIGHT)).toEqual({
      width: 48,
      height: 68,
    });
    expect(clampBoutCardSize(0, 0)).toEqual({ width: 0, height: 0 });
  });

  it('ITEM-2: raises the cards and the contour from one shared constant', () => {
    render(
      <GameTable
        myId="p0"
        myHand={hand}
        opponents={[bob]}
        tablePairs={[]}
        trumpSuit="diamonds"
        defenderId="p1"
        awaitingAttack
        playableKeys={[cardKey(hand[0])]}
      />,
    );

    const box = screen.getByTestId('hand-turn-highlight') as HTMLElement;
    expect(box.style.getPropertyValue('--hand-raise')).toBe(`${HAND_RAISED_OFFSET}px`);
    const wrappers = Array.from(box.querySelectorAll('.hand-card-wrapper')) as HTMLElement[];
    expect(wrappers[0].getAttribute('data-card-y')).toBe(String(HAND_RAISED_OFFSET));
    expect(wrappers[1].getAttribute('data-card-y')).toBe('0');
    expect(cssRule('.hand-cards .card-slot.legal-playable')).toContain(
      'translateY(var(--hand-raise, -14px))',
    );
    expect(cssRule('.hand-cards .card-slot.selected')).toContain(
      'translateY(var(--hand-raise, -14px))',
    );
    // The old all-legal translate-the-whole-box rule is gone, not just unused.
    expect(tableCss).not.toContain(
      "[data-all-legal='true'][data-active='true'] .card-slot.legal-playable",
    );
  });

  it('ITEM-2: colours the contour per role and drops the old rectangular glow', () => {
    const box = cssRule('.hand-cards');
    expect(box).not.toContain('border:');
    expect(box).not.toContain('box-shadow');

    const path = cssRule('.hand-highlight-path');
    expect(path).toContain('stroke-linejoin: round');
    expect(path).toContain('stroke: var(--hl-neutral-border');
    expect(tableCss).toMatch(
      /\.hand-cards\.attacker-turn \.hand-highlight-path,[\s\S]*?stroke: var\(--hl-attacker-border\);/,
    );
    expect(tableCss).toMatch(
      /\.hand-cards\.defender-turn \.hand-highlight-path,[\s\S]*?stroke: var\(--hl-defender-border\);/,
    );
    expect(tableCss).toMatch(
      /\.hand-cards\.throw-in-turn \.hand-highlight-path,[\s\S]*?stroke: var\(--hl-attacker-border\);/,
    );

    render(
      <GameTable
        myId="p0"
        myHand={hand}
        opponents={[bob]}
        tablePairs={[]}
        trumpSuit="diamonds"
        defenderId="p1"
      />,
    );
    const rendered = screen.getByTestId('hand-highlight-path');
    expect(rendered.getAttribute('stroke-linejoin')).toBe('round');
    expect(rendered.getAttribute('stroke-linecap')).toBe('round');
  });

});
