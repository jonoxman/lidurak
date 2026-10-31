package durak.engine

case class GameConfig(
  playerCount: Int,
  allowRedirect: Boolean = true,
  seed: Long = System.currentTimeMillis(),
  /** "Chaos Mode": free initial-attack targeting and random redirects (3-4 players only). */
  chaosMode: Boolean = false
)
