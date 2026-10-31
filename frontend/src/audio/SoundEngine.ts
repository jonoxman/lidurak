/**
 * Zero-dependency procedural sound effects for Lidurak, synthesized with the
 * Web Audio API. No audio assets are loaded: every effect is built from
 * oscillators, gain envelopes and filtered noise bursts.
 *
 * The engine is defensive by design:
 * - `AudioContext` may be missing entirely (Node/jsdom, old browsers), in which
 *   case every `play*` call is a silent no-op.
 * - Browsers start a context in the `suspended` state until a user gesture, so
 *   the context is created lazily and resumed on demand.
 * - Calling any `play*` method inside a gesture handler is enough to unlock it;
 *   `installUnlockListeners()` additionally unlocks on the first
 *   pointer/touch/key interaction.
 */

export const SOUND_STORAGE_KEY = 'lidurak.sound.enabled';

/** Hard cap so a malformed card count can never schedule thousands of nodes. */
const MAX_SFX_REPEATS = 52;

type AudioContextConstructor = new (options?: AudioContextOptions) => AudioContext;

interface AudioContextGlobals {
  AudioContext?: AudioContextConstructor;
  webkitAudioContext?: AudioContextConstructor;
}

export interface SoundEngineOptions {
  /** Pre-built context, mainly for tests. */
  context?: AudioContext | null;
  /** Storage used to persist the mute toggle; defaults to `localStorage`. */
  storage?: Storage | null;
}

function defaultStorage(): Storage | null {
  try {
    if (typeof globalThis === 'undefined') return null;
    return (globalThis as { localStorage?: Storage }).localStorage ?? null;
  } catch {
    return null;
  }
}

function findAudioContextConstructor(): AudioContextConstructor | null {
  if (typeof globalThis === 'undefined') return null;
  const scope = globalThis as unknown as AudioContextGlobals;
  return scope.AudioContext ?? scope.webkitAudioContext ?? null;
}

function clampRepeats(value: number): number {
  if (!Number.isFinite(value)) return 0;
  return Math.min(MAX_SFX_REPEATS, Math.max(0, Math.floor(value)));
}

export class SoundEngine {
  private context: AudioContext | null = null;
  private master: GainNode | null = null;
  private noiseBuffer: AudioBuffer | null = null;
  private enabled: boolean;
  private readonly storage: Storage | null;
  private readonly injectedContext: AudioContext | null;
  private unlockTarget: EventTarget | null = null;
  private readonly unlockHandler = () => this.unlock();

  constructor(options: SoundEngineOptions = {}) {
    this.injectedContext = options.context ?? null;
    this.storage = options.storage === undefined ? defaultStorage() : options.storage ?? null;
    this.enabled = this.readEnabled();
  }

  // --- Initialization, resume and muting -------------------------------

  /** Creates the `AudioContext` on first use and returns it (or null). */
  init(): AudioContext | null {
    return this.ensureContext();
  }

  /** The live context, without creating one. */
  get audioContext(): AudioContext | null {
    return this.context ?? this.injectedContext;
  }

  isSupported(): boolean {
    return this.audioContext !== null || findAudioContextConstructor() !== null;
  }

  isEnabled(): boolean {
    return this.enabled;
  }

  /** True when sound is switched off by the user. */
  isMuted(): boolean {
    return !this.enabled;
  }

  /** Enables or disables every effect, persisting the choice. */
  setEnabled(enabled: boolean): void {
    this.enabled = enabled;
    try {
      this.storage?.setItem(SOUND_STORAGE_KEY, enabled ? 'true' : 'false');
    } catch {
      // Private-mode storage failures must never break gameplay.
    }
    if (enabled) {
      void this.resume();
    }
  }

  setMuted(muted: boolean): void {
    this.setEnabled(!muted);
  }

  /** Flips the mute toggle and returns the new enabled state. */
  toggle(): boolean {
    this.setEnabled(!this.enabled);
    return this.enabled;
  }

  /** Resumes a suspended context; safe to call outside a user gesture. */
  async resume(): Promise<void> {
    const context = this.audioContext;
    if (!context || typeof context.resume !== 'function') return;
    if (context.state === 'running') return;
    try {
      await context.resume();
    } catch {
      // Autoplay policies reject until the next gesture; try again later.
    }
  }

  /** Resumes the context in response to a user gesture. */
  unlock(): void {
    const context = this.ensureContext();
    if (!context) return;
    void this.resume();
    if (this.unlockTarget) {
      this.removeUnlockListeners();
    }
  }

