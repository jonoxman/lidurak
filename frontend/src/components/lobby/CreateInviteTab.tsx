import { useState } from 'preact/hooks';
import { createRoom } from '../../api/lobbyClient';
import type { PlayerCount } from '../../types/multiplayer';

export interface CreateInviteTabProps {
  /** Opens `/g/:gameId` with the freshly created room. */
  onCreated: (gameId: string) => void;
}

const PLAYER_COUNTS: ReadonlyArray<PlayerCount> = [2, 3, 4];
const TURN_CLOCKS = [15, 30, 60] as const;

/**
 * Create a Game: choose whether the table is a private link or a public pool
 * room, configure it, and open it immediately.
 *
 * A private room is only reachable through its `/g/:gameId` URL; a public one
 * is also listed in the Lobby Pool for anyone to join.
 */
export function CreateInviteTab({ onCreated }: CreateInviteTabProps) {
  const [playerCount, setPlayerCount] = useState<PlayerCount>(2);
  const [allowRedirect, setAllowRedirect] = useState(true);
  const [turnTimeoutSeconds, setTurnTimeoutSeconds] = useState<number>(15);
  const [isPublic, setIsPublic] = useState(false);
  const [creating, setCreating] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const submit = async () => {
    if (creating) return;
    setCreating(true);
    setError(null);
    try {
      const room = await createRoom({
        playerCount,
        allowRedirect,
        turnTimeoutSeconds,
        isPublic,
      });
      onCreated(room.gameId);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : String(reason));
    } finally {
      setCreating(false);
    }
  };

  return (
    <section class="m2-panel create-invite" aria-label="Create a Game">
      <h2 class="m2-panel-title">Create a Game</h2>
      <p class="m2-panel-hint">
        Choose who can join, set the table, then share the generated link with
        your opponents.
      </p>

      <form
        class="create-invite-form"
        onSubmit={(event) => {
          event.preventDefault();
          void submit();
        }}
      >
        <fieldset class="create-invite-group">
          <legend>Visibility</legend>
          <div class="segmented" role="group" aria-label="Visibility">
            <button
              type="button"
              class="segmented-option"
              aria-pressed={!isPublic}
              onClick={() => setIsPublic(false)}
            >
              Private invite link
            </button>
            <button
              type="button"
              class="segmented-option"
              aria-pressed={isPublic}
              onClick={() => setIsPublic(true)}
            >
              Public lobby pool
            </button>
          </div>
        </fieldset>

        <fieldset class="create-invite-group">
          <legend>Players</legend>
          <div class="segmented" role="group" aria-label="Player count">
            {PLAYER_COUNTS.map((count) => (
              <button
                key={count}
                type="button"
                class="segmented-option"
                aria-label={`${count} players`}
                aria-pressed={playerCount === count}
                onClick={() => setPlayerCount(count)}
              >
                {count}
              </button>
            ))}
          </div>
          <p class="create-invite-note">
            {playerCount === 4 ? '52-card deck' : '36-card deck'}
          </p>
        </fieldset>

        <label class="create-invite-toggle">
          <input
            type="checkbox"
            checked={allowRedirect}
            onChange={(event) =>
              setAllowRedirect((event.currentTarget as HTMLInputElement).checked)
            }
          />
          Redirect / reflect: {allowRedirect ? 'ON' : 'OFF'}
        </label>

        <fieldset class="create-invite-group">
          <legend>Time control per turn</legend>
          <div class="segmented" role="group" aria-label="Turn clock">
            {TURN_CLOCKS.map((seconds) => (
              <button
                key={seconds}
                type="button"
                class="segmented-option"
                aria-pressed={turnTimeoutSeconds === seconds}
                onClick={() => setTurnTimeoutSeconds(seconds)}
              >
                {seconds}s
              </button>
            ))}
          </div>
        </fieldset>

        <button type="submit" class="m2-button primary" disabled={creating}>
          {creating ? 'Creating…' : 'Create room'}
        </button>
      </form>

      {error ? (
        <p class="m2-status-text" role="status">
          {error}
        </p>
      ) : null}
    </section>
  );
}
