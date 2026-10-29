# Project Specification: Lichess-Style Online Multiplayer Durak ("Lidurak")

## 1. System Overview & Architectural Philosophy
Build a fast, lightweight, browser-based online multiplayer implementation of the Russian card game **Durak**, modeled after the design, UX, and architecture of **Lichess.org**.
- **Zero-Install & Lightweight:** Works seamlessly on desktop and mobile browsers with a minimal TypeScript + Preact + custom SVG bundle (<50 KB gzipped) and a dark-mode Lichess aesthetic (`#161512` background, `#262421` panels, high-contrast vector cards).
- **Frictionless Access:** Accounts are strictly optional for playing. Anonymous guests receive a signed/opaque `guestToken` stored in an `HttpOnly` cookie (or local session header) enabling reconnection and URL-based matchmaking (`/g/:gameId`). Registered accounts unlock Glicko-2 ratings, profile statistics, and persistent game history/replays.
- **Authoritative Server & Zero-Trust Anti-Cheat:** The Scala 3 backend is the sole source of truth. Opponent hands and the remaining deck (`talon`) order MUST NEVER be serialized or transmitted over WebSockets to any client. Each player receives a strictly filtered `PlayerGameView` projection.

## 2. Repository Layout & Tech Stack
The monorepo resides in `/workspace` with two primary directories:
- `backend/` — **Scala 3.3.3** (`sbt` build):
  - `Http4s Ember` (`org.http4s::http4s-ember-server`, `http4s-dsl`, `http4s-circe`) for REST & WebSockets on `0.0.0.0:8080`.
  - `Cats Effect 3` (`org.typelevel::cats-effect`) for concurrent game actors (`Ref`, `Queue`, `Topic`) and bot tournament fibers.
  - `Circe` (`io.circe::circe-generic`) for JSON serialization.
  - `MongoDB Scala Driver` (`org.mongodb.scala::mongo-scala-driver`) connected via `sys.env.getOrElse("MONGODB_URI", "mongodb://mongodb:27017/durak")`.
  - `Argon2-jvm` (`de.mkammerer:argon2-jvm`) for password hashing.
  - `MUnit` (`org.scalameta::munit` and `munit-cats-effect`) for unit and property tests, executed via `cd backend && sbt test`.
- `frontend/` — **TypeScript 5 + Vite + Preact**:
  - Zero heavy UI component libraries. Pure CSS Grid/Flexbox + custom inline SVG playing cards.
  - Proxy `/api` and `/ws` to `http://localhost:8080` in `vite.config.ts`, serving on `0.0.0.0:5173`.
  - Unit tests written in **Vitest**, executed via `cd frontend && npm test -- --run`.

## 3. Formal Durak Rules & State Machine Specification (`durak.engine`)
All game logic must live in pure, immutable, deterministic Scala data structures inside `backend/src/main/scala/durak/engine/` with 100% unit test coverage.

### 3.1 Deck & Setup
- **Suits:** `Clubs`, `Diamonds`, `Hearts`, `Spades`.
- **Ranks:**
  - For `playerCount` in `{2, 3}`: **36-card deck** (`Six` (6) through `Ace` (14); ranks 2–5 removed).
  - For `playerCount == 4`: **52-card deck** (`Two` (2) through `Ace` (14)).
- **Initial Deal:**
  - Shuffle deck deterministically using a seeded RNG (`scala.util.Random(seed)`).
  - Deal 6 cards to each player (`players: Vector[PlayerState]`, seats `0` to `N-1`).
  - Reveal the next card face-up and place it perpendicular at the **bottom** of the remaining deck (`talon`). Its suit sets `trumpSuit: Suit` for the entire match (`bottomTrumpCard: Option[Card]`). The `bottomTrumpCard` is the very last card drawn from the `talon`. Once drawn, `trumpSuit` remains fixed in `GameState`.
