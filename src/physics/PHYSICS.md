# 2D Rigid Body Physics Engine

Self-contained PBD (Position-Based Dynamics) physics engine for 2D rigid body simulation with constraints. Extracted from Slinker (https://github.com/huggabiz/linkage-studio).

## File Structure

```
types.ts              — Vec2, Joint, Link, Body, SliderConstraint, ColliderConstraint, etc.
math/vec2.ts          — Vector math (add, sub, dot, cross, normalize, rotate, etc.)
math/linalg.ts        — LU decomposition solver for linear systems
solver/constraints.ts — Distance constraint + Jacobian, angle driver constraint
solver/newton-raphson.ts — Two solvers:
                          • solve() — Newton-Raphson kinematic solver (motor-driven)
                          • solveWithForce() — PBD physics simulation
body-links.ts         — Auto-generate rigid distance constraints from body joint membership
body-transform.ts     — Body reference frames, local/world coordinate transforms
```

## Core Concepts

### Bodies and Joints
- A **body** is a rigid group of joints. Joints can belong to multiple bodies — shared joints act as pivots/hinges.
- **Fixed joints** don't move. **Revolute joints** are free.
- Users define bodies by assigning joints to them. Links (distance constraints) are auto-generated.

### Link Generation (body-links.ts)
- **Full pairwise**: every pair of joints in a body gets a distance constraint. N joints = N(N-1)/2 links.
- **Hidden bracing joints**: for bodies with 3+ joints, an invisible joint is placed perpendicular to the longest span at the midpoint. This guarantees triangulation even when joints are collinear (where distance constraints alone become degenerate).
- Links are deduplicated across bodies — if two bodies share a joint pair, only one link exists.

### PBD Simulation (solveWithForce)
Each frame (dt = 1/60):
1. **10 substeps** per frame, **6 constraint passes** per substep
2. Semi-implicit Euler: apply forces → predict positions → project constraints → derive velocity
3. Velocity-based (not Verlet prev-position) for stability
4. Time-based damping: `dampPerSubstep = retentionFactor^(subDt)` — frame-rate independent

### Constraint Types

**Distance constraints** (PBD projection): standard equal-weight correction split between endpoints. If one endpoint is fixed, the free one gets 100% correction.

**Slider constraints** (3 joints: A, B, C): B slides along segment AC.
- Two sub-constraints per pass:
  1. **Perpendicular**: push B onto line AC (or rotate AC through B). Uses lever-arm weighting — A and C get different corrections based on B's parametric position, producing natural rotation.
  2. **Along-axis clamping**: keep B between A and C by translating the entire AC segment.
- B can be the fixed joint (bidirectional — corrections go to A & C instead).

**Collider constraints** (barrier walls): a line segment that joints cannot cross.
- Each affected joint records which side of the line it starts on.
- If a joint crosses during simulation, it's projected back to the line with a small epsilon offset.
- Joints going around the endpoints update their recorded side (no wrap-around glitch).
- Velocity damping on collision: normal component zeroed, tangential component reduced by friction factor (0.7).

### Drag Interaction
- Critically damped spring: `F = k*(target - grabPoint) - c*velocity`
- `c = 2 * sqrt(k) * dampingRatio` for critical damping
- Force distributed to link endpoints by grab parameter t

### Gravity
- Per-link distribution by default (each endpoint gets `g`)
- Optional per-joint weights for custom COM (e.g., from outline polygon centroid)

## Key Lessons / Pitfalls

1. **Angle constraints don't work well with PBD** — they fight distance constraints and destabilize near-collinear configurations due to 1/|d|² gradient amplification. Full pairwise distance links + hidden bracing joints solve rigidity without angle constraints.

2. **Slider B as fixed joint** required bidirectional constraint projection. The original one-directional implementation (only B moves) broke when B was the pivot point.

3. **Slider perpendicular correction must use lever-arm weighting**, not equal correction. Equal correction on A and C produces pure translation — no rotation around B. The lever-arm formula: `corrA = d * (1-t) / ((1-t)² + t²)`, `corrC = d * t / ((1-t)² + t²)`.

4. **Collider endpoint wrap-around**: joints going around the segment endpoint were seen as crossing. Fixed by updating the recorded side when the joint is outside the segment's parametric bounds (t < 0 or t > 1).

5. **Velocity state is module-level** (the `velocities` Map). Call `resetVelocities()` when starting/resetting simulation.

## Integration Example

```typescript
import { solveWithForce, resetVelocities } from './solver/newton-raphson';
import { generateBodyLinks } from './body-links';

// Define joints and bodies
const joints = { ... };
const bodies = { ... };
const fixedIds = new Set(['joint_0']); // ground joints

// Generate links from body structure
const { links, bracingJoints } = generateBodyLinks(bodies, joints);
const linkRecord: Record<string, Link> = {};
for (const link of links) linkRecord[link.id] = link;

// Simulation loop (call at 60Hz)
resetVelocities();
function step() {
  const result = solveWithForce(
    joints, linkRecord,
    { enabled: true, strength: 250 },  // gravity
    null,                                // no drag force
    0.3,                                 // damping (0=max, 1=none)
    25,                                  // drag multiplier
    0.15,                                // drag damping
    1 / 60,                              // dt
    fixedIds,
  );

  // Apply new positions
  for (const [id, pos] of result.positions) {
    if (joints[id] && !fixedIds.has(id)) {
      joints[id] = { ...joints[id], position: pos };
    }
  }
}
```

## Tuning Constants

| Constant | Default | Effect |
|----------|---------|--------|
| NUM_SUBSTEPS | 10 | More = more stable but slower |
| CONSTRAINT_PASSES | 6 | More = stiffer constraints but slower |
| PULL_STRENGTH | 6 | Base spring constant for drag interaction |
| WALL_FRICTION | 0.7 | Tangential velocity retention on collider hit |
| Gravity strength | 250 | Acceleration magnitude |
| Damping | 0.3 | Velocity retention per second (0.001 = heavy, 1.0 = none) |
