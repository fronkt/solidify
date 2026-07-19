// Rasterise the wordmark into a phase-field mold mask with three zones:
//   1 = letter interior (the molten pour)
//   2 = rim: a thin band of cold liquid around each glyph — dendrites sprout
//       from the letter edge into it and arrest at the mold, so the cast
//       type grows an organic dendritic fringe instead of laser-cut edges
//   0 = mold
// The band sits in the vertical middle of the square grid; a wide banner
// canvas cover-crops to exactly that band.

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
  ctx.strokeStyle = "#fff";
  ctx.lineJoin = "round";
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  const cx = n / 2, cy = bandH / 2 + size * 0.04;

  // pass 1: glyphs dilated by a stroked outline = letters + rim
  ctx.lineWidth = Math.max(4, size * 0.14);
  ctx.strokeText(word, cx, cy);
  ctx.fillText(word, cx, cy);
  const dil = ctx.getImageData(0, 0, n, bandH).data;

  // pass 2: glyph fill only = the letters themselves
  ctx.clearRect(0, 0, n, bandH);
  ctx.fillText(word, cx, cy);
  const fill = ctx.getImageData(0, 0, n, bandH).data;

  const mask = new Uint8Array(n * n);
  const cells: number[] = [];
  const y0 = Math.floor((n - bandH) / 2);
  for (let y = 0; y < bandH; y++) {
    const gy = y0 + y;   // renderer's cover-fit UV already flips rows
    for (let x = 0; x < n; x++) {
      const a = (y * n + x) * 4 + 3;
      if (fill[a] > 110) {
        const idx = gy * n + x;
        mask[idx] = 1;
        cells.push(idx);
      } else if (dil[a] > 60) {
        mask[gy * n + x] = 2;
      }
    }
  }
  return { mask, bandFrac, cells };
}
