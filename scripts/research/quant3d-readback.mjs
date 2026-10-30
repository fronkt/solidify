// Research-only RG32Float readback for arbitrary declared cube sizes. Texture
// uploads need no 256-byte row alignment, but texture-to-buffer copies do.
export function stateVolumeLayout(n) {
  if (!Number.isSafeInteger(n) || n < 1 || n > 2048) throw new Error('Invalid volume edge');
  const bytesPerRow = Math.ceil(n * 8 / 256) * 256;
  return { n, bytesPerRow, rowsPerImage: n, size: bytesPerRow * n * n };
}

export function unpackStateVolume(buffer, n) {
  const layout = stateVolumeLayout(n);
  if (!(buffer instanceof ArrayBuffer) || buffer.byteLength < layout.size)
    throw new Error('Truncated padded state volume');
  const raw = new Float32Array(buffer), stride = layout.bytesPerRow / 4;
  const phi = new Float32Array(n ** 3), T = new Float32Array(n ** 3);
  for (let z = 0; z < n; z++) for (let y = 0; y < n; y++) {
    const source = (z * n + y) * stride, target = (z * n + y) * n;
    for (let x = 0; x < n; x++) {
      phi[target + x] = raw[source + 2 * x];
      T[target + x] = raw[source + 2 * x + 1];
    }
  }
  return { phi, T };
}

export async function readStateVolumeAligned(sim) {
  const layout = stateVolumeLayout(sim.n), device = sim.device;
  const buffer = device.createBuffer({ size: layout.size, usage: GPUBufferUsage.COPY_DST | GPUBufferUsage.MAP_READ });
  let mapped = false;
  try {
    const encoder = device.createCommandEncoder();
    encoder.copyTextureToBuffer({ texture: sim.stateTexture(sim.dir) },
      { buffer, bytesPerRow: layout.bytesPerRow, rowsPerImage: layout.rowsPerImage }, [sim.n, sim.n, sim.n]);
    device.queue.submit([encoder.finish()]);
    await buffer.mapAsync(GPUMapMode.READ); mapped = true;
    return unpackStateVolume(buffer.getMappedRange(), sim.n);
  } finally {
    if (mapped) buffer.unmap();
    buffer.destroy();
  }
}
