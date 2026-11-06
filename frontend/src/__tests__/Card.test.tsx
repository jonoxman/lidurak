import { afterEach, describe, expect, it, vi } from 'vitest';
import { act, fireEvent, render, screen } from '@testing-library/preact';
import {
  ACE_PIP,
  CARD_CORNER_FONT_FAMILY,
  CARD_DEFAULT_HEIGHT,
  CARD_DEFAULT_WIDTH,
  CARD_INDEX,
  CARD_SERIF_FONT_FAMILY,
  Card,
  cardFrontPalette,
  PIP_COLUMNS,
  PIP_FONT_SIZE,
  PIP_LAYOUT_BOUNDS,
  PIP_ROWS,
  resolveCardFrontTheme,
} from '../components/Card';
import {
  CARD_BACK_PATTERNS,
  COLORFUL_CARD_BACK_PATTERNS,
  CardBack,
  DARK_CARD_BACK_OUTLINE,
  DARK_CARD_BACK_PALETTE,
  LIGHT_CARD_BACK_PALETTE,
  resolveCardBackTheme,
  svgCornerRadius,
} from '../components/CardBack';
import { resetSettings, setSettings } from '../state/settings';
import tableCss from '../styles/table.css?raw';

describe('Card', () => {
  it('renders a face-up card with its rank and suit text', () => {
    const { container } = render(<Card suit="hearts" rank="ace" />);

    const svg = screen.getByLabelText('ace of hearts');
    expect(svg.tagName.toLowerCase()).toBe('svg');

    const texts = Array.from(container.querySelectorAll('text')).map(
      (node) => node.textContent,
    );
    expect(texts[0]).toBe('A');
    expect(texts.filter((text) => text === '♥')).toHaveLength(3);
    expect(container.querySelector('.card-slot')!.getAttribute('data-suit')).toBe('hearts');
  });

  it('colors heart and diamond suits red and black suits sharp black', () => {
    const { container: red } = render(<Card suit="diamonds" rank="king" />);
    expect(red.querySelector('text')!.getAttribute('fill')).toBe('#c33');

    for (const suit of ['clubs', 'spades']) {
      const { container } = render(<Card suit={suit} rank="nine" />);
      expect(container.querySelector('text')!.getAttribute('fill')).toBe('#111111');
    }
  });

  it('renders a face-down card back without rank or suit text', () => {
    const { container } = render(<Card suit="spades" rank="seven" faceUp={false} />);

    expect(screen.getByLabelText('Card back')).toBeTruthy();
    expect(container.querySelector('.card-slot .card-back')).toBeTruthy();
    expect(container.querySelectorAll('text')).toHaveLength(0);
  });

  it('marks a selected card with the selected class and state', () => {
    const { container } = render(<Card suit="clubs" rank="queen" selected />);

    expect(container.querySelector('.card-slot')!.classList.contains('selected')).toBe(true);
    expect(container.querySelector('.card-slot')!.getAttribute('data-selected')).toBe('true');
  });

  it('marks a trump card with the gilded border and no corner badge', () => {
    const { container } = render(<Card suit="spades" rank="ace" trump />);

    const slot = container.querySelector('.card-slot')!;
    expect(slot.classList.contains('trump')).toBe(true);
    expect(slot.getAttribute('data-trump')).toBe('true');

    // T-90-2 ITEM-12: the gilded border alone marks a trump — the old circles
    // and extra suit symbols are gone, and the card paints no glowing aura.
    const face = container.querySelector('svg.playing-card')!;
    expect(face.classList.contains('trump-card')).toBe(true);
    expect(face.getAttribute('data-trump-glow')).toBe('false');
    expect(container.querySelector('[data-testid="trump-marker"]')).toBeNull();
    expect(container.querySelector('[data-testid="trump-badge-top-right"]')).toBeNull();
    expect(container.querySelector('[data-testid="trump-badge-bottom-left"]')).toBeNull();
    expect(face.querySelectorAll('circle')).toHaveLength(0);
    expect(tableCss).toMatch(
      /\.playing-card\.trump-card\s*{[^}]*border: 2px solid var\(--trump-border, #f59e0b\)/,
    );
    expect(tableCss).toMatch(/\.playing-card\.trump-card\s*{[^}]*box-shadow: none/);
  });

  it('leaves a non-trump card unglowed without a badge', () => {
    const { container } = render(<Card suit="clubs" rank="nine" />);

    expect(container.querySelector('.card-slot')!.classList.contains('trump')).toBe(false);
    expect(container.querySelector('.card-slot')!.getAttribute('data-trump')).toBe('false');
    expect(container.querySelector('[data-testid="trump-marker"]')).toBeNull();
  });

  it('fires the click handler when the card is clicked', () => {
    const onClick = vi.fn();
    const { container } = render(<Card suit="diamonds" rank="six" onClick={onClick} />);

    fireEvent.click(container.querySelector('.card-slot')!);

    expect(onClick).toHaveBeenCalledTimes(1);
  });

  it('renders one suit pip per rank for number cards 2 through 10', () => {
    const ranks = [
      'two',
      'three',
      'four',
      'five',
      'six',
      'seven',
      'eight',
      'nine',
      'ten',
    ];

    ranks.forEach((rank, index) => {
      const { container, unmount } = render(<Card suit="spades" rank={rank} />);
      const pips = container.querySelectorAll('[data-pip="rank"]');
      expect(pips.length, rank).toBe(index + 2);
      unmount();
    });
  });

  it('renders a single ornate ace pip about half the card width', () => {
    const { container } = render(<Card suit="spades" rank="ace" />);

    const pips = container.querySelectorAll('[data-pip]');
    expect(pips).toHaveLength(1);
    expect(pips[0].getAttribute('data-pip')).toBe('ace');
    expect(Number(pips[0].getAttribute('font-size'))).toBeGreaterThanOrEqual(40);
    // T-90-1 ITEM-3b: the 40pt centrepiece sits on the exact card centre
    // `(35, 50)`, so its left/right (`35` / `35`) and top/bottom (`50` / `50`)
    // margins match, and its carve-out clears the corner suit indices.
    expect(pips[0].getAttribute('x')).toBe(String(ACE_PIP.x));
    expect(pips[0].getAttribute('y')).toBe(String(ACE_PIP.y));
    expect(ACE_PIP.x).toBe(35);
    expect(ACE_PIP.y).toBe(50);
    expect(ACE_PIP.x).toBeGreaterThan(
      CARD_INDEX.topSuit.x + (CARD_INDEX.topSuit.fontSize * GLYPH_METRICS.suitWidth) / 2,
    );
  });

  it('centers the J, Q and K letters on the card', () => {
    const faces = [
      ['jack', 'J'],
      ['queen', 'Q'],
      ['king', 'K'],
    ] as const;

    faces.forEach(([rank, letter]) => {
      const { container, unmount } = render(<Card suit="hearts" rank={rank} />);
      const face = container.querySelector('[data-pip="face"]')!;
      expect(face.textContent).toBe(letter);
      expect(face.getAttribute('x')).toBe('35');
      expect(face.getAttribute('y')).toBe('50');
      expect(face.getAttribute('text-anchor')).toBe('middle');
      expect(face.getAttribute('dominant-baseline')).toBe('central');
      unmount();
    });
  });

  it('places face-card pips at the ends of the center letter', () => {
    const layouts = [
      ['jack', ['top-left', 'top-right', 'bottom-left']],
      ['queen', ['bottom-right']],
      ['king', ['top-left', 'top-right', 'bottom-left', 'bottom-right']],
    ] as const;

    layouts.forEach(([rank, corners]) => {
      const { container, unmount } = render(<Card suit="spades" rank={rank} />);
      const pips = Array.from(container.querySelectorAll('.face-pip'));
      expect(pips.map((pip) => pip.getAttribute('data-corner')), rank).toEqual([...corners]);
      expect(container.querySelectorAll('[data-pip="decor"]')).toHaveLength(corners.length);
      unmount();
    });
  });

  it('rotates each face pip so its distinguishing half faces outward', () => {
    const corners = ['top-left', 'top-right', 'bottom-right', 'bottom-left'] as const;

    const angleOf = (suit: string, corner: string): number => {
      const { container, unmount } = render(<Card suit={suit} rank="king" />);
      const pip = container.querySelector(`.face-pip[data-corner="${corner}"]`)!;
      const angle = Number(pip.getAttribute('data-rotation'));
      expect(pip.getAttribute('transform')).toBe(
        `rotate(${angle} ${pip.getAttribute('x')} ${pip.getAttribute('y')})`,
      );
      expect(pip.getAttribute('dominant-baseline')).toBe('central');
      unmount();
      return angle;
    };

    const offset = (angle: number): number => ((((angle % 360) + 540) % 360) - 180);

    corners.forEach((corner) => {
      const hearts = angleOf('hearts', corner);
      const clubs = angleOf('clubs', corner);
      const spades = angleOf('spades', corner);
      const diamonds = angleOf('diamonds', corner);

      // Hearts and clubs share a rotation, as do spades and diamonds.
      expect(clubs, corner).toBe(hearts);
      expect(diamonds, corner).toBe(spades);
      // Spades/diamonds expose their bottom half, exactly opposite the upper half.
      expect(Math.abs(offset(spades - hearts)), corner).toBe(180);
    });

    // Top-left points up-left for hearts and down-right for spades.
    expect(angleOf('hearts', 'top-left')).toBe(-45);
    expect(angleOf('spades', 'top-left')).toBe(135);
  });



  it('renders six distinct card back patterns', () => {
    expect(CARD_BACK_PATTERNS).toHaveLength(6);

    const seen = new Set<string>();
    for (const pattern of CARD_BACK_PATTERNS) {
      const { container, unmount } = render(<CardBack pattern={pattern} />);
      const svg = container.querySelector('svg.card-back')!;
      expect(svg.getAttribute('data-pattern')).toBe(pattern);
      expect(container.querySelector(`rect[data-pattern-fill="${pattern}"]`)).not.toBeNull();
      expect(container.querySelector('pattern')).not.toBeNull();
      seen.add(pattern);
      unmount();
    }
    expect(seen.size).toBe(6);
  });

  it('defaults the card back to the classic hatch pattern', () => {
    const { container } = render(<CardBack />);

    expect(container.querySelector('svg')!.getAttribute('data-pattern')).toBe('classic-hatch');
  });
});

type Box = { left: number; right: number; top: number; bottom: number };

/**
 * Ink metrics of the glyphs the cards draw, in em units. They describe the
 * painted ink rather than the advance box: a suit symbol's ink is about `0.8 em`
 * wide (its advance box is a little wider), a digit/letter about `0.62 em`, and
 * a `dominant-baseline="central"` glyph is centred on its `y` instead of
 * hanging above a baseline. Measuring ink is what makes the T-90-1 centred grid
 * (`22.5` / `35` / `47.5`, `32`–`68`) verifiable against the corner indices.
 */
const GLYPH_METRICS = {
  textWidth: 0.62,
  suitWidth: 0.8,
  ascent: 0.75,
  descent: 0.02,
  centralHalfHeight: 0.39,
} as const;

/** Approximate glyph box of a rendered SVG `<text>`, in viewBox units. */
const textBox = (node: Element): Box => {
  const text = node.textContent ?? '';
  const fontSize = Number(node.getAttribute('font-size'));
  const x = Number(node.getAttribute('x'));
  const y = Number(node.getAttribute('y'));
  const anchor = node.getAttribute('text-anchor') ?? 'start';
  const wide = /[^0-9A-Za-z]/.test(text);
  const width =
    text.length * fontSize * (wide ? GLYPH_METRICS.suitWidth : GLYPH_METRICS.textWidth);
  const left = anchor === 'middle' ? x - width / 2 : anchor === 'end' ? x - width : x;
  const central = node.getAttribute('dominant-baseline') === 'central';
  return {
    left,
    right: left + width,
    top: central ? y - fontSize * GLYPH_METRICS.centralHalfHeight : y - fontSize * GLYPH_METRICS.ascent,
    bottom: central
      ? y + fontSize * GLYPH_METRICS.centralHalfHeight
      : y + fontSize * GLYPH_METRICS.descent,
  };
};

const overlaps = (a: Box, b: Box): boolean =>
  a.right > b.left && a.left < b.right && a.bottom > b.top && a.top < b.bottom;

/**
 * The painted box of a glyph that may carry a `rotate(180 cx cy)` transform.
 * T-90-2 ITEM-11 inverts the bottom-right corner index, so measuring where the
 * ink actually lands needs the rotation applied instead of the raw `x`/`y`.
 */
const renderedBox = (node: Element): Box => {
  const box = textBox(node);
  const transform = node.getAttribute('transform') ?? '';
  const rotation = /rotate\(\s*(-?[\d.]+)\s+(-?[\d.]+)\s+(-?[\d.]+)\s*\)/.exec(transform);
  if (!rotation) return box;
  const angle = ((Number(rotation[1]) % 360) + 360) % 360;
  if (Math.abs(angle - 180) > 1e-6) return box;
  const cx = Number(rotation[2]);
  const cy = Number(rotation[3]);
  return {
    left: 2 * cx - box.right,
    right: 2 * cx - box.left,
    top: 2 * cy - box.bottom,
    bottom: 2 * cy - box.top,
  };
};

const NUMBER_RANKS = [
  'two',
  'three',
  'four',
  'five',
  'six',
  'seven',
  'eight',
  'nine',
  'ten',
];
const ALL_RANKS = [...NUMBER_RANKS, 'ace', 'jack', 'queen', 'king'];

/** Every pip glyph on a face-up card: rank pips, the ace centrepiece and face decoration. */
const cardPips = (container: Element): Element[] =>
  Array.from(
    container.querySelectorAll('[data-pip="rank"], [data-pip="ace"], [data-pip="decor"]'),
  );

describe('card face geometry and theme', () => {
  afterEach(() => {
    resetSettings();
  });

  it('keeps every pip clear of the corner rank and suit index on every rank', () => {
    for (const rank of ALL_RANKS) {
      const { container, unmount } = render(<Card suit="spades" rank={rank} />);
      const pips = cardPips(container);
      const indices = Array.from(container.querySelectorAll('[data-index]'));

      expect(pips.length, rank).toBeGreaterThan(0);
      expect(indices, rank).toHaveLength(4);

      for (const pip of pips) {
        for (const index of indices) {
          expect(
            overlaps(textBox(pip), renderedBox(index)),
            `${rank}: pip at ${pip.getAttribute('x')},${pip.getAttribute('y')} overlaps ${index.getAttribute(
              'data-index',
            )}`,
          ).toBe(false);
        }
      }

      unmount();
    }
  });

  it('keeps the two-digit 10 index clear of all ten pips', () => {
    const { container } = render(<Card suit="hearts" rank="ten" />);

    const rankIndex = container.querySelector('[data-index="top-rank"]')!;
    const suitIndex = container.querySelector('[data-index="top-suit"]')!;
    expect(rankIndex.textContent).toBe('10');

    const rankBox = textBox(rankIndex);
    const suitBox = textBox(suitIndex);
    const pips = Array.from(container.querySelectorAll('[data-pip="rank"]'));
    expect(pips).toHaveLength(10);

    for (const pip of pips) {
      const box = textBox(pip);
      expect(overlaps(box, rankBox), `pip at ${pip.getAttribute('x')},${pip.getAttribute('y')}`).toBe(
        false,
      );
      expect(overlaps(box, suitBox), `pip at ${pip.getAttribute('x')},${pip.getAttribute('y')}`).toBe(
        false,
      );
      // Every glyph also stays inside the card face.
      expect(box.left, 'left').toBeGreaterThan(2);
      expect(box.right, 'right').toBeLessThan(68);
      expect(box.top, 'top').toBeGreaterThan(2);
      expect(box.bottom, 'bottom').toBeLessThan(98);
    }
  });

  it('spaces the pips so no two of them touch each other', () => {
    for (const rank of ALL_RANKS) {
      const { container, unmount } = render(<Card suit="diamonds" rank={rank} />);
      const boxes = cardPips(container).map(textBox);

      for (let first = 0; first < boxes.length; first += 1) {
        for (let second = first + 1; second < boxes.length; second += 1) {
          expect(overlaps(boxes[first], boxes[second]), `${rank}: pips ${first}/${second}`).toBe(
            false,
          );
        }
      }

      unmount();
    }
  });


  it('paints a white card front in the light theme and a grey front in the dark theme', () => {
    setSettings({ theme: 'light' });
    const light = render(<Card suit="spades" rank="ten" />);
    const lightSvg = light.container.querySelector('svg.playing-card')!;
    expect(lightSvg.getAttribute('data-card-theme')).toBe('light');
    expect(light.container.querySelector('.card-slot')!.getAttribute('data-card-theme')).toBe(
      'light',
    );
    expect(lightSvg.querySelector('rect')!.getAttribute('fill')).toBe('#ffffff');
    expect(cardFrontPalette('light').face).toBe('#ffffff');
    light.unmount();

    setSettings({ theme: 'dark' });
    const dark = render(<Card suit="hearts" rank="ten" />);
    const darkSvg = dark.container.querySelector('svg.playing-card')!;
    expect(darkSvg.getAttribute('data-card-theme')).toBe('dark');
    expect(dark.container.querySelector('.card-slot')!.getAttribute('data-card-theme')).toBe(
      'dark',
    );
    expect(darkSvg.querySelector('rect')!.getAttribute('fill')).toBe('#cbd5e1');
    expect(cardFrontPalette('dark').face).toBe('#cbd5e1');
    // White and grey are genuinely different card faces.
    expect(cardFrontPalette('light').face).not.toBe(cardFrontPalette('dark').face);
    dark.unmount();
  });

  it('resolves the device card front from the applied document theme', () => {
    setSettings({ theme: 'device' });

    document.documentElement.setAttribute('data-theme', 'light');
    expect(resolveCardFrontTheme('device')).toBe('light');

    document.documentElement.setAttribute('data-theme', 'dark');
    expect(resolveCardFrontTheme('device')).toBe('dark');

    expect(resolveCardFrontTheme('light', true)).toBe('light');
    expect(resolveCardFrontTheme('dark', false)).toBe('dark');
    // Without an applied theme it follows the OS preference.
    expect(resolveCardFrontTheme('device', false, document.createElement('div'))).toBe('light');
    expect(resolveCardFrontTheme('device', true, document.createElement('div'))).toBe('dark');
  });
});

describe('card sprite serif typography and Roundness (T-90-2)', () => {
  afterEach(() => {
    resetSettings();
  });

  it('exposes the sans-serif corner stack and the classic serif court stack', () => {
    // The exact stacks the ticket specifies: sans-serif for the corner
    // indices, ornate serif for the large centre `J`/`Q`/`K` letters only.
    expect(CARD_CORNER_FONT_FAMILY).toBe(
      "Inter, system-ui, -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif",
    );
    expect(CARD_SERIF_FONT_FAMILY).toBe(
      "'Cinzel', 'Playfair Display', Georgia, 'Times New Roman', 'Palatino Linotype', 'Book Antiqua', serif",
    );
    expect(CARD_CORNER_FONT_FAMILY).toContain('Inter');
    expect(CARD_CORNER_FONT_FAMILY).toContain('system-ui');
    expect(CARD_CORNER_FONT_FAMILY).toContain('Segoe UI');
    expect(CARD_CORNER_FONT_FAMILY.trim().endsWith('sans-serif')).toBe(true);
    expect(CARD_CORNER_FONT_FAMILY).not.toContain('Cinzel');
    expect(CARD_CORNER_FONT_FAMILY).not.toContain('Georgia');

    expect(CARD_SERIF_FONT_FAMILY).toContain('Cinzel');
    expect(CARD_SERIF_FONT_FAMILY).toContain('Playfair Display');
    expect(CARD_SERIF_FONT_FAMILY).toContain('Georgia');
    expect(CARD_SERIF_FONT_FAMILY).toContain('Times New Roman');
    expect(CARD_SERIF_FONT_FAMILY.trim().endsWith('serif')).toBe(true);
  });

  it('ITEM-3a: every corner rank number and letter uses CARD_CORNER_FONT_FAMILY (sans-serif)', () => {
    const ranks: Array<[string, string]> = [
      ['two', '2'],
      ['three', '3'],
      ['four', '4'],
      ['five', '5'],
      ['six', '6'],
      ['seven', '7'],
      ['eight', '8'],
      ['nine', '9'],
      ['ten', '10'],
      ['jack', 'J'],
      ['queen', 'Q'],
      ['king', 'K'],
      ['ace', 'A'],
    ];

    for (const [rank, label] of ranks) {
      const { container, unmount } = render(<Card suit="hearts" rank={rank} />);

      for (const testId of ['card-rank-top', 'card-rank-bottom']) {
        const node = container.querySelector(`[data-testid="${testId}"]`)!;
        const family = node.getAttribute('font-family') ?? '';
        expect(node, `${rank} ${testId}`).not.toBeNull();
        expect(node.textContent, `${rank} ${testId}`).toBe(label);
        expect(node.classList.contains('card-rank-index'), `${rank} ${testId}`).toBe(true);
        expect(node.getAttribute('data-font-style'), `${rank} ${testId}`).toBe('sans-serif');
        expect(family, `${rank} ${testId}`).toBe(CARD_CORNER_FONT_FAMILY);
        expect(family, `${rank} ${testId}`).not.toBe(CARD_SERIF_FONT_FAMILY);
        expect(family, `${rank} ${testId}`).not.toMatch(/Cinzel|Playfair Display|Times New Roman/);
        expect(family, `${rank} ${testId}`).toMatch(/sans-serif$/);
        expect(node.getAttribute('font-weight'), `${rank} ${testId}`).toBe('700');
      }

      unmount();
    }
  });

  it('ITEM-3b: only the large J, Q and K centre letters use CARD_SERIF_FONT_FAMILY (serif)', () => {
    const faces = [
      ['jack', 'J'],
      ['queen', 'Q'],
      ['king', 'K'],
    ] as const;

    for (const [rank, letter] of faces) {
      const { container, unmount } = render(<Card suit="clubs" rank={rank} />);
      const node = container.querySelector('[data-testid="card-face-letter"]')!;
      const family = node.getAttribute('font-family') ?? '';

      expect(node.textContent, rank).toBe(letter);
      expect(node.classList.contains('card-face-letter'), rank).toBe(true);
      expect(node.getAttribute('data-font-style'), rank).toBe('serif');
      expect(family, rank).toBe(CARD_SERIF_FONT_FAMILY);
      expect(family, rank).not.toBe(CARD_CORNER_FONT_FAMILY);
      expect(family, rank).toMatch(/Cinzel|Playfair Display|Times New Roman/);
      expect(node.getAttribute('font-weight'), rank).toBe('700');
      unmount();
    }

    // Number cards and aces render no centre court letter at all.
    for (const rank of ['two', 'ten', 'ace']) {
      const { container, unmount } = render(<Card suit="clubs" rank={rank} />);
      expect(container.querySelector('[data-testid="card-face-letter"]'), rank).toBeNull();
      unmount();
    }
  });

  it('ITEM-3c: court cards pair sans-serif corner letters with a serif centre letter', () => {
    const faces = [
      ['jack', 'J'],
      ['queen', 'Q'],
      ['king', 'K'],
    ] as const;

    for (const [rank, letter] of faces) {
      const { container, unmount } = render(<Card suit="diamonds" rank={rank} />);

      for (const testId of ['card-rank-top', 'card-rank-bottom']) {
        const corner = container.querySelector(`[data-testid="${testId}"]`)!;
        expect(corner.textContent, `${rank} ${testId}`).toBe(letter);
        expect(corner.getAttribute('font-family'), `${rank} ${testId}`).toBe(
          CARD_CORNER_FONT_FAMILY,
        );
        expect(corner.getAttribute('font-family'), `${rank} ${testId}`).not.toBe(
          CARD_SERIF_FONT_FAMILY,
        );
        expect(corner.getAttribute('data-font-style'), `${rank} ${testId}`).toBe('sans-serif');
        expect(corner.getAttribute('font-weight'), `${rank} ${testId}`).toBe('700');
      }

      const centre = container.querySelector('[data-testid="card-face-letter"]')!;
      expect(centre.textContent, rank).toBe(letter);
      expect(centre.getAttribute('font-family'), rank).toBe(CARD_SERIF_FONT_FAMILY);
      expect(centre.getAttribute('font-family'), rank).not.toBe(CARD_CORNER_FONT_FAMILY);
      expect(centre.getAttribute('data-font-style'), rank).toBe('serif');
      expect(centre.getAttribute('font-weight'), rank).toBe('700');

      unmount();
    }
  });

  it('keeps the stylesheet rules in sync with both card font stacks', () => {
    // A CSS declaration beats the SVG `font-family` presentation attribute, so
    // these three rules are what actually renders the card text.
    const ruleOf = (selector: string): string => {
      const pattern = new RegExp(`${selector.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')} \\{([^}]*)\\}`);
      const match = pattern.exec(tableCss);
      expect(match, selector).not.toBeNull();
      return match![1].replace(/\s+/g, ' ');
    };

    // ITEM-3a: the corner indices are repainted sans-serif.
    const corner = ruleOf('.playing-card .card-rank-index');
    expect(corner).toContain('Inter');
    expect(corner).toContain('system-ui');
    expect(corner).toContain('Segoe UI');
    // The declaration ends on the generic `sans-serif` fallback.
    expect(corner.trim()).toMatch(/sans-serif;$/);
    expect(corner).not.toContain('Cinzel');
    expect(corner).not.toContain('Georgia');

    // ITEM-3b: the large centre court letters keep the ornate serif stack.
    const centre = ruleOf('.playing-card .card-face-letter');
    for (const face of ['Cinzel', 'Playfair Display', 'Georgia', 'Times New Roman', 'serif']) {
      expect(CARD_SERIF_FONT_FAMILY, face).toContain(face);
      expect(centre, face).toContain(face);
    }

    // The shared glyph rule still carries the serif stack for the pips.
    const glyphs = ruleOf('.playing-card text');
    for (const face of ['Cinzel', 'Playfair Display', 'Georgia', 'Times New Roman', 'serif']) {
      expect(glyphs, face).toContain(face);
    }
  });

  it('keeps the rank band and pip layout on the ticket geometry', () => {
    const { container } = render(<Card suit="spades" rank="ten" />);

    const topRank = container.querySelector('[data-index="top-rank"]')!;
    const topSuit = container.querySelector('[data-index="top-suit"]')!;
    expect(topRank.getAttribute('x')).toBe('7.5');
    expect(topRank.getAttribute('y')).toBe('21');
    expect(topSuit.getAttribute('y')).toBe('34');
    expect(container.querySelector('[data-pip="rank"]')!.getAttribute('y')).toBe(
      String(PIP_ROWS.top),
    );
  });

  it('scales face-up card SVG frame corners and wrapper radii with Roundness', () => {
    const { container } = render(<Card suit="diamonds" rank="eight" />);
    const slot = container.querySelector('.card-slot')!;
    const svg = container.querySelector('svg.card-face')!;
    const frame = container.querySelector('svg.card-face > rect')!;

    const expectRadii = (roundness: number) => {
      const expected = svgCornerRadius(roundness);
      expect(svgCornerRadius(0)).toBe(0);
      expect(svgCornerRadius(8)).toBe(6);
      expect(svgCornerRadius(16)).toBe(12);
      expect(frame.getAttribute('rx'), `roundness ${roundness}`).toBe(String(expected));
      expect(frame.getAttribute('ry'), `roundness ${roundness}`).toBe(String(expected));
      expect(slot.getAttribute('data-roundness'), `roundness ${roundness}`).toBe(
        String(roundness),
      );
      expect(svg.getAttribute('data-roundness'), `roundness ${roundness}`).toBe(
        String(roundness),
      );
    };

    expectRadii(8);

    act(() => {
      setSettings({ roundness: 0 });
    });
    expectRadii(0);
    expect(frame.getAttribute('rx')).toBe('0');

    act(() => {
      setSettings({ roundness: 16 });
    });
    expectRadii(16);
    expect(frame.getAttribute('rx')).toBe('12');
  });

  it('scales face-down card backs and decorative borders with Roundness', () => {
    const back = render(<CardBack />);
    const faceDown = render(<Card suit="spades" rank="six" faceUp={false} />);

    const rectsOf = (container: Element): Element[] => {
      const svg = container.querySelector('svg.card-back')!;
      return Array.from(svg.children).filter(
        (child) => child.tagName.toLowerCase() === 'rect',
      );
    };

    const expectBackRadii = (roundness: number) => {
      const outer = svgCornerRadius(roundness);
      const inner = Math.max(0, outer - 1.5);

      for (const container of [back.container, faceDown.container]) {
        const [frame, border] = rectsOf(container);
        expect(frame.getAttribute('rx'), `roundness ${roundness}`).toBe(String(outer));
        expect(frame.getAttribute('ry'), `roundness ${roundness}`).toBe(String(outer));
        expect(border.getAttribute('rx'), `roundness ${roundness}`).toBe(String(inner));
        expect(border.getAttribute('ry'), `roundness ${roundness}`).toBe(String(inner));
      }

      expect(back.container.querySelector('svg.card-back')!.getAttribute('data-roundness')).toBe(
        String(roundness),
      );
      // The face-down wrapper follows the same slider value.
      expect(
        faceDown.container.querySelector('.card-slot')!.getAttribute('data-roundness'),
      ).toBe(String(roundness));
    };

    expectBackRadii(8);
    expect(rectsOf(back.container)[0].getAttribute('rx')).toBe('6');
    expect(rectsOf(back.container)[1].getAttribute('rx')).toBe('4.5');

    act(() => {
      setSettings({ roundness: 0 });
    });
    expectBackRadii(0);
    // The inner border never inverts into a negative radius.
    expect(rectsOf(back.container)[1].getAttribute('rx')).toBe('0');

    act(() => {
      setSettings({ roundness: 16 });
    });
    expectBackRadii(16);
    expect(rectsOf(back.container)[0].getAttribute('rx')).toBe('12');
    expect(rectsOf(back.container)[1].getAttribute('rx')).toBe('10.5');
  });
});

const CORNER_RANKS: Array<[string, string]> = [
  ['two', '2'],
  ['three', '3'],
  ['four', '4'],
  ['five', '5'],
  ['six', '6'],
  ['seven', '7'],
  ['eight', '8'],
  ['nine', '9'],
  ['ten', '10'],
  ['jack', 'J'],
  ['queen', 'Q'],
  ['king', 'K'],
  ['ace', 'A'],
];

describe('corner pip alignment and face pip sizing (T-90 ITEM-3a / ITEM-3b)', () => {
  afterEach(() => {
    resetSettings();
  });

  it('ITEM-3a: shares one centred x axis between every corner rank and its suit pip', () => {
    for (const [rank, label] of CORNER_RANKS) {
      const { container, unmount } = render(<Card suit="hearts" rank={rank} />);

      const rankTop = container.querySelector('[data-testid="card-rank-top"]')!;
      const suitTop = container.querySelector('[data-testid="card-suit-top"]')!;
      const rankBottom = container.querySelector('[data-testid="card-rank-bottom"]')!;
      const suitBottom = container.querySelector('[data-testid="card-suit-bottom"]')!;

      // Same `x` coordinate and the same middle anchor on both nodes, so the
      // suit pip sits exactly centred beneath the rank on every rank.
      expect(rankTop.getAttribute('x'), rank).toBe(suitTop.getAttribute('x'));
      expect(rankBottom.getAttribute('x'), rank).toBe(suitBottom.getAttribute('x'));
      for (const node of [rankTop, suitTop, rankBottom, suitBottom]) {
        expect(node.getAttribute('text-anchor'), rank).toBe('middle');
      }

      // The two glyph boxes therefore share the same horizontal centre, for the
      // single-character ranks (`2`–`9`, `J`, `Q`, `K`, `A`) and the two-digit
      // `10` alike.
      const rankCentre = (box: Box): number => (box.left + box.right) / 2;
      expect(rankCentre(textBox(rankTop)), rank).toBeCloseTo(rankCentre(textBox(suitTop)), 5);
      expect(rankCentre(textBox(rankBottom)), rank).toBeCloseTo(
        rankCentre(textBox(suitBottom)),
        5,
      );

      // The corner column is mirrored across the card centre.
      expect(Number(rankBottom.getAttribute('x')), rank).toBeCloseTo(
        70 - Number(rankTop.getAttribute('x')),
        5,
      );

      expect(rankTop.textContent, rank).toBe(label);
      expect(rankBottom.textContent, rank).toBe(label);
      expect(suitTop.textContent, rank).toBe('♥');
      expect(suitBottom.textContent, rank).toBe('♥');
      expect(suitTop.getAttribute('data-index'), rank).toBe('top-suit');
      expect(suitBottom.getAttribute('data-index'), rank).toBe('bottom-suit');

      unmount();
    }
  });

  it('ITEM-3a: enlarges the corner suit pip while keeping it clear of the rank text', () => {
    for (const [rank, label] of CORNER_RANKS) {
      const { container, unmount } = render(<Card suit="clubs" rank={rank} />);

      for (const [rankId, suitId] of [
        ['card-rank-top', 'card-suit-top'],
        ['card-rank-bottom', 'card-suit-bottom'],
      ]) {
        const rankNode = container.querySelector(`[data-testid="${rankId}"]`)!;
        const suitNode = container.querySelector(`[data-testid="${suitId}"]`)!;
        const suitSize = Number(suitNode.getAttribute('font-size'));

        // Lightly larger than the previous 10-unit corner suit (+1.5–2.5).
        expect(suitSize, `${rank} ${suitId}`).toBeGreaterThanOrEqual(11.5);
        expect(suitSize, `${rank} ${suitId}`).toBeLessThanOrEqual(12.5);

        // The rank and the larger suit glyph never overlap: the suit sits in
        // its own band (below the rank in the top-left corner, above it in the
        // mirrored bottom-right corner) with clean vertical breathing room.
        const rankBox = renderedBox(rankNode);
        const suitBox = renderedBox(suitNode);
        expect(overlaps(rankBox, suitBox), `${rank} ${rankId}/suit`).toBe(false);
        const gap = Math.max(rankBox.top - suitBox.bottom, suitBox.top - rankBox.bottom);
        expect(gap, `${rank} ${rankId}/gap`).toBeGreaterThanOrEqual(1);

        // The suit glyph stays inside the card frame and the rank keeps its
        // two-character `10` inside the left/right band.
        expect(suitBox.left, `${rank} left`).toBeGreaterThan(2);
        expect(suitBox.right, `${rank} right`).toBeLessThan(68);
        expect(rankBox.left, `${rank} rank left`).toBeGreaterThan(1.5);
        expect(rankBox.right, `${rank} rank right`).toBeLessThan(68.5);
      }

      expect(label).toBeTruthy();
      unmount();
    }
  });

  it('ITEM-3b: renders numbered-card face pips at the larger size inside the tightened bounds', () => {
    // Larger than the previous 12-unit pips.
    expect(PIP_FONT_SIZE).toBeGreaterThan(12);

    // The grid is tighter than the previous `x = 22/35/48`, `y = 33..78` table:
    // narrower overall and clearly shorter vertically.
    const previousSpan = 48 - 22;
    expect(PIP_LAYOUT_BOUNDS.maxX - PIP_LAYOUT_BOUNDS.minX).toBeLessThan(previousSpan);
    expect(PIP_LAYOUT_BOUNDS.minX).toBeGreaterThan(22);
    expect(PIP_LAYOUT_BOUNDS.maxX).toBeLessThan(55); // clear of the trump badge at x = 55
    // T-90-1 ITEM-3a: the outer rows mirror across the card centre (`32 + 68`),
    // so the grid keeps equal top/bottom margins; the top row still clears the
    // corner rank band that ends at `y = 21`.
    expect(PIP_LAYOUT_BOUNDS.minY + PIP_LAYOUT_BOUNDS.maxY).toBe(100);
    expect(PIP_LAYOUT_BOUNDS.minY).toBeGreaterThan(CARD_INDEX.topRank.y);
    expect(PIP_LAYOUT_BOUNDS.maxY - PIP_LAYOUT_BOUNDS.minY).toBeLessThan(78 - 33);
    // T-90-2 ITEM-11: the bottom-right index is the 180° mirror of the
    // top-left one (`y = 100 - 21` / `100 - 34`), so the grid clears it to the
    // left of the rotated suit ink and above the rotated rank ink.
    expect(CARD_INDEX.topSuit.y + CARD_INDEX.bottomSuit.y).toBe(100);
    expect(CARD_INDEX.topRank.y + CARD_INDEX.bottomRank.y).toBe(100);
    expect(PIP_LAYOUT_BOUNDS.maxY).toBeLessThan(CARD_INDEX.bottomRank.y);
    expect(PIP_LAYOUT_BOUNDS.maxX + (PIP_FONT_SIZE * GLYPH_METRICS.suitWidth) / 2).toBeLessThan(
      CARD_INDEX.bottomSuit.x - (CARD_INDEX.bottomSuit.fontSize * GLYPH_METRICS.suitWidth) / 2,
    );

    // The columns are still far enough apart for a full 13pt glyph.
    const glyphWidth = PIP_FONT_SIZE * GLYPH_METRICS.suitWidth;
    expect(PIP_COLUMNS.center - PIP_COLUMNS.left).toBeGreaterThanOrEqual(glyphWidth);
    expect(PIP_COLUMNS.right - PIP_COLUMNS.center).toBeGreaterThanOrEqual(glyphWidth);

    for (const rank of NUMBER_RANKS) {
      const { container, unmount } = render(<Card suit="diamonds" rank={rank} trump />);
      const pips = Array.from(container.querySelectorAll('[data-pip="rank"]'));
      expect(pips.length, rank).toBeGreaterThan(0);

      for (const pip of pips) {
        const x = Number(pip.getAttribute('x'));
        const y = Number(pip.getAttribute('y'));
        expect(Number(pip.getAttribute('font-size')), `${rank} size`).toBe(PIP_FONT_SIZE);
        expect(x, `${rank} x=${x}`).toBeGreaterThanOrEqual(PIP_LAYOUT_BOUNDS.minX);
        expect(x, `${rank} x=${x}`).toBeLessThanOrEqual(PIP_LAYOUT_BOUNDS.maxX);
        expect(y, `${rank} y=${y}`).toBeGreaterThanOrEqual(PIP_LAYOUT_BOUNDS.minY);
        expect(y, `${rank} y=${y}`).toBeLessThanOrEqual(PIP_LAYOUT_BOUNDS.maxY);
      }

      // No pip collides with a corner rank/suit index, and no two pips collide
      // with each other, even with the larger glyphs. T-90-2 ITEM-12 removed the
      // trump corner badges, so there is no badge geometry left to clear.
      expect(
        container.querySelectorAll('[data-testid="trump-marker"] circle'),
        rank,
      ).toHaveLength(0);
      const indices = Array.from(container.querySelectorAll('[data-index]'));

      for (const pip of pips) {
        const box = textBox(pip);
        for (const index of indices) {
          expect(
            overlaps(box, renderedBox(index)),
            `${rank}: pip ${pip.getAttribute('x')},${pip.getAttribute('y')} vs ${index.getAttribute(
              'data-index',
            )}`,
          ).toBe(false);
        }
      }

      for (let first = 0; first < pips.length; first += 1) {
        for (let second = first + 1; second < pips.length; second += 1) {
          expect(
            overlaps(textBox(pips[first]), textBox(pips[second])),
            `${rank}: pips ${first}/${second}`,
          ).toBe(false);
        }
      }

      unmount();
    }
  });

  it('ITEM-3b: leaves the court-card letters and the ace centrepiece geometry intact', () => {
    for (const [rank, letter] of [
      ['jack', 'J'],
      ['queen', 'Q'],
      ['king', 'K'],
    ] as const) {
      const { container, unmount } = render(<Card suit="spades" rank={rank} />);
      const face = container.querySelector('[data-testid="card-face-letter"]')!;
      expect(face.textContent, rank).toBe(letter);
      expect(face.getAttribute('x'), rank).toBe('35');
      expect(face.getAttribute('y'), rank).toBe('50');
      expect(face.getAttribute('font-size'), rank).toBe('30');
      for (const pip of Array.from(container.querySelectorAll('.face-pip'))) {
        expect(pip.getAttribute('font-size'), rank).toBe('11');
      }
      unmount();
    }

    const ace = render(<Card suit="hearts" rank="ace" />);
    const pip = ace.container.querySelector('[data-pip="ace"]')!;
    expect(pip.getAttribute('font-size')).toBe(String(ACE_PIP.fontSize));
    expect(pip.getAttribute('y')).toBe(String(ACE_PIP.y));
    expect(pip.getAttribute('x')).toBe(String(ACE_PIP.x));
  });
});

describe('centred card faces with equal margins (T-90-1 ITEM-3a / ITEM-3b)', () => {
  afterEach(() => {
    resetSettings();
  });

  const CARD_WIDTH = 70;
  const CARD_HEIGHT = 100;
  const CENTRE = { x: CARD_WIDTH / 2, y: CARD_HEIGHT / 2 };

  const boundsOf = (pips: Element[]) => {
    const xs = pips.map((pip) => Number(pip.getAttribute('x')));
    const ys = pips.map((pip) => Number(pip.getAttribute('y')));
    return {
      minX: Math.min(...xs),
      maxX: Math.max(...xs),
      minY: Math.min(...ys),
      maxY: Math.max(...ys),
    };
  };

  it('ITEM-3a: centres every numbered-card pip grid on (35, 50) with equal margins', () => {
    // The grid constants themselves are centred on the `70x100` canvas.
    expect(PIP_COLUMNS.center).toBe(CENTRE.x);
    expect(PIP_COLUMNS.left).toBe(22.5);
    expect(PIP_COLUMNS.right).toBe(47.5);
    expect(PIP_COLUMNS.left + PIP_COLUMNS.right).toBe(CARD_WIDTH);
    expect(PIP_ROWS.middle).toBe(CENTRE.y);
    expect(PIP_ROWS.top).toBe(32);
    expect(PIP_ROWS.bottom).toBe(68);
    expect(PIP_ROWS.top + PIP_ROWS.bottom).toBe(CARD_HEIGHT);
    // The inner rows mirror the centre row.
    expect(PIP_ROWS.middle - PIP_ROWS.upperMid).toBe(PIP_ROWS.lowerMid - PIP_ROWS.middle);
    expect(PIP_ROWS.upperMid + PIP_ROWS.lowerMid).toBe(CARD_HEIGHT);

    const columns = [PIP_COLUMNS.left, PIP_COLUMNS.center, PIP_COLUMNS.right];
    const rows = [
      PIP_ROWS.top,
      PIP_ROWS.upperMid,
      PIP_ROWS.middle,
      PIP_ROWS.lowerMid,
      PIP_ROWS.bottom,
    ];

    for (const rank of NUMBER_RANKS) {
      const { container, unmount } = render(<Card suit="spades" rank={rank} />);
      const pips = Array.from(container.querySelectorAll('[data-pip="rank"]'));
      expect(pips.length, rank).toBeGreaterThan(1);

      for (const pip of pips) {
        expect(columns, `${rank} column`).toContain(Number(pip.getAttribute('x')));
        expect(rows, `${rank} row`).toContain(Number(pip.getAttribute('y')));
        expect(Number(pip.getAttribute('font-size')), rank).toBe(PIP_FONT_SIZE);
      }

      const { minX, maxX, minY, maxY } = boundsOf(pips);
      // Equal left/right and top/bottom margins on the card canvas.
      expect(minX + maxX, `${rank} horizontal margins`).toBe(CARD_WIDTH);
      expect(minY + maxY, `${rank} vertical margins`).toBe(CARD_HEIGHT);
      expect(CARD_WIDTH - maxX, `${rank} left margin`).toBeCloseTo(minX, 5);
      expect(CARD_HEIGHT - maxY, `${rank} top margin`).toBeCloseTo(minY, 5);

      // …and the resulting bounding box is centred on (35, 50).
      expect((minX + maxX) / 2, `${rank} centre x`).toBe(CENTRE.x);
      expect((minY + maxY) / 2, `${rank} centre y`).toBe(CENTRE.y);

      unmount();
    }
  });

  it('ITEM-3a: keeps the centre-column pips on x = 35 and the centre-row pips on y = 50', () => {
    // `2`, `3`, `5`, `7`, `8`, `9` and `10` hold at least one centre-column pip.
    for (const rank of ['two', 'three', 'five', 'seven', 'eight', 'nine', 'ten']) {
      const { container, unmount } = render(<Card suit="hearts" rank={rank} />);
      const centrePips = Array.from(container.querySelectorAll('[data-pip="rank"]')).filter(
        (pip) => Number(pip.getAttribute('x')) === PIP_COLUMNS.center,
      );
      expect(centrePips.length, rank).toBeGreaterThan(0);
      for (const pip of centrePips) {
        expect(Number(pip.getAttribute('x')), rank).toBe(CENTRE.x);
      }
      unmount();
    }

    // The single middle pip of `3`, `5` and `9` sits dead on the card centre.
    for (const rank of ['three', 'five', 'nine']) {
      const { container, unmount } = render(<Card suit="clubs" rank={rank} />);
      const centred = Array.from(container.querySelectorAll('[data-pip="rank"]')).filter(
        (pip) =>
          Number(pip.getAttribute('x')) === CENTRE.x && Number(pip.getAttribute('y')) === CENTRE.y,
      );
      expect(centred, rank).toHaveLength(1);
      unmount();
    }

    // `6`, `7` and `8` carry a middle row on both side columns (`y = 50`).
    for (const rank of ['six', 'seven', 'eight']) {
      const { container, unmount } = render(<Card suit="diamonds" rank={rank} />);
      const middleRow = Array.from(container.querySelectorAll('[data-pip="rank"]')).filter(
        (pip) => Number(pip.getAttribute('y')) === PIP_ROWS.middle,
      );
      expect(middleRow, rank).toHaveLength(2);
      expect(middleRow.map((pip) => Number(pip.getAttribute('x'))).sort(), rank).toEqual([
        PIP_COLUMNS.left,
        PIP_COLUMNS.right,
      ]);
      unmount();
    }
  });

  it('ITEM-3b: centres the ace single pip on (35, 50) with equal margins', () => {
    const { container } = render(<Card suit="hearts" rank="ace" />);
    const pip = container.querySelector('[data-pip="ace"]')!;

    expect(Number(pip.getAttribute('x'))).toBe(CENTRE.x);
    expect(Number(pip.getAttribute('y'))).toBe(CENTRE.y);
    expect(pip.getAttribute('text-anchor')).toBe('middle');
    expect(pip.getAttribute('dominant-baseline')).toBe('central');

    // Horizontal margins (35 / 35) and vertical margins (50 / 50) are equal.
    const x = Number(pip.getAttribute('x'));
    const y = Number(pip.getAttribute('y'));
    expect(x - 0).toBe(CARD_WIDTH - x);
    expect(y - 0).toBe(CARD_HEIGHT - y);

    // The 40-unit centrepiece still clears every corner index and stays inside
    // the card frame.
    for (const index of Array.from(container.querySelectorAll('[data-index]'))) {
      expect(overlaps(textBox(pip), textBox(index)), index.getAttribute('data-index')!).toBe(false);
    }
    const box = textBox(pip);
    expect(box.left).toBeGreaterThan(2);
    expect(box.right).toBeLessThan(68);
    expect(box.top).toBeGreaterThan(2);
    expect(box.bottom).toBeLessThan(98);
  });

  it('ITEM-3b: centres the J/Q/K court letters and mirrors their decoration pips around (35, 50)', () => {
    // The four decoration corners are equidistant from the card centre: the left
    // and right columns are 11 units away from `x = 35`, the top and bottom rows
    // 17 units from `y = 50`, so every pair sums to the card's dimensions.
    const CORNERS = {
      'top-left': { x: 24, y: 33 },
      'top-right': { x: 46, y: 33 },
      'bottom-right': { x: 46, y: 67 },
      'bottom-left': { x: 24, y: 67 },
    } as const;
    expect(CORNERS['top-left'].x + CORNERS['top-right'].x).toBe(CARD_WIDTH);
    expect(CORNERS['top-left'].y + CORNERS['bottom-left'].y).toBe(CARD_HEIGHT);
    for (const offset of Object.values(CORNERS)) {
      expect(Math.abs(offset.x - CENTRE.x)).toBe(11);
      expect(Math.abs(offset.y - CENTRE.y)).toBe(17);
    }

    for (const [rank, letter] of [
      ['jack', 'J'],
      ['queen', 'Q'],
      ['king', 'K'],
    ] as const) {
      const { container, unmount } = render(<Card suit="clubs" rank={rank} />);

      const face = container.querySelector('[data-testid="card-face-letter"]')!;
      expect(face.textContent, rank).toBe(letter);
      expect(Number(face.getAttribute('x')), rank).toBe(CENTRE.x);
      expect(Number(face.getAttribute('y')), rank).toBe(CENTRE.y);
      expect(face.getAttribute('text-anchor'), rank).toBe('middle');
      expect(face.getAttribute('dominant-baseline'), rank).toBe('central');

      const pips = Array.from(container.querySelectorAll('.face-pip'));
      expect(pips.length, rank).toBeGreaterThan(0);
      for (const pip of pips) {
        const corner = pip.getAttribute('data-corner') as keyof typeof CORNERS;
        expect(Number(pip.getAttribute('x')), `${rank} ${corner} x`).toBe(CORNERS[corner].x);
        expect(Number(pip.getAttribute('y')), `${rank} ${corner} y`).toBe(CORNERS[corner].y);
        // No decoration pip collides with the centred letter.
        expect(overlaps(textBox(pip), textBox(face)), `${rank} ${corner}`).toBe(false);
      }

      // Any rank drawn with pips on both sides is mirrored on both axes.
      const { minX, maxX, minY, maxY } = {
        minX: Math.min(...pips.map((pip) => Number(pip.getAttribute('x')))),
        maxX: Math.max(...pips.map((pip) => Number(pip.getAttribute('x')))),
        minY: Math.min(...pips.map((pip) => Number(pip.getAttribute('y')))),
        maxY: Math.max(...pips.map((pip) => Number(pip.getAttribute('y')))),
      };
      if (pips.length > 1) {
        expect(minX + maxX, rank).toBe(CARD_WIDTH);
        expect(minY + maxY, rank).toBe(CARD_HEIGHT);
      }

      unmount();
    }
  });

  it('ITEM-3a/ITEM-4: keeps the corner pip columns at 7.5 / 62.5 in size 12, clear of the face', () => {
    for (const rank of ALL_RANKS) {
      const { container, unmount } = render(<Card suit="spades" rank={rank} trump />);

      const topRank = container.querySelector('[data-testid="card-rank-top"]')!;
      const bottomRank = container.querySelector('[data-testid="card-rank-bottom"]')!;
      const topSuit = container.querySelector('[data-testid="card-suit-top"]')!;
      const bottomSuit = container.querySelector('[data-testid="card-suit-bottom"]')!;

      expect(Number(topRank.getAttribute('x')), rank).toBe(7.5);
      expect(Number(bottomRank.getAttribute('x')), rank).toBe(62.5);
      expect(Number(topSuit.getAttribute('x')), rank).toBe(7.5);
      expect(Number(bottomSuit.getAttribute('x')), rank).toBe(62.5);
      expect(Number(topSuit.getAttribute('x')) + Number(bottomSuit.getAttribute('x'))).toBe(
        CARD_WIDTH,
      );
      expect(Number(topSuit.getAttribute('font-size')), rank).toBe(12);
      expect(Number(bottomSuit.getAttribute('font-size')), rank).toBe(12);
      // The suit glyph shares the rank's centre axis in both corners.
      expect(topSuit.getAttribute('x'), rank).toBe(topRank.getAttribute('x'));
      expect(bottomSuit.getAttribute('x'), rank).toBe(bottomRank.getAttribute('x'));

      // T-90-2 ITEM-12: a trump card paints no corner badges any more, so the
      // face geometry is only checked against the corner indices.
      expect(
        container.querySelectorAll('[data-testid="trump-marker"] circle'),
        rank,
      ).toHaveLength(0);

      // Zero overlap against any face pip or either corner index.
      for (const pip of cardPips(container)) {
        const box = textBox(pip);
        expect(overlaps(box, textBox(topSuit)), `${rank} top corner suit`).toBe(false);
        expect(overlaps(box, renderedBox(bottomSuit)), `${rank} bottom corner suit`).toBe(false);
      }

      unmount();
    }
  });
});

describe('theme-adaptive card backs', () => {
  afterEach(() => {
    resetSettings();
  });

  it('keeps the original dark palette for the six monochrome backs', () => {
    setSettings({ theme: 'dark' });
    expect(CARD_BACK_PATTERNS).toHaveLength(6);

    for (const pattern of CARD_BACK_PATTERNS) {
      const { container, unmount } = render(<CardBack pattern={pattern} />);
      const svg = container.querySelector('svg.card-back')!;

      expect(svg.getAttribute('data-colorful'), pattern).toBe('false');
      expect(svg.getAttribute('data-card-back-theme'), pattern).toBe('dark');

      // The outer frame is a direct child of the svg, not the pattern tile.
      const frame = Array.from(svg.children).filter(
        (child) => child.tagName.toLowerCase() === 'rect',
      )[0];
      expect(frame.getAttribute('fill'), pattern).toBe(DARK_CARD_BACK_PALETTE.frame);
      expect(frame.getAttribute('stroke'), pattern).toBe(DARK_CARD_BACK_PALETTE.frameStroke);
      expect(svg.outerHTML, pattern).toContain(DARK_CARD_BACK_PALETTE.ink);
      expect(svg.outerHTML, pattern).not.toContain(LIGHT_CARD_BACK_PALETTE.ink);
      unmount();
    }
  });

  it('repaints the six monochrome backs with the light palette', () => {
    setSettings({ theme: 'light' });

    for (const pattern of CARD_BACK_PATTERNS) {
      const { container, unmount } = render(<CardBack pattern={pattern} />);
      const svg = container.querySelector('svg.card-back')!;

      expect(svg.getAttribute('data-card-back-theme'), pattern).toBe('light');

      const frame = Array.from(svg.children).filter(
        (child) => child.tagName.toLowerCase() === 'rect',
      )[0];
      expect(frame.getAttribute('fill'), pattern).toBe(LIGHT_CARD_BACK_PALETTE.frame);
      expect(frame.getAttribute('stroke'), pattern).toBe(LIGHT_CARD_BACK_PALETTE.frameStroke);

      // The pattern tile flips to the light base with contrasting strokes.
      const tile = svg.querySelector('pattern')!;
      expect(tile.querySelector('rect')!.getAttribute('fill'), pattern).toBe(
        LIGHT_CARD_BACK_PALETTE.base,
      );
      expect(svg.outerHTML, pattern).toContain(LIGHT_CARD_BACK_PALETTE.ink);
      expect(svg.outerHTML, pattern).not.toContain(DARK_CARD_BACK_PALETTE.ink);
      unmount();
    }
  });

  it('keeps every colourful gradient identical in both themes but brightens its dark outline', () => {
    setSettings({ theme: 'dark' });
    const darkMarkup: Record<string, string> = {};

    for (const pattern of COLORFUL_CARD_BACK_PATTERNS) {
      const { container, unmount } = render(<CardBack pattern={pattern} />);
      const svg = container.querySelector('svg.card-back')!;

      expect(svg.getAttribute('data-colorful'), pattern).toBe('true');
      expect(svg.getAttribute('data-card-back-theme'), pattern).toBeNull();
      expect(svg.getAttribute('data-card-back-outline'), pattern).toBe('bright');

      // T-90-2 ITEM-17: the dark outer frame is the bright silver-slate stroke.
      const frame = Array.from(svg.children).filter(
        (child) => child.tagName.toLowerCase() === 'rect',
      )[0];
      expect(frame.getAttribute('stroke'), pattern).toBe(DARK_CARD_BACK_OUTLINE);
      expect(frame.getAttribute('stroke-width'), pattern).toBe('2');

      // Everything except that outer outline stays byte-for-byte identical.
      darkMarkup[pattern] = svg.outerHTML
        .replace(`stroke="${DARK_CARD_BACK_OUTLINE}"`, 'stroke="__outline__"')
        .replace('data-card-back-outline="bright"', 'data-card-back-outline="__outline__"');
      unmount();
    }

    setSettings({ theme: 'light' });

    for (const pattern of COLORFUL_CARD_BACK_PATTERNS) {
      const { container, unmount } = render(<CardBack pattern={pattern} />);
      const svg = container.querySelector('svg.card-back')!;

      expect(svg.getAttribute('data-card-back-outline'), pattern).toBe('crisp');
      expect(
        svg.outerHTML
          .replace(/stroke="#[0-9a-f]{6}"/, 'stroke="__outline__"')
          .replace('data-card-back-outline="crisp"', 'data-card-back-outline="__outline__"'),
        pattern,
      ).toBe(darkMarkup[pattern]);
      unmount();
    }
  });

  it('resolves the device theme from the applied document theme', () => {
    setSettings({ theme: 'device' });

    document.documentElement.setAttribute('data-theme', 'light');
    expect(resolveCardBackTheme('device')).toBe('light');

    document.documentElement.setAttribute('data-theme', 'dark');
    expect(resolveCardBackTheme('device')).toBe('dark');

    expect(resolveCardBackTheme('light')).toBe('light');
    expect(resolveCardBackTheme('dark')).toBe('dark');
    // Without an applied theme it falls back to the OS preference.
    expect(resolveCardBackTheme('device', false, document.createElement('div'))).toBe('light');
    expect(resolveCardBackTheme('device', true, document.createElement('div'))).toBe('dark');
  });
});

/**
 * T-90-feedback-20261104_165819-2: ITEM-11 inverted bottom-right corner indices
 * and ITEM-12a/12b symmetrical, mutually inverted trump badges with no aura.
 */
describe('T-90-2 inverted corner indices and symmetrical trump badges', () => {
  afterEach(() => {
    resetSettings();
  });

  it('ITEM-11: keeps the top-left index upright and inverts the bottom-right corner', () => {
    for (const [rank, label] of CORNER_RANKS) {
      const { container, unmount } = render(<Card suit="hearts" rank={rank} />);

      const topRank = container.querySelector('[data-testid="card-rank-top"]')!;
      const topSuit = container.querySelector('[data-testid="card-suit-top"]')!;
      const bottomRank = container.querySelector('[data-testid="card-rank-bottom"]')!;
      const bottomSuit = container.querySelector('[data-testid="card-suit-bottom"]')!;

      // Top-left: upright, unchanged and explicitly not inverted.
      expect(topRank.getAttribute('data-inverted'), rank).toBe('false');
      expect(topSuit.getAttribute('data-inverted'), rank).toBe('false');
      expect(Number(topRank.getAttribute('x')), rank).toBe(7.5);
      expect(Number(topRank.getAttribute('y')), rank).toBe(21);
      expect(Number(topSuit.getAttribute('x')), rank).toBe(7.5);
      expect(Number(topSuit.getAttribute('y')), rank).toBe(34);
      expect(topRank.getAttribute('transform'), rank).toBeNull();
      expect(topSuit.getAttribute('transform'), rank).toBeNull();

      // Bottom-right: the exact 180° rotation around the (35, 50) card centre.
      expect(bottomRank.getAttribute('data-inverted'), rank).toBe('true');
      expect(bottomSuit.getAttribute('data-inverted'), rank).toBe('true');
      expect(Number(bottomRank.getAttribute('x')), rank).toBe(70 - 7.5);
      expect(Number(bottomRank.getAttribute('y')), rank).toBe(100 - 21);
      expect(Number(bottomSuit.getAttribute('x')), rank).toBe(70 - 7.5);
      expect(Number(bottomSuit.getAttribute('y')), rank).toBe(100 - 34);
      expect(bottomRank.getAttribute('transform'), rank).toBe('rotate(180 62.5 79)');
      expect(bottomSuit.getAttribute('transform'), rank).toBe('rotate(180 62.5 66)');
      // The upside-down rank sits nearest the corner, the suit above it.
      expect(Number(bottomRank.getAttribute('y')), rank).toBeGreaterThan(
        Number(bottomSuit.getAttribute('y')),
      );
      expect(bottomRank.textContent, rank).toBe(label);
      expect(bottomSuit.textContent, rank).toBe('♥');

      unmount();
    }
  });

  it('ITEM-12a: paints no glowing aura on a trump card', () => {
    const { container } = render(<Card suit="spades" rank="ace" trump />);
    const slot = container.querySelector('.card-slot') as HTMLElement;
    const svg = container.querySelector('svg.playing-card') as SVGElement;

    expect(slot.getAttribute('data-trump-glow')).toBe('false');
    expect(svg.getAttribute('data-trump-glow')).toBe('false');
    // No inline box-shadow anywhere on the card component.
    expect(slot.style.boxShadow).toBe('');
    expect(svg.getAttribute('style') ?? '').not.toContain('box-shadow');
  });

});

/**
 * T-90-2 ITEM-12: a face-up trump is marked by the gilded border alone, with no
 * corner badges, and ITEM-17 brightens every Dark-mode face-down outline.
 */
describe('T-90-2 gilded trump borders and bright face-down outlines', () => {
  afterEach(() => {
    resetSettings();
  });

  it('ITEM-12: paints no trump badge circles or suit symbols on a trump card', () => {
    for (const suit of ['spades', 'hearts', 'diamonds', 'clubs']) {
      const { container, unmount } = render(<Card suit={suit} rank="ten" trump />);

      const svg = container.querySelector('svg.playing-card') as SVGElement;
      expect(svg.classList.contains('trump-card'), suit).toBe(true);
      expect(svg.getAttribute('data-trump-glow'), suit).toBe('false');
      expect(container.querySelector('[data-testid="trump-marker"]'), suit).toBeNull();
      expect(container.querySelector('[data-testid="trump-badge"]'), suit).toBeNull();
      expect(container.querySelector('[data-testid="trump-badge-top-right"]'), suit).toBeNull();
      expect(container.querySelector('[data-testid="trump-badge-bottom-left"]'), suit).toBeNull();
      expect(svg.querySelectorAll('circle'), suit).toHaveLength(0);
      // The only trump cue is the gilded frame stroke defined in table.css.
      expect(tableCss).toMatch(
        /\.playing-card\.trump-card\s*{[^}]*border: 2px solid var\(--trump-border, #f59e0b\)/,
      );

      unmount();
    }
  });

  it('ITEM-17: brightens the Dark-mode outer frame for monochrome and gradient backs', () => {
    expect(DARK_CARD_BACK_PALETTE.frameStroke).toBe('#94a3b8');
    setSettings({ theme: 'dark' });

    const frameOf = (container: Element): SVGRectElement =>
      Array.from(container.querySelector('svg.card-back')!.children).filter(
        (child) => child.tagName.toLowerCase() === 'rect',
      )[0] as SVGRectElement;

    const mono = render(<CardBack pattern="classic-hatch" />);
    const monoFrame = frameOf(mono.container);
    expect(monoFrame.getAttribute('stroke')).toBe('#94a3b8');
    expect(monoFrame.getAttribute('stroke-width')).toBe('2');
    mono.unmount();

    const gradient = render(<CardBack pattern="cyber-neon" />);
    const gradientFrame = frameOf(gradient.container);
    expect(gradient.container.querySelector('svg.card-back')!.getAttribute('data-card-back-outline')).toBe(
      'bright',
    );
    expect(gradientFrame.getAttribute('stroke')).toBe(DARK_CARD_BACK_OUTLINE);
    expect(gradientFrame.getAttribute('stroke-width')).toBe('2');
    gradient.unmount();
  });

  it('ITEM-17: keeps the Light-mode face-down outline crisp and unchanged', () => {
    setSettings({ theme: 'light' });
    const light = render(<CardBack pattern="classic-hatch" />);
    const frame = Array.from(light.container.querySelector('svg.card-back')!.children).filter(
      (child) => child.tagName.toLowerCase() === 'rect',
    )[0] as SVGRectElement;

    expect(light.container.querySelector('svg.card-back')!.getAttribute('data-card-back-outline')).toBe(
      'crisp',
    );
    expect(frame.getAttribute('stroke')).toBe(LIGHT_CARD_BACK_PALETTE.frameStroke);
    expect(frame.getAttribute('stroke-width')).toBe('2');
  });
});

describe('T-90-feedback-20261105_221105-2: card footprint', () => {
  it('ITEM-1b: defaults to the 100x140 footprint shared with the outlines', () => {
    const { container, unmount } = render(<Card suit="spades" rank="six" />);
    const slot = container.querySelector('.card-slot') as HTMLElement;

    expect(slot.getAttribute('data-card-width')).toBe('100');
    expect(slot.getAttribute('data-card-height')).toBe('140');
    // The default footprint is inline but expressed through the responsive
    // variables, so the 900px breakpoint is not overridden by fixed inline px.
    // T-90: the root reads the shared `--card-w` / `--card-h` tokens.
    expect(slot.style.width).toBe('var(--card-w, 100px)');
    expect(slot.style.height).toBe('var(--card-h, 140px)');
    expect(slot.style.minWidth).toBe('var(--card-w, 100px)');
    expect(slot.style.minHeight).toBe('var(--card-h, 140px)');
    expect(slot.style.flex).toBe('0 0 var(--card-w, 100px)');
    expect(tableCss).toMatch(
      /\.card-slot\s*{[^}]*--card-width: var\(--card-w, 100px\);[^}]*--card-height: var\(--card-h, 140px\);/,
    );
    expect(tableCss).toMatch(
      /\.card-slot\s*{[^}]*width: var\(--card-width, 100px\);[^}]*height: var\(--card-height, 140px\);/,
    );
    expect(tableCss).toMatch(
      /@media \(max-width: 900px\)[\s\S]*?\.card-slot\s*{[^}]*--card-width: 48px;[^}]*--card-height: 68px;/,
    );
    unmount();

    // A compact caller (the sidebar bottom trump) pins its own smaller box.
    const compact = render(<Card suit="spades" rank="six" width={80} height={114} />);
    const compactSlot = compact.container.querySelector('.card-slot') as HTMLElement;
    expect(compactSlot.getAttribute('data-card-width')).toBe('80');
    expect(compactSlot.getAttribute('data-card-height')).toBe('114');
    expect(compactSlot.style.width).toBe('80px');
    expect(compactSlot.style.height).toBe('114px');
  });

  it('ITEM-4: keeps the top-left index inside the 20px strip left at 80% overlap', () => {
    const ranks = ['two', 'six', 'nine', 'ten', 'jack', 'queen', 'king', 'ace'];

    ranks.forEach((rank) => {
      const { container, unmount } = render(<Card suit="spades" rank={rank} />);
      const rankNode = container.querySelector('[data-testid="card-rank-top"]')!;
      const suitNode = container.querySelector('[data-testid="card-suit-top"]')!;

      // T-90-feedback-2 ITEM-4: the rank and suit share the `x = 7.5` axis.
      expect(Number(rankNode.getAttribute('x')), rank).toBe(7.5);
      expect(Number(suitNode.getAttribute('x')), rank).toBe(7.5);

      // At 100px card width the whole index ink stays inside the leftmost 20px
      // (the strip an 80% overlap always leaves uncovered).
      for (const node of [rankNode, suitNode]) {
        const box = textBox(node);
        const leftPx = (box.left * CARD_DEFAULT_WIDTH) / 70;
        const rightPx = (box.right * CARD_DEFAULT_WIDTH) / 70;
        expect(leftPx, `${rank} left`).toBeGreaterThanOrEqual(0);
        expect(rightPx, `${rank} right`).toBeLessThanOrEqual(20);
      }
      unmount();
    });
  });
});

describe('T-90-feedback-20261106_111512-3: token-sized cards', () => {
  it('sizes the root from var(--card-w)/var(--card-h) and fills the face', () => {
    const { container, unmount } = render(<Card suit="hearts" rank="nine" />);
    const slot = container.querySelector('.card-slot') as HTMLElement;

    expect(slot.style.width).toBe('var(--card-w, 100px)');
    expect(slot.style.height).toBe('var(--card-h, 140px)');
    expect(slot.getAttribute('data-card-width')).toBe('100');
    expect(slot.getAttribute('data-card-height')).toBe('140');
    expect(slot.className).not.toMatch(/scale/);

    const face = slot.querySelector('svg.card-face') as SVGElement | null;
    expect(face).not.toBeNull();
    expect(tableCss).toMatch(/\.playing-card\s*{[^}]*width: 100%;[^}]*height: 100%;/);
    expect(tableCss).toMatch(/\.card-slot\s*{[^}]*--card-width: var\(--card-w, 100px\);/);
    expect(tableCss).toMatch(
      /@media \(max-width: 899px\)\s*{\s*:root\s*{[^}]*--card-w: 48px;/,
    );
    unmount();
  });
});
