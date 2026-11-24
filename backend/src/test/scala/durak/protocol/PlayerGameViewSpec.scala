package durak.protocol

import durak.engine.{BoutPhase, Card, GameConfig, GameState, PlayerState, Rank, Suit, TablePair}
import durak.engine.JsonCodecs.given
import io.circe.parser
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
      turnDeadlineEpochMs: Option[Long] = Some(90_000L)
  ): PlayerGameView =
    PlayerGameView.forViewer(
      gameId = gameId,
      config = config,
      seats = seats,
      state = state,
      viewerId = viewerId,
      connectedPlayerIds = connected,
      turnDeadlineEpochMs = turnDeadlineEpochMs
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

  test("interaction fields mirror the seated engine projection and stay empty for spectators") {
    val engine = durak.engine.PlayerGameView.forViewer(baseState, "alice")
    val view = viewFor("alice")

    assertEquals(view.legalActions, engine.legalActions.toVector)
    assertEquals(view.throwInCards, engine.throwInCards.toVector)
    assertEquals(view.throwInCapacity, engine.throwInCapacity)
    assertEquals(view.canThrowIn, engine.canThrowIn)
    assertEquals(view.defenderDefenseless, engine.defenderDefenseless)
    assertEquals(view.promptedPlayerIds, engine.promptedPlayerIds)
    assertEquals(view.eligibleTargetIds, engine.eligibleTargetIds)
    assertEquals(view.redirectTargetId, engine.redirectTargetId)
    assertEquals(view.lastDiscardCards, engine.lastDiscardCards)
    assertEquals(view.turnPlayerId, engine.turnPlayerId)

    // A spectator never receives a hand-derived interaction field.
    val spectator = viewFor("anonymous-spectator")
    assertEquals(spectator.legalActions, Vector.empty)
    assertEquals(spectator.throwInCards, Vector.empty)
    assertEquals(spectator.throwInCapacity, 0)
    assertEquals(spectator.canThrowIn, false)
    assertEquals(spectator.promptedPlayerIds, Vector.empty)
    assertEquals(spectator.eligibleTargetIds, Vector.empty)
  }

  test("the interaction fields round-trip through the wire codec") {
    val view = viewFor("alice")
    assertEquals(parser.decode[PlayerGameView](view.asJson.noSpaces), Right(view))
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
    assertEquals(view.phase, Some("defense"))
    assertEquals(view.attackerIdx, Some(0))
    assertEquals(view.defenderIdx, Some(1))
    assertEquals(view.maxBoutAttacks, 6)
    assertEquals(view.finishOrder, Vector.empty)
    assertEquals(view.isDraw, false)
    assertEquals(view.durakId, None)
    assertEquals(view.turnDeadlineEpochMs, Some(90_000L))
  }

  test("an idle turn clock is projected as no deadline") {
    assertEquals(viewFor("alice", baseState, turnDeadlineEpochMs = Some(0L)).turnDeadlineEpochMs, None)
    assertEquals(viewFor("alice", baseState, turnDeadlineEpochMs = None).turnDeadlineEpochMs, None)
  }

  test("a finished game is projected as Finished with no running clock") {
    val finished = baseState.copy(
      players = baseState.players.updated(1, baseState.players(1).copy(hand = Vector.empty)),
      boutPhase = BoutPhase.GameOver,
      finishOrder = Vector("bob", "alice")
    )
    val view = viewFor("alice", finished, turnDeadlineEpochMs = Some(123_456L))

    assertEquals(view.status, RoomStatus.Finished)
    assertEquals(view.phase, Some("gameOver"))
    assertEquals(view.turnDeadlineEpochMs, None)
    assertEquals(view.finishOrder, Vector("bob", "alice"))
    assertEquals(view.players.find(_.id == "bob").flatMap(_.finishRank), Some(1))
    // A seat that still holds cards is never projected as finished.
    assertEquals(view.players.find(_.id == "alice").flatMap(_.finishRank), None)
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
    assertEquals(view.phase, None)
    assertEquals(view.turnDeadlineEpochMs, None)
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
    // T-95-2: the most recent discard is face-up public table information,
    // which the shared M1 table renders. The pile itself and every opponent
    // hand stay absent.
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
