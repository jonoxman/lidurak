package durak.engine

import io.circe.{Decoder, DecodingFailure, Encoder, Json}
import io.circe.generic.semiauto.{deriveDecoder, deriveEncoder}
import io.circe.syntax.*

/** Circe codecs for the engine types that cross the REST/WebSocket boundary. */
object JsonCodecs:

  // --- Enums ---

  given Encoder[Suit] = Encoder.encodeString.contramap(_.toString.toLowerCase)

  given Decoder[Suit] = Decoder.decodeString.emap { raw =>
    Suit.values
      .find(_.toString.equalsIgnoreCase(raw))
      .toRight(s"Unknown suit: $raw")
  }

  given Encoder[Rank] = Encoder.encodeString.contramap(_.toString.toLowerCase)

  given Decoder[Rank] = Decoder.decodeString.emap { raw =>
    Rank.values
      .find(_.toString.equalsIgnoreCase(raw))
      .toRight(s"Unknown rank: $raw")
  }

  given Encoder[BoutPhase] =
    Encoder.encodeString.contramap(phase => lowerFirst(phase.toString))

  given Decoder[BoutPhase] = Decoder.decodeString.emap { raw =>
    BoutPhase.values
      .find(_.toString.equalsIgnoreCase(raw))
      .toRight(s"Unknown bout phase: $raw")
  }

  private def lowerFirst(value: String): String =
    if value.isEmpty then value else s"${value.head.toLower}${value.tail}"

  // --- Value objects ---

  given Encoder[Card] = Encoder.instance { card =>
    Json.obj("suit" -> card.suit.asJson, "rank" -> card.rank.asJson)
  }

  given Decoder[Card] = Decoder.instance { cursor =>
    for
      suit <- cursor.downField("suit").as[Suit]
      rank <- cursor.downField("rank").as[Rank]
    yield Card(suit, rank)
  }

  given Encoder[TablePair] = deriveEncoder[TablePair]
  given Decoder[TablePair] = deriveDecoder[TablePair]

  // --- Views ---

  given Encoder[PublicPlayerSummary] = deriveEncoder[PublicPlayerSummary]
  given Decoder[PublicPlayerSummary] = deriveDecoder[PublicPlayerSummary]

  /**
   * `PlayerGameView` carries more fields than the compiler's inline budget lets
   * a derived codec expand, so its mapping is written out by hand. The names are
   * the wire contract the frontend reads.
   */
  given Encoder[PlayerGameView] = Encoder.instance { view =>
    Json.obj(
      "myId" -> view.myId.asJson,
      "myName" -> view.myName.asJson,
      "myHand" -> view.myHand.asJson,
      "opponents" -> view.opponents.asJson,
      "tablePairs" -> view.tablePairs.asJson,
      "talonCount" -> view.talonCount.asJson,
      "bottomTrumpCard" -> view.bottomTrumpCard.asJson,
      "trumpSuit" -> view.trumpSuit.asJson,
      "attackerIdx" -> view.attackerIdx.asJson,
      "defenderIdx" -> view.defenderIdx.asJson,
      "boutPhase" -> view.boutPhase.asJson,
      "legalActions" -> view.legalActions.asJson,
      "finishOrder" -> view.finishOrder.asJson,
      "isDraw" -> view.isDraw.asJson,
      "maxBoutAttacks" -> view.maxBoutAttacks.asJson,
      "myStatus" -> view.myStatus.asJson,
      "myFinishRank" -> view.myFinishRank.asJson,
      "winners" -> view.winners.asJson,
      "durak" -> view.durak.asJson,
      "turnPlayerId" -> view.turnPlayerId.asJson,
      "turnDeadlineMs" -> view.turnDeadlineMs.asJson,
      "turnSecondsRemaining" -> view.turnSecondsRemaining.asJson,
      "defenderDefenseless" -> view.defenderDefenseless.asJson,
      "presentPlayers" -> view.presentPlayers.asJson,
      "discardCount" -> view.discardCount.asJson,
      "lastDiscardCards" -> view.lastDiscardCards.asJson,
      "gameStartedAtMs" -> view.gameStartedAtMs.asJson,
      "gameEndedAtMs" -> view.gameEndedAtMs.asJson,
      "promptedPlayerIds" -> view.promptedPlayerIds.asJson
    )
  }

  given Decoder[PlayerGameView] = Decoder.instance { cursor =>
    def field[A: Decoder](name: String): Decoder.Result[A] = cursor.downField(name).as[A]
    for
      myId <- field[String]("myId")
      // Older fixtures omit "myName"; a missing field decodes to an empty name.
      myName <- cursor.downField("myName").as[Option[String]].map(_.getOrElse(""))
      myHand <- field[List[Card]]("myHand")
      opponents <- field[List[PublicPlayerSummary]]("opponents")
      tablePairs <- field[Vector[TablePair]]("tablePairs")
      talonCount <- field[Int]("talonCount")
      bottomTrumpCard <- field[Option[Card]]("bottomTrumpCard")
      trumpSuit <- field[Suit]("trumpSuit")
      attackerIdx <- field[Int]("attackerIdx")
      defenderIdx <- field[Int]("defenderIdx")
      boutPhase <- field[BoutPhase]("boutPhase")
      legalActions <- field[List[String]]("legalActions")
      finishOrder <- field[Vector[String]]("finishOrder")
      isDraw <- field[Boolean]("isDraw")
      maxBoutAttacks <- field[Int]("maxBoutAttacks")
      myStatus <- field[String]("myStatus")
      myFinishRank <- field[Option[Int]]("myFinishRank")
      winners <- field[List[String]]("winners")
      durak <- field[Option[String]]("durak")
      turnPlayerId <- field[Option[String]]("turnPlayerId")
      turnDeadlineMs <- field[Long]("turnDeadlineMs")
      turnSecondsRemaining <- field[Int]("turnSecondsRemaining")
      defenderDefenseless <- field[Boolean]("defenderDefenseless")
      presentPlayers <- field[Vector[String]]("presentPlayers")
      discardCount <- field[Int]("discardCount")
      lastDiscardCards <- field[Vector[Card]]("lastDiscardCards")
      gameStartedAtMs <- field[Option[Long]]("gameStartedAtMs")
      gameEndedAtMs <- field[Option[Long]]("gameEndedAtMs")
      promptedPlayerIds <- field[Vector[String]]("promptedPlayerIds")
    yield PlayerGameView(
      myId = myId,
      myName = myName,
      myHand = myHand,
      opponents = opponents,
      tablePairs = tablePairs,
      talonCount = talonCount,
      bottomTrumpCard = bottomTrumpCard,
      trumpSuit = trumpSuit,
      attackerIdx = attackerIdx,
      defenderIdx = defenderIdx,
      boutPhase = boutPhase,
      legalActions = legalActions,
      finishOrder = finishOrder,
      isDraw = isDraw,
      maxBoutAttacks = maxBoutAttacks,
      myStatus = myStatus,
      myFinishRank = myFinishRank,
      winners = winners,
      durak = durak,
      turnPlayerId = turnPlayerId,
      turnDeadlineMs = turnDeadlineMs,
      turnSecondsRemaining = turnSecondsRemaining,
      defenderDefenseless = defenderDefenseless,
      presentPlayers = presentPlayers,
      discardCount = discardCount,
      lastDiscardCards = lastDiscardCards,
      gameStartedAtMs = gameStartedAtMs,
      gameEndedAtMs = gameEndedAtMs,
      promptedPlayerIds = promptedPlayerIds
    )
  }

  // --- WebSocket commands ---

  given Encoder[GameAction] = Encoder.instance {
    case GameAction.InitialAttack(playerId, cards) =>
      Json.obj(
        "type" -> Json.fromString("initialAttack"),
        "playerId" -> playerId.asJson,
        "cards" -> cards.asJson
      )
    case GameAction.CoverCard(playerId, attackIndex, defenseCard) =>
      Json.obj(
        "type" -> Json.fromString("coverCard"),
        "playerId" -> playerId.asJson,
        "attackIndex" -> attackIndex.asJson,
        "defenseCard" -> defenseCard.asJson
      )
    case GameAction.RedirectAttack(playerId, cards) =>
      Json.obj(
        "type" -> Json.fromString("redirectAttack"),
        "playerId" -> playerId.asJson,
        "cards" -> cards.asJson
      )
    case GameAction.ThrowInCards(playerId, cards) =>
      Json.obj(
        "type" -> Json.fromString("throwInCards"),
        "playerId" -> playerId.asJson,
        "cards" -> cards.asJson
      )
    case GameAction.DeclareSurrender(playerId) =>
      Json.obj(
        "type" -> Json.fromString("declareSurrender"),
        "playerId" -> playerId.asJson
      )
    case GameAction.PassTurn(playerId) =>
      Json.obj(
        "type" -> Json.fromString("passTurn"),
        "playerId" -> playerId.asJson
      )
  }

  given Decoder[GameAction] = Decoder.instance { cursor =>
    cursor.downField("type").as[String].flatMap { raw =>
      raw.toLowerCase match
        case "initialattack" =>
          for
            playerId <- cursor.downField("playerId").as[String]
            cards <- cursor.downField("cards").as[List[Card]]
          yield GameAction.InitialAttack(playerId, cards)
        case "covercard" =>
          for
            playerId <- cursor.downField("playerId").as[String]
            attackIndex <- cursor.downField("attackIndex").as[Int]
            defenseCard <- cursor.downField("defenseCard").as[Card]
          yield GameAction.CoverCard(playerId, attackIndex, defenseCard)
        case "redirectattack" =>
          for
            playerId <- cursor.downField("playerId").as[String]
            cards <- cursor.downField("cards").as[List[Card]]
          yield GameAction.RedirectAttack(playerId, cards)
        case "throwincards" =>
          for
            playerId <- cursor.downField("playerId").as[String]
            cards <- cursor.downField("cards").as[List[Card]]
          yield GameAction.ThrowInCards(playerId, cards)
        case "declaresurrender" =>
          cursor
            .downField("playerId")
            .as[String]
            .map(playerId => GameAction.DeclareSurrender(playerId))
        case "passturn" =>
          cursor
            .downField("playerId")
            .as[String]
            .map(playerId => GameAction.PassTurn(playerId))
        case _ =>
          Left(DecodingFailure(s"Unknown game action type: $raw", cursor.history))
    }
  }

  // --- Engine state & replay history ---

  given Encoder[GameConfig] = deriveEncoder[GameConfig]
  given Decoder[GameConfig] = deriveDecoder[GameConfig]

  given Encoder[PlayerState] = deriveEncoder[PlayerState]
  given Decoder[PlayerState] = deriveDecoder[PlayerState]

  given Encoder[GameState] = deriveEncoder[GameState]
  given Decoder[GameState] = deriveDecoder[GameState]

  given Encoder[RecordedMove] = deriveEncoder[RecordedMove]
  given Decoder[RecordedMove] = deriveDecoder[RecordedMove]

  given Encoder[ReplayFrame] = deriveEncoder[ReplayFrame]
  given Decoder[ReplayFrame] = deriveDecoder[ReplayFrame]

  given Encoder[SerializedGame] = deriveEncoder[SerializedGame]
  given Decoder[SerializedGame] = deriveDecoder[SerializedGame]
