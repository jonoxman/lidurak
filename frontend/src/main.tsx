import { render } from 'preact';
import './app.css';
import { App } from './app';
import { ensureGuestSession } from './api/sessionClient';

/**
 * Boots the app only once the guest identity is known.
 *
 * T-90-feedback ITEM-1a/1b: `GET /api/session` mints the `Guest-XXXX` name (and
 * sets the `HttpOnly` cookie) on a cold visit. Awaiting it before the first
 * render means the very first DOM frame already carries that name — the header
 * can never flash, or get stuck on, a generic placeholder, and `/api/session`
 * is the only request that can create the first session cookie.
 *
 * `ensureGuestSession()` never rejects: an unreachable backend resolves a
 * locally generated `Guest-XXXX`, so boot is never blocked by the network.
 */
async function bootstrap(): Promise<void> {
  await ensureGuestSession();
  render(<App />, document.getElementById('app')!);
}

void bootstrap();
