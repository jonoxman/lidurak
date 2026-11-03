# Lidurak — Lichess-Style Online Multiplayer Durak

Lidurak is a fast, minimalist, browser-based implementation of the classic Russian card game **Durak**, inspired by the dark-mode visual ergonomics and zero-clutter design of **Lichess.org**.

---

## 1. Quick Start & Installation

### Prerequisites
- **Backend:** JDK 17+ and `sbt` (Scala Build Tool, Scala 3.3.3)
- **Frontend:** Node.js 22+ and `npm`
- *(Optional)* Docker (if running inside the preconfigured sandbox container)

### Installing Dependencies
- **Frontend:** the Vite/Preact/Vitest packages are not committed, so install them once (and again after `package.json` changes):
  ~~~bash
  cd frontend && npm ci
  ~~~
  Without `node_modules` the frontend suite exits with `sh: 1: vitest: not found`.
- **Backend:** `sbt` resolves its Scala dependencies itself on the first `sbt run` or `sbt -batch test`.

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
- **Frontend (TypeScript / Preact / Vitest):** run `cd frontend && npm ci` first if you have never installed the frontend packages.
  ~~~bash
  cd frontend && npm test -- --run
  ~~~

---

## 2. User Interface & Gameplay Guide

### Site Header & Appearance Menu (Profile Dropdown)
- **Brand Link:** The `LIDURAK` wordmark is preceded by an SVG logo inside the same home link; hovering highlights the logo and the text together in the accent colour. Everything left of the profile menu shifts right to make room, while the outer header margins stay unchanged.
- **Navigation Menus:** `PLAY`, `PUZZLES`, `LEARN` and `WATCH` open on hover.
- **Profile Dropdown:** Click the avatar (`Guest`) to open it. Rows are `Profile`, `Inbox`, `Preferences`, `Sign out`, `Language`, `Sound`, `Theme`, `Table` and `Card Back`.
  - Rows with a chevron (`Sound`, `Theme`, `Table`, `Card Back`) open their settings **in place of** the main list — no side flyout. A submenu header at the top shows a left-facing chevron plus the submenu name; clicking it returns to the main menu.
- **Connection Tracker:** Shows `PING` and `SERVER DELAY` in capitals with a lowercase `ms` unit, e.g. `24 ms`, next to a four-bar signal indicator. The values come from the live measured round-trip time. The bars change instantly with the latency tier (4 bars ≤ 60 ms, 3 ≤ 150 ms, 2 ≤ 300 ms, 1 above), and their colour follows the tier: **green** for 3–4 bars, **yellow** for 2 bars and **red** for the last remaining bar. They play one short pop animation only when the tier actually changes — there is no constant pulsing.

### Appearance & Audio Submenus
- **Theme:** `Device theme` (follows the OS), `Light`, or `Dark`, plus a global `Roundness` slider (`0–16 px`) that reshapes panels, buttons and inputs on every page.
- **Table:** Six felt textures — `Emerald Felt` (default), `Midnight Navy`, `Burgundy Velvet`, `Charcoal Slate`, `Forest Moss`, `Vintage Oak`. `Brightness`, `Contrast` and `Hue` sliders retune the felt live: every texture preview swatch and the live game table itself pick up the selected texture and filters instantly, and only the felt is filtered — cards keep their true colours. Each texture also has a paler light-theme felt: switching to `Light` turns the arena, opponent seats, battle box, outlines and count ovals pale, and switching back to `Dark` restores the rich palette.
- **Card Back:** Thirteen designs split into the original monochrome set (`Classic Hatch` default, `Royal Diamond`, `Celtic Weave`, `Hex Mesh`, `Chevron`, `Starburst`) and vibrant gradient backs (`Classic Crimson`, `Royal Sapphire`, `Emerald Gold`, `Sunset Prism`, `Amethyst Nebula`, `Cyber Neon`, `Coral Wave`). The choice applies to every face-down card in the app.
  - The six **monochrome** backs are theme-adaptive: they keep their warm charcoal look in the dark theme and repaint with a crisp ivory/slate palette in the light theme, so they stay high-contrast either way.
  - The seven **colourful** gradient backs are identical in both themes; switching the theme never alters their gradients or motifs.
