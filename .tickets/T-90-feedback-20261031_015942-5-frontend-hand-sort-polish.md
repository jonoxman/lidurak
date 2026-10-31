<!-- WAVE:2 -->
# Ticket: Frontend Hand Controls — 3-Mode SortBar, Trump Glow, Minimalist Controls & Turn Pulse

## 1. Description & Goal
Implement the 3-mode client-side hand sorting bar (Item 5), trump card visual highlight (Item 4), minimalist hand controls with contextual Surrender/Pass buttons (Item 7), subtle reflection shake (Item 15), and rhythmic turn nudge pulsing animations (Item 17).

## 2. Requirements & Specification

### Item 4: Trump Card Visual Highlight
- In `frontend/src/components/Card.tsx`, when a card belongs to the game's trump suit:
  - Apply an amber/golden border glow:
    ```css
    box-shadow: 0 0 10px rgba(212, 175, 55, 0.45);
    border-color: #d4af37;
    ```
  - Display a subtle corner trump icon/badge on the card face.

### Item 5: 3-Mode Client-Side Hand Sorting (`SortBar`)
- Create a `SortBar` component positioned in `Row 3, Col 3` (`[data-zone="player-controls"]`) to the right of the hand:
  - Toggle buttons for 3 sort modes:
    1. **`Suit` (Default):** Grouped by suit, ascending rank within each suit; trump suit grouped rightmost.
    2. **`Pairs`:** Unsuited rank-order matching identical ranks/pairs together, regardless of suit.
    3. **`Rank`:** Pure rank order ascending where all trump cards rank strictly higher than all non-trump cards.
  - Sorting is strictly client-side and never mutates server state.

### Item 7: Minimalist Hand Controls
- Remove `Attack` and `Redirect` buttons from `ActionBar`.
- Remove all text instructions below the hand.
- Place the contextual **`Surrender`** button (shown only to the defender when facing uncovered cards) and **`Pass`** button (shown only to attackers when all bout cards are covered / waiting on throw-ins) directly in `Row 3, Col 3` alongside the `SortBar`.

### Item 15: Subtle Reflection Shake
- In `frontend/src/styles/table.css`, define keyframe animation `redirectNudge`:
  - 180ms duration, subtle horizontal nudge (`±4px`), replacing any jarring recoil animations.

### Item 17: Turn Nudge Pulsing Animation
- Define keyframe animation `turnPulse` (`animation: turnPulse 2.4s infinite ease-in-out`):
  - On the **defending player's client only** when facing uncovered cards, apply `turnPulse` to the uncovered attacking card(s).
  - On the **active attacker's client only** when waited on to attack or throw in, apply the pulsing glow around their hand container (`[data-zone="player-hand"]`).
  - Do NOT display any text banners like "Your turn to defend".

## 3. Files to Touch
- `frontend/src/components/Card.tsx`
- `frontend/src/components/SortBar.tsx` (new)
- `frontend/src/components/ActionBar.tsx`
- `frontend/src/components/GameTable.tsx`
- `frontend/src/styles/table.css`
- `frontend/src/__tests__/Card.test.tsx`
- `frontend/src/__tests__/GameTable.test.tsx`

## 4. Verification & Testing
- Run `npm test -- --run` to verify UI components and styling.
- Test coverage:
  - `SortBar` switches sorting modes (`Suit`, `Pairs`, `Rank`) and reorders hand cards accordingly.
  - Trump cards receive the golden border glow and corner badge.
  - Contextual `Surrender` and `Pass` buttons render only when appropriate in `Row 3, Col 3`.
  - CSS classes for `turnPulse` apply to defender uncovered cards and attacker hand.

## 5. Autonomous Agent Workflow Steps
1. Run `git status` and `git diff` to inspect current state.
2. Implement components, styling, and tests.
3. Run `npm test -- --run` to verify all tests pass.
4. Document implemented features in `.reviews/agent_notes.md`.
5. Signal completion: `echo "DONE" > .tickets/STATUS`.
