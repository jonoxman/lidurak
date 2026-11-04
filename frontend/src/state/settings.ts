import { useEffect, useState } from 'preact/hooks';
import {
  DEFAULT_TABLE_FILTERS,
  DEFAULT_TABLE_TEXTURE_ID,
  getTableFilterCss,
  tableTexture,
  type TableFilterSettings,
  type TableTextureId,
} from '../styles/tableTextures';
import type { CardBackPattern } from '../components/CardBack';

/**
 * Global appearance settings. One small observable store keeps the header
 * submenus, the app shell and the card/table surfaces in sync without pulling
 * in a state library; changes are applied to `<html>` as data attributes and
 * CSS custom properties so styling stays in CSS.
 */

export type ThemeMode = 'device' | 'light' | 'dark';
export type ResolvedTheme = 'light' | 'dark';

/** T-90-feedback-2: six highlight colour scheme presets. */
export type HighlightPresetId = 'classic' | 'warm' | 'cool' | 'neon' | 'pastel' | 'royal';

/** The six semantic highlight slots every preset re-colours. */
export type HighlightSlot =
  | 'uiSelect'
  | 'attacker'
  | 'defender'
  | 'trump'
  | 'redirect'
  | 'clockUrgent';

export interface HighlightPreset {
  id: HighlightPresetId;
  label: string;
  /** Per-slot accent colours in the dark theme. */
  dark: Record<HighlightSlot, string>;
  /** Per-slot accent colours in the light theme. */
  light: Record<HighlightSlot, string>;
}

export interface AppSettings {
  theme: ThemeMode;
  /** Global corner radius in pixels, 0 (square) to 16. */
  roundness: number;
  tableTexture: TableTextureId;
  tableFilters: TableFilterSettings;
  cardBack: CardBackPattern;
  /** Active highlight colour scheme preset. */
  highlightPreset: HighlightPresetId;
  /** Highlight aura intensity in percent, 20 (subtle) to 200 (bright). */
  highlightIntensity: number;
}

/** The subset of the settings persisted in `localStorage` under `UserSettings`. */
export interface UserSettings {
  highlightPreset: HighlightPresetId;
  highlightIntensity: number;
}

export const ROUNDNESS_MIN = 0;
export const ROUNDNESS_MAX = 16;
export const DEFAULT_ROUNDNESS = 8;

export const HIGHLIGHT_INTENSITY_MIN = 20;
export const HIGHLIGHT_INTENSITY_MAX = 200;
export const DEFAULT_HIGHLIGHT_INTENSITY = 100;
export const DEFAULT_HIGHLIGHT_PRESET: HighlightPresetId = 'classic';

/** `localStorage` key holding the persisted `UserSettings`. */
export const USER_SETTINGS_STORAGE_KEY = 'UserSettings';

/** Matches `DEFAULT_CARD_BACK_PATTERN` in `components/CardBack`. */
const DEFAULT_CARD_BACK: CardBackPattern = 'classic-hatch';

/**
 * The six highlight colour schemes. Every preset defines all six semantic
 * slots for both themes, so switching preset — or theme — never leaves a
 * highlight on a stale colour.
 */