- **First Attacker Selection:**
  - The player holding the lowest-rank card of `trumpSuit` in their initial hand becomes `attackerIdx`, and the next active player clockwise (`(attackerIdx + 1) % N`) becomes `defenderIdx`. If no player holds a trump card, `attackerIdx = 0`.

### 3.2 Roles & Legal Moves in a Bout
A match consists of a sequence of **Bouts**. At the start of each bout, record `defenderInitialHandSize = defender.hand.size`.
- **Bout Capacity Invariant:** The maximum total number of attacking cards allowed in the current bout is:
  `maxBoutAttacks = Math.min(6, defenderInitialHandSize)`
  At no point may `tablePairs.size` exceed `maxBoutAttacks`, nor may a single move add more uncovered cards than `defender.hand.size`.
- **Initial Attack (`PHASE_INITIAL_ATTACK`):**
  - Only `attackerIdx` may play. They may play 1 to `maxBoutAttacks` cards simultaneously, provided **all played cards share the exact same Rank**.
  - State transitions to `PHASE_DEFENSE`.
- **Defender Options (`PHASE_DEFENSE`):**
  1. **Defend (`CoverCard(attackIndex, defenseCard)`):**
     - Legal against an uncovered attacking card `att` iff:
       - `(defenseCard.suit == att.suit && defenseCard.rank > att.rank)` OR
       - `(defenseCard.suit == trumpSuit && att.suit != trumpSuit)`.
  2. **Redirect / Reflect (`RedirectAttack(cards: List[Card])`):**
     - Legal iff ALL of the following hold:
       - `config.allowRedirect == true` (enabled by default).
       - **Zero** cards on the table are currently covered (`tablePairs.forall(_.defense.isEmpty)`).
       - `cards.nonEmpty` and all cards in `cards` have the **exact same Rank** as the attacking cards currently on the table.
       - Let `nextDefIdx` be the next active player in clockwise order after `defenderIdx`. That player MUST hold enough cards to defend the combined attack:
         `players(nextDefIdx).hand.size >= (tablePairs.size + cards.size)` AND `(tablePairs.size + cards.size) <= 6`.
     - **Effect of Redirect:** The redirected cards are added as uncovered attacking cards on the table. `attackerIdx` becomes the old `defenderIdx`, and `defenderIdx` becomes `nextDefIdx` (in a 2-player game, the original attacker is now the defender!). `defenderInitialHandSize` updates to the new defender's current hand size.
  3. **Surrender (`DeclareSurrender`):**
     - Legal whenever at least 1 uncovered attacking card is on the table.
     - State transitions to `PHASE_SURRENDER_THROW_IN`. The defender cannot revoke surrender.
- **Throwing In Additional Attacks (`ThrowInCards(playerId, cards: List[Card])`):**
  - Allowed during `PHASE_DEFENSE` (after the initial attack) and `PHASE_SURRENDER_THROW_IN` by any active non-defending player.
  - Every card in `cards` must match the `Rank` of **any** card currently on the table (either attacking or defending).
  - Total attacking cards on the table after the throw-in must not exceed `maxBoutAttacks` (which is capped by `defenderInitialHandSize`).
  - Whenever new attacking cards are thrown in during `PHASE_DEFENSE`, all non-defenders' `passed` flags reset to `false`.
- **Ending a Bout (`PassTurn(playerId)`):**
  - When all attacking cards on the table are covered (`tablePairs.forall(_.defense.isDefined)`), or when in `PHASE_SURRENDER_THROW_IN`, non-defending active players may declare `PassTurn` (auto-passed if they hold 0 cards or `tablePairs.size == maxBoutAttacks`).
  - Once **all** active non-defending players have passed:
    - **Case A (Successful Defense):** All table cards move to the `discardPile`. Players draw from `talon` back up to 6 cards (see 3.3). The old `defenderIdx` becomes the next `attackerIdx`, and the next active player clockwise becomes `defenderIdx`.
    - **Case B (Surrender):** The defender moves all attacking and defending cards on the table into their hand. Non-defending players draw from `talon` back up to 6 cards. The surrendering defender **forfeits their turn to attack**: the next `attackerIdx` is the active player immediately clockwise after `defenderIdx`, and the player clockwise after *them* becomes the new `defenderIdx`.

