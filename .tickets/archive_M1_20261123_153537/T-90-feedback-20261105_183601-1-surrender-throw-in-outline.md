<!-- WAVE:1 -->
# Ticket `T-90-feedback-20261105_183601-1-surrender-throw-in-outline`: Surrender Additional Card Outline Placement (Fully on Table Above/Below Taken Cards) & Exact Card Size Matching

## Summary
Fix the positioning and sizing of the additional card (throw-in) outline (`[data-testid="throw-in-outline"]`) on the battlefield so that:
1. When any player surrenders (`BoutPhase.SurrenderThrowIn` / surrender state active), the additional card outline (`[data-testid="throw-in-outline"]`) does **not** translate half-off the table with the cards being taken. Instead, it is placed **below** the cards being taken when an opponent (`top-left`, `top-center`, `top-right`) surrenders, or **above** the cards being taken when the active user (`bottom`) is surrendering, remaining **fully on the table** (completely inside `.battlefield-tinted-box`).
2. The additional card outline (`[data-testid="throw-in-outline"]`) size **always** matches the exact size of the cards (`100px × 140px`, matching `.playing-card` and `.card-slot`) in every game phase (normal bout, covered/uncovered pairs, multi-pair overlap, and surrender throw-in) and across all viewport sizes.

---

## Mandatory Acceptance Criteria Checklist

- [ ] **ITEM-1a — Opponent Surrender (`top-left`, `top-center`, `top-right`): Additional Card Outline Placed Below Taken Cards, Fully on the Table**
  > *"1. If a user surrenders, the additional card outline should not move off the table with the cards. Instead, it should be placed below the cards being taken, so it is positioned fully on the table (or above the cards being taken, if the active user is surrendering)."*
  - In `frontend/src/components/GameTable.tsx` and `frontend/src/styles/table.css`:
    - When a top-row opponent (`data-surrender-seat="top-left"`, `"top-center"`, or `"top-right"`) surrenders, the cards being taken (`tablePairs`) continue to shift half-off the top edge of `.battlefield-tinted-box` toward that opponent's seat (`translateY(calc(-50% - 12px))`).
    - The additional card outline (`[data-testid="throw-in-outline"]`) must **not** move off the table with those cards (it must not inherit or reside inside the half-off `translateY(calc(-50% - 12px))` transform of the taken cards).
    - Instead, `[data-testid="throw-in-outline"]` must be placed **below** the cards being taken (e.g., `data-surrender-outline-position="below"`, `data-on-table="true"`), so its entire bounding box sits **fully on the table** inside `.battlefield-tinted-box` without crossing or overhanging the top, bottom, left, or right border of `.battlefield-tinted-box`.
    - When additional cards are thrown in during `SurrenderThrowIn`, those newly thrown-in cards join the taken cards row (half-off the table), while `[data-testid="throw-in-outline"]` remains below them and fully on the table (as long as the bout has fewer than 6 pairs and the defender had remaining capacity).

- [ ] **ITEM-1b — Active User Surrender (`bottom`): Additional Card Outline Placed Above Taken Cards, Fully on the Table**
  > *"1. If a user surrenders, the additional card outline should not move off the table with the cards. Instead, it should be placed below the cards being taken, so it is positioned fully on the table (or above the cards being taken, if the active user is surrendering)."*
  - In `frontend/src/components/GameTable.tsx` and `frontend/src/styles/table.css`:
    - When the active user (`data-surrender-seat="bottom"`) is surrendering, the cards being taken (`tablePairs`) continue to shift half-off the bottom edge of `.battlefield-tinted-box` toward the active user's hand (`translateY(calc(50% + 12px))`).
    - The additional card outline (`[data-testid="throw-in-outline"]`) must **not** move off the table with those cards (it must not inherit or reside inside the half-off `translateY(calc(50% + 12px))` transform of the taken cards).
    - Instead, `[data-testid="throw-in-outline"]` must be placed **above** the cards being taken (e.g., `data-surrender-outline-position="above"`, `data-on-table="true"`), so its entire bounding box sits **fully on the table** inside `.battlefield-tinted-box` without crossing or overhanging the bottom edge of `.battlefield-tinted-box`.
    - During a normal (non-surrender) active bout (`isSurrendering === false`), `[data-testid="throw-in-outline"]` continues to sit inline in the single row immediately to the right of the played cards (`data-surrender-outline-position="inline"`, `data-on-table="true"`).
    - Drag-and-drop magnetic snapping (`48px` radius via `[data-drop-zone="throw-in"]`) and double-click throw-in must continue to work seamlessly whether `[data-testid="throw-in-outline"]` is inline, below the taken cards, or above the taken cards.

