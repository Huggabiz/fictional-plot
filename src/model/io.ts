import type { Plot } from './plot';
import { normalisePlot } from './persist';

/**
 * On-disk file format for Fictional Plot surveys. Lives in a versioned
 * envelope so future schema bumps can be migrated without breaking
 * existing files. The current payload is the Plot as JSON; lengths are
 * in millimetres.
 */
export interface PlotFile {
  app: 'fictional-plot';
  formatVersion: 1;
  exportedAt: string; // ISO timestamp
  plot: Plot;
}

export function serializePlot(plot: Plot): string {
  const file: PlotFile = {
    app: 'fictional-plot',
    formatVersion: 1,
    exportedAt: new Date().toISOString(),
    plot,
  };
  return JSON.stringify(file, null, 2);
}

export function parsePlotFile(json: string): Plot {
  const data = JSON.parse(json) as Partial<PlotFile> | Partial<Plot>;
  // Accept both wrapped PlotFile and bare Plot payloads so older
  // hand-written files still load.
  const raw =
    'plot' in data && data.plot ? (data.plot as Partial<Plot>) : (data as Partial<Plot>);
  return normalisePlot(raw);
}

export function suggestedFilename(): string {
  const now = new Date();
  const pad = (n: number) => String(n).padStart(2, '0');
  return `plot-${now.getFullYear()}${pad(now.getMonth() + 1)}${pad(now.getDate())}-${pad(now.getHours())}${pad(now.getMinutes())}.fplot.json`;
}

export function downloadPlot(plot: Plot): void {
  const blob = new Blob([serializePlot(plot)], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = suggestedFilename();
  document.body.appendChild(a);
  a.click();
  a.remove();
  // Give the browser a tick to start the download before revoking.
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

export function pickPlotFile(): Promise<Plot | null> {
  return new Promise(resolve => {
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = 'application/json,.json';
    input.onchange = () => {
      const file = input.files?.[0];
      if (!file) {
        resolve(null);
        return;
      }
      const reader = new FileReader();
      reader.onload = () => {
        try {
          const text = String(reader.result);
          resolve(parsePlotFile(text));
        } catch {
          resolve(null);
        }
      };
      reader.onerror = () => resolve(null);
      reader.readAsText(file);
    };
    input.click();
  });
}
