import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/preact';
import { HeaderBar, NAV_MENUS, PROFILE_ITEMS, connectionLevel } from '../components/HeaderBar';
import { ALL_CARD_BACK_PATTERNS, CardBack } from '../components/CardBack';
import { soundEngine } from '../audio/SoundEngine';
import { TABLE_TEXTURES } from '../styles/tableTextures';
import {
  clampRoundness,
  getSettings,
  resetSettings,
  resolveTheme,
  setSettings,
  subscribeSettings,
} from '../state/settings';
import appCss from '../app.css?raw';

/** Declarations of the first rule whose selector text contains `selector`. */
function cssRule(css: string, selector: string): string {
  const start = css.indexOf(selector);
  if (start === -1) return '';
  const open = css.indexOf('{', start);
  const close = css.indexOf('}', open);
  return open === -1 || close === -1 ? '' : css.slice(open + 1, close);
}

const openProfile = () => fireEvent.click(screen.getByRole('button', { name: 'Account menu' }));

const openSubmenu = (label: string) => {
  openProfile();
  fireEvent.click(screen.getByRole('menuitem', { name: label }));
};

describe('HeaderBar', () => {
  beforeEach(() => {
    resetSettings();
    window.localStorage.clear();
  });

  afterEach(() => {
    soundEngine.setVolume(0.7);
    soundEngine.setSoundPack('classic-felt');
    resetSettings();
    vi.restoreAllMocks();
  });

  it('renders the LIDURAK brand with the SVG logo left of the wordmark', () => {
    render(<HeaderBar />);

    const brand = screen.getByRole('link', { name: 'LIDURAK' });
    expect(brand.getAttribute('href')).toBe('#/');
    expect(brand.classList.contains('header-brand')).toBe(true);

    const logo = screen.getByTestId('header-logo');
    expect(logo.tagName.toLowerCase()).toBe('svg');
    expect(logo.classList.contains('header-logo')).toBe(true);
    expect(brand.contains(logo)).toBe(true);

    // The mark sits immediately before the wordmark inside the same link.
    expect(logo.nextElementSibling?.textContent).toBe('LIDURAK');

    expect(NAV_MENUS.map((menu) => menu.label)).toEqual(['PLAY', 'PUZZLES', 'LEARN', 'WATCH']);
    for (const menu of NAV_MENUS) {
      const trigger = screen.getByRole('button', { name: menu.label });
      expect(trigger.getAttribute('aria-haspopup')).toBe('true');
      expect(trigger.getAttribute('aria-expanded')).toBe('false');
    }
  });

  it('opens a navigation menu on hover and closes it on leave', () => {
    const { container } = render(<HeaderBar />);
    const wrapper = container.querySelector('.header-menu')!;
    expect(wrapper.getAttribute('data-open')).toBe('false');

    fireEvent.mouseEnter(wrapper);

    expect(wrapper.getAttribute('data-open')).toBe('true');
    const playMenu = screen.getByRole('menu', { name: 'PLAY menu' });
    expect(within(playMenu).getByRole('menuitem', { name: 'New game' })).toBeTruthy();
    expect(
      screen.getByRole('button', { name: 'PLAY' }).getAttribute('aria-expanded'),
    ).toBe('true');

    fireEvent.mouseLeave(wrapper);
    expect(wrapper.getAttribute('data-open')).toBe('false');
  });

  it('toggles a profile dropdown with every required item, icon and chevron', () => {
    const { container } = render(<HeaderBar />);
    expect(screen.queryByRole('menu', { name: 'Profile menu' })).toBeNull();

    openProfile();

    const menu = screen.getByRole('menu', { name: 'Profile menu' });
    const labels = [
      'Profile',
      'Inbox',
      'Preferences',
      'Sign out',
      'Language',
      'Sound',
      'Theme',
      'Table',
      'Card Back',
    ];
    expect(PROFILE_ITEMS).toHaveLength(labels.length);
    for (const label of labels) {
      const item = within(menu).getByRole('menuitem', { name: label });
      expect(item.querySelector('svg.menu-icon'), label).not.toBeNull();
    }

    // Only Sound, Theme, Table and Card Back open a submenu.
    expect(container.querySelectorAll('.profile-item .menu-chevron')).toHaveLength(4);

    openProfile();
    expect(screen.queryByRole('menu', { name: 'Profile menu' })).toBeNull();
  });

  it('replaces the profile list in place with a submenu that has a back header', () => {
    render(<HeaderBar />);
    openSubmenu('Sound');

    // The main rows are gone; the submenu body occupies the same panel.
    const menu = screen.getByRole('menu', { name: 'Profile menu' });
    expect(within(menu).queryByRole('menuitem', { name: 'Profile' })).toBeNull();
    expect(screen.getByTestId('submenu-sound')).toBeTruthy();

    const back = screen.getByTestId('submenu-back');
    expect(back.classList.contains('submenu-header')).toBe(true);
    expect(back.querySelector('svg.submenu-chevron')).not.toBeNull();
    expect(back.textContent).toContain('Sound');

    fireEvent.click(back);

    expect(screen.queryByTestId('submenu-sound')).toBeNull();
    expect(
      within(screen.getByRole('menu', { name: 'Profile menu' })).getByRole('menuitem', {
        name: 'Profile',
      }),
    ).toBeTruthy();
  });

  it('shows uppercase PING and SERVER DELAY labels with a lowercase ms unit', () => {
    render(<HeaderBar pingMs={42} serverDelayMs={9} />);
    openProfile();

    expect(screen.getByTestId('ping-label').textContent).toBe('PING');
    expect(screen.getByTestId('server-delay-label').textContent).toBe('SERVER DELAY');
    expect(screen.getByTestId('ping-value').textContent).toBe('42 ms');
    expect(screen.getByTestId('server-delay-value').textContent).toBe('9 ms');

    const bars = screen.getByRole('img', { name: 'Connection strength: 4 of 4' });
    expect(bars.querySelectorAll('.signal-bar')).toHaveLength(4);
    expect(bars.querySelectorAll('.signal-bar[data-active="true"]')).toHaveLength(4);
    // Nothing is animating until the tier changes.
    expect(bars.classList.contains('connection-bars-updating')).toBe(false);

    // The developer lag-switch is gone from the connection section.
    expect(screen.queryByTestId('lag-switch')).toBeNull();
    expect(screen.queryByLabelText('Lag switch')).toBeNull();
    expect(screen.queryByText(/lag-switch/i)).toBeNull();
  });

  it('drops signal bars as latency worsens', () => {
    expect(connectionLevel(20)).toBe(4);
    expect(connectionLevel(120)).toBe(3);
    expect(connectionLevel(250)).toBe(2);
    expect(connectionLevel(900)).toBe(1);
    expect(connectionLevel(Number.NaN)).toBe(1);

    render(<HeaderBar pingMs={900} />);
    openProfile();

    const bars = screen.getByRole('img', { name: 'Connection strength: 1 of 4' });
    expect(bars.querySelectorAll('.signal-bar[data-active="true"]')).toHaveLength(1);
  });

  it('colours the active bars green for 4/3, yellow for 2 and red for 1', () => {
    const cases: Array<{ ping: number; level: number; color: string }> = [
      { ping: 20, level: 4, color: 'green' },
      { ping: 60, level: 4, color: 'green' },
      { ping: 150, level: 3, color: 'green' },
      { ping: 300, level: 2, color: 'yellow' },
      { ping: 301, level: 1, color: 'red' },
    ];

    for (const { ping, level, color } of cases) {
      const { unmount } = render(<HeaderBar pingMs={ping} />);
      openProfile();

      const bars = screen.getByRole('img', { name: `Connection strength: ${level} of 4` });
      expect(bars.getAttribute('data-level')).toBe(String(level));
      expect(bars.getAttribute('data-bar-color')).toBe(color);

      const active = Array.from(bars.querySelectorAll('.signal-bar[data-active="true"]'));
      expect(active, `active bars at ${ping} ms`).toHaveLength(level);
      for (const bar of active) {
        expect(bar.classList.contains('active')).toBe(true);
        expect(bar.getAttribute('data-bar-color')).toBe(color);
      }

      // Inactive bars stay neutral and carry no tier colour.
      const inactive = Array.from(bars.querySelectorAll('.signal-bar[data-active="false"]'));
      expect(inactive).toHaveLength(4 - level);
      for (const bar of inactive) expect(bar.hasAttribute('data-bar-color')).toBe(false);

      unmount();
    }
  });

  it('follows the live measured ping and pops the bars only on a tier change', async () => {
    const { rerender } = render(<HeaderBar pingMs={24} />);
    openProfile();

    expect(screen.getByTestId('ping-value').textContent).toBe('24 ms');
    expect(
      screen
        .getByRole('img', { name: 'Connection strength: 4 of 4' })
        .classList.contains('connection-bars-updating'),
    ).toBe(false);

    // A worse reading from the app drops the tracker to a single red bar.
    rerender(<HeaderBar pingMs={420} />);

    expect(screen.getByTestId('ping-value').textContent).toBe('420 ms');
    const bars = screen.getByRole('img', { name: 'Connection strength: 1 of 4' });
    expect(bars.querySelectorAll('.signal-bar[data-active="true"]')).toHaveLength(1);
    expect(bars.getAttribute('data-bar-color')).toBe('red');
    expect(bars.classList.contains('connection-bars-updating')).toBe(true);
    expect(bars.getAttribute('data-updating')).toBe('true');

    // The pop is a single 360 ms pulse, not an idle animation.
    await waitFor(
      () =>
        expect(
          screen
            .getByRole('img', { name: 'Connection strength: 1 of 4' })
            .getAttribute('data-updating'),
        ).toBe('false'),
      { timeout: 1500 },
    );

    // Another reading in the same tier keeps the bars still.
    rerender(<HeaderBar pingMs={900} />);
    expect(screen.getByTestId('ping-value').textContent).toBe('900 ms');
    expect(
      screen
        .getByRole('img', { name: 'Connection strength: 1 of 4' })
        .getAttribute('data-updating'),
    ).toBe('false');
  });

  it('previews a pack sample and plays the volume sample only on slider release', () => {
    const sample = vi.spyOn(soundEngine, 'playSampleSound');
    render(<HeaderBar />);
    openSubmenu('Sound');

    const panel = screen.getByTestId('submenu-sound');
    const slider = within(panel).getByLabelText('Master volume') as HTMLInputElement;
    expect(Number(slider.value)).toBeCloseTo(0.7);

    fireEvent.click(within(panel).getByRole('button', { name: 'Sci-Fi Synth' }));

    expect(soundEngine.getSoundPack()).toBe('sci-fi-synth');
    expect(sample).toHaveBeenCalledWith('sci-fi-synth', expect.any(Number));
    expect(
      within(panel).getByRole('button', { name: 'Sci-Fi Synth' }).getAttribute('aria-pressed'),
    ).toBe('true');

    sample.mockClear();
    // Dragging the slider is silent but updates the stored volume and readout.
    fireEvent.input(slider, { target: { value: '0.9' } });
    fireEvent.input(slider, { target: { value: '0.35' } });

    expect(soundEngine.getVolume()).toBeCloseTo(0.35);
    expect(within(panel).getByText('35%')).toBeTruthy();
    expect(sample).toHaveBeenCalledTimes(0);

    // The burst of release events from one gesture auditions exactly one sample.
    fireEvent.pointerUp(slider);
    fireEvent.mouseUp(slider);
    fireEvent.touchEnd(slider);

    expect(sample).toHaveBeenCalledTimes(1);
    expect(sample).toHaveBeenCalledWith(undefined, 0.35);

    expect(within(panel).getAllByRole('button').map((button) => button.textContent)).toEqual([
      'Classic Felt',
      'Arcade 8-Bit',
      'Sci-Fi Synth',
      'Acoustic Pluck',
      'Modern Minimal',
    ]);
  });

  it('switches themes and applies the roundness slider to the document', () => {
    render(<HeaderBar />);
    openSubmenu('Theme');

    const panel = screen.getByTestId('submenu-theme');

    fireEvent.click(within(panel).getByRole('button', { name: 'Light' }));
    expect(document.documentElement.getAttribute('data-theme')).toBe('light');

    fireEvent.click(within(panel).getByRole('button', { name: 'Dark' }));
    expect(document.documentElement.getAttribute('data-theme')).toBe('dark');

    const roundness = within(panel).getByLabelText('Roundness') as HTMLInputElement;
    expect(roundness.value).toBe('8');
    expect(document.documentElement.style.getPropertyValue('--app-roundness')).toBe('8px');

    fireEvent.input(roundness, { target: { value: '0' } });
    expect(document.documentElement.style.getPropertyValue('--app-roundness')).toBe('0px');

    fireEvent.input(roundness, { target: { value: '16' } });
    expect(document.documentElement.style.getPropertyValue('--app-roundness')).toBe('16px');

    expect(clampRoundness(42)).toBe(16);
    expect(clampRoundness(-5)).toBe(0);
    expect(resolveTheme('device', true)).toBe('dark');
    expect(resolveTheme('device', false)).toBe('light');
  });

  it('selects a table texture and previews the felt filters on every swatch', () => {
    render(<HeaderBar />);
    openSubmenu('Table');

    const panel = screen.getByTestId('submenu-table');
    expect(within(panel).getAllByRole('button')).toHaveLength(6);

    fireEvent.click(within(panel).getByRole('button', { name: 'Midnight Navy' }));

    expect(document.documentElement.getAttribute('data-table-texture')).toBe('midnight-navy');
    expect(getSettings().tableTexture).toBe('midnight-navy');
    expect(
      within(panel).getByRole('button', { name: 'Midnight Navy' }).getAttribute('aria-pressed'),
    ).toBe('true');

    const swatch = panel.querySelector(
      '[data-testid="texture-swatch-midnight-navy"]',
    ) as HTMLElement;
    // Dark mode is calibrated: the 100% default paints at 1.10.
    expect(swatch.getAttribute('style')).toContain('brightness(1.1) contrast(1) hue-rotate(0deg)');

    fireEvent.input(within(panel).getByLabelText('Brightness'), { target: { value: '1.2' } });
    fireEvent.input(within(panel).getByLabelText('Contrast'), { target: { value: '0.8' } });
    fireEvent.input(within(panel).getByLabelText('Hue'), { target: { value: '25' } });

    expect(getSettings().tableFilters).toEqual({ brightness: 1.2, contrast: 0.8, hue: 25 });
    expect(document.documentElement.style.getPropertyValue('--table-filter')).toBe(
      'brightness(1.32) contrast(0.8) hue-rotate(25deg)',
    );
    expect(document.documentElement.style.getPropertyValue('--table-texture-bg')).toBe('#16203a');
    // The preview swatches follow the sliders in real time.
    expect(swatch.getAttribute('style')).toContain(
      'brightness(1.32) contrast(0.8) hue-rotate(25deg)',
    );
  });

  it('previews every table texture with the palette of the active theme', async () => {
    const hexToRgb = (hex: string): string => {
      const value = hex.replace('#', '');
      const [r, g, b] = [0, 2, 4].map((offset) => parseInt(value.slice(offset, offset + 2), 16));
      return `rgb(${r}, ${g}, ${b})`;
    };

    setSettings({ theme: 'dark' });
    const view = render(<HeaderBar />);
    openSubmenu('Table');

    const panel = screen.getByTestId('submenu-table');
    const swatch = (id: string) =>
      panel.querySelector(`[data-testid="texture-swatch-${id}"]`) as HTMLElement;

    for (const preset of TABLE_TEXTURES) {
      const node = swatch(preset.id);
      expect(node.getAttribute('data-texture-theme'), preset.id).toBe('dark');
      expect(node.style.backgroundImage, preset.id).toBe(preset.overlay);
      expect(node.getAttribute('style'), preset.id).toContain(hexToRgb(preset.base));
      // Each preview is also addressable by its texture id.
      expect(
        panel.querySelector(`[data-testid="table-texture-${preset.id}"]`),
        preset.id,
      ).not.toBeNull();
    }

    // Switching the theme repaints the previews from the light palette; the
    // texture layers themselves are unchanged.
    setSettings({ theme: 'light' });
    await waitFor(() => {
      for (const preset of TABLE_TEXTURES) {
        const node = swatch(preset.id);
        expect(node.getAttribute('data-texture-theme'), preset.id).toBe('light');
        expect(node.style.backgroundImage, preset.id).toBe(preset.lightOverlay);
        expect(node.getAttribute('style'), preset.id).toContain(hexToRgb(preset.lightBase));
      }
    });

    view.unmount();
  });

  it('selects one of the colourful card back designs', () => {
    render(<HeaderBar />);
    openSubmenu('Card Back');

    const panel = screen.getByTestId('submenu-cardback');
    const options = within(panel).getAllByRole('button');
    expect(options).toHaveLength(ALL_CARD_BACK_PATTERNS.length);
    expect(panel.querySelectorAll('svg.card-back')).toHaveLength(ALL_CARD_BACK_PATTERNS.length);
    expect(
      within(panel).getByRole('button', { name: 'Classic Hatch' }).getAttribute('aria-pressed'),
    ).toBe('true');

    fireEvent.click(within(panel).getByRole('button', { name: 'Royal Sapphire' }));

    expect(getSettings().cardBack).toBe('royal-sapphire');
    expect(document.documentElement.getAttribute('data-card-back')).toBe('royal-sapphire');
    expect(
      within(panel).getByRole('button', { name: 'Royal Sapphire' }).getAttribute('aria-pressed'),
    ).toBe('true');
    expect(
      panel.querySelector('svg.card-back[data-pattern="royal-sapphire"]')!.getAttribute(
        'data-colorful',
      ),
    ).toBe('true');
  });

  it('applies the chosen card back to face-down cards', () => {
    setSettings({ cardBack: 'starburst' });

    const { container } = render(<CardBack />);

    expect(container.querySelector('svg')!.getAttribute('data-pattern')).toBe('starburst');
  });

  it('notifies settings subscribers until they unsubscribe', () => {
    const listener = vi.fn();
    const unsubscribe = subscribeSettings(listener);

    setSettings({ cardBack: 'chevron' });
    expect(listener).toHaveBeenCalledTimes(1);

    unsubscribe();
    setSettings({ cardBack: 'hex-mesh' });
    expect(listener).toHaveBeenCalledTimes(1);
  });
});

