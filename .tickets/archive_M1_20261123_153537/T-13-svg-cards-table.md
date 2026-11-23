# T-13: SVG Playing Card Components & Responsive Table Layout

## Objective
Build custom inline SVG playing card components and the responsive game table layout using Preact, CSS Grid/Flexbox, and the Lichess dark-mode aesthetic.

## Requirements

### File: `frontend/src/components/Card.tsx`

A Preact component that renders an inline SVG playing card:
- **Props:** `{ suit: string, rank: string, faceUp?: boolean, selected?: boolean, onClick?: () => void }`
- **Face-up card:** White/cream rounded rectangle with rank text (top-left, bottom-right) and suit symbol (center). Suit colors: `♠♣` = `#bababa`, `♥♦` = `#c33`.
- **Face-down card:** Dark patterned rectangle (use `#262421` with a subtle pattern or cross-hatch).
- **Selected state:** Slight upward translation (`translateY(-8px)`) and green border highlight (`#629924`).
- Card dimensions: approximately `70×100px`, scalable via CSS.

### File: `frontend/src/components/CardBack.tsx`

A simpler component for opponent card backs (no rank/suit, just the back design).

### File: `frontend/src/components/TablePair.tsx`

Renders a single attack–defense pair:
- Attack card flat, defense card overlapping at a slight offset (translate ~20px right and ~15px down).
- If no defense card, show only the attack card.

### File: `frontend/src/components/GameTable.tsx`

The main game table layout:
- **Center:** Battle area showing `TablePair` components in a flex row/wrap.
- **Bottom:** Player's own hand — fanned/sorted cards, clickable for selection.
- **Top / Sides:** Opponent areas showing card back count and player name/status.
- **Top-Right:** Talon display — stacked card backs with count badge, plus the perpendicular bottom trump card (a card rotated 90°) visible while talon > 0.
- **Trump indicator:** Badge showing trump suit symbol and color.
- **Action buttons area:** Below the hand — contextual buttons (rendered by parent, this component provides the layout slot).

### File: `frontend/src/components/ActionBar.tsx`

Action buttons component:
- **Props:** `{ legalActions: string[], onAction: (action: object) => void }`
- Buttons: "Pass" (green), "Surrender" (red), "Redirect" (yellow/amber).
- Only show buttons relevant to `legalActions`.
- Styled with Lichess aesthetic: rounded, high-contrast, hover effects.

### File: `frontend/src/styles/table.css`

- Dark theme: `#161512` background, `#262421` panels, `#bababa` text.
- Responsive layout: CSS Grid for table regions, flexbox for card rows.
- Media queries for mobile (`< 640px`): stack opponent areas above battle area, reduce card size.
- Active turn indicator: `#629924` glow/border on the current attacker/defender.

### Test File: `frontend/src/__tests__/Card.test.tsx`

- Renders face-up card with correct rank and suit text
- Renders face-down card (card back)
- Selected card has the `selected` CSS class or style
- Click handler fires on click

### Test File: `frontend/src/__tests__/GameTable.test.tsx`

- Renders player hand with correct number of cards
- Renders table pairs in the battle area
- Renders opponent summary areas
- Renders talon count

## Acceptance Criteria
- [ ] SVG cards render correctly with proper suit colors
- [ ] Table layout is responsive (no horizontal scroll at 360px width)
- [ ] All component tests pass

## Verification Command
```bash
cd frontend && npm test -- --run
```

