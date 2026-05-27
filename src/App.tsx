import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { type Plot, type Shape, type Underlay, emptyPlot } from './model/plot';
import { ALL_UNITS, type Units } from './model/units';
import { loadPlot, savePlot } from './model/persist';
import { downloadPlot, pickPlotFile } from './model/io';
import { pickUnderlay } from './model/imageImport';
import { SketchCanvas } from './sketch/SketchCanvas';
import {
  bestNextCandidate,
  computeCandidates,
} from './survey/candidates';
import { runSurveySolve } from './survey/run';

export type Layer = 'features' | 'survey';
export type FeatureTool = 'draw' | 'point' | 'onEdge' | 'edit' | 'delete' | 'adjustImage';
export type SurveyTool = 'measure' | 'delete';

const HISTORY_LIMIT = 50;

export function App() {
  const [plot, setPlot] = useState<Plot>(loadPlot);
  const [layer, setLayer] = useState<Layer>('features');
  const [featureTool, setFeatureTool] = useState<FeatureTool>('draw');
  const [surveyTool, setSurveyTool] = useState<SurveyTool>('measure');
  const [currentShapeId, setCurrentShapeId] = useState<string | null>(null);
  const [activePointId, setActivePointId] = useState<string | null>(null);
  const [history, setHistory] = useState<Plot[]>([]);

  // Keep a ref to the latest plot so pushHistory captures the current
  // state even when called outside a setPlot updater (e.g. just before
  // a drag begins).
  const plotRef = useRef(plot);
  plotRef.current = plot;

  // Persist plot to localStorage on every change.
  useEffect(() => { savePlot(plot); }, [plot]);

  const pushHistory = useCallback(() => {
    const snapshot = plotRef.current;
    setHistory(h => {
      const next = h.length >= HISTORY_LIMIT ? h.slice(h.length - HISTORY_LIMIT + 1) : h.slice();
      next.push(snapshot);
      return next;
    });
  }, []);

  const undo = useCallback(() => {
    setHistory(h => {
      if (h.length === 0) return h;
      const prev = h[h.length - 1];
      setPlot(prev);
      return h.slice(0, -1);
    });
  }, []);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const meta = e.metaKey || e.ctrlKey;
      if (meta && !e.shiftKey && (e.key === 'z' || e.key === 'Z')) {
        e.preventDefault();
        undo();
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [undo]);

  const setUnits = useCallback((u: Units) => {
    setPlot(prev => prev.units === u ? prev : { ...prev, units: u });
  }, []);

  const setShapeCohesion = useCallback((v: number) => {
    const clamped = Math.max(0, Math.min(1, v));
    setPlot(prev => {
      if (prev.shapeCohesion === clamped) return prev;
      // Re-solve so the slider feels live when measurements exist.
      const next = { ...prev, shapeCohesion: clamped };
      return runSurveySolve(next) ?? next;
    });
  }, []);

  const openFile = useCallback(async () => {
    const loaded = await pickPlotFile();
    if (!loaded) return;
    pushHistory();
    setPlot(loaded);
    setCurrentShapeId(null);
    setActivePointId(null);
  }, [pushHistory]);

  const saveFile = useCallback(() => {
    downloadPlot(plotRef.current);
  }, []);

  const importImage = useCallback(async () => {
    // Aim for the image to span ~600 mm initially — large enough to
    // see but small enough not to dominate the viewport. The user
    // can then drag/pinch to place it precisely.
    const underlay = await pickUnderlay(600, { x: 0, y: 0 });
    if (!underlay) return;
    pushHistory();
    setPlot(p => ({ ...p, underlay }));
    setFeatureTool('adjustImage');
    setLayer('features');
  }, [pushHistory]);

  const setUnderlay = useCallback((updater: (u: Underlay) => Underlay) => {
    setPlot(prev => {
      if (!prev.underlay) return prev;
      return { ...prev, underlay: updater(prev.underlay) };
    });
  }, []);

  const removeUnderlay = useCallback(() => {
    pushHistory();
    setPlot(prev => {
      if (!prev.underlay) return prev;
      const { underlay: _, ...rest } = prev;
      return rest;
    });
    setFeatureTool(t => (t === 'adjustImage' ? 'draw' : t));
  }, [pushHistory]);

  const resetUnderlayTransform = useCallback(() => {
    pushHistory();
    setPlot(prev => {
      if (!prev.underlay) return prev;
      return {
        ...prev,
        underlay: { ...prev.underlay, rotation: 0, center: { x: 0, y: 0 } },
      };
    });
  }, [pushHistory]);

  const candidates = useMemo(() => computeCandidates(plot), [plot]);
  const nextBest = useMemo(() => bestNextCandidate(candidates), [candidates]);
  const nextBestKey = nextBest?.key ?? null;

  const pointCount = Object.keys(plot.points).length;
  const shapeList = Object.values(plot.shapes);
  const measurementCount = Object.keys(plot.measurements).length;
  const measuredRigid = candidates.filter(c => c.measured).length;
  const remainingDof = Math.max(0, 2 * pointCount - 3 - measuredRigid);

  const updatePlot = (updater: (p: Plot) => Plot) => setPlot(updater);

  const clearAll = () => {
    if (!confirm('Clear all points, shapes and measurements?')) return;
    pushHistory();
    setPlot(p => ({ ...emptyPlot(), units: p.units, shapeCohesion: p.shapeCohesion }));
    setCurrentShapeId(null);
    setActivePointId(null);
  };

  const clearMeasurements = () => {
    if (measurementCount === 0) return;
    if (!confirm(`Clear all ${measurementCount} measurements?`)) return;
    pushHistory();
    setPlot(p => ({ ...p, measurements: {}, anchorPointId: undefined, orientationPointId: undefined }));
  };

  const finishCurrentShape = () => {
    setCurrentShapeId(null);
    setActivePointId(null);
  };

  const solveNow = () => {
    pushHistory();
    setPlot(prev => runSurveySolve(prev) ?? prev);
  };

  return (
    <div className="app">
      <header className="app-header">
        <div className="app-title">
          <h1>Fictional Plot</h1>
          <span className="app-version" title="Build version">{__APP_VERSION__}</span>
        </div>
        <div className="layer-tabs" role="tablist" aria-label="Layer">
          <button
            type="button"
            role="tab"
            aria-selected={layer === 'features'}
            className={`layer-tab ${layer === 'features' ? 'active' : ''}`}
            onClick={() => setLayer('features')}
          >
            1 · Features
          </button>
          <button
            type="button"
            role="tab"
            aria-selected={layer === 'survey'}
            className={`layer-tab ${layer === 'survey' ? 'active' : ''}`}
            onClick={() => setLayer('survey')}
          >
            2 · Survey
          </button>
        </div>
        <div className="app-stats">
          <span>{pointCount} pts</span>
          <span>{shapeList.length} shapes</span>
          <span>{measurementCount} meas</span>
          {layer === 'survey' && pointCount >= 2 ? <span>{remainingDof} dof left</span> : null}
        </div>
        <div className="header-buttons">
          <button
            type="button"
            className="header-button"
            onClick={undo}
            disabled={history.length === 0}
            title="Undo (Ctrl/Cmd+Z)"
          >
            ↶ Undo
          </button>
          <button
            type="button"
            className="header-button"
            onClick={clearAll}
            title="Start a new plot (clears the canvas)"
          >
            New
          </button>
          <button type="button" className="header-button" onClick={openFile} title="Open a .fplot.json file">
            Open
          </button>
          <button type="button" className="header-button" onClick={saveFile} title="Download as .fplot.json">
            Save
          </button>
          <button
            type="button"
            className="header-button"
            onClick={importImage}
            title="Import an image to trace over"
          >
            Image…
          </button>
        </div>
      </header>

      <div className="app-body">
        <aside className="sidebar">
          {layer === 'features' ? (
            <FeatureSidebar
              tool={featureTool}
              onTool={setFeatureTool}
              shapes={shapeList}
              currentShapeId={currentShapeId}
              onPickShape={id => {
                setCurrentShapeId(id);
                const s = plot.shapes[id];
                if (s && s.pointIds.length > 0 && !s.closed) {
                  setActivePointId(s.pointIds[s.pointIds.length - 1]);
                } else {
                  setActivePointId(null);
                }
              }}
              onFinishShape={finishCurrentShape}
              onClearAll={clearAll}
              underlay={plot.underlay}
              onUnderlayChange={setUnderlay}
              onRemoveUnderlay={removeUnderlay}
              onResetUnderlay={resetUnderlayTransform}
              onImportImage={importImage}
            />
          ) : (
            <SurveySidebar
              tool={surveyTool}
              onTool={setSurveyTool}
              measurementCount={measurementCount}
              candidateCount={candidates.length}
              improvingCount={candidates.filter(c => c.improvesRigidity).length}
              remainingDof={remainingDof}
              nextBestLength={nextBest?.worldLength}
              units={plot.units}
              onUnitsChange={setUnits}
              shapeCohesion={plot.shapeCohesion}
              onShapeCohesionChange={setShapeCohesion}
              onSolve={solveNow}
              onClearMeasurements={clearMeasurements}
            />
          )}
        </aside>

        <main className="app-main">
          <SketchCanvas
            plot={plot}
            setPlot={updatePlot}
            pushHistory={pushHistory}
            layer={layer}
            featureTool={featureTool}
            surveyTool={surveyTool}
            candidates={candidates}
            nextBestKey={nextBestKey}
            currentShapeId={currentShapeId}
            setCurrentShapeId={setCurrentShapeId}
            activePointId={activePointId}
            setActivePointId={setActivePointId}
            units={plot.units}
            setUnits={setUnits}
            onUnderlayChange={setUnderlay}
          />
        </main>
      </div>
    </div>
  );
}

