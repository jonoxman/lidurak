<!-- WAVE:1 -->
# Ticket T-90-1: Suppress Startup Proxy `ECONNREFUSED` Log Flood & Clean Server Output

## Context & Motivation
When `./play-local.sh` starts the frontend Vite dev server (`localhost:5173`) and the backend `sbt run` server (`localhost:8080`) concurrently, Vite comes up in `< 1s` while `sbt` takes several seconds to compile and bind port `8080`. During this startup window, the frontend polls `GET /api/health` every second to detect when the backend is ready, causing Vite's built-in HTTP proxy logger to flood the terminal with repeated `http proxy error: /api/health` / `Error: connect ECONNREFUSED 127.0.0.1:8080` stack traces. Additionally, `sbt` logs standard SLF4J `stderr` output with an `[error]` prefix when forking.

## Scope & Files to Touch
- **Allowed files:**
  - `frontend/vite.config.ts`
  - `backend/build.sbt`
  - `play-local.sh`
- **Do NOT touch:** Any application source files in `frontend/src/` or `backend/src/`, or `README.md` / `ARCHITECTURE.md` (handled in Wave 3).

## Detailed Requirements

1. **Silence Expected Startup `ECONNREFUSED` Errors in `frontend/vite.config.ts`:**
   - Note how Vite's internal proxy middleware works: Vite invokes `proxyOptions.configure(proxy, options)` *before* registering its own `proxy.on('error', ...)` listener that calls `config.logger.error('http proxy error: ...')`.
   - Implement a two-layer defense in `frontend/vite.config.ts`:
     1. **Custom Vite Logger (`customLogger`):** Create a custom logger via `createLogger()` from `'vite'`. Override `logger.error` so that any log message containing `'http proxy error'` when the underlying error is `ECONNREFUSED` / `ECONNRESET` / `socket hang up` (either in `msg` or `options?.error`) is silently ignored instead of printed to the terminal.
     2. **Graceful Proxy Error Handler (`configure`):** On the `/api` proxy entry in `server.proxy`, use `configure: (proxy) => { ... }` to intercept `error` events (wrapping listener replacement in `setImmediate` or intercepting on `proxyReq` / `error`) so that if `res` is an HTTP `ServerResponse` and headers have not been sent (`!res.headersSent`), it responds cleanly with HTTP `503 Service Unavailable`, header `Content-Type: application/json`, and body `JSON.stringify({ status: "starting", error: "Backend starting" })`. For WebSocket upgrade errors before backend startup, close the socket cleanly without crashing or logging stack traces.

2. **Clean Up `sbt` Fork Output in `backend/build.sbt`:**
   - Ensure `outputStrategy := Some(StdoutOutput)` (or equivalent fork stdout routing) is configured in `backend/build.sbt` so that normal `slf4j-simple` `INFO` logs from `org.http4s.ember.server` are printed to stdout (`[info]`) rather than being prefixed with `[error]` by `sbt`.

3. **Keep `./play-local.sh` Clean & Reliable:**
   - Inspect `./play-local.sh` and ensure both servers start cleanly with concise, readable terminal output and clean shutdown on `SIGINT`/`SIGTERM`.

## Acceptance Criteria & Verification
1. Run `cd frontend && npm test -- --run` and `cd backend && sbt -batch test` to verify all existing tests pass and `vite.config.ts` compiles cleanly.
2. Verify that when Vite proxies `/api/health` while nothing is listening on `127.0.0.1:8080`, Vite returns HTTP `503` without printing `[vite] http proxy error: /api/health` or `ECONNREFUSED` stack traces to the console.
3. Write your implementation summary to `.reviews/agent_notes.md` and run `echo "DONE" > .tickets/STATUS`.
