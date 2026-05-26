import { useState } from 'react';
import { type Plot, emptyPlot } from './model/plot';
import { SketchCanvas } from './sketch/SketchCanvas';

export function App() {
  const [plot, setPlot] = useState<Plot>(emptyPlot);

  const pointCount = Object.keys(plot.points).length;
  const edgeCount = Object.keys(plot.edges).length;

  const updatePlot = (updater: (p: Plot) => Plot) => setPlot(updater);
  const clear = () => setPlot(emptyPlot());

  return (
    <div className="app">
      <header className="app-header">
        <div className="app-title">
          <h1>Fictional Plot</h1>
          <span className="app-mode">Rough Plot</span>
        </div>
        <div className="app-stats">
          <span>{pointCount} pts</span>
          <span>{edgeCount} edges</span>
          <button type="button" className="app-button" onClick={clear} disabled={pointCount === 0}>
            Clear
          </button>
        </div>
      </header>
      <main className="app-main">
        <SketchCanvas plot={plot} setPlot={updatePlot} />
      </main>
    </div>
  );
}
