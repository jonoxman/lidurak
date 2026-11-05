import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/preact';
import { HeaderBar, NAV_MENUS, PROFILE_ITEMS, connectionLevel } from '../components/HeaderBar';
import { ALL_CARD_BACK_PATTERNS, CardBack } from '../components/CardBack';
import { soundEngine } from '../audio/SoundEngine';
import { TABLE_TEXTURES } from '../styles/tableTextures';
import {
  HIGHLIGHT_INTENSITY_MAX,
  HIGHLIGHT_INTENSITY_MIN,
  HIGHLIGHT_PRESETS,
  LIGHT_SLOT_ALPHA,
  USER_SETTINGS_STORAGE_KEY,
  clampRoundness,
  getSettings,
  highlightRgba,
  resetSettings,
  resolveTheme,
  setHighlightIntensity,
  setHighlightPreset,
  setSettings,
  subscribeSettings,
  type HighlightSlot,
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
      'var(--ui-select-border)',
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
      '--ui-select-bg: rgba(91, 135, 245, 0.1)',
    );
    expect(cssRule(appCss, "html[data-theme='light']")).toContain('--ui-select-text: #1e3a8a');
  });
});

/**
 * T-90-feedback-2: Theme ▸ Highlights — placement, six presets with multi-line
 * previews, and the real-time Intensity slider.
 */
