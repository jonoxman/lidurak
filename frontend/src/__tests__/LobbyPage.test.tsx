import { beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, waitFor, within } from '@testing-library/preact';

vi.mock('../api/client', () => ({
  checkServerHealth: vi.fn(),
  createGame: vi.fn(),
  createPresetGame: vi.fn(),
}));

import * as client from '../api/client';
import { LobbyPage } from '../pages/LobbyPage';
import appCss from '../app.css?raw';

const createGame = client.createGame as unknown as ReturnType<typeof vi.fn>;
const checkServerHealth = client.checkServerHealth as unknown as ReturnType<typeof vi.fn>;
const createPresetGame = client.createPresetGame as unknown as ReturnType<typeof vi.fn>;

/** Declarations of the first rule whose selector text contains `selector`. */
function cssRule(css: string, selector: string): string {
  const start = css.indexOf(selector);
  if (start === -1) return '';
  const open = css.indexOf('{', start);
  const close = css.indexOf('}', open);
  return open === -1 || close === -1 ? '' : css.slice(open + 1, close);
}

const submitForm = () => {
  const button = screen.getByRole('button', { name: /Create Game|Creating/ });
  fireEvent.submit(button.closest('form') as HTMLFormElement);
};

const humanSeats = (count: number) => Array.from({ length: count }, () => 'human');

