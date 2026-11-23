import { afterEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/preact';
import {
  CARD_HEIGHT,
  CARD_WIDTH,
  GameTable,
  HAND_CONTOUR_PADDING,
  HAND_FALLBACK_WIDTH,
  HAND_FALLBACK_WIDTH_MOBILE,
  HAND_LANE_MARGIN_PX,
  HAND_MAX_OVERLAP_RATIO,
  HAND_MIN_OVERLAP_RATIO,
  HAND_RAISED_OFFSET,
  MOBILE_CARD_HEIGHT,
  MOBILE_CARD_WIDTH,
  cardKey,
  handContourPath,
  type GameTableProps,
  type OpponentSummary,
} from '../components/GameTable';
import { CARD_INDEX_STRIP_WIDTH_PX, type CardData } from '../components/Card';
import {
  ELIGIBLE_LIFT_PX,
  HAND_SMALL_HAND_OVERLAP_RATIO,
  SELECTED_LIFT_PX,
  computeHandLayout,
} from '../utils/handLayout';
import tableCss from '../styles/table.css?raw';

/**
 * T-95-audit-gap-1: focused acceptance tests for the four audited behaviours —
 * card sizing against the drop outlines, dynamic 20%-80% hand overlap for small
 * and stress hands, the tight non-rectangular hand contour, and drag visibility.
 */

const RANKS = [
  'two',
  'three',
  'four',
  'five',
  'six',
  'seven',
  'eight',
  'nine',
  'ten',
  'jack',
  'queen',
  'king',
];
const SUITS = ['spades', 'hearts', 'diamonds', 'clubs'];

/** A unique 52-card deck, so a stress hand never repeats a key. */
const DECK: CardData[] = SUITS.flatMap((suit) => RANKS.map((rank) => ({ suit, rank })));

const bob: OpponentSummary = {
  id: 'p1',
  name: 'Bob',
  cardCount: 6,
  hasPassed: false,
  finishRank: null,
};

const originalInnerWidth = window.innerWidth;

afterEach(() => {
  Object.defineProperty(window, 'innerWidth', {
    configurable: true,
    writable: true,
    value: originalInnerWidth,
  });
});

function setViewport(width: number): void {
  Object.defineProperty(window, 'innerWidth', {
    configurable: true,
    writable: true,
    value: width,
  });
}

function mountTable(myHand: CardData[], extra: Partial<GameTableProps> = {}) {
  return render(
    <GameTable
      myId="p0"
      myHand={myHand}
      opponents={[bob]}
      tablePairs={[]}
      trumpSuit="diamonds"
      defenderId="p1"
      {...extra}
    />,
  );
}

/** Declarations of the first rule whose selector text contains `selector`. */
function cssRule(css: string, selector: string): string {
  const start = css.indexOf(selector);
  if (start === -1) return '';
  const open = css.indexOf('{', start);
  const close = css.indexOf('}', open);
  return open === -1 || close === -1 ? '' : css.slice(open + 1, close);
}

function handWrappers(): HTMLElement[] {
  const box = screen.getByTestId('hand-turn-highlight');
  return Array.from(box.querySelectorAll('.hand-card-wrapper')) as HTMLElement[];
}

/**
 * T-95 #3: the flex row's real left edges, modelled from the DOM contract the
 * hand actually uses — each slot is `CARD_WIDTH` wide (a collapsed drag slot is
 * zero wide) and its inline `margin-left` positions it. Unlike `data-card-x`,
 * this model exposes a stylesheet rule that overrides the inline margin, which
 * is exactly what previously left every card after the dragged one offset.
 */
function flexRowLefts(wrappers: HTMLElement[]): number[] {
  let cursor = 0;
  return wrappers.map((wrapper) => {
    cursor += Number.parseFloat(wrapper.style.marginLeft || '0') || 0;
    const left = cursor;
    if (wrapper.getAttribute('data-collapsed') !== 'true') cursor += CARD_WIDTH;
    return left;
  });
}

describe('T-95 #2: card dimensions match the throw-in and redirect outlines', () => {
  it('renders hand, attack, throw-in and redirect boxes at the same 100x140 footprint', () => {
    mountTable(DECK.slice(0, 3), {
      tablePairs: [{ attack: { suit: 'clubs', rank: 'nine' }, defense: null }],
      canThrowIn: true,
      canRedirect: true,
    });

    const handCard = document.querySelector(
      '[data-zone="player-hand"] .card-slot',
    ) as HTMLElement;
    const tableCard = document.querySelector(
      '.table-pair-attack .card-slot',
    ) as HTMLElement;
    const throwIn = screen.getByTestId('throw-in-outline');
    const redirect = screen.getByTestId('redirect-outline');

    for (const node of [handCard, tableCard, throwIn, redirect]) {
      expect(node.getAttribute('data-card-width')).toBe(String(CARD_WIDTH));
      expect(node.getAttribute('data-card-height')).toBe(String(CARD_HEIGHT));
    }

    // One shared radius token drives every card-sized box at every breakpoint.
    for (const selector of [
      '.card-slot',
      '.throw-in-outline',
      '.redirect-outline',
      '.target-outline',
    ]) {
      const escaped = selector.replace(/\./g, '\\.');
      expect(tableCss, selector).toMatch(
        new RegExp(`${escaped}\\s*\\{[^}]*border-radius: var\\(--app-roundness, 8px\\)`),
      );
    }
  });

  it('steps every card and outline down to the same 48x68 mobile footprint', () => {
    setViewport(500);
    mountTable(DECK.slice(0, 3), {
      tablePairs: [{ attack: { suit: 'clubs', rank: 'nine' }, defense: null }],
      canThrowIn: true,
      canRedirect: true,
    });

    const boxes = [
      document.querySelector('[data-zone="player-hand"] .card-slot') as HTMLElement,
      document.querySelector('.table-pair-attack .card-slot') as HTMLElement,
      screen.getByTestId('throw-in-outline'),
      screen.getByTestId('redirect-outline'),
    ];
    for (const node of boxes) {
      expect(node.getAttribute('data-card-width')).toBe(String(MOBILE_CARD_WIDTH));
      expect(node.getAttribute('data-card-height')).toBe(String(MOBILE_CARD_HEIGHT));
    }

    expect(tableCss).toMatch(
      /@media \(max-width: 899px\)[\s\S]*?:root\s*{[^}]*--card-width: 48px;[^}]*--card-height: 68px;/,
    );
  });
});

