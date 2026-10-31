import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, within } from '@testing-library/preact';
import { HeaderBar, NAV_MENUS, PROFILE_ITEMS, connectionLevel } from '../components/HeaderBar';
import { CardBack } from '../components/CardBack';
import { soundEngine } from '../audio/SoundEngine';
import {
  clampRoundness,
  getSettings,
  resetSettings,
  resolveTheme,
  setSettings,
  subscribeSettings,
} from '../state/settings';

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

  it('renders the LIDURAK home logo and the four navigation menus', () => {
    render(<HeaderBar />);

    const logo = screen.getByRole('link', { name: 'LIDURAK' });
    expect(logo.getAttribute('href')).toBe('#/');
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

  it('shows ping, server delay and a four-bar connection indicator', () => {
    render(<HeaderBar pingMs={42} serverDelayMs={9} />);
    openProfile();

    expect(screen.getByText('Ping: 42 ms')).toBeTruthy();
    expect(screen.getByText('Server Delay: 9 ms')).toBeTruthy();
    const bars = screen.getByRole('img', { name: 'Connection strength: 4 of 4' });
    expect(bars.querySelectorAll('.signal-bar')).toHaveLength(4);
    expect(bars.querySelectorAll('.signal-bar[data-active="true"]')).toHaveLength(4);
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

  it('controls volume and the five sound packs from the Sound submenu', () => {
    render(<HeaderBar />);
    openSubmenu('Sound');

    const panel = screen.getByTestId('submenu-sound');
    const slider = within(panel).getByLabelText('Master volume') as HTMLInputElement;
    expect(Number(slider.value)).toBeCloseTo(0.7);

    fireEvent.input(slider, { target: { value: '0.25' } });
    expect(soundEngine.getVolume()).toBeCloseTo(0.25);

    expect(within(panel).getAllByRole('button').map((button) => button.textContent)).toEqual([
      'Classic Felt',
      'Arcade 8-Bit',
      'Sci-Fi Synth',
      'Acoustic Pluck',
      'Modern Minimal',
    ]);

    fireEvent.click(within(panel).getByRole('button', { name: 'Arcade 8-Bit' }));

    expect(soundEngine.getSoundPack()).toBe('arcade-8bit');
    expect(
      within(panel).getByRole('button', { name: 'Arcade 8-Bit' }).getAttribute('aria-pressed'),
    ).toBe('true');
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

  it('selects a table texture and adjusts the felt filters live', () => {
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

    fireEvent.input(within(panel).getByLabelText('Brightness'), { target: { value: '1.2' } });
    fireEvent.input(within(panel).getByLabelText('Contrast'), { target: { value: '0.8' } });
    fireEvent.input(within(panel).getByLabelText('Hue'), { target: { value: '25' } });

    expect(getSettings().tableFilters).toEqual({ brightness: 1.2, contrast: 0.8, hue: 25 });
    expect(document.documentElement.style.getPropertyValue('--table-filter')).toBe(
      'brightness(1.2) contrast(0.8) hue-rotate(25deg)',
    );
  });

  it('selects one of the six card back patterns', () => {
    render(<HeaderBar />);
    openSubmenu('Card Back');

    const panel = screen.getByTestId('submenu-cardback');
    const options = within(panel).getAllByRole('button');
    expect(options).toHaveLength(6);
    expect(options[0].getAttribute('aria-pressed')).toBe('true');
    expect(panel.querySelectorAll('svg.card-back')).toHaveLength(6);

    fireEvent.click(within(panel).getByRole('button', { name: 'royal-diamond' }));

    expect(getSettings().cardBack).toBe('royal-diamond');
    expect(document.documentElement.getAttribute('data-card-back')).toBe('royal-diamond');
    expect(
      within(panel).getByRole('button', { name: 'royal-diamond' }).getAttribute('aria-pressed'),
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
