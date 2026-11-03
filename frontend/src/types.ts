export interface Card {
  suit: string;
  rank: string;
}

export interface TablePair {
  attack: Card;
  defense?: Card | null;
}

/** Seat kind: a human client or a server-driven bot. */
export type PlayerType = 'human' | 'randomBot' | 'basicBot';

export interface PublicPlayerSummary {
  id: string;
  name: string;
  cardCount: number;
  hasPassed: boolean;
  finishRank?: number | null;
  /** False while the opponent's socket is disconnected. */
  isPresent?: boolean;
}

export interface PlayerGameView {
  myId: string;
  /** The viewed player's display name (empty for older backend payloads). */
  myName?: string;
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
  /** True when the viewed defender has no legal cover and no legal redirect. */
  defenderDefenseless?: boolean;
  /** Chaos Mode variant: the attacker may choose any active defender. */
  chaosMode?: boolean;
  /** True when the viewed seat is computer-controlled, so it accepts no input. */
  isBot?: boolean;
  /** Canonical seat types in seat order (`human`, `randomBot`, `basicBot`). */
  playerTypes?: string[];
  /** Perevod switch: reflections are legal while true. */
  allowRedirect?: boolean;
  /** Seats the current attacker may aim at during the opening attack. */
  eligibleTargetIds?: string[];
  /** The seat a reflection would reach, so the arrow can point the right way. */
  redirectTargetId?: string | null;
  /** Absolute epoch-ms deadline of the 15-second turn clock (0 = idle). */
  turnDeadlineMs?: number;
  turnSecondsRemaining?: number;
  /** Id of the player the clock is waiting on, for per-seat clocks. */
  turnPlayerId?: string;
  /** Ids of players whose sockets are currently connected. */
  presentPlayers?: string[];
  /** Face-down cards already in the discard pile. */
  discardCount?: number;
  /** Most recent discard, revealed face-up in the deck box. */
  lastDiscardCards?: Card[];
  /** Epoch-ms timestamps behind the split game/turn clocks. */
  gameStartedAtMs?: number | null;
  gameEndedAtMs?: number | null;
  /** The viewed player's own pass flag, so their row can show `PASSED` too. */
  myHasPassed?: boolean;
  /**
   * The viewed player's own finishing rank (1 = first out). Only populated once
   * their hand is empty, so their row shows `WINNER` / `OUT` like the opponents.
   */
  myFinishRank?: number | null;
  /** Every winner, in finishing order (the backend's `winners` list). */
  winners?: string[];
  /** The Durak (last place) named by the backend, when there is one. */
  durak?: string | null;
  /** Seats the game is currently waiting on (several during a throw-in). */
  promptedPlayerIds?: string[];
}

export interface GameAction {
  type: string;
  playerId: string;
  [key: string]: unknown;
}

/**
 * Opening attack. `targetPlayerId` names the seat being attacked; it is only
 * meaningful in Chaos mode, where any other active seat holding cards may be
 * chosen. A standard game ignores the field and attacks the clockwise defender.
 */
export interface InitialAttackAction extends GameAction {
  type: 'initialAttack';
  cards: Card[];
  targetPlayerId?: string;
}

/** One replayable step: its index, actor, action and every POV at that moment. */
export interface ReplayFrame {
  moveIndex: number;
  playerId?: string | null;
  action?: GameAction | null;
  elapsedMs: number;
  views: Record<string, PlayerGameView>;
}

/** A move recorded against the game clock, in milliseconds. */
export interface RecordedMove {
  moveIndex: number;
  playerId: string;
  action: GameAction;
  elapsedMs: number;
}

