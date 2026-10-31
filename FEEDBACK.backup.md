# Milestone 1 Gameplay, Rules, Audio & Lichess UI Specification

Implement all 20 items below across the Scala backend and React/TypeScript frontend while maintaining a clean Lichess dark aesthetic (`#161512` background, `#262421` sidebars, `#1e2923` felt table, `#bababa` text, `#629924` green accents) and a strict non-overlapping CSS Grid layout.

---

## PART A: Backend Game Engine, Bugs, Variants & Turn Clock (Items 0, 1, 11, 16, 18, 19)

### 0. Last-Player-Standing Victory Condition (Play Until Only One Durak Remains)
- Do NOT end the game when the first player runs out of cards in 3- or 4-player games.
- When the talon deck is empty (`talonCount == 0`) and a player empties their hand, remove that player from active turn rotation and append them to `winners: List[PlayerId]` (ordered by finish; the first player(s) out are declared the winner(s)).
- Continue gameplay among remaining players who still hold cards until `activePlayersWithCards.size <= 1`.
- The single last player left holding cards is declared the `durak: Option[PlayerId]` (if the final two players empty their hands simultaneously on the same defense, `durak` is `None` / draw).
- All clockwise turn-order helpers (`nextActivePlayer`, defender selection, redirection target) MUST skip players who have already emptied their hands.

### 1. Fix Disappearing Card Bug on Surrender & Enforce 36-Card Conservation
- **Bug Fix:** Fix the bug where a player with 1 card left faces an uncovered attacking card, is forced to surrender (`takeCards` / auto-surrender), and the attacking card disappears instead of entering the surrendering player's hand, falsely allowing them to win on the next turn.
- Audit all surrender / `takeCards` paths (both manual and automatic) so that **every** attacking and defending card currently on the table (`tableBouts`) is transferred into the surrendering defender's hand before clearing the table and advancing the turn.
- **Mandatory Invariant Test:** Add a backend test asserting that after every action (attack, cover, redirect, throw-in, pass, surrender, and deck draw), total card count (`talon.size + discardPile.size + players.map(_.hand.size).sum + tableBouts.flatMap(b => b.attack :: b.defense.toList).size`) strictly equals 36.

### 11. "Chaos Mode" Game Variant Setting
- Add a boolean setting `chaosMode: Boolean` (default `false`) to the Create Game form on `LobbyPage` (alongside the existing redirections toggle), creation REST endpoint, and backend game state. Note that `chaosMode` is only selectable/enabled when `playerCount > 2`.
- **Chaos Mode Rules:**
  1. **Free Target Selection on Initial Attack:** Instead of being restricted to attacking the active player to your left, the initial attacker may attack **any** active player who still holds cards (by playing the opening card into that target player's outline). Attacking an arbitrary player shifts the active defense to that player (which may skip intermediate players' turns). Once the opening attack card of a bout is placed against a target defender, all subsequent throw-ins during that bout target that same defender.
  2. **Randomized Redirections:** When `chaosMode == true` and the defender performs a redirection (`Perevod`), the server redirects the bout to a **randomly chosen active player** (who still has enough cards in hand to cover the new total of uncovered cards), excluding the player performing the redirection.

### 18 & 19. 15-Second Turn Clock, 3-Second Auto-Action Delay & Timeout Defaults
- **3-Second Delay Before Automatic Actions (Item 18):** Whenever a game state triggers an automatic action (such as auto-surrendering when a defender has no legal move, or auto-advancing), wait **3 seconds** before executing it so the transition never feels jarring.
- **15-Second Turn Clock (Item 19):**
  - Track a 15-second turn deadline (`turnDeadlineMs` / remaining seconds `00:15` down to `00:00`) that resets to `00:15` whenever any valid move is made.
  - When a player is actively being waited on and 15 seconds elapse without a move, automatically execute their default action:
    - Waiting on initial attack -> automatically play a random legal attack card from the attacker's hand (against a random legal target if `chaosMode` is on).
    - Waiting on defender -> automatically surrender (`takeCards`).
    - Waiting on attacker/throw-in -> automatically pass (`passTurn`).
  - When the game is idle or between states, display `00:15` to all users.

### 16. Suppress UI Error Banners & Log Invalid Actions to Server/Console
- Remove all invalid-move error banners/messages from the UI (such as *"Drag a card onto the table only when you can attack or throw in"*).
- Log invalid action attempts directly to the backend server stdout/logger (and browser console warning on client-side drop rejection) without rendering error text in the DOM.

---

## PART B: Lichess 3-Column Layout, Clockwise Seating & Defender-Anchored Table Grid (Items 7, 8, 9, 10, 12, 13, 14)

