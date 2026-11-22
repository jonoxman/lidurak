import { afterEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/preact';
import {
  CARD_HEIGHT,
  CARD_WIDTH,
  GameTable,
  HAND_CONTOUR_PADDING,
  HAND_FALLBACK_WIDTH,
  HAND_FALLBACK_WIDTH_MOBILE,
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
import type { CardData } from '../components/Card';
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

  it('keeps small hands (2-6 cards) at the 20% overlap floor without overflowing', () => {
    for (const count of [2, 3, 4, 5, 6]) {
      const view = mountTable(DECK.slice(0, count), { awaitingAttack: true });
      const box = screen.getByTestId('hand-turn-highlight') as HTMLElement;
      const wrappers = handWrappers();
      const stride = Number(box.getAttribute('data-stride-px'));

      expect(wrappers).toHaveLength(count);
      expect(Number(box.getAttribute('data-overlap-ratio'))).toBeCloseTo(
        HAND_MIN_OVERLAP_RATIO,
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

  it('contains the 30 / 34 / 46-card QA stress hands at the 80% cap', () => {
    for (const count of [30, 34, 46]) {
      const view = mountTable(DECK.slice(0, count), { awaitingAttack: true });
      const box = screen.getByTestId('hand-turn-highlight') as HTMLElement;
      const wrappers = handWrappers();
      const layoutWidth = Number(box.getAttribute('data-hand-width'));
      const renderedWidth = Number(box.getAttribute('data-rendered-hand-width'));
      const stride = Number(box.getAttribute('data-stride-px'));

      // Every card is rendered: nothing is hidden, stacked or removed.
      expect(wrappers).toHaveLength(count);
      expect(wrappers.filter((node) => node.getAttribute('data-hidden') === 'true')).toHaveLength(
        0,
      );
      expect(Number(box.getAttribute('data-overlap-ratio'))).toBeCloseTo(
        HAND_MAX_OVERLAP_RATIO,
        5,
      );
      expect(stride).toBeGreaterThanOrEqual(CARD_WIDTH * 0.2 - 1e-9);

      // The last card's right edge is exactly the row width, and the row is
      // scaled into the hand zone, so it can never reach the deck or controls.
      const last = wrappers[wrappers.length - 1];
      expect(Number(last.getAttribute('data-card-x')) + CARD_WIDTH).toBeCloseTo(
        layoutWidth,
        5,
      );
      expect(renderedWidth).toBeLessThanOrEqual(available + 1e-9);
      expect(Number(box.getAttribute('data-fit-scale'))).toBeLessThan(1);
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
    expect(Number(box.getAttribute('data-overlap-ratio'))).toBeCloseTo(
      HAND_MAX_OVERLAP_RATIO,
      5,
    );
    expect(Number(box.getAttribute('data-rendered-hand-width'))).toBeLessThanOrEqual(
      availableMobile + 1e-9,
    );
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
