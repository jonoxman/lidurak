package durak.engine

import scala.util.Random

/**
 * The simplest computer opponent: it looks only at the public/own-seat
 * information in [[GameState]], enumerates every action the engine would
 * accept for its seat, and picks one uniformly at random.
 *
 * Every returned action is filtered through [[GameEngine.applyAction]], so a
 * caller can submit it without re-checking legality.
 */
object RandomBot:

  /**
   * Every action the engine accepts for `playerId` right now, in a stable
   * order. A finished seat, a seat that is not prompted this turn, and a
   * surrendering defender ([[BoutPhase.SurrenderThrowIn]]) get nothing.
   */
  def legalActionsFor(state: GameState, playerId: String): Vector[GameAction] =
    val playerIdx = state.players.indexWhere(_.id == playerId)
    val surrenderedDefender =
      state.boutPhase == BoutPhase.SurrenderThrowIn && playerIdx == state.defenderIdx

    if state.boutPhase == BoutPhase.GameOver || playerIdx == -1 || surrenderedDefender then
      Vector.empty
    else
      candidateActions(state, playerId)
        .filter(action => GameEngine.applyAction(state, playerId, action).isRight)
        .distinct

  /** One uniformly chosen legal action, or `None` when the seat has no move. */
  def chooseAction(
      state: GameState,
      playerId: String,
      rng: Random = new Random()
  ): Option[GameAction] =
    val actions = legalActionsFor(state, playerId)
    if actions.isEmpty then None else Some(actions(rng.nextInt(actions.size)))

  /**
   * Plausible moves for the seat's role and phase. Legality is checked by the
   * caller, so this may include throws that the engine rejects.
   *
   * Opening attacks carry no target: `GameAction.InitialAttack` has no target
   * field, so every opening attack aims at the seat's clockwise defender.
   */
  private def candidateActions(state: GameState, playerId: String): Vector[GameAction] =
    val playerIdx = state.players.indexWhere(_.id == playerId)
    if playerIdx == -1 then Vector.empty
    else
      val player = state.players(playerIdx)
      if !player.isActive then Vector.empty
      else
        val isAttacker = playerIdx == state.attackerIdx
        val isDefender = playerIdx == state.defenderIdx
        val isDefensePhase = state.boutPhase == BoutPhase.Defense
        val canThrowIn =
          isDefensePhase || state.boutPhase == BoutPhase.SurrenderThrowIn

        val initialAttacks =
          if state.boutPhase == BoutPhase.InitialAttack && isAttacker then
            player.hand.map(card => GameAction.InitialAttack(playerId, List(card)))
          else Vector.empty

        val covers =
          if isDefensePhase && isDefender then
            (for
              (pair, index) <- state.tablePairs.zipWithIndex
              if pair.defense.isEmpty
              card <- player.hand
            yield GameAction.CoverCard(playerId, index, card)).toVector
          else Vector.empty

        val redirects =
          if isDefensePhase && isDefender && state.config.allowRedirect then
            val attackRank = state.tablePairs.headOption.map(_.attack.rank)
            player.hand
              .filter(card => attackRank.contains(card.rank))
              .map(card => GameAction.RedirectAttack(playerId, List(card)))
          else Vector.empty

        val surrenders =
          if isDefensePhase && isDefender && state.tablePairs.exists(_.defense.isEmpty) then
            Vector(GameAction.DeclareSurrender(playerId))
          else Vector.empty

        val throwIns =
          if canThrowIn && !isDefender then
            player.hand.map(card => GameAction.ThrowInCards(playerId, List(card)))
          else Vector.empty

        val passes =
          if canThrowIn && !isDefender then Vector(GameAction.PassTurn(playerId))
          else Vector.empty

        initialAttacks ++ covers ++ redirects ++ surrenders ++ throwIns ++ passes