describe('LobbyPage', () => {
  beforeEach(() => {
    createGame.mockReset();
    checkServerHealth.mockReset();
    createPresetGame.mockReset();
    checkServerHealth.mockResolvedValue(true);
    window.location.hash = '';
  });

  it('renders a two-player form with a seat-type dropdown per player', () => {
    render(<LobbyPage initialServerReady />);

    expect(screen.getByLabelText('Players')).toBeTruthy();
    expect((screen.getByLabelText('Player 1') as HTMLInputElement).value).toBe('Alice');
    expect((screen.getByLabelText('Player 2') as HTMLInputElement).value).toBe('Bob');
    expect(screen.queryByLabelText('Player 3')).toBeNull();
    expect(screen.getByLabelText('Allow redirects')).toBeTruthy();
    expect((screen.getByLabelText('Player 1 type') as HTMLSelectElement).value).toBe('human');
    expect((screen.getByTestId('player-type-1') as HTMLSelectElement).value).toBe('human');
  });

  it('adds a name field per extra player when the count changes', async () => {
    render(<LobbyPage initialServerReady />);

    fireEvent.change(screen.getByLabelText('Players'), { target: { value: '4' } });

    await waitFor(() => expect(screen.getByLabelText('Player 4')).toBeTruthy());
    expect((screen.getByLabelText('Player 3') as HTMLInputElement).value).toBe('Carol');
  });

  it('offers Human, RandomBot and BasicBot for every player row', async () => {
    render(<LobbyPage initialServerReady />);

    fireEvent.change(screen.getByLabelText('Players'), { target: { value: '4' } });

    await waitFor(() => expect(screen.getByTestId('player-type-3')).toBeTruthy());
    for (let index = 0; index < 4; index += 1) {
      expect(screen.getByLabelText(`Player ${index + 1}`)).toBeTruthy();
      const select = screen.getByTestId(`player-type-${index}`) as HTMLSelectElement;
      expect(select.value).toBe('human');
      expect(Array.from(select.options).map((option) => option.value)).toEqual([
        'human',
        'randomBot',
        'basicBot',
      ]);
      expect(Array.from(select.options).map((option) => option.textContent)).toEqual([
        'Human',
        'RandomBot',
        'BasicBot',
      ]);
    }
  });

  it('places BasicBot directly below RandomBot and sends it to createGame', async () => {
    createGame.mockResolvedValue({ gameId: 'game-3', players: ['p0', 'p1'] });
    render(<LobbyPage initialServerReady />);

    const select = screen.getByTestId('player-type-0') as HTMLSelectElement;
    const values = Array.from(select.options).map((option) => option.value);
    expect(values.indexOf('basicBot')).toBe(values.indexOf('randomBot') + 1);
    expect(select.querySelector('option[value="basicBot"]')?.textContent).toBe('BasicBot');

    fireEvent.change(select, { target: { value: 'basicBot' } });
    submitForm();

    await waitFor(() =>
      expect(createGame).toHaveBeenCalledWith(2, ['Alice', 'Bob'], true, false, [
        'basicBot',
        'human',
      ]),
    );
  });

  it('passes the selected player types to createGame', async () => {
    createGame.mockResolvedValue({ gameId: 'game-2', players: ['p0', 'p1'] });
    render(<LobbyPage initialServerReady />);

    fireEvent.change(screen.getByTestId('player-type-1'), { target: { value: 'randomBot' } });
    submitForm();

    await waitFor(() =>
      expect(createGame).toHaveBeenCalledWith(2, ['Alice', 'Bob'], true, false, [
        'human',
        'randomBot',
      ]),
    );
  });

  it('keeps seat choices when the count grows and defaults new seats to human', async () => {
    render(<LobbyPage initialServerReady />);

    fireEvent.change(screen.getByTestId('player-type-0'), { target: { value: 'randomBot' } });
    fireEvent.change(screen.getByLabelText('Players'), { target: { value: '3' } });

    await waitFor(() => expect(screen.getByTestId('player-type-2')).toBeTruthy());
    expect((screen.getByTestId('player-type-0') as HTMLSelectElement).value).toBe('randomBot');
    expect((screen.getByTestId('player-type-2') as HTMLSelectElement).value).toBe('human');
  });

  it('creates a game with the chosen names and links every player view', async () => {
    createGame.mockResolvedValue({ gameId: 'game-1', players: ['p0', 'p1', 'p2'] });
    render(<LobbyPage initialServerReady />);

    fireEvent.change(screen.getByLabelText('Players'), { target: { value: '3' } });
    fireEvent.input(screen.getByLabelText('Player 1'), { target: { value: 'Zoe' } });
    fireEvent.change(screen.getByLabelText('Allow redirects'), { target: { checked: false } });
    submitForm();

    await waitFor(() =>
      expect(createGame).toHaveBeenCalledWith(
        3,
        ['Zoe', 'Bob', 'Carol'],
        false,
        false,
        humanSeats(3),
      ),
    );

    const alice = await screen.findByRole('link', { name: 'Zoe (p0)' });
    expect(alice.getAttribute('href')).toBe('#/g/game-1?player=p0');
    expect(screen.getByRole('link', { name: 'Bob (p1)' }).getAttribute('href')).toBe(
      '#/g/game-1?player=p1',
    );
    expect(screen.getByRole('link', { name: 'Carol (p2)' }).getAttribute('href')).toBe(
      '#/g/game-1?player=p2',
    );
  });

  it('offers chaos mode only for three or more players and sends it on create', async () => {
    createGame.mockResolvedValue({ gameId: 'game-1', players: ['p0', 'p1', 'p2'] });
    render(<LobbyPage initialServerReady />);

    expect(screen.queryByLabelText('Chaos mode (attack any player)')).toBeNull();

    fireEvent.change(screen.getByLabelText('Players'), { target: { value: '3' } });
    const chaos = await screen.findByLabelText('Chaos mode (attack any player)');
    expect((chaos as HTMLInputElement).checked).toBe(false);

    fireEvent.click(chaos);
    submitForm();

    await waitFor(() =>
      expect(createGame).toHaveBeenCalledWith(
        3,
        ['Alice', 'Bob', 'Carol'],
        true,
        true,
        humanSeats(3),
      ),
    );
  });

  it('drops chaos mode when the player count returns to two', async () => {
    createGame.mockResolvedValue({ gameId: 'game-1', players: ['p0', 'p1'] });
    render(<LobbyPage initialServerReady />);

    fireEvent.change(screen.getByLabelText('Players'), { target: { value: '4' } });
    fireEvent.click(await screen.findByLabelText('Chaos mode (attack any player)'));
    fireEvent.change(screen.getByLabelText('Players'), { target: { value: '2' } });

    expect(screen.queryByLabelText('Chaos mode (attack any player)')).toBeNull();
    submitForm();

    await waitFor(() =>
      expect(createGame).toHaveBeenCalledWith(2, ['Alice', 'Bob'], true, false, humanSeats(2)),
    );
  });

  it('shows a themed loading page until the backend answers its health check', async () => {
    checkServerHealth.mockResolvedValue(false);
    render(<LobbyPage initialServerReady={false} />);

    const loading = await screen.findByTestId('server-loading');
    expect(loading.getAttribute('role')).toBe('status');
    expect(loading.className).toContain('server-loading-page');
    expect(loading.textContent).toContain('Starting game server, please wait');
    // The readiness wheel is the spinning ring, not a static dash glyph.
    const spinner = screen.getByTestId('lobby-loading-spinner');
    expect(spinner.classList.contains('lobby-loading-spinner')).toBe(true);
    expect(loading.contains(spinner)).toBe(true);
    expect(screen.queryByRole('button', { name: 'Create Game' })).toBeNull();
    expect(screen.queryByLabelText('Players')).toBeNull();

    // The server finishes booting and the next poll unlocks the form.
    checkServerHealth.mockResolvedValue(true);
    await waitFor(
      () => expect(screen.getByRole('button', { name: 'Create Game' })).toBeTruthy(),
      { timeout: 3000 },
    );
    expect(screen.queryByTestId('server-loading')).toBeNull();
  });

  it('keeps the create form hidden while the health check keeps failing', async () => {
    checkServerHealth.mockResolvedValue(false);
    render(<LobbyPage />);

    await screen.findByTestId('server-loading');

    expect(checkServerHealth).toHaveBeenCalled();
    expect(screen.queryByRole('button', { name: 'Create Game' })).toBeNull();
  });

  it('falls back to the loading page when creating hits a warming-up server', async () => {
    createGame.mockRejectedValue(new Error('Could not create game (HTTP 500)'));
    render(<LobbyPage initialServerReady />);
    checkServerHealth.mockResolvedValue(false);

    submitForm();

    const loading = await screen.findByTestId('server-loading');
    expect(loading.getAttribute('role')).toBe('status');
    // No raw "Could not create game (HTTP 500)" banner while the server boots.
    expect(screen.queryByRole('alert')).toBeNull();

    checkServerHealth.mockResolvedValue(true);
    await waitFor(
      () => expect(screen.getByRole('button', { name: 'Create Game' })).toBeTruthy(),
      { timeout: 3000 },
    );
  });

  it('treats a network failure on create as the server still starting up', async () => {
    createGame.mockRejectedValue(new TypeError('Failed to fetch'));
    render(<LobbyPage initialServerReady />);
    checkServerHealth.mockResolvedValue(false);

    submitForm();

    expect(await screen.findByTestId('server-loading')).toBeTruthy();
    expect(screen.queryByRole('alert')).toBeNull();
  });

  it('starts every QA scenario preset in one click', async () => {
    createPresetGame.mockResolvedValue({
      gameId: 'preset-1',
      players: ['p0', 'p1'],
      playerTypes: ['human', 'human'],
      defaultPlayerId: 'p1',
    });

    render(<LobbyPage initialServerReady />);

    const panel = screen.getByTestId('qa-scenarios');
    expect(within(panel).getByRole('heading', { name: '⚡ QA Scenarios' })).toBeTruthy();
    for (const label of [
      '3P Redirect (Bob POV)',
      '4P Chaos Targets',
      'Surrender Half-Off',
      'Defenseless Auto-Surrender',
      'Discard & Endgame Durak',
    ]) {
      expect(within(panel).getByRole('button', { name: label })).toBeTruthy();
    }

    fireEvent.click(within(panel).getByRole('button', { name: '3P Redirect (Bob POV)' }));

    await waitFor(() => expect(createPresetGame).toHaveBeenCalledWith('3p-redirect-bob'));
    // The preset opens on the seat that makes the scenario readable.
    await waitFor(() => expect(window.location.hash).toBe('#/g/preset-1?player=p1'));
  });

  it('surfaces a failed QA preset instead of navigating', async () => {
    createPresetGame.mockRejectedValue(new Error('Unknown preset'));
    render(<LobbyPage initialServerReady />);

    fireEvent.click(screen.getByRole('button', { name: '4P Chaos Targets' }));

    const alert = await screen.findByRole('alert');
    expect(alert.textContent).toContain('Unknown preset');
    expect(window.location.hash).not.toContain('preset-1');
  });

  it('T-90: styles the selected player count and primary action with royal blue', () => {
    render(<LobbyPage initialServerReady />);

    // The player-count selector and the primary button are the lobby's chrome.
    expect(screen.getByLabelText('Players')).toBeTruthy();
    const create = screen.getByRole('button', { name: 'Create Game' });
    expect(create.classList.contains('green')).toBe(true);
    expect(screen.getByLabelText('Allow redirects')).toBeTruthy();

    // Dark and light values of the UI selection family.
    expect(appCss).toContain('--ui-select-accent: #3b82f6');
    expect(appCss).toContain('--ui-select-accent: #1d4ed8');
    expect(appCss).toMatch(
      /\.lobby-form \.field select\s*{[^}]*border-color: var\(--ui-select-border\)/,
    );
    expect(appCss).toMatch(
      /\.lobby-form \.action-button\.green[^{]*{[^}]*background: var\(--ui-select-accent\)/,
    );
    // The checkbox tint follows the same family, never the attacker green.
    expect(appCss).toMatch(/\.checkbox-field input\s*{[^}]*accent-color: var\(--ui-select-accent\)/);
  });

  it('shows an error banner when game creation fails for a real reason', async () => {
    createGame.mockRejectedValue(new Error('backend down'));
    render(<LobbyPage initialServerReady />);

    submitForm();

    const alert = await screen.findByRole('alert');
    expect(alert.textContent).toContain('backend down');
    expect(screen.queryByTestId('server-loading')).toBeNull();
  });

  /**
   * T-90 ITEM-1b: the active player-count selector, focused inputs, variant
   * checkboxes and the Create Game / Rematch actions are chrome, so they read
   * from `--ui-select-*` and never from the attacker's emerald green.
   */
  it('T-90 ITEM-1b: every lobby selection stays inside the royal-blue family', () => {
    render(<LobbyPage initialServerReady />);

    const players = screen.getByLabelText('Players') as HTMLSelectElement;
    fireEvent.change(players, { target: { value: '3' } });

    expect(screen.getByLabelText('Allow redirects')).toBeTruthy();
    expect(screen.getByLabelText(/Chaos mode/i)).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Create Game' }).classList.contains('green')).toBe(
      true,
    );

    // The family values exist for both themes.
    expect(appCss).toContain('--ui-select-border: rgba(59, 130, 246, 0.85)');
    expect(appCss).toContain('--ui-select-bg: rgba(59, 130, 246, 0.16)');
    expect(appCss).toContain('--ui-select-border: rgba(29, 78, 216, 0.9)');
    expect(appCss).toContain('--ui-select-bg: rgba(37, 99, 235, 0.14)');

    // The player-count selector, focused inputs, checkboxes and primary actions.
    expect(cssRule(appCss, '.lobby-form .field select')).toContain('var(--ui-select-border)');
    expect(cssRule(appCss, '.field select:focus-visible')).toContain(
      'outline: 2px solid var(--ui-select-accent)',
    );
    expect(cssRule(appCss, '.checkbox-field input')).toContain(
      'accent-color: var(--ui-select-accent)',
    );
    expect(cssRule(appCss, '.lobby-form .action-button.green')).toContain(
      'background: var(--ui-select-accent)',
    );
    expect(
      cssRule(appCss, '.game-over-banner .action-button.banner-rematch-button'),
    ).toContain('background: var(--ui-select-accent)');

    // ...and no lobby selector falls back to attacker green.
    for (const selector of [
      '.lobby-form .field select',
      '.field select:focus-visible',
      '.checkbox-field input',
      '.lobby-form .action-button.green',
      '.game-over-banner .action-button.banner-rematch-button',
    ]) {
      expect(cssRule(appCss, selector), selector).not.toMatch(/#4ade80|#22c55e|#15803d/);
    }
  });
});
