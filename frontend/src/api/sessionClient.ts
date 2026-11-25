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

// --- Shared guest session cache ---------------------------------------------

/**
 * T-90-2 ITEM-3: one backend-generated guest session for the whole page.
 *
 * `HeaderBar` and `LobbyPage` both need the same automatically generated guest
 * `displayName`. Without a shared cache each of them would mint a competing
 * `GET /api/session`, so whichever response landed last could rename the header
 * out from under the lobby. The loader below keeps exactly one request in
 * flight, remembers its answer and notifies every subscriber (the header, the
 * lobby) the moment a name changes.
 */
let cachedGuestSession: GuestSession | null = null;
let inFlightGuestSession: Promise<GuestSession | null> | null = null;
const guestSessionListeners = new Set<(session: GuestSession) => void>();

/** The session already resolved for this page, or `null` before the first load. */
export function getCachedGuestSession(): GuestSession | null {
  return cachedGuestSession;
}

/** Subscribes to later guest-session changes (a rename, a fresh session). */
export function subscribeGuestSession(
  listener: (session: GuestSession) => void,
): () => void {
  guestSessionListeners.add(listener);
  return () => {
    guestSessionListeners.delete(listener);
  };
}

/** Clears the shared cache and listeners (isolated unit tests / a real sign-out). */
export function resetGuestSessionCache(): void {
  cachedGuestSession = null;
  inFlightGuestSession = null;
  guestSessionListeners.clear();
}

function publishGuestSession(session: GuestSession): GuestSession {
  cachedGuestSession = session;
  for (const listener of guestSessionListeners) listener(session);
  return session;
}

/**
 * Resolves the guest session at most once per page and deduplicates concurrent
 * callers onto that single in-flight request.
 *
 * Resolves `null` instead of rejecting when `fetch` is unavailable (an isolated
 * component unit test) or the request fails, so callers can render their
 * fallback guest label without an unhandled rejection.
 */
export function ensureGuestSession(): Promise<GuestSession | null> {
  if (cachedGuestSession !== null) return Promise.resolve(cachedGuestSession);
  if (inFlightGuestSession !== null) return inFlightGuestSession;
  if (typeof fetch !== 'function') return Promise.resolve(null);

  inFlightGuestSession = apiRequest('/api/session')
    .then((body) => publishGuestSession(parseGuestSession(body)))
    .then(
      (session) => {
        inFlightGuestSession = null;
        return session;
      },
      (error: unknown) => {
        inFlightGuestSession = null;
        // A real HTTP failure is still surfaced to a caller that requested the
        // session explicitly; the header handles it and keeps its fallback.
        throw error;
      },
    );
  return inFlightGuestSession;
}

/**
 * Fetches the visitor's session. The backend mints and sets an `HttpOnly`
 * guest cookie when none exists, so this doubles as "log in as a guest".
 * Every caller shares [[ensureGuestSession]]'s cache, so no two components
 * issue competing session requests.
 */
export async function getOrCreateSession(): Promise<GuestSession> {
  const session = await ensureGuestSession();
  if (session === null) {
    throw new Error('No guest session available: fetch is unsupported or the request failed');
  }
  return session;
}

/** Renames the current guest (2–20 printable characters server-side). */
export async function updateGuestName(displayName: string): Promise<GuestSession> {
  const session = parseGuestSession(
    await apiRequest('/api/session/name', {
      method: 'POST',
      body: { displayName },
    }),
  );
  // T-90-2 ITEM-3: the header shows the same name the lobby just saved.
  return publishGuestSession(session);
}
