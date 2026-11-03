import { describe, expect, it, vi } from 'vitest';
import { createPresetGame } from '../api/client';
import {
  buildCoverCard,
  buildDeclareSurrender,
  buildInitialAttack,
  buildPassTurn,
  buildRedirectAttack,
  buildThrowInCards,
  hasLegalAction,
  isGameOverPhase,
  isInitialAttackPhase,
  parseGameReplay,
  parsePlayerGameView,
  type PlayerType,
} from '../types';

const six = { suit: 'spades', rank: 'six' };
const seven = { suit: 'spades', rank: 'seven' };

const sampleView = {
  myId: 'p0',
  myHand: [six],
  opponents: [{ id: 'p1', name: 'Bob', cardCount: 3, hasPassed: false, finishRank: null }],
  tablePairs: [{ attack: six, defense: null }],
  talonCount: 20,
  bottomTrumpCard: null,
  trumpSuit: 'spades',
  attackerIdx: 0,
  defenderIdx: 1,
  boutPhase: 'defense',
  legalActions: ['cover', 'surrender', 'redirect'],
  finishOrder: [],
  isDraw: false,
  maxBoutAttacks: 6,
};

describe('discard pile and replay payloads', () => {
  it('parses discard metadata and game timestamps when the backend sends them', () => {
    const view = parsePlayerGameView({
      ...sampleView,
      discardCount: 7,
      lastDiscardCards: [six, seven],
      gameStartedAtMs: 1_700_000_000_000,
      gameEndedAtMs: null,
    });

    expect(view.discardCount).toBe(7);
    expect(view.lastDiscardCards).toEqual([six, seven]);
    expect(view.gameStartedAtMs).toBe(1_700_000_000_000);
    expect(view.gameEndedAtMs).toBeNull();
  });

  it('defaults the discard metadata so older views keep parsing', () => {
    const view = parsePlayerGameView({ ...sampleView });

    expect(view.discardCount).toBe(0);
    expect(view.lastDiscardCards).toEqual([]);
    expect(view.gameStartedAtMs).toBeNull();
    expect(view.gameEndedAtMs).toBeNull();
  });

  it('rejects malformed discard cards instead of trusting the payload', () => {
    expect(() => parsePlayerGameView({ ...sampleView, lastDiscardCards: 'nope' })).toThrow(
      /lastDiscardCards/,
    );
  });

  it('parses a replay payload with per-player views on every frame', () => {
    const replay = parseGameReplay({
      gameId: 'g1',
      moves: [
        {
          moveIndex: 1,
          playerId: 'p0',
          action: { type: 'initialAttack', cards: [six] },
          elapsedMs: 1200,
        },
      ],
      frames: [
        { moveIndex: 0, playerId: null, action: null, elapsedMs: 0, views: { p0: sampleView, p1: sampleView } },
        {
          moveIndex: 1,
          playerId: 'p0',
          action: { type: 'initialAttack', cards: [six] },
          elapsedMs: 1200,
          views: { p0: sampleView },
        },
      ],
    });

    expect(replay.gameId).toBe('g1');
    expect(replay.moves).toHaveLength(1);
    expect(replay.moves[0].action.type).toBe('initialAttack');
    expect(replay.moves[0].elapsedMs).toBe(1200);
    expect(replay.frames).toHaveLength(2);
    expect(Object.keys(replay.frames[0].views).sort()).toEqual(['p0', 'p1']);
    expect(replay.frames[0].views.p0.myHand).toEqual([six]);
    expect(replay.frames[0].action).toBeNull();
    expect(replay.frames[0].playerId).toBeNull();
  });

  it('rejects a replay without frames', () => {
    expect(() => parseGameReplay({ gameId: 'g1', moves: [] })).toThrow(/frames/);
  });
});

