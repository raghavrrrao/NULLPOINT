import { createLogger } from "@nullpoint/shared";

const log = createLogger("audio");

/**
 * Sound identifiers. The abstraction the rest of the game talks to.
 *
 * Combat code calls `play(GameSound.WeaponFire)` and knows nothing about how the
 * sound is produced, so replacing the synthesised placeholders with real
 * licensed samples later touches this file only.
 */
export const GameSound = {
  WeaponFire: "WEAPON_FIRE",
  WeaponDryFire: "WEAPON_DRY_FIRE",
  ReloadStart: "RELOAD_START",
  ReloadEnd: "RELOAD_END",
  TargetHit: "TARGET_HIT",
  TargetDestroyed: "TARGET_DESTROYED",
} as const;

export type GameSound = (typeof GameSound)[keyof typeof GameSound];

export interface AudioSystem {
  play(sound: GameSound): void;
  /** Browsers require a user gesture before audio may start. */
  resume(): void;
  readonly isReady: boolean;
  /** Sounds played since construction. Development hook. */
  readonly playCount: number;
  setMuted(muted: boolean): void;
  dispose(): void;
}

/** Caps concurrent voices so held fire cannot spawn unbounded audio nodes. */
const MAX_VOICES = 16;

/**
 * Web Audio implementation with synthesised placeholder sounds.
 *
 * No weapon audio with a verifiable licence is in the repository, and the brief
 * says audio must not block combat. These are short synthesised approximations —
 * noise burst plus pitch-swept body for the shot, filtered clicks for the
 * reload — good enough to make firing feel responsive, and obviously temporary.
 */
class WebAudioSystem implements AudioSystem {
  private context: AudioContext | null = null;
  private master: GainNode | null = null;
  private noiseBuffer: AudioBuffer | null = null;
  private voices = 0;
  private plays = 0;
  private muted = false;

  constructor() {
    try {
      this.context = new AudioContext();
      this.master = this.context.createGain();
      this.master.gain.value = 0.35;
      this.master.connect(this.context.destination);
      this.noiseBuffer = this.createNoiseBuffer(this.context);
    } catch (error) {
      // A missing or blocked AudioContext must not stop the game starting.
      log.warn("Web Audio unavailable; running silent", error);
      this.context = null;
    }
  }

  get isReady(): boolean {
    return this.context !== null;
  }

  get playCount(): number {
    return this.plays;
  }

  setMuted(muted: boolean): void {
    this.muted = muted;
    if (this.master !== null) this.master.gain.value = muted ? 0 : 0.35;
  }

  resume(): void {
    if (this.context !== null && this.context.state === "suspended") {
      void this.context.resume().catch((error: unknown) => log.warn("audio resume failed", error));
    }
  }

  play(sound: GameSound): void {
    const context = this.context;
    const master = this.master;
    if (context === null || master === null || this.muted) return;
    if (this.voices >= MAX_VOICES) return;
    if (context.state === "suspended") return;

    this.plays += 1;
    const now = context.currentTime;

    switch (sound) {
      case GameSound.WeaponFire:
        this.playShot(context, master, now);
        break;
      case GameSound.WeaponDryFire:
        this.playClick(context, master, now, 2400, 0.04, 0.25);
        break;
      case GameSound.ReloadStart:
        this.playClick(context, master, now, 900, 0.09, 0.4);
        break;
      case GameSound.ReloadEnd:
        this.playClick(context, master, now, 1500, 0.07, 0.45);
        break;
      case GameSound.TargetHit:
        this.playClick(context, master, now, 1800, 0.05, 0.3);
        break;
      case GameSound.TargetDestroyed:
        this.playClick(context, master, now, 520, 0.28, 0.5);
        break;
    }
  }

  /** Noise burst plus a fast downward pitch sweep — a serviceable rifle crack. */
  private playShot(context: AudioContext, master: GainNode, now: number): void {
    if (this.noiseBuffer !== null) {
      const noise = context.createBufferSource();
      noise.buffer = this.noiseBuffer;

      const bandpass = context.createBiquadFilter();
      bandpass.type = "bandpass";
      bandpass.frequency.value = 1800;
      bandpass.Q.value = 0.7;

      const gain = context.createGain();
      gain.gain.setValueAtTime(0.9, now);
      gain.gain.exponentialRampToValueAtTime(0.001, now + 0.13);

      noise.connect(bandpass).connect(gain).connect(master);
      this.startVoice(noise, now, 0.14);
    }

    const body = context.createOscillator();
    body.type = "square";
    body.frequency.setValueAtTime(220, now);
    body.frequency.exponentialRampToValueAtTime(48, now + 0.09);

    const bodyGain = context.createGain();
    bodyGain.gain.setValueAtTime(0.5, now);
    bodyGain.gain.exponentialRampToValueAtTime(0.001, now + 0.1);

    body.connect(bodyGain).connect(master);
    this.startVoice(body, now, 0.11);
  }

  private playClick(
    context: AudioContext,
    master: GainNode,
    now: number,
    frequency: number,
    duration: number,
    volume: number,
  ): void {
    const oscillator = context.createOscillator();
    oscillator.type = "triangle";
    oscillator.frequency.setValueAtTime(frequency, now);
    oscillator.frequency.exponentialRampToValueAtTime(Math.max(40, frequency * 0.35), now + duration);

    const gain = context.createGain();
    gain.gain.setValueAtTime(volume, now);
    gain.gain.exponentialRampToValueAtTime(0.001, now + duration);

    oscillator.connect(gain).connect(master);
    this.startVoice(oscillator, now, duration + 0.02);
  }

  /**
   * Starts a source and guarantees it is counted and released.
   *
   * Web Audio nodes are one-shot; without the `onended` release the voice count
   * would climb forever and firing would go silent after 16 rounds.
   */
  private startVoice(source: AudioScheduledSourceNode, now: number, duration: number): void {
    this.voices += 1;
    source.onended = () => {
      this.voices = Math.max(0, this.voices - 1);
      source.disconnect();
    };
    source.start(now);
    source.stop(now + duration);
  }

  private createNoiseBuffer(context: AudioContext): AudioBuffer {
    const length = Math.floor(context.sampleRate * 0.2);
    const buffer = context.createBuffer(1, length, context.sampleRate);
    const data = buffer.getChannelData(0);
    for (let i = 0; i < length; i++) data[i] = Math.random() * 2 - 1;
    return buffer;
  }

  dispose(): void {
    if (this.context !== null) {
      void this.context.close().catch(() => undefined);
      this.context = null;
    }
  }
}

/** A no-op implementation, used when Web Audio is unavailable. */
class SilentAudioSystem implements AudioSystem {
  private plays = 0;
  readonly isReady = false;
  get playCount(): number {
    return this.plays;
  }
  play(): void {
    this.plays += 1;
  }
  resume(): void {}
  setMuted(): void {}
  dispose(): void {}
}

export function createAudioSystem(): AudioSystem {
  if (typeof AudioContext === "undefined") {
    log.warn("AudioContext is not available; running silent");
    return new SilentAudioSystem();
  }
  return new WebAudioSystem();
}
