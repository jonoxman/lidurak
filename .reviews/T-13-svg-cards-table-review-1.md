### Code Review: T-13 SVG Playing Card Components & Responsive Table Layout

#### 1. Scope & Requirement Verification
- **`Card.tsx` & `CardBack.tsx`**:
  - Implements inline SVG card components at standard 70×100 viewBox dimensions.
  - Correct suit palette adhered to (`#c33` for `♥♦`, `#bababa` for `♠♣`).
  - Face-down rendering leverages the patterned SVG cross-hatch with dark `#262421` theme.
  - Card selection translates card upward (`translateY(-8px)`) with the required `#629924` accent outline.
- **`TablePair.tsx`**:
  - Renders flat attack card and positions defense card overlapping at `top: 15px; left: 20px;`.
  - Accurately renders attack only if `defense` is nullish.
- **`GameTable.tsx`**:
  - Structured layout with opponents, status/talon, central battle area, sorted player hand, and child actions slot.
  - Talon displays stacked card backs, numeric count badge, and perpendicular 90° rotated bottom trump card conditional on `talonCount > 0`.
  - Trump indicator badge correctly reflects suit symbol and color.
  - Hand sorting is pure (`[...hand].sort(...)`) and does not mutate incoming props.
- **`ActionBar.tsx`**:
  - Contextually filters actions based on `legalActions`.
  - Correctly maps action buttons: "Pass" (green), "Surrender" (red), and "Redirect" (amber).
- **`table.css`**:
  - CSS Grid with designated template areas (`opponents`, `status`, `battle`, `hand`, `actions`).
  - Correct Lichess dark theme variables (`#161512` background, `#262421` panel, `#bababa` text).
  - Turn indicator applies `#629924` border and glow to active attacker and defender.
  - Breakpoint at `< 640px` stacks table areas, adjusts card dimensions (48×68px), and prevents horizontal overflow at 360px viewports.

#### 2. Security & Code Quality
- **XSS & Injection**: Text nodes in SVG elements rely on standard Preact JSX text binding (`{symbol}`, `{label}`), avoiding `dangerouslySetInnerHTML`.
- **CSS / Layout Robustness**: Uses `box-shadow` for selection highlighting and turn indicators, avoiding layout jumps/reflows. Flexible wrapping ensures responsive containment at small viewport widths.

#### 3. Test Coverage
- `Card.test.tsx` and `GameTable.test.tsx` cover all specified test criteria: face-up rank/suit text, suit color branching, face-down back rendering, selection state, click event triggering, hand card counts, battle table pairs, opponent summaries, active turns, and talon/trump visibility under both non-empty and empty talon states.

VERDICT: APPROVED
