package durak.engine

import io.circe.syntax.*
import JsonCodecs.given

class PlayerViewSuite extends munit.FunSuite:

  private def card(rank: Rank, suit: Suit = Suit.Spades): Card = Card(suit, rank)

  private def player(
      id: String,
      hand: List[Card],
      hasPassed: Boolean = false,
      finishRank: Option[Int] = None
  ): PlayerState =
    PlayerState(
      id = id,
      name = id.toUpperCase,
      hand = hand.toVector,
      hasPassed = hasPassed,
      finishRank = finishRank
    )

  private def state(
      players: Vector[PlayerState],
      tablePairs: Vector[TablePair] = Vector.empty,
      talon: Vector[Card] = Vector.empty,
      bottomTrumpCard: Option[Card] = None,
      attackerIdx: Int = 0,
      defenderIdx: Int = 1,
      boutPhase: BoutPhase = BoutPhase.Defense,
      trumpSuit: Suit = Suit.Spades,
      defenderInitialHandSize: Int = 6,
      finishOrder: Vector[String] = Vector.empty,
      isDraw: Boolean = false
  ): GameState =
    GameState(
      config = GameConfig(players.size, seed = 42L),
      players = players,
      talon = talon,
      trumpSuit = trumpSuit,
      bottomTrumpCard = bottomTrumpCard,
      discardPile = Vector.empty,
      tablePairs = tablePairs,
      attackerIdx = attackerIdx,
      defenderIdx = defenderIdx,
      boutPhase = boutPhase,
      defenderInitialHandSize = defenderInitialHandSize,
      finishOrder = finishOrder,
      isDraw = isDraw
    )

  // --- Hand & opponent projection ---

  test("the viewer's own hand is included as a list of cards") {
    val gs = state(
      Vector(
        player("p0", List(card(Rank.Six), card(Rank.Seven, Suit.Hearts))),
        player("p1", List(card(Rank.Eight))),
        player("p2", List(card(Rank.Nine)))
      ),
      boutPhase = BoutPhase.InitialAttack
    )

    val view = PlayerGameView.forViewer(gs, "p0")

    assertEquals(view.myId, "p0")
    assertEquals(view.myHand, List(card(Rank.Six), card(Rank.Seven, Suit.Hearts)))
  }

  test("opponents are summarised without their cards") {
    val gs = state(
      Vector(
        player("p0", List(card(Rank.Six))),
        player("p1", List(card(Rank.Seven), card(Rank.Eight), card(Rank.Nine))),
        player("p2", List(card(Rank.Ten), card(Rank.Jack)), hasPassed = true)
      ),
      boutPhase = BoutPhase.InitialAttack
    )

    val view = PlayerGameView.forViewer(gs, "p0")

    assertEquals(
      view.opponents,
      List(
        PublicPlayerSummary("p1", "P1", 3, false, None),
        PublicPlayerSummary("p2", "P2", 2, true, None)
      )
    )
    assert(!view.opponents.exists(_.id == "p0"), view.opponents.map(_.id))
  }

  test("talonCount matches the actual talon size") {
    val gs = state(
      Vector(player("p0", List(card(Rank.Six))), player("p1", List(card(Rank.Seven)))),
      talon = Vector(
        card(Rank.Eight, Suit.Diamonds),
        card(Rank.Nine, Suit.Diamonds),
        card(Rank.Ten, Suit.Diamonds),
        card(Rank.Jack, Suit.Diamonds),
        card(Rank.Queen, Suit.Diamonds)
      )
    )

    assertEquals(PlayerGameView.forViewer(gs, "p0").talonCount, 5)
  }

  test("the bottom trump card is visible while the talon still has cards") {
    val trump = card(Rank.Six, Suit.Diamonds)
    val gs = state(
      Vector(player("p0", List(card(Rank.Six))), player("p1", List(card(Rank.Seven)))),
      talon = Vector(card(Rank.Eight, Suit.Clubs)),
      bottomTrumpCard = Some(trump)
    )

    assertEquals(PlayerGameView.forViewer(gs, "p0").bottomTrumpCard, Some(trump))
  }

  test("the bottom trump card is None once the talon is empty") {
    val gs = state(
      Vector(player("p0", List(card(Rank.Six))), player("p1", List(card(Rank.Seven)))),
      talon = Vector.empty,
      bottomTrumpCard = Some(card(Rank.Six, Suit.Diamonds))
    )

    assertEquals(PlayerGameView.forViewer(gs, "p0").bottomTrumpCard, None)
  }

  test("the public state mirrors the game state") {
    val gs = state(
      Vector(
        player("p0", List(card(Rank.Six))),
        player("p1", List(card(Rank.Seven))),
        player("p2", List(card(Rank.Eight)))
      ),
      tablePairs = Vector(TablePair(card(Rank.Six), Some(card(Rank.Seven)))),
      boutPhase = BoutPhase.Defense,
      defenderInitialHandSize = 4,
      finishOrder = Vector("p3")
    )

    val view = PlayerGameView.forViewer(gs, "p2")

    assertEquals(view.tablePairs, gs.tablePairs)
    assertEquals(view.trumpSuit, Suit.Spades)
    assertEquals(view.attackerIdx, 0)
    assertEquals(view.defenderIdx, 1)
    assertEquals(view.boutPhase, BoutPhase.Defense)
    assertEquals(view.finishOrder, Vector("p3"))
    assertEquals(view.isDraw, false)
    assertEquals(view.maxBoutAttacks, 4)
  }

  // --- Legal actions ---

  test("the attacker may attack during the initial attack, nobody else may act") {
    val gs = state(
      Vector(
        player("p0", List(card(Rank.Six), card(Rank.Seven))),
        player("p1", List(card(Rank.Eight))),
        player("p2", List(card(Rank.Nine)))
      ),
      boutPhase = BoutPhase.InitialAttack
    )

    assertEquals(PlayerGameView.forViewer(gs, "p0").legalActions, List("attack"))
    assertEquals(PlayerGameView.forViewer(gs, "p1").legalActions, List.empty)
  }

  test("a defender that can cover, redirect and surrender sees all three actions") {
    val gs = state(
      Vector(
        player("p0", List(card(Rank.King), card(Rank.Queen))),
        player("p1", List(card(Rank.Seven), card(Rank.Six, Suit.Hearts), card(Rank.King, Suit.Clubs))),
        player("p2", List(card(Rank.Eight, Suit.Diamonds), card(Rank.Nine, Suit.Diamonds)))
      ),
      tablePairs = Vector(TablePair(card(Rank.Six)))
    )

    assertEquals(
      PlayerGameView.forViewer(gs, "p1").legalActions,
      List("cover", "surrender", "redirect")
    )
  }

  test("a defender without a legal cover may still surrender and redirect") {
    val gs = state(
      Vector(
        player("p0", List(card(Rank.King))),
        player("p1", List(card(Rank.Six, Suit.Hearts))),
        player("p2", List(card(Rank.Eight), card(Rank.Nine)))
      ),
      tablePairs = Vector(TablePair(card(Rank.Six)))
    )

    assertEquals(
      PlayerGameView.forViewer(gs, "p1").legalActions,
      List("surrender", "redirect")
    )
  }

  test("a redirect is not offered when the next defender cannot take the attack") {
    val gs = state(
      Vector(
        player("p0", List(card(Rank.King))),
        player("p1", List(card(Rank.Six, Suit.Hearts))),
        player("p2", List(card(Rank.Eight)))
      ),
      tablePairs = Vector(TablePair(card(Rank.Six)))
    )

    assertEquals(PlayerGameView.forViewer(gs, "p1").legalActions, List("surrender"))
  }

  test("a non-defender may pass and throw in once the table is covered") {
    val gs = state(
      Vector(
        player("p0", List(card(Rank.King), card(Rank.Queen))),
        player("p1", List(card(Rank.Seven), card(Rank.Eight))),
        player("p2", List(card(Rank.Six, Suit.Hearts), card(Rank.Nine, Suit.Clubs)))
      ),
      tablePairs = Vector(TablePair(card(Rank.Six), Some(card(Rank.Seven))))
    )

    assertEquals(
      PlayerGameView.forViewer(gs, "p2").legalActions,
      List("pass", "throwIn")
    )
  }

  test("a non-defender cannot pass while an attack is uncovered") {
    val gs = state(
      Vector(
        player("p0", List(card(Rank.King), card(Rank.Queen))),
        player("p1", List(card(Rank.Seven), card(Rank.Eight), card(Rank.Nine))),
        player("p2", List(card(Rank.Six, Suit.Hearts)))
      ),
      tablePairs = Vector(TablePair(card(Rank.Six)))
    )

    assertEquals(PlayerGameView.forViewer(gs, "p2").legalActions, List("throwIn"))
  }

  test("a non-defender without a matching rank can only pass") {
    val gs = state(
      Vector(
        player("p0", List(card(Rank.King), card(Rank.Queen))),
        player("p1", List(card(Rank.Seven), card(Rank.Eight))),
        player("p2", List(card(Rank.Nine, Suit.Clubs)))
      ),
      tablePairs = Vector(TablePair(card(Rank.Six), Some(card(Rank.Seven))))
    )

    assertEquals(PlayerGameView.forViewer(gs, "p2").legalActions, List("pass"))
  }

  test("during a surrender throw-in non-defenders may pass or throw in, the defender may not act") {
    val gs = state(
      Vector(
        player("p0", List(card(Rank.King), card(Rank.Queen))),
        player("p1", List(card(Rank.Seven), card(Rank.Eight))),
        player("p2", List(card(Rank.Six, Suit.Hearts)))
      ),
      tablePairs = Vector(TablePair(card(Rank.Six))),
      boutPhase = BoutPhase.SurrenderThrowIn
    )

    assertEquals(
      PlayerGameView.forViewer(gs, "p2").legalActions,
      List("pass", "throwIn")
    )
    assertEquals(PlayerGameView.forViewer(gs, "p1").legalActions, List.empty)
  }

  test("a finished player has no legal actions") {
    val gs = state(
      Vector(
        player("p0", List.empty, finishRank = Some(1)),
        player("p1", List(card(Rank.Seven))),
        player("p2", List(card(Rank.Eight)))
      ),
      tablePairs = Vector(TablePair(card(Rank.Six), Some(card(Rank.Seven))))
    )

    assertEquals(PlayerGameView.forViewer(gs, "p0").legalActions, List.empty)
  }

  test("no player has legal actions once the game is over") {
    val gs = state(
      Vector(
        player("p0", List(card(Rank.Six))),
        player("p1", List(card(Rank.Seven)))
      ),
      boutPhase = BoutPhase.GameOver
    )

    assertEquals(PlayerGameView.forViewer(gs, "p0").legalActions, List.empty)
  }

  test("an unknown viewer is rejected") {
    val gs = state(
      Vector(player("p0", List(card(Rank.Six))), player("p1", List(card(Rank.Seven))))
    )

    intercept[IllegalArgumentException](PlayerGameView.forViewer(gs, "ghost"))
  }

  // --- Turn clock & defenseless state ---

  test("the view exposes the turn deadline, remaining seconds and turn flag") {
    val gs = state(
      Vector(
        player("p0", List(card(Rank.King))),
        player("p1", List(card(Rank.Six, Suit.Hearts)))
      ),
      tablePairs = Vector(TablePair(card(Rank.Ace, Suit.Clubs)))
    ).copy(turnDeadlineMs = 10_000L)

    val view = PlayerGameView.forViewer(gs, "p0", nowMs = 4_000L)

    assertEquals(view.turnPlayerId, Some("p1"))
    assertEquals(view.turnDeadlineMs, 10_000L)
    assertEquals(view.turnSecondsRemaining, 6)
    assertEquals(view.opponents.map(_.isTurn), List(true))
    assertEquals(view.defenderDefenseless, true)
  }

  test("an idle clock reports no deadline and zero seconds remaining") {
    val gs = state(
      Vector(player("p0", List(card(Rank.Six))), player("p1", List(card(Rank.Seven))))
    )

    val view = PlayerGameView.forViewer(gs, "p0", nowMs = 1_000L)

    assertEquals(view.turnDeadlineMs, 0L)
    assertEquals(view.turnSecondsRemaining, 0)
  }

  test("a defender who can cover is not flagged defenseless") {
    val gs = state(
      Vector(
        player("p0", List(card(Rank.King))),
        player("p1", List(card(Rank.Eight, Suit.Clubs)))
      ),
      tablePairs = Vector(TablePair(card(Rank.Six, Suit.Clubs)))
    )

    assertEquals(PlayerGameView.forViewer(gs, "p0").defenderDefenseless, false)
  }

  // --- Hidden information ---

  test("the serialized view never exposes opponent hands, the talon or the discard pile") {
    val secret = card(Rank.Ace, Suit.Hearts)
    val gs = state(
      Vector(
        player("p0", List(card(Rank.Six))),
        player("p1", List(secret, card(Rank.King, Suit.Clubs)))
      ),
      talon = Vector(card(Rank.Eight, Suit.Diamonds)),
      bottomTrumpCard = Some(card(Rank.Seven, Suit.Diamonds)),
      boutPhase = BoutPhase.InitialAttack
    )

    val json = PlayerGameView.forViewer(gs, "p0").asJson
    val encoded = json.noSpaces
    val keys = json.asObject.map(_.keys.toSet).getOrElse(Set.empty)

    assert(!keys.contains("talon"), keys.toString)
    assert(!keys.contains("players"), keys.toString)
    assert(!keys.contains("discardPile"), keys.toString)
    assert(!encoded.contains(secret.asJson.noSpaces), s"view leaked an opponent card: $encoded")
    assert(keys.contains("myHand"), keys.toString)
    assert(keys.contains("talonCount"), keys.toString)
  }

  // --- Presence ---

  test("present seats are projected to the opponents and the present list") {
    val gs = state(
      Vector(
        player("p0", List(card(Rank.Six))),
        player("p1", List(card(Rank.Seven))),
        player("p2", List(card(Rank.Eight)))
      ),
      boutPhase = BoutPhase.InitialAttack
    ).copy(presentPlayers = Set("p0", "p2"))

    val view = PlayerGameView.forViewer(gs, "p0")

    assertEquals(view.presentPlayers, Vector("p0", "p2"))
    assertEquals(view.opponents.map(seat => seat.id -> seat.isPresent).toMap, Map("p1" -> false, "p2" -> true))
  }

  test("bot seats are always present, even before they report anything") {
    val gs = state(
      Vector(player("p0", List(card(Rank.Six))), player("p1", List(card(Rank.Seven))))
    ).copy(config = GameConfig(2, seed = 42L, playerTypes = Vector("randomBot", "human")))

    val view = PlayerGameView.forViewer(gs, "p1")

    assertEquals(view.presentPlayers, Vector("p0"))
    assertEquals(view.opponents.map(_.isPresent), List(true))
    assertEquals(gs.isPlayerPresent("p1"), false)
  }

  // --- Viewer name ---

  test("the viewer's own name is projected and encoded for the POV menu") {
    val gs = state(
      Vector(player("p0", List(card(Rank.Six))), player("p1", List(card(Rank.Seven))))
    )

    val view = PlayerGameView.forViewer(gs, "p0")

    assertEquals(view.myName, "P0")
    assert(view.asJson.noSpaces.contains("\"myName\":\"P0\""), view.asJson.noSpaces)
  }

  test("legacy view JSON without myName still decodes to an empty name") {
    val gs = state(
      Vector(player("p0", List(card(Rank.Six))), player("p1", List(card(Rank.Seven))))
    )
    val json = PlayerGameView.forViewer(gs, "p0").asJson
    val legacy = io.circe.Json.fromJsonObject(
      json.asObject.map(_.remove("myName")).getOrElse(io.circe.JsonObject.empty)
    )

    val decoded = io.circe.parser.decode[PlayerGameView](legacy.noSpaces)

    assertEquals(decoded.map(_.myName), Right(""))
    assertEquals(decoded.map(_.myId), Right("p0"))
  }
