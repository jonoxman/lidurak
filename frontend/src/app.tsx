import { useEffect, useState } from 'preact/hooks';
import { HeaderBar } from './components/HeaderBar';
import { initSettings } from './state/settings';
import { GamePage } from './pages/GamePage';
import { LobbyPage } from './pages/LobbyPage';
import { navigateToLobby, useRoute } from './router/useRoute';

interface LobbyRoute {
  name: 'lobby';
}

interface GameRoute {
  name: 'game';
  gameId: string;
  playerId: string;
}

type Route = LobbyRoute | GameRoute;

/**
 * Resolves the legacy M1 hash route (`#/g/:gameId?player=:seat`).
 *
 * The local/bot hotseat tables keep using this hash route; the M2 live rooms
 * use the History-API path `/g/:gameId` handled by `useRoute`.
 */
export function parseRoute(hash: string): Route {
  const raw = hash.startsWith('#') ? hash.slice(1) : hash;
  const [path, query = ''] = raw.split('?');
  // `#/g/:gameId` and its review alias `#/g/:gameId/replay` open the same table;
  // a finished game hydrates itself from the recorded match.
  const match = /^\/g\/([^/]+)(?:\/replay)?$/.exec(path);
  if (match) {
    let gameId: string;
    try {
      gameId = decodeURIComponent(match[1]).trim();
    } catch {
      // A malformed escape sequence is not a usable game id.
      gameId = '';
    }
    if (gameId.length > 0) {
      const params = new URLSearchParams(query);
      return {
        name: 'game',
        gameId,
        playerId: params.get('player')?.trim() || 'p0',
      };
    }
  }
  return { name: 'lobby' };
}

/** True for the explicit `#/` lobby link used by the site header. */
export function isLobbyHash(hash: string): boolean {
  const raw = hash.startsWith('#') ? hash.slice(1) : hash;
  return raw === '/';
}

export function navigate(path: string): void {
  window.location.hash = path;
}

export function App() {
  const { route } = useRoute();
  const [hashRoute, setHashRoute] = useState<Route>(() => parseRoute(window.location.hash));

  useEffect(() => {
    const handleHashChange = () => setHashRoute(parseRoute(window.location.hash));
    window.addEventListener('hashchange', handleHashChange);
    return () => window.removeEventListener('hashchange', handleHashChange);
  }, []);

  // Applies theme, roundness and surface preferences to <html>, and keeps
  // "Device theme" in sync with the OS colour scheme.
  useEffect(() => initSettings(), []);

  // M1 local/bot tables keep their hash route; an explicit `#/` header link
  // always returns to the lobby; everything else follows the History API.
  const showLocalGame = hashRoute.name === 'game';
  const showLobby = !showLocalGame && isLobbyHash(window.location.hash);

  return (
    <div class="app">
      {/* The LIDURAK brand link in HeaderBar already titles every page. */}
      <HeaderBar />
      {showLocalGame ? (
        <GamePage
          gameId={hashRoute.gameId}
          playerId={hashRoute.playerId}
          onSwitchPlayer={(playerId) =>
            navigate(`/g/${hashRoute.gameId}?player=${playerId}`)
          }
          onLeaveGame={() => navigate('/')}
        />
      ) : showLobby || route.kind === 'lobby' ? (
        <LobbyPage />
      ) : (
        // T-95-audit-gap: the History-API multiplayer route renders the very
        // same Milestone 1 game shell as the local/bot hash routes, driven by
        // the live room controller instead of the local REST/socket pair.
        <GamePage
          gameId={route.gameId}
          playerId="p0"
          multiplayer
          onSwitchPlayer={() => {}}
          onLeaveGame={navigateToLobby}
        />
      )}
    </div>
  );
}
