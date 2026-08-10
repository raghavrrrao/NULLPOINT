import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  applyShotRecoil,
  applySpread,
  createRandom,
  createRecoilState,
  damageAtDistance,
  recoverRecoil,
} from "../../packages/shared/src/combat/ballistics.ts";
import { applyDamage } from "../../packages/shared/src/combat/damage.ts";
import { ASSAULT_RIFLE, FireMode, secondsPerShot, spreadFor } from "../../packages/shared/src/combat/weapon.ts";
import {
  WeaponState,
  canFire,
  canReload,
  computeReloadTransfer,
  createWeaponInput,
  createWeaponRuntime,
  formatAmmo,
  stepWeapon,
  type WeaponInput,
} from "../../packages/shared/src/combat/weaponState.ts";
import { vec3 } from "../../packages/shared/src/math/index.ts";

const rifle = ASSAULT_RIFLE;
const TICK = 1 / 60;

function input(overrides: Partial<WeaponInput> = {}): WeaponInput {
  return { ...createWeaponInput(), ...overrides };
}

/** Runs the weapon for `seconds`, returning total shots fired. */
function run(
  runtime: ReturnType<typeof createWeaponRuntime>,
  held: WeaponInput,
  seconds: number,
  dt = TICK,
): number {
  let shots = 0;
  const steps = Math.round(seconds / dt);
  for (let i = 0; i < steps; i++) {
    // Only the first tick counts as a fresh press.
    const tickInput = i === 0 ? held : { ...held, firePressed: false, reloadPressed: false };
    shots += stepWeapon(runtime, tickInput, dt, rifle).shotsFired;
  }
  return shots;
}

describe("fire rate", () => {
  it("converts rounds per minute to an interval", () => {
    assert.equal(secondsPerShot(rifle), 60 / 700);
    assert.equal(secondsPerShot({ ...rifle, fireRateRpm: 600 }), 0.1);
  });

  it("reports an infinite interval for a zero fire rate rather than dividing by zero", () => {
    assert.equal(secondsPerShot({ ...rifle, fireRateRpm: 0 }), Number.POSITIVE_INFINITY);
  });

  it("fires at approximately the configured rate over one second", () => {
    const runtime = createWeaponRuntime({ ...rifle, magazineSize: 100, reserveAmmo: 0 });
    const shots = run(runtime, input({ firePressed: true, fireHeld: true }), 1);
    // 700 RPM ≈ 11.67 shots/second.
    assert.ok(shots >= 11 && shots <= 12, `fired ${shots} shots in one second`);
  });

  it("cannot be made to fire faster by tapping every tick", () => {
    const runtime = createWeaponRuntime({ ...rifle, magazineSize: 100 });
    let shots = 0;
    for (let i = 0; i < 60; i++) {
      shots += stepWeapon(
        runtime,
        input({ firePressed: true, fireHeld: true }),
        TICK,
        { ...rifle, magazineSize: 100 },
      ).shotsFired;
    }
    assert.ok(shots <= 12, `tapping produced ${shots} shots in one second`);
  });

  it("is frame-rate independent", () => {
    const at = (dt: number) => {
      const runtime = createWeaponRuntime({ ...rifle, magazineSize: 500 });
      let shots = 0;
      const steps = Math.round(2 / dt);
      for (let i = 0; i < steps; i++) {
        shots += stepWeapon(runtime, input({ fireHeld: true }), dt, { ...rifle, magazineSize: 500 }).shotsFired;
      }
      return shots;
    };
    const slow = at(1 / 20);
    const fast = at(1 / 240);
    assert.ok(Math.abs(slow - fast) <= 1, `20Hz=${slow} 240Hz=${fast}`);
  });
});

describe("ammunition", () => {
  it("starts with a full magazine and the configured reserve", () => {
    const runtime = createWeaponRuntime(rifle);
    assert.equal(runtime.magazine, 30);
    assert.equal(runtime.reserve, 120);
    assert.equal(formatAmmo(runtime), "30 / 120");
  });

  it("consumes exactly one round per shot", () => {
    const runtime = createWeaponRuntime(rifle);
    const result = stepWeapon(runtime, input({ firePressed: true, fireHeld: true }), TICK, rifle);
    assert.equal(result.shotsFired, 1);
    assert.equal(runtime.magazine, 29);
    assert.equal(runtime.reserve, 120);
  });

  it("never fires more rounds than the magazine holds", () => {
    const runtime = createWeaponRuntime(rifle);
    const shots = run(runtime, input({ firePressed: true, fireHeld: true }), 10);
    assert.equal(shots, 30);
    assert.equal(runtime.magazine, 0);
  });

  it("does not touch the reserve while firing", () => {
    const runtime = createWeaponRuntime(rifle);
    run(runtime, input({ firePressed: true, fireHeld: true }), 10);
    assert.equal(runtime.reserve, 120);
  });
});

