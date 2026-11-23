<!-- WAVE:1 -->
# T-01: Guest Session Store, 256-Bit Token Generator & Cookie Auth Routes

## Goal
Implement frictionless anonymous guest session management in the Scala 3 backend using cryptographically random 256-bit tokens (`SecureRandom`), a clean `SessionStore[F[_]]` algebra with an in-memory `Ref`-backed implementation (ready for MongoDB persistence in M4), `HttpOnly; SameSite=Strict` cookie handling, and REST endpoints for fetching/creating and renaming guest sessions.

## Scope & Owned Files
Create new files strictly under:
- `backend/src/main/scala/durak/session/SessionModels.scala`
- `backend/src/main/scala/durak/session/SessionStore.scala`
- `backend/src/main/scala/durak/session/SessionCookie.scala`
- `backend/src/main/scala/durak/session/SessionRoutes.scala`
- `backend/src/test/scala/durak/session/SessionStoreSpec.scala`
- `backend/src/test/scala/durak/session/SessionRoutesSpec.scala`

> **Do NOT edit** `Main.scala`, `README.md`, or `ARCHITECTURE.md` in this ticket (server route wiring happens in `T-06`).

## Design Details
1. **Models (`SessionModels.scala`):**
   - `GuestSession(token: String, playerId: String, displayName: String, createdAtEpochMs: Long, lastSeenAtEpochMs: Long)`
   - `SessionResponse(playerId: String, displayName: String, isGuest: Boolean)` — NEVER echo the raw secret `token` inside JSON responses when cookie auth is used (keep secret token strictly in the `HttpOnly` cookie; optionally return a non-secret `playerId` for UI identity matching).
   - `UpdateNameRequest(displayName: String)`
2. **Store (`SessionStore.scala`):**
   - Trait `SessionStore[F[_]]` with methods:
     - `createGuest(displayName: Option[String] = None): F[GuestSession]`
     - `findByToken(token: String): F[Option[GuestSession]]`
     - `touchAndFind(token: String): F[Option[GuestSession]]`
     - `updateDisplayName(token: String, newName: String): F[Either[String, GuestSession]]`
   - `InMemorySessionStore` backed by `cats.effect.Ref[F, Map[String, GuestSession]]`.
   - Token generation uses `java.security.SecureRandom` producing 32 random bytes (256 bits), Base64URL-encoded without padding.
   - Default `playerId` is a unique public identifier (e.g., `"guest-" + 8-char random hex/alphanumeric`), distinct from the secret `token`.
   - Default `displayName` is `"Guest-" + 4 uppercase alphanumeric chars`.
   - `updateDisplayName` trims input and validates length (`2..20` printable characters, rejecting blank or control characters).
3. **Cookie & Request Extraction (`SessionCookie.scala`):**
   - Cookie name: `lidurak_session`.
   - Builder creating `org.http4s.ResponseCookie` with `httpOnly = true`, `sameSite = Some(org.http4s.SameSite.Strict)`, `path = Some("/")`, `maxAge = Some(30L * 24 * 3600)`.
   - Helper `extractToken[F[_]](req: Request[F]): Option[String]` checking the `lidurak_session` cookie first, falling back to `X-Guest-Token` request header (useful for automated tests and non-browser WebSocket clients).
   - Helper `resolveOrCreate[F[_]: Monad](req: Request[F], store: SessionStore[F]): F[(GuestSession, Boolean)]` returning `(session, wasNewlyCreated)` so callers attach the `Set-Cookie` header whenever a new guest session is minted.
4. **REST Routes (`SessionRoutes.scala`):**
   - `GET /api/session`: resolves existing guest session from cookie/header or auto-mints a new `GuestSession`, attaches `Set-Cookie` with `HttpOnly; SameSite=Strict` if newly created, and returns `200 OK` with `SessionResponse`.
   - `POST /api/session/name`: resolves or creates session, validates and updates `displayName`, returns `200 OK` with updated `SessionResponse` or `400 Bad Request` on invalid name.

## Mandatory Acceptance Criteria Checklist
- [ ] **REQ-01:** `SessionStore` generates cryptographically random 256-bit (32-byte) tokens via `java.security.SecureRandom` encoded safely for cookies/headers; `playerId` is distinct from the secret `token`.
- [ ] **REQ-01:** `InMemorySessionStore` is thread-safe (`Cats Effect Ref`), stores `GuestSession(token, playerId, displayName, createdAtEpochMs, lastSeenAtEpochMs)`, and supports `createGuest`, `findByToken`, `touchAndFind`, and `updateDisplayName`.
- [ ] **REQ-02:** Issued `lidurak_session` cookies strictly enforce `HttpOnly = true`, `SameSite = Strict`, and `Path = /`.
- [ ] **REQ-02:** `SessionCookie.extractToken` extracts credentials from the `lidurak_session` cookie with fallback to `X-Guest-Token` header for WebSocket/automated test clients.
- [ ] **REQ-02:** `GET /api/session` auto-mints a guest session when none is present, sets the `HttpOnly; SameSite=Strict` cookie, returns `SessionResponse(playerId, displayName, isGuest = true)` without leaking the raw secret token in JSON, and reuses the exact same `playerId` on subsequent requests carrying the cookie.
- [ ] **REQ-02:** `POST /api/session/name` validates display names (trimmed, 2–20 printable chars), persists the updated name in `SessionStore`, and returns `400 Bad Request` for invalid inputs.
- [ ] Unit tests in `SessionStoreSpec.scala` and `SessionRoutesSpec.scala` verify 256-bit token length/uniqueness, cookie security attributes, idempotent session reuse across requests, and display name validation.
- [ ] All backend tests pass cleanly via `cd backend && sbt -batch test`.

## Verification Commands
```bash
cd backend && sbt -batch test
```

