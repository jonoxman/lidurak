import type { GuestSession } from '../types/multiplayer';

/** A failed REST call, carrying the HTTP status and the server's error code. */
export class MultiplayerApiError extends Error {
  readonly status: number;
  readonly code: string | null;

  constructor(message: string, status: number, code: string | null = null) {
    super(message);
    this.name = 'MultiplayerApiError';
    this.status = status;
    this.code = code;
  }
}

export interface ApiRequestOptions {
  method?: 'GET' | 'POST' | 'DELETE';
  body?: unknown;
}

async function readJson(response: Response): Promise<unknown> {
  if (response.status === 204) return null;
  try {
    return await response.json();
  } catch {
    return null;
  }
}

function errorMessage(body: unknown, fallback: string): string {
  if (typeof body === 'object' && body !== null) {
    const raw = body as Record<string, unknown>;
    for (const key of ['error', 'message']) {
      if (typeof raw[key] === 'string' && (raw[key] as string).length > 0) {
        return raw[key] as string;
      }
    }
  }
  return fallback;
}

function errorCode(body: unknown): string | null {
  if (typeof body === 'object' && body !== null) {
    const code = (body as Record<string, unknown>).code;
    if (typeof code === 'string' && code.length > 0) return code;
  }
  return null;
}

/**
 * Sends one JSON REST request with the guest session cookie attached.
 *
 * `credentials: 'include'` is mandatory: the `lidurak_session` cookie is
 * `HttpOnly; SameSite=Strict`, so without it every call would mint a fresh
 * anonymous session.
 */
export async function apiRequest(
  path: string,
  options: ApiRequestOptions = {},
): Promise<unknown> {
  const response = await fetch(path, {
    method: options.method ?? 'GET',
    credentials: 'include',
    ...(options.body === undefined
      ? {}
      : {
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(options.body),
        }),
  });
  const body = await readJson(response);

  if (!response.ok) {
    throw new MultiplayerApiError(
      errorMessage(body, `Request failed (HTTP ${response.status})`),
      response.status,
      errorCode(body),
    );
  }
  return body;
}

function parseGuestSession(value: unknown): GuestSession {
  if (typeof value !== 'object' || value === null) {
    throw new Error('Invalid session response: expected a JSON object');
  }
  const raw = value as Record<string, unknown>;
  if (typeof raw.playerId !== 'string') {
    throw new Error('Invalid session response: playerId must be a string');
  }
  if (typeof raw.displayName !== 'string') {
    throw new Error('Invalid session response: displayName must be a string');
  }
  return {
    playerId: raw.playerId,
    displayName: raw.displayName,
    isGuest: raw.isGuest !== false,
  };
}

/**
 * Fetches the visitor's session. The backend mints and sets an `HttpOnly`
 * guest cookie when none exists, so this doubles as "log in as a guest".
 */
export async function getOrCreateSession(): Promise<GuestSession> {
  return parseGuestSession(await apiRequest('/api/session'));
}

/** Renames the current guest (2–20 printable characters server-side). */
export async function updateGuestName(displayName: string): Promise<GuestSession> {
  return parseGuestSession(
    await apiRequest('/api/session/name', {
      method: 'POST',
      body: { displayName },
    }),
  );
}
