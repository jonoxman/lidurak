<!-- USER_SECTION_START -->
# Lidurak — Lichess-Style Online Multiplayer Durak

Lidurak is a fast, minimalist, browser-based implementation of the classic Russian card game **Durak**.

*Note from the developer: This is a side project in which my main goal was to create an autonomous development pipeline from scratch using AI. As a side effect, we also get the project this pipeline developed, which is the bulk of this repository. The main models used were Gemini 4 Argon and DeepSeek V4.1 Flash. Since my overall goal was to develop the whole project without writing any code myself, I can't make any guarantees as to the quality or security of the software (described in the rest of the README). However, as you can see, the source is open, so you can feel free to try it for yourself. The code I do stand by is contained in the agent-orchestration/ directory - this is the bulk of the harness by which the development can be run, with minimal specifications being initially written by the user and only infrequent human intervention by means of editing the FEEDBACK.md document after a QA step. This project runs well in WSL2-Ubuntu 24.04.2 LTS on a Windows 10 PC - there is no guarantee for compatibility with other software and hardware.*
<!-- USER_SECTION_END -->

## 1. Quick Start & Installation

### Prerequisites
- **Java (JDK 17+)** and **sbt** (for the Scala 3 backend)
- **Node.js (18+)** and **npm** (for the Preact + Vite frontend)

### Launching Locally
Start both the backend server and the frontend development server with a single command from the repository root:

```bash
./play-local.sh
```

Once both services are running, open the local frontend URL printed by Vite in your browser.

---

## 2. Running Tests

Run the backend and frontend test suites independently:

- **Backend (Scala 3 / sbt):**
  ```bash
  sbt -batch test
  ```
- **Frontend (Vitest / npm):**
  ```bash
  cd frontend && npm test -- --run
  ```

---

## 3. UI & Gameplay Overview

Lidurak supports both **online multiplayer** rooms and **local hotseat / bot matches** for 2 to 4 players (using a 36-card deck for 2–3 players and a 52-card deck for 4 players).

### Lobby
- **Guest Identity:** Visitors are automatically assigned a guest session and can customize their display name directly from the lobby.
- **Quick Pairing:** One-click matchmaking presets for 2, 3, or 4 players with configurable turn clocks and redirects enabled.
- **Lobby Pool:** Live list of open public rooms showing host name, seat occupancy, deck size, redirect rule, and turn clock, with one-click joining.
- **Create Invite Link:** Configure a custom table (player count, redirect/reflect toggle, turn clock, and public or private visibility) and share the generated `/g/:gameId` invite URL.
- **Local & Bot Tables:** Create offline-style hotseat or bot-filled games mixing Human, RandomBot, and BasicBot seats.

### Game Table
The table uses a three-column desktop layout:
- **Left Sidebar:** How to Play reference, game presets, and (in local hotseat mode) player-switcher tabs.
- **Center Felt Table:**
  - **Top Row:** Opponent seats displaying remaining card counts and status.
  - **Middle Row:** Active attack and defense card pairs (bouts), target slots for defending, and a redirect outline when reflection is enabled.
  - **Bottom Row:** Talon deck and face-up trump card, the active player's hand, and hand sorting controls alongside contextual **Pass** / **Surrender** actions.
- **Right Sidebar:** Turn countdown clock and end-of-match winner/Durak results.
