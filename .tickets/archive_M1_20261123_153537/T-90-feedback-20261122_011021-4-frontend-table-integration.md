<!-- WAVE:2 -->
# T-90-feedback-20261122_011021-4-frontend-table-integration: Live Table Wiring — Throw-In Visibility Gating, Full-Size Cards CSS, Tight Hand Contour, 20%–80% Hand Overlap, Multi-Card Throw-In, Compact Icon Buttons & QA Presets

## Scope & Owned Files
Modify these frontend files to wire all Wave 1 backend & frontend modules end-to-end into the live UI:
- `frontend/src/components/ActionBar.tsx`
- `frontend/src/components/GameTable.tsx`
- `frontend/src/styles/table.css`
- `frontend/src/pages/GamePage.tsx`
- `frontend/src/pages/LobbyPage.tsx`
- `frontend/src/api/client.ts`
- `frontend/src/types.ts` (only if needed for preset/action types)
- `frontend/src/__tests__/GameTable.test.tsx`
- `frontend/src/__tests__/GamePage.test.tsx`
- `frontend/src/__tests__/LobbyPage.test.tsx`

Do NOT touch `README.md`, `ARCHITECTURE.md`, `play-local.sh`, or `backend/`.

## Requirements & Architecture

### 1. Strict Throw-In Outline Visibility Gating (`GameTable.tsx`) (ITEM-1)
- Render `[data-testid="throw-in-outline"]` (and its surrender wrapper `[data-testid="surrender-throw-in-anchor"]` when in `SurrenderThrowIn`) **ONLY** when the active viewing player can legally play a card into it:
  - `view.canThrowIn === true`
  - Viewer is NOT the defender (`myIdx !== view.defenderIdx`)
  - Viewer has NOT already passed (`!view.myHasPassed`)
  - Viewer has at least one legal throw-in card in hand (`(view.throwInCards?.length ?? 0) > 0`)
  - Remaining throw-in capacity > 0 (`(view.throwInCapacity ?? 0) > 0`)
