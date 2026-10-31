import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { SOUND_STORAGE_KEY, SoundEngine } from '../audio/SoundEngine';

class MockAudioParam {
  value = 0;
  setValueAtTime = vi.fn((_value: number, _time: number) => this);
  linearRampToValueAtTime = vi.fn((_value: number, _time: number) => this);
  exponentialRampToValueAtTime = vi.fn((_value: number, _time: number) => this);
}

class MockAudioNode {
  connections: MockAudioNode[] = [];
  connect = vi.fn((node: MockAudioNode) => {
    this.connections.push(node);
    return node;
  });
  disconnect = vi.fn();
}

class MockOscillatorNode extends MockAudioNode {
  type = 'sine';
  frequency = new MockAudioParam();
  startTimes: number[] = [];
  stopTimes: number[] = [];
  start = vi.fn((time: number) => this.startTimes.push(time));
  stop = vi.fn((time: number) => this.stopTimes.push(time));
}

class MockGainNode extends MockAudioNode {
  gain = new MockAudioParam();
}

class MockBiquadFilterNode extends MockAudioNode {
  type = 'lowpass';
  frequency = new MockAudioParam();
  Q = new MockAudioParam();
}

class MockBufferSourceNode extends MockAudioNode {
  buffer: { length: number } | null = null;
  startTimes: number[] = [];
  start = vi.fn((time: number) => this.startTimes.push(time));
  stop = vi.fn();
}

class MockAudioContext {
  state: AudioContextState = 'running';
  currentTime = 0;
  sampleRate = 8000;
  destination = new MockAudioNode();
  oscillators: MockOscillatorNode[] = [];
  gains: MockGainNode[] = [];
  filters: MockBiquadFilterNode[] = [];
  sources: MockBufferSourceNode[] = [];
  resume = vi.fn(async () => {
    this.state = 'running';
  });

  createOscillator = vi.fn(() => {
    const oscillator = new MockOscillatorNode();
    this.oscillators.push(oscillator);
    return oscillator;
  });

  createGain = vi.fn(() => {
    const gain = new MockGainNode();
    this.gains.push(gain);
    return gain;
  });

  createBiquadFilter = vi.fn(() => {
    const filter = new MockBiquadFilterNode();
    this.filters.push(filter);
    return filter;
  });

  createBufferSource = vi.fn(() => {
    const source = new MockBufferSourceNode();
    this.sources.push(source);
    return source;
  });

  createBuffer = vi.fn((_channels: number, length: number) => ({
    length,
    getChannelData: () => new Float32Array(length),
  }));
}

const asContext = (context: MockAudioContext): AudioContext => context as unknown as AudioContext;

const requestedFrequencies = (context: MockAudioContext): number[] =>
  context.oscillators.flatMap((oscillator) =>
    oscillator.frequency.setValueAtTime.mock.calls.map((call) => call[0] as number),
  );

