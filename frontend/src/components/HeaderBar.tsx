import { useEffect, useRef, useState } from 'preact/hooks';
import { SoundEngine, soundEngine } from '../audio/SoundEngine';
import { ALL_CARD_BACK_PATTERNS, CARD_BACK_LABELS, CardBack } from './CardBack';
import {
  TABLE_TEXTURES,
  getTableFilterCss,
  resolveTableTheme,
  tableTexturePalette,
} from '../styles/tableTextures';
import {
  HIGHLIGHT_INTENSITY_MAX,
  HIGHLIGHT_INTENSITY_MIN,
  HIGHLIGHT_PRESETS,
  HIGHLIGHT_SLOTS,
  ROUNDNESS_MAX,
  ROUNDNESS_MIN,
  highlightIntensityScale,
  setHighlightIntensity,
  setHighlightPreset,
  setSettings,
  useSettings,
  type ThemeMode,
} from '../state/settings';

export interface HeaderBarProps {
  /** Round-trip latency shown in the connection tracker. */
  pingMs?: number;
  /** Server-side delay shown next to the ping. */
  serverDelayMs?: number;
}

interface NavLink {
  label: string;
  href: string;
}

interface NavMenu {
  id: string;
  label: string;
  links: NavLink[];
}

/** Placeholder navigation, mirroring Lichess' top-level menus. */
export const NAV_MENUS: readonly NavMenu[] = [
  {
    id: 'play',
    label: 'PLAY',
    links: [
      { label: 'New game', href: '#/' },
      { label: 'Quick pairing', href: '#/' },
      { label: 'Play vs. computer', href: '#/' },
    ],
  },
  {
    id: 'puzzles',
    label: 'PUZZLES',
    links: [
      { label: 'Daily puzzle', href: '#/' },
      { label: 'Puzzle dashboard', href: '#/' },
      { label: 'Puzzle themes', href: '#/' },
    ],
  },
  {
    id: 'learn',
    label: 'LEARN',
    links: [
      { label: 'Durak basics', href: '#/' },
      { label: 'Practice', href: '#/' },
      { label: 'Rules', href: '#/' },
    ],
  },
  {
    id: 'watch',
    label: 'WATCH',
    links: [
      { label: 'Live games', href: '#/' },
      { label: 'Tournaments', href: '#/' },
      { label: 'Replays', href: '#/' },
    ],
  },
];

export type ProfileIconName =
  | 'profile'
  | 'inbox'
  | 'preferences'
  | 'signout'
  | 'language'
  | 'sound'
  | 'theme'
  | 'table'
  | 'cardback';

export type SubmenuId = 'sound' | 'theme' | 'table' | 'cardback';

/** Title shown in the in-place submenu header. */
export const SUBMENU_LABELS: Record<SubmenuId, string> = {
  sound: 'Sound',
  theme: 'Theme',
  table: 'Table',
  cardback: 'Card Back',
};

interface ProfileItem {
  id: string;
  label: string;
  icon: ProfileIconName;
  submenu?: SubmenuId;
}

/** Profile dropdown rows: five plain entries and four submenu entries. */
export const PROFILE_ITEMS: readonly ProfileItem[] = [
  { id: 'profile', label: 'Profile', icon: 'profile' },
  { id: 'inbox', label: 'Inbox', icon: 'inbox' },
  { id: 'preferences', label: 'Preferences', icon: 'preferences' },
  { id: 'signout', label: 'Sign out', icon: 'signout' },
  { id: 'language', label: 'Language', icon: 'language' },
  { id: 'sound', label: 'Sound', icon: 'sound', submenu: 'sound' },
  { id: 'theme', label: 'Theme', icon: 'theme', submenu: 'theme' },
  { id: 'table', label: 'Table', icon: 'table', submenu: 'table' },
  { id: 'cardback', label: 'Card Back', icon: 'cardback', submenu: 'cardback' },
];

/** Colour of the active signal bars for the current latency tier. */
export type BarColor = 'green' | 'yellow' | 'red';

/** Four-bar signal strength: 4 is excellent, 1 is poor. */
export function connectionLevel(pingMs: number): number {
  if (!Number.isFinite(pingMs) || pingMs < 0) return 1;
  if (pingMs <= 60) return 4;
  if (pingMs <= 150) return 3;
  if (pingMs <= 300) return 2;
  return 1;
}

