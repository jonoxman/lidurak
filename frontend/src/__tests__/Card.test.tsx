import { afterEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/preact';
import { Card } from '../components/Card';
import {
  CARD_BACK_PATTERNS,
  COLORFUL_CARD_BACK_PATTERNS,
  CardBack,
  DARK_CARD_BACK_PALETTE,
  LIGHT_CARD_BACK_PALETTE,
  resolveCardBackTheme,
} from '../components/CardBack';
import { resetSettings, setSettings } from '../state/settings';

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

  it('marks a trump card with the golden glow class and a corner badge', () => {
    const { container } = render(<Card suit="spades" rank="ace" trump />);

    const slot = container.querySelector('.card-slot')!;
    expect(slot.classList.contains('trump')).toBe(true);
    expect(slot.getAttribute('data-trump')).toBe('true');

    const marker = screen.getByTestId('trump-marker');
    expect(marker.querySelector('circle')!.getAttribute('fill')).toBe('#d4af37');
    expect(marker.querySelector('text')!.textContent).toBe('♠');
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
    expect(pips[0].getAttribute('x')).toBe('35');
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

  it('centers the trump badge symbol exactly inside the golden circle', () => {
    render(<Card suit="spades" rank="ace" trump />);

    const marker = screen.getByTestId('trump-marker');
    const circle = marker.querySelector('circle')!;
    const text = marker.querySelector('text')!;

    expect(text.getAttribute('x')).toBe(circle.getAttribute('cx'));
    expect(text.getAttribute('y')).toBe(circle.getAttribute('cy'));
    expect(text.getAttribute('text-anchor')).toBe('middle');
    expect(text.getAttribute('dominant-baseline')).toBe('central');
  });

  it('keeps the gold trump badge compact so it never covers a pip', () => {
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
      'ace',
      'jack',
      'queen',
      'king',
    ];

    for (const rank of ranks) {
      const { container, unmount } = render(<Card suit="spades" rank={rank} trump />);
      const circle = screen.getByTestId('trump-marker').querySelector('circle')!;
      const cx = Number(circle.getAttribute('cx'));
      const cy = Number(circle.getAttribute('cy'));
      const r = Number(circle.getAttribute('r'));

      // 70 viewBox units render into an 80px-wide card: a 12-14px badge.
      const diameterPx = r * 2 * (80 / 70);
      expect(r, rank).toBeLessThanOrEqual(6.5);
      expect(diameterPx, rank).toBeGreaterThanOrEqual(12);
      expect(diameterPx, rank).toBeLessThanOrEqual(14);

      // Still fully inside the card frame.
      const badge = { left: cx - r, right: cx + r, top: cy - r, bottom: cy + r };
      expect(badge.left, rank).toBeGreaterThanOrEqual(2);
      expect(badge.top, rank).toBeGreaterThanOrEqual(2);
      expect(badge.right, rank).toBeLessThanOrEqual(68);
      expect(badge.bottom, rank).toBeLessThanOrEqual(20);

      // No pip's glyph box may intersect the badge's box.
      for (const pip of Array.from(container.querySelectorAll('[data-pip]'))) {
        const x = Number(pip.getAttribute('x'));
        const y = Number(pip.getAttribute('y'));
        const fontSize = Number(pip.getAttribute('font-size'));
        const box = {
          left: x - fontSize * 0.45,
          right: x + fontSize * 0.45,
          top: y - fontSize * 0.8,
          bottom: y + fontSize * 0.2,
        };
        const overlaps =
          box.right > badge.left &&
          box.left < badge.right &&
          box.bottom > badge.top &&
          box.top < badge.bottom;
        expect(overlaps, `${rank} pip at ${x},${y}`).toBe(false);
      }

      const text = screen.getByTestId('trump-marker').querySelector('text')!;
      expect(Number(text.getAttribute('font-size')), rank).toBeLessThanOrEqual(9);
      unmount();
    }
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

  it('leaves every colourful card back identical in both themes', () => {
    setSettings({ theme: 'dark' });
    const darkMarkup: Record<string, string> = {};

    for (const pattern of COLORFUL_CARD_BACK_PATTERNS) {
      const { container, unmount } = render(<CardBack pattern={pattern} />);
      const svg = container.querySelector('svg.card-back')!;

      expect(svg.getAttribute('data-colorful'), pattern).toBe('true');
      expect(svg.getAttribute('data-card-back-theme'), pattern).toBeNull();
      darkMarkup[pattern] = svg.outerHTML;
      unmount();
    }

    setSettings({ theme: 'light' });

    for (const pattern of COLORFUL_CARD_BACK_PATTERNS) {
      const { container, unmount } = render(<CardBack pattern={pattern} />);
      const svg = container.querySelector('svg.card-back')!;

      expect(svg.outerHTML, pattern).toBe(darkMarkup[pattern]);
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
