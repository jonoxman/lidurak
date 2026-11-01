<!-- WAVE:2 -->
# Ticket T-90-5: Frontend GamePage & GameTable — Right-Sidebar Deck/Trump Stack, Frozen Inactive Clock, Dynamic Cursor-Scrolling Hand Overlap, Table Texture Filters, & Presence Dots

## Summary
Implement all gameplay layout, hand layout, clock, table texture, and player presence requirements in `GamePage.tsx`, `GameTable.tsx`, and `table.css`:
1. **Right-Sidebar Talon Deck, Horizontal Trump Card, & Non-Overlapping `TRUMP` Suit Indicator (Feedback #7):**
   - Place the card deck, revealed trump card, and `TRUMP` suit indicator on the right side of the screen (`[data-zone="sidebar-right"]`), underneath the turn clock and `PLAYERS` list element.
   - Position the card deck vertically, with the revealed trump card placed horizontally sticking out on the right side of the deck (the left edge of the horizontal trump card aligned with the left edge of the vertical deck, and centered vertically).
   - Place the `TRUMP` suit indicator clearly below both of these elements with zero overlap.
2. **Inactive Player Turn Clock Frozen at 15 Seconds (Feedback #8):**
   - Only players currently being waited on to play should see their clock timer ticking down. For inactive players, the clock timer must remain frozen at `00:15` (15 seconds).
3. **Single-Row Dynamic Hand Overlap & Cursor-Driven Scrolling + Opponent Fixed-Box Overlap (Feedback #9):**
   - Never wrap hand cards onto a second row.
   - Use `8px` overlap as the default (cards are never farther apart than `8px` overlap).
   - When a player holds more cards than fit at `8px` overlap, increase pixel overlap up to the maximum overlap where the card's top-left pip/rank symbol remains readable.
   - When card count exceeds maximum readable overlap, stack excess cards at `100%` overlap on the ends of the hand behind the last readable card, and dynamically shift cards from the hidden stack on the right to the hidden stack on the left (and vice versa) as the player moves their cursor from left to right across their hand.
   - Apply fixed-size bounding box + dynamic single-row overlap (without mouse movement response) to opponent hands.
4. **Game Table Texture & Real-Time Brightness/Contrast/Hue Filters (Feedback #11):**
   - Color/texture the game table element using the active texture from `tableTextures.ts` / `settings.ts