function MenuIcon({ name }: { name: ProfileIconName }) {
  const stroke = { fill: 'none', stroke: 'currentColor', 'stroke-width': 1.6 } as const;
  switch (name) {
    case 'profile':
      return (
        <svg class="menu-icon" viewBox="0 0 24 24" aria-hidden="true">
          <circle cx="12" cy="12" r="9.2" {...stroke} />
          <circle cx="12" cy="9.5" r="3" fill="currentColor" />
          <path d="M6.2 18.2c1.3-2.4 3.4-3.6 5.8-3.6s4.5 1.2 5.8 3.6" {...stroke} />
        </svg>
      );
    case 'inbox':
      return (
        <svg class="menu-icon" viewBox="0 0 24 24" aria-hidden="true">
          <rect x="3.5" y="6" width="17" height="12" rx="2" {...stroke} />
          <path d="M3.5 13h4l1.5 2.5h6L16.5 13h4" {...stroke} />
        </svg>
      );
    case 'preferences':
      return (
        <svg class="menu-icon" viewBox="0 0 24 24" aria-hidden="true">
          <circle cx="12" cy="12" r="3.2" {...stroke} />
          <path d="M12 3v3M12 18v3M3 12h3M18 12h3M5.6 5.6l2.1 2.1M16.3 16.3l2.1 2.1M18.4 5.6l-2.1 2.1M7.7 16.3l-2.1 2.1" {...stroke} />
        </svg>
      );
    case 'signout':
      return (
        <svg class="menu-icon" viewBox="0 0 24 24" aria-hidden="true">
          <path d="M14 4.5H6.5a1.5 1.5 0 0 0-1.5 1.5v12a1.5 1.5 0 0 0 1.5 1.5H14" {...stroke} />
          <path d="M16.5 8.5 20 12l-3.5 3.5M9.5 12H20" {...stroke} stroke-linecap="round" />
        </svg>
      );
    case 'language':
      return (
        <svg class="menu-icon" viewBox="0 0 24 24" aria-hidden="true">
          <circle cx="12" cy="12" r="9" {...stroke} />
          <ellipse cx="12" cy="12" rx="4" ry="9" {...stroke} />
          <path d="M3.4 9h17.2M3.4 15h17.2" {...stroke} />
        </svg>
      );
    case 'sound':
      return (
        <svg class="menu-icon" viewBox="0 0 24 24" aria-hidden="true">
          <path d="M4 9.5h3.5L12 5.5v13L7.5 14.5H4z" {...stroke} stroke-linejoin="round" />
          <path d="M15.5 9a4 4 0 0 1 0 6M18 6.5a7.5 7.5 0 0 1 0 11" {...stroke} stroke-linecap="round" />
        </svg>
      );
    case 'theme':
      return (
        <svg class="menu-icon" viewBox="0 0 24 24" aria-hidden="true">
          <circle cx="12" cy="12" r="9" {...stroke} />
          <path d="M12 3a9 9 0 0 1 0 18z" fill="currentColor" />
        </svg>
      );
    case 'table':
      return (
        <svg class="menu-icon" viewBox="0 0 24 24" aria-hidden="true">
          <rect x="3" y="6.5" width="18" height="8.5" rx="1.5" {...stroke} />
          <path d="M6.5 15v4M17.5 15v4" {...stroke} stroke-linecap="round" />
        </svg>
      );
    case 'cardback':
    default:
      return (
        <svg class="menu-icon" viewBox="0 0 24 24" aria-hidden="true">
          <rect x="4" y="3.5" width="16" height="17" rx="2" {...stroke} />
          <rect x="7" y="6.5" width="10" height="11" rx="1" {...stroke} />
        </svg>
      );
  }
}

/** Right-facing chevron marking profile rows that open a submenu. */
function Chevron() {
  return (
    <svg class="menu-chevron" viewBox="0 0 14 14" aria-hidden="true">
      <path
        d="M5 2.5 9.5 7 5 11.5"
        fill="none"
        stroke="currentColor"
        stroke-width="2"
        stroke-linecap="round"
        stroke-linejoin="round"
      />
    </svg>
  );
}

/** Left-facing chevron in the submenu header that returns to the main menu. */
function BackChevron() {
  return (
    <svg class="submenu-chevron" viewBox="0 0 14 14" aria-hidden="true">
      <path
        d="M9 2.5 4.5 7 9 11.5"
        fill="none"
        stroke="currentColor"
        stroke-width="2"
        stroke-linecap="round"
        stroke-linejoin="round"
      />
    </svg>
  );
}

