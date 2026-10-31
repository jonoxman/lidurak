import { useState } from 'preact/hooks';
import { SoundEngine, soundEngine } from '../audio/SoundEngine';
import { CARD_BACK_PATTERNS, CardBack } from './CardBack';
import { TABLE_TEXTURES } from '../styles/tableTextures';
import {
  ROUNDNESS_MAX,
  ROUNDNESS_MIN,
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

function Chevron() {
  return (
    <svg class="menu-chevron" viewBox="0 0 12 12" aria-hidden="true">
      <path
        d="M4.5 2.5 8 6l-3.5 3.5"
        fill="none"
        stroke="currentColor"
        stroke-width="1.8"
        stroke-linecap="round"
        stroke-linejoin="round"
      />
    </svg>
  );
}

function SoundSubmenu() {
  const [volume, setVolume] = useState(() => soundEngine.getVolume());
  const [pack, setPack] = useState(() => soundEngine.getSoundPack());
  const packs = SoundEngine.soundPacks();

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
            setVolume(next);
            soundEngine.setVolume(next);
          }}
        />
        <output class="setting-value">{Math.round(volume * 100)}%</output>
      </label>

      <div class="pack-grid" role="group" aria-label="Sound packs">
        {packs.map((option) => (
          <button
            type="button"
            key={option.id}
            class={`pack-option${pack === option.id ? ' active' : ''}`}
            aria-pressed={pack === option.id}
            onClick={() => {
              setPack(option.id);
              soundEngine.setSoundPack(option.id);
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
            class={`theme-option${settings.theme === theme.id ? ' active' : ''}`}
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
          onInput={(event) =>
            setSettings({ roundness: Number((event.target as HTMLInputElement).value) })
          }
        />
        <output class="setting-value">{settings.roundness}px</output>
      </label>
    </div>
  );
}

function TableSubmenu() {
  const settings = useSettings();
  const { brightness, contrast, hue } = settings.tableFilters;

  return (
    <div class="settings-submenu" data-testid="submenu-table">
      <div class="texture-grid" role="group" aria-label="Table textures">
        {TABLE_TEXTURES.map((texture) => (
          <button
            type="button"
            key={texture.id}
            class={`texture-option${settings.tableTexture === texture.id ? ' active' : ''}`}
            aria-label={texture.name}
            aria-pressed={settings.tableTexture === texture.id}
            onClick={() => setSettings({ tableTexture: texture.id })}
          >
            <span class="texture-swatch" style={{ background: texture.base }} aria-hidden="true" />
            <span class="texture-name">{texture.name}</span>
          </button>
        ))}
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
        {CARD_BACK_PATTERNS.map((pattern) => (
          <button
            type="button"
            key={pattern}
            class={`cardback-option${settings.cardBack === pattern ? ' active' : ''}`}
            aria-label={pattern}
            aria-pressed={settings.cardBack === pattern}
            onClick={() => setSettings({ cardBack: pattern })}
          >
            <span class="cardback-preview" aria-hidden="true">
              <CardBack pattern={pattern} />
            </span>
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

  const level = connectionLevel(pingMs);

  return (
    <header class="site-header" data-zone="site-header">
      <a class="header-logo" href="#/" onClick={() => setOpenMenu(null)}>
        LIDURAK
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
            <div class="profile-menu-main">
              {PROFILE_ITEMS.map((item) => (
                <button
                  type="button"
                  role="menuitem"
                  key={item.id}
                  class={`profile-item${item.submenu && submenu === item.submenu ? ' active' : ''}`}
                  aria-haspopup={item.submenu ? 'menu' : undefined}
                  onClick={() =>
                    setSubmenu((open) => {
                      if (!item.submenu) return null;
                      return open === item.submenu ? null : item.submenu;
                    })
                  }
                >
                  <MenuIcon name={item.icon} />
                  <span class="profile-item-label">{item.label}</span>
                  {item.submenu ? <Chevron /> : null}
                </button>
              ))}
            </div>

            {submenu ? (
              <div class="profile-submenu-panel" role="menu" aria-label={`${submenu} settings`}>
                <Submenu id={submenu} />
              </div>
            ) : null}

            <div class="connection-tracker" aria-label="Connection">
              <div class="connection-metrics">
                <span class="connection-ping">Ping: {pingMs} ms</span>
                <span class="connection-delay">Server Delay: {serverDelayMs} ms</span>
              </div>
              <div
                class="signal-bars"
                role="img"
                aria-label={`Connection strength: ${level} of 4`}
                data-level={level}
              >
                {[1, 2, 3, 4].map((bar) => (
                  <span
                    key={bar}
                    class="signal-bar"
                    data-bar={bar}
                    data-active={bar <= level ? 'true' : 'false'}
                  />
                ))}
              </div>
            </div>
          </div>
        ) : null}
      </div>
    </header>
  );
}

export default HeaderBar;
