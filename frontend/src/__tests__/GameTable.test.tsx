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
  HAND_SELECTED_RAISED_OFFSET,
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
  boutLayout,
  clockwiseOffset,
  discardLayout,
  handLayout,
  handMargins,
  opponentIndexStripWidth,
  opponentOverlap,
  rowWidth,
  seatForOffset,
  canonicalSeatOrder,
  MIN_VISIBLE_CARD_LEFT_PX,
  MIN_VISIBLE_STRIP_PX,
  BOUT_CARD_HEIGHT,
  BOUT_CARD_WIDTH,
  BOUT_DEFENSE_OVERHANG_RATIO,
  BOUT_MIN_VISIBLE_LEFT,
  CARD_HEIGHT,
  CARD_WIDTH,
  sortHand,
  type OpponentSummary,
  type TablePairData,
} from '../components/GameTable';
import { ActionBar } from '../components/ActionBar';
import { CARD_INDEX_STRIP_WIDTH_PX } from '../components/Card';
import {
  HAND_SMALL_HAND_OVERLAP_RATIO,
  HAND_SMALL_HAND_PARTING_PAD_RATIO,
} from '../utils/handLayout';
import { DEFAULT_SETTINGS, setSettings } from '../state/settings';
import type { CardData } from '../components/Card';
import tableCss from '../styles/table.css?raw';
import actionIconsCss from '../styles/actionIcons.css?raw';
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
        <ActionBar legalActions={['pass']} onAction={() => {}} />
      </GameTable>,
    );

    expect(container.querySelector('[data-zone="table-arena"]')).not.toBeNull();
    expect(container.querySelector('[data-zone="player-hand"]')).not.toBeNull();
    const controls = container.querySelector('[data-zone="player-controls"]');
    expect(controls).not.toBeNull();
    expect(within(controls as HTMLElement).getByTestId('pass-button')).toBeTruthy();
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
      children: <ActionBar legalActions={['surrender']} onAction={() => {}} />,
    });

    const controls = container.querySelector('[data-zone="player-controls"]') as HTMLElement;
    // The sort dropdown lives in the sidebar box, not beside the hand.
    expect(controls.querySelector('[data-testid="sort-bar"]')).toBeNull();
    expect(within(controls).queryByRole('combobox', { name: 'Sort hand' })).toBeNull();
    // The three separate sort buttons are gone.
    expect(within(controls).queryByRole('button', { name: 'Suit' })).toBeNull();
    expect(within(controls).queryByRole('button', { name: 'Pairs' })).toBeNull();
    expect(within(controls).queryByRole('button', { name: 'Rank' })).toBeNull();
    expect(within(controls).getByTestId('surrender-button')).toBeTruthy();
    expect(within(controls).queryByRole('button', { name: 'Redirect' })).toBeNull();
  });
});