function SoundSubmenu() {
  const [volume, setVolume] = useState(() => soundEngine.getVolume());
  const [pack, setPack] = useState(() => soundEngine.getSoundPack());
  // The latest volume is mirrored in a ref so a release can audition it even
  // before the re-render that follows the final `input` event.
  const volumeRef = useRef(volume);
  // A single release fires pointerup, mouseup and touchend in the same turn;
  // the flag keeps that burst down to exactly one audible sample.
  const releasedRef = useRef(false);
  const packs = SoundEngine.soundPacks();

  const playReleasedSample = () => {
    if (releasedRef.current) return;
    releasedRef.current = true;
    window.setTimeout(() => {
      releasedRef.current = false;
    }, 0);
    // Audible feedback: one random effect from the pack at the chosen volume.
    soundEngine.playSampleSound(undefined, volumeRef.current);
  };

  return (
    <div class="settings-submenu" data-testid="submenu-sound">
      <label class="setting-row">
        <span class="setting-label">Volume</span>
        <input
          type="range"
          min={0}
          max={1}
          step={0.01}
          value={volume}
          aria-label="Master volume"
          onInput={(event) => {
            const next = Number((event.target as HTMLInputElement).value);
            // Dragging is silent: the level is stored immediately, but the
            // sample only plays once the selector is released.
            volumeRef.current = next;
            setVolume(next);
            soundEngine.setVolume(next);
          }}
          onPointerUp={playReleasedSample}
          onMouseUp={playReleasedSample}
          onTouchEnd={playReleasedSample}
        />
        <output class="setting-value">{Math.round(volume * 100)}%</output>
      </label>

      <div class="pack-grid" role="group" aria-label="Sound packs">
        {packs.map((option) => (
          <button
            type="button"
            key={option.id}
            class={`pack-option appearance-choice sound-pack-btn${pack === option.id ? ' active' : ''}`}
            aria-pressed={pack === option.id}
            onClick={() => {
              soundEngine.setSoundPack(option.id);
              setPack(option.id);
              // Audition the pack right away with one of its own effects.
              soundEngine.playSampleSound(option.id, soundEngine.getVolume());
            }}
          >
            {option.name}
          </button>
        ))}
      </div>
    </div>
  );
}

function ThemeSubmenu() {
  const settings = useSettings();
  const resolvedTheme = resolveTableTheme(settings.theme);
  const themes: ReadonlyArray<{ id: ThemeMode; label: string }> = [
    { id: 'device', label: 'Device theme' },
    { id: 'light', label: 'Light' },
    { id: 'dark', label: 'Dark' },
  ];

  return (
    <div class="settings-submenu" data-testid="submenu-theme">
      <div class="theme-grid" role="group" aria-label="Theme">
        {themes.map((theme) => (
          <button
            type="button"
            key={theme.id}
            class={`theme-option appearance-choice${settings.theme === theme.id ? ' active' : ''}`}
            aria-pressed={settings.theme === theme.id}
            onClick={() => setSettings({ theme: theme.id })}
          >
            {theme.label}
          </button>
        ))}
      </div>

      <label class="setting-row">
        <span class="setting-label">Roundness</span>
        <input
          type="range"
          min={ROUNDNESS_MIN}
          max={ROUNDNESS_MAX}
          step={1}
          value={settings.roundness}
          aria-label="Roundness"
          data-testid="roundness-slider"
          onInput={(event) =>
            setSettings({ roundness: Number((event.target as HTMLInputElement).value) })
          }
        />
        <output class="setting-value">{settings.roundness}px</output>
      </label>

      {/* T-90-feedback-2: the Palettes section sits below every existing Theme
          control and above the connection tracker at the dropdown foot. */}
      <div class="theme-highlights-section" data-testid="theme-highlights-section">
        <div class="submenu-section-title" data-testid="theme-highlights-heading">
          Palettes
        </div>

        <div class="highlight-preset-grid" role="group" aria-label="Highlight color presets">
          {HIGHLIGHT_PRESETS.map((preset) => {
            const active = settings.highlightPreset === preset.id;
            const palette = resolvedTheme === 'light' ? preset.light : preset.dark;
            // Preview lines track the live intensity, just like the table aura.
            const scale = highlightIntensityScale(settings.highlightIntensity);
            return (
              <button
                type="button"
                key={preset.id}
                class={`appearance-choice highlight-preset-btn${active ? ' active' : ''}`}
                data-testid={`highlight-preset-${preset.id}`}
                data-preset={preset.id}
                aria-pressed={active}
                onClick={() => setHighlightPreset(preset.id)}
              >
                <span class="highlight-preset-name">{preset.label}</span>
                <span
                  class="highlight-preset-lines"
                  data-testid={`highlight-preset-preview-${preset.id}`}
                  aria-hidden="true"
                >
                  {HIGHLIGHT_SLOTS.map(({ slot, label }) => {
                    const color = palette[slot];
                    return (
                      <span
                        key={slot}
                        class="highlight-preview-line"
                        data-slot={slot}
                        title={label}
                        style={{
                          background: color,
                          boxShadow: `0 0 ${(5 * scale).toFixed(1)}px ${color}`,
                        }}
                      />
                    );
                  })}
                </span>
              </button>
            );
          })}
        </div>

        <label class="setting-row">
          {/* T-90-2 ITEM-1b / ITEM-4: the visible label is `Glow`; the setting
              key (`highlightIntensity`) and the test hooks are unchanged. */}
          <span class="setting-label">Glow</span>
          <input
            type="range"
            min={HIGHLIGHT_INTENSITY_MIN}
            max={HIGHLIGHT_INTENSITY_MAX}
            step={1}
            value={settings.highlightIntensity}
            aria-label="Highlight intensity"
            data-testid="highlight-intensity-slider"
            onInput={(event) =>
              setHighlightIntensity(Number((event.target as HTMLInputElement).value))
            }
          />
          <output class="setting-value" data-testid="highlight-intensity-value">
            {settings.highlightIntensity}%
          </output>
        </label>
      </div>
    </div>
  );
}