- When ANY of those conditions fail (defender POV, player with no valid throw-in cards, player who has passed, or bout full), `[data-testid="throw-in-outline"]` MUST NOT be rendered in the DOM at all (neither inline nor above/below surrendered cards).
- Preserve the existing surrender placement behavior when visible (below taken cards for opponent surrender, above taken cards for active user surrender — note: when active user is the surrendering defender, the outline will now naturally be hidden for them and visible only to opponents who have legal throw-in cards and haven't passed!).

### 2. Unified Full-Size Cards Matching Outlines (`table.css`, `GameTable.tsx`) (ITEM-2)
- Define and enforce unified CSS custom properties in `table.css`:
  - Desktop (`>= 900px`): `--card-width: 100px; --card-height: 140px; --card-radius: 10px;`
  - Mobile (`< 900px`): `--card-width: 48px; --card-height: 68px; --card-radius: 6px;`
- Apply `width: var(--card-width); height: var(--card-height);` uniformly to:
  - Hand cards in `[data-zone="player-hand"]`
  - Attack & defense cards in `TablePair` inside Row 2 battlefield
  - `[data-testid="throw-in-outline"]` and `[data-testid="redirect-outline"]`
  - Talon deck & bottom trump card in `[data-zone="table-deck"]`
- Audit and remove any stale CSS rules in `table.css` that shrank `.card`, `.hand-card`, or `.table-pair .card` smaller than `--card-width × --card-height`.

### 3. Active Hand 20%–80% Overlap Layout + Tight Non-Rectangular Highlight Contour (`GameTable.tsx`, `table.css`) (ITEM-3 & ITEM-5)
- Replace the old hand card layout and old rectangular hand highlight box inside `[data-zone="player-hand"]` completely (ignoring all past specs for the old highlight box):
- Measure the available width of `[data-zone="player-hand"]` via `ResizeObserver` (with a sensible test/SSR fallback width when `ResizeObserver` returns 0, e.g., `640px` desktop / `300px` mobile).
- Call `computeHandLayout(...)` and `buildHandContourPath(...)` from `frontend/src/utils/handLayout.ts`:
  - Pass the current card count, measured container width, canonical card size (`100×140` desktop / `48×68` mobile), and the set of lifted card indices (playable cards and/or selected cards shifted upward).
  - Position each card cleanly according to the returned layout coordinates inside the hand stage box so all cards overlap between **~20% min and ~80% max** of card width, keeping every card's left-side rank & suit always visible.
  - Even when a player holds **30–52 cards** (verified with `large-hand-stress`), the hand stays 100% inside `[data-zone="player-hand"]` with zero horizontal overflow off-screen and zero overlap onto `[data-zone="table-deck"]`, Row 3 Col 3 controls, or the left/right sidebars!
- Render the tight non-rectangular hand highlight contour as an `<svg data-testid="hand-highlight-contour" data-contour-shape={...}>` containing the `<path d={contour.pathD} />` stacked strictly inside the hand stage using **CSS Grid layer stacking (`grid-area: 1 / 1`)** (following the zero-overlap CSS Grid spatial rules — NEVER using `position: absolute` or `position: fixed` to place seats, hands, bouts, or sidebars!).
  - When playable or selected cards shift upward, the highlight contour immediately distorts non-rectangularly around those exact raised cards and hugs the entire hand tightly at all times.
  - Only show the active highlight glow when the active viewer has legal moves/turn prompt (or consistent with turn-indicator highlighting), keeping it responsive on resize, card play, selection toggle, and POV switch.

### 4. Always-Visible Drag Interaction (`GameTable.tsx`, `table.css`) (ITEM-4)
- Audit `table.css` and `GameTable.tsx` for any `.dragging`, `[data-dragging="true"]`, or drag-state rules that reduce card visibility (`opacity: 0`, `opacity: 0.15`, `visibility: hidden`, etc.) and replace them so dragged cards ALWAYS remain fully visible (`opacity: 1; visibility: visible;`).
- Ensure dragging a card from `[data-zone="player-hand"]` to a target outline, table card, redirect outline, or `[data-testid="throw-in-outline"]` keeps the card clearly visible throughout the entire drag gesture.

### 5. Remove "Throw In" Button & Wire Drag / Double-Click / Multi-Select Batch Throw-In (`ActionBar.tsx`, `GameTable.tsx`, `GamePage.tsx`) (ITEM-6)
- **Remove the `"Throw In"` button completely** from `ActionBar.tsx`, `GameTable.tsx`, and `GamePage.tsx` (no `"Throw In"` button anywhere in the DOM!).
- Wire all three throw-in interactions in `GameTable.tsx` -> `GamePage.tsx`:
  1. **Single-card drag:** Dragging any legal throw-in card onto `[data-testid="throw-in-outline"]` immediately dispatches `ThrowInCards` for that card (or if the dragged card is part of a multi-selection of legal throw-in cards, deploys all selected legal throw-in cards together!).
  2. **Single-card double-click:** Double-clicking a legal throw-in card (when no other throw-in cards are selected) immediately dispatches `ThrowInCards` with `[card]`.
  3. **Multi-card click-select + double-click deploy:**
     - Single-clicking legal throw-in cards toggles their membership in the current selection (`selectedThrowInCards`), enforcing `selected.length <= throwInCapacity` and allowing only cards present in `view.throwInCards`.
     - Selected cards visibly raise upward in the hand (and the tight non-rectangular hand contour from ITEM-3 dynamically wraps around them!).
     - Double-clicking any selected legal throw-in card (or double-clicking a legal throw-in card while others are selected, including it if within capacity) dispatches a single `ThrowInCards` action with ALL selected legal cards at once and clears the selection!
     - Clear stale selections whenever `view.tablePairs`, `view.boutPhase`, `view.myId`, or `view.myHand` changes.

### 6. Compact Theme-Matched Icon-Only Surrender & Pass Buttons (`ActionBar.tsx`, `GameTable.tsx`, `table.css`) (ITEM-7 & ITEM-8)
- Update `ActionBar.tsx` to import and render `SurrenderIcon` and `PassIcon` from `frontend/src/components/icons/` using the compact themed classes from `frontend/src/styles/actionIcons.css`.
- **Surrender button:**
  - Contains ONLY `<SurrenderIcon />` visually — NO visible `"Surrender"` word!
  - Accessible via `aria-label="Surrender"` and `title="Surrender"`, with `data-testid="surrender-button"`.
  - Compact size, styled to match the dark emerald/slate/gold table aesthetic (NO bright red background!).
  - Positioned in the **bottom-right corner of the game table** (Row 3, Col 3 of `[data-zone="table-arena"]`, right-aligned at the bottom alongside/below `SortBar`).
- **Pass button:**
  - Contains ONLY `<PassIcon />` visually — NO visible `"Pass"` word!
  - Accessible via `aria-label="Pass"` and `title="Pass"`, with `data-testid="pass-button"`.
  - Analogous compact size, matching dark table aesthetic, and bottom-right corner placement in Row 3, Col 3 of `[data-zone="table-arena"]`.

### 7. Wire New 1-Click QA Scenario Presets into Lobby & Left Sidebar (`api/client.ts`, `LobbyPage.tsx`, `GamePage.tsx`)
- Add both new Wave 1 backend presets to the `⚡ QA Scenarios` preset list in `api/client.ts`, `LobbyPage.tsx`, and the left sidebar (`[data-zone="sidebar-left"]`) of `GamePage.tsx`:
  1. `throw-in-multi-qa`: **"Throw-In & Multi-Card QA"** (tests ITEM-1 across Alice/Bob/Charlie + Pass, ITEM-6 multi-select & double-click throw-in, ITEM-8 Pass icon, ITEM-2 card sizing).
  2. `large-hand-stress`: **"Large Hand (30+ Cards)"** (tests ITEM-5 30-card 20%–80% overlap & zero overflow, ITEM-3 tight non-rectangular contour around lifted playable cards, ITEM-2 card sizing, ITEM-4 visible drag, ITEM-7 Surrender icon).

## Mandatory Acceptance Criteria Checklist
- [ ] **ITEM-1 (QA Playbook #1):** "the additional card outline should only be visible to players that can legally play into it. In other words, it should not be visible if a player has no valid cards to throw in, is the defending player, or has already input a pass command." (Wired in `GameTable.tsx` for both inline and surrender placements.)
- [ ] **ITEM-2 (QA Playbook #2):** "Currently, the throw-in and redirect outlines match in size, while the actual cards are substantially smaller. Ensure that the cards are also the (larger) size of the outlines." (Wired in `table.css` & `GameTable.tsx` with unified `100px × 140px` desktop / `48px × 68px` mobile dimensions.)
- [ ] **ITEM-3 (New #1):** "The active player's hand highlight box doesn't match with or align to the player's actual card positions at all. Adjust the implementation, ignoring all past specs for this component, to make sure that the highlight box responsively wraps tightly around the hand at all times. This means that if certain cards are shifted upwards to be playable, the highlight box should distort accordingly to keep wrapped tightly around the hand as a whole ('box' is no longer the right word - the outline does not need to maintain a rectangular shape)." (Wired in `GameTable.tsx` & `table.css` using `handLayout.ts` SVG contour.)
- [ ] **ITEM-4 (New #2):** "Bug: Clicking and dragging a card makes it invisible. Cards should be displayed at all times (aside from overlap rules as we have defined), regardless of if they are bing dragged or not." (Wired in `GameTable.tsx` & `table.css` with zero invisibility on drag.)
- [ ] **ITEM-5 (New #3):** "Arrange the cards in the active user's hand subject to the following constraints: all cards should overlap by 20% of their width at minimum and by 80% of their width at maximum. (These percentages are approximate - adjust them as needed to make sure that the left-side rank symbol and suit is always visible on every card, and so that even if a player picks up every card into their hand, the hand won't look wrong graphically (i.e. go off screen or overlap UI elements)). Keep in mine New Item #1 when implementing this, and vice versa." (Wired in `GameTable.tsx` & `table.css` via `handLayout.ts` + `ResizeObserver`.)
- [ ] **ITEM-6 (New #4):** "Remove the 'Throw In' button. Instead, cards can be thrown in by dragging them to the additional card outline or double clicking. To throw in multiple cards at once, the player can click to select multiple legal cards to throw in, and then double-click to deploy them all at once." (Wired across `ActionBar.tsx`, `GameTable.tsx`, and `GamePage.tsx`.)
- [ ] **ITEM-7 (New #5):** "Instead of the word 'Surrender', the surrender button should be smaller and non-verbally communicate the action with an icon. Design the icon to be two hands, raised in surrender, underneath some cards with an arrow pointing from the cards down towards the hands. Keep the position of the surrender button in the bottom right corner of the game table. Adjust the button to fit the aesthetic of the current theme as the other game elements do, instead of being the current bright red." (Wired in `ActionBar.tsx`, `GameTable.tsx`, and `table.css`.)
- [ ] **ITEM-8 (New #6):** "Instead of the word 'Pass', the pass button should be smaller and non-verbally communicate the action with an icon. Design the icon with a similar aesthetic to the above specification for the surrender button. Also make the other button adjustments in an analogous way." (Wired in `ActionBar.tsx`, `GameTable.tsx`, and `table.css`.)
- [ ] QA Presets `throw-in-multi-qa` and `large-hand-stress` are clickable in BOTH `LobbyPage.tsx` and the left sidebar of `GamePage.tsx`.
- [ ] Update & expand `GameTable.test.tsx`, `GamePage.test.tsx`, and `LobbyPage.test.tsx` to cover all 8 items and both new QA presets; run `npm test -- --run` inside `frontend/` and ensure 100% pass.
