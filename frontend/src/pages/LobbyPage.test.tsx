import { beforeEach, describe, expect, it, vi } from 'vitest';
import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/preact';

vi.mock('../api/client', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../api/client')>();
  return {
    ...actual,
    checkServerHealth: vi.fn(async () => true),
  };
});

vi.mock('../api/sessionClient', () => ({
  getOrCreateSession: vi.fn(),
  updateGuestName: vi.fn(),
}));

vi.mock('../api/lobbyClient', () => ({
  fetchLobbyRooms: vi.fn(),
  connectLobbySocket: vi.fn(),
  joinQuickPair: vi.fn(),
  cancelQuickPair: vi.fn(),
  joinRoom: vi.fn(),
  createRoom: vi.fn(),
  seedLobbyPreset: vi.fn(),
  createActiveMatchPreset: vi.fn(),
  createSpectatorMatchPreset: vi.fn(),
  triggerQaQuickPairOpponent: vi.fn(),
  launchQaSmallHandMatch: vi.fn(),
}));

import * as client from '../api/client';
import * as lobbyApi from '../api/lobbyClient';
import * as sessionApi from '../api/sessionClient';
import type { LobbyRoomSummary } from '../types/multiplayer';
import lobbyCss from '../styles/lobby.css?raw';
import { resetSettings, setSettings } from '../state/settings';
import { CreateInviteTab } from '../components/lobby/CreateInviteTab';
import { LobbyPage } from './LobbyPage';

const checkServerHealth = client.checkServerHealth as unknown as ReturnType<typeof vi.fn>;
const getOrCreateSession =
  sessionApi.getOrCreateSession as unknown as ReturnType<typeof vi.fn>;
const fetchLobbyRooms = lobbyApi.fetchLobbyRooms as unknown as ReturnType<typeof vi.fn>;
const connectLobbySocket =
  lobbyApi.connectLobbySocket as unknown as ReturnType<typeof vi.fn>;
const joinQuickPair = lobbyApi.joinQuickPair as unknown as ReturnType<typeof vi.fn>;
const cancelQuickPair = lobbyApi.cancelQuickPair as unknown as ReturnType<typeof vi.fn>;
const joinRoom = lobbyApi.joinRoom as unknown as ReturnType<typeof vi.fn>;
const createRoom = lobbyApi.createRoom as unknown as ReturnType<typeof vi.fn>;
const seedLobbyPreset = lobbyApi.seedLobbyPreset as unknown as ReturnType<typeof vi.fn>;
const createActiveMatchPreset =
  lobbyApi.createActiveMatchPreset as unknown as ReturnType<typeof vi.fn>;
const createSpectatorMatchPreset =
  lobbyApi.createSpectatorMatchPreset as unknown as ReturnType<typeof vi.fn>;
const triggerQaQuickPairOpponent =
  lobbyApi.triggerQaQuickPairOpponent as unknown as ReturnType<typeof vi.fn>;
const launchQaSmallHandMatch =
  lobbyApi.launchQaSmallHandMatch as unknown as ReturnType<typeof vi.fn>;

/** The deferred queue answer: no room exists until the bucket fills. */
const SEARCHING_2_15 = {
  status: 'searching' as const,
  playerCount: 2,
  turnTimeoutSeconds: 15,
  allowRedirect: true,
  queuedCount: 1,
  requiredCount: 2,
};

const GUEST = {
  playerId: 'guest-abcd1234',
  displayName: 'Guest-AB12',
  isGuest: true,
};

const ROOM: LobbyRoomSummary = {
  gameId: 'room-1',
  hostName: 'Mira',
  playerCount: 2,
  filledSeats: 1,
  allowRedirect: true,
  turnTimeoutSeconds: 15,
  createdAtEpochMs: 1,
  isQuickPair: false,
};

let socketHandlers: import('../api/lobbyClient').LobbySocketHandlers | null = null;

const renderLobby = () => render(<LobbyPage initialServerReady />);

/** The SPA opens M2 rooms with the History API, never a hash route. */
const expectGamePath = (gameId: string) =>
  waitFor(() => {
    expect(window.location.pathname).toBe(`/g/${gameId}`);
    expect(window.location.hash).toBe('');
  });

const openPoolTab = async () => {
  fireEvent.click(screen.getByRole('tab', { name: /Lobby Pool/ }));
  await waitFor(() => expect(socketHandlers).not.toBeNull());
};

