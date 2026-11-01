# Lidurak — Lichess-Style Online Multiplayer Durak

Lidurak is a fast, minimalist, browser-based implementation of the classic Russian card game **Durak**, inspired by the dark-mode visual ergonomics and zero-clutter design of **Lichess.org**.

---

## 1. Quick Start & Installation

### Prerequisites
- **Backend:** JDK 17+ and `sbt` (Scala Build Tool, Scala 3.3.3)
- **Frontend:** Node.js 22+ and `npm`
- *(Optional)* Docker (if running inside the preconfigured sandbox container)

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

### Creating a Match (Lobby Page)
1. Open [http://localhost:5173](http://localhost:5173) in your browser.
2. Select the **Number of Players** (`2`, `3`, or `4` players).
3. Enter custom player names (defaults to `Alice`, `Bob`, `Carol`, `Dave`).
4. Configure match variants:
   - **Allow redirects (`Perevod`):** Enables reflecting an unopened attack to the next player using a card of matching rank.
   - **Chaos Mode** *(available for 3 or 4 players)*: Allows the initial attacker to target *any* active player who still holds cards (instead of strictly attacking clockwise), and sends reflections (`Perevod`) to a randomly chosen eligible player.
5. Click **Create Game** and select any player link (or use the left-sidebar player switcher tabs during local hotseat inspection) to view the table from that player's seat.

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
    - **Bottom-Left:** The **Talon Deck** (remaining draw count) and perpendicular face-up **Trump Card**.
    - **Bottom-Center:** Your active **Hand** (trump cards feature a subtle golden border glow and corner badge). A gentle pulsing glow around your hand (when attacking) or around uncovered attacking cards (when defending) indicates that the game is waiting on your move.
    - **Bottom-Right:** Client-side **Hand Sorting Controls** and contextual action buttons.
- **Right Sidebar:** Displays the large digital **15-Second Turn Clock (`00:XX`)** and match results (`Winners` list and final `Durak`).

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
- **15-Second Turn Clock & Auto-Actions:**
  - Resets to `00:15` on every move and plays a subtle per-second tick during the final 5 seconds (`00:05`–`00:01`).
  - If `00:00` is reached, the server automatically executes the default action (random opening attack, `Surrender` for a defender, or `Pass` for a thrower).
  - Automatic state transitions (such as forced auto-surrender) include a 3-second visual delay so table updates remain easy to follow.