describe("empty magazine", () => {
  it("enters EMPTY and refuses to fire", () => {
    const runtime = createWeaponRuntime(rifle);
    run(runtime, input({ firePressed: true, fireHeld: true }), 10);

    assert.equal(runtime.magazine, 0);
    assert.equal(runtime.state, WeaponState.Empty);
    assert.equal(canFire(runtime), false);

    const result = stepWeapon(runtime, input({ firePressed: true, fireHeld: true }), TICK, rifle);
    assert.equal(result.shotsFired, 0);
  });

  it("reports a dry fire on the press, not on every held tick", () => {
    const runtime = createWeaponRuntime(rifle);
    run(runtime, input({ firePressed: true, fireHeld: true }), 10);

    const pressed = stepWeapon(runtime, input({ firePressed: true, fireHeld: true }), TICK, rifle);
    assert.equal(pressed.dryFired, true);

    const held = stepWeapon(runtime, input({ fireHeld: true }), TICK, rifle);
    assert.equal(held.dryFired, false);
  });
});

describe("reload", () => {
  it("refills the magazine from the reserve", () => {
    const transferred = computeReloadTransfer(0, 120, 30);
    assert.deepEqual(transferred, { magazine: 30, reserve: 90 });
  });

  it("tops up a partially empty magazine and takes only what it needs", () => {
    const transferred = computeReloadTransfer(18, 120, 30);
    assert.deepEqual(transferred, { magazine: 30, reserve: 108 });
  });

  it("takes everything left when the reserve is insufficient", () => {
    const transferred = computeReloadTransfer(0, 7, 30);
    assert.deepEqual(transferred, { magazine: 7, reserve: 0 });
  });

  it("is refused when the magazine is already full", () => {
    const runtime = createWeaponRuntime(rifle);
    assert.equal(canReload(runtime, rifle), false);

    const result = stepWeapon(runtime, input({ reloadPressed: true }), TICK, rifle);
    assert.equal(result.reloadStarted, false);
    assert.equal(runtime.state, WeaponState.Idle);
  });

  it("is refused when the reserve is empty", () => {
    const runtime = createWeaponRuntime({ ...rifle, reserveAmmo: 0 });
    runtime.magazine = 5;
    assert.equal(canReload(runtime, rifle), false);
  });

  it("blocks firing for its whole duration, then completes", () => {
    const runtime = createWeaponRuntime(rifle);
    runtime.magazine = 5;

    const started = stepWeapon(runtime, input({ reloadPressed: true }), TICK, rifle);
    assert.equal(started.reloadStarted, true);
    assert.equal(runtime.state, WeaponState.Reloading);

    // Halfway through: still reloading, still refusing to fire.
    const halfway = Math.round(rifle.reloadSeconds / 2 / TICK);
    let shots = 0;
    for (let i = 0; i < halfway; i++) {
      shots += stepWeapon(runtime, input({ fireHeld: true }), TICK, rifle).shotsFired;
    }
    assert.equal(shots, 0);
    assert.equal(runtime.state, WeaponState.Reloading);
    assert.equal(canFire(runtime), false);
    assert.equal(runtime.magazine, 5, "ammunition must not move until the reload finishes");

    // Run out the remainder.
    let completed = false;
    for (let i = 0; i < halfway + 10; i++) {
      if (stepWeapon(runtime, input(), TICK, rifle).reloadCompleted) completed = true;
    }
    assert.equal(completed, true);
    assert.equal(runtime.state, WeaponState.Idle);
    assert.equal(runtime.magazine, 30);
    assert.equal(runtime.reserve, 95);
  });

  it("leaves an empty weapon in EMPTY when the reserve cannot fill it", () => {
    const runtime = createWeaponRuntime({ ...rifle, reserveAmmo: 0 });
    runtime.magazine = 0;
    runtime.reserve = 0;
    stepWeapon(runtime, input({ reloadPressed: true }), TICK, rifle);
    assert.equal(runtime.state, WeaponState.Empty);
  });
});