  /**
   * Installs one-shot listeners so the first click/touch/drag/key press
   * resumes a context the browser started in the `suspended` state.
   */
  installUnlockListeners(target: EventTarget | null = typeof window === 'undefined' ? null : window): void {
    if (!target || typeof (target as EventTarget).addEventListener !== 'function') return;
    this.removeUnlockListeners();
    this.unlockTarget = target;
    for (const event of ['pointerdown', 'touchstart', 'keydown'] as const) {
      target.addEventListener(event, this.unlockHandler, { passive: true });
    }
  }

  removeUnlockListeners(): void {
    if (!this.unlockTarget) return;
    for (const event of ['pointerdown', 'touchstart', 'keydown'] as const) {
      this.unlockTarget.removeEventListener(event, this.unlockHandler);
    }
    this.unlockTarget = null;
  }

  // --- Sound effects ---------------------------------------------------

  /**
   * Attack card thud: soft low-mid percussive hit. Multiple cards are staggered
   * by 60ms so a pair/three-of-a-kind reads as separate throws.
   */
  playAttackCard(count = 1): void {
    const context = this.acquire();
    if (!context) return;
    const repeats = Math.max(1, clampRepeats(count));
    for (let index = 0; index < repeats; index += 1) {
      const start = context.currentTime + index * 0.06;
      this.thud(context, start, 140, 92, 0.07, 0.32);
      this.noiseBurst(context, start, 0.05, 0.09, 'lowpass', 900);
    }
  }

  /** Defend card thud: higher pitch with a harder attack. */
  playDefendCard(): void {
    const context = this.acquire();
    if (!context) return;
    const start = context.currentTime;
    this.thud(context, start, 210, 140, 0.08, 0.38, 0.002);
    this.noiseBurst(context, start, 0.045, 0.12, 'bandpass', 1600, 1.2);
  }

  /** Redirect: rapid two-pitch double thud (260Hz -> 330Hz). */
  playRedirect(): void {
    const context = this.acquire();
    if (!context) return;
    const start = context.currentTime;
    this.thud(context, start, 260, 200, 0.055, 0.34);
    this.thud(context, start + 0.055, 330, 260, 0.055, 0.3);
    this.noiseBurst(context, start + 0.055, 0.04, 0.1, 'bandpass', 2200, 1.4);
  }

  /** Surrender: one low thud per table card picked up, 65ms apart. */
  playSurrender(cardCount: number): void {
    const context = this.acquire();
    if (!context) return;
    const repeats = clampRepeats(cardCount);
    for (let index = 0; index < repeats; index += 1) {
      const start = context.currentTime + index * 0.065;
      this.thud(context, start, 95, 62, 0.1, 0.3);
      this.noiseBurst(context, start, 0.06, 0.08, 'lowpass', 600);
    }
  }

  /**
   * Talon draw: soft paper brush (bandpass-filtered noise), one per card drawn,
   * spaced 75ms apart. Callers invoke this only when the local viewer draws.
   */
  playTalonDraw(cardCount: number): void {
    const context = this.acquire();
    if (!context) return;
    const repeats = clampRepeats(cardCount);
    for (let index = 0; index < repeats; index += 1) {
      const start = context.currentTime + index * 0.075;
      this.noiseBurst(context, start, 0.06, 0.16, 'bandpass', 2400, 0.8);
    }
  }

  /** Subtle wooden clock tick for the final 5 seconds of a turn. */
  playClockTick(): void {
    const context = this.acquire();
    if (!context) return;
    const start = context.currentTime;
    this.thud(context, start, 1500, 1050, 0.025, 0.16, 0.001);
    this.noiseBurst(context, start, 0.02, 0.07, 'bandpass', 3200, 2);
  }

  /** Two-note game-over chime: D5 (587Hz) then A5 (880Hz). */
  playGameOver(): void {
    const context = this.acquire();
    if (!context) return;
    const start = context.currentTime;
    this.tone(context, start, 587, 0.22, 0.24);
    this.tone(context, start + 0.18, 880, 0.32, 0.22);
  }

  // --- Internals -------------------------------------------------------

  private readEnabled(): boolean {
    try {
      return this.storage?.getItem(SOUND_STORAGE_KEY) !== 'false';
    } catch {
      return true;
    }
  }