describe('SoundEngine', () => {
  let context: MockAudioContext;
  let engine: SoundEngine;

  beforeEach(() => {
    context = new MockAudioContext();
    engine = new SoundEngine({ context: asContext(context), storage: window.localStorage });
    window.localStorage.clear();
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
    window.localStorage.clear();
  });

  it('wires the master gain into the destination on first use', () => {
    expect(context.gains).toHaveLength(0);

    engine.playClockTick();

    expect(context.gains.length).toBeGreaterThan(0);
    expect(context.gains[0].connect).toHaveBeenCalledWith(context.destination);
  });

  it('creates an AudioContext lazily on the first sound', () => {
    class Ctor extends MockAudioContext {
      static instances: Ctor[] = [];
      constructor() {
        super();
        (this.constructor as typeof Ctor).instances.push(this);
      }
    }
    vi.stubGlobal('AudioContext', Ctor);

    const lazy = new SoundEngine({ storage: window.localStorage });
    expect(Ctor.instances).toHaveLength(0);

    lazy.playClockTick();
    expect(Ctor.instances).toHaveLength(1);

    lazy.playClockTick();
    expect(Ctor.instances).toHaveLength(1);
  });

  it('resumes a suspended context before playing', async () => {
    context.state = 'suspended';

    engine.playAttackCard();

    expect(context.resume).toHaveBeenCalled();
    await Promise.resolve();
    expect(context.state).toBe('running');
  });

  it('resumes through an explicit unlock() call', async () => {
    context.state = 'suspended';

    engine.unlock();
    await Promise.resolve();

    expect(context.resume).toHaveBeenCalledTimes(1);
    expect(engine.audioContext).toBe(asContext(context));
  });

  it('unlocks on the first user interaction listener', () => {
    context.state = 'suspended';
    const target = new EventTarget();
    engine.installUnlockListeners(target);

    target.dispatchEvent(new Event('pointerdown'));

    expect(context.resume).toHaveBeenCalled();
    engine.removeUnlockListeners();
    target.dispatchEvent(new Event('pointerdown'));
    expect(context.resume).toHaveBeenCalledTimes(1);
  });

  it('never throws when no AudioContext implementation exists', () => {
    vi.stubGlobal('AudioContext', undefined);
    vi.stubGlobal('webkitAudioContext', undefined);
    const silent = new SoundEngine({ storage: window.localStorage });

    expect(() => {
      silent.playAttackCard(2);
      silent.playDefendCard();
      silent.playRedirect();
      silent.playSurrender(3);
      silent.playTalonDraw(4);
      silent.playClockTick();
      silent.playGameOver();
      silent.unlock();
    }).not.toThrow();
    expect(silent.isSupported()).toBe(false);
  });

  it('plays every effect without throwing against a mocked context', () => {
    expect(() => {
      engine.playAttackCard(2);
      engine.playDefendCard();
      engine.playRedirect();
      engine.playSurrender(2);
      engine.playTalonDraw(2);
      engine.playClockTick();
      engine.playGameOver();
    }).not.toThrow();
  });

  it('staggers multi-card attacks 60ms apart', () => {
    engine.playAttackCard(3);

    const times = context.oscillators.map((oscillator) => oscillator.startTimes[0]);
    expect(times).toHaveLength(3);
    expect(times[0]).toBeCloseTo(0);
    expect(times[1]).toBeCloseTo(0.06);
    expect(times[2]).toBeCloseTo(0.12);
  });

  it('plays a single attack thud around 140Hz by default', () => {
    engine.playAttackCard();

    expect(context.oscillators).toHaveLength(1);
    expect(requestedFrequencies(context)[0]).toBe(140);
  });

  it('plays a crisper, higher defend thud than the attack', () => {
    engine.playAttackCard();
    const attackFrequency = requestedFrequencies(context)[0];
    context.oscillators = [];

    engine.playDefendCard();

    expect(requestedFrequencies(context)[0]).toBe(210);
    expect(requestedFrequencies(context)[0]).toBeGreaterThan(attackFrequency);
  });

  it('plays a two-pitch redirect double thud 55ms apart', () => {
    engine.playRedirect();

    const oscillators = context.oscillators;
    expect(oscillators.map((oscillator) => oscillator.startTimes[0])).toEqual([
      expect.closeTo(0, 5),
      expect.closeTo(0.055, 5),
    ]);
    expect(requestedFrequencies(context)).toEqual([260, 330]);
  });

  it('fires the surrender thud exactly once per picked-up card, 65ms apart', () => {
    engine.playSurrender(4);

    const times = context.oscillators.map((oscillator) => oscillator.startTimes[0]);
    expect(times).toHaveLength(4);
    expect(times.map((time) => Number(time.toFixed(3)))).toEqual([0, 0.065, 0.13, 0.195]);
    expect(requestedFrequencies(context)).toEqual([95, 95, 95, 95]);
  });

  it('does not play any surrender thud for an empty table', () => {
    engine.playSurrender(0);

    expect(context.oscillators).toHaveLength(0);
  });

  it('brushes the talon once per drawn card, 75ms apart', () => {
    engine.playTalonDraw(3);

    expect(context.sources).toHaveLength(3);
    const times = context.sources.map((source) => source.startTimes[0]);
    expect(times.map((time) => Number(time.toFixed(3)))).toEqual([0, 0.075, 0.15]);
    expect(context.filters.every((filter) => filter.type === 'bandpass')).toBe(true);
  });

  it('skips the talon brush when no cards were drawn', () => {
    engine.playTalonDraw(0);

    expect(context.sources).toHaveLength(0);
  });

  it('clicks the clock with a short high-frequency tick', () => {
    engine.playClockTick();

    const [oscillator] = context.oscillators;
    expect(oscillator.frequency.setValueAtTime).toHaveBeenCalledWith(1500, 0);
    expect(oscillator.startTimes[0]).toBeCloseTo(0);
    expect(oscillator.stopTimes[0]).toBeCloseTo(0.045);
  });

  it('plays the game-over chime as D5 then A5 over 500ms', () => {
    engine.playGameOver();

    expect(requestedFrequencies(context)).toEqual([587, 880]);
    const starts = context.oscillators.map((oscillator) => oscillator.startTimes[0]);
    expect(starts[0]).toBeCloseTo(0);
    expect(starts[1]).toBeCloseTo(0.18);
    expect(context.oscillators.every((oscillator) => oscillator.type === 'sine')).toBe(true);
    expect(context.oscillators[1].stopTimes[0]).toBeCloseTo(0.52);
  });

  it('stays silent and schedules nothing while muted', () => {
    engine.setMuted(true);
    context.oscillators = [];

    engine.playAttackCard(2);
    engine.playGameOver();

    expect(context.oscillators).toHaveLength(0);
    expect(engine.isMuted()).toBe(true);
  });

  it('persists the mute toggle in local storage', () => {
    expect(engine.isEnabled()).toBe(true);

    expect(engine.toggle()).toBe(false);
    expect(window.localStorage.getItem(SOUND_STORAGE_KEY)).toBe('false');

    const reloaded = new SoundEngine({ context: asContext(context), storage: window.localStorage });
    expect(reloaded.isEnabled()).toBe(false);

    engine.setEnabled(true);
    expect(window.localStorage.getItem(SOUND_STORAGE_KEY)).toBe('true');
  });

  it('survives local storage throwing', () => {
    const storage = {
      getItem: () => {
        throw new Error('blocked');
      },
      setItem: () => {
        throw new Error('blocked');
      },
    } as unknown as Storage;
    const engineWithoutStorage = new SoundEngine({ context: asContext(context), storage });

    expect(engineWithoutStorage.isEnabled()).toBe(true);
    expect(() => engineWithoutStorage.setMuted(true)).not.toThrow();
  });
});
