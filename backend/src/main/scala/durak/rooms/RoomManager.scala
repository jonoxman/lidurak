package durak.rooms

import cats.effect.{Async, Deferred, Fiber, Ref, Resource}
import cats.effect.std.{Queue, Semaphore}
import cats.syntax.all.*
import durak.engine.{BasicBot, BoutPhase, GameAction, GameConfig, GameEngine, GameState}
import durak.protocol.{
  LobbyRoomSummary,
  PlayerGameView,
  RoomStatus,
  WsClientMessage,
  WsServerMessage
}
import durak.session.GuestSession
import fs2.Stream
import fs2.concurrent.Topic

import java.security.SecureRandom
import java.util.UUID
import scala.concurrent.duration.*

/**
 * A live room plus the two pieces of runtime state that must not live in the
 * immutable [[GameRoom]]: the connected WebSocket clients and the room's
 * turn-timeout monitor.
 *
 * Every mutation goes through [[RoomManager]]'s single mutex, so a client
 * registry and a room state are always updated as one unit.
 */
private[rooms] final case class ManagedRoom[F[_]](
    state: Ref[F, GameRoom],
    clients: Ref[F, Vector[ConnectedClient[F]]],
    clock: Ref[F, Option[Fiber[F, Throwable, Unit]]],
    bots: Ref[F, Option[Fiber[F, Throwable, Unit]]]
)

/**
 * The authoritative, concurrent room pool for shareable `/g/:gameId` matches.
 *
 * The server owns every room: seats, deals, legal moves, turn clocks and the
 * per-viewer projection. A client can only ever name itself in a move; the
 * acting seat is derived from the authenticated `senderPlayerId` in
 * [[handleAction]], never from the payload.
 *
 * All room mutations are serialised through one [[Semaphore]], so joins,
 * leaves, moves and turn-timeout auto-moves cannot interleave into a torn
 * state. Reads project a consistent snapshot of the room and its connected
 * clients.
 *
 * @param startTurnClocks whether a started match forks its timeout monitor;
 *                        tests can turn the fork off and drive
 *                        [[enforceTurnTimeout]] deterministically instead.
 * @param botMoveDelay    how long a bot waits before each of its moves, so a
 *                        reviewer can follow the live table.
 * @param devMode         whether a creator may start an all-bot room without
 *                        occupying a seat and watch it as a spectator. In
 *                        production (`false`) the creator must take a seat.
 */
