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
import { LobbyPage } from './LobbyPage';

const checkServerHealth = client.checkServerHealth as unknown as ReturnType<typeof vi.fn>;
const getOrCreateSession =
  sessionApi.getOrCreateSession as unknown as ReturnType<typeof vi.fn>;
const updateGuestName = sessionApi.updateGuestName as unknown as ReturnType<typeof vi.fn>;
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
    updateGuestName.mockResolvedValue({ ...GUEST, displayName: 'Ace' });
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

  it('renders the brand, guest badge and the three lobby tabs', async () => {
    renderLobby();

    const badge = await screen.findByRole('button', { name: 'Edit guest name' });
    expect(badge.textContent).toBe('Guest-AB12');
    expect(getOrCreateSession).toHaveBeenCalledTimes(1);

    expect(screen.getByTestId('m2-lobby')).toBeTruthy();
    expect(screen.getByText('LIDURAK')).toBeTruthy();
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

  it('renames the guest through the editable identity badge', async () => {
    renderLobby();

    fireEvent.click(await screen.findByRole('button', { name: 'Edit guest name' }));
    const input = screen.getByLabelText('Guest name');
    fireEvent.input(input, { target: { value: 'Ace' } });
    fireEvent.submit(input.closest('form') as HTMLFormElement);

    await waitFor(() => expect(updateGuestName).toHaveBeenCalledWith('Ace'));
    await waitFor(() =>
      expect(screen.getByRole('button', { name: 'Edit guest name' }).textContent).toBe('Ace'),
    );
  });

  it('opens Quick Pairing on the Quick Pairing tab by default', () => {
    renderLobby();

    expect(screen.getByRole('button', { name: /2P • 15s/ })).toBeTruthy();
    expect(screen.getByRole('button', { name: /2P • 30s/ })).toBeTruthy();
    expect(screen.getByRole('button', { name: /3P • 15s/ })).toBeTruthy();
    expect(screen.getByRole('button', { name: /3P • 30s/ })).toBeTruthy();
    expect(screen.getByRole('button', { name: /4P • 15s/ })).toBeTruthy();
    expect(screen.getByRole('button', { name: /4P • 30s/ })).toBeTruthy();
  });

  it('ITEM-2a: renders all six quick-pairing tiles at double height', () => {
    renderLobby();

    const ids = [
      'quick-pair-2-15',
      'quick-pair-2-30',
      'quick-pair-3-15',
      'quick-pair-3-30',
      'quick-pair-4-15',
      'quick-pair-4-30',
    ];
    for (const id of ids) {
      const tile = screen.getByTestId(id);
      expect(tile.classList.contains('quick-pair-tile')).toBe(true);
      expect(tile.getAttribute('data-height')).toBe('double');
    }

    // The layout is unchanged: the tile just grows, the 3x2 grid stays put.
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
    expect(lobbyCss).toMatch(/\.m2-lobby\s*\{[^}]*--m2-green: var\(--app-accent\)/);
    expect(lobbyCss).toContain("html[data-theme='light'] .m2-lobby");

    // The theme-reactive token block itself carries no hardcoded hex colour.
    const tokenStart = lobbyCss.indexOf('.m2-lobby {');
    const tokenBlock = lobbyCss.slice(tokenStart, lobbyCss.indexOf('}', tokenStart));
    expect(tokenBlock).not.toMatch(/#[0-9a-fA-F]{3,6}/);
  });

  it('ITEM-1b: stays on the lobby with the searching status while queued', async () => {
    renderLobby();

    fireEvent.click(screen.getByRole('button', { name: /2P • 15s/ }));

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

    fireEvent.click(screen.getByRole('button', { name: /2P • 15s/ }));

    await expectGamePath('xyz98765');
    expect(screen.queryByTestId('quick-pair-searching')).toBeNull();
  });

  it('navigates when /ws/lobby pushes quickPairMatched to a waiting player', async () => {
    renderLobby();

    fireEvent.click(screen.getByRole('button', { name: /2P • 15s/ }));
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

    fireEvent.click(screen.getByRole('button', { name: /3P • 30s/ }));

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

  it('T-90-6: launches a four-card small-hand match in one click', async () => {
    renderLobby();

    const button = screen.getByTestId('qa-small-hand-match');
    expect(button.textContent).toBe('Launch small-hand match (4 cards)');
    fireEvent.click(button);

    await waitFor(() => expect(launchQaSmallHandMatch).toHaveBeenCalledTimes(1));
    await expectGamePath('small-1');
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
    expect(lobbyCss).toMatch(/border-radius: var\(--app-roundness/);
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