describe('finished games and replay payloads', () => {
  const finishedView = {
    ...sampleView,
    myHand: [],
    tablePairs: [],
    boutPhase: 'GameOver',
    legalActions: [],
    finishOrder: ['p1', 'p0'],
    winners: ['p1'],
    durak: 'p0',
    promptedPlayerIds: ['p0'],
    bottomTrumpCard: null,
    // The backend encodes these as JSON null once the match is over.
    turnPlayerId: null,
    turnDeadlineMs: null,
    gameStartedAtMs: 0,
    gameEndedAtMs: 5000,
  };

  it('parses a finished view whose idle clock fields arrive as null', () => {
    const view = parsePlayerGameView(finishedView);

    expect(view.boutPhase).toBe('GameOver');
    expect(isGameOverPhase(view.boutPhase)).toBe(true);
    expect(view.myHand).toEqual([]);
    expect(view.legalActions).toEqual([]);
    expect(view.bottomTrumpCard).toBeNull();
    expect(view.turnPlayerId).toBeUndefined();
    expect(view.turnDeadlineMs).toBe(0);
    expect(view.gameEndedAtMs).toBe(5000);
    expect(view.winners).toEqual(['p1']);
    expect(view.durak).toBe('p0');
    expect(view.promptedPlayerIds).toEqual(['p0']);
  });

  it('treats snake and camel phase spellings as game over', () => {
    expect(isGameOverPhase('game_over')).toBe(true);
    expect(isGameOverPhase('gameOver')).toBe(true);
    expect(isGameOverPhase('GAME_OVER')).toBe(true);
  });

  it('rejects malformed optional result fields instead of trusting them', () => {
    expect(() => parsePlayerGameView({ ...finishedView, durak: 7 })).toThrow(/durak/);
    expect(() => parsePlayerGameView({ ...finishedView, winners: [1] })).toThrow(/winners/);
    expect(() =>
      parsePlayerGameView({ ...finishedView, promptedPlayerIds: 'p0' }),
    ).toThrow(/promptedPlayerIds/);
    expect(() =>
      parsePlayerGameView({ ...finishedView, turnDeadlineMs: 'soon' }),
    ).toThrow(/turnDeadlineMs/);
    expect(() =>
      parsePlayerGameView({ ...finishedView, turnPlayerId: 4 }),
    ).toThrow(/turnPlayerId/);
  });

  it('accepts the backend replay payload with its extra state fields', () => {
    const replay = parseGameReplay({
      gameId: 'g1',
      config: { playerCount: 2 },
      initialState: { boutPhase: 'InitialAttack' },
      moves: [
        {
          moveIndex: 1,
          playerId: 'p0',
          action: { type: 'initialAttack', playerId: 'p0', cards: [six] },
          elapsedMs: 0,
          stateAfter: { boutPhase: 'Defense' },
        },
      ],
      frames: [
        {
          moveIndex: 0,
          playerId: null,
          action: null,
          elapsedMs: 0,
          state: {},
          views: { p0: sampleView, p1: { ...sampleView, myId: 'p1' } },
        },
        {
          moveIndex: 1,
          playerId: 'p0',
          action: { type: 'initialAttack', playerId: 'p0' },
          elapsedMs: 0,
          state: {},
          views: {
            p0: finishedView,
            p1: { ...finishedView, myId: 'p1', myName: 'Bob' },
          },
        },
      ],
    });

    const finalFrame = replay.frames[replay.frames.length - 1];
    expect(replay.frames).toHaveLength(2);
    expect(replay.frames[0].playerId).toBeNull();
    expect(replay.moves[0].elapsedMs).toBe(0);
    expect(isGameOverPhase(finalFrame.views.p0.boutPhase)).toBe(true);
    expect(finalFrame.views.p1.myName).toBe('Bob');
    expect(finalFrame.views.p0.durak).toBe('p0');
  });
});

