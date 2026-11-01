import { parsePlayerGameView, type GameAction, type PlayerGameView } from '../types';

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
  playerTypes?: string[],
): Promise<CreatedGame> {
  const seats = playerTypes ?? Array.from({ length: playerCount }, () => 'human');
  const response = await fetch('/api/game/create', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ playerCount, playerNames, allowRedirect, chaosMode, playerTypes: seats }),
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

export async function getGameView(gameId: string, playerId: string): Promise<PlayerGameView> {
  const response = await fetch(
    `/api/game/${encodeURIComponent(gameId)}/view/${encodeURIComponent(playerId)}`,
  );
  const body = await readJson(response);

  if (!response.ok) {
    throw new Error(errorMessage(body, `Could not load the game view (HTTP ${response.status})`));
  }
  return parsePlayerGameView(body);
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
