<!-- USER_SECTION_START -->
# Lidurak — Lichess-Style Online Multiplayer Durak

Lidurak is a fast, minimalist, browser-based implementation of the classic Russian card game **Durak**.

*Note from the developer: This is a side project in which my main goal was to create an autonomous development pipeline from scratch using AI. As a side effect, we also get the project this pipeline developed, which is the bulk of this repository. The main models used were Gemini 4 Argon and DeepSeek V4.1 Flash. Since my overall goal was to develop the whole project without writing any code myself, I can't make any guarantees as to the quality or security of the software (described in the rest of the README). However, as you can see, the source is open, so you can feel free to try it for yourself. The code I do stand by is contained in the agent-orchestration/ directory - this is the bulk of the harness by which the development can be run, with minimal specifications being initially written by the user and only infrequent human intervention by means of editing the FEEDBACK.md document after a QA step. This project runs well in WSL2-Ubuntu 24.04.2 LTS on a Windows 10 PC - there is no guarantee for compatibility with other software and hardware.*
<!-- USER_SECTION_END -->

## 1. Quick Start & Installation

### Prerequisites

- **Java & sbt** (to build and run the Scala 3 backend)
- **Node.js & npm** (to build and run the Preact frontend)

### Launch Locally

From the repository root, start both the backend server and the frontend development server using the local launcher script:

```bash
./play-local.sh
```

### Running Tests

Run the backend and frontend test suites from their respective directories:

```bash
# Backend (Scala 3)
cd backend && sbt -batch test

# Frontend (Preact / TypeScript)
cd frontend && npm test -- --run
```

## 2. Gameplay & UI Overview

### Gameplay

Lidurak implements classic **Durak** (including passing/redirecting variants) with a server-authoritative rule engine:

- **Attack & Throw-In:** The active attacker opens a bout by playing a card, and attackers may throw in additional cards whose ranks match cards already on the table.
- **Defense:** The defender covers each uncovered attack card with a higher-ranking card of the same suit or any card of the **trump suit** (which beats non-trump suits and is beaten only by higher trumps).
- **Redirect (*Perevod*):** When eligible, the defender can reflect an attack to the next player by matching the rank on the table.
- **Pass & Surrender:** Attackers can pass once they have no further cards to throw in; a defender who cannot or chooses not to defend can surrender to pick up the bout cards.
- **Modes & Variants:** Supports bot opponents and hotseat play, **Chaos Mode** (allowing attacks against any eligible opponent seat), **Transparent Mode** (revealing opponent hands), and a **Review Mode** for inspecting game states.

### User Interface

The game view follows a three-column table layout designed to keep the board clear and uncluttered:

- **Top Header Bar:** Provides navigation menus, a connection latency indicator, and quick customization controls for **Sound** (volume and sound packs), **Theme** (dark/light mode, highlight intensity, and corner roundness), **Table** (felt textures and color filters), and **Card Back** patterns.
- **Left Sidebar:** Houses the *How to Play* reference, scenario presets, and hotseat seat-switching tabs.
- **Center Felt Arena:** Displays opponent seats across the top, the active bout area in the middle with clear attacker/defender/redirect target indicators, and the talon deck, trump card, your sortable hand, and contextual **Pass** / **Surrender** controls along the bottom.
- **Right Sidebar:** Displays the turn clock and end-of-match winner/Durak results.
