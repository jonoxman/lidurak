package durak.protocol

import durak.engine.JsonCodecs.given
import durak.engine.{Card, PlayerStatus}
import io.circe.{Decoder, DecodingFailure, Encoder, Json}
import io.circe.syntax.*

/**
 * Circe codecs for the multiplayer protocol.
 *
 * Every type is mapped by hand so the emitted field names and order stay a
 * stable wire contract, and so a raw `GameState` can never sneak into a server
 * frame: there is simply no encoder for it here, and no server message holds
 * one.
 */
object ProtocolCodecs:

  // --- Room enums & configuration ---

  given Encoder[RoomStatus] =
    Encoder.encodeString.contramap(RoomStatus.wireName)

  given Decoder[RoomStatus] = Decoder.decodeString.emap { raw =>
    RoomStatus
      .fromWire(raw)
      .toRight(s"Unknown room status: $raw")
  }

  given Encoder[RoomConfigView] = Encoder.instance { config =>
    Json.obj(
      "playerCount" -> config.playerCount.asJson,
      "allowRedirect" -> config.allowRedirect.asJson,
      "turnTimeoutSeconds" -> config.turnTimeoutSeconds.asJson,
      "isPublic" -> config.isPublic.asJson,
      "deckSize" -> config.deckSize.asJson
    )
  }

  given Decoder[RoomConfigView] = Decoder.instance { cursor =>
    for
      playerCount <- cursor.downField("playerCount").as[Int]
      allowRedirect <- cursor
        .downField("allowRedirect")
        .as[Option[Boolean]]
        .map(_.getOrElse(true))
      turnTimeoutSeconds <- cursor
        .downField("turnTimeoutSeconds")
        .as[Option[Int]]
        .map(_.getOrElse(15))
      isPublic <- cursor
        .downField("isPublic")
        .as[Option[Boolean]]
        .map(_.getOrElse(true))
      // An older payload omits the deck setting; the player count then decides.
      deckSize <- cursor
        .downField("deckSize")
        .as[Option[Int]]
        .map(_.getOrElse(if playerCount == 4 then 52 else 36))
    yield RoomConfigView(playerCount, allowRedirect, turnTimeoutSeconds, isPublic, deckSize)
  }

  // --- Static room views ---

  given Encoder[PublicPlayerSummary] = Encoder.instance { player =>
    Json.obj(
      "id" -> player.id.asJson,
      "name" -> player.name.asJson,
      "rating" -> player.rating.asJson,
      "cardCount" -> player.cardCount.asJson,
      "isConnected" -> player.isConnected.asJson,
      "hasPassed" -> player.hasPassed.asJson,
      "finishRank" -> player.finishRank.asJson,
      "seatIndex" -> player.seatIndex.asJson,
      "status" -> player.status.asJson,
      "isTurn" -> player.isTurn.asJson
    )
  }

  given Decoder[PublicPlayerSummary] = Decoder.instance { cursor =>
    for
      id <- cursor.downField("id").as[String]
      name <- cursor.downField("name").as[String]
      rating <- cursor.downField("rating").as[Option[Int]]
      cardCount <- cursor.downField("cardCount").as[Int]
      isConnected <- cursor
        .downField("isConnected")
        .as[Option[Boolean]]
        .map(_.getOrElse(false))
      hasPassed <- cursor
        .downField("hasPassed")
        .as[Option[Boolean]]
        .map(_.getOrElse(false))
      finishRank <- cursor.downField("finishRank").as[Option[Int]]
      seatIndex <- cursor.downField("seatIndex").as[Int]
      // Optional additions: an older payload omits the public status and the
      // turn flag, which then decode to an active seat that is not on the clock.
      status <- cursor
        .downField("status")
        .as[Option[String]]
        .map(_.getOrElse(PlayerStatus.Active))
      isTurn <- cursor.downField("isTurn").as[Option[Boolean]].map(_.getOrElse(false))
    yield PublicPlayerSummary(
      id = id,
      name = name,
      rating = rating,
      cardCount = cardCount,
      isConnected = isConnected,
      hasPassed = hasPassed,
      finishRank = finishRank,
      seatIndex = seatIndex,
      status = status,
      isTurn = isTurn
    )
  }

  given Encoder[RoomSeatView] = Encoder.instance { seat =>
    Json.obj(
      "seatIndex" -> seat.seatIndex.asJson,
      "playerId" -> seat.playerId.asJson,
      "displayName" -> seat.displayName.asJson,
      "isConnected" -> seat.isConnected.asJson
    )
  }

  given Decoder[RoomSeatView] = Decoder.instance { cursor =>
    for
      seatIndex <- cursor.downField("seatIndex").as[Int]
      playerId <- cursor.downField("playerId").as[Option[String]]
      displayName <- cursor.downField("displayName").as[Option[String]]
      isConnected <- cursor
        .downField("isConnected")
        .as[Option[Boolean]]
        .map(_.getOrElse(false))
    yield RoomSeatView(seatIndex, playerId, displayName, isConnected)
  }

  given Encoder[PlayerGameView] = Encoder.instance { view =>
    Json.obj(
      "gameId" -> view.gameId.asJson,
      "status" -> view.status.asJson,
      "config" -> view.config.asJson,
      "viewerId" -> view.viewerId.asJson,
      "viewerSeat" -> view.viewerSeat.asJson,
      "hand" -> view.hand.asJson,
      "players" -> view.players.asJson,
      "seats" -> view.seats.asJson,
      "tablePairs" -> view.tablePairs.asJson,
      "talonCount" -> view.talonCount.asJson,
      "bottomTrumpCard" -> view.bottomTrumpCard.asJson,
      "trumpSuit" -> view.trumpSuit.asJson,
      "attackerIdx" -> view.attackerIdx.asJson,
      "defenderIdx" -> view.defenderIdx.asJson,
      "boutPhase" -> view.boutPhase.asJson,
      "maxBoutAttacks" -> view.maxBoutAttacks.asJson,
      "legalActions" -> view.legalActions.asJson,
      "finishOrder" -> view.finishOrder.asJson,
      "isDraw" -> view.isDraw.asJson,
      "winners" -> view.winners.asJson,
      "durak" -> view.durak.asJson,
      "turnPlayerId" -> view.turnPlayerId.asJson,
      "turnDeadlineMs" -> view.turnDeadlineMs.asJson,
      "turnSecondsRemaining" -> view.turnSecondsRemaining.asJson,
      "defenderDefenseless" -> view.defenderDefenseless.asJson,
      "promptedPlayerIds" -> view.promptedPlayerIds.asJson,
      "discardCount" -> view.discardCount.asJson,
      "lastDiscardCards" -> view.lastDiscardCards.asJson,
      "gameStartedAtMs" -> view.gameStartedAtMs.asJson,
      "gameEndedAtMs" -> view.gameEndedAtMs.asJson,
      "eligibleTargetIds" -> view.eligibleTargetIds.asJson,
      "redirectTargetId" -> view.redirectTargetId.asJson,
      "throwInCards" -> view.throwInCards.asJson,
      "throwInCapacity" -> view.throwInCapacity.asJson,
      "canThrowIn" -> view.canThrowIn.asJson,
      "myHasPassed" -> view.myHasPassed.asJson,
      "myFinishRank" -> view.myFinishRank.asJson,
      "myStatus" -> view.myStatus.asJson
    )
  }

  given Decoder[PlayerGameView] = Decoder.instance { cursor =>
    for
      gameId <- cursor.downField("gameId").as[String]
      status <- cursor.downField("status").as[RoomStatus]
      config <- cursor.downField("config").as[RoomConfigView]
      viewerId <- cursor.downField("viewerId").as[String]
      viewerSeat <- cursor.downField("viewerSeat").as[Option[Int]]
      hand <- cursor.downField("hand").as[List[Card]]
      players <- cursor.downField("players").as[Vector[PublicPlayerSummary]]
      seats <- cursor.downField("seats").as[Vector[RoomSeatView]]
      tablePairs <- cursor.downField("tablePairs").as[Vector[durak.engine.TablePair]]
      talonCount <- cursor.downField("talonCount").as[Int]
      bottomTrumpCard <- cursor.downField("bottomTrumpCard").as[Option[Card]]
      trumpSuit <- cursor.downField("trumpSuit").as[Option[durak.engine.Suit]]
      attackerIdx <- cursor.downField("attackerIdx").as[Option[Int]]
      defenderIdx <- cursor.downField("defenderIdx").as[Option[Int]]
      // `boutPhase` is the M1 wire name; an older payload calls it `phase`.
      boutPhase <- cursor
        .downField("boutPhase")
        .as[Option[String]]
        .flatMap {
          case some @ Some(_) => Right(some)
          case None           => cursor.downField("phase").as[Option[String]]
        }
      maxBoutAttacks <- cursor.downField("maxBoutAttacks").as[Int]
      legalActions <- cursor
        .downField("legalActions")
        .as[Option[List[String]]]
        .map(_.getOrElse(Nil))
      finishOrder <- cursor.downField("finishOrder").as[Vector[String]]
      isDraw <- cursor.downField("isDraw").as[Boolean]
      winners <- cursor
        .downField("winners")
        .as[Option[List[String]]]
        .map(_.getOrElse(Nil))
      // `durak` is the M1 wire name; an older payload calls it `durakId`.
      durak <- cursor
        .downField("durak")
        .as[Option[String]]
        .flatMap {
          case some @ Some(_) => Right(some)
          case None           => cursor.downField("durakId").as[Option[String]]
        }
      turnPlayerId <- cursor.downField("turnPlayerId").as[Option[String]]
      // `turnDeadlineMs` is the M1 wire name; `turnDeadlineEpochMs` is the
      // legacy M2 name for the same absolute deadline.
      turnDeadlineMs <- cursor
        .downField("turnDeadlineMs")
        .as[Option[Long]]
        .flatMap {
          case some @ Some(_) => Right(some)
          case None           => cursor.downField("turnDeadlineEpochMs").as[Option[Long]]
        }
        .map(_.getOrElse(0L))
      turnSecondsRemaining <- cursor
        .downField("turnSecondsRemaining")
        .as[Option[Int]]
        .map(_.getOrElse(0))
      defenderDefenseless <- cursor
        .downField("defenderDefenseless")
        .as[Option[Boolean]]
        .map(_.getOrElse(false))
      promptedPlayerIds <- cursor
        .downField("promptedPlayerIds")
        .as[Option[Vector[String]]]
        .map(_.getOrElse(Vector.empty))
      discardCount <- cursor
        .downField("discardCount")
        .as[Option[Int]]
        .map(_.getOrElse(0))
      lastDiscardCards <- cursor
        .downField("lastDiscardCards")
        .as[Option[Vector[Card]]]
        .map(_.getOrElse(Vector.empty))
      gameStartedAtMs <- cursor.downField("gameStartedAtMs").as[Option[Long]]
      gameEndedAtMs <- cursor.downField("gameEndedAtMs").as[Option[Long]]
      eligibleTargetIds <- cursor
        .downField("eligibleTargetIds")
        .as[Option[Vector[String]]]
        .map(_.getOrElse(Vector.empty))
      redirectTargetId <- cursor.downField("redirectTargetId").as[Option[String]]
      throwInCards <- cursor
        .downField("throwInCards")
        .as[Option[List[Card]]]
        .map(_.getOrElse(Nil))
      throwInCapacity <- cursor
        .downField("throwInCapacity")
        .as[Option[Int]]
        .map(_.getOrElse(0))
      canThrowIn <- cursor
        .downField("canThrowIn")
        .as[Option[Boolean]]
        .map(_.getOrElse(false))
      myHasPassed <- cursor
        .downField("myHasPassed")
        .as[Option[Boolean]]
        .map(_.getOrElse(false))
      myFinishRank <- cursor.downField("myFinishRank").as[Option[Int]]
      myStatus <- cursor
        .downField("myStatus")
        .as[Option[String]]
        .map(_.getOrElse(PlayerStatus.Active))
    yield PlayerGameView(
      gameId = gameId,
      status = status,
      config = config,
      viewerId = viewerId,
      viewerSeat = viewerSeat,
      hand = hand,
      players = players,
      seats = seats,
      tablePairs = tablePairs,
      talonCount = talonCount,
      bottomTrumpCard = bottomTrumpCard,
      trumpSuit = trumpSuit,
      attackerIdx = attackerIdx,
      defenderIdx = defenderIdx,
      boutPhase = boutPhase,
      maxBoutAttacks = maxBoutAttacks,
      legalActions = legalActions,
      finishOrder = finishOrder,
      isDraw = isDraw,
      winners = winners,
      durak = durak,
      turnPlayerId = turnPlayerId,
      turnDeadlineMs = turnDeadlineMs,
      turnSecondsRemaining = turnSecondsRemaining,
      defenderDefenseless = defenderDefenseless,
      promptedPlayerIds = promptedPlayerIds,
      discardCount = discardCount,
      lastDiscardCards = lastDiscardCards,
      gameStartedAtMs = gameStartedAtMs,
      gameEndedAtMs = gameEndedAtMs,
      eligibleTargetIds = eligibleTargetIds,
      redirectTargetId = redirectTargetId,
      throwInCards = throwInCards,
      throwInCapacity = throwInCapacity,
      canThrowIn = canThrowIn,
      myHasPassed = myHasPassed,
      myFinishRank = myFinishRank,
      myStatus = myStatus
    )
  }

  // --- Lobby summaries ---

  given Encoder[LobbyRoomSummary] = Encoder.instance { room =>
    Json.obj(
      "gameId" -> room.gameId.asJson,
      "hostName" -> room.hostName.asJson,
      "playerCount" -> room.playerCount.asJson,
      "filledSeats" -> room.filledSeats.asJson,
      "allowRedirect" -> room.allowRedirect.asJson,
      "turnTimeoutSeconds" -> room.turnTimeoutSeconds.asJson,
      "createdAtEpochMs" -> room.createdAtEpochMs.asJson,
      "isQuickPair" -> room.isQuickPair.asJson,
      "deckSize" -> room.deckSize.asJson
    )
  }

  given Decoder[LobbyRoomSummary] = Decoder.instance { cursor =>
    for
      gameId <- cursor.downField("gameId").as[String]
      hostName <- cursor.downField("hostName").as[String]
      playerCount <- cursor.downField("playerCount").as[Int]
      filledSeats <- cursor.downField("filledSeats").as[Int]
      allowRedirect <- cursor.downField("allowRedirect").as[Boolean]
      turnTimeoutSeconds <- cursor.downField("turnTimeoutSeconds").as[Int]
      createdAtEpochMs <- cursor.downField("createdAtEpochMs").as[Long]
      isQuickPair <- cursor.downField("isQuickPair").as[Boolean]
      // A payload from before the deck setting falls back to the player-count
      // default: 52 cards for four players, 36 otherwise.
      deckSize <- cursor
        .downField("deckSize")
        .as[Option[Int]]
        .map(_.getOrElse(if playerCount == 4 then 52 else 36))
    yield LobbyRoomSummary(
      gameId = gameId,
      hostName = hostName,
      playerCount = playerCount,
      filledSeats = filledSeats,
      allowRedirect = allowRedirect,
      turnTimeoutSeconds = turnTimeoutSeconds,
      createdAtEpochMs = createdAtEpochMs,
      isQuickPair = isQuickPair,
      deckSize = deckSize
    )
  }

  // --- Quick-pair responses ---

  given Encoder[QuickPairResponse] = Encoder.instance {
    case QuickPairResponse.Searching(
          playerCount,
          turnTimeoutSeconds,
          allowRedirect,
          queuedCount,
          requiredCount
        ) =>
      Json.obj(
        "status" -> Json.fromString("searching"),
        "playerCount" -> playerCount.asJson,
        "turnTimeoutSeconds" -> turnTimeoutSeconds.asJson,
        "allowRedirect" -> allowRedirect.asJson,
        "queuedCount" -> queuedCount.asJson,
        "requiredCount" -> requiredCount.asJson
      )
    case QuickPairResponse.Matched(gameId, seatIndex) =>
      Json.obj(
        "status" -> Json.fromString("matched"),
        "gameId" -> gameId.asJson,
        "seatIndex" -> seatIndex.asJson
      )
  }

  given Decoder[QuickPairResponse] = Decoder.instance { cursor =>
    cursor.downField("status").as[String].flatMap { raw =>
      raw.trim.toLowerCase match
        case "searching" =>
          for
            playerCount <- cursor.downField("playerCount").as[Int]
            turnTimeoutSeconds <- cursor.downField("turnTimeoutSeconds").as[Int]
            allowRedirect <- cursor.downField("allowRedirect").as[Boolean]
            queuedCount <- cursor.downField("queuedCount").as[Int]
            requiredCount <- cursor.downField("requiredCount").as[Int]
          yield QuickPairResponse.Searching(
            playerCount,
            turnTimeoutSeconds,
            allowRedirect,
            queuedCount,
            requiredCount
          )
        case "matched" =>
          for
            gameId <- cursor.downField("gameId").as[String]
            seatIndex <- cursor.downField("seatIndex").as[Int]
          yield QuickPairResponse.Matched(gameId, seatIndex)
        case _ =>
          Left(DecodingFailure(s"Unknown quick-pair status: $raw", cursor.history))
    }
  }

  // --- Client -> server frames ---

  given Encoder[WsClientMessage] = Encoder.instance {
    case WsClientMessage.PlayAttack(cards) =>
      Json.obj(
        "type" -> Json.fromString("playAttack"),
        "cards" -> cards.asJson
      )
    case WsClientMessage.CoverCard(attackIndex, defenseCard) =>
      Json.obj(
        "type" -> Json.fromString("coverCard"),
        "attackIndex" -> attackIndex.asJson,
        "defenseCard" -> defenseCard.asJson
      )
    case WsClientMessage.RedirectAttack(cards) =>
      Json.obj(
        "type" -> Json.fromString("redirectAttack"),
        "cards" -> cards.asJson
      )
    case WsClientMessage.ThrowInCards(cards) =>
      Json.obj(
        "type" -> Json.fromString("throwInCards"),
        "cards" -> cards.asJson
      )
    case WsClientMessage.DeclareSurrender =>
      Json.obj("type" -> Json.fromString("declareSurrender"))
    case WsClientMessage.PassTurn =>
      Json.obj("type" -> Json.fromString("passTurn"))
    case WsClientMessage.Ping =>
      Json.obj("type" -> Json.fromString("ping"))
  }

  given Decoder[WsClientMessage] = Decoder.instance { cursor =>
    cursor.downField("type").as[String].flatMap { raw =>
      raw.trim.toLowerCase match
        case "playattack" =>
          cursor
            .downField("cards")
            .as[List[Card]]
            .map(WsClientMessage.PlayAttack.apply)
        case "covercard" =>
          for
            attackIndex <- cursor.downField("attackIndex").as[Int]
            defenseCard <- cursor.downField("defenseCard").as[Card]
          yield WsClientMessage.CoverCard(attackIndex, defenseCard)
        case "redirectattack" =>
          cursor
            .downField("cards")
            .as[List[Card]]
            .map(WsClientMessage.RedirectAttack.apply)
        case "throwincards" =>
          cursor
            .downField("cards")
            .as[List[Card]]
            .map(WsClientMessage.ThrowInCards.apply)
        case "declaresurrender" =>
          Right(WsClientMessage.DeclareSurrender)
        case "passturn" =>
          Right(WsClientMessage.PassTurn)
        case "ping" =>
          Right(WsClientMessage.Ping)
        case _ =>
          Left(DecodingFailure(s"Unknown client message type: $raw", cursor.history))
    }
  }

  // --- Server -> client frames ---

  given Encoder[WsServerMessage] = Encoder.instance {
    case WsServerMessage.GameViewUpdate(view) =>
      Json.obj(
        "type" -> Json.fromString("gameViewUpdate"),
        "view" -> view.asJson
      )
    case WsServerMessage.ActionRejected(code, message) =>
      Json.obj(
        "type" -> Json.fromString("actionRejected"),
        "code" -> code.asJson,
        "message" -> message.asJson
      )
    case WsServerMessage.LobbySnapshot(rooms) =>
      Json.obj(
        "type" -> Json.fromString("lobbySnapshot"),
        "rooms" -> rooms.asJson
      )
    case WsServerMessage.LobbyUpdated(rooms) =>
      Json.obj(
        "type" -> Json.fromString("lobbyUpdated"),
        "rooms" -> rooms.asJson
      )
    case WsServerMessage.MatchFound(gameId) =>
      Json.obj(
        "type" -> Json.fromString("matchFound"),
        "gameId" -> gameId.asJson
      )
    case WsServerMessage.QuickPairMatched(gameId, seatIndex) =>
      Json.obj(
        "type" -> Json.fromString("quickPairMatched"),
        "gameId" -> gameId.asJson,
        "seatIndex" -> seatIndex.asJson
      )
    case WsServerMessage.Pong =>
      Json.obj("type" -> Json.fromString("pong"))
  }

  given Decoder[WsServerMessage] = Decoder.instance { cursor =>
    cursor.downField("type").as[String].flatMap { raw =>
      raw.trim.toLowerCase match
        case "gameviewupdate" =>
          cursor
            .downField("view")
            .as[PlayerGameView]
            .map(WsServerMessage.GameViewUpdate.apply)
        case "actionrejected" =>
          for
            code <- cursor.downField("code").as[String]
            message <- cursor.downField("message").as[String]
          yield WsServerMessage.ActionRejected(code, message)
        case "lobbysnapshot" =>
          cursor
            .downField("rooms")
            .as[List[LobbyRoomSummary]]
            .map(WsServerMessage.LobbySnapshot.apply)
        case "lobbyupdated" =>
          cursor
            .downField("rooms")
            .as[List[LobbyRoomSummary]]
            .map(WsServerMessage.LobbyUpdated.apply)
        case "matchfound" =>
          cursor
            .downField("gameId")
            .as[String]
            .map(WsServerMessage.MatchFound.apply)
        case "quickpairmatched" =>
          for
            gameId <- cursor.downField("gameId").as[String]
            seatIndex <- cursor.downField("seatIndex").as[Int]
          yield WsServerMessage.QuickPairMatched(gameId, seatIndex)
        case "pong" =>
          Right(WsServerMessage.Pong)
        case _ =>
          Left(DecodingFailure(s"Unknown server message type: $raw", cursor.history))
    }
  }
