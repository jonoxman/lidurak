package durak.rooms

import cats.effect.{Async, Deferred, Fiber, Ref, Resource}
import cats.effect.std.{Queue, Semaphore}
import cats.syntax.all.*
import durak.engine.{GameAction, GameConfig, GameEngine, GameState}
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
    clock: Ref[F, Option[Fiber[F, Throwable, Unit]]]
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
 */
final class RoomManager[F[_]](
    rooms: Ref[F, Map[String, ManagedRoom[F]]],
    lobbyTopic: Topic[F, List[LobbyRoomSummary]],
    mutex: Semaphore[F],
    startTurnClocks: Boolean,
    clockPollInterval: FiniteDuration
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
    config.validate match
      case Left(error) => F.pure(Left(error))
      case Right(valid) =>
        nowMs.flatMap { now =>
          mutex.permit.use { _ =>
            freshGameId.flatMap { gameId =>
              val hostSeat =
                SeatSlot(0, Some(host.playerId), Some(host.displayName))
              val room = GameRoom(
                gameId = gameId,
                config = valid,
                status = RoomStatus.WaitingForPlayers,
                seats = Vector.tabulate(valid.playerCount) { seatIndex =>
                  if seatIndex == 0 then hostSeat
                  else SeatSlot(seatIndex, None, None)
                },
                gameState = None,
                turnDeadlineEpochMs = None,
                createdAtEpochMs = now,
                hostName = host.displayName
              )
              for
                managed <- newManaged(room)
                _ <- rooms.update(_.updated(gameId, managed))
                _ <- publishLobby
              yield Right((room, 0))
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
      initialHandSize: Int = GameEngine.DefaultHandSize
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
                val seats = Vector.tabulate(valid.playerCount) { seatIndex =>
                  prefilledSeats.lift(seatIndex) match
                    case Some((playerId, displayName)) =>
                      SeatSlot(seatIndex, Some(playerId), Some(displayName))
                    case None =>
                      SeatSlot(seatIndex, None, None)
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
                      startRoom(base, seed, now, initialHandSize)
                    else F.pure(base)
                  managed <- newManaged(stored)
                  _ <- rooms.update(_.updated(gameId, managed))
                  _ <- ensureClock(managed)
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
                    seats = room.seats.updated(seatIdx, SeatSlot(seatIdx, None, None))
                  )
                  val stillOccupied = vacated.seats.exists(_.isOccupied)
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
                toGameAction(senderPlayerId, action) match
                  case Left(rejected) => F.pure(Left(rejected))
                  case Right(engineAction) =>
                    GameEngine.applyAction(state, senderPlayerId, engineAction) match
                      case Left(reason) =>
                        F.pure(Left(ActionRejected.illegalMove(reason)))
                      case Right(next) =>
                        val now = System.currentTimeMillis()
                        val updated = afterMove(room, next, now)
                        for
                          _ <- managed.state.set(updated)
                          _ <- broadcastViews(managed)
                          _ <- publishLobby
                        yield Right(())
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
    yield ManagedRoom(state, clients, clock)

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
      initialHandSize: Int = GameEngine.DefaultHandSize
  ): F[GameRoom] =
    seedOverride match
      case Some(seed) => F.pure(deal(room, seed, now, initialHandSize))
      case None       => F.delay(deal(room, RoomManager.newSeed(), now, initialHandSize))

  private def deal(
      room: GameRoom,
      seed: Long,
      now: Long,
      initialHandSize: Int = GameEngine.DefaultHandSize
  ): GameRoom =
    val engineConfig = GameConfig(
      playerCount = room.config.playerCount,
      allowRedirect = room.config.allowRedirect,
      seed = seed
    )
    val names = room.seats.map(seat => seat.displayName.getOrElse("Player"))
    val dealt = GameEngine.createGame(engineConfig, names, initialHandSize)
    val seated = dealt.copy(
      players = dealt.players.zip(room.seats).map { case (player, seat) =>
        player.copy(
          id = seat.playerId.getOrElse(player.id),
          name = seat.displayName.getOrElse(player.name)
        )
      }
    )
    room.copy(
      status = RoomStatus.InProgress,
      gameState = Some(seated),
      turnDeadlineEpochMs = deadlineFor(seated, room.config.turnTimeoutSeconds, now)
    )

  /**
   * The room after a legal move: the engine state is stored, a finished match
   * becomes [[RoomStatus.Finished]] with no running clock, and a running one
   * gets a fresh deadline for whoever is on the clock now.
   */
  private def afterMove(room: GameRoom, next: GameState, now: Long): GameRoom =
    if next.isGameOver then
      room.copy(
        gameState = Some(next),
        status = RoomStatus.Finished,
        turnDeadlineEpochMs = None
      )
    else
      room.copy(
        gameState = Some(next),
        status = RoomStatus.InProgress,
        turnDeadlineEpochMs = deadlineFor(next, room.config.turnTimeoutSeconds, now)
      )

  /** The single definition of when the current turn expires. */
  private def deadlineFor(
      state: GameState,
      turnTimeoutSeconds: Int,
      now: Long
  ): Option[Long] =
    if state.isGameOver || state.promptedPlayerIds.isEmpty then None
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
    (managed.state.get, managed.clients.get).mapN { (room, clients) =>
      project(room, clients.map(_.playerId).toSet, viewerId)
    }

  private def project(
      room: GameRoom,
      connectedPlayerIds: Set[String],
      viewerId: String
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
          turnDeadlineEpochMs = room.turnDeadlineEpochMs
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
      clients
        .filterNot(client => exceptClientIds.contains(client.clientId))
        .traverse_ { client =>
          client.queue.offer(
            WsServerMessage.GameViewUpdate(project(room, connected, client.playerId))
          )
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
  def create[F[_]: Async](
      startTurnClocks: Boolean = true,
      clockPollInterval: FiniteDuration = DefaultClockPollInterval
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
      clockPollInterval = clockPollInterval
    )
