/**
 * Rolling frame-rate and frame-time meter.
 *
 * A rolling average rather than an instantaneous reading: 1/dt on a single frame
 * jumps around far too much to read, and the Phase 1 brief asks for measured
 * performance rather than a guess.
 */
export class FpsMeter {
  private readonly samples: Float32Array;
  private index = 0;
  private count = 0;
  private sum = 0;
  private worst = 0;

  constructor(sampleCount = 90) {
    this.samples = new Float32Array(sampleCount);
  }

  /** @param dt Frame delta in seconds. */
  sample(dt: number): void {
    if (dt <= 0) return;
    const previous = this.samples[this.index] ?? 0;
    this.sum -= previous;
    this.samples[this.index] = dt;
    this.sum += dt;
    this.index = (this.index + 1) % this.samples.length;
    if (this.count < this.samples.length) this.count++;
    if (dt > this.worst) this.worst = dt;
  }

  get fps(): number {
    if (this.count === 0 || this.sum <= 0) return 0;
    return this.count / this.sum;
  }

  /** Mean frame time in milliseconds. */
  get frameTimeMs(): number {
    if (this.count === 0) return 0;
    return (this.sum / this.count) * 1000;
  }

  /** Worst frame time seen since the last reset, in milliseconds. */
  get worstFrameTimeMs(): number {
    return this.worst * 1000;
  }

  resetWorst(): void {
    this.worst = 0;
  }
}
