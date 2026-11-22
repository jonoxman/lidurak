<!-- WAVE:1 -->
# Ticket: Prune & Curate Backend QA Scenario Presets for Current QA Round

## Context & Objective
Reduce the backend QA Scenario Preset catalog (`GameManager.scala` and `GameRoutes.scala`) by removing obsolete presets from previous rounds that are not needed for this round of QA testing (Item #9), and replace them with a minimal, high-signal set of **4 curated presets** that allow a human reviewer to verify every single non-deferred item in this round (Items #2, #3, #4, #5, #6, #7, #8) in under 15 seconds.

## Target Files (Backend ONLY — Do Not Touch `frontend/`, `README.md`, or `ARCHITECTURE.md`)
- `backend/src/main/scala/durak/server/GameManager.scala`
- `backend/src/main/scala/durak/server/GameRoutes.scala` (if preset metadata/endpoints reference preset names)
- `backend/src/test/scala/durak/server/PresetSuite.scala`
- `backend/src/test/scala/durak/server/GameRoutesSuite.scala`
- Any other backend test suite under `backend/src/test/scala/` that directly references removed preset IDs (inline local test fixtures into those suites rather than keeping obsolete presets in `GameManager`).

## Curated 4-Preset Catalog Specification
Remove all legacy presets from `GameManager` / `GameRoutes` and expose **exactly these 4 QA Scenario Presets** (each with an active live turn clock so Item #4 timer visibility is testable immediately):

1. **`qa-normal-6-actions`** — `"6-Card 10s & Actions"`
   - 3-player game (`Alice` `p0`, `Bob` `p1`, `Carol` `p2`, all human hotseat seats, `BoutPhase.Defense`, non-empty talon, `trumpSuit = Hearts`).
   - Table has 1 uncovered attack card (`Card(Spades, Rank.Ten)` or `Card(Clubs, Rank.Eight)` — ensure `Ten` appears both on table and in hands, e.g., table has `TablePair(Card(Spades, Rank.Eight), None)` or `TablePair(Card(Spades, Rank.Ten), None)`).
   - Defender (`p1`, Bob — active turn player with active turn clock) holds **exactly 6 cards** including multiple `'10'`s (e.g., `10♥`, `10♦`, `9♠`, `J♠`, `6♣`, `7♦`), containing BOTH eligible playable covers AND ineligible unplayable cards, with `"surrender"` in `legalActions` (tests Items #2, #3, #4, #5 default 6-card box, #6 hover parting, #7 Surrender button in lower table area, #8 two-tier raise).
   - Attacker (`p0`, Alice — 1-click hotseat switch) holds **exactly 6 cards** including matching-rank cards (e.g., two `'10'`s matching the table rank plus non-matching cards) so Alice has `"pass"` and `"throwIn"` in `legalActions` with multi-select throw-in capability (tests Item #7 Pass button in lower table area, Item #8 two-tier eligible vs multi-selected raise, Item #2 `'10'` font/suit, Item #3 drag).
   - Carol (`p2`) holds 6 cards.

2. **`qa-medium-14-expand`** — `"14-Card Expand Box"`
   - 2-player game (`Alice` `p0`, `Bob` `p1`, human hotseat, `BoutPhase.InitialAttack`, active turn clock on `p0`, non-empty talon).
   - `p0` holds **14 cards** containing all four `'10'`s (`10♠`, `10♥`, `10♦`, `10♣`) plus 10 varied cards (including additional pairs for multi-select testing).
   - Tests Item #5 Option B expansion beyond the default 6-card box toward the maximal box at full card size, Item #2 full `'10'` rank & enlarged suit visibility at max allowable overlap, Item #3 zero horizontal drag offset across a wider hand, Item #4 timer clearance above raised/selected cards, Item #6 hover parting, and Item #8 two-tier raise.

3. **`qa-large-30-compress`** — `"30-Card Compress & Part"`
   - 2-player game (`Alice` `p0`, `Bob` `p1`, human hotseat, `BoutPhase.Defense`, active turn clock on defender `p0`, small remaining talon, 1 uncovered attack card on table such as `Card(Clubs, Rank.Nine)`).
   - Defender `p0` holds **30 cards** (including all four `'10'`s, mixing playable covers and unplayable low cards) with `"surrender"` in `legalActions`.
   - Tests Item #5 constant full card size with overlap compressed beyond maximal allowable overlap inside the maximal box, Item #6 smooth hover parting & stationary hovered card on a densely overlapping hand, Item #3 rightmost-card drag tracking, Item #4 timer clearance above raised/selected cards, Item #7 lower-table Surrender button with zero overlap against a maximal-width hand, and Item #8 two-tier vertical raise.

4. **`qa-single-card`** — `"1-Card Hand (No Part)"`
   - 2-player game (`Alice` `p0`, `Bob` `p1`, human hotseat, `BoutPhase.InitialAttack`, active turn clock on `p0`, empty talon).
   - `p0` holds **exactly 1 card**: `Card(Spades, Rank.Ten)`.
   - `p1` holds 2 cards (e.g., `Card(Hearts, Rank.Ace)`, `Card(Diamonds, Rank.King)`).
   - Tests Item #6 1-card hover-parting suppression, Item #2 `'10'` rank font size & enlarged suit, Item #3 drag tracking, Item #4 timer clearance, and Item #8 two-tier raise.

## Mandatory Acceptance Criteria Checklist
- [ ] **ITEM-9:** Reduce the number of QA scenarios in `GameManager.scala` / `GameRoutes.scala`, removing all obsolete presets not needed for the current round of QA testing so the preset catalog exposes ONLY the 4 curated scenarios (`qa-normal-6-actions`, `qa-medium-14-expand`, `qa-large-30-compress`, `qa-single-card`).
- [ ] Every preset initializes a valid, rule-compliant `GameState` (no duplicate cards across hands/talon/table/discard) with an active turn clock (`turnDeadlineMs > 0L` when players are present / on creation).
- [ ] `qa-normal-6-actions` provides both a defender with `"surrender"` and an attacker with `"pass"` + multi-select `"throwIn"`, with 6-card hands containing `'10'`s and mixed playable/unplayable cards.
- [ ] `qa-medium-14-expand` provides a 14-card hand with all four `'10'`s and selectable pairs in `InitialAttack`.
- [ ] `qa-large-30-compress` provides a 30-card defending hand with all four `'10'`s, mixed playable/unplayable cards, and `"surrender"` available.
- [ ] `qa-single-card` provides a 1-card hand (`10♠`) in `InitialAttack` for verifying single-card hover-parting suppression.
- [ ] Update `PresetSuite.scala`, `GameRoutesSuite.scala`, and any other backend test suites referencing removed preset IDs (inlining local fixtures where engine tests depended on old presets).
- [ ] Run `cd backend && sbt -batch test` and verify 100% of backend tests pass with zero errors.
- [ ] Do NOT edit `frontend/`, `README.md`, `ARCHITECTURE.md`, or `./play-local.sh`.
