/**
 * Zero-dependency procedural sound effects for Lidurak, synthesized with the
 * Web Audio API. No audio assets are loaded: every effect is built from
 * oscillators, gain envelopes and filtered noise bursts.
 *
 * Five cohesive packs ("Classic Felt", "Arcade 8-Bit", "Sci-Fi Synth",
 * "Acoustic Pluck", "Modern Minimal") each define a voice for every game event,
 * so switching packs never mixes chiptune beeps with acoustic chimes.
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
export const PACK_STORAGE_KEY = 'durak_sound_pack';
export const VOLUME_STORAGE_KEY = 'durak_sound_volume';

/** Master volume used when the user has never moved the slider. */
export const DEFAULT_VOLUME = 0.7;

/** Hard cap so a malformed card count can never schedule thousands of nodes. */
const MAX_SFX_REPEATS = 52;

type AudioContextConstructor = new (options?: AudioContextOptions) => AudioContext;

interface AudioContextGlobals {
  AudioContext?: AudioContextConstructor;
  webkitAudioContext?: AudioContextConstructor;
}

/** Every event a sound pack has to voice. */
export type SoundEvent =
  | 'cardPlay'
  | 'cardDefend'
  | 'cardRedirect'
  | 'pass'
  | 'surrender'
  | 'boutWon'
  | 'gameWin'
  | 'gameDurak'
  | 'invalid'
  | 'clockTick'
  | 'talonDraw';

export type SoundPackId =
  | 'classic-felt'
  | 'arcade-8bit'
  | 'sci-fi-synth'
  | 'acoustic-pluck'
  | 'modern-minimal';

/** Public pack description, enough to render a picker. */
export interface SoundPackSummary {
  id: SoundPackId;
  name: string;
  description: string;
}

interface ToneFilterSpec {
  type: BiquadFilterType;
  frequency: number;
  q?: number;
  /** Optional filter glide, for resonant sweeps. */
  sweepTo?: number;
}

interface ToneSpec {
  wave: OscillatorType;
  from: number;
  /** Glide target; omitted for a steady pitch. */
  to?: number;
  duration: number;
  peak: number;
  /** Attack time in seconds; defaults to 4ms. */
  attack?: number;
  /** Offset in seconds from the start of the event. */
  delay?: number;
  filter?: ToneFilterSpec;
}

interface NoiseSpec {
  duration: number;
  peak: number;
  filter: BiquadFilterType;
  frequency: number;
  q?: number;
  delay?: number;
}

interface EventSpec {
  tones?: ToneSpec[];
  noises?: NoiseSpec[];
  /** Spacing between repeats when an event plays once per card. */
  stagger?: number;
}

interface SoundPack extends SoundPackSummary {
  events: Record<SoundEvent, EventSpec>;
}

