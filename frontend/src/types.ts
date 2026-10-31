export interface Card {
  suit: string;
  rank: string;
}

export interface TablePair {
  attack: Card;
  defense?: Card | null;
}

export interface PublicPlayerSummary {
  id: string;
  name: string;
  cardCount: number;
  hasPassed: boolean;
  finishRank?: number | null;
}

export interface PlayerGameView {
  myId: string;
  myHand: Card[];
  opponents: PublicPlayerSummary[];
  tablePairs: TablePair[];
  talonCount: number;
  bottomTrumpCard?: Card | null;
  trumpSuit: string;
  attackerIdx: number;
  defenderIdx: number;
  boutPhase: string;
  legalActions: string[];
  finishOrder: string[];
  isDraw: boolean;
  maxBoutAttacks: number;
  /** Chaos Mode variant: the attacker may choose any active defender. */
  chaosMode?: boolean;
  /** Absolute epoch-ms deadline of the 15-second turn clock (0 = idle). */
  turnDeadlineMs?: number;
  turnSecondsRemaining?: number;
}

export interface GameAction {
  type: string;
  playerId: string;
  [key: string]: unknown;
}

function fail(message: string): never {
  throw new Error(`Invalid game view: ${message}`);
}

export function isCard(value: unknown): value is Card {
  if (typeof value !== 'object' || value === null) return false;
  const candidate = value as Record<string, unknown>;
  return typeof candidate.suit === 'string' && typeof candidate.rank === 'string';
}

function parseCard(value: unknown): Card {
  if (!isCard(value)) fail('expected a card with a string suit and rank');
  return value;
}

function parseStringArray(value: unknown, name: string): string[] {
  if (!Array.isArray(value) || value.some((item) => typeof item !== 'string')) {
    fail(`${name} must be an array of strings`);
  }
  return value as string[];
}

function parsePublicPlayerSummary(value: unknown): PublicPlayerSummary {
  if (typeof value !== 'object' || value === null) fail('opponent must be an object');
  const raw = value as Record<string, unknown>;
  const { id, name, cardCount, hasPassed } = raw;
  if (typeof id !== 'string') fail('opponent id must be a string');
  if (typeof name !== 'string') fail('opponent name must be a string');
  if (typeof cardCount !== 'number') fail('opponent cardCount must be a number');
  if (typeof hasPassed !== 'boolean') fail('opponent hasPassed must be a boolean');
  const finishRank = raw.finishRank;
  if (finishRank !== undefined && finishRank !== null && typeof finishRank !== 'number') {
    fail('opponent finishRank must be a number or null');
  }
  return {
    id,
    name,
    cardCount,
    hasPassed,
    finishRank: (finishRank as number | null | undefined) ?? null,
  };
}

function parseTablePair(value: unknown): TablePair {
  if (typeof value !== 'object' || value === null) fail('table pair must be an object');
  const raw = value as Record<string, unknown>;
  const attack = parseCard(raw.attack);
  const defense = raw.defense;
  if (defense !== undefined && defense !== null && !isCard(defense)) {
    fail('table pair defense must be a card or null');
  }
  return { attack, defense: (defense as Card | null | undefined) ?? null };
}

/**
 * Validates an incoming `PlayerGameView` JSON payload and normalizes the
 * optional fields, so callers can trust the shape of the projection.
 */
