import type { Vec2 } from '../physics/types';

export interface Viewport {
  tx: number;
  ty: number;
  scale: number;
}

export const initialViewport = (): Viewport => ({ tx: 0, ty: 0, scale: 1 });

export const worldToScreen = (v: Viewport, p: Vec2): Vec2 => ({
  x: p.x * v.scale + v.tx,
  y: p.y * v.scale + v.ty,
});

export const screenToWorld = (v: Viewport, p: Vec2): Vec2 => ({
  x: (p.x - v.tx) / v.scale,
  y: (p.y - v.ty) / v.scale,
});

export const panBy = (v: Viewport, dx: number, dy: number): Viewport => ({
  ...v,
  tx: v.tx + dx,
  ty: v.ty + dy,
});

export const zoomAt = (v: Viewport, screen: Vec2, factor: number): Viewport => {
  const world = screenToWorld(v, screen);
  const scale = clamp(v.scale * factor, 0.05, 200);
  return {
    scale,
    tx: screen.x - world.x * scale,
    ty: screen.y - world.y * scale,
  };
};

const clamp = (n: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, n));
