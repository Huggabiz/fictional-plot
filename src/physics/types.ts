export interface Vec2 {
  readonly x: number;
  readonly y: number;
}

export type JointType = 'revolute' | 'fixed';

export interface Joint {
  readonly id: string;
  type: JointType;
  position: Vec2;
  connectedLinkIds: string[];
  mass?: number;
  externalForce?: Vec2;
  hidden?: boolean;
}

export interface Link {
  readonly id: string;
  jointIds: [string, string];
  restLength: number;
  mass: number;
}

export interface Body {
  readonly id: string;
  name: string;
  color: string;
  jointIds: string[];
  useOutlineCOM: boolean;
  showLinks: boolean;
}

export interface SliderConstraint {
  readonly id: string;
  jointIdA: string;
  jointIdB: string;
  jointIdC: string;
  t: number;
}

export interface AngleConstraint {
  readonly id: string;
  jointIdA: string;
  jointIdB: string;
  jointIdC: string;
  restAngle: number;
}

export interface ColliderConstraint {
  readonly id: string;
  jointIdA: string;
  jointIdC: string;
  bodyIds: string[];
}

export interface Tracer {
  readonly id: string;
  bodyId: string;
  localPosition: Vec2;
  enabled: boolean;
}

export interface SolverResult {
  converged: boolean;
  iterations: number;
  residual: number;
  positions: Map<string, Vec2>;
  forceVectors: ForceVector[];
}

export interface ForceVector {
  origin: Vec2;
  force: Vec2;
  color: string;
}
