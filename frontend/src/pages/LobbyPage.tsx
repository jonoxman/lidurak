import { useEffect, useState } from 'preact/hooks';
import { checkServerHealth, createGame, type CreatedGame } from '../api/client';
import '../styles/table.css';

const DEFAULT_NAMES = ['Alice', 'Bob', 'Carol', 'Dave'];

/** Seat choices offered per player row; values match the backend's `playerTypes`. */
const SEAT_TYPES = [
  { value: 'human', label: 'Human' },
  { value: 'randomBot', label: 'RandomBot' },
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
  const [playerTypes, setPlayerTypes] = useState<string[]>(['human', 'human']);
  const [allowRedirect, setAllowRedirect] = useState(true);
  const [chaosMode, setChaosMode] = useState(false);
  const [serverReady, setServerReady] = useState(initialServerReady);
  const [creating, setCreating] = useState(false);
  const [created, setCreated] = useState<CreatedRoom | null>(null);
  const [error, setError] = useState<string | null>(null);

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

  const changeType = (index: number, value: string) => {
    setPlayerTypes((previous) =>
      previous.map((type, current) => (current === index ? value : type)),
    );
  };

  const submit = () => {
    if (!serverReady) return;
    setCreating(true);
    setError(null);
    setCreated(null);
    createGame(playerCount, names, allowRedirect, playerCount > 2 && chaosMode, playerTypes)
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
                        changeType(index, (event.target as HTMLSelectElement).value)
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

            <button type="submit" class="action-button green" disabled={creating}>
              {creating ? 'Creating…' : 'Create Game'}
            </button>
          </form>
        </>
      ) : (
        <div class="server-loading-page" data-testid="server-loading" role="status">
          <span class="server-loading-indicator" aria-hidden="true">
            <svg viewBox="0 0 24 24" width="22" height="22">
              <circle
                cx="12"
                cy="12"
                r="9"
                fill="none"
                stroke="currentColor"
                stroke-width="3"
                stroke-linecap="round"
                stroke-dasharray="10 56"
              />
            </svg>
          </span>
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