describe('T-95 #3: active hand overlap stays inside 20%-80% and the zone', () => {
  const available = HAND_FALLBACK_WIDTH - HAND_CONTOUR_PADDING * 2;

  it('keeps small hands (2-6 cards) at the Item 6b resting overlap without overflowing', () => {
    for (const count of [2, 3, 4, 5, 6]) {
      const view = mountTable(DECK.slice(0, count), { awaitingAttack: true });
      const box = screen.getByTestId('hand-turn-highlight') as HTMLElement;
      const wrappers = handWrappers();
      const stride = Number(box.getAttribute('data-stride-px'));

      expect(wrappers).toHaveLength(count);
      expect(Number(box.getAttribute('data-overlap-ratio'))).toBeCloseTo(
        HAND_SMALL_HAND_OVERLAP_RATIO,
        5,
      );
      expect(stride).toBeGreaterThanOrEqual(CARD_WIDTH * HAND_MIN_OVERLAP_RATIO - 1e-9);
      expect(stride).toBeLessThanOrEqual(CARD_WIDTH * HAND_MAX_OVERLAP_RATIO + 1e-9);
      for (let index = 1; index < wrappers.length; index += 1) {
        const previous = Number(wrappers[index - 1].getAttribute('data-card-x'));
        const current = Number(wrappers[index].getAttribute('data-card-x'));
        expect(current - previous).toBeCloseTo(stride, 5);
      }
      // The visible row never runs past the hand column / into the talon.
      expect(Number(box.getAttribute('data-rendered-hand-width'))).toBeLessThanOrEqual(
        available + 1e-9,
      );
      view.unmount();
    }
  });

  it('T-90-feedback-5 ITEM-5a/5b: keeps the 30 / 34 / 46-card stress hands at full size', () => {
    for (const count of [30, 34, 46]) {
      const view = mountTable(DECK.slice(0, count), { awaitingAttack: true });
      const box = screen.getByTestId('hand-turn-highlight') as HTMLElement;
      const wrappers = handWrappers();
      const layoutWidth = Number(box.getAttribute('data-hand-width'));
      const renderedWidth = Number(box.getAttribute('data-rendered-hand-width'));
      const stride = Number(box.getAttribute('data-stride-px'));

      // Every card is rendered: nothing is hidden, stacked, removed or shrunk.
      expect(wrappers).toHaveLength(count);
      expect(wrappers.filter((node) => node.getAttribute('data-hidden') === 'true')).toHaveLength(
        0,
      );
      expect(Number(box.getAttribute('data-fit-scale'))).toBe(1);
      for (const wrapper of wrappers) {
        const card = wrapper.querySelector('.card-slot') as HTMLElement;
        expect(card.getAttribute('data-card-width')).toBe(String(CARD_WIDTH));
        expect(card.getAttribute('data-card-height')).toBe(String(CARD_HEIGHT));
      }

      // Option B: the row compresses inside the maximal box (never beyond it),
      // and every card stays distinct and left-to-right ordered.
      expect(stride).toBeGreaterThan(0);
      expect(renderedWidth).toBeLessThanOrEqual(available + 1e-9);
      const last = wrappers[wrappers.length - 1];
      expect(
        Math.abs(Number(last.getAttribute('data-card-x')) + CARD_WIDTH - layoutWidth),
      ).toBeLessThanOrEqual(1);
      view.unmount();
    }
  });

  it('contains a 46-card mobile hand inside the narrow mobile column', () => {
    setViewport(500);
    mountTable(DECK.slice(0, 46), { awaitingAttack: true });
    const box = screen.getByTestId('hand-turn-highlight') as HTMLElement;
    const wrappers = handWrappers();
    const availableMobile =
      HAND_FALLBACK_WIDTH_MOBILE - HAND_CONTOUR_PADDING * 2;

    expect(wrappers).toHaveLength(46);
    // ITEM-5a: the mobile cards keep their 48x68 footprint too.
    expect(Number(box.getAttribute('data-fit-scale'))).toBe(1);
    expect(Number(box.getAttribute('data-rendered-hand-width'))).toBeLessThanOrEqual(
      availableMobile + 1e-9,
    );
    const mobileCard = wrappers[0].querySelector('.card-slot') as HTMLElement;
    expect(mobileCard.getAttribute('data-card-width')).toBe(String(MOBILE_CARD_WIDTH));
    expect(mobileCard.getAttribute('data-card-height')).toBe(String(MOBILE_CARD_HEIGHT));
  });
});

