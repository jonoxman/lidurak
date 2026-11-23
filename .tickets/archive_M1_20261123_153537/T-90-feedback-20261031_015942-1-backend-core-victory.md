<!-- WAVE:1 -->
# Ticket: Backend Engine Core — Last-Player-Standing Victory, 36-Card Surrender Bug Fix & Conservation Invariant Suite

## 1. Description & Goal
Implement the core Durak engine rules for last-player-standing endgame handling (Item 0), fix the disappearing card bug on surrender while enforcing a strict 36-card conservation invariant across all state transitions (Item 1), and log invalid client actions to server stdout/logger without throwing unhandled exceptions (Item 16).

## 2. Requirements & Specification

### Item 0: Last-Player-Standing Victory Condition
1. **Multiplayer Durak Finish Order:**
   - In 3- and 4-player games, do NOT declare game over when the first player empties their hand.
   - When the talon deck is empty (`talon.isEmpty` / `talonCount == 0`) and a player empties their hand, remove that player from the active turn rotation and append their `PlayerId` to `winners: List[PlayerId]` in the order they finished (first out = 1st place).
   - Continue active gameplay among players who still hold cards until `activePlayersWithCards.size <= 1`.
   - When only 1 player remains with cards, that player is declared the `durak: Option[PlayerId] = Some(lastPlayerId)`.
   - If the final two players empty their hands simultaneously on the exact same defense, `durak = None` (draw) and both are added to `winners`.
2. **Turn Rotation Helpers:**
   - Update `nextActivePlayer`, defender selection, attacker selection, and redirection target selection to strictly skip players who have already emptied their hands after the deck is depleted.
   - Update `PlayerGameView` to expose `winners: List[String]`, `durak: Option[String]`, and each player's status (`active`, `finished`, rank).

### Item 1: Fix Disappearing Card Bug on Surrender & 36-Card Conservation Invariant
1. **Surrender Card Bug Fix:**
   - Audit all surrender and `takeCards` execution paths (both manual surrender actions and automatic surrender transitions).
   - Ensure that whenever a defender takes cards, **every** card currently on the table in `tableBouts` (all attack cards and all defense cards) is transferred into the defender's hand before clearing `tableBouts` and advancing the turn.
   - Verify specifically that when a player with 1 card left faces an uncovered attack card and surrenders, the attacking card(s) and any defending card(s) enter the defender's hand (increasing hand size to >= 2), preventing any false win on the next turn.
2. **Conservation of 36 Cards Invariant:**
   - Create a comprehensive property/unit test suite verifying that after **every** action (`attack`, `cover`, `redirect`, `throwIn`, `passTurn`, `declareSurrender`, and talon draw), the total sum of cards across the game strictly equals 36:
     ```scala
     talon.size + discardPile.size + players.map(_.hand.size).sum + tableBouts.flatMap(b => b.attack :: b.defense.toList).size == 36
     ```
   - Test this invariant across simulated full game playthroughs until termination.

### Item 16: Server Logging of Invalid Actions
- When receiving an invalid action from a player, log a descriptive warning to server stdout/SLF4J logger (e.g., `"Invalid action [ActionType] from player [playerId]: [reason]"`).
- Return an HTTP/WebSocket error response without crashing or corrupting game state.

## 3. Files to Touch
- `backend/src/main/scala/durak/engine/GameState.scala`
- `backend/src/main/scala/durak/engine/GameEngine.scala`
- `backend/src/main/scala/durak/engine/PlayerGameView.scala`
- `backend/src/main/scala/durak/engine/JsonCodecs.scala`
- `backend/src/main/scala/durak/server/GameActor.scala`
- `backend/src/main/scala/durak/server/GameRoutes.scala`
- `backend/src/test/scala/durak/engine/EndgameSuite.scala`
- `backend/src/test/scala/durak/engine/SurrenderThrowInSuite.scala`
- `backend/src/test/scala/durak/engine/GameStateSuite.scala`

## 4. Verification & Testing
- Run `sbt -batch test` to ensure all existing and new tests pass.
- Verify specific test scenarios:
  1. 3-player game: Player 1 empties hand with talon empty -> Player 1 is in `winners`, game continues between Player 2 and Player 3 until one empties hand and the other is `durak`.
  2. Defender surrenders with 1 card left -> defender hand contains initial card + all table cards (strictly >= 2 cards).
  3. 36-card conservation test suite passing across all action permutations.

## 5. Autonomous Agent Workflow Steps
1. Run `git status` and `git diff` to inspect current state.
2. Implement backend changes in Scala files under `backend/src/main/scala/durak/`.
3. Add and run test suites with `sbt -batch test`.
4. Document implemented features in `.reviews/agent_notes.md`.
5. Signal completion: `echo "DONE" > .tickets/STATUS`.