### 3.3 Drawing Cards & Endgame Elimination
- **Draw Order:** At the end of a bout, players with fewer than 6 cards draw one by one up to 6 cards as long as `talon.nonEmpty`:
  1. Primary attacker (`attackerIdx`) draws to 6 first.
  2. Other active non-defending players draw to 6 in clockwise order.
  3. Defender (`defenderIdx`) draws to 6 last (skipped if they surrendered).
- **Player Elimination & Victory Conditions:**
  - Once `talon.isEmpty`, any player whose hand reaches 0 cards immediately finishes the game and is recorded in `finishOrder: Vector[PlayerId]`.
  - **2-Player Draw:** If `talon.isEmpty` and the final bout ends with both remaining players hitting 0 cards simultaneously (attacker played last card(s), defender covered with last card(s)), both players finish as `Draw`.
  - **Game Over:** The game ends when `activePlayersWithCards.size <= 1`. If 1 player remains with cards, they are the **Durak** (last place).

## 4. Security & Anti-Cheat Architecture
1. **Strict State Projection (`PlayerGameView`):**
   - WebSocket outgoing payloads MUST map `GameState` through `PlayerGameView.forViewer(state, viewerId)`.
   - The viewer receives their own `hand: List[Card]`, while all other players are represented strictly by `PublicPlayerSummary(id, name, rating, cardCount: Int, isConnected: Boolean, hasPassed: Boolean, finishRank: Option[Int])`.
   - The `talon` is represented strictly as `talonCount: Int` and `bottomTrumpCard: Option[Card]` (visible only while `talonCount >= 1`), plus `trumpSuit: Suit`.
2. **Credential & Session Security:**
   - Passwords MUST be hashed using **Argon2id** (`memory = 65536` KB, `iterations = 3`, `parallelism = 1`). Plaintext passwords must never be logged or stored.
   - Sessions use cryptographically random 256-bit tokens (`SecureRandom`) stored in MongoDB with `HttpOnly; SameSite=Strict` cookies.
   - All incoming WebSocket commands must validate that the sender's session/guest token matches the seat attempting the action.

## 5. AI Bot Architectures (`durak.bots`)
Implement a common trait `DurakBot { def selectMove(view: PlayerGameView): IO[GameAction] }` with three distinct difficulty tiers:
1. **`NoviceBot` (Tier 1 - Random/Greedy):** Plays random legal moves; prefers non-trump cards over trump cards when attacking or defending.
2. **`TacticianBot` (Tier 2 - Rule-Based Heuristic):**
   - Evaluates hand quality: preserves trumps and high ranks (`J, Q, K, A`), sheds low off-suit cards first, pairs duplicates, and prefers surrendering early if defending requires spending multiple high trumps while the `talon` still has >12 cards.
