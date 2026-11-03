import { afterEach, describe, expect, it } from 'vitest';
import {
  DARK_MODE_BRIGHTNESS_FACTOR,
  DEFAULT_TABLE_BRIGHTNESS,
  DEFAULT_TABLE_FILTERS,
  DEFAULT_TABLE_TEXTURE_ID,
  LIGHT_MODE_BRIGHTNESS_FACTOR,
  TABLE_BRIGHTNESS_SLIDER_MAX,
  TABLE_BRIGHTNESS_SLIDER_MIN,
  TABLE_TEXTURES,
  absoluteTableBrightness,
  getTableFilterCss,
  getTableTextureStyle,
  isTableTextureId,
  resolveTableTheme,
  tableBrightnessFromPercent,
  tableBrightnessPercent,
  tableTexture,
  tableTexturePalette,
  tableTextureStyle,
  tableThemeBrightnessFactor,
  textureFilter,
} from '../styles/tableTextures';

/** Splits a CSS `background-image` value into its top-level layers. */
const backgroundLayers = (image: string): string[] => {
  const layers: string[] = [];
  let depth = 0;
  let current = '';

  for (const char of image) {
    if (char === '(') depth += 1;
    if (char === ')') depth -= 1;
    if (char === ',' && depth === 0) {
      layers.push(current.trim());
      current = '';
      continue;
    }
    current += char;
  }
  if (current.trim()) layers.push(current.trim());
  return layers;
};

/** A layer with its colour stops removed, leaving only its texture geometry. */
const layerGeometry = (layer: string): string =>
  layer.replace(/rgba?\([^)]*\)|#[0-9a-fA-F]{3,8}|\btransparent\b/g, 'COLOR');

/** Rough perceived lightness of a `#rrggbb` colour, 0 (black) to 1 (white). */
const luminance = (hex: string): number => {
  const value = hex.replace('#', '');
  const channels = [0, 2, 4].map((offset) => parseInt(value.slice(offset, offset + 2), 16) / 255);
  return channels.reduce((sum, channel) => sum + channel, 0) / channels.length;
};

/** WCAG relative luminance, used to compare rendered surfaces across themes. */
const relativeLuminance = (hex: string): number => {
  const value = hex.replace('#', '');
  const channels = [0, 2, 4].map((offset) => parseInt(value.slice(offset, offset + 2), 16) / 255);
  const linear = (channel: number) =>
    channel <= 0.03928 ? channel / 12.92 : ((channel + 0.055) / 1.055) ** 2.4;
  return 0.2126 * linear(channels[0]) + 0.7152 * linear(channels[1]) + 0.0722 * linear(channels[2]);
};

