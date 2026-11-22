package durak.server

import cats.effect.IO
import cats.effect.unsafe.implicits.global
import durak.engine.*
import durak.engine.JsonCodecs.given
import io.circe.Json
import io.circe.syntax.*
import org.http4s.*
import org.http4s.circe.CirceEntityDecoder.*
import org.http4s.circe.CirceEntityEncoder.*
import org.http4s.headers.`Content-Type`

import scala.concurrent.duration.*

/**
 * T-90-feedback-20261122_171451-1 ITEM-9: the QA Scenario Preset catalog of the
 * current QA round, i.e. exactly the four curated positions
 * (`qa-normal-6-actions`, `qa-medium-14-expand`, `qa-large-30-compress` and
 * `qa-single-card`). Every one of them must load a card-conserving, rule
 * compliant `GameState` with a live turn clock.
 */
class PresetSuite extends munit.FunSuite:

  private def newManager: GameManager =
    GameManager
      .create(BotTiming(randomBotDelay = 5.millis, initialBotStartDelay = 5.millis))
      .unsafeRunSync()

  private def send(manager: GameManager, request: Request[IO]): (Status, Json) =
    GameRoutes
      .restRoutes(manager)
      .orNotFound
      .run(request)
      .flatMap(response => response.as[Json].map(json => (response.status, json)))
      .unsafeRunSync()

  private def post(manager: GameManager, path: String, body: Json): (Status, Json) =
    send(
      manager,
      Request[IO](Method.POST, Uri.unsafeFromString(path))
        .withEntity(body)
        .withContentType(`Content-Type`(MediaType.application.json))
    )

  private def view(manager: GameManager, gameId: String, playerId: String): PlayerGameView =
    val (status, json) = send(
      manager,
      Request[IO](
        Method.GET,
        Uri.unsafeFromString(s"/api/games/$gameId/view?player=$playerId")
      )
    )
    assertEquals(status, Status.Ok)
    json.as[PlayerGameView].getOrElse(fail(s"invalid view body: ${json.noSpaces}"))

  private def startPreset(manager: GameManager, presetId: String): (String, Json) =
    val (status, json) = post(
      manager,
      "/api/games/preset",
      Json.obj("preset" -> presetId.asJson)
    )
    assertEquals(status, Status.Ok, json.noSpaces)
    val gameId = json.hcursor
      .get[String]("gameId")
      .getOrElse(fail(s"missing gameId in ${json.noSpaces}"))
    (gameId, json)

  /** Starts a preset through the documented path form and returns its room. */
  private def startPresetPath(manager: GameManager, presetId: String): (String, Json) =
    val (status, json) = post(manager, s"/api/games/preset/$presetId", Json.obj())
    assertEquals(status, Status.Ok, json.noSpaces)
    val gameId = json.hcursor
      .get[String]("gameId")
      .getOrElse(fail(s"missing gameId in ${json.noSpaces}"))
    (gameId, json)

  /**
   * Asserts the position holds exactly `deckSize` distinct cards across every
   * hand, the table, the talon and the discard pile, and returns its state.
   */
  private def assertConserved(
      manager: GameManager,
      gameId: String,
      deckSize: Int
  ): GameState =
    val room = manager.getRoom(gameId).unsafeRunSync().getOrElse(fail("room is missing"))
    val state = room.stateRef.get.unsafeRunSync()
    val tableCards = state.tablePairs.flatMap(pair => pair.attack :: pair.defense.toList)
    val allCards =
      state.players.flatMap(_.hand) ++ tableCards ++ state.talon ++ state.discardPile
    assertEquals(allCards.size, deckSize, s"cards: $allCards")
    assertEquals(allCards.distinct.size, deckSize, s"cards: $allCards")
    state

  test("the preset catalog exposes only the four curated QA scenarios") {
    assertEquals(
      GameManager.Presets,
      Vector(
        "qa-normal-6-actions",
        "qa-medium-14-expand",
        "qa-large-30-compress",
        "qa-single-card"
      )
    )

    val manager = newManager
    // ITEM-9: every preset of the previous QA rounds is pruned, both from the id
    // lookup and from the two HTTP routes.
    Vector(
      "3p-redirect-bob",
      "chaos-4p",
      "surrender-half-off",
      "defenseless-surrender",
      "discard-and-endgame",
      "transparent-mode",
      "full-hand-pickup",
      "throw-in-visibility-4p",
      "throw-in-capacity-cap",
      "huge-hand-36",
      "huge-hand-52",
      "throw-in-multi-qa",
      "large-hand-stress",
      "throw-in-visibility-3p",
      "mega-hand-30"
    ).foreach { presetId =>
      assert(GameManager.preset(presetId).isLeft, s"$presetId is still in the catalog")
      val (pathStatus, pathJson) = post(manager, s"/api/games/preset/$presetId", Json.obj())
      assertEquals(pathStatus, Status.BadRequest, s"$presetId: ${pathJson.noSpaces}")
      val (bodyStatus, bodyJson) = post(
        manager,
        "/api/games/preset",
        Json.obj("preset" -> presetId.asJson)
      )
      assertEquals(bodyStatus, Status.BadRequest, s"$presetId: ${bodyJson.noSpaces}")
    }
  }

  test("an unknown preset is rejected with 400 and an error message") {
    val manager = newManager

    val (status, json) = post(manager, "/api/games/preset", Json.obj("preset" -> "nope".asJson))

    assertEquals(status, Status.BadRequest)
    assert(json.hcursor.get[String]("error").exists(_.nonEmpty), json.noSpaces)
  }

  test("qa-normal-6-actions starts the 6-card 10s & actions table") {
    val manager = newManager
    val (gameId, json) = startPreset(manager, "qa-normal-6-actions")

    assert(gameId.matches("^[A-Za-z0-9]{8}$"), s"invalid game id: $gameId")
    assertEquals(json.hcursor.get[String]("defaultPlayerId").toOption, Some("p0"))
    assertEquals(
      json.hcursor.downField("players").as[List[Json]].map(_.size).toOption,
      Some(3)
    )
    assertEquals(
      json.hcursor.downField("playerTypes").as[List[String]].toOption,
      Some(List("human", "human", "human"))
    )
    assertEquals(json.hcursor.get[Boolean]("devMode").toOption, Some(true))

    val alice = view(manager, gameId, "p0")

    // ITEM #2: a `10` hand card next to a `10` on the table and two more tens in
    // the defender's hand.
    assertEquals(
      alice.myHand,
      List(
        Card(Suit.Clubs, Rank.Ten),
        Card(Suit.Diamonds, Rank.Jack),
        Card(Suit.Clubs, Rank.Jack),
        Card(Suit.Diamonds, Rank.Nine),
        Card(Suit.Clubs, Rank.Queen),
        Card(Suit.Diamonds, Rank.Six)
      )
    )
    assertEquals(alice.tablePairs.size, 1)
    assertEquals(
      alice.tablePairs.map(pair => (pair.attack, pair.defense)),
      Vector((Card(Suit.Spades, Rank.Ten), Some(Card(Suit.Spades, Rank.Jack))))
    )
    assertEquals(alice.boutPhase, BoutPhase.Defense)
    assertEquals(alice.trumpSuit, Suit.Hearts)
    assertEquals(alice.attackerIdx, 0)
    assertEquals(alice.defenderIdx, 1)
    // ITEM #5 / #7: the default six-card box with a three-card multi-select
    // throw-in and the lower-table Pass button.
    assertEquals(alice.throwInCards, alice.myHand.take(3))
    assertEquals(alice.throwInCapacity, 3)
    assertEquals(alice.canThrowIn, true)
    assertEquals(alice.legalActions, List("pass", "throwIn"))
    // ITEM #4: the turn clock is live from the first frame.
    assert(alice.turnDeadlineMs > 0L, alice.turnDeadlineMs.toString)
    assert(alice.turnSecondsRemaining > 0, alice.turnSecondsRemaining.toString)
    assert(alice.promptedPlayerIds.contains("p0"), alice.promptedPlayerIds.toString)
    // A non-empty talon keeps the bottom trump badge visible.
    assert(alice.talonCount > 0, alice.talonCount.toString)
    assertEquals(alice.bottomTrumpCard.map(_.suit), Some(Suit.Hearts))

    // Bob defends with six cards and two tens, a playable trump among them.
    val bob = view(manager, gameId, "p1")
    assertEquals(bob.myName, "Bob")
    assertEquals(bob.myHand.size, 6)
    assertEquals(bob.myHand.count(_.rank == Rank.Ten), 2)
    assert(bob.myHand.contains(Card(Suit.Hearts, Rank.Ten)), bob.myHand.toString)
    assertEquals(bob.throwInCards, Nil)
    assertEquals(bob.legalActions, List.empty)

    val carol = view(manager, gameId, "p2")
    assertEquals(carol.myName, "Carol")
    assertEquals(carol.myHand.size, 6)

    val state = assertConserved(manager, gameId, 36)
    assertEquals(state.players.map(_.hand.size).sum, 18)
    assertEquals(state.talon.size, 16)

    // Two of Alice's matching cards deploy in one throw-in.
    val jacks = List(Card(Suit.Diamonds, Rank.Jack), Card(Suit.Clubs, Rank.Jack))
    val (status, afterJson) = post(
      manager,
      s"/api/games/$gameId/action",
      Json.obj(
        "type" -> "throwInCards".asJson,
        "playerId" -> "p0".asJson,
        "cards" -> jacks.asJson
      )
    )
    assertEquals(status, Status.Ok, afterJson.noSpaces)
    val after = afterJson
      .as[PlayerGameView]
      .getOrElse(fail(s"invalid view body: ${afterJson.noSpaces}"))
    assertEquals(after.tablePairs.size, 3)
    assertEquals(after.tablePairs.map(_.attack).takeRight(2), jacks.toVector)
    assertEquals(after.myHand.size, 4)
  }

  test("qa-medium-14-expand starts a 14-card opening attack with all four tens") {
    val manager = newManager
    val (gameId, json) = startPreset(manager, "qa-medium-14-expand")

    assertEquals(json.hcursor.get[String]("defaultPlayerId").toOption, Some("p0"))
    assertEquals(
      json.hcursor.downField("players").as[List[Json]].map(_.size).toOption,
      Some(2)
    )

    val alice = view(manager, gameId, "p0")

    assertEquals(alice.myName, "Alice")
    // ITEM #5 Option B: a hand that must expand past the default six-card box.
    assertEquals(alice.myHand.size, 14)
    assertEquals(alice.myHand.count(_.rank == Rank.Ten), 4)
    Suit.values.foreach(suit =>
      assert(alice.myHand.contains(Card(suit, Rank.Ten)), s"missing 10$suit")
    )
    // Paired nines and jacks give the multi-select a second and third option.
    assertEquals(alice.myHand.count(_.rank == Rank.Nine), 2)
    assertEquals(alice.myHand.count(_.rank == Rank.Jack), 2)
    assertEquals(alice.boutPhase, BoutPhase.InitialAttack)
    assertEquals(alice.tablePairs, Vector.empty)
    assertEquals(alice.attackerIdx, 0)
    assertEquals(alice.defenderIdx, 1)
    assertEquals(alice.trumpSuit, Suit.Hearts)
    assertEquals(alice.legalActions, List("attack"))
    assertEquals(alice.throwInCards, Nil)
    assert(alice.turnDeadlineMs > 0L, alice.turnDeadlineMs.toString)
    assertEquals(alice.turnPlayerId, Some("p0"))
    assert(alice.talonCount > 0, alice.talonCount.toString)
    assertEquals(alice.bottomTrumpCard.map(_.suit), Some(Suit.Hearts))

    val bob = view(manager, gameId, "p1")
    assertEquals(bob.myHand.size, 6)
    assertEquals(bob.opponents.map(_.cardCount), List(14))

    val state = assertConserved(manager, gameId, 36)
    assertEquals(state.players.map(_.hand.size).sum, 20)
    assertEquals(state.talon.size, 16)

    // The opening attack is live: one of the tens goes down as an uncovered card.
    val (status, afterJson) = post(
      manager,
      s"/api/games/$gameId/action",
      Json.obj(
        "type" -> "initialAttack".asJson,
        "playerId" -> "p0".asJson,
        "cards" -> Json.arr(Card(Suit.Spades, Rank.Ten).asJson)
      )
    )
    assertEquals(status, Status.Ok, afterJson.noSpaces)
    val after = afterJson
      .as[PlayerGameView]
      .getOrElse(fail(s"invalid view body: ${afterJson.noSpaces}"))
    assertEquals(after.boutPhase, BoutPhase.Defense)
    assertEquals(after.tablePairs.size, 1)
    assertEquals(after.myHand.size, 13)
  }

  test("qa-large-30-compress starts a 30-card defending hand with surrender") {
    val manager = newManager
    val (gameId, json) = startPresetPath(manager, "qa-large-30-compress")

    assertEquals(json.hcursor.get[String]("defaultPlayerId").toOption, Some("p0"))
    assertEquals(
      json.hcursor.downField("players").as[List[Json]].map(_.size).toOption,
      Some(2)
    )

    val alice = view(manager, gameId, "p0")

    assertEquals(alice.myName, "Alice")
    assertEquals(alice.myHand.size, 30)
    assertEquals(alice.boutPhase, BoutPhase.Defense)
    assertEquals(alice.trumpSuit, Suit.Hearts)
    assertEquals(alice.attackerIdx, 1)
    assertEquals(alice.defenderIdx, 0)
    assertEquals(alice.tablePairs, Vector(TablePair(Card(Suit.Clubs, Rank.Nine))))
    // The turn clock is on the defending seat (ITEM #4).
    assertEquals(alice.turnPlayerId, Some("p0"))
    assert(alice.turnDeadlineMs > 0L, alice.turnDeadlineMs.toString)

    // All four tens sit in the defending hand next to playable and unplayable
    // cards, and the butt of the deck still shows a bottom trump.
    assertEquals(alice.myHand.count(_.rank == Rank.Ten), 4)
    assertEquals(alice.talonCount, 3)
    assertEquals(alice.bottomTrumpCard, Some(Card(Suit.Hearts, Rank.Six)))
    val attack = alice.tablePairs.head.attack
    assertEquals(alice.myHand.count(held => held.covers(attack, alice.trumpSuit)), 13)
    assertEquals(alice.myHand.count(held => !held.covers(attack, alice.trumpSuit)), 17)

    // ITEM #7: the lower-table Surrender button, next to Cover.
    assertEquals(alice.canThrowIn, false)
    assertEquals(alice.throwInCards, Nil)
    assert(alice.legalActions.contains("cover"), alice.legalActions.toString)
    assert(alice.legalActions.contains("surrender"), alice.legalActions.toString)
    assert(!alice.legalActions.contains("throwIn"), alice.legalActions.toString)

    val bob = view(manager, gameId, "p1")
    assertEquals(bob.myName, "Bob")
    assertEquals(
      bob.myHand,
      List(Card(Suit.Spades, Rank.Eight), Card(Suit.Spades, Rank.Nine))
    )
    assertEquals(bob.opponents.map(_.cardCount), List(30))

    val state = assertConserved(manager, gameId, 36)
    assertEquals(state.players.map(_.hand.size).sum, 32)
    assertEquals(state.tablePairs.size, 1)
    assertEquals(state.talon.size, 3)
    assertEquals(state.discardPile, Vector.empty)

    // A legal cover of the nine lands on the only uncovered attack.
    val (status, afterJson) = post(
      manager,
      s"/api/games/$gameId/action",
      Json.obj(
        "type" -> "coverCard".asJson,
        "playerId" -> "p0".asJson,
        "attackIndex" -> 0.asJson,
        "defenseCard" -> Card(Suit.Clubs, Rank.Ten).asJson
      )
    )
    assertEquals(status, Status.Ok, afterJson.noSpaces)
    val after = afterJson
      .as[PlayerGameView]
      .getOrElse(fail(s"invalid view body: ${afterJson.noSpaces}"))
    assertEquals(after.tablePairs.head.defense, Some(Card(Suit.Clubs, Rank.Ten)))
    assertEquals(after.myHand.size, 29)
  }

  test("qa-single-card starts a one-card hand for the no-part check") {
    val manager = newManager
    val (gameId, json) = startPreset(manager, "qa-single-card")

    assertEquals(json.hcursor.get[String]("defaultPlayerId").toOption, Some("p0"))

    val alice = view(manager, gameId, "p0")

    assertEquals(alice.myName, "Alice")
    // ITEM #6: exactly one card in hand, the `10♠`, so the fan never parts.
    assertEquals(alice.myHand, List(Card(Suit.Spades, Rank.Ten)))
    assertEquals(alice.myHand.size, 1)
    assertEquals(alice.opponents.map(_.id), List("p1"))
    assertEquals(alice.opponents.map(_.cardCount), List(2))
    assertEquals(alice.boutPhase, BoutPhase.InitialAttack)
    assertEquals(alice.attackerIdx, 0)
    assertEquals(alice.defenderIdx, 1)
    assertEquals(alice.trumpSuit, Suit.Hearts)
    assertEquals(alice.talonCount, 0)
    assertEquals(alice.bottomTrumpCard, None)
    assertEquals(alice.legalActions, List("attack"))
    assertEquals(alice.turnPlayerId, Some("p0"))
    assert(alice.turnDeadlineMs > 0L, alice.turnDeadlineMs.toString)

    val bob = view(manager, gameId, "p1")
    assertEquals(
      bob.myHand,
      List(Card(Suit.Hearts, Rank.Ace), Card(Suit.Diamonds, Rank.King))
    )

    // The whole unresolved deck sits in the discard pile, so 36 cards stay
    // distinct across hands and pile.
    assertEquals(alice.discardCount, 33)
    assertEquals(alice.lastDiscardCards, Vector.empty)
    val state = assertConserved(manager, gameId, 36)
    assertEquals(state.players.map(_.hand.size).sum, 3)
    assertEquals(state.talon, Vector.empty)

    // The single card still opens the bout.
    val (status, afterJson) = post(
      manager,
      s"/api/games/$gameId/action",
      Json.obj(
        "type" -> "initialAttack".asJson,
        "playerId" -> "p0".asJson,
        "cards" -> Json.arr(Card(Suit.Spades, Rank.Ten).asJson)
      )
    )
    assertEquals(status, Status.Ok, afterJson.noSpaces)
    val after = afterJson
      .as[PlayerGameView]
      .getOrElse(fail(s"invalid view body: ${afterJson.noSpaces}"))
    assertEquals(after.myHand, List.empty)
    assertEquals(after.tablePairs.map(_.attack), Vector(Card(Suit.Spades, Rank.Ten)))
    assertEquals(after.boutPhase, BoutPhase.Defense)
  }

  test("POST /api/games reads chaosMode and opens every seat as a target") {
    val manager = newManager

    val (status, json) = post(
      manager,
      "/api/games",
      Json.obj(
        "playerCount" -> 4.asJson,
        "playerNames" -> List("Alice", "Bob", "Carol", "Dave").asJson,
        "chaosMode" -> true.asJson
      )
    )
    assertEquals(status, Status.Ok)
    val gameId = json.hcursor
      .get[String]("gameId")
      .getOrElse(fail(s"missing gameId in ${json.noSpaces}"))

    val room = manager.getRoom(gameId).unsafeRunSync().getOrElse(fail("room is missing"))
    val view = PlayerGameView.forViewer(room.stateRef.get.unsafeRunSync(), room.playerIds.head)
    assertEquals(view.chaosMode, true)
    assertEquals(view.eligibleTargetIds.size, 3)
  }

  test("a client cannot submit a move for a bot seat") {
    val manager = newManager

    val (createStatus, createJson) = post(
      manager,
      "/api/games",
      Json.obj(
        "playerCount" -> 2.asJson,
        "playerNames" -> List("Bot", "Alice").asJson,
        "playerTypes" -> List("randomBot", "human").asJson
      )
    )
    assertEquals(createStatus, Status.Ok)
    val gameId = createJson.hcursor
      .get[String]("gameId")
      .getOrElse(fail(s"missing gameId in ${createJson.noSpaces}"))

    // The bot seat reports itself, exposes no legal actions and refuses input.
    val bot = view(manager, gameId, "p0")
    assertEquals(bot.isBot, true)
    assertEquals(bot.legalActions, List.empty)
    assertEquals(bot.playerTypes, Vector("randomBot", "human"))

    val (status, json) = post(
      manager,
      s"/api/games/$gameId/action",
      Json.obj(
        "type" -> "initialAttack".asJson,
        "playerId" -> "p0".asJson,
        "cards" -> Json.arr(bot.myHand.head.asJson)
      )
    )

    assertEquals(status, Status.BadRequest)
    assertEquals(
      json.hcursor.get[String]("error").toOption,
      Some(GameActor.BotSeatInputError)
    )

    // The human seat still plays normally.
    val human = view(manager, gameId, "p1")
    assert(!human.isBot)
  }
