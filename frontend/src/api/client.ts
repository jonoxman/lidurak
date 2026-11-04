import {
  parseGameReplay,
  parsePlayerGameView,
  type CreateGameRequest,
  type GameAction,
  type GameReplay,
  type PlayerGameView,
  type PlayerType,
} from '../types';

export interface CreatedGame {
  gameId: string;
  players: string[];
}

async function readJson(response: Response): Promise<unknown> {
  try {
    return await response.json();
  } catch {
    return null;
  }
}

function errorMessage(body: unknown, fallback: string): string {
  if (typeof body === 'object' && body !== null) {
    const error = (body as Record<string, unknown>).error;
    if (typeof error === 'string' && error.length > 0) return error;
  }
  return fallback;
}

/** Resolves true only when the backend answers `GET /api/health` with 2xx. */
export async function checkServerHealth(): Promise<boolean> {
  try {
    const response = await fetch('/api/health');
    return response.ok;
  } catch {
    return false;
  }
}

export async function createGame(
  playerCount: number,
  playerNames: string[],
  allowRedirect = true,
  chaosMode = false,
  playerTypes?: readonly PlayerType[],
  transparentMode?: boolean,
  devMode?: boolean,
): Promise<CreatedGame> {
  const seats: readonly PlayerType[] =
    playerTypes ?? Array.from({ length: playerCount }, (): PlayerType => 'human');
  // T-90-2: Transparent Mode and Dev Mode are forwarded verbatim, and only when
  // the caller opted in, so an ordinary `POST /api/games` body is unchanged.
  const request: CreateGameRequest = {
    playerCount,
    playerNames,
    allowRedirect,
    chaosMode,
    playerTypes: seats,
    ...(transparentMode === undefined ? {} : { transparentMode }),
    ...(devMode === undefined ? {} : { devMode }),
  };
  const response = await fetch('/api/games', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(request),
  });
  const body = await readJson(response);

  if (!response.ok) {
    throw new Error(errorMessage(body, `Could not create game (HTTP ${response.status})`));
  }
  if (typeof body !== 'object' || body === null) {
    throw new Error('Game creation response was not a JSON object');
  }

  const record = body as Record<string, unknown>;
  const gameId = record.gameId;
  if (typeof gameId !== 'string') {
    throw new Error('Game creation response did not include a gameId');
  }

  const players = Array.isArray(record.players)
    ? record.players
        .map((player) => {
          if (typeof player === 'string') return player;
          if (typeof player === 'object' && player !== null) {
            const id = (player as Record<string, unknown>).id;
            if (typeof id === 'string') return id;
          }
          return '';
        })
        .filter((id) => id.length > 0)
    : [];

  return { gameId, players };
}

/** Response of `POST /api/games/preset`: a scripted QA room and its opening seat. */
export interface CreatedPresetGame {
  gameId: string;
  players: string[];
  playerTypes: string[];
  /** The seat the table should open on for this scenario. */
  defaultPlayerId: string;
}

/**
 * Starts one of the scripted QA positions (`3p-redirect-bob`, `chaos-4p`,
 * `surrender-half-off`, `discard-and-endgame`) so a reviewer can jump straight
 * to that exact table state in one click.
 */
export async function createPresetGame(preset: string): Promise<CreatedPresetGame> {
  const response = await fetch('/api/games/preset', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ preset }),
  });
  const body = await readJson(response);

  if (!response.ok) {
    throw new Error(errorMessage(body, `Could not start the preset (HTTP ${response.status})`));
  }
  if (typeof body !== 'object' || body === null) {
    throw new Error('Preset response was not a JSON object');
  }

  const record = body as Record<string, unknown>;
  const gameId = record.gameId;
  if (typeof gameId !== 'string') {
    throw new Error('Preset response did not include a gameId');
  }

  const players = Array.isArray(record.players)
    ? record.players
        .map((player) => {
          if (typeof player === 'string') return player;
          if (typeof player === 'object' && player !== null) {
            const id = (player as Record<string, unknown>).id;
            if (typeof id === 'string') return id;
          }
          return '';
        })
        .filter((id) => id.length > 0)
    : [];
  const playerTypes = Array.isArray(record.playerTypes)
    ? record.playerTypes.filter((type): type is string => typeof type === 'string')
    : [];
  const defaultPlayerId =
    typeof record.defaultPlayerId === 'string' && record.defaultPlayerId.length > 0
      ? record.defaultPlayerId
      : (players[0] ?? 'p0');

  return { gameId, players, playerTypes, defaultPlayerId };
}

export async function getGameView(
  gameId: string,
  playerId: string,
  requesterId?: string,
): Promise<PlayerGameView> {
  // T-90-2: an explicit `requester` asks the backend which seat is asking, so
  // debug / Transparent projections can be filtered for that viewer.
  const query = requesterId ? `?requester=${encodeURIComponent(requesterId)}` : '';
  const response = await fetch(
    `/api/game/${encodeURIComponent(gameId)}/view/${encodeURIComponent(playerId)}${query}`,
  );
  const body = await readJson(response);

  if (!response.ok) {
    throw new Error(errorMessage(body, `Could not load the game view (HTTP ${response.status})`));
  }
  return parsePlayerGameView(body);
}

/** Fetches the recorded match for review mode (`GET /api/games/:gameId/replay`). */
export async function getGameReplay(gameId: string): Promise<GameReplay> {
  const response = await fetch(`/api/games/${encodeURIComponent(gameId)}/replay`);
  const body = await readJson(response);

  if (!response.ok) {
    throw new Error(errorMessage(body, `Could not load the game replay (HTTP ${response.status})`));
  }
  return parseGameReplay(body);
}

export async function sendAction(
  gameId: string,
  action: GameAction,
): Promise<PlayerGameView | { error: string }> {
  const response = await fetch(`/api/game/${encodeURIComponent(gameId)}/action`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(action),
  });
  const body = await readJson(response);

  if (!response.ok) {
    return { error: errorMessage(body, `Action failed (HTTP ${response.status})`) };
  }
  try {
    return parsePlayerGameView(body);
  } catch (reason: unknown) {
    return { error: reason instanceof Error ? reason.message : String(reason) };
  }
}
