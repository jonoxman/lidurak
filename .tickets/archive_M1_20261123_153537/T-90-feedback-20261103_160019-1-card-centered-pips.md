<!-- WAVE:1 -->
# T-90-1: Center Numbered Face Pips, Court Letters (`J`/`Q`/`K`), and Ace Single Pip with Symmetric Vertical & Horizontal Margins

## Summary
In the previous round, the corner suit pips were enlarged to `12` viewBox units (`x = 11.5` top-left, `x = 58.5` bottom-right) and the numbered-card face pips (`2`–`10`) were enlarged to `13` units. However, the face pip grid (`x = 23.5 / 36 / 48.5`, `y = 34`–`70`) and the Ace single pip (`x = 37`) were shifted off-center relative to the `70 × 100` SVG card canvas (`viewBox="0 0 70 100"`, true center `(35, 50)`), resulting in unequal left/right and top/bottom margins.

This ticket updates `frontend/src/components/Card.tsx` (and `frontend/src/__tests__/Card.test.tsx`) so that:
1. All face pips on numbered cards (`2`–`10`), the center court letters (`J`, `Q`, `K`) and their court decoration pips, and the large single pip on the Ace (`A`) are centered on the card around `(x = 35, y = 50)`.
2. Both the horizontal margins (distance from `x = 0` and `x = 70`) and the vertical margins (distance from `y = 0` and `y = 100`) are equal on both sides, while maintaining clean separation from the enlarged corner rank/suit indices (`x = 11.5` / `x = 58.5`) and the top-right trump badge.

## Scope & Files to Touch
- `frontend/src/components/Card.tsx`
- `frontend/src/__tests__/Card.test.tsx`

*(Do NOT touch `GameTable.tsx`, `GamePage.tsx`, `table.css`, `app.css`, or backend files in this ticket.)*

## Technical Implementation Details

### 1. Card Canvas & Corner Index Preservation (`Card.tsx`)
- The SVG card canvas uses `viewBox="0 0 70 100"`, so the exact horizontal center axis is **`x = 35`** and the exact vertical center axis is **`y = 50`**.
- Keep the corner rank and suit index columns symmetric and horizontally aligned as established in the previous round:
  - Top-left index column at `x = 11.5` (`y = 21` rank, `y = 34` suit pip of font-size `12`, `text-anchor="middle"`).
  - Bottom-right index column at `x = 58.5` (`y = 96` rank, `y = 82` suit pip of font-size `12`, `text-anchor="middle"`). Notice `11.5 + 58.5 = 70`, which is already symmetric horizontally.

### 2. Numbered Cards (`2`–`10`) Symmetric Pip Grid (`ITEM-3a`)
- Replace the asymmetric face pip coordinates (`x = 23.5 / 36 / 48.5`, `y = 34`–`70`) with a grid strictly centered at **`(x = 35, y = 50)`**:
  - **Horizontal coordinates (`x`):**
    - Left column: `x = 22.5` (or `23`)
    - Center column: `x = 35`
    - Right column: `x = 47.5` (or `47`, matching `70 - leftX` so `leftMargin === rightMargin` exactly, e.g., `22.5` from the left edge `0` and `22.5` from the right edge `70`).
  - **Vertical coordinates (`y`):**
    - Top row: `y = 32` (or `33`)
    - Upper-mid row: `y = 44` (or symmetric inner offset `50 - d`)
    - Center row: `y = 50`
    - Lower-mid row: `y = 56` (or `50 + d`, matching `100 - upperMidY`)
    - Bottom row: `y = 68` (or `67`, matching `100 - topY` so `topMargin === bottomMargin` exactly: `32` from top edge `0` and `32` from bottom edge `100`, or `33` and `67`).
    - For every rank `2`–`10` (including ranks `6`, `7`, `8`, `9`, `10` and `2`, `3`, `4`, `5`):
      - The bounding box of the card's face pip coordinates must have `minX + maxX === 70` (equal left and right margins when multiple columns exist, or `x === 35` for single-column cards `2` and `3`) and `minY + maxY === 100` (equal top and bottom margins).
      - Keep face pip size at `13` viewBox units so pips remain slightly larger and crisp while staying inside the `[22.5, 47.5] × [32, 68]` inner zone, with zero overlap against the corner suit pips (`x = 11.5, y = 34` and `x = 58.5, y = 82`) or the top-right trump badge (`cx = 61, cy = 10, r = 6`).

