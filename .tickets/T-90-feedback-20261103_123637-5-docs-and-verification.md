<!-- WAVE:3 -->
# Ticket T-90-5: Living Documentation Synchronization (`README.md`, `ARCHITECTURE.md`, `play-local.sh`) & Full-Stack Verification

## Summary
Synchronize `./README.md`, `./ARCHITECTURE.md`, and `./play-local.sh` with all newly implemented features and run both the backend (`sbt -batch test`) and frontend (`npm test -- --run`) test suites to verify full-stack green status.

## Files to Modify
- `README.md`
- `ARCHITECTURE.md`
- `play-local.sh` (verify executable & up to date)

## Mandatory Acceptance Criteria Checklist
- [ ] **Living Documentation Updates (`README.md` & `ARCHITECTURE.md`):**
  - Document **Previous Item Response #7**: In the `DECK` box discard pile, the face-up cards from the last finished bout (`[data-testid="discard-visible-row"]`) overlap the stationary face-down discard stack (`[data-testid="discard-facedown-stack"]`) with the leftmost revealed card overlapping at the maximally allowed margin and the remaining revealed cards spread evenly across the space (hover sliding only when too many face-up cards to fit).
  - Document **Additional Feedback Response #1**: Realistic clockwise opponent box placement in Row 1 relative to the active user's POV (`offset = (seatIdx - myIdx + N) % N`: in 3P, when Alice `p0` is active, Bob `p1` is at `top-left` and Carol `p2` is at `top-right`; when Bob `p1` is active, Carol `p2` is at `top-left` and Alice `p0` is at `top-right`), with redirect arrows and anchors matching the relative seats.
  - Document **Additional Feedback Response #2**: Soft diffused glow on attacking (`data-role="attacker"`) and defending (`data-role="defender"`) player rows (`li.status-badge`) in the `PLAYERS` list, with no inner outline around `.status-name`.
  - Document **Additional Feedback Response #4**: `Surrender Half-Off` QA scenario starting in `BoutPhase.Defense` with a clickable `Surrender` button and legal throw-ins so clicking `Surrender` transitions to `BoutPhase.SurrenderThrowIn` and moves `.table-pairs-group` half-on (50%) and half-off (50%) the border of `.battlefield-tinted-box` toward the surrendering player's box.
  - Document **Additional Feedback Response #8**: `PlayerGameView` exposing `myHasPassed` and `myFinishRank` so the active user's row in `PLAYERS` displays `WINNER`, `OUT`, `PASSED`, and `DURAK`, and the strict guard that no player with `cardCount > 0` ever displays `OUT` or `WINNER`.
  - Document **New Additional Specifications #1, #2, #3**:
    - `Roundness` slider (`--app-roundness`) affecting all game table elements, borders, and face-up/face-down card SVGs (`Card.tsx`, `CardBack.tsx`, `table.css`).
    - Compact single-row (`flex-wrap: nowrap`) card placement in the play area anchored near the defender with dynamic overlap preserving at least `22px` of every card's left rank/suit strip.
    - Fancier, serifed font stack on card sprite numbers (`2`–`10`) and letters (`J`, `Q`, `K`, `A`).
- [ ] **Full-Stack Test Suite Execution:**
  - Run `cd backend && sbt -batch test` and confirm 0 failures.
  - Run `cd frontend && npm test -- --run` and confirm 0 failures.
