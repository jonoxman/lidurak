<!-- WAVE:1 -->
# T-90-feedback-20261124_002056-1: Backend Multiplayer Projection & RoomManager Support for Full Milestone 1 Gameplay UI

## Context & Objective
To replace the lightweight Milestone 2 placeholder game screen with the full original Milestone 1 gameplay interface (`GamePage.tsx` / `GameTable.tsx`), the multiplayer `durak.protocol.PlayerGameView` payload and `RoomManager` must provide all public and viewer-safe gameplay metadata expected by the M1 UI (legal actions, throw-in eligibility/capacity, eligible attack/redirect targets, discard pile count & last discard cards, turn clock deadline & seconds remaining, finish order, winners, durak, draw status, defender-defenseless state, prompted players, seat presence/turn status) while **strictly preserving zero-leak anti-cheat** (opponent hands and undealt talon cards must NEVER appear in serialized JSON for seated players or spectators).

## Mandatory Acceptance Criteria Checklist
- [ ] **ITEM-4a (Verbatim — New #3 Backend Foundation):** "Hook in the original gameplay interface as was developed in Milestone 1 for all gameplay elements. The current lightweight placeholder interface should be removed from the project completely."
- [ ] **Complete Viewer-Safe M1 Projection (`backend/src/main/scala/durak/protocol/PlayerGameView.scala` & `ProtocolCodecs.scala`):**
  - Enrich `durak.protocol.PlayerGameView` (while retaining existing M2 room metadata fields: `gameId`, `status`, `config`, `seats`, `viewerSeat`, `players`, `hand`) with all public/viewer-safe fields needed by M1 `GamePage.tsx` and `GameTable.tsx` when a match is `InProgress` or `Finished`:
    - `tablePairs`, `talonCount`, `bottomTrumpCard`, `trumpSuit`, `attackerIdx`, `defenderIdx`, `boutPhase`, `maxBoutAttacks`
    - `legalActions` (computed specifically for the authenticated viewer's seat; empty list `Nil` for spectators or `WaitingForPlayers`)
    - `finishOrder`, `isDraw`, `winners`, `durak`
    - `turnPlayerId`, `turnDeadlineMs`, `turnSecondsRemaining`, `defenderDefenseless`, `promptedPlayerIds`
    - `discardCount`, `lastDiscardCards`, `gameStartedAtMs`, `gameEndedAtMs`
    - `eligibleTargetIds`, `redirectTargetId`, `throwInCards`, `throwInCapacity`, `canThrowIn` (computed only for the viewer's own seat; empty/false for spectators)
    - `myHasPassed`, `myFinishRank`, `myStatus` (or derivable cleanly from `players` + `viewerSeat`)
  - Ensure `PublicPlayerSummary` in `durak.protocol` carries public state (`id`, `name`, `rating`, `cardCount`, `isConnected`, `hasPassed`, `finishRank`, `seatIndex`, `status`, `isTurn`) and NEVER exposes opponent card faces.
- [ ] **Strict Zero-Leak Anti-Cheat Invariant:**
  - For a seated player (`viewerSeat = Some(i)`): only seat `i`'s cards appear in `hand` (and viewer-scoped `throwInCards` which is a subset of `hand`). No opponent cards and no undealt talon cards (other than the public face-up `bottomTrumpCard` when visible) may ever appear anywhere in the serialized JSON.
  - For a spectator (`viewerSeat = None`): `hand` is `Nil`, `legalActions` is `Nil`, `throwInCards` is `Nil`, `canThrowIn` is `false`, and zero hidden cards appear anywhere in the serialized JSON.
- [ ] **Authoritative `RoomManager` Action & Turn-Clock Wiring (`backend/src/main/scala/durak/rooms/RoomManager.scala` & `RoomModels.scala`):**
  - Ensure `RoomManager` supports all M1 `GameAction` variants (`InitialAttack` with optional `targetPlayerId`, `CoverCard`, `RedirectAttack`, `ThrowInCards`, `DeclareSurrender`, `PassTurn`) routed via authenticated seat identity.
  - Populate `gameStartedAtMs` when a room transitions from `WaitingForPlayers` to `InProgress`, `gameEndedAtMs` when transitioning to `Finished` (`BoutPhase.GameOver`), and maintain `turnDeadlineMs` using `room.config.turnTimeoutSeconds * 1000L` whenever the turn/phase advances so `turnSecondsRemaining` counts down accurately for the M1 right-sidebar `00:XX` digital clock.
  - Ensure `RoomManager.forViewer` / projection builds the enriched `PlayerGameView` consistently for both `GET /api/games/:gameId` and `/ws/games/:gameId` `gameViewUpdate` broadcasts.
- [ ] **End-to-End Wiring Points:**
  - `backend/src/main/scala/durak/protocol/PlayerGameView.scala` (`PlayerGameView.fromRoom` / projection factory)
  - `backend/src/main/scala/durak/protocol/ProtocolCodecs.scala` (Circe encoders/decoders for enriched `PlayerGameView` and `PublicPlayerSummary`)
  - `backend/src/main/scala/durak/rooms/RoomManager.scala` & `RoomModels.scala` (match start timestamps, turn clock deadline updates, full `GameAction` execution, per-viewer broadcast)
- [ ] **Do NOT modify** `README.md`, `ARCHITECTURE.md`, `QuickPairingService.scala`, `MultiplayerRoutes.scala`, `QaPresetRoutes.scala`, `WsProtocol.scala`, or any `frontend/` files in this ticket.

## Scope & Files
- `backend/src/main/scala/durak/protocol/PlayerGameView.scala`
- `backend/src/main/scala/durak/protocol/ProtocolCodecs.scala`
- `backend/src/main/scala/durak/rooms/RoomManager.scala`
- `backend/src/main/scala/durak/rooms/RoomModels.scala`
- `backend/src/test/scala/durak/protocol/PlayerGameViewSpec.scala`
- `backend/src/test/scala/durak/rooms/RoomManagerSpec.scala`

## Verification Plan
1. Update/add tests in `PlayerGameViewSpec.scala` asserting all M1 projection fields (`legalActions`, `eligibleTargetIds`, `redirectTargetId`, `throwInCards`, `throwInCapacity`, `canThrowIn`, `turnDeadlineMs`, `turnSecondsRemaining`, `discardCount`, `lastDiscardCards`, `finishOrder`, `winners`, `durak`, `isDraw`, `promptedPlayerIds`, `defenderDefenseless`) serialize cleanly and never leak opponent hands or undealt talon cards for players or spectators.
2. Update/add tests in `RoomManagerSpec.scala` verifying turn deadline initialization on match start, all `GameAction` variants executing cleanly, `gameEndedAtMs` & `RoomStatus.Finished` transitions, and individualized per-viewer projections.
3. Run `cd backend && sbt -batch test` and ensure all tests pass with zero warnings/errors.
4. Write concise summary in `.reviews/agent_notes.md`, then run `echo "DONE" > .tickets/STATUS`.