describe('T-90-feedback-2 Theme Highlights section', () => {
  beforeEach(() => {
    resetSettings();
    window.localStorage.clear();
  });

  afterEach(() => {
    cleanup();
    resetSettings();
    window.localStorage.clear();
  });

  const openHighlights = () => {
    render(<HeaderBar />);
    openSubmenu('Theme');
    return screen.getByTestId('theme-highlights-section');
  };

  it('ITEM-4 / ITEM-NEW-1a: renders Palettes below Roundness and above the connection tracker', () => {
    const section = openHighlights();

    expect(section.classList.contains('theme-highlights-section')).toBe(true);
    const heading = screen.getByTestId('theme-highlights-heading');
    expect(heading.textContent).toBe('Palettes');
    expect(heading.classList.contains('submenu-section-title')).toBe(true);

    const roundness = screen.getByTestId('roundness-slider');
    const tracker = document.querySelector('.connection-tracker') as HTMLElement;
    expect(roundness).not.toBeNull();
    expect(tracker).not.toBeNull();
    // Roundness precedes the Highlights section, which precedes the PING tracker.
    expect(
      roundness.compareDocumentPosition(section) & Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy();
    expect(
      section.compareDocumentPosition(tracker) & Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy();
    expect(within(screen.getByTestId('submenu-theme')).getByTestId('theme-highlights-section'))
      .toBe(section);
  });

  it('ITEM-NEW-1b: renders six presets and applies each palette in real time', () => {
    const section = openHighlights();
    const buttons = within(section).getAllByRole('button');
    // Six presets + the Intensity slider is not a button, so exactly six.
    expect(buttons).toHaveLength(HIGHLIGHT_PRESETS.length);
    expect(HIGHLIGHT_PRESETS.map((preset) => preset.id)).toEqual([
      'classic',
      'warm',
      'cool',
      'neon',
      'pastel',
      'royal',
    ]);

    const root = document.documentElement;
    expect(root.dataset.highlightPreset).toBe('classic');
    expect(root.style.getPropertyValue('--ui-select-accent')).toBe('#3b82f6');
    expect(within(section).getByTestId('highlight-preset-classic').getAttribute('aria-pressed'))
      .toBe('true');

    for (const preset of HIGHLIGHT_PRESETS) {
      const button = within(section).getByTestId(`highlight-preset-${preset.id}`) as HTMLElement;
      expect(button.classList.contains('highlight-preset-btn')).toBe(true);
      expect(button.getAttribute('data-preset')).toBe(preset.id);

      fireEvent.click(button);

      expect(getSettings().highlightPreset).toBe(preset.id);
      expect(root.dataset.highlightPreset).toBe(preset.id);
      expect(button.getAttribute('aria-pressed')).toBe('true');
      expect(button.classList.contains('active')).toBe(true);
      // Every semantic accent token is rewritten from the preset's dark palette
      // (the default Device theme resolves to dark in jsdom).
      expect(root.style.getPropertyValue('--ui-select-accent')).toBe(preset.dark.uiSelect);
      expect(root.style.getPropertyValue('--role-attacker-accent')).toBe(preset.dark.attacker);
      expect(root.style.getPropertyValue('--role-defender-accent')).toBe(preset.dark.defender);
      expect(root.style.getPropertyValue('--trump-accent')).toBe(preset.dark.trump);
      expect(root.style.getPropertyValue('--redirect-accent')).toBe(preset.dark.redirect);
      expect(root.style.getPropertyValue('--clock-urgent-accent')).toBe(preset.dark.clockUrgent);
    }

    // Warm and Cool are two of the six, and each selected palette sticks.
    fireEvent.click(within(section).getByTestId('highlight-preset-warm'));
    expect(root.style.getPropertyValue('--role-attacker-accent')).toBe('#84cc16');
    fireEvent.click(within(section).getByTestId('highlight-preset-cool'));
    expect(root.style.getPropertyValue('--ui-select-accent')).toBe('#06b6d4');
  });

  it('ITEM-NEW-1b: repaints the palette for the light theme too', () => {
    setSettings({ theme: 'light' });
    const section = openHighlights();
    fireEvent.click(within(section).getByTestId('highlight-preset-warm'));

    const root = document.documentElement;
    expect(root.getAttribute('data-theme')).toBe('light');
    expect(root.style.getPropertyValue('--ui-select-accent')).toBe('#c47a2c');
    expect(root.style.getPropertyValue('--role-attacker-accent')).toBe('#6b9a2e');
    expect(root.style.getPropertyValue('--role-defender-accent')).toBe('#d9526b');
    expect(root.style.getPropertyValue('--trump-accent')).toBe('#c9a227');
    expect(root.style.getPropertyValue('--redirect-accent')).toBe('#d9558f');
    expect(root.style.getPropertyValue('--clock-urgent-accent')).toBe('#d97a45');

    // Switching back to dark reloads the dark half of the same preset.
    fireEvent.click(screen.getByRole('button', { name: 'Dark' }));
    expect(root.style.getPropertyValue('--ui-select-accent')).toBe('#d97706');
  });

  it('ITEM-NEW-1c: each preset button previews six distinct highlight lines', () => {
    const section = openHighlights();

    for (const preset of HIGHLIGHT_PRESETS) {
      const preview = within(section).getByTestId(`highlight-preset-preview-${preset.id}`);
      expect(preview.classList.contains('highlight-preset-lines')).toBe(true);
      const lines = Array.from(preview.querySelectorAll('.highlight-preview-line')) as HTMLElement[];
      expect(lines, preset.id).toHaveLength(6);

      const colors = lines.map((line) => line.style.background || line.style.backgroundColor);
      // One line per semantic slot, each with its own preset colour.
      expect(new Set(colors).size, preset.id).toBe(6);
      for (const line of lines) {
        expect(line.getAttribute('data-slot')).toBeTruthy();
        expect(line.style.boxShadow).not.toBe('');
      }
      expect(lines[0].getAttribute('data-slot')).toBe('uiSelect');
      expect(lines[5].getAttribute('data-slot')).toBe('clockUrgent');
    }

    // Changing preset visibly repaints the preview lines inside the buttons.
    const classicLine = within(section)
      .getByTestId('highlight-preset-preview-classic')
      .querySelector('.highlight-preview-line') as HTMLElement;
    const classicColor = classicLine.style.background || classicLine.style.backgroundColor;
    const warmLine = within(section)
      .getByTestId('highlight-preset-preview-warm')
      .querySelector('.highlight-preview-line') as HTMLElement;
    expect(warmLine.style.background || warmLine.style.backgroundColor).not.toBe(classicColor);
  });

  it('ITEM-NEW-1d: the Intensity slider scales every aura token in real time', () => {
    const section = openHighlights();
    const slider = screen.getByTestId('highlight-intensity-slider') as HTMLInputElement;
    const readout = screen.getByTestId('highlight-intensity-value');
    const root = document.documentElement;

    expect(slider.type).toBe('range');
    expect(slider.min).toBe(String(HIGHLIGHT_INTENSITY_MIN));
    expect(slider.max).toBe(String(HIGHLIGHT_INTENSITY_MAX));
    expect(slider.value).toBe('100');
    expect(readout.textContent).toBe('100%');
    expect(root.dataset.highlightIntensity).toBe('100');
    expect(root.style.getPropertyValue('--highlight-intensity')).toBe('1');
    expect(section.contains(slider)).toBe(true);

    const baseGlow = root.style.getPropertyValue('--role-defender-glow');
    const basePreviewShadow = (
      within(section)
        .getByTestId('highlight-preset-preview-classic')
        .querySelector('.highlight-preview-line') as HTMLElement
    ).style.boxShadow;

    fireEvent.input(slider, { target: { value: '180' } });

    expect(getSettings().highlightIntensity).toBe(180);
    expect(root.dataset.highlightIntensity).toBe('180');
    expect(root.style.getPropertyValue('--highlight-intensity')).toBe('1.8');
    expect(readout.textContent).toBe('180%');
    expect(root.style.getPropertyValue('--role-defender-glow')).not.toBe(baseGlow);
    expect(root.style.getPropertyValue('--role-attacker-pulse-outer')).not.toBe('');
    expect(root.style.getPropertyValue('--role-defender-pulse-halo')).not.toBe('');
    expect(root.style.getPropertyValue('--trump-glow')).not.toBe('');
    expect(root.style.getPropertyValue('--redirect-glow')).not.toBe('');
    expect(root.style.getPropertyValue('--clock-low-glow')).not.toBe('');

    // The preview bars brighten with the same live factor.
    const previewShadow = (
      within(section)
        .getByTestId('highlight-preset-preview-classic')
        .querySelector('.highlight-preview-line') as HTMLElement
    ).style.boxShadow;
    expect(previewShadow).not.toBe(basePreviewShadow);

    // Subtle end of the range: 20% still applies, just much softer.
    fireEvent.input(slider, { target: { value: '20' } });
    expect(root.dataset.highlightIntensity).toBe('20');
    expect(root.style.getPropertyValue('--highlight-intensity')).toBe('0.2');
    expect(readout.textContent).toBe('20%');

    // The choice is persisted as UserSettings.
    const stored = JSON.parse(
      window.localStorage.getItem(USER_SETTINGS_STORAGE_KEY) as string,
    ) as { highlightPreset: string; highlightIntensity: number };
    expect(stored.highlightIntensity).toBe(20);
    expect(stored.highlightPreset).toBe('classic');
  });
});

/**
 * T-90-feedback-20261104_133915-1: Light mode highlights are slightly paler and
 * softer at the default 100% intensity across every preset and every semantic
 * role, while the Intensity slider still scales them in real time.
 */
describe('T-90-feedback-3 paler light-mode highlights', () => {
  const PREFIXES: Record<HighlightSlot, string> = {
    uiSelect: '--ui-select',
    attacker: '--role-attacker',
    defender: '--role-defender',
    trump: '--trump',
    redirect: '--redirect',
    clockUrgent: '--clock-urgent',
  };

  const alphaOf = (value: string): number => {
    const match = /rgba\([^)]*,\s*([0-9.]+)\)/.exec(value);
    return match ? Number(match[1]) : Number.NaN;
  };

  /** jsdom reports inline background hex colours as `rgb(r, g, b)`. */
  const rgbCss = (hex: string): string => {
    const value = hex.replace('#', '');
    const [r, g, b] = [0, 2, 4].map((offset) => parseInt(value.slice(offset, offset + 2), 16));
    return `rgb(${r}, ${g}, ${b})`;
  };

  beforeEach(() => {
    resetSettings();
    window.localStorage.clear();
  });

  afterEach(() => {
    cleanup();
    resetSettings();
  });

  it('ITEM-LIGHT-1: every preset resolves to its paler Light palette in Light mode', () => {
    setSettings({ theme: 'light' });
    const root = document.documentElement;
    expect(root.getAttribute('data-theme')).toBe('light');

    for (const preset of HIGHLIGHT_PRESETS) {
      setHighlightPreset(preset.id);
      expect(root.dataset.highlightPreset).toBe(preset.id);

      for (const slot of Object.keys(PREFIXES) as HighlightSlot[]) {
        expect(
          root.style.getPropertyValue(`${PREFIXES[slot]}-accent`),
          `${preset.id} ${slot}`,
        ).toBe(preset.light[slot]);

        // Softer Light alphas at the default 100% intensity.
        const border = alphaOf(root.style.getPropertyValue(`${PREFIXES[slot]}-border`));
        const glow = alphaOf(root.style.getPropertyValue(`${PREFIXES[slot]}-glow`));
        const bg = alphaOf(root.style.getPropertyValue(`${PREFIXES[slot]}-bg`));
        expect(border, `${preset.id} ${slot} border`).toBeGreaterThanOrEqual(0.55);
        expect(border, `${preset.id} ${slot} border`).toBeLessThanOrEqual(0.68);
        expect(glow, `${preset.id} ${slot} glow`).toBeGreaterThanOrEqual(0.24);
        expect(glow, `${preset.id} ${slot} glow`).toBeLessThanOrEqual(0.38);
        expect(bg, `${preset.id} ${slot} tint`).toBeGreaterThanOrEqual(0.08);
        expect(bg, `${preset.id} ${slot} tint`).toBeLessThanOrEqual(0.12);
      }
    }

    // Dark mode is untouched by the Light calibration.
    setSettings({ theme: 'dark' });
    setHighlightPreset('classic');
    expect(root.style.getPropertyValue('--ui-select-accent')).toBe('#3b82f6');
    expect(root.style.getPropertyValue('--role-defender-glow')).toBe('rgba(239, 68, 68, 0.6)');
    expect(alphaOf(root.style.getPropertyValue('--role-attacker-glow'))).toBeCloseTo(0.55);
  });

  it('ITEM-LIGHT-2: all six roles stay mutually distinct in Light mode', () => {
    setSettings({ theme: 'light' });
    render(<HeaderBar />);
    openSubmenu('Theme');

    for (const preset of HIGHLIGHT_PRESETS) {
      fireEvent.click(screen.getByTestId(`highlight-preset-${preset.id}`));
      const preview = screen.getByTestId(`highlight-preset-preview-${preset.id}`);
      const lines = Array.from(preview.querySelectorAll('.highlight-preview-line')) as HTMLElement[];
      expect(lines, preset.id).toHaveLength(6);

      const colors = lines.map((line) => line.style.background || line.style.backgroundColor);
      expect(new Set(colors).size, preset.id).toBe(6);
      // The preview lines show exactly the paler Light palette.
      expect(colors).toEqual(
        [
          preset.light.uiSelect,
          preset.light.attacker,
          preset.light.defender,
          preset.light.trump,
          preset.light.redirect,
          preset.light.clockUrgent,
        ].map(rgbCss),
      );
    }
  });

  it('ITEM-LIGHT-3: the Intensity slider scales Light alphas monotonically', () => {
    setSettings({ theme: 'light' });
    render(<HeaderBar />);
    openSubmenu('Theme');

    const slider = screen.getByTestId('highlight-intensity-slider') as HTMLInputElement;
    const root = document.documentElement;
    const samples = [20, 100, 200].map((value) => {
      fireEvent.input(slider, { target: { value: String(value) } });
      expect(root.style.getPropertyValue('--highlight-intensity')).toBe(String(value / 100));
      return {
        border: alphaOf(root.style.getPropertyValue('--role-defender-border')),
        glow: alphaOf(root.style.getPropertyValue('--role-defender-glow')),
        halo: alphaOf(root.style.getPropertyValue('--role-defender-pulse-halo')),
        tint: alphaOf(root.style.getPropertyValue('--role-attacker-bg')),
        trump: alphaOf(root.style.getPropertyValue('--trump-glow')),
        redirect: alphaOf(root.style.getPropertyValue('--redirect-glow')),
        clock: alphaOf(root.style.getPropertyValue('--clock-urgent-glow')),
      };
    });

    for (let i = 1; i < samples.length; i += 1) {
      for (const key of Object.keys(samples[i]) as Array<keyof (typeof samples)[number]>) {
        expect(samples[i][key], key).toBeGreaterThan(samples[i - 1][key]);
      }
    }

    // At the default 100% the tokens equal the softer Light calibration exactly.
    setHighlightIntensity(100);
    expect(root.style.getPropertyValue('--role-defender-glow')).toBe(
      highlightRgba('#dc6868', LIGHT_SLOT_ALPHA.defender.glow),
    );
    expect(root.style.getPropertyValue('--trump-bg')).toBe(
      highlightRgba('#d4943a', LIGHT_SLOT_ALPHA.trump.bg),
    );
  });
});

/**
 * T-90-feedback-4: the Light page is a darker cool-grey family (never beige)
 * and the header bar is the inverse of Dark — darker than the page, lightening
 * via one continuous gradient that continues past the bar into the page.
 */
function rgbOf(hex: string): { r: number; g: number; b: number } {
  const value = hex.replace('#', '');
  return {
    r: Number.parseInt(value.slice(0, 2), 16),
    g: Number.parseInt(value.slice(2, 4), 16),
    b: Number.parseInt(value.slice(4, 6), 16),
  };
}

function relativeLuminance(hex: string): number {
  const { r, g, b } = rgbOf(hex);
  return (0.2126 * r + 0.7152 * g + 0.0722 * b) / 255;
}

describe('T-90-feedback-4 light page background & inverse header gradient', () => {
  beforeEach(() => {
    resetSettings();
    window.localStorage.clear();
  });

  afterEach(() => {
    resetSettings();
    vi.restoreAllMocks();
  });

  it('repaints the Light page with a darker, cool-grey, non-beige palette', () => {
    const light = cssRule(appCss, "html[data-theme='light']");
    const base = /--bg-base:\s*(#[0-9a-fA-F]{6})/.exec(light)?.[1] ?? '';
    expect(base.toLowerCase()).toBe('#d8dde4');

    // Neutral/cool grey: R <= G <= B, never the old warm beige (R > B).
    const { r, g, b } = rgbOf(base);
    expect(r).toBeLessThanOrEqual(g);
    expect(g).toBeLessThanOrEqual(b);
    // Noticeably darker than the previous bright light theme.
    expect(relativeLuminance(base)).toBeLessThan(relativeLuminance('#f0f0f0'));
    expect(relativeLuminance(base)).toBeLessThan(relativeLuminance('#f4f1ea'));

    // Coordinated grey surfaces, all in the same neutral/cool family.
    for (const token of ['--bg-surface: #e4e8ee', '--bg-elevated: #eceff4', '--bg-panel: #eef1f5']) {
      expect(light).toContain(token);
    }
    expect(cssRule(appCss, ':root')).toContain('--bg-base: #161512');
    expect(cssRule(appCss, 'body')).toContain('background-color: var(--app-bg)');
    expect(cssRule(appCss, '.app')).toContain('--page-top-gradient,');
  });

  it('applies the lightening header gradient in Light, inverse to Dark', () => {
    render(<HeaderBar />);
    openSubmenu('Theme');
    const panel = screen.getByTestId('submenu-theme');

    fireEvent.click(within(panel).getByRole('button', { name: 'Light' }));
    expect(screen.getByRole('banner').getAttribute('data-header-gradient')).toBe('lightening');

    const light = cssRule(appCss, "html[data-theme='light']");
    expect(light).toContain('--header-bg-top: #b8c0cc');
    expect(light).toContain('--header-gradient-mid: #c8cfd9');
    expect(light).toContain('--header-gradient-extent: 160px');
    expect(light).toMatch(/--page-top-gradient:\s*linear-gradient\(/);

    // The header region is darker than the rest-of-page background.
    expect(relativeLuminance('#b8c0cc')).toBeLessThan(relativeLuminance('#d8dde4'));
    expect(relativeLuminance('#c8cfd9')).toBeLessThan(relativeLuminance('#d8dde4'));

    // The bar paints no lighter opaque strip and no hard border, so the same
    // gradient continues through and a little way below it into the page.
    expect(
      cssRule(appCss, ".site-header[data-header-gradient='lightening']"),
    ).toContain('background: transparent');
    expect(cssRule(appCss, "html[data-theme='light'] .site-header")).toContain(
      'border-bottom-color: transparent',
    );

    fireEvent.click(within(panel).getByRole('button', { name: 'Dark' }));
    expect(screen.getByRole('banner').getAttribute('data-header-gradient')).toBe('darkening');
  });
});

/**
 * T-90-2 ITEM-1b / ITEM-4: the palette slider is labelled `Glow` and its live
 * value reaches the player-box / PLAYERS-row aura token.
 */
describe('T-90-2 Glow slider label and live scale', () => {
  afterEach(() => {
    resetSettings();
  });

  it('ITEM-1b/4: labels the slider Glow inside Palettes and updates the scale token', () => {
    render(<HeaderBar />);
    openSubmenu('Theme');

    const section = screen.getByTestId('theme-highlights-section');
    expect(section.textContent).toContain('Palettes');
    expect(section.textContent).toContain('Glow');
    expect(section.textContent).not.toContain('Intensity');

    const slider = screen.getByTestId('highlight-intensity-slider') as HTMLInputElement;
    fireEvent.input(slider, { target: { value: '200' } });
    expect(document.documentElement.style.getPropertyValue('--highlight-intensity-scale')).toBe('2');
    expect(document.documentElement.style.getPropertyValue('--highlight-intensity')).toBe('2');

    fireEvent.input(slider, { target: { value: '20' } });
    expect(document.documentElement.style.getPropertyValue('--highlight-intensity-scale')).toBe('0.2');

    fireEvent.input(slider, { target: { value: '100' } });
    expect(document.documentElement.style.getPropertyValue('--highlight-intensity-scale')).toBe('1');
  });
});
