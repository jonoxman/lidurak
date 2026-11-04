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

  // --- Own status projection (ITEM-ADD-8a / ITEM-ADD-8b) ---

  test("the viewer's own pass flag and finishing rank are projected") {
    val gs = state(
      Vector(
        player("p0", List.empty, hasPassed = true, finishRank = Some(1)),
        player("p1", List(card(Rank.Seven)), hasPassed = true)
      ),
      boutPhase = BoutPhase.SurrenderThrowIn,
      finishOrder = Vector("p0")
    )

    val finishedView = PlayerGameView.forViewer(gs, "p0")

    assertEquals(finishedView.myHasPassed, true)
    assertEquals(finishedView.myFinishRank, Some(1))
    assertEquals(finishedView.myHand, List.empty)

    // A seat that still holds cards is passed but never finished.
    val waiting = PlayerGameView.forViewer(gs, "p1")

    assertEquals(waiting.myHasPassed, true)
    assertEquals(waiting.myFinishRank, None)
  }

  test("a seat still holding cards is never projected with a finishing rank") {
    val gs = state(
      Vector(
        player("p0", List(card(Rank.Six))),
        player("p1", List(card(Rank.Seven)), finishRank = Some(2)),
        player("p2", List.empty, finishRank = Some(1))
      ),
      boutPhase = BoutPhase.GameOver,
      finishOrder = Vector("p2", "p1")
    )

    // Bob keeps three-card hands in the QA preset: he must never read as OUT.
    val alice = PlayerGameView.forViewer(gs, "p0")

    assertEquals(
      alice.opponents.map(seat => seat.id -> seat.finishRank).toMap,
      Map("p1" -> None, "p2" -> Some(1))
    )
    assertEquals(alice.myFinishRank, None)

    val bob = PlayerGameView.forViewer(gs, "p1")

    assertEquals(bob.myFinishRank, None)
    assertEquals(bob.myHasPassed, false)
    // The finished seat still resolves its rank from `finishOrder`.
    assertEquals(PlayerGameView.forViewer(gs, "p2").myFinishRank, Some(1))
  }

  test("the own status fields round-trip through JSON and default when absent") {
    val gs = state(
      Vector(player("p0", List.empty, hasPassed = true), player("p1", List(card(Rank.Seven)))),
      boutPhase = BoutPhase.SurrenderThrowIn,
      finishOrder = Vector("p0")
    )

    val view = PlayerGameView.forViewer(gs, "p0")
    val json = view.asJson

    assert(json.noSpaces.contains("\"myHasPassed\":true"), json.noSpaces)
    assert(json.noSpaces.contains("\"myFinishRank\":1"), json.noSpaces)
    assertEquals(io.circe.parser.decode[PlayerGameView](json.noSpaces), Right(view))

    val legacy = io.circe.Json.fromJsonObject(
      json.asObject.map(_.remove("myHasPassed")).getOrElse(io.circe.JsonObject.empty)
    )

    assertEquals(io.circe.parser.decode[PlayerGameView](legacy.noSpaces).map(_.myHasPassed), Right(false))
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

  // --- Game over projection (feedback items 9 / 12) ---

  test("every seat can be projected at game over with an idle clock and no actions") {
    val finished = state(
      Vector(
        player("p0", List.empty, finishRank = Some(1)),
        player("p1", List(card(Rank.Six)), finishRank = Some(2))
      ),
      boutPhase = BoutPhase.GameOver,
      finishOrder = Vector("p0", "p1")
    ).copy(turnDeadlineMs = 9_000L, gameStartedAtMs = Some(1_000L), gameEndedAtMs = Some(2_500L))

    List("p0", "p1").foreach { viewer =>
      val view = PlayerGameView.forViewer(finished, viewer, nowMs = 4_000L)

      assertEquals(view.boutPhase, BoutPhase.GameOver)
      assertEquals(view.legalActions, List.empty)
      assertEquals(view.promptedPlayerIds, Vector.empty)
      assertEquals(view.turnPlayerId, None)
      assertEquals(view.turnDeadlineMs, 0L)
      assertEquals(view.turnSecondsRemaining, 0)
      assertEquals(view.gameEndedAtMs, Some(2_500L))
      assertEquals(view.winners, List("p0"))
      assertEquals(view.durak, Some("p1"))
    }
  }

  test("a draw with every hand empty still projects every seat without throwing") {
    val drawn = state(
      Vector(
        player("p0", List.empty, finishRank = Some(1)),
        player("p1", List.empty, finishRank = Some(1))
      ),
      boutPhase = BoutPhase.GameOver,
      finishOrder = Vector("p0", "p1"),
      isDraw = true
    )

    List("p0", "p1").foreach { viewer =>
      val view = PlayerGameView.forViewer(drawn, viewer)

      assertEquals(view.boutPhase, BoutPhase.GameOver)
      assertEquals(view.isDraw, true)
      assertEquals(view.winners, List("p0", "p1"))
      assertEquals(view.durak, None)
      assertEquals(view.legalActions, List.empty)
      assertEquals(view.promptedPlayerIds, Vector.empty)
      assertEquals(view.turnDeadlineMs, 0L)
    }
  }

  // --- Throw-in projection (feedback item 3b) ---

  test("every matching thrower sees throwIn right after the opening attack") {
    val attack = card(Rank.Six)
    val gs = state(
      Vector(
        player("p0", List(card(Rank.Nine, Suit.Clubs), card(Rank.Queen, Suit.Hearts))),
        player("p1", List(card(Rank.Nine), card(Rank.Eight, Suit.Diamonds))),
        player("p2", List(card(Rank.Six, Suit.Hearts), card(Rank.Ten, Suit.Diamonds))),
        player("p3", List(card(Rank.Six, Suit.Diamonds), card(Rank.Ace)))
      ),
      tablePairs = Vector(TablePair(attack)),
      boutPhase = BoutPhase.Defense,
      defenderInitialHandSize = 4
    ).copy(turnDeadlineMs = 10_000L)

    // Both matching throwers may add a card, and the engine agrees with the view.
    assertEquals(PlayerGameView.forViewer(gs, "p2").legalActions, List("throwIn"))
    assertEquals(PlayerGameView.forViewer(gs, "p3").legalActions, List("throwIn"))
    assertEquals(
      GameEngine.legalActions(gs, "p2"),
      List(GameAction.ThrowInCards("p2", List(card(Rank.Six, Suit.Hearts))))
    )
    // A seat without a matching rank keeps the clock but has nothing to add.
    assertEquals(PlayerGameView.forViewer(gs, "p0").legalActions, List.empty)
    assertEquals(PlayerGameView.forViewer(gs, "p1").legalActions, List("cover", "surrender"))

    // The defender keeps the turn clock while an attack is still uncovered.
    assertEquals(gs.turnPlayerId, Some("p1"))
    assertEquals(gs.promptedPlayerIds, Set("p1"))
    assertEquals(PlayerGameView.forViewer(gs, "p2").turnPlayerId, Some("p1"))
  }

  // --- Transparent Mode & Dev Mode (T-90 ITEM-10a / ITEM-14a) ---

  test("an ordinary live view keeps every opponent hand hidden") {
    val gs = state(
      Vector(
        player("p0", List(card(Rank.Six))),
        player("p1", List(card(Rank.Seven), card(Rank.Eight))),
        player("p2", List(card(Rank.Nine)))
      ),
      boutPhase = BoutPhase.InitialAttack
    )

    val view = PlayerGameView.forViewer(gs, "p0")

    assertEquals(view.transparentMode, false)
    assertEquals(view.devMode, true)
    assertEquals(view.opponents.map(_.cards), List(Vector.empty, Vector.empty))
    assert(!view.asJson.noSpaces.contains("\"cards\":[{"), view.asJson.noSpaces)
  }

  test("Transparent Mode projects every opponent's actual hand") {
    val bobHand = Vector(card(Rank.Seven), card(Rank.Nine, Suit.Diamonds))
    val carolHand = Vector(card(Rank.Eight, Suit.Hearts))
    val gs = state(
      Vector(
        player("p0", List(card(Rank.Six))),
        player("p1", bobHand.toList),
        player("p2", carolHand.toList)
      ),
      boutPhase = BoutPhase.InitialAttack
    ).copy(config = GameConfig(3, seed = 42L, transparentMode = true))

    val view = PlayerGameView.forViewer(gs, "p0")

    assertEquals(view.transparentMode, true)
    assertEquals(view.opponents.map(_.cards), List(bobHand, carolHand))
    assertEquals(view.opponents.map(_.cardCount), List(2, 1))
    // The viewer's own hand still travels through `myHand` only.
    assertEquals(view.myHand, List(card(Rank.Six)))
  }

  test("a non-transparent replay keeps hands hidden until Game Over") {
    val live = state(
      Vector(player("p0", List(card(Rank.Six))), player("p1", List(card(Rank.Seven))))
    )

    val liveView = GameReplay.frozenViews(live, 0L)("p0")
    assertEquals(liveView.opponents.map(_.cards), List(Vector.empty))

    val finished = live.copy(boutPhase = BoutPhase.GameOver)
    val reviewView = GameReplay.frozenViews(finished, 500L)("p0")
    assertEquals(reviewView.opponents.map(_.cards), List(Vector(card(Rank.Seven))))
    assertEquals(reviewView.transparentMode, false)
  }

  test("Dev Mode is projected from the config, including when it is off") {
    val gs = state(
      Vector(player("p0", List(card(Rank.Six))), player("p1", List(card(Rank.Seven))))
    ).copy(config = GameConfig(2, seed = 42L, devMode = false))

    val view = PlayerGameView.forViewer(gs, "p0")

    assertEquals(view.devMode, false)
    assertEquals(view.asJson.noSpaces.contains("\"devMode\":false"), true)
  }

  test("during a surrender throw-in every eligible thrower is prompted") {
    val gs = state(
      Vector(
        player("p0", List(card(Rank.Ace, Suit.Clubs), card(Rank.Six, Suit.Hearts))),
        player("p1", List(card(Rank.Seven), card(Rank.Eight))),
        player("p2", List(card(Rank.King, Suit.Diamonds), card(Rank.Queen, Suit.Diamonds))),
        player("p3", List(card(Rank.Six, Suit.Diamonds)))
      ),
      tablePairs = Vector(TablePair(card(Rank.Six))),
      boutPhase = BoutPhase.SurrenderThrowIn,
      defenderInitialHandSize = 4
    )

    assertEquals(PlayerGameView.forViewer(gs, "p0").legalActions, List("pass", "throwIn"))
    assertEquals(PlayerGameView.forViewer(gs, "p3").legalActions, List("pass", "throwIn"))
    assertEquals(PlayerGameView.forViewer(gs, "p2").legalActions, List("pass"))
    assertEquals(PlayerGameView.forViewer(gs, "p1").legalActions, List.empty)

    // Every seat that can still act is on the clock together.
    assertEquals(gs.promptedPlayerIds, Set("p0", "p2", "p3"))
    assertEquals(PlayerGameView.forViewer(gs, "p2").promptedPlayerIds, Vector("p0", "p2", "p3"))
  }
