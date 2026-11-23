<!-- USER_SECTION_START -->
# Lidurak — Lichess-Style Online Multiplayer Durak

Lidurak is a fast, minimalist, browser-based implementation of the classic Russian card game **Durak**.

*Note from the developer: This is a side project in which my main goal was to create an autonomous development pipeline from scratch using AI. As a side effect, we also get the project this pipeline developed, which is the bulk of this repository. The main models used were Gemini 4 Argon and DeepSeek V4.1 Flash. Since my overall goal was to develop the whole project without writing any code myself, I can't make any guarantees as to the quality or security of the software (described in the rest of the README). However, as you can see, the source is open, so you can feel free to try it for yourself. The code I do stand by is contained in the agent-orchestration/ directory - this is the bulk of the harness by which the development can be run, with minimal specifications being initially written by the user and only infrequent human intervention by means of editing the FEEDBACK.md document after a QA step. This project runs well in WSL2-Ubuntu 24.04.2 LTS on a Windows 10 PC - there is no guarantee for compatibility with other software and hardware.*
<!-- USER_SECTION_END -->

## 1. Quick Start & Installation

### Prerequisites
- **Java (JDK) & sbt** — required to build, run, and test the Scala 3 backend.
- **Node.js & npm** — required to build, run, and test the Preact/TypeScript frontend.
- **Bash** — required to run the local launcher script.

### Launch the Application
From the repository root, start both the backend server and the frontend dev server with a single command:

```bash
./play-local.sh
```

Once both services are running, open the local frontend URL printed in the terminal in your browser.

### Run the Test Suites
Run the backend and frontend test suites independently from their respective directories:

```bash
# Backend (Scala 3)
cd backend && sbt -batch test

# Frontend (Preact / TypeScript)
cd frontend && npm test -- --run
```

---

## 2. UI & Gameplay Overview

### Lobby & Game Setup
From the lobby, you can configure a new match or jump directly into a preset table state:
- **Players & Seats:** Choose the player count, customize player names, and assign seats as human or bot players.
- **Rule Variants & Modes:**
  - **Redirect:** Allow a defender to transfer an uncovered attack to the next player by playing a matching rank.
  - **Chaos Mode:** Allow attackers to target any active opponent at the table.
  - **Transparent Mode:** Reveal opponent hands for open-table inspection or debugging.
- **Scenario Presets:** Launch curated table positions in one click from either the lobby or the in-game left sidebar to test specific hand sizes, surrender timers, and table layouts without playing through a full deck.

### Table Layout
The game screen uses a three-column layout designed to keep the table readable at both desktop and mobile sizes:
- **Left Sidebar:** Displays the **How to Play** quick reference, **Scenario Presets**, hand-sorting controls, and **hotseat player-switcher tabs** when inspecting or playing multiple human seats.
- **Center Felt Arena:**
  - **Top Row:** Opponent seats showing each player's name, card count, pass status, and finish rank.
  - **Middle Row:** Active attacking and defending card pairs, legal drop/target outlines, and a redirect outline when a transfer is available.
  - **Bottom Row:** The remaining talon deck with the face-up trump card, your interactive hand (supporting click, double-click, and drag-and-drop), hand-sorting controls, and the contextual **Pass** / **Surrender** button.
- **Right Sidebar:** Shows the active turn countdown clock (`00:15` default), overall match elapsed clock, and end-of-game winner / Durak standings.

### Core Durak Rules
1. **Attack & Defend:** The attacker plays one or more cards; the defender must cover every attacking card with a higher-ranked card of the same suit or any card of the trump suit.
2. **Throw-Ins:** Attackers may add extra cards matching any rank already present on the table.
3. **Redirect:** If enabled and no card has been covered yet, the defender may play a card of the same rank to pass the defense onward.
4. **Pass or Surrender:** Once all attacks are covered, players pass to discard the bout and deal back up from the talon. If the defender cannot or chooses not to cover, they surrender and pick up all cards on the table, skipping their next turn to attack.
5. **Winning & Losing:** Play continues until the deck is exhausted and players empty their hands. The last player left holding cards is the **Durak**.

### Themes & Match Replay
- **Appearance:** Supports Dark and Light themes (automatically respecting system preferences or user settings).
- **Replay Mode:** Completed matches can be reviewed frame by frame via the recorded match replay view.
