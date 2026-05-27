import type { Underlay } from './plot';

/** Pick an image file from disk, read it as a data URL, and produce an
 *  Underlay sized to fit a target on-screen footprint. The caller
 *  supplies the desired width in world coordinates so the image lands
 *  visibly in the current viewport. */
export function pickUnderlay(targetWorldWidth: number, centerWorld: { x: number; y: number }): Promise<Underlay | null> {
  return new Promise(resolve => {
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = 'image/*';
    input.onchange = async () => {
      const file = input.files?.[0];
      if (!file) {
        resolve(null);
        return;
      }
      try {
        const dataUrl = await readAsDataURL(file);
        const { width, height } = await readImageSize(dataUrl);
        if (width === 0 || height === 0) {
          resolve(null);
          return;
        }
        const scale = targetWorldWidth / width;
        resolve({
          dataUrl,
          naturalWidth: width,
          naturalHeight: height,
          center: { x: centerWorld.x, y: centerWorld.y },
          rotation: 0,
          scale,
          opacity: 0.6,
        });
      } catch {
        resolve(null);
      }
    };
    input.click();
  });
}

function readAsDataURL(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const r = new FileReader();
    r.onload = () => resolve(String(r.result));
    r.onerror = () => reject(r.error);
    r.readAsDataURL(file);
  });
}

function readImageSize(dataUrl: string): Promise<{ width: number; height: number }> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve({ width: img.naturalWidth, height: img.naturalHeight });
    img.onerror = () => reject(new Error('image decode failed'));
    img.src = dataUrl;
  });
}
