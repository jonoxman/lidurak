package durak.engine

import cats.effect.unsafe.implicits.global
import durak.server.{GameActor, GameRoom}

class ReplayVisibilitySuite extends munit.FunSuite:

  private def card(rank: Rank, suit: Suit = Suit.Spades): Card = Card(suit, rank)

  private def player(id: String, hand: List[Card]): PlayerState =
    PlayerState(id = id, name = id.toUpperCase, hand = hand.toVector)

  /**
   * A three-player room with a fully covered table, so a non-defender may pass
   * without changing anything the table shows.
   */
  private def coveredTableRoom(): GameRoom =
    val room = GameActor
      .create(GameConfig(playerCount = 3, seed = 5L), Vector("P0", "P1", "P2"))
      .unsafeRunSync()
    val six = card(Rank.Six, Suit.Spades)
    val cover = card(Rank.Seven, Suit.Spades)
    val base = room.stateRef.get.unsafeRunSync().copy(
      players = Vector(
        player("p0", List(card(Rank.Ace, Suit.Clubs), card(Rank.King, Suit.Clubs))),
        player("p1", List(card(Rank.Nine, Suit.Spades), card(Rank.Ten, Suit.Spades))),
        player("p2", List(card(Rank.Queen, Suit.Diamonds), card(Rank.Jack, Suit.Diamonds)))
      ),
      talon = Vector.empty,
      bottomTrumpCard = None,
      tablePairs = Vector(TablePair(six, Some(cover))),
      attackerIdx = 0,
      defenderIdx = 1,
      boutPhase = BoutPhase.Defense,
      defenderInitialHandSize = 2,
      turnDeadlineMs = 0L
    )
    room.stateRef.set(base).unsafeRunSync()
    // The scripted position is the replay's deal frame, so it can be verified.
    room.replay.set(GameReplay.initial(room.gameId, base)).unsafeRunSync()
    room

  private def apply(room: GameRoom, action: GameAction): GameState =
    GameActor.applyAction(room, action).unsafeRunSync() match
      case Right(next) => next
      case Left(error) => fail(s"$action was rejected: $error")

  private def replayOf(room: GameRoom): SerializedGame = room.replay.get.unsafeRunSync()

  test("a pass that leaves the table and the phase untouched is not a replay step") {
    val room = coveredTableRoom()

    val after = apply(room, GameAction.PassTurn("p2"))
    GameActor.stopClock(room).unsafeRunSync()

    assertEquals(after.players(2).hasPassed, true)
    assertEquals(after.tablePairs.size, 1)
    assertEquals(after.boutPhase, BoutPhase.Defense)

    val replay = replayOf(room)
    // No visible move happened, so the replay still only holds the deal frame.
    assertEquals(replay.moves, Vector.empty)
    assertEquals(replay.frames.map(_.moveIndex), Vector(0))
    // The transition itself is kept, so the history still replays exactly.
    assertEquals(replay.skippedMoves.size, 1)
    assertEquals(replay.skippedMoves.head.playerId, "p2")
    assertEquals(GameReplay.verifyReplay(replay).map(_.size), Right(2))
  }

  test("the pass that settles the bout is a visible replay step") {
    val room = coveredTableRoom()

    apply(room, GameAction.PassTurn("p2"))
    val settled = apply(room, GameAction.PassTurn("p0"))
    GameActor.stopClock(room).unsafeRunSync()

    assertEquals(settled.tablePairs, Vector.empty)
    assertEquals(settled.boutPhase, BoutPhase.InitialAttack)

    val replay = replayOf(room)
    assertEquals(replay.moves.size, 1)
    assertEquals(replay.moves.head.playerId, "p0")
    assertEquals(replay.frames.map(_.moveIndex), Vector(0, 1))
    assertEquals(replay.frames.last.action, Some(GameAction.PassTurn("p0")))
    assertEquals(replay.frames.last.state.boutPhase, BoutPhase.InitialAttack)
    assertEquals(replay.skippedMoves.size, 1)
    assertEquals(GameReplay.verifyReplay(replay).map(_.size), Right(3))
  }

  test("a completed match never shows a redundant pass between its steps") {
    val room = coveredTableRoom()

    apply(room, GameAction.PassTurn("p2"))
    apply(room, GameAction.PassTurn("p0"))
    GameActor.stopClock(room).unsafeRunSync()

    val replay = replayOf(room)
    replay.frames.foreach { frame =>
      frame.action.foreach { action =>
        action match
          case _: GameAction.PassTurn =>
            val previous =
              replay.frames.filter(_.moveIndex < frame.moveIndex).lastOption.map(_.state)
            previous.foreach { before =>
              assert(
                frame.state.tablePairs != before.tablePairs ||
                  frame.state.boutPhase != before.boutPhase,
                s"frame ${frame.moveIndex} is a no-op pass: ${frame.state.tablePairs}"
              )
            }
          case _ => ()
      }
    }
  }