function FeatureSidebar({
  tool,
  onTool,
  shapes,
  currentShapeId,
  onPickShape,
  onFinishShape,
  onClearAll,
  underlay,
  onUnderlayChange,
  onRemoveUnderlay,
  onResetUnderlay,
  onImportImage,
}: {
  tool: FeatureTool;
  onTool: (t: FeatureTool) => void;
  shapes: Shape[];
  currentShapeId: string | null;
  onPickShape: (id: string) => void;
  onFinishShape: () => void;
  onClearAll: () => void;
  underlay: Underlay | undefined;
  onUnderlayChange: (u: (cur: Underlay) => Underlay) => void;
  onRemoveUnderlay: () => void;
  onResetUnderlay: () => void;
  onImportImage: () => void;
}) {
  return (
    <>
      <SectionTitle>Tools</SectionTitle>
      <div className="tool-grid">
        <ToolButton active={tool === 'draw'} onClick={() => onTool('draw')} hint="Tap to chain points; tap an edge to insert a vertex; tap the first point to close.">
          Draw shape
        </ToolButton>
        <ToolButton active={tool === 'point'} onClick={() => onTool('point')} hint="Drop standalone reference points.">
          Add point
        </ToolButton>
        <ToolButton active={tool === 'onEdge'} onClick={() => onTool('onEdge')} hint="Tap an existing edge to drop a point pinned to that edge between its endpoints.">
          On-edge point
        </ToolButton>
        <ToolButton active={tool === 'edit'} onClick={() => onTool('edit')} hint="Drag a point to move it.">
          Edit
        </ToolButton>
        <ToolButton active={tool === 'delete'} onClick={() => onTool('delete')} hint="Tap a point to remove it.">
          Delete
        </ToolButton>
        {underlay ? (
          <ToolButton
            active={tool === 'adjustImage'}
            onClick={() => onTool('adjustImage')}
            hint="Drag to move the image; pinch with two fingers to scale and rotate."
          >
            Adjust image
          </ToolButton>
        ) : null}
      </div>
      {tool === 'draw' ? (
        <button type="button" className="block-button" disabled={!currentShapeId} onClick={onFinishShape}>
          Finish shape
        </button>
      ) : null}

      <SectionTitle>Reference image</SectionTitle>
      {underlay ? (
        <>
          <div className="slider-row">
            <label className="slider-label">Opacity</label>
            <input
              type="range"
              min={0}
              max={1}
              step={0.05}
              value={underlay.opacity}
              onChange={e => {
                const v = Number(e.currentTarget.value);
                onUnderlayChange(u => ({ ...u, opacity: v }));
              }}
            />
            <span className="slider-value">{Math.round(underlay.opacity * 100)}%</span>
          </div>
          <div className="slider-row">
            <label className="slider-label">Rotation</label>
            <input
              type="range"
              min={-180}
              max={180}
              step={0.5}
              value={(underlay.rotation * 180) / Math.PI}
              onChange={e => {
                const deg = Number(e.currentTarget.value);
                onUnderlayChange(u => ({ ...u, rotation: (deg * Math.PI) / 180 }));
              }}
            />
            <span className="slider-value">{Math.round((underlay.rotation * 180) / Math.PI)}°</span>
          </div>
          <button type="button" className="block-button" onClick={onResetUnderlay}>
            Reset rotation & position
          </button>
          <button type="button" className="block-button danger" onClick={onRemoveUnderlay}>
            Remove image
          </button>
          <p className="hint">
            Pick the Adjust image tool to drag/scale/rotate on the canvas. Tap any other
            tool to draw over the image as a tracing underlay.
          </p>
        </>
      ) : (
        <>
          <button type="button" className="block-button" onClick={onImportImage}>
            Import image…
          </button>
          <p className="hint">JPG, PNG or anything the browser can decode. Embedded into the saved plot.</p>
        </>
      )}

      <SectionTitle>Shapes ({shapes.length})</SectionTitle>
      {shapes.length === 0 ? (
        <p className="hint">No shapes yet. Use Draw shape and tap on the canvas.</p>
      ) : (
        <ul className="shape-list">
          {shapes.map(s => (
            <li key={s.id}>
              <button
                type="button"
                className={`shape-row ${currentShapeId === s.id ? 'active' : ''}`}
                onClick={() => onPickShape(s.id)}
              >
                <span className="shape-name">{s.name ?? defaultShapeName(s, shapes)}</span>
                <span className="shape-meta">
                  {s.closed ? 'closed' : 'open'} · {s.pointIds.length} pts
                </span>
              </button>
            </li>
          ))}
        </ul>
      )}

      <div className="sidebar-footer">
        <button type="button" className="block-button danger" onClick={onClearAll}>
          Clear everything
        </button>
      </div>
    </>
  );
}

