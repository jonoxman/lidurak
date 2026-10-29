package durak.engine

case class GameConfig(
  playerCount: Int,
  allowRedirect: Boolean = true,
  seed: Long = System.currentTimeMillis()
)
