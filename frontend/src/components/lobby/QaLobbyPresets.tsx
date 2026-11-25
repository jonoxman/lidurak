import { useState } from 'preact/hooks';
import {
  createActiveMatchPreset,
  createRoom,
  createSpectatorMatchPreset,
  launchQaSmallHandMatch,
  seedLobbyPreset,
  triggerQaQuickPairOpponent,
} from '../../api/lobbyClient';
import type { LobbyRoomSummary } from '../../types/multiplayer';

export interface QaLobbyPresetsProps {
  /** Called after seeding, with the rooms the server just opened. */
  onSeeded: (rooms: LobbyRoomSummary[]) => void;
  /** Opens `/g/:gameId` for a preset match. */
  onOpenGame: (gameId: string) => void;
}

type PresetId =
  | 'seed-lobby'
  | 'invite-room'
  | 'active-match'
  | 'spectator-match'
  | 'quick-pair-opponent'
  | 'small-hand-match';

/**
 * One-click QA scenarios for the M2 lobby.
 *
 * Every button drives the real backend, so a reviewer can verify the live pool,
 * a shareable invite room, an active projected match and a zero-leak spectator
 * view without playing a full match.
 */
export function QaLobbyPresets({ onSeeded, onOpenGame }: QaLobbyPresetsProps) {
  const [pending, setPending] = useState<PresetId | null>(null);
  const [error, setError] = useState<string | null>(null);

  const run = async (id: PresetId, action: () => Promise<void>) => {
    if (pending) return;
    setPending(id);
    setError(null);
    try {
      await action();
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : String(reason));
    } finally {
      setPending(null);
    }
  };

  const seed = () =>
    run('seed-lobby', async () => {
      const seeded = await seedLobbyPreset();
      onSeeded(seeded.rooms);
    });

  const inviteRoom = () =>
    run('invite-room', async () => {
      const room = await createRoom({
        playerCount: 2,
        allowRedirect: true,
        turnTimeoutSeconds: 15,
        isPublic: true,
      });
      onOpenGame(room.gameId);
    });

  const activeMatch = () =>
    run('active-match', async () => {
      const match = await createActiveMatchPreset(2);
      onOpenGame(match.gameId);
    });

  const spectatorMatch = () =>
    run('spectator-match', async () => {
      const match = await createSpectatorMatchPreset();
      onOpenGame(match.gameId);
    });

  // Fills the reviewer's own quick-pair bucket; the live `/ws/lobby`
  // `quickPairMatched` frame is what actually navigates a waiting player.
  const quickPairOpponent = () =>
    run('quick-pair-opponent', async () => {
      const match = await triggerQaQuickPairOpponent();
      onOpenGame(match.gameId);
    });

  const smallHandMatch = () =>
    run('small-hand-match', async () => {
      const match = await launchQaSmallHandMatch();
      onOpenGame(match.gameId);
    });

  return (
    <section
      class="m2-panel qa-lobby-presets"
      data-testid="qa-lobby-presets"
      aria-label="Lobby QA presets"
    >
      <h2 class="m2-panel-title">QA scenario presets</h2>
      <p class="m2-panel-hint">
        Jump straight to the M2 states a reviewer needs to verify.
      </p>
      <div class="qa-lobby-grid">
        <button
          type="button"
          class="m2-button secondary"
          data-testid="qa-seed-lobby"
          disabled={pending !== null}
          onClick={() => void seed()}
        >
          Seed open lobby pool
        </button>
        <button
          type="button"
          class="m2-button secondary"
          data-testid="qa-invite-room"
          disabled={pending !== null}
          onClick={() => void inviteRoom()}
        >
          Launch 2P invite room (1/2)
        </button>
        <button
          type="button"
          class="m2-button secondary"
          data-testid="qa-active-match"
          disabled={pending !== null}
          onClick={() => void activeMatch()}
        >
          Launch active projected match
        </button>
        <button
          type="button"
          class="m2-button secondary"
          data-testid="qa-spectator-match"
          disabled={pending !== null}
          onClick={() => void spectatorMatch()}
        >
          Launch spectator zero-leak view
        </button>
        <button
          type="button"
          class="m2-button secondary"
          data-testid="qa-quick-pair-opponent"
          disabled={pending !== null}
          onClick={() => void quickPairOpponent()}
        >
          Match queued quick-pair opponent
        </button>
        <button
          type="button"
          class="m2-button secondary"
          data-testid="qa-small-hand-match"
          disabled={pending !== null}
          onClick={() => void smallHandMatch()}
        >
          Launch small-hand match (4 cards)
        </button>
      </div>
      {error ? (
        <p class="m2-status-text" role="status">
          {error}
        </p>
      ) : null}
    </section>
  );
}
