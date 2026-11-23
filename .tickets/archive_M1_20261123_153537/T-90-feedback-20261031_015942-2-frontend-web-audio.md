<!-- WAVE:1 -->
# Ticket: Frontend Web Audio Synthesizer — Zero-Dependency SoundEngine

## 1. Description & Goal
Implement a standalone, zero-dependency Web Audio API synthesizer module (`frontend/src/audio/SoundEngine.ts`) that procedurally synthesizes all game sound effects (card attacks, defenses, redirections, surrender card pickups, talon draws, 5-second countdown clicks, and game over chimes) according to Item 2 of the specification.

## 2. Requirements & Specification

### Item 2: Synthesized Web Audio Sound Effects (`SoundEngine.ts`)
Create `frontend/src/audio/SoundEngine.ts` exporting a singleton or class `SoundEngine` with programmatic audio synthesis using `AudioContext`:
1. **Browser AudioContext Policy & Initialization:**
   - Handle suspended `AudioContext` states gracefully; lazily initialize or resume context on the first user interaction (click/touch/drag).
   - Provide a global sound mute/enable toggle with local storage persistence.
2. **Procedural Sound Generators:**
   - **Play / Attack Card (`playAttackCard(count = 1)`):**
     - Low-mid soft percussive thud (`~140Hz` sine/triangle wave + short filtered noise burst, duration `70ms`).
     - If `count > 1` (multiple cards thrown), stagger successive thuds by `60ms`.
   - **Cover / Defend Card (`playDefendCard()`):**
     - Slightly higher-pitched, crisper thud (`~210Hz` with strong initial attack envelope, duration `80ms`).
   - **Redirect Card (`playRedirect()`):**
     - Distinct two-pitch rapid double-thud (`~260Hz` -> `~330Hz`, total duration `110ms`).
   - **Surrender Card Pickup (`playSurrender(cardCount: number)`):**
     - Series of lower-pitched thuds (`~95Hz`) played in quick succession (`65ms` apart), firing exactly `cardCount` times to represent picking up each table card.
   - **Draw from Talon Deck (`playTalonDraw(cardCount: number)`):**
     - Soft paper/page-turn brush sound (bandpass filtered white noise burst with quick decay, `75ms` interval) played as many times as cards were drawn.
     - Parameterized so caller can invoke only when the local active viewer draws cards.
   - **5-Second Clock Warning (`playClockTick()`):**
     - Subtle `"tick-tick-tick"` wooden/mechanical click (short high-frequency click, duration `25ms`), invoked once per second during the final 5 seconds (`00:05` down to `00:01`).
   - **Game Over Chime (`playGameOver()`):**
     - Crisp Lichess-style two-note chime (`~587Hz` [D5] -> `~880Hz` [A5] sine waves with smooth exponential decay, total duration `500ms`).

## 3. Files to Touch
- `frontend/src/audio/SoundEngine.ts` (new)
- `frontend/src/__tests__/SoundEngine.test.ts` (new)

## 4. Verification & Testing
- Create unit tests in `frontend/src/__tests__/SoundEngine.test.ts` testing:
  - AudioContext initialization and resume.
  - Calling all sound methods without throwing errors in Node/jsdom test environments (mocking `AudioContext`, `OscillatorNode`, `GainNode`, `BiquadFilterNode` where necessary).
  - Stagger timing and loop counts for multi-card attacks and surrenders.
- Run `npm test -- --run` to verify test execution.

## 5. Autonomous Agent Workflow Steps
1. Run `git status` and `git diff` to inspect current state.
2. Create `frontend/src/audio/SoundEngine.ts` and test file.
3. Run `npm test -- --run` and ensure all tests pass.
4. Document implemented features in `.reviews/agent_notes.md`.
5. Signal completion: `echo "DONE" > .tickets/STATUS`.