describe('single-row hand overlap', () => {
  const bigHand: CardData[] = Array.from({ length: 36 }, (_, index) => ({
    suit: ['spades', 'hearts', 'diamonds', 'clubs'][index % 4],
    rank: 'six',
  }));

  it('keeps a small hand at the Item 6b resting overlap', () => {
    const layout = handLayout(4, 720);

    expect(layout.hiddenLeft + layout.hiddenRight).toBe(0);
    expect(layout.overlapRatio).toBeCloseTo(HAND_SMALL_HAND_OVERLAP_RATIO, 5);
    // Slightly larger than the 20% minimum, so hover parting has headroom.
    expect(layout.overlap).toBeGreaterThan(HAND_MIN_OVERLAP);
    expect(handMargins(layout, 4)[1]).toBe(-layout.overlap);
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
    // T-95 #3: the unscaled row keeps the 20% stride; the scaled width is what
    // has to stay inside the hand column.
    // T-90-feedback-5 ITEM-5a/5b: a 36-card hand is never scaled down; the
    // Option B row compresses inside the maximal box instead.
    expect(Number(row.getAttribute('data-fit-scale'))).toBe(1);
    expect(Number(row.getAttribute('data-rendered-hand-width'))).toBeLessThanOrEqual(
      HAND_FALLBACK_WIDTH + 1e-9,
    );
  });

  it('T-95 #3: keeps the overlap inside 20%-80% for every large hand size', () => {
    for (const [cardWidth, cardHeight] of [
      [HAND_CARD_WIDTH, HAND_CARD_HEIGHT],
      [MOBILE_CARD_WIDTH, MOBILE_CARD_HEIGHT],
    ] as const) {
      for (const available of [240, 420, 640, 900]) {
        for (const count of [20, 25, 30, 36, 44, 52]) {
          const layout = handLayout(count, available, 0.5, cardWidth);
          expect(layout.visibleCount).toBe(count);
          expect(layout.hiddenLeft + layout.hiddenRight).toBe(0);
          expect(layout.overlapRatio).toBeGreaterThanOrEqual(
            HAND_MIN_OVERLAP_RATIO - 1e-9,
          );
          expect(layout.overlapRatio).toBeLessThanOrEqual(
            HAND_MAX_OVERLAP_RATIO + 1e-9,
          );
          // The uncovered left strip always keeps the rank/suit index.
          expect(cardWidth - layout.overlap).toBeGreaterThanOrEqual(
            cardWidth * HAND_MIN_OVERLAP_RATIO - 1e-9,
          );
          expect(layout.totalWidth * layout.scale).toBeLessThanOrEqual(available + 1e-9);
          expect(cardHeight).toBeGreaterThan(0);
        }
      }
    }
  });

  it('T-95 #3: renders a 30/36/52-card pickup inside the hand zone', () => {
    const ranks = ['six', 'seven', 'eight', 'nine', 'ten', 'jack', 'queen', 'king', 'ace'];
    const suits = ['spades', 'hearts', 'clubs', 'diamonds'];
    const available = HAND_FALLBACK_WIDTH - HAND_CONTOUR_PADDING * 2;
    for (const count of [30, 36, 52]) {
      const bigHand: CardData[] = Array.from({ length: count }, (_, index) => ({
        suit: suits[index % suits.length],
        rank: ranks[index % ranks.length],
      }));
      const view = render(
        <GameTable
          myId="p0"
          myHand={bigHand}
          opponents={[opponents[0]]}
          tablePairs={[]}
          trumpSuit="diamonds"
          defenderId="p1"
        />,
      );
      const box = screen.getByTestId('hand-turn-highlight') as HTMLElement;
      expect(box.querySelectorAll('.hand-card-wrapper')).toHaveLength(count);
      // T-90-feedback-5 ITEM-5a/5b: every card keeps its full footprint inside
      // the maximal box; the row is never scaled.
      expect(Number(box.getAttribute('data-fit-scale'))).toBe(1);
      expect(Number(box.getAttribute('data-rendered-hand-width'))).toBe(
        Number(box.getAttribute('data-hand-width')),
      );
      expect(Number(box.getAttribute('data-rendered-hand-width'))).toBeLessThanOrEqual(
        available + 1e-9,
      );
      for (const card of Array.from(box.querySelectorAll('.card-slot')) as HTMLElement[]) {
        expect(card.getAttribute('data-card-width')).toBe(String(HAND_CARD_WIDTH));
        expect(card.getAttribute('data-card-height')).toBe(String(HAND_CARD_HEIGHT));
      }
      // The tight contour still spans the whole overlapped row.
      const contour = screen.getByTestId('hand-highlight-contour');
      expect(Number(contour.getAttribute('data-contour-width'))).toBe(
        Number(box.getAttribute('data-hand-width')),
      );
      view.unmount();
    }
  });

  it('T-95 #1: hugs a tightly overlapped hand when only some cards are raised', () => {
    const ranks = ['six', 'seven', 'eight', 'nine', 'ten', 'jack', 'queen', 'king', 'ace'];
    const suits = ['spades', 'hearts', 'clubs', 'diamonds'];
    const bigHand: CardData[] = Array.from({ length: 30 }, (_, index) => ({
      suit: suits[index % suits.length],
      rank: ranks[index % ranks.length],
    }));
    const liftedKeys = bigHand.filter((_, index) => index % 3 === 0).map(cardKey);
    render(
      <GameTable
        myId="p0"
        myHand={bigHand}
        opponents={[opponents[0]]}
        tablePairs={[]}
        trumpSuit="diamonds"
        defenderId="p1"
        awaitingAttack
        playableKeys={liftedKeys}
      />,
    );

    const box = screen.getByTestId('hand-turn-highlight') as HTMLElement;
    const contour = screen.getByTestId('hand-highlight-contour');
    // The full-size row compresses inside the maximal box, yet the contour
    // still spans its exact width and steps over the raised cards.
    expect(Number(box.getAttribute('data-fit-scale'))).toBe(1);
    expect(Number(contour.getAttribute('data-contour-width'))).toBe(
      Number(box.getAttribute('data-hand-width')),
    );
    expect(contour.getAttribute('data-contour-shape')).toBe('stepped');
    const ys = new Set(
      Array.from(box.querySelectorAll('.hand-card-wrapper')).map((wrapper) =>
        wrapper.getAttribute('data-card-y'),
      ),
    );
    expect(ys).toEqual(new Set([String(HAND_RAISED_OFFSET), '0']));
    const path = screen.getByTestId('hand-highlight-path').getAttribute('d') ?? '';
    expect(path).not.toMatch(/NaN|Infinity|undefined/);
    expect(path.endsWith('Z')).toBe(true);
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
    // T-90-feedback-5 ITEM-2c: the opponent overlap ceiling leaves the mini
    // index strip (scaled from CARD_INDEX_STRIP_WIDTH_PX) fully visible.
    const strip = opponentIndexStripWidth(LOW_DETAIL_CARD_WIDTH);
    expect(strip).toBeGreaterThanOrEqual(
      Math.ceil((36 * LOW_DETAIL_CARD_WIDTH) / CARD_WIDTH),
    );
    for (const count of [6, 12, 18, 30]) {
      const overlap = opponentOverlap(count, 208, LOW_DETAIL_CARD_WIDTH);
      expect(LOW_DETAIL_CARD_WIDTH - overlap).toBeGreaterThanOrEqual(strip - 1e-9);
    }
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

  it('anchors the highlight from slot margins: first at the runway, the rest negative', () => {
    renderSortableTable({ awaitingAttack: true });

    const highlight = screen.getByTestId('hand-turn-highlight') as HTMLElement;
    const slots = Array.from(
      highlight.querySelectorAll('.hand-card-wrapper'),
    ) as HTMLElement[];
    expect(slots).toHaveLength(sortableHand.length);

    // ITEM-6b: the first small-hand slot carries the symmetric parting runway.
    expect(parseFloat(slots[0].style.marginLeft)).toBeCloseTo(
      HAND_CARD_WIDTH * HAND_SMALL_HAND_PARTING_PAD_RATIO,
      5,
    );
    for (const slot of slots.slice(1)) {
      expect(parseFloat(slot.style.marginLeft)).toBeLessThan(0);
    }
    // The box model aligns the container; no guessed transform is involved.
    for (const slot of slots) expect(slot.style.transform).toBe('');

    const highlightRule = cssBlock('.hand-cards');
    expect(highlightRule).toContain('display: grid');
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
    expect(actionIconsCss).toContain('content: attr(data-countdown)');
  });

  it('leaves the pass button bare without a countdown', () => {
    render(
      <ActionBar legalActions={['pass']} onAction={() => {}} passCountdownSeconds={0} />,
    );

    expect(screen.queryByTestId('pass-countdown')).toBeNull();
    expect(screen.getByTestId('pass-button')).toBeTruthy();
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
    expect(screen.queryByTestId('pass-button')).toBeNull();
    expect(screen.queryByTestId('surrender-button')).toBeNull();
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
    const row = highlight.querySelector('.hand-row') as HTMLElement;
    expect(row).not.toBeNull();
    expect(row.parentElement).toBe(highlight);
    for (const slot of slots) {
      expect(slot.classList.contains('hand-slot')).toBe(true);
      expect(slot.parentElement).toBe(row);
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
    expect(rule).toContain('display: grid');
    expect(rule).toContain('flex: 0 0 auto');
    expect(rule).toContain('width: fit-content');
    expect(rule).toContain('max-width: none');
    expect(rule).toContain('align-items: center');
    // T-96 item 6: the single track is pinned to the stage's inline width and
    // the row starts at its left edge, so a widened contour overlay can never
    // re-centre (and shift) the whole hand row.
    expect(rule).toContain('grid-template-columns: minmax(0, 1fr)');
    expect(rule).toContain('justify-content: start');
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
    // ITEM-6b: small hands keep a symmetric runway, not a zero first margin.
    expect(parseFloat(slots[0].style.marginLeft)).toBeCloseTo(
      HAND_CARD_WIDTH * HAND_SMALL_HAND_PARTING_PAD_RATIO,
      5,
    );
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

  it('T-95 item #2: leaves the full "10" index strip uncovered on an overlapped discard row', () => {
    for (const count of [2, 6, 18, 36, 52]) {
      for (const available of [160, DISCARD_FALLBACK_WIDTH, 720]) {
        const layout = discardLayout(count, available, 0.5, DECK_CARD_WIDTH);
        // Whenever cards overlap at all, the exposed strip is still the
        // shared 36px index strip — never the old 28% guess.
        expect(DECK_CARD_WIDTH - layout.overlap).toBeGreaterThanOrEqual(
          CARD_INDEX_STRIP_WIDTH_PX - 1e-9,
        );
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

    // One shared source of truth for the deck card size, pointing at the
    // canonical 100x140 card tokens (ITEM-2).
    expect(tableCss).toContain('--deck-card-width: var(--card-width, 100px)');
    expect(tableCss).toContain('--deck-card-height: var(--card-height, 140px)');
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
    expect(DECK_CARD_HEIGHT).toBe(140);
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
    // T-90-4 ITEM-1a: the bout never wraps any more; the solver compresses gaps.
    expect(groupRule).toContain('flex-wrap: nowrap');
    expect(groupRule).toContain('align-items: center');
    expect(cssRule('.table-bout-row')).toContain('flex-wrap: nowrap');
    expect(groupRule).toContain('--bout-card-width: var(--card-w, 100px)');
    expect(groupRule).toContain('--bout-card-height: var(--card-h, 140px)');
    expect(groupRule).toContain('--bout-card-offset: 18px');

    const pairRule = cssRule('.table-pair');
    expect(pairRule).toContain('grid-template-rows: var(--pair-card-h, var(--card-h, 140px))');
    expect(pairRule).toContain('align-content: start');
    // T-96: an uncovered pair reserves no horizontal overhang, so its DOM width
    // is exactly `cardWidth`; only a covered pair adds the defence strip.
    expect(pairRule).toContain('padding: 0 0 var(--bout-card-offset, 18px) 0');
    expect(cssRule(".table-pair[data-covered='true']")).toContain(
      'padding-right: var(--pair-defense-offset, 36px)',
    );
    expect(pairRule).toContain('box-sizing: border-box');

    const outlineRule = cssRule('.redirect-outline');
    expect(outlineRule).toContain('height: var(--card-h, 140px)');
    expect(outlineRule).toContain('width: var(--card-w, 100px)');
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
    // T-90-feedback-5 ITEM-8: every eligible card sits on the half-raise tier,
    // rendered as a transform on the wrapper so the contour follows it.
    for (const slot of Array.from(
      highlight.querySelectorAll('.hand-card-wrapper'),
    ) as HTMLElement[]) {
      expect(slot.getAttribute('data-card-y')).toBe(String(HAND_RAISED_OFFSET));
      expect(slot.style.transform).toBe(
        `translate3d(0px, ${HAND_RAISED_OFFSET}px, 0)`,
      );
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
    expect(screen.queryByTestId('pass-button')).toBeNull();
    expect(screen.queryByTestId('surrender-button')).toBeNull();

    const highlight = screen.getByTestId('hand-turn-highlight');
    expect(highlight.getAttribute('data-active')).toBe('false');
    expect(highlight.getAttribute('data-all-legal')).toBe('false');
    expect(container.querySelectorAll('.card-slot[data-playable="true"]')).toHaveLength(0);
  });

  it('ITEM-ADD-9: hides Surrender and Pass in ActionBar for a bot seat', () => {
    render(
      <ActionBar legalActions={['pass', 'surrender']} onAction={() => {}} isBotSeat />,
    );

    expect(screen.queryByTestId('pass-button')).toBeNull();
    expect(screen.queryByTestId('surrender-button')).toBeNull();
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
    expect(cssRule('.table-bout-row')).toContain('flex-wrap: nowrap');

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

  it('T-95 item #2: keeps the full "10" index strip on every overlapped bout row', () => {
    expect(BOUT_MIN_VISIBLE_LEFT).toBe(CARD_INDEX_STRIP_WIDTH_PX);

    for (const width of [240, 320, 420, 640, 960]) {
      for (let slots = 2; slots <= 9; slots += 1) {
        const layout = boutLayout(slots, width, BOUT_CARD_WIDTH);
        // The exposed left strip of every card is never narrower than the
        // strip that carries the full-size `10` and the enlarged suit pip.
        expect(BOUT_CARD_WIDTH - layout.overlap).toBeGreaterThanOrEqual(
          CARD_INDEX_STRIP_WIDTH_PX - 1e-9,
        );
        expect(layout.step).toBeGreaterThanOrEqual(CARD_INDEX_STRIP_WIDTH_PX - 1e-9);
      }
    }

    // The responsive 48px mobile card keeps the same proportional strip.
    const mobile = boutLayout(6, 300, MOBILE_CARD_WIDTH);
    expect(MOBILE_CARD_WIDTH - mobile.overlap).toBeGreaterThanOrEqual(
      Math.ceil((CARD_INDEX_STRIP_WIDTH_PX * MOBILE_CARD_WIDTH) / CARD_WIDTH) - 1e-9,
    );
  });

  it('T-96: the defence overhang clears the whole shared index strip', () => {
    // The covering card starts exactly where the attack card's rank/suit index
    // strip ends, so the `0` of a covered `10` is never clipped.
    expect(BOUT_DEFENSE_OVERHANG_RATIO).toBeCloseTo(
      CARD_INDEX_STRIP_WIDTH_PX / CARD_WIDTH,
      10,
    );
    expect(Math.round(BOUT_CARD_WIDTH * BOUT_DEFENSE_OVERHANG_RATIO)).toBe(
      CARD_INDEX_STRIP_WIDTH_PX,
    );
    // The 48px mobile card scales the strip proportionally (17.28px, which the
    // CSS rounds up to the documented 18px offset).
    expect(MOBILE_CARD_WIDTH * BOUT_DEFENSE_OVERHANG_RATIO).toBeCloseTo(
      (CARD_INDEX_STRIP_WIDTH_PX * MOBILE_CARD_WIDTH) / CARD_WIDTH,
      10,
    );

    // `boutLayout` reserves that overhang when spacing neighbouring pairs.
    const pairRule = cssRule('.table-pair');
    expect(pairRule).toContain(
      '--pair-defense-offset: var(--card-index-strip-width, 36px)',
    );
    // T-96: the overhang is only reserved by a COVERED pair, so an uncovered
    // pair stays exactly one card wide.
    expect(pairRule).toContain('padding: 0 0 var(--bout-card-offset, 18px) 0');
    expect(cssRule(".table-pair[data-covered='true']")).toContain(
      'padding-right: var(--pair-defense-offset, 36px)',
    );
    // `.table-pair-defense` is first declared in the grouped grid-column rule,
    // so match its own margin rule directly.
    expect(tableCss).toMatch(
      /\.table-pair-defense\s*{\s*margin: 15px 0 0 var\(--pair-defense-offset, 36px\)/,
    );
    // The 48px mobile layout scales the same strip (18px) instead of the
    // former narrower 14px offset.
    expect(tableCss).toMatch(/--pair-defense-offset: 18px/);
    expect(tableCss).toContain('padding: 0 0 var(--bout-card-offset, 10px) 0');
    // The mobile covered pair adds its own 18px strip inside the media query.
    expect(tableCss.slice(tableCss.indexOf('@media (max-width: 899px)'))).toContain(
      'padding-right: var(--pair-defense-offset, 18px)',
    );
    expect(tableCss).toContain('margin: 10px 0 0 var(--pair-defense-offset, 18px)');
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
      // T-96: the slot carries no inset border any more; the inner trump face
      // paints the single 2px gold ring at the full 100x140 footprint.
      expect(tableCss).toMatch(
        /\n\.card-slot\.trump\s*{[^}]*border: 0 solid var\(--trump-accent\);[^}]*box-shadow: none/,
      );
      expect(tableCss).toMatch(
        /\n\.playing-card\.trump-card\s*{[^}]*border: 2px solid var\(--trump-border, #f59e0b\)/,
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
    expect(rule).toContain('display: grid');
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
    // T-96: no slot border, so the trump face keeps its exact 100x140 size.
    const trumpSlot = cssRule(tableCss, '.card-slot.trump');
    expect(trumpSlot).toContain('border: 0 solid var(--trump-accent)');
    expect(trumpSlot).toContain('box-shadow: none');
    expect(cssRule(tableCss, '.trump-badge')).toContain('var(--trump-accent)');
  });

  it('tags Pass and Surrender with the shared icon-button family and muted accents', () => {
    render(<ActionBar legalActions={['pass', 'surrender']} onAction={() => {}} />);

    const pass = screen.getByTestId('pass-button');
    const surrender = screen.getByTestId('surrender-button');
    for (const button of [pass, surrender]) {
      expect(button.classList.contains('action-icon-btn')).toBe(true);
      expect(button.classList.contains('action-button')).toBe(true);
      expect(button.className).not.toContain('action-btn-pass');
      expect(button.className).not.toContain('action-btn-surrender');
      expect(button.className).not.toContain('red');
    }
    expect(pass.classList.contains('action-icon-pass')).toBe(true);
    expect(surrender.classList.contains('action-icon-surrender')).toBe(true);

    // The shared theme accents live in the stylesheet the bar imports.
    expect(actionIconsCss).toContain('--icon-accent: #7d9e83');
    expect(actionIconsCss).toContain('--icon-accent: #b98a5e');
    expect(actionIconsCss).not.toMatch(/#ef4444|#dc2626/);
  });

  /** T-90-feedback-20261105_221105-3 ITEM-6/7: no word on the button, only a
   *  theme-matched glyph that still names itself for assistive tech. */
  it('ITEM-6/7: renders icon-only Surrender and Pass buttons with no visible text', () => {
    render(<ActionBar legalActions={['pass', 'surrender']} onAction={() => {}} />);

    const surrender = screen.getByTestId('surrender-button');
    const pass = screen.getByTestId('pass-button');
    for (const [button, label, iconId, iconName] of [
      [surrender, 'Surrender', 'surrender-icon', 'surrender-hands-cards'],
      [pass, 'Pass', 'pass-icon', 'pass-wave-cards'],
    ] as const) {
      expect(button.tagName).toBe('BUTTON');
      expect(button.textContent).toBe('');
      expect(button.getAttribute('aria-label')).toBe(label);
      expect(button.getAttribute('title')).toBe(label);
      expect(button.classList.contains('action-icon-btn')).toBe(true);
      expect(within(button).getByTestId(iconId).getAttribute('data-icon')).toBe(iconName);
    }

    const surrenderIcon = within(surrender).getByTestId('surrender-icon');
    expect(surrenderIcon.querySelector('[data-icon-part="cards"]')).not.toBeNull();
    expect(surrenderIcon.querySelector('[data-icon-part="arrow-down"]')).not.toBeNull();
    expect(surrenderIcon.querySelector('[data-icon-part="raised-hands"]')).not.toBeNull();
    const passIcon = within(pass).getByTestId('pass-icon');
    expect(passIcon.querySelector('[data-icon-part="cards"]')).not.toBeNull();
    expect(passIcon.querySelector('[data-icon-part="pass-hand"]')).not.toBeNull();
    expect(passIcon.querySelector('[data-icon-part="arrow-pass"]')).not.toBeNull();

    // T-90-feedback-20261106_111512-2: the square size and theme live in the
    // stylesheet the bar imports — 40x40 desktop, 32x32 below 900px.
    expect(actionIconsCss).toMatch(
      /\.action-button\.action-icon-btn \{[^}]*width: 40px;[^}]*height: 40px;/,
    );
    expect(actionIconsCss).toMatch(
      /@media \(max-width: 900px\) \{[\s\S]*?\.action-button\.action-icon-btn[^{]*\{[^}]*width: 32px;[^}]*height: 32px;/,
    );
    expect(actionIconsCss).toMatch(/background: var\(--bg-elevated, rgba\(24, 34, 29, 0\.85\)\)/);
    expect(actionIconsCss).toMatch(/border: 1px solid var\(--durak-border, rgba\(214, 199, 170, 0\.34\)\)/);
    expect(actionIconsCss).toMatch(/border-radius: 8px/);
    expect(actionIconsCss).toMatch(/backdrop-filter: blur\(6px\)/);
    // The digit must not inherit the button's `font-size: 0; line-height: 0`,
    // or the countdown is drawn at 0px.
    expect(actionIconsCss).toMatch(
      /\.action-button\.action-icon-btn \.surrender-countdown \{[^}]*font-size: 11px;[^}]*line-height: 1;/,
    );
    // The hand glyphs are outlined palms with fingers and a thumb, not comb
    // strokes: two palms + fingers + thumb per raised hand, one flat hand.
    expect(surrenderIcon.querySelectorAll('[data-icon-part="raised-hands"] path')).toHaveLength(6);
    expect(passIcon.querySelectorAll('[data-icon-part="pass-hand"] path')).toHaveLength(4);
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
    expect(tableCss).toMatch(
      /\.target-outline\s*{[^}]*width: var\(--card-w, 100px\);[^}]*height: var\(--card-h, 140px\);/,
    );
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
    // T-96: the vertical padding is tight so a 1280x800 viewport fits.
    expect(arenaRule).toContain('padding: 8px 28px');
    // T-96: the felt layer pulls out through the padding, so the painted surface
    // fills the whole padding box instead of stopping 28px short on each side.
    expect(tableCss).toMatch(
      /\[data-zone='table-arena'\]::before\s*{[^}]*margin: -8px -28px;/,
    );
    // ... and the small-screen 12px inset is pulled out by the same amount.
    expect(tableCss).toMatch(
      /\[data-zone='table-arena'\]::before\s*{[^}]*margin: -12px;/,
    );
    expect(cssRule(tableCss, '.battlefield-tinted-box')).toContain(
      'clamp(182px, 20vh, 320px)',
    );
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
    // The dragged slot keeps the small-hand runway margin it started with.
    expect(parseFloat(wrappers[0].style.marginLeft)).toBeCloseTo(
      HAND_CARD_WIDTH * HAND_SMALL_HAND_PARTING_PAD_RATIO,
      5,
    );
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

  it('T-96: resting cards report direction none and pointerenter never parts the hand', () => {
    render(
      <GameTable
        myId="p0"
        myHand={hand}
        opponents={[fourPlayerOpponents[0]]}
        tablePairs={[]}
        trumpSuit="diamonds"
        defenderId="p1"
      />,
    );
    const handBox = screen.getByTestId('hand-turn-highlight') as HTMLElement;
    const wrappers = Array.from(
      handBox.querySelectorAll('.hand-card-wrapper'),
    ) as HTMLElement[];

    expect(wrappers.map((node) => node.getAttribute('data-part-delta-x'))).toEqual([
      '0',
      '0',
      '0',
    ]);
    expect(wrappers.map((node) => node.getAttribute('data-part-direction'))).toEqual([
      'none',
      'none',
      'none',
    ]);

    fireEvent.pointerEnter(handBox, { bubbles: true });
    const zone = document.querySelector('[data-zone="player-hand"]') as HTMLElement;
    expect(zone.getAttribute('data-parting-active')).toBe('false');
    expect(zone.getAttribute('data-hovered-card-index')).toBeNull();
    expect(wrappers.map((node) => node.getAttribute('data-part-direction'))).toEqual([
      'none',
      'none',
      'none',
    ]);
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
      defenderId: 'p1',
    } as const;

    // The viewer is the defender and nobody flagged a legal throw-in: the
    // outline and its slot are gone entirely.
    const view = render(<GameTable {...props} boutPhase="Defense" />);
    expect(screen.queryByTestId('throw-in-outline')).toBeNull();
    expect(screen.queryByTestId('throw-in-slot')).toBeNull();

    view.rerender(<GameTable {...props} boutPhase="Defense" canThrowIn />);
    const outline = screen.getByTestId('throw-in-outline');
    expect(outline.getAttribute('data-throw-in-enabled')).toBe('true');
    expect(outline.getAttribute('data-drop-zone')).toBe('throw-in');

    view.rerender(
      <GameTable {...props} boutPhase="GameOver" canThrowIn />,
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
    expect(boxRule).toContain('display: grid');
    expect(boxRule).toContain('padding: 0');
    expect(boxRule).toContain('overflow: visible');
    expect(boxRule).not.toMatch(/height:\s*(112|120)px/);
    expect(tableCss).toMatch(
      /\.hand-card-wrapper\s*{[^}]*width: var\(--hand-card-width, 100px\);[^}]*height: var\(--hand-card-height, 140px\);[^}]*flex: 0 0 var\(--hand-card-width, 100px\);/,
    );

    // ITEM-6b: a small hand rests at the larger default overlap and is centred
    // in its six-card box, so the reported row carries the parting runway.
    const layout = handLayout(3, 720, 0.5, HAND_CARD_WIDTH);
    expect(layout.overlap).toBeGreaterThan(HAND_MIN_OVERLAP);
    expect(rowWidth(layout, HAND_CARD_WIDTH)).toBe(layout.totalWidth);
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

  it('ITEM-1b/ITEM-1: hides the outline from the surrendering viewer and keeps a hidden spacer', () => {
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

    // The viewer is the defender, so they can never throw in: no outline at all.
    expect(screen.queryByTestId('throw-in-outline')).toBeNull();
    expect(screen.getByTestId('table-pairs-group').getAttribute('data-surrender-target')).toBe(
      'bottom',
    );

    const anchor = screen.getByTestId('surrender-throw-in-anchor');
    expect(anchor.getAttribute('data-placement')).toBe('above');
    expect(anchor.getAttribute('data-surrender-seat')).toBe('bottom');
    expect(anchor.getAttribute('data-outline-hidden')).toBe('true');
    expect(anchor.children).toHaveLength(0);

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
        attackerId="p0"
        defenderId="p1"
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
        block.includes('min-width: var(--card-w, 100px)'),
      ) ?? '';
    expect(sizeRule).not.toBe('');
    expect(sizeRule).toContain('flex: 0 0 var(--card-w, 100px)');
    expect(sizeRule).toContain('width: var(--card-w, 100px)');
    expect(sizeRule).toContain('height: var(--card-h, 140px)');
    expect(sizeRule).toContain('min-width: var(--card-w, 100px)');
    expect(sizeRule).toContain('max-width: var(--card-w, 100px)');
    expect(sizeRule).toContain('min-height: var(--card-h, 140px)');
    expect(sizeRule).toContain('max-height: var(--card-h, 140px)');
    expect(sizeRule).toContain('box-sizing: border-box');
    expect(sizeRule).toContain('margin: 0');
    expect(tableCss).toMatch(/@media \(max-width: 899px\) \{[^}]*\.throw-in-outline \{[^}]*width: 48px;/);

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
          defenderId="p1"
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

    // ITEM-1: the outline survives only for an opponent of the defender.
    for (const scenario of [{ defenderId: 'p1', placement: 'below' }]) {
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
    for (const scenario of [{ defenderId: 'p1', placement: 'below' }]) {
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
        defenderId="p1"
        canRedirect
        canThrowIn
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
      /@media \(max-width: 899px\)[\s\S]*?\.card-slot\s*{[^}]*--card-width: 48px;[^}]*--card-height: 68px;/,
    );
  });

  it('T-95: cards, hand slots and both outlines share size, radius and no-shrink rules', () => {
    // Desktop: every card-sized box resolves the same 100x140 footprint and the
    // same Roundness-driven border radius as the outlines it is dragged onto.
    const cardBlock = cssRule('.card-slot');
    for (const declaration of [
      'width: var(--card-width, 100px)',
      'height: var(--card-height, 140px)',
      'min-width: var(--card-width, 100px)',
      'min-height: var(--card-height, 140px)',
      'flex: 0 0 var(--card-width, 100px)',
      'border-radius: var(--app-roundness, 8px)',
    ]) {
      expect(cardBlock, '.card-slot').toContain(declaration);
    }

    const throwInBlock =
      (tableCss.match(/\.throw-in-outline \{[^}]*\}/g) ?? []).find((block) =>
        block.includes('min-width: var(--card-width, 100px)'),
      ) ?? '';
    expect(throwInBlock).toContain('width: var(--card-width, 100px)');
    expect(throwInBlock).toContain('height: var(--card-height, 140px)');
    expect(throwInBlock).toContain('flex: 0 0 var(--card-width, 100px)');
    expect(throwInBlock).toContain('border-radius: var(--app-roundness, 8px)');

    for (const selector of ['.target-outline', '.redirect-outline']) {
      const start = tableCss.indexOf(`\n${selector} {`);
      const rule = tableCss.slice(start, tableCss.indexOf('}', start));
      expect(rule, selector).toContain('width: var(--card-width, 100px)');
      expect(rule, selector).toContain('height: var(--card-height, 140px)');
      expect(rule, selector).toContain('border-radius: var(--app-roundness, 8px)');
    }
    expect(cssRule('.redirect-outline')).toContain('flex: 0 0 auto');

    // The hand and the play area read the same card tokens, so a hand or table
    // card can never render smaller than the outline it is dropped on.
    const handZoneRule =
      (tableCss.match(/\[data-zone='player-hand'\] \{[^}]*\}/g) ?? []).find((block) =>
        block.includes('--hand-card-width: var(--card-width'),
      ) ?? '';
    expect(handZoneRule).toContain('--hand-card-width: var(--card-width, 100px)');
    expect(handZoneRule).toContain('--hand-card-height: var(--card-height, 140px)');
    expect(cssRule('.hand-card-wrapper')).toContain(
      'flex: 0 0 var(--hand-card-width, 100px)',
    );
    expect(cssRule('.throw-in-slot')).toContain('flex: 0 0 auto');

    // Below 900px every card-sized box steps down to 48x68 at the SAME 899px
    // breakpoint the JS and the root card tokens use, so exactly 900px renders
    // desktop cards and would never pair a 100px card with a 48px outline.
    expect(tableCss).not.toMatch(/@media \(max-width: 900px\)/);
    expect(tableCss).toMatch(
      /@media \(max-width: 899px\)[\s\S]*?:root\s*{[^}]*--card-w: 48px;[^}]*--card-h: 68px;/,
    );
    expect(tableCss).toMatch(
      /@media \(max-width: 899px\)[\s\S]*?\.card-slot\s*{[^}]*--card-width: 48px;[^}]*--card-height: 68px;/,
    );
    expect(tableCss).toMatch(
      /@media \(max-width: 899px\)[\s\S]*?\.throw-in-outline\s*{[^}]*width: 48px;[^}]*height: 68px;/,
    );
    expect(tableCss).toMatch(
      /@media \(max-width: 899px\)[\s\S]*?\.target-outline,\s*\.redirect-outline\s*{[^}]*width: 48px;[^}]*height: 68px;/,
    );
    expect(cardSizeForViewport(899)).toEqual({
      width: MOBILE_CARD_WIDTH,
      height: MOBILE_CARD_HEIGHT,
    });
    expect(cardSizeForViewport(900)).toEqual({ width: CARD_WIDTH, height: CARD_HEIGHT });
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

    // A very wide column still uses the Item 6b small-hand resting overlap.
    expect(handLayout(4, 2000).overlapRatio).toBeCloseTo(
      HAND_SMALL_HAND_OVERLAP_RATIO,
      5,
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
    const box = screen.getByTestId('hand-turn-highlight') as HTMLElement;
    expect(Number(box.getAttribute('data-overlap-ratio'))).toBeCloseTo(
      handLayout(3, 720).overlapRatio,
      5,
    );
    expect(Number(box.getAttribute('data-overlap-px'))).toBeCloseTo(
      handLayout(3, 720).overlap,
      5,
    );
    const smallStep = HAND_CARD_WIDTH * (1 - HAND_SMALL_HAND_OVERLAP_RATIO);
    expect(Number(box.getAttribute('data-stride-px'))).toBeCloseTo(smallStep, 5);
    // Three cards centred in the four-hundred-and-twenty-pixel default box:
    // a 32px runway each side around two 64px strides and the 100px card.
    expect(Number(box.getAttribute('data-hand-width'))).toBe(292);
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
      layout.totalWidth,
    );

    // The raised middle card steps the outline up and back down tightly.
    const d = path.getAttribute('d') ?? '';
    expect(d.length).toBeGreaterThan(0);
    expect(contour.getAttribute('data-contour-shape')).toBe('stepped');
    // 4px of tight padding above the -14px raised card, placed with a grid-safe
    // margin instead of absolute positioning.
    expect(parseFloat(contour.style.marginTop)).toBe(HAND_RAISED_OFFSET - 4);
    expect(contour.style.top).toBe('');

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
    // T-95-audit-gap-20261122_203506-1: the card's exact centre is locked to
    // the pointer (130, 60), independent of the (10, 20) grab point. The
    // translate is relative to the 32px small-hand runway: 130 - 50 - 32 = 48
    // and 60 - 70 = -10.
    expect(wrapper.style.transform).toBe('translate3d(48px, -10px, 0)');

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
    expect(cardSizeForViewport(MOBILE_BREAKPOINT_PX - 1)).toEqual({
      width: MOBILE_CARD_WIDTH,
      height: MOBILE_CARD_HEIGHT,
    });
    // ITEM-2: `>= 900px` is desktop, matching the CSS breakpoint.
    expect(cardSizeForViewport(MOBILE_BREAKPOINT_PX)).toEqual({
      width: CARD_WIDTH,
      height: CARD_HEIGHT,
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
      /@media \(max-width: 899px\)[\s\S]*?--hand-card-width: 48px;[\s\S]*?--hand-card-height: 68px;/,
    );
    expect(tableCss).toMatch(
      /@media \(max-width: 899px\)[\s\S]*?\.hand-card-wrapper,\s*\.bout-card,\s*\.bout-pair\s*{[^}]*min-width: 48px;[^}]*min-height: 68px;/,
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
    // T-90-feedback-5 ITEM-5a/5b: the 52-card row compresses inside the maximal
    // box at full card size; it is never scaled down.
    const stride = Number(box.getAttribute('data-stride-px'));
    const totalWidth = Number(box.getAttribute('data-hand-width'));
    expect(Number(box.getAttribute('data-fit-scale'))).toBe(1);
    expect(stride).toBeGreaterThan(0);
    expect(totalWidth).toBeGreaterThanOrEqual(100);
    expect(totalWidth).toBeLessThanOrEqual(HAND_FALLBACK_WIDTH + 1e-9);
    expect(Number(box.getAttribute('data-rendered-hand-width'))).toBe(totalWidth);
    expect(box.style.width).toBe(`${Math.round(totalWidth)}px`);
    expect(box.style.transform).toBe('');

    // `data-hand-width` and the contour share the same full-size row space.
    const contour = screen.getByTestId('hand-highlight-contour');
    expect(Number(contour.getAttribute('data-contour-width'))).toBe(totalWidth);
    expect(Number(contour.getAttribute('data-contour-rendered-width'))).toBe(
      totalWidth,
    );

    const cards = Array.from(box.querySelectorAll('.hand-card-wrapper')) as HTMLElement[];
    expect(cards).toHaveLength(fullDeck.length);
    expect(Number(cards[fullDeck.length - 1].getAttribute('data-card-x'))).toBeCloseTo(
      (fullDeck.length - 1) * stride,
      0,
    );
    // ITEM-4g: every slot reports its vertical offset.
    for (const card of cards) expect(card.getAttribute('data-card-y')).toBe('0');
    for (const card of cards) {
      const slot = card.querySelector('.card-slot') as HTMLElement;
      expect(slot.getAttribute('data-card-width')).toBe(String(CARD_WIDTH));
      expect(slot.getAttribute('data-card-height')).toBe(String(CARD_HEIGHT));
    }

    // ITEM-3: the dragged card tracks the pointer 1:1 at full size — there is
    // no fit scale left to counter-scale.
    fireEvent.mouseDown(within(cards[0]).getByLabelText('six of spades'), {
      button: 0,
      clientX: 10,
      clientY: 20,
    });
    fireEvent.mouseMove(document, { clientX: 70, clientY: 50 });
    // T-95-audit-gap-20261122_203506-1: the 52-card row starts at x = 0, so the
    // centre-locked translate is `70 - 50` / `50 - 70` — no grab offset.
    expect(cards[0].style.transform).toBe('translate3d(20px, -20px, 0)');
    expect(cards[0].style.transformOrigin).toBe('');
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
    // Three cards: 32px runway + two 64px strides + the 100px card + 32px.
    expect(Number(box.getAttribute('data-hand-width'))).toBe(292);

    fireEvent.mouseDown(screen.getByLabelText('six of spades'), {
      button: 0,
      clientX: 10,
      clientY: 20,
    });
    fireEvent.mouseMove(document, { clientX: 400, clientY: 900 });

    // The dragged card floats under the pointer, so the hand (and the contour)
    // wrap the compacted two-card row: 32px runway + 164px + 32px = 228px.
    expect(box.getAttribute('data-gap-closed')).toBe('true');
    expect(Number(box.getAttribute('data-hand-width'))).toBe(228);
    const contour = screen.getByTestId('hand-highlight-contour');
    const path = screen.getByTestId('hand-highlight-path');
    expect(Number(contour.getAttribute('data-contour-width'))).toBe(228);
    const d = path.getAttribute('d') ?? '';
    // The rounded Wave-1 path uses `L` / `A` corners instead of square `H` / `V`
    // commands; its width is the two cards plus the 4px padding on each side.
    expect(d.length).toBeGreaterThan(0);
    expect(d).toContain(String(164 + 8));
    expect(Number(contour.getAttribute('width'))).toBe(164 + 8);

    fireEvent.mouseUp(document, { clientX: 400, clientY: 900 });
    expect(Number(screen.getByTestId('hand-turn-highlight').getAttribute('data-hand-width'))).toBe(
      292,
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
  it('T-95 #3: scales a mobile full deck instead of exceeding the 80% overlap cap', () => {
    const layout = handLayout(36, 300, 0.5, MOBILE_CARD_WIDTH);
    // 20% of 48px is 9.6px, so the whole row scales down rather than packing
    // the cards tighter than the readable strip allows.
    expect(layout.stride).toBeCloseTo(MOBILE_CARD_WIDTH * HAND_MIN_OVERLAP_RATIO, 5);
    expect(layout.overlapRatio).toBeCloseTo(HAND_MAX_OVERLAP_RATIO, 5);
    expect(layout.stride).toBeLessThan(HAND_MIN_VISIBLE_LEFT);
    expect(layout.scale).toBeLessThan(1);
    expect(layout.totalWidth * layout.scale).toBeCloseTo(300, 5);
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
    // ITEM-8: the tier lift lives on the wrapper (transform), never on the card
    // itself, so hover and the tight contour stay in sync.
    expect(cssRule('.hand-cards .card-slot.legal-playable')).toContain(
      'transform: none',
    );
    expect(cssRule('.hand-cards .card-slot.selected')).toContain('transform: none');
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

describe('T-90-feedback-20261106_111512-3: throw-in gate, card tokens, drag visibility', () => {
  const bob: OpponentSummary = { id: 'p1', name: 'Bob', cardCount: 4, hasPassed: false, finishRank: null };
  const pairs: TablePairData[] = [{ attack: { suit: 'spades', rank: 'seven' }, defense: null }];
  const base = {
    myId: 'p0', myHand: hand, opponents: [bob], tablePairs: pairs, trumpSuit: 'clubs',
    // T-90-feedback ITEM-1: the viewer is an opponent of the defender here, so
    // the legal throw-in conditions are the only thing under test.
    attackerId: 'p1', defenderId: 'p1', boutPhase: 'Defense',
  };
  const renderGate = (overrides: Partial<Parameters<typeof GameTable>[0]> = {}) =>
    render(<GameTable {...base} canThrowIn {...overrides} />);

  it('hides the outline unless canThrowIn is exactly true', () => {
    const shown = renderGate();
    expect(screen.getByTestId('throw-in-outline')).toBeTruthy();
    shown.unmount();
    for (const overrides of [{ canThrowIn: false }, { canThrowIn: false, defending: true }]) {
      const view = renderGate(overrides);
      expect(screen.queryByTestId('throw-in-outline')).toBeNull();
      expect(document.querySelector('[data-drop-zone="throw-in"]')).toBeNull();
      view.unmount();
    }
    const missing = render(<GameTable {...base} />);
    expect(screen.queryByTestId('throw-in-outline')).toBeNull();
    missing.unmount();
  });

  it('keeps an empty hidden spacer instead of the surrendered outline', () => {
    renderGate({ boutPhase: 'SurrenderThrowIn', defenderId: 'p1', canThrowIn: false });
    expect(screen.queryByTestId('throw-in-outline')).toBeNull();
    const anchor = screen.getByTestId('surrender-throw-in-anchor');
    expect(anchor.getAttribute('data-outline-hidden')).toBe('true');
    expect(anchor.getAttribute('aria-hidden')).toBe('true');
    expect(anchor.style.visibility).toBe('hidden');
    expect(anchor.getAttribute('data-drop-zone')).toBeNull();
    expect(anchor.children).toHaveLength(0);
  });

  it('applies the gate in every opponent surrender position', () => {
    for (const [defenderId, boutPhase, position] of [
      ['p1', 'Defense', 'inline'],
      ['p1', 'SurrenderThrowIn', 'below'],
    ] as const) {
      const view = renderGate({ defenderId, boutPhase });
      const outline = screen.getByTestId('throw-in-outline');
      expect(outline.getAttribute('data-surrender-outline-position')).toBe(position);
      view.unmount();
    }
    // ITEM-1: the surrendered defender can never play into the outline.
    const defenderView = renderGate({ defenderId: 'p0', boutPhase: 'SurrenderThrowIn' });
    expect(screen.queryByTestId('throw-in-outline')).toBeNull();
    defenderView.unmount();
  });

  it('sizes cards and outlines from the same tokens and never shrinks them', () => {
    expect(tableCss).toMatch(/:root\s*{[^}]*--card-w: 100px;[^}]*--card-h: 140px;/);
    expect(tableCss).toMatch(/@media \(max-width: 899px\)\s*{\s*:root\s*{[^}]*--card-w: 48px;[^}]*--card-h: 68px;/);
    const block = (selector: string): string => {
      const escaped = selector.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
      return tableCss.match(new RegExp(`(?:^|\\n)${escaped} \\{([^}]*)\\}`))?.[1] ?? '';
    };
    for (const selector of ['.card-slot', '.target-outline', '.redirect-outline']) {
      expect(block(selector), selector).toMatch(/var\(--card-w, 100px\)/);
      expect(block(selector), selector).toMatch(/var\(--card-h, 140px\)/);
    }
    const throwIn = (tableCss.match(/\.throw-in-outline \{[^}]*\}/g) ?? []).find((b) => b.includes('max-width')) ?? '';
    expect(throwIn).toContain('var(--card-w, 100px)');
    expect(throwIn).toContain('var(--card-h, 140px)');
    expect(block('.table-pairs-group')).toContain('flex-wrap: nowrap');
    expect(block('.table-bout-row')).toContain('flex-wrap: nowrap');
    expect(block('.table-pairs-group')).toMatch(/gap: 0;/);
    expect(block('.playing-card')).toContain('width: 100%');
    expect(block('.playing-card')).toContain('height: 100%');
    expect(block('.card-slot')).not.toMatch(/transform:\s*scale\(/);
  });

  it('suppresses the native drag ghost and paints the center-locked preview', () => {
    render(<GameTable {...base} tablePairs={[]} defenderId="p1" onReorderHand={vi.fn()} />);
    const card = screen.getByLabelText('king of clubs').closest('.card-slot') as HTMLElement;
    const wrapper = card.closest('.hand-card-wrapper') as HTMLElement;
    const setDragImage = vi.fn();
    // A real grab pre-captures the point on mousedown. jsdom's `dragstart` has
    // no coordinates, so it must not discard the pre-captured point.
    fireEvent.mouseDown(card, { button: 0, clientX: 60, clientY: 90 });
    fireEvent.dragStart(card, {
      dataTransfer: { setData: vi.fn(), setDragImage, effectAllowed: 'move' },
    });
    expect(setDragImage).toHaveBeenCalledTimes(1);
    const [image, offsetX, offsetY] = setDragImage.mock.calls[0];
    // ITEM-3: a cached 1x1 transparent image replaces the offset-prone ghost.
    expect(image).not.toBe(card);
    expect((image as HTMLCanvasElement).width).toBe(1);
    expect((image as HTMLCanvasElement).height).toBe(1);
    expect(offsetX).toBe(0);
    expect(offsetY).toBe(0);

    // The center-locked preview is the visible dragged card.
    const preview = screen.getByTestId('drag-card-preview');
    const width = Number(preview.getAttribute('data-card-width'));
    const height = Number(preview.getAttribute('data-card-height'));
    expect(width).toBe(100);
    expect(height).toBe(140);

    const readCenter = (): { x: number; y: number } => {
      const [translateX, translateY] = (
        preview.style.transform.match(
          /translate3d\((-?[\d.]+)px, (-?[\d.]+)px, 0\)/,
        ) ?? []
      )
        .slice(1)
        .map(Number);
      return { x: translateX + width / 2, y: translateY + height / 2 };
    };

    // Before any `dragover`, the preview is already centred on the grab point.
    expect(readCenter()).toEqual({ x: 60, y: 90 });

    // The window-level dragover listener then keeps its centre on the pointer.
    window.dispatchEvent(new window.MouseEvent('dragover', { clientX: 200, clientY: 220 }));
    expect(readCenter()).toEqual({ x: 200, y: 220 });

    // The source card stays connected and fully painted behind the preview.
    expect(document.body.contains(card)).toBe(true);
    expect(wrapper.isConnected).toBe(true);
    expect(card.style.opacity).not.toBe('0');
    expect(card.style.visibility).not.toBe('hidden');
    expect(card.style.display).not.toBe('none');
    expect(wrapper.className).not.toContain('dragging-hidden');
    expect(wrapper.getAttribute('data-drag-hidden')).toBeNull();

    // `dragend` dismisses the floating preview cleanly.
    fireEvent.dragEnd(card);
    expect(screen.queryByTestId('drag-card-preview')).toBeNull();
  });
});

describe('T-90-feedback-20261122_011021-4: live table wiring', () => {
  const bobSeat: OpponentSummary = {
    id: 'p1',
    name: 'Bob',
    cardCount: 4,
    hasPassed: false,
    finishRank: null,
  };
  const baseProps = {
    myId: 'p0',
    myHand: hand,
    opponents: [bobSeat],
    tablePairs: [{ attack: { suit: 'spades', rank: 'seven' }, defense: null }],
    trumpSuit: 'clubs',
    attackerId: 'p1',
    defenderId: 'p1',
    boutPhase: 'Defense',
  };
  const cssBlock = (selector: string): string => {
    const start = tableCss.indexOf(`\n${selector} {`);
    if (start < 0) return '';
    return tableCss.slice(start, tableCss.indexOf('}', start));
  };

  it('ITEM-1: hides the outline unless every throw-in precondition holds', () => {
    const shown = render(<GameTable {...baseProps} canThrowIn />);
    expect(screen.getByTestId('throw-in-outline')).toBeTruthy();
    shown.unmount();

    const blocked: Array<Partial<Parameters<typeof GameTable>[0]>> = [
      { canThrowIn: false },
      { defenderId: 'p0' },
      { myHasPassed: true },
      { throwInCards: [] },
      { throwInCapacity: 0 },
      // T-95 #1: a bout at its six-pair cap has no throw-in slot left.
      {
        tablePairs: Array.from({ length: 6 }, () => ({
          attack: { suit: 'spades', rank: 'seven' },
          defense: null,
        })),
      },
    ];
    for (const overrides of blocked) {
      const view = render(<GameTable {...baseProps} canThrowIn {...overrides} />);
      expect(screen.queryByTestId('throw-in-outline')).toBeNull();
      expect(document.querySelector('[data-drop-zone="throw-in"]')).toBeNull();
      view.unmount();
    }
  });

  it('ITEM-2: exposes canonical card tokens and sizes every card box from them', () => {
    expect(tableCss).toMatch(
      /:root\s*{[^}]*--card-width: 100px;[^}]*--card-height: 140px;[^}]*--card-radius: 10px;/,
    );
    expect(tableCss).toMatch(
      /@media \(max-width: 899px\)\s*{\s*:root\s*{[^}]*--card-width: 48px;[^}]*--card-height: 68px;[^}]*--card-radius: 6px;/,
    );
    for (const selector of ['.target-outline', '.redirect-outline']) {
      const block = cssBlock(selector);
      expect(block).toContain('var(--card-width, 100px)');
      expect(block).toContain('var(--card-height, 140px)');
    }
    const throwInBlock =
      (tableCss.match(/\.throw-in-outline \{[^}]*\}/g) ?? []).find((block) =>
        block.includes('min-width'),
      ) ?? '';
    expect(throwInBlock).toContain('var(--card-width, 100px)');
    expect(throwInBlock).toContain('var(--card-height, 140px)');
  });

  it('ITEM-3: stacks the contour over the hand row in one grid cell', () => {
    expect(cssBlock('.hand-cards')).toContain('display: grid');
    const contourRule = cssBlock('.hand-highlight-contour');
    expect(contourRule).toContain('grid-area: 1 / 1');
    expect(contourRule).not.toContain('position: absolute');

    const { unmount } = render(<GameTable {...baseProps} canThrowIn />);
    const contour = screen.getByTestId('hand-highlight-contour');
    expect(contour.getAttribute('data-contour-shape')).toBe('uniform');
    expect(contour.parentElement?.classList.contains('hand-cards')).toBe(true);
    // The contour is a sibling grid layer of the row, never an absolutely
    // positioned overlay.
    expect(contour.closest('.hand-row')).toBeNull();
    unmount();

    render(
      <GameTable
        {...baseProps}
        canThrowIn
        playableKeys={[`${hand[0].suit.toLowerCase()}:${hand[0].rank.toLowerCase()}`]}
      />,
    );
    expect(screen.getByTestId('hand-highlight-contour').getAttribute('data-contour-shape')).toBe(
      'stepped',
    );
  });

  it('ITEM-6/7/8: never renders a Throw In button', () => {
    render(<GameTable {...baseProps} canThrowIn />);
    expect(screen.queryByText('Throw In')).toBeNull();
    expect(screen.queryByRole('button', { name: /throw in/i })).toBeNull();
  });

  it('ITEM-3/ITEM-6: selected throw-in cards lift the contour into a stepped shape', () => {
    const selectedKey = `${hand[0].suit.toLowerCase()}:${hand[0].rank.toLowerCase()}`;
    render(<GameTable {...baseProps} canThrowIn selectedKeys={[selectedKey]} />);

    expect(screen.getByTestId('hand-highlight-contour').getAttribute('data-contour-shape')).toBe(
      'stepped',
    );
    expect(document.querySelectorAll('.hand-card-wrapper[data-selected="true"]')).toHaveLength(1);
    // The lifted card sits at the shared raise offset used by the contour.
    expect(
      document.querySelector('.hand-card-wrapper[data-selected="true"]')?.getAttribute('data-card-y'),
    ).toBe(String(HAND_SELECTED_RAISED_OFFSET));
  });

  it('ITEM-7/8: renders compact icon-only controls with exact accessible names', () => {
    render(<ActionBar legalActions={['pass', 'surrender']} onAction={() => {}} />);

    for (const [testId, label, iconId] of [
      ['surrender-button', 'Surrender', 'surrender-icon'],
      ['pass-button', 'Pass', 'pass-icon'],
    ] as const) {
      const button = screen.getByTestId(testId);
      expect(button.getAttribute('aria-label')).toBe(label);
      expect(button.getAttribute('title')).toBe(label);
      expect(button.textContent).toBe('');
      expect(button.querySelector(`[data-testid="${iconId}"]`)).not.toBeNull();
      expect(button.classList.contains('action-icon-btn')).toBe(true);
      expect(button.closest('[data-zone="player-controls"]') ?? button).toBeTruthy();
    }
  });
});

describe('T-90-feedback-20261122_171451-6 ITEM-4/ITEM-7: tabletimer clearance & lower-table controls', () => {
  const rule = (selector: string): string => cssRule(tableCss, selector);

  const renderWithControls = (onAction: (action: { type: string }) => void = () => {}) =>
    render(
      <GameTable
        myId="p0"
        myHand={hand}
        opponents={opponents}
        tablePairs={tablePairs}
        trumpSuit="diamonds"
        attackerId="p1"
        defenderId="p0"
      >
        <ActionBar legalActions={['pass', 'surrender']} onAction={onAction} />
      </GameTable>,
    );

  it('ITEM-7: renders Surrender and Pass in the lower table band, not the bottom-right corner', () => {
    const { container } = renderWithControls();

    const controls = container.querySelector('[data-zone="player-controls"]') as HTMLElement;
    expect(controls).not.toBeNull();
    expect(controls.getAttribute('data-placement')).toBe('lower-table-controls');
    // A direct child of the felt arena: never inside the hand, the deck or the
    // hand-sort corner box.
    expect(controls.parentElement?.getAttribute('data-zone')).toBe('table-arena');
    expect(controls.closest('[data-zone="player-hand"]')).toBeNull();
    expect(controls.closest('[data-zone="table-deck"]')).toBeNull();
    expect(controls.closest('[data-zone="hand-sort-box"]')).toBeNull();
    expect(controls.querySelector('.sort-bar')).toBeNull();

    // Icon-only, themed, and both wired into the same band.
    const bar = within(controls).getByTestId('action-bar');
    expect(bar.getAttribute('data-placement')).toBe('lower-table-controls');
    for (const testId of ['surrender-button', 'pass-button']) {
      const button = within(controls).getByTestId(testId);
      expect(button.textContent).toBe('');
      expect(button.classList.contains('action-icon-btn')).toBe(true);
      expect(bar.contains(button)).toBe(true);
    }

    // The band owns the full-width Row 4 track, after the hand row.
    const controlsRule = rule("[data-zone='player-controls']");
    expect(controlsRule).toContain('grid-column: 1 / -1;');
    expect(controlsRule).toContain('grid-row: 4;');
    expect(controlsRule).toContain('justify-content: center;');
    expect(controlsRule).toContain('gap: 12px;');
    expect(controlsRule).toContain('min-width: 0;');
    expect(controlsRule).toContain('box-sizing: border-box;');
    expect(controlsRule).not.toContain('position: absolute');
    expect(controlsRule).not.toContain('position: fixed');
    // The old bottom-right corner placement is gone for good.
    expect(controlsRule).not.toContain('grid-column: 3;');
    expect(tableCss).not.toMatch(
      /\[data-zone='player-controls'\]\s*{[^}]*grid-row:\s*3;/,
    );

    // Row 3 is the hand's alone, so a maximal hand never meets a neighbour.
    const handRule = rule("[data-zone='player-hand']");
    expect(handRule).toContain('grid-column: 1 / -1;');
    expect(handRule).toContain('grid-row: 3;');
    expect(rule("[data-zone='table-arena']")).toContain('var(--actions-row-height)');
  });

  it('ITEM-4: gives the timer its own track with explicit clearance above raised cards', () => {
    const { container } = render(
      <GameTable
        myId="p0"
        myHand={hand}
        opponents={opponents}
        tablePairs={[]}
        trumpSuit="diamonds"
        attackerId="p0"
        defenderId="p1"
        awaitingAttack
        selectedKeys={hand.map(cardKey)}
        playableKeys={hand.map(cardKey)}
        turnPlayerId="p0"
      />,
    );

    const zone = container.querySelector('[data-zone="player-hand"]') as HTMLElement;
    const clock = within(zone).getByTestId('hand-clock');
    const cards = zone.querySelector('.hand-cards') as HTMLElement;

    // The timer is a sibling of the card stage — never inside the container that
    // carries the raise transform.
    expect(clock.parentElement).toBe(zone);
    expect(cards.parentElement).toBe(zone);
    expect(clock.nextElementSibling).toBe(cards);
    expect(cards.contains(clock)).toBe(false);
    expect(clock.getAttribute('data-slot')).toBe('hand-timer');

    // The stylesheet's clearance is driven by the SAME constants that raise the
    // cards, so the two can never be tuned apart.
    expect(zone.style.getPropertyValue('--hand-selected-lift')).toBe(
      `${-HAND_SELECTED_RAISED_OFFSET}px`,
    );
    expect(zone.style.getPropertyValue('--hand-contour-padding')).toBe(
      `${HAND_CONTOUR_PADDING}px`,
    );

    // Every card is fully raised inside the card stage.
    for (const wrapper of Array.from(zone.querySelectorAll('.hand-card-wrapper'))) {
      expect(wrapper.getAttribute('data-card-y')).toBe(String(HAND_SELECTED_RAISED_OFFSET));
    }

    const zoneRule = rule("[data-zone='player-hand']");
    // Two dedicated tracks: timer, then card stage.
    expect(zoneRule).toContain('grid-template-rows: auto auto;');
    expect(zoneRule).toContain('row-gap: calc(');
    expect(zoneRule).toContain('var(--hand-selected-lift, 18px)');
    expect(zoneRule).toContain('var(--hand-contour-padding, 4px)');
    expect(zoneRule).toContain('+ 2.5px + 8px');
    expect(zoneRule).not.toContain('position: absolute');
    // The clock and the stage are pinned to their own rows.
    expect(rule("[data-zone='player-hand'] > .hand-clock")).toContain('grid-row: 1;');
    expect(rule("[data-zone='player-hand'] > .hand-cards")).toContain('grid-row: 2;');

    // The reserved row gap (the timer -> card-stage clearance) covers the full
    // Tier 2 raise + contour pad + contour stroke + breathing room, measured
    // from the CSS fallbacks themselves, so a fully raised selected card and its
    // non-rectangular contour can never reach the clock track.
    const liftFallback = Number(
      /var\(--hand-selected-lift,\s*(\d+)px\)/.exec(zoneRule)?.[1],
    );
    const padFallback = Number(
      /var\(--hand-contour-padding,\s*(\d+)px\)/.exec(zoneRule)?.[1],
    );
    expect(liftFallback).toBe(-HAND_SELECTED_RAISED_OFFSET);
    expect(padFallback).toBe(HAND_CONTOUR_PADDING);
    const reservedGap = liftFallback + padFallback + 2.5 + 8;
    expect(reservedGap).toBeGreaterThanOrEqual(
      -HAND_SELECTED_RAISED_OFFSET + HAND_CONTOUR_PADDING + 2.5,
    );
    // ... and the hand row itself reserves the timer band clearance plus that
    // raise clearance (T-90-4 ITEM-4).
    const arenaRule = rule("[data-zone='table-arena']");
    expect(arenaRule).toContain('--hand-timer-clearance: 76px;');
    expect(arenaRule).toContain('--hand-row-height: calc(');
    expect(arenaRule).toContain('var(--hand-timer-clearance, 76px)');
    expect(64).toBeGreaterThan(-HAND_SELECTED_RAISED_OFFSET + 20);
  });

  it('ITEM-7: dispatches Surrender and Pass from the new lower-table location', () => {
    const onAction = vi.fn();
    renderWithControls(onAction);

    const surrender = screen.getByTestId('surrender-button');
    expect(surrender.closest('[data-zone="player-controls"]')).not.toBeNull();
    fireEvent.click(surrender);
    expect(onAction).toHaveBeenNthCalledWith(1, { type: 'declareSurrender' });

    const pass = screen.getByTestId('pass-button');
    expect(pass.closest('[data-zone="player-controls"]')).not.toBeNull();
    fireEvent.click(pass);
    expect(onAction).toHaveBeenNthCalledWith(2, { type: 'passTurn' });
    expect(onAction).toHaveBeenCalledTimes(2);
  });
});

describe('T-90-4 ITEM-1/ITEM-4: covered-pair edge collapsing and the turn-timer band', () => {
  const fourOpponents: OpponentSummary[] = [
    { id: 'p1', name: 'Bob', cardCount: 4, hasPassed: false, finishRank: null },
    { id: 'p2', name: 'Carol', cardCount: 4, hasPassed: false, finishRank: null },
    { id: 'p3', name: 'Dan', cardCount: 4, hasPassed: false, finishRank: null },
  ];

  const coveredThenUncovered: TablePairData[] = [
    { attack: { suit: 'spades', rank: 'six' }, defense: { suit: 'spades', rank: 'seven' } },
    { attack: { suit: 'clubs', rank: 'king' }, defense: null },
  ];

  /** Four seats: p1 top-left, p2 top-center, p3 top-right, p0 bottom. */
  const renderForDefender = (defenderId: string, pairs = coveredThenUncovered) =>
    render(
      <GameTable
        myId="p0"
        myHand={hand}
        opponents={fourOpponents}
        tablePairs={pairs}
        trumpSuit="diamonds"
        defenderId={defenderId}
      />,
    );

  it.each([
    { defenderId: 'p1', edge: 'left', seat: 'top-left' },
    { defenderId: 'p2', edge: 'left', seat: 'top-center' },
    { defenderId: 'p3', edge: 'right', seat: 'top-right' },
    { defenderId: 'p0', edge: 'left', seat: 'bottom' },
  ])(
    'ITEM-1b: snaps covered pairs to the $edge edge for the $seat defender',
    ({ defenderId, edge }) => {
      const { unmount } = renderForDefender(defenderId);

      const row = screen.getByTestId('table-bout-row');
      const stack = screen.getByTestId('covered-pairs-stack');
      const uncovered = screen.getByTestId('uncovered-pairs-row');

      expect(row.getAttribute('data-covered-edge')).toBe(edge);
      expect(stack.getAttribute('data-edge')).toBe(edge);
      expect(uncovered.querySelectorAll('.table-pair')).toHaveLength(1);
      // The covered pair has left the interactive row for good.
      expect(stack.querySelectorAll('.table-pair-covered-collapsed')).toHaveLength(1);
      expect(stack.querySelector('[data-drop-zone]')).toBeNull();

      if (edge === 'left') {
        expect(row.firstElementChild).toBe(stack);
        expect(row.lastElementChild).toBe(uncovered);
      } else {
        expect(row.firstElementChild).toBe(uncovered);
        expect(row.lastElementChild).toBe(stack);
        expect(cssRule(tableCss, ".covered-pairs-stack[data-edge='right']")).toContain(
          'margin-left: auto',
        );
      }

      const covered = Array.from(stack.querySelectorAll('.table-pair')) as HTMLElement[];
      expect(covered[0].style.zIndex).toBe('1');
      expect(covered[0].style.marginLeft).toBe('0px');
      unmount();
    },
  );

  it('ITEM-1c: maximally overlaps covered pairs while both rank strips stay visible', () => {
    const threeCovered: TablePairData[] = Array.from({ length: 3 }, () => ({
      attack: { suit: 'hearts', rank: 'ten' },
      defense: { suit: 'clubs', rank: 'jack' },
    }));
    renderForDefender('p1', [...threeCovered, { attack: { suit: 'spades', rank: 'six' }, defense: null }]);

    const stack = screen.getByTestId('covered-pairs-stack');
    // defence overhang (36) + index strip (36) = the documented 72px step.
    expect(Number(stack.getAttribute('data-step'))).toBe(72);
    const covered = Array.from(stack.querySelectorAll('.table-pair')) as HTMLElement[];
    expect(covered).toHaveLength(3);
    expect(covered[0].style.marginLeft).toBe('0px');
    for (const [index, pair] of covered.slice(1).entries()) {
      // coveredPairStep (72) - coveredPairWidth (136) = -64px overlap.
      expect(pair.style.marginLeft).toBe('-64px');
      expect(pair.style.zIndex).toBe(String(index + 2));
    }
  });

  it('ITEM-1d: submits the original attackIndex for uncovered cards after covered ones', () => {
    const onTableCardClick = vi.fn();
    const onCoverDrop = vi.fn();
    const mixed: TablePairData[] = [
      { attack: { suit: 'spades', rank: 'six' }, defense: { suit: 'spades', rank: 'seven' } },
      { attack: { suit: 'clubs', rank: 'king' }, defense: null },
      { attack: { suit: 'hearts', rank: 'ten' }, defense: { suit: 'hearts', rank: 'jack' } },
      { attack: { suit: 'diamonds', rank: 'nine' }, defense: null },
    ];
    render(
      <GameTable
        myId="p0"
        myHand={hand}
        opponents={fourOpponents}
        tablePairs={mixed}
        trumpSuit="diamonds"
        defenderId="p1"
        onTableCardClick={onTableCardClick}
        onCoverDrop={onCoverDrop}
      />,
    );

    const row = screen.getByTestId('uncovered-pairs-row');
    const attacks = Array.from(row.querySelectorAll('.table-pair-attack')) as HTMLElement[];
    expect(attacks).toHaveLength(2);
    expect(attacks[0].getAttribute('data-drop-zone')).toBe('cover:1');
    expect(attacks[1].getAttribute('data-drop-zone')).toBe('cover:3');

    fireEvent.click(attacks[1].querySelector('.card-slot') as HTMLElement);
    expect(onTableCardClick).toHaveBeenCalledWith(3);

    fireEvent.drop(attacks[1], { dataTransfer: { getData: () => 'spades:six' } });
    expect(onCoverDrop).toHaveBeenCalledWith({ suit: 'spades', rank: 'six' }, 3);
  });

  it('ITEM-4: keeps the turn timer in its dedicated band above the raised hand', () => {
    const { container } = render(
      <GameTable
        myId="p0"
        myHand={hand}
        opponents={fourOpponents}
        tablePairs={coveredThenUncovered}
        trumpSuit="diamonds"
        boutPhase="SurrenderThrowIn"
        defending
        isSurrenderingDefender
        defenderId="p0"
        selectedKeys={hand.map(cardKey)}
        playableKeys={[]}
        turnPlayerId="p0"
        turnSecondsRemaining={9}
      />,
    );

    const zone = container.querySelector('[data-zone="player-hand"]') as HTMLElement;
    const clock = screen.getByTestId('hand-clock');
    const cards = zone.querySelector('.hand-cards') as HTMLElement;

    // The timer band is the first, clearly separated row of the hand area.
    expect(zone.getAttribute('data-timer-band')).toBe('true');
    expect(zone.firstElementChild).toBe(clock);
    expect(clock.nextElementSibling).toBe(cards);
    expect(cards.contains(clock)).toBe(false);
    expect(clock.textContent).toBe('00:09');

    const zoneRule = cssRule(tableCss, "[data-zone='player-hand']");
    expect(zoneRule).toContain('padding: var(--hand-timer-clearance, 76px) 0 8px;');
    expect(zoneRule).toContain('row-gap: calc(');
    expect(zoneRule).not.toContain('position: absolute');

    // The band's top clearance exceeds the deepest surrendered-bout overhang.
    // A bottom surrender translates the pair box by `50% + 12px`, so the card
    // bottoms land at `12 (inner padding) + 140 (card) + 158 / 2 + 12` = 243px
    // below the tinted box's top edge — 61px past its 182px height.
    const pairBox = BOUT_CARD_HEIGHT + 18;
    const pastTintedBox = 12 + BOUT_CARD_HEIGHT + pairBox / 2 + 12 - 182;
    expect(pastTintedBox).toBe(61);
    // T-96: at the 1280x800 minimum the arena row gap is 8px, so the incoming
    // cards reach 53px into the hand row; the 76px clearance clears them.
    const surrenderOverhang = pastTintedBox - 8;
    expect(surrenderOverhang).toBe(53);
    expect(76).toBeGreaterThan(surrenderOverhang);

    // The incoming cards stay in the single-row bout area above the band.
    expect(screen.getByTestId('table-bout-row')).not.toBeNull();
    expect(screen.getByTestId('covered-pairs-stack')).not.toBeNull();
    expect(screen.getByTestId('uncovered-pairs-row').querySelectorAll('.table-pair')).toHaveLength(1);
    // ... and the contextual controls band never enters the timer band.
    expect(zone.querySelector('[data-zone="player-controls"]')).toBeNull();
    const controls = container.querySelector('[data-zone="player-controls"]');
    expect(controls).not.toBeNull();
    expect(zone.contains(controls)).toBe(false);
  });
});

/**
 * T-96-visual-qa: the uncovered `.table-pair` box and the desktop vertical
 * rhythm are measured against the SAME numbers `computeTableBoutLayout` uses,
 * so the DOM can never drift from the solver and the hand never slides below
 * the `1280x800` fold.
 */
describe('T-96: uncovered pair width and the 1280x800 viewport fit', () => {
  /** Evaluates a `clamp(min, vh, max)` track at a given viewport height. */
  const clampAt = (declarationText: string, viewportHeight: number): number => {
    const match = /clamp\(\s*([\d.]+)px,\s*([\d.]+)vh,\s*([\d.]+)px\s*\)/.exec(declarationText);
    expect(match, declarationText).not.toBeNull();
    const min = Number(match![1]);
    const vh = Number(match![2]);
    const max = Number(match![3]);
    return Math.min(max, Math.max(min, (vh * viewportHeight) / 100));
  };

  /** Raw value of one declaration inside a rule block. */
  const declaration = (ruleText: string, name: string): string => {
    const match = new RegExp(`(?:^|[;\\s])${name}:\\s*([^;]+);`).exec(ruleText);
    expect(match, name).not.toBeNull();
    return match![1].trim();
  };

  /** Block of the first rule whose selector is exactly `selector` on its line. */
  const ruleBlock = (selector: string): string => {
    const start = tableCss.indexOf(`\n${selector} {`);
    expect(start, selector).toBeGreaterThan(-1);
    const end = tableCss.indexOf('}', start);
    return tableCss.slice(start, end);
  };

  it('only reserves the defence overhang on covered pairs', () => {
    const pairRule = ruleBlock('.table-pair');
    // An uncovered pair is exactly one card wide: no horizontal reserve at all.
    expect(pairRule).toContain('padding: 0 0 var(--bout-card-offset, 18px) 0');
    expect(pairRule).not.toContain('padding: 0 var(--pair-defense-offset');
    expect(ruleBlock(".table-pair[data-covered='true']")).toContain(
      'padding-right: var(--pair-defense-offset, 36px)',
    );

    // The DOM widths now match the solver: `cardW` per uncovered slot,
    // `cardW + defenseOverhang` for a covered pair.
    expect(BOUT_DEFENSE_OVERHANG_RATIO * BOUT_CARD_WIDTH).toBe(
      CARD_INDEX_STRIP_WIDTH_PX,
    );
    expect(BOUT_CARD_WIDTH).toBe(100);
    expect(BOUT_CARD_WIDTH + CARD_INDEX_STRIP_WIDTH_PX).toBe(136);

    const { container } = render(
      <GameTable
        myId="p0"
        myHand={hand}
        opponents={activeOpponents}
        tablePairs={[
          { attack: { suit: 'spades', rank: 'six' }, defense: null },
          { attack: { suit: 'clubs', rank: 'nine' }, defense: null },
        ]}
        trumpSuit="diamonds"
        defenderId="p1"
      />,
    );

    const uncoveredPairs = Array.from(
      container.querySelectorAll('.table-pair'),
    ) as HTMLElement[];
    expect(uncoveredPairs).toHaveLength(2);
    for (const pair of uncoveredPairs) {
      expect(pair.getAttribute('data-covered')).toBe('false');
      // Both uncovered pairs share the one `cardWidth` the row was solved for.
      expect(Number(pair.getAttribute('data-card-width'))).toBe(BOUT_CARD_WIDTH);
    }
  });

  it('keeps the arena, the hand and the controls inside a 1280x800 viewport', () => {
    const VIEWPORT_HEIGHT = 800;
    // Real-Chromium measurement of the arena's top edge BEFORE T-96 trimmed the
    // header, so it is the conservative upper bound for the trimmed layout.
    const ARENA_TOP_PX = 127;

    const arenaRule = ruleBlock("[data-zone='table-arena']");
    const seatRow = clampAt(declaration(arenaRule, '--seat-row-height'), VIEWPORT_HEIGHT);
    const battlefield = clampAt(
      declaration(arenaRule, '--battlefield-height'),
      VIEWPORT_HEIGHT,
    );
    const actionsRow = clampAt(
      declaration(arenaRule, '--actions-row-height'),
      VIEWPORT_HEIGHT,
    );
    const gap = clampAt(declaration(arenaRule, 'gap'), VIEWPORT_HEIGHT);
    const padding = declaration(arenaRule, 'padding').split(/\s+/);
    const padTop = Number(padding[0].replace('px', ''));
    const padBottom = Number((padding[2] ?? padding[0]).replace('px', ''));

    // `calc(140px + 64px + 76px)` — card + clock/raise band + timer clearance.
    const handRow = (declaration(arenaRule, '--hand-row-height').match(/([\d.]+)px/g) ?? [])
      .map((value) => Number(value.replace('px', '')))
      .reduce((total, value) => total + value, 0);

    expect({ seatRow, battlefield, actionsRow, gap }).toEqual({
      seatRow: 116,
      battlefield: 182,
      actionsRow: 52,
      gap: 8,
    });
    expect(handRow).toBe(280);

    const arenaHeight =
      padTop + seatRow + gap + battlefield + gap + handRow + gap + actionsRow + padBottom;
    expect(arenaHeight).toBe(670);
    // The whole felt table ends above the fold.
    expect(ARENA_TOP_PX + arenaHeight).toBeLessThanOrEqual(VIEWPORT_HEIGHT);

    // The hand (a full 30+ card row, lifted/selected cards included) and the
    // Row 4 controls are both fully inside the viewport.
    const handZoneBottom = ARENA_TOP_PX + arenaHeight - padBottom - actionsRow - gap;
    const handRule = ruleBlock("[data-zone='player-hand']");
    expect(handRule).toContain('padding: var(--hand-timer-clearance, 76px) 0 8px;');
    const cardsBottom = handZoneBottom - 8;
    expect(cardsBottom).toBeLessThanOrEqual(VIEWPORT_HEIGHT);
    expect(handZoneBottom + gap + actionsRow).toBeLessThanOrEqual(VIEWPORT_HEIGHT);

    // ... and an incoming bottom-seat surrender still stops above the hand clock.
    const clearance = Number(/--hand-timer-clearance:\s*(\d+)px;/.exec(arenaRule)?.[1]);
    const surrenderOverhang = (BOUT_CARD_HEIGHT + 18) / 2 + 12 - 18 - gap;
    expect(clearance).toBe(76);
    expect(clearance).toBeGreaterThan(surrenderOverhang);

    // The header / shell gutters that buy the room stay trimmed.
    expect(cssRule(appCss, '.game-header')).toContain('padding: 6px 16px;');
    expect(cssRule(appCss, '.game-shell')).toContain('padding: 10px 16px 12px;');
  });
});

/**
 * T-95-audit-gap-20261122_203506-1: the dragged card's exact geometric centre —
 * never the pressed pixel — is locked to the pointer for BOTH drag paths: the
 * mouse hand-reorder drag (`.hand-card-wrapper[data-dragging='true']`) and the
 * HTML5 play-drag preview (`[data-testid="drag-card-preview"]`).
 */
describe('T-95-audit-gap-20261122_203506-1: center-locked card dragging', () => {
  const bobSeat: OpponentSummary = {
    id: 'p1',
    name: 'Bob',
    cardCount: 6,
    hasPassed: false,
    finishRank: null,
  };

  /** `count` unique cards, enough for the 30-card hands used below. */
  const makeHand = (count: number): CardData[] => {
    const suits = ['spades', 'hearts', 'clubs', 'diamonds'];
    const ranks = ['six', 'seven', 'eight', 'nine', 'ten', 'jack', 'queen', 'king', 'ace'];
    return Array.from({ length: count }, (_, index) => ({
      suit: suits[Math.floor(index / ranks.length) % suits.length],
      rank: ranks[index % ranks.length],
    }));
  };

  const renderHand = (count: number) =>
    render(
      <GameTable
        myId="p0"
        myHand={makeHand(count)}
        opponents={[bobSeat]}
        tablePairs={[]}
        trumpSuit="diamonds"
        defenderId="p1"
        onReorderHand={vi.fn()}
      />,
    );

  const wrappers = (container: Element): HTMLElement[] =>
    Array.from(container.querySelectorAll('.hand-card-wrapper')) as HTMLElement[];

  const translate = (value: string): { x: number; y: number } => {
    const match = value.match(/translate3d\((-?[\d.]+)px, (-?[\d.]+)px, 0\)/);
    return { x: match ? Number(match[1]) : Number.NaN, y: match ? Number(match[2]) : Number.NaN };
  };

  it('mouse reorder: locks the card centre to the pointer from every click point', () => {
    // Top-left corner, the visible 36px strip, dead centre and the bottom-right
    // corner of the SAME card, all released at the same pointer position.
    const clickPoints: Array<[number, number]> = [
      [5, 5],
      [18, 20],
      [50, 70],
      [95, 135],
    ];
    const pointer = { x: 500, y: 400 };

    for (const [offsetX, offsetY] of clickPoints) {
      const view = renderHand(6);
      const target = wrappers(view.container)[2];
      const card = target.querySelector('.card-slot') as HTMLElement;

      fireEvent.mouseDown(card, {
        button: 0,
        clientX: 200 + offsetX,
        clientY: 240 + offsetY,
      });
      fireEvent.mouseMove(document, { clientX: pointer.x, clientY: pointer.y });

      expect(target.getAttribute('data-dragging')).toBe('true');
      const { x, y } = translate(target.style.transform);
      const slotRestingOffsetX = Number(target.getAttribute('data-card-x'));
      // The wrapper's resting left inside the zero-origin jsdom hand box plus
      // its translate is the rendered left edge; its centre must be the pointer.
      expect(slotRestingOffsetX + x).toBeCloseTo(pointer.x - CARD_WIDTH / 2, 1);
      expect(y).toBeCloseTo(pointer.y - CARD_HEIGHT / 2, 5);

      fireEvent.mouseUp(document, { clientX: pointer.x, clientY: pointer.y });
      view.unmount();
    }
  });

  it('mouse reorder: centres the leftmost, middle and rightmost card of small and large hands', () => {
    const pointer = { x: 420, y: 380 };
    const cases: Array<{ count: number; indices: number[] }> = [
      // 6 cards keeps the 32px small-hand parting runway.
      { count: 6, indices: [0, 2, 5] },
      { count: 14, indices: [0, 7, 13] },
      { count: 30, indices: [0, 15, 29] },
    ];

    for (const { count, indices } of cases) {
      const view = renderHand(count);
      for (const index of indices) {
        const target = wrappers(view.container)[index];
        const card = target.querySelector('.card-slot') as HTMLElement;

        fireEvent.mouseDown(card, { button: 0, clientX: 60, clientY: 90 });
        fireEvent.mouseMove(document, { clientX: pointer.x, clientY: pointer.y });

        const { x, y } = translate(target.style.transform);
        const slotRestingOffsetX = Number(target.getAttribute('data-card-x'));
        // Zero index-dependent horizontal drift: the lane origin cancels out.
        expect(slotRestingOffsetX + x).toBeCloseTo(pointer.x - CARD_WIDTH / 2, 1);
        expect(y).toBeCloseTo(pointer.y - CARD_HEIGHT / 2, 5);

        fireEvent.mouseUp(document, { clientX: pointer.x, clientY: pointer.y });
      }
      view.unmount();
    }
  });

  it('play drag: the HTML5 preview stays centre-locked for every click point and index', () => {
    const pointer = { x: 520, y: 420 };
    const cases: Array<{ count: number; index: number; grab: [number, number] }> = [
      { count: 6, index: 0, grab: [5, 5] },
      { count: 6, index: 3, grab: [50, 70] },
      { count: 6, index: 5, grab: [95, 135] },
      { count: 14, index: 13, grab: [95, 135] },
    ];

    for (const { count, index, grab } of cases) {
      const view = renderHand(count);
      const card = wrappers(view.container)[index].querySelector('.card-slot') as HTMLElement;
      const grabPoint = { x: 100 + grab[0], y: 140 + grab[1] };

      // jsdom has no `DragEvent` coordinates, so a real grab pre-captures them.
      fireEvent.mouseDown(card, {
        button: 0,
        clientX: grabPoint.x,
        clientY: grabPoint.y,
      });
      fireEvent.dragStart(card, {
        dataTransfer: { setData: vi.fn(), setDragImage: vi.fn(), effectAllowed: 'move' },
      });

      // From `dragstart` onwards the preview is centred on the pointer, never
      // offset by the pressed pixel or the card index.
      const preview = screen.getByTestId('drag-card-preview') as HTMLElement;
      let previewTranslate = translate(preview.style.transform);
      expect(previewTranslate.x).toBeCloseTo(grabPoint.x - CARD_WIDTH / 2, 5);
      expect(previewTranslate.y).toBeCloseTo(grabPoint.y - CARD_HEIGHT / 2, 5);

      window.dispatchEvent(new window.MouseEvent('dragover', { clientX: pointer.x, clientY: pointer.y }));
      previewTranslate = translate(preview.style.transform);
      expect(previewTranslate.x).toBeCloseTo(pointer.x - CARD_WIDTH / 2, 5);
      expect(previewTranslate.y).toBeCloseTo(pointer.y - CARD_HEIGHT / 2, 5);

      fireEvent.dragEnd(card);
      expect(screen.queryByTestId('drag-card-preview')).toBeNull();
      view.unmount();
    }
  });
});

/**
 * T-96: the centre-locked drag preview must survive a re-drag (and the native
 * `dragend` the browser fires when our own handler cancels its native drag),
 * no native text selection may start from the hand, and hover-parting on the
 * 30-card compressed preset must never reverse.
 */
describe('T-96: re-drag reliability, selection lock and 30-card parting stability', () => {
  const bobSeat: OpponentSummary = {
    id: 'p1',
    name: 'Bob',
    cardCount: 6,
    hasPassed: false,
    finishRank: null,
  };

  const makeHand = (count: number): CardData[] => {
    const suits = ['spades', 'hearts', 'clubs', 'diamonds'];
    const ranks = ['six', 'seven', 'eight', 'nine', 'ten', 'jack', 'queen', 'king', 'ace'];
    return Array.from({ length: count }, (_, index) => ({
      suit: suits[Math.floor(index / ranks.length) % suits.length],
      rank: ranks[index % ranks.length],
    }));
  };

  const renderHand = (count: number) =>
    render(
      <GameTable
        myId="p0"
        myHand={makeHand(count)}
        opponents={[bobSeat]}
        tablePairs={[]}
        trumpSuit="diamonds"
        defenderId="p1"
        onReorderHand={vi.fn()}
      />,
    );

  const wrappers = (container: Element): HTMLElement[] =>
    Array.from(container.querySelectorAll('.hand-card-wrapper')) as HTMLElement[];

  const mockHandBox = (width: number): HTMLElement => {
    const box = screen.getByTestId('hand-turn-highlight') as HTMLElement;
    vi.spyOn(box, 'getBoundingClientRect').mockReturnValue({
      left: 0,
      top: 0,
      right: width,
      bottom: CARD_HEIGHT,
      width,
      height: CARD_HEIGHT,
      x: 0,
      y: 0,
      toJSON: () => ({}),
    } as DOMRect);
    return box;
  };

  const previewCenter = (): { x: number; y: number } => {
    const preview = screen.getByTestId('drag-card-preview') as HTMLElement;
    const width = Number(preview.getAttribute('data-card-width'));
    const height = Number(preview.getAttribute('data-card-height'));
    const match = preview.style.transform.match(
      /translate3d\((-?[\d.]+)px, (-?[\d.]+)px, 0\)/,
    );
    return {
      x: match ? Number(match[1]) + width / 2 : Number.NaN,
      y: match ? Number(match[2]) + height / 2 : Number.NaN,
    };
  };

  const draggingArena = (): HTMLElement =>
    document.querySelector('[data-zone="table-arena"]') as HTMLElement;

  it('cancels the native mouse default so no text selection can start', () => {
    const view = renderHand(6);
    const slot = wrappers(view.container)[2].querySelector('.card-slot') as HTMLElement;

    // `fireEvent` returns false once the handler calls `preventDefault()`.
    expect(fireEvent.mouseDown(slot, { button: 0, clientX: 120, clientY: 240 })).toBe(false);
    // The preview only appears after the 4px activation threshold.
    expect(screen.queryByTestId('drag-card-preview')).toBeNull();

    // The stylesheet locks the hand and the whole page during a drag.
    const wrapperRule = cssRule(tableCss, '.hand-card-wrapper {');
    expect(wrapperRule).toContain('user-select: none');
    expect(wrapperRule).toContain('-webkit-user-drag: none');
    const dragLock = tableCss.slice(tableCss.indexOf("html[data-dragging='true'],"));
    expect(dragLock).toContain('user-select: none !important');
    expect(dragLock).toContain('-webkit-user-select: none !important');
  });

  it('survives the dragend the browser fires after our own dragstart cancels it', () => {
    const view = renderHand(6);
    mockHandBox(600);
    const slot = wrappers(view.container)[2].querySelector('.card-slot') as HTMLElement;

    fireEvent.mouseDown(slot, { button: 0, clientX: 120, clientY: 240 });
    fireEvent.mouseMove(document, { clientX: 300, clientY: 320 });
    expect(screen.getByTestId('drag-card-preview')).toBeTruthy();

    // The wrapper / card `dragstart` suppresses the native drag; Chromium then
    // emits `dragend` straight away. That synthetic end must not tear down the
    // live pointer gesture, which is what produced "preview not found".
    fireEvent.dragStart(slot, {
      dataTransfer: { setData: vi.fn(), setDragImage: vi.fn(), effectAllowed: 'move' },
    });
    fireEvent.dragEnd(document);

    expect(screen.getByTestId('drag-card-preview')).toBeTruthy();
    expect(draggingArena().classList.contains('dragging')).toBe(true);
    expect(draggingArena().getAttribute('data-dragging')).toBe('true');

    fireEvent.mouseMove(document, { clientX: 360, clientY: 340 });
    const center = previewCenter();
    expect(Math.abs(center.x - 360)).toBeLessThanOrEqual(1);
    expect(Math.abs(center.y - 340)).toBeLessThanOrEqual(1);

    fireEvent.mouseUp(document, { clientX: 360, clientY: 340 });
    expect(screen.queryByTestId('drag-card-preview')).toBeNull();
  });

  it('opens the centre-locked preview again on every re-drag', () => {
    const view = renderHand(6);
    mockHandBox(600);
    const drags: Array<{ index: number; pointer: { x: number; y: number } }> = [
      { index: 1, pointer: { x: 220, y: 300 } },
      { index: 4, pointer: { x: 480, y: 360 } },
      { index: 0, pointer: { x: 160, y: 260 } },
    ];

    for (const { index, pointer } of drags) {
      const slot = wrappers(view.container)[index].querySelector('.card-slot') as HTMLElement;
      fireEvent.mouseDown(slot, { button: 0, clientX: 60, clientY: 200 });
      fireEvent.mouseMove(document, { clientX: pointer.x, clientY: pointer.y });

      const center = previewCenter();
      expect(Math.abs(center.x - pointer.x)).toBeLessThanOrEqual(1);
      expect(Math.abs(center.y - pointer.y)).toBeLessThanOrEqual(1);

      fireEvent.mouseUp(document, { clientX: pointer.x, clientY: pointer.y });
      expect(screen.queryByTestId('drag-card-preview')).toBeNull();
    }
  });

  it('resolves hover from the resting row so a 30-card sweep never reverses', () => {
    const view = renderHand(30);
    const box = mockHandBox(HAND_FALLBACK_WIDTH);
    const zone = document.querySelector('[data-zone="player-hand"]') as HTMLElement;
    const cards = wrappers(view.container);

    // Clear any hover so `data-card-x` below is the resting slot geometry.
    fireEvent.mouseLeave(zone);
    const restingPositions = cards.map((card) => Number(card.getAttribute('data-card-x')));
    const sweepEnd = restingPositions[restingPositions.length - 1] + CARD_WIDTH + 20;

    let previous = -1;
    let reversals = 0;
    const seen = new Set<number>();
    for (let x = 1; x <= sweepEnd; x += 3) {
      fireEvent.mouseMove(box, { clientX: x, clientY: 40 });
      const raw = zone.getAttribute('data-hovered-card-index');
      if (raw === null) continue;
      const index = Number(raw);
      if (index < previous) reversals += 1;
      expect(index).toBeGreaterThanOrEqual(previous);
      previous = index;
      seen.add(index);
    }

    expect(seen.size).toBe(30);
    expect(reversals).toBe(0);

    // The moved DOM never decides the target: an event dispatched on a card far
    // from the pointer still resolves to the resting slot under `clientX`.
    fireEvent.mouseLeave(zone);
    fireEvent.mouseMove(cards[2], {
      clientX: restingPositions[16] + 1,
      clientY: 40,
    });
    expect(zone.getAttribute('data-hovered-card-index')).toBe('16');
  });

  it('coalesces hover tracking through one rAF pass and ignores unchanged indices', async () => {
    const view = renderHand(14);
    const box = mockHandBox(HAND_FALLBACK_WIDTH);
    const zone = document.querySelector('[data-zone="player-hand"]') as HTMLElement;
    const cards = wrappers(view.container);
    fireEvent.mouseLeave(zone);

    const frames: FrameRequestCallback[] = [];
    const originalRaf = window.requestAnimationFrame;
    const originalCancel = window.cancelAnimationFrame;
    const rafWindow = window as unknown as {
      requestAnimationFrame: typeof requestAnimationFrame;
      cancelAnimationFrame: typeof cancelAnimationFrame;
    };
    rafWindow.requestAnimationFrame = ((callback: FrameRequestCallback) => {
      frames.push(callback);
      return frames.length;
    }) as typeof requestAnimationFrame;
    rafWindow.cancelAnimationFrame = (() => undefined) as typeof cancelAnimationFrame;

    try {
      const resting = cards.map((card) => Number(card.getAttribute('data-card-x')));
      const at = (index: number) => resting[index] + 1;

      // The first resolved index of a frame commits on the leading edge.
      fireEvent.mouseMove(box, { clientX: at(3), clientY: 40 });
      expect(zone.getAttribute('data-hovered-card-index')).toBe('3');
      expect(frames).toHaveLength(1);

      // Every further move in the same frame shares that single rAF pass.
      fireEvent.mouseMove(box, { clientX: at(5), clientY: 40 });
      fireEvent.mouseMove(box, { clientX: at(7), clientY: 40 });
      expect(frames).toHaveLength(1);

      // A move that still resolves to the same card does no work at all.
      fireEvent.mouseMove(box, { clientX: at(7) + 0.5, clientY: 40 });
      expect(frames).toHaveLength(1);
      expect(zone.getAttribute('data-hovered-card-index')).toBe('7');

      frames[0](0);
      await new Promise((resolve) => setTimeout(resolve, 0));
      expect(zone.getAttribute('data-hovered-card-index')).toBe('7');
      expect(frames).toHaveLength(1);
    } finally {
      rafWindow.requestAnimationFrame = originalRaf;
      rafWindow.cancelAnimationFrame = originalCancel;
    }

    view.unmount();
  });
});

describe('T-90-feedback-20261123_020207-4: drag reorder slot and consecutive throw-ins', () => {
  const dragRect = (width = 300): DOMRect =>
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

  it('ITEM-NEW2: exposes and commits the exact parted insertion slot', () => {
    const onReorderHand = vi.fn();
    render(
      <GameTable
        myId="p0"
        myHand={hand}
        opponents={opponents}
        tablePairs={[]}
        trumpSuit="diamonds"
        defenderId="p1"
        onReorderHand={onReorderHand}
      />,
    );
    const handBox = screen.getByTestId('hand-turn-highlight') as HTMLElement;
    vi.spyOn(handBox, 'getBoundingClientRect').mockReturnValue(dragRect());

    fireEvent.mouseDown(screen.getByLabelText('king of clubs'), {
      button: 0,
      clientX: 150,
      clientY: 20,
    });
    fireEvent.mouseMove(document, { clientX: 5, clientY: 22 });

    expect(handBox.getAttribute('data-drag-insert-index')).toBe('0');
    const wrappers = Array.from(
      handBox.querySelectorAll('.hand-card-wrapper'),
    ) as HTMLElement[];
    expect(wrappers[1].getAttribute('data-drag-source')).toBe('true');
    // The remaining cards open a slot at the left edge: the first one is pushed
    // right until a whole card fits, the second decays, and nothing else moves.
    expect(
      Number(wrappers[0].getAttribute('data-part-delta-x')),
    ).toBeGreaterThan(60);
    expect(Number(wrappers[0].getAttribute('data-card-x'))).toBeGreaterThanOrEqual(
      CARD_WIDTH - 1,
    );
    // The dragged card itself never carries a parting delta.
    expect(Number(wrappers[1].getAttribute('data-part-delta-x'))).toBe(0);

    fireEvent.mouseUp(document, { clientX: 5, clientY: 22 });
    expect(onReorderHand).toHaveBeenCalledWith([
      { suit: 'clubs', rank: 'king' },
      { suit: 'spades', rank: 'six' },
      { suit: 'hearts', rank: 'ace' },
    ]);
    expect(handBox.getAttribute('data-drag-insert-index')).toBeNull();
  });

  const sevenClubs: CardData = { suit: 'clubs', rank: 'seven' };
  const eightHearts: CardData = { suit: 'hearts', rank: 'eight' };
  const collapseHand: CardData[] = [
    sevenClubs,
    eightHearts,
    { suit: 'spades', rank: 'two' },
    { suit: 'spades', rank: 'three' },
  ];
  // `qa-table-collapse-right`: two covered pairs plus two uncovered attacks.
  const collapsePairs: TablePairData[] = [
    { attack: { suit: 'clubs', rank: 'ten' }, defense: { suit: 'clubs', rank: 'jack' } },
    { attack: { suit: 'spades', rank: 'eight' }, defense: { suit: 'spades', rank: 'queen' } },
    { attack: { suit: 'hearts', rank: 'seven' }, defense: null },
    { attack: { suit: 'diamonds', rank: 'eight' }, defense: null },
  ];
  const collapseOpponents: OpponentSummary[] = [
    { id: 'p3', name: 'Dave', cardCount: 4, hasPassed: false, finishRank: null },
  ];

  it('ITEM-NEW1: plays both projected throw-ins in a row during Defense with uncovered pairs', () => {
    const onThrowInDrop = vi.fn();
    const view = render(
      <GameTable
        myId="p0"
        myHand={collapseHand}
        opponents={collapseOpponents}
        tablePairs={collapsePairs}
        trumpSuit="hearts"
        attackerId="p0"
        defenderId="p3"
        boutPhase="Defense"
        canThrowIn
        throwInCards={[sevenClubs, eightHearts]}
        throwInCapacity={2}
        onThrowInDrop={onThrowInDrop}
      />,
    );

    const first = screen.getByTestId('throw-in-outline');
    expect(first.getAttribute('data-throw-in-enabled')).toBe('true');
    fireEvent.drop(first, { dataTransfer: { getData: () => cardKey(sevenClubs) } });
    expect(onThrowInDrop).toHaveBeenNthCalledWith(1, sevenClubs);

    // The server's view after the first card lands: five pairs, three uncovered
    // attacks, the one remaining projected card and one slot of capacity.
    view.rerender(
      <GameTable
        myId="p0"
        myHand={collapseHand.slice(1)}
        opponents={collapseOpponents}
        tablePairs={[...collapsePairs, { attack: sevenClubs, defense: null }]}
        trumpSuit="hearts"
        attackerId="p0"
        defenderId="p3"
        boutPhase="Defense"
        canThrowIn
        throwInCards={[eightHearts]}
        throwInCapacity={1}
        onThrowInDrop={onThrowInDrop}
      />,
    );

    const second = screen.getByTestId('throw-in-outline');
    expect(second.getAttribute('data-throw-in-enabled')).toBe('true');
    expect(second.getAttribute('data-drop-zone')).toBe('throw-in');
    fireEvent.drop(second, { dataTransfer: { getData: () => cardKey(eightHearts) } });
    expect(onThrowInDrop).toHaveBeenNthCalledWith(2, eightHearts);
    expect(onThrowInDrop).toHaveBeenCalledTimes(2);
    view.unmount();
  });
});