export interface SoundEngineOptions {
  /** Pre-built context, mainly for tests. */
  context?: AudioContext | null;
  /** Storage used to persist preferences; defaults to `localStorage`. */
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

function clampVolume(value: number): number {
  return Math.min(1, Math.max(0, value));
}

// --- Sound packs -------------------------------------------------------

/**
 * Classic Felt: organic card flicks, soft felt thuds and wooden table taps.
 * Triangles carry the body, low-passed noise adds the paper/felt texture.
 */
const CLASSIC_FELT: Record<SoundEvent, EventSpec> = {
  cardPlay: {
    tones: [{ wave: 'triangle', from: 140, to: 92, duration: 0.07, peak: 0.32 }],
    noises: [{ duration: 0.05, peak: 0.09, filter: 'lowpass', frequency: 900 }],
    stagger: 0.06,
  },
  cardDefend: {
    tones: [{ wave: 'triangle', from: 210, to: 140, duration: 0.08, peak: 0.38, attack: 0.002 }],
    noises: [{ duration: 0.045, peak: 0.12, filter: 'bandpass', frequency: 1600, q: 1.2 }],
  },
  cardRedirect: {
    tones: [
      { wave: 'triangle', from: 260, to: 200, duration: 0.055, peak: 0.34 },
      { wave: 'triangle', from: 330, to: 260, duration: 0.055, peak: 0.3, delay: 0.055 },
    ],
    noises: [{ duration: 0.04, peak: 0.1, filter: 'bandpass', frequency: 2200, q: 1.4, delay: 0.055 }],
  },
  pass: {
    tones: [{ wave: 'triangle', from: 190, to: 130, duration: 0.06, peak: 0.24 }],
    noises: [{ duration: 0.05, peak: 0.07, filter: 'lowpass', frequency: 700 }],
  },
  surrender: {
    tones: [{ wave: 'triangle', from: 95, to: 62, duration: 0.1, peak: 0.3 }],
    noises: [{ duration: 0.06, peak: 0.08, filter: 'lowpass', frequency: 600 }],
    stagger: 0.065,
  },
  boutWon: {
    tones: [
      { wave: 'triangle', from: 330, to: 392, duration: 0.09, peak: 0.26 },
      { wave: 'triangle', from: 494, to: 587, duration: 0.14, peak: 0.22, delay: 0.09 },
    ],
    noises: [{ duration: 0.06, peak: 0.06, filter: 'bandpass', frequency: 1200 }],
  },
  gameWin: {
    tones: [
      { wave: 'sine', from: 587, duration: 0.22, peak: 0.24, attack: 0.012 },
      { wave: 'sine', from: 880, duration: 0.32, peak: 0.22, attack: 0.012, delay: 0.18 },
    ],
  },
  gameDurak: {
    tones: [
      { wave: 'triangle', from: 392, duration: 0.2, peak: 0.26 },
      { wave: 'triangle', from: 311, duration: 0.24, peak: 0.24, delay: 0.16 },
      { wave: 'triangle', from: 233, duration: 0.3, peak: 0.22, delay: 0.32 },
    ],
  },
  invalid: {
    tones: [
      { wave: 'square', from: 150, to: 110, duration: 0.09, peak: 0.16 },
      { wave: 'square', from: 118, to: 96, duration: 0.09, peak: 0.14, delay: 0.1 },
    ],
    noises: [{ duration: 0.04, peak: 0.06, filter: 'bandpass', frequency: 900, q: 3 }],
  },
  clockTick: {
    tones: [{ wave: 'triangle', from: 1500, to: 1050, duration: 0.025, peak: 0.16, attack: 0.001 }],
    noises: [{ duration: 0.02, peak: 0.07, filter: 'bandpass', frequency: 3200, q: 2 }],
  },
  talonDraw: {
    noises: [{ duration: 0.06, peak: 0.16, filter: 'bandpass', frequency: 2400, q: 0.8 }],
    stagger: 0.075,
  },
};

/**
 * Arcade 8-Bit: chiptune squares, vintage blips and retro arpeggio jingles.
 */
const ARCADE_8BIT: Record<SoundEvent, EventSpec> = {
  cardPlay: {
    tones: [{ wave: 'square', from: 660, to: 880, duration: 0.06, peak: 0.16, attack: 0.002 }],
    noises: [{ duration: 0.02, peak: 0.04, filter: 'highpass', frequency: 3200 }],
    stagger: 0.055,
  },
  cardDefend: {
    tones: [{ wave: 'square', from: 880, to: 1320, duration: 0.055, peak: 0.16, attack: 0.002 }],
    noises: [{ duration: 0.02, peak: 0.05, filter: 'highpass', frequency: 4000 }],
  },
  cardRedirect: {
    tones: [
      { wave: 'square', from: 990, duration: 0.05, peak: 0.15 },
      { wave: 'square', from: 1480, duration: 0.05, peak: 0.13, delay: 0.05 },
    ],
  },
  pass: {
    tones: [{ wave: 'square', from: 330, to: 220, duration: 0.07, peak: 0.12 }],
  },
  surrender: {
    tones: [{ wave: 'square', from: 220, to: 110, duration: 0.08, peak: 0.15 }],
    stagger: 0.06,
  },
  boutWon: {
    tones: [
      { wave: 'square', from: 523, duration: 0.05, peak: 0.14 },
      { wave: 'square', from: 659, duration: 0.05, peak: 0.14, delay: 0.06 },
      { wave: 'square', from: 784, duration: 0.07, peak: 0.14, delay: 0.12 },
    ],
  },
  gameWin: {
    tones: [
      { wave: 'square', from: 523, duration: 0.06, peak: 0.15 },
      { wave: 'square', from: 659, duration: 0.06, peak: 0.15, delay: 0.08 },
      { wave: 'square', from: 784, duration: 0.06, peak: 0.15, delay: 0.16 },
      { wave: 'square', from: 1046, duration: 0.18, peak: 0.15, delay: 0.24 },
    ],
  },
  gameDurak: {
    tones: [
      { wave: 'square', from: 392, duration: 0.08, peak: 0.14 },
      { wave: 'square', from: 330, duration: 0.08, peak: 0.14, delay: 0.1 },
      { wave: 'square', from: 262, duration: 0.22, peak: 0.14, delay: 0.2 },
    ],
  },
  invalid: {
    tones: [
      { wave: 'square', from: 140, duration: 0.05, peak: 0.12 },
      { wave: 'square', from: 100, duration: 0.08, peak: 0.12, delay: 0.07 },
    ],
  },
  clockTick: {
    tones: [{ wave: 'square', from: 1760, duration: 0.02, peak: 0.12, attack: 0.001 }],
  },
  talonDraw: {
    noises: [{ duration: 0.03, peak: 0.08, filter: 'highpass', frequency: 3600 }],
    stagger: 0.06,
  },
};

/**
 * Sci-Fi Synth: resonant FM-style sweeps, futuristic chirps and gliding pads.
 */
const SCI_FI_SYNTH: Record<SoundEvent, EventSpec> = {
  cardPlay: {
    tones: [
      {
        wave: 'sawtooth',
        from: 160,
        to: 420,
        duration: 0.12,
        peak: 0.18,
        filter: { type: 'bandpass', frequency: 700, q: 6, sweepTo: 2200 },
      },
    ],
    noises: [{ duration: 0.05, peak: 0.05, filter: 'bandpass', frequency: 1800, q: 4 }],
    stagger: 0.09,
  },
  cardDefend: {
    tones: [
      {
        wave: 'sawtooth',
        from: 240,
        to: 620,
        duration: 0.14,
        peak: 0.18,
        filter: { type: 'bandpass', frequency: 900, q: 5, sweepTo: 2600 },
      },
    ],
  },
  cardRedirect: {
    tones: [
      {
        wave: 'sawtooth',
        from: 520,
        to: 780,
        duration: 0.1,
        peak: 0.16,
        filter: { type: 'bandpass', frequency: 1400, q: 4, sweepTo: 2800 },
      },
      {
        wave: 'sawtooth',
        from: 760,
        to: 1040,
        duration: 0.1,
        peak: 0.14,
        delay: 0.08,
        filter: { type: 'bandpass', frequency: 1800, q: 4, sweepTo: 3200 },
      },
    ],
  },
  pass: {
    tones: [
      {
        wave: 'sawtooth',
        from: 200,
        to: 140,
        duration: 0.1,
        peak: 0.14,
        filter: { type: 'lowpass', frequency: 900 },
      },
    ],
  },
  surrender: {
    tones: [
      {
        wave: 'sawtooth',
        from: 120,
        to: 60,
        duration: 0.16,
        peak: 0.18,
        filter: { type: 'lowpass', frequency: 500 },
      },
    ],
    noises: [{ duration: 0.08, peak: 0.05, filter: 'lowpass', frequency: 300 }],
    stagger: 0.09,
  },
  boutWon: {
    tones: [
      {
        wave: 'sawtooth',
        from: 440,
        to: 660,
        duration: 0.1,
        peak: 0.16,
        filter: { type: 'bandpass', frequency: 1200, q: 3, sweepTo: 2400 },
      },
      {
        wave: 'sawtooth',
        from: 660,
        to: 880,
        duration: 0.12,
        peak: 0.14,
        delay: 0.09,
        filter: { type: 'bandpass', frequency: 1800, q: 3, sweepTo: 3000 },
      },
    ],
  },
  gameWin: {
    tones: [
      {
        wave: 'sawtooth',
        from: 523,
        to: 784,
        duration: 0.16,
        peak: 0.16,
        filter: { type: 'bandpass', frequency: 1000, q: 3, sweepTo: 3200 },
      },
      {
        wave: 'sawtooth',
        from: 784,
        to: 1046,
        duration: 0.24,
        peak: 0.14,
        delay: 0.14,
        filter: { type: 'bandpass', frequency: 1500, q: 3, sweepTo: 3600 },
      },
    ],
  },
  gameDurak: {
    tones: [
      {
        wave: 'sawtooth',
        from: 330,
        to: 220,
        duration: 0.2,
        peak: 0.16,
        filter: { type: 'lowpass', frequency: 1200, sweepTo: 400 },
      },
      {
        wave: 'sawtooth',
        from: 165,
        to: 110,
        duration: 0.3,
        peak: 0.14,
        delay: 0.18,
        filter: { type: 'lowpass', frequency: 800, sweepTo: 300 },
      },
    ],
  },
  invalid: {
    tones: [
      {
        wave: 'sawtooth',
        from: 130,
        to: 90,
        duration: 0.12,
        peak: 0.14,
        filter: { type: 'bandpass', frequency: 600, q: 8 },
      },
    ],
    noises: [{ duration: 0.05, peak: 0.05, filter: 'bandpass', frequency: 600, q: 6 }],
  },
  clockTick: {
    tones: [
      {
        wave: 'sawtooth',
        from: 1900,
        to: 1500,
        duration: 0.03,
        peak: 0.1,
        attack: 0.001,
        filter: { type: 'bandpass', frequency: 3000, q: 5 },
      },
    ],
    noises: [{ duration: 0.02, peak: 0.04, filter: 'bandpass', frequency: 3600, q: 4 }],
  },
  talonDraw: {
    noises: [{ duration: 0.05, peak: 0.06, filter: 'bandpass', frequency: 3000, q: 2 }],
    stagger: 0.08,
  },
};

/**
 * Acoustic Pluck: warm bell/string tones on a pentatonic scale (C D E G A).
 */
const ACOUSTIC_PLUCK: Record<SoundEvent, EventSpec> = {
  cardPlay: {
    tones: [{ wave: 'triangle', from: 440, to: 392, duration: 0.09, peak: 0.2, attack: 0.006 }],
    noises: [{ duration: 0.04, peak: 0.05, filter: 'bandpass', frequency: 1500, q: 1.5 }],
    stagger: 0.08,
  },
  cardDefend: {
    tones: [{ wave: 'triangle', from: 523, to: 494, duration: 0.1, peak: 0.2, attack: 0.006 }],
    noises: [{ duration: 0.04, peak: 0.05, filter: 'bandpass', frequency: 1800, q: 1.5 }],
  },
  cardRedirect: {
    tones: [
      { wave: 'triangle', from: 587, duration: 0.12, peak: 0.18, attack: 0.006 },
      { wave: 'triangle', from: 698, duration: 0.14, peak: 0.16, delay: 0.06, attack: 0.006 },
    ],
  },
  pass: {
    tones: [{ wave: 'triangle', from: 330, to: 294, duration: 0.09, peak: 0.16, attack: 0.006 }],
  },
  surrender: {
    tones: [{ wave: 'triangle', from: 262, to: 220, duration: 0.12, peak: 0.18, attack: 0.008 }],
    noises: [{ duration: 0.05, peak: 0.04, filter: 'lowpass', frequency: 800 }],
    stagger: 0.09,
  },
  boutWon: {
    tones: [
      { wave: 'triangle', from: 523, duration: 0.16, peak: 0.18, attack: 0.008 },
      { wave: 'triangle', from: 659, duration: 0.2, peak: 0.16, delay: 0.08, attack: 0.008 },
    ],
  },
  gameWin: {
    tones: [
      { wave: 'triangle', from: 523, duration: 0.16, peak: 0.16, attack: 0.01 },
      { wave: 'triangle', from: 659, duration: 0.16, peak: 0.16, delay: 0.12, attack: 0.01 },
      { wave: 'triangle', from: 784, duration: 0.18, peak: 0.16, delay: 0.24, attack: 0.01 },
      { wave: 'triangle', from: 880, duration: 0.3, peak: 0.14, delay: 0.36, attack: 0.01 },
    ],
  },
  gameDurak: {
    tones: [
      { wave: 'triangle', from: 392, duration: 0.2, peak: 0.18, attack: 0.01 },
      { wave: 'triangle', from: 330, duration: 0.22, peak: 0.16, delay: 0.14, attack: 0.01 },
      { wave: 'triangle', from: 262, duration: 0.3, peak: 0.15, delay: 0.28, attack: 0.01 },
    ],
  },
  invalid: {
    tones: [
      { wave: 'triangle', from: 233, duration: 0.1, peak: 0.14 },
      { wave: 'triangle', from: 247, duration: 0.12, peak: 0.12, delay: 0.09 },
    ],
  },
  clockTick: {
    tones: [{ wave: 'triangle', from: 1200, to: 1100, duration: 0.03, peak: 0.12, attack: 0.002 }],
    noises: [{ duration: 0.02, peak: 0.04, filter: 'bandpass', frequency: 2800, q: 2 }],
  },
  talonDraw: {
    noises: [{ duration: 0.05, peak: 0.07, filter: 'bandpass', frequency: 2200, q: 1.2 }],
    stagger: 0.07,
  },
};

/**
 * Modern Minimal: muted UI pops, high-passed clicks and deep sub-thumps.
 */
const MODERN_MINIMAL: Record<SoundEvent, EventSpec> = {
  cardPlay: {
    tones: [{ wave: 'sine', from: 220, to: 180, duration: 0.05, peak: 0.14 }],
    noises: [{ duration: 0.02, peak: 0.05, filter: 'highpass', frequency: 4500 }],
    stagger: 0.05,
  },
  cardDefend: {
    tones: [{ wave: 'sine', from: 300, to: 260, duration: 0.05, peak: 0.14 }],
    noises: [{ duration: 0.02, peak: 0.05, filter: 'highpass', frequency: 5200 }],
  },
  cardRedirect: {
    tones: [
      { wave: 'sine', from: 260, duration: 0.04, peak: 0.12 },
      { wave: 'sine', from: 340, duration: 0.04, peak: 0.11, delay: 0.045 },
    ],
    noises: [{ duration: 0.015, peak: 0.04, filter: 'highpass', frequency: 6000 }],
  },
  pass: {
    tones: [{ wave: 'sine', from: 180, to: 150, duration: 0.06, peak: 0.12 }],
  },
  surrender: {
    tones: [{ wave: 'sine', from: 90, to: 70, duration: 0.09, peak: 0.18 }],
    noises: [{ duration: 0.04, peak: 0.04, filter: 'lowpass', frequency: 400 }],
    stagger: 0.06,
  },
  boutWon: {
    tones: [
      { wave: 'sine', from: 392, duration: 0.09, peak: 0.14 },
      { wave: 'sine', from: 523, duration: 0.14, peak: 0.12, delay: 0.07 },
    ],
  },
  gameWin: {
    tones: [
      { wave: 'sine', from: 523, duration: 0.12, peak: 0.12 },
      { wave: 'sine', from: 659, duration: 0.12, peak: 0.12, delay: 0.09 },
      { wave: 'sine', from: 784, duration: 0.16, peak: 0.12, delay: 0.18 },
    ],
  },
  gameDurak: {
    tones: [
      { wave: 'sine', from: 330, duration: 0.14, peak: 0.14 },
      { wave: 'sine', from: 262, duration: 0.2, peak: 0.12, delay: 0.11 },
    ],
  },
  invalid: {
    tones: [{ wave: 'sine', from: 160, to: 120, duration: 0.07, peak: 0.1 }],
    noises: [{ duration: 0.015, peak: 0.04, filter: 'highpass', frequency: 5000 }],
  },
  clockTick: {
    tones: [{ wave: 'sine', from: 1800, duration: 0.015, peak: 0.1, attack: 0.001 }],
    noises: [{ duration: 0.01, peak: 0.04, filter: 'highpass', frequency: 7000 }],
  },
  talonDraw: {
    noises: [{ duration: 0.03, peak: 0.05, filter: 'highpass', frequency: 3800 }],
    stagger: 0.06,
  },
};

/** All packs, in picker order. */
export const SOUND_PACKS: readonly SoundPack[] = [
  {
    id: 'classic-felt',
    name: 'Classic Felt',
    description: 'Organic card flicks and soft felt thuds',
    events: CLASSIC_FELT,
  },
  {
    id: 'arcade-8bit',
    name: 'Arcade 8-Bit',
    description: 'Chiptune blips and retro jingles',
    events: ARCADE_8BIT,
  },
  {
    id: 'sci-fi-synth',
    name: 'Sci-Fi Synth',
    description: 'Resonant sweeps and futuristic chirps',
    events: SCI_FI_SYNTH,
  },
  {
    id: 'acoustic-pluck',
    name: 'Acoustic Pluck',
    description: 'Warm pentatonic bell and string tones',
    events: ACOUSTIC_PLUCK,
  },
  {
    id: 'modern-minimal',
    name: 'Modern Minimal',
    description: 'Muted pops, clicks and sub-thumps',
    events: MODERN_MINIMAL,
  },
];

export const DEFAULT_SOUND_PACK_ID: SoundPackId = 'classic-felt';

function findPack(id: string): SoundPack | undefined {
  return SOUND_PACKS.find((pack) => pack.id === id);
}

export class SoundEngine {
  private context: AudioContext | null = null;
  private master: GainNode | null = null;
  private noiseBuffer: AudioBuffer | null = null;
  private enabled: boolean;
  private volume: number;
  private pack: SoundPack;
  private readonly storage: Storage | null;
  private readonly injectedContext: AudioContext | null;
  private unlockTarget: EventTarget | null = null;
  private readonly unlockHandler = () => this.unlock();

