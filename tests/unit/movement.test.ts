import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { PLAYER_CONFIG } from "../../packages/shared/src/constants/player.ts";
import { SIM_DT } from "../../packages/shared/src/constants/sim.ts";
import { damp, dampAngle, vec3, wrapAngle } from "../../packages/shared/src/math/index.ts";
import {
  accelerateHorizontal,
  applyVerticalMotion,
  commitMovementResult,
  computeWishDirection,
  resolveMovementState,
  selectTargetSpeed,
  stepCharacterMovement,
  tryConsumeJump,
  yawFromDirection,
} from "../../packages/shared/src/sim/movement.ts";
import {
  createCharacterSimState,
  createMoveIntent,
  MovementState,
  type MoveIntent,
} from "../../packages/shared/src/types/index.ts";

const cfg = PLAYER_CONFIG;

function intentOf(overrides: Partial<MoveIntent> = {}): MoveIntent {
  return { ...createMoveIntent(), ...overrides };
}

/** Advances a grounded character for `seconds` with a constant intent. */
function simulate(intent: MoveIntent, seconds: number, grounded = true) {
  const state = createCharacterSimState(vec3(0, 0, 0));
  state.grounded = grounded;
  const displacement = vec3();
  const steps = Math.round(seconds / SIM_DT);
  for (let i = 0; i < steps; i++) {
    stepCharacterMovement(state, intent, SIM_DT, cfg, displacement);
    // Stand in for a collision solve that never blocks anything.
    state.position.x += displacement.x;
    state.position.z += displacement.z;
    if (grounded) state.velocity.y = 0;
  }
  return state;
}

describe("computeWishDirection — camera-relative movement", () => {
  it("maps forward to −Z when the camera faces north (yaw 0)", () => {
    const d = computeWishDirection(1, 0, 0, vec3());
    assert.ok(Math.abs(d.x) < 1e-9, `x=${d.x}`);
    assert.ok(Math.abs(d.z + 1) < 1e-9, `z=${d.z}`);
  });

  it("maps forward to +X when the camera is rotated to face east", () => {
    // Camera yaw −π/2 points the view direction along +X.
    const d = computeWishDirection(1, 0, -Math.PI / 2, vec3());
    assert.ok(Math.abs(d.x - 1) < 1e-9, `x=${d.x}`);
    assert.ok(Math.abs(d.z) < 1e-9, `z=${d.z}`);
  });

  it("maps strafe right to +X when the camera faces north", () => {
    const d = computeWishDirection(0, 1, 0, vec3());
    assert.ok(Math.abs(d.x - 1) < 1e-9, `x=${d.x}`);
    assert.ok(Math.abs(d.z) < 1e-9, `z=${d.z}`);
  });

  it("normalises diagonal input so diagonals are not faster", () => {
    const d = computeWishDirection(1, 1, 0, vec3());
    assert.ok(Math.abs(Math.hypot(d.x, d.z) - 1) < 1e-9);
  });

  it("returns a zero vector for no input", () => {
    const d = computeWishDirection(0, 0, 1.234, vec3());
    assert.equal(d.x, 0);
    assert.equal(d.z, 0);
  });

  it("rotates with the camera through a full turn without changing magnitude", () => {
    for (let yaw = -Math.PI; yaw <= Math.PI; yaw += Math.PI / 8) {
      const d = computeWishDirection(1, 0, yaw, vec3());
      assert.ok(Math.abs(Math.hypot(d.x, d.z) - 1) < 1e-9);
    }
  });
});

describe("yawFromDirection", () => {
  it("faces −Z at yaw 0, matching the glTF model forward axis", () => {
    assert.ok(Math.abs(yawFromDirection(vec3(0, 0, -1))) < 1e-9);
  });

  it("round-trips against computeWishDirection", () => {
    for (const cameraYaw of [0, 0.5, -1.2, Math.PI / 2, 3.0]) {
      const dir = computeWishDirection(1, 0, cameraYaw, vec3());
      const yaw = yawFromDirection(dir);
      assert.ok(Math.abs(wrapAngle(yaw - cameraYaw)) < 1e-9, `yaw=${yaw} cam=${cameraYaw}`);
    }
  });
});