function TableSubmenu() {
  const settings = useSettings();
  const { brightness, contrast, hue } = settings.tableFilters;
  // Every swatch previews the live filter, so slider drags repaint them in place.
  const filterCss = getTableFilterCss({ brightness, contrast, hue });
  // Swatches follow the applied theme, so each preset previews the very texture
  // the arena paints: same layers, only the colour palette changes per theme.
  const resolvedTheme = resolveTableTheme(settings.theme);

  return (
    <div class="settings-submenu" data-testid="submenu-table">
      <div class="texture-grid" role="group" aria-label="Table textures">
        {TABLE_TEXTURES.map((texture) => {
          const palette = tableTexturePalette(texture, resolvedTheme);
          return (
            <button
              type="button"
              key={texture.id}
              class={`texture-option appearance-choice felt-swatch-btn${settings.tableTexture === texture.id ? ' active' : ''}`}
              aria-label={texture.name}
              aria-pressed={settings.tableTexture === texture.id}
              data-testid={`table-texture-${texture.id}`}
              data-texture-theme={resolvedTheme}
              onClick={() => setSettings({ tableTexture: texture.id })}
            >
              <span
                class="texture-swatch"
                data-testid={`texture-swatch-${texture.id}`}
                data-texture-theme={resolvedTheme}
                style={{
                  backgroundColor: palette.base,
                  backgroundImage: palette.overlay,
                  filter: filterCss,
                }}
                aria-hidden="true"
              />
              <span class="texture-name">{texture.name}</span>
            </button>
          );
        })}
      </div>

      <label class="setting-row">
        <span class="setting-label">Brightness</span>
        <input
          type="range"
          min={0.2}
          max={2}
          step={0.05}
          value={brightness}
          aria-label="Brightness"
          onInput={(event) =>
            setSettings({ tableFilters: { brightness: Number((event.target as HTMLInputElement).value) } })
          }
        />
        <output class="setting-value">{brightness.toFixed(2)}</output>
      </label>

      <label class="setting-row">
        <span class="setting-label">Contrast</span>
        <input
          type="range"
          min={0}
          max={2}
          step={0.05}
          value={contrast}
          aria-label="Contrast"
          onInput={(event) =>
            setSettings({ tableFilters: { contrast: Number((event.target as HTMLInputElement).value) } })
          }
        />
        <output class="setting-value">{contrast.toFixed(2)}</output>
      </label>

      <label class="setting-row">
        <span class="setting-label">Hue</span>
        <input
          type="range"
          min={-180}
          max={180}
          step={1}
          value={hue}
          aria-label="Hue"
          onInput={(event) =>
            setSettings({ tableFilters: { hue: Number((event.target as HTMLInputElement).value) } })
          }
        />
        <output class="setting-value">{hue}°</output>
      </label>
    </div>
  );
}

