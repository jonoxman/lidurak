<!-- WAVE:2 -->
# Ticket T-90-3: Frontend `GameTable` — Static Centered Play Area, Edge-Anchored Cards/Outlines, Half-Off Surrender, All-Legal Hand Outline Shift, 3P Deflect Arrow, Discard Stack, Chaos Targets, and Bot Input Lock

## Scope & Files to Touch
- **Touch ONLY these files:**
  - `frontend/src/types.ts`
  - `frontend/src/api/client.ts`
  - `frontend/src/components/GameTable.tsx`
  - `frontend/src/components/ActionBar.tsx`
  - `frontend/src/styles/table.css`
  - `frontend/src/__tests__/GameTable.test.tsx`
  - `frontend/src/__tests__/types.test.ts`
- **DO NOT touch `GamePage.tsx`, `LobbyPage.tsx`, `SortBar.tsx`, `app.css`, `README.md`, or `ARCHITECTURE.md` in this ticket.**

---

## Mandatory Acceptance Criteria Checklist

- [ ] **ITEM-PB-3 (Move Hand Turn-Highlight Outline Upward When All Cards in Hand Are Legal):**
  > "3. The position is now correct, but the outline looks a little strange when all of the player's cards are legal to play (for example on the first attacked). In this case only, move the entire outline to the cards' adjusted-upward position (if at least one card is not legal to play, the outline should be located as it is now)."
  1. In `GameTable.tsx` (`PlayerHand` / `[data-testid="hand-turn-highlight"]`) and `frontend/src/styles/table.css`:
     - Compute `allCardsLegal`: `true` when `myHand.length > 0` and every card in `myHand` is currently legal to play (`legalCardKeys.size === myHand.length` / `myHand.every(c => isCardLegal(c))`).
     - Expose `data-all-legal={allCardsLegal ? 'true' : 'false'}` on `[data-testid="hand-turn-highlight"]` (`.hand-cards`).
     - When `allCardsLegal` is `true` (and the hand turn highlight is active), shift the entire hand turn-highlight outline container upward to match the legal cards' adjusted-upward position (or apply the upward translation to `.hand-cards[data-all-legal='true']` while keeping individual `.hand-slot` cards at `0` relative offset inside the shifted outline so the outline wraps the lifted cards symmetrically on all 4 sides!).
     - When at least one card in `myHand` is NOT legal to play (`data-all-legal="false"`), keep the outline located at its existing baseline position while only the individual legal cards shift upward.

- [ ] **ITEM-PB-7 (Discard Pile: Face-Down Single Stack Without Hover Animation; Overlap Logic Only on Visible Face-Up Cards):**
  > "7. The overlap logic should only apply to the visible discard pile cards - the face-down cards should always remain in a single stack. Mousing over the face-down cards in the discard pile should not trigger any animation the way mousing over cards in the players' hands does."
  1. In `TableDeck` inside `frontend/src/components/GameTable.tsx` and `frontend/src/styles/table.css`:
     - Separate the discard pile into two distinct visual elements inside `[data-testid="discard-stack"]`:
       1. **Face-down stack (`[data-testid="discard-facedown-stack"]`):** When `faceDownCount = Math.max(0, discardCount - lastDiscardCards.length) > 0`, render the face-down cards in a **single stationary stack** (all face-down cards stacked at 100% overlap in one single card footprint, e.g. `marginLeft: -DECK_CARD_WIDTH` or CSS grid `grid-area: 1 / 1`, with `pointer-events: none` and NO hover transform/transition/cursor-sliding animation!).
       2. **Visible face-up cards (`[data-testid="discard-visible-row"]`):** Apply `handLayout` / `handMargins` responsive overlap logic **ONLY** to the visible face-up cards (`lastDiscardCards`), using the remaining available width of the discard pile box!
     - Ensure mousing over the face-down cards in the discard pile triggers **zero** animation, lift, or stack-sliding behavior.

