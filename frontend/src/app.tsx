import { useEffect } from 'preact/hooks';
import { HeaderBar } from './components/HeaderBar';
import { initSettings } from './state/settings';
import { GamePage } from './pages/GamePage';
import { LobbyPage } from './pages/LobbyPage';
import { navigateToGame, navigateToLobby, useRoute } from './router/useRoute';

/**
 * The SPA shell. The History-API router owns the URL:
 *
 * - `/` is the lobby.
 * - `/g/:gameId` is a live multiplayer room.
 * - `/g/:gameId?player=:seat` is a local hotseat/bot table on that seat.
 *
 * There is no hash route: `useRoute` also normalizes a legacy `#/` or
 * `#/g/:gameId` loaded from an old bookmark, so the address bar stays clean.
 */
export function App() {
  const { route } = useRoute();

  // Applies theme, roundness and surface preferences to <html>, and keeps
  // "Device theme" in sync with the OS colour scheme.
  useEffect(() => initSettings(), []);

  return (
    <div class="app">
      {/* The LIDURAK brand link in HeaderBar already titles every page. */}
      <HeaderBar />
      {route.kind === 'lobby' ? (
        <LobbyPage />
      ) : route.playerId !== undefined ? (
        <GamePage
          gameId={route.gameId}
          playerId={route.playerId}
          onSwitchPlayer={(playerId) => navigateToGame(route.gameId, playerId)}
          onNavigateGame={(gameId, playerId) => navigateToGame(gameId, playerId)}
          onLeaveGame={navigateToLobby}
        />
      ) : (
        // T-90: `/g/:gameId` is the original M1 gameplay interface in live
        // multiplayer mode — never a placeholder screen.
        <GamePage
          mode="multiplayer"
          gameId={route.gameId}
          playerId="p0"
          onSwitchPlayer={() => {}}
          onLeaveGame={navigateToLobby}
        />
      )}
    </div>
  );
}