### 8 & 9. Lichess 3-Column Shell & Zero Table Text Clutter
- **No Table Text (Item 8):** Never render instructional or status text messages (such as *"Waiting for the first attack..."*, *"Waiting for the next move..."*, or *"Your turn to defend"*) inside the game table or below the hand.
- **Lichess Side Margins (Item 9):** Use a 3-column CSS Grid shell (`grid-template-columns: 240px minmax(640px, 1fr) 260px; gap: 16px; max-width: 1440px; margin: 0 auto; padding: 16px; align-items: start;`):
  - **Left Sidebar (`[data-zone="sidebar-left"]`):** Contains the "How to Play" reference panel (moved completely off the top of the screen into this sidebar) and hotseat player-view switcher tabs.
  - **Center Column (`[data-zone="table-arena"]`):** The minimalist felt game table.
  - **Right Sidebar (`[data-zone="sidebar-right"]`):** Features the large digital **Turn Clock (`00:XX`)** in a clean monospace Lichess clock panel (`font-size: 2.25rem; font-family: monospace;`), plus game status/winner badges.

### 10, 12, 13. Clockwise Player Seating, Defender-Anchored Bout Outlines & Bottom-Left Deck
Structure `[data-zone="table-arena"]` as a **deterministic 3-Column × 3-Row CSS Grid** (`grid-template-columns: 1fr 2fr 1fr; grid-template-rows: auto minmax(220px, 1fr) auto; gap: 16px; min-height: 620px; padding: 20px;`) so elements NEVER overlap:

1. **Consistent Clockwise Seating (`Row 1` & `Row 3`):**
   - For the active viewer (`myPlayerIndex = i` out of `N` total players), compute relative clockwise offset `offset = (seatIndex - i + N) % N`:
     - **2 Players (`N = 2`):** Opponent (`offset == 1`) sits at **Top-Center** (`Row 1, Col 2`, `data-seat="top-center"`).
     - **3 Players (`N = 3`):** Next clockwise player (`offset == 1`, to viewer's left) sits at **Top-Left** (`Row 1, Col 1`, `data-seat="top-left"`). Player `offset == 2` (to viewer's right) sits at **Top-Right** (`Row 1, Col 3`, `data-seat="top-right"`).
     - **4 Players (`N = 4`):** `offset == 1` at **Top-Left** (`Row 1, Col 1`), `offset == 2` at **Top-Center** (`Row 1, Col 2`), `offset == 3` at **Top-Right** (`Row 1, Col 3`).
   - This clockwise transform guarantees perspective consistency: if Alice (`p0`) sees Bob (`p1`) at `top-left` and Charlie (`p2`) at `top-center`, Bob (`p1`) sees Charlie (`p2`) at `top-left` and Alice (`p0`) at `top-right`.
   - Each opponent seat renders a compact badge showing only the player's name, card count (or `WINNER` / `OUT` badge), and an avatar placeholder slot.