describe("selectTargetSpeed", () => {
  it("defaults to run speed", () => {
    assert.equal(selectTargetSpeed(intentOf(), false, cfg), cfg.runSpeed);
  });

  it("uses walk speed with the walk modifier", () => {
    assert.equal(selectTargetSpeed(intentOf({ walk: true }), false, cfg), cfg.walkSpeed);
  });

  it("uses sprint speed with sprint held", () => {
    assert.equal(selectTargetSpeed(intentOf({ sprint: true }), false, cfg), cfg.sprintSpeed);
  });

  it("lets crouch override sprint", () => {
    assert.equal(selectTargetSpeed(intentOf({ sprint: true }), true, cfg), cfg.crouchSpeed);
  });
});

describe("resolveMovementState", () => {
  it("reports IDLE below the idle threshold", () => {
    assert.equal(resolveMovementState(0, 0, true, false, cfg), MovementState.Idle);
  });

  it("reports WALK, RUN and SPRINT by horizontal speed", () => {
    assert.equal(resolveMovementState(1.5, 0, true, false, cfg), MovementState.Walk);
    assert.equal(resolveMovementState(5, 0, true, false, cfg), MovementState.Run);
    assert.equal(resolveMovementState(7.5, 0, true, false, cfg), MovementState.Sprint);
  });

  it("reports CROUCH while grounded and crouched regardless of speed", () => {
    assert.equal(resolveMovementState(1.6, 0, true, true, cfg), MovementState.Crouch);
  });

  it("reports JUMP while rising and FALL once descending", () => {
    assert.equal(resolveMovementState(0, 5, false, false, cfg), MovementState.Jump);
    assert.equal(resolveMovementState(0, -5, false, false, cfg), MovementState.Fall);
  });

  it("prefers airborne states over crouch", () => {
    assert.equal(resolveMovementState(0, -5, false, true, cfg), MovementState.Fall);
  });

  it("reports IDLE when pressed against a wall despite commanded velocity", () => {
    // The measured speed is what is passed in, so a blocked character is idle.
    assert.equal(resolveMovementState(0, 0, true, false, cfg), MovementState.Idle);
  });
});

describe("commitMovementResult", () => {
  it("records the speed actually achieved, not the speed commanded", () => {
    const s = createCharacterSimState(vec3());
    s.grounded = true;
    s.velocity.x = cfg.runSpeed;

    const requested = vec3(cfg.runSpeed * SIM_DT, 0, 0);
    const blocked = vec3(0, 0, 0);
    commitMovementResult(s, blocked, requested, true, SIM_DT, cfg);

    assert.equal(s.measuredSpeed, 0);
    assert.equal(s.movementState, MovementState.Idle);
  });

  it("leaves commanded horizontal velocity intact when blocked", () => {
    // Regression guard: zeroing it here starves the collision solver's step-up
    // logic, and the character can never climb a stair it is standing against.
    const s = createCharacterSimState(vec3());
    s.grounded = true;
    s.velocity.x = cfg.runSpeed;

    const requested = vec3(cfg.runSpeed * SIM_DT, 0, 0);
    commitMovementResult(s, vec3(0, 0, 0), requested, true, SIM_DT, cfg);

    assert.equal(s.velocity.x, cfg.runSpeed);
  });

  it("drops upward velocity when the head hits a ceiling", () => {
    const s = createCharacterSimState(vec3());
    s.velocity.y = cfg.jumpVelocity;

    const requested = vec3(0, cfg.jumpVelocity * SIM_DT, 0);
    commitMovementResult(s, vec3(0, 0, 0), requested, false, SIM_DT, cfg);

    assert.equal(s.velocity.y, 0);
  });

  it("advances position by the applied displacement", () => {
    const s = createCharacterSimState(vec3(1, 2, 3));
    const applied = vec3(0.5, -0.25, 1);
    commitMovementResult(s, applied, applied, true, SIM_DT, cfg);

    assert.equal(s.position.x, 1.5);
    assert.equal(s.position.z, 4);
  });
});

