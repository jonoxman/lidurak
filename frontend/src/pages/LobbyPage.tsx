import { useEffect, useState } from 'preact/hooks';
import {
  checkServerHealth,
  createGame,
  createPresetGame,
  QA_SCENARIOS,
  type CreatedGame,
} from '../api/client';
import {
  connectLobbySocket,
  fetchLobbyRooms,
  type LobbySocket,
} from '../api/lobbyClient';
import { getOrCreateSession, updateGuestName } from '../api/sessionClient';
import { CreateInviteTab } from '../components/lobby/CreateInviteTab';
import { LobbyPoolTab } from '../components/lobby/LobbyPoolTab';
import { QaLobbyPresets } from '../components/lobby/QaLobbyPresets';
import { QuickPairingTab } from '../components/lobby/QuickPairingTab';
import { navigateToGame } from '../router/useRoute';
import type { PlayerType } from '../types';
import type { GuestSession, LobbyRoomSummary, SocketStatus } from '../types/multiplayer';
import '../styles/table.css';
import '../styles/lobby.css';

const DEFAULT_NAMES = ['Alice', 'Bob', 'Carol', 'Dave'];

/** Seat choices offered per player row; values match the backend's `playerTypes`. */
const SEAT_TYPES = [
  { value: 'human', label: 'Human' },
  { value: 'randomBot', label: 'RandomBot' },
  { value: 'basicBot', label: 'BasicBot' },
] as const;

/** How often an unready backend is re-probed before the lobby unlocks. */
const HEALTH_POLL_MS = 1000;

/** Gateway/proxy statuses that mean "the backend is still warming up". */
const WARMUP_STATUS = /50[0234]/;

type LobbyTabId = 'quick' | 'pool' | 'invite';

const LOBBY_TABS: ReadonlyArray<{ id: LobbyTabId; label: string }> = [
  { id: 'quick', label: 'Quick Pairing' },
  { id: 'pool', label: 'Lobby Pool' },
  { id: 'invite', label: 'Create a Game' },
];

interface CreatedRoom {
  gameId: string;
  players: { id: string; name: string }[];
}

export interface LobbyPageProps {
  /**
   * Start with the lobby already unlocked, skipping the readiness probe. Used by
   * tests (and any caller that already knows the backend is up).
   */
  initialServerReady?: boolean;
}

/** True when a failed create looks like the server was still starting up. */
function isServerWarmupFailure(reason: unknown): boolean {
  if (!(reason instanceof Error)) return false;
  // `fetch` rejects with a TypeError when the proxy has no upstream yet.
  if (reason.name === 'TypeError') return true;
  return WARMUP_STATUS.test(reason.message);
}

/**
 * Opens a live M2 room at `/g/:gameId` through the History-API router, so the
 * URL matches the backend's `inviteUrl` and survives a direct reload.
 */
function openGame(gameId: string): void {
  navigateToGame(gameId);
}

/**
 * The homepage lobby.
 *
 * The M2 shell provides Quick Pairing, the live Lobby Pool and the invite
 * configurator; the local hotseat panel below it keeps the existing local game
 * editor (names, seat types, Chaos / Transparent / Dev modes and the QA
 * scenarios) working unchanged.
 */