- [ ] **ITEM-2 — Additional Card Outline Size Always Matches Card Size (`100px × 140px`)**
  > *"2. The additional card outline size must always match the size of the cards."*
  - In `frontend/src/components/GameTable.tsx`, `frontend/src/components/TablePair.tsx`, and `frontend/src/styles/table.css`:
    - Inspect all CSS rules and inline styles affecting `.throw-in-outline` (`[data-testid="throw-in-outline"]`), `.card-slot`, `.playing-card`, `.table-pair`, and `.table-pairs-group` (including any media queries or flex layout rules).
    - Ensure `[data-testid="throw-in-outline"]` always has the exact same width and height as a playing card on the table (`100px × 140px` in standard layout, or matching `.card-slot` / `.playing-card` at every responsive breakpoint if a breakpoint scales cards):
      - Enforce `width: 100px; height: 140px; min-width: 100px; max-width: 100px; min-height: 140px; max-height: 140px; flex: 0 0 100px; box-sizing: border-box;` on `.throw-in-outline` (`[data-testid="throw-in-outline"]`) so it never shrinks horizontally when multiple pairs are on the table (`flex-shrink: 0`), never stretches horizontally when placed in a vertical column above/below taken cards (`align-self: center` or matching anchor alignment), and never stretches vertically to include the covered-card offset reserve (`margin-bottom` / cover-card offset of `.table-pair`).
      - If `.table-pair` reserves vertical space for a defending cover card offset so inline items align with the attack card, apply any alignment offset via margin/wrapper outside `[data-testid="throw-in-outline"]` so the outline border box itself is strictly `100px × 140px` — identical to `.playing-card` / `.card-slot.attack-card`.
      - Also verify that `[data-testid="redirect-outline"]` and `[data-testid^="target-outline-"]` match the exact card dimensions (`100px × 140px`).
      - Expose `data-card-width="100"` and `data-card-height="140"` (matching `.card-slot`) on `[data-testid="throw-in-outline"]` and verify in tests that its dimensions match the cards in both normal and surrender states.

- [ ] **15-Second QA Testability & Preset Verification (`Surrender Half-Off`)**
  - Verify that clicking `Surrender Half-Off` (`surrender-half-off`) in the `⚡ QA Scenarios` panel (in `LobbyPage.tsx` or the left sidebar of `GamePage.tsx`) allows a human reviewer to observe both surrender cases and the card-size match in under 15 seconds:
    1. Click `Surrender Half-Off`: inspect the inline `[data-testid="throw-in-outline"]` next to `7♠` and confirm its size matches `7♠` (`100px × 140px`).
    2. Click `Surrender` as `Bob (You)`: observe `7♠` move half-off the bottom of `.battlefield-tinted-box` toward Bob's hand while `[data-testid="throw-in-outline"]` is placed **above** `7♠`, **fully on the table**, with the exact same `100px × 140px` size as `7♠`.
    3. Click `Alice` in the left-sidebar `PLAYERS` list to switch POV to the attacker: observe `7♠` half-off the top of `.battlefield-tinted-box` toward Bob's top seat while `[data-testid="throw-in-outline"]` is placed **below** `7♠`, **fully on the table**, with the exact same `100px × 140px` size as `7♠` (and Alice can drag a matching `7` onto it).

---

## Automated Testing Requirements
- Run `cd frontend && npm test -- --run` and ensure all existing and new unit/component tests pass.
- Add comprehensive tests in `frontend/src/__tests__/GameTable.test.tsx` (and `GamePage.test.tsx` if needed) covering:
  1. **Active user surrendering (`bottom` seat, `BoutPhase.SurrenderThrowIn`):** `[data-testid="throw-in-outline"]` is rendered **above** the taken cards (`data-surrender-outline-position="above"`, `data-on-table="true"`), is NOT inside the half-off `translateY(calc(50% + 12px))` transform of the taken cards, and remains fully inside `.battlefield-tinted-box`.
  2. **Opponent surrendering (`top-left` / `top-center` / `top-right` seat, `BoutPhase.SurrenderThrowIn`):** `[data-testid="throw-in-outline"]` is rendered **below** the taken cards (`data-surrender-outline-position="below"`, `data-on-table="true"`), is NOT inside the half-off `translateY(calc(-50% - 12px))` transform of the taken cards, and remains fully inside `.battlefield-tinted-box`.
  3. **Normal non-surrender bout (`Attacking` / `Defending`):** `[data-testid="throw-in-outline"]` remains inline to the right of the active bout pairs (`data-surrender-outline-position="inline"`, `data-on-table="true"`).
  4. **Exact card size match (`100px × 140px`):** `[data-testid="throw-in-outline"]` always has the exact `100px × 140px` card size (`width: 100px`, `height: 140px`, `flex: 0 0 100px`, `box-sizing: border-box`) across normal bouts (1 to 5 pairs, with and without covered cards) and surrender throw-in bouts (both `above` and `below` placements).
  5. **Throw-in drop interaction during surrender:** dragging and dropping a matching-rank card onto `[data-testid="throw-in-outline"]` when it is positioned below/above the taken cards still dispatches `ThrowInCards`.