describe('PlayerGameView', () => {
  it('parses a sample view payload from the backend', () => {
    const view = parsePlayerGameView(JSON.parse(JSON.stringify(sampleView)));

    expect(view.myId).toBe('p0');
    expect(view.myHand).toEqual([six]);
    expect(view.opponents).toHaveLength(1);
    expect(view.opponents[0].cardCount).toBe(3);
    expect(view.tablePairs[0].attack).toEqual(six);
    expect(view.tablePairs[0].defense).toBeNull();
    expect(view.talonCount).toBe(20);
    expect(view.bottomTrumpCard).toBeNull();
    expect(view.trumpSuit).toBe('spades');
    expect(view.boutPhase).toBe('defense');
    expect(view.legalActions).toContain('cover');
    expect(view.isDraw).toBe(false);
    expect(view.maxBoutAttacks).toBe(6);
  });

  it('keeps a covered pair and bottom trump card intact', () => {
    const view = parsePlayerGameView({
      ...sampleView,
      tablePairs: [{ attack: six, defense: seven }],
      bottomTrumpCard: { suit: 'hearts', rank: 'ace' },
    });

    expect(view.tablePairs[0].defense).toEqual(seven);
    expect(view.bottomTrumpCard).toEqual({ suit: 'hearts', rank: 'ace' });
  });

  it('rejects payloads that do not match the interface', () => {
    expect(() => parsePlayerGameView(null)).toThrow();
    expect(() => parsePlayerGameView({ ...sampleView, myId: 7 })).toThrow();
    expect(() => parsePlayerGameView({ ...sampleView, myHand: 'six' })).toThrow();
    expect(() => parsePlayerGameView({ ...sampleView, tablePairs: [{ attack: null }] })).toThrow();
    expect(() => parsePlayerGameView({ ...sampleView, legalActions: [1] })).toThrow();
    expect(() => parsePlayerGameView({ ...sampleView, isDraw: 'no' })).toThrow();
  });

  it('parses optional player presence fields', () => {
    const view = parsePlayerGameView({
      ...sampleView,
      opponents: [{ ...sampleView.opponents[0], isPresent: false }],
      presentPlayers: ['p0'],
    });

    expect(view.opponents[0].isPresent).toBe(false);
    expect(view.presentPlayers).toEqual(['p0']);

    const withoutPresence = parsePlayerGameView(sampleView);
    expect(withoutPresence.opponents[0].isPresent).toBeUndefined();
    expect(withoutPresence.presentPlayers).toBeUndefined();
  });

  it('rejects malformed presence fields', () => {
    expect(() =>
      parsePlayerGameView({
        ...sampleView,
        opponents: [{ ...sampleView.opponents[0], isPresent: 'yes' }],
      }),
    ).toThrow(/isPresent/);
    expect(() => parsePlayerGameView({ ...sampleView, presentPlayers: [1] })).toThrow(
      /presentPlayers/,
    );
  });

  it('rejects payloads missing a required numeric field', () => {
    const withoutAttacker = { ...sampleView } as Record<string, unknown>;
    delete withoutAttacker.attackerIdx;
    expect(() => parsePlayerGameView(withoutAttacker)).toThrow(/attackerIdx/);

    const withoutDefender = { ...sampleView } as Record<string, unknown>;
    delete withoutDefender.defenderIdx;
    expect(() => parsePlayerGameView(withoutDefender)).toThrow(/defenderIdx/);

    const withoutMaxAttacks = { ...sampleView } as Record<string, unknown>;
    delete withoutMaxAttacks.maxBoutAttacks;
    expect(() => parsePlayerGameView(withoutMaxAttacks)).toThrow(/maxBoutAttacks/);
  });
});

describe('backend token normalization', () => {
  it('accepts both attack and initialAttack legal-action spellings', () => {
    expect(hasLegalAction(['attack'], 'attack')).toBe(true);
    expect(hasLegalAction(['initialAttack'], 'attack')).toBe(true);
    expect(hasLegalAction(['throwInCards'], 'throwIn')).toBe(true);
    expect(hasLegalAction(['cover'], 'attack')).toBe(false);
  });

  it('matches bout phases regardless of casing', () => {
    expect(isGameOverPhase('GameOver')).toBe(true);
    expect(isGameOverPhase('gameOver')).toBe(true);
    expect(isGameOverPhase('defense')).toBe(false);
    expect(isInitialAttackPhase('InitialAttack')).toBe(true);
    expect(isInitialAttackPhase('initialAttack')).toBe(true);
    expect(isInitialAttackPhase('defense')).toBe(false);
  });
});

describe('PlayerType', () => {
  it('accepts basicBot alongside human and randomBot', () => {
    const seats: PlayerType[] = ['human', 'randomBot', 'basicBot'];

    expect(seats).toHaveLength(3);
    expect(seats).toContain('basicBot');
    expect(seats.indexOf('basicBot')).toBe(seats.indexOf('randomBot') + 1);
  });
});

describe('GameAction builders', () => {
  it('builds an initial attack', () => {
    expect(buildInitialAttack('p0', [six])).toEqual({
      type: 'initialAttack',
      playerId: 'p0',
      cards: [six],
    });
  });

  it('names a Chaos-mode target with targetPlayerId', () => {
    expect(buildInitialAttack('p0', [six], 'p2')).toEqual({
      type: 'initialAttack',
      playerId: 'p0',
      cards: [six],
      targetPlayerId: 'p2',
    });
    // A standard attack sends no target field at all.
    expect(buildInitialAttack('p0', [six])).not.toHaveProperty('targetPlayerId');
  });

  it('builds a cover', () => {
    expect(buildCoverCard('p1', 0, seven)).toEqual({
      type: 'coverCard',
      playerId: 'p1',
      attackIndex: 0,
      defenseCard: seven,
    });
  });

  it('builds a redirect', () => {
    expect(buildRedirectAttack('p1', [six])).toEqual({
      type: 'redirectAttack',
      playerId: 'p1',
      cards: [six],
    });
  });

  it('builds a throw-in', () => {
    expect(buildThrowInCards('p2', [six])).toEqual({
      type: 'throwInCards',
      playerId: 'p2',
      cards: [six],
    });
  });

  it('builds surrender and pass actions', () => {
    expect(buildDeclareSurrender('p1')).toEqual({
      type: 'declareSurrender',
      playerId: 'p1',
    });
    expect(buildPassTurn('p0')).toEqual({ type: 'passTurn', playerId: 'p0' });
  });

  it('produces JSON-safe payloads for every action type', () => {
    const actions = [
      buildInitialAttack('p0', [six]),
      buildCoverCard('p1', 0, seven),
      buildRedirectAttack('p1', [six]),
      buildThrowInCards('p2', [six]),
      buildDeclareSurrender('p1'),
      buildPassTurn('p0'),
    ];

    actions.forEach((action) => {
      const json = JSON.parse(JSON.stringify(action));
      expect(json).toEqual(action);
      expect(typeof action.type).toBe('string');
      expect(typeof action.playerId).toBe('string');
    });
  });
});

