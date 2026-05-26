# Project Handover Brief

This document is for a new Claude Code instance starting a project that may reuse physics mechanics from **Slinker** — a 2D mechanical linkage simulator PWA.

## What Slinker Is

A browser-based tool (React 19 + TypeScript + Canvas 2D + Vite) for designing and simulating 2D rigid body mechanisms. Users create **bodies** (rigid groups of joints), connect them via shared pivot joints, draw outlines, add sliders/colliders, then simulate with gravity and drag interaction. Deployed as a PWA for iPad with Apple Pencil support.

Live: https://huggabiz.github.io/linkage-studio/
Repo: https://github.com/huggabiz/linkage-studio

## Physics Engine Summary

The physics engine is self-contained (~1200 lines TypeScript, zero dependencies). You may have a copy in `physics-handover/` or `src/physics/` — if so, see `PHYSICS.md` in that directory for full docs. If not, the engine lives in the Slinker repo under `src/core/`.

### What the engine provides

**Two solvers:**
1. **Newton-Raphson kinematic solver** (`solve()`) — for motor-driven mechanisms in design mode. Solves distance + angle driver constraints via Jacobian + LU decomposition.
2. **PBD physics simulator** (`solveWithForce()`) — for interactive simulation with gravity, drag, damping. 10 substeps/frame, 6 constraint passes/substep, semi-implicit Euler with explicit velocity tracking.

**Constraint types:**
- **Distance constraints** — standard PBD projection, equal-weight split between free endpoints
- **Slider constraints** (3-joint: A-B-C) — B slides along segment AC. Bidirectional (B can be fixed). Uses lever-arm weighted perpendicular correction for natural rotation around the pivot.
- **Collider constraints** (barrier walls) — line segment that joints cannot cross. Side-tracking with endpoint wrap-around handling. Velocity damping on collision (normal zeroed, tangential friction).

**Rigidity system:**
- Full pairwise distance constraints (N joints → N(N-1)/2 links per body)
- Hidden bracing joints for 3+ joint bodies — placed perpendicular to longest span, prevents collinear degeneracy
- Angle constraints were tried and removed — they fight distance constraints in PBD

**Other modules:**
- `body-transform.ts` — body reference frames from joint positions, local↔world coordinate transforms, polygon area/centroid
- `math/vec2.ts` — standard 2D vector operations (add, sub, dot, cross, normalize, rotate, lerp, distToSegment, etc.)
- `math/linalg.ts` — LU decomposition with partial pivoting

### Key physics parameters (defaults)
| Parameter | Value | Notes |
|-----------|-------|-------|
| Substeps | 10 | Per frame |
| Constraint passes | 6 | Per substep |
| Gravity | 250 | Acceleration magnitude |
| Damping | 0.3 | Velocity retention/sec (0.001=heavy, 1.0=none) |
| Drag spring | 6 × 25 = 150 | PULL_STRENGTH × dragMultiplier |
| Wall friction | 0.7 | Tangential velocity retention on collision |

### Hard-won lessons (don't re-learn these)

1. **Angle constraints don't work in PBD** — gradient has 1/|d|² amplification that destabilizes near-collinear joint configurations. Use full pairwise distance constraints + hidden bracing joints instead.

2. **Slider perpendicular correction needs lever-arm weighting** — equal correction on A and C produces pure translation, no rotation around B. Formula: `corrA = d*(1-t) / ((1-t)² + t²)`, `corrC = d*t / ((1-t)² + t²)`.

3. **Slider B can be the fixed joint** — constraint must be bidirectional (push A & C, not just B).

4. **Collider endpoint wrap-around** — joints going around segment endpoints must update their recorded side, otherwise re-entry is blocked.

5. **Velocity is module-level state** — call `resetVelocities()` when starting/resetting simulation.

6. **PBD is inherently energy-dissipative** — more constraint passes = stiffer but more energy loss. 6 passes is a good balance.

7. **Damping=0 means max damping, not zero** — the slider maps 0→0.001 retention, 1→1.0 retention per second.

## Slinker's UI/Interaction Patterns Worth Knowing

These aren't physics, but they solved hard interaction problems:

- **Arc body selector** — radial popup on long-press for fast body assignment (300ms timer). Staggered entry animation. Different arc layouts for different tools.
- **Pen vs touch separation** — Apple Pencil events pass through as mouse-like. Touch uses pending/pan/pinch gesture detection. Touch never places on finger-down, only on release.
- **Body-local coordinates** — outlines and tracers are stored in body-local coords, reprojected to world when body transforms change (joint add/remove/move).
- **Frozen outline points** — world-space snapshots used to preserve outline positions when editing joints in create mode. Auto-populated on mode switch.
- **iOS file picker** — dynamically created `<input>` elements must be appended to DOM (not left detached) or Safari GC's them before `onchange` fires.

## How to Use This Document

Drop this file into your new project as `HANDOVER.md` or reference it in your `CLAUDE.md`:

```markdown
## Reference
See HANDOVER.md for physics engine architecture from the Slinker project.
Physics source files may be in src/physics/ — see PHYSICS.md there.
```

If you have the physics files, the new instance can read them directly. If not, point it at the Slinker repo or paste the specific files you need — the engine is only 8 files.
