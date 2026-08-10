import { MAX_FRAME_DELTA, MAX_STEPS_PER_FRAME, SIM_DT } from "@nullpoint/shared";

export interface LoopCallbacks {
  /** Advances the simulation by exactly `SIM_DT`. */
  fixedUpdate(dt: number): void;
  /**
   * Draws a frame.
   *
   * @param alpha Fraction through the pending fixed tick, 0..1, for interpolation.
   * @param dt    Real elapsed time since the previous frame, seconds.
   */
  render(alpha: number, dt: number): void;
}

/**
 * Fixed-timestep loop with an accumulator and interpolated rendering.
 *
 * Simulation runs at `SIM_HZ` regardless of display rate, which is what makes
 * movement identical at 30, 60 and 144 Hz — and what will let the server run the
 * same steps later. Rendering runs as fast as the display allows and interpolates
 * between the two most recent simulation states.
 */
export class GameLoop {
  private readonly callbacks: LoopCallbacks;
  private accumulator = 0;
  private lastTime = 0;
  private frameHandle: number | null = null;
  private running = false;

  constructor(callbacks: LoopCallbacks) {
    this.callbacks = callbacks;
  }

  get isRunning(): boolean {
    return this.running;
  }

  start(): void {
    if (this.running) return;
    this.running = true;
    this.lastTime = performance.now();
    this.accumulator = 0;
    this.frameHandle = requestAnimationFrame(this.frame);
  }

  stop(): void {
    this.running = false;
    if (this.frameHandle !== null) {
      cancelAnimationFrame(this.frameHandle);
      this.frameHandle = null;
    }
  }

  private readonly frame = (now: number): void => {
    if (!this.running) return;
    this.frameHandle = requestAnimationFrame(this.frame);

    // A backgrounded tab or a paused debugger produces a huge delta. Clamping it
    // costs a little simulated time but avoids a catch-up burst that stalls the
    // next frame too, and so on.
    const rawDelta = (now - this.lastTime) / 1000;
    this.lastTime = now;
    const delta = Math.min(rawDelta, MAX_FRAME_DELTA);

    this.accumulator += delta;

    let steps = 0;
    while (this.accumulator >= SIM_DT && steps < MAX_STEPS_PER_FRAME) {
      this.callbacks.fixedUpdate(SIM_DT);
      this.accumulator -= SIM_DT;
      steps++;
    }

    // If the budget ran out, drop the backlog rather than carrying a debt that
    // can never be repaid.
    if (steps === MAX_STEPS_PER_FRAME && this.accumulator > SIM_DT) {
      this.accumulator = 0;
    }

    this.callbacks.render(this.accumulator / SIM_DT, delta);
  };
}