export const HIGHLIGHT_PRESETS: readonly HighlightPreset[] = [
  {
    id: 'classic',
    label: 'Classic',
    dark: {
      uiSelect: '#3b82f6',
      attacker: '#22c55e',
      defender: '#ef4444',
      trump: '#f59e0b',
      redirect: '#a855f7',
      clockUrgent: '#ea580c',
    },
    light: {
      uiSelect: '#5b87f5',
      attacker: '#46a76f',
      defender: '#dc6868',
      trump: '#d4943a',
      redirect: '#a375e6',
      clockUrgent: '#e27c43',
    },
  },
  {
    id: 'warm',
    label: 'Warm',
    dark: {
      uiSelect: '#d97706',
      attacker: '#84cc16',
      defender: '#f43f5e',
      trump: '#eab308',
      redirect: '#ec4899',
      clockUrgent: '#ea580c',
    },
    light: {
      uiSelect: '#c47a2c',
      attacker: '#6b9a2e',
      defender: '#d9526b',
      trump: '#c9a227',
      redirect: '#d9558f',
      clockUrgent: '#d97a45',
    },
  },
  {
    id: 'cool',
    label: 'Cool',
    dark: {
      uiSelect: '#06b6d4',
      attacker: '#10b981',
      defender: '#e11d48',
      trump: '#38bdf8',
      redirect: '#8b5cf6',
      clockUrgent: '#f97316',
    },
    light: {
      uiSelect: '#3b93ad',
      attacker: '#3d9c84',
      defender: '#c0506b',
      trump: '#4a8fc4',
      redirect: '#8b6fd6',
      clockUrgent: '#d9786a',
    },
  },
  {
    id: 'neon',
    label: 'Neon',
    dark: {
      uiSelect: '#00e5ff',
      attacker: '#39ff14',
      defender: '#ff2a85',
      trump: '#facc15',
      redirect: '#c084fc',
      clockUrgent: '#ff6b00',
    },
    light: {
      uiSelect: '#38a3d6',
      attacker: '#49b96b',
      defender: '#e05a9e',
      trump: '#d9b53a',
      redirect: '#a875e0',
      clockUrgent: '#e6773d',
    },
  },
  {
    id: 'pastel',
    label: 'Pastel',
    dark: {
      uiSelect: '#818cf8',
      attacker: '#4ade80',
      defender: '#fb7185',
      trump: '#fbbf24',
      redirect: '#c084fc',
      clockUrgent: '#fb923c',
    },
    light: {
      uiSelect: '#7c83e8',
      attacker: '#63b07a',
      defender: '#ea8296',
      trump: '#e2a95c',
      redirect: '#a98aea',
      clockUrgent: '#ed9a63',
    },
  },
  {
    id: 'royal',
    label: 'Royal',
    dark: {
      uiSelect: '#2563eb',
      attacker: '#059669',
      defender: '#dc2626',
      trump: '#d97706',
      redirect: '#9333ea',
      clockUrgent: '#ea580c',
    },
    light: {
      uiSelect: '#3a6ac9',
      attacker: '#2f8a6a',
      defender: '#c94c4c',
      trump: '#b07a2a',
      redirect: '#7d5bc4',
      clockUrgent: '#c26a3d',
    },
  },
];

/** Order and labels of the six preview lines inside each preset button. */
export const HIGHLIGHT_SLOTS: readonly {
  slot: HighlightSlot;
  label: string;
  /** Custom-property prefix written by `applyHighlightTokens`. */
  prefix: string;
}[] = [
  { slot: 'uiSelect', label: 'UI select', prefix: '--ui-select' },
  { slot: 'attacker', label: 'Attacker', prefix: '--role-attacker' },
  { slot: 'defender', label: 'Defender', prefix: '--role-defender' },
  { slot: 'trump', label: 'Trump', prefix: '--trump' },
  { slot: 'redirect', label: 'Redirect', prefix: '--redirect' },
  { slot: 'clockUrgent', label: 'Urgent clock', prefix: '--clock-urgent' },
];

/** Alpha shape of each slot's border / glow / tint, before intensity scaling. */
const SLOT_ALPHA: Record<HighlightSlot, { border: number; glow: number; bg: number }> = {
  uiSelect: { border: 0.85, glow: 0.4, bg: 0.16 },
  attacker: { border: 0.85, glow: 0.55, bg: 0.14 },
  defender: { border: 0.88, glow: 0.6, bg: 0.15 },
  trump: { border: 0.8, glow: 0.42, bg: 0.14 },
  redirect: { border: 0.9, glow: 0.55, bg: 0.14 },
  clockUrgent: { border: 1, glow: 0.7, bg: 0.14 },
};

/**
 * T-90-feedback-20261104_133915-1: Light mode is deliberately calmer than Dark.
 * At the default 100% intensity the borders sit around `0.58–0.68`, the auras
 * around `0.28–0.34` and the surface tints around `0.10–0.11`, so highlights
 * harmonise with a pale surface instead of glaring against it. The Intensity
 * slider still scales every value from 20% to 200%.
 */
export const LIGHT_SLOT_ALPHA: Record<
  HighlightSlot,
  { border: number; glow: number; bg: number }
> = {
  uiSelect: { border: 0.62, glow: 0.3, bg: 0.1 },
  attacker: { border: 0.6, glow: 0.3, bg: 0.1 },
  defender: { border: 0.65, glow: 0.34, bg: 0.11 },
  trump: { border: 0.58, glow: 0.28, bg: 0.1 },
  redirect: { border: 0.62, glow: 0.3, bg: 0.1 },
  clockUrgent: { border: 0.68, glow: 0.34, bg: 0.1 },
};

/** Alpha shape for a slot in the given theme (Light is the paler calibration). */
export function highlightSlotAlpha(
  slot: HighlightSlot,
  theme: ResolvedTheme,
): { border: number; glow: number; bg: number } {
  return theme === 'light' ? LIGHT_SLOT_ALPHA[slot] : SLOT_ALPHA[slot];
}

