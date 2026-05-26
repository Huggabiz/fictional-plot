import type { Body, Joint, Vec2 } from './types';
import { sub, add, rotate } from './math/vec2';

export interface BodyTransform {
  origin: Vec2;
  angle: number;
}

/**
 * Compute a rigid body's reference frame from its joint positions.
 * Origin = centroid of all joints in the body.
 * Angle = direction from centroid to first joint (reference direction).
 */
export function computeBodyTransform(
  body: Body,
  joints: Record<string, Joint>,
): BodyTransform {
  const positions: Vec2[] = [];
  for (const jid of body.jointIds) {
    const j = joints[jid];
    if (j) positions.push(j.position);
  }

  if (positions.length === 0) {
    return { origin: { x: 0, y: 0 }, angle: 0 };
  }

  if (positions.length === 1) {
    return { origin: positions[0], angle: 0 };
  }

  let cx = 0, cy = 0;
  for (const p of positions) { cx += p.x; cy += p.y; }
  cx /= positions.length;
  cy /= positions.length;
  const origin = { x: cx, y: cy };

  const dx = positions[0].x - cx;
  const dy = positions[0].y - cy;
  const angle = Math.atan2(dy, dx);

  return { origin, angle };
}

export function localToWorld(localPt: Vec2, transform: BodyTransform): Vec2 {
  const rotated = rotate(localPt, transform.angle);
  return add(transform.origin, rotated);
}

export function worldToLocal(worldPt: Vec2, transform: BodyTransform): Vec2 {
  const relative = sub(worldPt, transform.origin);
  return rotate(relative, -transform.angle);
}

export function polygonArea(points: Vec2[]): number {
  if (points.length < 3) return 0;
  let area = 0;
  for (let i = 0; i < points.length; i++) {
    const j = (i + 1) % points.length;
    area += points[i].x * points[j].y - points[j].x * points[i].y;
  }
  return Math.abs(area / 2);
}

export function polygonCentroid(points: Vec2[]): Vec2 {
  if (points.length === 0) return { x: 0, y: 0 };
  if (points.length === 1) return points[0];
  if (points.length === 2) return { x: (points[0].x + points[1].x) / 2, y: (points[0].y + points[1].y) / 2 };

  let area = 0;
  let cx = 0;
  let cy = 0;
  for (let i = 0; i < points.length; i++) {
    const j = (i + 1) % points.length;
    const cross = points[i].x * points[j].y - points[j].x * points[i].y;
    area += cross;
    cx += (points[i].x + points[j].x) * cross;
    cy += (points[i].y + points[j].y) * cross;
  }
  area /= 2;
  if (Math.abs(area) < 1e-10) {
    let sx = 0, sy = 0;
    for (const p of points) { sx += p.x; sy += p.y; }
    return { x: sx / points.length, y: sy / points.length };
  }
  cx /= (6 * area);
  cy /= (6 * area);
  return { x: cx, y: cy };
}