/** Serialized match served by `GET /api/games/:gameId/replay`. */
export interface GameReplay {
  gameId: string;
  moves: RecordedMove[];
  frames: ReplayFrame[];
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
  const isPresent = raw.isPresent;
  if (isPresent !== undefined && typeof isPresent !== 'boolean') {
    fail('opponent isPresent must be a boolean');
  }
  return {
    id,
    name,
    cardCount,
    hasPassed,
    finishRank: (finishRank as number | null | undefined) ?? null,
    ...(isPresent === undefined ? {} : { isPresent }),
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
  const isBot = raw.isBot;
  if (isBot !== undefined && typeof isBot !== 'boolean') {
    fail('isBot must be a boolean');
  }
  const allowRedirect = raw.allowRedirect;
  if (allowRedirect !== undefined && typeof allowRedirect !== 'boolean') {
    fail('allowRedirect must be a boolean');
  }
  const playerTypes = raw.playerTypes;
  if (playerTypes !== undefined) parseStringArray(playerTypes, 'playerTypes');
  const eligibleTargetIds = raw.eligibleTargetIds;
  if (eligibleTargetIds !== undefined) {
    parseStringArray(eligibleTargetIds, 'eligibleTargetIds');
  }
  const redirectTargetId = raw.redirectTargetId;
  if (
    redirectTargetId !== undefined &&
    redirectTargetId !== null &&
    typeof redirectTargetId !== 'string'
  ) {
    fail('redirectTargetId must be a string or null');
  }
  const turnDeadlineMs = raw.turnDeadlineMs;
  if (
    turnDeadlineMs !== undefined &&
    turnDeadlineMs !== null &&
    typeof turnDeadlineMs !== 'number'
  ) {
    fail('turnDeadlineMs must be a number or null');
  }
  const turnSecondsRemaining = raw.turnSecondsRemaining;
  if (turnSecondsRemaining !== undefined && typeof turnSecondsRemaining !== 'number') {
    fail('turnSecondsRemaining must be a number');
  }
  // A finished (or otherwise idle) game encodes the prompted seat as JSON
  // `null`; treating that as "no clock" keeps finished payloads parseable.
  const turnPlayerId = raw.turnPlayerId;
  if (
    turnPlayerId !== undefined &&
    turnPlayerId !== null &&
    typeof turnPlayerId !== 'string'
  ) {
    fail('turnPlayerId must be a string or null');
  }
  const durak = raw.durak;
  if (durak !== undefined && durak !== null && typeof durak !== 'string') {
    fail('durak must be a string or null');
  }
  const winners = raw.winners;
  if (winners !== undefined) parseStringArray(winners, 'winners');
  const myHasPassed = raw.myHasPassed;
  if (myHasPassed !== undefined && typeof myHasPassed !== 'boolean') {
    fail('myHasPassed must be a boolean');
  }
  const defenderDefenseless = raw.defenderDefenseless;
  if (defenderDefenseless !== undefined && typeof defenderDefenseless !== 'boolean') {
    fail('defenderDefenseless must be a boolean');
  }
  const myFinishRank = raw.myFinishRank;
  if (myFinishRank !== undefined && myFinishRank !== null && typeof myFinishRank !== 'number') {
    fail('myFinishRank must be a number or null');
  }
  const promptedPlayerIds = raw.promptedPlayerIds;
  if (promptedPlayerIds !== undefined) {
    parseStringArray(promptedPlayerIds, 'promptedPlayerIds');
  }
  const myName = raw.myName;
  if (myName !== undefined && typeof myName !== 'string') {
    fail('myName must be a string');
  }
  const presentPlayers = raw.presentPlayers;
  if (presentPlayers !== undefined) parseStringArray(presentPlayers, 'presentPlayers');
  const discardCount = raw.discardCount;
  if (discardCount !== undefined && typeof discardCount !== 'number') {
    fail('discardCount must be a number');
  }
  const lastDiscardCards = raw.lastDiscardCards;
  if (lastDiscardCards !== undefined && !Array.isArray(lastDiscardCards)) {
    fail('lastDiscardCards must be an array of cards');
  }
  const parsedLastDiscard = ((lastDiscardCards as unknown[] | undefined) ?? []).map(parseCard);
  const gameStartedAtMs = raw.gameStartedAtMs;
  if (
    gameStartedAtMs !== undefined &&
    gameStartedAtMs !== null &&
    typeof gameStartedAtMs !== 'number'
  ) {
    fail('gameStartedAtMs must be a number or null');
  }
  const gameEndedAtMs = raw.gameEndedAtMs;
  if (gameEndedAtMs !== undefined && gameEndedAtMs !== null && typeof gameEndedAtMs !== 'number') {
    fail('gameEndedAtMs must be a number or null');
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
    ...(typeof myName === 'string' && myName.length > 0 ? { myName } : {}),
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
    isBot: (isBot as boolean | undefined) ?? false,
    playerTypes: (playerTypes as string[] | undefined) ?? [],
    allowRedirect: (allowRedirect as boolean | undefined) ?? true,
    eligibleTargetIds: (eligibleTargetIds as string[] | undefined) ?? [],
    redirectTargetId: (redirectTargetId as string | null | undefined) ?? null,
    turnDeadlineMs: (turnDeadlineMs as number | null | undefined) ?? 0,
    turnSecondsRemaining: (turnSecondsRemaining as number | undefined) ?? 15,
    turnPlayerId: (turnPlayerId as string | null | undefined) ?? undefined,
    ...(presentPlayers === undefined ? {} : { presentPlayers: presentPlayers as string[] }),
    discardCount: (discardCount as number | undefined) ?? 0,
    lastDiscardCards: parsedLastDiscard,
    gameStartedAtMs: (gameStartedAtMs as number | null | undefined) ?? null,
    gameEndedAtMs: (gameEndedAtMs as number | null | undefined) ?? null,
    winners: (winners as string[] | undefined) ?? [],
    defenderDefenseless: (defenderDefenseless as boolean | undefined) ?? false,
    ...(myHasPassed === undefined ? {} : { myHasPassed: myHasPassed as boolean }),
    ...(myFinishRank === undefined
      ? {}
      : { myFinishRank: myFinishRank as number | null }),
    durak: (durak as string | null | undefined) ?? null,
    promptedPlayerIds: (promptedPlayerIds as string[] | undefined) ?? [],
  };
}

function parseReplayAction(value: unknown): GameAction {
  if (typeof value !== 'object' || value === null) fail('replay action must be an object');
  const raw = value as Record<string, unknown>;
  if (typeof raw.type !== 'string') fail('replay action type must be a string');
  return {
    ...raw,
    type: raw.type,
    playerId: typeof raw.playerId === 'string' ? raw.playerId : '',
  } as GameAction;
}

function parseRecordedMove(value: unknown, index: number): RecordedMove {
  if (typeof value !== 'object' || value === null) fail(`replay move ${index} must be an object`);
  const raw = value as Record<string, unknown>;
  if (typeof raw.playerId !== 'string') fail(`replay move ${index} playerId must be a string`);
  return {
    moveIndex: typeof raw.moveIndex === 'number' ? raw.moveIndex : index,
    playerId: raw.playerId,
    action: parseReplayAction(raw.action),
    elapsedMs: typeof raw.elapsedMs === 'number' ? raw.elapsedMs : 0,
  };
}

function parseReplayFrame(value: unknown, index: number): ReplayFrame {
  if (typeof value !== 'object' || value === null) fail(`replay frame ${index} must be an object`);
  const raw = value as Record<string, unknown>;
  if (typeof raw.views !== 'object' || raw.views === null) {
    fail(`replay frame ${index} views must be an object`);
  }
  const views: Record<string, PlayerGameView> = {};
  for (const [playerId, frameView] of Object.entries(raw.views as Record<string, unknown>)) {
    views[playerId] = parsePlayerGameView(frameView);
  }
  const playerId = raw.playerId;
  if (playerId !== undefined && playerId !== null && typeof playerId !== 'string') {
    fail(`replay frame ${index} playerId must be a string or null`);
  }
  const action = raw.action;
  return {
    moveIndex: typeof raw.moveIndex === 'number' ? raw.moveIndex : index,
    playerId: (playerId as string | null | undefined) ?? null,
    action: action === undefined || action === null ? null : parseReplayAction(action),
    elapsedMs: typeof raw.elapsedMs === 'number' ? raw.elapsedMs : 0,
    views,
  };
}

/** Validates a serialized match before the review mode consumes it. */
export function parseGameReplay(value: unknown): GameReplay {
  if (typeof value !== 'object' || value === null) fail('expected a replay object');
  const raw = value as Record<string, unknown>;
  if (typeof raw.gameId !== 'string') fail('replay gameId must be a string');
  if (!Array.isArray(raw.moves)) fail('replay moves must be an array');
  if (!Array.isArray(raw.frames)) fail('replay frames must be an array');
  return {
    gameId: raw.gameId,
    moves: raw.moves.map(parseRecordedMove),
    frames: raw.frames.map(parseReplayFrame),
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

/**
 * Opens a bout. `targetPlayerId` is the Chaos-mode seat being aimed at; in a
 * standard game the clock-wise defender receives the attack and the field is
 * omitted, which is exactly what the backend decoder expects.
 */
export function buildInitialAttack(
  playerId: string,
  cards: Card[],
  targetPlayerId?: string,
): InitialAttackAction {
  return {
    type: 'initialAttack',
    playerId,
    cards,
    ...(targetPlayerId ? { targetPlayerId } : {}),
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