export const DEFAULT_SETTINGS: AppSettings = {
  theme: 'device',
  roundness: DEFAULT_ROUNDNESS,
  tableTexture: DEFAULT_TABLE_TEXTURE_ID,
  tableFilters: { ...DEFAULT_TABLE_FILTERS },
  cardBack: DEFAULT_CARD_BACK,
  highlightPreset: DEFAULT_HIGHLIGHT_PRESET,
  highlightIntensity: DEFAULT_HIGHLIGHT_INTENSITY,
};

export function clampRoundness(value: number): number {
  if (!Number.isFinite(value)) return DEFAULT_ROUNDNESS;
  return Math.min(ROUNDNESS_MAX, Math.max(ROUNDNESS_MIN, Math.round(value)));
}

/** Intensity is a whole percentage between 20% and 200%. */
export function clampHighlightIntensity(value: number): number {
  if (!Number.isFinite(value)) return DEFAULT_HIGHLIGHT_INTENSITY;
  return Math.min(
    HIGHLIGHT_INTENSITY_MAX,
    Math.max(HIGHLIGHT_INTENSITY_MIN, Math.round(value)),
  );
}

/** `1` at the default 100%, `0.2` subtle, `2` bright. */
export function highlightIntensityScale(intensity: number): number {
  return clampHighlightIntensity(intensity) / 100;
}

export function isHighlightPresetId(value: unknown): value is HighlightPresetId {
  return HIGHLIGHT_PRESETS.some((preset) => preset.id === value);
}

export function highlightPresetById(id: HighlightPresetId): HighlightPreset {
  return HIGHLIGHT_PRESETS.find((preset) => preset.id === id) ?? HIGHLIGHT_PRESETS[0];
}

/** Device theme follows the OS; everything else is explicit. */
export function resolveTheme(theme: ThemeMode, prefersDark: boolean): ResolvedTheme {
  if (theme === 'device') return prefersDark ? 'dark' : 'light';
  return theme;
}

/** True when the OS asks for a dark scheme; defaults to the durak dark look. */
export function prefersDarkScheme(): boolean {
  if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') return true;
  return window.matchMedia('(prefers-color-scheme: dark)').matches;
}

/** A patch may update any setting, and only some table filter sliders. */
export type SettingsPatch = Omit<Partial<AppSettings>, 'tableFilters'> & {
  tableFilters?: Partial<TableFilterSettings>;
};

type Listener = () => void;

function defaultUserSettings(): UserSettings {
  return {
    highlightPreset: DEFAULT_SETTINGS.highlightPreset,
    highlightIntensity: DEFAULT_SETTINGS.highlightIntensity,
  };
}

