package durak.engine

import io.circe.{Json, parser}
import io.circe.syntax.*
import JsonCodecs.given

class JsonCodecsSuite extends munit.FunSuite:

  private def card(rank: Rank, suit: Suit = Suit.Spades): Card = Card(suit, rank)

  private def decodeAction(json: String): GameAction =
    parser.decode[GameAction](json).fold(error => fail(error.getMessage), identity)

  // --- Basic types ---

  test("suits encode as lowercase strings") {
    Suit.values.foreach { suit =>
      assertEquals(suit.asJson, Json.fromString(suit.toString.toLowerCase))
    }
    assertEquals(Suit.Hearts.asJson, Json.fromString("hearts"))
  }

  test("ranks encode as lowercase strings") {
    Rank.values.foreach { rank =>
      assertEquals(rank.asJson, Json.fromString(rank.toString.toLowerCase))
    }
    assertEquals(Rank.Ace.asJson, Json.fromString("ace"))
    assertEquals(Rank.Ten.asJson, Json.fromString("ten"))
  }

  test("suits and ranks decode from lowercase strings") {
    Suit.values.foreach { suit =>
      val raw = s""""${suit.toString.toLowerCase}""""
      assertEquals(parser.decode[Suit](raw), Right(suit))
    }
    Rank.values.foreach { rank =>
      val raw = s""""${rank.toString.toLowerCase}""""
      assertEquals(parser.decode[Rank](raw), Right(rank))
    }
    assert(parser.decode[Suit]("\"stars\"").isLeft)
    assert(parser.decode[Rank]("\"joker\"").isLeft)
  }

  test("cards encode as suit/rank objects and round-trip") {
    val ace = Card(Suit.Hearts, Rank.Ace)

    assertEquals(ace.asJson, Json.obj("suit" -> "hearts".asJson, "rank" -> "ace".asJson))
    assertEquals(parser.decode[Card](ace.asJson.noSpaces), Right(ace))
  }

  test("table pairs round-trip with and without a defense") {
    val pairs = List(
      TablePair(card(Rank.Six)),
      TablePair(card(Rank.Seven, Suit.Clubs), Some(card(Rank.Eight, Suit.Clubs)))
    )

    pairs.foreach { pair =>
      assertEquals(parser.decode[TablePair](pair.asJson.noSpaces), Right(pair))
    }
  }

  test("bout phases encode as lowercase-first names and round-trip") {
    assertEquals(BoutPhase.InitialAttack.asJson, Json.fromString("initialAttack"))
    assertEquals(BoutPhase.Defense.asJson, Json.fromString("defense"))
    assertEquals(BoutPhase.SurrenderThrowIn.asJson, Json.fromString("surrenderThrowIn"))
    assertEquals(BoutPhase.BoutOver.asJson, Json.fromString("boutOver"))
    assertEquals(BoutPhase.GameOver.asJson, Json.fromString("gameOver"))

    BoutPhase.values.foreach { phase =>
      assertEquals(parser.decode[BoutPhase](phase.asJson.noSpaces), Right(phase))
    }
    assert(parser.decode[BoutPhase]("\"lunchBreak\"").isLeft)
  }

  test("public player summaries round-trip") {
    val summary =
      PublicPlayerSummary("p1", "Bob", 4, hasPassed = true, finishRank = Some(2))

    assertEquals(
      parser.decode[PublicPlayerSummary](summary.asJson.noSpaces),
      Right(summary)
    )
  }

  // --- Player view ---

  test("PlayerGameView round-trips through JSON") {
    val game = GameEngine.createGame(
      GameConfig(playerCount = 3, seed = 99L),
      Vector("a", "b", "c")
    )
    val view = PlayerGameView.forViewer(game, "p1")

    val decoded = parser
      .decode[PlayerGameView](view.asJson.noSpaces)
      .fold(error => fail(error.getMessage), identity)

    assertEquals(decoded, view)
  }

  // --- Game actions ---

  test("InitialAttack decodes from a JSON command") {
    val json =
      """{"type":"initialAttack","playerId":"p0","cards":[{"suit":"spades","rank":"six"},{"suit":"hearts","rank":"six"}]}"""

    assertEquals(
      decodeAction(json),
      GameAction.InitialAttack("p0", List(card(Rank.Six), card(Rank.Six, Suit.Hearts)))
    )
  }

  test("InitialAttack round-trips an optional chaos target defender") {
    val targeted = GameAction.InitialAttack("p0", List(card(Rank.Six)), Some("p2"))
    val encoded = targeted.asJson

    assertEquals(encoded.hcursor.get[String]("targetDefender"), Right("p2"))
    assertEquals(parser.decode[GameAction](encoded.noSpaces), Right(targeted))

    val untargeted = GameAction.InitialAttack("p0", List(card(Rank.Six)))
    assertEquals(untargeted.asJson.hcursor.get[String]("targetDefender").isLeft, true)
    assertEquals(parser.decode[GameAction](untargeted.asJson.noSpaces), Right(untargeted))
  }

  test("CoverCard decodes from a JSON command") {
    val json =
      """{"type":"coverCard","playerId":"p1","attackIndex":0,"defenseCard":{"suit":"spades","rank":"seven"}}"""

    assertEquals(decodeAction(json), GameAction.CoverCard("p1", 0, card(Rank.Seven)))
  }

  test("RedirectAttack decodes from a JSON command") {
    val json =
      """{"type":"redirectAttack","playerId":"p1","cards":[{"suit":"clubs","rank":"eight"}]}"""

    assertEquals(
      decodeAction(json),
      GameAction.RedirectAttack("p1", List(card(Rank.Eight, Suit.Clubs)))
    )
  }

  test("every GameAction variant encodes with a type discriminator and round-trips") {
    val actions = List(
      GameAction.InitialAttack("p0", List(card(Rank.Six))),
      GameAction.CoverCard("p1", 2, card(Rank.Ace, Suit.Hearts)),
      GameAction.RedirectAttack("p1", List(card(Rank.Six, Suit.Clubs))),
      GameAction.ThrowInCards("p2", List(card(Rank.Seven), card(Rank.Seven, Suit.Hearts))),
      GameAction.DeclareSurrender("p1"),
      GameAction.PassTurn("p2")
    )

    actions.foreach { action =>
      val json = action.asJson
      assert(
        json.asObject.exists(_("type").flatMap(_.asString).nonEmpty),
        s"missing type discriminator: ${json.noSpaces}"
      )
      assertEquals(parser.decode[GameAction](json.noSpaces), Right(action))
    }
  }

  test("each game action uses its documented discriminator") {
    val expected = List(
      GameAction.InitialAttack("p0", Nil) -> "initialAttack",
      GameAction.CoverCard("p0", 0, card(Rank.Six)) -> "coverCard",
      GameAction.RedirectAttack("p0", Nil) -> "redirectAttack",
      GameAction.ThrowInCards("p0", Nil) -> "throwInCards",
      GameAction.DeclareSurrender("p0") -> "declareSurrender",
      GameAction.PassTurn("p0") -> "passTurn"
    )

    expected.foreach { case (action, discriminator) =>
      val encoded =
        action.asJson.asObject.flatMap(_("type")).flatMap(_.asString)
      assertEquals(encoded, Some(discriminator))
    }
  }

  test("unknown action types are rejected") {
    assert(parser.decode[GameAction]("""{"type":"teleport","playerId":"p0"}""").isLeft)
  }

  test("actions with missing or invalid fields are rejected") {
    assert(parser.decode[GameAction]("""{"type":"coverCard","playerId":"p1"}""").isLeft)
    assert(parser.decode[GameAction]("""{"playerId":"p1"}""").isLeft)
    assert(
      parser
        .decode[GameAction](
          """{"type":"initialAttack","playerId":"p0","cards":[{"suit":"stars","rank":"six"}]}"""
        )
        .isLeft
    )
  }
