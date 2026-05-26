# Fictional Plot

Architectural survey maker. Sketch a rough plot of points and connecting
edges, take a handful of tape-measure dimensions between points, and the
app solves the over-constrained system to produce an accurate dimension
map. Measurements are modelled as elastic distance constraints — when
the plot relaxes with low residual stress, the survey is well-fitted.

## Stack

- React 19 + TypeScript + Vite + Canvas 2D
- PWA (vite-plugin-pwa), iPad-friendly with Apple Pencil support
- Physics engine copied from Slinker (see `HANDOVER.md` and
  `src/physics/PHYSICS.md`)

## Modes

1. **Rough Plot** — tap to add points, connect with straight edges.
   Topology + approximate positions only. (Arcs are out of scope for v1.)
2. **Survey** — app suggests the next dimension to measure: a still-needed
   edge that improves rigidity, preferring one sharing an endpoint with
   the last measurement (least walking on site), then shortest length.
   User enters the tape reading.
3. **Solve** — PBD relaxation with measurements as soft distance
   constraints. Per-edge residual stress colours the edges; bad readings
   glow red. A "Compute" step runs Levenberg–Marquardt non-linear least
   squares for the final co-ordinates and per-point uncertainty.

## Rigidity

For N points in 2D, full rigidity needs 2N − 3 independent distance
measurements (after pinning one anchor point + one orientation point to
remove translation and rotation degrees of freedom). The app's job is to
guide the surveyor toward the next measurement that increases the rank
of the rigidity matrix, then optionally collect redundancy.

## File Layout

```
src/
  physics/        # Slinker engine — Vec2, joints/links, PBD + N-R solvers
  model/          # Plot/Point/Edge/Measurement types
  App.tsx         # placeholder shell
  main.tsx
HANDOVER.md       # Slinker handover doc
src/physics/PHYSICS.md  # engine internals
```

## Notes for future sessions

- Distance constraints in PBD are rigid; for survey solving they need to
  be soft (springs). Don't reuse the Slinker `solveWithForce` PBD
  projection unchanged for the solve step — adapt it, or write the LM
  solver fresh using `solveLU` from `math/linalg.ts`.
- Pen-vs-touch separation matters on iPad. Pen events arrive as
  mouse-like; touch should pan/zoom and only place points on release.
- Don't reintroduce angle constraints — see HANDOVER.md lesson 1.