export function parsePlayerGameView(value: unknown): PlayerGameView {
  if (typeof value !== 'object' || value === null) fail('expected an object');
  const raw = value as Record<string, unknown>;

  const { myId, talonCount, trumpSuit, attackerIdx, defenderIdx, boutPhase, isDraw, maxBoutAttacks } =
    raw;
  const chaosMode = raw.chaosMode;
  if (chaosMode !== undefined && typeof chaosMode !== 'boolean') {
    fail('chaosMode must be a boolean');
  }
  const turnDeadlineMs = raw.turnDeadlineMs;
  if (turnDeadlineMs !== undefined && typeof turnDeadlineMs !== 'number') {
    fail('turnDeadlineMs must be a number');
  }
  const turnSecondsRemaining = raw.turnSecondsRemaining;
  if (turnSecondsRemaining !== undefined && typeof turnSecondsRemaining !== 'number') {
    fail('turnSecondsRemaining must be a number');
  }
  if (typeof myId !== 'string') fail('myId must be a string');
  if (!Array.isArray(raw.myHand)) fail('myHand must be an array of cards');
  if (!Array.isArray(raw.opponents)) fail('opponents must be an array');
  if (!Array.isArray(raw.tablePairs)) fail('tablePairs must be an array');
  if (typeof talonCount !== 'number') fail('talonCount must be a number');
  if (typeof trumpSuit !== 'string') fail('trumpSuit must be a string');
  if (typeof attackerIdx !== 'number') fail('attackerIdx must be a number');
  if (typeof defenderIdx !== 'number') fail('defenderIdx must be a number');
  if (typeof boutPhase !== 'string') fail('boutPhase must be a string');
  if (typeof isDraw !== 'boolean') fail('isDraw must be a boolean');
  if (typeof maxBoutAttacks !== 'number') fail('maxBoutAttacks must be a number');

  const bottomTrumpCard = raw.bottomTrumpCard;
  if (bottomTrumpCard !== undefined && bottomTrumpCard !== null && !isCard(bottomTrumpCard)) {
    fail('bottomTrumpCard must be a card or null');
  }

  return {
    myId,
    myHand: (raw.myHand as unknown[]).map(parseCard),
    opponents: (raw.opponents as unknown[]).map(parsePublicPlayerSummary),
    tablePairs: (raw.tablePairs as unknown[]).map(parseTablePair),
    talonCount,
    bottomTrumpCard: (bottomTrumpCard as Card | null | undefined) ?? null,
    trumpSuit,
    attackerIdx,
    defenderIdx,
    boutPhase,
    legalActions: parseStringArray(raw.legalActions, 'legalActions'),
    finishOrder: parseStringArray(raw.finishOrder, 'finishOrder'),
    isDraw,
    maxBoutAttacks,
    chaosMode: (chaosMode as boolean | undefined) ?? false,
    turnDeadlineMs: (turnDeadlineMs as number | undefined) ?? 0,
    turnSecondsRemaining: (turnSecondsRemaining as number | undefined) ?? 15,
  };
}

// --- Backend string normalization ---

/** Normalizes a phase or action name so casing and separators do not matter. */
export function normalizeToken(value: string): string {
  return value.replace(/[^a-z]/gi, '').toLowerCase();
}

export function isInitialAttackPhase(phase: string): boolean {
  return normalizeToken(phase) === 'initialattack';
}

export function isGameOverPhase(phase: string): boolean {
  return normalizeToken(phase) === 'gameover';
}

const LEGAL_ACTION_ALIASES: Record<string, string[]> = {
  attack: ['attack', 'initialattack'],
  cover: ['cover', 'covercard'],
  pass: ['pass', 'passturn'],
  surrender: ['surrender', 'declaresurrender'],
  redirect: ['redirect', 'redirectattack'],
  throwin: ['throwin', 'throwincards'],
};

/** True when the backend view lists any spelling of `action` as legal. */
export function hasLegalAction(legalActions: string[], action: string): boolean {
  const key = normalizeToken(action);
  const aliases = LEGAL_ACTION_ALIASES[key] ?? [key];
  return legalActions.some((candidate) => aliases.includes(normalizeToken(candidate)));
}

// --- GameAction builders: one per backend action variant ---

export function buildInitialAttack(
  playerId: string,
  cards: Card[],
  targetDefender?: string,
): GameAction {
  return {
    type: 'initialAttack',
    playerId,
    cards,
    ...(targetDefender ? { targetDefender } : {}),
  };
}

export function buildCoverCard(playerId: string, attackIndex: number, defenseCard: Card): GameAction {
  return { type: 'coverCard', playerId, attackIndex, defenseCard };
}

export function buildRedirectAttack(playerId: string, cards: Card[]): GameAction {
  return { type: 'redirectAttack', playerId, cards };
}

export function buildThrowInCards(playerId: string, cards: Card[]): GameAction {
  return { type: 'throwInCards', playerId, cards };
}

export function buildDeclareSurrender(playerId: string): GameAction {
  return { type: 'declareSurrender', playerId };
}

export function buildPassTurn(playerId: string): GameAction {
  return { type: 'passTurn', playerId };
}
