import { useEffect, useState } from 'preact/hooks';
import { HeaderBar } from './components/HeaderBar';
import { initSettings } from './state/settings';
import { GamePage } from './pages/GamePage';
import { LobbyPage } from './pages/LobbyPage';

interface LobbyRoute {
  name: 'lobby';
}

interface GameRoute {
  name: 'game';
  gameId: string;
  playerId: string;
}

type Route = LobbyRoute | GameRoute;

export function parseRoute(hash: string): Route {
  const raw = hash.startsWith('#') ? hash.slice(1) : hash;
  const [path, query = ''] = raw.split('?');
  const match = /^\/g\/([^/]+)$/.exec(path);
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
        playerId: params.get('player') || 'p0',
      };
    }
  }
  return { name: 'lobby' };
}

export function navigate(path: string): void {
  window.location.hash = path;
}

export function App() {
  const [route, setRoute] = useState<Route>(() => parseRoute(window.location.hash));

  useEffect(() => {
    const handleHashChange = () => setRoute(parseRoute(window.location.hash));
    window.addEventListener('hashchange', handleHashChange);
    return () => window.removeEventListener('hashchange', handleHashChange);
  }, []);

  // Applies theme, roundness and surface preferences to <html>, and keeps
  // "Device theme" in sync with the OS colour scheme.
  useEffect(() => initSettings(), []);

  return (
    <div class="app">
      <HeaderBar />
      <h1 class="app-title">Lidurak</h1>
      {route.name === 'game' ? (
        <GamePage
          gameId={route.gameId}
          playerId={route.playerId}
          onSwitchPlayer={(playerId) => navigate(`/g/${route.gameId}?player=${playerId}`)}
        />
      ) : (
        <LobbyPage />
      )}
    </div>
  );
}
