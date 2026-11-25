import { useState } from 'preact/hooks';
import { createRoom } from '../../api/lobbyClient';
import type { DeckSize, PlayerCount, SeatType } from '../../types/multiplayer';

export interface CreateInviteTabProps {
  /** Opens `/g/:gameId` with the freshly created room. */
  onCreated: (gameId: string) => void;
  /** The creator's guest name, shown on their own seat. */
  guestName?: string;
  /**
   * ITEM-7d: whether the creator may deselect their own seat. Dev mode
   * (`npm run dev` / `./play-local.sh`) allows an all-bot spectator match;
   * production locks seat 0 to the creator.
   */
  allowAllBots?: boolean;
}

const PLAYER_COUNTS: ReadonlyArray<PlayerCount> = [2, 3, 4];
const TURN_CLOCKS = [15, 30, 60] as const;
const SEAT_TYPES: ReadonlyArray<{ value: SeatType; label: string }> = [
  { value: 'human', label: 'Human' },
  { value: 'randomBot', label: 'RandomBot' },
  { value: 'basicBot', label: 'BasicBot' },
];

const SEAT_LABEL: Record<SeatType, string> = {
  human: 'Human',
  randomBot: 'RandomBot',
  basicBot: 'BasicBot',
};

/** Person silhouette for a human seat. */
function HumanIcon() {
  return (
    <svg class="create-seat-icon" viewBox="0 0 24 24" aria-hidden="true" focusable="false">
      <circle cx="12" cy="7.5" r="3.6" fill="currentColor" />
      <path d="M4.5 20a7.5 7.5 0 0 1 15 0z" fill="currentColor" />
    </svg>
  );
}

/** Dice for the RandomBot seat. */
function DiceIcon() {
  return (
    <svg class="create-seat-icon" viewBox="0 0 24 24" aria-hidden="true" focusable="false">
      <rect
        x="3.5"
        y="3.5"
        width="17"
        height="17"
        rx="3.5"
        fill="none"
        stroke="currentColor"
        stroke-width="1.8"
      />
      <circle cx="8.5" cy="8.5" r="1.5" fill="currentColor" />
      <circle cx="15.5" cy="8.5" r="1.5" fill="currentColor" />
      <circle cx="12" cy="12" r="1.5" fill="currentColor" />
      <circle cx="8.5" cy="15.5" r="1.5" fill="currentColor" />
      <circle cx="15.5" cy="15.5" r="1.5" fill="currentColor" />
    </svg>
  );
}

/** Chip/robot head for the BasicBot seat. */
function BotIcon() {
  return (
    <svg class="create-seat-icon" viewBox="0 0 24 24" aria-hidden="true" focusable="false">
      <rect
        x="4"
        y="7"
        width="16"
        height="12"
        rx="3"
        fill="none"
        stroke="currentColor"
        stroke-width="1.8"
      />
      <path d="M12 7V4" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" />
      <circle cx="12" cy="3.2" r="1.2" fill="currentColor" />
      <circle cx="9" cy="13" r="1.4" fill="currentColor" />
      <circle cx="15" cy="13" r="1.4" fill="currentColor" />
      <path d="M9.5 16.5h5" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" />
    </svg>
  );
}

function SeatIcon({ type }: { type: SeatType }) {
  if (type === 'randomBot') return <DiceIcon />;
  if (type === 'basicBot') return <BotIcon />;
  return <HumanIcon />;
}

/**
 * Create a Game: configure the table and open it immediately.
 *
 * The first choice is always visibility: a private room is only reachable
 * through its `/g/:gameId` URL, while a public one is also listed in the Lobby
 * Pool. Player count, deck, redirects and the turn clock sit in the left
 * column; the visual seat map fills the other half of the panel, so adding bot
 * seats does not make the panel taller.
 */
