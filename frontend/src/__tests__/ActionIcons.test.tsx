import { describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, within } from '@testing-library/preact';
import { ACTION_BUTTONS, ActionBar } from '../components/ActionBar';
import { PassIcon } from '../components/icons/PassIcon';
import { SurrenderIcon } from '../components/icons/SurrenderIcon';
import actionBarSource from '../components/ActionBar.tsx?raw';
import actionIconsCss from '../styles/actionIcons.css?raw';

const SURRENDER_LABEL = 'Surrender — take the cards';
const PASS_LABEL = 'Pass — done throwing in';

const viewBoxOf = (element: Element): string | null =>
  element.getAttribute('viewBox') ?? element.getAttribute('viewbox');

/** Declarations of the first rule whose selector is exactly `selector {`. */
function cssRule(css: string, selector: string): string {
  const pattern = new RegExp(selector.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '\\s*\\{');
  const match = pattern.exec(css);
  if (!match) return '';
  const open = match.index + match[0].length - 1;
  const close = css.indexOf('}', open);
  return close === -1 ? '' : css.slice(open + 1, close);
}

/** The complete `@media (query) { ... }` block, braces balanced. */
function mediaBlock(css: string, query: string): string {
  const start = css.indexOf('@media (' + query + ')');
  if (start === -1) return '';
  let depth = 0;
  for (let i = css.indexOf('{', start); i !== -1 && i < css.length; i += 1) {
    if (css[i] === '{') depth += 1;
    else if (css[i] === '}') {
      depth -= 1;
      if (depth === 0) return css.slice(start, i + 1);
    }
  }
  return '';
}

/** Numbers behind every `command` letter in a path, e.g. `V23.6` -> 23.6. */
function numbersAfter(path: string, command: string): number[] {
  const pattern = new RegExp(command + '\\s*(-?\\d+(?:\\.\\d+)?)', 'g');
  return (path.match(pattern) ?? []).map((token) => Number(token.slice(command.length)));
}

const d = (element: Element): string => element.getAttribute('d') ?? '';

/** Every `<path>` in a group, as path-data strings. */
const pathsOf = (group: Element): string[] =>
  Array.from(group.querySelectorAll('path')).map(d);

