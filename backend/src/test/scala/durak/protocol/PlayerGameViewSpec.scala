package durak.protocol

import durak.engine.{BoutPhase, Card, GameConfig, GameState, PlayerState, Rank, Suit, TablePair}
import durak.engine.JsonCodecs.given
import io.circe.{parser, Json}
import io.circe.syntax.*
import ProtocolCodecs.given

class PlayerGameViewSpec extends munit.FunSuite:

  private def card(rank: Rank, suit: Suit): Card = Card(suit, rank)

  private val aliceHand = List(card(Rank.Six, Suit.Spades), card(Rank.Seven, Suit.Spades))
  private val bobHand =
    List(card(Rank.Eight, Suit.Spades), card(Rank.Nine, Suit.Spades), card(Rank.Ten, Suit.Spades))
  private val carolHand = List(card(Rank.Jack, Suit.Spades), card(Rank.Queen, Suit.Spades))
  private val daveHand = List(card(Rank.King, Suit.Spades))

  // Hidden talon order: only `bottomTrump` is public while the talon is non-empty.
  private val hiddenTalonCards = Vector(
    card(Rank.Three, Suit.Clubs),
    card(Rank.Four, Suit.Clubs),
    card(Rank.Five, Suit.Clubs)
  )
  private val bottomTrump = card(Rank.Six, Suit.Diamonds)

  private val gameId = "game-abc123"

  private val config = RoomConfigView(
    playerCount = 4,
    allowRedirect = true,
    turnTimeoutSeconds = 15,
    isPublic = true
  )

  private val seats = Vector(
    RoomSeatView(0, Some("alice"), Some("Alice")),
    RoomSeatView(1, Some("bob"), Some("Bob")),
    RoomSeatView(2, Some("carol"), Some("Carol")),
    RoomSeatView(3, Some("dave"), Some("Dave"))
  )

  private def baseState: GameState =
    GameState(
      config = GameConfig(playerCount = 4, seed = 7L),
      players = Vector(
        PlayerState("alice", "Alice", aliceHand.toVector),
        PlayerState("bob", "Bob", bobHand.toVector),
        PlayerState("carol", "Carol", carolHand.toVector),
        PlayerState("dave", "Dave", daveHand.toVector)
      ),
      talon = hiddenTalonCards :+ bottomTrump,
      trumpSuit = Suit.Diamonds,
      bottomTrumpCard = Some(bottomTrump),
      discardPile = Vector(card(Rank.Two, Suit.Clubs)),
      tablePairs =
        Vector(TablePair(card(Rank.Nine, Suit.Hearts), Some(card(Rank.Ten, Suit.Hearts)))),
      attackerIdx = 0,
      defenderIdx = 1,
      boutPhase = BoutPhase.Defense,
      defenderInitialHandSize = 6,
      finishOrder = Vector.empty
    )

  private def viewFor(
      viewerId: String,
      state: GameState = baseState,
      connected: Set[String] = Set("alice", "carol"),
      turnDeadlineMs: Option[Long] = Some(90_000L),
      nowMs: Long = 20_000L
  ): PlayerGameView =
    PlayerGameView.forViewer(
      gameId = gameId,
      config = config,
      seats = seats,
      state = state,
      viewerId = viewerId,
      connectedPlayerIds = connected,
      turnDeadlineMs = turnDeadlineMs,
      nowMs = nowMs
    )

  private def assertCardAbsent(encoded: String, secret: Card): Unit =
    assert(
      !encoded.contains(secret.asJson.noSpaces),
      s"payload leaked hidden card $secret: $encoded"
    )

  // --- Own hand & seat resolution (REQ-03) ---

  test("a seated viewer receives exactly their own hand and seat") {
    val view = viewFor("alice")

    assertEquals(view.gameId, gameId)
    assertEquals(view.viewerId, "alice")
    assertEquals(view.viewerSeat, Some(0))
    assertEquals(view.hand, aliceHand)
    assertEquals(view.status, RoomStatus.InProgress)
    assertEquals(view.config, config)
  }

  test("every seated viewer is projected with only their own cards") {
    List(
      "alice" -> aliceHand,
      "bob" -> bobHand,
      "carol" -> carolHand,
      "dave" -> daveHand
    ).foreach { case (playerId, expectedHand) =>
      val view = viewFor(playerId)

      assertEquals(view.viewerSeat, seats.find(_.playerId.contains(playerId)).map(_.seatIndex))
      assertEquals(view.hand, expectedHand)
    }
  }

  test("a spectator gets no seat and an empty hand") {
    val view = viewFor("anonymous-spectator")

    assertEquals(view.viewerSeat, None)
    assertEquals(view.hand, Nil)
    // Public counts remain visible to spectators.
    assertEquals(view.players.map(_.cardCount), Vector(2, 3, 2, 1))
  }

  test("seats and players carry public status only") {
    val view = viewFor("alice")

    assertEquals(view.players.map(_.id), Vector("alice", "bob", "carol", "dave"))
    assertEquals(view.players.map(_.name), Vector("Alice", "Bob", "Carol", "Dave"))
    assertEquals(view.players.map(_.seatIndex), Vector(0, 1, 2, 3))
    assertEquals(view.players.map(_.cardCount), Vector(2, 3, 2, 1))
    assertEquals(view.players.map(_.isConnected), Vector(true, false, true, false))
    assertEquals(view.seats.map(_.isConnected), Vector(true, false, true, false))
    assertEquals(view.players.map(_.rating), Vector(None, None, None, None))

    val keys = view.asJson.asObject.map(_.keys.toSet).getOrElse(fail("view must encode as object"))
    assert(!keys.contains("cards"), keys.toString)
    assert(!keys.contains("talon"), keys.toString)
    assert(!keys.contains("discardPile"), keys.toString)
  }

  // --- Anti-cheat serialization (REQ-03) ---

  test("the serialized view never contains an opponent's cards") {
    val encoded = viewFor("alice").asJson.noSpaces

    (bobHand ++ carolHand ++ daveHand).foreach(assertCardAbsent(encoded, _))
    // The viewer's own hand is the only hand in the payload.
    aliceHand.foreach { own =>
      assert(encoded.contains(own.asJson.noSpaces), s"own card $own missing: $encoded")
    }
  }

  test("the serialized spectator view contains no hand cards at all") {
    val encoded = viewFor("anonymous-spectator").asJson.noSpaces

    (aliceHand ++ bobHand ++ carolHand ++ daveHand).foreach(assertCardAbsent(encoded, _))
  }

  // --- Talon projection (REQ-04) ---

  test("the talon is a count, its hidden order never appears, and the bottom trump is public") {
    val view = viewFor("alice")
    val encoded = view.asJson.noSpaces

    assertEquals(view.talonCount, 4)
    assertEquals(view.bottomTrumpCard, Some(bottomTrump))
    assertEquals(view.trumpSuit, Some(Suit.Diamonds))
    hiddenTalonCards.foreach(assertCardAbsent(encoded, _))
    assert(
      encoded.contains(bottomTrump.asJson.noSpaces),
      s"public bottom trump missing: $encoded"
    )
  }

  test("an empty talon hides the bottom trump but keeps the trump suit") {
    val exhausted = baseState.copy(talon = Vector.empty, bottomTrumpCard = Some(bottomTrump))
    val view = viewFor("bob", exhausted)
    val encoded = view.asJson.noSpaces

    assertEquals(view.talonCount, 0)
    assertEquals(view.bottomTrumpCard, None)
    assertEquals(view.trumpSuit, Some(Suit.Diamonds))
    assertCardAbsent(encoded, bottomTrump)
  }

  // --- Public table & game metadata ---

  test("table, discard, phase and clock fields mirror the game state") {
    val view = viewFor("alice")

    assertEquals(view.tablePairs, baseState.tablePairs)
    assertEquals(view.discardCount, 1)
    assertEquals(view.boutPhase, Some("defense"))
    assertEquals(view.attackerIdx, Some(0))
    assertEquals(view.defenderIdx, Some(1))
    assertEquals(view.maxBoutAttacks, 6)
    assertEquals(view.finishOrder, Vector.empty)
    assertEquals(view.isDraw, false)
    assertEquals(view.durak, None)
    assertEquals(view.turnDeadlineMs, 90_000L)
  }

  test("an idle turn clock is projected as no deadline and no countdown") {
    val zero = viewFor("alice", baseState, turnDeadlineMs = Some(0L))
    assertEquals(zero.turnDeadlineMs, 0L)
    assertEquals(zero.turnSecondsRemaining, 0)

    val missing = viewFor("alice", baseState, turnDeadlineMs = None)
    assertEquals(missing.turnDeadlineMs, 0L)
    assertEquals(missing.turnSecondsRemaining, 0)
  }

  test("a finished game is projected as Finished with no running clock") {
    val finished = baseState.copy(
      players = baseState.players.updated(1, baseState.players(1).copy(hand = Vector.empty)),
      boutPhase = BoutPhase.GameOver,
      finishOrder = Vector("bob", "alice")
    )
    val view = viewFor("alice", finished, turnDeadlineMs = Some(123_456L))

    assertEquals(view.status, RoomStatus.Finished)
    assertEquals(view.boutPhase, Some("gameOver"))
    assertEquals(view.turnDeadlineMs, 0L)
    assertEquals(view.turnSecondsRemaining, 0)
    assertEquals(view.finishOrder, Vector("bob", "alice"))
    assertEquals(view.players.find(_.id == "bob").flatMap(_.finishRank), Some(1))
    // A seat that still holds cards is never projected as finished.
    assertEquals(view.players.find(_.id == "alice").flatMap(_.finishRank), None)
  }

  // --- Full M1 gameplay projection -----------------------------------------

  test("the viewer's own legal actions, clock and prompt fields mirror the engine") {
    val view = viewFor("alice")

    // Every card on the table is covered, so the attacker's only move is to pass.
    assertEquals(view.legalActions, List("pass"))
    assertEquals(view.turnPlayerId, Some("bob"))
    assertEquals(view.turnDeadlineMs, 90_000L)
    assertEquals(view.turnSecondsRemaining, 70)
    assertEquals(view.promptedPlayerIds, Vector("alice", "carol", "dave"))
    assertEquals(view.defenderDefenseless, false)
    assertEquals(view.players.map(_.isTurn), Vector(true, false, true, true))
    assertEquals(view.players.map(_.status).distinct, Vector(durak.engine.PlayerStatus.Active))
    assertEquals(view.myHasPassed, false)
    assertEquals(view.myFinishRank, None)
    assertEquals(view.myStatus, durak.engine.PlayerStatus.Active)
    assertEquals(view.winners, Nil)
  }

  test("throw-in eligibility is projected only for the viewer's own seat") {
    val throwInState = baseState.copy(
      players = baseState.players.updated(
        2,
        PlayerState(
          "carol",
          "Carol",
          Vector(card(Rank.Nine, Suit.Clubs), card(Rank.Jack, Suit.Spades))
        )
      )
    )

    val carol = viewFor("carol", throwInState)
    assertEquals(carol.throwInCards, List(card(Rank.Nine, Suit.Clubs)))
    assertEquals(carol.throwInCapacity, 1)
    assertEquals(carol.canThrowIn, true)
    assert(carol.legalActions.contains("throwIn"), carol.legalActions.toString)

    // A seat with no matching rank gets nothing to throw in.
    val alice = viewFor("alice", throwInState)
    assertEquals(alice.throwInCards, Nil)
    assertEquals(alice.throwInCapacity, 0)
    assertEquals(alice.canThrowIn, false)

    // The defender can never throw in.
    val bob = viewFor("bob", throwInState)
    assertEquals(bob.throwInCards, Nil)
    assertEquals(bob.canThrowIn, false)

    // A spectator receives none of the viewer-scoped action metadata.
    val spectator = viewFor("anonymous-spectator", throwInState)
    assertEquals(spectator.hand, Nil)
    assertEquals(spectator.legalActions, Nil)
    assertEquals(spectator.throwInCards, Nil)
    assertEquals(spectator.throwInCapacity, 0)
    assertEquals(spectator.canThrowIn, false)
    assertEquals(spectator.eligibleTargetIds, Vector.empty)
    assertEquals(spectator.redirectTargetId, None)
    assertEquals(spectator.myStatus, "")
  }

  test("opening-attack targets and redirect target are public to seated viewers only") {
    val opening = baseState.copy(boutPhase = BoutPhase.InitialAttack, tablePairs = Vector.empty)
    assertEquals(viewFor("alice", opening).eligibleTargetIds, Vector("bob"))
    assertEquals(viewFor("anonymous-spectator", opening).eligibleTargetIds, Vector.empty)

    // The standard-game reflect lands on the next clockwise seat (Carol).
    assertEquals(viewFor("alice").redirectTargetId, Some("carol"))
    assertEquals(viewFor("anonymous-spectator").redirectTargetId, None)
  }

  test("a defenseless defender projects only surrender and the defender prompt") {
    val helpless = baseState.copy(
      config = GameConfig(playerCount = 4, seed = 7L, allowRedirect = false),
      players = baseState.players.updated(
        1,
        PlayerState("bob", "Bob", Vector(card(Rank.Two, Suit.Clubs)))
      ),
      tablePairs = Vector(TablePair(card(Rank.Ace, Suit.Hearts)))
    )

    val bob = viewFor("bob", helpless)
    assertEquals(bob.defenderDefenseless, true)
    assertEquals(bob.legalActions, List("surrender"))
    assertEquals(bob.turnPlayerId, Some("bob"))
    assertEquals(bob.promptedPlayerIds, Vector("bob"))
  }

  test("a finished match projects winners, durak and frozen game clocks") {
    val finished = baseState.copy(
      players = baseState.players.zipWithIndex.map { case (player, idx) =>
        if idx == 1 then player else player.copy(hand = Vector.empty)
      },
      boutPhase = BoutPhase.GameOver,
      finishOrder = Vector("alice", "carol", "dave", "bob"),
      gameStartedAtMs = Some(1_000L),
      gameEndedAtMs = Some(5_000L)
    )

    val view = viewFor("alice", finished, turnDeadlineMs = Some(123_456L))

    assertEquals(view.status, RoomStatus.Finished)
    assertEquals(view.winners, List("alice", "carol", "dave"))
    assertEquals(view.durak, Some("bob"))
    assertEquals(view.legalActions, Nil)
    assertEquals(view.turnPlayerId, None)
    assertEquals(view.turnDeadlineMs, 0L)
    assertEquals(view.turnSecondsRemaining, 0)
    assertEquals(view.promptedPlayerIds, Vector.empty)
    assertEquals(view.players.map(_.isTurn).distinct, Vector(false))
    assertEquals(view.gameStartedAtMs, Some(1_000L))
    assertEquals(view.gameEndedAtMs, Some(5_000L))
    assertEquals(view.myFinishRank, Some(1))
    // The last seat still holding cards is the Durak and is never ranked.
    assertEquals(view.players.find(_.id == "bob").flatMap(_.finishRank), None)
  }

  test("discard history is public and the viewer's own pass/status are projected") {
    val passed = baseState.copy(
      players = baseState.players.updated(0, baseState.players(0).copy(hasPassed = true)),
      discardPile = Vector(card(Rank.Two, Suit.Clubs), card(Rank.Three, Suit.Hearts)),
      lastDiscardCards = Vector(card(Rank.Three, Suit.Hearts))
    )

    val view = viewFor("alice", passed)
    assertEquals(view.discardCount, 2)
    assertEquals(view.lastDiscardCards, Vector(card(Rank.Three, Suit.Hearts)))
    assertEquals(view.myHasPassed, true)
    assertEquals(view.players.find(_.id == "alice").map(_.hasPassed), Some(true))
  }

  test("the enriched payload round-trips through JSON without exposing hidden cards") {
    val throwInState = baseState.copy(
      players = baseState.players.updated(
        2,
        PlayerState(
          "carol",
          "Carol",
          Vector(card(Rank.Nine, Suit.Clubs), card(Rank.Jack, Suit.Spades))
        )
      )
    )
    val carol = viewFor("carol", throwInState)
    val view = carol
    val json = view.asJson

    assertEquals(parser.decode[PlayerGameView](json.noSpaces), Right(view))

    val viewKeys = json.asObject.map(_.keys.toSet).getOrElse(fail("view must encode as object"))
    List(
      "boutPhase",
      "legalActions",
      "winners",
      "durak",
      "turnPlayerId",
      "turnDeadlineMs",
      "turnSecondsRemaining",
      "defenderDefenseless",
      "promptedPlayerIds",
      "discardCount",
      "lastDiscardCards",
      "gameStartedAtMs",
      "gameEndedAtMs",
      "eligibleTargetIds",
      "redirectTargetId",
      "throwInCards",
      "throwInCapacity",
      "canThrowIn",
      "myHasPassed",
      "myFinishRank",
      "myStatus"
    ).foreach(key => assert(viewKeys.contains(key), s"missing $key: $viewKeys"))

    val encoded = json.noSpaces
    (aliceHand ++ bobHand ++ daveHand).foreach(assertCardAbsent(encoded, _))
    hiddenTalonCards.foreach(assertCardAbsent(encoded, _))
    // The only cards in the payload are the viewer's own hand and the cards it
    // may legally throw in, so every throw-in card is one of its own.
    assert(carol.throwInCards.forall(view.hand.contains), carol.throwInCards.toString)
  }

  test("a legacy payload decodes with the M1 fields defaulted or renamed") {
    val legacy = Json
      .obj(
        "gameId" -> Json.fromString(gameId),
        "status" -> Json.fromString("inProgress"),
        "config" -> Json.obj(
          "playerCount" -> Json.fromInt(4),
          "allowRedirect" -> Json.True,
          "turnTimeoutSeconds" -> Json.fromInt(15),
          "isPublic" -> Json.True
        ),
        "viewerId" -> Json.fromString("alice"),
        "viewerSeat" -> Json.fromInt(0),
        "hand" -> aliceHand.asJson,
        "players" -> Json.arr(),
        "seats" -> Json.arr(),
        "tablePairs" -> Json.arr(),
        "talonCount" -> Json.fromInt(0),
        "bottomTrumpCard" -> Json.Null,
        "trumpSuit" -> Json.fromString("diamonds"),
        "phase" -> Json.fromString("defense"),
        "attackerIdx" -> Json.fromInt(0),
        "defenderIdx" -> Json.fromInt(1),
        "maxBoutAttacks" -> Json.fromInt(6),
        "finishOrder" -> Json.arr(),
        "isDraw" -> Json.False,
        "durakId" -> Json.Null,
        "turnDeadlineEpochMs" -> Json.fromLong(90_000L)
      )

    val decoded = parser.decode[PlayerGameView](legacy.noSpaces)
    assert(decoded.isRight, decoded.toString)
    val view = decoded.toOption.get
    assertEquals(view.boutPhase, Some("defense"))
    assertEquals(view.durak, None)
    assertEquals(view.turnDeadlineMs, 90_000L)
    assertEquals(view.legalActions, Nil)
    assertEquals(view.throwInCards, Nil)
    assertEquals(view.canThrowIn, false)
  }

  // --- Waiting room ---

  test("a waiting room has no cards, no talon and populated seats") {
    val view = PlayerGameView.forWaitingRoom(
      gameId = gameId,
      config = config,
      seats = seats,
      viewerId = "bob",
      connectedPlayerIds = Set("bob")
    )

    assertEquals(view.status, RoomStatus.WaitingForPlayers)
    assertEquals(view.viewerSeat, Some(1))
    assertEquals(view.hand, Nil)
    assertEquals(view.seats.size, 4)
    assertEquals(view.seats.map(_.isConnected), Vector(false, true, false, false))
    assertEquals(view.players.map(_.id), Vector("alice", "bob", "carol", "dave"))
    assertEquals(view.players.map(_.cardCount), Vector(0, 0, 0, 0))
    assertEquals(view.talonCount, 0)
    assertEquals(view.bottomTrumpCard, None)
    assertEquals(view.trumpSuit, None)
    assertEquals(view.boutPhase, None)
    assertEquals(view.turnDeadlineMs, 0L)
    assertEquals(view.legalActions, Nil)
    assertEquals(view.throwInCards, Nil)
    assertEquals(view.canThrowIn, false)
    assertEquals(view.eligibleTargetIds, Vector.empty)
    assertEquals(view.redirectTargetId, None)
    assertEquals(view.winners, Nil)
    assertEquals(view.durak, None)
    assertEquals(view.promptedPlayerIds, Vector.empty)
  }

  test("a waiting-room spectator gets no seat and no hand") {
    val view = PlayerGameView.forWaitingRoom(gameId, config, seats, "ghost")

    assertEquals(view.viewerSeat, None)
    assertEquals(view.hand, Nil)
  }

  // --- Client -> server frames ---

  private val clientMessages = List(
    WsClientMessage.PlayAttack(List(card(Rank.Six, Suit.Spades))),
    WsClientMessage.CoverCard(1, card(Rank.Ace, Suit.Diamonds)),
    WsClientMessage.RedirectAttack(List(card(Rank.Six, Suit.Clubs))),
    WsClientMessage.ThrowInCards(
      List(card(Rank.Seven, Suit.Hearts), card(Rank.Seven, Suit.Diamonds))
    ),
    WsClientMessage.DeclareSurrender,
    WsClientMessage.PassTurn,
    WsClientMessage.Ping
  )

  test("every client message round-trips with a type discriminator") {
    clientMessages.foreach { message =>
      val json = message.asJson
      val discriminator = json.asObject.flatMap(_("type")).flatMap(_.asString)

      assert(discriminator.nonEmpty, s"missing type discriminator: ${json.noSpaces}")
      assertEquals(parser.decode[WsClientMessage](json.noSpaces), Right(message))
    }
  }

  test("client messages use the documented discriminators") {
    val expected = List(
      WsClientMessage.PlayAttack(Nil) -> "playAttack",
      WsClientMessage.CoverCard(0, card(Rank.Six, Suit.Spades)) -> "coverCard",
      WsClientMessage.RedirectAttack(Nil) -> "redirectAttack",
      WsClientMessage.ThrowInCards(Nil) -> "throwInCards",
      WsClientMessage.DeclareSurrender -> "declareSurrender",
      WsClientMessage.PassTurn -> "passTurn",
      WsClientMessage.Ping -> "ping"
    )

    expected.foreach { case (message, discriminator) =>
      assertEquals(
        message.asJson.asObject.flatMap(_("type")).flatMap(_.asString),
        Some(discriminator)
      )
    }
  }

  test("unknown and malformed client payloads are rejected") {
    assert(parser.decode[WsClientMessage]("""{"type":"teleport"}""").isLeft)
    assert(parser.decode[WsClientMessage]("""{"type":"coverCard"}""").isLeft)
    assert(parser.decode[WsClientMessage]("""{"cards":[]}""").isLeft)
  }

  // --- Server -> client frames ---

  private val lobbyRooms = List(
    LobbyRoomSummary(
      gameId = "g1",
      hostName = "Alice",
      playerCount = 2,
      filledSeats = 1,
      allowRedirect = true,
      turnTimeoutSeconds = 15,
      createdAtEpochMs = 1_000L,
      isQuickPair = false
    ),
    LobbyRoomSummary(
      gameId = "g2",
      hostName = "Bob",
      playerCount = 4,
      filledSeats = 4,
      allowRedirect = false,
      turnTimeoutSeconds = 30,
      createdAtEpochMs = 2_000L,
      isQuickPair = true
    )
  )

  private def serverMessages: List[WsServerMessage] =
    List(
      WsServerMessage.GameViewUpdate(viewFor("alice")),
      WsServerMessage.ActionRejected("ILLEGAL_MOVE", "not your turn"),
      WsServerMessage.LobbySnapshot(lobbyRooms),
      WsServerMessage.LobbyUpdated(lobbyRooms),
      WsServerMessage.MatchFound("g1"),
      WsServerMessage.Pong
    )

  test("every server message round-trips with a type discriminator") {
    serverMessages.foreach { message =>
      val json = message.asJson

      assert(
        json.asObject.flatMap(_("type")).flatMap(_.asString).nonEmpty,
        s"missing type discriminator: ${json.noSpaces}"
      )
      assertEquals(parser.decode[WsServerMessage](json.noSpaces), Right(message))
    }
  }

  test("server messages use the documented discriminators") {
    val expected = List(
      WsServerMessage.GameViewUpdate(viewFor("alice")) -> "gameViewUpdate",
      WsServerMessage.ActionRejected("UNAUTHORIZED", "spectator") -> "actionRejected",
      WsServerMessage.LobbySnapshot(Nil) -> "lobbySnapshot",
      WsServerMessage.LobbyUpdated(Nil) -> "lobbyUpdated",
      WsServerMessage.MatchFound("g1") -> "matchFound",
      WsServerMessage.Pong -> "pong"
    )

    expected.foreach { case (message, discriminator) =>
      assertEquals(
        message.asJson.asObject.flatMap(_("type")).flatMap(_.asString),
        Some(discriminator)
      )
    }
  }

  test("a game-view update exposes no raw GameState and no opponent cards") {
    val frame = (WsServerMessage.GameViewUpdate(viewFor("alice")): WsServerMessage).asJson
    val encoded = frame.noSpaces
    val topLevelKeys = frame.asObject.map(_.keys.toSet).getOrElse(fail("frame must be an object"))
    val viewKeys = frame.hcursor
      .downField("view")
      .focus
      .flatMap(_.asObject)
      .map(_.keys.toSet)
      .getOrElse(fail("frame must embed a view object"))

    assertEquals(topLevelKeys, Set("type", "view"))
    assert(!viewKeys.contains("talon"), viewKeys.toString)
    assert(!viewKeys.contains("discardPile"), viewKeys.toString)
    // The most recent discard is required public M1 metadata; the older
    // discards stay hidden behind `discardCount` only.
    assert(viewKeys.contains("lastDiscardCards"), viewKeys.toString)
    assert(!viewKeys.contains("players.cardLists"), viewKeys.toString)

    (bobHand ++ carolHand ++ daveHand).foreach(assertCardAbsent(encoded, _))
    hiddenTalonCards.foreach(assertCardAbsent(encoded, _))
  }

  test("a raw GameState payload cannot be decoded as a server message") {
    val raw = baseState.asJson.noSpaces
    val forged = s"""{"type":"gameState","state":$raw}"""

    assert(parser.decode[WsServerMessage](forged).isLeft)
    assert(!raw.isEmpty)
  }