final class RoomManager[F[_]](
    rooms: Ref[F, Map[String, ManagedRoom[F]]],
    lobbyTopic: Topic[F, List[LobbyRoomSummary]],
    mutex: Semaphore[F],
    startTurnClocks: Boolean,
    clockPollInterval: FiniteDuration,
    botMoveDelay: FiniteDuration,
    devMode: Boolean
)(using F: Async[F]):

  import RoomManager.*

  // --- Room lifecycle ------------------------------------------------------

  /**
   * Creates a public or private waiting room and seats `host` in seat 0.
   *
   * The configuration is validated first, so a room can only ever exist with a
   * supported player count and a turn clock inside the accepted range. The
   * generated id is URL-safe and unique inside the pool.
   */
  def createRoom(
      host: GuestSession,
      config: CreateRoomConfig
  ): F[Either[String, (GameRoom, Int)]] =
    createRoomWithSeats(host, config).map(
      _.map(creation => (creation.room, creation.seatIndex.getOrElse(0)))
    )

  /**
   * Creates a room from a per-seat plan and seats (or deliberately does not
   * seat) the creator.
   *
   * `seatTypes` names who plays every seat (`"human"`, `"randomBot"` or
   * `"basicBot"`); an empty vector means every seat is human. Bot seats are
   * pre-populated immediately, so they never wait for a player. When the plan
   * leaves no open human seat (for example one human plus bots, or an all-bot
   * dev room) the match is dealt and started right away.
   *
   * `spectateAsCreator` (or a plan of nothing but bots) makes the creator a
   * spectator: they occupy no seat and only watch `room`'s live projection.
   * That is a dev-mode ability; with [[devMode]] off the request is rejected
   * because production games require the creator to take a seat.
   */
  def createRoomWithSeats(
      host: GuestSession,
      config: CreateRoomConfig,
      seatTypes: Vector[String] = Vector.empty,
      creatorSeatIndex: Option[Int] = None,
      spectateAsCreator: Boolean = false
  ): F[Either[String, RoomCreation]] =
    config.validate match
      case Left(error) => F.pure(Left(error))
      case Right(valid) =>
        seatPlan(valid, seatTypes, creatorSeatIndex, spectateAsCreator) match
          case Left(error) => F.pure(Left(error))
          case Right((types, creatorSeat)) =>
            nowMs.flatMap { now =>
              mutex.permit.use { _ =>
                freshGameId.flatMap { gameId =>
                  val seats = Vector.tabulate(valid.playerCount) { seatIndex =>
                    if creatorSeat.contains(seatIndex) then
                      SeatSlot(
                        seatIndex,
                        Some(host.playerId),
                        Some(host.displayName),
                        GameConfig.HumanSeat
                      )
                    else
                      openSeat(gameId, seatIndex, types)
                  }
                  val base = GameRoom(
                    gameId = gameId,
                    config = valid,
                    status = RoomStatus.WaitingForPlayers,
                    seats = seats,
                    gameState = None,
                    turnDeadlineEpochMs = None,
                    createdAtEpochMs = now,
                    hostName = host.displayName
                  )
                  for
                    // Bots are always ready, so a plan with no open human seat
                    // deals and starts in the same transition.
                    stored <-
                      if seats.forall(_.isOccupied) then startRoom(base, None, now)
                      else F.pure(base)
                    managed <- newManaged(stored)
                    _ <- rooms.update(_.updated(gameId, managed))
                    _ <- ensureClock(managed)
                    _ <- ensureBots(managed)
                    _ <- publishLobby
                  yield Right(RoomCreation(stored, creatorSeat))
                }
              }
            }

  /**
   * Creates a room that is already partly (or fully) seated, for the 1-click QA
   * scenario presets. `prefilledSeats` are `(playerId, displayName)` pairs in
   * seat order. When `autoStartIfFull` is set and every seat is claimed, the
   * match is dealt immediately through the same deal path a real join uses, so
   * the preset match is indistinguishable from an organic one.
   */
  def createPresetRoom(
      config: CreateRoomConfig,
      prefilledSeats: Vector[(String, String)],
      autoStartIfFull: Boolean,
      seed: Option[Long] = None,
      initialHandSize: Int = GameEngine.DefaultHandSize,
      firstAttackerIdx: Option[Int] = None,
      seatTypes: Vector[String] = Vector.empty
  ): F[GameRoom] =
    config.validate match
      case Left(error) => F.raiseError(new IllegalArgumentException(error))
      case Right(valid) =>
        if prefilledSeats.size > valid.playerCount then
          F.raiseError(
            new IllegalArgumentException(
              s"Preset seats (${prefilledSeats.size}) exceed player count (${valid.playerCount})"
            )
          )
        else
          nowMs.flatMap { now =>
            mutex.permit.use { _ =>
              freshGameId.flatMap { gameId =>
                val types =
                  GameConfig.normalizePlayerTypes(valid.playerCount, seatTypes)
                val seats = Vector.tabulate(valid.playerCount) { seatIndex =>
                  prefilledSeats.lift(seatIndex) match
                    case Some((playerId, displayName)) =>
                      SeatSlot(seatIndex, Some(playerId), Some(displayName), types(seatIndex))
                    case None =>
                      openSeat(gameId, seatIndex, types)
                }
                val base = GameRoom(
                  gameId = gameId,
                  config = valid,
                  status = RoomStatus.WaitingForPlayers,
                  seats = seats,
                  gameState = None,
                  turnDeadlineEpochMs = None,
                  createdAtEpochMs = now,
                  hostName = prefilledSeats.headOption.map(_._2).getOrElse("QA Host")
                )
                for
                  stored <-
                    if autoStartIfFull && seats.forall(_.isOccupied) then
                      startRoom(base, seed, now, initialHandSize, firstAttackerIdx)
                    else F.pure(base)
                  managed <- newManaged(stored)
                  _ <- rooms.update(_.updated(gameId, managed))
                  _ <- ensureClock(managed)
                  _ <- ensureBots(managed)
                  _ <- publishLobby
                yield stored
              }
            }
          }

  /**
   * Returns a viewer's strictly filtered projection of the room, or `None`
   * when no such room exists.
   */
  def getRoomView(gameId: String, viewerId: String): F[Option[PlayerGameView]] =
    rooms.get.flatMap(_.get(gameId).traverse(managed => viewFor(managed, viewerId)))

  /** The authoritative room state, for read-only inspection. */
  def getRoom(gameId: String): F[Option[GameRoom]] =
    rooms.get.flatMap(_.get(gameId).traverse(_.state.get))

  /**
   * How many rooms the pool holds right now, started or waiting.
   *
   * The lobby projection only ever lists open public rooms, so this is the
   * read that lets tests prove a deferred quick-pair queue created no room.
   */
  def roomCount: F[Int] =
    rooms.get.map(_.size)

  /**
   * Seats `session.playerId` in the lowest open seat.
   *
   * Rejoining with the same `playerId` is idempotent: the existing seat is
   * returned, which is what lets a reconnecting browser re-attach to a match
   * that is already running. Claiming the final open seat starts the match and
   * removes the room from the open lobby pool.
   */
  def joinSeat(
      gameId: String,
      session: GuestSession
  ): F[Either[String, (PlayerGameView, Int)]] =
    mutex.permit.use { _ =>
      rooms.get.flatMap(_.get(gameId) match
        case None => F.pure(Left(unknownRoomMessage(gameId)))
        case Some(managed) =>
          managed.state.get.flatMap { room =>
            room.seatIndexOf(session.playerId) match
              case Some(seatIdx) =>
                // Reconnection: re-attach to the exact same seat and hand.
                for
                  view <- viewFor(managed, session.playerId)
                  _ <- broadcastViews(managed)
                  _ <- publishLobby
                yield Right((view, seatIdx))
              case None =>
                if room.status != RoomStatus.WaitingForPlayers then
                  F.pure(Left("This match has already started"))
                else
                  room.seats.indexWhere(_.playerId.isEmpty) match
                    case -1 => F.pure(Left("This room is full"))
                    case seatIdx =>
                      val seated = room.copy(
                        seats = room.seats.updated(
                          seatIdx,
                          SeatSlot(seatIdx, Some(session.playerId), Some(session.displayName))
                        )
                      )
                      val now = System.currentTimeMillis()
                      val filled = seated.seats.forall(_.isOccupied)
                      for
                        next <-
                          if filled then startRoom(seated, None, now)
                          else F.pure(seated)
                        _ <- managed.state.set(next)
                        view <- viewFor(managed, session.playerId)
                        _ <- broadcastViews(managed)
                        _ <- publishLobby
                        _ <- if filled then ensureClock(managed) else F.unit
                        _ <- ensureBots(managed)
                      yield Right((view, seatIdx))
          }
      )
    }

  /**
   * Vacates a seat while the room is still waiting for players. Once the match
   * has started a player may not abandon their seat; a room that loses its last
   * waiting player is removed from the pool entirely.
   */
  def leaveSeat(gameId: String, playerId: String): F[Either[String, Unit]] =
    mutex.permit.use { _ =>
      rooms.get.flatMap(_.get(gameId) match
        case None => F.pure(Left(unknownRoomMessage(gameId)))
        case Some(managed) =>
          managed.state.get.flatMap { room =>
            if room.status != RoomStatus.WaitingForPlayers then
              F.pure(Left("Cannot leave a match that has already started"))
            else
              room.seatIndexOf(playerId) match
                case None =>
                  F.pure(Left(s"$playerId is not seated in room $gameId"))
                case Some(seatIdx) =>
                  val vacated = room.copy(
                    seats = room.seats.updated(
                      seatIdx,
                      SeatSlot(seatIdx, None, None, GameConfig.HumanSeat)
                    )
                  )
                  // A room whose last human leaves is removed even when bot
                  // seats are still occupied: nobody could ever finish it.
                  val stillOccupied = vacated.seats.exists(seat => seat.isOccupied && !seat.isBot)
                  for
                    _ <-
                      if stillOccupied then managed.state.set(vacated)
                      else removeRoom(managed)
                    _ <- if stillOccupied then broadcastViews(managed) else F.unit
                    _ <- publishLobby
                  yield Right(())
          }
      )
    }

  // --- Presence & streams --------------------------------------------------

  /**
   * Registers one WebSocket client of `viewerId` and streams every projected
   * frame for that client.
   *
   * The initial [[PlayerGameView]] is queued immediately and returned as well,
   * so the caller can render the table without waiting for a frame. Seated
   * players become `isConnected = true` and every other client is told; on
   * release the client is removed and, when no other socket remains for that
   * player, peers receive `isConnected = false`.
   */
  def subscribe(
      gameId: String,
      viewerId: String
  ): Resource[F, (Stream[F, WsServerMessage], PlayerGameView)] =
    Resource
      .make {
        mutex.permit.use { _ =>
          rooms.get.flatMap(_.get(gameId) match
            case None => F.raiseError[Subscription[F]](new UnknownRoom(gameId))
            case Some(managed) =>
              for
                queue <- Queue.unbounded[F, WsServerMessage]
                stop <- Deferred[F, Either[Throwable, Unit]]
                client = ConnectedClient(
                  clientId = UUID.randomUUID().toString,
                  playerId = viewerId,
                  queue = queue,
                  stop = stop
                )
                _ <- managed.clients.update(_ :+ client)
                view <- viewFor(managed, viewerId)
                _ <- queue.offer(WsServerMessage.GameViewUpdate(view))
                _ <- broadcastViews(managed, exceptClientIds = Set(client.clientId))
              yield Subscription(managed, client, view)
          )
        }
      } { subscription =>
        mutex.permit.use { _ =>
          for
            _ <- subscription.managed.clients.update(
              _.filterNot(_.clientId == subscription.client.clientId)
            )
            _ <- subscription.client.stop.complete(Right(())).void
            // Peers see the connection state flip only when this was the last
            // socket of that player.
            _ <- broadcastViews(subscription.managed)
          yield ()
        }
      }
      .map { subscription =>
        val frames = Stream
          .fromQueueUnterminated(subscription.client.queue)
          .interruptWhen(subscription.client.stop.get)
        (frames, subscription.view)
      }

  // --- Actions -------------------------------------------------------------

  /**
   * Applies one client action on behalf of the authenticated `senderPlayerId`.
   *
   * Strict seat authorisation: the sender must occupy a seat of a running
   * match, and [[GameEngine.applyAction]] is called with that same id, so a
   * payload can never name another seat. A rejected action never touches
   * `gameState`; a legal one broadcasts a freshly projected
   * [[PlayerGameView]] to every connected client individually.
   */
  def handleAction(
      gameId: String,
      senderPlayerId: String,
      action: WsClientMessage
  ): F[Either[ActionRejected, Unit]] =
    toGameAction(senderPlayerId, action) match
      case Left(rejected) => F.pure(Left(rejected))
      case Right(engineAction) => handleGameAction(gameId, senderPlayerId, engineAction)

  /**
   * Applies one already-decoded engine action on behalf of the authenticated
   * `senderPlayerId`.
   *
   * This is the shared entry point for every [[GameAction]] variant, including
   * an `InitialAttack` that names an optional `targetPlayerId` (the Chaos-mode
   * opening attack), which the compact WebSocket frame does not carry. Seat
   * authorisation is identical to [[handleAction]]: the acting id is always the
   * authenticated sender, never a value read from the payload.
   */
  def handleGameAction(
      gameId: String,
      senderPlayerId: String,
      action: GameAction
  ): F[Either[ActionRejected, Unit]] =
    mutex.permit.use { _ =>
      rooms.get.flatMap(_.get(gameId) match
        case None =>
          F.pure(
            Left(ActionRejected(RoomManager.roomNotFoundCode, unknownRoomMessage(gameId)))
          )
        case Some(managed) =>
          managed.state.get.flatMap { room =>
            val senderSeat = room.seatIndexOf(senderPlayerId)
            (room.status, room.gameState, senderSeat) match
              case (RoomStatus.InProgress, Some(state), Some(_)) =>
                GameEngine.applyAction(state, senderPlayerId, action) match
                  case Left(reason) =>
                    F.pure(Left(ActionRejected.illegalMove(reason)))
                  case Right(next) =>
                    nowMs.flatMap { now =>
                      val updated = afterMove(room, next, now)
                      for
                        _ <- managed.state.set(updated)
                        _ <- broadcastViews(managed)
                        _ <- publishLobby
                        // A human move can hand the clock to a bot seat.
                        _ <- ensureBots(managed)
                      yield Right(())
                    }
              case _ =>
                F.pure(
                  Left(
                    ActionRejected.unauthorized(
                      s"$senderPlayerId is not a seated player in a running match"
                    )
                  )
                )
          }
      )
    }

  /**
   * Enforces the turn clock at `nowEpochMs`: when the room's deadline has
   * passed, the player on the clock is given a random legal move. Returns
   * `Right(true)` when a move was played, `Right(false)` when there was nothing
   * to enforce, and `Left(error)` for an unknown room.
   *
   * The background monitor calls this with the wall clock; tests can call it
   * with a future timestamp to exercise expiry deterministically.
   */
  def enforceTurnTimeout(
      gameId: String,
      nowEpochMs: Long
  ): F[Either[String, Boolean]] =
    mutex.permit.use { _ =>
      rooms.get.flatMap(_.get(gameId) match
        case None => F.pure(Left(unknownRoomMessage(gameId)))
        case Some(managed) =>
          managed.state.get.flatMap { room =>
            if room.status != RoomStatus.InProgress then F.pure(Right(false))
            else
              room.turnDeadlineEpochMs match
                case Some(deadline) if deadline <= nowEpochMs =>
                  room.gameState.flatMap(autoMove) match
                    case None => F.pure(Right(false))
                    case Some(action) =>
                      room.gameState.map(state => GameEngine.applyAction(state, action)) match
                        case Some(Right(next)) =>
                          for
                            _ <- managed.state.set(afterMove(room, next, nowEpochMs))
                            _ <- broadcastViews(managed)
                            _ <- publishLobby
                            _ <- ensureBots(managed)
                          yield Right(true)
                        case Some(Left(reason)) => F.pure(Left(reason))
                        case None               => F.pure(Right(false))
                case _ => F.pure(Right(false))
          }
      )
    }

  // --- Lobby pool ----------------------------------------------------------

  /** Every open public room, oldest first. */
  def listOpenPublicRooms: F[List[LobbyRoomSummary]] =
    rooms.get.flatMap(openPublicRooms)

  /** Every lobby snapshot published whenever the open pool changes. */
  def lobbyUpdates: Stream[F, List[LobbyRoomSummary]] =
    lobbyTopic.subscribe(MaxLobbySubscribers)

  // --- Internals -----------------------------------------------------------

  private def newManaged(room: GameRoom): F[ManagedRoom[F]] =
    for
      state <- Ref.of[F, GameRoom](room)
      clients <- Ref.of[F, Vector[ConnectedClient[F]]](Vector.empty)
      clock <- Ref.of[F, Option[Fiber[F, Throwable, Unit]]](None)
      bots <- Ref.of[F, Option[Fiber[F, Throwable, Unit]]](None)
    yield ManagedRoom(state, clients, clock, bots)

  // --- Seat plans ----------------------------------------------------------

  /**
   * Resolves who plays each seat and where (if anywhere) the creator sits.
   *
   * Every rejected plan becomes a human-readable reason, which the REST layer
   * answers with HTTP 400. Bot seats are validated strictly, so a typo can
   * never silently become a human seat waiting for a second player.
   */
  private def seatPlan(
      config: CreateRoomConfig,
      requestedTypes: Vector[String],
      requestedCreatorSeat: Option[Int],
      spectateAsCreator: Boolean
  ): Either[String, (Vector[String], Option[Int])] =
    val parsed: Either[String, Vector[String]] =
      if requestedTypes.isEmpty then
        Right(Vector.fill(config.playerCount)(GameConfig.HumanSeat))
      else if requestedTypes.size != config.playerCount then
        Left(
          s"seatTypes must have exactly ${config.playerCount} entries, got ${requestedTypes.size}"
        )
      else
        requestedTypes.toVector
          .traverse(value =>
            GameConfig
              .parseSeatType(value)
              .toRight(s"Unsupported seat type: $value (expected human, randomBot, or basicBot)")
          )
          .map(_.toVector)

    parsed.flatMap { types =>
      val allBots = types.forall(GameConfig.isBotType)
      val creatorSpectates = spectateAsCreator || allBots

      if creatorSpectates && !devMode then Left("Creator must occupy a seat")
      else if spectateAsCreator && !allBots then
        Left("Spectating a created room requires every seat to be a bot")
      else if creatorSpectates then Right((types, None))
      else
        val seat =
          requestedCreatorSeat.getOrElse(types.indexWhere(_ == GameConfig.HumanSeat))
        if seat < 0 || seat >= config.playerCount then
          Left(s"creatorSeatIndex must be between 0 and ${config.playerCount - 1}")
        else if types(seat) != GameConfig.HumanSeat then
          Left(s"creatorSeatIndex $seat is not a human seat")
        else Right((types, Some(seat)))
    }

  /**
   * The seat a player (or a bot) has to claim: bot seats are occupied at once,
   * a human seat stays open until somebody joins it.
   */
  private def openSeat(gameId: String, seatIndex: Int, types: Vector[String]): SeatSlot =
    val seatType = types.lift(seatIndex).getOrElse(GameConfig.HumanSeat)
    if GameConfig.isBotType(seatType) then botSeat(gameId, seatIndex, seatType, types)
    else SeatSlot(seatIndex, None, None, GameConfig.HumanSeat)

  /**
   * A pre-populated bot seat. Its id is unique per room, and its display name is
   * the bare bot name unless several seats share one bot type, in which case a
   * seat ordinal keeps the table readable (`BasicBot 1`, `BasicBot 2`, ...).
   */
  private def botSeat(
      gameId: String,
      seatIndex: Int,
      seatType: String,
      types: Vector[String]
  ): SeatSlot =
    val label =
      if seatType == GameConfig.BasicBotSeat then "BasicBot" else "RandomBot"
    val total = types.count(_ == seatType)
    val ordinal = types.take(seatIndex).count(_ == seatType) + 1
    val name = if total > 1 then s"$label $ordinal" else label
    SeatSlot(seatIndex, Some(s"bot-$gameId-$seatIndex"), Some(name), seatType)

  // --- Bot driver ----------------------------------------------------------

  /** True when the room has at least one computer seat, i.e. a bot match. */
  private def isBotMatch(room: GameRoom): Boolean = room.seats.exists(_.isBot)

  /**
   * True when the driver still has work: a bot seat is prompted, or a bot match
   * needs its last settling pass.
   */
  private def hasPendingWork(room: GameRoom): Boolean =
    room.status == RoomStatus.InProgress && isBotMatch(room) &&
      room.gameState.exists(state =>
        !state.isGameOver &&
          (state.promptedPlayerSeats.exists(state.config.isBotSeat) || settlingPass(state).nonEmpty)
      )

  /**
   * Starts the room's bot driver once, when a bot match still needs a move.
   *
   * Bots are driven from `state.promptedPlayerSeats`, not only from
   * `turnPlayerIdx`, so they also act during throw-in / pass windows where
   * several seats (and possibly several bots) are prompted at once. The
   * [[settlingPass]] case covers the one position the engine leaves nobody on
   * the clock for: a bout whose attacks are all covered while the attacker has
   * no cards left, which needs a single `PassTurn` before it can settle.
   */
  private def ensureBots(managed: ManagedRoom[F]): F[Unit] =
    managed.state.get.flatMap { room =>
      if !hasPendingWork(room) then F.unit
      else
        managed.bots.get.flatMap {
          case Some(_) => F.unit
          case None =>
            F.start(botLoop(managed)).flatMap(fiber => managed.bots.set(Some(fiber)))
        }
    }

  private def stopBots(managed: ManagedRoom[F]): F[Unit] =
    managed.bots.getAndSet(None).flatMap(_.traverse_(_.cancel))

  /**
   * The bot driver: sleep `botMoveDelay`, play the first prompted bot move, and
   * repeat until no bot seat is prompted any more (or the match ends).
   */
  private def botLoop(managed: ManagedRoom[F]): F[Unit] =
    F.defer {
      F.sleep(botMoveDelay) *> playOneBotMove(managed)
    }.flatMap { moved =>
      if moved then botLoop(managed) else managed.bots.set(None)
    }.handleErrorWith(_ => managed.bots.set(None))

  /**
   * Plays one move for the first bot seat the game is waiting on. Returns
   * `false` when the room has nothing left for a bot to do (finished match, no
   * prompted bot, or no legal move), which stops the driver.
   */
  private def playOneBotMove(managed: ManagedRoom[F]): F[Boolean] =
    mutex.permit.use { _ =>
      managed.state.get.flatMap { room =>
        val live =
          if room.status == RoomStatus.InProgress then room.gameState.filterNot(_.isGameOver)
          else None

        live.flatMap(state => botMoveFor(state).map((state, _))) match
          case None => F.pure(false)
          case Some((state, move)) =>
            GameEngine.applyAction(state, move) match
              case Left(_) => F.pure(false)
              case Right(next) =>
                nowMs.flatMap { now =>
                  for
                    _ <- managed.state.set(afterMove(room, next, now))
                    _ <- broadcastViews(managed)
                    _ <- publishLobby
                  yield true
                }
      }
    }

  /**
   * The move a bot match plays next: the policy or random pick of the first
   * prompted bot seat, or — when no seat is prompted any more — the settling
   * pass a fully covered bout still needs.
   */
  private def botMoveFor(state: GameState): Option[GameAction] =
    val prompted =
      state.promptedPlayerSeats
        .filter(state.config.isBotSeat)
        .iterator
        .flatMap(seatIdx => state.players.lift(seatIdx).map(bot => (seatIdx, bot)))
        .filter { case (_, bot) => bot.isActive }
        .flatMap { case (seatIdx, bot) =>
          chooseBotAction(state, bot.id, state.config.seatType(seatIdx))
        }
        .nextOption()
    prompted.orElse(settlingPass(state))

  /** A bot's move: [[BasicBot]]'s policy or [[GameEngine]]'s random pick. */
  private def chooseBotAction(
      state: GameState,
      botId: String,
      seatType: String
  ): Option[GameAction] =
    if seatType == GameConfig.BasicBotSeat then BasicBot.chooseAction(state, botId)
    else GameEngine.randomLegalAction(state, botId)

  /**
   * The final `PassTurn` a covered bout still needs when nobody is prompted.
   *
   * In a two-player game the attacker can empty their hand into a covered table
   * with the talon already gone; the engine then accepts their pass to settle
   * the bout, but nobody is "on the clock", so a room would otherwise freeze.
   * This mirrors `durak.server.GameActor`'s settling pass: it is only offered
   * when every attacking card is covered and no seat at all is prompted, so it
   * never takes a real choice away from a human seat.
   */
  private def settlingPass(state: GameState): Option[GameAction] =
    if state.isGameOver ||
      state.promptedPlayerSeats.nonEmpty ||
      state.boutPhase != BoutPhase.Defense ||
      state.tablePairs.isEmpty ||
      state.tablePairs.exists(_.defense.isEmpty)
    then None
    else
      state.players.zipWithIndex.iterator
        .filter { case (player, idx) => idx != state.defenderIdx && player.isActive }
        .map { case (player, _) => GameAction.PassTurn(player.id) }
        .find(action => GameEngine.applyAction(state, action).isRight)

  /**
   * Deals the match once every seat is filled. Player ids are re-stamped from
   * the seats so the engine state, the lobby seats and the authenticated
   * sessions all speak the same ids; the initial turn deadline is set from the
   * room's configured clock.
   */
  private def startRoom(
      room: GameRoom,
      seedOverride: Option[Long],
      now: Long,
      initialHandSize: Int = GameEngine.DefaultHandSize,
      firstAttackerIdx: Option[Int] = None
  ): F[GameRoom] =
    seedOverride match
      case Some(seed) => F.pure(deal(room, seed, now, initialHandSize, firstAttackerIdx))
      case None =>
        F.delay(deal(room, RoomManager.newSeed(), now, initialHandSize, firstAttackerIdx))

  private def deal(
      room: GameRoom,
      seed: Long,
      now: Long,
      initialHandSize: Int = GameEngine.DefaultHandSize,
      firstAttackerIdx: Option[Int] = None
  ): GameRoom =
    val engineConfig = GameConfig(
      playerCount = room.config.playerCount,
      allowRedirect = room.config.allowRedirect,
      seed = seed,
      // Every seat's type (and so every bot seat) comes from the room itself.
      playerTypes = room.seats.map(_.seatType),
      deckSize = room.config.deckSize
    )
    val names = room.seats.map(seat => seat.displayName.getOrElse("Player"))
    val dealt = GameEngine.createGame(engineConfig, names, initialHandSize, firstAttackerIdx)
    val seated = dealt.copy(
      players = dealt.players.zip(room.seats).map { case (player, seat) =>
        player.copy(
          id = seat.playerId.getOrElse(player.id),
          name = seat.displayName.getOrElse(player.name)
        )
      },
      // The overall game clock starts on the transition into InProgress and
      // stays frozen until the match is over.
      gameStartedAtMs = Some(now),
      gameEndedAtMs = None
    )
    room.copy(
      status = RoomStatus.InProgress,
      gameState = Some(seated),
      turnDeadlineEpochMs = deadlineFor(seated, room.config.turnTimeoutSeconds, now)
    )

  /**
   * The room after a legal move: the overall game clock is stamped (started on
   * the first move at the latest, frozen once the match ends), the engine state
   * is stored, a finished match becomes [[RoomStatus.Finished]] with no running
   * clock, and a running one gets a fresh deadline for whoever is on the clock
   * now.
   */
  private def afterMove(room: GameRoom, next: GameState, now: Long): GameRoom =
    val stamped = next.copy(
      gameStartedAtMs = next.gameStartedAtMs
        .orElse(room.gameState.flatMap(_.gameStartedAtMs))
        .orElse(Some(now)),
      gameEndedAtMs = next.gameEndedAtMs.orElse(Option.when(next.isGameOver)(now))
    )
    if next.isGameOver then
      room.copy(
        gameState = Some(stamped),
        status = RoomStatus.Finished,
        turnDeadlineEpochMs = None
      )
    else
      room.copy(
        gameState = Some(stamped),
        status = RoomStatus.InProgress,
        turnDeadlineEpochMs = deadlineFor(stamped, room.config.turnTimeoutSeconds, now)
      )

  /**
   * The single definition of when the current turn expires.
   *
   * Only a human on the clock gets a deadline: a bot seat is driven by the bot
   * loop after [[botMoveDelay]], so an idle bot can never trip the timeout
   * auto-move ahead of its own move.
   */
  private def deadlineFor(
      state: GameState,
      turnTimeoutSeconds: Int,
      now: Long
  ): Option[Long] =
    val humanOnTheClock = state.promptedPlayerSeats.exists(idx => !state.config.isBotSeat(idx))
    if state.isGameOver || !humanOnTheClock then None
    else Some(now + turnTimeoutSeconds.toLong * 1000L)

  /** A random legal move for any seat the game is waiting on, in seat order. */
  private def autoMove(state: GameState): Option[GameAction] =
    state.players.iterator
      .filter(player => state.promptedPlayerIds.contains(player.id))
      .flatMap(player => GameEngine.randomLegalAction(state, player.id))
      .nextOption()

  /** Maps a wire frame to the engine action, bound strictly to `playerId`. */
  private def toGameAction(
      playerId: String,
      message: WsClientMessage
  ): Either[ActionRejected, GameAction] =
    message match
      case WsClientMessage.PlayAttack(cards) =>
        Right(GameAction.InitialAttack(playerId, cards, None))
      case WsClientMessage.CoverCard(attackIndex, defenseCard) =>
        Right(GameAction.CoverCard(playerId, attackIndex, defenseCard))
      case WsClientMessage.RedirectAttack(cards) =>
        Right(GameAction.RedirectAttack(playerId, cards))
      case WsClientMessage.ThrowInCards(cards) =>
        Right(GameAction.ThrowInCards(playerId, cards))
      case WsClientMessage.DeclareSurrender =>
        Right(GameAction.DeclareSurrender(playerId))
      case WsClientMessage.PassTurn =>
        Right(GameAction.PassTurn(playerId))
      case WsClientMessage.Ping =>
        Left(
          ActionRejected(
            ActionRejected.InvalidActionCode,
            "Ping is not a game action"
          )
        )

  /** Projects one viewer's view from a room and its live client registry. */
  private def viewFor(
      managed: ManagedRoom[F],
      viewerId: String
  ): F[PlayerGameView] =
    (managed.state.get, managed.clients.get, nowMs).mapN { (room, clients, now) =>
      project(room, clients.map(_.playerId).toSet, viewerId, now)
    }

  /**
   * Projects `room` for one viewer at `nowMs`. Both the REST view and every
   * broadcast frame go through this one function, so `GET /api/games/:gameId`
   * and the `/ws/games/:gameId` `gameViewUpdate` payload can never disagree.
   */
  private def project(
      room: GameRoom,
      connectedPlayerIds: Set[String],
      viewerId: String,
      nowMs: Long
  ): PlayerGameView =
    room.gameState match
      case None =>
        PlayerGameView.forWaitingRoom(
          gameId = room.gameId,
          config = room.configView,
          seats = room.seatViews,
          viewerId = viewerId,
          connectedPlayerIds = connectedPlayerIds
        )
      case Some(state) =>
        PlayerGameView.forViewer(
          gameId = room.gameId,
          config = room.configView,
          seats = room.seatViews,
          state = state,
          viewerId = viewerId,
          connectedPlayerIds = connectedPlayerIds,
          turnDeadlineMs = room.turnDeadlineEpochMs,
          nowMs = nowMs
        )

  /**
   * Sends one freshly projected [[PlayerGameView]] per client. Each frame is
   * built for that client's own `playerId`, so Player A never receives Player
   * B's hand and a spectator always receives `hand = Nil`.
   */
  private def broadcastViews(
      managed: ManagedRoom[F],
      exceptClientIds: Set[String] = Set.empty
  ): F[Unit] =
    (managed.state.get, managed.clients.get).flatMapN { (room, clients) =>
      val connected = clients.map(_.playerId).toSet
      nowMs.flatMap { now =>
        clients
          .filterNot(client => exceptClientIds.contains(client.clientId))
          .traverse_ { client =>
            client.queue.offer(
              WsServerMessage.GameViewUpdate(project(room, connected, client.playerId, now))
            )
          }
      }
    }

  /** Snapshots the open pool and publishes it to every lobby subscriber. */
  private def publishLobby: F[Unit] =
    listOpenPublicRooms.flatMap(open => lobbyTopic.publish1(open).void)

  private def openPublicRooms(
      all: Map[String, ManagedRoom[F]]
  ): F[List[LobbyRoomSummary]] =
    all.values.toList
      .traverse(_.state.get)
      .map { rooms =>
        rooms
          .filter(room =>
            room.config.isPublic && room.status == RoomStatus.WaitingForPlayers
          )
          .sortBy(_.createdAtEpochMs)
          .map(_.lobbySummary)
      }

  private def removeRoom(managed: ManagedRoom[F]): F[Unit] =
    for
      room <- managed.state.get
      _ <- rooms.update(_ - room.gameId)
      clients <- managed.clients.get
      _ <- clients.traverse_(_.stop.complete(Right(())).void)
      _ <- stopClock(managed)
      _ <- stopBots(managed)
    yield ()

  /**
   * Starts the room's turn monitor exactly once. The monitor re-reads the room
   * every [[clockPollInterval]] and enforces the deadline through the same
   * serialised path every other mutation uses.
   */
  private def ensureClock(managed: ManagedRoom[F]): F[Unit] =
    if !startTurnClocks then F.unit
    else
      managed.clock.get.flatMap {
        case Some(_) => F.unit
        case None =>
          managed.state.get.flatMap { room =>
            if room.status != RoomStatus.InProgress then F.unit
            else
              F.start(clockLoop(room.gameId)).flatMap { fiber =>
                managed.clock.set(Some(fiber))
              }
          }
      }

  private def stopClock(managed: ManagedRoom[F]): F[Unit] =
    managed.clock.getAndSet(None).flatMap(_.traverse_(_.cancel))

  private def clockLoop(gameId: String): F[Unit] =
    F.defer {
      F.sleep(clockPollInterval) *>
        nowMs.flatMap(now => enforceTurnTimeout(gameId, now).void) *>
        clockLoop(gameId)
    }

  private def freshGameId: F[String] =
    F.defer {
      F.delay(RoomManager.newGameId()).flatMap { candidate =>
        rooms.get.flatMap { current =>
          if current.contains(candidate) then freshGameId else F.pure(candidate)
        }
      }
    }

  private def nowMs: F[Long] =
    F.delay(System.currentTimeMillis())