export function LobbyPage({ initialServerReady = false }: LobbyPageProps = {}) {
  const [serverReady, setServerReady] = useState(initialServerReady);

  // --- M2 identity, tabs and live lobby state -----------------------------
  const [session, setSession] = useState<GuestSession | null>(null);
  const [editingName, setEditingName] = useState(false);
  const [nameDraft, setNameDraft] = useState('');
  const [savingName, setSavingName] = useState(false);
  const [tab, setTab] = useState<LobbyTabId>('quick');
  const [poolOpened, setPoolOpened] = useState(false);
  const [rooms, setRooms] = useState<LobbyRoomSummary[]>([]);
  const [poolStatus, setPoolStatus] = useState<SocketStatus | 'idle'>('idle');
  const [notice, setNotice] = useState<string | null>(null);

  // Probe `GET /api/health` until the backend answers, then unlock the page so
  // a click can never land on a proxy 500 while the server is still booting.
  useEffect(() => {
    if (serverReady) return;
    let cancelled = false;
    let timer: ReturnType<typeof setTimeout> | undefined;

    const probe = async () => {
      let ready = false;
      try {
        ready = await checkServerHealth();
      } catch {
        // An unreachable (or unmocked) health check simply is not ready yet.
        ready = false;
      }
      if (cancelled) return;
      if (ready) {
        setServerReady(true);
      } else {
        timer = setTimeout(probe, HEALTH_POLL_MS);
      }
    };

    void probe();
    return () => {
      cancelled = true;
      if (timer !== undefined) clearTimeout(timer);
    };
  }, [serverReady]);

  // Hydrate the guest badge and open the lobby socket immediately.
  //
  // The socket carries three things the page needs while it is on any tab:
  // the live pool, the connection badge and Quick Pairing's `matchFound`. It
  // is not tied to the Lobby Pool tab, so a searching player is still told
  // when their table is full.
  useEffect(() => {
    let cancelled = false;
    let socket: LobbySocket | null = null;

    getOrCreateSession()
      .then((hydrated) => {
        if (cancelled) return;
        setSession(hydrated);
        setNameDraft(hydrated.displayName);
      })
      .catch(() => {
        // Keep the neutral "Guest" placeholder when the session is offline.
      });

    fetchLobbyRooms()
      .then((open) => {
        if (!cancelled) setRooms(open);
      })
      .catch(() => {
        // The socket snapshot supersedes a failed hydration.
      });

    try {
      socket = connectLobbySocket({
        onSnapshot: (open) => {
          if (!cancelled) setRooms(open);
        },
        onUpdated: (open) => {
          if (!cancelled) setRooms(open);
        },
        onMatchFound: (gameId) => {
          if (!cancelled) openGame(gameId);
        },
        onStatusChange: (status) => {
          if (!cancelled) setPoolStatus(status);
        },
      });
    } catch {
      // A browser without a WebSocket keeps the REST hydration above.
    }

    return () => {
      cancelled = true;
      socket?.close();
    };
  }, []);

  const saveGuestName = (event: Event) => {
    event.preventDefault();
    const nextName = nameDraft.trim();
    if (nextName.length === 0) {
      setEditingName(false);
      return;
    }
    setSavingName(true);
    setNotice(null);
    updateGuestName(nextName)
      .then((renamed) => {
        setSession(renamed);
        setNameDraft(renamed.displayName);
        setEditingName(false);
      })
      .catch((reason: unknown) => {
        setNotice(reason instanceof Error ? reason.message : String(reason));
      })
      .finally(() => setSavingName(false));
  };

  const selectTab = (next: LobbyTabId) => {
    setTab(next);
    // The pool panel mounts lazily; its rooms already stream in from the
    // page-level socket.
    if (next === 'pool') setPoolOpened(true);
  };

  const handleSeeded = (seededRooms: LobbyRoomSummary[]) => {
    setRooms(seededRooms);
    setPoolOpened(true);
    setTab('pool');
  };

  const liveLabel =
    poolStatus === 'connected'
      ? 'Lobby live'
      : poolStatus === 'reconnecting'
        ? 'Reconnecting'
        : poolStatus === 'disconnected'
          ? 'Lobby offline'
          : 'Lobby idle';

  return (
    <section class="page lobby-page" aria-label="Lobby">
      {serverReady ? (
        <>
          <div class="m2-lobby" data-testid="m2-lobby">
            <header class="m2-lobby-header">
              <div class="m2-lobby-brand">
                <span class="m2-lobby-brand-mark" aria-hidden="true">
                  ♠
                </span>
                <span class="m2-lobby-brand-name">LIDURAK</span>
                <span class="m2-lobby-tagline">Play Durak with friends</span>
              </div>
              <div class="m2-lobby-identity">
                <span
                  class="m2-lobby-indicator"
                  data-status={poolStatus}
                  data-testid="lobby-connection"
                >
                  <span class="m2-lobby-indicator-dot" aria-hidden="true" />
                  {liveLabel}
                </span>
                {editingName ? (
                  <form class="m2-guest-form" onSubmit={saveGuestName}>
                    <input
                      class="m2-guest-input"
                      aria-label="Guest name"
                      maxLength={20}
                      value={nameDraft}
                      onInput={(event) =>
                        setNameDraft((event.currentTarget as HTMLInputElement).value)
                      }
                    />
                    <button type="submit" class="m2-button primary" disabled={savingName}>
                      {savingName ? 'Saving…' : 'Save'}
                    </button>
                    <button
                      type="button"
                      class="m2-button secondary"
                      onClick={() => setEditingName(false)}
                    >
                      Cancel
                    </button>
                  </form>
                ) : (
                  <button
                    type="button"
                    class="m2-guest-badge"
                    aria-label="Edit guest name"
                    onClick={() => {
                      setNameDraft(session?.displayName ?? '');
                      setEditingName(true);
                    }}
                  >
                    {session?.displayName ?? 'Guest'}
                  </button>
                )}
              </div>
            </header>

            <nav class="m2-lobby-tabs" role="tablist" aria-label="Lobby sections">
              {LOBBY_TABS.map((entry) => (
                <button
                  key={entry.id}
                  type="button"
                  role="tab"
                  class={`m2-lobby-tab${tab === entry.id ? ' active' : ''}`}
                  aria-selected={tab === entry.id}
                  onClick={() => selectTab(entry.id)}
                >
                  {entry.label}
                  {entry.id === 'pool' && rooms.length > 0 ? (
                    <span class="m2-tab-count">{rooms.length}</span>
                  ) : null}
                </button>
              ))}
            </nav>

            {notice ? (
              <p class="m2-status-text" role="status">
                {notice}
              </p>
            ) : null}

            {tab === 'quick' ? <QuickPairingTab onMatched={openGame} /> : null}
            {tab === 'invite' ? <CreateInviteTab onCreated={openGame} /> : null}
            {poolOpened ? (
              <div class="m2-tab-panel" hidden={tab !== 'pool'}>
                <LobbyPoolTab
                  rooms={rooms}
                  onRoomsChange={setRooms}
                  onJoin={openGame}
                  onCreateRoom={() => setTab('invite')}
                />
              </div>
            ) : null}

            <QaLobbyPresets onSeeded={handleSeeded} onOpenGame={openGame} />
          </div>

          <LocalGameSection onServerWarmup={() => setServerReady(false)} />
        </>
      ) : (
        <div class="server-loading-page" data-testid="server-loading" role="status">
          <span
            class="lobby-loading-spinner"
            data-testid="lobby-loading-spinner"
            aria-hidden="true"
          />
          <p class="server-loading-message">Starting game server, please wait…</p>
        </div>
      )}
    </section>
  );
}

