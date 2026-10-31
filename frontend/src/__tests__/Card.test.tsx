import { describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/preact';
import { Card } from '../components/Card';

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

  it('colors heart and diamond suits red and black suits grey', () => {
    const { container: red } = render(<Card suit="diamonds" rank="king" />);
    expect(red.querySelector('text')!.getAttribute('fill')).toBe('#c33');

    const { container: black } = render(<Card suit="clubs" rank="king" />);
    expect(black.querySelector('text')!.getAttribute('fill')).toBe('#bababa');
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
});
