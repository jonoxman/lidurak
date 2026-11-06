<!-- USER_SECTION_START -->
# Lidurak — Lichess-Style Online Multiplayer Durak

Lidurak is a fast, minimalist, browser-based implementation of the classic Russian card game **Durak**, inspired by the dark-mode visual ergonomics and zero-clutter design of **Lichess.org**.

*This introduction is protected and can be freely edited by the repository owner without the AI overwriting it.*
<!-- USER_SECTION_END -->
<!-- USER_SECTION_START -->
# Lidurak — Lichess-Style Online Multiplayer Durak

Lidurak is a fast, minimalist, browser-based implementation of the classic Russian card game **Durak**, inspired by the dark-mode visual ergonomics and zero-clutter design of **Lichess.org**.

*This introduction is protected and can be freely edited by the repository owner without the AI overwriting it.*
<!-- USER_SECTION_END -->

## 1. Quick Start & Installation

### Prerequisites
- **Backend:** JDK 17+ and `sbt` (Scala 3)
- **Frontend:** Node.js 22+ and `npm`

### Installing Dependencies
Install the frontend dependencies before launching for the first time:
~~~bash
cd frontend && npm ci
~~~
The Scala backend resolves its dependencies automatically via `sbt` on first run.

### Launching Locally (`./play-local.sh`)
From the repository root, start both the backend and frontend servers with a single command:
~~~bash
./play-local.sh
~~~
- **Frontend UI:** [http://localhost:5173](http://localhost:5173)
- **Backend API & WebSocket Server:** `http://localhost:8080`

Press `Ctrl+C` to stop both servers cleanly.

### Running Automated Tests
- **Backend Test Suite (Scala 3 / MUnit):**
  ~~~bash
  cd backend && sbt -batch test
  ~~~
- **Frontend Test Suite (TypeScript / Preact / Vitest):**
  ~~~bash
  cd frontend && npm test -- --run
  ~~~

---

## 2. User Interface & Gameplay Overview

### Lobby & Match Setup
From the lobby page, you can configure and launch a new game or load a pre-configured scenario preset:
- **Player Count & Deck Size:** Choose 2, 3, or 4 players. Matches with 2–3 players use the standard 36-card deck (`6` through `A`), while 4-player matches use a 52-card deck (`2` through `A`).
- **Seat Controllers:** Assign each seat to a `Human`, `RandomBot` (plays random legal moves), or `BasicBot` (prioritizes low non-trump attacks, covers/reflects whenever possible, and conserves trumps).
- **Optional Variants:**
  - **Allow redirects (`Perevod`):** Lets the defender deflect an uncovered attack to the next eligible player by playing a card of matching rank.
  - **Chaos mode** *(3–4 players)*: Allows the initial attacker to target any active opponent holding cards, and routes reflections to a deterministically selected eligible opponent.
  - **Transparent mode:** Reveals all opponent hands as compact mini-cards for observation or testing.
  - **Dev mode:** Enables switching the active table point of view (POV) by clicking any player in the left sidebar during live play.
- **Scenario Presets:** Jump directly into specific mid-game or endgame situations (such as redirects, surrenders, chaos mode, or endgame elimination) with one click.

### Table Layout
The game screen uses a clean three-column layout:
- **Left Sidebar:** Displays the `PLAYERS` list (showing turn roles, remaining card counts, and match status), quick scenario presets, a collapsible `How to Play` rules summary, and post-game `REPLAY CONTROLS` for stepping backward and forward through completed matches.
- **Center Felt Table:**
  - **Top Row:** Opponent seats arranged clockwise relative to the active bottom player.
  - **Middle Row (Battlefield):** Displays active attack and defense card pairs along with contextual drop outlines for opening targets, throw-ins, and reflections (`Perevod`).
  - **Bottom Row:** The active player's hand, contextual `Surrender` and `Pass` action buttons, and a `HAND SORTING` selector (`Rank`, `Suit`, `Pairs`, or `Custom` via drag-and-drop reordering) directly below the table.
- **Right Sidebar:** Contains the match and turn clocks, the talon deck with the revealed trump card and discard pile, and the post-game results summary (`Winners`, `Durak`, and `Rematch`).

### Playing a Bout
- **Attacking:** The active attacker drags a card onto an opponent's target outline (or double-clicks a legal card) to open a bout. Once the bout is underway, attackers may throw in additional cards matching any rank currently on the table (up to 6 pairs or the defender's hand size) or click `Pass`.
- **Defending:** The defender covers each attacking card with a higher-ranked card of the same suit or a trump card. When redirects (`Perevod`) are enabled and no cards have been covered yet, the defender may instead play a card of the same rank onto the reflection outline to pass the attack to the next player.
- **Surrendering:** If the defender chooses not to defend (or has no legal defense), they surrender and pick up all cards on the table after attackers finish throwing in any remaining matching cards.
- **Winning & the Durak:** Once the talon deck is empty, players who shed all of their cards finish the match in order. The last player left holding cards is declared the **Durak**.

### Appearance & Audio Settings
Click the profile button in the top-right header to customize:
- **Theme & Palettes:** Switch between `Device theme`, `Dark`, and `Light` modes, adjust corner `Roundness` and highlight `Glow`, or pick from six semantic color palettes (`Classic`, `Warm`, `Cool`, `Neon`, `Pastel`, `Royal`).
- **Table & Card Backs:** Choose from six table felt surfaces (with brightness, contrast, and hue sliders) and thirteen monochrome or gradient SVG card-back patterns.
- **Sound:** Adjust master volume and select between five synthesized Web Audio sound packs.
