package durak.engine

enum BoutPhase:
  case InitialAttack
  case Defense
  case SurrenderThrowIn
  case BoutOver       // Transient phase during resolution
  case GameOver