export function CreateInviteTab({
  onCreated,
  guestName,
  allowAllBots = import.meta.env.DEV,
}: CreateInviteTabProps) {
  const [playerCount, setPlayerCount] = useState<PlayerCount>(2);
  const [deckChoice, setDeckChoice] = useState<DeckSize>(36);
  const [allowRedirect, setAllowRedirect] = useState(true);
  const [turnTimeoutSeconds, setTurnTimeoutSeconds] = useState<number>(15);
  const [isPublic, setIsPublic] = useState(false);
  const [seatTypes, setSeatTypes] = useState<SeatType[]>(['human', 'human']);
  const [creating, setCreating] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // ITEM-6b: a four-seat table always plays the full deck, so `52 cards` is
  // forced (and `36 cards` disabled) without losing the shorter-table choice.
  const deckSize: DeckSize = playerCount === 4 ? 52 : deckChoice;

  const changePlayerCount = (count: PlayerCount) => {
    setPlayerCount(count);
    setSeatTypes((previous) =>
      Array.from({ length: count }, (_, index) => previous[index] ?? 'human'),
    );
  };

  const changeSeatType = (index: number, type: SeatType) => {
    if (index === 0 && !allowAllBots) return;
    setSeatTypes((previous) =>
      previous.map((current, seat) => (seat === index ? type : current)),
    );
  };

  const submit = async () => {
    if (creating) return;
    setCreating(true);
    setError(null);
    try {
      const allBots = seatTypes.every((type) => type !== 'human');
      const creatorSeatIndex = allBots ? null : seatTypes.indexOf('human');
      const room = await createRoom({
        playerCount,
        allowRedirect,
        turnTimeoutSeconds,
        isPublic,
        deckSize,
        seatTypes,
        creatorSeatIndex,
        spectateAsCreator: allBots,
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

      <form
        class="create-invite-form"
        onSubmit={(event) => {
          event.preventDefault();
          void submit();
        }}
      >
        <div class="create-invite-settings">
          {/* ITEM-2c: visibility is the first decision of the form. */}
          <fieldset class="create-invite-group" data-testid="create-game-visibility">
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
                  onClick={() => changePlayerCount(count)}
                >
                  {count}
                </button>
              ))}
            </div>
          </fieldset>

          {/* ITEM-6b: 36 or 52 cards for 2P/3P; a 4P table is always 52. */}
          <fieldset class="create-invite-group" data-testid="create-game-deck-size">
            <legend>Deck</legend>
            <div class="segmented" role="group" aria-label="Deck size">
              <button
                type="button"
                class="segmented-option"
                aria-pressed={deckSize === 36}
                disabled={playerCount === 4}
                onClick={() => setDeckChoice(36)}
              >
                36 cards
              </button>
              <button
                type="button"
                class="segmented-option"
                aria-pressed={deckSize === 52}
                onClick={() => setDeckChoice(52)}
              >
                52 cards
              </button>
            </div>
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
        </div>

        {/* ITEM-7d: the seat map uses the unused right half of the panel. */}
        <div class="create-invite-seats">
          <div
            class="create-seat-map"
            data-testid="create-game-seat-map"
            data-player-count={playerCount}
          >
            {seatTypes.map((type, index) => {
              const isCreator = index === 0 && type === 'human';
              const badge = isCreator ? (guestName ?? 'You') : SEAT_LABEL[type];
              const locked = index === 0 && !allowAllBots;
              return (
                <div
                  key={index}
                  class="create-seat-card"
                  data-seat-index={index}
                  data-seat-type={type}
                  data-testid={`seat-card-${index}`}
                >
                  <span class="create-seat-badge">
                    <SeatIcon type={type} />
                    <span class="create-seat-name">{badge}</span>
                  </span>
                  <div class="create-seat-options" role="group" aria-label={`Seat ${index + 1}`}>
                    {SEAT_TYPES.map((option) => (
                      <button
                        key={option.value}
                        type="button"
                        class="create-seat-option"
                        aria-label={option.label}
                        aria-pressed={type === option.value}
                        title={option.label}
                        disabled={locked}
                        onClick={() => changeSeatType(index, option.value)}
                      >
                        <SeatIcon type={option.value} />
                      </button>
                    ))}
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      </form>

      {error ? (
        <p class="m2-status-text" role="status">
          {error}
        </p>
      ) : null}
    </section>
  );
}