describe('M2 LobbyPage', () => {
  beforeEach(() => {
    vi.resetAllMocks();
    resetSettings();
    window.history.replaceState({}, '', '/');
    window.location.hash = '';
    socketHandlers = null;

    checkServerHealth.mockResolvedValue(true);
    getOrCreateSession.mockResolvedValue(GUEST);
    fetchLobbyRooms.mockResolvedValue([]);
    joinQuickPair.mockResolvedValue(SEARCHING_2_15);
    cancelQuickPair.mockResolvedValue(undefined);
    joinRoom.mockResolvedValue({ gameId: 'room-1', seatIndex: 1, view: {} as never });
    createRoom.mockResolvedValue({
      gameId: 'inv-1',
      seatIndex: 0,
      inviteUrl: '/g/inv-1',
    });
    seedLobbyPreset.mockResolvedValue({ rooms: [ROOM] });
    createActiveMatchPreset.mockResolvedValue({ gameId: 'active-1', seatIndex: 0 });
    createSpectatorMatchPreset.mockResolvedValue({ gameId: 'spec-1' });
    triggerQaQuickPairOpponent.mockResolvedValue({ gameId: 'qa-pair-1', seatIndex: 0 });
    launchQaSmallHandMatch.mockResolvedValue({ gameId: 'small-1', seatIndex: 0 });
    connectLobbySocket.mockImplementation(
      (handlers: import('../api/lobbyClient').LobbySocketHandlers) => {
        socketHandlers = handlers;
        handlers.onStatusChange?.('connected');
        return { status: 'connected', close: vi.fn() };
      },
    );
  });

  it('T-90-feedback ITEM-1b: resolves the guest session before the first lobby request', async () => {
    let releaseSession!: (session: typeof GUEST) => void;
    getOrCreateSession.mockReturnValue(
      new Promise<typeof GUEST>((resolve) => {
        releaseSession = resolve;
      }),
    );

    renderLobby();

    await waitFor(() => expect(getOrCreateSession).toHaveBeenCalledTimes(1));
    // `/api/lobby` must not race the session mint on a cold visit.
    expect(fetchLobbyRooms).not.toHaveBeenCalled();

    await act(async () => {
      releaseSession(GUEST);
    });

    await waitFor(() => expect(fetchLobbyRooms).toHaveBeenCalledTimes(1));
  });

  it('ITEM-2: renders the three lobby tabs and no second header bar', async () => {
    renderLobby();

    // `HeaderBar` is the app's only header, so the lobby shell renders none and
    // the redundant "♠ LIDURAK / Play Durak with friends" bar is gone with it.
    expect(screen.getByTestId('m2-lobby')).toBeTruthy();
    expect(document.querySelector('.m2-lobby header')).toBeNull();
    expect(screen.queryByText('LIDURAK')).toBeNull();
    expect(screen.queryByText('Play Durak with friends')).toBeNull();
    // The guest name lives in the HeaderBar profile menu now, not in the lobby.
    expect(screen.queryByRole('button', { name: 'Edit guest name' })).toBeNull();
    // The shared guest session is still hydrated for API calls and the seat label.
    await waitFor(() => expect(getOrCreateSession).toHaveBeenCalledTimes(1));

    expect(
      screen.getByRole('tab', { name: 'Quick Pairing' }).getAttribute('aria-selected'),
    ).toBe('true');
    expect(screen.getByRole('tab', { name: /Lobby Pool/ })).toBeTruthy();
    expect(screen.getByRole('tab', { name: 'Create a Game' })).toBeTruthy();
    expect(screen.queryByRole('tab', { name: 'Create Invite Link' })).toBeNull();
    // The transcript persists for the whole page, so the Quick Pairing tab is live.
    await waitFor(() =>
      expect(screen.getByTestId('lobby-connection').textContent).toContain('Lobby live'),
    );
  });

  /** T-90-4 ITEM-1: no small-font explanation is left under any lobby header. */
  it('ITEM-1: removes every explanation text under the lobby headers', () => {
    renderLobby();

    const removed = [
      'Open public rooms, updated live. Join any table with a free seat.',
      'Choose whether this is a private invite link or a public pool table',
      'Redirects are on for every table. Pick a size and clock',
      'Jump straight to the M2 states a reviewer needs to verify.',
    ];
    const expectNoHints = () => {
      expect(document.querySelector('.m2-panel-hint')).toBeNull();
      for (const text of removed) {
        expect(document.body.textContent ?? '').not.toContain(text);
      }
    };

    // Quick Pairing is the default panel; then the lazily mounted tabs.
    expectNoHints();
    fireEvent.click(screen.queryByRole('tab', { name: /Lobby Pool/ }) as HTMLElement);
    expectNoHints();
    fireEvent.click(screen.getByRole('tab', { name: 'Create a Game' }));
    expectNoHints();
    // The helper rule itself is gone, so nothing can render one later.
    expect(lobbyCss).not.toContain('.m2-panel-hint');
  });

  it('opens Quick Pairing on the Quick Pairing tab by default', () => {
    renderLobby();

    for (const id of [
      'quick-pair-2-15',
      'quick-pair-2-30',
      'quick-pair-3-15',
      'quick-pair-3-30',
      'quick-pair-4-15',
      'quick-pair-4-30',
    ]) {
      expect(screen.getByTestId(id)).toBeTruthy();
    }
  });

  it('ITEM-2a / T-90-3 ITEM-7c: renders all twelve tiles at double height', () => {
    renderLobby();

    const ids = [
      'quick-pair-2-15',
      'quick-pair-2-30',
      'quick-pair-3-15',
      'quick-pair-3-30',
      'quick-pair-4-15',
      'quick-pair-4-30',
      'quick-pair-52-2-15',
      'quick-pair-52-2-30',
      'quick-pair-52-3-30',
      'quick-pair-bot-2-random',
      'quick-pair-bot-2-basic',
      'quick-pair-bot-4-basic',
    ];
    for (const id of ids) {
      const tile = screen.getByTestId(id);
      expect(tile.classList.contains('quick-pair-tile')).toBe(true);
      expect(tile.getAttribute('data-height')).toBe('double');
    }
    expect(document.querySelectorAll('.quick-pair-tile')).toHaveLength(12);

    // The layout is unchanged: the tile just grows, the 3x3 grid stays put.
    expect(lobbyCss).toMatch(/\.quick-pair-grid\s*\{[^}]*repeat\(3, minmax\(0, 1fr\)\)/);
    expect(lobbyCss).toMatch(/\.quick-pair-tile\s*\{[^}]*min-height:\s*7\.5rem/);
  });

  it('ITEM-2b/2c: names the third tab "Create a Game" with visibility first', () => {
    renderLobby();

    fireEvent.click(screen.getByRole('tab', { name: 'Create a Game' }));

    const panel = screen.getByRole('region', { name: 'Create a Game' });
    expect(within(panel).getByRole('heading', { name: 'Create a Game' })).toBeTruthy();
    expect(screen.queryByText('Create Invite Link')).toBeNull();

    // The fieldset legend and its inner group share the "Visibility" name.
    const visibility = within(panel).getByTestId('create-game-visibility');
    expect(within(visibility).getByRole('button', { name: 'Private invite link' })).toBeTruthy();
    expect(within(visibility).getByRole('button', { name: 'Public lobby pool' })).toBeTruthy();

    // Visibility is the first form control, before players / redirect / clock.
    const laterControls = [
      within(panel).getByRole('group', { name: 'Player count' }),
      within(panel).getByLabelText(/Redirect \/ reflect/),
      within(panel).getByRole('group', { name: 'Turn clock' }),
      within(panel).getByRole('button', { name: 'Create room' }),
    ];
    for (const control of laterControls) {
      expect(
        visibility.compareDocumentPosition(control) & Node.DOCUMENT_POSITION_FOLLOWING,
      ).toBeTruthy();
    }
  });

  it('ITEM-3: follows the profile Theme menu on every lobby surface', () => {
    renderLobby();

    act(() => {
      setSettings({ theme: 'light' });
    });
    expect(document.documentElement.getAttribute('data-theme')).toBe('light');

    act(() => {
      setSettings({ theme: 'dark' });
    });
    expect(document.documentElement.getAttribute('data-theme')).toBe('dark');

    // The lobby shell reads the M1 tokens instead of dark-only hex colours.
    expect(lobbyCss).toMatch(
      /\.m2-lobby\s*\{[^}]*--m2-surface: var\(--app-panel\)[^}]*--m2-border: var\(--app-border\)/,
    );
    // T-96b: the M2 selection chrome resolves from the M1 cobalt family, so a
    // Theme -> Palettes swap re-colours the tabs, tiles and Create-a-Game
    // controls together with the M1 `Local game` form below them.
    expect(lobbyCss).toMatch(
      /\.m2-lobby-tab\.active\s*\{[^}]*var\(--ui-select-accent\)/,
    );
    expect(lobbyCss).toMatch(/\.m2-button\s*\{[^}]*background: var\(--ui-select-accent\)/);
    expect(lobbyCss).toContain("html[data-theme='light'] .m2-lobby");

    // The theme-reactive token block itself carries no hardcoded hex colour.
    const tokenStart = lobbyCss.indexOf('.m2-lobby {');
    const tokenBlock = lobbyCss.slice(tokenStart, lobbyCss.indexOf('}', tokenStart));
    expect(tokenBlock).not.toMatch(/#[0-9a-fA-F]{3,6}/);
  });

  it('ITEM-1b: stays on the lobby with the searching status while queued', async () => {
    renderLobby();

    fireEvent.click(screen.getByTestId('quick-pair-2-15'));

    await waitFor(() =>
      expect(joinQuickPair).toHaveBeenCalledWith({
        playerCount: 2,
        turnTimeoutSeconds: 15,
        allowRedirect: true,
      }),
    );

    const searching = await screen.findByTestId('quick-pair-searching');
    expect(searching.getAttribute('role')).toBe('status');
    expect(searching.textContent).toContain('Searching for a 2P • 15s table… (1/2)');
    // A queued player owns no room yet, so the lobby stays on screen.
    expect(window.location.pathname).toBe('/');
    expect(window.location.hash).toBe('');
    expect(searching.querySelector('.quick-pair-spinner')).toBeTruthy();
  });

  it('navigates straight to the room when POST /api/quick-pair answers matched', async () => {
    joinQuickPair.mockResolvedValue({
      status: 'matched',
      gameId: 'xyz98765',
      seatIndex: 1,
    });
    renderLobby();

    fireEvent.click(screen.getByTestId('quick-pair-2-15'));

    await expectGamePath('xyz98765');
    expect(screen.queryByTestId('quick-pair-searching')).toBeNull();
  });

  it('navigates when /ws/lobby pushes quickPairMatched to a waiting player', async () => {
    renderLobby();

    fireEvent.click(screen.getByTestId('quick-pair-2-15'));
    await screen.findByTestId('quick-pair-searching');

    act(() => {
      socketHandlers?.onQuickPairMatched?.('abc12345', 0);
    });

    await expectGamePath('abc12345');
    expect(screen.queryByTestId('quick-pair-searching')).toBeNull();
  });

  it('cancels the queue from the searching banner and stays on the lobby', async () => {
    joinQuickPair.mockResolvedValue({
      ...SEARCHING_2_15,
      playerCount: 3,
      turnTimeoutSeconds: 30,
      requiredCount: 3,
    });
    renderLobby();

    fireEvent.click(screen.getByTestId('quick-pair-3-30'));

    const searching = await screen.findByTestId('quick-pair-searching');
    expect(searching.textContent).toContain('3P • 30s');
    fireEvent.click(within(searching).getByRole('button', { name: 'Cancel' }));

    await waitFor(() => expect(cancelQuickPair).toHaveBeenCalledTimes(1));
    expect(screen.queryByTestId('quick-pair-searching')).toBeNull();
    expect(window.location.pathname).toBe('/');
  });

  it('switches presets while queued without a stale navigation', async () => {
    joinQuickPair
      .mockResolvedValueOnce(SEARCHING_2_15)
      .mockResolvedValueOnce({
        ...SEARCHING_2_15,
        playerCount: 3,
        turnTimeoutSeconds: 30,
        requiredCount: 3,
      });
    renderLobby();

    fireEvent.click(screen.getByTestId('quick-pair-2-15'));
    await screen.findByTestId('quick-pair-searching');

    fireEvent.click(screen.getByTestId('quick-pair-3-30'));

    await waitFor(() => expect(cancelQuickPair).toHaveBeenCalledTimes(1));
    await waitFor(() =>
      expect(screen.getByTestId('quick-pair-searching').textContent).toContain('3P • 30s'),
    );
    expect(window.location.pathname).toBe('/');
  });

  it('streams the live pool snapshot and joins a room in one click', async () => {
    fetchLobbyRooms.mockResolvedValue([ROOM]);
    renderLobby();

    await openPoolTab();
    expect(screen.getByTestId('lobby-connection').textContent).toContain('Lobby live');

    act(() => {
      socketHandlers?.onSnapshot?.([ROOM]);
    });

    const row = await screen.findByTestId('pool-room-room-1');
    expect(within(row).getByText('Mira')).toBeTruthy();
    expect(within(row).getByText('1 / 2')).toBeTruthy();
    expect(within(row).getByText('Redirect ON')).toBeTruthy();
    expect(within(row).getByText(/36-card/)).toBeTruthy();
    expect(within(row).getByText('15s')).toBeTruthy();

    fireEvent.click(within(row).getByRole('button', { name: 'Join' }));
    await waitFor(() => expect(joinRoom).toHaveBeenCalledWith('room-1'));
    await expectGamePath('room-1');
  });

  it('T-96: advertises a two-player 52-card room with its actual deck size', async () => {
    const room52: LobbyRoomSummary = { ...ROOM, deckSize: 52 };
    fetchLobbyRooms.mockResolvedValue([room52]);
    renderLobby();

    await openPoolTab();
    act(() => {
      socketHandlers?.onSnapshot?.([room52]);
    });

    const row = await screen.findByTestId('pool-room-room-1');
    expect(within(row).getByText('52-card deck')).toBeTruthy();
    expect(within(row).queryByText('36-card deck')).toBeNull();
  });

  it('updates the pool from live LobbyUpdated frames', async () => {
    fetchLobbyRooms.mockResolvedValue([]);
    renderLobby();

    await openPoolTab();
    act(() => {
      socketHandlers?.onUpdated?.([ROOM]);
    });

    expect(await screen.findByTestId('pool-room-room-1')).toBeTruthy();
  });

  it('seeds QA rooms from the empty pool state', async () => {
    renderLobby();

    await openPoolTab();
    act(() => {
      socketHandlers?.onSnapshot?.([]);
    });
    expect(await screen.findByTestId('lobby-pool-empty')).toBeTruthy();

    fireEvent.click(screen.getByRole('button', { name: 'Seed QA rooms' }));

    await waitFor(() => expect(seedLobbyPreset).toHaveBeenCalledTimes(1));
    expect(await screen.findByTestId('pool-room-room-1')).toBeTruthy();
  });

  it('creates a configured invite room and opens it', async () => {
    renderLobby();

    fireEvent.click(screen.getByRole('tab', { name: 'Create a Game' }));
    fireEvent.click(screen.getByRole('button', { name: '4 players' }));
    fireEvent.click(screen.getByLabelText(/Redirect \/ reflect/));
    fireEvent.click(screen.getByRole('button', { name: '30s' }));
    fireEvent.click(screen.getByRole('button', { name: 'Public lobby pool' }));
    fireEvent.click(screen.getByRole('button', { name: 'Create room' }));

    await waitFor(() =>
      expect(createRoom).toHaveBeenCalledWith({
        playerCount: 4,
        allowRedirect: false,
        turnTimeoutSeconds: 30,
        isPublic: true,
        deckSize: 52,
        seatTypes: ['human', 'human', 'human', 'human'],
        creatorSeatIndex: 0,
        spectateAsCreator: false,
      }),
    );
    await expectGamePath('inv-1');
  });

  it('seeds the lobby pool and switches to the Lobby Pool tab', async () => {
    renderLobby();

    fireEvent.click(screen.getByTestId('qa-seed-lobby'));

    await waitFor(() => expect(seedLobbyPreset).toHaveBeenCalledTimes(1));
    await waitFor(() =>
      expect(
        screen.getByRole('tab', { name: /Lobby Pool/ }).getAttribute('aria-selected'),
      ).toBe('true'),
    );
    expect(await screen.findByTestId('pool-room-room-1')).toBeTruthy();
  });

  it('launches the invite, active and spectator QA presets', async () => {
    renderLobby();

    fireEvent.click(screen.getByTestId('qa-invite-room'));
    await waitFor(() =>
      expect(createRoom).toHaveBeenCalledWith({
        playerCount: 2,
        allowRedirect: true,
        turnTimeoutSeconds: 15,
        isPublic: true,
      }),
    );
    await expectGamePath('inv-1');
    window.history.replaceState({}, '', '/');

    await waitFor(() =>
      expect((screen.getByTestId('qa-active-match') as HTMLButtonElement).disabled).toBe(false),
    );
    fireEvent.click(screen.getByTestId('qa-active-match'));
    await waitFor(() => expect(createActiveMatchPreset).toHaveBeenCalledWith(2));
    await expectGamePath('active-1');
    window.history.replaceState({}, '', '/');

    await waitFor(() =>
      expect(
        (screen.getByTestId('qa-spectator-match') as HTMLButtonElement).disabled,
      ).toBe(false),
    );
    fireEvent.click(screen.getByTestId('qa-spectator-match'));
    await waitFor(() => expect(createSpectatorMatchPreset).toHaveBeenCalledTimes(1));
    await expectGamePath('spec-1');
  });

  it('T-90-6: matches the queued quick-pair opponent in one click', async () => {
    renderLobby();

    const button = screen.getByTestId('qa-quick-pair-opponent');
    expect(button.textContent).toBe('Match queued quick-pair opponent');
    fireEvent.click(button);

    await waitFor(() => expect(triggerQaQuickPairOpponent).toHaveBeenCalledTimes(1));
    await expectGamePath('qa-pair-1');
  });

  it('T-90-3 ITEM-6b: QA preset fills the 52-card quick-pair bucket', async () => {
    triggerQaQuickPairOpponent.mockResolvedValue({ gameId: 'qa-pair-52', seatIndex: 0 });
    renderLobby();

    fireEvent.click(screen.getByTestId('qa-quick-pair-52-opponent'));

    await waitFor(() =>
      expect(triggerQaQuickPairOpponent).toHaveBeenCalledWith({ deckSize: 52 }),
    );
    await expectGamePath('qa-pair-52');
  });

  it('T-90-6: launches a four-card small-hand match in one click', async () => {
    renderLobby();

    const button = screen.getByTestId('qa-small-hand-match');
    expect(button.textContent).toBe('Launch small-hand match (4 cards)');
    fireEvent.click(button);

    await waitFor(() => expect(launchQaSmallHandMatch).toHaveBeenCalledTimes(1));
    await expectGamePath('small-1');
  });

  it('T-90-3 ITEM-6b: queues each 52-card tile with deckSize 52', async () => {
    renderLobby();

    const cases = [
      ['quick-pair-52-2-15', 2, 15],
      ['quick-pair-52-2-30', 2, 30],
      ['quick-pair-52-3-30', 3, 30],
    ] as const;

    for (const [id, playerCount, turnTimeoutSeconds] of cases) {
      joinQuickPair.mockResolvedValueOnce({
        status: 'searching',
        playerCount,
        turnTimeoutSeconds,
        allowRedirect: true,
        queuedCount: 1,
        requiredCount: playerCount,
      });
      expect(screen.getByTestId(id).textContent).toContain('52 cards');
      fireEvent.click(screen.getByTestId(id));

      await waitFor(() =>
        expect(joinQuickPair).toHaveBeenLastCalledWith({
          playerCount,
          turnTimeoutSeconds,
          allowRedirect: true,
          deckSize: 52,
        }),
      );
      await screen.findByTestId('quick-pair-searching');
    }

    expect(window.location.pathname).toBe('/');
  });

  /** ITEM-7c: bot seats are always ready, so the server answers `matched` and
   * the lobby navigates in one click instead of showing a searching state. */
  it('T-90-3 ITEM-7c: bot tiles start the match immediately', async () => {
    renderLobby();

    const cases = [
      [
        'quick-pair-bot-2-random',
        {
          playerCount: 2,
          turnTimeoutSeconds: 15,
          allowRedirect: true,
          botOpponent: 'randomBot',
        },
        'bot-random',
      ],
      [
        'quick-pair-bot-2-basic',
        {
          playerCount: 2,
          turnTimeoutSeconds: 30,
          allowRedirect: true,
          botOpponent: 'basicBot',
        },
        'bot-basic',
      ],
      [
        'quick-pair-bot-4-basic',
        {
          playerCount: 4,
          turnTimeoutSeconds: 30,
          allowRedirect: true,
          botOpponent: 'basicBot',
        },
        'bot-3xbasic',
      ],
    ] as const;

    for (const [id, request, gameId] of cases) {
      joinQuickPair.mockResolvedValueOnce({ status: 'matched', gameId, seatIndex: 0 });
      fireEvent.click(screen.getByTestId(id));

      await expectGamePath(gameId);
      expect(joinQuickPair).toHaveBeenLastCalledWith(request);
      expect(screen.queryByTestId('quick-pair-searching')).toBeNull();
      window.history.replaceState({}, '', '/');
    }
  });

  /** ITEM-8b: one faded logo sliced across the tiles, never in the gaps. */
  it('T-90-3 ITEM-8b: spreads one mosaic logo across all twelve tiles', () => {
    renderLobby();

    const tiles = Array.from(
      document.querySelectorAll<HTMLButtonElement>('.quick-pair-tile'),
    );
    expect(tiles).toHaveLength(12);

    const positions = new Set<string>();
    tiles.forEach((tile, index) => {
      expect(tile.getAttribute('data-mosaic-col')).toBe(String(index % 3));
      expect(tile.getAttribute('data-mosaic-row')).toBe(String(Math.floor(index / 3)));
      expect(tile.style.backgroundImage).toContain('data:image/svg+xml');
      expect(tile.style.backgroundRepeat).toBe('no-repeat');
      // JSDOM has no layout, so the pure-CSS fallback is in charge there.
      expect(tile.style.backgroundSize).toContain('calc(var(--mosaic-cols)');
      positions.add(tile.style.backgroundPosition);
    });
    // Every tile paints a different slice of the same logo.
    expect(positions.size).toBe(12);

    expect(lobbyCss).toMatch(/\.quick-pair-grid\s*\{[^}]*--mosaic-cols:\s*3/);
    expect(lobbyCss).toMatch(/\.quick-pair-grid\s*\{[^}]*--mosaic-rows:\s*4/);
    expect(lobbyCss).toMatch(/\.quick-pair-tile\s*\{[^}]*background-repeat:\s*no-repeat/);
    // The slice is clipped by the rounded border, so it never leaks into a gap.
    expect(lobbyCss).toMatch(/\.quick-pair-tile\s*\{[^}]*border-radius:/);
  });

  it('T-90-3 ITEM-8b: re-tints the mosaic when the profile theme changes', async () => {
    renderLobby();

    const tile = screen.getByTestId('quick-pair-2-15');
    const dark = tile.style.backgroundImage;
    expect(dark).toContain('data:image/svg+xml');

    act(() => {
      setSettings({ theme: 'light' });
    });

    await waitFor(() => expect(tile.style.backgroundImage).not.toBe(dark));
    expect(tile.style.backgroundImage).toContain('data:image/svg+xml');
  });

  it('T-90-3 ITEM-6b: offers 36/52 cards and sends the chosen deck', async () => {
    renderLobby();

    fireEvent.click(screen.getByRole('tab', { name: 'Create a Game' }));
    const deck = screen.getByTestId('create-game-deck-size');
    const thirtySix = within(deck).getByRole('button', { name: '36 cards' });
    const fiftyTwo = within(deck).getByRole('button', { name: '52 cards' });

    expect(thirtySix.getAttribute('aria-pressed')).toBe('true');
    expect((thirtySix as HTMLButtonElement).disabled).toBe(false);
    fireEvent.click(fiftyTwo);
    expect(fiftyTwo.getAttribute('aria-pressed')).toBe('true');

    fireEvent.click(screen.getByRole('button', { name: 'Create room' }));
    await waitFor(() =>
      expect(createRoom).toHaveBeenCalledWith(
        expect.objectContaining({ playerCount: 2, deckSize: 52 }),
      ),
    );
  });

  it('T-90-3 ITEM-6b: locks a four-player table to 52 cards', () => {
    renderLobby();

    fireEvent.click(screen.getByRole('tab', { name: 'Create a Game' }));
    const deck = screen.getByTestId('create-game-deck-size');
    const thirtySix = within(deck).getByRole('button', {
      name: '36 cards',
    }) as HTMLButtonElement;
    const fiftyTwo = within(deck).getByRole('button', { name: '52 cards' });

    fireEvent.click(screen.getByRole('button', { name: '4 players' }));
    expect(thirtySix.disabled).toBe(true);
    expect(fiftyTwo.getAttribute('aria-pressed')).toBe('true');

    // A three-player table may still choose either deck.
    fireEvent.click(screen.getByRole('button', { name: '3 players' }));
    expect(thirtySix.disabled).toBe(false);
    expect(within(deck).getByRole('button', { name: '52 cards' })).toBeTruthy();

    fireEvent.click(screen.getByRole('button', { name: '2 players' }));
    expect(thirtySix.disabled).toBe(false);
    expect(thirtySix.getAttribute('aria-pressed')).toBe('true');
  });

  it('T-90-3 ITEM-7d: renders a visual seat map for the table size', () => {
    renderLobby();

    fireEvent.click(screen.getByRole('tab', { name: 'Create a Game' }));
    const map = screen.getByTestId('create-game-seat-map');
    expect(map.getAttribute('data-player-count')).toBe('2');
    expect(within(map).getByTestId('seat-card-0').textContent).toContain('You');
    expect(within(map).getByTestId('seat-card-1').textContent).toContain('Human');
    expect(within(map).queryByTestId('seat-card-2')).toBeNull();

    fireEvent.click(screen.getByRole('button', { name: '4 players' }));
    expect(map.getAttribute('data-player-count')).toBe('4');
    for (const index of [0, 1, 2, 3]) {
      expect(screen.getByTestId(`seat-card-${index}`)).toBeTruthy();
    }
    expect(screen.queryByTestId('seat-card-4')).toBeNull();

    // Desktop uses the right half of the panel; narrow screens stack.
    expect(lobbyCss).toMatch(
      /@media \(min-width: 900px\)\s*\{\s*\.create-invite-form\s*\{[^}]*grid-template-columns:\s*minmax\(0, 1fr\) minmax\(0, 1fr\)/,
    );
    expect(lobbyCss).toMatch(/\.create-seat-map\s*\{[^}]*display:\s*grid/);
  });

  it('T-90-3 ITEM-7d: sends the per-seat bot plan with the creator in seat 0', async () => {
    renderLobby();

    fireEvent.click(screen.getByRole('tab', { name: 'Create a Game' }));
    const seatOne = screen.getByTestId('seat-card-1');
    fireEvent.click(within(seatOne).getByRole('button', { name: 'BasicBot' }));
    expect(seatOne.getAttribute('data-seat-type')).toBe('basicBot');
    expect(seatOne.textContent).toContain('BasicBot');

    fireEvent.click(screen.getByRole('button', { name: 'Create room' }));

    await waitFor(() =>
      expect(createRoom).toHaveBeenCalledWith(
        expect.objectContaining({
          playerCount: 2,
          deckSize: 36,
          seatTypes: ['human', 'basicBot'],
          creatorSeatIndex: 0,
          spectateAsCreator: false,
        }),
      ),
    );
    await expectGamePath('inv-1');
  });

  it('T-90-3 ITEM-7d: dev mode can deselect the creator for an all-bot spectate', async () => {
    renderLobby();

    fireEvent.click(screen.getByRole('tab', { name: 'Create a Game' }));
    const seatZero = screen.getByTestId('seat-card-0');
    fireEvent.click(within(seatZero).getByRole('button', { name: 'RandomBot' }));
    expect(seatZero.getAttribute('data-seat-type')).toBe('randomBot');
    fireEvent.click(
      within(screen.getByTestId('seat-card-1')).getByRole('button', { name: 'BasicBot' }),
    );

    fireEvent.click(screen.getByRole('button', { name: 'Create room' }));

    await waitFor(() =>
      expect(createRoom).toHaveBeenCalledWith(
        expect.objectContaining({
          seatTypes: ['randomBot', 'basicBot'],
          creatorSeatIndex: null,
          spectateAsCreator: true,
        }),
      ),
    );
    await expectGamePath('inv-1');
  });

  it('T-90-3 ITEM-7d: production mode locks seat 0 to the creator', () => {
    render(
      <CreateInviteTab allowAllBots={false} guestName="Mira" onCreated={vi.fn()} />,
    );

    const seatZero = screen.getByTestId('seat-card-0');
    expect(seatZero.textContent).toContain('Mira');
    for (const name of ['Human', 'RandomBot', 'BasicBot']) {
      expect(
        (within(seatZero).getByRole('button', { name }) as HTMLButtonElement).disabled,
      ).toBe(true);
    }

    const seatOne = screen.getByTestId('seat-card-1');
    expect(
      (within(seatOne).getByRole('button', { name: 'BasicBot' }) as HTMLButtonElement).disabled,
    ).toBe(false);
  });

  it('keeps the existing local game editor available below the M2 lobby', () => {
    renderLobby();

    expect(screen.getByLabelText('Players')).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Create Game' })).toBeTruthy();
    expect(screen.getByTestId('qa-scenarios')).toBeTruthy();
  });
});

describe('lobby.css visual invariants', () => {
  it('adopts the Milestone 1 theme tokens instead of dark-only hex colours', () => {
    // The lobby shell resolves every surface from the M1 custom properties the
    // profile Theme menu writes to `<html data-theme>`.
    expect(lobbyCss).toContain('--m2-bg: var(--app-bg)');
    expect(lobbyCss).toContain('--m2-surface: var(--app-panel)');
    expect(lobbyCss).toContain('--m2-surface-raised: var(--bg-elevated)');
    expect(lobbyCss).toContain('--m2-text: var(--app-text)');
    expect(lobbyCss).toContain('--m2-text-strong: var(--app-text-strong)');
    expect(lobbyCss).toContain('--m2-green: var(--app-accent)');
    expect(lobbyCss).toContain('border-color: var(--ui-select-accent)');
    expect(lobbyCss).toContain('background: var(--ui-select-bg)');
    expect(lobbyCss).toContain('color: var(--ui-select-text)');
    expect(lobbyCss).toContain('box-shadow: 0 0 10px 2px var(--ui-select-glow)');
    expect(lobbyCss).toMatch(/border-radius: var\(--app-roundness/);
    // ITEM-5: the glow only ever appears on a hover/focus rule.
    const glowRules = lobbyCss
      .split('}')
      .filter((block) => block.includes('var(--ui-select-glow)'));
    expect(glowRules.length).toBeGreaterThan(0);
    for (const block of glowRules) {
      expect(block).toMatch(/:hover|:focus-visible/);
    }
    expect(lobbyCss).toContain("html[data-theme='light'] .m2-lobby");
  });

  it('lays out with Grid/Flexbox gaps only and never freeform positioning', () => {
    expect(lobbyCss).toContain('display: grid');
    expect(lobbyCss).toContain('display: flex');
    expect(lobbyCss).toContain('gap:');
    expect(lobbyCss).toContain('min-width: 0');
    expect(lobbyCss).toContain('box-sizing: border-box');
    expect(lobbyCss).not.toMatch(/position:\s*(absolute|fixed)/);
  });

  it('T-96b: paints every M2 selection with the M1 cobalt --ui-select-* family', () => {
    /** The declaration block of the first rule that starts with `selector`. */
    const ruleFor = (selector: string) => {
      const at = lobbyCss.indexOf(selector);
      if (at < 0) return '';
      const open = lobbyCss.indexOf('{', at);
      return lobbyCss.slice(at, lobbyCss.indexOf('}', open) + 1);
    };

    // Active and hovered lobby tabs.
    expect(ruleFor('.m2-lobby-tab.active')).toContain('var(--ui-select-accent)');
    expect(ruleFor('.m2-lobby-tab.active')).toContain('var(--ui-select-bg)');
    expect(ruleFor('.m2-lobby-tab.active')).toContain('var(--ui-select-text)');
    expect(ruleFor('.m2-lobby-tab:hover')).toContain('var(--ui-select-accent)');

    // Quick Pairing tiles.
    expect(ruleFor('.quick-pair-tile:hover:not(:disabled)')).toContain(
      'var(--ui-select-accent)',
    );
    expect(ruleFor('.quick-pair-tile:hover:not(:disabled)')).toContain(
      'var(--ui-select-bg)',
    );
    expect(ruleFor('.quick-pair-tile:focus-visible:not(:disabled)')).toContain(
      'var(--ui-select-accent)',
    );

    // Create a Game segmented controls, checkbox and primary submit button.
    expect(ruleFor(".segmented-option[aria-pressed='true']")).toContain(
      'border-color: var(--ui-select-accent)',
    );
    expect(ruleFor(".segmented-option[aria-pressed='true']")).toContain(
      'background: var(--ui-select-bg)',
    );
    expect(ruleFor(".segmented-option[aria-pressed='true']")).toContain(
      'color: var(--ui-select-text)',
    );
    expect(ruleFor('.segmented-option:hover')).toContain('var(--ui-select-accent)');
    expect(ruleFor('.create-invite-toggle input')).toContain(
      'accent-color: var(--ui-select-accent)',
    );
    expect(ruleFor('.m2-button {')).toContain('background: var(--ui-select-accent)');

    // Secondary buttons and guest identity controls.
    expect(ruleFor('.m2-button.secondary:hover:not(:disabled)')).toContain(
      'var(--ui-select-accent)',
    );
    expect(ruleFor('.m2-button.secondary:hover:not(:disabled)')).toContain(
      'var(--ui-select-text)',
    );
    expect(ruleFor('.m2-button:hover:not(:disabled)')).toContain('var(--ui-select-glow)');
    expect(ruleFor('.create-seat-option:hover:not(:disabled)')).toContain(
      'var(--ui-select-glow)',
    );

    // No selection rule may fall back to the attacker/status green.
    for (const selector of [
      '.m2-lobby-tab.active',
      '.quick-pair-tile:hover:not(:disabled)',
      ".segmented-option[aria-pressed='true']",
      '.create-invite-toggle input',
      '.m2-button {',
    ]) {
      expect(ruleFor(selector)).not.toContain('--m2-green');
    }
  });

  /** T-90-4 ITEM-5: zero resting glow, hover-only highlight in both themes. */
  it('ITEM-5: rest states are flat and only hover/focus adds the glow', () => {
    /** The declaration block of the first rule that starts with `selector`. */
    const ruleFor = (selector: string) => {
      const at = lobbyCss.indexOf(selector);
      if (at < 0) return '';
      const open = lobbyCss.indexOf('{', at);
      return lobbyCss.slice(at, lobbyCss.indexOf('}', open) + 1);
    };

    // Flat resting surfaces: panels, tiles, buttons, segmented controls, tabs,
    // pool rows and the Create-a-Game seat map.
    for (const selector of [
      '.m2-panel {',
      '.quick-pair-tile {',
      '.m2-button {',
      '.m2-button.primary {',
      '.segmented-option {',
      '.m2-lobby-tab {',
      '.lobby-pool-row {',
      '.create-seat-card {',
      '.create-seat-option {',
    ]) {
      const rule = ruleFor(selector);
      expect(rule, selector).toContain('box-shadow: none');
      expect(rule, selector).not.toContain('--ui-select-glow');
    }

    // Selected states are crisp flat pills, never a resting glow.
    for (const selector of [
      ".segmented-option[aria-pressed='true']",
      ".create-seat-option[aria-pressed='true']",
      '.m2-lobby-tab.active',
    ]) {
      const rule = ruleFor(selector);
      expect(rule, selector).toContain('box-shadow: none');
      expect(rule, selector).not.toContain('--ui-select-glow');
    }

    // The shell itself is flat too.
    expect(lobbyCss).toMatch(/\.m2-lobby\s*\{[^}]*display:\s*grid[^}]*box-shadow:\s*none/);
    expect(lobbyCss).not.toContain('box-shadow: var(--app-shadow)');

    // The highlight is applied on hover/focus only, for interactive elements.
    for (const selector of [
      '.m2-button:hover:not(:disabled)',
      '.quick-pair-tile:hover:not(:disabled)',
      '.segmented-option:hover:not(:disabled)',
      '.create-seat-option:hover:not(:disabled)',
      '.m2-lobby-tab:hover',
    ]) {
      expect(ruleFor(selector), selector).toContain('var(--ui-select-glow)');
    }

    // ...and the same highlight is wired for the Light theme tokens.
    for (const selector of [
      "html[data-theme='light'] .quick-pair-tile:hover:not(:disabled)",
      "html[data-theme='light'] .segmented-option:hover:not(:disabled)",
      "html[data-theme='light'] .create-seat-option:hover:not(:disabled)",
    ]) {
      expect(lobbyCss, selector).toContain(selector);
    }
    expect(lobbyCss).toContain('0 0 0 1px var(--ui-select-border), 0 0 12px var(--ui-select-glow)');

    // Never a drop-shadow or text-shadow halo anywhere in the lobby styles.
    expect(lobbyCss).not.toContain('filter: drop-shadow');
    expect(lobbyCss).not.toContain('text-shadow');
  });

  it('keeps the M2 panel headings light on the dark panel', () => {
    // T-96 ITEM-3: `.lobby-page h2` (0,1,1) must lose to the scoped panel title.
    expect(lobbyCss).toContain('.m2-lobby .m2-panel-title');
    expect(lobbyCss).toContain('color: var(--m2-text-strong);');
  });

  it('T-90: keeps no styles from the removed multiplayer placeholder', () => {
    // The lightweight placeholder shell is gone: the live room now renders the
    // M1 gameplay interface, so none of its `.multiplayer-page` or `.mp-*`
    // placeholder rules may survive in the lobby stylesheet.
    expect(lobbyCss).not.toContain('.multiplayer-page');
    expect(lobbyCss).not.toMatch(/\.mp-[a-z-]+/);
    expect(lobbyCss).toContain('.m2-button.secondary');
  });

  it('adapts below 640px and caps the desktop shell', () => {
    expect(lobbyCss).toMatch(/@media \(max-width: 640px\)/);
    expect(lobbyCss).toMatch(/@media \(min-width: 1400px\)/);
    expect(lobbyCss).toContain('grid-template-columns: repeat(2, minmax(0, 1fr))');
    expect(lobbyCss).toContain('overflow-wrap: anywhere');
  });
});
