import { useEffect, useState } from 'preact/hooks';
import {
  DEFAULT_TABLE_FILTERS,
  DEFAULT_TABLE_TEXTURE_ID,
  tableTexture,
  textureFilter,
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

export interface AppSettings {
  theme: ThemeMode;
  /** Global corner radius in pixels, 0 (square) to 16. */
  roundness: number;
  tableTexture: TableTextureId;
  tableFilters: TableFilterSettings;
  cardBack: CardBackPattern;
}

export const ROUNDNESS_MIN = 0;
export const ROUNDNESS_MAX = 16;
export const DEFAULT_ROUNDNESS = 8;

/** Matches `DEFAULT_CARD_BACK_PATTERN` in `components/CardBack`. */
const DEFAULT_CARD_BACK: CardBackPattern = 'classic-hatch';

export const DEFAULT_SETTINGS: AppSettings = {
  theme: 'device',
  roundness: DEFAULT_ROUNDNESS,
  tableTexture: DEFAULT_TABLE_TEXTURE_ID,
  tableFilters: { ...DEFAULT_TABLE_FILTERS },
  cardBack: DEFAULT_CARD_BACK,
};

export function clampRoundness(value: number): number {
  if (!Number.isFinite(value)) return DEFAULT_ROUNDNESS;
  return Math.min(ROUNDNESS_MAX, Math.max(ROUNDNESS_MIN, Math.round(value)));
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

let current: AppSettings = {
  ...DEFAULT_SETTINGS,
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
  notify();
  return current;
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
  notify();
}

/**
 * Writes the settings to the document element: theme, roundness, card back,
 * table texture and the felt filter variables consumed by CSS.
 */
export function applySettings(settings: AppSettings, root?: HTMLElement | null): void {
  const target = root ?? (typeof document === 'undefined' ? null : document.documentElement);
  if (!target) return;

  const preset = tableTexture(settings.tableTexture);
  const filters = settings.tableFilters;

  target.setAttribute('data-theme', resolveTheme(settings.theme, prefersDarkScheme()));
  target.setAttribute('data-table-texture', preset.id);
  target.setAttribute('data-card-back', settings.cardBack);
  target.style.setProperty('--app-roundness', `${clampRoundness(settings.roundness)}px`);
  target.style.setProperty('--table-felt', preset.base);
  target.style.setProperty('--table-felt-overlay', preset.overlay);
  target.style.setProperty('--table-brightness', String(filters.brightness));
  target.style.setProperty('--table-contrast', String(filters.contrast));
  target.style.setProperty('--table-hue', `${filters.hue}deg`);
  target.style.setProperty('--table-filter', textureFilter(filters));
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
