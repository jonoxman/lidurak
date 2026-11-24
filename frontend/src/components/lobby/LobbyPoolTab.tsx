import { useState } from 'preact/hooks';
import { joinRoom, seedLobbyPreset } from '../../api/lobbyClient';
import type { LobbyRoomSummary } from '../../types/multiplayer';

export interface LobbyPoolTabProps {
  /** Opens `/g/:gameId` after a successful join. */
  onJoin: (gameId: string) => void;
  /**
   * The live pool, owned by the page-level `/ws/lobby` socket. The socket is
   * opened as soon as the lobby mounts, so the pool is already streaming when
   * this tab is first shown.
   */
  rooms?: LobbyRoomSummary[];
  /** Reports rooms this tab seeded, so the page's live list stays in sync. */
  onRoomsChange?: (rooms: LobbyRoomSummary[]) => void;
  /** Switches to the Create a Game tab from the empty state. */
  onCreateRoom?: () => void;
}

/**
 * The live Lobby Pool.
 *
 * `LobbyPage` owns the socket and hands the authoritative
 * `LobbySnapshot`/`LobbyUpdated` rooms down as a prop; this tab only renders
 * them and performs the one-click joins.
 */
export function LobbyPoolTab({
  onJoin,
  rooms = [],
  onRoomsChange,
  onCreateRoom,
}: LobbyPoolTabProps) {
  const [joining, setJoining] = useState<string | null>(null);
  const [seeding, setSeeding] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const join = async (gameId: string) => {
    if (joining !== null) return;
    setJoining(gameId);
    setError(null);
    try {
      const joined = await joinRoom(gameId);
      onJoin(joined.gameId);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : String(reason));
    } finally {
      setJoining(null);
    }
  };

  const seed = async () => {
    if (seeding) return;
    setSeeding(true);
    setError(null);
    try {
      const seeded = await seedLobbyPreset();
      onRoomsChange?.(seeded.rooms);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : String(reason));
    } finally {
      setSeeding(false);
    }
  };

  return (
    <section class="m2-panel lobby-pool" aria-label="Lobby Pool">
      <h2 class="m2-panel-title">Lobby Pool</h2>
      <p class="m2-panel-hint">
        Open public rooms, updated live. Join any table with a free seat.
      </p>

      {rooms.length === 0 ? (
        <div class="lobby-pool-empty" data-testid="lobby-pool-empty">
          <p>No open rooms right now.</p>
          <div class="lobby-pool-empty-actions">
            {onCreateRoom ? (
              <button type="button" class="m2-button" onClick={onCreateRoom}>
                Create a room
              </button>
            ) : null}
            <button
              type="button"
              class="m2-button secondary"
              disabled={seeding}
              onClick={() => void seed()}
            >
              {seeding ? 'Seeding…' : 'Seed QA rooms'}
            </button>
          </div>
        </div>
      ) : (
        <ul class="lobby-pool-list">
          {rooms.map((room) => (
            <li
              key={room.gameId}
              class="lobby-pool-row"
              data-testid={`pool-room-${room.gameId}`}
            >
              <span class="lobby-pool-host">
                <span class="lobby-pool-host-name">{room.hostName}</span>
                <span class="lobby-pool-game-id">{room.gameId}</span>
              </span>
              <span class="lobby-pool-seats">
                {room.filledSeats} / {room.playerCount}
              </span>
              <span class="lobby-pool-badges">
                <span class={`pool-badge ${room.allowRedirect ? 'on' : 'off'}`}>
                  Redirect {room.allowRedirect ? 'ON' : 'OFF'}
                </span>
                <span class="pool-badge">
                  {room.playerCount === 4 ? '52-card' : '36-card'} deck
                </span>
                <span class="pool-badge clock">{room.turnTimeoutSeconds}s</span>
              </span>
              <button
                type="button"
                class="m2-button"
                disabled={joining !== null}
                onClick={() => void join(room.gameId)}
              >
                {joining === room.gameId ? 'Joining…' : 'Join'}
              </button>
            </li>
          ))}
        </ul>
      )}

      {error ? (
        <p class="m2-status-text" role="status">
          {error}
        </p>
      ) : null}
    </section>
  );
}