describe("state machine", () => {
  it("rests in IDLE with ammunition and no input", () => {
    const runtime = createWeaponRuntime(rifle);
    stepWeapon(runtime, input(), TICK, rifle);
    assert.equal(runtime.state, WeaponState.Idle);
  });

  it("enters FIRING while shooting and returns to IDLE on release", () => {
    const runtime = createWeaponRuntime(rifle);
    stepWeapon(runtime, input({ firePressed: true, fireHeld: true }), TICK, rifle);
    assert.equal(runtime.state, WeaponState.Firing);

    stepWeapon(runtime, input(), TICK, rifle);
    assert.equal(runtime.state, WeaponState.Idle);
  });

  it("never fires on the tick a reload starts", () => {
    const runtime = createWeaponRuntime(rifle);
    runtime.magazine = 10;
    const result = stepWeapon(
      runtime,
      input({ reloadPressed: true, fireHeld: true, firePressed: true }),
      TICK,
      rifle,
    );
    assert.equal(result.shotsFired, 0);
    assert.equal(runtime.state, WeaponState.Reloading);
  });

  it("tracks aiming independently of the firing state", () => {
    const runtime = createWeaponRuntime(rifle);
    stepWeapon(runtime, input({ aimHeld: true, fireHeld: true, firePressed: true }), TICK, rifle);
    assert.equal(runtime.aiming, true);
    assert.equal(runtime.state, WeaponState.Firing);

    stepWeapon(runtime, input({ aimHeld: false }), TICK, rifle);
    assert.equal(runtime.aiming, false);
  });

  it("respects semi-automatic fire mode", () => {
    const semi = { ...rifle, fireMode: FireMode.SemiAutomatic, magazineSize: 30 };
    const runtime = createWeaponRuntime(semi);
    let shots = stepWeapon(runtime, input({ firePressed: true, fireHeld: true }), TICK, semi).shotsFired;
    for (let i = 0; i < 60; i++) {
      shots += stepWeapon(runtime, input({ fireHeld: true }), TICK, semi).shotsFired;
    }
    assert.equal(shots, 1, "holding the trigger must not repeat on a semi-automatic");
  });
});

describe("damage", () => {
  it("applies full damage inside the falloff start", () => {
    assert.equal(damageAtDistance(rifle, 0), 25);
    assert.equal(damageAtDistance(rifle, rifle.falloffStart), 25);
  });

  it("reduces damage linearly beyond the falloff start", () => {
    const mid = damageAtDistance(rifle, (rifle.falloffStart + rifle.range) / 2);
    assert.ok(mid < 25 && mid > 25 * rifle.falloffMinMultiplier, `mid=${mid}`);
  });

  it("reaches the minimum multiplier at maximum range", () => {
    const far = damageAtDistance(rifle, rifle.range);
    assert.ok(Math.abs(far - 25 * rifle.falloffMinMultiplier) < 1e-9, `far=${far}`);
  });

  it("does no damage beyond maximum range", () => {
    assert.equal(damageAtDistance(rifle, rifle.range + 0.01), 0);
  });

  it("kills a 100 HP target in exactly four point-blank hits", () => {
    let health = 100;
    let hits = 0;
    while (health > 0 && hits < 20) {
      const result = applyDamage(health, 100, damageAtDistance(rifle, 5));
      health = result.remainingHealth;
      hits++;
    }
    assert.equal(hits, 4);
    assert.equal(health, 0);
  });
});

describe("applyDamage", () => {
  it("reduces health and reports the amount applied", () => {
    const result = applyDamage(100, 100, 25);
    assert.deepEqual(result, { applied: 25, remainingHealth: 75, killed: false });
  });

  it("clamps overkill to the remaining health", () => {
    const result = applyDamage(10, 100, 999);
    assert.equal(result.applied, 10);
    assert.equal(result.remainingHealth, 0);
    assert.equal(result.killed, true);
  });

  it("ignores a hit on something already dead", () => {
    const result = applyDamage(0, 100, 25);
    assert.deepEqual(result, { applied: 0, remainingHealth: 0, killed: false });
  });

  it("refuses negative and non-finite damage rather than healing or corrupting health", () => {
    // Rejected outright rather than clamped: the same value could arrive from an
    // untrusted source once damage moves behind server authority.
    assert.equal(applyDamage(50, 100, -25).remainingHealth, 50);
    assert.equal(applyDamage(50, 100, Number.NaN).remainingHealth, 50);
    assert.equal(applyDamage(50, 100, Number.POSITIVE_INFINITY).remainingHealth, 50);
    assert.equal(applyDamage(50, 100, Number.POSITIVE_INFINITY).applied, 0);
  });
});