- [ ] **ITEM-CHAOS-1 (Frontend Chaos Mode Multi-Target Outlines & Target Selection):**
  > "- Chaos Mode Engine Target Selection: Chaos mode should be implemented completely now. Make sure the UI is completely compatible - in Chaos mode, multiple players will have a card outline in front of them visible to the active user, for instance)."
  1. In `frontend/src/types.ts` and `frontend/src/api/client.ts`:
     - Update `InitialAttack` action creator and type to support optional `targetPlayerId?: string`.
     - Update `PlayerGameView` interface and `parsePlayerGameView` to parse `isBot?: boolean`, `playerTypes?: string[]`, `allowRedirect?: boolean`, `chaosMode?: boolean`, `eligibleTargetIds?: string[]`, and `redirectTargetId?: string | null`.
     - Add `createPresetGame(preset: string)` in `client.ts` calling `POST /api/games/preset`.
  2. In `frontend/src/components/GameTable.tsx`:
     - Determine eligible initial-attack target player IDs: during `InitialAttack`, use `view.eligibleTargetIds` if non-empty; otherwise when `view.chaosMode` is true, include all opponents with `cardCount > 0`; otherwise `[view.defenderId]`.
     - When the active viewer can play an `InitialAttack`, render a `data-testid={`target-outline-${targetId}`}` inside `.battlefield-tinted-box` for **every** eligible target player!
     - Each `target-outline-${targetId}` is positioned inside the statically centered `.battlefield-tinted-box` near the edge or corner corresponding to that target player's seat (`top-left`, `top-center`, `top-right`, `bottom`).
     - Dragging and dropping a legal hand card onto `target-outline-${targetId}` (or snapping within `48px` of that outline) dispatches `InitialAttack([card], targetId)`.
     - Double-clicking a hand card during `InitialAttack` dispatches immediately if and only if there is exactly **1** eligible target (`eligibleTargets.length === 1`); when multiple targets exist in Chaos mode, double-click does not guess a target (user drags to the desired player's target outline).

- [ ] **ITEM-ADD-1 (Fix 3-Player Deflect Arrow Direction):**
  > "1. The deflect arrow in the 3 player mode points in the wrong direction. With default player names, when Alice plays against Bob, from Bob's POV the arrow is pointing at Alice in the top-left of the table, when it should be pointing at Carol in the top-right."
  1. In `frontend/src/components/GameTable.tsx`:
     - Inspect how opponent seats are mapped to `top-left`, `top-center`, and `top-right` and how the redirect outline (`[data-testid="redirect-outline"]`) computes its target seat and arrow direction (`data-redirect-target` / SVG rotation or path).
     - Ensure that the redirect target player ID is determined from `view.redirectTargetId` (or the next active player with cards after `view.defenderId` in seat order `p0 -> p1 -> p2 -> p0`), and look up that exact player's rendered seat position (`top-left`, `top-center`, `top-right`, or `bottom`) on the current viewer's table!
     - Specifically, in a 3-player game with default names (`p0 = Alice`, `p1 = Bob`, `p2 = Carol`), when Alice (`p0`) attacks Bob (`p1`), from Bob's POV (`p1`), Alice (`p0`) is rendered at `top-left` and Carol (`p2`) is rendered at `top-right`. The next player to receive a deflected attack from Bob is Carol (`p2`), who sits at **`top-right`**. The deflect arrow (`[data-testid="redirect-outline"]`) MUST have `data-target-seat="top-right"` (and `data-target-player="p2"`) and its arrow graphic MUST point toward **`top-right`** (Carol), NEVER `top-left` (Alice)!

- [ ] **ITEM-ADD-3 (Statically Centered Shaded Play Area; Cards & Outlines Anchored Near Target Player's Edge/Corner with Small Margin):**
  > "3. The way the shaded play area shifts depending on the active player makes no sense. Instead of the shaded play area itself shifting, it should stay statically centred in the game table. Instead, move the cards and card outlines themselves close to the edge or corner of the play area corresponding to the target player (the view will be different from the perspective of each user). Always leave a small margin between the edge of the play area and the card outlines/positions."
  1. In `frontend/src/components/GameTable.tsx` and `frontend/src/styles/table.css`:
     - `.battlefield-tinted-box` (`[data-testid="battlefield-tinted-box"]`) MUST stay **statically centered** in Row 2 of the game table (`justify-self: center; align-self: center; transform: none;`) regardless of who is attacking or defending. Remove any logic or CSS that shifts `.battlefield-tinted-box` itself left, right, up, or down!
     - Inside `.battlefield-tinted-box`, position the active bout cards (`.table-pairs-group`) and card outlines (`target-outline-<id>`, `redirect-outline`) close to the edge or corner of `.battlefield-tinted-box` corresponding to the target player's seat from the active viewer's perspective:
       - `top-left` target: top-left corner inside `.battlefield-tinted-box`
       - `top-center` target: top-center edge inside `.battlefield-tinted-box`
       - `top-right` target: top-right corner inside `.battlefield-tinted-box`
       - `bottom` target (active user is defending): bottom-center edge inside `.battlefield-tinted-box`
     - Always maintain a small consistent inner margin (e.g. `10px`–`14px` padding/inset) between the border of `.battlefield-tinted-box` and the cards/outlines in normal (non-surrendering) play.
     - Expose `data-anchor-seat="top-left" | "top-center" | "top-right" | "bottom"` on `.table-pairs-group` and each `.target-outline` so the edge/corner anchoring is deterministic and testable.

- [ ] **ITEM-ADD-4 (Surrendering Cards Move Half-On / Half-Off the Shaded Play Area Toward Surrendering Player's Box):**
  > "4. When a player is in the process of surrendering (i.e. the player has selected surrender, and all that is being waited for is the other players to throw cards in) move the cards so that they are half on and half off the play area, with the half-off being in the direction of the surrendering player's player box (if the active user surrenders, the cards should move down, almost touching the cards in their hand). These cards should stay there until the surrender action is resolved by all non-defending players passing or having no further cards to throw in."
  1. In `frontend/src/components/GameTable.tsx` and `frontend/src/styles/table.css`:
     - Ensure `.battlefield-tinted-box` has `overflow: visible` so cards that move half-off the shaded play area are never clipped.
     - Whenever the bout is in the surrender throw-in phase (`boutPhase` is `SurrenderThrowIn` / `surrender_throw_in` or `defenderSurrendered` is true) and `tablePairs.length > 0`:
       - Set `data-surrendered="true"` and `data-surrender-target={defenderSeatPosition}` (`"top-left" | "top-center" | "top-right" | "bottom"`) on `.table-pairs-group`.
       - Position `.table-pairs-group` so that the cards straddle the edge/corner of `.battlefield-tinted-box` in the direction of the surrendering player's box — **50% on and 50% off** the shaded play area:
         - `top-center`: shifted upward across the top border of `.battlefield-tinted-box` (`translateY(-50%)` at the top edge) toward the top-center seat box.
         - `top-left`: shifted across the top-left border/corner of `.battlefield-tinted-box` toward the top-left seat box.
         - `top-right`: shifted across the top-right border/corner of `.battlefield-tinted-box` toward the top-right seat box.
         - `bottom` (active viewer surrendered): shifted downward across the bottom border of `.battlefield-tinted-box` (`translateY(50%)` at the bottom edge) so the bottom half of the cards extends below `.battlefield-tinted-box`, almost touching the cards in the active user's hand.
       - Keep the cards in this half-on/half-off position for the entire duration of `SurrenderThrowIn` (including when additional throw-in cards are added to `tablePairs`) until all non-defending players pass or have no cards to throw in and the bout resolves.

- [ ] **ITEM-ADD-6 (Shaded Play Area Never Expands When a Player Runs Out of Cards):**
  > "6. When a player runs out of cards, the shaded play area expands to fill more of the game table space. This should never happen - the shaded play area should only change size to responsively accommodate window size changes and other similar external stimuli rather than user actions within the game."
  1. In `frontend/src/styles/table.css` and `frontend/src/components/GameTable.tsx`:
     - Give Row 1 (`.opponents-row` / `.seat-box`), Row 2 (`.battlefield-row` / `.battlefield-tinted-box`), and Row 3 (`.player-controls-row` / `[data-zone="player-hand"]` / `.hand-cards`) fixed or viewport-clamped heights (`height` / `min-height` / `max-height` and fixed `grid-template-rows` on `[data-zone="table-arena"]`) that do **NOT** depend on whether a seat has `0` cards or `>0` cards!
     - Specifically:
       - When an opponent runs out of cards (`cardCount === 0`), `.seat-box` and `.opponent-hand` must keep the exact same height as when they hold cards.
       - When the active viewer runs out of cards (`myHand.length === 0`), `[data-zone="player-hand"]` and Row 3 must keep the exact same height as when holding cards (`--hand-card-height` reserve).
       - `.battlefield-tinted-box` must have dimensions determined purely by the table container / viewport (`width: 88%; height: 220px` or `clamp(...)` tied only to viewport size) and NEVER grow or shrink when players play cards or run out of cards.

- [ ] **ITEM-ADD-9 (Disable User Move Input When Viewing a Bot Seat in `GameTable` & `ActionBar`):**
  > "9. If a player is a bot, the game should not accept user input for that player's moves."
  1. In `frontend/src/components/GameTable.tsx` and `frontend/src/components/ActionBar.tsx`:
     - When `view.isBot === true` (or `isBotSeat` prop is `true`):
       - Treat the table as read-only for move input (just like `reviewMode`):
       - Do not allow dragging or double-clicking cards in `myHand`.
       - Do not mark cards as interactive/lifting legal moves (`legalCardKeys` empty for interaction).
       - Do not render target outlines (`target-outline-*`), redirect outlines (`redirect-outline`), or hand turn-highlight glow.
       - Do not render `Surrender` or `Pass` buttons in `ActionBar`.

---

## Verification Commands
```bash
cd frontend && npm test -- --run src/__tests__/types.test.ts src/__tests__/GameTable.test.tsx
```
