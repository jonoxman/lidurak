package durak.engine

import scala.util.Random

/**
 * The "basic" computer opponent. It shares [[RandomBot]]'s legal-move
 * enumeration — so every action it returns is already accepted by
 * [[GameEngine.applyAction]] — but plays a simple policy instead of choosing
 * uniformly at random:
 *
 *   - an opening attack uses the lowest non-trump card, and only a trump when
 *     the hand holds nothing else;
 *   - a defender always covers or reflects the attack when it legally can, and
 *     only surrenders when no cover or redirect exists;
 *   - throw-ins use the lowest non-trump card matching a rank on the table and
 *     never a trump, passing once no non-trump throw-in is left.
 */
object BasicBot:

  /**
   * Every action the engine accepts for `playerId` right now. Delegating to
   * [[RandomBot.legalActionsFor]] keeps the two bots' move sets identical, so a
   * basic bot can never offer a move the engine would reject.
   */
  def legalActionsFor(state: GameState, playerId: String): Vector[GameAction] =
    RandomBot.legalActionsFor(state, playerId)

  /**
   * The basic bot's move for `playerId`: a legal action chosen by the policy
   * above, or `None` when the seat has nothing legal to play.
   */
  def chooseAction(
      state: GameState,
      playerId: String,
      rng: Random = new Random()
  ): Option[GameAction] =
    val actions = legalActionsFor(state, playerId)
    val attacks = actions.collect { case attack: GameAction.InitialAttack => attack }
    val defenses: Vector[GameAction] = actions.collect {
      case cover: GameAction.CoverCard          => cover
      case redirect: GameAction.RedirectAttack  => redirect
    }
    val surrenders = actions.collect { case surrender: GameAction.DeclareSurrender => surrender }
    val throwIns = actions.collect { case throwIn: GameAction.ThrowInCards => throwIn }
    val passes = actions.collect { case pass: GameAction.PassTurn => pass }

    if attacks.nonEmpty then Some(attackChoice(attacks, state.trumpSuit, rng))
    else if defenses.nonEmpty then Some(defenseChoice(defenses, state.trumpSuit, rng))
    else if throwIns.nonEmpty then throwInChoice(throwIns, passes, state.trumpSuit, rng)
    else if surrenders.nonEmpty then Some(surrenders.head)
    else passes.headOption

  /**
   * The lowest non-trump opening attack, or a random trump one when the hand
   * holds only trumps. Equal lowest ranks are broken at random.
   */
  private def attackChoice(
      attacks: Vector[GameAction.InitialAttack],
      trumpSuit: Suit,
      rng: Random
  ): GameAction.InitialAttack =
    val nonTrump = attacks.filter(attack => attack.cards.forall(_.suit != trumpSuit))
    val pool = if nonTrump.nonEmpty then nonTrump else attacks
    lowest(pool.map(attack => (attack.cards.map(_.rank.value).max, attack)), rng)

  /**
   * The cheapest legal cover or redirect: a non-trump one whenever possible,
   * then the lowest rank, with ties broken at random. Surrender is never
   * considered here, so a defender only gives up when this list is empty.
   */
  private def defenseChoice(
      defenses: Vector[GameAction],
      trumpSuit: Suit,
      rng: Random
  ): GameAction =
    val nonTrump = defenses.filter(action => defenseCards(action).forall(_.suit != trumpSuit))
    val pool = if nonTrump.nonEmpty then nonTrump else defenses
    lowest(pool.map(action => (defenseCards(action).map(_.rank.value).max, action)), rng)

  /** The cards an action spends: one for a cover, every reflected card for a redirect. */
  private def defenseCards(action: GameAction): List[Card] =
    action match
      case GameAction.CoverCard(_, _, card)    => List(card)
      case GameAction.RedirectAttack(_, cards) => cards
      case _                                   => Nil

  /**
   * The lowest non-trump throw-in matching a rank on the table. Trump cards are
   * never thrown in — once only trump throw-ins remain the bot passes, and
   * `None` when even passing is not legal.
   */
  private def throwInChoice(
      throwIns: Vector[GameAction.ThrowInCards],
      passes: Vector[GameAction.PassTurn],
      trumpSuit: Suit,
      rng: Random
  ): Option[GameAction] =
    val nonTrump = throwIns.filter(throwIn =>
      throwIn.cards.nonEmpty && throwIn.cards.forall(_.suit != trumpSuit)
    )
    if nonTrump.nonEmpty then
      Some(lowest(nonTrump.map(throwIn => (throwIn.cards.map(_.rank.value).max, throwIn)), rng))
    else passes.headOption

  /** A random pick among the actions with the smallest score. */
  private def lowest[A <: GameAction](scored: Vector[(Int, A)], rng: Random): A =
    val best = scored.map(_._1).min
    val pool = scored.collect { case (score, action) if score == best => action }
    pool(rng.nextInt(pool.size))
