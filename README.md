<!-- USER_SECTION_START -->
# Lidurak — Lichess-Style Online Multiplayer Durak

Lidurak is a fast, minimalist, browser-based implementation of the classic Russian card game **Durak**.

*Note from the developer: This is a side project in which my main goal was to create an autonomous development pipeline from scratch using AI. As a side effect, we also get the project this pipeline developed, which is the bulk of this repository. The main models used were Gemini 4 Argon and DeepSeek V4.1 Flash. Since my overall goal was to develop the whole project without writing any code myself, I can't make any guarantees as to the quality or security of the software (described in the rest of the README). However, as you can see, the source is open, so you can feel free to try it for yourself. The code I do stand by is contained in the agent-orchestration/ directory - this is the bulk of the harness by which the development can be run, with minimal specifications being initially written by the user and only infrequent human intervention by means of editing the FEEDBACK.md document after a QA step. This project runs well in WSL2-Ubuntu 24.04.2 LTS on a Windows 10 PC - there is no guarantee for compatibility with other software and hardware.*
<!-- USER_SECTION_END -->

## 1. Quick Start & Installation

### Prerequisites

- **Java Development Kit (JDK)** and **sbt** (for the Scala 3 backend)
- **Node.js** and **npm** (for the Preact + TypeScript frontend)
- **Bash** shell environment (Linux/macOS)

### Launching Locally

Start both the backend server and the frontend development server from the repository root with:

```bash
./play-local.sh
```

Once running, open the local URL printed by the launcher in your browser to access the lobby and start playing.

## 2. Running Tests

Run the backend and frontend test suites independently from their respective directories:

- **Backend (`backend/`)**
  ```bash
  cd backend && sbt -batch test
  ```
- **Frontend (`frontend/`)**
  ```bash
  cd frontend && npm test -- --run
  ```

## 3. UI & Gameplay Overview

### Lobby & Matchmaking

From the lobby, you can start or join a match in several ways:

- **Create a Game:** Configure a table for **2, 3, or 4 players** (using a 36-card deck for 2–3 players or a 52-card deck for 4 players), choose **Private invite link** or **Public lobby pool** visibility, toggle **Redirect / reflect** rules, and set the per-turn clock (**15s**, **30s**, or **60s**).
- **Lobby Pool:** Browse open public rooms updated in real time and join any table with an open seat.
- **Quick Pair:** Enter the matchmaking queue to be paired automatically with opponents.
- **Local / Hotseat & Spectator Modes:** Play local or bot-filled games, switch seats in hotseat mode, or open a match as a spectator.

### Table Layout & Controls

Matches are rendered in a three-column layout designed to keep the table readable at all times:

- **Left Sidebar:** Displays the **How to Play** reference, quick scenario presets, and hotseat seat-switcher tabs when playing locally.
- **Center Felt Arena:** A 3×3 table grid showing opponent seats across the top, active attack/defense card pairs and target outlines in the center, and the talon deck, trump card, your hand, sort controls, and contextual **Pass** / **Surrender** button along the bottom.
- **Right Sidebar:** Displays the digital turn countdown clock and end-of-game winner / Durak results.

### Basic Gameplay

- **Attacking & Throwing In:** Play one or more cards of matching rank to open a bout, or throw in additional cards matching ranks already on the table when allowed.
- **Defending & Redirecting:** Cover each attacking card with a higher card of the same suit or a trump card. When redirect rules are enabled and legal, you may reflect the attack to the next seat by playing a card of matching rank.
- **Passing & Surrendering:** Attackers can pass once they have no more cards to add; a defender who cannot or chooses not to cover can surrender the bout and pick up the table cards.
- **Themes & Preferences:** Toggle between light and dark themes (or follow your device theme) and adjust visual settings from the top navigation bar.