function readStoredUserSettings(): UserSettings | null {
  if (typeof window === 'undefined') return null;
  try {
    const raw = window.localStorage?.getItem(USER_SETTINGS_STORAGE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as Partial<UserSettings> | null;
    if (!parsed || typeof parsed !== 'object') return null;
    return {
      highlightPreset: isHighlightPresetId(parsed.highlightPreset)
        ? parsed.highlightPreset
        : DEFAULT_SETTINGS.highlightPreset,
      highlightIntensity:
        typeof parsed.highlightIntensity === 'number'
          ? clampHighlightIntensity(parsed.highlightIntensity)
          : DEFAULT_SETTINGS.highlightIntensity,
    };
  } catch {
    return null;
  }
}

function persistUserSettings(settings: AppSettings): void {
  if (typeof window === 'undefined') return;
  try {
    const stored: UserSettings = {
      highlightPreset: settings.highlightPreset,
      highlightIntensity: clampHighlightIntensity(settings.highlightIntensity),
    };
    window.localStorage?.setItem(USER_SETTINGS_STORAGE_KEY, JSON.stringify(stored));
  } catch {
    // Storage can be unavailable (private mode / quota); settings still apply.
  }
}

const storedAtBoot = readStoredUserSettings();

let current: AppSettings = {
  ...DEFAULT_SETTINGS,
  ...(storedAtBoot ?? defaultUserSettings()),
  tableFilters: { ...DEFAULT_SETTINGS.tableFilters },
};
const listeners = new Set<Listener>();

function notify(): void {
  listeners.forEach((listener) => listener());
}

export function getSettings(): AppSettings {
  return current;
}

/** Shallow-merges a patch (table filters merge separately) and repaints. */
export function setSettings(patch: SettingsPatch): AppSettings {
  current = {
    ...current,
    ...patch,
    tableFilters: { ...current.tableFilters, ...patch.tableFilters },
  };
  applySettings(current);
  persistUserSettings(current);
  notify();
  return current;
}

export function setHighlightPreset(preset: HighlightPresetId): AppSettings {
  return setSettings({ highlightPreset: preset });
}

export function setHighlightIntensity(intensity: number): AppSettings {
  return setSettings({ highlightIntensity: clampHighlightIntensity(intensity) });
}

export function subscribeSettings(listener: Listener): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

export function resetSettings(): void {
  current = {
    ...DEFAULT_SETTINGS,
    tableFilters: { ...DEFAULT_SETTINGS.tableFilters },
  };
  applySettings(current);
  persistUserSettings(current);
  notify();
}

function hexToRgb(hex: string): { r: number; g: number; b: number } | null {
  const value = hex.replace('#', '').trim();
  if (value.length !== 6) return null;
  const parsed = Number.parseInt(value, 16);
  if (Number.isNaN(parsed)) return null;
  return {
    r: (parsed >> 16) & 0xff,
    g: (parsed >> 8) & 0xff,
    b: parsed & 0xff,
  };
}

/** `rgba()` string from a hex colour and an alpha in `0…1`. */
export function highlightRgba(hex: string, alpha: number): string {
  const rgb = hexToRgb(hex);
  if (!rgb) return hex;
  const clamped = Math.min(1, Math.max(0, Number(alpha.toFixed(3))));
  return `rgba(${rgb.r}, ${rgb.g}, ${rgb.b}, ${clamped})`;
}

/** Mixes a hex colour toward white, for readable text on dark surfaces. */
function tintTowardWhite(hex: string, amount: number): string {
  const rgb = hexToRgb(hex);
  if (!rgb) return hex;
  const mix = (channel: number) => Math.round(channel + (255 - channel) * amount);
  const toHex = (channel: number) => channel.toString(16).padStart(2, '0');
  return `#${toHex(mix(rgb.r))}${toHex(mix(rgb.g))}${toHex(mix(rgb.b))}`;
}

/** Mixes a hex colour toward black, keeping selected labels readable on white. */
function shadeTowardBlack(hex: string, amount: number): string {
  const rgb = hexToRgb(hex);
  if (!rgb) return hex;
  const mix = (channel: number) => Math.round(channel * (1 - amount));
  const toHex = (channel: number) => channel.toString(16).padStart(2, '0');
  return `#${toHex(mix(rgb.r))}${toHex(mix(rgb.g))}${toHex(mix(rgb.b))}`;
}

/**
 * Applies the active highlight preset and intensity. Every semantic token is
 * recomputed from the preset's palette for the resolved theme and scaled by
 * `intensity / 100`, so menu selections, hand glows, table outlines, trump
 * rings, reflection outlines and the urgent clock all change together. Light
 * mode uses the paler `LIGHT_SLOT_ALPHA` calibration; Dark is unchanged.
 */
export function applyHighlightTokens(
  settings: AppSettings,
  resolvedTheme: ResolvedTheme,
  target: HTMLElement,
): void {
  const preset = highlightPresetById(settings.highlightPreset);
  const intensity = clampHighlightIntensity(settings.highlightIntensity);
  const scale = intensity / 100;
  const palette = resolvedTheme === 'light' ? preset.light : preset.dark;

  target.setAttribute('data-highlight-preset', preset.id);
  target.setAttribute('data-highlight-intensity', String(intensity));
  target.style.setProperty('--highlight-intensity', String(scale));

  for (const { slot, prefix } of HIGHLIGHT_SLOTS) {
    const accent = palette[slot];
    const alphas = highlightSlotAlpha(slot, resolvedTheme);
    const borderAlpha = alphas.border * (0.6 + 0.4 * scale);
    target.style.setProperty(`${prefix}-accent`, accent);
    target.style.setProperty(
      `${prefix}-border`,
      // Clock borders are solid in Dark; Light keeps the paler translucent edge.
      slot === 'clockUrgent' && resolvedTheme === 'dark'
        ? accent
        : highlightRgba(accent, borderAlpha),
    );
    target.style.setProperty(`${prefix}-glow`, highlightRgba(accent, alphas.glow * scale));
    target.style.setProperty(`${prefix}-bg`, highlightRgba(accent, alphas.bg * scale));
  }

  // Legacy `-surface` aliases used by older rules.
  target.style.setProperty('--ui-select-surface', 'var(--ui-select-bg)');
  target.style.setProperty(
    '--ui-select-text',
    // Pale light-mode accents need a darker label colour to stay readable.
    resolvedTheme === 'light'
      ? shadeTowardBlack(palette.uiSelect, 0.4)
      : tintTowardWhite(palette.uiSelect, 0.45),
  );
  target.style.setProperty('--role-attacker-surface', 'var(--role-attacker-bg)');
  target.style.setProperty('--role-defender-surface', 'var(--role-defender-bg)');
  target.style.setProperty('--trump-surface', 'var(--trump-bg)');
  target.style.setProperty('--redirect-surface', 'var(--redirect-bg)');

  // Pulse layers: the outer ring and the softer halo behind each role glow.
  for (const [slot, prefix] of [
    ['attacker', '--role-attacker'],
    ['defender', '--role-defender'],
  ] as const) {
    const accent = palette[slot];
    const alphas = highlightSlotAlpha(slot, resolvedTheme);
    target.style.setProperty(
      `${prefix}-pulse-outer`,
      highlightRgba(accent, alphas.glow * scale),
    );
    target.style.setProperty(
      `${prefix}-pulse-halo`,
      highlightRgba(accent, alphas.glow * 0.6 * scale),
    );
  }

  // Urgent clock aliases point at the same scaled values.
  target.style.setProperty('--clock-low-accent', palette.clockUrgent);
  target.style.setProperty(
    '--clock-low-border',
    resolvedTheme === 'light'
      ? highlightRgba(
          palette.clockUrgent,
          highlightSlotAlpha('clockUrgent', 'light').border * (0.6 + 0.4 * scale),
        )
      : palette.clockUrgent,
  );
  target.style.setProperty(
    '--clock-low-glow',
    highlightRgba(
      palette.clockUrgent,
      highlightSlotAlpha('clockUrgent', resolvedTheme).glow * scale,
    ),
  );
  target.style.setProperty(
    '--clock-low-bg',
    highlightRgba(
      palette.clockUrgent,
      highlightSlotAlpha('clockUrgent', resolvedTheme).bg * scale,
    ),
  );
}

/**
 * Writes the settings to the document element: theme, roundness, card back,
 * table texture, the felt filter variables and the highlight preset / intensity
 * tokens consumed by CSS.
 */
export function applySettings(settings: AppSettings, root?: HTMLElement | null): void {
  const target = root ?? (typeof document === 'undefined' ? null : document.documentElement);
  if (!target) return;

  const preset = tableTexture(settings.tableTexture);
  const filters = settings.tableFilters;
  const resolvedTheme = resolveTheme(settings.theme, prefersDarkScheme());

  target.setAttribute('data-theme', resolvedTheme);
  target.setAttribute('data-table-texture', preset.id);
  target.setAttribute('data-card-back', settings.cardBack);
  target.style.setProperty('--app-roundness', `${clampRoundness(settings.roundness)}px`);
  target.style.setProperty('--table-felt', preset.base);
  target.style.setProperty('--table-felt-overlay', preset.overlay);
  target.style.setProperty('--table-texture-bg', preset.base);
  target.style.setProperty('--table-texture-overlay', preset.overlay);
  target.style.setProperty('--table-brightness', String(filters.brightness));
  target.style.setProperty('--table-contrast', String(filters.contrast));
  target.style.setProperty('--table-hue', `${filters.hue}deg`);
  target.style.setProperty('--table-filter', getTableFilterCss(filters));

  applyHighlightTokens(settings, resolvedTheme, target);
}

/** Alias used by the Theme menu wiring and documented in the ticket. */
export function applySettingsToDocument(settings: AppSettings, root?: HTMLElement | null): void {
  applySettings(settings, root);
}

/**
 * Applies the current settings and keeps "Device theme" in sync with OS
 * changes. Returns a cleanup function.
 */
export function initSettings(): () => void {
  applySettings(current);
  if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') {
    return () => {};
  }
  const query = window.matchMedia('(prefers-color-scheme: dark)');
  const onChange = () => applySettings(current);
  query.addEventListener?.('change', onChange);
  return () => query.removeEventListener?.('change', onChange);
}

/** Reactive settings snapshot for components. */
export function useSettings(): AppSettings {
  const [snapshot, setSnapshot] = useState<AppSettings>(getSettings);
  useEffect(() => subscribeSettings(() => setSnapshot(getSettings())), []);
  return snapshot;
}
