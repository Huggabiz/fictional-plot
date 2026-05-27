import { useEffect, useState } from 'react';
import { ALL_UNITS, fromMm, toMm, type Units } from '../model/units';

interface Props {
  title: string;
  subtitle?: string;
  /** Existing length in mm to seed the display, if editing. */
  initialValueMm?: number;
  unit: Units;
  onUnitChange: (unit: Units) => void;
  allowDelete?: boolean;
  /** Called with the entered length converted to mm. */
  onCommit: (valueMm: number) => void;
  onDelete?: () => void;
  onCancel: () => void;
}

export function NumberPad({
  title,
  subtitle,
  initialValueMm,
  unit,
  onUnitChange,
  allowDelete = false,
  onCommit,
  onDelete,
  onCancel,
}: Props) {
  const [value, setValue] = useState(() =>
    initialValueMm != null ? formatInitial(initialValueMm, unit) : '',
  );

  // When editing an existing measurement, re-format the seeded display
  // string each time the user toggles units so the same underlying mm
  // value is shown in the new unit. When entering fresh, the digits the
  // user has typed are left alone — they're now interpreted in the new
  // unit, which is what a tape-readout swap should do.
  useEffect(() => {
    if (initialValueMm != null) {
      setValue(formatInitial(initialValueMm, unit));
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [unit]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.preventDefault();
        onCancel();
      } else if (e.key === 'Enter') {
        e.preventDefault();
        tryCommit(value);
      } else if (e.key === 'Backspace') {
        e.preventDefault();
        setValue(v => v.slice(0, -1));
      } else if (e.key === '.' || /^[0-9]$/.test(e.key)) {
        e.preventDefault();
        setValue(v => appendDigit(v, e.key));
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  });

  const tryCommit = (raw: string) => {
    const n = Number(raw);
    if (!Number.isFinite(n) || n <= 0) return;
    onCommit(toMm(n, unit));
  };

  const numeric = Number(value);
  const canCommit = value !== '' && Number.isFinite(numeric) && numeric > 0;

  const press = (s: string) => setValue(v => appendDigit(v, s));
  const backspace = () => setValue(v => v.slice(0, -1));
  const clear = () => setValue('');

  return (
    <div className="numpad-backdrop" onPointerDown={e => { if (e.target === e.currentTarget) onCancel(); }}>
      <div className="numpad" role="dialog" aria-label={title}>
        <div className="numpad-header">
          <div className="numpad-title">{title}</div>
          {subtitle ? <div className="numpad-subtitle">{subtitle}</div> : null}
        </div>
        <div className="numpad-units" role="tablist" aria-label="Units">
          {ALL_UNITS.map(u => (
            <button
              key={u}
              type="button"
              role="tab"
              aria-selected={u === unit}
              className={`numpad-unit ${u === unit ? 'active' : ''}`}
              onClick={() => onUnitChange(u)}
            >
              {u}
            </button>
          ))}
        </div>
        <div className={`numpad-display ${value === '' ? 'empty' : ''}`}>
          <span className="numpad-display-value">{value === '' ? '0' : value}</span>
          <span className="numpad-display-unit">{unit}</span>
        </div>
        <div className="numpad-grid">
          <button type="button" className="numpad-key" onClick={() => press('7')}>7</button>
          <button type="button" className="numpad-key" onClick={() => press('8')}>8</button>
          <button type="button" className="numpad-key" onClick={() => press('9')}>9</button>
          <button type="button" className="numpad-key" onClick={() => press('4')}>4</button>
          <button type="button" className="numpad-key" onClick={() => press('5')}>5</button>
          <button type="button" className="numpad-key" onClick={() => press('6')}>6</button>
          <button type="button" className="numpad-key" onClick={() => press('1')}>1</button>
          <button type="button" className="numpad-key" onClick={() => press('2')}>2</button>
          <button type="button" className="numpad-key" onClick={() => press('3')}>3</button>
          <button type="button" className="numpad-key" onClick={() => press('.')}>.</button>
          <button type="button" className="numpad-key" onClick={() => press('0')}>0</button>
          <button type="button" className="numpad-key muted" onClick={backspace} aria-label="Backspace">⌫</button>
          <button type="button" className="numpad-key muted wide" onClick={clear}>Clear</button>
        </div>
        <div className="numpad-actions">
          <button type="button" className="numpad-action" onClick={onCancel}>Cancel</button>
          {allowDelete && onDelete ? (
            <button type="button" className="numpad-action danger" onClick={onDelete}>Delete</button>
          ) : null}
          <button
            type="button"
            className="numpad-action primary"
            onClick={() => tryCommit(value)}
            disabled={!canCommit}
          >
            OK
          </button>
        </div>
      </div>
    </div>
  );
}

function appendDigit(current: string, key: string): string {
  if (key === '.') {
    if (current.includes('.')) return current;
    if (current === '') return '0.';
    return current + '.';
  }
  if (current === '0') return key;
  return current + key;
}

function formatInitial(valueMm: number, unit: Units): string {
  const v = fromMm(valueMm, unit);
  // Trim trailing zeros for nicer editing.
  return String(Number(v.toFixed(6)));
}
