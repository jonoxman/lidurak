# Lidurak Architecture

Lidurak is a client-server implementation of the Durak card game combining a Scala 3 authoritative backend with a Preact + TypeScript + CSS Grid frontend.

## 1. Repository Structure

```text
.
├── play-local.sh                  # Unified local launcher for backend and frontend
├── backend/                       # Scala 3 backend (sbt)
│   └── src/...
│       ├── durak/engine/          # Pure game rules and state machine (`durak.engine`)
│       └── durak/server/          # Actors, WebSocket/REST transport (`durak.server`)
└── frontend/                      # Preact + TypeScript frontend (npm)
    └── src/
        ├── audio/                 # SoundEngine & sound pack playback
        ├── components/            # UI components (GameTable, HeaderBar, Card, CardBack, SortBar, TablePair, etc.)
        ├── state/                 # Persistent user preferences & theme/highlight settings
        ├── styles/                # CSS Grid table styles (`table.css`) & felt textures (`tableTextures`)
        ├── utils/                 # Pure layout solvers (`handLayout.ts`, `tableLayout`)
        └── types                  # Shared action builders and client-side protocol types
```

## 2. Scala 3 Engine State Machine (`durak.engine`)

`durak.engine` encapsulates the pure, deterministic Durak state machine:

- **Turn & Bout Lifecycle:** Tracks the talon deck, trump suit, per-player hands, bout phases (attack, defense, surrender throw-in, completion), and attacker/defender seat rotation.
- **Move Validation & Legal Projections:** Evaluates legal initial attacks, defense covers (higher same-suit or trump), rank-matching throw-ins (bounded by defender capacity), and *Perevod* redirects.
- **Game Mode Rules:** Supports standard clockwise targeting as well as Chaos Mode (`chaosMode`) where the attacker may target any active opponent seat, alongside end-of-game winner/Durak finish-rank resolution once the talon is depleted.

## 3. Server Actors & WebSocket/REST Protocol (`durak.server`)

`durak.server` hosts live match sessions and bridges the engine to connected clients:

- **Session Actors:** Coordinate game rooms, bot turn execution, turn clocks, and serialized command processing over the engine state machine.
- **REST & WebSocket Protocol:** Accepts match setup/management requests over REST and streams real-time game projections while receiving `GameAction` commands (initial attacks, covers, redirects, throw-ins, passes, and surrenders) over WebSocket.
- **Seat-Scoped Projections:** Projects per-viewer state onto the client, withholding hidden opponent cards unless Transparent Mode or Review Mode is enabled, and explicitly supplying action gates and hints (`eligibleTargetIds`, `redirectTargetId`, `canRedirect`, `canThrowIn`, `throwInCards`, `throwInCapacity`, `playableKeys`, and turn clock counters).

## 4. Frontend Architecture (`frontend/src`)

### 4.1 Three-Column Shell & CSS Grid Arena (`styles/table.css`, `components/GameTable.tsx`)

The desktop gameplay screen uses a three-column shell (`[data-zone='sidebar-left']`, `[data-zone='table-arena']`, `[data-zone='sidebar-right']`) built strictly with CSS Grid and Flexbox to prevent overlapping elements:

- **Arena Grid:** `[data-zone='table-arena']` is a `1fr 2fr 1fr` 3-column, 4-row CSS Grid containing:
  1. **Row 1 (Opponent Seats):** Fixed-size `.seat` / `.seat-box` containers (`top-left`, `top-center`, `top-right`) with per-seat clocks (`.seat-clock`) and role indicators (`data-role='attacker' | 'defender'`).
  2. **Row 2 (Battlefield):** Active bout pairs rendered via `TablePair` (partitioned and positioned by `utils/tableLayout`), defender-anchored target outlines, and the *Perevod* redirect outline.
  3. **Row 3 (Deck, Hand & Timer Clearance):** Talon/trump display (`[data-zone='table-deck']`) and the viewer's hand (`[data-zone='player-hand']`) with dedicated vertical clearance (`--hand-timer-clearance`) above the hand so surrendered bouts sliding toward the viewer never collide with the `.hand-clock`.
  4. **Row 4 (Actions Band):** `SortBar` and contextual `Pass` / `Surrender` controls.
