/**
 * Display / entry units for measurements. Internally every length and
 * point coordinate is stored in millimetres; this module is the only
 * place that knows how to convert between mm and the user's preferred
 * unit. The first measurement establishes the sketch-to-mm scale, so
 * once the survey has a single dimension the rest of the system has
 * real-world mm to reason about.
 */

export type Units = 'mm' | 'cm' | 'm' | 'in' | 'ft';

export const ALL_UNITS: Units[] = ['mm', 'cm', 'm', 'in', 'ft'];

const MM_PER_UNIT: Record<Units, number> = {
  mm: 1,
  cm: 10,
  m: 1000,
  in: 25.4,
  ft: 304.8,
};

export function toMm(value: number, unit: Units): number {
  return value * MM_PER_UNIT[unit];
}

export function fromMm(valueMm: number, unit: Units): number {
  return valueMm / MM_PER_UNIT[unit];
}

/** Format a length stored in mm for display in the given unit. */
export function formatLength(valueMm: number, unit: Units): string {
  const v = fromMm(valueMm, unit);
  return `${formatNumber(v, unit)} ${unit}`;
}

/** Format without the unit suffix — for labels where space is tight. */
export function formatNumber(value: number, unit: Units): string {
  // Pick a sensible number of decimals per unit.
  switch (unit) {
    case 'mm': return value >= 100 ? value.toFixed(0) : value.toFixed(1);
    case 'cm': return value >= 100 ? value.toFixed(0) : value.toFixed(1);
    case 'm':  return value.toFixed(value >= 10 ? 2 : 3);
    case 'in': return value >= 12 ? value.toFixed(1) : value.toFixed(2);
    case 'ft': return value.toFixed(value >= 10 ? 2 : 3);
  }
}
