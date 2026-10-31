<!-- WAVE:1 -->
# Ticket T-90-feedback-20261031_010137-2: Frontend Synthesized Web Audio Sound Engine (`SoundEngine.ts`)

## Subsystem
Frontend Audio Architecture (`frontend/src/audio/SoundEngine.ts`, `frontend/src/__tests__/SoundEngine.test.ts`)

## Description & Scope
Implement a zero-dependency Web Audio API synthesizer (`SoundEngine.ts`) that programmatically generates all game sound effects and provides event methods for card plays, covers, redirections, surrenders, deck draws, clock ticks, and game over chimes.

### Requirements Covered
- **Item 2: Synthesized Web Audio Sound Effects (`SoundEngine.ts`)**
  - **Play / Attack Card:** Low-mid soft percussive thud (`~140Hz` sine/triangle wave + short filtered noise burst, `70ms` duration). If multiple cards are played at once, stagger thuds by `60ms`.
  - **Cover / Defend Card:** Slightly higher-pitched, crisper thud (`~210Hz` with stronger attack emphasis, `80ms` duration).
  - **Redirect (`Perevod`):** Distinct two-pitch rapid double-thud (`~260Hz` -> `~330Hz`, `110ms` total duration).
  - **Surrender (Pick Up Cards):** Series of lower-pitched thuds (`~95Hz`) played in quick succession (`65ms` apart), matching the exact number of cards picked up from the table.
  - **Draw from Talon Deck (Player-Specific):** Soft paper/page-turn brush sound (band-pass filtered noise burst) played in quick succession (`75ms` apart) as many times as cards were drawn—played **only** for the specific player whose hand drew cards.
  - **5-Second Clock Warning (Player-Specific, Item 19):** Subtle `"tick-tick-tick"` wooden/mechanical click once per second during the final 5 seconds (`00:05` down to `00:01`) for the player currently being waited on.
  - **Game Over ("Ding!"):** Crisp Lichess-style two-note chime (`~587Hz` D5 -> `~880Hz` A5) played when the game finishes.
- **Audio Lifecycle & Browser Autoplay Compliance:**
  - Create audio context lazily on first user interaction (`pointerdown`, `click`, or drag).
  - Safely handle suspended/closed AudioContext states without throwing unhandled exceptions.
  - Provide a toggle or mute state to allow silencing.

## Target Files
- `frontend/src/audio/SoundEngine.ts` (New File)
- `frontend/src/__tests__/SoundEngine.test.ts` (New File)

## Implementation Steps
1. Create `frontend/src/audio/SoundEngine.ts`:
   - Initialize `window.AudioContext || window.webkitAudioContext`.
   - Implement synthesized sound functions using Web Audio nodes (`OscillatorNode`, `GainNode`, `BiquadFilterNode`, and synthesized audio buffer for paper noise).
   - Export helper class or singleton `soundEngine` with methods:
     - `playAttack(count = 1): void`
     - `playDefend(): void`
     - `playRedirect(): void`
     - `playSurrender(cardCount: number): void`
     - `playDraw(cardCount: number): void`
     - `playClockTick(): void`
     - `playGameOver(): void`
     - `ensureContext(): Promise<void>`
2. Create unit tests in `frontend/src/__tests__/SoundEngine.test.ts`:
   - Mock `AudioContext`, `OscillatorNode`, `GainNode`, and verify node connections, scheduling timings, and frequencies.
   - Verify that multiple card attacks schedule staggered triggers.
   - Verify that surrender schedules `N` thuds.

## Verification Commands
- `npm test -- --run`

## Completion Requirements
- All unit tests pass cleanly with `npm test -- --run`.
- No external audio files or network dependencies introduced; 100% Web Audio synthesis.
- Update `.reviews/agent_notes.md` with implementation summary.
- Run `echo "DONE" > .tickets/STATUS`.
