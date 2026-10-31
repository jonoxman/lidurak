package durak.engine

enum GameAction:
  case InitialAttack(playerId: String, cards: List[Card], targetDefender: Option[String] = None)
  case CoverCard(playerId: String, attackIndex: Int, defenseCard: Card)
  case RedirectAttack(playerId: String, cards: List[Card])
  case ThrowInCards(playerId: String, cards: List[Card])
  case DeclareSurrender(playerId: String)
  case PassTurn(playerId: String)
