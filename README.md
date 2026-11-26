<!-- USER_SECTION_START -->
# Lidurak — Lichess-Style Online Multiplayer Durak

Lidurak is a fast, minimalist, browser-based implementation of the classic Russian card game **Durak**.

*Note from the developer: This is a side project in which my main goal was to create an autonomous development pipeline from scratch using AI. As a side effect, we also get the project this pipeline developed, which is the bulk of this repository. The main models used were Gemini 4 Argon and DeepSeek V4.1 Flash. Since my overall goal was to develop the whole project without writing any code myself, I can't make any guarantees as to the quality or security of the software (described in the rest of the README). However, as you can see, the source is open, so you can feel free to try it for yourself. The code I do stand by is contained in the agent-orchestration/ directory - this is the bulk of the harness by which the development can be run, with minimal specifications being initially written by the user and only infrequent human intervention by means of editing the FEEDBACK.md document after a QA step. This project runs well in WSL2-Ubuntu 24.04.2 LTS on a Windows 10 PC - there is no guarantee for compatibility with other software and hardware.*
<!-- USER_SECTION_END -->

## 1. Quick Start & Installation

### Prerequisites

- **Java & sbt** (for the Scala 3 backend)
- **Node.js & npm** (for the Preact frontend)
- **Bash** (to run the local launcher script)

### Running Locally

Start both the backend server and the frontend application from the repository root:

```bash
./play-local.sh
```

### Running Tests

Run the backend and frontend test suites from their respective directories:

```bash
# Backend (Scala 3)
cd backend && sbt -batch test

# Frontend (Preact)
cd frontend && npm test -- --run
```

## 2. UI & Gameplay Overview

### Lobby & Matchmaking

On first visit, Lidurak automatically assigns a guest identity (`Guest-XXXX`) backed by an HTTP-only session cookie. From the lobby, you can jump into a match through three modes:

- **Quick Pairing**: Join the matchmaking queue for fast pairing.
- **Lobby Pool**: Browse open public tables in real time and join an available seat.
- **Create a Game**: Configure a private invite link or a public table with:
  - **2 to 4 players** (Human, RandomBot, or BasicBot seats)
  - **36-card or 52-card deck** (4-player tables use the full 52-card deck)
  - **Redirect / Reflect** toggle (ON or OFF)
  - **Turn clock** (15s, 30s, or 60s)

You can also launch local hotseat or bot matches and preset game scenarios for quick practice or testing.

### Table Layout & Controls

The top header provides navigation, a connection latency indicator, and a profile menu to customize **Sound**, **Theme**, **Table** surface, and **Card Back** styles.

The game table uses a clean three-column layout:

- **Left Sidebar**: Rules reference (*How to Play*), preset scenario triggers, and seat-switcher tabs during local hotseat games.
- **Center Felt Arena**:
  - **Top**: Opponent seats showing card counts and roles.
  - **Middle**: Active attack and defense card pairs, defender target outlines, and the redirect outline when eligible.
  - **Bottom**: The talon deck with the face-up trump card, your hand, card sorting controls, and contextual **Pass** / **Surrender** buttons.
- **Right Sidebar**: Digital turn countdown clock, elapsed match timer, end-of-game winner/Durak summary, and move-by-move replay controls once a match finishes.

### Basic Durak Rules

1. **Attack & Defend**: The attacker leads with one or more cards. The defender must cover each attacking card with a higher-ranked card of the same suit, or any card of the trump suit against a non-trump.
2. **Throw In**: Attackers may add extra attacking cards whose rank matches any card already on the table.
3. **Redirect / Reflect**: When enabled and before any attacking card on the table has been covered, the defender may play a card of matching rank to pass the defense to the next player.
4. **Pass or Surrender**: Once all attacks are covered, passing moves defended cards to the discard pile and players draw up from the talon. If you cannot or choose not to defend, surrendering puts all table cards into your hand and skips your next attack.
5. **Winning**: Once the talon is empty, players who shed all of their cards leave the round. The last player holding cards is the **Durak**.

