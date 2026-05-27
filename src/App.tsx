import { useEffect, useMemo, useState } from 'react';
import { type Plot, type Shape, emptyPlot } from './model/plot';
import { loadPlot, savePlot } from './model/persist';
import { SketchCanvas } from './sketch/SketchCanvas';
import {
  bestNextCandidate,
  computeCandidates,
} from './survey/candidates';
import { runSurveySolve } from './survey/run';

export type Layer = 'features' | 'survey';
export type FeatureTool = 'draw' | 'point' | 'edit' | 'delete';
export type SurveyTool = 'measure' | 'delete';

export function App() {
  const [plot, setPlot] = useState<Plot>(loadPlot);
  const [layer, setLayer] = useState<Layer>('features');
  const [featureTool, setFeatureTool] = useState<FeatureTool>('draw');
  const [surveyTool, setSurveyTool] = useState<SurveyTool>('measure');
  const [currentShapeId, setCurrentShapeId] = useState<string | null>(null);
  const [activePointId, setActivePointId] = useState<string | null>(null);

  // Persist plot to localStorage on every change.
  useEffect(() => { savePlot(plot); }, [plot]);

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
    setPlot(emptyPlot());
    setCurrentShapeId(null);
    setActivePointId(null);
  };

  const clearMeasurements = () => {
    if (measurementCount === 0) return;
    if (!confirm(`Clear all ${measurementCount} measurements?`)) return;
    setPlot(p => ({ ...p, measurements: {}, anchorPointId: undefined, orientationPointId: undefined }));
  };

  const finishCurrentShape = () => {
    setCurrentShapeId(null);
    setActivePointId(null);
  };

  const solveNow = () => {
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
              onSolve={solveNow}
              onClearMeasurements={clearMeasurements}
            />
          )}
        </aside>

        <main className="app-main">
          <SketchCanvas
            plot={plot}
            setPlot={updatePlot}
            layer={layer}
            featureTool={featureTool}
            surveyTool={surveyTool}
            candidates={candidates}
            nextBestKey={nextBestKey}
            currentShapeId={currentShapeId}
            setCurrentShapeId={setCurrentShapeId}
            activePointId={activePointId}
            setActivePointId={setActivePointId}
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
}: {
  tool: FeatureTool;
  onTool: (t: FeatureTool) => void;
  shapes: Shape[];
  currentShapeId: string | null;
  onPickShape: (id: string) => void;
  onFinishShape: () => void;
  onClearAll: () => void;
}) {
  return (
    <>
      <SectionTitle>Tools</SectionTitle>
      <div className="tool-grid">
        <ToolButton active={tool === 'draw'} onClick={() => onTool('draw')} hint="Tap to chain points; tap the first point to close.">
          Draw shape
        </ToolButton>
        <ToolButton active={tool === 'point'} onClick={() => onTool('point')} hint="Drop standalone reference points.">
          Add point
        </ToolButton>
        <ToolButton active={tool === 'edit'} onClick={() => onTool('edit')} hint="Drag a point to move it.">
          Edit
        </ToolButton>
        <ToolButton active={tool === 'delete'} onClick={() => onTool('delete')} hint="Tap a point to remove it.">
          Delete
        </ToolButton>
      </div>
      {tool === 'draw' ? (
        <button type="button" className="block-button" disabled={!currentShapeId} onClick={onFinishShape}>
          Finish shape
        </button>
      ) : null}

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

      <SectionTitle>Survey</SectionTitle>
      <ul className="stat-list">
        <li>Candidates: <strong>{candidateCount}</strong></li>
        <li>Measured: <strong>{measurementCount}</strong></li>
        <li>Would improve rigidity: <strong>{improvingCount}</strong></li>
        <li>Free DoFs: <strong>{remainingDof}</strong></li>
        {nextBestLength != null ? (
          <li>Next best length: <strong>~{nextBestLength.toFixed(1)}</strong></li>
        ) : null}
      </ul>

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