3. **`GrandmasterBot` (Tier 3 - Determinized Information-Set MCTS / ISMCTS):**
   - Must ONLY take `PlayerGameView` (and tracked `discardPile` history) as input—**never** the hidden `GameState`.
   - For each simulation budget (`e.g., 250 iterations` or `400ms` max per move):
     1. **Determinization:** Sample a consistent assignment of unknown cards (cards not in bot's hand, not on table, not in discard pile, and not the known `bottomTrumpCard` if someone drew it) across opponents' hands and the `talon`.
     2. **MCTS Rollout:** Run UCT selection, expansion, heuristic rollout policy, and backpropagation to maximize win/non-Durak probability.

## 6. Glicko-2 Rating System (`durak.rating`)
Implement the full **Glicko-2** algorithm ($\mu, \phi, \sigma$, system constant $\tau = 0.5$, default rating $R = 1500$, $RD = 350$, $\sigma = 0.06$):
- **2-Player Rated Match:** Standard 1v1 Glicko-2 update ($S = 1.0$ win, $0.5$ draw, $0.0$ loss).
- **3- and 4-Player Rated Match:** Composite Pairwise Glicko-2. Given `finishOrder`, for each player $i$, construct $N-1$ pairwise matchups against every other player $j \ne i$ ($S_{ij} = 1.0$ if $i$ finished ahead of $j$, $0.5$ if tied, $0.0$ if behind). Scale the Glicko-2 variance $v^{-1}$ and delta sums by $\frac{1}{N-1}$ before updating $\phi'$ and $\mu'$.

## 7. Lichess-Inspired UI & URL Routing (`frontend/`)
- **Visual Design:** Dark slate palette (`#161512` background, `#262421` panels, `#bababa` text, `#629924` active turn/ready indicators, `#c33` trump suit badge). Responsive layout working from `360px` mobile screens to `1920px` desktop monitors.
- **Routes:**
  - `/` — **Lobby & Quick Pairing Pool:** Tabs for *Quick Pairing* (2P/3P/4P presets), *Lobby Pool* (live open rooms), *Create Invite Link* (configurable 2/3/4 players, Redirect ON/OFF, time control), and *Play vs. Computer* (select 1–3 bots of Novice/Tactician/Grandmaster tiers).
  - `/g/:gameId` — **Live Game Table:** Shareable URL. If seats are open, clicking "Join Table" seats the visitor (using their account or automatic Guest session). Shows opponent card backs & counts around the table, central battle pairs (attacking card + overlapping defending card), talon count + perpendicular bottom trump card, player's fanned/sorted hand at bottom, and contextual action buttons (*Pass / Done*, *Take / Surrender*, *Redirect*).
  - `/u/:username` — **Player Profile:** Current Glicko-2 rating (`R ± RD`), win/loss/draw stats, and paginated list of past matches.
  - `/replay/:gameId` — **Interactive Replay Viewer:** Step-by-step VCR controls (`|<`, `<`, `Play/Pause`, `>`, `>|`) reconstructing every state of a completed match from MongoDB.
  - `/arena` — **Bot Stress-Test & Calibration Dashboard:** Trigger $K$ concurrent headless or WebSocket bot matches, view live games/sec, latency percentiles, and real-time bot Glicko-2 convergence table.

## 8. Milestone Roadmap
- **Milestone M1:** Pure Scala 3 Durak Engine (`36/52` deck, 2/3/4 players, Redirects, Surrender throw-ins), REST/WS state bridge, and playable Local/Inspector Table UI at `http://localhost:5173`.
- **Milestone M2:** Shareable Match URLs (`/g/:gameId`), Guest Tokens, strict `PlayerGameView` anti-cheat projection, and real-time Homepage Lobby Pool.
- **Milestone M3:** AI Bot Engine (`NoviceBot`, `TacticianBot`, `GrandmasterBot` ISMCTS) + "Play with the Computer" lobby workflow.
- **Milestone M4:** MongoDB integration, `Argon2id` Auth, Pairwise Glicko-2 Rating Engine, User Profiles (`/u/:username`), and Replay Viewer (`/replay/:gameId`).
- **Milestone M5:** High-Concurrency Bot Arena & Server Stress-Test Suite (`/arena` UI + CLI benchmark runner).

## 9. ACTIVE MILESTONE DIRECTIVE (FOR ORCHESTRATOR)
**CURRENT ACTIVE MILESTONE: M1**
When decomposing this specification into `.tickets/T-XX.md`, generate atomic tickets ONLY for **Milestone M1** (Scaffolding `backend/` & `frontend/`, Pure Durak Rules Engine & Unit Tests, Local/WebSocket Game Controller, and Interactive SVG Table UI). Ensure every ticket includes exact `sbt test` or `npm test -- --run` verification commands.
