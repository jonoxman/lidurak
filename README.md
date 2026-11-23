<!-- USER_SECTION_START -->
# Lidurak — Lichess-Style Online Multiplayer Durak

Lidurak is a fast, minimalist, browser-based implementation of the classic Russian card game **Durak**.

*Note from the developer: This is a side project in which my main goal was to create an autonomous development pipeline from scratch using AI. As a side effect, we also get the project this pipeline developed, which is the bulk of this repository. The main models used were Gemini 4 Argon and DeepSeek V4.1 Flash. Since my overall goal was to develop the whole project without writing any code myself, I can't make any guarantees as to the quality or security of the software (described in the rest of the README). However, as you can see, the source is open, so you can feel free to try it for yourself. The code I do stand by is contained in the agent-orchestration/ directory - this is the bulk of the harness by which the development can be run, with minimal specifications being initially written by the user and only infrequent human intervention by means of editing the FEEDBACK.md document after a QA step. This project runs well in WSL2-Ubuntu 24.04.2 LTS on a Windows 10 PC - there is no guarantee for compatibility with other software and hardware.*
<!-- USER_SECTION_END -->

## 1. Quick Start & Installation

### Prerequisites
- **Java (JDK 17+)** and **sbt** (for the Scala 3 backend)
- **Node.js (18+)** and **npm** (for the Preact + TypeScript frontend)

### Launch Locally
Start both the backend server and frontend development server with the repository launcher script:

```bash
./play-local.sh
```

Once started, open the local frontend URL printed in your terminal to access the Lobby.

### Running Tests
Run the backend and frontend test suites independently from their respective directories:

```bash
# Backend (Scala 3 / sbt)
cd backend && sbt -batch test

# Frontend (Vitest / Preact)
cd frontend && npm test -- --run
```

## 2. UI & Gameplay Overview

### Lobby & Game Modes
From the Lobby, you can configure a match with human seats and computer-controlled bots (`BasicBot` or `RandomBot`), customize player names, and toggle gameplay options:
- **Redirect (Perevod):** Allows a defender to pass an attack forward to the next player by matching the attacking card's rank.
- **Chaos Mode:** Allows attackers to target any active opponent at the table rather than only the player immediately to their left.
- **Transparent Mode & Dev Mode:** Optional inspection modes for revealing opponent hands or switching perspectives during local testing and review.
- **Scripted Presets:** One-click scenario presets available in the Lobby and left sidebar to jump directly into specific mid-game or edge-case table states.

### Table Layout
The game screen uses a clean three-column layout inspired by online tabletop interfaces:
- **Left Sidebar:** Houses game rules/controls, hand-sorting options, and quick-launch scenario presets.
- **Center Felt Arena:** Displays opponent seats across the top, the active bout pairs and target outlines in the middle, the talon deck and trump card alongside your hand, and contextual action controls (`Pass` / `Surrender`) below.
- **Right Sidebar:** Displays match status, turn clock information, and end-of-match results.

### Playing a Turn
- **Attacking & Throwing In:** Click, double-click, or drag a legal card onto an eligible opponent target or throw-in slot. Multiple cards of matching rank can be selected and played together, or you can `Pass` once satisfied.
- **Defending & Redirecting:** Cover uncovered attacking cards with a higher card of the same suit or a trump card. When Redirect is enabled and legal, drag or play a matching-rank card onto the reflection target to pass the bout onward.
- **Surrendering & Turn Clock:** Each active turn is governed by a countdown clock. If you cannot or choose not to defend, click `Surrender` to pick up the cards on the table after opponents finish any legal throw-ins.
- **Hand Organization & Reordering:** Sort your hand by rank or suit, or drag cards directly within your hand to arrange them manually.
- **Match Replay:** Completed matches can be inspected step by step in review mode.