describe('T-95 #1: the contour wraps the actual rendered card boxes', () => {
  it('recomputes the non-rectangular contour from the rendered x/y of every card', () => {
    const myHand = DECK.slice(0, 6);
    const raised = [0, 2, 4].map((index) => cardKey(myHand[index]));
    const view = mountTable(myHand, {
      defenderId: 'p1',
      awaitingAttack: true,
      playableKeys: raised,
    });

    const box = screen.getByTestId('hand-turn-highlight') as HTMLElement;
    const contour = screen.getByTestId('hand-highlight-contour');
    const path = screen.getByTestId('hand-highlight-path');
    const wrappers = handWrappers();

    // Rebuild the expected outline from the DOM-reported card boxes, exactly
    // as the component must: tight x/stride, raised playable cards at -14px.
    const rects = wrappers.map((wrapper) => ({
      x: Number(wrapper.getAttribute('data-card-x')),
      y: Number(wrapper.getAttribute('data-card-y')),
      width: CARD_WIDTH,
      height: CARD_HEIGHT,
    }));
    expect(new Set(rects.map((rect) => rect.y))).toEqual(
      new Set([HAND_RAISED_OFFSET, 0]),
    );

    const expectedD = handContourPath(
      rects.map((rect) => ({ x: rect.x, y: rect.y })),
      CARD_WIDTH,
      CARD_HEIGHT,
    );
    expect(path.getAttribute('d')).toBe(expectedD);
    expect(contour.getAttribute('data-non-rectangular')).toBe('true');
    expect(contour.getAttribute('data-contour-shape')).toBe('stepped');

    const minX = Math.min(...rects.map((rect) => rect.x));
    const maxRight = Math.max(...rects.map((rect) => rect.x + rect.width));
    expect(Number(contour.getAttribute('data-contour-width'))).toBe(
      maxRight - minX,
    );
    expect(parseFloat(contour.style.marginTop)).toBe(HAND_RAISED_OFFSET - 4);

    // A smaller hand re-lays out immediately; the outline is never stale.
    view.unmount();
    mountTable(myHand.slice(0, 3), { awaitingAttack: true });
    const smaller = screen.getByTestId('hand-highlight-contour');
    expect(Number(smaller.getAttribute('data-contour-width'))).toBe(
      Number(screen.getByTestId('hand-turn-highlight').getAttribute('data-hand-width')),
    );
    expect(Number(smaller.getAttribute('data-contour-width'))).toBeLessThan(
      maxRight - minX,
    );
  });

  it('never lifts a hand card on hover outside the contour it models', () => {
    expect(cssRule(tableCss, '.hand-cards .card-slot:hover {')).toContain(
      'transform: none',
    );
  });
});

