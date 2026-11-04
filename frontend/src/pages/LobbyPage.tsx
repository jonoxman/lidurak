import { useEffect, useState } from 'preact/hooks';
import {
  checkServerHealth,
  createGame,
  createPresetGame,
  type CreatedGame,
} from '../api/client';
import type { PlayerType } from '../types';
import { setSettings } from '../state/settings';
import '../styles/table.css';

/** One-click Light-theme preset; it only repaints, so no room is created. */
export const LIGHT_THEME_PRESET_ID = 'light-theme-gradient';

const DEFAULT_NAMES = ['Alice', 'Bob', 'Carol', 'Dave'];

/** One-click scripted positions, mirrored in the game's left sidebar. */
const QA_SCENARIOS: { id: string; label: string }[] = [
  { id: '3p-redirect-bob', label: '3P Redirect (Bob POV)' },
  { id: 'chaos-4p', label: '4P Chaos Targets' },
  { id: 'surrender-half-off', label: 'Surrender Half-Off' },
  { id: 'defenseless-surrender', label: 'Defenseless Auto-Surrender' },
  { id: 'discard-and-endgame', label: 'Discard & Endgame Durak' },
  { id: 'transparent-mode', label: 'Transparent Mode' },
  { id: LIGHT_THEME_PRESET_ID, label: 'Light Theme Header' },
];

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

export function LobbyPage({ initialServerReady = false }: LobbyPageProps = {}) {
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
  const [serverReady, setServerReady] = useState(initialServerReady);
  const [creating, setCreating] = useState(false);
  const [created, setCreated] = useState<CreatedRoom | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [presetPending, setPresetPending] = useState(false);
  const [presetError, setPresetError] = useState<string | null>(null);

  // Probe `GET /api/health` until the backend answers, then unlock the form so a
  // click can never land on a proxy 500 while the server is still booting.
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
    if (!serverReady) return;
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
          setServerReady(false);
          return;
        }
        setError(reason instanceof Error ? reason.message : String(reason));
      })
      .finally(() => setCreating(false));
  };

  // QA presets open a scripted position on the seat that makes it readable.
  const startPreset = (presetId: string) => {
    // T-90-feedback-4: the Light theme check repaints the lobby in place; it
    // is deliberately backend-free so a reviewer sees the new page/header
    // gradient in one click even before creating a room.
    if (presetId === LIGHT_THEME_PRESET_ID) {
      setSettings({ theme: 'light' });
      return;
    }
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
    <section class="page lobby-page" aria-label="Lobby">
      {serverReady ? (
        <>
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
                onChange={(event) => changeCount(Number((event.target as HTMLSelectElement).value))}
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
                        changeType(index, (event.target as HTMLSelectElement).value as PlayerType)
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
                  data-testid={`qa-preset-${scenario.id}`}
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