2. **Defender-Anchored Bout Area & Target Outlines (Item 12):**
   - **Initial Attack Target Outlines:** Before the first card of a bout is played, render a highlighted single-card **Target Outline** (`width: 72px; height: 104px; border: 2px dashed #629924; border-radius: 8px;`, `data-testid="target-outline-<playerId>"`) directly in front of every player who is a legal attack target (players out of cards are never legal targets).
     - When `chaosMode == false`, only 1 target outline is shown (in front of the clockwise defender at `top-left`, or `top-center` in 2p).
     - When `chaosMode == true`, target outlines appear in front of all legal opponents.
     - All players see these highlighted target outlines.
   - **Defender-Anchored Cards in Play:** All cards in play (`tableBouts`) and active drop outlines are positioned in the table region corresponding to the **current defending player**:
     - If an opponent at `top-left`, `top-center`, or `top-right` is defending, anchor the bout row directly in front of their seat (`justify-self: start / center / end; align-self: start;` in Row 2).
     - If the **active viewer (bottom player)** is defending, anchor the bout cards and outlines at the **bottom of the battlefield area** (`align-self: end; justify-self: center;` directly above the active player's hand).

3. **Deck & Displayed Trump Card on the Table (Item 13):**
   - Place the Talon Deck and perpendicular face-up Trump Card inside the table at **Bottom-Left (`Row 3, Col 1`, `data-zone="table-deck"`)**.
   - Because opponents occupy `Row 1` and the active player's hand occupies `Row 3, Col 2`, `Row 3, Col 1` is always free across 2-, 3-, and 4-player games and stays in a consistent on-table position for every player.

4. **Card-Shaped Redirection (`Perevod`) Outline with Directional Arrow (Item 14):**
   - Remove the text `"PEREVODZHU!"` from the reflection outline.
   - Make the reflection outline the exact size and shape of a single card (`width: 72px; height: 104px;`, `data-testid="redirect-outline"`), aligned cleanly to the **immediate right** of the attacking card(s) in the bout row whenever redirection is legal.
   - Inside this card outline, render a clean **SVG multi-arrow reflection icon** accompanied by a directional arrow pointing toward the seat (`top-left`, `top-center`, or `top-right`) of the player who will receive the redirected cards (or a split shuffle arrow icon when `chaosMode == true` and >2 active players remain).

---

## PART C: Hand Sorting, Drag-Snap, Double-Click, Visual Polish & Web Audio (Items 2, 3, 4, 5, 6, 7, 15, 17)

### 3 & 6. Magnetic Drag-and-Drop Snapping & Unambiguous Double-Click
- **Magnetic Drag Snapping (Item 3):** When dragging a card from the hand within `48px` of a valid drop target (a legal target player's outline, an uncovered attacking card for defense, the throw-in outline, or the card-sized redirect outline), visually snap a preview/card outline into that exact slot with a highlight border. Releasing the mouse executes that play. Ensure drop zones have at least `16px` separation so two drop targets are never ambiguous.
- **Double-Click to Play (Item 6):** Double-clicking a card in the hand immediately plays it if there is **only one legal way** to play that card:
  - Opening attack when only 1 legal target player exists (`chaosMode == false`, or only 1 opponent left).
  - Throw-in during an active bout (when the player is an attacker and the card's rank matches a rank on the table).
  - Defending when the card can legally beat **only one** uncovered attacking card on the table (and cannot also redirect).
  - If double-clicking is ambiguous (e.g., `chaosMode == true` opening attack with 2+ legal targets, or a card that can cover 2 different uncovered cards, or both cover and redirect), ignore the double-click and require dragging to the intended target slot.

### 4, 5, 7, 15, 17. Trump Glow, Client-Side Hand Sorting, Minimalist Controls & Turn Pulse
- **Trump Card Visual Highlight (Item 4):** Give every trump card a subtle golden/amber border glow (`box-shadow: 0 0 10px rgba(212, 175, 55, 0.45); border-color: #d4af37;`) and a small corner trump badge so trump cards stand out without breaking the minimalist aesthetic.
- **3-Mode Client-Side Hand Sorting (Item 5):**
  - Default sort: **By Suit in Rank Order** (`suit-rank`).
  - Place a compact `SortBar` next to the player's hand with 3 aesthetic toggle buttons:
    1. `Suit` (Grouped by suit, ascending rank within each suit; trump suit grouped right).
    2. `Pairs` (Unsuited rank-order matching identical ranks/pairs together, regardless of suit).
    3. `Rank` (Pure rank order ascending where all trump cards rank higher than all non-trump cards).
  - Sorting is strictly client-side and never mutates server state.
- **Minimalist Hand Controls (Item 7):**
  - Remove `Attack` and `Redirect` buttons completely, and remove any text instructions below the hand.
  - Place the contextual **`Surrender`** button (shown only to the defender when facing uncovered cards) and **`Pass`** button (shown only to attackers when all bout cards are covered / waiting on throw-ins) directly **to the right of the player's hand** (`Row 3, Col 3`) alongside the `SortBar`.
- **Subtle Reflection Shake (Item 15):** Reduce any shake/recoil animation on redirection to a short, subtle `180ms` horizontal nudge (`±4px`).
- **Turn Nudge Pulsing Animation (Item 17):**
  - Remove all *"Your turn to defend"* / *"It's X's turn"* text banners.
  - Instead, on the **defending player's client only** (when facing uncovered cards), apply a subtle rhythmic CSS pulse animation (`animation: turnPulse 2.4s infinite ease-in-out`) around the uncovered attacking card(s).
  - On the **active attacker's client only** (when waited on to attack or throw in), apply the same subtle pulsing glow around their hand container.

### 2. Synthesized Web Audio Sound Effects (`frontend/src/audio/SoundEngine.ts`)
Implement a zero-dependency Web Audio API synthesizer (`SoundEngine.ts`) triggered by state transitions:
- **Play / Attack Card:** Low-mid soft percussive thud (`~140Hz` sine/triangle + short filtered noise burst, `70ms`). If multiple cards are played simultaneously, stagger thuds by `60ms`.
- **Cover / Defend Card:** Slightly higher-pitched, crisper thud (`~210Hz` with stronger attack emphasis, `80ms`).
- **Redirect (`Perevod`):** Distinct two-pitch rapid double-thud (`~260Hz` -> `~330Hz`, `110ms` total).
- **Surrender (Pick Up Cards):** Series of lower-pitched thuds (`~95Hz`) played in quick succession (`65ms` apart), matching the exact number of cards picked up from the table.
- **Draw from Talon Deck (Player-Specific):** Soft paper/page-turn brush sound played in quick succession (`75ms` apart) as many times as cards were drawn—played **only** for the specific player whose hand drew cards from the deck.
- **5-Second Clock Warning (Player-Specific, Item 19):** Subtle `"tick-tick-tick"` wooden/mechanical click once per second during the final 5 seconds (`00:05` down to `00:01`) for the player currently being waited on.
- **Game Over ("Ding!"):** Crisp Lichess-style two-note chime (`~587Hz` D5 -> `~880Hz` A5) played for all players when the game finishes.