/** The subscription resource acquired by [[RoomManager.subscribe]]. */
private[rooms] final case class Subscription[F[_]](
    managed: ManagedRoom[F],
    client: ConnectedClient[F],
    view: PlayerGameView
)

object RoomManager:

  /** Characters a shareable game id is drawn from: URL-safe alphanumerics. */
  val GameIdAlphabet: String =
    "abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789"

  /** Length of the short, shareable `/g/:gameId` identifier. */
  val GameIdLength: Int = 8

  /** How long lobby subscribers may lag before they miss an update. */
  private val MaxLobbySubscribers: Int = 64

  /** How often a running room re-checks its turn deadline. */
  val DefaultClockPollInterval: FiniteDuration = 250.millis

  /** The code a move for a missing room is rejected with. */
  val roomNotFoundCode: String = ActionRejected.RoomNotFoundCode

  /** The message a missing room answers with. */
  def unknownRoomMessage(gameId: String): String =
    s"Unknown room: $gameId"

  private val secureRandom = new SecureRandom()

  /** A fresh URL-safe game id (not yet checked for collisions). */
  def newGameId(): String =
    (1 to GameIdLength)
      .map(_ => GameIdAlphabet(secureRandom.nextInt(GameIdAlphabet.length)))
      .mkString

  /** A fresh deterministic-deal seed for a newly started match. */
  def newSeed(): Long = secureRandom.nextLong()

  /**
   * Creates an empty room pool.
   *
   * @param startTurnClocks whether started matches fork their turn monitor.
   * @param clockPollInterval how often that monitor checks the deadline.
   */
  /** How long a bot pauses before each move, so a reviewer can follow the table. */
  val DefaultBotMoveDelay: FiniteDuration = 500.millis

  def create[F[_]: Async](
      startTurnClocks: Boolean = true,
      clockPollInterval: FiniteDuration = DefaultClockPollInterval,
      botMoveDelay: FiniteDuration = DefaultBotMoveDelay,
      devMode: Boolean = true
  ): F[RoomManager[F]] =
    for
      rooms <- Ref.of[F, Map[String, ManagedRoom[F]]](Map.empty)
      lobbyTopic <- Topic[F, List[LobbyRoomSummary]]
      mutex <- Semaphore[F](1)
    yield new RoomManager[F](
      rooms = rooms,
      lobbyTopic = lobbyTopic,
      mutex = mutex,
      startTurnClocks = startTurnClocks,
      clockPollInterval = clockPollInterval,
      botMoveDelay = botMoveDelay,
      devMode = devMode
    )
