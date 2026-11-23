<!-- WAVE:3 -->
# Ticket T-90-6: `GamePage` Discard Pile UI, Split Game/Turn Clock, POV Menu, Game Over Banner & Game Review Mode

## Context & Motivation
With the backend serialization/timer/discard engine (Ticket 2) and `GameTable` props/types (Ticket 5) in place, this ticket completes the user-facing features in `GamePage.tsx` and `app.css`:
1. **Discard Pile in the `DECK` Box (Req 7):** Render the discard pile inside the `DECK` box (`[data-zone="table-deck"]`), keeping general discarded cards face-down while showing the
