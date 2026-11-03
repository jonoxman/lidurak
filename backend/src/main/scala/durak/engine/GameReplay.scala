package durak.engine

/**
 * One atomic move of a game, together with the full state it produced.
 *
 * `elapsedMs` is the reading of the overall game clock when the move was made:
 * always `0` for the first move, and `now - gameStartedAtMs` afterwards.
 */
case class RecordedMove(
    moveIndex: Int,
    playerId: String,
    action: GameAction,
    elapsedMs: Long,
    stateAfter: GameState
)

/**
 * A single step of the replay: frame `0` is the deal before any move, frames
 * `1..N` follow the recorded moves. `views` carries a frozen
 * [[PlayerGameView]] per seat, so the frontend can show any player's point of
 * view at that exact timestamp.
 */
case class ReplayFrame(
    moveIndex: Int,
    playerId: Option[String],
    action: Option[GameAction],
    elapsedMs: Long,
    state: GameState,
    views: Map[String, PlayerGameView]
)

/** A complete, move-by-move serialization of a game, served by the replay API. */
case class SerializedGame(
    gameId: String,
    config: GameConfig,
    initialState: GameState,
    // Every visible action on the table, in order. Each one is a replay step.
    moves: Vector[RecordedMove],
    frames: Vector[ReplayFrame],
    // Actions that only moved bookkeeping (a pass that left the table and the
    // phase untouched). They are never replay steps, but keeping them preserves
    // the exact transition order, so `verifyReplay` can still re-derive the game.
    skippedMoves: Vector[RecordedMove] = Vector.empty
)

object GameReplay:

  /** A replay holding only the deal frame of `initialState`. */
  def initial(gameId: String, initialState: GameState): SerializedGame =
    SerializedGame(
      gameId = gameId,
      config = initialState.config,
      initialState = initialState,
      moves = Vector.empty,
      frames = Vector(frame(0, None, None, 0L, initialState))
    )

  /**
   * True when `action` visibly changed the table and therefore belongs in the
   * replay steps.
   *
   * A `PassTurn` that leaves `tablePairs` and `boutPhase` untouched is a
   * "non-move": the state moves on (a thrower is marked as passed) but nothing
   * on the table changes, so the replay must not show a step for it. The pass
   * that actually settles a bout clears the table or picks the cards up and so
   * changes the phase — it always stays visible.
   */
  def isVisibleMove(previous: GameState, action: GameAction, next: GameState): Boolean =
    action match
      case _: GameAction.PassTurn =>
        next.tablePairs != previous.tablePairs || next.boutPhase != previous.boutPhase
      case _ => true

  /**
   * Appends one applied move, and — when it is a visible action on the table —
   * its replay frame. The elapsed time is measured from the state's own game
   * start, and the first move is always stamped `0`. Frames are numbered by
   * their own position, so a skipped non-move never leaves a gap in the replay
   * viewer's steps.
   */
  def appendMove(
      replay: SerializedGame,
      action: GameAction,
      stateAfter: GameState,
      nowMs: Long,
      visible: Boolean = true
  ): SerializedGame =
    val moveIndex = replay.moves.size + replay.skippedMoves.size + 1
    val startedAt = stateAfter.gameStartedAtMs
      .orElse(replay.initialState.gameStartedAtMs)
      .getOrElse(nowMs)
    val elapsedMs = if moveIndex <= 1 then 0L else Math.max(0L, nowMs - startedAt)
    val playerId = GameEngine.actorId(action)
    val move = RecordedMove(moveIndex, playerId, action, elapsedMs, stateAfter)
    if !visible then replay.copy(skippedMoves = replay.skippedMoves :+ move)
    else
      replay.copy(
        moves = replay.moves :+ move,
        frames = replay.frames :+ frame(
          replay.frames.size,
          Some(playerId),
          Some(action),
          elapsedMs,
          stateAfter
        )
      )

  /** A replay frame with the frozen per-seat projections at `elapsedMs`. */
  def frame(
      moveIndex: Int,
      playerId: Option[String],
      action: Option[GameAction],
      elapsedMs: Long,
      state: GameState
  ): ReplayFrame =
    ReplayFrame(moveIndex, playerId, action, elapsedMs, state, frozenViews(state, elapsedMs))

  /**
   * One projection per seat with the clock frozen at `elapsedMs`: the overall
   * timer appears to have started at `0` and ended at this move, and the turn
   * clock is idle, so a replay never shows a live countdown.
   */
  def frozenViews(state: GameState, elapsedMs: Long): Map[String, PlayerGameView] =
    state.players.map { player =>
      val view = PlayerGameView.forViewer(state, player.id, nowMs = 0L)
      player.id -> view.copy(
        turnDeadlineMs = 0L,
        turnSecondsRemaining = 0,
        gameStartedAtMs = Some(0L),
        gameEndedAtMs = Some(elapsedMs)
      )
    }.toMap

  /**
   * Replays every recorded transition — visible moves and the skipped
   * bookkeeping-only passes, in their original order — from `initialState`
   * through [[GameEngine.applyAction]] and checks that each recorded state is
   * exactly reproduced, proving the history is deterministic and complete.
   */
  def verifyReplay(serialized: SerializedGame): Either[String, Vector[GameState]] =
    val moves = (serialized.moves ++ serialized.skippedMoves).sortBy(_.moveIndex)
    val expectedIndices = (1 to moves.size).toVector
    if moves.map(_.moveIndex) != expectedIndices then
      Left(s"Move indices are not sequential: ${moves.map(_.moveIndex)}")
    else
      moves.foldLeft[Either[String, Vector[GameState]]](
        Right(Vector(serialized.initialState))
      ) { (acc, move) =>
        acc.flatMap { states =>
          GameEngine.applyAction(states.last, move.action) match
            case Left(error) =>
              Left(s"Move ${move.moveIndex} was rejected on replay: $error")
            case Right(next) =>
              if comparable(next) != comparable(move.stateAfter) then
                Left(s"Move ${move.moveIndex} did not reproduce the recorded state")
              else Right(states :+ next)
        }
      }

  /**
   * The fields the engine owns. Server-only bookkeeping (the turn clock,
   * presence and the overall timer stamped by the server) is ignored.
   */
  private def comparable(state: GameState): GameState =
    state.copy(
      turnDeadlineMs = 0L,
      presentPlayers = Set.empty,
      gameStartedAtMs = None,
      gameEndedAtMs = None
    )
