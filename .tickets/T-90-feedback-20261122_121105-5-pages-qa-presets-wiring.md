<!-- WAVE:3 -->
# Ticket: Page-Level Wiring & 1-Click QA Scenario Presets (Lobby + Left Sidebar)

## Context & Goal
Complete end-to-end wiring in `GamePage.tsx`, `LobbyPage.tsx`, and `client.ts` so:
1. Multi-card throw-in actions (`ThrowInCards(playerId, cards)`) flow cleanly from `GameTable` through `GamePage` to the backend WebSocket/REST API without any leftover "Throw In" button props;
2. The two new **1-Click QA Scenario Presets** (`throw-in-visibility-3p` and `mega-hand-30`) are exposed in both `LobbyPage.tsx` and the Left Sidebar `[data-zone="sidebar-left"]` `⚡ QA Scenarios` panel in `GamePage.tsx`, allowing a human reviewer to verify all 8 feedback items in under 15 seconds; and
3. Page-level tests validate full Lobby -> Game -> POV-switch flows.

## Target Files
- `frontend/src/pages/GamePage.tsx`
- `frontend/src/pages/LobbyPage.tsx`
- `frontend/src/api/client.ts`
- `frontend/src/__tests__/GamePage.test.tsx`
- `frontend/src/__tests__/LobbyPage.test.tsx`

## Implementation Details
1. **1-Click QA Scenario Presets (`LobbyPage.tsx`, `GamePage.tsx`, `client.ts`):**
   - Add two new preset triggers to the `⚡ QA Scenarios` panel in BOTH `LobbyPage.tsx` and `[data-zone="sidebar-left"]` in `GamePage.tsx` (alongside existing presets like `surrender-half-off` and `3p-redirect-bob`):
     - **`throw-in-visibility-3p`** — Label: `"Throw-In & Visibility (3P)"` (loads the 3P preset from Ticket 1 so the reviewer can immediately test eligible multi-card throw-in + Pass icon as Alice, hidden throw-in outline as Bob the defender, and hidden throw-in outline as Carol with no valid throw-in cards).
     - **`mega-hand-30`** — Label: `"Mega Hand (30 Cards)"` (loads the 30-card hand preset from Ticket 1 so the reviewer can immediately test 20%–80% card overlap with zero overflow, visible rank/suit on every card, tight non-rectangular hand highlight wrapping lifted playable cards, drag visibility, large card sizing, and the compact Surrender icon button).
   - Ensure `client.ts` preset launcher cleanly invokes the backend preset route for these IDs and navigates/loads the live game state in 1 click.
2. **End-to-End `GamePage.tsx` Wiring:**
   - Remove any obsolete "Throw In" button state or callbacks from `GamePage.tsx` (keep `onThrowIn(cards: Card[])` sending the full selected `cards` array in a single `throwInCards` / `ThrowInCards` payload to the backend!).
   - Verify POV switching via the Left Sidebar `PLAYERS` panel (`[data-testid="players-panel"]`) updates `GameTable` immediately so switching between Alice (`p0`), Bob (`p1`), and Carol (`p2`) in `throw-in-visibility-3p` cleanly toggles `[data-testid="throw-in-outline"]` visibility and resets any pending throw-in multi-selection.
   - Verify How-to-Play text (if it mentions throwing in in the Left Sidebar) accurately describes dragging cards to the outline or selecting multiple legal cards and double-clicking to throw them in (and does NOT mention a removed "Throw In" button).
3. **End-to-End Page Tests (`GamePage.test.tsx`, `LobbyPage.test.tsx`):**
   - In `LobbyPage.test.tsx`: assert both new QA Scenario Preset buttons (`Throw-In & Visibility (3P)` and `Mega Hand (30 Cards)`) render and trigger preset creation with `throw-in-visibility-3p` and `mega-hand-30`.
   - In `GamePage.test.tsx`:
     - Assert both new QA Scenario Presets appear in the Left Sidebar `⚡ QA Scenarios` panel.
     - Assert there is NO "Throw In" button rendered anywhere on `GamePage`.
     - Assert Surrender and Pass buttons are accessible by `aria-label` (`Surrender`, `Pass`) with icon-only visuals (no visible `"Surrender"` or `"Pass"` text node).
     - Assert multi-selecting 2 legal throw-in cards and double-clicking sends a single `throwInCards` payload containing both cards.
     - Assert throw-in outline visibility updates correctly across POV states (eligible attacker vs. defender vs. passed player vs. no-valid-cards player).
   - Run `npm test -- --run` (and `sbt -batch test` if desired for full-stack confidence) and fix any issues.

## Mandatory Acceptance Criteria Checklist
- [ ] **ITEM-QA1a / QA1b / QA1c (End-to-End + QA Preset):** "It works, but make the following adjustment: the additional card outline should only be visible to players that can legally play into it. In other words, it should not be visible if a player has no valid cards to throw in, is the defending player, or has already input a pass command." -> Verifiable in 1 click via `Throw-In & Visibility (3P)` in `LobbyPage.tsx` and `GamePage.tsx` Left Sidebar.
- [ ] **ITEM-NEW1 & ITEM-NEW3 (End-to-End + QA Preset):** Tight non-rectangular hand highlight outline + 20%–80% hand overlap containment up to full-deck hand -> Verifiable in 1 click via `Mega Hand (30 Cards)` in `LobbyPage.tsx` and `GamePage.tsx` Left Sidebar.
- [ ] **ITEM-NEW4a / 4b / 4c (End-to-End):** "Remove the "Throw In" button. Instead, cards can be thrown in by dragging them to the additional card outline or double clicking. To throw in multiple cards at once, the player can click to select multiple legal cards to throw in, and then double-click to deploy them all at once." -> Wired end-to-end through `GamePage.tsx` with multi-card payload dispatch and zero "Throw In" button.
- [ ] **ITEM-NEW5 & ITEM-NEW6 (End-to-End):** Compact icon-only theme-matched Surrender and Pass buttons wired cleanly in `GamePage.tsx` without visible "Surrender"/"Pass" word labels.
- [ ] **Tests:** `GamePage.test.tsx` and `LobbyPage.test.tsx` updated and `npm test -- --run` passes cleanly.

