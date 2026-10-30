import { useState } from 'preact/hooks';
import { createGame, type CreatedGame } from '../api/client';
import '../styles/table.css';

const DEFAULT_NAMES = ['Alice', 'Bob', 'Carol', 'Dave'];

interface CreatedRoom {
  gameId: string;
  players: { id: string; name: string }[];
}

export function LobbyPage() {
  const [playerCount, setPlayerCount] = useState(2);
  const [names, setNames] = useState<string[]>(DEFAULT_NAMES.slice(0, 2));
  const [allowRedirect, setAllowRedirect] = useState(true);
  const [creating, setCreating] = useState(false);
  const [created, setCreated] = useState<CreatedRoom | null>(null);
  const [error, setError] = useState<string | null>(null);

  const changeCount = (count: number) => {
    setPlayerCount(count);
    setNames((previous) =>
      Array.from(
        { length: count },
        (_, index) => previous[index] ?? DEFAULT_NAMES[index] ?? `Player ${index + 1}`,
      ),
    );
  };

  const changeName = (index: number, value: string) => {
    setNames((previous) =>
      previous.map((name, current) => (current === index ? value : name)),
    );
  };

  const submit = () => {
    setCreating(true);
    setError(null);
    setCreated(null);
    createGame(playerCount, names, allowRedirect)
      .then((room: CreatedGame) => {
        setCreated({
          gameId: room.gameId,
          players: room.players.map((id, index) => ({ id, name: names[index] ?? id })),
        });
      })
      .catch((reason: unknown) =>
        setError(reason instanceof Error ? reason.message : String(reason)),
      )
      .finally(() => setCreating(false));
  };

  return (
    <section class="page lobby-page" aria-label="Lobby">
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
            <label class="field" key={index}>
              Player {index + 1}
              <input
                value={name}
                onInput={(event) => changeName(index, (event.target as HTMLInputElement).value)}
              />
            </label>
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

        <button type="submit" class="action-button green" disabled={creating}>
          {creating ? 'Creating…' : 'Create Game'}
        </button>
      </form>

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
