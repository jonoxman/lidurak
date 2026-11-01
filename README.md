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
- **Connection Tracker:** Shows `PING` and `SERVER DELAY` in capitals with a lowercase `ms` unit, e.g. `24 ms`, next to a four-bar signal indicator. The bars change instantly with the latency tier (4 bars ≤ 60 ms, 3 ≤ 150 ms, 2 ≤ 300 ms, 1 above) and play one short pop animation only when the tier actually changes — there is no constant pulsing.
- **Lag-Switch (development):** The slider under the connection metrics sets a manual ping from `0 ms` to `500 ms`. Moving it across a tier boundary immediately updates the `PING` readout, the number of active bars, and the one-shot bar animation.

### Appearance & Audio Submenus
- **Theme:** `Device theme` (follows the OS), `Light`, or `Dark`, plus a global `Roundness` slider (`0–16 px`) that reshapes panels, buttons and inputs on every page.
- **Table:** Six felt textures — `Emerald Felt` (default), `Midnight Navy`, `Burgundy Velvet`, `Charcoal Slate`, `Forest Moss`, `Vintage Oak`. `Brightness`, `Contrast` and `Hue` sliders retune the felt live: every texture preview swatch and the live game table itself pick up the selected texture and filters instantly, and only the felt is filtered — cards keep their true colours.
- **Card Back:** Thirteen designs split into the original monochrome set (`Classic Hatch` default, `Royal Diamond`, `Celtic Weave`, `Hex Mesh`, `Chevron`, `Starburst`) and vibrant gradient backs (`Classic Crimson`, `Royal Sapphire`, `Emerald Gold`, `Sunset Prism`, `Amethyst Nebula`, `Cyber Neon`, `Coral Wave`). The choice applies to every face-down card in the app.
- **Sound:** `Master volume` slider plus five sound packs (`Classic Felt`, `Arcade 8-Bit`, `Sci-Fi Synth`, `Acoustic Pluck`, `Modern Minimal`). Choosing a pack plays a random sample from that pack immediately, and dragging the volume slider auditions a sample at the new level.