describe('chaos mode and bot projections', () => {
  it('parses the chaos, bot and redirect fields the table needs', () => {
    const view = parsePlayerGameView({
      ...sampleView,
      isBot: true,
      playerTypes: ['randomBot', 'human'],
      allowRedirect: false,
      chaosMode: true,
      eligibleTargetIds: ['p1', 'p2'],
      redirectTargetId: 'p2',
    });

    expect(view.isBot).toBe(true);
    expect(view.playerTypes).toEqual(['randomBot', 'human']);
    expect(view.allowRedirect).toBe(false);
    expect(view.chaosMode).toBe(true);
    expect(view.eligibleTargetIds).toEqual(['p1', 'p2']);
    expect(view.redirectTargetId).toBe('p2');
  });

  it('defaults every new optional field for older payloads', () => {
    const view = parsePlayerGameView({ ...sampleView });

    expect(view.isBot).toBe(false);
    expect(view.playerTypes).toEqual([]);
    expect(view.allowRedirect).toBe(true);
    expect(view.chaosMode).toBe(false);
    expect(view.eligibleTargetIds).toEqual([]);
    expect(view.redirectTargetId).toBeNull();
  });

  it('rejects malformed chaos and bot fields', () => {
    expect(() => parsePlayerGameView({ ...sampleView, isBot: 'yes' })).toThrow(/isBot/);
    expect(() =>
      parsePlayerGameView({ ...sampleView, allowRedirect: 'no' }),
    ).toThrow(/allowRedirect/);
    expect(() => parsePlayerGameView({ ...sampleView, playerTypes: [1] })).toThrow(
      /playerTypes/,
    );
    expect(() =>
      parsePlayerGameView({ ...sampleView, eligibleTargetIds: 'p1' }),
    ).toThrow(/eligibleTargetIds/);
    expect(() =>
      parsePlayerGameView({ ...sampleView, redirectTargetId: 3 }),
    ).toThrow(/redirectTargetId/);
  });
});

describe('QA scenario presets', () => {
  it('starts a scripted position through POST /api/games/preset', async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({
        gameId: 'g1',
        players: [
          { id: 'p0', name: 'Alice' },
          { id: 'p1', name: 'Bob' },
        ],
        playerTypes: ['human', 'human'],
        defaultPlayerId: 'p1',
      }),
    });
    vi.stubGlobal('fetch', fetchMock);

    const created = await createPresetGame('3p-redirect-bob');

    expect(fetchMock).toHaveBeenCalledWith('/api/games/preset', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ preset: '3p-redirect-bob' }),
    });
    expect(created).toEqual({
      gameId: 'g1',
      players: ['p0', 'p1'],
      playerTypes: ['human', 'human'],
      defaultPlayerId: 'p1',
    });
    vi.unstubAllGlobals();
  });

  it('surfaces the server error for an unknown preset', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({
        ok: false,
        status: 400,
        json: async () => ({ error: 'Unknown preset: nope' }),
      }),
    );

    await expect(createPresetGame('nope')).rejects.toThrow(/Unknown preset/);
    vi.unstubAllGlobals();
  });
});

describe('viewer name parsing', () => {
  it('keeps a non-empty myName', () => {
    expect(parsePlayerGameView({ ...sampleView, myName: 'Alice' }).myName).toBe('Alice');
  });

  it('omits missing and empty names so older payloads stay clean', () => {
    expect(parsePlayerGameView({ ...sampleView }).myName).toBeUndefined();
    expect(parsePlayerGameView({ ...sampleView, myName: '' }).myName).toBeUndefined();
  });

  it('rejects a non-string myName', () => {
    expect(() => parsePlayerGameView({ ...sampleView, myName: 7 })).toThrow(/myName/);
  });
});