describe("accelerateHorizontal", () => {
  it("does not overshoot the target speed", () => {
    const v = vec3();
    for (let i = 0; i < 600; i++) {
      accelerateHorizontal(v, vec3(1, 0, 0), cfg.runSpeed, true, true, SIM_DT, cfg);
    }
    assert.ok(Math.abs(v.x - cfg.runSpeed) < 1e-9, `x=${v.x}`);
  });

  it("reaches run speed in well under a second", () => {
    const v = vec3();
    let ticks = 0;
    while (Math.hypot(v.x, v.z) < cfg.runSpeed - 1e-6 && ticks < 600) {
      accelerateHorizontal(v, vec3(1, 0, 0), cfg.runSpeed, true, true, SIM_DT, cfg);
      ticks++;
    }
    assert.ok(ticks * SIM_DT < 0.35, `took ${(ticks * SIM_DT).toFixed(3)}s`);
  });

  it("comes to a complete stop rather than sliding indefinitely", () => {
    const v = vec3(cfg.sprintSpeed, 0, 0);
    for (let i = 0; i < 600; i++) {
      accelerateHorizontal(v, vec3(0, 0, 0), 0, false, true, SIM_DT, cfg);
    }
    assert.equal(v.x, 0);
    assert.equal(v.z, 0);
  });

  it("preserves airborne momentum when there is no input", () => {
    const v = vec3(4, 0, 0);
    accelerateHorizontal(v, vec3(0, 0, 0), 0, false, false, SIM_DT, cfg);
    assert.equal(v.x, 4);
  });

  it("gives only partial steering in the air", () => {
    const air = vec3(0, 0, 0);
    const ground = vec3(0, 0, 0);
    for (let i = 0; i < 30; i++) {
      accelerateHorizontal(air, vec3(1, 0, 0), cfg.runSpeed, true, false, SIM_DT, cfg);
      accelerateHorizontal(ground, vec3(1, 0, 0), cfg.runSpeed, true, true, SIM_DT, cfg);
    }
    assert.ok(air.x < ground.x, `air=${air.x} ground=${ground.x}`);
    assert.ok(air.x > 0, "air control should not be zero");
  });
});

describe("applyVerticalMotion", () => {
  it("accelerates downward under gravity when airborne", () => {
    const v = vec3();
    applyVerticalMotion(v, false, SIM_DT, cfg);
    assert.ok(Math.abs(v.y - cfg.gravity * SIM_DT) < 1e-9);
  });

  it("clamps to terminal velocity", () => {
    const v = vec3(0, -1000, 0);
    applyVerticalMotion(v, false, SIM_DT, cfg);
    assert.equal(v.y, cfg.maxFallSpeed);
  });

  it("holds the stick velocity while grounded", () => {
    const v = vec3(0, -30, 0);
    applyVerticalMotion(v, true, SIM_DT, cfg);
    assert.equal(v.y, cfg.groundStickVelocity);
  });
});

describe("jump", () => {
  it("fires when grounded with a buffered press", () => {
    const s = createCharacterSimState(vec3());
    s.grounded = true;
    s.jumpBufferRemaining = cfg.jumpBufferTime;
    assert.equal(tryConsumeJump(s, cfg), true);
    assert.equal(s.velocity.y, cfg.jumpVelocity);
  });

  it("does not fire twice in the air", () => {
    const s = createCharacterSimState(vec3());
    s.grounded = true;
    s.jumpBufferRemaining = cfg.jumpBufferTime;
    assert.equal(tryConsumeJump(s, cfg), true);
    s.jumpBufferRemaining = cfg.jumpBufferTime;
    s.timeSinceGrounded = 1.0;
    assert.equal(tryConsumeJump(s, cfg), false);
  });

  it("still fires just after walking off a ledge (coyote time)", () => {
    const s = createCharacterSimState(vec3());
    s.grounded = false;
    s.timeSinceGrounded = cfg.coyoteTime * 0.5;
    s.jumpBufferRemaining = cfg.jumpBufferTime;
    assert.equal(tryConsumeJump(s, cfg), true);
  });

  it("refuses once the coyote window has passed", () => {
    const s = createCharacterSimState(vec3());
    s.grounded = false;
    s.timeSinceGrounded = cfg.coyoteTime * 2;
    s.jumpBufferRemaining = cfg.jumpBufferTime;
    assert.equal(tryConsumeJump(s, cfg), false);
  });

  it("reaches roughly the intended apex height", () => {
    const expected = (cfg.jumpVelocity * cfg.jumpVelocity) / (2 * -cfg.gravity);
    assert.ok(expected > 1.0 && expected < 1.5, `apex ${expected.toFixed(2)}m`);
  });
});

