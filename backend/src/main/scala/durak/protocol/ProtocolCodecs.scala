package durak.protocol

import durak.engine.JsonCodecs.given
import durak.engine.Card
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
      "isPublic" -> config.isPublic.asJson
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
    yield RoomConfigView(playerCount, allowRedirect, turnTimeoutSeconds, isPublic)
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
      "seatIndex" -> player.seatIndex.asJson
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
    yield PublicPlayerSummary(
      id = id,
      name = name,
      rating = rating,
      cardCount = cardCount,
      isConnected = isConnected,
      hasPassed = hasPassed,
      finishRank = finishRank,
      seatIndex = seatIndex
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
      "discardCount" -> view.discardCount.asJson,
      "phase" -> view.phase.asJson,
      "attackerIdx" -> view.attackerIdx.asJson,
      "defenderIdx" -> view.defenderIdx.asJson,
      "maxBoutAttacks" -> view.maxBoutAttacks.asJson,
      "finishOrder" -> view.finishOrder.asJson,
      "isDraw" -> view.isDraw.asJson,
      "durakId" -> view.durakId.asJson,
      "turnDeadlineEpochMs" -> view.turnDeadlineEpochMs.asJson
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
      discardCount <- cursor.downField("discardCount").as[Int]
      phase <- cursor.downField("phase").as[Option[String]]
      attackerIdx <- cursor.downField("attackerIdx").as[Option[Int]]
      defenderIdx <- cursor.downField("defenderIdx").as[Option[Int]]
      maxBoutAttacks <- cursor.downField("maxBoutAttacks").as[Int]
      finishOrder <- cursor.downField("finishOrder").as[Vector[String]]
      isDraw <- cursor.downField("isDraw").as[Boolean]
      durakId <- cursor.downField("durakId").as[Option[String]]
      turnDeadlineEpochMs <- cursor.downField("turnDeadlineEpochMs").as[Option[Long]]
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
      discardCount = discardCount,
      phase = phase,
      attackerIdx = attackerIdx,
      defenderIdx = defenderIdx,
      maxBoutAttacks = maxBoutAttacks,
      finishOrder = finishOrder,
      isDraw = isDraw,
      durakId = durakId,
      turnDeadlineEpochMs = turnDeadlineEpochMs
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
      "isQuickPair" -> room.isQuickPair.asJson
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
    yield LobbyRoomSummary(
      gameId = gameId,
      hostName = hostName,
      playerCount = playerCount,
      filledSeats = filledSeats,
      allowRedirect = allowRedirect,
      turnTimeoutSeconds = turnTimeoutSeconds,
      createdAtEpochMs = createdAtEpochMs,
      isQuickPair = isQuickPair
    )
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
        case "pong" =>
          Right(WsServerMessage.Pong)
        case _ =>
          Left(DecodingFailure(s"Unknown server message type: $raw", cursor.history))
    }
  }
