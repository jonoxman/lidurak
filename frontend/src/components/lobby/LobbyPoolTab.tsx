import { useEffect, useState } from 'preact/hooks';
import {
  connectLobbySocket,
  fetchLobbyRooms,
  joinRoom,
  seedLobbyPreset,
  type LobbySocket,
} from '../../api/lobbyClient';
import type { LobbyRoomSummary, SocketStatus } from '../../types/multiplayer';

export interface LobbyPoolTabProps {
  /** Opens `/g/:gameId` after a successful join. */
  onJoin: (gameId: string) => void;
  /** Rooms already hydrated by the page, so the first paint is not empty. */
  initialRooms?: LobbyRoomSummary[];
  /** Keeps the tab's count badge in sync with the live socket. */
  onRoomsChange?: (rooms: LobbyRoomSummary[]) => void;
  /** Feeds the page's live-lobby indicator. */
  onStatusChange?: (status: SocketStatus) => void;
  /** Switches to the Create Invite Link tab from the empty state. */
  onCreateRoom?: () => void;
}

/**
 * The live Lobby Pool.
 *
 * REST hydration renders the first paint immediately; the `/ws/lobby` socket
 * then replaces it with the authoritative `LobbySnapshot`/`LobbyUpdated`
 * frames. Every row can be joined in one click.
 */
export function LobbyPoolTab({
  onJoin,
  initialRooms = [],
  onRoomsChange,
  onStatusChange,
  onCreateRoom,
}: LobbyPoolTabProps) {
  const [rooms, setRooms] = useState<LobbyRoomSummary[]>(initialRooms);
  const [joining, setJoining] = useState<string | null>(null);
  const [seeding, setSeeding] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    let socket: LobbySocket | null = null;

    const apply = (next: LobbyRoomSummary[]) => {
      if (cancelled) return;
      setRooms(next);
      onRoomsChange?.(next);
    };

    fetchLobbyRooms()
      .then(apply)
      .catch(() => {
        // The socket snapshot supersedes a failed hydration.
      });

    try {
      socket = connectLobbySocket({
        onSnapshot: apply,
        onUpdated: apply,
        onStatusChange: (status) => {
          if (!cancelled) onStatusChange?.(status);
        },
      });
    } catch {
      // A browser without a WebSocket still gets the REST hydration.
    }

    return () => {
      cancelled = true;
      socket?.close();
    };
    // The handlers are stable for the lifetime of the tab.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

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
      setRooms(seeded.rooms);
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