interface LocalGameSectionProps {
  /** Re-locks the lobby when the backend turns out to still be booting. */
  onServerWarmup: () => void;
}

/**
 * The existing local hotseat editor: names, seat types, match variants, the
 * seven QA scenarios and the created-game links. It is kept intact below the
 * M2 shell so the offline/local workflow never regresses.
 */
function LocalGameSection({ onServerWarmup }: LocalGameSectionProps) {
  const [playerCount, setPlayerCount] = useState(2);
  const [names, setNames] = useState<string[]>(DEFAULT_NAMES.slice(0, 2));
  const [playerTypes, setPlayerTypes] = useState<PlayerType[]>(['human', 'human']);
  const [allowRedirect, setAllowRedirect] = useState(true);
  const [chaosMode, setChaosMode] = useState(false);
  // T-90-2 ITEM-10b: Transparent Mode reveals every hand; it is legal at every
  // player count and combines with Allow redirects / Chaos mode.
  const [transparentMode, setTransparentMode] = useState(false);
  // T-90-2 ITEM-14a: Dev Mode keeps POV switching open during live play. It is
  // on by default while testing; unchecking it hands control to the server's
  // `devMode` lock, which DOM tampering cannot override.
  const [devMode, setDevMode] = useState(true);
  const [creating, setCreating] = useState(false);
  const [created, setCreated] = useState<CreatedRoom | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [presetPending, setPresetPending] = useState(false);
  const [presetError, setPresetError] = useState<string | null>(null);

  const changeCount = (count: number) => {
    setPlayerCount(count);
    // Chaos Mode needs at least three players, so drop it when shrinking.
    if (count <= 2) setChaosMode(false);
    setNames((previous) =>
      Array.from(
        { length: count },
        (_, index) => previous[index] ?? DEFAULT_NAMES[index] ?? `Player ${index + 1}`,
      ),
    );
    // Existing seat choices survive a count change; new seats are human.
    setPlayerTypes((previous) =>
      Array.from({ length: count }, (_, index) => previous[index] ?? 'human'),
    );
  };

  const changeName = (index: number, value: string) => {
    setNames((previous) =>
      previous.map((name, current) => (current === index ? value : name)),
    );
  };

  const changeType = (index: number, value: PlayerType) => {
    setPlayerTypes((previous) =>
      previous.map((type, current) => (current === index ? value : type)),
    );
  };

  const submit = () => {
    setCreating(true);
    setError(null);
    setCreated(null);
    createGame(
      playerCount,
      names,
      allowRedirect,
      playerCount > 2 && chaosMode,
      playerTypes,
      transparentMode,
      devMode,
    )
      .then((room: CreatedGame) => {
        setCreated({
          gameId: room.gameId,
          players: room.players.map((id, index) => ({ id, name: names[index] ?? id })),
        });
      })
      .catch((reason: unknown) => {
        if (isServerWarmupFailure(reason)) {
          // The backend went away mid-startup: wait for it rather than showing
          // a raw "Could not create game (HTTP 500)" error.
          onServerWarmup();
          return;
        }
        setError(reason instanceof Error ? reason.message : String(reason));
      })
      .finally(() => setCreating(false));
  };

  // QA presets open a scripted position on the seat that makes it readable.
  const startPreset = (presetId: string) => {
    if (presetPending) return;
    setPresetPending(true);
    setPresetError(null);
    createPresetGame(presetId)
      .then((preset) => {
        window.location.hash = `#/g/${preset.gameId}?player=${encodeURIComponent(
          preset.defaultPlayerId,
        )}`;
      })
      .catch((reason: unknown) => {
        console.warn('Could not start the QA preset', reason);
        setPresetError(reason instanceof Error ? reason.message : String(reason));
      })
      .finally(() => setPresetPending(false));
  };

  return (
    <section class="local-game-section" aria-label="Local game">
      <h2>Local game</h2>
      <form
        class="lobby-form"
        onSubmit={(event) => {
          event.preventDefault();
          submit();
        }}
      >
        <label class="field">
          Players
          <select
            value={playerCount}
            onChange={(event) =>
              changeCount(Number((event.target as HTMLSelectElement).value))
            }
          >
            <option value={2}>2 players</option>
            <option value={3}>3 players</option>
            <option value={4}>4 players</option>
          </select>
        </label>

        <div class="name-fields">
          {names.map((name, index) => (
            <div class="player-seat" key={index}>
              <label class="field">
                Player {index + 1}
                <input
                  value={name}
                  onInput={(event) =>
                    changeName(index, (event.target as HTMLInputElement).value)
                  }
                />
              </label>
              <label class="field">
                Type
                <select
                  aria-label={`Player ${index + 1} type`}
                  data-testid={`player-type-${index}`}
                  value={playerTypes[index] ?? 'human'}
                  onChange={(event) =>
                    changeType(
                      index,
                      (event.target as HTMLSelectElement).value as PlayerType,
                    )
                  }
                >
                  {SEAT_TYPES.map((seat) => (
                    <option value={seat.value} key={seat.value}>
                      {seat.label}
                    </option>
                  ))}
                </select>
              </label>
            </div>
          ))}
        </div>

        <label class="checkbox-field">
          <input
            type="checkbox"
            checked={allowRedirect}
            onChange={(event) => setAllowRedirect((event.target as HTMLInputElement).checked)}
          />
          Allow redirects
        </label>

        {playerCount > 2 ? (
          <label class="checkbox-field">
            <input
              type="checkbox"
              checked={chaosMode}
              onChange={(event) => setChaosMode((event.target as HTMLInputElement).checked)}
            />
            Chaos mode (attack any player)
          </label>
        ) : null}

        <label class="checkbox-field">
          <input
            type="checkbox"
            data-testid="transparent-mode-checkbox"
            checked={transparentMode}
            onChange={(event) =>
              setTransparentMode((event.target as HTMLInputElement).checked)
            }
          />
          Transparent mode (all hands visible)
        </label>

        <label class="checkbox-field">
          <input
            type="checkbox"
            data-testid="dev-mode-checkbox"
            checked={devMode}
            onChange={(event) => setDevMode((event.target as HTMLInputElement).checked)}
          />
          Dev mode (allow POV switching)
        </label>

        <button type="submit" class="action-button green" disabled={creating}>
          {creating ? 'Creating…' : 'Create Game'}
        </button>
      </form>

      <section
        class="panel qa-scenarios-panel"
        data-testid="qa-scenarios"
        aria-label="QA Scenarios"
      >
        <h2>⚡ QA Scenarios</h2>
        <div class="qa-scenario-buttons">
          {QA_SCENARIOS.map((scenario) => (
            <button
              key={scenario.id}
              type="button"
              class="qa-scenario-button"
              data-testid={`preset-btn-${scenario.id}`}
              data-preset={scenario.id}
              disabled={presetPending}
              onClick={() => startPreset(scenario.id)}
            >
              {scenario.label}
            </button>
          ))}
        </div>
        {presetError ? (
          <p class="qa-scenario-error" role="alert">
            {presetError}
          </p>
        ) : null}
      </section>

      {error ? (
        <p class="error-banner" role="alert">
          {error}
        </p>
      ) : null}

      {created ? (
        <section class="created-game" aria-label="Created game">
          <p>
            Game <code>{created.gameId}</code> created. Open a player view:
          </p>
          <nav class="player-tabs">
            {created.players.map((player) => (
              <a key={player.id} href={`#/g/${created.gameId}?player=${player.id}`}>
                {player.name} ({player.id})
              </a>
            ))}
          </nav>
        </section>
      ) : null}
    </section>
  );
}
