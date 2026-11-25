import { useEffect, useRef, useState } from 'preact/hooks';
import {
  checkServerHealth,
  createGame,
  createPresetGame,
  QA_SCENARIOS,
  type CreatedGame,
} from '../api/client';
import {
  cancelQuickPair,
  connectLobbySocket,
  fetchLobbyRooms,
  joinQuickPair,
  type LobbySocket,
} from '../api/lobbyClient';
import { getOrCreateSession } from '../api/sessionClient';
import { CreateInviteTab } from '../components/lobby/CreateInviteTab';
import { LobbyPoolTab } from '../components/lobby/LobbyPoolTab';
import { QaLobbyPresets } from '../components/lobby/QaLobbyPresets';
import { QuickPairingTab } from '../components/lobby/QuickPairingTab';
import { navigateToGame } from '../router/useRoute';
import type { PlayerType } from '../types';
import type {
  GuestSession,
  LobbyRoomSummary,
  QuickPairRequest,
  QuickPairSearching,
  SocketStatus,
} from '../types/multiplayer';
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
 * URL matches the backend's `inviteUrl` and survives a direct reload. A repeat
 * call for the room already on screen never pushes a duplicate entry.
 */
function openGame(gameId: string): void {
  const target = `/g/${encodeURIComponent(gameId)}`;
  if (typeof window !== 'undefined' && window.location.pathname === target) return;
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
  // T-90-4 ITEM-2: the guest name is edited from the global `HeaderBar`, so the
  // page only hydrates the session for its API calls and the creator's seat.
  const [session, setSession] = useState<GuestSession | null>(null);
  const [tab, setTab] = useState<LobbyTabId>('quick');
  const [poolOpened, setPoolOpened] = useState(false);
  const [rooms, setRooms] = useState<LobbyRoomSummary[]>([]);
  const [poolStatus, setPoolStatus] = useState<SocketStatus | 'idle'>('idle');

  // --- Quick Pairing queue (owned here so it survives tab switches) --------
  const [searching, setSearching] = useState<QuickPairSearching | null>(null);
  const [quickPairPending, setQuickPairPending] = useState(false);
  const [quickPairError, setQuickPairError] = useState<string | null>(null);
  // Bumped by Cancel, a re-tile click or a match, so stale responses are inert.
  const quickPairAttempt = useRef(0);
  const quickPairPendingRef = useRef(false);
  const searchingRef = useRef<QuickPairSearching | null>(null);

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

  // Hydrate the guest badge and the initial pool count. Both calls fail
  // silently: the page stays usable, and the live socket retries on its own.
  useEffect(() => {
    let cancelled = false;

    getOrCreateSession()
      .then((hydrated) => {
        if (cancelled) return;
        setSession(hydrated);
      })
      .catch(() => {
        // Keep the neutral "Guest" placeholder when the session is offline.
      });

    fetchLobbyRooms()
      .then((open) => {
        if (!cancelled) setRooms(open);
      })
      .catch(() => {
        // The Lobby Pool tab hydrates again when it opens.
      });

    return () => {
      cancelled = true;
    };
  }, []);

  // One `/ws/lobby` subscription for the whole lobby page: a waiting quick-pair
  // player receives `quickPairMatched` immediately, and the Lobby Pool stays
  // live no matter which tab is on screen.
  useEffect(() => {
    let cancelled = false;
    let socket: LobbySocket | null = null;

    const clearSearching = () => {
      quickPairAttempt.current += 1;
      quickPairPendingRef.current = false;
      searchingRef.current = null;
      setSearching(null);
      setQuickPairPending(false);
    };

    const navigateMatched = (gameId: string) => {
      // A Cancel (or an earlier navigation) already resolved this attempt.
      if (cancelled || searchingRef.current === null) return;
      clearSearching();
      if (typeof window === 'undefined' || window.location.pathname === '/') {
        openGame(gameId);
      }
    };

    try {
      socket = connectLobbySocket({
        onSnapshot: (next) => {
          if (!cancelled) setRooms(next);
        },
        onUpdated: (next) => {
          if (!cancelled) setRooms(next);
        },
        onQuickPairMatched: (gameId) => navigateMatched(gameId),
        // Legacy `matchFound` frame; the deferred queue uses `quickPairMatched`.
        onMatchFound: (gameId) => navigateMatched(gameId),
        onStatusChange: (status) => {
          if (!cancelled) setPoolStatus(status);
        },
      });
    } catch {
      // A browser without a WebSocket still gets the REST hydration.
    }

    return () => {
      cancelled = true;
      // Leaving the page invalidates any in-flight pairing response.
      quickPairAttempt.current += 1;
      socket?.close();
    };
  }, []);

  const beginQuickPair = async (preset: QuickPairRequest) => {
    if (quickPairPendingRef.current) return;
    const attemptId = ++quickPairAttempt.current;
    quickPairPendingRef.current = true;
    setQuickPairPending(true);
    setQuickPairError(null);

    try {
      // Clicking another tile while queued leaves the previous bucket first.
      if (searchingRef.current !== null) {
        searchingRef.current = null;
        setSearching(null);
        try {
          await cancelQuickPair();
        } catch {
          // The previous bucket may already be gone.
        }
        if (quickPairAttempt.current !== attemptId) return;
      }

      const result = await joinQuickPair(preset);
      if (quickPairAttempt.current !== attemptId) {
        // Cancelled while in flight: drop the queue entry that just landed.
        if (result.status === 'searching') void cancelQuickPair().catch(() => {});
        return;
      }

      if (result.status === 'matched') {
        searchingRef.current = null;
        setSearching(null);
        openGame(result.gameId);
      } else {
        searchingRef.current = result;
        setSearching(result);
      }
    } catch (reason) {
      if (quickPairAttempt.current === attemptId) {
        setQuickPairError(reason instanceof Error ? reason.message : String(reason));
      }
    } finally {
      if (quickPairAttempt.current === attemptId) {
        quickPairPendingRef.current = false;
        setQuickPairPending(false);
      }
    }
  };

  const cancelSearch = () => {
    quickPairAttempt.current += 1;
    quickPairPendingRef.current = false;
    searchingRef.current = null;
    setSearching(null);
    setQuickPairPending(false);
    setQuickPairError(null);
    void cancelQuickPair().catch(() => {
      // A failed cancel only means the queue entry was already gone.
    });
  };

  const selectTab = (next: LobbyTabId) => {
    setTab(next);
    // The pool panel mounts on first open; its rooms stay live through the
    // page-level socket even while another tab is visible.
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
            {/* T-90-4 ITEM-2: `HeaderBar` is the app's only header. The lobby
                keeps its tab row with the live-pool status beside it. */}
            <div class="m2-lobby-topline">
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

              <span
                class="m2-lobby-indicator"
                data-status={poolStatus}
                data-testid="lobby-connection"
              >
                <span class="m2-lobby-indicator-dot" aria-hidden="true" />
                {liveLabel}
              </span>
            </div>

            {tab === 'quick' ? (
              <QuickPairingTab
                searching={searching}
                pending={quickPairPending}
                error={quickPairError}
                onSearch={(preset) => void beginQuickPair(preset)}
                onCancel={cancelSearch}
              />
            ) : null}
            {tab === 'invite' ? (
              <CreateInviteTab guestName={session?.displayName} onCreated={openGame} />
            ) : null}
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