  constructor(options: SoundEngineOptions = {}) {
    this.injectedContext = options.context ?? null;
    this.storage = options.storage === undefined ? defaultStorage() : options.storage ?? null;
    this.enabled = this.readEnabled();
    this.volume = this.readVolume();
    this.pack = this.readPack();
  }

  /** The five available packs, as picker-ready summaries. */
  static soundPacks(): SoundPackSummary[] {
    return SOUND_PACKS.map(({ id, name, description }) => ({ id, name, description }));
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
    this.write(SOUND_STORAGE_KEY, enabled ? 'true' : 'false');
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

  // --- Volume and sound pack state -------------------------------------

  /** Master volume in `0..1`; `0` is completely silent. */
  getVolume(): number {
    return this.volume;
  }

  /** Sets the master volume, clamped to `0..1`, and persists it. */
  setVolume(volume: number): void {
    if (!Number.isFinite(volume)) return;
    this.volume = clampVolume(volume);
    if (this.master) {
      this.master.gain.value = this.volume;
    }
    this.write(VOLUME_STORAGE_KEY, String(this.volume));
  }

  /** The active pack id. */
  getSoundPack(): SoundPackId {
    return this.pack.id;
  }

  /**
   * Switches the active pack. Unknown ids are ignored, so a stale stored value
   * can never leave the engine without a voice.
   */
  setSoundPack(packId: string): boolean {
    const next = findPack(packId);
    if (!next) return false;
    this.pack = next;
    this.write(PACK_STORAGE_KEY, next.id);
    return true;
  }

  // --- Sound effects ---------------------------------------------------

  /**
   * Plays any event from the active pack. `count` repeats the per-card events
   * (attack, surrender, talon draw); other events ignore it.
   */
  playSound(event: SoundEvent, count = 1): void {
    const spec = this.pack.events[event];
    if (!spec) return;
    if (event === 'cardPlay' || event === 'surrender' || event === 'talonDraw') {
      this.playRepeated(spec, Math.max(0, clampRepeats(count)));
    } else {
      this.playRepeated(spec, 1);
    }
  }

  /** Attack card: one hit per card thrown in, staggered so groups read apart. */
  playCardPlay(count = 1): void {
    this.playRepeated(this.pack.events.cardPlay, Math.max(1, clampRepeats(count)));
  }

  /** Covering card: a crisper, higher voice than the attack. */
  playCardDefend(): void {
    this.playRepeated(this.pack.events.cardDefend, 1);
  }

  /** Redirect: the attack is reflected onto the next player. */
  playCardRedirect(): void {
    this.playRepeated(this.pack.events.cardRedirect, 1);
  }

  /** Passing the bout. */
  playPass(): void {
    this.playRepeated(this.pack.events.pass, 1);
  }

  /** Surrender: one low hit per table card taken into hand. */
  playSurrender(cardCount: number): void {
    this.playRepeated(this.pack.events.surrender, clampRepeats(cardCount));
  }

  /** A bout ends with a successful defense. */
  playBoutWon(): void {
    this.playRepeated(this.pack.events.boutWon, 1);
  }

  /** The viewer wins the match. */
  playGameWin(): void {
    this.playRepeated(this.pack.events.gameWin, 1);
  }

  /** The viewer is the Durak. */
  playGameDurak(): void {
    this.playRepeated(this.pack.events.gameDurak, 1);
  }

  /** An illegal action was attempted. */
  playInvalid(): void {
    this.playRepeated(this.pack.events.invalid, 1);
  }

  /** Paper brush for each card drawn from the talon. */
  playTalonDraw(cardCount: number): void {
    this.playRepeated(this.pack.events.talonDraw, clampRepeats(cardCount));
  }

  /**
   * Urgent tick for the last seconds of the turn. With a `remainingSeconds`
   * argument it only fires inside the final five seconds (5..1); without one it
   * always plays, for callers that already gate the timing.
   */
  playClockTick(remainingSeconds?: number): void {
    if (remainingSeconds !== undefined) {
      const inFinalSeconds = remainingSeconds >= 1 && remainingSeconds <= 5;
      if (!inFinalSeconds) return;
    }
    this.playRepeated(this.pack.events.clockTick, 1);
  }

  // --- Legacy method names ---------------------------------------------

  /** @deprecated Use [[playCardPlay]]. */
  playAttackCard(count = 1): void {
    this.playCardPlay(count);
  }

  /** @deprecated Use [[playCardDefend]]. */
  playDefendCard(): void {
    this.playCardDefend();
  }

  /** @deprecated Use [[playCardRedirect]]. */
  playRedirect(): void {
    this.playCardRedirect();
  }

  /** @deprecated Use [[playGameWin]]. */
  playGameOver(): void {
    this.playGameWin();
  }

  // --- Internals -------------------------------------------------------

  private readEnabled(): boolean {
    try {
      return this.storage?.getItem(SOUND_STORAGE_KEY) !== 'false';
    } catch {
      return true;
    }
  }

  private readVolume(): number {
    try {
      const raw = this.storage?.getItem(VOLUME_STORAGE_KEY);
      if (raw === null || raw === undefined || raw === '') return DEFAULT_VOLUME;
      const parsed = Number(raw);
      return Number.isFinite(parsed) ? clampVolume(parsed) : DEFAULT_VOLUME;
    } catch {
      return DEFAULT_VOLUME;
    }
  }

  private readPack(): SoundPack {
    try {
      const stored = this.storage?.getItem(PACK_STORAGE_KEY);
      const match = stored ? findPack(stored) : undefined;
      return match ?? findPack(DEFAULT_SOUND_PACK_ID)!;
    } catch {
      return findPack(DEFAULT_SOUND_PACK_ID)!;
    }
  }

  private write(key: string, value: string): void {
    try {
      this.storage?.setItem(key, value);
    } catch {
      // Private-mode storage failures must never break gameplay.
    }
  }

  /** Returns a usable context, creating/resuming it and honoring mute/volume. */
  private acquire(): AudioContext | null {
    if (!this.enabled || this.volume <= 0) return null;
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
      master.gain.value = this.volume;
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

  /** Plays one event spec `repeats` times, spacing per-card events by `stagger`. */
  private playRepeated(spec: EventSpec, repeats: number): void {
    if (repeats <= 0) return;
    const context = this.acquire();
    if (!context) return;
    const start = this.now(context);
    const stagger = spec.stagger ?? 0.06;
    for (let index = 0; index < repeats; index += 1) {
      this.render(context, start + index * stagger, spec);
    }
  }

  private render(context: AudioContext, start: number, spec: EventSpec): void {
    for (const tone of spec.tones ?? []) {
      this.renderTone(context, start + (tone.delay ?? 0), tone);
    }
    for (const noise of spec.noises ?? []) {
      this.noiseBurst(
        context,
        start + (noise.delay ?? 0),
        noise.duration,
        noise.peak,
        noise.filter,
        noise.frequency,
        noise.q ?? 1,
      );
    }
  }

  /** One oscillator with an optional pitch glide and optional filter sweep. */
  private renderTone(context: AudioContext, start: number, tone: ToneSpec): void {
    try {
      const oscillator = context.createOscillator();
      oscillator.type = tone.wave;
      oscillator.frequency.setValueAtTime(tone.from, start);
      if (tone.to !== undefined && tone.to !== tone.from) {
        oscillator.frequency.exponentialRampToValueAtTime(
          Math.max(1, tone.to),
          start + tone.duration,
        );
      }

      const gain = context.createGain();
      this.envelope(gain, start, tone.peak, tone.attack ?? 0.004, tone.duration);

      if (tone.filter) {
        const filter = context.createBiquadFilter();
        filter.type = tone.filter.type;
        filter.frequency.setValueAtTime(tone.filter.frequency, start);
        filter.Q.value = tone.filter.q ?? 1;
        if (tone.filter.sweepTo) {
          filter.frequency.exponentialRampToValueAtTime(
            Math.max(1, tone.filter.sweepTo),
            start + tone.duration,
          );
        }
        oscillator.connect(filter);
        filter.connect(gain);
      } else {
        oscillator.connect(gain);
      }

      gain.connect(this.destination(context));
      oscillator.start(start);
      oscillator.stop(start + tone.duration + 0.02);
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
