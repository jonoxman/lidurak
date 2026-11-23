<!-- WAVE:1 -->
# T-02: Strict `PlayerGameView` Anti-Cheat Projection & WebSocket Protocol ADTs

## Goal
Implement the zero-trust server-to-client state projection (`PlayerGameView.forViewer`) and Circe-serialized WebSocket protocol ADTs so that opponent hands and the hidden `talon` card order can NEVER be serialized or transmitted to any client (player or spectator).

## Scope & Owned Files
Create new files strictly under:
- `backend/src/main/scala/durak/protocol/PlayerGameView.scala`
- `backend/src/main/scala/durak/protocol/WsProtocol.scala`
- `backend/src/main/scala/durak/protocol/ProtocolCodecs.scala`
- `backend/src/test/scala/durak/protocol/PlayerGameViewSpec.scala`

> **Do NOT edit** `durak/engine/*` (read existing engine types and map from them cleanly), `Main.scala`, `README.md`, or `ARCHITECTURE.md`.

## Design Details
1. **Strict Projection Models (`PlayerGameView.scala`):**
   - `RoomStatus`: enum `WaitingForPlayers`, `InProgress`, `Finished`.
   - `RoomConfigView(playerCount: Int, allowRedirect: Boolean, turnTimeoutSeconds: Int, isPublic: Boolean)`.
   - `PublicPlayerSummary(id: String, name: String, rating: Option[Int], cardCount: Int, isConnected: Boolean, hasPassed: Boolean, finishRank: Option[Int], seatIndex: Int)`.
   - `RoomSeatView(seatIndex: Int, playerId: Option[String], displayName: Option[String], isConnected: Boolean)`.
   - `PlayerGameView`:
     - `gameId: String`
     - `status: RoomStatus`
     - `config: RoomConfigView`
     - `viewerId: String`
     - `viewerSeat: Option[Int]` (`Some(seatIndex)` for seated players, `None` for spectators)
     - `hand: List[Card]` (strictly the viewer's own cards; `Nil` when `viewerSeat.isEmpty` or `status == WaitingForPlayers`)
     - `players: Vector[PublicPlayerSummary]` (strictly public counts & status; NO card lists)
     - `seats: Vector[RoomSeatView]`
     - `tablePairs: Vector[TablePair]` (referencing the existing engine `TablePair` / `Card` models)
     - `talonCount: Int`
     - `bottomTrumpCard: Option[Card]` (`Some(card)` strictly while `talonCount >= 1`, `None` when `talonCount == 0`)
     - `trumpSuit: Option[Suit]` (always `Some(suit)` once dealt, even after `bottomTrumpCard` is drawn and `talonCount == 0`)
     - `discardCount: Int`
     - `phase: Option[String]`
     - `attackerIdx: Option[Int]`
     - `defenderIdx: Option[Int]`
     - `maxBoutAttacks: Int`
     - `finishOrder: Vector[String]`
     - `isDraw: Boolean`
     - `durakId: Option[String]`
     - `turnDeadlineEpochMs: Option[Long]`
   - Pure projection functions:
     - `PlayerGameView.forWaitingRoom(...)`: builds view while `status == WaitingForPlayers` (`hand = Nil`, `talonCount = 0`, `bottomTrumpCard = None`, populated `seats`).
     - `PlayerGameView.forViewer(gameId, config, seats, state, viewerId, connectedPlayerIds, turnDeadlineEpochMs)`:
       - Resolves `viewerSeat` by matching `viewerId` against `seats`.
       - Extracts `hand` strictly from `state.players(seatIdx).hand` iff `viewerSeat == Some(seatIdx)`, else `Nil`.
       - Maps every player in `state.players` to `PublicPlayerSummary` with `cardCount = p.hand.size`, `isConnected = connectedPlayerIds.contains(seatPlayerId)`, `hasPassed`, and 1-based `finishRank` derived from `state.finishOrder`.
       - Projects `talon` strictly to `talonCount = state.talon.size`, `bottomTrumpCard = if (state.talon.nonEmpty) state.bottomTrumpCard else None`, and `trumpSuit = Some(state.trumpSuit)`.
2. **WebSocket & Lobby Protocol ADTs (`WsProtocol.scala` & `ProtocolCodecs.scala`):**
   - `LobbyRoomSummary(gameId: String, hostName: String, playerCount: Int, filledSeats: Int, allowRedirect: Boolean, turnTimeoutSeconds: Int, createdAtEpochMs: Long, isQuickPair: Boolean)`.
   - `WsClientMessage` (tagged JSON with `"type"` field):
     - `PlayAttack(cards: List[Card])`
     - `CoverCard(attackIndex: Int, defenseCard: Card)`
     - `RedirectAttack(cards: List[Card])`
     - `ThrowInCards(cards: List[Card])`
     - `DeclareSurrender`
     - `PassTurn`
     - `Ping`
   - `WsServerMessage` (tagged JSON with `"type"` field):
     - `GameViewUpdate(view: PlayerGameView)`
     - `ActionRejected(code: String, message: String)`
     - `LobbySnapshot(rooms: List[LobbyRoomSummary])`
     - `LobbyUpdated(rooms: List[LobbyRoomSummary])`
     - `MatchFound(gameId: String)`
     - `Pong`
   - Circe codecs encoding/decoding all protocol types cleanly and deterministically. Raw `GameState` MUST NOT be a member of any `WsServerMessage`.

## Mandatory Acceptance Criteria Checklist
- [ ] **REQ-03:** `PlayerGameView.forViewer` exposes `hand: List[Card]` strictly for the matching `viewerId` seat and returns `hand = Nil` and `viewerSeat = None` for spectators.
- [ ] **REQ-03:** All players are represented strictly by `PublicPlayerSummary(id, name, rating, cardCount, isConnected, hasPassed, finishRank, seatIndex)`; opponent hand cards never exist in `PlayerGameView`.
- [ ] **REQ-03:** Anti-cheat JSON serialization test inspects the serialized JSON string of `PlayerGameView.forViewer(state, playerA)` and asserts that ZERO cards unique to Player B / Player C / Player D hands appear anywhere in the JSON payload.
- [ ] **REQ-04:** `talon` is projected strictly to `talonCount: Int`, `bottomTrumpCard: Option[Card]` (strictly `Some` when `talonCount >= 1` and `None` when `talonCount == 0`), and `trumpSuit: Option[Suit]` (persists even when `talonCount == 0`).
- [ ] **REQ-04:** Anti-cheat JSON serialization test asserts that hidden cards in `state.talon` (excluding `bottomTrumpCard`) NEVER appear anywhere in the serialized `PlayerGameView` JSON payload.
- [ ] **REQ-04:** `WsClientMessage` and `WsServerMessage` Circe codecs round-trip cleanly and never expose raw `GameState`.
- [ ] All backend tests pass cleanly via `cd backend && sbt -batch test`.

## Verification Commands
```bash
cd backend && sbt -batch test
```