- **Sound:** `Master volume` slider plus five sound packs (`Classic Felt`, `Arcade 8-Bit`, `Sci-Fi Synth`, `Acoustic Pluck`, `Modern Minimal`). Choosing a pack plays a random sample from that pack immediately, and dragging the volume slider only updates the level and percentage while you drag — releasing the slider auditions exactly one sample at the new level.

### Creating a Match (Lobby Page)
1. Open [http://localhost:5173](http://localhost:5173) in your browser.
2. If the backend is still starting, the lobby shows a **loading panel** with a continuously spinning ring (`Starting game server, please wait…`) and re-checks `GET /api/health` every second. The Create Game form appears automatically once the server answers, so a click can never land on a proxy `HTTP 500`.
3. Select the **Number of Players** (`2`, `3`, or `4` players).
4. Enter custom player names (defaults to `Alice`, `Bob`, `Carol`, `Dave`).
5. Pick who plays each seat from the **Type** dropdown next to every name — `Human`, `RandomBot` or `BasicBot` (listed in that order). Bots play legal moves on their own — `RandomBot` moves instantly, `BasicBot` pauses a random `500 ms`–`2000 ms` between moves; seat choices survive changing the player count, and new seats default to `Human`.
6. Configure match variants:
   - **Allow redirects (`Perevod`):** Enables reflecting an unopened attack to the next player using a card of matching rank.
   - **Chaos Mode** *(available for 3 or 4 players)*: Allows the initial attacker to target *any* active player who still holds cards (instead of strictly attacking clockwise), and sends reflections (`Perevod`) to a randomly chosen eligible player.
7. Click **Create Game** and select any player link (or use the left-sidebar `POV` tabs during local inspection) to view the table from that player's seat.

### Computer Opponents (`RandomBot` & `BasicBot`)
- **`RandomBot`** plays one uniformly random legal move each turn, **instantly** (`0 ms` between moves), so an all-`RandomBot` match reaches the game-over banner and the interactive review mode in well under a second. The server yields between moves, so the table's HTTP and WebSocket traffic is never starved while bots play.
- **`BasicBot`** keeps its human-like pace: a random `500 ms`–`2000 ms` pause before each move.
- **`BasicBot`** follows a simple heuristic and always obeys the rules:
  - It opens with its **lowest-ranked non-trump** card; only when the hand holds nothing but trumps does it open with a random trump.
  - As defender it always **covers or reflects** when a legal `CoverCard` / `RedirectAttack` exists, and surrenders only when it genuinely cannot answer.
  - During throw-ins — including after another player surrenders — it throws in **non-trump** cards that match a rank on the table (lowest rank first) and passes once only trumps or nothing legal remain.
- **Legal-move guarantees (both bots):** every move a bot submits is one the engine accepts. A redirect is only legal while the next clockwise player still holds at least `attacking cards + 1` cards, nobody can redirect an attack to themselves or cover their own attack, and once a defender surrenders that seat has no further actions for the rest of the bout.

### Table Layout (Lichess 3-Column Shell)
- **Game Header:** `Game {id}`, the connection state, a **`POV`** menu listing every seat by its real player name (the viewed seat is labelled from the `myName` field of `PlayerGameView`, never `You` or a raw seat id) and a **`Back to lobby`** button. The button keeps its charcoal dark-theme styling; in the light theme it switches to a high-contrast slate surface (`#e2e8f0`, hover `#cbd5e1`), a visible border (`#64748b`, hover `#334155`) and bold near-black text (`#0f172a`) so it stays readable against the pale header.
- **Left Sidebar:** Displays the **`POV`** player-switcher tabs (one per seat, labelled with each player's real name) for testing multi-seat perspectives locally, followed by the **How to Play** quick-reference guide. After a match ends, a **Replay** panel appears at the bottom of this sidebar with the move-navigation buttons.
- **Center Felt Table (3x3 Grid):**    - **Top Row (Opponent Seats):** Opponents are seated consistently in clockwise order relative to your bottom seat. Each opponent's face-down cards are centred inside their player box, with that player's card count shown as a small oval on the **top-left** corner of the hand (no `N cards` text underneath).
    - *2 Players:* Opponent sits directly across (`Top-Center`).
    - *3 Players:* Next clockwise player sits at `Top-Left`; third player sits at `Top-Right`.
    - *4 Players:* Opponents occupy `Top-Left`, `Top-Center`, and `Top-Right`.
  - **Middle Row (Defender-Anchored Battlefield):**
    - Before the opening card of a bout is played, dashed green **Target Outlines** appear directly in front of every player who is a legal attack target.
    - All cards in play (`tablePairs`) and drop outlines are anchored in front of the currently defending player's seat (or directly above your hand at the bottom when you are defending).
    - When reflection (`Perevod`) is legal, a card-sized **Reflection Outline** with a directional arrow pointing toward the next receiver appears immediately to the right of the attacking cards.
    - The tinted battle box has a **fixed size tied to the table** (it spans the whole middle row at `88%` width), so it never grows or shrinks with the number of cards in play — only the cards inside move.
    - When a player **surrenders**, every card in play slides toward that player's box (left/right for the corner seats, up for the centre seat, down toward your own hand) while the tinted box keeps its size.
  - **Bottom Row:**
    - **Bottom-Center:** Your active **Hand** (trump cards feature a subtle golden border glow and a compact 12–14 px corner badge that never touches the pips). A gentle pulsing glow around your hand (when attacking) or around uncovered attacking cards (when defending) indicates that the game is waiting on your move. The turn-highlight box wraps only the rendered cards — never the empty column — so it tightly encloses your hand.
    - **Bottom-Right:** Contextual action buttons only (`Surrender` / `Pass`). The hand sorting control now lives in the right sidebar.
- **Right Sidebar:** From top to bottom: the overall **Game** clock (`mm:ss`), the large digital **15-Second Turn Clock (`00:XX`)**, the **PLAYERS** list with presence dots, the **`DECK`** box (with the discard pile), the **`SORT`** box, and the match results (`Winners` list and final `Durak`).
  - The `DECK` box is titled like the `PLAYERS` box. Its assembly — the vertical talon stack, the horizontal trump card and the `TRUMP` badge — is centred as one block in the box: the revealed **Trump Card** lies horizontally, nudged slightly right and up so it tucks under the talon and only sticks out to the right, and the suit-specific `TRUMP` badge sits clearly below both, with no overlap. The remaining-deck count is an oval on the **top-left** corner of the deck. The same box holds the **discard pile**: every earlier discard stays face-down under its own top-left counter oval, while the cards of the last finished bout are revealed face-up beside them — before the first bout the pile reads `Empty`.
  - The `SORT` box sits directly underneath the `DECK` box and holds the **Sort** dropdown (`Suit` | `Pairs` | `Rank`). Changing it reorders your hand immediately, and it never appears on the felt table.

### Card Faces
- Number cards (`6`–`10`, plus `2`–`5` in 4-player games) show one suit pip per rank; aces show a single large ornate pip.
- Face cards (`J`, `Q`, `K`) place their suit pips at the ends of the center letter — `J` has 3 pips (top-left, top-right, bottom-left), `Q` has 1 pip (bottom-right tail), and `K` has 4 pips (all corners).
- Every face pip is rotated diagonally outward, so the recognizable half of the suit symbol (the top half of a heart/club, the bottom half of a spade/diamond) points away from the letter.

### Playing Cards & Controls
- **Drag-and-Drop with Magnetic Snapping:** Drag any card from your hand within `48px` of a valid drop zone (a target player outline, an uncovered attacking card to cover it, the throw-in slot, or the arrow reflection outline). The preview snaps into place; release the mouse to play the card.
- **Fast Double-Click to Play:** Double-click any card in your hand to play it immediately whenever there is **only one unambiguous legal move** for that card (e.g., opening attack in standard mode, throwing in a matching rank, or covering when only one uncovered card can be beaten). If multiple targets are legal (such as in Chaos Mode or when a card can cover multiple uncovered cards), drag the card to your chosen target instead.
- **Sorting Your Hand (`Suit` | `Pairs` | `Rank`):** pick the mode from the **`Sort`** box in the right sidebar, directly under the `DECK` box.
  - `Suit` *(Default)*: Groups cards by suit in ascending rank order.
  - `Pairs`: Groups identical ranks together regardless of suit to spot multi-card throw-ins easily.
  - `Rank`: Sorts strictly by ascending rank with all trump cards grouped highest.
- **Contextual Action Buttons (`Surrender` / `Pass`):**
  - **Surrender:** Appears next to your hand only when you are the defender facing uncovered attacking cards. Clicking it picks up all table cards after any final throw-ins.
  - **Pass:** Appears next to your hand only when you are an attacker and all current table cards are covered (or the defender has surrendered) to end your throw-in turn early. While your throw-in clock is running it carries the same badge/timer as `Surrender` (for example `Pass 3`), so the automatic pass is never a surprise.
- **Single-Row Hand Overlap:** Your hand never wraps onto a second row. Neighbouring cards overlap by `8px` by default and tighten only as far as the top-left rank/suit index stays readable. If even that cannot fit, the surplus cards stack at 100% overlap behind the readable row, and moving the cursor left-to-right slides them from the hidden right stack to the hidden left stack (and back). Opponent hands sit in a fixed-size box and overlap more as they hold more cards, without following the cursor.
- **Presence Dots:** Each name in the `PLAYERS` list carries a dot that is green while that player is present — their window is focused and the mouse or keyboard moved within the last 30 seconds — and grey otherwise.
- **Game Over Banner & Review Mode:** A finished match announces `Game over — … wins` (or `Game over — Draw`) and the `Durak` in a banner above the table, and the banner carries its own **Return to lobby** button (the header's **Back to lobby** button does the same). From then on the page loads the recorded match (`GET /api/games/:gameId/replay`) and becomes an interactive review: the **Replay** panel at the bottom of the left sidebar, directly under **How to Play**, has `‹` and `›` buttons (`Previous move` / `Next move`) and a `Move X / Y` counter. Each step redraws the table, the hand, the `PLAYERS` list and the `DECK` box for that move, and the overall **Game** clock freezes at the move's elapsed `mm:ss` (`00:00` on the first move, `data-active="false"`). The table stays read-only: no `Pass` / `Surrender` / `Throw In` buttons, no target or reflection outlines, and no dragging or double-click plays — the `SORT` box and `POV` menu keep working, so you can re-read every position from every seat.
- **Split Clock Panel:** The right sidebar has a single clock panel divided vertically into two equal halves by a horizontal divider. The top half is the overall **Game** clock (`mm:ss` since the first move, frozen at the recorded end time, `00:00` and inactive before the first move) and the bottom half is the 15-second **Turn** clock. Only the running half is highlighted.
- **15-Second Turn Clock & Auto-Actions:**
  - Only the player being waited on sees the clock count down; every other seat — including your right-sidebar clock when it is someone else's turn — stays frozen at `00:15`.
  - Resets to `00:15` on every move and plays a subtle per-second tick during the final 5 seconds (`00:05`–`00:01`).
  - If `00:00` is reached, the server automatically executes the default action (random opening attack, `Surrender` for a defender, or `Pass` for a thrower).
  - Automatic state transitions (such as forced auto-surrender) include a 3-second visual delay so table updates remain easy to follow.