  /** Returns a usable context, creating/resuming it and honoring mute. */
  private acquire(): AudioContext | null {
    if (!this.enabled) return null;
    const context = this.ensureContext();
    if (!context) return null;
    if (context.state === 'suspended') {
      void this.resume();
    }
    return context;
  }

  private ensureContext(): AudioContext | null {
    if (this.context) return this.context;
    if (this.injectedContext) {
      this.context = this.injectedContext;
      this.master = this.connectMaster(this.injectedContext);
      return this.context;
    }
    const Constructor = findAudioContextConstructor();
    if (!Constructor) return null;
    try {
      this.context = new Constructor();
    } catch {
      this.context = null;
      return null;
    }
    this.master = this.connectMaster(this.context);
    return this.context;
  }

  private connectMaster(context: AudioContext): GainNode | null {
    try {
      const master = context.createGain();
      master.gain.value = 0.9;
      master.connect(context.destination);
      return master;
    } catch {
      return null;
    }
  }

  private destination(context: AudioContext): AudioNode {
    return this.master ?? context.destination;
  }

  private now(context: AudioContext): number {
    return Number.isFinite(context.currentTime) ? context.currentTime : 0;
  }

  private envelope(gain: GainNode, start: number, peak: number, attack: number, duration: number): void {
    const end = start + duration;
    gain.gain.setValueAtTime(0.0001, start);
    gain.gain.linearRampToValueAtTime(peak, start + Math.max(0.001, attack));
    gain.gain.exponentialRampToValueAtTime(0.0001, end);
  }

  /** Pitched percussive body used by the card thuds and clock tick. */
  private thud(
    context: AudioContext,
    start: number,
    frequency: number,
    endFrequency: number,
    duration: number,
    peak: number,
    attack = 0.004,
  ): void {
    try {
      const oscillator = context.createOscillator();
      oscillator.type = 'triangle';
      oscillator.frequency.setValueAtTime(frequency, start);
      oscillator.frequency.exponentialRampToValueAtTime(endFrequency, start + duration);

      const gain = context.createGain();
      this.envelope(gain, start, peak, attack, duration);

      oscillator.connect(gain);
      gain.connect(this.destination(context));
      oscillator.start(start);
      oscillator.stop(start + duration + 0.02);
    } catch {
      // A single failed node must not break the rest of the effect.
    }
  }

  /** Short filtered white-noise burst (percussive texture / paper brush). */
  private noiseBurst(
    context: AudioContext,
    start: number,
    duration: number,
    peak: number,
    filterType: BiquadFilterType,
    frequency: number,
    q = 1,
  ): void {
    try {
      const source = context.createBufferSource();
      source.buffer = this.getNoiseBuffer(context);

      const filter = context.createBiquadFilter();
      filter.type = filterType;
      filter.frequency.setValueAtTime(frequency, start);
      filter.Q.value = q;

      const gain = context.createGain();
      this.envelope(gain, start, peak, 0.003, duration);

      source.connect(filter);
      filter.connect(gain);
      gain.connect(this.destination(context));
      source.start(start);
      source.stop(start + duration);
    } catch {
      // Ignore individual node failures.
    }
  }

  /** Sustained sine note with an exponential decay, used by the end chime. */
  private tone(context: AudioContext, start: number, frequency: number, duration: number, peak: number): void {
    try {
      const oscillator = context.createOscillator();
      oscillator.type = 'sine';
      oscillator.frequency.setValueAtTime(frequency, start);

      const gain = context.createGain();
      this.envelope(gain, start, peak, 0.012, duration);

      oscillator.connect(gain);
      gain.connect(this.destination(context));
      oscillator.start(start);
      oscillator.stop(start + duration + 0.02);
    } catch {
      // Ignore individual node failures.
    }
  }

  private getNoiseBuffer(context: AudioContext): AudioBuffer | null {
    if (this.noiseBuffer) return this.noiseBuffer;
    try {
      const sampleRate = context.sampleRate > 0 ? context.sampleRate : 44100;
      const length = Math.max(1, Math.floor(sampleRate));
      const buffer = context.createBuffer(1, length, sampleRate);
      const data = buffer.getChannelData(0);
      for (let index = 0; index < data.length; index += 1) {
        data[index] = Math.random() * 2 - 1;
      }
      this.noiseBuffer = buffer;
      return buffer;
    } catch {
      return null;
    }
  }
}

/** Process-wide singleton used by the game table. */
export const soundEngine = new SoundEngine();

export default soundEngine;
