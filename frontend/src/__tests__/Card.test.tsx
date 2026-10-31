import { describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/preact';
import { Card } from '../components/Card';
import { CARD_BACK_PATTERNS, CardBack } from '../components/CardBack';

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

  it('renders J, Q and K as centered letters flanked by decorative pips', () => {
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
      expect(face.getAttribute('text-anchor')).toBe('middle');
      expect(container.querySelectorAll('[data-pip="decor"]')).toHaveLength(4);
      unmount();
    });
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
