import { createLogger, defineConfig } from 'vite';
import type { LogErrorOptions, Logger } from 'vite';
import preact from '@preact/preset-vite';

/**
 * Errors the proxy raises while `sbt` is still compiling and nothing is bound
 * to port 8080 yet. They are expected on every cold start, so they must not
 * flood the terminal of `./play-local.sh`.
 */
const STARTUP_CONNECTION_ERRORS = [/ECONNREFUSED/, /ECONNRESET/, /socket hang up/i];

const BACKEND_STARTING_BODY = JSON.stringify({ status: 'starting', error: 'Backend starting' });

function describeError(value: unknown): string {
  if (value === null || value === undefined) return '';
  if (typeof value === 'string') return value;
  if (value instanceof Error) {
    const code = (value as { code?: unknown }).code;
    return [value.message, typeof code === 'string' ? code : '', value.stack ?? ''].join(' ');
  }
  return String(value);
}

/**
 * True only for a proxy failure caused by the backend not listening yet.
 * Covers both the HTTP listener (`http proxy error: …`) and the WebSocket
 * upgrade listener (`ws proxy error:`), which Vite logs separately.
 */
export function isStartupProxyError(msg: string, options?: LogErrorOptions): boolean {
  const text = `${msg ?? ''} ${describeError(options?.error)}`;
  if (!/proxy error/i.test(text)) return false;
  return STARTUP_CONNECTION_ERRORS.some((pattern) => pattern.test(text));
}

/**
 * Vite's default logger, with the expected "backend is still starting" proxy
 * errors dropped. Everything else is relayed untouched.
 */
function createStartupAwareLogger(): Logger {
  const logger = createLogger();
  const relayError = logger.error.bind(logger);
  logger.error = (msg: string, options?: LogErrorOptions) => {
    if (isStartupProxyError(msg, options)) return;
    relayError(msg, options);
  };
  return logger;
}

interface ProxyResponse {
  headersSent?: boolean;
  writableEnded?: boolean;
  writeHead?: (status: number, headers?: Record<string, string>) => unknown;
  end?: (body?: string) => unknown;
}

/**
 * Answers a proxied request whose backend connection failed with a clean
 * `503 Service Unavailable` instead of letting the browser wait on a stack
 * trace. This runs from `configure`, i.e. before Vite registers its own
 * `error` listener, so `headersSent`/`writableEnded` already stop that
 * listener from replying a second time.
 */
export function respondBackendStarting(response: unknown): void {
  const res = response as ProxyResponse | undefined;
  if (!res || typeof res.end !== 'function') return;
  if (res.headersSent || res.writableEnded) return;

  if (typeof res.writeHead === 'function') {
    res.writeHead(503, {
      'Content-Type': 'application/json',
      'Cache-Control': 'no-store',
      'Retry-After': '1',
    });
    res.end(BACKEND_STARTING_BODY);
    return;
  }

  // A WebSocket upgrade hands the raw socket to the proxy: close it with a
  // minimal 503 handshake response so the client fails fast without a hang.
  res.end('HTTP/1.1 503 Service Unavailable\r\nConnection: close\r\nContent-Length: 0\r\n\r\n');
}

export default defineConfig({
  customLogger: createStartupAwareLogger(),
  plugins: [preact()],
  server: {
    host: '0.0.0.0',
    port: 5173,
    proxy: {
      '/api': {
        target: 'http://localhost:8080',
        configure: (proxy) => {
          proxy.on('error', (_error, _req, res) => respondBackendStarting(res));
        },
      },
      '/ws': {
        target: 'http://localhost:8080',
        ws: true,
        configure: (proxy) => {
          proxy.on('error', (_error, _req, res) => respondBackendStarting(res));
        },
      },
    },
  },
});
