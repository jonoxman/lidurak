import { describe, expect, it } from 'vitest';
import {
  DEFAULT_TABLE_FILTERS,
  DEFAULT_TABLE_TEXTURE_ID,
  TABLE_TEXTURES,
  isTableTextureId,
  tableTexture,
  tableTextureStyle,
  textureFilter,
} from '../styles/tableTextures';

describe('table textures', () => {
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
});