function CardBackSubmenu() {
  const settings = useSettings();

  return (
    <div class="settings-submenu" data-testid="submenu-cardback">
      <div class="cardback-grid" role="group" aria-label="Card backs">
        {ALL_CARD_BACK_PATTERNS.map((pattern) => (
          <button
            type="button"
            key={pattern}
            class={`cardback-option appearance-choice card-back-swatch-btn${settings.cardBack === pattern ? ' active' : ''}`}
            aria-label={CARD_BACK_LABELS[pattern]}
            title={CARD_BACK_LABELS[pattern]}
            aria-pressed={settings.cardBack === pattern}
            onClick={() => setSettings({ cardBack: pattern })}
          >
            <span class="cardback-preview" aria-hidden="true">
              <CardBack pattern={pattern} />
            </span>
            <span class="cardback-name">{CARD_BACK_LABELS[pattern]}</span>
          </button>
        ))}
      </div>
    </div>
  );
}

function Submenu({ id }: { id: SubmenuId }) {
  switch (id) {
    case 'sound':
      return <SoundSubmenu />;
    case 'theme':
      return <ThemeSubmenu />;
    case 'table':
      return <TableSubmenu />;
    case 'cardback':
    default:
      return <CardBackSubmenu />;
  }
}

/**
 * Universal site header: logo, hover navigation menus and a profile dropdown
 * with appearance/audio submenus and a live connection tracker.
 */
