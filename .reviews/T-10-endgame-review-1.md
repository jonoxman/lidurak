### Review Summary

The changes in this diff implement the endgame, player elimination, Durak crowning, and 2-player draw detection logic for Durak as specified in **T-10**.

#### Key Changes Reviewed
1. **Endgame Resolution in `GameEngine.scala`**:
   - `eliminateEmptyHands`: When `talon.isEmpty`, active players with empty hands are eliminated in seat order, assigned consecutive `finishRank`s, and appended to `finishOrder`.
   - `crownDurak`: Correctly assigns the highest `finishRank` to the last remaining player holding cards and records them in `finishOrder`.
   - `isTwoPlayerDraw`: Handles the 2-player simultaneous draw condition on successful defense when the talon is empty, setting `isDraw = true`, awarding both players equal `finishRank`, and setting `boutPhase = GameOver`.
   - Role rotation post-bout properly accounts for eliminated defenders by skipping inactive players (`!roster.players(defenderIdx).isActive`).
   - `passTurn`: Includes idempotency handling via `boutAlreadySettled` when non-defenders have already auto-passed after a surrender.

2. **Test Coverage in `EndgameSuite.scala`**:
   - Comprehensive unit test coverage matching all ticket specifications:
     - Elimination tests (single finisher, seat order for simultaneous finishers, ranks continuing from previous bouts).
     - Durak detection (phase transition to `GameOver`, highest `finishRank`).
     - 2-player draw scenario.
     - Multi-player 3- and 4-player progression across multiple bouts.
     - Deterministic full 2-player game simulation test with fixed seed.

All acceptance criteria are satisfied, the implementation is clean, and the tests pass.

VERDICT: APPROVED
