# Lidurak — Lichess-Style Online Multiplayer Durak

Lidurak is a fast, minimalist, browser-based implementation of the classic Russian card game **Durak**, inspired by the dark-mode visual ergonomics and zero-clutter design of **Lichess.org**.

---

## 1. Quick Start & Installation

### Prerequisites
- **Backend:** JDK 17+ and `sbt` (Scala Build Tool, Scala 3.3.3)
- **Frontend:** Node.js 22+ and `npm`
- *(Optional)* Docker (if running inside a containerized environment)

### Installing Dependencies
- **Frontend:** Install the Vite, Preact, and Vitest packages once (and whenever `package.json` changes):
  ~~~bash
  cd frontend && npm ci
  ~~~
- **Backend:** `sbt` resolves its Scala dependencies automatically on the first `sbt run` or `sbt -batch test`.

### Launching the Local Server (`./play-local.sh`)
From the repository root, run:
~~~bash
./play-local.sh
~~~
This starts both servers concurrently:
- **Frontend UI:** [http://localhost:5173](http://localhost:5173)
- **Backend REST & WebSocket API:** `http://localhost:8080`

Press `Ctrl+C` to stop both servers cleanly.

### Running the Automated Test Suites
- **Backend (Scala 3 / MUnit):**
  ~~~bash
  cd backend && sbt -batch test
  ~~~
- **Frontend (TypeScript / Preact / Vitest):**
  ~~~bash
  cd frontend && npm test -- --run
  ~~~

---

## 2. User Interface & Gameplay Guide

### Site Header & Appearance Menu (Profile Dropdown)
- **Brand Link:** The `LIDURAK` wordmark is preceded by an SVG emblem inside the home link; hovering highlights both the logo and the wordmark in the active accent color.
- **Navigation Menus:** `PLAY`, `PUZZLES`, `LEARN`, and `WATCH` open on hover.
- **Profile Dropdown (`Guest`):** Click the profile button in the top-right corner to open the settings menu: `Profile`, `Inbox`, `Preferences`, `Sign out`, `Language`, `Sound`, `Theme`, `Table`, and `Card Back`.
  - Rows with a chevron (`Sound`, `Theme`, `Table`, `Card Back`) open their configuration panels **in place of** the main list rather than spawning side flyouts. Clicking the top back-chevron header returns to the root menu.
- **Connection Tracker:** Displays live `PING` and `SERVER DELAY` measurements in milliseconds (`ms`) beside a four-bar signal indicator. The bars update according to latency tier (4 bars ≤ 60 ms, 3 ≤ 150 ms, 2 ≤ 300 ms, 1 > 300 ms) and color-code by connection health (**green** for 3–4 bars, **yellow** for 2 bars, **red** for 1 bar).

### Appearance, Themes, Palettes & Audio
- **Theme & Global Roundness:**
  - Switch between `Device theme` (follows OS preference), `Light`, or `Dark`.
  - **Dark Mode** renders a rich charcoal/slate shell with a top header gradient that darkens smoothly into the page.
  - **Light Mode** renders a neutral cool-grey surface (`#d8dde4` page background with crisp `#1e293b` / `#334155` slate typography) paired with an inverse header gradient that begins darker at the top edge (`#b8c0cc`) and lightens seamlessly across the header boundary into the page content.
  - The **`Roundness`** slider (`0–16 px`, default `8 px`) dynamically reshapes panels, buttons, inputs, the felt table border, the shaded battlefield box, opponent seat boxes, target/throw-in/reflection outlines, hand highlights, counter ovals, and the SVG corners of every face-up playing card and face-down card back.
- **Highlight Palettes & Glow Slider (`Theme ▸ Palettes`):**
  - Six color-scheme presets are available below the `Roundness` slider: **`Classic`** (default), **`Warm`**, **`Cool`**, **`Neon`**, **`Pastel`**, and **`Royal`**.
  - Each preset button displays six horizontal preview bars representing the six non-overlapping semantic highlight roles used across the application:
    1. **UI Customization & Chrome** *(Cobalt Blue in Classic)*: Active menu choices, sliders, checkboxes, the `HAND SORTING` selector, and primary lobby controls.
    2. **Active Attacker & Throw-In** *(Emerald Green in Classic)*: The attacking player's row in `PLAYERS` and seat box on the felt, the attacking/throw-in hand glow, legal attack target outlines, the throw-in outline, and the contextual `Pass` button.
    3. **Active Defender, Uncovered Attacks & Surrender** *(Crimson Red in Classic)*: The defending player's row in `PLAYERS` and seat box on the felt, the defending hand glow, pulsing uncovered attack cards (shown to the defender), and the contextual `Surrender` button.
    4. **Trump Indicators** *(Gold / Bronze in Classic)*: The `2px` gilded border on trump cards (in hand, on the table, under the talon, and on Transparent Mode mini-cards) and the `TRUMP` suit badge under the deck.
    5. **Reflection (`Perevod`)** *(Royal Violet in Classic)*: The reflection drop outline and its directional SVG arrow.
    6. **Urgent Turn Clock** *(Orange-Amber in Classic)*: The Turn clock half during its final five seconds (`00:05`–`00:01`).
  - Light mode automatically calibrates all six palettes to softer, lower-saturation mid-tones for comfortable contrast on cool-grey and pale felt surfaces.
  - The **`Glow`** slider (`20%`–`200%`, default `100%`) scales the border and aura intensity of every highlight in real time—including opponent seat boxes, `PLAYERS` rows, hand glows, table outlines, and menu preview bars—without closing the dropdown.
- **Table Felt (`Table` Submenu):**
  - Choose from six procedural felt textures: `Emerald Felt` (default), `Midnight Navy`, `Burgundy Velvet`, `Charcoal Slate`, `Forest Moss`, and `Vintage Oak`.
  - Live `Brightness` (`50%`–`150%`), `Contrast`, and `Hue` sliders adjust only the felt surface while keeping playing cards in their true colors. Each texture preserves its exact weave or grain geometry across both Dark and Light themes.
- **Card Backs (`Card Back` Submenu):**
  - Thirteen SVG card-back designs: six theme-adaptive monochrome patterns (`Classic Hatch`, `Royal Diamond`, `Celtic Weave`, `Hex Mesh`, `Chevron`, `Starburst`) that use bright silver-slate outlines in Dark mode and crisp ivory/slate strokes in Light mode, plus seven vibrant multi-stop gradient designs (`Classic Crimson`, `Royal Sapphire`, `Emerald Gold`, `Sunset Prism`, `Amethyst Nebula`, `Cyber Neon`, `Coral Wave`).
- **Audio (`Sound` Submenu):**
  - Includes a `Master volume` slider (which auditions a sample upon release) and five synthesized Web Audio sound packs: `Classic Felt`, `Arcade 8-Bit`, `Sci-Fi Synth`, `Acoustic Pluck`, and `Modern Minimal`.

### Creating a Match (Lobby Page)
1. Open [http://localhost:5173](http://localhost:5173). If the backend is still warming up, the lobby displays a loading spinner (`Starting game server, please wait…`) and polls `GET /api/health` until the server is ready.
2. Select the **Number of Players** (`2`, `3`, or `4`). Games with 2–3 players use the standard 36-card deck (`6` through `A`); 4-player games use a full 52-card deck (`2` through `A`).
3. Enter custom player names (defaults to `Alice`, `Bob`, `Carol`, `Dave`) and select each seat's controller from the **Type** dropdown: `Human`, `RandomBot`, or `BasicBot`.
4. Configure optional game variants:
   - **Allow redirects (`Perevod`):** Permits the defender to deflect an uncovered attack to the next player by playing a card of matching rank, provided the next player holds enough cards to cover the combined attack.
   - **Chaos mode** *(3 or 4 players)*: Allows the initial attacker to target *any* active opponent who still holds cards by dragging a card onto that opponent's target outline. Reflections (`Perevod`) redirect to a deterministically chosen random eligible opponent, with the reflection arrow pointing directly at the receiving seat.
   - **Transparent mode (all hands visible):** Deals all hands face-up for inspection. Opponent seat boxes render compact low-detail mini-cards displaying only the card's rank, suit, and gilded trump border.
   - **Dev mode (allow POV switching):** Enabled by default for local testing and hotseat play. When checked, clicking any row in the left-sidebar `PLAYERS` panel switches the table point of view (POV) to that player's seat. When unchecked, POV switching is disabled during live play (enforced both in the UI and by server-side `403 Forbidden` responses) and unlocks automatically once the match reaches `Game Over`.
5. Click **Create Game** to launch the match, or use the **Scenario Presets** panel to jump directly into pre-configured mid-game and endgame situations (such as `Surrender Half-Off`, `3P Redirect (Bob POV)`, `4P Chaos Targets`, `Transparent Mode`, or `Defenseless Auto-Surrender`).

### Computer Opponents (`RandomBot` & `BasicBot`)
- New matches wait **`2.0 s`** before executing the first bot action so human players have time to open the table view.
- **`RandomBot`** selects a uniformly random legal move every **`0.2 s` (`200 ms`)**.
- **`BasicBot`** pauses **`500 ms`–`2000 ms`** between moves and plays according to tactical Durak heuristics:
  - Opens attacks with its lowest-ranked non-trump card (playing a trump only when holding nothing else).
  - Covers or reflects incoming attacks whenever a legal defense exists, surrendering only when unable to defend.
  - Throws in matching non-trump cards (lowest rank first) during ongoing bouts and after an opponent surrenders, passing rather than spending trump cards unnecessarily.

### Table Layout & Gameplay Mechanics (Lichess 3-Column Shell)

#### Left Sidebar
- **`PLAYERS` Panel (Top):** Lists every seat in canonical turn order with live presence dots, card counts (`N cards` centered on each row), role highlights (emerald glow for the active attacker, crimson glow for the active defender), and status pills (`WINNER`, `OUT`, and `PASSED` share a uniform borderless pill; `DURAK` carries a distinct bordered pill).
  - The currently viewed seat is indicated by the trailing **` (You)`** suffix without extra border clutter.
  - Clicking a player row switches the table POV when `Dev mode` is enabled or after `Game Over`.
- **Scenario Presets & How to Play:** Quick-launch scenario buttons and a concise rules reference.
- **`REPLAY CONTROLS` (Post-Game):** Appears at the bottom of the left sidebar once a match finishes, providing `‹` / `›` buttons (and keyboard `ArrowLeft` / `ArrowRight` shortcuts) to step through every recorded move of the game from any seat's perspective.

#### Center Felt Table (3x3 CSS Grid) & Hand Sorting
- **Top Row — Opponent Seats:**
  - Opponents are arranged clockwise relative to the active bottom seat: `Top-Center` in 2-player games; `Top-Left` and `Top-Right` in 3-player games; `Top-Left`, `Top-Center`, and `Top-Right` in 4-player games.
  - Each opponent box displays a top-left card-count oval and centered face-down card backs (or rank/suit mini-cards in Transparent Mode) with at least 10% neighbor overlap.
- **Middle Row — Statically Centered Battlefield:**
  - The shaded play area (`.battlefield-tinted-box`) sits at the center of the felt table. All bout cards and drop outlines anchor near the edge or corner corresponding to the defending player's seat (`top-left`, `top-center`, `top-right`, or `bottom`).
  - **Target Outlines:** Before the opening attack of a bout, dashed emerald target outlines (`100px × 140px`) appear for every legal target opponent.
  - **Single-Row Active Bout:** Played attack and cover pairs (`100px × 140px` on desktop, `48px × 68px` on mobile) stay in a single non-wrapping horizontal row. As more pairs are added, cards compact smoothly while keeping at least `22px` of each card's left rank/suit index visible. Uncovered attack cards pulse in crimson for the defending player until covered or surrendered.
  - **Throw-In Outline:** During an ongoing bout (with fewer than 6 pairs on the table), a card-sized (`100px × 140px`) dashed emerald throw-in outline sits in the next slot to the right of the played cards.
  - **Reflection Outline (`Perevod`):** Whenever the defender can legally deflect an uncovered attack, a violet card-sized outline with a directional SVG arrow pointing toward the next receiving seat appears beside the bout row.
  - **Surrender Slide & Throw-In Anchor:** When a defender surrenders, the cards being taken slide half-on / half-off the edge of the shaded battlefield toward the surrendering player's seat (across the top border for an opponent, or across the bottom border toward your hand). While attackers finish throwing in matching cards during `SurrenderThrowIn`, the dashed emerald throw-in outline stays **fully inside** the shaded battlefield—anchored directly **below** the half-off cards when a top opponent surrenders, or **above** them when the bottom player surrenders. If a defender has no legal cover or reflection against an attack, a `3 → 2 → 1` auto-surrender countdown starts automatically.
- **Bottom Row — Active Player's Hand & Contextual Actions:**
  - **Player Hand:** Renders `100px × 140px` SVG cards with at least `10px` (10%) overlap between adjacent cards and responsive overflow stacking for very large hands. When it is your turn to act, a single tight pulsing outline wraps `.hand-cards` (emerald when attacking or throwing in; crimson when defending before surrender). Legal cards lift upward when playable.
  - **Two-Stage Hand Reordering & Pointer Drag:** Dragging any hand card uses custom pointer tracking that maintains the pointer-finger cursor across the entire viewport. Lifting a card immediately collapses its original slot so the remaining `N - 1` cards close the gap; moving the pointer across the hand parts the row (`±22px`) at the hovered insertion slot. Releasing over the hand inserts the card at that position and flips `HAND SORTING` to `Custom` for the remainder of the match. Releasing over a table target outline, uncovered attack card, throw-in outline, or reflection outline (with `48px` magnetic snap) plays the card. Double-clicking a legal card also plays it immediately when the target is unambiguous.
  - **Contextual Action Buttons:** Located in the bottom-right cell of the table grid, displaying `Surrender` for the defender or `Pass` for attackers during throw-in phases.
- **`HAND SORTING` Box (Below the Table):**
  - Positioned in normal document flow directly beneath the felt table, offering a `<select>` dropdown with four modes: `Suit`, `Pairs`, `Rank` (default for new games), and `Custom` (activated automatically when manually reordering cards in hand).

#### Right Sidebar
- **Split Digital Clock:** Displays the overall elapsed `Game` timer (`mm:ss`) above the `15-Second Turn Clock` (`00:XX`). Both halves remain visually neutral during normal play; the Turn clock highlights with an urgent orange-amber pulse only during its final five seconds (`00:05`–`00:01`).
- **`DECK` & Discard Pile:**
  - Displays the vertical talon stack with a top-left remaining card count oval, the perpendicular face-up **Trump Card** tucked underneath, and a high-contrast `TRUMP` suit badge below.
  - Beside the talon sits the two-part **Discard Pile**: cards from earlier bouts form a stationary face-down stack on the left, while the face-up cards from the most recently completed bout overlap across it in a single responsive row so players can inspect the last cleared bout at a glance.
- **Match Results:** Once the talon is empty and players shed their remaining cards, the right sidebar displays the ordered `Winners` list, highlights the final `Durak`, and offers a one-click `Rematch` button.

### Card Faces & Typography
- **Theme-Adaptive Faces:** Card fronts render in crisp white (`#ffffff`) in Light mode and soft silver-slate (`#cbd5e1`) in Dark mode.
- **Corner Indices:** Top-left (upright) and bottom-right (rotated `180°`) indices use a bold sans-serif stack (`Inter`, `system-ui`) paired with enlarged, centered suit glyphs (`x = 11.5` and `x = 58.5` on the `70 × 100` SVG canvas) for instant legibility in overlapped hands.
- **Centered Pip Grids & Court Cards:** Numbered cards (`2`–`10`) place their suit pips on a symmetrically centered grid (`x = 22.5 / 35 / 47.5`, `y = 32 / 44 / 50 / 56 / 68`). Aces (`A`) feature a single large centered ornate pip at `(35, 50)`, while court cards (`J`, `Q`, `K`) render classic serif letters (`Cinzel`, `Playfair Display`, `Georgia`) at `(35, 50)` flanked by outward-rotated suit pips.
- **Trump Framing:** Trump cards are marked exclusively by a `2px` gilded gold border (`#f59e0b` in Dark mode, `#d4943a` in Light mode), keeping the card face clean and uncluttered.