export function HeaderBar({ pingMs = 24, serverDelayMs = 12 }: HeaderBarProps) {
  const [openMenu, setOpenMenu] = useState<string | null>(null);
  const [profileOpen, setProfileOpen] = useState(false);
  const [submenu, setSubmenu] = useState<SubmenuId | null>(null);
  const [barsUpdating, setBarsUpdating] = useState(false);
  const previousLevel = useRef<number | null>(null);
  // T-90-feedback-4: expose the page gradient direction for deterministic CSS
  // and tests — Light is the inverse ("lightening") of Dark ("darkening").
  const settings = useSettings();
  const resolvedTheme = resolveTableTheme(settings.theme);

  // The tracker follows the live measured round-trip time reported by the app.
  const level = connectionLevel(pingMs);
  // Tier colour: green only for a good connection, yellow for two bars and red
  // for the last remaining bar, so the tracker reads at a glance.
  const barColor: BarColor = level >= 3 ? 'green' : level === 2 ? 'yellow' : 'red';

  // Bars animate once per quality-tier change; a steady connection stays still.
  useEffect(() => {
    if (previousLevel.current === null) {
      previousLevel.current = level;
      return;
    }
    if (previousLevel.current === level) return;
    previousLevel.current = level;
    setBarsUpdating(true);
    const timer = window.setTimeout(() => setBarsUpdating(false), 360);
    return () => window.clearTimeout(timer);
  }, [level]);

  return (
    <header
      class="site-header"
      data-zone="site-header"
      data-theme={resolvedTheme}
      data-header-gradient={resolvedTheme === 'light' ? 'lightening' : 'darkening'}
    >
      <a class="header-brand" href="#/" onClick={() => setOpenMenu(null)}>
        <svg
          class="header-logo"
          data-testid="header-logo"
          viewBox="0 0 32 32"
          aria-hidden="true"
        >
          {/* Two fanned playing cards with a trump diamond. */}
          <rect
            x="4"
            y="8"
            width="15"
            height="20"
            rx="2.5"
            fill="none"
            stroke="currentColor"
            stroke-width="2"
            opacity="0.55"
            transform="rotate(-10 11.5 18)"
          />
          <rect
            x="12"
            y="4"
            width="16"
            height="23"
            rx="2.5"
            fill="none"
            stroke="currentColor"
            stroke-width="2"
          />
          <path d="M20 9 24.5 15 20 21 15.5 15z" fill="currentColor" />
        </svg>
        <span class="header-brand-text">LIDURAK</span>
      </a>

      <nav class="header-nav" aria-label="Main">
        {NAV_MENUS.map((menu) => {
          const open = openMenu === menu.id;
          return (
            <div
              key={menu.id}
              class="header-menu"
              data-open={open ? 'true' : 'false'}
              onMouseEnter={() => setOpenMenu(menu.id)}
              onMouseLeave={() => setOpenMenu(null)}
            >
              <button
                type="button"
                class="header-menu-trigger"
                aria-haspopup="true"
                aria-expanded={open}
                onMouseEnter={() => setOpenMenu(menu.id)}
                onMouseLeave={() => setOpenMenu(null)}
              >
                {menu.label}
              </button>
              <ul class="header-menu-dropdown" role="menu" aria-label={`${menu.label} menu`}>
                {menu.links.map((link) => (
                  <li key={link.label} role="none">
                    <a role="menuitem" href={link.href}>
                      {link.label}
                    </a>
                  </li>
                ))}
              </ul>
            </div>
          );
        })}
      </nav>

      <div class="header-profile">
        <button
          type="button"
          class="profile-button"
          aria-label="Account menu"
          aria-haspopup="true"
          aria-expanded={profileOpen}
          onClick={() => {
            setProfileOpen((open) => !open);
            setSubmenu(null);
          }}
        >
          <svg class="profile-icon" viewBox="0 0 24 24" aria-hidden="true">
            <circle cx="12" cy="12" r="9.6" fill="none" stroke="currentColor" stroke-width="1.6" />
            <circle cx="12" cy="9.4" r="3.1" fill="currentColor" />
            <path
              d="M5.9 18.6c1.4-2.6 3.6-3.9 6.1-3.9s4.7 1.4 6.1 3.9"
              fill="none"
              stroke="currentColor"
              stroke-width="1.6"
              stroke-linecap="round"
            />
          </svg>
          <span class="profile-name">Guest</span>
        </button>

        {profileOpen ? (
          <div class="profile-dropdown" role="menu" aria-label="Profile menu">
            {submenu ? (
              // The submenu replaces the main list in place: its header carries a
              // back chevron and the title, and returns to the main menu.
              <div class="profile-submenu-panel" role="none">
                <button
                  type="button"
                  class="submenu-header"
                  data-testid="submenu-back"
                  data-submenu={submenu}
                  aria-label="Back to profile menu"
                  onClick={() => setSubmenu(null)}
                >
                  <BackChevron />
                  <span class="submenu-title">{SUBMENU_LABELS[submenu]}</span>
                </button>
                <div
                  class="settings-panel"
                  role="menu"
                  aria-label={`${SUBMENU_LABELS[submenu]} settings`}
                >
                  <Submenu id={submenu} />
                </div>
              </div>
            ) : (
              <div class="profile-menu-main" role="none">
                {PROFILE_ITEMS.map((item) => (
                  <button
                    type="button"
                    role="menuitem"
                    key={item.id}
                    class="profile-item"
                    aria-haspopup={item.submenu ? 'menu' : undefined}
                    onClick={() => {
                      if (item.submenu) setSubmenu(item.submenu);
                    }}
                  >
                    <MenuIcon name={item.icon} />
                    <span class="profile-item-label">{item.label}</span>
                    {item.submenu ? <Chevron /> : null}
                  </button>
                ))}
              </div>
            )}

            <div class="connection-tracker" aria-label="Connection">
              <div class="connection-metrics">
                <span class="connection-ping">
                  <span class="connection-label" data-testid="ping-label">
                    PING
                  </span>
                  <span class="connection-value" data-testid="ping-value">
                    {pingMs} ms
                  </span>
                </span>
                <span class="connection-delay">
                  <span class="connection-label" data-testid="server-delay-label">
                    SERVER DELAY
                  </span>
                  <span class="connection-value" data-testid="server-delay-value">
                    {serverDelayMs} ms
                  </span>
                </span>
              </div>
              <div
                class={`signal-bars${barsUpdating ? ' connection-bars-updating' : ''}`}
                role="img"
                aria-label={`Connection strength: ${level} of 4`}
                data-level={level}
                data-bar-color={barColor}
                data-updating={barsUpdating ? 'true' : 'false'}
              >
                {[1, 2, 3, 4].map((bar) => {
                  const active = bar <= level;
                  return (
                    <span
                      key={bar}
                      class={`signal-bar${active ? ' active' : ''}`}
                      data-bar={bar}
                      data-active={active ? 'true' : 'false'}
                      data-bar-color={active ? barColor : undefined}
                    />
                  );
                })}
              </div>
            </div>
          </div>
        ) : null}
      </div>
    </header>
  );
}

export default HeaderBar;