### 3. Court Card Letters (`J`, `Q`, `K`) & Ace Single Pip (`A`) Centering (`ITEM-3b`)
- **Ace (`A`) Large Single Pip:**
  - Position the large single center pip on the Ace at **`x = 35, y = 50`** (replacing the off-center `x = 37`) with `text-anchor="middle"` and `dominant-baseline="central"` (or equivalent vertical centering around `y = 50`), so its horizontal margins (`35` from left, `35` from right) and vertical margins (`50` from top, `50` from bottom) are strictly equal on both sides, and size/carve-out clears the corner suit indices cleanly.
- **Court Cards (`J`, `Q`, `K`):**
  - Position the large serif court letter (`data-testid="card-face-letter"`, `.card-face-letter`) at **`x = 35, y = 50`** with `text-anchor="middle"` and `dominant-baseline="central"` (so its vertical and horizontal margins to the card edges are equal on both sides).
  - Ensure the court card decoration pips around `J`, `Q`, and `K` are positioned symmetrically relative to the `(35, 50)` center (`leftPipX + rightPipX === 70` and `topPipY + bottomPipY === 100`).

### 4. Automated Unit Tests (`frontend/src/__tests__/Card.test.tsx`)
- Update and add tests in `frontend/src/__tests__/Card.test.tsx` verifying:
  - Every numbered card (`2` through `10`) places its face pips symmetrically around `(35, 50)`: `minX + maxX === 70` (left margin equals right margin) and `minY + maxY === 100` (top margin equals bottom margin), with center-column pips at `x = 35` and center-row pips at `y = 50`.
  - The Ace (`A`) large center pip is centered at `x = 35, y = 50` (equal horizontal and vertical margins on both sides).
  - Court card face letters (`J`, `Q`, `K`, `data-testid="card-face-letter"`) are centered at `x = 35, y = 50` with symmetric court pip offsets around `(35, 50)`.
  - Corner pips (`data-testid="card-suit-top"` at `x = 11.5`, `data-testid="card-suit-bottom"` at `x = 58.5`) remain size `12` and horizontally aligned with the corner rank indices, with zero overlap against any face pip or trump badge.

## 15-Second Interactive QA Verification
1. Open `http://localhost:5173` and click the **`4P Chaos Targets`** or **`Surrender Half-Off`** preset in **`⚡ QA Scenarios`**.
2. Inspect numbered cards (`2`–`10`), court cards (`J`, `Q`, `K`), and Aces (`A`) in the hand and on the felt: verify that all face pips, court letters, and the Ace's single large pip sit dead-center on the card with identical top/bottom and left/right margins.

## Mandatory Acceptance Criteria Checklist
- [ ] **ITEM-3a (Numbered Card Face Pips Centered with Equal Margins):** *"3. Adjust the design so that the pips are still centred on the card (this should also apply to the letters and larger single pip for the ace). The vertical and horizontal margins should be the same on both sides."* — Wired in `frontend/src/components/Card.tsx` so numbered cards (`2`–`10`) render `13`-unit face pips centered around `(x = 35, y = 50)` with `leftMargin === rightMargin` (`minX + maxX === 70`) and `topMargin === bottomMargin` (`minY + maxY === 100`) and no overlap with corner indices or the trump badge.
- [ ] **ITEM-3b (Court Card Letters `J`/`Q`/`K` & Ace Single Pip Centered with Equal Margins):** *"3. Adjust the design so that the pips are still centred on the card (this should also apply to the letters and larger single pip for the ace). The vertical and horizontal margins should be the same on both sides."* — Wired in `frontend/src/components/Card.tsx` so the Ace single center pip and the `J`, `Q`, `K` center letters (and their court pips) are centered at `(x = 35, y = 50)` with equal horizontal and vertical margins on both sides.
- [ ] All unit tests in `frontend/src/__tests__/Card.test.tsx` pass via `cd frontend && npm test -- --run`.

