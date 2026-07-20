// Mesh-export worker: naive surface nets over the (strided, zero-padded) φ
// volume → binary STL. Surface nets place one vertex per sign-mixed cell at
// the average of its edge crossings and quad-connect across sign-changing
// sample edges — watertight by construction (the virtual φ=0 pad closes the
// box walls, and enclosed pores emit their own interior shells).

interface MsgIn {
  phi: ArrayBuffer;   // Float32Array n³ (x fastest)
  n: number;
  stride: number;
  iso: number;
  boxMm: number;      // printed size of the full volume edge
}

self.onmessage = (ev: MessageEvent<MsgIn>) => {
  try {
    const { n, stride, iso, boxMm } = ev.data;
    const phi = new Float32Array(ev.data.phi);
    const m = Math.floor((n - 1) / stride) + 1;   // samples inside the box
    const M = m + 2;                              // + one pad layer each side
    const S = new Float32Array(M * M * M);
    const sIdx = (x: number, y: number, z: number) => (z * M + y) * M + x;
    for (let z = 0; z < m; z++)
      for (let y = 0; y < m; y++) {
        const src = ((z * stride) * n + y * stride) * n;
        const dst = sIdx(1, y + 1, z + 1);
        for (let x = 0; x < m; x++) S[dst + x] = phi[src + x * stride];
      }

    // vertices: one per sign-mixed cell, at the mean of edge crossings
    const C = M - 1;
    const cellV = new Int32Array(C * C * C).fill(-1);
    const cIdx = (x: number, y: number, z: number) => (z * C + y) * C + x;
    const verts: number[] = [];
    const mmPerVox = boxMm / n;
    const toMm = (s: number) => (s - 1) * stride * mmPerVox;
    const corner = [
      [0, 0, 0], [1, 0, 0], [0, 1, 0], [1, 1, 0],
      [0, 0, 1], [1, 0, 1], [0, 1, 1], [1, 1, 1],
    ];
    const edges = [
      [0, 1], [2, 3], [4, 5], [6, 7],
      [0, 2], [1, 3], [4, 6], [5, 7],
      [0, 4], [1, 5], [2, 6], [3, 7],
    ];
    for (let z = 0; z < C; z++)
      for (let y = 0; y < C; y++)
        for (let x = 0; x < C; x++) {
          const vals: number[] = [];
          let inside = 0;
          for (const [dx, dy, dz] of corner) {
            const v = S[sIdx(x + dx, y + dy, z + dz)];
            vals.push(v);
            if (v >= iso) inside++;
          }
          if (inside === 0 || inside === 8) continue;
          let px = 0, py = 0, pz = 0, cnt = 0;
          for (const [a, b] of edges) {
            const va = vals[a], vb = vals[b];
            if ((va >= iso) === (vb >= iso)) continue;
            const t = (iso - va) / (vb - va);
            px += corner[a][0] + (corner[b][0] - corner[a][0]) * t;
            py += corner[a][1] + (corner[b][1] - corner[a][1]) * t;
            pz += corner[a][2] + (corner[b][2] - corner[a][2]) * t;
            cnt++;
          }
          cellV[cIdx(x, y, z)] = verts.length / 3;
          verts.push(toMm(x + px / cnt), toMm(y + py / cnt), toMm(z + pz / cnt));
        }

    // quads across sign-changing sample edges → two triangles each
    const tris: number[] = [];
    const quad = (c0: number, c1: number, c2: number, c3: number, flip: boolean) => {
      if (c0 < 0 || c1 < 0 || c2 < 0 || c3 < 0) return;
      if (flip) tris.push(c0, c2, c1, c0, c3, c2);
      else tris.push(c0, c1, c2, c0, c2, c3);
    };
    for (let z = 1; z < C; z++)
      for (let y = 1; y < C; y++)
        for (let x = 1; x < C; x++) {
          const s0 = S[sIdx(x, y, z)];
          const in0 = s0 >= iso;
          // +x edge — cells circle CCW seen from +x
          if (x + 1 < M && (S[sIdx(x + 1, y, z)] >= iso) !== in0)
            quad(cellV[cIdx(x, y - 1, z - 1)], cellV[cIdx(x, y, z - 1)],
              cellV[cIdx(x, y, z)], cellV[cIdx(x, y - 1, z)], !in0);
          // +y edge — CCW seen from +y is (z-1,x-1)→(z,x-1)? use axis-cycled order
          if (y + 1 < M && (S[sIdx(x, y + 1, z)] >= iso) !== in0)
            quad(cellV[cIdx(x - 1, y, z - 1)], cellV[cIdx(x - 1, y, z)],
              cellV[cIdx(x, y, z)], cellV[cIdx(x, y, z - 1)], !in0);
          // +z edge
          if (z + 1 < M && (S[sIdx(x, y, z + 1)] >= iso) !== in0)
            quad(cellV[cIdx(x - 1, y - 1, z)], cellV[cIdx(x, y - 1, z)],
              cellV[cIdx(x, y, z)], cellV[cIdx(x - 1, y, z)], !in0);
        }

    const nt = tris.length / 3;
    const buf = new ArrayBuffer(84 + 50 * nt);
    const dv = new DataView(buf);
    const header = `SOLIDIFY dendrite ${n}^3 stride ${stride} box ${boxMm}mm`;
    for (let i = 0; i < Math.min(79, header.length); i++) dv.setUint8(i, header.charCodeAt(i));
    dv.setUint32(80, nt, true);
    let o = 84;
    for (let t = 0; t < nt; t++) {
      const a = tris[t * 3] * 3, b = tris[t * 3 + 1] * 3, c = tris[t * 3 + 2] * 3;
      const ux = verts[b] - verts[a], uy = verts[b + 1] - verts[a + 1], uz = verts[b + 2] - verts[a + 2];
      const vx = verts[c] - verts[a], vy = verts[c + 1] - verts[a + 1], vz = verts[c + 2] - verts[a + 2];
      let nx = uy * vz - uz * vy, ny = uz * vx - ux * vz, nz = ux * vy - uy * vx;
      const l = Math.hypot(nx, ny, nz) || 1;
      nx /= l; ny /= l; nz /= l;
      dv.setFloat32(o, nx, true); dv.setFloat32(o + 4, ny, true); dv.setFloat32(o + 8, nz, true);
      o += 12;
      for (const vi of [a, b, c]) {
        dv.setFloat32(o, verts[vi], true);
        dv.setFloat32(o + 4, verts[vi + 1], true);
        dv.setFloat32(o + 8, verts[vi + 2], true);
        o += 12;
      }
      dv.setUint16(o, 0, true);
      o += 2;
    }
    (self as unknown as Worker).postMessage({ stl: buf, tris: nt }, [buf]);
  } catch (err) {
    (self as unknown as Worker).postMessage({ error: String(err) });
  }
};