describe('T-95 #2: a dragged hand card stays visible for the whole gesture', () => {
  it('keeps the card painted and connected from mousedown through mouseup', () => {
    mountTable(DECK.slice(0, 3), { onReorderHand: vi.fn() });

    const box = screen.getByTestId('hand-turn-highlight') as HTMLElement;
    vi.spyOn(box, 'getBoundingClientRect').mockReturnValue({
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

    const labeled = screen.getByLabelText('two of spades');
    const wrapper = labeled.closest('.hand-card-wrapper') as HTMLElement;
    const card = wrapper.querySelector('.card-slot') as HTMLElement;
    const initialCount = handWrappers().length;

    expect(wrapper.isConnected).toBe(true);
    fireEvent.mouseDown(labeled, { button: 0, clientX: 10, clientY: 20 });

    for (const [clientX, clientY] of [
      [130, 60],
      [180, 90],
      [40, 30],
    ]) {
      fireEvent.mouseMove(document, { clientX, clientY });
      expect(wrapper.isConnected).toBe(true);
      expect(card.isConnected).toBe(true);
      expect(wrapper.getAttribute('data-dragging')).toBe('true');
      expect(wrapper.getAttribute('data-collapsed')).toBe('true');
      expect(card.getAttribute('data-card-visible')).toBe('true');
      expect(card.style.opacity).toBe('1');
      expect(card.style.visibility).toBe('visible');
      expect(card.style.display).not.toBe('none');
      expect(handWrappers()).toHaveLength(initialCount);
    }

    const collapsed = cssRule(tableCss, ".hand-card-wrapper[data-collapsed='true'] {");
    expect(collapsed).not.toMatch(/opacity:\s*0/);
    expect(collapsed).not.toMatch(/visibility:\s*hidden/);
    expect(collapsed).not.toMatch(/display:\s*none/);
    expect(collapsed).toContain('overflow: visible');

    fireEvent.mouseUp(document, { clientX: 40, clientY: 30 });
    expect(wrapper.isConnected).toBe(true);
    expect(card.isConnected).toBe(true);
    expect(wrapper.getAttribute('data-dragging')).toBe('false');
    expect(card.style.opacity).toBe('1');
    expect(card.style.visibility).toBe('visible');
  });
});

describe('T-90-feedback-5 ITEM-8: two-tier card raise', () => {
  it('raises eligible cards halfway and selected cards fully, others at baseline', () => {
    const myHand = DECK.slice(0, 3);
    mountTable(myHand, {
      awaitingAttack: true,
      playableKeys: [cardKey(myHand[0])],
      selectedKeys: [cardKey(myHand[1])],
    });

    const wrappers = handWrappers();
    expect(wrappers).toHaveLength(3);

    // Eligible -> half raise.
    expect(wrappers[0].getAttribute('data-eligible')).toBe('true');
    expect(wrappers[0].getAttribute('data-lift-px')).toBe(String(ELIGIBLE_LIFT_PX));
    expect(wrappers[0].getAttribute('data-card-y')).toBe(String(-ELIGIBLE_LIFT_PX));
    expect(wrappers[0].style.transform).toBe(
      `translate3d(0px, ${-ELIGIBLE_LIFT_PX}px, 0)`,
    );

    // Selected -> full raise, even though it is also playable.
    expect(wrappers[1].getAttribute('data-selected')).toBe('true');
    expect(wrappers[1].getAttribute('data-lift-px')).toBe(String(SELECTED_LIFT_PX));
    expect(wrappers[1].getAttribute('data-card-y')).toBe(String(-SELECTED_LIFT_PX));
    expect(wrappers[1].style.transform).toBe(
      `translate3d(0px, ${-SELECTED_LIFT_PX}px, 0)`,
    );

    // Neither eligible nor selected -> baseline.
    expect(wrappers[2].getAttribute('data-eligible')).toBe('false');
    expect(wrappers[2].getAttribute('data-card-y')).toBe('0');
    expect(wrappers[2].style.transform).toBe('');

    // The contour hugs all three tiers non-rectangularly.
    expect(
      screen.getByTestId('hand-highlight-contour').getAttribute('data-contour-shape'),
    ).toBe('stepped');
  });
});

describe('T-90-feedback-5 ITEM-6a/6b/6c: smooth hover parting', () => {
  it('parts the hand around the hovered card without moving that card', () => {
    mountTable(DECK.slice(0, 8), { awaitingAttack: true });
    const zone = document.querySelector('[data-zone="player-hand"]') as HTMLElement;
    const wrappers = handWrappers();
    const before = wrappers.map((wrapper) => Number(wrapper.getAttribute('data-card-x')));

    fireEvent.pointerMove(wrappers[4], { bubbles: true });

    // ITEM-6a: the lane reports the hovered card and the parting state.
    expect(zone.getAttribute('data-hovered-card-index')).toBe('4');
    expect(zone.getAttribute('data-parting-active')).toBe('true');

    const after = handWrappers().map((wrapper) =>
      Number(wrapper.getAttribute('data-card-x')),
    );
    // ITEM-6b: the hovered card is pinned exactly where it was.
    expect(after[4]).toBe(before[4]);
    // ITEM-6a: near neighbours part outward, the rest compress smoothly.
    expect(after[3]).toBeLessThan(before[3]);
    expect(after[5]).toBeGreaterThan(before[5]);
    expect(after[0]).toBeLessThanOrEqual(before[0]);
    expect(after[7]).toBeGreaterThanOrEqual(before[0]);

    // The contour follows the parted positions.
    expect(
      Number(screen.getByTestId('hand-highlight-contour').getAttribute('data-contour-width')),
    ).toBeGreaterThan(0);

    // ITEM-6a: leaving the lane clears the hover and returns the row.
    fireEvent.pointerLeave(zone);
    expect(zone.getAttribute('data-hovered-card-index')).toBeNull();
    expect(zone.getAttribute('data-parting-active')).toBe('false');
    expect(
      handWrappers().map((wrapper) => Number(wrapper.getAttribute('data-card-x'))),
    ).toEqual(before);
  });

  it('ITEM-6c: never parts a single-card hand', () => {
    mountTable(DECK.slice(0, 1), { awaitingAttack: true });
    const zone = document.querySelector('[data-zone="player-hand"]') as HTMLElement;
    const wrapper = handWrappers()[0];
    const beforeX = wrapper.getAttribute('data-card-x');

    fireEvent.pointerMove(wrapper, { bubbles: true });

    expect(zone.getAttribute('data-hovered-card-index')).toBeNull();
    expect(zone.getAttribute('data-parting-active')).toBe('false');
    expect(handWrappers()[0].getAttribute('data-card-x')).toBe(beforeX);
    expect(handWrappers()[0].style.transform).toBe('');
  });

  it('ITEM-6a: keeps the hover over the parted gaps and clears only on leave', () => {
    mountTable(DECK.slice(0, 6), { awaitingAttack: true });
    const zone = document.querySelector('[data-zone="player-hand"]') as HTMLElement;
    const box = screen.getByTestId('hand-turn-highlight') as HTMLElement;

    // A plain mouse sweep (not only pointer events) drives the parting.
    fireEvent.mouseMove(handWrappers()[2], { bubbles: true });
    expect(zone.getAttribute('data-hovered-card-index')).toBe('2');
    expect(zone.getAttribute('data-parting-active')).toBe('true');

    // Moving over the parted gap / contour (target = `.hand-cards`, with no
    // card wrapper) must not flicker the row closed.
    fireEvent.mouseMove(box, { bubbles: true });
    expect(zone.getAttribute('data-hovered-card-index')).toBe('2');
    expect(zone.getAttribute('data-parting-active')).toBe('true');

    // Crossing straight to a neighbour keeps a single continuous hover.
    fireEvent.mouseMove(handWrappers()[3], { bubbles: true });
    expect(zone.getAttribute('data-hovered-card-index')).toBe('3');

    // Leaving the hand container is the only reset.
    fireEvent.mouseLeave(zone);
    expect(zone.getAttribute('data-hovered-card-index')).toBeNull();
    expect(zone.getAttribute('data-parting-active')).toBe('false');
  });

  it('ITEM-6b: visibly parts every multi-card hand size around the hovered card', () => {
    const cases: Array<{ count: number; index: number; left?: number; right?: number }> = [
      { count: 2, index: 0, right: 1 },
      { count: 3, index: 1, left: 0, right: 2 },
      { count: 4, index: 2, left: 1, right: 3 },
      { count: 5, index: 3, left: 2, right: 4 },
      { count: 6, index: 2, left: 1, right: 3 },
      { count: 14, index: 7, left: 6, right: 8 },
      { count: 30, index: 15, left: 14, right: 16 },
    ];
    for (const { count, index, left, right } of cases) {
      const view = mountTable(DECK.slice(0, count), { awaitingAttack: true });
      const before = handWrappers().map((wrapper) =>
        Number(wrapper.getAttribute('data-card-x')),
      );

      fireEvent.pointerMove(handWrappers()[index], { bubbles: true });

      const after = handWrappers().map((wrapper) =>
        Number(wrapper.getAttribute('data-card-x')),
      );
      // The hovered card never moves; its neighbours visibly part outward.
      expect(after[index], `${count}-card hovered card`).toBe(before[index]);
      expect(Number(handWrappers()[index].getAttribute('data-part-delta-x'))).toBe(0);
      if (left !== undefined) {
        expect(after[left], `${count}-card left neighbour`).toBeLessThan(before[left]);
      }
      if (right !== undefined) {
        expect(after[right], `${count}-card right neighbour`).toBeGreaterThan(
          before[right],
        );
      }

      // ITEM-6a: every parted card moves through a GPU-composited translate3d.
      for (const wrapper of handWrappers()) {
        if (Number(wrapper.getAttribute('data-part-delta-x')) === 0) continue;
        expect(wrapper.style.transform).toContain('translate3d(');
      }
      view.unmount();
    }
  });

  it('ITEM-6a: animates only transform / margin-left, never layout widths', () => {
    const wrapperRule = cssRule(tableCss, '.hand-card-wrapper {');
    expect(wrapperRule).toContain('will-change: transform');
    expect(wrapperRule).toContain(
      'transform 220ms cubic-bezier(0.22, 1, 0.36, 1)',
    );
    expect(wrapperRule).not.toMatch(/transition:[^;]*(width|left|right):/);

    // The floating preview itself opts out of every transition (0ms lag).
    const previewRule = cssRule(tableCss, '.drag-card-preview {');
    expect(previewRule).toContain('position: fixed');
    expect(previewRule).toContain('pointer-events: none');
    expect(previewRule).toContain('z-index: 9999');
    expect(previewRule).toContain('transition: none');
  });
});

describe('T-90-feedback-6 ITEM-3: center-locked card dragging', () => {
  /** Centre of `[data-testid="drag-card-preview"]` from its inline transform. */
  function dragPreviewCenter(): { x: number; y: number; width: number; height: number } {
    const preview = screen.getByTestId('drag-card-preview') as HTMLElement;
    const width = Number(preview.getAttribute('data-card-width'));
    const height = Number(preview.getAttribute('data-card-height'));
    const match = preview.style.transform.match(
      /translate3d\((-?[\d.]+)px, (-?[\d.]+)px, 0\)/,
    );
    return {
      x: match ? Number(match[1]) + width / 2 : Number.NaN,
      y: match ? Number(match[2]) + height / 2 : Number.NaN,
      width,
      height,
    };
  }

  it('locks the exact preview centre to (clientX, clientY) from any click point and index', () => {
    const cases: Array<{
      count: number;
      index: number;
      grab: [number, number];
    }> = [
      // Far-left 5px edge, top-left and bottom-right corners, and dead centre.
      { count: 1, index: 0, grab: [5, 6] },
      { count: 6, index: 0, grab: [5, 130] },
      { count: 6, index: 5, grab: [95, 18] },
      { count: 14, index: 0, grab: [5, 5] },
      { count: 14, index: 7, grab: [50, 70] },
      { count: 14, index: 13, grab: [95, 135] },
      { count: 30, index: 0, grab: [5, 135] },
      { count: 30, index: 15, grab: [50, 2] },
      { count: 30, index: 29, grab: [99, 139] },
    ];

    for (const { count, index, grab } of cases) {
      const view = mountTable(DECK.slice(0, count), { onReorderHand: vi.fn() });
      const wrapper = handWrappers()[index];
      const [grabX, grabY] = grab;

      // The preview does not exist until the gesture becomes a drag.
      expect(screen.queryByTestId('drag-card-preview')).toBeNull();
      fireEvent.mouseDown(wrapper, { button: 0, clientX: grabX, clientY: grabY });

      for (const [clientX, clientY] of [
        [grabX + 4, grabY],
        [grabX + 120, grabY + 60],
        [grabX + 260, grabY + 180],
      ]) {
        fireEvent.mouseMove(document, { clientX, clientY });
        const center = dragPreviewCenter();
        expect(center.width).toBe(CARD_WIDTH);
        expect(center.height).toBe(CARD_HEIGHT);
        expect(Math.abs(center.x - clientX)).toBeLessThanOrEqual(1);
        expect(Math.abs(center.y - clientY)).toBeLessThanOrEqual(1);
      }

      // The preview is a transient, non-interactive, untweened floating card.
      const preview = screen.getByTestId('drag-card-preview') as HTMLElement;
      expect(preview.style.pointerEvents).toBe('');
      const previewRule = cssRule(tableCss, '.drag-card-preview {');
      expect(previewRule).toContain('pointer-events: none');
      expect(previewRule).toContain('transition: none');
      // The source hand card never paints a duplicate copy while dragging.
      expect(
        document
          .querySelector('[data-testid="hand-turn-highlight"]')
          ?.getAttribute('data-drag-preview'),
      ).toBe('true');

      fireEvent.mouseUp(document, { clientX: grabX + 260, clientY: grabY + 180 });
      expect(screen.queryByTestId('drag-card-preview')).toBeNull();
      view.unmount();
    }
  });

  it('stays centered while the hand is actively parted by a hover', () => {
    mountTable(DECK.slice(0, 14), { onReorderHand: vi.fn() });
    const zone = document.querySelector('[data-zone="player-hand"]') as HTMLElement;

    fireEvent.pointerMove(handWrappers()[3], { bubbles: true });
    expect(zone.getAttribute('data-parting-active')).toBe('true');

    fireEvent.mouseDown(handWrappers()[9], { button: 0, clientX: 500, clientY: 300 });
    fireEvent.mouseMove(document, { clientX: 620, clientY: 360 });

    const center = dragPreviewCenter();
    expect(Math.abs(center.x - 620)).toBeLessThanOrEqual(1);
    expect(Math.abs(center.y - 360)).toBeLessThanOrEqual(1);
    // Parting is suppressed while the drag is live, so the hand never jitters.
    expect(zone.getAttribute('data-parting-active')).toBe('false');

    fireEvent.mouseUp(document, { clientX: 620, clientY: 360 });
  });

  it('follows window-level drag events, ignores the (0, 0) sentinel and clears on Escape', () => {
    mountTable(DECK.slice(0, 6), { onReorderHand: vi.fn() });
    fireEvent.mouseDown(handWrappers()[2], { button: 0, clientX: 40, clientY: 80 });
    fireEvent.mouseMove(document, { clientX: 100, clientY: 120 });

    // A native drag repositioning event moves the preview too (jsdom has no
    // `DragEvent`, so the window listener is exercised with a real MouseEvent).
    window.dispatchEvent(new window.MouseEvent('dragover', { clientX: 240, clientY: 200 }));
    let center = dragPreviewCenter();
    expect(Math.abs(center.x - 240)).toBeLessThanOrEqual(1);
    expect(Math.abs(center.y - 200)).toBeLessThanOrEqual(1);

    // The browser's end-of-drag (0, 0) sentinel never teleports the preview.
    window.dispatchEvent(new window.MouseEvent('drag', { clientX: 0, clientY: 0 }));
    center = dragPreviewCenter();
    expect(Math.abs(center.x - 240)).toBeLessThanOrEqual(1);
    expect(Math.abs(center.y - 200)).toBeLessThanOrEqual(1);

    fireEvent.keyDown(window, { key: 'Escape' });
    expect(screen.queryByTestId('drag-card-preview')).toBeNull();
  });

  it('dismisses the preview on a cancelled dragend and keeps the hand intact', () => {
    mountTable(DECK.slice(0, 6), { onReorderHand: vi.fn() });
    fireEvent.mouseDown(handWrappers()[0], { button: 0, clientX: 20, clientY: 60 });
    fireEvent.mouseMove(document, { clientX: 180, clientY: 140 });
    expect(screen.getByTestId('drag-card-preview')).toBeTruthy();

    fireEvent.dragEnd(handWrappers()[0]);
    expect(screen.queryByTestId('drag-card-preview')).toBeNull();
    expect(handWrappers()).toHaveLength(6);
  });

  it('locks the preview centre on a 375x812 mobile viewport (48x68 cards)', () => {
    setViewport(375);
    mountTable(DECK.slice(0, 6), { onReorderHand: vi.fn() });

    fireEvent.mouseDown(handWrappers()[5], { button: 0, clientX: 180, clientY: 300 });
    fireEvent.mouseMove(document, { clientX: 240, clientY: 360 });

    const center = dragPreviewCenter();
    expect(center.width).toBe(MOBILE_CARD_WIDTH);
    expect(center.height).toBe(MOBILE_CARD_HEIGHT);
    expect(Math.abs(center.x - 240)).toBeLessThanOrEqual(1);
    expect(Math.abs(center.y - 360)).toBeLessThanOrEqual(1);

    fireEvent.mouseUp(document, { clientX: 240, clientY: 360 });
    expect(screen.queryByTestId('drag-card-preview')).toBeNull();
  });

  it('executes the expected move on every drop target and dismisses the preview', () => {
    const card = DECK[0]; // two of spades
    const uncovered = [{ attack: { suit: 'spades', rank: 'six' }, defense: null }];
    // The covered/uncovered mix keeps every uncovered card's ORIGINAL
    // attackIndex on its `<TablePair>` drop zone.
    const mixed = [
      { attack: { suit: 'spades', rank: 'six' }, defense: { suit: 'spades', rank: 'seven' } },
      { attack: { suit: 'clubs', rank: 'king' }, defense: null },
      { attack: { suit: 'hearts', rank: 'ten' }, defense: { suit: 'hearts', rank: 'jack' } },
      { attack: { suit: 'diamonds', rank: 'nine' }, defense: null },
    ];
    const baseProps: GameTableProps = {
      myId: 'p0',
      myHand: DECK.slice(0, 3),
      opponents: [bob],
      tablePairs: [],
      trumpSuit: 'diamonds',
      defenderId: 'p1',
    };
    const cases: Array<{
      name: string;
      props: GameTableProps;
      findZone: () => Element | null;
      spy: 'onCoverDrop' | 'onAttackDrop' | 'onRedirectDrop' | 'onThrowInDrop';
      expected: unknown[];
    }> = [
      {
        name: 'uncovered pair (original attackIndex)',
        props: { ...baseProps, tablePairs: mixed },
        findZone: () => document.querySelector('[data-drop-zone="cover:3"]'),
        spy: 'onCoverDrop',
        expected: [card, 3],
      },
      {
        name: 'attack target outline',
        props: { ...baseProps, tablePairs: [], awaitingAttack: true },
        findZone: () => screen.getByTestId('target-outline-p1'),
        spy: 'onAttackDrop',
        expected: [card, 'p1'],
      },
      {
        name: 'redirect outline',
        props: { ...baseProps, tablePairs: uncovered, canRedirect: true },
        findZone: () => screen.getByTestId('redirect-outline'),
        spy: 'onRedirectDrop',
        expected: [card],
      },
      {
        name: 'throw-in outline',
        props: { ...baseProps, tablePairs: uncovered, canThrowIn: true },
        findZone: () => screen.getByTestId('throw-in-outline'),
        spy: 'onThrowInDrop',
        expected: [card],
      },
    ];

    const original = (document as unknown as { elementFromPoint?: unknown })
      .elementFromPoint;
    try {
      for (const testCase of cases) {
        const spies = {
          onCoverDrop: vi.fn(),
          onAttackDrop: vi.fn(),
          onRedirectDrop: vi.fn(),
          onThrowInDrop: vi.fn(),
        };
        const view = render(<GameTable {...testCase.props} {...spies} />);
        const zone = testCase.findZone();
        expect(zone, testCase.name).not.toBeNull();
        (document as unknown as { elementFromPoint: unknown }).elementFromPoint = vi.fn(
          () => zone,
        );

        fireEvent.mouseDown(handWrappers()[0], { button: 0, clientX: 30, clientY: 60 });
        fireEvent.mouseMove(document, { clientX: 120, clientY: 140 });
        expect(screen.getByTestId('drag-card-preview'), testCase.name).toBeTruthy();
        fireEvent.mouseUp(document, { clientX: 500, clientY: 300 });

        expect(spies[testCase.spy]).toHaveBeenCalledWith(...testCase.expected);
        expect(screen.queryByTestId('drag-card-preview'), testCase.name).toBeNull();
        view.unmount();
      }
    } finally {
      (document as unknown as { elementFromPoint: unknown }).elementFromPoint = original;
    }
  });
});

describe('T-90-feedback-5 ITEM-3: zero horizontal drag drift', () => {
  function fakeRect(left: number, top: number): DOMRect {
    return {
      left,
      top,
      right: left + 100,
      bottom: top + 140,
      width: 100,
      height: 140,
      x: left,
      y: top,
      toJSON: () => ({}),
    } as DOMRect;
  }

  const translateX = (value: string): number => {
    const match = value.match(/translate3d\((-?[\d.]+)px,/);
    return match ? Number(match[1]) : 0;
  };

  it('tracks 1-card, 6-card, 14-card and 30-card hands with no drift', () => {
    const cases: Array<{ count: number; index: number }> = [
      { count: 1, index: 0 },
      { count: 6, index: 0 },
      { count: 6, index: 5 },
      { count: 14, index: 0 },
      { count: 14, index: 7 },
      { count: 14, index: 13 },
      { count: 30, index: 0 },
      { count: 30, index: 15 },
      { count: 30, index: 29 },
    ];

    for (const { count, index } of cases) {
      const view = mountTable(DECK.slice(0, count), { onReorderHand: vi.fn() });
      const box = screen.getByTestId('hand-turn-highlight') as HTMLElement;
      const stageLeft = 120;
      const stageTop = 60;
      vi.spyOn(box, 'getBoundingClientRect').mockReturnValue(fakeRect(stageLeft, stageTop));

      const wrapper = handWrappers()[index];
      const layoutX = Number(wrapper.getAttribute('data-card-x'));
      const cardLeft = stageLeft + layoutX;
      vi.spyOn(wrapper, 'getBoundingClientRect').mockReturnValue(
        fakeRect(cardLeft, stageTop),
      );

      const startX = 40;
      const startY = 80;
      fireEvent.mouseDown(wrapper, { button: 0, clientX: startX, clientY: startY });

      for (const [clientX, clientY] of [
        [startX + 4, startY],
        [startX + 90, startY + 60],
        [startX + 220, startY + 120],
      ]) {
        fireEvent.mouseMove(document, { clientX, clientY });
        // T-95 #3: resolve the live left edge from the real flex contract, not
        // from the reported `data-card-x`, so a stylesheet margin override can
        // never hide a horizontal offset.
        const currentBaseX = flexRowLefts(handWrappers())[index];
        const renderedCenterX =
          stageLeft +
          currentBaseX +
          translateX(wrapper.style.transform) +
          CARD_WIDTH / 2;
        // T-95-audit-gap-20261122_203506-1: the card's exact centre — not its
        // grab point — is locked to the pointer, for every hand index.
        expect(renderedCenterX).toBeCloseTo(clientX, 5);
      }

      fireEvent.mouseUp(document, { clientX: startX + 220, clientY: startY + 120 });
      view.unmount();
    }
  });
});

describe('T-95 #3: the collapsed drag slot closes the gap exactly', () => {
  const compactPositions = (cardCount: number): readonly number[] =>
    computeHandLayout({
      cardCount,
      containerWidth: HAND_FALLBACK_WIDTH - HAND_CONTOUR_PADDING * 2,
      baseCardWidth: CARD_WIDTH,
      baseCardHeight: CARD_HEIGHT,
      minVisibleStripPx: CARD_INDEX_STRIP_WIDTH_PX,
      maximalBoxWidth: HAND_FALLBACK_WIDTH - HAND_LANE_MARGIN_PX * 2,
    }).cardPositions;

  it('keeps the negative gap-closing margin that anchors the drag origin', () => {
    for (const { count, index } of [
      { count: 6, index: 1 },
      { count: 14, index: 7 },
      { count: 30, index: 15 },
    ]) {
      const view = mountTable(DECK.slice(0, count), { onReorderHand: vi.fn() });
      const wrappers = handWrappers();
      const compact = compactPositions(count - 1);
      const expectedMargin =
        compact[Math.min(index, compact.length - 1)] -
        compact[Math.max(0, index - 1)] -
        CARD_WIDTH;

      fireEvent.mouseDown(wrappers[index], { button: 0, clientX: 40, clientY: 80 });
      fireEvent.mouseMove(document, { clientX: 260, clientY: 160 });

      const collapsed = handWrappers()[index];
      expect(collapsed.getAttribute('data-collapsed')).toBe('true');
      // A zero-width slot in the compacted row needs one negative stride of
      // margin; forcing it to `0` would leave exactly that much of a hole.
      expect(expectedMargin).toBeLessThan(0);
      expect(Number.parseFloat(collapsed.style.marginLeft)).toBeCloseTo(expectedMargin, 2);

      // Every real left edge matches the x the drag math and contour use.
      const actual = flexRowLefts(handWrappers());
      const reported = handWrappers().map((node) =>
        Number(node.getAttribute('data-card-x')),
      );
      actual.forEach((left, cardIndex) => {
        expect(left, `card ${cardIndex}`).toBeCloseTo(reported[cardIndex], 2);
      });
      // The compacted row stays strictly inside the maximal hand box.
      expect(actual[actual.length - 1] + CARD_WIDTH).toBeLessThanOrEqual(
        HAND_FALLBACK_WIDTH - HAND_LANE_MARGIN_PX * 2 + 0.01,
      );

      fireEvent.mouseUp(document, { clientX: 260, clientY: 160 });
      view.unmount();
    }
  });

  it('never overrides the inline gap-closing margin in the stylesheet', () => {
    const collapsed = cssRule(tableCss, ".hand-card-wrapper[data-collapsed='true'] {");
    expect(collapsed).toContain('overflow: visible');
    expect(collapsed).not.toMatch(/margin-left:\s*0\s*!important/);
  });
});

describe('T-96 item 6: contour expansion never shifts the hand row', () => {
  it('pins the stage to one minmax(0, 1fr) track and starts the row', () => {
    const stage = cssRule(tableCss, '.hand-cards {');
    expect(stage).toContain('grid-template-columns: minmax(0, 1fr)');
    expect(stage).toContain('justify-content: start');
    // The old `auto` track sized itself from the contour's margin box, so a
    // widened contour re-centred (and therefore shifted) the whole row.
    expect(stage).not.toContain('grid-template-columns: auto');

    // The contour stays a stacked overlay layer; it never adds track width.
    const contour = cssRule(tableCss, '.hand-highlight-contour {');
    expect(contour).toContain('grid-area: 1 / 1');
    expect(contour).toContain('overflow: visible');
  });

  it('keeps the stage width fixed while card 2 stays pinned and card 3 parts right', () => {
    mountTable(DECK.slice(0, 6), { awaitingAttack: true });

    const box = screen.getByTestId('hand-turn-highlight') as HTMLElement;
    const contour = screen.getByTestId('hand-highlight-contour') as HTMLElement;
    const stageWidthAtRest = box.style.width;
    const contourWidthAtRest = Number.parseFloat(contour.style.width);
    const before = handWrappers().map((wrapper) =>
      Number(wrapper.getAttribute('data-card-x')),
    );

    fireEvent.mouseMove(handWrappers()[2], { bubbles: true });

    const after = handWrappers().map((wrapper) =>
      Number(wrapper.getAttribute('data-card-x')),
    );
    const deltas = handWrappers().map((wrapper) =>
      Number(wrapper.getAttribute('data-part-delta-x')),
    );

    // The hovered card is pinned in the resting coordinate space ...
    expect(after[2]).toBe(before[2]);
    expect(deltas[2]).toBe(0);
    // ... its neighbours part outward ...
    expect(deltas[1]).toBeLessThan(0);
    expect(deltas[3]).toBeCloseTo(14.67, 2);
    // ... and the contour widens WITHOUT changing the stage's track width, so
    // no `justify-content` re-centring can move the row (the old -17px jump).
    expect(Number.parseFloat(contour.style.width)).toBeGreaterThan(contourWidthAtRest);
    expect(box.style.width).toBe(stageWidthAtRest);
  });
});
