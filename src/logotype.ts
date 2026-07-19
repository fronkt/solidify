// Rasterise the wordmark into a phase-field mold mask: 1 = letter interior
// (the molten pour), 0 = mold. The band sits in the vertical middle of the
// square grid; a wide banner canvas cover-crops to exactly that band.

const FONT = 'ui-monospace, "Cascadia Mono", "JetBrains Mono", Consolas, monospace';

export interface LogoMask {
  mask: Uint8Array;
  bandFrac: number;   // band height as a fraction of the grid
  cells: number[];    // flat indices of letter-interior cells (for seeding)
}

export function buildLogoMask(n: number, bandFrac = 0.24, word = "SOLIDIFY"): LogoMask {
  const bandH = Math.round(n * bandFrac);
  const cv = document.createElement("canvas");
  cv.width = n;
  cv.height = bandH;
  const ctx = cv.getContext("2d", { willReadFrequently: true })!;

  let size = bandH * 0.92;
  const fit = () => {
    ctx.font = `900 ${size.toFixed(1)}px ${FONT}`;
    try { (ctx as CanvasRenderingContext2D & { letterSpacing: string }).letterSpacing = `${size * 0.10}px`; } catch { /* older engines */ }
    return ctx.measureText(word).width;
  };
  const maxW = n * 0.95;
  const w0 = fit();
  if (w0 > maxW) { size *= maxW / w0; fit(); }

  ctx.fillStyle = "#fff";
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  ctx.fillText(word, n / 2, bandH / 2 + size * 0.04);
  const fill = ctx.getImageData(0, 0, n, bandH).data;

  const mask = new Uint8Array(n * n);
  const cells: number[] = [];
  const y0 = Math.floor((n - bandH) / 2);
  for (let y = 0; y < bandH; y++) {
    const gy = y0 + y;   // renderer's cover-fit UV already flips rows
    for (let x = 0; x < n; x++) {
      if (fill[(y * n + x) * 4 + 3] > 110) {
        const idx = gy * n + x;
        mask[idx] = 1;
        cells.push(idx);
      }
    }
  }
  return { mask, bandFrac, cells };
}