function SurveySidebar({
  tool,
  onTool,
  measurementCount,
  candidateCount,
  improvingCount,
  remainingDof,
  nextBestLength,
  units,
  onUnitsChange,
  shapeCohesion,
  onShapeCohesionChange,
  onSolve,
  onClearMeasurements,
}: {
  tool: SurveyTool;
  onTool: (t: SurveyTool) => void;
  measurementCount: number;
  candidateCount: number;
  improvingCount: number;
  remainingDof: number;
  nextBestLength?: number;
  units: Units;
  onUnitsChange: (u: Units) => void;
  shapeCohesion: number;
  onShapeCohesionChange: (v: number) => void;
  onSolve: () => void;
  onClearMeasurements: () => void;
}) {
  return (
    <>
      <SectionTitle>Tools</SectionTitle>
      <div className="tool-grid">
        <ToolButton active={tool === 'measure'} onClick={() => onTool('measure')} hint="Tap a candidate line to enter a tape reading.">
          Add dimension
        </ToolButton>
        <ToolButton active={tool === 'delete'} onClick={() => onTool('delete')} hint="Tap a measured line to remove its dimension.">
          Clear dimension
        </ToolButton>
      </div>

      <SectionTitle>Units</SectionTitle>
      <div className="unit-row" role="tablist" aria-label="Units">
        {ALL_UNITS.map(u => (
          <button
            key={u}
            type="button"
            role="tab"
            aria-selected={u === units}
            className={`unit-button ${u === units ? 'active' : ''}`}
            onClick={() => onUnitsChange(u)}
          >
            {u}
          </button>
        ))}
      </div>

      <SectionTitle>Survey</SectionTitle>
      <ul className="stat-list">
        <li>Candidates: <strong>{candidateCount}</strong></li>
        <li>Measured: <strong>{measurementCount}</strong></li>
        <li>Would improve rigidity: <strong>{improvingCount}</strong></li>
        <li>Free DoFs: <strong>{remainingDof}</strong></li>
        {nextBestLength != null && measurementCount > 0 ? (
          <li>Next best length: <strong>~{nextBestLength.toFixed(0)} mm</strong></li>
        ) : null}
      </ul>

      <SectionTitle>Shape cohesion</SectionTitle>
      <div className="slider-row">
        <input
          type="range"
          min={0}
          max={1}
          step={0.01}
          value={shapeCohesion}
          onChange={e => onShapeCohesionChange(Number(e.currentTarget.value))}
          aria-label="Shape cohesion"
        />
        <span className="slider-value">{shapeCohesion.toFixed(2)}</span>
      </div>
      <p className="hint">
        Pulls the survey back toward the rough sketch. 0 lets tape readings dominate;
        higher values preserve the drawn shape when measurements are sparse.
      </p>

      <button type="button" className="block-button" onClick={onSolve} disabled={measurementCount === 0}>
        Solve now
      </button>
      <button type="button" className="block-button danger" onClick={onClearMeasurements} disabled={measurementCount === 0}>
        Clear all dimensions
      </button>

      <p className="hint">
        Translucent grey racetracks are candidate dimensions; the{' '}
        <span style={{ color: '#3b5bdb', fontWeight: 600 }}>blue</span> one is the next best to measure.
        Measured lines glow <span style={{ color: '#2e8b57', fontWeight: 600 }}>green</span> when in-fit,{' '}
        <span style={{ color: '#c83c3c', fontWeight: 600 }}>red</span> when stressed.
      </p>
    </>
  );
}

function SectionTitle({ children }: { children: React.ReactNode }) {
  return <h2 className="sidebar-section">{children}</h2>;
}

function ToolButton({
  active,
  onClick,
  hint,
  children,
}: {
  active: boolean;
  onClick: () => void;
  hint?: string;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      className={`tool-button ${active ? 'active' : ''}`}
      onClick={onClick}
      title={hint}
    >
      {children}
    </button>
  );
}

function defaultShapeName(shape: Shape, all: Shape[]): string {
  const idx = all.findIndex(s => s.id === shape.id) + 1;
  return `Shape ${idx}`;
}
