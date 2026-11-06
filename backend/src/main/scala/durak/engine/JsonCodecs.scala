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

  /**
   * Opponent summaries are written out by hand so `cards` can default to an
   * empty vector: an older payload (live mode) simply omits the field and must
   * never decode into a revealed hand.
   */
  given Encoder[PublicPlayerSummary] = Encoder.instance { summary =>
    Json.obj(
      "id" -> summary.id.asJson,
      "name" -> summary.name.asJson,
      "cardCount" -> summary.cardCount.asJson,
      "hasPassed" -> summary.hasPassed.asJson,
      "finishRank" -> summary.finishRank.asJson,
      "status" -> summary.status.asJson,
      "isTurn" -> summary.isTurn.asJson,
      "isPresent" -> summary.isPresent.asJson,
      "cards" -> summary.cards.asJson
    )
  }

  given Decoder[PublicPlayerSummary] = Decoder.instance { cursor =>
    for
      id <- cursor.downField("id").as[String]
      name <- cursor.downField("name").as[String]
      cardCount <- cursor.downField("cardCount").as[Int]
      hasPassed <- cursor.downField("hasPassed").as[Boolean]
      finishRank <- cursor.downField("finishRank").as[Option[Int]]
      status <- cursor
        .downField("status")
        .as[Option[String]]
        .map(_.getOrElse(PlayerStatus.Active))
      isTurn <- cursor.downField("isTurn").as[Option[Boolean]].map(_.getOrElse(false))
      isPresent <- cursor.downField("isPresent").as[Option[Boolean]].map(_.getOrElse(false))
      // Only an explicit revealed-hand payload fills `cards`.
      cards <- cursor
        .downField("cards")
        .as[Option[Vector[Card]]]
        .map(_.getOrElse(Vector.empty))
    yield PublicPlayerSummary(
      id = id,
      name = name,
      cardCount = cardCount,
      hasPassed = hasPassed,
      finishRank = finishRank,
      status = status,
      isTurn = isTurn,
      isPresent = isPresent,
      cards = cards
    )
  }

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
      "myHasPassed" -> view.myHasPassed.asJson,
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
      "promptedPlayerIds" -> view.promptedPlayerIds.asJson,
      "isBot" -> view.isBot.asJson,
      "playerTypes" -> view.playerTypes.asJson,
      "allowRedirect" -> view.allowRedirect.asJson,
      "chaosMode" -> view.chaosMode.asJson,
      "transparentMode" -> view.transparentMode.asJson,
      "devMode" -> view.devMode.asJson,
      "eligibleTargetIds" -> view.eligibleTargetIds.asJson,
      "redirectTargetId" -> view.redirectTargetId.asJson,
      "throwInCards" -> view.throwInCards.asJson,
      "throwInCapacity" -> view.throwInCapacity.asJson,
      "canThrowIn" -> view.canThrowIn.asJson
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
      // Optional additions: an older payload simply omits the viewer's own
      // pass flag and finishing rank.
      myHasPassed <- cursor
        .downField("myHasPassed")
        .as[Option[Boolean]]
        .map(_.getOrElse(false))
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
      // Optional additions: older fixtures and clients simply omit them.
      isBot <- cursor.downField("isBot").as[Option[Boolean]].map(_.getOrElse(false))
      playerTypes <- cursor
        .downField("playerTypes")
        .as[Option[Vector[String]]]
        .map(_.getOrElse(Vector.empty))
      allowRedirect <- cursor
        .downField("allowRedirect")
        .as[Option[Boolean]]
        .map(_.getOrElse(true))
      chaosMode <- cursor.downField("chaosMode").as[Option[Boolean]].map(_.getOrElse(false))
      // Optional additions: an ordinary (hidden-hand) payload omits them, and a
      // legacy payload predates Dev Mode, which defaults to on.
      transparentMode <- cursor
        .downField("transparentMode")
        .as[Option[Boolean]]
        .map(_.getOrElse(false))
      devMode <- cursor.downField("devMode").as[Option[Boolean]].map(_.getOrElse(true))
      eligibleTargetIds <- cursor
        .downField("eligibleTargetIds")
        .as[Option[Vector[String]]]
        .map(_.getOrElse(Vector.empty))
      redirectTargetId <- cursor.downField("redirectTargetId").as[Option[String]]
      // Optional additions: a legacy payload omits the throw-in projection,
      // which then decodes to "nothing to throw in".
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
      myHasPassed = myHasPassed,
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
      promptedPlayerIds = promptedPlayerIds,
      isBot = isBot,
      playerTypes = playerTypes,
      allowRedirect = allowRedirect,
      chaosMode = chaosMode,
      transparentMode = transparentMode,
      devMode = devMode,
      eligibleTargetIds = eligibleTargetIds,
      redirectTargetId = redirectTargetId,
      throwInCards = throwInCards,
      throwInCapacity = throwInCapacity,
      canThrowIn = canThrowIn
    )
  }

  // --- WebSocket commands ---

  given Encoder[GameAction] = Encoder.instance {
    case GameAction.InitialAttack(playerId, cards, targetPlayerId) =>
      val base = Json.obj(
        "type" -> Json.fromString("initialAttack"),
        "playerId" -> playerId.asJson,
        "cards" -> cards.asJson
      )
      // A standard opening attack names no target, so the field stays out of
      // the payload unless the move actually carries one.
      targetPlayerId.fold(base)(targetId => base.deepMerge(Json.obj("targetPlayerId" -> targetId.asJson)))
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
            // "targetPlayerId" may be present, null or absent; all mean the
            // same for a standard attack.
            targetPlayerId <- cursor
              .downField("targetPlayerId")
              .as[Option[String]]
              .map(_.map(_.trim).filter(_.nonEmpty))
          yield GameAction.InitialAttack(playerId, cards, targetPlayerId)
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

  /** Decodes a config, defaulting every optional setting a legacy payload omits. */
  given Decoder[GameConfig] = Decoder.instance { cursor =>
    for
      playerCount <- cursor.downField("playerCount").as[Int]
      allowRedirect <- cursor
        .downField("allowRedirect")
        .as[Option[Boolean]]
        .map(_.getOrElse(true))
      seed <- cursor.downField("seed").as[Option[Long]].map(_.getOrElse(0L))
      playerTypes <- cursor
        .downField("playerTypes")
        .as[Option[Vector[String]]]
        .map(_.getOrElse(Vector.empty))
      chaosMode <- cursor.downField("chaosMode").as[Option[Boolean]].map(_.getOrElse(false))
      // Optional settings: Transparent Mode is off and Dev Mode is on by
      // default, so an older stored config keeps its live-POV behaviour.
      transparentMode <- cursor
        .downField("transparentMode")
        .as[Option[Boolean]]
        .map(_.getOrElse(false))
      devMode <- cursor.downField("devMode").as[Option[Boolean]].map(_.getOrElse(true))
    yield GameConfig(
      playerCount,
      allowRedirect,
      seed,
      playerTypes,
      chaosMode,
      transparentMode,
      devMode
    )
  }

  given Encoder[PlayerState] = deriveEncoder[PlayerState]
  given Decoder[PlayerState] = deriveDecoder[PlayerState]

  given Encoder[GameState] = deriveEncoder[GameState]
  given Decoder[GameState] = deriveDecoder[GameState]

  given Encoder[RecordedMove] = deriveEncoder[RecordedMove]
  given Decoder[RecordedMove] = deriveDecoder[RecordedMove]

  given Encoder[ReplayFrame] = deriveEncoder[ReplayFrame]
  given Decoder[ReplayFrame] = deriveDecoder[ReplayFrame]

  given Encoder[SerializedGame] = deriveEncoder[SerializedGame]

  /** `skippedMoves` is optional, so older stored replays still decode. */
  given Decoder[SerializedGame] = Decoder.instance { cursor =>
    for
      gameId <- cursor.downField("gameId").as[String]
      config <- cursor.downField("config").as[GameConfig]
      initialState <- cursor.downField("initialState").as[GameState]
      moves <- cursor.downField("moves").as[Vector[RecordedMove]]
      frames <- cursor.downField("frames").as[Vector[ReplayFrame]]
      skippedMoves <- cursor
        .downField("skippedMoves")
        .as[Option[Vector[RecordedMove]]]
        .map(_.getOrElse(Vector.empty))
    yield SerializedGame(gameId, config, initialState, moves, frames, skippedMoves)
  }
