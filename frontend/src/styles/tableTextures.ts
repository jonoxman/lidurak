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

export type TableTheme = 'dark' | 'light';

export interface TableTexturePreset {
  id: TableTextureId;
  name: string;
  /** Base felt colour in the dark theme. */
  base: string;
  /** Layered CSS `background-image` overlay that gives the surface its grain. */
  overlay: string;
  /** Pale felt base used while the light theme is active. */
  lightBase: string;
  /** Pale grain overlay for the light theme. */
  lightOverlay: string;
  /** Harmonious frame/border colour for the light-theme felt. */
  lightBorder: string;
}

export interface TableTexturePalette {
  base: string;
  overlay: string;
  /** Light-theme frame colour; the dark theme keeps its transparent frame. */
  border?: string;
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
    lightBase: '#b5d6c5',
    lightOverlay:
      'radial-gradient(circle at 50% 30%, #d6eadf, #b5d6c5 70%), repeating-linear-gradient(45deg, rgba(255, 255, 255, 0.45) 0 2px, transparent 2px 7px)',
    lightBorder: '#8cb8a2',
  },
  {
    id: 'midnight-navy',
    name: 'Midnight Navy',
    base: '#16203a',
    overlay:
      'repeating-linear-gradient(135deg, rgba(255, 255, 255, 0.03) 0 2px, transparent 2px 8px), radial-gradient(circle at 50% 25%, rgba(140, 170, 255, 0.08), transparent 70%)',
    lightBase: '#b8cce4',
    lightOverlay:
      'radial-gradient(circle at 50% 25%, #d8e4f2, #b8cce4 70%), repeating-linear-gradient(135deg, rgba(255, 255, 255, 0.4) 0 2px, transparent 2px 8px)',
    lightBorder: '#8ea9ca',
  },
  {
    id: 'burgundy-velvet',
    name: 'Burgundy Velvet',
    base: '#3a1620',
    overlay:
      'radial-gradient(ellipse at 50% 20%, rgba(255, 170, 170, 0.09), transparent 60%), repeating-radial-gradient(circle at 50% 50%, rgba(0, 0, 0, 0.06) 0 3px, transparent 3px 9px)',
    lightBase: '#dcb6c2',
    lightOverlay:
      'radial-gradient(ellipse at 50% 20%, #f0d8df, #dcb6c2 65%), repeating-radial-gradient(circle at 50% 50%, rgba(120, 60, 80, 0.06) 0 3px, transparent 3px 9px)',
    lightBorder: '#be8e9d',
  },
  {
    id: 'charcoal-slate',
    name: 'Charcoal Slate',
    base: '#232629',
    overlay:
      'repeating-linear-gradient(90deg, rgba(255, 255, 255, 0.025) 0 1px, transparent 1px 9px), radial-gradient(circle at 50% 30%, rgba(255, 255, 255, 0.05), transparent 70%)',
    lightBase: '#cbd5e1',
    lightOverlay:
      'radial-gradient(circle at 50% 30%, #e2e8f0, #cbd5e1 70%), repeating-linear-gradient(90deg, rgba(255, 255, 255, 0.45) 0 1px, transparent 1px 9px)',
    lightBorder: '#94a3b8',
  },
  {
    id: 'forest-moss',
    name: 'Forest Moss',
    base: '#243222',
    overlay:
      'radial-gradient(circle at 20% 30%, rgba(150, 190, 120, 0.07), transparent 55%), radial-gradient(circle at 80% 70%, rgba(120, 160, 100, 0.06), transparent 60%)',
    lightBase: '#c4d6b4',
    lightOverlay:
      'radial-gradient(circle at 20% 30%, #dfe9d5, #c4d6b4 65%), radial-gradient(circle at 80% 70%, rgba(255, 255, 255, 0.4), transparent 60%)',
    lightBorder: '#9ab386',
  },
  {
    id: 'vintage-oak',
    name: 'Vintage Oak',
    base: '#3a2b1c',
    overlay:
      'repeating-linear-gradient(90deg, rgba(0, 0, 0, 0.14) 0 3px, transparent 3px 11px), repeating-linear-gradient(88deg, rgba(255, 220, 160, 0.05) 0 2px, transparent 2px 26px)',
    lightBase: '#dcc7a8',
    lightOverlay:
      'radial-gradient(circle at 50% 25%, #efe3d0, #dcc7a8 70%), repeating-linear-gradient(90deg, rgba(120, 90, 50, 0.1) 0 3px, transparent 3px 11px)',
    lightBorder: '#b89d78',
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

/**
 * CSS `filter` for the felt, as consumed by both the arena and the header
 * preview swatches. Alias of [[textureFilter]] kept as the settings-facing name.
 */
export function getTableFilterCss(filters: Partial<TableFilterSettings> = {}): string {
  return textureFilter(filters);
}

export interface TableAppearanceSettings {
  tableTexture?: string;
  tableFilters?: Partial<TableFilterSettings>;
  /** Explicit theme; `device` (or omitting it) follows the applied `data-theme`. */
  theme?: TableTheme | 'device';
}

/**
 * Resolves the palette theme. An explicit `light`/`dark` wins; `device` and
 * `undefined` read the `data-theme` that `settings.ts` writes to `<html>`, so a
 * style built without a theme argument still tracks the live theme.
 */
export function resolveTableTheme(
  theme?: TableTheme | 'device',
  root?: HTMLElement | null,
): TableTheme {
  if (theme === 'light' || theme === 'dark') return theme;
  const target = root ?? (typeof document === 'undefined' ? null : document.documentElement);
  return target?.getAttribute('data-theme') === 'light' ? 'light' : 'dark';
}

/** Palette for one preset in the requested theme. */
export function tableTexturePalette(
  preset: TableTexturePreset,
  theme: TableTheme = 'dark',
): TableTexturePalette {
  return theme === 'light'
    ? {
        base: preset.lightBase,
        overlay: preset.lightOverlay,
        border: preset.lightBorder,
      }
    : { base: preset.base, overlay: preset.overlay };
}

/**
 * Inline style for the felt (or a texture preview swatch) built straight from a
 * settings snapshot, so previews and the live table can never drift apart.
 * Passing `settings.theme` opts into the matching palette; otherwise the
 * document's applied theme decides.
 */
export function getTableTextureStyle(
  settings: TableAppearanceSettings = {},
): Record<string, string> {
  return tableTextureStyle(
    settings.tableTexture ?? DEFAULT_TABLE_TEXTURE_ID,
    settings.tableFilters ?? {},
    settings.theme,
  );
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
 * custom properties the CSS filter classes read. Both palettes are emitted, so
 * `table.css` can swap them from `:root[data-theme='light']` even when the
 * style was built without a theme argument.
 */
export function tableTextureStyle(
  id: string,
  filters: Partial<TableFilterSettings> = {},
  theme?: TableTheme | 'device',
): Record<string, string> {
  const preset = tableTexture(id);
  const resolvedTheme = resolveTableTheme(theme);
  const palette = tableTexturePalette(preset, resolvedTheme);
  const brightness = setting(filters.brightness, DEFAULT_TABLE_FILTERS.brightness, LIMITS.brightness.min, LIMITS.brightness.max);
  const contrast = setting(filters.contrast, DEFAULT_TABLE_FILTERS.contrast, LIMITS.contrast.min, LIMITS.contrast.max);
  const hue = setting(filters.hue, DEFAULT_TABLE_FILTERS.hue, LIMITS.hue.min, LIMITS.hue.max);

  return {
    backgroundColor: palette.base,
    backgroundImage: palette.overlay,
    '--table-felt': palette.base,
    '--table-felt-overlay': palette.overlay,
    '--table-felt-light': preset.lightBase,
    '--table-felt-overlay-light': preset.lightOverlay,
    '--table-felt-border-light': preset.lightBorder,
    '--table-theme': resolvedTheme,
    '--table-brightness': String(brightness),
    '--table-contrast': String(contrast),
    '--table-hue': `${hue}deg`,
    '--table-filter': textureFilter(filters),
  };
}
