import { describe, expect, it } from 'vitest';
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