describe("stepCharacterMovement", () => {
  it("moves a grounded character forward at run speed", () => {
    const s = simulate(intentOf({ forward: 1 }), 2);
    assert.ok(Math.abs(Math.hypot(s.velocity.x, s.velocity.z) - cfg.runSpeed) < 1e-6);
    assert.ok(s.position.z < -5, `z=${s.position.z}`);
    assert.equal(s.movementState, MovementState.Run);
  });

  it("moves faster with sprint than without", () => {
    const run = simulate(intentOf({ forward: 1 }), 2);
    const sprint = simulate(intentOf({ forward: 1, sprint: true }), 2);
    assert.ok(Math.abs(sprint.position.z) > Math.abs(run.position.z));
    assert.equal(sprint.movementState, MovementState.Sprint);
  });

  it("moves slower while crouched", () => {
    const s = createCharacterSimState(vec3());
    s.grounded = true;
    s.crouching = true;
    const d = vec3();
    for (let i = 0; i < 120; i++) {
      stepCharacterMovement(s, intentOf({ forward: 1 }), SIM_DT, cfg, d);
      s.velocity.y = 0;
    }
    assert.ok(Math.abs(Math.hypot(s.velocity.x, s.velocity.z) - cfg.crouchSpeed) < 1e-6);
    assert.equal(s.movementState, MovementState.Crouch);
  });

  it("turns the character to face the movement direction", () => {
    const s = simulate(intentOf({ forward: 1, right: 0, cameraYaw: 0 }), 1);
    assert.ok(Math.abs(wrapAngle(s.yaw)) < 0.01, `yaw=${s.yaw}`);
  });

  it("holds its facing while standing still and the aim stays inside the deadzone", () => {
    const s = createCharacterSimState(vec3());
    s.grounded = true;
    s.yaw = 0;
    const d = vec3();
    // Well inside hipYawLimit: the torso covers this, the legs must not move.
    for (let i = 0; i < 60; i++) {
      stepCharacterMovement(s, intentOf({ cameraYaw: 0.6 }), SIM_DT, cfg, d);
    }
    assert.equal(s.yaw, 0);
  });

  it("turns to follow the aim once it leaves the deadzone", () => {
    const s = createCharacterSimState(vec3());
    s.grounded = true;
    s.yaw = 0;
    const d = vec3();
    const target = 2.6;
    for (let i = 0; i < 240; i++) {
      stepCharacterMovement(s, intentOf({ cameraYaw: target }), SIM_DT, cfg, d);
    }
    // Settles inside the deadzone rather than snapping onto the aim exactly.
    const offset = Math.abs(wrapAngle(target - s.yaw));
    assert.ok(offset < cfg.hipYawLimit, `offset ${offset.toFixed(3)} should be within the deadzone`);
    assert.ok(offset > 0.05, "the body should stop short of the aim, not snap onto it");
  });

  it("turns gradually rather than snapping", () => {
    const s = createCharacterSimState(vec3());
    s.grounded = true;
    s.yaw = 0;
    const d = vec3();
    stepCharacterMovement(s, intentOf({ cameraYaw: 3.0 }), SIM_DT, cfg, d);
    // One tick must not cover more than a small fraction of the turn.
    assert.ok(Math.abs(s.yaw) < 0.2, `turned ${s.yaw.toFixed(3)} rad in a single tick`);
  });

  it("uses a tighter deadzone while aiming than at the hip", () => {
    assert.ok(cfg.aimYawLimit < cfg.hipYawLimit);

    const turnedAt = (aim: boolean, cameraYaw: number): number => {
      const s = createCharacterSimState(vec3());
      s.grounded = true;
      const d = vec3();
      for (let i = 0; i < 60; i++) {
        stepCharacterMovement(s, intentOf({ cameraYaw, aim }), SIM_DT, cfg, d);
      }
      return Math.abs(s.yaw);
    };

    // An offset between the two limits turns the body when aiming, not otherwise.
    const between = (cfg.aimYawLimit + cfg.hipYawLimit) / 2;
    assert.ok(turnedAt(true, between) > 0.01, "aiming should turn the body here");
    assert.equal(turnedAt(false, between), 0, "hip stance should hold still here");
  });

  it("faces the aim direction while moving and aiming", () => {
    const s = createCharacterSimState(vec3());
    s.grounded = true;
    const d = vec3();
    // Strafing right while aiming forward: the body should face the aim, not the
    // direction of travel.
    for (let i = 0; i < 180; i++) {
      stepCharacterMovement(s, intentOf({ right: 1, cameraYaw: 0, aim: true }), SIM_DT, cfg, d);
      s.velocity.y = 0;
    }
    assert.ok(Math.abs(wrapAngle(s.yaw)) < 0.05, `yaw ${s.yaw.toFixed(3)} should face the aim`);
  });

  it("suppresses sprint while aiming", () => {
    const aimSprint = selectTargetSpeed(intentOf({ sprint: true, aim: true }), false, cfg);
    assert.equal(aimSprint, cfg.runSpeed);
    assert.equal(selectTargetSpeed(intentOf({ sprint: true }), false, cfg), cfg.sprintSpeed);
  });

  it("passes through WALK on the way up to RUN", () => {
    const s = createCharacterSimState(vec3());
    s.grounded = true;
    const d = vec3();
    const seen = new Set<string>();
    for (let i = 0; i < 60; i++) {
      stepCharacterMovement(s, intentOf({ forward: 1 }), SIM_DT, cfg, d);
      s.velocity.y = 0;
      seen.add(s.movementState);
    }
    assert.ok(seen.has(MovementState.Walk), `states seen: ${[...seen].join(",")}`);
    assert.ok(seen.has(MovementState.Run));
  });

  it("is frame-rate independent for straight-line travel", () => {
    const distanceAt = (dt: number) => {
      const s = createCharacterSimState(vec3());
      s.grounded = true;
      const d = vec3();
      const steps = Math.round(4 / dt);
      for (let i = 0; i < steps; i++) {
        stepCharacterMovement(s, intentOf({ forward: 1 }), dt, cfg, d);
        s.position.z += d.z;
        s.velocity.y = 0;
      }
      return Math.abs(s.position.z);
    };
    const a = distanceAt(1 / 30);
    const b = distanceAt(1 / 60);
    const c = distanceAt(1 / 144);
    assert.ok(Math.abs(a - b) < 0.1, `30Hz=${a.toFixed(3)} 60Hz=${b.toFixed(3)}`);
    assert.ok(Math.abs(b - c) < 0.1, `60Hz=${b.toFixed(3)} 144Hz=${c.toFixed(3)}`);
  });
});

describe("math helpers", () => {
  it("damp is frame-rate independent", () => {
    const stepped = (dt: number) => {
      let v = 0;
      for (let t = 0; t < 1; t += dt) v = damp(v, 10, 5, dt);
      return v;
    };
    assert.ok(Math.abs(stepped(1 / 30) - stepped(1 / 240)) < 0.01);
  });

  it("dampAngle takes the short way around the circle", () => {
    const result = dampAngle(3.0, -3.0, 60, 0.5);
    assert.ok(Math.abs(result) > 3.0, `went the long way: ${result}`);
  });

  it("wrapAngle keeps angles in (−π, π]", () => {
    for (const a of [0, 7, -7, 100, -100]) {
      const w = wrapAngle(a);
      assert.ok(w > -Math.PI - 1e-9 && w <= Math.PI + 1e-9, `${a} -> ${w}`);
    }
  });
});