describe("spread", () => {
  it("is tighter when aiming than from the hip", () => {
    assert.ok(spreadFor(rifle, true) < spreadFor(rifle, false));
  });

  it("returns the aim direction untouched at zero spread", () => {
    const out = applySpread(vec3(0, 0, -1), 0, createRandom(1), vec3());
    assert.deepEqual(out, { x: 0, y: 0, z: -1 });
  });

  it("always produces a unit direction", () => {
    const random = createRandom(42);
    for (let i = 0; i < 200; i++) {
      const out = applySpread(vec3(0, 0, -1), rifle.hipSpread, random, vec3());
      assert.ok(Math.abs(Math.hypot(out.x, out.y, out.z) - 1) < 1e-9);
    }
  });

  it("stays inside the configured cone", () => {
    const random = createRandom(7);
    const forward = vec3(0, 0, -1);
    for (let i = 0; i < 500; i++) {
      const out = applySpread(forward, rifle.hipSpread, random, vec3());
      const dot = out.x * forward.x + out.y * forward.y + out.z * forward.z;
      assert.ok(Math.acos(Math.min(1, dot)) <= rifle.hipSpread + 1e-6);
    }
  });

  it("does not degenerate when aiming straight up", () => {
    const out = applySpread(vec3(0, 1, 0), rifle.hipSpread, createRandom(3), vec3());
    assert.ok(Number.isFinite(out.x) && Number.isFinite(out.y) && Number.isFinite(out.z));
    assert.ok(Math.abs(Math.hypot(out.x, out.y, out.z) - 1) < 1e-9);
  });

  it("is reproducible from a seed", () => {
    const a = applySpread(vec3(0, 0, -1), rifle.hipSpread, createRandom(99), vec3());
    const b = applySpread(vec3(0, 0, -1), rifle.hipSpread, createRandom(99), vec3());
    assert.deepEqual(a, b);
  });
});

describe("recoil", () => {
  it("kicks upward predictably and never exceeds its ceiling", () => {
    const state = createRecoilState();
    const random = createRandom(5);
    for (let i = 0; i < 100; i++) applyShotRecoil(state, rifle.recoil, random);
    assert.equal(state.pitch, rifle.recoil.maxPitch);
  });

  it("accumulates pitch monotonically during a burst", () => {
    const state = createRecoilState();
    const random = createRandom(5);
    let previous = state.pitch;
    for (let i = 0; i < 5; i++) {
      applyShotRecoil(state, rifle.recoil, random);
      assert.ok(state.pitch > previous);
      previous = state.pitch;
    }
  });

  it("keeps horizontal drift bounded by the configured variance", () => {
    const state = createRecoilState();
    const random = createRandom(11);
    for (let i = 0; i < 30; i++) applyShotRecoil(state, rifle.recoil, random);
    const bound = rifle.recoil.yawPerShot * rifle.recoil.yawVariance * 30;
    assert.ok(Math.abs(state.yaw) <= bound);
  });

  it("recovers to zero once firing stops", () => {
    const state = createRecoilState();
    applyShotRecoil(state, rifle.recoil, createRandom(1));
    for (let i = 0; i < 240; i++) recoverRecoil(state, rifle.recoil, TICK);
    assert.equal(state.pitch, 0);
    assert.equal(state.yaw, 0);
  });

  it("recovers frame-rate independently", () => {
    const settle = (dt: number) => {
      const state = createRecoilState();
      state.pitch = 0.2;
      const steps = Math.round(0.5 / dt);
      for (let i = 0; i < steps; i++) recoverRecoil(state, rifle.recoil, dt);
      return state.pitch;
    };
    assert.ok(Math.abs(settle(1 / 30) - settle(1 / 240)) < 0.002);
  });
});
