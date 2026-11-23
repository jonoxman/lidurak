<!-- WAVE:1 -->
# Ticket: `T-90-feedback-20261103_135755-1-card-typography` — Revert Corner Rank Font to Sans-Serif; Keep Fancy Serif Font Only on Large Center `J`, `Q`, `K` Letters

## Assigned Items
- **ITEM-3a:** Revert the serif font for the small numbers and letters (`2`–`10`, `J`, `Q`, `K`, `A`) in the top-left and bottom-right corners of the card (`.card-rank-index`) back to the sans-serif font stack.
- **ITEM-3b:** Only use the fancy serif font (`CARD_SERIF_FONT_FAMILY`) for the large `J`, `Q`, and `K` letters on the face of the cards (`.card-face-letter`), rather than the small letters/numbers in the corners.

---

## Context & End-to-End Wiring

### Current State
In `frontend/src/components/Card.tsx` and `frontend/src/styles/table.css`:
- `CARD_SERIF_FONT_FAMILY` (`"'Cinzel', 'Playfair Display', Georgia, 'Times New Roman', 'Palatino Linotype', 'Book Antiqua', serif"`) is currently applied to **both** the small corner rank indices (`.card-rank-index`, `data-testid="card-rank-top"`, `data-testid="card-rank-bottom"`) and the large center face letters on court cards (`.card-face-letter`, `data-testid="card-face-letter"`).

### Required Changes
1. **`frontend/src/components/Card.tsx`:**
   - Define a clean sans-serif font constant for corner indices:
     ```ts
     export const CARD_CORNER_FONT_FAMILY =
       "Inter, system-ui, -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif";
     ```
   - Keep `export const CARD_SERIF_FONT_FAMILY = "'Cinzel', 'Playfair Display', Georgia, 'Times New Roman', 'Palatino Linotype', 'Book Antiqua', serif";` for the large center `J`, `Q`, and `K` court letters.
   - On the top-left and bottom-right corner `<text>` elements (`.card-rank-index`, `data-testid="card-rank-top"`, `data-testid="card-rank-bottom"`):
     - Set `fontFamily={CARD_CORNER_FONT_FAMILY}` (reverted from `CARD_SERIF_FONT_FAMILY`).
     - Set `data-font-style="sans-serif"` (reverted from `"serif"`).
     - Keep `fontWeight="700"` and existing coordinates (`x="9"`, `y="21"`, `fontSize={rankText.length > 1 ? '12.5' : '14'}`) so the reserved corner band and pip clearance remain unchanged.
   - On the large center face-card `<text>` element rendered only for `J`, `Q`, and `K` (`FACE_LETTER[card.rank]`, `.card-face-letter`, `data-testid="card-face-letter"`):
     - Keep `fontFamily={CARD_SERIF_FONT_FAMILY}`, `data-font-style="serif"`, and `fontWeight="700"`.
2. **`frontend/src/styles/table.css`:**
   - Update `.playing-card .card-rank-index` so its `font-family` uses the sans-serif stack (`Inter, system-ui, -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif`) instead of the serif stack.
   - Ensure `.playing-card .card-face-letter` retains the fancy serif stack (`'Cinzel', 'Playfair Display', Georgia, 'Times New Roman', 'Palatino Linotype', 'Book Antiqua', serif`).
3. **`frontend/src/__tests__/Card.test.tsx`:**
   - Update existing typography assertions and add explicit unit tests verifying:
     - For every rank (`2`–`10`, `J`, `Q`, `K`, `A`), the corner rank elements (`[data-testid="card-rank-top"]` and `[data-testid="card-rank-bottom"]`, `.card-rank-index`) do **not** use `CARD_SERIF_FONT_FAMILY`; instead they use `CARD_CORNER_FONT_FAMILY` (sans-serif) and carry `data-font-style="sans-serif"`.
     - For face cards (`J`, `Q`, `K`), the large center letter (`[data-testid="card-face-letter"]`, `.card-face-letter`) uses `CARD_SERIF_FONT_FAMILY` and carries `data-font-style="serif"`.
     - Even on court cards (`J`, `Q`, `K`), the small corner letters `J`, `Q`, `K` in `[data-testid="card-rank-top"]` / `[data-testid="card-rank-bottom"]` use sans-serif while only the large center `J`, `Q`, `K` in `[data-testid="card-face-letter"]` uses the fancy serif font.

---

## Mandatory Acceptance Criteria Checklist

- [ ] **ITEM-3a (Corner Numbers & Letters Reverted to Sans-Serif):**
  > "3. Revert the serif font for the numbers/letters in the corners of the card. Only use the fancy font for the large J, Q, and K letters on the face of the cards, rather than the small letters in the corners."
  - All top-left and bottom-right corner rank indices (`.card-rank-index`, `data-testid="card-rank-top"`, `data-testid="card-rank-bottom"`) on all ranks (`2`–`10`, `J`, `Q`, `K`, `A`) render with the sans-serif font stack (`CARD_CORNER_FONT_FAMILY`) and `data-font-style="sans-serif"`.
- [ ] **ITEM-3b (Large Center `J`, `Q`, `K` Letters Keep Fancy Serif Font):**
  - The large `J`, `Q`, and `K` letters in the center of face cards (`.card-face-letter`, `data-testid="card-face-letter"`) continue to render with `CARD_SERIF_FONT_FAMILY` and `data-font-style="serif"`.
- [ ] **Automated Test Verification:**
  - `cd frontend && npm test -- --run` passes with 0 errors.