- **Isolated Felt Layer:** The felt color, texture overlay, and visual filter (`--table-felt`, `--table-felt-overlay`, `--table-filter`) are rendered on `[data-zone='table-arena']::before` so visual adjustments tint only the table surface and never alter card legibility.

### 4.2 Semantic Theme & Highlight Tokens (`styles/table.css`, `state/settings`)

Gameplay roles map to distinct CSS custom property families with calibrated palettes for both dark mode and `:root[data-theme='light']`:

- `--role-attacker-*` (emerald/green): active attacker seat, throw-in prompts, and `Pass` cues.
- `--role-defender-*` (crimson/red): active defender seat, uncovered attack prompts, and `Surrender` cues.
- `--trump-*` (gold/bronze): trump card borders and suit indicators.
- `--redirect-*` (violet/purple): *Perevod* reflection outline and directional indicator.
- `--clock-active-*` and `--clock-urgent-*` (cyan and orange-amber): active and low-time clock states.

User settings in `state/settings` dynamically update `--highlight-intensity` / `--highlight-intensity-scale` and `--app-roundness` on the document root so highlight glows and nested border radii (`calc(var(--app-roundness, 8px) * 1.5)` on the arena and contour) scale live.

### 4.3 Pure Hand Geometry & Memoized Rendering (`utils/handLayout.ts`, `components/GameTable.tsx`)

`utils/handLayout.ts` provides pure, DOM-free layout geometry consumed by `GameTable.tsx`:

- **`computeHandLayout`:** Keeps cards at a constant canonical footprint (`100x140` desktop, `48x68` mobile) in a single row. Small hands (`2..6` cards) sit at `HAND_SMALL_HAND_OVERLAP_RATIO` (`0.36`) centered within a six-card box; larger hands expand toward the maximal container width at `HAND_MIN_OVERLAP_RATIO` (`0.20`), then compress while preserving the `36px` rank/suit index strip (`DEFAULT_MIN_VISIBLE_INDEX_STRIP_PX` / `CARD_INDEX_STRIP_WIDTH_PX`) before falling back to tighter steps for extreme hand sizes.
- **Vertical Lift Tiers (`getCardVerticalLiftPx`):** Separates resting (`0px`), legally playable (`ELIGIBLE_LIFT_PX = 9px`), and selected (`SELECTED_LIFT_PX = 18px`) cards.
- **Localized Hover & Drag Parting (`computePartedCardLayout`, `computeDragPartedCardPositions`):** Opens a localized gap strictly to the right of the hovered card across a `HAND_HOVER_PARTING_RADIUS` of `3` neighbors, leaving left-hand and distant cards stationary at zero delta.
- **SVG Hand Contour (`buildHandContourPath`):** Generates a tight non-rectangular SVG path wrapping the laid-out cards, including lifted tiers and parted positions, with corner radii derived from `handContourCornerRadius`.
- **Memoized Card Slots (`HandCardSlot`):** Each card wrapper in `GameTable.tsx` is wrapped in `memo` and positioned exclusively with `translate3d(...)` transforms while reading live interaction handlers from a stable `api` ref, preventing pointer sweeps or hand reordering from re-rendering unaffected cards or the surrounding table.

### 4.4 Header Bar & Customization (`components/HeaderBar.tsx`)

`HeaderBar` renders the top navigation (`NAV_MENUS`), the 4-bar latency tracker (`connectionLevel`), and a profile dropdown with in-place submenus (`SUBMENU_LABELS`):

- **Sound:** Adjusts volume and switches packs exposed by `SoundEngine.soundPacks()`.
- **Theme:** Toggles dark/light `ThemeMode`, highlight presets, highlight intensity, and corner roundness.
- **Table:** Selects felt textures and palettes from `TABLE_TEXTURES` and `styles/tableTextures`.
- **Card Back:** Selects card back designs from `ALL_CARD_BACK_PATTERNS` rendered via `CardBack`.
