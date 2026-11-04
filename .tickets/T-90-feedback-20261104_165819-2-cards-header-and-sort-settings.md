<!-- WAVE:1 -->
# Ticket 2 (Wave 1): Card Corner Inversion, Symmetrical Trump Badges, Palettes Menu Rename, Default Rank Sort & Shared Frontend Types

## Scope & Files to Touch
- **Touch ONLY the following frontend files:**
  - `frontend/src/types.ts`
  - `frontend/src/api/client.ts`
  - `frontend/src/state/settings.ts`
  - `frontend/src/components/Card.tsx`
  - `frontend/src/components/HeaderBar.tsx`
  - `frontend/src/components/SortBar.tsx`
  - `frontend/src/__tests__/Card.test.tsx`
  - `frontend/src/__tests__/HeaderBar.test.tsx`
  - `frontend/src/__tests__/types.test.ts`
- **Do NOT touch `GamePage.tsx`, `GameTable.tsx`, `LobbyPage.tsx`, `table.css`, `app.css`, or `backend/` in this ticket.**

## Mandatory Acceptance Criteria Checklist

- [ ] **Shared Frontend Protocol Types & Client Helpers (`types.ts`, `client.ts`):**
  - In `frontend/src/types.ts`:
    - Add `cards?: Card[]` to `OpponentInfo`.
    - Add `transparentMode?: boolean` and `devMode?: boolean` to `PlayerGameView` and `CreateGameRequest`.
  - In `frontend/src/api/client.ts`:
    - Update `createGame` so `transparentMode?: boolean` and `devMode?: boolean` are forwarded in the `POST /api/games` JSON body.
    - Update `getGameView(gameId: string, playerId: string, requesterId?: string)` so when `requesterId` is provided, it appends `?requester=${encodeURIComponent(requesterId)}` to the request URL.

- [ ] **ITEM-4 — Rename `Highlights` Section in Profile Menu to `Palettes` (`HeaderBar.tsx`, `HeaderBar.test.tsx`):**
  > "4. Rename the Highlight section in the profile menu to "Palettes""
  - In `frontend/src/components/HeaderBar.tsx` (inside the `Theme` submenu of the profile dropdown):
    - Change the visible section title/label from `Highlights` to `Palettes`.
    - Preserve existing `data-testid` attributes on the section and preset buttons so preset selection and intensity slider hooks remain intact, and update `frontend/src/__tests__/HeaderBar.test.tsx` to expect the `"Palettes"` label.

- [ ] **ITEM-5 & ITEM-6b (SortBar & Settings) — Default Hand Sorting Schema `Rank` for New Users & 4th `"Custom"` Sort Option (`settings.ts`, `SortBar.tsx`):**
  > "5. Set the default Hand Sorting schema to Rank for new users, instead of Suit."
  > "6. ... This should automatically set the user's Hand Sorting schema to a fourth new option, "Custom" (this should not persist between games)."
  - In `frontend/src/components/SortBar.tsx` and `frontend/src/state/settings.ts`:
    - Expand `SortMode` to `'suit' | 'pairs' | 'rank' | 'custom'`.
    - Change the default hand sorting schema for new users from `'suit'` to `'rank'` (`Rank`) in `settings.ts` (if stored in `UserSettings`) and as the default fallback in `SortBar.tsx`.
    - Ensure `'custom'` is NEVER persisted to `localStorage` (if a helper saves sort mode, ignore `'custom'` so a new game always starts with the user's non-custom sort mode, defaulting to `'rank'`).
    - In `SortBar.tsx`, render all four sort buttons in the `HAND SORTING` bar:
      - `Suit` (`data-testid="sort-suit"`)
      - `Pairs` (`data-testid="sort-pairs"`)
      - `Rank` (`data-testid="sort-rank"`)
      - `Custom` (`data-testid="sort-custom"`)

- [ ] **ITEM-11 — Invert Bottom-Right Rank Symbol and Suit Icon on Cards (`Card.tsx`, `Card.test.tsx`):**
  > "11. Invert the rank symbol and suit icon on the bottom-right corner of the card (the top-left corner should stay the same)"
  - In `frontend/src/components/Card.tsx`:
    - Keep the top-left corner rank (`data-testid="card-rank-top"`, `x = 11.5`, `y = 21`) and suit (`data-testid="card-suit-top"`, `x = 11.5`, `y = 34`) upright and unchanged.
    - Invert (`rotate(180)`) the bottom-right corner rank (`data-testid="card-rank-bottom"`) and suit (`data-testid="card-suit-bottom"`) so they are rotated 180 degrees relative to the top-left corner (180° rotational symmetry around the `(35, 50)` card center: the upside-down rank sits nearest the bottom-right corner at `(58.5, 79)` rotated 180° around its anchor or via `transform="rotate(180 ...)"`, and the upside-down suit sits directly above it at `(58.5, 66)` rotated 180°).
    - Expose `data-inverted="true"` on both `card-rank-bottom` and `card-suit-bottom` (and `data-inverted="false"` on `card-rank-top` and `card-suit-top`) and verify in `Card.test.tsx`.

- [ ] **ITEM-12a & ITEM-12b (Card Component) — Symmetrical & Inverted Top-Right and Bottom-Left Trump Highlight Icons (`Card.tsx`, `Card.test.tsx`):**
  > "12. Redesign the trump highlight on the cards as follows: First, remove the glowing aura from trump cards. Second, place the trump highlight icon in the bottom-left of the card as well as the top-right, since the left side of the card is always visible regardless of overlap. The two highlight icons should be symmetrical, but inverted relative to one another (in the same way as the suit icons on the cards are based on #11)."
  - In `frontend/src/components/Card.tsx`:
    - Ensure `Card.tsx` does not apply any inline glowing `box-shadow` or aura to trump cards (`data-trump-glow="false"`).
    - When `isTrump` is `true`, render TWO symmetrical trump highlight badges on the `70 × 100` SVG canvas:
      1. **Top-right trump badge** (`data-testid="trump-badge"` and `data-testid="trump-badge-top-right"`, `data-inverted="false"`): centered at `(58.5, 14)` (upright, `r = 6`, with the upright trump suit glyph or star/suit icon).
      2. **Bottom-left trump badge** (`data-testid="trump-badge-bottom-left"`, `data-inverted="true"`): centered at the exact 180°-symmetric coordinates `(11.5, 86)` (`58.5 + 11.5 = 70`, `14 + 86 = 100`) and inverted 180 degrees (`transform="rotate(180 11.5 86)"`) relative to the top-right badge. Because `x = 11.5` lies inside the `>= 22px` minimum visible left strip of overlapped cards, the bottom-left trump highlight icon is always visible regardless of card overlap.
    - Add unit tests in `frontend/src/__tests__/Card.test.tsx` verifying both `trump-badge-top-right` and `trump-badge-bottom-left`, their exact 180° rotational symmetry (`x1 + x2 = 70`, `y1 + y2 = 100`), their relative inversion, and the inverted bottom-right rank/suit indices.

## Verification
- Run `cd frontend && npm test -- --run src/__tests__/Card.test.tsx src/__tests__/HeaderBar.test.tsx src/__tests__/types.test.ts` and ensure all tests pass.

