/**
 * Table felt texture presets and the brightness/contrast/hue filter controls
 * that sit on top of them. Everything is plain CSS: a preset supplies the base
 * felt colour and a layered overlay, and the filter settings drive the
 * `--table-*` custom properties consumed by `table.css`.
 */

export type TableTextureId =
  | 'emerald-felt'
  | 'midnight-navy'
  | 'burgundy-velvet'
  | 'charcoal-slate'
  | 'forest-moss'
  | 'vintage-oak';

export interface TableTexturePreset {
  id: TableTextureId;
  name: string;
  /** Base felt colour. */
  base: string;
  /** Layered CSS `background-image` overlay that gives the surface its grain. */
  overlay: string;
}

export interface TableFilterSettings {
  /** Multiplier, `1` is unchanged. */
  brightness: number;
  /** Multiplier, `1` is unchanged. */
  contrast: number;
  /** Rotation in degrees, `0` is unchanged. */
  hue: number;
}

export const TABLE_TEXTURES: readonly TableTexturePreset[] = [
  {
    id: 'emerald-felt',
    name: 'Emerald Felt',
    base: '#123f2b',
    overlay:
      'repeating-linear-gradient(45deg, rgba(255, 255, 255, 0.035) 0 2px, transparent 2px 7px), radial-gradient(circle at 50% 30%, rgba(255, 255, 255, 0.06), transparent 65%)',
  },
  {
    id: 'midnight-navy',
    name: 'Midnight Navy',
    base: '#16203a',
    overlay:
      'repeating-linear-gradient(135deg, rgba(255, 255, 255, 0.03) 0 2px, transparent 2px 8px), radial-gradient(circle at 50% 25%, rgba(140, 170, 255, 0.08), transparent 70%)',
  },
  {
    id: 'burgundy-velvet',
    name: 'Burgundy Velvet',
    base: '#3a1620',
    overlay:
      'radial-gradient(ellipse at 50% 20%, rgba(255, 170, 170, 0.09), transparent 60%), repeating-radial-gradient(circle at 50% 50%, rgba(0, 0, 0, 0.06) 0 3px, transparent 3px 9px)',
  },
  {
    id: 'charcoal-slate',
    name: 'Charcoal Slate',
    base: '#232629',
    overlay:
      'repeating-linear-gradient(90deg, rgba(255, 255, 255, 0.025) 0 1px, transparent 1px 9px), radial-gradient(circle at 50% 30%, rgba(255, 255, 255, 0.05), transparent 70%)',
  },
  {
    id: 'forest-moss',
    name: 'Forest Moss',
    base: '#243222',
    overlay:
      'radial-gradient(circle at 20% 30%, rgba(150, 190, 120, 0.07), transparent 55%), radial-gradient(circle at 80% 70%, rgba(120, 160, 100, 0.06), transparent 60%)',
  },
  {
    id: 'vintage-oak',
    name: 'Vintage Oak',
    base: '#3a2b1c',
    overlay:
      'repeating-linear-gradient(90deg, rgba(0, 0, 0, 0.14) 0 3px, transparent 3px 11px), repeating-linear-gradient(88deg, rgba(255, 220, 160, 0.05) 0 2px, transparent 2px 26px)',
  },
];

export const DEFAULT_TABLE_TEXTURE_ID: TableTextureId = 'emerald-felt';

export const DEFAULT_TABLE_FILTERS: TableFilterSettings = {
  brightness: 1,
  contrast: 1,
  hue: 0,
};

/** Filter limits that keep the felt readable instead of washing it out. */
const LIMITS = {
  brightness: { min: 0.2, max: 2 },
  contrast: { min: 0, max: 2 },
  hue: { min: -180, max: 180 },
};

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

function setting(value: number | undefined, fallback: number, min: number, max: number): number {
  if (value === undefined || !Number.isFinite(value)) return fallback;
  return clamp(value, min, max);
}

/** CSS `filter` string for the felt: brightness, contrast and hue rotation. */
export function textureFilter(filters: Partial<TableFilterSettings> = {}): string {
  const brightness = setting(filters.brightness, DEFAULT_TABLE_FILTERS.brightness, LIMITS.brightness.min, LIMITS.brightness.max);
  const contrast = setting(filters.contrast, DEFAULT_TABLE_FILTERS.contrast, LIMITS.contrast.min, LIMITS.contrast.max);
  const hue = setting(filters.hue, DEFAULT_TABLE_FILTERS.hue, LIMITS.hue.min, LIMITS.hue.max);
  return `brightness(${brightness}) contrast(${contrast}) hue-rotate(${hue}deg)`;
}

export function isTableTextureId(id: string): id is TableTextureId {
  return TABLE_TEXTURES.some((preset) => preset.id === id);
}

export function tableTexture(id: string): TableTexturePreset {
  return (
    TABLE_TEXTURES.find((preset) => preset.id === id) ??
    TABLE_TEXTURES.find((preset) => preset.id === DEFAULT_TABLE_TEXTURE_ID)!
  );
}

/**
 * Inline style for the arena: the preset's felt colours plus the `--table-*`
 * custom properties the CSS filter classes read.
 */
export function tableTextureStyle(
  id: string,
  filters: Partial<TableFilterSettings> = {},
): Record<string, string> {
  const preset = tableTexture(id);
  const brightness = setting(filters.brightness, DEFAULT_TABLE_FILTERS.brightness, LIMITS.brightness.min, LIMITS.brightness.max);
  const contrast = setting(filters.contrast, DEFAULT_TABLE_FILTERS.contrast, LIMITS.contrast.min, LIMITS.contrast.max);
  const hue = setting(filters.hue, DEFAULT_TABLE_FILTERS.hue, LIMITS.hue.min, LIMITS.hue.max);

  return {
    backgroundColor: preset.base,
    backgroundImage: preset.overlay,
    '--table-felt': preset.base,
    '--table-felt-overlay': preset.overlay,
    '--table-brightness': String(brightness),
    '--table-contrast': String(contrast),
    '--table-hue': `${hue}deg`,
    '--table-filter': textureFilter(filters),
  };
}
