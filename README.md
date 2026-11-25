<!-- USER_SECTION_START -->
# Lidurak — Lichess-Style Online Multiplayer Durak

Lidurak is a fast, minimalist, browser-based implementation of the classic Russian card game **Durak**.

*Note from the developer: This is a side project in which my main goal was to create an autonomous development pipeline from scratch using AI. As a side effect, we also get the project this pipeline developed, which is the bulk of this repository. The main models used were Gemini 4 Argon and DeepSeek V4.1 Flash. Since my overall goal was to develop the whole project without writing any code myself, I can't make any guarantees as to the quality or security of the software (described in the rest of the README). However, as you can see, the source is open, so you can feel free to try it for yourself. The code I do stand by is contained in the agent-orchestration/ directory - this is the bulk of the harness by which the development can be run, with minimal specifications being initially written by the user and only infrequent human intervention by means of editing the FEEDBACK.md document after a QA step. This project runs well in WSL2-Ubuntu 24.04.2 LTS on a Windows 10 PC - there is no guarantee for compatibility with other software and hardware.*
<!-- USER_SECTION_END -->

## 1. Quick Start & Installation

### Prerequisites
- **Java & sbt** (for building and testing the Scala 3 backend)
- **Node.js & npm** (for building and testing the Preact/TypeScript frontend)
- **Bash** (to run the local launcher script)

### Launch Locally
From the repository root, start both the backend server and the frontend development server with:

```bash
./play-local.sh
```

Once running, open the local URL printed by the launcher (defaulting to the frontend dev server proxied to `localhost:8080`).

### Running Tests
- **Backend test suite** (Scala 3):
  ```bash
  sbt -batch test
  ```
- **Frontend test suite** (Preact / TypeScript):
  ```bash
  cd frontend && npm test -- --run
  ```

---

## 2. UI & Gameplay Overview

Lidurak is a web-based implementation of the classic card game **Durak**, featuring real-time multiplayer, bot opponents, spectator mode, and customizable visual themes.

### Lobby & Matchmaking
- **Guest Sessions**: Visitors receive an automatic guest session and can customize their display name.
- **Quick Pairing**: Join the matchmaking pool to be automatically seated with opponents once enough players queue for the same game configuration.
- **Public Lobby & Invite Links**: Browse open rooms in the lobby pool or create a shareable room URL (`/g/<gameId>`) to invite friends or watch as a spectator.

### Table Layout
The game screen uses a clean three-column layout:
- **Top Header Bar**: Brand logo, navigation links (`PLAY`, `PUZZLES`, `LEARN`, `WATCH`), connection status indicator, and a user menu for sound, theme (`dark` / `light`), table felt texture, and card back preferences.
- **Left Sidebar**: Rules / How to Play reference, player viewpoint controls (where applicable), and hand sorting options.
- **Center Table Arena**:
  - **Top Row**: Opponent seats showing remaining card counts, pass indicators, and finish rankings.
  - **Center Row**: Active attack and defense card pairs, legal target outlines, and attack reflection (redirect) indicators.
  - **Bottom Row**: Talon deck and revealed trump card on the left, your interactive hand in the center, and sort / `Pass` / `Surrender` controls on the right.
- **Right Sidebar**: Turn countdown clock (`00:15` default) and end-of-match winner / Durak summary.

### Basic Gameplay
- **Attacking & Defending**: Attackers play cards to start a bout or throw in matching ranks; the defender must cover each attacking card with a higher card of the same suit or any card of the trump suit.
- **Redirecting**: When permitted, the defender may reflect an uncovered attack to the next eligible player by playing a matching rank.
- **Chaos Mode**: Optional rule variant allowing attackers to target any active opponent rather than only the immediate neighbor.
- **Controls**: Play cards via drag-and-drop onto target outlines or by clicking/double-clicking cards in hand, and drag cards within your hand to reorder them.
