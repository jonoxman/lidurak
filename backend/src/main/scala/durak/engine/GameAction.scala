package durak.engine

enum GameAction:
  /**
   * Opens a bout. `targetPlayerId` names the seat the attack is aimed at; it is
   * only meaningful in Chaos mode, where any other active seat may be attacked.
   * A standard game ignores it when it is empty and rejects any other seat than
   * the clockwise defender.
   */
  case InitialAttack(
      playerId: String,
      cards: List[Card],
      targetPlayerId: Option[String] = None
  )
  case CoverCard(playerId: String, attackIndex: Int, defenseCard: Card)
  case RedirectAttack(playerId: String, cards: List[Card])
  case ThrowInCards(playerId: String, cards: List[Card])
  case DeclareSurrender(playerId: String)
  case PassTurn(playerId: String)