describe('T-90-3 light-mode menu and appearance glows', () => {
  beforeEach(() => {
    resetSettings();
    window.localStorage.clear();
  });

  it('darkens the active Theme / Table / Card Back / Sound options', () => {
    render(<HeaderBar />);

    openSubmenu('Theme');
    expect(screen.getByRole('button', { name: 'Device theme' }).getAttribute('aria-pressed')).toBe(
      'true',
    );
    expect(cssRule(appCss, "html[data-theme='light'] .theme-option.active")).toContain(
      'box-shadow: 0 0 12px 2px var(--ui-select-glow)',
    );
    expect(
      cssRule(appCss, "html[data-theme='light'] .theme-option[aria-pressed='true']"),
    ).toContain('border-color: var(--ui-select-accent)');

    // Each submenu lives in place of the main list, so start from a clean tree.
    cleanup();
    render(<HeaderBar />);
    openSubmenu('Table');
    const emerald = screen.getByRole('button', { name: /Emerald Felt/ });
    expect(emerald.getAttribute('aria-pressed')).toBe('true');
    expect(emerald.querySelector('.texture-swatch')).not.toBeNull();
    expect(
      cssRule(appCss, "html[data-theme='light'] .texture-option.active .texture-swatch"),
    ).toContain('outline: 2px solid var(--ui-select-accent)');

    cleanup();
    render(<HeaderBar />);
    openSubmenu('Card Back');
    const classic = screen.getByRole('button', { name: /Classic Hatch/ });
    expect(classic.getAttribute('aria-pressed')).toBe('true');
    expect(classic.querySelector('.cardback-preview')).not.toBeNull();
    expect(
      cssRule(appCss, "html[data-theme='light'] .cardback-option.active .cardback-preview"),
    ).toContain('box-shadow: 0 0 12px 2px var(--ui-select-glow)');

    cleanup();
    render(<HeaderBar />);
    openSubmenu('Sound');
    expect(
      cssRule(appCss, "html[data-theme='light'] .pack-option.active"),
    ).toContain('box-shadow: 0 0 12px 2px var(--ui-select-glow)');
  });

  it('darkens the top navigation and profile menu hover/focus glows', () => {
    expect(
      cssRule(appCss, "html[data-theme='light'] .header-menu-trigger:hover"),
    ).toContain('var(--ui-select-glow)');
    expect(
      cssRule(appCss, "html[data-theme='light'] .header-menu-dropdown a:hover"),
    ).toContain('var(--ui-select-border)');
    expect(cssRule(appCss, "html[data-theme='light'] .profile-item.active")).toContain(
      'rgba(29, 78, 216, 0.8)',
    );

    // Dark mode uses the same blue family, never the attacker green.
    expect(cssRule(appCss, '.theme-option.active')).toContain('var(--ui-select-accent)');
    expect(cssRule(appCss, '.theme-option.active')).not.toMatch(/#22c55e|#15803d/);
    expect(appCss).not.toMatch(/\n\.header-menu-trigger:hover\s*{[^}]*#22c55e/);
  });
});

/**
 * T-90 ITEM-1b: every UI customization menu (Theme, Table, Card Back, Sound)
 * selects through the Royal Blue / Cobalt `--ui-select-*` family — never the
 * attacker's emerald green — in both the Dark and Light themes.
 */
describe('T-90 item 1b: appearance menus select in royal blue', () => {
  beforeEach(() => {
    resetSettings();
    window.localStorage.clear();
  });

  afterEach(() => {
    cleanup();
    resetSettings();
  });

  it('tags every Theme / Table / Card Back / Sound choice with the chrome classes', () => {
    render(<HeaderBar />);
    openSubmenu('Theme');
    const theme = screen.getByRole('button', { name: 'Device theme' });
    expect(theme.classList.contains('appearance-choice')).toBe(true);
    expect(theme.classList.contains('active')).toBe(true);

    cleanup();
    render(<HeaderBar />);
    openSubmenu('Table');
    const felt = screen.getByRole('button', { name: /Emerald Felt/ });
    expect(felt.classList.contains('appearance-choice')).toBe(true);
    expect(felt.classList.contains('felt-swatch-btn')).toBe(true);
    expect(felt.classList.contains('active')).toBe(true);
    expect(felt.querySelector('.texture-swatch')).not.toBeNull();

    cleanup();
    render(<HeaderBar />);
    openSubmenu('Card Back');
    const back = screen.getByRole('button', { name: /Classic Hatch/ });
    expect(back.classList.contains('appearance-choice')).toBe(true);
    expect(back.classList.contains('card-back-swatch-btn')).toBe(true);
    expect(back.classList.contains('active')).toBe(true);
    expect(back.querySelector('.cardback-preview')).not.toBeNull();

    cleanup();
    render(<HeaderBar />);
    openSubmenu('Sound');
    const pack = document.querySelector(
      '[data-testid="submenu-sound"] .pack-option.active',
    ) as HTMLElement;
    expect(pack).not.toBeNull();
    expect(pack.classList.contains('appearance-choice')).toBe(true);
    expect(pack.classList.contains('sound-pack-btn')).toBe(true);
  });

  it('styles every appearance selection with --ui-select-* and never attacker green', () => {
    const selectors = [
      '.appearance-choice.active',
      '.sound-pack-btn.active',
      '.felt-swatch-btn.active',
      '.card-back-swatch-btn.active',
      '.theme-option.active',
      '.texture-option.active',
      '.cardback-option.active',
      '.pack-option.active',
      '.felt-swatch-btn.active .texture-swatch',
      '.card-back-swatch-btn.active .cardback-preview',
      '.header-brand:hover',
      '.pov-tab.active',
      ".setting-row input[type='range']",
    ];
    for (const selector of selectors) {
      const rule = cssRule(appCss, selector);
      expect(rule, selector).toContain('var(--ui-select-');
      expect(rule, selector).not.toMatch(/#4ade80|#22c55e|#15803d/);
    }

    // Both themes define the same four-value family.
    expect(cssRule(appCss, ':root')).toContain('--ui-select-bg: rgba(59, 130, 246, 0.16)');
    expect(cssRule(appCss, ':root')).toContain('--ui-select-text: #93c5fd');
    expect(cssRule(appCss, "html[data-theme='light']")).toContain(
      '--ui-select-bg: rgba(37, 99, 235, 0.14)',
    );
    expect(cssRule(appCss, "html[data-theme='light']")).toContain('--ui-select-text: #1e3a8a');
  });
});