### Creating a Match (Lobby Page)
1. Open [http://localhost:5173](http://localhost:5173) in your browser.
2. If the backend is still starting, the lobby shows a **loading panel** (`Starting game server, please wait…`) and re-checks `GET /api/health` every second. The Create Game form appears automatically once the server answers, so a click can never land on a proxy `HTTP 500`.
3. Select the **Number of Players** (`2`, `3`, or `4` players).
4. Enter custom player names (defaults to `Alice`, `Bob`, `Carol`, `Dave`).
5. Pick who plays each seat from the **Type** dropdown next to every name — `Human` or `RandomBot`. Bots play legal moves on their own after a short random pause; seat choices survive changing the player count, and new seats default to `Human`.
6. Configure match variants:
   - **Allow redirects (`Perevod`):** Enables reflecting an unopened attack to the next player using a card of matching rank.
   - **Chaos Mode** *(available for 3 or 4 players)*: Allows the initial attacker to target *any* active player who still holds cards (instead of strictly attacking clockwise), and sends reflections (`Perevod`) to a randomly chosen eligible player.
7. Click **Create Game** and select any player link (or use the left-sidebar player switcher tabs during local hotseat inspection) to view the table from that player's seat.

### Table Layout (Lichess 3-Column Shell)
- **Left Sidebar:** Displays the **How to Play** quick-reference guide and the **Player Switcher** tabs (`p0`, `p1`, etc.) for testing multi-seat perspectives locally.
- **Center Felt Table (3x3 Grid):**
  - **Top Row (Opponent Seats):** Opponents are seated consistently in clockwise order relative to your bottom seat:
    - *2 Players:* Opponent sits directly across (`Top-Center`).
    - *3 Players:* Next clockwise player sits at `Top-Left`; third player sits at `Top-Right`.
    - *4 Players:* Opponents occupy `Top-Left`, `Top-Center`, and `Top-Right`.
  - **Middle Row (Defender-Anchored Battlefield):**
    - Before the opening card of a bout is played, dashed green **Target Outlines** appear directly in front of every player who is a legal attack target.
    - All cards in play (`tablePairs`) and drop outlines are anchored in front of the currently defending player's seat (or directly above your hand at the bottom when you are defending).
    - When reflection (`Perevod`) is legal, a card-sized **Reflection Outline** with a directional arrow pointing toward the next receiver appears immediately to the right of the attacking cards.
  - **Bottom Row:**
    - **Bottom-Center:** Your active **Hand** (trump cards feature a subtle golden border glow and corner badge). A gentle pulsing glow around your hand (when attacking) or around uncovered attacking cards (when defending) indicates that the game is waiting on your move.
    - **Bottom-Right:** Client-side **Hand Sorting Controls** and contextual action buttons.
- **Right Sidebar:** From top to bottom: the large digital **15-Second Turn Clock (`00:XX`)**, the **PLAYERS** list with presence dots, the **Talon Deck** stack, and the match results (`Winners` list and final `Durak`).
  - The deck is drawn vertically with the revealed **Trump Card** lying horizontally and sticking out to its right (their left edges line up); the suit-specific `TRUMP` badge sits clearly below both, with no overlap.

### Card Faces
- Number cards (`6`–`10`, plus `2`–`5` in 4-player games) show one suit pip per rank; aces show a single large ornate pip.
- Face cards (`J`, `Q`, `K`) place their suit pips at the ends of the center letter — `J` has 3 pips (top-left, top-right, bottom-left), `Q` has 1 pip (bottom-right tail), and `K` has 4 pips (all corners).
- Every face pip is rotated diagonally outward, so the recognizable half of the suit symbol (the top half of a heart/club, the bottom half of a spade/diamond) points away from the letter.

### Playing Cards & Controls
- **Drag-and-Drop with Magnetic Snapping:** Drag any card from your hand within `48px` of a valid drop zone (a target player outline, an uncovered attacking card to cover it, the throw-in slot, or the arrow reflection outline). The preview snaps into place; release the mouse to play the card.
- **Fast Double-Click to Play:** Double-click any card in your hand to play it immediately whenever there is **only one unambiguous legal move** for that card (e.g., opening attack in standard mode, throwing in a matching rank, or covering when only one uncovered card can be beaten). If multiple targets are legal (such as in Chaos Mode or when a card can cover multiple uncovered cards), drag the card to your chosen target instead.
- **Sorting Your Hand (`Suit` | `Pairs` | `Rank`):**
  - `Suit` *(Default)*: Groups cards by suit in ascending rank order.
  - `Pairs`: Groups identical ranks together regardless of suit to spot multi-card throw-ins easily.
  - `Rank`: Sorts strictly by ascending rank with all trump cards grouped highest.
- **Contextual Action Buttons (`Surrender` / `Pass`):**
  - **Surrender:** Appears next to your hand only when you are the defender facing uncovered attacking cards. Clicking it picks up all table cards after any final throw-ins.
  - **Pass:** Appears next to your hand only when you are an attacker and all current table cards are covered (or the defender has surrendered) to end your throw-in turn early.
- **Single-Row Hand Overlap:** Your hand never wraps onto a second row. Neighbouring cards overlap by `8px` by default and tighten only as far as the top-left rank/suit index stays readable. If even that cannot fit, the surplus cards stack at 100% overlap behind the readable row, and moving the cursor left-to-right slides them from the hidden right stack to the hidden left stack (and back). Opponent hands sit in a fixed-size box and overlap more as they hold more cards, without following the cursor.
- **Presence Dots:** Each name in the `PLAYERS` list carries a dot that is green while that player is present — their window is focused and the mouse or keyboard moved within the last 30 seconds — and grey otherwise.
- **15-Second Turn Clock & Auto-Actions:**
  - Only the player being waited on sees the clock count down; every other seat — including your right-sidebar clock when it is someone else's turn — stays frozen at `00:15`.
  - Resets to `00:15` on every move and plays a subtle per-second tick during the final 5 seconds (`00:05`–`00:01`).
  - If `00:00` is reached, the server automatically executes the default action (random opening attack, `Surrender` for a defender, or `Pass` for a thrower).
  - Automatic state transitions (such as forced auto-surrender) include a 3-second visual delay so table updates remain easy to follow.