describe('T-90-feedback-20261122_011021-2 ITEM-7/8: themed icon-only Surrender & Pass', () => {
  it('wires the icon stylesheet into the component that renders the buttons', () => {
    // Every size, theme, hover, focus and position rule lives in this file, so a
    // missing import would leave the live buttons completely unstyled — and no
    // jsdom render can catch that.
    expect(actionBarSource).toContain("import '../styles/actionIcons.css';");
  });

  it('SurrenderIcon: fanned cards, a downward arrow and two raised open hands', () => {
    const { container } = render(<SurrenderIcon />);
    const icon = container.querySelector('[data-icon="surrender-hands-cards"]') as SVGElement;

    expect(icon).not.toBeNull();
    expect(icon.getAttribute('data-testid')).toBe('surrender-icon');
    expect(icon.getAttribute('aria-hidden')).toBe('true');
    expect(viewBoxOf(icon)).toBe('0 0 48 48');
    expect(icon.getAttribute('fill')).toBe('none');
    expect(icon.getAttribute('stroke')).toBe('currentColor');
    // The ticket's single stroke weight, shared with PassIcon.
    expect(icon.getAttribute('stroke-width')).toBe('2.2');
    expect(icon.getAttribute('stroke-linecap')).toBe('round');
    expect(icon.getAttribute('stroke-linejoin')).toBe('round');

    const cards = icon.querySelector('[data-part="cards"]')!;
    const arrow = icon.querySelector('[data-part="arrow"]')!;
    const hands = icon.querySelector('[data-part="hands"]')!;
    expect(cards).not.toBeNull();
    expect(arrow).not.toBeNull();
    expect(hands).not.toBeNull();

    // A small fan of 2-3 cards, all recognisable silhouettes in the upper third.
    const faces = Array.from(cards.querySelectorAll('rect'));
    expect(faces.length).toBeGreaterThanOrEqual(2);
    expect(faces.length).toBeLessThanOrEqual(3);
    for (const face of faces) {
      expect(Number(face.getAttribute('y'))).toBeLessThan(48 / 3);
      expect(Number(face.getAttribute('rx'))).toBeGreaterThan(0);
      expect(Number(face.getAttribute('fill-opacity') ?? '0')).toBeLessThanOrEqual(0.2);
      expect(face.getAttribute('fill')).toBe('currentColor');
    }
    // Fanned: the outer cards are rotated, the centre one is upright.
    const transforms = faces.map((face) => face.getAttribute('transform') ?? '');
    expect(transforms.filter((value) => /rotate\(-/.test(value))).toHaveLength(1);
    expect(transforms.filter((value) => /rotate\(\d/.test(value))).toHaveLength(1);

    // The arrow leaves the cards (below them) and points down toward the hands.
    const arrowPaths = pathsOf(arrow);
    expect(arrowPaths).toHaveLength(2); // shaft + chevron head
    const [shaft, head] = arrowPaths;
    expect(shaft).toBe('M24 17.2 V23.6');
    const [shaftEnd] = numbersAfter(shaft, 'V');
    expect(shaftEnd).toBeGreaterThan(17.2); // same x, lower on the grid
    expect(numbersAfter(shaft, 'M')).toEqual([24]);
    const headPoints = head.match(/-?\d+(?:\.\d+)?/g) ?? [];
    expect(headPoints).toHaveLength(6); // chevron: apex + two wings
    const cardsBottom = Math.max(
      ...faces.map((face) => Number(face.getAttribute('y')) + Number(face.getAttribute('height'))),
    );
    expect(17.2).toBeGreaterThan(cardsBottom);

    // Two open palms, mirrored about the 48-unit centre line, wrists low.
    const handPaths = pathsOf(hands);
    expect(handPaths).toHaveLength(6);
    const palms = handPaths.filter((path) => /a2\.4 2\.4/.test(path));
    expect(palms).toHaveLength(2);
    const [leftPalm, rightPalm] = palms;
    expect(leftPalm).toMatch(/^M5\.4 30/);
    expect(rightPalm).toMatch(/^M42\.6 30/);
    expect(5.4 + 42.6).toBeCloseTo(48, 10); // mirror image about x = 24
    for (const palm of palms) {
      expect(palm).toContain('v9.6'); // wrist column
      expect(palm).toContain('V30'); // palm top, fingers attach here
    }
    // ... and the wrist reaches the bottom band of the glyph: 30 + 9.6 + 2.4.
    expect(30 + 9.6 + 2.4).toBeGreaterThan(48 * 0.85);

    // Four fingers per hand, all pointing up from the palm top.
    const fingers = handPaths.filter((path) => /^M\d/.test(path) && path.includes('V') && !/a2\.4/.test(path));
    expect(fingers).toHaveLength(2);
    const fingerTops = fingers.map((path) => numbersAfter(path, 'V'));
    for (const tops of fingerTops) {
      expect(tops).toHaveLength(4);
      for (const top of tops) expect(top).toBeLessThan(30);
    }
    expect(fingerTops[0]).toEqual(fingerTops[1]); // mirrored finger lengths

    // One outward thumb per hand, mirrored.
    const thumbs = handPaths.filter((path) => /l-?2\.2-1\.6/.test(path));
    expect(thumbs).toHaveLength(2);
    expect(thumbs[0]).toContain('l-2.2-1.6');
    expect(thumbs[1]).toContain('l2.2-1.6');
  });

  it('PassIcon: cards swept aside, one open hand and a forward skip arc', () => {
    const { container } = render(<PassIcon />);
    const icon = container.querySelector('[data-icon="pass-wave-cards"]') as SVGElement;

    expect(icon).not.toBeNull();
    expect(icon.getAttribute('data-testid')).toBe('pass-icon');
    expect(icon.getAttribute('aria-hidden')).toBe('true');
    expect(viewBoxOf(icon)).toBe('0 0 48 48');
    expect(icon.getAttribute('fill')).toBe('none');
    expect(icon.getAttribute('stroke')).toBe('currentColor');
    // Exact same visual language as SurrenderIcon: grid + stroke weight.
    expect(icon.getAttribute('stroke-width')).toBe('2.2');
    expect(icon.getAttribute('stroke-linecap')).toBe('round');
    expect(icon.getAttribute('stroke-linejoin')).toBe('round');

    const cards = icon.querySelector('[data-part="cards"]')!;
    expect(cards.querySelectorAll('rect')).toHaveLength(3);
    for (const face of Array.from(cards.querySelectorAll('rect'))) {
      expect(Number(face.getAttribute('y'))).toBeLessThan(48 / 3);
    }

    // The pass indicator is the arc + its forward head.
    const indicator = icon.querySelector('[data-part="pass-indicator"]')!;
    expect(indicator).not.toBeNull();
    const [curve, head] = pathsOf(indicator);
    expect(curve).toMatch(/^M7 20\.4/);
    expect(curve).toContain('C');
    expect(curve).toMatch(/32\s+17\.2$/);
    expect(head.match(/-?\d+(?:\.\d+)?/g) ?? []).toHaveLength(6); // chevron head

    // One open palm, the Surrender hand geometry with four fingers + thumb.
    const hand = icon.querySelector('[data-part="hand"]')!;
    const handPaths = pathsOf(hand);
    expect(handPaths).toHaveLength(4);
    const palm = handPaths[0];
    expect(palm).toContain('a2.4 2.4');
    const palmStart = /^M(\d+(?:\.\d+)?) (\d+(?:\.\d+)?)/.exec(palm)!;
    expect(Number(palmStart[2])).toBeGreaterThan(48 / 2); // lower half
    const fingerTops = handPaths.slice(1, 3).flatMap((path) => numbersAfter(path, 'V'));
    expect(fingerTops).toHaveLength(4);
    for (const top of fingerTops) expect(top).toBeLessThan(Number(palmStart[2]));
    // Slight tilt, not the upright surrender palms.
    expect(hand.querySelector('g')!.getAttribute('transform')).toBe('rotate(-8 30 34)');
  });

  it('keeps the two glyphs distinguishable from each other', () => {
    const { container } = render(
      <div>
        <SurrenderIcon />
        <PassIcon />
      </div>,
    );
    const surrender = container.querySelector('[data-icon="surrender-hands-cards"]')!;
    const pass = container.querySelector('[data-icon="pass-wave-cards"]')!;

    expect(surrender.querySelectorAll('[data-part="hands"]')).toHaveLength(1);
    expect(pass.querySelectorAll('[data-part="hands"]')).toHaveLength(0);
    expect(surrender.querySelectorAll('[data-part="arrow"]')).toHaveLength(1);
    expect(pass.querySelectorAll('[data-part="arrow"]')).toHaveLength(0);
    expect(pass.querySelectorAll('[data-part="hand"]')).toHaveLength(1);
    expect(pass.querySelectorAll('[data-part="pass-indicator"]')).toHaveLength(1);
    expect(surrender.querySelectorAll('[data-part="pass-indicator"]')).toHaveLength(0);
  });

  it('renders both buttons icon-only, with an aria-label, title and no text node', () => {
    render(<ActionBar legalActions={['pass', 'surrender']} onAction={() => {}} />);

    const surrender = screen.getByTestId('surrender-button');
    const pass = screen.getByTestId('pass-button');

    for (const [button, label, iconId, iconName] of [
      [surrender, SURRENDER_LABEL, 'surrender-icon', 'surrender-hands-cards'],
      [pass, PASS_LABEL, 'pass-icon', 'pass-wave-cards'],
    ] as const) {
      expect(button.tagName).toBe('BUTTON');
      expect(button.textContent).toBe('');
      expect(button.getAttribute('aria-label')).toBe(label);
      expect(button.getAttribute('title')).toBe(label);
      const icon = within(button).getByTestId(iconId);
      expect(icon.getAttribute('data-icon')).toBe(iconName);
      expect(icon.getAttribute('aria-hidden')).toBe('true');
      expect(button.classList.contains('action-icon-btn')).toBe(true);
      expect(button.className).toContain('action-button');
      expect(button.className).not.toContain('red');
      expect(button.getAttribute('style')).toBeNull();
    }

    // The accent hooks the stylesheet differentiates the pair with.
    expect(pass.classList.contains('action-icon-pass')).toBe(true);
    expect(surrender.classList.contains('action-icon-surrender')).toBe(true);

    // No bare one-word "Surrender" / "Pass" accessible name survives anywhere.
    expect(screen.getByRole('button', { name: SURRENDER_LABEL })).toBe(surrender);
    expect(screen.getByRole('button', { name: PASS_LABEL })).toBe(pass);
    expect(screen.queryByRole('button', { name: 'Surrender' })).toBeNull();
    expect(screen.queryByRole('button', { name: 'Pass' })).toBeNull();
  });

  it('dispatches DeclareSurrender and PassTurn through the existing action path', () => {
    const onAction = vi.fn();
    render(<ActionBar legalActions={['pass', 'surrender']} onAction={onAction} />);

    fireEvent.click(screen.getByTestId('surrender-button'));
    expect(onAction).toHaveBeenNthCalledWith(1, { type: 'declareSurrender' });

    fireEvent.click(screen.getByTestId('pass-button'));
    expect(onAction).toHaveBeenNthCalledWith(2, { type: 'passTurn' });
    expect(onAction).toHaveBeenCalledTimes(2);
  });

  it('has no "Throw In" button and no throw-in action left in the bar', () => {
    render(
      <ActionBar
        legalActions={['pass', 'surrender', 'throwIn', 'throwInCards', 'cover']}
        onAction={() => {}}
      />,
    );

    expect(screen.queryByRole('button', { name: /throw in/i })).toBeNull();
    expect(screen.queryByText(/^throw in$/i)).toBeNull();
    expect(screen.getAllByRole('button')).toHaveLength(2);
    for (const button of screen.getAllByRole('button')) {
      expect(button.textContent).toBe('');
    }

    expect(ACTION_BUTTONS.map((entry) => entry.action)).toEqual(['pass', 'surrender']);
    expect(ACTION_BUTTONS.map((entry) => entry.type)).toEqual(['passTurn', 'declareSurrender']);
    expect(ACTION_BUTTONS.some((entry) => /^throw/i.test(entry.action))).toBe(false);
  });

  it('renders only the actions the server lists as legal', () => {
    const { unmount } = render(<ActionBar legalActions={['surrender']} onAction={() => {}} />);
    expect(screen.getByTestId('surrender-button')).toBeTruthy();
    expect(screen.queryByTestId('pass-button')).toBeNull();
    unmount();

    const { unmount: unmountThrowIn } = render(
      <ActionBar legalActions={['throwIn', 'throwInCards']} onAction={() => {}} />,
    );
    expect(screen.queryAllByRole('button')).toHaveLength(0);
    unmountThrowIn();

    render(<ActionBar legalActions={[]} onAction={() => {}} />);
    expect(screen.queryByRole('button')).toBeNull();
  });

  it('styles compact 52px / 42px themed squares, with no red anywhere', () => {
    const desktop = cssRule(actionIconsCss, '.action-bar .action-button.action-icon-btn');
    // Noticeably compact, and inside the ticket's 48px-56px band.
    const width = Number(/width: (\d+)px;/.exec(desktop)?.[1]);
    const height = Number(/height: (\d+)px;/.exec(desktop)?.[1]);
    expect(width).toBeGreaterThanOrEqual(48);
    expect(width).toBeLessThanOrEqual(56);
    expect(height).toBe(width);
    expect(desktop).toContain('min-width:');
    expect(desktop).toContain('max-width:');
    expect(desktop).toContain('padding: 0;'); // beats .action-button's 10px 22px
    expect(desktop).toContain('border-radius: 8px;');
    expect(desktop).toContain('box-sizing: border-box;');
    // Dark-emerald/slate surface + parchment ink from the table's own tokens.
    expect(desktop).toContain('var(--bg-elevated, rgba(24, 34, 29, 0.85))');
    expect(desktop).toContain('var(--durak-border, rgba(214, 199, 170, 0.34))');
    expect(desktop).toContain('var(--durak-text, #e8e4d8)');
    expect(desktop).toContain('backdrop-filter: blur(6px)');

    // Muted gold for Surrender, muted emerald for Pass — never an alarm color.
    expect(actionIconsCss).toContain('rgba(212, 175, 55, 0.35)');
    expect(actionIconsCss).toContain('rgba(110, 231, 183, 0.35)');
    expect(actionIconsCss).toContain('--icon-accent: #b98a5e');
    expect(actionIconsCss).toContain('--icon-accent: #7d9e83');
    expect(actionIconsCss).not.toMatch(/#ef4444|#dc2626|#c33\b|rgb\(239, 68, 68\)/i);
    expect(actionIconsCss).not.toMatch(/:\s*(red|crimson)\b/i);

    // The new class-name variants coexist with the Wave-1 names ActionBar uses.
    expect(actionIconsCss).toContain('.action-icon-btn--surrender');
    expect(actionIconsCss).toContain('.action-icon-btn--pass');
    expect(actionIconsCss).toContain('.action-icon-surrender');
    expect(actionIconsCss).toContain('.action-icon-pass');

    // Glyph ~62% of the button; the artwork carries the same weight as the SVG.
    const glyph = cssRule(actionIconsCss, '.action-icon');
    expect(glyph).toMatch(/width: 32px;/);
    expect(glyph).toMatch(/height: 32px;/);
    expect(glyph).toContain('stroke-width: 2.2;');

    // The 42px mobile square and the 26px glyph live inside the 900px block.
    const mobile = mediaBlock(actionIconsCss, 'max-width: 900px');
    expect(mobile).not.toBe('');
    expect(cssRule(mobile, '.action-bar .action-button.action-icon-btn')).toMatch(/width: 42px;/);
    expect(cssRule(mobile, '.action-bar .action-button.action-icon-btn')).toMatch(/height: 42px;/);
    expect(cssRule(mobile, '.action-icon')).toMatch(/width: 26px;/);
    expect(cssRule(mobile, '.action-icon')).toMatch(/height: 26px;/);

    // Wave-1 compatibility: the family-only baseline still declares the old
    // footprint, and the scoped rule above it wins on specificity.
    const baseline = cssRule(actionIconsCss, '.action-button.action-icon-btn');
    expect(baseline).toMatch(/width: 40px;/);
    expect(baseline).toMatch(/height: 40px;/);
    expect(cssRule(mobile, '.action-button.action-icon-btn')).toMatch(/width: 32px;/);

    // Tactile states: hover lift, press, focus ring, disabled dimming.
    expect(actionIconsCss).toMatch(/hover:not\(:disabled\)[^{]*\{[^}]*translateY\(-1px\)/);
    expect(actionIconsCss).toMatch(/:active:not\(:disabled\)[^{]*\{[^}]*translateY\(0\)/);
    expect(actionIconsCss).toMatch(/focus-visible[^{]*\{[^}]*outline: 2px solid/);
    expect(actionIconsCss).toMatch(/:disabled[^{]*\{[^}]*opacity: 0\.45/);

    // Countdown digits are painted from the attribute and stay 11px readable.
    expect(cssRule(actionIconsCss, '.action-button.action-icon-btn .surrender-countdown')).toMatch(
      /font-size: 11px;/,
    );
    expect(actionIconsCss).toContain('content: attr(data-countdown)');

    // Grid/Flex placement only, anchored bottom-right inside the arena.
    const cluster = cssRule(
      actionIconsCss,
      "[data-zone='table-arena'] [data-zone='player-controls']",
    );
    expect(cluster).toContain('justify-self: end;');
    expect(cluster).toContain('align-self: end;');
    expect(cluster).toContain('min-width: 0;');
    expect(cluster).toContain('box-sizing: border-box;');
    expect(actionIconsCss).not.toMatch(/position:\s*(absolute|fixed)/);
  });
});
