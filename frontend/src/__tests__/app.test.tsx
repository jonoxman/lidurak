import { beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen, waitFor } from '@testing-library/preact';

vi.mock('../api/client', () => ({
  checkServerHealth: vi.fn(async () => true),
  createGame: vi.fn(),
  getGameView: vi.fn(),
  sendAction: vi.fn(),
}));

import * as client from '../api/client';
import { App, parseRoute } from '../app';
import appCss from '../app.css?raw';
import tableCss from '../styles/table.css?raw';

/** Declarations of the first rule whose selector text contains `selector`. */
function cssRule(css: string, selector: string): string {
  const start = css.indexOf(selector);
  if (start === -1) return '';
  const open = css.indexOf('{', start);
  const close = css.indexOf('}', open);
  return open === -1 || close === -1 ? '' : css.slice(open + 1, close);
}

const checkServerHealth = client.checkServerHealth as unknown as ReturnType<typeof vi.fn>;

describe('App', () => {
  beforeEach(() => {
    checkServerHealth.mockResolvedValue(true);
  });

  it('does not repeat the Lidurak title below the header bar', async () => {
    render(<App />);

    await screen.findByRole('button', { name: 'Create Game' });

    expect(document.querySelector('.app-title')).toBeNull();
    expect(screen.queryByRole('heading', { level: 1 })).toBeNull();
  });

  it('shows the local lobby by default', async () => {
    render(<App />);
    expect(await screen.findByRole('button', { name: 'Create Game' })).toBeTruthy();
  });

  it('mounts the universal site header above the lobby', async () => {
    render(<App />);

    const header = screen.getByRole('banner');
    expect(header.getAttribute('data-zone')).toBe('site-header');
    expect(screen.getByRole('link', { name: 'LIDURAK' }).getAttribute('href')).toBe('#/');
    expect(screen.getByRole('button', { name: 'Account menu' })).toBeTruthy();
    await screen.findByRole('button', { name: 'Create Game' });
  });

  it('waits on the loading view instead of the lobby until the backend is ready', async () => {
    checkServerHealth.mockResolvedValue(false);
    render(<App />);

    const loading = await screen.findByTestId('server-loading');
    expect(loading.getAttribute('role')).toBe('status');
    expect(loading.textContent).toContain('Starting game server, please wait');
    expect(screen.queryByRole('button', { name: 'Create Game' })).toBeNull();

    checkServerHealth.mockResolvedValue(true);
    await waitFor(
      () => expect(screen.getByRole('button', { name: 'Create Game' })).toBeTruthy(),
      { timeout: 3000 },
    );
  });

  it('T-90: lobby controls use the royal-blue selection family in light mode', async () => {
    render(<App />);

    const create = await screen.findByRole('button', { name: 'Create Game' });
    expect(create.classList.contains('green')).toBe(true);

    // The player-count control is the lobby's active player selector.
    const playerCount = document.querySelector('.lobby-form .field select');
    expect(playerCount).not.toBeNull();

    expect(
      cssRule(appCss, "html[data-theme='light'] .lobby-form .field select:focus-visible"),
    ).toContain('var(--ui-select-glow)');
    expect(
      cssRule(appCss, "html[data-theme='light'] .lobby-form .action-button.green"),
    ).toContain('var(--ui-select-glow)');
    expect(
      cssRule(appCss, "html[data-theme='light'] .lobby-form .action-button.green:hover"),
    ).toContain('var(--ui-select-glow)');

    // The primary button is blue, never the attacker green.
    expect(cssRule(appCss, '.lobby-form .action-button.green')).toContain(
      'background: var(--ui-select-accent)',
    );
    expect(appCss).not.toMatch(/\.lobby-form[^{]*{[^}]*#22c55e/);
  });
});

describe('T-90 semantic feature color system', () => {
  it('defines a royal-blue UI selection family in both themes', () => {
    const dark = cssRule(appCss, ':root');
    const light = cssRule(appCss, "html[data-theme='light']");
    expect(dark).toContain('--ui-select-accent: #3b82f6');
    expect(dark).toContain('--ui-select-border: rgba(59, 130, 246, 0.85)');
    expect(dark).toContain('--ui-select-glow: rgba(59, 130, 246, 0.4)');
    expect(dark).toContain('--ui-select-bg: rgba(59, 130, 246, 0.16)');
    // T-90-feedback-3: the Light palette is paler and the alphas softer.
    expect(light).toContain('--ui-select-accent: #5b87f5');
    expect(light).toContain('--ui-select-border: rgba(91, 135, 245, 0.62)');
    expect(light).toContain('--ui-select-glow: rgba(91, 135, 245, 0.3)');
    expect(light).toContain('--ui-select-bg: rgba(91, 135, 245, 0.1)');
    expect(light).not.toMatch(/#1d4ed8|rgba\(29, 78, 216/);
  });

  it('keeps every menu, POV, hand-sorting and lobby selection on the blue family', () => {
    const selectors = [
      '.theme-option.active',
      '.texture-option.active',
      '.cardback-option.active',
      '.pack-option.active',
      '.hotseat-tab.active',
      '.qa-scenario-button:hover',
      '.review-nav-button:hover',
    ];
    for (const selector of selectors) {
      const rule = cssRule(appCss, selector);
      expect(rule, selector).toMatch(/--ui-select/);
      expect(rule, selector).not.toMatch(
        /#22c55e|#15803d|#0f7636|34, 197, 94|21, 128, 61|15, 118, 54/,
      );
    }
    expect(cssRule(tableCss, '.sort-select')).toContain('var(--ui-select-border)');
    expect(cssRule(tableCss, '.sort-select:hover')).toContain('var(--ui-select-glow)');
    expect(cssRule(appCss, '.field select:focus-visible')).toContain(
      'var(--ui-select-accent)',
    );
    expect(
      cssRule(appCss, "html[data-theme='light'] .lobby-form .field select:focus-visible"),
    ).toContain('var(--ui-select-accent)');
    expect(cssRule(appCss, '.lobby-form .action-button.green')).toContain(
      'background: var(--ui-select-accent)',
    );
    expect(cssRule(appCss, '.checkbox-field input')).toContain('accent-color: var(--ui-select-accent)');
    expect(cssRule(appCss, ".setting-row input[type='range']")).toContain(
      'accent-color: var(--ui-select-accent)',
    );
  });

  it('defines emerald Attacker and crimson Defender families in both themes', () => {
    const dark = cssRule(tableCss, ':root');
    const light = cssRule(tableCss, ":root[data-theme='light']");
    expect(dark).toContain('--role-attacker-accent: #22c55e');
    expect(dark).toContain('--role-attacker-border: rgba(34, 197, 94, 0.85)');
    expect(dark).toContain('--role-attacker-glow: rgba(34, 197, 94, 0.55)');
    expect(light).toContain('--role-attacker-accent: #46a76f');
    expect(light).toContain('--role-attacker-border: rgba(70, 167, 111, 0.6)');
    expect(light).toContain('--role-attacker-glow: rgba(70, 167, 111, 0.3)');
    expect(dark).toContain('--role-defender-accent: #ef4444');
    expect(dark).toContain('--role-defender-border: rgba(239, 68, 68, 0.88)');
    expect(dark).toContain('--role-defender-glow: rgba(239, 68, 68, 0.6)');
    expect(light).toContain('--role-defender-accent: #dc6868');
    expect(light).toContain('--role-defender-border: rgba(220, 104, 104, 0.65)');
    expect(light).toContain('--role-defender-glow: rgba(220, 104, 104, 0.34)');
    // None of the old high-emphasis Light colours survive.
    expect(light).not.toMatch(/#15803d|#b91c1c|rgba\(21, 128, 61|rgba\(185, 28, 28/);
  });

  it('wires every Attacker, Defender, trump, redirect and clock feature to its family', () => {
    // Players rows and hands.
    expect(cssRule(appCss, ".status-badge[data-role='attacker']")).toContain(
      'var(--role-attacker-border)',
    );
    expect(cssRule(appCss, ".status-badge[data-role='defender']")).toContain(
      'var(--role-defender-border)',
    );
    expect(
      cssRule(
        tableCss,
        ".hand-cards[data-highlighted='true'][data-highlight-variant='attacker']",
      ),
    ).toContain('attackerPulse');
    expect(
      cssRule(
        tableCss,
        ".hand-cards[data-highlighted='true'][data-highlight-variant='defender']",
      ),
    ).toContain('defenderHandPulse');
    // Dark attacker hand pulse is emerald (not amber) and the uncovered pulse is crimson.
    expect(tableCss).toMatch(/@keyframes attackerPulse\s*{[\s\S]*?var\(--attacker-glow\)/);
    expect(tableCss).toMatch(/@keyframes turnPulse\s*{[\s\S]*?var\(--role-defender-glow\)/);
    expect(tableCss).toMatch(/\[data-table-theme='light'\] \.table-card-uncovered \.card-slot/);
    // Table surfaces.
    expect(tableCss).toMatch(
      /\.target-outline\s*{[^}]*border: 2px dashed var\(--role-attacker-border\)/,
    );
    expect(cssRule(tableCss, '.redirect-outline')).toContain('var(--redirect-border)');
    expect(cssRule(tableCss, '.action-button.green')).toContain('var(--role-attacker-accent)');
    expect(cssRule(tableCss, '.action-button.red')).toContain('var(--role-defender-accent)');
    // Trump / redirect / clock tokens.
    expect(cssRule(tableCss, ':root')).toContain('--trump-accent: #f59e0b');
    expect(cssRule(tableCss, ":root[data-theme='light']")).toContain('--trump-accent: #d4943a');
    expect(cssRule(tableCss, '.card-slot.trump')).toContain('var(--trump-accent)');
    expect(cssRule(tableCss, '.trump-badge')).toContain('var(--trump-border)');
    expect(cssRule(tableCss, ':root')).toContain('--redirect-accent: #a855f7');
    expect(cssRule(tableCss, ":root[data-theme='light']")).toContain('--redirect-accent: #a375e6');
    expect(cssRule(tableCss, ':root')).toContain('--clock-active-accent: #22d3ee');
    expect(cssRule(tableCss, ":root[data-theme='light']")).toContain(
      '--clock-active-accent: #0e7490',
    );
    expect(cssRule(appCss, ".game-clock[data-active='true']")).toContain(
      'var(--clock-idle-text)',
    );
    expect(cssRule(tableCss, ':root')).toContain('--clock-idle-text: #f8fafc');
    expect(cssRule(tableCss, ":root[data-theme='light']")).toContain(
      '--clock-idle-text: #0f172a',
    );
    expect(cssRule(appCss, ".turn-clock[data-low-time='true']")).toContain(
      'var(--clock-urgent-accent)',
    );
  });
});

describe('parseRoute', () => {
  it('routes a game hash with a player query parameter', () => {
    expect(parseRoute('#/g/game-1?player=p2')).toEqual({
      name: 'game',
      gameId: 'game-1',
      playerId: 'p2',
    });
  });

  it('routes an 8-character alphanumeric game id', () => {
    expect(parseRoute('#/g/aB3dE9fZ?player=p1')).toEqual({
      name: 'game',
      gameId: 'aB3dE9fZ',
      playerId: 'p1',
    });
  });

  it('decodes the game id and defaults the player id', () => {
    expect(parseRoute('#/g/game%2F1')).toEqual({
      name: 'game',
      gameId: 'game/1',
      playerId: 'p0',
    });
  });

  it('falls back to the lobby for other hashes', () => {
    expect(parseRoute('')).toEqual({ name: 'lobby' });
    expect(parseRoute('#/')).toEqual({ name: 'lobby' });
    expect(parseRoute('#/g/')).toEqual({ name: 'lobby' });
  });

  it('rejects a game id that is empty once decoded', () => {
    expect(parseRoute('#/g/%20')).toEqual({ name: 'lobby' });
    expect(parseRoute('#/g/%20%20')).toEqual({ name: 'lobby' });
    expect(parseRoute('#/g/%E0%A4%A')).toEqual({ name: 'lobby' });
  });

  it('defaults a blank player query parameter', () => {
    expect(parseRoute('#/g/game-1?player=')).toEqual({
      name: 'game',
      gameId: 'game-1',
      playerId: 'p0',
    });
  });

  it('routes the /replay alias of a game and defaults the player', () => {
    expect(parseRoute('#/g/game-1/replay')).toEqual({
      name: 'game',
      gameId: 'game-1',
      playerId: 'p0',
    });
    expect(parseRoute('#/g/game-1/replay?player=p2')).toEqual({
      name: 'game',
      gameId: 'game-1',
      playerId: 'p2',
    });
  });

  it('defaults a whitespace-only player query parameter', () => {
    expect(parseRoute('#/g/game-1?player=%20')).toEqual({
      name: 'game',
      gameId: 'game-1',
      playerId: 'p0',
    });
  });
});