/** Brightness a preset actually renders at once its theme calibration lands. */
const effectiveLuminance = (preset: (typeof TABLE_TEXTURES)[number], theme: 'dark' | 'light') =>
  relativeLuminance(theme === 'light' ? preset.lightBase : preset.base) *
  absoluteTableBrightness({}, theme);

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
    // The default slider (100%) is calibrated per theme: dark 1.10, light 0.90.
    expect(textureFilter()).toBe('brightness(1.1) contrast(1) hue-rotate(0deg)');
    expect(textureFilter({}, 'dark')).toBe('brightness(1.1) contrast(1) hue-rotate(0deg)');
    expect(textureFilter({}, 'light')).toBe('brightness(0.9) contrast(1) hue-rotate(0deg)');
    expect(textureFilter({ brightness: 1.1, contrast: 0.9, hue: 25 }, 'dark')).toBe(
      'brightness(1.21) contrast(0.9) hue-rotate(25deg)',
    );
    expect(textureFilter({ brightness: 1.25, contrast: 1.05, hue: -30 }, 'light')).toBe(
      'brightness(1.125) contrast(1.05) hue-rotate(-30deg)',
    );
  });

  it('clamps filter settings to readable ranges', () => {
    expect(textureFilter({ brightness: 9, contrast: -1, hue: 400 }, 'dark')).toBe(
      'brightness(2) contrast(0) hue-rotate(180deg)',
    );
    expect(textureFilter({ brightness: Number.NaN }, 'dark')).toBe(
      'brightness(1.1) contrast(1) hue-rotate(0deg)',
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
    expect(style['--table-brightness']).toBe('1.32');
    expect(style['--table-slider-brightness']).toBe('1.2');
    expect(style['--table-theme-brightness-factor']).toBe('1.1');
    expect(style['--table-contrast']).toBe('0.95');
    expect(style['--table-hue']).toBe('-10deg');
    expect(style['--table-filter']).toBe('brightness(1.32) contrast(0.95) hue-rotate(-10deg)');
  });

  it('uses neutral defaults when no filters are supplied', () => {
    const style = tableTextureStyle('forest-moss');

    expect(style['--table-slider-brightness']).toBe(String(DEFAULT_TABLE_FILTERS.brightness));
    expect(style['--table-brightness']).toBe('1.1');
    expect(style['--table-contrast']).toBe(String(DEFAULT_TABLE_FILTERS.contrast));
    expect(style['--table-hue']).toBe(`${DEFAULT_TABLE_FILTERS.hue}deg`);
    expect(style['--table-filter']).toBe('brightness(1.1) contrast(1) hue-rotate(0deg)');
  });

  it('exposes the same filter string through getTableFilterCss', () => {
    expect(getTableFilterCss()).toBe('brightness(1.1) contrast(1) hue-rotate(0deg)');
    expect(getTableFilterCss({ brightness: 1.2, contrast: 0.9, hue: -15 }, 'dark')).toBe(
      'brightness(1.32) contrast(0.9) hue-rotate(-15deg)',
    );
    expect(getTableFilterCss({ brightness: 1.2, contrast: 0.9, hue: -15 }, 'dark')).toBe(
      textureFilter({ brightness: 1.2, contrast: 0.9, hue: -15 }, 'dark'),
    );
    expect(getTableFilterCss({ brightness: 1.2, contrast: 0.9, hue: -15 }, 'light')).toBe(
      'brightness(1.08) contrast(0.9) hue-rotate(-15deg)',
    );
    expect(getTableFilterCss({ brightness: 5 }, 'dark')).toBe(
      'brightness(2) contrast(1) hue-rotate(0deg)',
    );
  });

  it('builds a felt style straight from a settings snapshot', () => {
    const defaults = getTableTextureStyle();
    expect(defaults.backgroundColor).toBe('#123f2b');
    expect(defaults['--table-filter']).toBe('brightness(1.1) contrast(1) hue-rotate(0deg)');

    const custom = getTableTextureStyle({
      tableTexture: 'vintage-oak',
      tableFilters: { brightness: 1.4, contrast: 1.1, hue: 40 },
    });
    expect(custom.backgroundColor).toBe('#3a2b1c');
    expect(custom['--table-slider-brightness']).toBe('1.4');
    expect(custom['--table-brightness']).toBe('1.54');
    expect(custom['--table-filter']).toBe('brightness(1.54) contrast(1.1) hue-rotate(40deg)');

    const light = getTableTextureStyle({
      tableTexture: 'vintage-oak',
      tableFilters: { brightness: 1.4, contrast: 1.1, hue: 40 },
      theme: 'light',
    });
    expect(light['--table-theme-brightness-factor']).toBe('0.9');
    expect(light['--table-brightness']).toBe('1.26');

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
    expect(light.backgroundImage).toBe(tableTexture('midnight-navy').lightOverlay);
    expect(light['--table-felt']).toBe('#b8cce4');
    expect(light['--table-felt-border-light']).toBe('#8ea9ca');
    expect(light['--table-theme']).toBe('light');
    // Both palettes ride along, so CSS can switch without a re-render.
    expect(dark['--table-felt-light']).toBe('#b8cce4');
    expect(dark['--table-felt-overlay-light']).toBe(light['--table-felt-overlay']);
    // The filter is theme-calibrated: dark 1.10 vs light 0.90 at slider 100%.
    expect(light['--table-filter']).toBe('brightness(0.9) contrast(1) hue-rotate(0deg)');
    expect(dark['--table-filter']).toBe('brightness(1.1) contrast(1) hue-rotate(0deg)');

    expect(
      getTableTextureStyle({ tableTexture: 'vintage-oak', theme: 'light' }).backgroundColor,
    ).toBe('#dcc7a8');
    expect(getTableTextureStyle({ tableTexture: 'vintage-oak' }).backgroundColor).toBe('#3a2b1c');
  });

  it('keeps the light felt on the exact same texture geometry as the dark felt', () => {
    for (const preset of TABLE_TEXTURES) {
      const dark = backgroundLayers(preset.overlay);
      const light = backgroundLayers(preset.lightOverlay);

      // Same number of layers, in the same order…
      expect(light, preset.id).toHaveLength(dark.length);
      // …with identical gradient types, angles, positions and pattern stops.
      expect(light.map(layerGeometry), preset.id).toEqual(dark.map(layerGeometry));
      // The light version is a different palette, not the same overlay repeated.
      expect(preset.lightOverlay, preset.id).not.toBe(preset.overlay);
      expect(preset.lightOverlay, preset.id).not.toContain(preset.lightBase);
    }
  });

  it('paints every light overlay layer with a visible tint', () => {
    for (const preset of TABLE_TEXTURES) {
      const layers = backgroundLayers(preset.lightOverlay);
      const tinted = layers.filter((layer) => /rgba\(0, 0, 0|rgba\(\d+, \d+, \d+, 0\.[1-9]/.test(layer));

      // Every layer carries real ink (a dark/white tint or a highlight), never
      // a flat transparent wash that would hide the grain.
      expect(tinted.length, preset.id).toBeGreaterThan(0);
      for (const layer of layers) {
        expect(layerGeometry(layer), preset.id).toContain('COLOR');
      }
      expect(luminance(preset.lightBase), preset.id).toBeGreaterThan(0.6);
    }
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

describe('theme-calibrated absolute table brightness (ITEM-PB-4)', () => {
  afterEach(() => {
    document.documentElement.removeAttribute('data-theme');
  });

  it('keeps the brightness slider at its 100% default position', () => {
    expect(DEFAULT_TABLE_BRIGHTNESS).toBe(100);
    // The stored slider multiplier is unchanged: `1` is `100%`.
    expect(DEFAULT_TABLE_FILTERS.brightness).toBe(1);
    expect(tableBrightnessPercent()).toBe(100);
    expect(tableBrightnessPercent(DEFAULT_TABLE_FILTERS.brightness)).toBe(100);
    expect(tableBrightnessFromPercent(DEFAULT_TABLE_BRIGHTNESS)).toBe(1);

    // Dragging the slider maps percent onto the multiplier one to one and is
    // bounded to the 50–150 range the control exposes.
    expect(tableBrightnessFromPercent(TABLE_BRIGHTNESS_SLIDER_MIN)).toBe(0.5);
    expect(tableBrightnessFromPercent(TABLE_BRIGHTNESS_SLIDER_MAX)).toBe(1.5);
    expect(tableBrightnessPercent(0.5)).toBe(50);
    expect(tableBrightnessPercent(1.5)).toBe(150);
    expect(tableBrightnessFromPercent(10)).toBe(0.5);
    expect(tableBrightnessFromPercent(900)).toBe(1.5);
  });

  it('renders dark mode slightly lighter and light mode slightly darker at the default slider', () => {
    expect(DARK_MODE_BRIGHTNESS_FACTOR).toBeGreaterThan(1);
    expect(LIGHT_MODE_BRIGHTNESS_FACTOR).toBeLessThan(1);
    expect(tableThemeBrightnessFactor('dark')).toBe(DARK_MODE_BRIGHTNESS_FACTOR);
    expect(tableThemeBrightnessFactor('light')).toBe(LIGHT_MODE_BRIGHTNESS_FACTOR);

    // The slider itself never moves: 100% in both themes, only the absolute
    // brightness underneath it is calibrated.
    expect(absoluteTableBrightness({}, 'dark')).toBe(1.1);
    expect(absoluteTableBrightness({}, 'light')).toBe(0.9);
    expect(
      absoluteTableBrightness({ brightness: DEFAULT_TABLE_FILTERS.brightness }, 'dark'),
    ).toBe(1.1);
    expect(
      absoluteTableBrightness({ brightness: DEFAULT_TABLE_FILTERS.brightness }, 'light'),
    ).toBe(0.9);

    // Proportional scaling across the slider's 50–150 range.
    for (const percent of [50, 75, 100, 125, 150]) {
      const brightness = tableBrightnessFromPercent(percent);
      expect(absoluteTableBrightness({ brightness }, 'dark'), `${percent}% dark`).toBeCloseTo(
        (percent / 100) * DARK_MODE_BRIGHTNESS_FACTOR,
        5,
      );
      expect(absoluteTableBrightness({ brightness }, 'light'), `${percent}% light`).toBeCloseTo(
        (percent / 100) * LIGHT_MODE_BRIGHTNESS_FACTOR,
        5,
      );
    }

    // The emitted style and filter carry the calibrated value, so the live
    // arena, the header swatches and the settings store stay in sync.
    const dark = getTableTextureStyle({ tableTexture: 'emerald-felt', theme: 'dark' });
    expect(dark['--table-slider-brightness']).toBe('1');
    expect(dark['--table-brightness']).toBe('1.1');
    expect(dark['--table-filter']).toBe('brightness(1.1) contrast(1) hue-rotate(0deg)');

    const light = getTableTextureStyle({ tableTexture: 'emerald-felt', theme: 'light' });
    expect(light['--table-slider-brightness']).toBe('1');
    expect(light['--table-brightness']).toBe('0.9');
    expect(light['--table-filter']).toBe('brightness(0.9) contrast(1) hue-rotate(0deg)');
  });

  it('keeps every preset distinctly darker in dark mode than in light mode', () => {
    for (const preset of TABLE_TEXTURES) {
      const darkBase = relativeLuminance(preset.base);
      const lightBase = relativeLuminance(preset.lightBase);
      const darkEffective = effectiveLuminance(preset, 'dark');
      const lightEffective = effectiveLuminance(preset, 'light');

      // The palettes still order light above dark before calibration…
      expect(lightBase, preset.id).toBeGreaterThan(darkBase);
      // …dark mode renders slightly lighter than its unadjusted baseline…
      expect(darkEffective, preset.id).toBeGreaterThan(darkBase);
      // …light mode renders slightly darker than its unadjusted baseline…
      expect(lightEffective, preset.id).toBeLessThan(lightBase);
      // …and the calibrated dark surface is still clearly the darker one.
      expect(darkEffective, preset.id).toBeLessThan(lightEffective - 0.1);

      // Every preset emits its calibrated filter in both themes.
      expect(
        getTableTextureStyle({ tableTexture: preset.id, theme: 'dark' })['--table-filter'],
        preset.id,
      ).toContain(`brightness(${DARK_MODE_BRIGHTNESS_FACTOR})`);
      expect(
        getTableTextureStyle({ tableTexture: preset.id, theme: 'light' })['--table-filter'],
        preset.id,
      ).toContain(`brightness(${LIGHT_MODE_BRIGHTNESS_FACTOR})`);
    }
  });
});
