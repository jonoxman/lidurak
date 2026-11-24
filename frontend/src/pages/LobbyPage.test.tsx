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
}));

import * as client from '../api/client';
import * as lobbyApi from '../api/lobbyClient';
import * as sessionApi from '../api/sessionClient';
import type { LobbyRoomSummary } from '../types/multiplayer';
import lobbyCss from '../styles/lobby.css?raw';
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
    window.history.replaceState({}, '', '/');
    window.location.hash = '';
    socketHandlers = null;

    checkServerHealth.mockResolvedValue(true);
    getOrCreateSession.mockResolvedValue(GUEST);
    updateGuestName.mockResolvedValue({ ...GUEST, displayName: 'Ace' });
    fetchLobbyRooms.mockResolvedValue([]);
    joinQuickPair.mockResolvedValue({ status: 'matched', gameId: 'qp-1', seatIndex: 0 });
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
    expect(screen.getByRole('tab', { name: 'Create Invite Link' })).toBeTruthy();
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

  it('joins a Quick Pairing preset and navigates to its game table', async () => {
    renderLobby();

    fireEvent.click(screen.getByRole('button', { name: /2P • 15s/ }));

    await waitFor(() =>
      expect(joinQuickPair).toHaveBeenCalledWith({
        playerCount: 2,
        turnTimeoutSeconds: 15,
        allowRedirect: true,
      }),
    );
    await waitFor(() => expect(window.location.pathname).toBe('/g/qp-1'));
    expect(window.location.hash).toBe('');
  });

  it('shows a searching state whose Cancel leaves the pairing queue', async () => {
    joinQuickPair.mockReturnValue(new Promise(() => {}));
    renderLobby();

    fireEvent.click(screen.getByRole('button', { name: /3P • 30s/ }));

    const searching = await screen.findByTestId('quick-pair-searching');
    expect(searching.textContent).toContain('3P • 30s');
    fireEvent.click(within(searching).getByRole('button', { name: 'Cancel' }));

    await waitFor(() => expect(cancelQuickPair).toHaveBeenCalledTimes(1));
    expect(screen.queryByTestId('quick-pair-searching')).toBeNull();
  });

  it('stays on the lobby while the quick-pair request is queued', async () => {
    joinQuickPair.mockResolvedValue({
      status: 'queued',
      playerCount: 2,
      turnTimeoutSeconds: 15,
      allowRedirect: true,
      queuedCount: 1,
    });
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
    expect(searching.textContent).toContain('2P • 15s');
    // Queued is not matched: the player must not leave the lobby.
    expect(window.location.pathname).toBe('/');
    expect((screen.getByTestId('quick-pair-2-15') as HTMLButtonElement).disabled).toBe(true);
  });

  it('cancels a queued quick pairing without leaving the lobby', async () => {
    joinQuickPair.mockResolvedValue({
      status: 'queued',
      playerCount: 3,
      turnTimeoutSeconds: 30,
      allowRedirect: true,
      queuedCount: 1,
    });
    renderLobby();

    fireEvent.click(screen.getByTestId('quick-pair-3-30'));
    const searching = await screen.findByTestId('quick-pair-searching');
    fireEvent.click(within(searching).getByRole('button', { name: 'Cancel' }));

    await waitFor(() => expect(cancelQuickPair).toHaveBeenCalledTimes(1));
    expect(screen.queryByTestId('quick-pair-searching')).toBeNull();
    expect(window.location.pathname).toBe('/');
    expect((screen.getByTestId('quick-pair-3-30') as HTMLButtonElement).disabled).toBe(false);
  });

  it('navigates to the matched table when quickPairMatched arrives on /ws/lobby', async () => {
    joinQuickPair.mockResolvedValue({
      status: 'queued',
      playerCount: 2,
      turnTimeoutSeconds: 15,
      allowRedirect: true,
      queuedCount: 1,
    });
    renderLobby();

    fireEvent.click(screen.getByTestId('quick-pair-2-15'));
    await screen.findByTestId('quick-pair-searching');
    await waitFor(() => expect(socketHandlers).not.toBeNull());

    act(() => {
      socketHandlers?.onQuickPairMatched?.('qp-ws-1', 0);
    });

    await expectGamePath('qp-ws-1');
    expect(screen.queryByTestId('quick-pair-searching')).toBeNull();
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

    fireEvent.click(screen.getByRole('tab', { name: 'Create Invite Link' }));
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

  it('keeps the existing local game editor available below the M2 lobby', () => {
    renderLobby();

    expect(screen.getByLabelText('Players')).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Create Game' })).toBeTruthy();
    expect(screen.getByTestId('qa-scenarios')).toBeTruthy();
  });
});

describe('lobby.css visual invariants', () => {
  it('uses the dark Lichess palette', () => {
    expect(lobbyCss).toContain('#161512');
    expect(lobbyCss).toContain('#262421');
    expect(lobbyCss).toContain('#bababa');
    expect(lobbyCss).toContain('#629924');
    expect(lobbyCss).toContain('#c33');
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

  it('shares the M2 palette and button styling with the multiplayer shell', () => {
    // T-96 ITEM-2: the tokens live on both M2 shells, not the lobby alone.
    expect(lobbyCss).toMatch(/\.m2-lobby,\s*\n\.multiplayer-page \{/);
    expect(lobbyCss).toContain('--m2-text-strong: #f1f1f1;');
    expect(lobbyCss).toContain('.multiplayer-page .m2-button.secondary');
  });

  it('adapts below 640px and caps the desktop shell', () => {
    expect(lobbyCss).toMatch(/@media \(max-width: 640px\)/);
    expect(lobbyCss).toMatch(/@media \(min-width: 1400px\)/);
    expect(lobbyCss).toContain('grid-template-columns: repeat(2, minmax(0, 1fr))');
    expect(lobbyCss).toContain('overflow-wrap: anywhere');
  });
});
