<!-- USER_SECTION_START -->
# Lidurak — Lichess-Style Online Multiplayer Durak

Lidurak is a fast, minimalist, browser-based implementation of the classic Russian card game **Durak**.

*Note from the developer: This is a side project in which my main goal was to create an autonomous development pipeline from scratch using AI. As a side effect, we also get the project this pipeline developed, which is the bulk of this repository. The main models used were Gemini 4 Argon and DeepSeek V4.1 Flash. Since my overall goal was to develop the whole project without writing any code myself, I can't make any guarantees as to the quality or security of the software (described in the rest of the README). However, as you can see, the source is open, so you can feel free to try it for yourself. The code I do stand by is contained in the agent-orchestration/ directory - this is the bulk of the harness by which the development can be run, with minimal specifications being initially written by the user and only infrequent human intervention by means of editing the FEEDBACK.md document after a QA step. This project runs well in WSL2-Ubuntu 24.04.2 LTS on a Windows 10 PC - there is no guarantee for compatibility with other software and hardware.*
<!-- USER_SECTION_END -->

## 1. Quick Start & Installation

### Prerequisites

- **Java (JDK)** and **sbt** (Scala Build Tool) for the backend
- **Node.js** and **npm** for the frontend

### Launching Locally

Run the launcher script from the repository root to start both the backend and frontend servers together:

```bash
./play-local.sh
```

- **Backend API & WebSocket:** `http://localhost:8080`
- **Frontend UI:** `http://localhost:5173`

Press `Ctrl+C` in the terminal to stop both servers cleanly.

## 2. Running Tests

Run the backend and frontend test suites independently from their respective directories:

```bash
# Backend (Scala)
cd backend && sbt -batch test

# Frontend
cd frontend && npm test -- --run
```

## 3. Gameplay Overview

Lidurak is a web implementation of the classic card game Durak for **2 to 4 players**.

- **Deck & Deal:** Matches with 2–3 players use a standard 36-card deck (Six through Ace); 4-player matches use a 52-card deck. Each player is dealt 6 cards, and the bottom card of the talon is placed face-up to establish the trump suit.
- **Game Modes:** Supports local hotseat games, online multiplayer rooms and quick pairing, and AI opponents (`randomBot` and `basicBot`). Optional rules include attack redirection, chaos targeting, and transparent mode.
- **Bout Flow:**
  1. **Initial Attack:** The active attacker plays one or more cards of the same rank against a defender (up to the defender's starting hand size for the bout, capped at 6).
  2. **Defense or Redirect:** The defender covers each attacking card with a higher-ranked card of the same suit or any trump card, redirects the attack (when enabled and holding a matching-rank card), or surrenders to pick up the cards on the table.
  3. **Throw-Ins & Passing:** Other active players may throw in additional cards matching any rank currently on the table, or pass to finish the bout.
  4. **Endgame:** Once the talon is empty, players who play out their last card finish in order. The final player remaining with cards is the **Durak**.

## 4. User Interface Overview

The game table uses a three-column desktop layout:

- **Left Sidebar:** Contains the How to Play reference, scenario preset controls, and hotseat player-switcher tabs.
- **Center Felt Table:** Displays opponent seats along the top, the active attack/defense pairs and target indicators in the center, and the talon deck, trump card, your hand, card sorting controls, and contextual **Pass** / **Surrender** actions along the bottom.
- **Right Sidebar:** Displays the turn countdown clock and final winner / Durak results when a match concludes.
