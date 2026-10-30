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
    if value.isEmpty then value else value.head.toLower + value.tail

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

  given Encoder[PlayerGameView] = deriveEncoder[PlayerGameView]
  given Decoder[PlayerGameView] = deriveDecoder[PlayerGameView]

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
