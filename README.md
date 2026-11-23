<!-- USER_SECTION_START -->
# Lidurak — Lichess-Style Online Multiplayer Durak

Lidurak is a fast, minimalist, browser-based implementation of the classic Russian card game **Durak**.

*Note from the developer: This is a side project in which my main goal was to create an autonomous development pipeline from scratch using AI. As a side effect, we also get the project this pipeline developed, which is the bulk of this repository. The main models used were Gemini 4 Argon and DeepSeek V4.1 Flash. Since my overall goal was to develop the whole project without writing any code myself, I can't make any guarantees as to the quality or security of the software (described in the rest of the README). However, as you can see, the source is open, so you can feel free to try it for yourself. The code I do stand by is contained in the agent-orchestration/ directory - this is the bulk of the harness by which the development can be run, with minimal specifications being initially written by the user and only infrequent human intervention by means of editing the FEEDBACK.md document after a QA step. This project runs well in WSL2-Ubuntu 24.04.2 LTS on a Windows 10 PC - there is no guarantee for compatibility with other software and hardware.*
<!-- USER_SECTION_END -->

## 1. Quick Start & Installation

### Prerequisites
- **Backend:** Scala / `sbt` (for `backend/`)
- **Frontend:** Node.js and `npm` (for `frontend/`)

### Launch Locally
Start both the backend server and the frontend application from the repository root using the local launcher script:

```bash
./play-local.sh
```

### Running Tests
Run the backend and frontend test suites from their respective directories:

```bash
# Backend tests (from backend/)
sbt -batch test

# Frontend tests (from frontend/)
npm test -- --run
```

## 2. Gameplay & UI Overview

### Lobby & Game Modes
From the lobby you can start a match by choosing the player count, player names, and seat types (human or bot). Optional match settings include:
- **Allow Redirect:** Lets a defender pass an uncovered initial attack to the next player by playing a matching-rank card.
- **Chaos Mode:** Allows attackers to target any active opponent rather than only the standard seat.
- **Transparent Mode:** Reveals opponents' hands on the table for inspection.
- **Dev Mode / Scenario Presets:** Launches curated preset table states in one click (6-card actions, 14-card hand expansion, 30-card hand compression, and 1-card hand edge cases).

### Rules of Durak
- **Attack & Defend:** Defend every attacking card with a higher card of the same suit, or any trump card against a non-trump.
- **End a Bout:** Once all attacks are covered, attackers pass to send defended cards to the discard pile.
- **Throw In:** Attackers may add extra attacking cards matching any rank already on the table.
- **Surrender:** A defender may surrender to pick up all cards currently on the table and skip their next attack.
- **Redirect:** Before covering any card, a defender may redirect the attack to the next player (when enabled).
- **Winning:** The last player still holding cards is the Durak.

### Table Interface
The game table uses a three-column layout:
- **Left Sidebar:** In-game *How to Play* summary, quick scenario presets, and hotseat player-switcher tabs.
- **Center Table Arena:** Opponent seats across the top, the central bout area with attack/defense pairs and drop targets, the talon deck and trump card, your sortable hand, and contextual **Pass** / **Surrender** controls. You can play cards by dragging them onto valid targets or double-clicking.
- **Right Sidebar:** Digital turn countdown timer (`00:15` default), overall match clock, and end-of-game / Durak results with step-by-step replay review.
- **Themes & Settings:** Supports Dark and Light themes, hand sorting modes, and adjustable visual roundness and highlight intensity.
