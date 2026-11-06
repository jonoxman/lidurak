import { describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, within } from '@testing-library/preact';
import { ACTION_BUTTONS, ActionBar } from '../components/ActionBar';
import { PassIcon } from '../components/icons/PassIcon';
import { SurrenderIcon } from '../components/icons/SurrenderIcon';
import actionBarSource from '../components/ActionBar.tsx?raw';
import actionIconsCss from '../styles/actionIcons.css?raw';
import tableCss from '../styles/table.css?raw';
import appCss from '../app.css?raw';

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

/** Numbers behind every `command` letter in a path, e.g. `V18.2` -> 18.2. */
function numbersAfter(path: string, command: string): number[] {
  const pattern = new RegExp(command + '\\s*(\\d+(?:\\.\\d+)?)', 'g');
  return (path.match(pattern) ?? []).map((token) => Number(token.slice(command.length)));
}

const d = (element: Element): string => element.getAttribute('d') ?? '';

describe('T-90-feedback-20261106_111512-2: icon-only Surrender & Pass controls', () => {
  it('wires the icon stylesheet into the component that renders the buttons', () => {
    // Every size, theme, hover, focus and position rule lives in this file, so a
    // missing import would leave the live buttons completely unstyled — and no
    // jsdom render can catch that.
    expect(actionBarSource).toContain("import '../styles/actionIcons.css';");
  });

  it('SurrenderIcon: cards, a downward arrow and two raised open hands', () => {
    const { container } = render(<SurrenderIcon />);
    const icon = container.querySelector('[data-icon="surrender-hands-cards"]') as SVGElement;

    expect(icon).not.toBeNull();
    expect(icon.getAttribute('aria-hidden')).toBe('true');
    expect(viewBoxOf(icon)).toBe('0 0 32 32');
    expect(icon.getAttribute('fill')).toBe('none');
    expect(icon.getAttribute('stroke')).toBe('currentColor');
    expect(icon.getAttribute('stroke-width')).toBe('1.6');
    expect(icon.getAttribute('stroke-linecap')).toBe('round');
    expect(icon.getAttribute('stroke-linejoin')).toBe('round');

    const cards = icon.querySelector('[data-icon-part="cards"]')!;
    const arrow = icon.querySelector('[data-icon-part="arrow-down"]')!;
    const hands = icon.querySelector('[data-icon-part="raised-hands"]')!;
    expect(cards).not.toBeNull();
    expect(arrow).not.toBeNull();
    expect(hands).not.toBeNull();

    // 2-3 small overlapping fanned cards, all in the upper third.
    const faces = Array.from(cards.querySelectorAll('rect'));
    expect(faces.length).toBeGreaterThanOrEqual(2);
    expect(faces.length).toBeLessThanOrEqual(3);
    for (const face of faces) {
      expect(Number(face.getAttribute('y'))).toBeLessThan(32 / 3);
      expect(Number(face.getAttribute('fill-opacity') ?? '0')).toBeLessThanOrEqual(0.2);
    }

    // The arrow points down out of the cards: shaft plus chevron head.
    const arrowPaths = Array.from(arrow.querySelectorAll('path'));
    expect(arrowPaths).toHaveLength(2);
    expect(d(arrowPaths[0])).toBe('M16 13.2 V 17.2');
    expect(numbersAfter(d(arrowPaths[0]), 'V')[0]).toBeGreaterThan(
      numbersAfter(d(arrowPaths[0]), 'M')[0],
    );

    // Two palms, symmetric about the icon's centre line, wrists on the bottom edge.
    const handPaths = Array.from(hands.querySelectorAll('path'));
    expect(handPaths).toHaveLength(6);
    const palms = handPaths.filter((path) => /a1\.9 1\.9/.test(d(path))).map(d);
    expect(palms).toHaveLength(2);
    const [leftPalm, rightPalm] = palms;
    expect(leftPalm).toMatch(/^M3\.4 22/);
    expect(rightPalm).toMatch(/^M28\.6 22/);
    expect(3.4 + 28.6).toBeCloseTo(32, 10); // mirror image about x = 16
    for (const palm of palms) {
      expect(palm).toContain('v6.3'); // wrist column
      expect(palm).toContain('V22'); // palm top, fingers attach here
    }
    // ... and the wrist reaches the bottom edge: 22 + 6.3 + 1.9 = 30.2 of 32.
    expect(22 + 6.3 + 1.9).toBeGreaterThan(32 * 0.9);

    // Four fingers per hand, all pointing UP (target y below the palm top).
    const fingerPaths = handPaths
      .filter((path) => !/a1\.9 1\.9/.test(d(path)) && /V\d/.test(d(path)))
      .map(d);
    expect(fingerPaths).toHaveLength(2);
    const fingerTops = fingerPaths.map((path) => numbersAfter(path, 'V'));
    for (const tops of fingerTops) {
      expect(tops).toHaveLength(4);
      for (const top of tops) expect(top).toBeLessThan(22);
    }
    expect(fingerTops[0]).toEqual(fingerTops[1]); // mirrored finger lengths

    // One outward thumb per hand, mirrored.
    const thumbs = handPaths.filter((path) => /l-?1\.6-1\.2/.test(d(path))).map(d);
    expect(thumbs).toHaveLength(2);
    expect(thumbs[0]).toContain('l-1.6-1.2');
    expect(thumbs[1]).toContain('l1.6-1.2');
  });

  it('PassIcon: cards, a sideways skip arrow and one flat palm-down hand', () => {
    const { container } = render(<PassIcon />);
    const icon = container.querySelector('[data-icon="pass-wave-cards"]') as SVGElement;

    expect(icon).not.toBeNull();
    expect(icon.getAttribute('aria-hidden')).toBe('true');
    expect(viewBoxOf(icon)).toBe('0 0 32 32');
    expect(icon.getAttribute('fill')).toBe('none');
    expect(icon.getAttribute('stroke')).toBe('currentColor');
    expect(icon.getAttribute('stroke-width')).toBe('1.6');
    // Same family grid and stroke style as SurrenderIcon.
    expect(icon.getAttribute('stroke-linecap')).toBe('round');
    expect(icon.getAttribute('stroke-linejoin')).toBe('round');

    expect(icon.querySelector('[data-icon-part="cards"]')!.querySelectorAll('rect')).toHaveLength(3);

    const arrow = icon.querySelector('[data-icon-part="arrow-pass"]')!;
    const curve = d(arrow.querySelector('path')!);
    expect(curve).toMatch(/^M6\.2 21\.4/);
    expect(curve).toContain('C');
    expect(curve).toMatch(/26\.4\s+15\.4$/);
    expect(arrow.querySelectorAll('path')).toHaveLength(2); // curve + head

    const hand = icon.querySelector('[data-icon-part="pass-hand"]')!;
    const handPaths = Array.from(hand.querySelectorAll('path')).map(d);
    expect(handPaths.length).toBeGreaterThanOrEqual(4);

    // Palm is wider than tall, i.e. flat and horizontal, palm down.
    const palm = handPaths[0];
    expect(palm).toMatch(/^M12 24\.6 h5\.4/);
    expect(palm).toContain('a2.4 2.4');
    const palmStart = /^M(\d+(?:\.\d+)?) (\d+(?:\.\d+)?)/.exec(palm)!;
    expect(Number(palmStart[2])).toBeGreaterThan((32 * 2) / 3); // lower third

    const fingers = d(hand.querySelector('[data-icon-part="pass-fingers"]')!);
    expect(fingers.match(/h\d+(?:\.\d+)?/g) ?? []).toHaveLength(3);
    expect(fingers).not.toContain('V'); // horizontal fingers, not raised

    // The hand sits nearly flat: a shallow tilt, not a vertical palm.
    const group = hand.querySelector('g')!;
    expect(group.getAttribute('transform')).toBe('rotate(-7 17 27)');
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

    expect(surrender.querySelectorAll('[data-icon-part="raised-hands"]')).toHaveLength(1);
    expect(pass.querySelectorAll('[data-icon-part="raised-hands"]')).toHaveLength(0);
    expect(surrender.querySelectorAll('[data-icon-part="arrow-down"]')).toHaveLength(1);
    expect(pass.querySelectorAll('[data-icon-part="arrow-down"]')).toHaveLength(0);
    expect(pass.querySelectorAll('[data-icon-part="pass-hand"]')).toHaveLength(1);
    expect(pass.querySelectorAll('[data-icon-part="arrow-pass"]')).toHaveLength(1);
    expect(surrender.querySelectorAll('[data-icon-part="arrow-pass"]')).toHaveLength(0);
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
      expect(button.className).not.toContain('red');
      expect(button.getAttribute('style')).toBeNull();
    }

    // The accessible names are reachable through the role query as well, and no
    // bare one-word "Surrender" / "Pass" accessible name survives anywhere.
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

    // No dead throw-in entry or handler survives in the button table.
    expect(ACTION_BUTTONS.map((entry) => entry.action)).toEqual(['pass', 'surrender']);
    expect(ACTION_BUTTONS.map((entry) => entry.type)).toEqual(['passTurn', 'declareSurrender']);
    expect(ACTION_BUTTONS.some((entry) => /^throw/i.test(entry.action))).toBe(false);
  });

  it('renders only the actions the server lists as legal', () => {
    const { unmount } = render(<ActionBar legalActions={['surrender']} onAction={() => {}} />);
    expect(screen.getByTestId('surrender-button')).toBeTruthy();
    expect(screen.queryByTestId('pass-button')).toBeNull();
    unmount();

    // A throw-in-only legal list must not resurrect a throw-in control.
    const { unmount: unmountThrowIn } = render(
      <ActionBar legalActions={['throwIn', 'throwInCards']} onAction={() => {}} />,
    );
    expect(screen.queryAllByRole('button')).toHaveLength(0);
    unmountThrowIn();

    render(<ActionBar legalActions={[]} onAction={() => {}} />);
    expect(screen.queryByRole('button')).toBeNull();
  });

  it('styles 40x40 desktop / 32x32 mobile squares in the felt theme, never red', () => {
    const desktop = cssRule(actionIconsCss, '.action-bar .action-button.action-icon-btn');
    expect(desktop).toMatch(/width: 40px;/);
    expect(desktop).toMatch(/height: 40px;/);
    expect(desktop).toContain('border-radius: 8px;');
    expect(desktop).toContain('padding: 0;'); // beats .action-button's 10px 22px
    expect(desktop).toContain('var(--bg-elevated, rgba(24, 34, 29, 0.85))');
    expect(desktop).toContain('var(--durak-border, rgba(214, 199, 170, 0.34))');
    expect(desktop).toContain('var(--durak-text, #e8e4d8)');
    expect(desktop).toContain('backdrop-filter: blur(6px)');

    // Glyph is 70% of the button.
    expect(cssRule(actionIconsCss, '.action-icon')).toMatch(/width: 28px;/);
    expect(cssRule(actionIconsCss, '.action-icon')).toMatch(/height: 28px;/);

    // The 32px square and the 22px glyph live INSIDE the 900px breakpoint.
    const mobile = mediaBlock(actionIconsCss, 'max-width: 900px');
    expect(mobile).not.toBe('');
    expect(cssRule(mobile, '.action-button.action-icon-btn')).toMatch(/width: 32px;/);
    expect(cssRule(mobile, '.action-button.action-icon-btn')).toMatch(/height: 32px;/);
    expect(cssRule(mobile, '.action-icon')).toMatch(/width: 22px;/);
    expect(cssRule(mobile, '.action-icon')).toMatch(/height: 22px;/);
    expect(actionIconsCss.replace(mobile, '')).not.toMatch(/width: (32|22)px;/);

    // The tokens really are the ones SortBar / the table chrome define.
    expect(cssRule(tableCss, ':root')).toContain('--durak-border:');
    expect(cssRule(tableCss, ':root')).toContain('--durak-text:');
    expect(cssRule(appCss, ':root')).toContain('--bg-elevated:');
    expect(cssRule(tableCss, '.sort-select')).toContain('var(--durak-panel)');

    // Muted accents only: terracotta for Surrender, sage for Pass.
    expect(actionIconsCss).toContain('--icon-accent: #b98a5e');
    expect(actionIconsCss).toContain('--icon-accent: #7d9e83');
    expect(actionIconsCss).not.toMatch(/#ef4444|#dc2626|#c33\b|rgb\(239, 68, 68\)/i);
    // No red words anywhere, including `color:` / `border-color:` keywords.
    expect(actionIconsCss).not.toMatch(/:\s*(red|crimson)\b/i);

    // The retired red/green word-button families are gone from table.css, and no
    // stale icon-button rule is left behind there.
    expect(tableCss).not.toContain('.action-btn-surrender');
    expect(tableCss).not.toContain('.action-btn-pass');
    expect(tableCss).not.toContain('.action-icon-btn');

    // Hover brighten, focus ring, disabled opacity.
    expect(actionIconsCss).toMatch(/hover:not\(:disabled\)[^{]*\{[^}]*filter: brightness\(1\.12\)/);
    expect(actionIconsCss).toMatch(/focus-visible[^{]*\{[^}]*outline: 2px solid/);
    expect(actionIconsCss).toMatch(/:disabled[^{]*\{[^}]*opacity: 0\.45/);

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
