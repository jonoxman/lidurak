import { afterEach, describe, expect, it } from 'vitest';
import {
  DEFAULT_TABLE_FILTERS,
  DEFAULT_TABLE_TEXTURE_ID,
  TABLE_TEXTURES,
  getTableFilterCss,
  getTableTextureStyle,
  isTableTextureId,
  resolveTableTheme,
  tableTexture,
  tableTexturePalette,
  tableTextureStyle,
  textureFilter,
} from '../styles/tableTextures';

/** Rough perceived lightness of a `#rrggbb` colour, 0 (black) to 1 (white). */
const luminance = (hex: string): number => {
  const value = hex.replace('#', '');
  const channels = [0, 2, 4].map((offset) => parseInt(value.slice(offset, offset + 2), 16) / 255);
  return channels.reduce((sum, channel) => sum + channel, 0) / channels.length;
};

describe('table textures', () => {
  afterEach(() => {
    document.documentElement.removeAttribute('data-theme');
  });

  it('defines six distinct felt presets', () => {
    expect(TABLE_TEXTURES).toHaveLength(6);
    expect(new Set(TABLE_TEXTURES.map((preset) => preset.id)).size).toBe(6);
    expect(TABLE_TEXTURES.map((preset) => preset.id)).toEqual([
      'emerald-felt',
      'midnight-navy',
      'burgundy-velvet',
      'charcoal-slate',
      'forest-moss',
      'vintage-oak',
    ]);
    expect(TABLE_TEXTURES.map((preset) => preset.name)).toEqual([
      'Emerald Felt',
      'Midnight Navy',
      'Burgundy Velvet',
      'Charcoal Slate',
      'Forest Moss',
      'Vintage Oak',
    ]);
    expect(TABLE_TEXTURES.every((preset) => preset.base.startsWith('#'))).toBe(true);
    expect(TABLE_TEXTURES.every((preset) => preset.overlay.length > 0)).toBe(true);
  });

  it('defaults to the emerald felt preset', () => {
    expect(DEFAULT_TABLE_TEXTURE_ID).toBe('emerald-felt');
    expect(tableTexture('emerald-felt').base).toBe('#123f2b');
  });

  it('falls back to the default preset for an unknown id', () => {
    expect(tableTexture('lava-lamp').id).toBe('emerald-felt');
    expect(isTableTextureId('lava-lamp')).toBe(false);
    expect(isTableTextureId('vintage-oak')).toBe(true);
  });

  it('builds a brightness/contrast/hue filter string', () => {
    expect(textureFilter()).toBe('brightness(1) contrast(1) hue-rotate(0deg)');
    expect(textureFilter({ brightness: 1.1, contrast: 0.9, hue: 25 })).toBe(
      'brightness(1.1) contrast(0.9) hue-rotate(25deg)',
    );
    expect(textureFilter({ brightness: 1.25, contrast: 1.05, hue: -30 })).toBe(
      'brightness(1.25) contrast(1.05) hue-rotate(-30deg)',
    );
  });

  it('clamps filter settings to readable ranges', () => {
    expect(textureFilter({ brightness: 9, contrast: -1, hue: 400 })).toBe(
      'brightness(2) contrast(0) hue-rotate(180deg)',
    );
    expect(textureFilter({ brightness: Number.NaN })).toBe(
      'brightness(1) contrast(1) hue-rotate(0deg)',
    );
  });

  it('returns the preset colours and CSS variables in one style object', () => {
    const style = tableTextureStyle('midnight-navy', {
      brightness: 1.2,
      contrast: 0.95,
      hue: -10,
    });

    expect(style.backgroundColor).toBe('#16203a');
    expect(style.backgroundImage).toContain('repeating-linear-gradient');
    expect(style['--table-felt']).toBe('#16203a');
    expect(style['--table-brightness']).toBe('1.2');
    expect(style['--table-contrast']).toBe('0.95');
    expect(style['--table-hue']).toBe('-10deg');
    expect(style['--table-filter']).toBe('brightness(1.2) contrast(0.95) hue-rotate(-10deg)');
  });

  it('uses neutral defaults when no filters are supplied', () => {
    const style = tableTextureStyle('forest-moss');

    expect(style['--table-brightness']).toBe(String(DEFAULT_TABLE_FILTERS.brightness));
    expect(style['--table-contrast']).toBe(String(DEFAULT_TABLE_FILTERS.contrast));
    expect(style['--table-hue']).toBe(`${DEFAULT_TABLE_FILTERS.hue}deg`);
    expect(style['--table-filter']).toBe('brightness(1) contrast(1) hue-rotate(0deg)');
  });

  it('exposes the same filter string through getTableFilterCss', () => {
    expect(getTableFilterCss()).toBe('brightness(1) contrast(1) hue-rotate(0deg)');
    expect(getTableFilterCss({ brightness: 1.2, contrast: 0.9, hue: -15 })).toBe(
      'brightness(1.2) contrast(0.9) hue-rotate(-15deg)',
    );
    expect(getTableFilterCss({ brightness: 1.2, contrast: 0.9, hue: -15 })).toBe(
      textureFilter({ brightness: 1.2, contrast: 0.9, hue: -15 }),
    );
    expect(getTableFilterCss({ brightness: 5 })).toBe(
      'brightness(2) contrast(1) hue-rotate(0deg)',
    );
  });

  it('builds a felt style straight from a settings snapshot', () => {
    const defaults = getTableTextureStyle();
    expect(defaults.backgroundColor).toBe('#123f2b');
    expect(defaults['--table-filter']).toBe('brightness(1) contrast(1) hue-rotate(0deg)');

    const custom = getTableTextureStyle({
      tableTexture: 'vintage-oak',
      tableFilters: { brightness: 1.4, contrast: 1.1, hue: 40 },
    });
    expect(custom.backgroundColor).toBe('#3a2b1c');
    expect(custom['--table-brightness']).toBe('1.4');
    expect(custom['--table-filter']).toBe('brightness(1.4) contrast(1.1) hue-rotate(40deg)');

    expect(getTableTextureStyle({ tableTexture: 'lava-lamp' }).backgroundColor).toBe('#123f2b');
  });

  it('gives every preset a paler light-theme palette', () => {
    for (const preset of TABLE_TEXTURES) {
      expect(preset.lightBase, preset.id).toMatch(/^#[0-9a-f]{6}$/);
      expect(preset.lightBorder, preset.id).toMatch(/^#[0-9a-f]{6}$/);
      expect(preset.lightOverlay.length, preset.id).toBeGreaterThan(0);
      expect(preset.lightBase, preset.id).not.toBe(preset.base);
      expect(preset.lightOverlay, preset.id).not.toBe(preset.overlay);
      // Genuinely pale, not just a different dark colour.
      expect(luminance(preset.lightBase), preset.id).toBeGreaterThan(
        luminance(preset.base) + 0.35,
      );
    }

    const emerald = tableTexture('emerald-felt');
    expect(tableTexturePalette(emerald)).toEqual({
      base: emerald.base,
      overlay: emerald.overlay,
    });
    expect(tableTexturePalette(emerald, 'light')).toEqual({
      base: '#b5d6c5',
      overlay: emerald.lightOverlay,
      border: '#8cb8a2',
    });
  });

  it('switches palettes through tableTextureStyle and getTableTextureStyle', () => {
    const dark = tableTextureStyle('midnight-navy');
    const light = tableTextureStyle('midnight-navy', {}, 'light');

    expect(dark.backgroundColor).toBe('#16203a');
    expect(dark['--table-theme']).toBe('dark');
    expect(light.backgroundColor).toBe('#b8cce4');
    expect(light.backgroundImage).toContain('#d8e4f2');
    expect(light['--table-felt']).toBe('#b8cce4');
    expect(light['--table-felt-border-light']).toBe('#8ea9ca');
    expect(light['--table-theme']).toBe('light');
    // Both palettes ride along, so CSS can switch without a re-render.
    expect(dark['--table-felt-light']).toBe('#b8cce4');
    expect(dark['--table-felt-overlay-light']).toBe(light['--table-felt-overlay']);
    // Filters are theme independent.
    expect(light['--table-filter']).toBe('brightness(1) contrast(1) hue-rotate(0deg)');

    expect(
      getTableTextureStyle({ tableTexture: 'vintage-oak', theme: 'light' }).backgroundColor,
    ).toBe('#dcc7a8');
    expect(getTableTextureStyle({ tableTexture: 'vintage-oak' }).backgroundColor).toBe('#3a2b1c');
  });

  it('follows the applied data-theme when no theme is passed', () => {
    document.documentElement.setAttribute('data-theme', 'light');

    expect(resolveTableTheme()).toBe('light');
    expect(getTableTextureStyle({ tableTexture: 'emerald-felt' }).backgroundColor).toBe('#b5d6c5');

    document.documentElement.setAttribute('data-theme', 'dark');

    expect(resolveTableTheme()).toBe('dark');
    expect(getTableTextureStyle({ tableTexture: 'emerald-felt' }).backgroundColor).toBe('#123f2b');

    // `device` resolves through the same document theme, never the OS here.
    expect(resolveTableTheme('device')).toBe('dark');
    const lightRoot = document.createElement('div');
    lightRoot.setAttribute('data-theme', 'light');
    expect(resolveTableTheme('device', lightRoot)).toBe('light');
    expect(resolveTableTheme('light', lightRoot)).toBe('light');
    expect(resolveTableTheme('dark', lightRoot)).toBe('dark');
  });
});
